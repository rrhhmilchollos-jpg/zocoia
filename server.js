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

// JWT_SECRET: en produccion SIEMPRE debe venir de una variable de entorno.
// Si no está definida, generamos una aleatoria en cada arranque (las sesiones
// se invalidarán al reiniciar). Ponla en Railway como JWT_SECRET.
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET no está definido. Usando uno temporal generado al vuelo.');
  console.warn('   Configura JWT_SECRET en las variables de entorno de Railway para producción.');
}
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
const JWT_EXPIRES_IN = '7d';
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

// En Railway con volumen persistente, el volumen se monta en /data
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
`);

// ─── Sembrado de la cuenta de administracion ──────────────────────────────────
// Nunca hardcodeamos el email/contraseña de admin en el código: se leen de
// variables de entorno (ADMIN_EMAIL / ADMIN_PASSWORD) que configuras en Railway,
// NUNCA en el repositorio de GitHub.
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

// ─── Utilidades ────────────────────────────────────────────────────────────────
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
    createdAt: user.created_at,
  };
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

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ─── Rutas de salud / existentes ────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Zoco IA conectado con éxito' });
});

app.post('/v1/chat/completions', authMiddleware, (req, res) => {
  res.json({
    choices: [{
      message: {
        role: 'assistant',
        content: 'Conexión en vivo completada desde el servidor de Zoco IA.',
      },
    }],
  });
});

// ─── Autenticación: registro ────────────────────────────────────────────────────
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

// ─── Autenticación: login ───────────────────────────────────────────────────────
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

// ─── Autenticación: usuario actual ──────────────────────────────────────────────
app.get('/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ user: publicUser(user) });
});

// ─── Autenticación: olvidé mi contraseña ───────────────────────────────────────
// Por seguridad, la respuesta es siempre la misma exista o no el email,
// para no revelar qué correos están registrados.
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
    // Sin proveedor de email configurado: lo dejamos en el log del servidor
    // para que puedas probarlo en desarrollo.
    console.log(`🔗 Enlace de recuperación para ${user.email}: ${resetLink}`);
  }

  res.json(genericResponse);
});

// ─── Autenticación: restablecer contraseña ─────────────────────────────────────
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

// ─── Envío de email (opcional, vía Resend) ─────────────────────────────────────
// Si defines RESEND_API_KEY en Railway, los emails de recuperación se envían
// de verdad. Si no, el enlace se imprime en los logs del servidor (modo dev).
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

// ─── Admin: listar clientes (protegido) ────────────────────────────────────────
app.get('/admin/clientes', authMiddleware, (req, res) => {
  if (!req.auth.isAdmin && !req.auth.isSupport) return res.status(403).json({ error: 'No autorizado' });
  const users = db.prepare('SELECT id, email, nombre, is_admin, is_support, creditos, activo, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

app.listen(port, () => {
  console.log(`🚀 Zoco IA Console corriendo en puerto ${port}`);
});
