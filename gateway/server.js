// Maris AI — Gateway de autenticacion y medicion de uso delante de vLLM/Ollama
// Capa propia en Express: sin esto no puedes controlar ni cobrar a nadie.
// Compatible con OpenAI API: cualquier cliente que use openai-python, curl, etc.

const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { webSearchDuckDuckGo, formatResultsAsContext } = require('./websearch');

const PORT = process.env.PORT || 4000;
const VLLM_URL = process.env.VLLM_URL || 'http://localhost:8000/v1';
const DB_PATH = process.env.DB_PATH || './data/gateway.db';
const ADMIN_KEY = process.env.ADMIN_KEY || null;

// Crear directorio de base de datos si no existe
const dbDir = path.dirname(DB_PATH);
if (dbDir && dbDir !== '.' && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// ─── Base de datos ────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nombre TEXT NOT NULL,
    rol TEXT DEFAULT 'cliente',
    saldo REAL DEFAULT 0,
    tokens_comprados INTEGER DEFAULT 0,
    tokens_usados INTEGER DEFAULT 0,
    activo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_hash TEXT UNIQUE NOT NULL,
    owner_name TEXT NOT NULL,
    owner_email TEXT DEFAULT NULL,
    owner_id INTEGER,
    active INTEGER DEFAULT 1,
    monthly_token_limit INTEGER DEFAULT NULL,
    monthly_usd_limit REAL DEFAULT NULL,
    price_per_1k_tokens REAL DEFAULT 0.001,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    notes TEXT DEFAULT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_id INTEGER NOT NULL,
    agent_id INTEGER DEFAULT NULL,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    model TEXT,
    used_web_search INTEGER DEFAULT 0,
    endpoint TEXT DEFAULT '/v1/chat/completions',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (key_id) REFERENCES api_keys(id),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );

  CREATE TABLE IF NOT EXISTS models_registry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    equivalencia TEXT DEFAULT NULL,
    backend_url TEXT NOT NULL,
    backend_model_id TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    price_per_1k_tokens REAL DEFAULT 0.001,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    modelo TEXT NOT NULL,
    estado TEXT DEFAULT 'inactivo',
    sesiones INTEGER DEFAULT 0,
    ultima_actividad TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    tipo TEXT,
    monto REAL,
    tokens INTEGER,
    descripcion TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Registrar modelos por defecto si no existen.
// OLLAMA_URL debe ser la URL pública de tu ngrok (o tu servidor Ollama), sin barra final,
// ej: OLLAMA_URL=https://concave-charred-lived.ngrok-free.dev/v1
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/v1';

const modelosDefecto = [
  { model_id: 'maris-velox-1b', display_name: 'Zoco Nano', equivalencia: 'Modelo ligero y rápido', backend_url: OLLAMA_URL, backend_model_id: 'llama3.2:1b', active: 1, price: 0.0005 },
  { model_id: 'maris-core-7b', display_name: 'Zoco Core', equivalencia: 'Modelo intermedio, más capaz', backend_url: OLLAMA_URL, backend_model_id: 'qwen2.5:3b', active: 1, price: 0.002 },
];
for (const m of modelosDefecto) {
  const exists = db.prepare('SELECT id FROM models_registry WHERE model_id = ?').get(m.model_id);
  if (!exists) {
    db.prepare('INSERT INTO models_registry (model_id, display_name, equivalencia, backend_url, backend_model_id, active, price_per_1k_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(m.model_id, m.display_name, m.equivalencia, m.backend_url, m.backend_model_id, m.active, m.price);
  }
}

// Crear usuario admin si no existe (la contraseña SOLO sale de la variable de entorno ADMIN_PASSWORD, nunca del código)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'rrhh.milchollos@gmail.com';
const adminExists = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
if (!adminExists) {
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('⚠️  ADMIN_PASSWORD no está definida en las variables de entorno. No se creó el usuario admin.');
  } else {
    const adminPasswordHash = crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD).digest('hex');
    db.prepare('INSERT INTO users (email, password_hash, nombre, rol, saldo, tokens_comprados) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ADMIN_EMAIL, adminPasswordHash, 'Administrador', 'admin', 0, 0);
  }
}

// ─── Utilidades ───────────────────────────────────────────────────────────────
function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generateApiKey(ownerName, ownerEmail, ownerUserId, monthlyTokenLimit, monthlyUsdLimit, notes) {
  const rawKey = 'sk-marisai-' + crypto.randomBytes(24).toString('hex');
  const keyHash = hashKey(rawKey);
  db.prepare(
    'INSERT INTO api_keys (key_hash, owner_name, owner_email, owner_id, monthly_token_limit, monthly_usd_limit, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(keyHash, ownerName, ownerEmail || null, ownerUserId || null, monthlyTokenLimit || null, monthlyUsdLimit || null, notes || null);
  return rawKey;
}

function getUsageThisMonth(keyId) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total_tokens,
      COUNT(*) AS total_requests
    FROM usage_log
    WHERE key_id = ?
      AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
  `).get(keyId);
  return row;
}

// ─── Aplicacion Express ───────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Middleware de autenticacion
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const rawKey = authHeader.replace('Bearer ', '').trim();

  if (!rawKey) {
    return res.status(401).json({ error: 'Falta cabecera Authorization: Bearer <api_key>' });
  }

  if (ADMIN_KEY && rawKey === ADMIN_KEY) {
    req.isAdmin = true;
    req.apiKeyRow = { id: 0, owner_name: 'admin', active: 1 };
    return next();
  }

  const keyHash = hashKey(rawKey);
  const keyRow = db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND active = 1').get(keyHash);

  if (!keyRow) {
    return res.status(401).json({ error: 'API key invalida o desactivada' });
  }

  if (keyRow.monthly_token_limit) {
    const usage = getUsageThisMonth(keyRow.id);
    if (usage.total_tokens >= keyRow.monthly_token_limit) {
      return res.status(429).json({ error: 'Limite mensual de tokens alcanzado para esta key' });
    }
  }

  req.apiKeyRow = keyRow;
  next();
}

// ─── Endpoints de autenticacion ───────────────────────────────────────────────

app.post('/auth/register', (req, res) => {
  const { email, password, nombre } = req.body;
  
  if (!email || !password || !nombre) {
    return res.status(400).json({ error: 'Email, contraseña y nombre son requeridos' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) {
    return res.status(400).json({ error: 'El email ya está registrado' });
  }

  const passwordHash = hashPassword(password);
  try {
    db.prepare('INSERT INTO users (email, password_hash, nombre, rol) VALUES (?, ?, ?, ?)')
      .run(email, passwordHash, nombre, 'cliente');
    res.json({ message: 'Usuario registrado correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son requeridos' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  
  if (!user) {
    return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  }

  const passwordHash = hashPassword(password);
  if (user.password_hash !== passwordHash) {
    return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  }

  res.json({
    id: user.id,
    email: user.email,
    nombre: user.nombre,
    rol: user.rol,
    saldo: user.saldo,
    tokens_comprados: user.tokens_comprados,
    tokens_usados: user.tokens_usados,
  });
});

// ─── Endpoints de inferencia (compatibles con OpenAI) ────────────────────────

app.post('/v1/chat/completions', authMiddleware, async (req, res) => {
  try {
    const modelId = req.body.model || 'maris-velox-1b';
    const modelRow = db.prepare('SELECT * FROM models_registry WHERE model_id = ? AND active = 1').get(modelId);

    if (!modelRow) {
      return res.status(400).json({ error: `Modelo "${modelId}" no encontrado o inactivo en models_registry` });
    }

    // agent_id (opcional): permite desglosar el consumo de tokens por agente en vez de solo por api key
    const agentId = req.body.agent_id || null;

    // web_search (opcional): { web_search: { query: "..." } } o simplemente true para usar el último mensaje del usuario
    let messages = req.body.messages || [];
    let usedWebSearch = false;

    if (req.body.web_search) {
      const query = typeof req.body.web_search === 'object' && req.body.web_search.query
        ? req.body.web_search.query
        : messages.filter(m => m.role === 'user').slice(-1)[0]?.content;

      if (query) {
        try {
          const results = await webSearchDuckDuckGo(query, 5);
          const context = formatResultsAsContext(query, results);
          messages = [{ role: 'system', content: context }, ...messages];
          usedWebSearch = true;
        } catch (searchErr) {
          console.error('Error en búsqueda web:', searchErr.message);
          // Si falla la búsqueda, seguimos sin ella en vez de romper la petición
        }
      }
    }

    // Reescribimos "model" con el nombre real de Ollama y "messages" con el contexto de búsqueda si aplica
    const upstreamBody = { ...req.body, model: modelRow.backend_model_id, messages };
    delete upstreamBody.web_search;
    delete upstreamBody.agent_id;

    const upstream = await fetch(`${modelRow.backend_url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(upstreamBody),
    });

    const data = await upstream.json();
    const promptTokens = data.usage?.prompt_tokens || 0;
    const completionTokens = data.usage?.completion_tokens || 0;

    if (req.apiKeyRow.id !== 0) {
      db.prepare('INSERT INTO usage_log (key_id, agent_id, prompt_tokens, completion_tokens, model, used_web_search, endpoint) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(req.apiKeyRow.id, agentId, promptTokens, completionTokens, modelId, usedWebSearch ? 1 : 0, '/v1/chat/completions');

      if (agentId) {
        db.prepare('UPDATE agents SET sesiones = sesiones + 1, ultima_actividad = CURRENT_TIMESTAMP WHERE id = ?').run(agentId);
      }
    }

    res.status(upstream.status).json(data);
  } catch (err) {
    console.error('Error al reenviar a backend:', err.message);
    res.status(502).json({ error: 'El servidor de inferencia no respondio', detail: err.message });
  }
});

app.get('/v1/models', authMiddleware, (req, res) => {
  const modelos = db.prepare('SELECT * FROM models_registry WHERE active = 1').all();
  res.json({
    object: 'list',
    data: modelos.map(m => ({
      id: m.model_id,
      object: 'model',
      created: Math.floor(new Date(m.created_at).getTime() / 1000),
      owned_by: 'maris-ai',
      display_name: m.display_name,
      equivalencia: m.equivalencia,
    }))
  });
});

app.get('/v1/usage', authMiddleware, (req, res) => {
  const usage = getUsageThisMonth(req.apiKeyRow.id);
  res.json({
    owner: req.apiKeyRow.owner_name,
    tokens_used_this_month: usage.total_tokens,
    requests_this_month: usage.total_requests,
    monthly_token_limit: req.apiKeyRow.monthly_token_limit,
    monthly_usd_limit: req.apiKeyRow.monthly_usd_limit,
  });
});

// ─── Endpoints de administracion ──────────────────────────────────────────────

app.get('/admin/keys', authMiddleware, (req, res) => {
  if (!req.isAdmin) return res.status(403).json({ error: 'Solo accesible con ADMIN_KEY' });
  const keys = db.prepare('SELECT id, owner_name, owner_email, active, monthly_token_limit, monthly_usd_limit, created_at, notes FROM api_keys').all();
  const result = keys.map(k => {
    const usage = getUsageThisMonth(k.id);
    return { ...k, tokens_this_month: usage.total_tokens, requests_this_month: usage.total_requests };
  });
  res.json(result);
});

app.post('/admin/keys', authMiddleware, (req, res) => {
  if (!req.isAdmin) return res.status(403).json({ error: 'Solo accesible con ADMIN_KEY' });
  const { owner_name, owner_email, monthly_token_limit, monthly_usd_limit, notes } = req.body;
  if (!owner_name) return res.status(400).json({ error: 'owner_name es requerido' });
  const rawKey = generateApiKey(owner_name, owner_email, null, monthly_token_limit, monthly_usd_limit, notes);
  res.json({ api_key: rawKey, message: 'Guarda esta clave ahora, no se puede recuperar despues.' });
});

app.delete('/admin/keys/:id', authMiddleware, (req, res) => {
  if (!req.isAdmin) return res.status(403).json({ error: 'Solo accesible con ADMIN_KEY' });
  db.prepare('UPDATE api_keys SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ message: 'Clave desactivada correctamente' });
});

app.get('/admin/users', authMiddleware, (req, res) => {
  if (!req.isAdmin) return res.status(403).json({ error: 'Solo accesible con ADMIN_KEY' });
  const users = db.prepare('SELECT id, email, nombre, rol, saldo, tokens_comprados, tokens_usados, activo, created_at FROM users').all();
  res.json(users);
});

app.get('/admin/agents-usage', authMiddleware, (req, res) => {
  if (!req.isAdmin) return res.status(403).json({ error: 'Solo accesible con ADMIN_KEY' });
  const rows = db.prepare(`
    SELECT
      a.id,
      a.nombre,
      a.modelo,
      a.estado,
      a.sesiones,
      a.ultima_actividad,
      COALESCE(SUM(u.prompt_tokens + u.completion_tokens), 0) AS tokens_totales,
      COALESCE(SUM(CASE WHEN strftime('%Y-%m', u.created_at) = strftime('%Y-%m', 'now') THEN u.prompt_tokens + u.completion_tokens ELSE 0 END), 0) AS tokens_este_mes,
      COUNT(u.id) AS peticiones_totales,
      SUM(u.used_web_search) AS busquedas_web
    FROM agents a
    LEFT JOIN usage_log u ON u.agent_id = a.id
    GROUP BY a.id
    ORDER BY tokens_totales DESC
  `).all();
  res.json(rows);
});

app.get('/admin/stats', authMiddleware, (req, res) => {
  if (!req.isAdmin) return res.status(403).json({ error: 'Solo accesible con ADMIN_KEY' });
  const totalTokens = db.prepare(`
    SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total
    FROM usage_log WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
  `).get();
  const totalRequests = db.prepare(`
    SELECT COUNT(*) AS total FROM usage_log
    WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
  `).get();
  const activeKeys = db.prepare('SELECT COUNT(*) AS total FROM api_keys WHERE active = 1').get();
  const activeUsers = db.prepare('SELECT COUNT(*) AS total FROM users WHERE activo = 1').get();
  res.json({
    tokens_this_month: totalTokens.total,
    requests_this_month: totalRequests.total,
    active_keys: activeKeys.total,
    active_users: activeUsers.total,
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'maris-ai-gateway', version: '2.0.0' });
});

// ─── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === 'create-key') {
    const owner = args[1] || 'sin-nombre';
    const email = args[2] || null;
    const tokenLimit = args[3] ? parseInt(args[3], 10) : null;
    const key = generateApiKey(owner, email, null, tokenLimit, null, null);
    console.log(`\nAPI key creada para "${owner}":`);
    console.log(key);
    console.log('\nGuardala ahora, no se puede recuperar despues (solo se almacena el hash).\n');
    process.exit(0);
  }

  app.listen(PORT, () => {
    console.log(`Maris AI Gateway v2.0 — escuchando en puerto ${PORT}`);
    console.log(`Backend de inferencia: ${VLLM_URL}`);
    console.log(`Base de datos: ${DB_PATH}`);
  });
}

module.exports = { app, generateApiKey };
