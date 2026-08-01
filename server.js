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
import Anthropic from '@anthropic-ai/sdk';
import { TOOL_DEFINITIONS, ALL_TOOL_NAMES, runToolLoop, makeWorkspacesRoot } from './tools.js';
import { runDeterministicAgent, resolveTemplatePrompt, registerBridgeAdminRoutes } from './bridge-marisai.js';
import { seedOwnerAgentsIfEmpty, seedBasicAgentsForUser, isOwnerUser, ENTERPRISE_REQUIRED_MESSAGE } from './seed-owner-agents.js';
import { registerSessionRoutes, validateZocoApiKey } from './zoco-sessions.js';
import { registerConsoleRoutes, resumeInterruptedBatches, buildEnvironmentContext } from './zoco-console.js';

// DEEPSEEK_SAFE_FORMAT_RULE ya no se importa — Claude no la necesita.
// Se mantiene como string vacío para no romper módulos que la referencien.
const DEEPSEEK_SAFE_FORMAT_RULE = '';

// ─── CLIENTE ANTHROPIC ───────────────────────────────────────────────────────
let _anthropicClient = null;
function getAnthropicClient() {
  if (!_anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw Object.assign(new Error('ANTHROPIC_API_KEY no configurada en variables de entorno'), { status: 503 });
    _anthropicClient = new Anthropic({ apiKey });
  }
  return _anthropicClient;
}

// ─── MAPA DE MODELOS: nombres internos → IDs reales de Claude Anthropic ──────
// Modelos verificados en docs.anthropic.com (agosto 2026):
const CLAUDE_MODEL_MAP = {
  'zoco-flash':     'claude-haiku-4-5-20251001',   // Rápido y barato
  'zoco-plus':      'claude-sonnet-4-6',            // Equilibrado (default)
  'zoco-max':       'claude-opus-4-8',              // Máxima capacidad
  'zoco-lab':       'claude-opus-4-8',              // Experimental
  'maris-velox':    'claude-haiku-4-5-20251001',
  'maris-velox-1b': 'claude-haiku-4-5-20251001',
  'maris-core':     'claude-sonnet-4-6',
  'maris-core-7b':  'claude-sonnet-4-6',
  'maris-pro':      'claude-opus-4-8',
  'maris-pro-32b':  'claude-opus-4-8',
  'maris-beta':     'claude-opus-4-8',
  'maris-beta-70b': 'claude-opus-4-8',
};

// Resuelve nombre interno → ID real de Claude. Si ya es un ID de Claude, lo pasa tal cual.
function resolveClaudeModel(modeloZocoia) {
  if (!modeloZocoia) return 'claude-sonnet-4-6';
  if (String(modeloZocoia).startsWith('claude-')) return modeloZocoia;
  return CLAUDE_MODEL_MAP[modeloZocoia] || 'claude-sonnet-4-6';
}

// ─── CÓDIGO OLLAMA COMENTADO (por si se necesita volver atrás) ───────────────
/*
const OLLAMA_MODEL_MAP = {
  'zoco-flash': process.env.OLLAMA_MODEL_FLASH || 'Zoco-Flash',
  'zoco-plus':  process.env.OLLAMA_MODEL_PLUS  || 'Zoco-Plus',
  'zoco-max':   process.env.OLLAMA_MODEL_MAX   || 'Zoco-Max',
  'zoco-lab':   process.env.OLLAMA_MODEL_LAB   || 'Zoco-Lab',
  'maris-velox': process.env.OLLAMA_MODEL_FLASH || 'Zoco-Flash',
  'maris-velox-1b': process.env.OLLAMA_MODEL_FLASH || 'Zoco-Flash',
  'maris-core':  process.env.OLLAMA_MODEL_PLUS  || 'Zoco-Plus',
  'maris-core-7b':  process.env.OLLAMA_MODEL_PLUS  || 'Zoco-Plus',
  'maris-pro':   process.env.OLLAMA_MODEL_MAX   || 'Zoco-Max',
  'maris-pro-32b':  process.env.OLLAMA_MODEL_MAX   || 'Zoco-Max',
  'maris-beta':  process.env.OLLAMA_MODEL_MAX   || 'Zoco-Max',
  'maris-beta-70b': process.env.OLLAMA_MODEL_MAX   || 'Zoco-Max',
};
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || 'ollama';
const OLLAMA_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS || '300000', 10);
*/
// ─── FIN CÓDIGO OLLAMA ────────────────────────────────────────────────────────

const ANTHROPIC_TIMEOUT_MS = parseInt(process.env.ANTHROPIC_TIMEOUT_MS || '120000', 10);
const PROMPT_CACHE_TTL_MS = 5 * 60 * 1000;

// Módulos opcionales — si no existen en el repo, el servidor sigue arrancando
let construirSystemPrompt = null;
let registerEventStreamRoute = null;
let emitirEventoAgente = null;
let handleOrdenadorZocoAction = null;
let registerNewApiEndpoints = null;

try {
  const m = await import('./sistema-prompt.js');
  construirSystemPrompt = m.construirSystemPrompt;
} catch {}

try {
  const m = await import('./eventos-agente.js');
  registerEventStreamRoute = m.registerEventStreamRoute;
  emitirEventoAgente = m.emitirEventoAgente;
} catch {}

try {
  const m = await import('./ordenadorZoco.js');
  handleOrdenadorZocoAction = m.handleOrdenadorZocoAction;
} catch {}

try {
  const m = await import('./new-api-endpoints.js');
  registerNewApiEndpoints = m.default || m.registerNewApiEndpoints || null;
} catch {}
let registerComputerRoutes = null;
try {
  const m = await import('./zoco-computer.js');
  registerComputerRoutes = m.registerComputerRoutes;
} catch (err) {
  console.warn('⚠️  zoco-computer.js no disponible:', err?.message);
}

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
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  if (fs.existsSync('/data')) return '/data/zocoia.db';
  return path.join(__dirname, 'data', 'app.db');
}

const DB_PATH = resolveDbPath();
const dbDir = path.dirname(DB_PATH);
if (dbDir && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const legacyDbPath = path.join(dbDir, 'app.db');
if (!fs.existsSync(DB_PATH) && fs.existsSync(legacyDbPath)) {
  console.log(`♻️  Migrando base de datos: ${legacyDbPath} → ${DB_PATH}`);
  fs.renameSync(legacyDbPath, DB_PATH);
  for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(legacyDbPath + ext)) fs.renameSync(legacyDbPath + ext, DB_PATH + ext);
  }
}

console.log(`🗄️ Usando base de datos en: ${DB_PATH}`);

if (process.env.NODE_ENV === 'production' && !process.env.DB_PATH && !fs.existsSync('/data')) {
  console.warn('⚠️⚠️⚠️  No se detecta volumen persistente en /data. La BD se borrará en el próximo deploy.');
  console.warn('⚠️⚠️⚠️  Solución: añade un Volumen persistente montado en /data en Coolify.');
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

// Migraciones de columnas
const userColumns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userColumns.includes('modelo_activo')) {
  db.exec("ALTER TABLE users ADD COLUMN modelo_activo TEXT DEFAULT 'zoco-plus'");
}

const apiKeyColumns = db.prepare('PRAGMA table_info(api_keys)').all().map(c => c.name);
if (!apiKeyColumns.includes('key_type')) db.exec("ALTER TABLE api_keys ADD COLUMN key_type TEXT DEFAULT 'pago'");
if (!apiKeyColumns.includes('monthly_tokens_used')) db.exec('ALTER TABLE api_keys ADD COLUMN monthly_tokens_used INTEGER DEFAULT 0');
if (!apiKeyColumns.includes('usage_month')) db.exec('ALTER TABLE api_keys ADD COLUMN usage_month TEXT');

const FREE_KEY_MONTHLY_TOKEN_LIMIT = Number(process.env.FREE_KEY_MONTHLY_TOKEN_LIMIT || 1000);
const currentUsageMonth = () => new Date().toISOString().slice(0, 7);

const RESOURCE_TYPES = ['agente', 'archivo', 'habilidad', 'lote', 'sesion', 'implementacion', 'entorno', 'credencial', 'memoria'];
const BALANCE_BLOCK_THRESHOLD = Number(process.env.BALANCE_BLOCK_THRESHOLD_USD || -0.83);

const MODELOS_VALIDOS = [
  'zoco-flash', 'zoco-plus', 'zoco-max', 'zoco-lab',
  'maris-velox', 'maris-core', 'maris-pro', 'maris-beta',
  'maris-velox-1b', 'maris-core-7b', 'maris-pro-32b', 'maris-beta-70b',
];

// ─── Seeds ────────────────────────────────────────────────────────────────────

function seedAdminAccount() {
  const email = process.env.ADMIN_EMAIL;
  const passwordPlain = process.env.ADMIN_PASSWORD;
  if (!email || !passwordPlain) {
    console.log('ℹ️  ADMIN_EMAIL / ADMIN_PASSWORD no configurados.');
    return;
  }
  const passwordHash = bcrypt.hashSync(passwordPlain, 12);
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ?, is_admin = 1, is_support = 1, activo = 1, creditos = 99999999.99 WHERE id = ?')
      .run(passwordHash, existing.id);
    console.log(`✅ Cuenta admin actualizada para ${email}`);
  } else {
    db.prepare('INSERT INTO users (id, email, password_hash, nombre, is_admin, is_support, creditos, activo) VALUES (?, ?, ?, ?, 1, 1, 99999999.99, 1)')
      .run(uuidv4(), email.toLowerCase(), passwordHash, 'Maria (Admin)');
    console.log(`✅ Cuenta admin creada para ${email}`);
  }
}

const DEFAULT_AGENTS = [
  { name: 'Agente de Investigación (Researcher)', tipo: 'prompted', systemPrompt: 'Eres el Agente de Investigación de Zoco IA. Buscas información actualizada en internet, la analizas y sintetizas en briefs técnicos claros, con fuentes cuando sea posible.' },
  { name: 'Agente Arquitecto', tipo: 'prompted', systemPrompt: 'Eres el Agente Arquitecto de Zoco IA. Diseñas arquitecturas de software (backend, frontend, infraestructura) y tomas decisiones técnicas de alto nivel explicando trade-offs.' },
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
  if (!email) return;
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return;
  const existentes = db.prepare("SELECT name FROM resources WHERE user_id = ? AND type = 'agente'").all(user.id);
  if (existentes.length > 0) {
    console.log(`ℹ️  ${email} ya tiene ${existentes.length} agente(s) — no se aplica siembra genérica.`);
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
  if (creados > 0) console.log(`✅ Sembrados ${creados} agentes por defecto para ${email}.`);
}

function seedSeoGeoAgent() {
  const email = process.env.ADMIN_EMAIL;
  if (!email) return;
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return;
  const existing = db.prepare("SELECT id FROM resources WHERE user_id = ? AND type = 'agente' AND name = ?").get(user.id, 'Agente de SEO + GEO');
  if (existing) return;
  db.prepare('INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, ?, ?, ?)').run(
    uuidv4(), user.id, 'agente', 'Agente de SEO + GEO',
    JSON.stringify({ tipo: 'prompted', systemPrompt: 'Eres el Agente de SEO + GEO de Zoco IA.', modelo: 'zoco-plus', habilidadesActivas: [], allowedTools: ALL_TOOL_NAMES, num_predict: 4096, num_ctx: 8192, temperature: 0.5, busquedaWeb: true })
  );
  console.log(`✅ Agente de SEO + GEO creado para ${email}.`);
}

try { seedAdminAccount(); } catch (e) { console.error('[SEED] seedAdminAccount falló:', e); }
try { seedOwnerAgentsIfEmpty(db); } catch (e) { console.error('[SEED] seedOwnerAgentsIfEmpty falló:', e); }
try { seedDefaultAgents(); } catch (e) { console.error('[SEED] seedDefaultAgents falló:', e); }
try { seedSeoGeoAgent(); } catch (e) { console.error('[SEED] seedSeoGeoAgent falló:', e); }

// ─── Utilidades ───────────────────────────────────────────────────────────────

const DEFAULT_ALLOWED_ORIGINS = ['https://zocoia.es', 'https://www.zocoia.es'];

function parseOriginsList(raw) {
  if (!raw) return [];
  return raw.split(',').map(o => o.trim()).filter(Boolean);
}

const ENV_ALLOWED_ORIGINS = [
  ...parseOriginsList(process.env.ALLOWED_ORIGINS),
  ...parseOriginsList(process.env.CORS_ALLOWED_ORIGINS),
];

const ALLOWED_ORIGINS = ENV_ALLOWED_ORIGINS.length > 0 ? ENV_ALLOWED_ORIGINS : DEFAULT_ALLOWED_ORIGINS;
console.log('🌐 CORS — orígenes permitidos:', ALLOWED_ORIGINS.join(', '));

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    console.warn(`🚫 CORS bloqueado para origen: ${origin}`);
    return callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors());
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
    id: user.id, email: user.email, nombre: user.nombre,
    isAdmin: !!user.is_admin, isSupport: !!user.is_support,
    creditos: user.creditos, activo: !!user.activo,
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
    db.prepare('UPDATE prompt_cache SET hits = hits + 1, expires_at = ? WHERE cache_key = ?').run(now + PROMPT_CACHE_TTL_MS, cacheKey);
    return { hit: true, cachedTokens: existing.token_estimate };
  }
  if (existing) {
    db.prepare('UPDATE prompt_cache SET hits = 0, token_estimate = ?, expires_at = ? WHERE cache_key = ?').run(tokenEstimate, now + PROMPT_CACHE_TTL_MS, cacheKey);
  } else {
    db.prepare('INSERT INTO prompt_cache (cache_key, agente_id, user_id, token_estimate, hits, expires_at) VALUES (?, ?, ?, ?, 0, ?)').run(cacheKey, agentId || 'general', userId, tokenEstimate, now + PROMPT_CACHE_TTL_MS);
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
        return res.status(402).json({ error: `Límite mensual alcanzado (${FREE_KEY_MONTHLY_TOKEN_LIMIT} tokens/mes).`, code: 'free_key_limit_reached' });
      }
    }
    try { db.prepare('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(check.keyId); } catch {}
    const owner = db.prepare('SELECT id, is_admin, is_support FROM users WHERE id = ?').get(check.ownerId);
    if (!owner) return res.status(401).json({ error: 'La cuenta propietaria de la clave no existe' });
    req.auth = { sub: owner.id, isAdmin: !!owner.is_admin, isSupport: !!owner.is_support, viaApiKey: true, apiKeyId: check.keyId, apiKeyType: keyRow?.key_type || 'pago' };
    return next();
  }

  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
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
  if (!user) { res.status(404).json({ error: 'Usuario no encontrado' }); return null; }
  return user;
}

function firstOfMonthISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

function stripThink(text) {
  if (!text) return '';
  let out = String(text).replace(/<think>[\s\S]*?<\/think>/g, '');
  const openIdx = out.indexOf('<think>');
  if (openIdx !== -1 && out.indexOf('</think>', openIdx) === -1) out = out.slice(0, openIdx);
  const orphanClose = out.indexOf('</think>');
  if (orphanClose !== -1 && out.lastIndexOf('<think>', orphanClose) === -1) out = out.slice(orphanClose + 8);
  return out.trim();
}

// ─── Web search ───────────────────────────────────────────────────────────────

async function webSearch(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'ZocoIA/1.0' }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const results = [];
    if (data.AbstractText) results.push(`Resumen: ${data.AbstractText}`);
    if (data.RelatedTopics) data.RelatedTopics.slice(0, 5).forEach(t => { if (t.Text) results.push(t.Text); });
    try {
      const htmlRes = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZocoIA/1.0)' },
        signal: AbortSignal.timeout(5000),
      });
      if (htmlRes.ok) {
        const html = await htmlRes.text();
        const snippets = [...html.matchAll(/<a class="result__snippet"[^>]*>(.*?)<\/a>/gs)]
          .slice(0, 4).map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
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
  const keywords = ['hoy', 'ahora', 'actual', 'última hora', 'noticia', 'noticias', 'precio', 'cotización', 'tiempo', 'temperatura', 'clima', '2024', '2025', '2026', 'mundial', 'elección', 'ganó', 'gano', 'quien es el presidente', 'quién ganó', 'últimas noticias', 'what happened', 'latest', 'current', 'today', 'news'];
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

// ─── Motor de IA: Claude Anthropic ───────────────────────────────────────────
// Sustituye completamente a callChatModel (Ollama).
// Mantiene la misma firma de retorno para no romper el resto del código:
// { choices: [{ message: { role, content, tool_calls? } }], usage: {...} }

// Convierte tools en formato OpenAI ({type:'function', function:{name, description, parameters}})
// —el formato en el que están definidas en tools.js/TOOL_DEFINITIONS, pensado
// originalmente para Groq/Ollama /v1/chat/completions— al formato nativo que
// espera la API de Anthropic ({name, description, input_schema}). Sin esta
// conversión, anthropic.messages.create() ignoraría o rechazaría las tools.
function openAIToolsToAnthropic(tools) {
  if (!Array.isArray(tools)) return undefined;
  return tools.map(t => {
    // Ya viene en formato Anthropic (tiene input_schema) — no tocar.
    if (t && t.input_schema) return t;
    const fn = t?.function || t;
    return {
      name: fn.name,
      description: fn.description || '',
      input_schema: fn.parameters || { type: 'object', properties: {} },
    };
  });
}

// Convierte tool_choice en formato OpenAI ('auto' | 'required' | {type:'function',...})
// al formato Anthropic ({type:'auto'} | {type:'any'} | {type:'tool', name}).
function openAIToolChoiceToAnthropic(toolChoice) {
  if (!toolChoice) return undefined;
  if (toolChoice === 'auto') return { type: 'auto' };
  if (toolChoice === 'required') return { type: 'any' };
  if (toolChoice === 'none') return undefined;
  if (typeof toolChoice === 'object') {
    if (toolChoice.type === 'function' && toolChoice.function?.name) {
      return { type: 'tool', name: toolChoice.function.name };
    }
    // Ya viene en formato Anthropic
    if (toolChoice.type) return toolChoice;
  }
  return { type: 'auto' };
}

async function callChatModel({ claudeModel, messages, maxTokens, temperature, tools, toolChoice }) {
  const anthropic = getAnthropicClient();

  // Separar el mensaje de sistema del resto
  const systemMsg = messages.find(m => m.role === 'system');
  const userMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }));

  const anthropicTools = tools && tools.length ? openAIToolsToAnthropic(tools) : undefined;
  const anthropicToolChoice = anthropicTools ? openAIToolChoiceToAnthropic(toolChoice) : undefined;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);

  try {
    const params = {
      model: claudeModel,
      max_tokens: maxTokens || 4096,
      temperature: temperature ?? 0.7,
      messages: userMessages,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      ...(anthropicTools ? { tools: anthropicTools } : {}),
      ...(anthropicTools && anthropicToolChoice ? { tool_choice: anthropicToolChoice } : {}),
    };

    const response = await anthropic.messages.create(params, { signal: controller.signal });

    // Convertir respuesta de Anthropic al formato OpenAI que espera el resto del código
    const textContent = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const toolUses = response.content.filter(b => b.type === 'tool_use');
    const tool_calls = toolUses.length > 0
      ? toolUses.map(tu => ({ id: tu.id, type: 'function', function: { name: tu.name, arguments: JSON.stringify(tu.input || {}) } }))
      : undefined;

    return {
      choices: [{
        message: {
          role: 'assistant',
          content: textContent,
          ...(tool_calls ? { tool_calls } : {}),
        },
        finish_reason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
      }],
      usage: {
        prompt_tokens: response.usage?.input_tokens || 0,
        completion_tokens: response.usage?.output_tokens || 0,
        total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── CÓDIGO ANTIGUO callChatModel (Ollama) COMENTADO ─────────────────────────
/*
async function callChatModel({ ollamaUrl, ollamaModel, messages, maxTokens, temperature, tools, toolChoice, ollamaOptions }) {
  async function doFetch(url, auth, model, extraOllamaOptions) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({
          model, messages, max_tokens: maxTokens, temperature,
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
        const e = new Error(`Timeout: el modelo ${ollamaModel} tardó más de ${Math.round(OLLAMA_TIMEOUT_MS / 1000)}s`);
        e.status = 504; throw e;
      }
      const transient = !err.status || err.status >= 500;
      if (transient && attempt < MAX_ATTEMPTS - 1) {
        console.warn(`[Ollama] fallo transitorio (${err.message}) — reintentando...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      if (err.status) throw err;
      const e = new Error(`Error de conexión con Ollama (${ollamaUrl}): ${err.message}`);
      e.status = 502; throw e;
    }
  }
  throw lastErr;
}
*/
// ─── FIN CÓDIGO ANTIGUO ───────────────────────────────────────────────────────

async function processChatCompletion(authSub, { agentId, messages, model, temperature: temperatureInput, max_tokens: maxTokensInput, sessionSkills, tools: requestTools, tool_choice: requestToolChoice, apiKeyId, apiKeyType }) {
  const userCheck = db.prepare('SELECT creditos, activo FROM users WHERE id = ?').get(authSub);
  if (!userCheck || !userCheck.activo) {
    const e = new Error('Cuenta desactivada'); e.status = 403; throw e;
  }
  if (userCheck.creditos <= BALANCE_BLOCK_THRESHOLD) {
    const e = new Error('Créditos insuficientes. Recarga tu cuenta en zocoia.es/billing');
    e.status = 402; e.code = 'insufficient_credits'; throw e;
  }

  const userMessage = Array.isArray(messages) && messages.length ? messages[messages.length - 1] : null;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(authSub);
  const modeloZocoia = model || user?.modelo_activo || 'zoco-plus';

  let agente = null;
  let agenteData = {};
  let cacheResult = { hit: false, cachedTokens: 0 };
  let mensajesParaClaude = [];
  let systemPromptText = '';

  if (agentId) {
    agente = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?').get(agentId, authSub, 'agente');
    if (!agente) { const e = new Error('Agente no encontrado'); e.status = 404; throw e; }

    agenteData = agente.data ? JSON.parse(agente.data) : {};

    if (agenteData.tipo === 'deterministic') {
      if (!isOwnerUser(db, authSub)) {
        const e = new Error(ENTERPRISE_REQUIRED_MESSAGE); e.status = 403; e.code = 'enterprise_required'; throw e;
      }
      return runDeterministicAgent({ db, uuidv4, userId: authSub, agente, agenteData, userMessage });
    }

    const historial = db.prepare('SELECT role, content FROM agent_memory WHERE agente_id = ? ORDER BY created_at ASC LIMIT 50').all(agentId);

    if (construirSystemPrompt) {
      systemPromptText = await construirSystemPrompt({ db, agente, agenteData, authSub });
    } else {
      systemPromptText = agenteData.tipo === 'generic_prompted' && agenteData.templateId
        ? resolveTemplatePrompt({ db, templateId: agenteData.templateId, overrideVars: agenteData.templateVars })
        : (agenteData.systemPrompt || `Eres ${agente.name}, un asistente de IA útil y preciso.`);
    }

    // Claude no necesita la regla DeepSeek — no la inyectamos
    systemPromptText += buildEnvironmentContext(db, authSub);
    mensajesParaClaude.push({ role: 'system', content: systemPromptText });
    mensajesParaClaude = mensajesParaClaude.concat(historial);
    if (userMessage) mensajesParaClaude.push({ role: 'user', content: String(userMessage.content) });
    cacheResult = checkAndUpdatePromptCache(authSub, agentId, systemPromptText);
  } else {
    mensajesParaClaude = Array.isArray(messages) ? messages : [{ role: 'user', content: 'Hola' }];
    const envCtx = buildEnvironmentContext(db, authSub);
    if (envCtx && !mensajesParaClaude.some(m => m.role === 'system')) {
      mensajesParaClaude = [{ role: 'system', content: `Eres Zoco IA, un asistente de IA útil y preciso.${envCtx}` }, ...mensajesParaClaude];
    } else if (envCtx) {
      mensajesParaClaude = mensajesParaClaude.map(m => m.role === 'system' ? { ...m, content: m.content + envCtx } : m);
    }
  }

  const lastUserMsg = mensajesParaClaude.filter(m => m.role === 'user').slice(-1)[0]?.content || '';
  const skillForcesWeb = !!(sessionSkills && sessionSkills.busquedaWeb);
  if (skillForcesWeb || needsWebSearch(lastUserMsg)) {
    const searchResults = await webSearch(lastUserMsg);
    if (searchResults) {
      const webCtx = `\n\n[CONTEXTO WEB - ${new Date().toLocaleDateString('es-ES')}]\n${searchResults}\n[FIN CONTEXTO WEB]\nUsa este contexto para responder con información actualizada.`;
      const sysIdx = mensajesParaClaude.findIndex(m => m.role === 'system');
      if (sysIdx >= 0) {
        mensajesParaClaude[sysIdx] = { ...mensajesParaClaude[sysIdx], content: mensajesParaClaude[sysIdx].content + webCtx };
      } else {
        mensajesParaClaude.unshift({ role: 'system', content: `Eres Zoco IA, un asistente útil y preciso.${webCtx}` });
      }
    }
  }

  const claudeModel = resolveClaudeModel(modeloZocoia);
  console.log(`[IA] ${modeloZocoia} → ${claudeModel} via Claude Anthropic`);

  const clamp = (v, min, max, fallback) => { const n = Number(v); if (!Number.isFinite(n)) return fallback; return Math.min(max, Math.max(min, n)); };
  const maxTokens = clamp(maxTokensInput || agenteData.num_predict, 256, 8192, 4096);
  const temperature = clamp(temperatureInput ?? agenteData.temperature, 0, 1, 0.7);

  const skillTools = Array.isArray(sessionSkills?.allowedTools) ? sessionSkills.allowedTools.filter(t => ALL_TOOL_NAMES.includes(t)) : [];
  const agentTools = agentId ? (Array.isArray(agenteData.allowedTools) ? agenteData.allowedTools : ALL_TOOL_NAMES) : [];
  let allowedTools = [...new Set([...agentTools, ...skillTools])];
  if (allowedTools.length > 0 && !isOwnerUser(db, authSub)) allowedTools = [];

  const callModel = (msgs, tools, toolChoice) => callChatModel({
    claudeModel,
    messages: msgs,
    maxTokens,
    temperature,
    tools,
    toolChoice,
  });

  let respuesta;
  let usage;
  let clientToolCalls = null;

  const clientTools = Array.isArray(requestTools) && requestTools.length > 0 && requestTools.every(t => t && t.type === 'function' && t.function?.name) ? requestTools : null;

  if (clientTools) {
    const data = await callModel(mensajesParaClaude, clientTools, requestToolChoice || 'auto');
    const msg = data.choices?.[0]?.message || {};
    respuesta = stripThink(msg.content || '');
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) clientToolCalls = msg.tool_calls;
    usage = data.usage || {};
  } else if (allowedTools.length > 0) {
    const tavilyRow = db.prepare("SELECT data FROM resources WHERE user_id = ? AND type IN ('credencial','habilidad') AND name = 'TAVILY_API_KEY'").get(authSub);
    let tavilyApiKey = null;
    if (tavilyRow) { try { tavilyApiKey = JSON.parse(tavilyRow.data || '{}').valor || null; } catch {} }

    const e2bRow = db.prepare("SELECT data FROM resources WHERE user_id = ? AND type IN ('credencial','habilidad') AND name = 'E2B_API_KEY'").get(authSub);
    let e2bApiKey = null;
    if (e2bRow) { try { e2bApiKey = JSON.parse(e2bRow.data || '{}').valor || null; } catch {} }

    const result = await runToolLoop({ messages: mensajesParaClaude, callModel, allowedTools, workspacesRoot: WORKSPACES_ROOT, workspaceId: agentId, context: { tavilyApiKey, e2bApiKey, workspaceId: agentId } });
    respuesta = stripThink(result.finalMessage);
    usage = result.usage;
  } else {
    const data = await callModel(mensajesParaClaude, undefined);
    respuesta = stripThink(data.choices?.[0]?.message?.content || '');
    usage = data.usage || {};
  }

  if (agentId && userMessage?.content) {
    db.prepare('INSERT INTO agent_memory (id, agente_id, user_id, role, content) VALUES (?, ?, ?, ?, ?)').run(uuidv4(), agentId, authSub, 'user', String(userMessage.content));
    db.prepare('INSERT INTO agent_memory (id, agente_id, user_id, role, content) VALUES (?, ?, ?, ?, ?)').run(uuidv4(), agentId, authSub, 'assistant', respuesta);
    if (emitirEventoAgente) {
      try { emitirEventoAgente(agentId, { type: 'message', content: respuesta }); } catch {}
    }
  }

  const totalTokens = usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);

  if (apiKeyId && apiKeyType === 'gratuita') {
    const month = currentUsageMonth();
    const keyRow = db.prepare('SELECT monthly_tokens_used, usage_month FROM api_keys WHERE id = ?').get(apiKeyId);
    const previousUsage = keyRow?.usage_month === month ? (keyRow.monthly_tokens_used || 0) : 0;
    db.prepare('UPDATE api_keys SET monthly_tokens_used = ?, usage_month = ? WHERE id = ?').run(previousUsage + totalTokens, month, apiKeyId);
  }

  const tokensConDescuento = cacheResult.hit ? Math.max(0, totalTokens - Math.round(cacheResult.cachedTokens * 0.9)) : totalTokens;
  const costeEuros = tokensConDescuento * 0.000002;
  if (costeEuros > 0) {
    db.prepare('INSERT INTO usage_log (id, user_id, amount, kind, description) VALUES (?, ?, ?, ?, ?)').run(uuidv4(), authSub, costeEuros, 'gasto', `Claude ${claudeModel}${cacheResult.hit ? ' (caché)' : ''}`);
    db.prepare('UPDATE users SET creditos = creditos - ? WHERE id = ?').run(costeEuros, authSub);
  }

  return {
    choices: [{ message: { role: 'assistant', content: respuesta, ...(clientToolCalls ? { tool_calls: clientToolCalls } : {}) }, finish_reason: clientToolCalls ? 'tool_calls' : 'stop' }],
    usage: { input_tokens: usage.prompt_tokens || 0, output_tokens: usage.completion_tokens || 0, total_tokens: totalTokens, cache_read_tokens: cacheResult.hit ? cacheResult.cachedTokens : 0, prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0 },
    model: claudeModel,
  };
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

app.get(['/health', '/salud'], (req, res) => res.json({ status: 'ok', message: 'Zoco IA conectado con éxito' }));

if (registerEventStreamRoute) {
  try { registerEventStreamRoute(app, authMiddleware); } catch (e) { console.warn('[eventos-agente] No se pudo registrar:', e.message); }
}

if (registerNewApiEndpoints) {
  try { registerNewApiEndpoints(app, db, authMiddleware); } catch (e) { console.warn('[new-api-endpoints] No se pudo registrar:', e.message); }
}

if (handleOrdenadorZocoAction) {
  app.post('/api/ordenador-zoco', authMiddleware, async (req, res) => {
    try {
      const { action, ...params } = req.body;
      const result = await handleOrdenadorZocoAction(req.auth.sub, process.env.E2B_API_KEY, { action, ...params }, () => {});
      res.json(result);
    } catch (err) {
      console.error('Error en /api/ordenador-zoco:', err);
      res.status(500).json({ error: err.message || 'Error al ejecutar acción' });
    }
  });
}

app.post('/v1/chat/completions', authMiddleware, async (req, res) => {
  try {
    const result = await processChatCompletion(req.auth.sub, {
      ...(req.body || {}),
      apiKeyId: req.auth.viaApiKey ? req.auth.apiKeyId : undefined,
      apiKeyType: req.auth.viaApiKey ? req.auth.apiKeyType : undefined,
    });
    res.json(result);
  } catch (err) {
    console.error('Error inferencia:', err);
    res.status(err.status || 500).json({ error: err.message || 'Error interno', ...(err.code ? { code: err.code } : {}) });
  }
});

app.post('/api/chat', authMiddleware, async (req, res) => {
  try {
    const { message, agentId, model, history } = req.body || {};
    if (!message || !String(message).trim()) return res.status(400).json({ error: 'El mensaje es obligatorio' });
    const historialMensajes = Array.isArray(history) ? history.filter(m => m && typeof m.content === 'string').map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })) : [];
    const messages = [...historialMensajes, { role: 'user', content: String(message) }];
    const result = await processChatCompletion(req.auth.sub, {
      agentId, model, messages,
      apiKeyId: req.auth.viaApiKey ? req.auth.apiKeyId : undefined,
      apiKeyType: req.auth.viaApiKey ? req.auth.apiKeyType : undefined,
    });
    res.json({ response: result.choices?.[0]?.message?.content || '', usage: result.usage, model: result.model });
  } catch (err) {
    console.error('Error en /api/chat:', err);
    res.status(err.status || 500).json({ error: err.message || 'Error interno', ...(err.code ? { code: err.code } : {}) });
  }
});

app.get('/api/cache/stats', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT cache_key, agente_id, hits, token_estimate, expires_at FROM prompt_cache WHERE user_id = ? AND expires_at > ?').all(req.auth.sub, Date.now());
  res.json({ entradasActivas: rows.length, totalHits: rows.reduce((s, r) => s + r.hits, 0), tokensAhorrados: rows.reduce((s, r) => s + r.hits * Math.round(r.token_estimate * 0.9), 0), ahorroEstimadoEuros: rows.reduce((s, r) => s + r.hits * Math.round(r.token_estimate * 0.9), 0) * 0.000002 });
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
  db.prepare('INSERT INTO agent_memory (id, agente_id, user_id, role, content) VALUES (?, ?, ?, ?, ?)').run(id, req.params.id, req.auth.sub, role === 'assistant' ? 'assistant' : 'user', content.trim());
  res.status(201).json({ id, role: role === 'assistant' ? 'assistant' : 'user', content: content.trim() });
});

app.delete('/api/agentes/:id/memoria', authMiddleware, (req, res) => {
  const agente = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?').get(req.params.id, req.auth.sub, 'agente');
  if (!agente) return res.status(404).json({ error: 'Agente no encontrado' });
  db.prepare('DELETE FROM agent_memory WHERE agente_id = ?').run(req.params.id);
  db.prepare('DELETE FROM prompt_cache WHERE agente_id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/resources/:id/memory', authMiddleware, (req, res) => {
  const agente = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?').get(req.params.id, req.auth.sub, 'agente');
  if (!agente) return res.status(404).json({ error: 'Agente no encontrado' });
  const mensajes = db.prepare('SELECT id, role, content, created_at FROM agent_memory WHERE agente_id = ? ORDER BY created_at ASC').all(req.params.id);
  const cacheActiva = db.prepare('SELECT COUNT(*) as count FROM prompt_cache WHERE agente_id = ? AND expires_at > ?').get(req.params.id, Date.now()).count;
  res.json({ mensajes, cacheActiva: cacheActiva > 0 });
});

app.delete('/api/resources/:id/memory', authMiddleware, (req, res) => {
  const agente = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?').get(req.params.id, req.auth.sub, 'agente');
  if (!agente) return res.status(404).json({ error: 'Agente no encontrado' });
  db.prepare('DELETE FROM agent_memory WHERE agente_id = ?').run(req.params.id);
  db.prepare('DELETE FROM prompt_cache WHERE agente_id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/resources', authMiddleware, (req, res) => {
  const { type } = req.query;
  if (type && !RESOURCE_TYPES.includes(type)) return res.status(400).json({ error: 'Tipo no válido' });
  const rows = type
    ? db.prepare('SELECT * FROM resources WHERE user_id = ? AND type = ? ORDER BY created_at DESC').all(req.auth.sub, type)
    : db.prepare('SELECT * FROM resources WHERE user_id = ? ORDER BY created_at DESC').all(req.auth.sub);
  res.json(rows.map(r => ({ id: r.id, type: r.type, name: r.name, data: JSON.parse(r.data || '{}'), createdAt: r.created_at, updatedAt: r.updated_at })));
});

app.post('/api/resources', authMiddleware, (req, res) => {
  const { type, name, data } = req.body || {};
  if (!RESOURCE_TYPES.includes(type)) return res.status(400).json({ error: 'Tipo no válido' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (type === 'agente' && !isOwnerUser(db, req.auth.sub)) {
    const d = data || {};
    if (d.tipo === 'deterministic' || d.executorType || (Array.isArray(d.allowedTools) && d.allowedTools.length > 0)) {
      return res.status(403).json({ error: ENTERPRISE_REQUIRED_MESSAGE, code: 'enterprise_required' });
    }
  }
  const id = uuidv4();
  db.prepare('INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, ?, ?, ?)').run(id, req.auth.sub, type, name.trim(), JSON.stringify(data || {}));
  const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(id);
  res.status(201).json({ id: row.id, type: row.type, name: row.name, data: JSON.parse(row.data), createdAt: row.created_at });
});

app.put('/api/resources/:id', authMiddleware, (req, res) => {
  const row = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
  if (!row) return res.status(404).json({ error: 'Recurso no encontrado' });
  const { name, data } = req.body || {};
  if (row.type === 'agente' && data !== undefined && !isOwnerUser(db, req.auth.sub)) {
    const d = data || {};
    if (d.tipo === 'deterministic' || d.executorType || (Array.isArray(d.allowedTools) && d.allowedTools.length > 0)) {
      return res.status(403).json({ error: ENTERPRISE_REQUIRED_MESSAGE, code: 'enterprise_required' });
    }
  }
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
  const spendRow = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM usage_log WHERE user_id = ? AND kind = 'gasto' AND created_at >= ?").get(user.id, monthStart);
  const resourceCounts = db.prepare('SELECT type, COUNT(*) as count FROM resources WHERE user_id = ? GROUP BY type').all(user.id);
  const countsByType = {};
  RESOURCE_TYPES.forEach(t => { countsByType[t] = 0; });
  resourceCounts.forEach(r => { countsByType[r.type] = r.count; });
  const keysCount = db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE user_id = ? AND revoked = 0').get(user.id).count;
  res.json({ creditos: user.creditos, gastoEsteMes: spendRow.total, recursos: countsByType, clavesActivas: keysCount });
});

app.post('/api/billing/topup', authMiddleware, (req, res) => {
  const { amount } = req.body || {};
  const value = Number(amount);
  if (!value || value <= 0) return res.status(400).json({ error: 'El importe debe ser mayor que 0' });
  db.prepare('UPDATE users SET creditos = creditos + ? WHERE id = ?').run(value, req.auth.sub);
  db.prepare('INSERT INTO usage_log (id, user_id, amount, kind, description) VALUES (?, ?, ?, ?, ?)').run(uuidv4(), req.auth.sub, value, 'recarga', 'Recarga de créditos');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub);
  res.json({ creditos: user.creditos });
});

app.get('/api/keys', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT id, name, key_prefix, last_used_at, revoked, created_at, key_type, monthly_tokens_used, usage_month FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(req.auth.sub);
  const month = currentUsageMonth();
  res.json(rows.map(r => ({ id: r.id, name: r.name, display: `${r.key_prefix}${'•'.repeat(16)}`, lastUsedAt: r.last_used_at, revoked: !!r.revoked, createdAt: r.created_at, type: r.key_type || 'pago', monthlyTokensUsed: r.usage_month === month ? (r.monthly_tokens_used || 0) : 0, monthlyTokenLimit: r.key_type === 'gratuita' ? FREE_KEY_MONTHLY_TOKEN_LIMIT : null })));
});

app.post('/api/keys', authMiddleware, (req, res) => {
  console.log('[DEBUG /api/keys] body recibido:', JSON.stringify(req.body));
  console.log('[DEBUG /api/keys] content-type:', req.headers['content-type']);
  const { name, type } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const keyType = type === 'gratuita' ? 'gratuita' : 'pago';
  const rawSecret = crypto.randomBytes(24).toString('hex');
  const fullKey = `sk-zoco-${rawSecret}`;
  const keyPrefix = `sk-zoco-${rawSecret.slice(0, 6)}`;
  const keyHash = crypto.createHash('sha256').update(fullKey).digest('hex');
  const id = uuidv4();
  db.prepare('INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, key_type) VALUES (?, ?, ?, ?, ?, ?)').run(id, req.auth.sub, name.trim(), keyPrefix, keyHash, keyType);
  res.status(201).json({ id, name: name.trim(), key: fullKey, type: keyType, monthlyTokenLimit: keyType === 'gratuita' ? FREE_KEY_MONTHLY_TOKEN_LIMIT : null, createdAt: new Date().toISOString() });
});

app.delete('/api/keys/:id', authMiddleware, (req, res) => {
  const key = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
  if (!key) return res.status(404).json({ error: 'Clave no encontrada' });
  db.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.put('/api/keys/:id', authMiddleware, (req, res) => {
  const key = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
  if (!key) return res.status(404).json({ error: 'Clave no encontrada' });
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  db.prepare('UPDATE api_keys SET name = ? WHERE id = ?').run(name.trim(), key.id);
  res.json({ ok: true, id: key.id, name: name.trim() });
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
  db.prepare('INSERT INTO users (id, email, password_hash, nombre, is_admin, is_support, creditos, activo) VALUES (?, ?, ?, ?, 0, 0, 0, 1)').run(id, emailLower, passwordHash, nombre.trim());
  seedBasicAgentsForUser(db, id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email) || !password) return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !user.activo) return res.status(401).json({ error: 'Credenciales incorrectas' });
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Credenciales incorrectas' });
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.get('/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ user: publicUser(user) });
});

app.post('/auth/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  const genericResponse = { message: 'Si el email existe, recibirás un enlace de recuperación.' };
  if (!isValidEmail(email)) return res.json(genericResponse);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return res.json(genericResponse);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + RESET_TOKEN_TTL_MS;
  db.prepare('INSERT INTO password_resets (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)').run(token, user.id, expiresAt);
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const resetLink = `${appUrl}/restablecer-password?token=${token}`;
  await sendPasswordResetEmail(user.email, resetLink).catch(() => console.log(`🔗 Reset link: ${resetLink}`));
  res.json(genericResponse);
});

app.post('/auth/reset-password', (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || password.length < 8) return res.status(400).json({ error: 'Token y contraseña (mín. 8 chars) obligatorios' });
  const record = db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token);
  if (!record || record.used || record.expires_at < Date.now()) return res.status(400).json({ error: 'Enlace inválido o caducado' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 12), record.user_id);
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
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromEmail, to: toEmail, subject: 'Recupera tu contraseña — Zoco IA', html: `<p>Has solicitado restablecer tu contraseña.</p><p><a href="${resetLink}">Haz clic aquí para crear una nueva contraseña</a></p><p>Este enlace caduca en 1 hora.</p>` }),
    });
    return resp.ok;
  } catch { return false; }
}

// ─── Pagos Viva ───────────────────────────────────────────────────────────────

const VIVA_CLIENT_ID     = process.env.VIVA_CLIENT_ID;
const VIVA_CLIENT_SECRET = process.env.VIVA_CLIENT_SECRET;
const VIVA_SOURCE_CODE   = process.env.VIVA_SOURCE_CODE;
const VIVA_IS_DEMO       = process.env.VIVA_IS_DEMO !== 'false';
const VIVA_BASE          = VIVA_IS_DEMO ? 'https://demo.vivapayments.com' : 'https://www.vivapayments.com';
const VIVA_API_BASE      = VIVA_IS_DEMO ? 'https://demo-api.vivapayments.com' : 'https://api.vivapayments.com';
const APP_URL            = process.env.APP_URL || 'https://zocoia.es';

const CREDIT_PACKS = [
  { id: 'starter',   euros: 5,   credits: 5,   label: 'Starter' },
  { id: 'basic',     euros: 10,  credits: 11,  label: 'Basic' },
  { id: 'pro',       euros: 25,  credits: 28,  label: 'Pro' },
  { id: 'business',  euros: 50,  credits: 60,  label: 'Business' },
  { id: 'enterprise',euros: 100, credits: 125, label: 'Enterprise' },
];

async function getVivaToken() {
  const res = await fetch(`${VIVA_API_BASE}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: VIVA_CLIENT_ID, client_secret: VIVA_CLIENT_SECRET }),
  });
  if (!res.ok) throw new Error('No se pudo obtener token de Viva');
  return (await res.json()).access_token;
}

app.get('/api/payments/packs', authMiddleware, (req, res) => res.json(CREDIT_PACKS));
app.get('/api/payments/history', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.auth.sub));
});

app.post('/api/payments/create', authMiddleware, async (req, res) => {
  if (!VIVA_CLIENT_ID || !VIVA_CLIENT_SECRET || !VIVA_SOURCE_CODE) return res.status(503).json({ error: 'Pasarela de pago no configurada' });
  const { packId } = req.body || {};
  const pack = CREDIT_PACKS.find(p => p.id === packId);
  if (!pack) return res.status(400).json({ error: 'Paquete no válido' });
  const user = getUserOr404(req.auth.sub, res);
  if (!user) return;
  try {
    const token = await getVivaToken();
    const orderRes = await fetch(`${VIVA_API_BASE}/checkout/v2/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ amount: Math.round(pack.euros * 100), customerTrns: `Zoco IA — ${pack.label}`, customer: { email: user.email, fullName: user.nombre }, paymentTimeout: 1800, preauth: false, allowRecurring: false, maxInstallments: 0, paymentNotification: true, merchantTrns: `zocoia-${req.auth.sub}-${pack.id}`, sourceCode: VIVA_SOURCE_CODE, tags: [`user:${req.auth.sub}`, `pack:${pack.id}`], paymentMethodFees: [], disabledPaymentMethods: ['paypal','mbway','mbreference','mobilepay','cash','wallet','prepaid'], allowedPaymentMethods: [0] }),
    });
    if (!orderRes.ok) { const err = await orderRes.json().catch(() => ({})); console.error('Viva error:', err); return res.status(502).json({ error: 'Error al crear pedido en Viva' }); }
    const { orderCode } = await orderRes.json();
    const paymentId = uuidv4();
    db.prepare('INSERT INTO payments (id, user_id, amount, credits, status, provider, order_code) VALUES (?, ?, ?, ?, ?, ?, ?)').run(paymentId, req.auth.sub, pack.euros, pack.credits, 'pending', 'viva', String(orderCode));
    res.json({ checkoutUrl: `${VIVA_BASE}/web/checkout?ref=${orderCode}&color=1a1a2e&langs=es&paymentMethod=0`, orderCode, paymentId });
  } catch (err) {
    console.error('Error creando pago:', err);
    res.status(500).json({ error: 'Error interno al crear el pago' });
  }
});

app.post('/api/payments/webhook', async (req, res) => {
  try {
    const { EventTypeId, EventData } = req.body || {};
    if (EventTypeId !== 1796) return res.json({ ok: true });
    const { OrderCode, TransactionId } = EventData || {};
    if (!OrderCode || !TransactionId) return res.status(400).json({ error: 'Datos incompletos' });
    const payment = db.prepare('SELECT * FROM payments WHERE order_code = ? AND status = ?').get(String(OrderCode), 'pending');
    if (!payment) return res.json({ ok: true });
    db.prepare('UPDATE payments SET status = ?, transaction_id = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?').run('completed', TransactionId, payment.id);
    db.prepare('UPDATE users SET creditos = creditos + ? WHERE id = ?').run(payment.credits, payment.user_id);
    db.prepare('INSERT INTO usage_log (id, user_id, amount, kind, description) VALUES (?, ?, ?, ?, ?)').run(uuidv4(), payment.user_id, payment.credits, 'recarga', `Recarga via Viva.com — ${payment.credits} créditos`);
    console.log(`✅ Pago completado: usuario ${payment.user_id} recibió ${payment.credits} créditos`);
    res.json({ ok: true });
  } catch (err) { console.error('Error webhook Viva:', err); res.status(500).json({ error: 'Error interno' }); }
});

app.get('/api/payments/webhook', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ Key: String(process.env.VIVA_WEBHOOK_KEY || '') }));
});

app.get('/api/payments/success', authMiddleware, (req, res) => {
  const { orderCode } = req.query;
  const payment = db.prepare('SELECT * FROM payments WHERE order_code = ?').get(String(orderCode));
  if (payment && payment.status === 'completed') return res.json({ ok: true, credits: payment.credits, message: `¡Pago completado! +${payment.credits} créditos.` });
  res.json({ ok: false, message: 'Pago pendiente de confirmación' });
});

// ─── Sistema: estado del motor IA ─────────────────────────────────────────────
// Antes chequeaba Ollama (/api/tags). Ahora reporta el estado de Claude Anthropic.
app.get('/api/system/ollama', authMiddleware, async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.json({ online: false, motor: 'Claude Anthropic', error: 'ANTHROPIC_API_KEY no configurada' });
    // Verificación ligera: intentamos listar modelos
    const resp = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return res.json({ online: false, motor: 'Claude Anthropic' });
    const data = await resp.json();
    res.json({ online: true, motor: 'Claude Anthropic', models: (data.data || []).map(m => m.id).slice(0, 8) });
  } catch { res.json({ online: false, motor: 'Claude Anthropic' }); }
});

app.get('/admin/stats', authMiddleware, requireAdmin, (req, res) => {
  res.json({
    totalUsuarios: db.prepare('SELECT COUNT(*) as n FROM users').get().n,
    usuariosActivos: db.prepare("SELECT COUNT(*) as n FROM users WHERE activo = 1").get().n,
    ingresosTotal: db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM payments WHERE status='completed'").get().t,
    llamadasHoy: db.prepare("SELECT COUNT(*) as n FROM usage_log WHERE kind='gasto' AND created_at >= date('now')").get().n,
    ultimosPagos: db.prepare('SELECT p.*, u.email as user_email FROM payments p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 50').all(),
    vivaConfigurado: !!(VIVA_CLIENT_ID && VIVA_CLIENT_SECRET),
    // ollamaOnline renombrado a motorOnline para el frontend — Claude siempre disponible si hay API key
    ollamaOnline: !!process.env.ANTHROPIC_API_KEY,
    motorOnline: !!process.env.ANTHROPIC_API_KEY,
    motor: 'Claude Anthropic',
  });
});

app.get('/admin/logs', authMiddleware, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM usage_log ORDER BY created_at DESC LIMIT 100').all());
});

app.get('/admin/clientes', authMiddleware, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, email, nombre, is_admin, is_support, creditos, activo, created_at FROM users ORDER BY created_at DESC').all().map(publicUser));
});

app.put('/admin/clientes/:id', authMiddleware, requireAdmin, (req, res) => {
  const target = getUserOr404(req.params.id, res);
  if (!target) return;
  const { creditos, activo, isAdmin, isSupport, nombre, _addCredits } = req.body || {};
  const newCreditos = creditos !== undefined ? (_addCredits ? target.creditos + Number(creditos) : Number(creditos)) : target.creditos;
  db.prepare('UPDATE users SET creditos = ?, activo = ?, is_admin = ?, is_support = ?, nombre = ? WHERE id = ?').run(
    newCreditos,
    activo !== undefined ? (activo ? 1 : 0) : target.activo,
    isAdmin !== undefined ? (isAdmin ? 1 : 0) : target.is_admin,
    isSupport !== undefined ? (isSupport ? 1 : 0) : target.is_support,
    (nombre && nombre.trim()) || target.nombre,
    target.id
  );
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)));
});

// ─── Rutas de módulos externos ────────────────────────────────────────────────

registerBridgeAdminRoutes({ app, db, authMiddleware, requireAdmin, uuidv4 });
registerSessionRoutes({ app, db, authMiddleware, uuidv4, serverSecret: JWT_SECRET, processChatCompletion });

// ─── El Ordenador de Zoco: agente autónomo tipo Manus ──────────────────────
if (registerComputerRoutes) {
  registerComputerRoutes({
    app, db, authMiddleware, uuidv4, jwt, JWT_SECRET,
    workspacesRoot: WORKSPACES_ROOT,
    makeCallModel: ({ userId, model }) => {
      const claudeModel = resolveClaudeModel(model || 'zoco-plus');
      return async (msgs, tools, toolChoice) => {
        const userCheck = db.prepare('SELECT creditos, activo FROM users WHERE id = ?').get(userId);
        if (!userCheck || !userCheck.activo) { const e = new Error('Cuenta desactivada'); e.status = 403; throw e; }
        if (userCheck.creditos <= BALANCE_BLOCK_THRESHOLD) { const e = new Error('Créditos insuficientes'); e.status = 402; throw e; }
        const data = await callChatModel({ claudeModel, messages: msgs, maxTokens: 4096, temperature: 0.7, tools, toolChoice });
        const totalTokens = data.usage?.total_tokens || 0;
        const coste = totalTokens * 0.000002;
        if (coste > 0) {
          db.prepare('INSERT INTO usage_log (id, user_id, amount, kind, description) VALUES (?, ?, ?, ?, ?)').run(uuidv4(), userId, coste, 'gasto', `Ordenador de Zoco · ${claudeModel}`);
          db.prepare('UPDATE users SET creditos = creditos - ? WHERE id = ?').run(coste, userId);
        }
        return data;
      };
    },
    getUserTavilyKey: (userId) => {
      const row = db.prepare("SELECT data FROM resources WHERE user_id = ? AND type IN ('credencial','habilidad') AND name = 'TAVILY_API_KEY'").get(userId);
      if (!row) return null;
      try { return JSON.parse(row.data || '{}').valor || null; } catch { return null; }
    },
  });
}
registerConsoleRoutes({ app, db, authMiddleware, uuidv4, processChatCompletion });
resumeInterruptedBatches(db, processChatCompletion);

// ─── Endpoint compatible con Anthropic (/v1/messages) ────────────────────────

app.post('/v1/messages', authMiddleware, async (req, res) => {
  try {
    const { system, messages, max_tokens, temperature, model, metadata, stream } = req.body || {};
    const mensajesConSystem = system ? [{ role: 'system', content: system }, ...(messages || [])] : (messages || []);
    const result = await processChatCompletion(req.auth.sub, {
      agentId: metadata?.agent_slug ? await resolveAgentIdBySlug(metadata.agent_slug, req.auth.sub) : undefined,
      messages: mensajesConSystem, model, temperature, max_tokens,
      apiKeyId: req.auth.viaApiKey ? req.auth.apiKeyId : undefined,
      apiKeyType: req.auth.viaApiKey ? req.auth.apiKeyType : undefined,
    });
    const textoRespuesta = result.choices?.[0]?.message?.content || '';
    if (!stream) {
      return res.json({ id: `msg_${uuidv4().replace(/-/g, '').slice(0, 24)}`, type: 'message', role: 'assistant', model: result.model, content: [{ type: 'text', text: textoRespuesta }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens } });
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const msgId = `msg_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('message_start', { type: 'message_start', message: { id: msgId, role: 'assistant', model: result.model, usage: { input_tokens: result.usage.input_tokens, output_tokens: 0 } } });
    send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: textoRespuesta } });
    send('content_block_stop', { type: 'content_block_stop', index: 0 });
    send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: result.usage.output_tokens } });
    send('message_stop', { type: 'message_stop' });
    res.end();
  } catch (err) {
    console.error('Error en /v1/messages:', err);
    const status = err.status || 500;
    const errorType = status === 402 ? 'permission_error' : status === 401 ? 'authentication_error' : status === 404 ? 'invalid_request_error' : 'api_error';
    res.status(status).json({ type: 'error', error: { type: errorType, message: err.message || 'Error interno' } });
  }
});

async function resolveAgentIdBySlug(slug, userId) {
  const porId = db.prepare("SELECT id FROM resources WHERE id = ? AND user_id = ? AND type = 'agente'").get(slug, userId);
  if (porId) return porId.id;
  return db.prepare("SELECT id FROM resources WHERE user_id = ? AND type = 'agente' AND name = ?").get(userId, slug)?.id;
}

// ─── Frontend estático ────────────────────────────────────────────────────────

const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get(/^(?!\/(auth|v1|admin|health|salud|api)).*/, (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
} else {
  console.warn('⚠️  No se encontró la carpeta "public". Solo la API estará disponible.');
}

app.listen(port, () => {
  console.log(`🚀 Zoco IA Console corriendo en puerto ${port} — Motor: Claude Anthropic`);
});
