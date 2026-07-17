// Zoco IA — Backend: autenticacion de clientes + API existente
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { TOOL_DEFINITIONS, ALL_TOOL_NAMES, runToolLoop, makeWorkspacesRoot } from './tools.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8080;

if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET no está definido. Usando uno temporal generado al vuelo.');
  console.warn('   Configura JWT_SECRET en las variables de entorno de Railway para producción.');
}
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
const JWT_EXPIRES_IN = '7d';
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

const DB_PATH = process.env.DB_PATH || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'app.db') : path.join(__dirname, 'data', 'app.db'));
const dbDir = path.dirname(DB_PATH);
if (dbDir && !fs.existsSync(dbDir)) {
  console.log(`📁 Creando directorio de base de datos en: ${dbDir}`);
  fs.mkdirSync(dbDir, { recursive: true });
}

console.log(`🗄️ Usando base de datos en: ${DB_PATH}`);

// Aviso crítico: si estamos en producción (Railway) y NO hay un volumen
// persistente montado, todo lo que se guarde en `db` (agentes, habilidades,
// entornos, memoria...) vivirá SOLO dentro del contenedor y desaparecerá en
// el próximo deploy/reinicio. Esto no se puede arreglar solo con código: hay
// que adjuntar un Volumen al servicio desde el dashboard/CLI de Railway
// (Command Palette ⌘K → "Create Volume", montado p. ej. en /data). En cuanto
// exista, Railway inyecta RAILWAY_VOLUME_MOUNT_PATH automáticamente y esta
// misma línea de arriba empezará a usarlo sin tocar nada más.
if (process.env.NODE_ENV === 'production' && !process.env.RAILWAY_VOLUME_MOUNT_PATH && !process.env.DB_PATH) {
  console.warn('⚠️⚠️⚠️  ATENCIÓN: no se detecta ningún volumen persistente de Railway (RAILWAY_VOLUME_MOUNT_PATH no está definido).');
  console.warn('⚠️⚠️⚠️  La base de datos SQLite vive dentro del contenedor y SE BORRARÁ en el próximo deploy/reinicio.');
  console.warn('⚠️⚠️⚠️  Solución: adjunta un Volumen a este servicio en el dashboard de Railway (Command Palette ⌘K → "Create Volume"), móntalo en /data, y haz redeploy.');
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const WORKSPACES_ROOT = makeWorkspacesRoot(dbDir);
fs.mkdirSync(WORKSPACES_ROOT, { recursive: true });

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nombre TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    is_support INTEGER DEFAULT 0,
    creditos REAL DEFAULT 0,
    activo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    last_used_at TEXT,
    revoked INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    data TEXT DEFAULT '{}',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS usage_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    kind TEXT NOT NULL DEFAULT 'gasto',
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS agent_memory (
    id TEXT PRIMARY KEY,
    agente_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agente_id) REFERENCES resources(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS prompt_cache (
    cache_key TEXT PRIMARY KEY,
    agente_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    token_estimate INTEGER NOT NULL DEFAULT 0,
    hits INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    credits REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    provider TEXT DEFAULT 'viva',
    order_code TEXT,
    transaction_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userColumns.includes('modelo_activo')) {
  db.exec("ALTER TABLE users ADD COLUMN modelo_activo TEXT DEFAULT 'zoco-plus'");
}

const RESOURCE_TYPES = ['agente', 'archivo', 'habilidad', 'lote', 'sesion', 'implementacion', 'entorno', 'credencial', 'memoria'];

const MODELOS_VALIDOS = [
  'zoco-flash', 'zoco-plus', 'zoco-max', 'zoco-lab',
  'maris-velox', 'maris-core', 'maris-pro', 'maris-beta',
  'maris-velox-1b', 'maris-core-7b', 'maris-pro-32b', 'maris-beta-70b',
];

const GROQ_MODEL_MAP = {
  'zoco-flash': 'llama-3.3-70b-versatile',
  'zoco-plus':  'llama-3.3-70b-versatile',
  'zoco-max':   'llama-3.3-70b-versatile',
  'zoco-lab':   'llama-3.3-70b-versatile',
  'maris-velox': 'llama-3.3-70b-versatile', 'maris-velox-1b': 'llama-3.3-70b-versatile',
  'maris-core':  'llama-3.3-70b-versatile', 'maris-core-7b':  'llama-3.3-70b-versatile',
  'maris-pro':   'llama-3.3-70b-versatile', 'maris-pro-32b':  'llama-3.3-70b-versatile',
  'maris-beta':  'llama-3.3-70b-versatile', 'maris-beta-70b': 'llama-3.3-70b-versatile',
};

const OLLAMA_MODEL_MAP = {
  'zoco-flash': 'Zoco-Flash',
  'zoco-plus':  'Zoco-Plus',
  'zoco-max':   'Zoco-Max',
  'zoco-lab':   'Zoco-Lab'
};

const OLLAMA_URL = process.env.OLLAMA_URL;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

async function webSearch(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'ZocoIA/1.0' }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();

    const results = [];
    if (data.AbstractText) results.push(`Resumen: ${data.AbstractText}`);
    if (data.RelatedTopics) {
      data.RelatedTopics.slice(0, 5).forEach(t => {
        if (t.Text) results.push(t.Text);
      });
    }

    try {
      const htmlRes = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZocoIA/1.0)' },
        signal: AbortSignal.timeout(5000),
      });
      if (htmlRes.ok) {
        const html = await htmlRes.text();
        const snippets = [...html.matchAll(/<a class="result__snippet"[^>]*>(.*?)<\/a>/gs)]
          .slice(0, 4)
          .map(m => m[1].replace(/<[^>]+>/g, '').trim())
          .filter(Boolean);
        results.push(...snippets);
      }
    } catch {}

    return results.length > 0 ? results.slice(0, 6).join('\n') : null;
  } catch (err) {
    console.warn('Web search falló:', err.message);
    return null;
  }
}

function needsWebSearch(text) {
  if (!text) return false;
  const keywords = [
    'hoy', 'ahora', 'actual', 'última hora', 'noticia', 'noticias',
    'precio', 'cotización', 'tiempo', 'temperatura', 'clima',
    '2024', '2025', '2026', 'mundial', 'elección', 'ganó', 'gano',
    'quien es el presidente', 'quién ganó', 'últimas noticias',
    'what happened', 'latest', 'current', 'today', 'news',
  ];
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

const PROMPT_CACHE_TTL_MS = 5 * 60 * 1000;

function seedAdminAccount() {
  const email = process.env.ADMIN_EMAIL;
  const passwordPlain = process.env.ADMIN_PASSWORD;
  if (!email || !passwordPlain) {
    console.log('ℹ️  ADMIN_EMAIL / ADMIN_PASSWORD no configurados: no se crea/actualiza cuenta admin.');
    return;
  }
  const passwordHash = bcrypt.hashSync(passwordPlain, 12);
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    db.prepare(
      'UPDATE users SET password_hash = ?, is_admin = 1, is_support = 1, activo = 1, creditos = 99999999.99 WHERE id = ?'
    ).run(passwordHash, existing.id);
    console.log(`✅ Cuenta admin/soporte actualizada para ${email}`);
  } else {
    db.prepare(
      'INSERT INTO users (id, email, password_hash, nombre, is_admin, is_support, creditos, activo) VALUES (?, ?, ?, ?, 1, 1, 99999999.99, 1)'
    ).run(uuidv4(), email.toLowerCase(), passwordHash, 'Maria (Admin)');
    console.log(`✅ Cuenta admin/soporte creada para ${email}`);
  }
}
seedAdminAccount();

// Catálogo de los 11 agentes por defecto de Zoco IA. Se recrean automáticamente
// al arrancar el servidor SI el usuario admin no tiene todavía ningún agente
// (es idempotente: si el volumen persistente ya está funcionando, esto no
// hará nada tras la primera vez; si por lo que sea el disco vuelve a estar
// vacío tras un deploy, actúa como red de seguridad y los recrea solos).
// NOTA: solo cubre el agente en sí (nombre + system prompt + parámetros).
// Las Habilidades/Entornos/Implementaciones específicas de tu operación no
// estaban detalladas, así que no se inventan valores (API keys, URLs, etc.);
// puedes añadirlos desde el panel una vez creados los agentes.
const DEFAULT_AGENTS = [
  { name: 'Agente de Investigación (Researcher)', systemPrompt: 'Eres el Agente de Investigación de Zoco IA. Tu trabajo es buscar información actualizada en internet, analizarla y sintetizarla en briefs técnicos claros, con fuentes cuando sea posible.' },
  { name: 'Agente Arquitecto', systemPrompt: 'Eres el Agente Arquitecto de Zoco IA. Diseñas arquitecturas de software (backend, frontend, infraestructura) y tomas decisiones técnicas de alto nivel, explicando trade-offs.' },
  { name: 'Agente de Diseño (Diseñador)', systemPrompt: 'Eres el Agente de Diseño de Zoco IA. Ayudas con UX/UI, sistemas de diseño, wireframes y decisiones visuales, priorizando claridad y usabilidad.' },
  { name: 'Agente de Interfaz', systemPrompt: 'Eres el Agente de Interfaz de Zoco IA. Te especializas en implementar componentes de frontend (React/TypeScript), maquetación y experiencia de usuario en código real.' },
  { name: 'Agente de Backend', systemPrompt: 'Eres el Agente de Backend de Zoco IA. Implementas APIs, lógica de servidor, autenticación e integración con bases de datos, priorizando seguridad y buenas prácticas.' },
  { name: 'Agente de Base de Datos', systemPrompt: 'Eres el Agente de Base de Datos de Zoco IA. Diseñas esquemas, escribes consultas eficientes y asesoras sobre migraciones, índices y modelado de datos.' },
  { name: 'Agente de Integraciones', systemPrompt: 'Eres el Agente de Integraciones de Zoco IA. Conectas servicios de terceros (pagos, email, APIs externas) y resuelves problemas de autenticación/webhooks entre sistemas.' },
  { name: 'Agente de Control de Calidad (QA)', systemPrompt: 'Eres el Agente de QA de Zoco IA. Revisas código y funcionalidades en busca de bugs, casos límite y regresiones, y propones planes de prueba.' },
  { name: 'Agente DevOps', systemPrompt: 'Eres el Agente DevOps de Zoco IA. Te ocupas de despliegues, CI/CD, variables de entorno, contenedores y la fiabilidad de la infraestructura (incluyendo Railway).' },
  { name: 'Agente de Pruebas (Testing)', systemPrompt: 'Eres el Agente de Pruebas de Zoco IA. Escribes y ejecutas tests unitarios, de integración y end-to-end, e informas resultados de forma clara.' },
  { name: 'Agente de Reparación', systemPrompt: 'Eres el Agente de Reparación de Zoco IA. Diagnosticas errores a partir de logs/stack traces y propones o aplicas el fix más seguro y mínimo posible.' },
];

function seedDefaultAgents() {
  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    console.log('ℹ️  ADMIN_EMAIL no configurado: no se siembran agentes por defecto (no hay usuario al que asignarlos).');
    return;
  }
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return; // No debería pasar justo después de seedAdminAccount(), pero por seguridad.

  const existentes = db.prepare("SELECT name FROM resources WHERE user_id = ? AND type = 'agente'").all(user.id);
  const nombresExistentes = new Set(existentes.map(r => r.name));

  const insert = db.prepare('INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, ?, ?, ?)');
  let creados = 0;
  for (const agente of DEFAULT_AGENTS) {
    if (nombresExistentes.has(agente.name)) continue; // ya existe: no duplicar
    insert.run(uuidv4(), user.id, 'agente', agente.name, JSON.stringify({
      systemPrompt: agente.systemPrompt,
      modelo: 'zoco-plus',
      habilidadesActivas: [],
      allowedTools: ALL_TOOL_NAMES,
      num_predict: 4096,
      num_ctx: 8192,
      temperature: 0.7,
      busquedaWeb: true,
    }));
    creados++;
  }
  if (creados > 0) {
    console.log(`✅ Sembrados ${creados} agente(s) por defecto para ${email} (de un total de ${DEFAULT_AGENTS.length} esperados).`);
  } else {
    console.log(`ℹ️  Los ${DEFAULT_AGENTS.length} agentes por defecto ya existen para ${email}; no se crea ninguno nuevo.`);
  }
}
seedDefaultAgents();

app.use(cors());
app.use(express.json());

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, isAdmin: !!user.is_admin, isSupport: !!user.is_support },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    nombre: user.nombre,
    isAdmin: !!user.is_admin,
    isSupport: !!user.is_support,
    creditos: user.creditos,
    activo: !!user.activo,
    modeloActivo: user.modelo_activo || 'zoco-plus',
    createdAt: user.created_at,
  };
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil((text || '').length / 4));
}

function buildCacheKey(userId, agentId, systemPromptText) {
  return crypto.createHash('sha256').update(`${userId}::${agentId || 'general'}::${systemPromptText}`).digest('hex');
}

/**
 * Comprueba si el system prompt de esta conversación ya está "cacheado" (se usó
 * hace menos de PROMPT_CACHE_TTL_MS). Si es así, devuelve el descuento de tokens
 * a aplicar en el coste (no se vuelve a cobrar por reprocesar ese prefijo).
 * Si no, crea/renueva la entrada de caché para la próxima llamada.
 */
function checkAndUpdatePromptCache(userId, agentId, systemPromptText) {
  const cacheKey = buildCacheKey(userId, agentId, systemPromptText);
  const tokenEstimate = estimateTokens(systemPromptText);
  const now = Date.now();

  const existing = db.prepare('SELECT * FROM prompt_cache WHERE cache_key = ?').get(cacheKey);

  if (existing && existing.expires_at > now) {
    db.prepare('UPDATE prompt_cache SET hits = hits + 1, expires_at = ? WHERE cache_key = ?')
      .run(now + PROMPT_CACHE_TTL_MS, cacheKey);
    return { hit: true, cachedTokens: existing.token_estimate };
  }

  if (existing) {
    db.prepare('UPDATE prompt_cache SET hits = 0, token_estimate = ?, expires_at = ? WHERE cache_key = ?')
      .run(tokenEstimate, now + PROMPT_CACHE_TTL_MS, cacheKey);
  } else {
    db.prepare('INSERT INTO prompt_cache (cache_key, agente_id, user_id, token_estimate, hits, expires_at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(cacheKey, agentId || 'general', userId, tokenEstimate, now + PROMPT_CACHE_TTL_MS);
  }
  return { hit: false, cachedTokens: 0 };
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión inválida o caducada' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.auth.isAdmin && !req.auth.isSupport) return res.status(403).json({ error: 'No autorizado' });
  next();
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getUserOr404(id, res) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado' });
    return null;
  }
  return user;
}

function firstOfMonthISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Zoco IA conectado con éxito' });
});

async function callChatModel({ usandoOllama, ollamaUrl, ollamaModel, groqModel, messages, maxTokens, temperature, tools, ollamaOptions }) {
  async function doFetch(url, auth, model, extraOllamaOptions) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature,
          ...(tools && tools.length ? { tools } : {}),
          // 'options' es una extensión propia de Ollama (num_ctx, num_predict, etc.)
          // sobre el endpoint compatible con OpenAI. Groq la ignora si se le llegara
          // a enviar, así que solo se añade cuando se llama de verdad a Ollama.
          ...(extraOllamaOptions ? { options: extraOllamaOptions } : {}),
        }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        const e = new Error(err.error?.message || 'Error al llamar al modelo de IA');
        e.status = resp.status;
        throw e;
      }
      return await resp.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (usandoOllama) {
    try {
      return await doFetch(`${ollamaUrl.replace(/\/+$/, '')}/v1/chat/completions`, 'Bearer ollama', ollamaModel, ollamaOptions);
    } catch (err) {
      if (err.name === 'AbortError' && GROQ_API_KEY) {
        console.warn('Ollama timeout — usando Groq como fallback');
        return await doFetch(GROQ_API_URL, `Bearer ${GROQ_API_KEY}`, groqModel);
      }
      if (err.name === 'AbortError') {
        const e = new Error('Timeout: el modelo tardó demasiado en responder');
        e.status = 504;
        throw e;
      }
      const e = new Error('Error de conexión con el modelo de IA');
      e.status = 502;
      throw e;
    }
  }
  return await doFetch(GROQ_API_URL, `Bearer ${GROQ_API_KEY}`, groqModel);
}

/**
 * Lógica compartida de inferencia (créditos, agente, caché de prompts, tools,
 * Ollama/Groq). Extraída para que /v1/chat/completions y /api/chat la llamen
 * directamente en memoria — SIN hacer una petición HTTP de vuelta al propio
 * servidor (evitar eso es importante: un fetch a "http://localhost:PORT/..."
 * puede colgarse por resolución IPv4/IPv6 de "localhost" en algunos entornos
 * como Railway, dejando el chat "parado" sin motivo aparente).
 * Lanza errores con `.status` adjunto (mismo patrón que ya usaba esta ruta).
 */
async function processChatCompletion(authSub, { agentId, messages, model, temperature: temperatureInput, max_tokens: maxTokensInput }) {
  if (!GROQ_API_KEY) {
    const e = new Error('GROQ_API_KEY no configurada en el servidor'); e.status = 503; throw e;
  }

  const userCheck = db.prepare('SELECT creditos, activo FROM users WHERE id = ?').get(authSub);
  if (!userCheck || !userCheck.activo) {
    const e = new Error('Cuenta desactivada'); e.status = 403; throw e;
  }
  if (userCheck.creditos <= 0) {
    const e = new Error('Créditos insuficientes. Recarga tu cuenta en zocoia.es/billing'); e.status = 402; e.code = 'insufficient_credits'; throw e;
  }

  const userMessage = Array.isArray(messages) && messages.length ? messages[messages.length - 1] : null;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(authSub);
  const modeloZocoia = model || user?.modelo_activo || 'zoco-plus';
  const groqModel = GROQ_MODEL_MAP[modeloZocoia] || GROQ_MODEL_MAP['zoco-plus'];

  let agente = null;
  let agenteData = {};
  let cacheResult = { hit: false, cachedTokens: 0 };

  let mensajesParaGroq = [];
  let systemPromptText = '';

  if (agentId) {
    agente = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?').get(agentId, authSub, 'agente');
    if (!agente) { const e = new Error('Agente no encontrado'); e.status = 404; throw e; }

    agenteData = agente.data ? JSON.parse(agente.data) : {};
    const historial = db.prepare('SELECT role, content FROM agent_memory WHERE agente_id = ? ORDER BY created_at ASC LIMIT 50').all(agentId);

    systemPromptText = agenteData.systemPrompt || `Eres ${agente.name}, un asistente de IA útil y preciso.`;
    mensajesParaGroq.push({ role: 'system', content: systemPromptText });
    mensajesParaGroq = mensajesParaGroq.concat(historial);
    if (userMessage) mensajesParaGroq.push({ role: 'user', content: String(userMessage.content) });

    // Caché de prompts: si este mismo system prompt (por agente+usuario) se usó
    // hace menos de PROMPT_CACHE_TTL_MS, no se vuelve a cobrar por esos tokens.
    cacheResult = checkAndUpdatePromptCache(authSub, agentId, systemPromptText);
  } else {
    mensajesParaGroq = Array.isArray(messages) ? messages : [{ role: 'user', content: 'Hola' }];
  }

  const lastUserMsg = mensajesParaGroq.filter(m => m.role === 'user').slice(-1)[0]?.content || '';
  if (needsWebSearch(lastUserMsg)) {
    const searchResults = await webSearch(lastUserMsg);
    if (searchResults) {
      const webCtx = `\n\n[CONTEXTO WEB - ${new Date().toLocaleDateString('es-ES')}]\n${searchResults}\n[FIN CONTEXTO WEB]\nUsa este contexto para responder con información actualizada.`;
      const sysIdx = mensajesParaGroq.findIndex(m => m.role === 'system');
      if (sysIdx >= 0) {
        mensajesParaGroq[sysIdx] = { ...mensajesParaGroq[sysIdx], content: mensajesParaGroq[sysIdx].content + webCtx };
      } else {
        mensajesParaGroq.unshift({ role: 'system', content: `Eres Zoco IA, un asistente útil y preciso.${webCtx}` });
      }
      console.log('🌐 Web search inyectado para:', lastUserMsg.slice(0, 60));
    }
  }

  const usandoOllama = !!OLLAMA_URL;
  const modeloFinal = usandoOllama
    ? (OLLAMA_MODEL_MAP[modeloZocoia] || modeloZocoia)
    : groqModel;
  console.log(`[IA] ${modeloZocoia} → ${modeloFinal} via ${usandoOllama ? 'Ollama' : 'Groq'}`);

  // Parámetros avanzados de IA por agente (num_predict / num_ctx / temperature),
  // con límites de seguridad y valores por defecto si el agente no los define.
  const clamp = (v, min, max, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  const numPredict = clamp(agenteData.num_predict, 256, 8192, 4096);
  const numCtx = clamp(agenteData.num_ctx, 2048, 16384, 8192);
  const temperature = clamp(temperatureInput ?? agenteData.temperature, 0, 1.2, 0.7);
  const maxTokens = maxTokensInput || numPredict;

  // options nativas de Ollama; solo tienen efecto cuando usandoOllama = true
  const ollamaOptions = { num_predict: numPredict, num_ctx: numCtx };

  const allowedTools = agentId
    ? (Array.isArray(agenteData.allowedTools) ? agenteData.allowedTools : ALL_TOOL_NAMES)
    : [];

  const callModel = (msgs, tools) =>
    callChatModel({
      usandoOllama,
      ollamaUrl: OLLAMA_URL,
      ollamaModel: modeloFinal,
      groqModel,
      messages: msgs,
      maxTokens,
      temperature,
      tools,
      ollamaOptions,
    });

  let respuesta;
  let usage;

  if (allowedTools.length > 0) {
    const result = await runToolLoop({
      messages: mensajesParaGroq,
      callModel,
      allowedTools,
      workspacesRoot: WORKSPACES_ROOT,
      workspaceId: agentId,
    });
    respuesta = result.finalMessage;
    usage = result.usage;
  } else {
    const data = await callModel(mensajesParaGroq, undefined);
    respuesta = data.choices?.[0]?.message?.content || '';
    usage = data.usage || {};
  }

  if (agentId && userMessage?.content) {
    db.prepare('INSERT INTO agent_memory (id, agente_id, user_id, role, content) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), agentId, authSub, 'user', String(userMessage.content));
    db.prepare('INSERT INTO agent_memory (id, agente_id, user_id, role, content) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), agentId, authSub, 'assistant', respuesta);
  }

  const totalTokens = usage.total_tokens || 0;
  const tokensConDescuento = cacheResult.hit ? Math.max(0, totalTokens - Math.round(cacheResult.cachedTokens * 0.9)) : totalTokens;
  const costeEuros = tokensConDescuento * 0.000002;
  if (costeEuros > 0) {
    db.prepare('INSERT INTO usage_log (id, user_id, amount, kind, description) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), authSub, costeEuros, 'gasto', `Groq ${groqModel}${cacheResult.hit ? ' (caché de prompt)' : ''}`);
    db.prepare('UPDATE users SET creditos = MAX(0, creditos - ?) WHERE id = ?')
      .run(costeEuros, authSub);
  }

  return {
    choices: [{ message: { role: 'assistant', content: respuesta } }],
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
      total_tokens: totalTokens,
      cache_read_tokens: cacheResult.hit ? cacheResult.cachedTokens : 0,
    },
    model: groqModel,
  };
}

app.post('/v1/chat/completions', authMiddleware, async (req, res) => {
  try {
    const result = await processChatCompletion(req.auth.sub, req.body || {});
    res.json(result);
  } catch (err) {
    console.error('Error inferencia:', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Error interno al procesar la solicitud', ...(err.code ? { code: err.code } : {}) });
  }
});

// Adaptador para el Dashboard: el frontend llama a POST /api/chat con
// { message, agentId, model, history } y espera { response }. Reutiliza
// processChatCompletion() directamente (llamada de función, no de red), así
// que toda la lógica de créditos/memoria/Ollama-Groq sigue siendo una única
// fuente de verdad y no hay ningún salto de red que se pueda quedar colgado.
app.post('/api/chat', authMiddleware, async (req, res) => {
  try {
    const { message, agentId, model, history } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'El mensaje es obligatorio' });
    }

    const historialMensajes = Array.isArray(history)
      ? history
          .filter(m => m && typeof m.content === 'string')
          .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
      : [];

    const messages = [...historialMensajes, { role: 'user', content: String(message) }];

    const result = await processChatCompletion(req.auth.sub, { agentId, model, messages });
    res.json({ response: result.choices?.[0]?.message?.content || '', usage: result.usage, model: result.model });

  } catch (err) {
    console.error('Error en /api/chat:', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Error interno al procesar el mensaje', ...(err.code ? { code: err.code } : {}) });
  }
});

app.get('/api/cache/stats', authMiddleware, (req, res) => {
  const rows = db.prepare(
    'SELECT cache_key, agente_id, hits, token_estimate, expires_at FROM prompt_cache WHERE user_id = ? AND expires_at > ?'
  ).all(req.auth.sub, Date.now());
  const totalHits = rows.reduce((sum, r) => sum + r.hits, 0);
  const tokensAhorrados = rows.reduce((sum, r) => sum + (r.hits * Math.round(r.token_estimate * 0.9)), 0);
  res.json({
    entradasActivas: rows.length,
    totalHits,
    tokensAhorrados,
    ahorroEstimadoEuros: tokensAhorrados * 0.000002,
  });
});

app.put('/api/user/modelo', authMiddleware, (req, res) => {
  const { modelo } = req.body || {};
  if (!MODELOS_VALIDOS.includes(modelo)) return res.status(400).json({ error: 'Modelo no válido' });

  db.prepare('UPDATE users SET modelo_activo = ? WHERE id = ?').run(modelo, req.auth.sub);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ user: publicUser(user) });
});

app.get('/api/agentes/:id/memoria', authMiddleware, (req, res) => {
  const agente = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?').get(req.params.id, req.auth.sub, 'agente');
  if (!agente) return res.status(404).json({ error: 'Agente no encontrado' });

  const mensajes = db.prepare('SELECT id, role, content, created_at FROM agent_memory WHERE agente_id = ? ORDER BY created_at ASC').all(req.params.id);
  const cacheActiva = db.prepare('SELECT COUNT(*) as count FROM prompt_cache WHERE agente_id = ? AND expires_at > ?').get(req.params.id, Date.now()).count;

  res.json({ mensajes, cacheActiva: cacheActiva > 0 });
});

app.post('/api/agentes/:id/memoria', authMiddleware, (req, res) => {
  const agente = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?').get(req.params.id, req.auth.sub, 'agente');
  if (!agente) return res.status(404).json({ error: 'Agente no encontrado' });

  const { role, content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'El contenido es obligatorio' });

  const id = uuidv4();
  db.prepare('INSERT INTO agent_memory (id, agente_id, user_id, role, content) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.params.id, req.auth.sub, role === 'assistant' ? 'assistant' : 'user', content.trim());

  res.status(201).json({ id, role: role === 'assistant' ? 'assistant' : 'user', content: content.trim() });
});

app.delete('/api/agentes/:id/memoria', authMiddleware, (req, res) => {
  const agente = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?').get(req.params.id, req.auth.sub, 'agente');
  if (!agente) return res.status(404).json({ error: 'Agente no encontrado' });

  db.prepare('DELETE FROM agent_memory WHERE agente_id = ?').run(req.params.id);
  db.prepare('DELETE FROM prompt_cache WHERE agente_id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/auth/register', (req, res) => {
  const { email, password, nombre } = req.body || {};
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Email no válido' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

  const emailLower = email.toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(emailLower);
  if (existing) return res.status(409).json({ error: 'Ya existe una cuenta con ese email' });

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 12);
  db.prepare(
    'INSERT INTO users (id, email, password_hash, nombre, is_admin, is_support, creditos, activo) VALUES (?, ?, ?, ?, 0, 0, 0, 1)'
  ).run(id, emailLower, passwordHash, nombre.trim());

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email) || !password) {
    return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !user.activo) return res.status(401).json({ error: 'Credenciales incorrectas' });

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });

  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

app.get('/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ user: publicUser(user) });
});

app.post('/auth/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  const genericResponse = { message: 'Si el email existe en nuestro sistema, recibirás un enlace de recuperación.' };
  if (!isValidEmail(email)) return res.json(genericResponse);

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return res.json(genericResponse);

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + RESET_TOKEN_TTL_MS;
  db.prepare('INSERT INTO password_resets (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)').run(token, user.id, expiresAt);

  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const resetLink = `${appUrl}/restablecer-password?token=${token}`;

  const sent = await sendPasswordResetEmail(user.email, resetLink);
  if (!sent) {
    console.log(`🔗 Enlace de recuperación para ${user.email}: ${resetLink}`);
  }

  res.json(genericResponse);
});

app.post('/auth/reset-password', (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || password.length < 8) {
    return res.status(400).json({ error: 'Token y contraseña (mín. 8 caracteres) son obligatorios' });
  }
  const record = db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token);
  if (!record || record.used || record.expires_at < Date.now()) {
    return res.status(400).json({ error: 'El enlace de recuperación no es válido o ha caducado' });
  }
  const passwordHash = bcrypt.hashSync(password, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, record.user_id);
  db.prepare('UPDATE password_resets SET used = 1 WHERE token = ?').run(token);

  res.json({ message: 'Contraseña actualizada correctamente' });
});

async function sendPasswordResetEmail(toEmail, resetLink) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !fromEmail) return false;
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: toEmail,
        subject: 'Recupera tu contraseña — Zoco IA',
        html: `<p>Has solicitado restablecer tu contraseña.</p><p><a href="${resetLink}">Haz clic aquí para crear una nueva contraseña</a></p><p>Este enlace caduca en 1 hora. Si no lo has pedido tú, ignora este correo.</p>`,
      }),
    });
    return resp.ok;
  } catch (err) {
    console.error('Error enviando email con Resend:', err);
    return false;
  }
}

app.get('/api/keys', authMiddleware, (req, res) => {
  const rows = db.prepare(
    'SELECT id, name, key_prefix, last_used_at, revoked, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.auth.sub);
  res.json(rows.map(r => ({
    id: r.id,
    name: r.name,
    display: `${r.key_prefix}${'•'.repeat(16)}`,
    lastUsedAt: r.last_used_at,
    revoked: !!r.revoked,
    createdAt: r.created_at,
  })));
});

app.post('/api/keys', authMiddleware, (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre de la clave es obligatorio' });

  const rawSecret = crypto.randomBytes(24).toString('hex');
  const fullKey = `sk-zoco-${rawSecret}`;
  const keyPrefix = `sk-zoco-${rawSecret.slice(0, 6)}`;
  const keyHash = crypto.createHash('sha256').update(fullKey).digest('hex');
  const id = uuidv4();

  db.prepare(
    'INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash) VALUES (?, ?, ?, ?, ?)'
  ).run(id, req.auth.sub, name.trim(), keyPrefix, keyHash);

  res.status(201).json({ id, name: name.trim(), key: fullKey, createdAt: new Date().toISOString() });
});

app.delete('/api/keys/:id', authMiddleware, (req, res) => {
  const key = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
  if (!key) return res.status(404).json({ error: 'Clave no encontrada' });
  db.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/resources', authMiddleware, (req, res) => {
  const { type } = req.query;
  if (type && !RESOURCE_TYPES.includes(type)) return res.status(400).json({ error: 'Tipo de recurso no válido' });

  const rows = type
    ? db.prepare('SELECT * FROM resources WHERE user_id = ? AND type = ? ORDER BY created_at DESC').all(req.auth.sub, type)
    : db.prepare('SELECT * FROM resources WHERE user_id = ? ORDER BY created_at DESC').all(req.auth.sub);

  res.json(rows.map(r => ({
    id: r.id,
    type: r.type,
    name: r.name,
    data: JSON.parse(r.data || '{}'),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })));
});

app.post('/api/resources', authMiddleware, (req, res) => {
  const { type, name, data } = req.body || {};
  if (!RESOURCE_TYPES.includes(type)) return res.status(400).json({ error: 'Tipo de recurso no válido' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

  const id = uuidv4();
  db.prepare(
    'INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, ?, ?, ?)'
  ).run(id, req.auth.sub, type, name.trim(), JSON.stringify(data || {}));

  const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(id);
  res.status(201).json({ id: row.id, type: row.type, name: row.name, data: JSON.parse(row.data), createdAt: row.created_at });
});

app.put('/api/resources/:id', authMiddleware, (req, res) => {
  const row = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
  if (!row) return res.status(404).json({ error: 'Recurso no encontrado' });

  const { name, data } = req.body || {};
  const newName = (name && name.trim()) || row.name;
  const newData = data !== undefined ? JSON.stringify(data) : row.data;

  db.prepare('UPDATE resources SET name = ?, data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newName, newData, row.id);
  const updated = db.prepare('SELECT * FROM resources WHERE id = ?').get(row.id);
  res.json({ id: updated.id, type: updated.type, name: updated.name, data: JSON.parse(updated.data), updatedAt: updated.updated_at });
});

app.delete('/api/resources/:id', authMiddleware, (req, res) => {
  const row = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
  if (!row) return res.status(404).json({ error: 'Recurso no encontrado' });
  db.prepare('DELETE FROM resources WHERE id = ?').run(row.id);
  if (row.type === 'agente') {
    db.prepare('DELETE FROM agent_memory WHERE agente_id = ?').run(row.id);
    db.prepare('DELETE FROM prompt_cache WHERE agente_id = ?').run(row.id);
  }
  res.json({ ok: true });
});

app.get('/api/billing/summary', authMiddleware, (req, res) => {
  const user = getUserOr404(req.auth.sub, res);
  if (!user) return;

  const monthStart = firstOfMonthISO();
  const spendRow = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM usage_log WHERE user_id = ? AND kind = 'gasto' AND created_at >= ?"
  ).get(user.id, monthStart);

  const resourceCounts = db.prepare(
    'SELECT type, COUNT(*) as count FROM resources WHERE user_id = ? GROUP BY type'
  ).all(user.id);

  const countsByType = {};
  RESOURCE_TYPES.forEach(t => { countsByType[t] = 0; });
  resourceCounts.forEach(r => { countsByType[r.type] = r.count; });

  const keysCount = db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE user_id = ? AND revoked = 0').get(user.id).count;

  res.json({
    creditos: user.creditos,
    gastoEsteMes: spendRow.total,
    recursos: countsByType,
    clavesActivas: keysCount,
  });
});

app.post('/api/billing/topup', authMiddleware, (req, res) => {
  const { amount } = req.body || {};
  const value = Number(amount);
  if (!value || value <= 0) return res.status(400).json({ error: 'El importe debe ser mayor que 0' });

  db.prepare('UPDATE users SET creditos = creditos + ? WHERE id = ?').run(value, req.auth.sub);
  db.prepare(
    'INSERT INTO usage_log (id, user_id, amount, kind, description) VALUES (?, ?, ?, ?, ?)'
  ).run(uuidv4(), req.auth.sub, value, 'recarga', 'Recarga de créditos');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub);
  res.json({ creditos: user.creditos });
});

const VIVA_CLIENT_ID     = process.env.VIVA_CLIENT_ID;
const VIVA_CLIENT_SECRET = process.env.VIVA_CLIENT_SECRET;
const VIVA_SOURCE_CODE   = process.env.VIVA_SOURCE_CODE;
const VIVA_IS_DEMO       = process.env.VIVA_IS_DEMO !== 'false';
const VIVA_BASE          = VIVA_IS_DEMO ? 'https://demo.vivapayments.com' : 'https://www.vivapayments.com';
const VIVA_API_BASE      = VIVA_IS_DEMO ? 'https://demo-api.vivapayments.com' : 'https://api.vivapayments.com';
const APP_URL            = process.env.APP_URL || 'https://zocoia-production.up.railway.app';

const CREDIT_PACKS = [
  { id: 'starter',  euros: 5,   credits: 5,   label: 'Starter'     },
  { id: 'basic',    euros: 10,  credits: 11,  label: 'Basic'       },
  { id: 'pro',      euros: 25,  credits: 28,  label: 'Pro'         },
  { id: 'business', euros: 50,  credits: 60,  label: 'Business'    },
  { id: 'enterprise',euros: 100, credits: 125, label: 'Enterprise' },
];

async function getVivaToken() {
  const res = await fetch(`${VIVA_API_BASE}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: VIVA_CLIENT_ID,
      client_secret: VIVA_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error('No se pudo obtener token de Viva');
  const data = await res.json();
  return data.access_token;
}

app.get('/api/payments/packs', authMiddleware, (req, res) => {
  res.json(CREDIT_PACKS);
});

app.get('/api/payments/history', authMiddleware, (req, res) => {
  const payments = db.prepare(
    'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(req.auth.sub);
  res.json(payments);
});

app.post('/api/payments/create', authMiddleware, async (req, res) => {
  if (!VIVA_CLIENT_ID || !VIVA_CLIENT_SECRET || !VIVA_SOURCE_CODE) {
    return res.status(503).json({ error: 'Pasarela de pago no configurada todavía' });
  }

  const { packId } = req.body || {};
  const pack = CREDIT_PACKS.find(p => p.id === packId);
  if (!pack) return res.status(400).json({ error: 'Paquete no válido' });

  const user = getUserOr404(req.auth.sub, res);
  if (!user) return;

  try {
    const token = await getVivaToken();

    const orderRes = await fetch(`${VIVA_API_BASE}/checkout/v2/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        amount: Math.round(pack.euros * 100),
        customerTrns: `Zoco IA — ${pack.label} (${pack.credits} créditos)`,
        customer: { email: user.email, fullName: user.nombre },
        paymentTimeout: 1800,
        preauth: false,
        allowRecurring: false,
        maxInstallments: 0,
        paymentNotification: true,
        merchantTrns: `zocoia-${req.auth.sub}-${pack.id}`,
        sourceCode: VIVA_SOURCE_CODE,
        tags: [`user:${req.auth.sub}`, `pack:${pack.id}`],
        paymentMethodFees: [],
        disabledPaymentMethods: [
          'paypal', 'mbway', 'mbreference', 'mobilepay',
          'cash', 'wallet', 'prepaid',
        ],
        allowedPaymentMethods: [0],
      }),
    });

    if (!orderRes.ok) {
      const err = await orderRes.json().catch(() => ({}));
      console.error('Error Viva crear orden:', err);
      return res.status(502).json({ error: 'Error al crear el pedido en Viva' });
    }

    const orderData = await orderRes.json();
    const orderCode = orderData.orderCode;

    const paymentId = uuidv4();
    db.prepare(
      'INSERT INTO payments (id, user_id, amount, credits, status, provider, order_code) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(paymentId, req.auth.sub, pack.euros, pack.credits, 'pending', 'viva', String(orderCode));

    const checkoutUrl = `${VIVA_BASE}/web/checkout?ref=${orderCode}&color=1a1a2e&langs=es&paymentMethod=0`;
    res.json({ checkoutUrl, orderCode, paymentId });

  } catch (err) {
    console.error('Error creando pago:', err);
    res.status(500).json({ error: 'Error interno al crear el pago' });
  }
});

app.post('/api/payments/webhook', async (req, res) => {
  try {
    const { EventTypeId, EventData } = req.body || {};
    if (EventTypeId !== 1796) return res.json({ ok: true });

    const { OrderCode, TransactionId, Amount } = EventData || {};
    if (!OrderCode || !TransactionId) return res.status(400).json({ error: 'Datos incompletos' });

    const payment = db.prepare('SELECT * FROM payments WHERE order_code = ? AND status = ?').get(String(OrderCode), 'pending');
    if (!payment) {
      console.warn('Webhook Viva: pago no encontrado o ya procesado:', OrderCode);
      return res.json({ ok: true });
    }

    db.prepare('UPDATE payments SET status = ?, transaction_id = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('completed', TransactionId, payment.id);

    db.prepare('UPDATE users SET creditos = creditos + ? WHERE id = ?')
      .run(payment.credits, payment.user_id);

    db.prepare('INSERT INTO usage_log (id, user_id, amount, kind, description) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), payment.user_id, payment.credits, 'recarga', `Recarga via Viva.com — ${payment.credits} créditos`);

    console.log(`✅ Pago completado: usuario ${payment.user_id} recibió ${payment.credits} créditos`);
    res.json({ ok: true });

  } catch (err) {
    console.error('Error en webhook Viva:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/payments/webhook', (req, res) => {
  const key = String(process.env.VIVA_WEBHOOK_KEY || '');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ Key: key }));
});

app.get('/api/payments/success', authMiddleware, (req, res) => {
  const { s, orderCode } = req.query;
  const payment = db.prepare('SELECT * FROM payments WHERE order_code = ?').get(String(orderCode));
  if (payment && payment.status === 'completed') {
    return res.json({ ok: true, credits: payment.credits, message: `¡Pago completado! Se han añadido ${payment.credits} créditos a tu cuenta.` });
  }
  res.json({ ok: false, message: 'Pago pendiente de confirmación' });
});

app.get('/api/system/ollama', authMiddleware, async (req, res) => {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  try {
    const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return res.json({ online: false });
    const data = await resp.json();
    res.json({ online: true, models: (data.models || []).map(m => m.name) });
  } catch (err) {
    res.json({ online: false });
  }
});

app.get('/admin/stats', authMiddleware, requireAdmin, (req, res) => {
  const totalUsuarios = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  const usuariosActivos = db.prepare("SELECT COUNT(*) as n FROM users WHERE activo = 1").get().n;
  const ingresosTotal = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM payments WHERE status='completed'").get().t;
  const llamadasHoy = db.prepare("SELECT COUNT(*) as n FROM usage_log WHERE kind='gasto' AND created_at >= date('now')").get().n;
  const ultimosPagos = db.prepare(`
    SELECT p.*, u.email as user_email FROM payments p 
    LEFT JOIN users u ON u.id = p.user_id 
    ORDER BY p.created_at DESC LIMIT 50
  `).all();
  const vivaConfigurado = !!(process.env.VIVA_CLIENT_ID && process.env.VIVA_CLIENT_SECRET);
  const ollamaOnline = !!process.env.OLLAMA_URL;

  res.json({ totalUsuarios, usuariosActivos, ingresosTotal, llamadasHoy, ultimosPagos, vivaConfigurado, ollamaOnline });
});

app.get('/admin/logs', authMiddleware, requireAdmin, (req, res) => {
  const logs = db.prepare('SELECT * FROM usage_log ORDER BY created_at DESC LIMIT 100').all();
  res.json(logs);
});

app.get('/admin/clientes', authMiddleware, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, email, nombre, is_admin, is_support, creditos, activo, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users.map(publicUser));
});

app.put('/admin/clientes/:id', authMiddleware, requireAdmin, (req, res) => {
  const target = getUserOr404(req.params.id, res);
  if (!target) return;

  const { creditos, activo, isAdmin, isSupport, nombre, _addCredits } = req.body || {};
  const newCreditos = creditos !== undefined
    ? (_addCredits ? target.creditos + Number(creditos) : Number(creditos))
    : target.creditos;
  const newActivo = activo !== undefined ? (activo ? 1 : 0) : target.activo;
  const newIsAdmin = isAdmin !== undefined ? (isAdmin ? 1 : 0) : target.is_admin;
  const newIsSupport = isSupport !== undefined ? (isSupport ? 1 : 0) : target.is_support;
  const newNombre = (nombre && nombre.trim()) || target.nombre;

  db.prepare(
    'UPDATE users SET creditos = ?, activo = ?, is_admin = ?, is_support = ?, nombre = ? WHERE id = ?'
  ).run(newCreditos, newActivo, newIsAdmin, newIsSupport, newNombre, target.id);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
  res.json(publicUser(updated));
});

const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get(/^(?!\/(auth|v1|admin|health|api)).*/, (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
} else {
  console.warn('⚠️  No se encontró la carpeta "public" (build del frontend). Solo la API estará disponible.');
}

app.listen(port, () => {
  console.log(`🚀 Zoco IA Console corriendo en puerto ${port}`);
});
