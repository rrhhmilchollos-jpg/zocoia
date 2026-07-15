// ============================================================
// ZOCO IA — Servidor unificado de producción
// Backend completo: autenticación, API keys, agentes, modelos,
// créditos, analíticas y administración.
// Sirve también el frontend (carpeta /public).
// ============================================================
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// ---------- Persistencia (JSON en disco, sin dependencias nativas) ----------
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'zocoia-db.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const uid = () => crypto.randomBytes(8).toString('hex');
const newApiKey = () => 'sk-zocoia-' + crypto.randomBytes(24).toString('hex');
const newToken = () => 'tok-' + crypto.randomBytes(24).toString('hex');

const ADMIN_EMAIL = 'rrhh.milchollos@gmail.com';
const ADMIN_PASS = '19862210Des';
const MASTER_KEY = process.env.ADMIN_KEY || 'sk-marisai-00721f5f89c10d78b286ad7f3bda6d457068b4ea10d53a5d';

// Modelos propios de la infraestructura
const MODELS = [
  { id: 'maris-fable-70b',  name: 'Fable 5',   equiv: 'Fable 5',  badge: 'Nuevo', color: 'blue',   tags: ['Más capaz', 'Investigación', 'Tareas de varios días'], input: 5.0,  output: 25.0, ctx: 500000 },
  { id: 'maris-pro-32b',    name: 'Opus 4.8',  equiv: 'Opus 4.8', badge: null,    color: 'orange', tags: ['Proyectos complejos', 'Agentes', 'Programación'],     input: 15.0, output: 75.0, ctx: 200000 },
  { id: 'maris-core-7b',    name: 'Sonnet 5',  equiv: 'Sonnet 5', badge: 'Nuevo', color: 'beige',  tags: ['Tareas cotidianas', 'Escritura', 'Rentable'],          input: 3.0,  output: 15.0, ctx: 200000 },
  { id: 'maris-velox-1b',   name: 'Haiku 4.5', equiv: 'Haiku 4.5',badge: null,    color: 'green',  tags: ['Más rápido', 'Menor coste', 'Alto volumen'],           input: 0.8,  output: 4.0,  ctx: 200000 }
];

// Los 11 agentes del pipeline de Maria
const DEFAULT_AGENTS = [
  { n: 1,  name: 'Analista de Requisitos',  icon: 'clipboard-list', model: 'maris-core-7b',  desc: 'Analiza la idea del cliente y extrae requisitos funcionales.' },
  { n: 2,  name: 'Investigador de Mercado', icon: 'magnifying-glass-chart', model: 'maris-fable-70b', desc: 'Investiga tendencias y competencia para orientar el producto.' },
  { n: 3,  name: 'Arquitecto de Software',  icon: 'sitemap', model: 'maris-pro-32b',  desc: 'Diseña la arquitectura técnica y la estructura del proyecto.' },
  { n: 4,  name: 'Maquetador HTML',         icon: 'code', model: 'maris-velox-1b', desc: 'Construye la estructura HTML semántica de la aplicación.' },
  { n: 5,  name: 'Estilista CSS Custom',    icon: 'palette', model: 'maris-velox-1b', desc: 'Aplica estilos y diseño visual personalizado.' },
  { n: 6,  name: 'Desarrollador JS',        icon: 'js', model: 'maris-core-7b',  desc: 'Programa la lógica e interactividad del frontend.' },
  { n: 7,  name: 'Ingeniero Backend',       icon: 'server', model: 'maris-pro-32b',  desc: 'Desarrolla la API, base de datos y lógica de servidor.' },
  { n: 8,  name: 'Especialista en Seguridad', icon: 'shield-halved', model: 'maris-pro-32b', desc: 'Audita vulnerabilidades y protege la aplicación.' },
  { n: 9,  name: 'Tester QA',               icon: 'vial-circle-check', model: 'maris-core-7b', desc: 'Prueba la aplicación y reporta errores.' },
  { n: 10, name: 'Depurador de Código',     icon: 'bug-slash', model: 'maris-pro-32b',  desc: 'Corrige los errores detectados por el tester.' },
  { n: 11, name: 'Desplegador DevOps',      icon: 'rocket', model: 'maris-velox-1b', desc: 'Prepara y publica la aplicación en producción.' }
];

function defaultDB() {
  const adminId = uid();
  const now = new Date().toISOString();
  return {
    users: [{
      id: adminId, name: 'Maria', email: ADMIN_EMAIL, passHash: sha256(ADMIN_PASS),
      role: 'admin', credits: 1000.0, spentMonth: 43.73, cacheSaved: 1.02, limitMonth: 1000,
      createdAt: now, org: 'Maris AI'
    }],
    apiKeys: [{
      id: uid(), userId: adminId, name: 'Clave maestra Maria Admin', key: MASTER_KEY,
      createdAt: now, lastUsed: now, active: true, spend: 0, budget: null
    }],
    agents: DEFAULT_AGENTS.map(a => ({
      id: uid(), userId: adminId, ...a, status: 'active', createdAt: now, sessions: 0, tokensUsed: 0
    })),
    sessions: [],
    transactions: [],
    usage: seedUsage(adminId),
    files: [], skills: [], batches: [], deployments: [], environments: [],
    credentialStores: [], memoryStores: []
  };
}
function seedUsage(userId) {
  // 7 días de uso semilla para el gráfico (total ≈ 6M tokens)
  const out = [];
  const vals = [420000, 510000, 680000, 750000, 890000, 1160000, 1590000];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    out.push({ date: d, userId, tokens: vals[6 - i], requests: Math.round(vals[6 - i] / 2100), cost: +(vals[6 - i] / 1e6 * 6.2).toFixed(2) });
  }
  return out;
}

let db;
function loadDB() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    // asegurar admin
    if (!db.users.find(u => u.email === ADMIN_EMAIL)) {
      const d = defaultDB();
      db.users.push(d.users[0]);
    }
  } catch {
    db = defaultDB();
    saveDB();
  }
}
let saveTimer = null;
function saveDB() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1)); } catch (e) { console.error('DB save error', e); }
  }, 150);
}
loadDB();

// ---------- Sesiones de login (tokens en memoria + persistidos) ----------
db.authTokens = db.authTokens || {};
function authUser(req) {
  const t = (req.headers.authorization || '').replace('Bearer ', '').trim() || req.headers['x-auth-token'];
  if (!t) return null;
  const userId = db.authTokens[t];
  if (!userId) return null;
  return db.users.find(u => u.id === userId) || null;
}
function requireAuth(req, res, next) {
  const u = authUser(req);
  if (!u) return res.status(401).json({ error: { message: 'No autenticado. Inicia sesión.' } });
  req.user = u; next();
}
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: { message: 'Solo administradores.' } });
  next();
}

app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-auth-token, x-api-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ============ SALUD ============
app.get('/health', (_, res) => res.json({ status: 'ok', service: 'Zoco IA Console', time: new Date().toISOString() }));

// ============ AUTENTICACIÓN ============
app.post('/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: { message: 'Faltan datos: nombre, email y contraseña.' } });
  if (db.users.find(u => u.email.toLowerCase() === String(email).toLowerCase()))
    return res.status(409).json({ error: { message: 'Ese email ya está registrado. Inicia sesión.' } });
  const now = new Date().toISOString();
  const user = { id: uid(), name, email, passHash: sha256(password), role: 'client', credits: 5.0, spentMonth: 0, cacheSaved: 0, limitMonth: 100, createdAt: now, org: name };
  db.users.push(user);
  // clave API automática de bienvenida
  const key = { id: uid(), userId: user.id, name: 'Clave por defecto', key: newApiKey(), createdAt: now, lastUsed: null, active: true, spend: 0, budget: 5 };
  db.apiKeys.push(key);
  db.transactions.push({ id: uid(), userId: user.id, type: 'bonus', amount: 5.0, desc: 'Créditos de bienvenida', date: now });
  const token = newToken();
  db.authTokens[token] = user.id;
  saveDB();
  res.json({ token, user: publicUser(user), apiKey: key.key });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.users.find(u => u.email.toLowerCase() === String(email || '').toLowerCase());
  if (!user || user.passHash !== sha256(password)) return res.status(401).json({ error: { message: 'Email o contraseña incorrectos.' } });
  const token = newToken();
  db.authTokens[token] = user.id;
  saveDB();
  res.json({ token, user: publicUser(user) });
});

app.post('/auth/logout', requireAuth, (req, res) => {
  const t = (req.headers.authorization || '').replace('Bearer ', '').trim();
  delete db.authTokens[t]; saveDB();
  res.json({ ok: true });
});

app.get('/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, credits: u.credits, spentMonth: u.spentMonth, cacheSaved: u.cacheSaved, limitMonth: u.limitMonth, org: u.org, createdAt: u.createdAt };
}

// ============ DASHBOARD (métricas del usuario) ============
app.get('/api/dashboard', requireAuth, (req, res) => {
  const u = req.user;
  const myUsage = db.usage.filter(x => x.userId === u.id).slice(-7);
  const tokens7d = myUsage.reduce((s, x) => s + x.tokens, 0);
  res.json({
    user: publicUser(u),
    credits: u.credits,
    spentMonth: u.spentMonth,
    limitMonth: u.limitMonth,
    cacheSaved: u.cacheSaved,
    cacheHitRate: 6,
    tokens7d,
    usage: myUsage,
    models: MODELS,
    agentCount: db.agents.filter(a => a.userId === u.id).length,
    keyCount: db.apiKeys.filter(k => k.userId === u.id && k.active).length
  });
});

// ============ MODELOS ============
app.get('/api/models', (_, res) => res.json({ data: MODELS }));

// ============ CLAVES API ============
app.get('/api/keys', requireAuth, (req, res) => {
  const keys = db.apiKeys.filter(k => k.userId === req.user.id).map(k => ({ ...k, key: maskKey(k.key) }));
  res.json({ data: keys });
});
app.post('/api/keys', requireAuth, (req, res) => {
  const now = new Date().toISOString();
  const k = { id: uid(), userId: req.user.id, name: (req.body && req.body.name) || 'Nueva clave', key: newApiKey(), createdAt: now, lastUsed: null, active: true, spend: 0, budget: (req.body && req.body.budget) || null };
  db.apiKeys.push(k); saveDB();
  res.json({ ...k }); // se muestra completa SOLO al crearla
});
app.delete('/api/keys/:id', requireAuth, (req, res) => {
  const k = db.apiKeys.find(x => x.id === req.params.id && x.userId === req.user.id);
  if (!k) return res.status(404).json({ error: { message: 'Clave no encontrada' } });
  k.active = false; saveDB();
  res.json({ ok: true });
});
function maskKey(k) { return k.slice(0, 14) + '...' + k.slice(-4); }

// ============ AGENTES ============
app.get('/api/agents', requireAuth, (req, res) => {
  const list = req.user.role === 'admin' ? db.agents : db.agents.filter(a => a.userId === req.user.id);
  res.json({ data: list });
});
app.post('/api/agents', requireAuth, (req, res) => {
  const { name, desc, model, icon } = req.body || {};
  if (!name) return res.status(400).json({ error: { message: 'El agente necesita un nombre.' } });
  const now = new Date().toISOString();
  const a = { id: uid(), userId: req.user.id, n: db.agents.filter(x => x.userId === req.user.id).length + 1, name, icon: icon || 'robot', model: model || 'maris-core-7b', desc: desc || '', status: 'active', createdAt: now, sessions: 0, tokensUsed: 0 };
  db.agents.push(a); saveDB();
  res.json(a);
});
app.patch('/api/agents/:id', requireAuth, (req, res) => {
  const a = db.agents.find(x => x.id === req.params.id && (x.userId === req.user.id || req.user.role === 'admin'));
  if (!a) return res.status(404).json({ error: { message: 'Agente no encontrado' } });
  ['name', 'desc', 'model', 'status', 'icon'].forEach(f => { if (req.body[f] !== undefined) a[f] = req.body[f]; });
  saveDB(); res.json(a);
});
app.delete('/api/agents/:id', requireAuth, (req, res) => {
  const i = db.agents.findIndex(x => x.id === req.params.id && (x.userId === req.user.id || req.user.role === 'admin'));
  if (i < 0) return res.status(404).json({ error: { message: 'Agente no encontrado' } });
  db.agents.splice(i, 1); saveDB();
  res.json({ ok: true });
});

// ============ EJECUCIÓN DE AGENTES / CHAT (v1 compatible OpenAI) ============
// Motor de respuesta: usa OLLAMA_URL o LLM_URL si están configurados; si no, simulador local.
const LLM_URL = process.env.OLLAMA_URL || process.env.LLM_URL || null;

async function runLLM(model, messages, maxTokens) {
  if (LLM_URL) {
    try {
      const r = await fetch(LLM_URL.replace(/\/$/, '') + '/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.OLLAMA_MODEL || 'llama3.2:1b', messages, stream: false })
      });
      if (r.ok) { const j = await r.json(); return j.message && j.message.content; }
    } catch (e) { console.error('LLM remoto no disponible:', e.message); }
  }
  // Simulador local determinista (siempre responde)
  const last = (messages[messages.length - 1] || {}).content || '';
  return simulate(model, last);
}
function simulate(model, prompt) {
  const m = MODELS.find(x => x.id === model) || MODELS[3];
  return `[${m.name} · ${m.id}] He procesado tu solicitud: "${String(prompt).slice(0, 140)}". ` +
    `Esta respuesta proviene de la infraestructura propia de Zoco IA. ` +
    `Para conectar un motor LLM real, configura la variable OLLAMA_URL en Railway apuntando a tu servidor de modelos.`;
}

app.post('/v1/chat/completions', async (req, res) => {
  // autenticación por API key
  const key = (req.headers.authorization || '').replace('Bearer ', '').trim() || req.headers['x-api-key'];
  const rec = db.apiKeys.find(k => k.key === key && k.active);
  if (!rec) return res.status(401).json({ error: { message: 'API key inválida o revocada.', type: 'authentication_error' } });
  const owner = db.users.find(u => u.id === rec.userId);
  if (!owner) return res.status(401).json({ error: { message: 'Propietario de la clave no encontrado.' } });
  if (owner.credits <= 0) return res.status(402).json({ error: { message: `Saldo agotado (${owner.credits.toFixed(2)} US$). Añade fondos en el panel.`, type: 'insufficient_quota' } });

  const { model = 'maris-velox-1b', messages = [], max_tokens = 512 } = req.body || {};
  const content = await runLLM(model, messages, max_tokens);
  const promptTok = Math.max(8, Math.round(JSON.stringify(messages).length / 4));
  const compTok = Math.max(8, Math.round(String(content).length / 4));
  const mm = MODELS.find(x => x.id === model) || MODELS[3];
  const cost = +(promptTok / 1e6 * mm.input + compTok / 1e6 * mm.output).toFixed(6);

  owner.credits = +(owner.credits - cost).toFixed(6);
  owner.spentMonth = +(owner.spentMonth + cost).toFixed(6);
  rec.spend = +((rec.spend || 0) + cost).toFixed(6);
  rec.lastUsed = new Date().toISOString();
  addUsage(owner.id, promptTok + compTok, cost);
  saveDB();

  res.json({
    id: 'chatcmpl-' + uid(), object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: promptTok, completion_tokens: compTok, total_tokens: promptTok + compTok, cost_usd: cost }
  });
});
app.get('/v1/models', (_, res) => res.json({ object: 'list', data: MODELS.map(m => ({ id: m.id, object: 'model', owned_by: 'zocoia', equiv: m.equiv })) }));

function addUsage(userId, tokens, cost) {
  const d = new Date().toISOString().slice(0, 10);
  let row = db.usage.find(x => x.userId === userId && x.date === d);
  if (!row) { row = { date: d, userId, tokens: 0, requests: 0, cost: 0 }; db.usage.push(row); }
  row.tokens += tokens; row.requests += 1; row.cost = +(row.cost + cost).toFixed(6);
}

// ============ CHAT DEL ÁREA DE TRABAJO (autenticado por sesión) ============
app.post('/api/workspace/chat', requireAuth, async (req, res) => {
  const { model = 'maris-velox-1b', messages = [] } = req.body || {};
  if (req.user.credits <= 0 && req.user.role !== 'admin')
    return res.status(402).json({ error: { message: 'Saldo agotado. Añade fondos para continuar.' } });
  const content = await runLLM(model, messages, 512);
  const toks = Math.max(16, Math.round((JSON.stringify(messages).length + content.length) / 4));
  const mm = MODELS.find(x => x.id === model) || MODELS[3];
  const cost = +(toks / 1e6 * (mm.input + mm.output) / 2).toFixed(6);
  req.user.credits = +(req.user.credits - cost).toFixed(6);
  req.user.spentMonth = +(req.user.spentMonth + cost).toFixed(6);
  addUsage(req.user.id, toks, cost);
  saveDB();
  res.json({ content, tokens: toks, cost });
});

// ============ PIPELINE: ejecutar los 11 agentes en cascada ============
app.post('/api/pipeline/run', requireAuth, async (req, res) => {
  const idea = (req.body && req.body.idea) || 'Aplicación de ejemplo';
  const myAgents = db.agents.filter(a => a.userId === req.user.id && a.status === 'active').sort((a, b) => a.n - b.n);
  if (!myAgents.length) return res.status(400).json({ error: { message: 'No tienes agentes activos.' } });
  const steps = [];
  let contextText = idea;
  for (const ag of myAgents) {
    const out = await runLLM(ag.model, [
      { role: 'system', content: `Eres el agente "${ag.name}": ${ag.desc}` },
      { role: 'user', content: `Tarea del proyecto: ${idea}\nContexto previo: ${String(contextText).slice(0, 400)}` }
    ], 200);
    const toks = Math.max(20, Math.round(out.length / 4));
    ag.sessions += 1; ag.tokensUsed += toks;
    addUsage(req.user.id, toks, +(toks / 1e6 * 3).toFixed(6));
    steps.push({ agent: ag.name, n: ag.n, model: ag.model, output: out });
    contextText = out;
  }
  const sess = { id: uid(), userId: req.user.id, idea, steps: steps.length, date: new Date().toISOString() };
  db.sessions.push(sess); saveDB();
  res.json({ session: sess, steps });
});

app.get('/api/sessions', requireAuth, (req, res) => {
  const list = req.user.role === 'admin' ? db.sessions : db.sessions.filter(s => s.userId === req.user.id);
  res.json({ data: list.slice(-50).reverse() });
});

// ============ CRÉDITOS / FACTURACIÓN ============
const PACKS = [
  { id: 'starter', name: 'Starter', usd: 10, tokens: '2 M', bonus: 0 },
  { id: 'professional', name: 'Professional', usd: 50, tokens: '12 M', bonus: 10 },
  { id: 'enterprise', name: 'Enterprise', usd: 200, tokens: '55 M', bonus: 15 },
  { id: 'unlimited', name: 'Unlimited', usd: 500, tokens: '150 M', bonus: 25 }
];
app.get('/api/billing/packs', (_, res) => res.json({ data: PACKS }));
app.post('/api/billing/add-funds', requireAuth, (req, res) => {
  const pack = PACKS.find(p => p.id === (req.body && req.body.packId));
  const custom = req.body && Number(req.body.amount);
  const amount = pack ? pack.usd * (1 + pack.bonus / 100) : (custom > 0 ? custom : 0);
  if (!amount) return res.status(400).json({ error: { message: 'Paquete o importe inválido.' } });
  req.user.credits = +(req.user.credits + amount).toFixed(2);
  db.transactions.push({ id: uid(), userId: req.user.id, type: 'recharge', amount, desc: pack ? `Paquete ${pack.name} (Viva.com)` : 'Recarga manual (Viva.com)', date: new Date().toISOString() });
  saveDB();
  res.json({ ok: true, credits: req.user.credits });
});
app.get('/api/billing/transactions', requireAuth, (req, res) => {
  res.json({ data: db.transactions.filter(t => t.userId === req.user.id).slice(-50).reverse() });
});

// ============ ANALÍTICAS ============
app.get('/api/usage', requireAuth, (req, res) => {
  const mine = db.usage.filter(x => x.userId === req.user.id);
  res.json({ data: mine.slice(-30) });
});

// ============ RECURSOS AUXILIARES (Archivos, Habilidades, Lotes, etc.) ============
function crudList(name) {
  app.get(`/api/${name}`, requireAuth, (req, res) => {
    const list = (db[name] || []).filter(x => x.userId === req.user.id || req.user.role === 'admin');
    res.json({ data: list });
  });
  app.post(`/api/${name}`, requireAuth, (req, res) => {
    const item = { id: uid(), userId: req.user.id, ...req.body, createdAt: new Date().toISOString() };
    db[name] = db[name] || []; db[name].push(item); saveDB();
    res.json(item);
  });
  app.delete(`/api/${name}/:id`, requireAuth, (req, res) => {
    const i = (db[name] || []).findIndex(x => x.id === req.params.id && (x.userId === req.user.id || req.user.role === 'admin'));
    if (i < 0) return res.status(404).json({ error: { message: 'No encontrado' } });
    db[name].splice(i, 1); saveDB(); res.json({ ok: true });
  });
}
['files', 'skills', 'batches', 'deployments', 'environments', 'credentialStores', 'memoryStores'].forEach(crudList);

// ============ ADMINISTRACIÓN ============
app.get('/api/admin/stats', requireAuth, requireAdmin, (req, res) => {
  const totalTokens = db.usage.reduce((s, x) => s + x.tokens, 0);
  const totalRevenue = db.transactions.filter(t => t.type === 'recharge').reduce((s, t) => s + t.amount, 0);
  res.json({
    users: db.users.length,
    clients: db.users.filter(u => u.role === 'client').length,
    activeKeys: db.apiKeys.filter(k => k.active).length,
    agents: db.agents.length,
    sessions: db.sessions.length,
    totalTokens, totalRevenue,
    totalSpend: db.users.reduce((s, u) => s + (u.spentMonth || 0), 0)
  });
});
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  res.json({ data: db.users.map(u => ({ ...publicUser(u), keys: db.apiKeys.filter(k => k.userId === u.id && k.active).length, agents: db.agents.filter(a => a.userId === u.id).length })) });
});
app.patch('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const u = db.users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: { message: 'Usuario no encontrado' } });
  ['name', 'role', 'credits', 'limitMonth'].forEach(f => { if (req.body[f] !== undefined) u[f] = req.body[f]; });
  if (req.body.password) u.passHash = sha256(req.body.password);
  saveDB(); res.json(publicUser(u));
});
app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const i = db.users.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: { message: 'Usuario no encontrado' } });
  if (db.users[i].email === ADMIN_EMAIL) return res.status(400).json({ error: { message: 'No puedes eliminar al administrador principal.' } });
  const uidDel = db.users[i].id;
  db.users.splice(i, 1);
  db.apiKeys = db.apiKeys.filter(k => k.userId !== uidDel);
  db.agents = db.agents.filter(a => a.userId !== uidDel);
  saveDB(); res.json({ ok: true });
});
app.get('/api/admin/keys', requireAuth, requireAdmin, (req, res) => {
  res.json({ data: db.apiKeys.map(k => ({ ...k, key: maskKey(k.key), owner: (db.users.find(u => u.id === k.userId) || {}).email })) });
});
app.post('/api/admin/keys/:id/toggle', requireAuth, requireAdmin, (req, res) => {
  const k = db.apiKeys.find(x => x.id === req.params.id);
  if (!k) return res.status(404).json({ error: { message: 'Clave no encontrada' } });
  k.active = !k.active; saveDB(); res.json({ ok: true, active: k.active });
});
app.get('/api/admin/transactions', requireAuth, requireAdmin, (req, res) => {
  res.json({ data: db.transactions.slice(-100).reverse().map(t => ({ ...t, owner: (db.users.find(u => u.id === t.userId) || {}).email })) });
});

// ============ FRONTEND ============
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/v1') || req.path.startsWith('/auth'))
    return res.status(404).json({ error: { message: 'Endpoint no encontrado' } });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Zoco IA Console corriendo en puerto ${PORT}`));
