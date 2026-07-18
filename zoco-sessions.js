// zoco-sessions.js
//
// Módulo del backend que completa la experiencia "consola profesional"
// (estilo platform.claude.com) sobre la base existente de Zoco IA, sin
// tocar el diseño del Dashboard: solo añade las piezas de servidor que
// el frontend necesita para que cada sección del menú lateral funcione
// de verdad y todo quede conectado.
//
// Aporta 4 bloques, todos aditivos (IF NOT EXISTS, rutas nuevas):
//   1) SESIONES  — conversaciones persistentes en servidor (como claude.ai):
//        título, agente, modelo, mensajes, archivos adjuntos y habilidades
//        activas por conversación. CRUD completo + envío de mensajes.
//   2) ARCHIVOS  — subida de archivos de texto (base64 o texto plano) que
//        pueden adjuntarse como contexto a cualquier sesión/mensaje.
//   3) HABILIDADES por chat — activación dinámica de tools por conversación.
//   4) ALMACÉN DE CREDENCIALES — valida, guarda (cifrada AES-256-GCM) y
//        expone la API Key de Zoco IA hacia los agentes del pipeline.
//
// No abre su propia conexión a la base de datos: server.js le pasa `db`.

import crypto from 'crypto';

// ── Tablas aditivas ──────────────────────────────────────────────────────
export function ensureSessionTables(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'Nueva conversación',
        agent_id TEXT,
        model TEXT DEFAULT 'zoco-plus',
        attached_file_ids TEXT DEFAULT '[]',
        active_skill_ids TEXT DEFAULT '[]',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chat_session_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        attachments_json TEXT DEFAULT '[]',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_session_msgs ON chat_session_messages(session_id, created_at ASC);
    `);
  } catch (err) {
    console.error('⚠️  [zoco-sessions] No se pudieron crear las tablas de sesiones:', err.message);
  }
}

// ── Cifrado de credenciales (AES-256-GCM) ────────────────────────────────
// La clave de cifrado se deriva del secreto del servidor: las credenciales
// guardadas nunca viajan ni se almacenan en claro.
function deriveKey(secret) {
  return crypto.createHash('sha256').update(`zoco-credential-store:${secret}`).digest();
}

export function encryptSecret(plain, serverSecret) {
  const key = deriveKey(serverSecret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(payload, serverSecret) {
  try {
    const [v, ivB64, tagB64, dataB64] = String(payload).split(':');
    if (v !== 'v1') return null;
    const key = deriveKey(serverSecret);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function maskKey(key) {
  const k = String(key || '');
  if (k.length <= 14) return `${k.slice(0, 4)}${'•'.repeat(8)}`;
  return `${k.slice(0, 14)}${'•'.repeat(12)}${k.slice(-4)}`;
}

// Valida el formato y la autenticidad de una API Key de Zoco IA contra la
// tabla api_keys (hash sha256, no revocada). Devuelve el registro si es válida.
export function validateZocoApiKey(db, rawKey) {
  const key = String(rawKey || '').trim();
  if (!/^sk-zoco-[a-f0-9]{24,64}$/i.test(key)) {
    return { valid: false, reason: 'Formato inválido: las claves de Zoco IA empiezan por sk-zoco-' };
  }
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const row = db.prepare('SELECT id, user_id, name, revoked FROM api_keys WHERE key_hash = ?').get(hash);
  if (!row) return { valid: false, reason: 'La clave no existe en esta organización de Zoco IA' };
  if (row.revoked) return { valid: false, reason: 'La clave está revocada' };
  return { valid: true, keyId: row.id, keyName: row.name, ownerId: row.user_id };
}

// ── Contexto de archivos y habilidades para el chat ─────────────────────
// Materializa los archivos adjuntos de una sesión como bloque de contexto
// que se inyecta en el system prompt (mismo patrón que el "context window"
// de archivos de claude.ai).
export function buildFilesContext(db, userId, fileIds) {
  if (!Array.isArray(fileIds) || fileIds.length === 0) return '';
  const bloques = [];
  for (const fid of fileIds.slice(0, 10)) {
    const row = db.prepare("SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = 'archivo'").get(fid, userId);
    if (!row) continue;
    const data = JSON.parse(row.data || '{}');
    const contenido = String(data.content || data.valor || '').slice(0, 24000);
    if (!contenido.trim()) continue;
    bloques.push(`<archivo nombre="${row.name}">\n${contenido}\n</archivo>`);
  }
  if (!bloques.length) return '';
  return `\n\n[ARCHIVOS DE CONTEXTO ADJUNTOS POR EL USUARIO]\n${bloques.join('\n\n')}\n[FIN DE ARCHIVOS ADJUNTOS]\nUsa estos archivos como contexto para responder.`;
}

// Resuelve las habilidades activas de una sesión a: tools permitidas +
// flags de comportamiento (búsqueda web) + credenciales asociadas.
export function resolveActiveSkills(db, userId, skillIds) {
  const result = { allowedTools: [], busquedaWeb: false, notas: [] };
  if (!Array.isArray(skillIds) || skillIds.length === 0) return result;
  for (const sid of skillIds.slice(0, 20)) {
    const row = db.prepare("SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = 'habilidad'").get(sid, userId);
    if (!row) continue;
    const data = JSON.parse(row.data || '{}');
    const nombre = row.name.toLowerCase();
    // Mapeo de habilidades por nombre/config a capacidades reales del motor.
    if (Array.isArray(data.allowedTools)) result.allowedTools.push(...data.allowedTools);
    if (data.busquedaWeb || /b[uú]squeda|search|web/.test(nombre)) result.busquedaWeb = true;
    if (/archivo|file|workspace|c[oó]digo/.test(nombre)) result.allowedTools.push('leer_archivo', 'escribir_archivo', 'listar_archivos');
    result.notas.push(row.name);
  }
  result.allowedTools = [...new Set(result.allowedTools)];
  return result;
}

// ── Registro de rutas ────────────────────────────────────────────────────
export function registerSessionRoutes({ app, db, authMiddleware, uuidv4, serverSecret, processChatCompletion }) {
  ensureSessionTables(db);

  const sesionPublica = (s) => ({
    id: s.id,
    title: s.title,
    agentId: s.agent_id,
    model: s.model,
    attachedFileIds: JSON.parse(s.attached_file_ids || '[]'),
    activeSkillIds: JSON.parse(s.active_skill_ids || '[]'),
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  });

  // ── 1) SESIONES (conversaciones persistentes estilo claude.ai) ────────
  app.get('/api/sesiones', authMiddleware, (req, res) => {
    const rows = db.prepare('SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200').all(req.auth.sub);
    // último mensaje como preview, igual que la lista de chats de claude.ai
    const withPreview = rows.map(s => {
      const last = db.prepare('SELECT content, role, created_at FROM chat_session_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(s.id);
      const count = db.prepare('SELECT COUNT(*) AS n FROM chat_session_messages WHERE session_id = ?').get(s.id).n;
      return { ...sesionPublica(s), preview: last ? String(last.content).slice(0, 120) : '', messageCount: count };
    });
    res.json(withPreview);
  });

  app.post('/api/sesiones', authMiddleware, (req, res) => {
    const { title, agentId, model, attachedFileIds, activeSkillIds } = req.body || {};
    const id = uuidv4();
    db.prepare(`
      INSERT INTO chat_sessions (id, user_id, title, agent_id, model, attached_file_ids, active_skill_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, req.auth.sub,
      (title && String(title).trim()) || 'Nueva conversación',
      agentId || null,
      model || 'zoco-plus',
      JSON.stringify(Array.isArray(attachedFileIds) ? attachedFileIds : []),
      JSON.stringify(Array.isArray(activeSkillIds) ? activeSkillIds : []),
    );
    const row = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);
    res.status(201).json(sesionPublica(row));
  });

  app.get('/api/sesiones/:id', authMiddleware, (req, res) => {
    const s = db.prepare('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
    if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });
    const mensajes = db.prepare('SELECT id, role, content, attachments_json, created_at FROM chat_session_messages WHERE session_id = ? ORDER BY created_at ASC').all(s.id)
      .map(m => ({ id: m.id, role: m.role, content: m.content, attachments: JSON.parse(m.attachments_json || '[]'), createdAt: m.created_at }));
    res.json({ ...sesionPublica(s), mensajes });
  });

  app.put('/api/sesiones/:id', authMiddleware, (req, res) => {
    const s = db.prepare('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
    if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });
    const { title, agentId, model, attachedFileIds, activeSkillIds } = req.body || {};
    db.prepare(`
      UPDATE chat_sessions SET
        title = ?, agent_id = ?, model = ?, attached_file_ids = ?, active_skill_ids = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      (title && String(title).trim()) || s.title,
      agentId !== undefined ? (agentId || null) : s.agent_id,
      model || s.model,
      attachedFileIds !== undefined ? JSON.stringify(attachedFileIds) : s.attached_file_ids,
      activeSkillIds !== undefined ? JSON.stringify(activeSkillIds) : s.active_skill_ids,
      s.id,
    );
    const updated = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(s.id);
    res.json(sesionPublica(updated));
  });

  app.delete('/api/sesiones/:id', authMiddleware, (req, res) => {
    const s = db.prepare('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
    if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });
    db.prepare('DELETE FROM chat_session_messages WHERE session_id = ?').run(s.id);
    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(s.id);
    res.json({ ok: true });
  });

  // Enviar un mensaje dentro de una sesión: persiste usuario+asistente,
  // inyecta archivos adjuntos como contexto y aplica las habilidades activas.
  app.post('/api/sesiones/:id/mensajes', authMiddleware, async (req, res) => {
    try {
      const s = db.prepare('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
      if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });

      const { message, attachments, skills } = req.body || {};
      if (!message || !String(message).trim()) return res.status(400).json({ error: 'El mensaje es obligatorio' });

      // Adjuntos/habilidades del mensaje: se fusionan con los de la sesión
      // (mismo modelo mental que claude.ai: el clip añade contexto al hilo).
      const sessionFiles = JSON.parse(s.attached_file_ids || '[]');
      const sessionSkills = JSON.parse(s.active_skill_ids || '[]');
      const fileIds = [...new Set([...sessionFiles, ...(Array.isArray(attachments) ? attachments : [])])];
      const skillIds = [...new Set([...sessionSkills, ...(Array.isArray(skills) ? skills : [])])];

      // Persistir la fusión para que el hilo recuerde sus adjuntos.
      db.prepare('UPDATE chat_sessions SET attached_file_ids = ?, active_skill_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(JSON.stringify(fileIds), JSON.stringify(skillIds), s.id);

      // Historial del hilo (últimos 30 mensajes).
      const historial = db.prepare('SELECT role, content FROM chat_session_messages WHERE session_id = ? ORDER BY created_at ASC').all(s.id).slice(-30);

      const filesContext = buildFilesContext(db, req.auth.sub, fileIds);
      const skillsInfo = resolveActiveSkills(db, req.auth.sub, skillIds);

      const mensajes = [];
      if (filesContext || skillsInfo.notas.length) {
        const habilidadesTxt = skillsInfo.notas.length
          ? `\n[HABILIDADES ACTIVAS EN ESTA CONVERSACIÓN: ${skillsInfo.notas.join(', ')}]`
          : '';
        mensajes.push({ role: 'system', content: `Eres Zoco IA, asistente profesional.${habilidadesTxt}${filesContext}` });
      }
      historial.forEach(m => mensajes.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
      mensajes.push({ role: 'user', content: String(message) });

      const result = await processChatCompletion(req.auth.sub, {
        agentId: s.agent_id || undefined,
        messages: mensajes,
        model: s.model,
        sessionSkills: skillsInfo, // habilidades dinámicas por conversación
      });

      const respuesta = result.choices?.[0]?.message?.content || '';

      const userMsgId = uuidv4();
      const asstMsgId = uuidv4();
      db.prepare('INSERT INTO chat_session_messages (id, session_id, role, content, attachments_json) VALUES (?, ?, ?, ?, ?)')
        .run(userMsgId, s.id, 'user', String(message), JSON.stringify(Array.isArray(attachments) ? attachments : []));
      db.prepare('INSERT INTO chat_session_messages (id, session_id, role, content, attachments_json) VALUES (?, ?, ?, ?, ?)')
        .run(asstMsgId, s.id, 'assistant', respuesta, '[]');

      // Autotitular la conversación con el primer mensaje (como claude.ai).
      if (s.title === 'Nueva conversación') {
        const titulo = String(message).slice(0, 60).replace(/\s+/g, ' ').trim();
        db.prepare('UPDATE chat_sessions SET title = ? WHERE id = ?').run(titulo || s.title, s.id);
      }
      db.prepare('UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(s.id);

      res.json({ response: respuesta, usage: result.usage, model: result.model, sessionId: s.id });
    } catch (err) {
      console.error('Error en /api/sesiones/:id/mensajes:', err);
      const status = err.status || 500;
      res.status(status).json({ error: err.message || 'Error interno', ...(err.code ? { code: err.code } : {}) });
    }
  });

  // ── 2) ARCHIVOS: subida de contenido real ─────────────────────────────
  // Acepta { name, content } (texto plano) o { name, contentBase64 }.
  // Se guarda como recurso type=archivo con data.content, reutilizando el
  // CRUD de recursos ya existente para listado/borrado.
  app.post('/api/archivos/upload', authMiddleware, (req, res) => {
    const { name, content, contentBase64, mimeType } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre del archivo es obligatorio' });

    let texto = '';
    if (typeof content === 'string') {
      texto = content;
    } else if (typeof contentBase64 === 'string') {
      try { texto = Buffer.from(contentBase64, 'base64').toString('utf8'); }
      catch { return res.status(400).json({ error: 'contentBase64 no es válido' }); }
    } else {
      return res.status(400).json({ error: 'Falta el contenido del archivo (content o contentBase64)' });
    }

    const MAX_CHARS = 200_000;
    if (texto.length > MAX_CHARS) texto = texto.slice(0, MAX_CHARS);

    const id = uuidv4();
    db.prepare("INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, 'archivo', ?, ?)")
      .run(id, req.auth.sub, String(name).trim(), JSON.stringify({
        content: texto,
        mimeType: mimeType || 'text/plain',
        size: texto.length,
        uploadedAt: new Date().toISOString(),
      }));
    res.status(201).json({ id, name: String(name).trim(), size: texto.length });
  });

  // ── 4) ALMACÉN DE CREDENCIALES Zoco IA ─────────────────────────────────
  // Valida una API Key de Zoco IA y la guarda cifrada como recurso
  // type=credencial. Los agentes la consumen vía getZocoCredential().
  app.post('/api/credenciales/validar', authMiddleware, (req, res) => {
    const { apiKey } = req.body || {};
    const check = validateZocoApiKey(db, apiKey);
    res.json({ valid: check.valid, reason: check.reason || null, keyName: check.keyName || null });
  });

  app.post('/api/credenciales/zoco', authMiddleware, (req, res) => {
    const { name, apiKey } = req.body || {};
    const check = validateZocoApiKey(db, apiKey);
    if (!check.valid) return res.status(400).json({ error: `Clave no válida: ${check.reason}` });

    const encrypted = encryptSecret(String(apiKey).trim(), serverSecret);
    const display = maskKey(apiKey);

    // Una sola credencial "principal" de Zoco IA por usuario: upsert.
    const existente = db.prepare("SELECT id FROM resources WHERE user_id = ? AND type = 'credencial' AND json_extract(data, '$.provider') = 'zoco-ia'").get(req.auth.sub);
    const data = JSON.stringify({
      provider: 'zoco-ia',
      encrypted,
      display,
      keyName: check.keyName,
      validatedAt: new Date().toISOString(),
      status: 'valida',
    });
    if (existente) {
      db.prepare('UPDATE resources SET name = ?, data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run((name && String(name).trim()) || 'API Key Zoco IA', data, existente.id);
      return res.json({ id: existente.id, display, status: 'valida', updated: true });
    }
    const id = uuidv4();
    db.prepare("INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, 'credencial', ?, ?)")
      .run(id, req.auth.sub, (name && String(name).trim()) || 'API Key Zoco IA', data);
    res.status(201).json({ id, display, status: 'valida', updated: false });
  });
}

// Expone (descifrada, solo en servidor) la credencial Zoco IA de un usuario
// para que los agentes del pipeline firmen sus llamadas internas. Nunca se
// envía al navegador.
export function getZocoCredential(db, userId, serverSecret) {
  const row = db.prepare("SELECT data FROM resources WHERE user_id = ? AND type = 'credencial' AND json_extract(data, '$.provider') = 'zoco-ia'").get(userId);
  if (!row) return null;
  const data = JSON.parse(row.data || '{}');
  if (!data.encrypted) return null;
  return decryptSecret(data.encrypted, serverSecret);
}
