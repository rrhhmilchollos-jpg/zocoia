// Zoco IA — gateway de autenticacion y medicion de uso delante de vLLM
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4000;
const VLLM_URL = process.env.VLLM_URL || 'http://localhost:8000/v1';
const DB_PATH = process.env.DB_PATH || './data/gateway.db';

// better-sqlite3 no crea el directorio padre por si solo: si falta, falla al
// arrancar. Lo creamos aqui para que funcione tanto en Docker (donde el
// volumen ya lo crea) como en local.
const dbDir = path.dirname(DB_PATH);
if (dbDir && dbDir !== '.' && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_hash TEXT UNIQUE NOT NULL,
    owner_name TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    monthly_token_limit INTEGER DEFAULT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_id INTEGER NOT NULL,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    model TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (key_id) REFERENCES api_keys(id)
  );
`);

function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

function generateApiKey(ownerName, monthlyLimit = null) {
  const rawKey = 'sk-priv-' + crypto.randomBytes(24).toString('hex');
  const keyHash = hashKey(rawKey);
  db.prepare(
    'INSERT INTO api_keys (key_hash, owner_name, monthly_token_limit) VALUES (?, ?, ?)'
  ).run(keyHash, ownerName, monthlyLimit);
  return rawKey;
}

function getUsageThisMonth(keyId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total
    FROM usage_log
    WHERE key_id = ?
      AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
  `).get(keyId);
  return row.total;
}

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  const authHeader = req.headers['authorization'] || '';
  const rawKey = authHeader.replace('Bearer ', '').trim();

  if (!rawKey) {
    return res.status(401).json({ error: 'Falta cabecera Authorization: Bearer <api_key>' });
  }

  const keyHash = hashKey(rawKey);
  const keyRow = db.prepare(
    'SELECT * FROM api_keys WHERE key_hash = ? AND active = 1'
  ).get(keyHash);

  if (!keyRow) {
    return res.status(401).json({ error: 'API key inválida o desactivada' });
  }

  if (keyRow.monthly_token_limit) {
    const used = getUsageThisMonth(keyRow.id);
    if (used >= keyRow.monthly_token_limit) {
      return res.status(429).json({ error: 'Límite mensual de tokens alcanzado para esta key' });
    }
  }

  req.apiKeyRow = keyRow;
  next();
});

app.post('/v1/chat/completions', async (req, res) => {
  try {
    const upstream = await fetch(`${VLLM_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });

    const data = await upstream.json();

    const promptTokens = data.usage?.prompt_tokens || 0;
    const completionTokens = data.usage?.completion_tokens || 0;

    db.prepare(`
      INSERT INTO usage_log (key_id, prompt_tokens, completion_tokens, model)
      VALUES (?, ?, ?, ?)
    `).run(req.apiKeyRow.id, promptTokens, completionTokens, req.body.model || 'desconocido');

    res.status(upstream.status).json(data);
  } catch (err) {
    console.error('Error al reenviar a vLLM:', err.message);
    res.status(502).json({ error: 'El servidor de inferencia no respondió' });
  }
});

app.get('/v1/usage', (req, res) => {
  const used = getUsageThisMonth(req.apiKeyRow.id);
  res.json({
    owner: req.apiKeyRow.owner_name,
    tokens_used_this_month: used,
    monthly_limit: req.apiKeyRow.monthly_token_limit
  });
});

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === 'create-key') {
    const owner = args[1] || 'sin-nombre';
    const limit = args[2] ? parseInt(args[2], 10) : null;
    const key = generateApiKey(owner, limit);
    console.log(`API key creada para "${owner}":`);
    console.log(key);
    console.log('Guárdala ahora, no se puede recuperar después (solo se almacena el hash).');
    process.exit(0);
  }
}

app.listen(PORT, () => {
  console.log(`Zoco IA — gateway escuchando en el puerto ${PORT}, reenviando a ${VLLM_URL}`);
});

module.exports = { app, generateApiKey };
