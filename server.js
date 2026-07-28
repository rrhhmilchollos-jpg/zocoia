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
import { construirSystemPrompt } from './sistema-prompt.js';
import { registerEventStreamRoute, emitirEventoAgente } from './eventos-agente.js';
import { runDeterministicAgent, resolveTemplatePrompt, registerBridgeAdminRoutes } from './bridge-marisai.js';
import { seedOwnerAgentsIfEmpty, seedBasicAgentsForUser, isOwnerUser, DEEPSEEK_SAFE_FORMAT_RULE, ENTERPRISE_REQUIRED_MESSAGE } from './seed-owner-agents.js';
import { registerSessionRoutes, validateZocoApiKey } from './zoco-sessions.js';
import { registerConsoleRoutes, resumeInterruptedBatches, buildEnvironmentContext } from './zoco-console.js';
import { handleOrdenadorZocoAction } from './ordenadorZoco.js';
import registerNewApiEndpoints from './new-api-endpoints.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8080;

if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET no está definido. Usando uno temporal generado al vuelo.');
  console.warn('   Configura JWT_SECRET en las variables de entorno de Coolify para producción.');
}
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
const JWT_EXPIRES_IN = '7d';
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

// Resolución de la ruta de la base de datos, en orden de prioridad:
//   1. DB_PATH explícito (si lo defines a mano en Coolify, gana siempre)
//   2. /data — ruta estándar del volumen persistente montado en Coolify
//   3. Solo si nada de lo anterior existe, cae a ./data/ local (dev/local).
function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  if (fs.existsSync('/data')) return '/data/zocoia.db';
  return path.join(__dirname, 'data', 'app.db');
}

const DB_PATH = resolveDbPath();
const dbDir = path.dirname(DB_PATH);
if (dbDir && !fs.existsSync(dbDir)) {
  console.log(`📁 Creando directorio de base de datos en: ${dbDir}`);
  fs.mkdirSync(dbDir, { recursive: true });
}

// Migración de compatibilidad: si existe una BD antigua con el nombre
// previo (app.db) en el mismo directorio del volumen y todavía NO existe
// zocoia.db, se renombra en vez de arrancar en blanco — así ningún dato
// que ya sobrevivió en el volumen se pierde solo por el cambio de nombre.
const legacyDbPath = path.join(dbDir, 'app.db');
if (!fs.existsSync(DB_PATH) && fs.existsSync(legacyDbPath)) {
  console.log(`♻️  Migrando base de datos existente: ${legacyDbPath} → ${DB_PATH}`);
  fs.renameSync(legacyDbPath, DB_PATH);
  for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(legacyDbPath + ext)) fs.renameSync(legacyDbPath + ext, DB_PATH + ext);
  }
}

console.log(`🗄️ Usando base de datos en: ${DB_PATH}`);

if (process.env.NODE_ENV === 'production' && !process.env.DB_PATH && !fs.existsSync('/data')) {
  console.warn('⚠️⚠️⚠️  ATENCIÓN: no se detecta ningún volumen persistente montado en /data.');
  console.warn('⚠️⚠️⚠️  La base de datos SQLite vive dentro del contenedor y SE BORRARÁ en el próximo deploy/reinicio.');
  console.warn('⚠️⚠️⚠️  Solución: en Coolify, añade un Volumen persistente a este recurso montado en /data y redeploy.');
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

const apiKeyColumns = db.prepare("PRAGMA table_info(api_keys)").all().map(c => c.name);
if (!apiKeyColumns.includes('key_type')) {
  db.exec("ALTER TABLE api_keys ADD COLUMN key_type TEXT DEFAULT 'pago'");
}
if (!apiKeyColumns.includes('monthly_tokens_used')) {
  db.exec("ALTER TABLE api_keys ADD COLUMN monthly_tokens_used INTEGER DEFAULT 0");
}
if (!apiKeyColumns.includes('usage_month')) {
  db.exec("ALTER TABLE api_keys ADD COLUMN usage_month TEXT");
}

const FREE_KEY_MONTHLY_TOKEN_LIMIT = Number(process.env.FREE_KEY_MONTHLY_TOKEN_LIMIT || 1000);
const currentUsageMonth = () => new Date().toISOString().slice(0, 7); // 'YYYY-MM'

const RESOURCE_TYPES = ['agente', 'archivo', 'habilidad', 'lote', 'sesion', 'implementacion', 'entorno', 'credencial', 'memoria'];

const BALANCE_BLOCK_THRESHOLD = Number(process.env.BALANCE_BLOCK_THRESHOLD_USD || -0.83);

const MODELOS_VALIDOS = [
  'zoco-flash', 'zoco-plus', 'zoco-max', 'zoco-lab',
  'maris-velox', 'maris-core', 'maris-pro', 'maris-beta',
  'maris-velox-1b', 'maris-core-7b', 'maris-pro-32b', 'maris-beta-70b',
];

const OLLAMA_MODEL_MAP = {
  'zoco-flash': process.env.OLLAMA_MODEL_FLASH || 'Zoco-Flash',
  'zoco-plus':  process.env.OLLAMA_MODEL_PLUS  || 'Zoco-Plus',
  'zoco-max':   process.env.OLLAMA_MODEL_MAX   || 'Zoco-Max',
  'zoco-lab':   process.env.OLLAMA_MODEL_LAB   || 'Zoco-Lab',
  'maris-velox': process.env.OLLAMA_MODEL_FLASH || 'Zoco-Flash', 'maris-velox-1b': process.env.OLLAMA_MODEL_FLASH || 'Zoco-Flash',
  'maris-core':  process.env.OLLAMA_MODEL_PLUS  || 'Zoco-Plus',  'maris-core-7b':  process.env.OLLAMA_MODEL_PLUS  || 'Zoco-Plus',
  'maris-pro':   process.env.OLLAMA_MODEL_MAX   || 'Zoco-Max',   'maris-pro-32b':  process.env.OLLAMA_MODEL_MAX   || 'Zoco-Max',
  'maris-beta':  process.env.OLLAMA_MODEL_MAX   || 'Zoco-Max',   'maris-beta-70b': process.env.OLLAMA_MODEL_MAX   || 'Zoco-Max',
};

const OLLAMA_URL = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || 'ollama';
const OLLAMA_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS || '300000', 10);

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

const DEFAULT_AGENTS = [
  { name: 'Agente de Investigación (Researcher)', tipo: 'prompted', systemPrompt: 'Eres el Agente de Investigación de Zoco IA. Tu trabajo es buscar información actualizada en internet, analizarla y sintetizarla en briefs técnicos claros, con fuentes cuando sea posible.' },
  { name: 'Agente Arquitecto', tipo: 'prompted', systemPrompt: 'Eres el Agente Arquitecto de Zoco IA. Diseñas arquitecturas de software (backend, frontend, infraestructura) y tomas decisiones técnicas de alto nivel, explicando trade-offs.' },
  { name: 'Agente de Diseño (Diseñador)', tipo: 'prompted', systemPrompt: 'Eres el Agente de Diseño de Zoco IA. Ayudas con UX/UI, sistemas de diseño, wireframes y decisiones visuales, priorizando claridad y usabilidad.' },
  { name: 'Agente de Interfaz', tipo: 'generic_prompted', templateId: 'tpl_frontend_master', systemPrompt: 'Eres el Agente de Interfaz de Zoco IA. Te especializas en implementar componentes de frontend (React/TypeScript), maquetación y experiencia de usuario en código real.' },
  { name: 'Agente de Backend', tipo: 'prompted', systemPrompt: 'Eres el Agente de Backend de Zoco IA. Implementas APIs, lógica de servidor, autenticación e integración con bases de datos, priorizando seguridad y buenas prácticas.' },
  { name: 'Agente de Base de Datos', tipo: 'generic_prompted', templateId: 'tpl_database_master', systemPrompt: 'Eres el Agente de Base de Datos de Zoco IA. Diseñas esquemas, escribes consultas eficientes y asesoras sobre migraciones, índices y modelado de datos.' },
  { name: 'Agente de Integraciones', tipo: 'prompted', systemPrompt: 'Eres el Agente de Integraciones de Zoco IA. Conectas servicios de terceros (pagos, email, APIs externas) y resuelves problemas de autenticación/webhooks entre sistemas.' },
  { name: 'Agente de Control de Calidad (QA)', tipo: 'prompted', systemPrompt: 'Eres el Agente de QA de Zoco IA. Revisas código y funcionalidades en busca de bugs, casos límite y regresiones, y propones planes de prueba.' },
  { name: 'Agente DevOps', tipo: 'deterministic', executorType: 'vercel_api', systemPrompt: null },
  { name: 'Agente de Pruebas (Testing)', tipo: 'deterministic', executorType: 'static_code_analysis', systemPrompt: null },
  { name: 'Agente de Reparación', tipo: 'deterministic', executorType: 'sandbox_repair', systemPrompt: null },
];

function seedDefaultAgents() {
  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    console.log('ℹ️  ADMIN_EMAIL no configurado: no se siembran agentes por defecto (no hay usuario al que asignarlos).');
    return;
  }
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return;

  const existentes = db.prepare("SELECT name FROM resources WHERE user_id = ? AND type = 'agente'").all(user.id);
  if (existentes.length > 0) {
    console.log(`ℹ️  ${email} ya tiene ${existentes.length} agente(s) — no se aplica la siembra genérica de respaldo.`);
    return;
  }
  const nombresExistentes = new Set(existentes.map(r => r.name));

  const insert = db.prepare('INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, ?, ?, ?)');
  let creados = 0;
  for (const agente of DEFAULT_AGENTS) {
    if (nombresExistentes.has(agente.name)) continue;
    insert.run(uuidv4(), user.id, 'agente', agente.name, JSON.stringify({
      tipo: agente.tipo || 'prompted',
      systemPrompt: agente.systemPrompt,
      templateId: agente.templateId || null,
      executorType: agente.executorType || null,
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

const SEO_GEO_AGENT = {
  name: 'Agente de SEO + GEO',
  tipo: 'prompted',
  systemPrompt: `Eres el Agente de SEO + GEO de Zoco IA.`,
};

function seedSeoGeoAgent() {
  const email = process.env.ADMIN_EMAIL;
  if (!email) return;
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return;

  const existing = db
    .prepare("SELECT id FROM resources WHERE user_id = ? AND type = 'agente' AND name = ?")
    .get(user.id, SEO_GEO_AGENT.name);
  if (existing) {
    console.log('ℹ️  Agente de SEO + GEO ya existe — no se duplica.');
    return;
  }

  db.prepare('INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, ?, ?, ?)').run(
    uuidv4(),
    user.id,
    'agente',
    SEO_GEO_AGENT.name,
    JSON.stringify({
      tipo: SEO_GEO_AGENT.tipo,
      systemPrompt: SEO_GEO_AGENT.systemPrompt,
      templateId: null,
      executorType: null,
      modelo: 'zoco-plus',
      habilidadesActivas: [],
      allowedTools: ALL_TOOL_NAMES,
      num_predict: 4096,
      num_ctx: 8192,
      temperature: 0.5,
      busquedaWeb: true,
    }),
  );
  console.log(`✅ Agente de SEO + GEO creado para ${email}.`);
}

try {
  seedAdminAccount();
} catch (error) {
  console.error('[SEED ERROR] Falló seedAdminAccount, pero el servidor sigue vivo:', error);
}

try {
  seedOwnerAgentsIfEmpty(db);
} catch (error) {
  console.error('[SEED ERROR] Falló la siembra de agentes owner, pero el servidor sigue vivo:', error);
}

try {
  seedDefaultAgents();
} catch (error) {
  console.error('[SEED ERROR] Falló seedDefaultAgents, pero el servidor sigue vivo:', error);
}

try {
  seedSeoGeoAgent();
} catch (error) {
  console.error('[SEED ERROR] Falló seedSeoGeoAgent, pero el servidor sigue vivo:', error);
}

app.use(cors());
app.use(express.json());

registerNewApiEndpoints(app, db, authMiddleware);

  // ==================== ENDPOINT DE ORDENADOR DE ZOCO ====================

  app.post('/api/ordenador-zoco', authMiddleware, async (req, res) => {
    try {
      const { action, ...params } = req.body;
      const workspaceId = req.auth.sub; // Usar el ID de usuario como workspaceId
      const e2bApiKey = process.env.E2B_API_KEY; // Obtener la clave de entorno

      // Placeholder para onEvent. La implementación real de eventos en vivo se hará en el frontend.
      const onEvent = (payload) => {
        // console.log('Ordenador de Zoco Event:', payload);
      };

      const result = await handleOrdenadorZocoAction(workspaceId, e2bApiKey, { action, ...params }, onEvent);
      res.json(result);
    } catch (err) {
      console.error('Error en /api/ordenador-zoco:', err);
      res.status(500).json({ error: err.message || 'Error al ejecutar acción en Ordenador de Zoco' });
    }
  });

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

  if (token.startsWith('sk-zoco-')) {
    const check = validateZocoApiKey(db, token);
    if (!check.valid) return res.status(401).json({ error: `API Key inválida: ${check.reason}` });

    const keyRow = db.prepare('SELECT key_type, monthly_tokens_used, usage_month FROM api_keys WHERE id = ?').get(check.keyId);
    if (keyRow?.key_type === 'gratuita') {
      const month = currentUsageMonth();
      const usedThisMonth = keyRow.usage_month === month ? keyRow.monthly_tokens_used : 0;
      if (usedThisMonth >= FREE_KEY_MONTHLY_TOKEN_LIMIT) {
        return res.status(402).json({
          error: `Límite mensual de la clave gratuita alcanzado (${FREE_KEY_MONTHLY_TOKEN_LIMIT} tokens/mes). Genera una clave de pago o espera al próximo mes.`,
          code: 'free_key_limit_reached',
        });
      }
    }

    try {
      db.prepare('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(check.keyId);
    } catch {}
    const owner = db.prepare('SELECT id, is_admin, is_support FROM users WHERE id = ?').get(check.ownerId);
    if (!owner) return res.status(401).json({ error: 'La cuenta propietaria de la clave no existe' });
    req.auth = {
      sub: owner.id,
      isAdmin: !!owner.is_admin,
      isSupport: !!owner.is_support,
      viaApiKey: true,
      apiKeyId: check.keyId,
      apiKeyType: keyRow?.key_type || 'pago',
    };
    return next();
  }

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

app.get(['/health', '/salud'], (req, res) => {
  res.json({ status: 'ok', message: 'Zoco IA conectado con éxito' });
});

function stripThink(text) {
  if (!text) return '';
  let out = String(text).replace(/<think>[\s\S]*?<\/think>/g, '');
  const openIdx = out.indexOf('<think>');
  if (openIdx !== -1 && out.indexOf('</think>', openIdx) === -1) out = out.slice(0, openIdx);
  const orphanClose = out.indexOf('</think>');
  if (orphanClose !== -1 && out.lastIndexOf('<think>', orphanClose) === -1) out = out.slice(orphanClose + 8);
  return out.trim();
}

async function callChatModel({ ollamaUrl, ollamaModel, messages, maxTokens, temperature, tools, toolChoice, ollamaOptions }) {
  async function doFetch(url, auth, model, extraOllamaOptions) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
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
          ...(tools && tools.length && toolChoice ? { tool_choice: toolChoice } : {}),
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

  const endpoint = `${ollamaUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  const MAX_ATTEMPTS = 2;
  let lastErr;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await doFetch(endpoint, `Bearer ${OLLAMA_API_KEY}`, ollamaModel, ollamaOptions);
    } catch (err) {
      lastErr = err;
      if (err.name === 'AbortError') {
        const e = new Error(`Timeout: el modelo local ${ollamaModel} tardó más de ${Math.round(OLLAMA_TIMEOUT_MS / 1000)}s en responder en Ollama`);
        e.status = 504;
        throw e;
      }
      const transient = !err.status || err.status >= 500;
      if (transient && attempt < MAX_ATTEMPTS - 1) {
        console.warn(`[Ollama] fallo transitorio (${err.message}) — reintentando...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      if (err.status) throw err;
      const e = new Error(`Error de conexión con el servidor de Ollama (${ollamaUrl}): ${err.message}`);
      e.status = 502;
      throw e;
    }
  }
  throw lastErr;
}

async function processChatCompletion(authSub, { agentId, messages, model, temperature: temperatureInput, max_tokens: maxTokensInput, sessionSkills, tools: requestTools, tool_choice: requestToolChoice, apiKeyId, apiKeyType }) {
  if (!OLLAMA_URL) {
    const e = new Error('OLLAMA_BASE_URL no configurada en el servidor'); e.status = 503; throw e;
  }

  const userCheck = db.prepare('SELECT creditos, activo FROM users WHERE id = ?').get(authSub);
  if (!userCheck || !userCheck.activo) {
    const e = new Error('Cuenta desactivada'); e.status = 403; throw e;
  }
  if (userCheck.creditos <= BALANCE_BLOCK_THRESHOLD) {
    const e = new Error('Créditos insuficientes. Recarga tu cuenta en zocoia.es/billing'); e.status = 402; e.code = 'insufficient_credits'; throw e;
  }

  const userMessage = Array.isArray(messages) && messages.length ? messages[messages.length - 1] : null;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(authSub);
  const modeloZocoia = model || user?.modelo_activo || 'zoco-plus';

  let agente = null;
  let agenteData = {};
  let cacheResult = { hit: false, cachedTokens: 0 };

  let mensajesParaGroq = [];
  let systemPromptText = '';

  if (agentId) {
    agente = db.prepare('SELECT *
