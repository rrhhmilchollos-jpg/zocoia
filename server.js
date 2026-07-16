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
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

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
`);

// Migración simple: añade la columna modelo_activo si no existe todavía.
const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userColumns.includes('modelo_activo')) {
  db.exec("ALTER TABLE users ADD COLUMN modelo_activo TEXT DEFAULT 'maris-core-7b'");
}

const RESOURCE_TYPES = ['agente', 'archivo', 'habilidad', 'lote', 'sesion', 'implementacion', 'entorno', 'credencial', 'memoria'];

// Modelos Groq disponibles con sus IDs reales
const MODELOS_VALIDOS = ['maris-velox', 'maris-core', 'maris-pro', 'maris-beta'];
const GROQ_MODEL_MAP = {
  'maris-velox': 'llama-3.3-70b-versatile',   // Rápido, equiv. Haiku
  'maris-core':  'llama-3.3-70b-versatile',   // Equilibrado, equiv. Sonnet
  'maris-pro':   'moonshotai/kimi-k2-instruct', // Potente, equiv. Sonnet 4.7
  'maris-beta':  'moonshotai/kimi-k2-instruct', // Máxima potencia, equiv. Opus
};
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

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
    modeloActivo: user.modelo_activo || 'maris-core-7b',
    createdAt: user.created_at,
  };
}

function estimateTokens(text) {
  // Estimación simple (~4 caracteres por token), suficiente para simular la caché.
  return Math.max(1, Math.ceil((text || '').length / 4));
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

app.post('/v1/chat/completions', authMiddleware, async (req, res) => {
  if (!GROQ_API_KEY) {
    return res.status(503).json({ error: 'GROQ_API_KEY no configurada en el servidor' });
  }

  const { agentId, messages, model } = req.body || {};
  const userMessage = Array.isArray(messages) && messages.length ? messages[messages.length - 1] : null;

  // Determinar modelo Groq a usar
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub);
  const modeloZocoia = model || user?.modelo_activo || 'maris-core';
  const groqModel = GROQ_MODEL_MAP[modeloZocoia] || GROQ_MODEL_MAP['maris-core'];

  try {
    let mensajesParaGroq = [];

    if (agentId) {
      // Con agente: usar memoria persistente
      const agente = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?').get(agentId, req.auth.sub, 'agente');
      if (!agente) return res.status(404).json({ error: 'Agente no encontrado' });

      const agenteData = agente.data ? JSON.parse(agente.data) : {};
      const historial = db.prepare('SELECT role, content FROM agent_memory WHERE agente_id = ? ORDER BY created_at ASC LIMIT 50').all(agentId);

      if (agenteData.systemPrompt) {
        mensajesParaGroq.push({ role: 'system', content: agenteData.systemPrompt });
      } else {
        mensajesParaGroq.push({ role: 'system', content: `Eres ${agente.name}, un asistente de IA útil y preciso.` });
      }
      mensajesParaGroq = mensajesParaGroq.concat(historial);
      if (userMessage) mensajesParaGroq.push({ role: 'user', content: String(userMessage.content) });
    } else {
      // Sin agente: pasar mensajes directamente
      mensajesParaGroq = Array.isArray(messages) ? messages : [{ role: 'user', content: 'Hola' }];
    }

    // Llamada real a Groq
    const groqRes = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: groqModel,
        messages: mensajesParaGroq,
        max_tokens: req.body.max_tokens || 2048,
        temperature: req.body.temperature ?? 0.7,
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.json().catch(() => ({}));
      console.error('Error Groq:', err);
      return res.status(groqRes.status).json({ error: err.error?.message || 'Error al llamar a Groq' });
    }

    const groqData = await groqRes.json();
    const respuesta = groqData.choices?.[0]?.message?.content || '';
    const usage = groqData.usage || {};

    // Persistir en memoria del agente si aplica
    if (agentId && userMessage?.content) {
      db.prepare('INSERT INTO agent_memory (id, agente_id, user_id, role, content) VALUES (?, ?, ?, ?, ?)')
        .run(uuidv4(), agentId, req.auth.sub, 'user', String(userMessage.content));
      db.prepare('INSERT INTO agent_memory (id, agente_id, user_id, role, content) VALUES (?, ?, ?, ?, ?)')
        .run(uuidv4(), agentId, req.auth.sub, 'assistant', respuesta);
    }

    // Registrar uso
    if (usage.total_tokens) {
      db.prepare('INSERT INTO usage_log (id, user_id, amount, kind, description) VALUES (?, ?, ?, ?, ?)')
        .run(uuidv4(), req.auth.sub, usage.total_tokens * 0.000001, 'gasto', `Groq ${groqModel}`);
    }

    res.json({
      choices: groqData.choices,
      usage: {
        input_tokens: usage.prompt_tokens || 0,
        output_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0,
      },
      model: groqModel,
    });

  } catch (err) {
    console.error('Error inferencia:', err);
    res.status(500).json({ error: 'Error interno al procesar la solicitud' });
  }
});

// ─── Selección de modelo activo ────────────────────────────────────────────────
app.put('/api/user/modelo', authMiddleware, (req, res) => {
  const { modelo } = req.body || {};
  if (!MODELOS_VALIDOS.includes(modelo)) return res.status(400).json({ error: 'Modelo no válido' });

  db.prepare('UPDATE users SET modelo_activo = ? WHERE id = ?').run(modelo, req.auth.sub);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ user: publicUser(user) });
});

// ─── Memoria persistente por agente ─────────────────────────────────────────────
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

// ─── Claves de API ──────────────────────────────────────────────────────────────
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

// ─── Recursos genéricos ─────────────────────────────────────────────────────────
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

// ─── Facturación / uso real ─────────────────────────────────────────────────────
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

// ─── Ollama ──────────────────────────────────────────────────────────────────────
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

// ─── Admin: listar clientes ─────────────────────────────────────────────────────
app.get('/admin/clientes', authMiddleware, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, email, nombre, is_admin, is_support, creditos, activo, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users.map(publicUser));
});

// ─── Admin: editar un cliente ───────────────────────────────────────────────────
app.put('/admin/clientes/:id', authMiddleware, requireAdmin, (req, res) => {
  const target = getUserOr404(req.params.id, res);
  if (!target) return;

  const { creditos, activo, isAdmin, isSupport, nombre } = req.body || {};
  const newCreditos = creditos !== undefined ? Number(creditos) : target.creditos;
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

// ─── Servir el frontend ──────────────────────────────────────────────────────────
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
