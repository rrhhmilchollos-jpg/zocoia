// zoco-sessions.js
// -----------------------------------------------------------------------------
// Archivo que faltaba en el repo pero que server.js ya importa y usa:
//   import { registerSessionRoutes, validateZocoApiKey } from './zoco-sessions.js';
//
// validateZocoApiKey() es la pieza CRÍTICA: sin ella, cualquier petición
// autenticada con una API Key "sk-zoco-..." (incluido Maris AI apuntando a
// esta base URL) falla en authMiddleware. Su contrato se dedujo 100% de cómo
// la usa server.js:
//
//   const check = validateZocoApiKey(db, token);
//   if (!check.valid) ... `API Key inválida: ${check.reason}`
//   const keyRow = db.prepare('... FROM api_keys WHERE id = ?').get(check.keyId);
//   const owner  = db.prepare('... FROM users WHERE id = ?').get(check.ownerId);
//
// registerSessionRoutes() no tiene ningún consumidor confirmado en el
// frontend (no encontré llamadas a /api/sessions/* desde el Dashboard), así
// que su forma exacta es una propuesta razonable siguiendo el resto del
// patrón del repo (resources, agent_memory, etc.), no una migración 1:1 de
// nada existente. Revisa las rutas y ajusta nombres/payloads si tu frontend
// espera algo distinto.
// -----------------------------------------------------------------------------

import crypto from 'crypto';

// ─── Validación de API Keys de Zoco IA (sk-zoco-...) ────────────────────────
// Misma lógica de hash que /api/keys en server.js: la clave completa nunca
// se guarda en claro, solo su sha256. Se compara ese hash contra key_hash.
export function validateZocoApiKey(db, token) {
  if (!token || typeof token !== 'string' || !token.startsWith('sk-zoco-')) {
    return { valid: false, reason: 'formato de clave no reconocido' };
  }

  const keyHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.prepare('SELECT id, user_id, revoked FROM api_keys WHERE key_hash = ?').get(keyHash);

  if (!row) return { valid: false, reason: 'clave no encontrada' };
  if (row.revoked) return { valid: false, reason: 'clave revocada' };

  return { valid: true, keyId: row.id, ownerId: row.user_id };
}

// ─── Tablas propias de sesiones persistentes + archivos adjuntos ───────────
function ensureSessionTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Nueva sesión',
      agent_id TEXT,
      skills TEXT DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS session_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
    );

    CREATE TABLE IF NOT EXISTS session_files (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
    );
  `);
}

function safeParseJSON(text, fallback = {}) {
  try { return JSON.parse(text || '{}'); } catch { return fallback; }
}

function publicSession(row) {
  return {
    id: row.id,
    name: row.name,
    agentId: row.agent_id || null,
    skills: safeParseJSON(row.skills),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Rutas: Sesiones persistentes + Archivos + Credenciales ────────────────
export function registerSessionRoutes({ app, db, authMiddleware, uuidv4, serverSecret, processChatCompletion }) {
  ensureSessionTables(db);

  // — Sesiones —
  app.get('/api/sessions', authMiddleware, (req, res) => {
    const rows = db.prepare('SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC').all(req.auth.sub);
    res.json(rows.map(publicSession));
  });

  app.post('/api/sessions', authMiddleware, (req, res) => {
    const { name, agentId, skills } = req.body || {};
    const id = uuidv4();
    db.prepare('INSERT INTO chat_sessions (id, user_id, name, agent_id, skills) VALUES (?, ?, ?, ?, ?)')
      .run(id, req.auth.sub, (name && name.trim()) || 'Nueva sesión', agentId || null, JSON.stringify(skills || {}));
    const row = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);
    res.status(201).json(publicSession(row));
  });

  app.get('/api/sessions/:id', authMiddleware, (req, res) => {
    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

    const mensajes = db.prepare('SELECT id, role, content, created_at FROM session_messages WHERE session_id = ? ORDER BY created_at ASC').all(session.id);
    const archivos = db.prepare('SELECT id, filename, created_at FROM session_files WHERE session_id = ? ORDER BY created_at ASC').all(session.id);

    res.json({ ...publicSession(session), mensajes, archivos });
  });

  app.put('/api/sessions/:id', authMiddleware, (req, res) => {
    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

    const { name, agentId, skills } = req.body || {};
    const newName = (name && name.trim()) || session.name;
    const newAgentId = agentId !== undefined ? agentId : session.agent_id;
    const newSkills = skills !== undefined ? JSON.stringify(skills) : session.skills;

    db.prepare('UPDATE chat_sessions SET name = ?, agent_id = ?, skills = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(newName, newAgentId, newSkills, session.id);

    const updated = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(session.id);
    res.json(publicSession(updated));
  });

  app.delete('/api/sessions/:id', authMiddleware, (req, res) => {
    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

    db.prepare('DELETE FROM session_messages WHERE session_id = ?').run(session.id);
    db.prepare('DELETE FROM session_files WHERE session_id = ?').run(session.id);
    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(session.id);
    res.json({ ok: true });
  });

  // Enviar un mensaje dentro de una sesión: reutiliza processChatCompletion
  // (misma fuente de verdad de créditos/agente/Ollama que /api/chat), con el
  // historial de la sesión y las habilidades activas guardadas en ella.
  app.post('/api/sessions/:id/mensajes', authMiddleware, async (req, res) => {
    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

    const { message } = req.body || {};
    if (!message || !String(message).trim()) return res.status(400).json({ error: 'El mensaje es obligatorio' });

    try {
      const historial = db.prepare('SELECT role, content FROM session_messages WHERE session_id = ? ORDER BY created_at ASC').all(session.id);
      const archivos = db.prepare('SELECT filename, content FROM session_files WHERE session_id = ?').all(session.id);

      let messages = historial.map(m => ({ role: m.role, content: m.content }));
      if (archivos.length > 0) {
        const contexto = archivos.map(f => `--- ${f.filename} ---\n${f.content}`).join('\n\n');
        messages = [{ role: 'system', content: `Archivos de contexto adjuntos a esta sesión:\n\n${contexto}` }, ...messages];
      }
      messages.push({ role: 'user', content: String(message) });

      const result = await processChatCompletion(req.auth.sub, {
        agentId: session.agent_id || undefined,
        messages,
        sessionSkills: safeParseJSON(session.skills),
        apiKeyId: req.auth.viaApiKey ? req.auth.apiKeyId : undefined,
        apiKeyType: req.auth.viaApiKey ? req.auth.apiKeyType : undefined,
      });

      const respuesta = result.choices?.[0]?.message?.content || '';

      db.prepare('INSERT INTO session_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), session.id, 'user', String(message));
      db.prepare('INSERT INTO session_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), session.id, 'assistant', respuesta);
      db.prepare('UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(session.id);

      res.json({ response: respuesta, usage: result.usage, model: result.model });
    } catch (err) {
      console.error('Error en /api/sessions/:id/mensajes:', err);
      const status = err.status || 500;
      res.status(status).json({ error: err.message || 'Error interno al procesar el mensaje', ...(err.code ? { code: err.code } : {}) });
    }
  });

  // — Archivos de contexto adjuntos a una sesión —
  app.post('/api/sessions/:id/archivos', authMiddleware, (req, res) => {
    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

    const { filename, content } = req.body || {};
    if (!filename || !content) return res.status(400).json({ error: 'filename y content son obligatorios' });

    const id = uuidv4();
    db.prepare('INSERT INTO session_files (id, session_id, filename, content) VALUES (?, ?, ?, ?)')
      .run(id, session.id, String(filename), String(content));
    res.status(201).json({ id, filename: String(filename) });
  });

  app.delete('/api/sessions/:id/archivos/:fileId', authMiddleware, (req, res) => {
    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });
    db.prepare('DELETE FROM session_files WHERE id = ? AND session_id = ?').run(req.params.fileId, session.id);
    res.json({ ok: true });
  });

  // — Almacén de credenciales —
  // Reutiliza la tabla `resources` (type='credencial') que server.js YA lee
  // directamente en varios sitios (TAVILY_API_KEY, E2B_API_KEY: busca
  // resources con type IN ('credencial','habilidad') y name=<clave>, y hace
  // JSON.parse(data).valor). Por eso aquí se guarda en el mismo formato
  // { valor: '...' } sin cifrar — si en el futuro quieres cifrar en reposo
  // con `serverSecret`, hazlo también en los puntos de lectura de server.js,
  // o ambos dejan de entenderse entre sí.
  app.get('/api/credenciales', authMiddleware, (req, res) => {
    const rows = db.prepare("SELECT id, name, created_at FROM resources WHERE user_id = ? AND type = 'credencial' ORDER BY created_at DESC").all(req.auth.sub);
    res.json(rows); // nunca se devuelve el valor, solo nombre/id
  });

  app.post('/api/credenciales', authMiddleware, (req, res) => {
    const { name, valor } = req.body || {};
    if (!name || !name.trim() || !valor) return res.status(400).json({ error: 'name y valor son obligatorios' });

    const existing = db.prepare("SELECT id FROM resources WHERE user_id = ? AND type = 'credencial' AND name = ?").get(req.auth.sub, name.trim());
    if (existing) {
      db.prepare('UPDATE resources SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(JSON.stringify({ valor }), existing.id);
      return res.json({ ok: true, id: existing.id, name: name.trim() });
    }

    const id = uuidv4();
    db.prepare('INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, ?, ?, ?)')
      .run(id, req.auth.sub, 'credencial', name.trim(), JSON.stringify({ valor }));
    res.status(201).json({ ok: true, id, name: name.trim() });
  });

  app.delete('/api/credenciales/:id', authMiddleware, (req, res) => {
    const row = db.prepare("SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = 'credencial'").get(req.params.id, req.auth.sub);
    if (!row) return res.status(404).json({ error: 'Credencial no encontrada' });
    db.prepare('DELETE FROM resources WHERE id = ?').run(row.id);
    res.json({ ok: true });
  });
}
