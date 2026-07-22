// zoco-console.js
//
// Los 4 flujos especializados de la consola de Zoco IA (estilo consola de
// Anthropic), conectados al motor local de Ollama y a los ejecutores reales:
//
//   1. LOTES (Batches): crear un lote con N peticiones → cola de procesamiento
//      en segundo plano contra el motor Ollama → estados por petición →
//      descarga de resultados en JSONL. Equivalente al Message Batches API.
//   2. IMPLEMENTACIONES (Deployments): panel real de despliegues conectado a
//      las APIs de Railway (GraphQL) y Vercel, reutilizando la configuración
//      del Agente DevOps determinista.
//   3. ENTORNOS (Environments): variables por entorno (desarrollo/producción)
//      que se inyectan como contexto operativo en las llamadas de chat cuando
//      el entorno está activo.
//   4. ALMACENES DE MEMORIA: búsqueda global sobre la memoria de todos los
//      agentes (texto + relevancia), con estadísticas por almacén.
//
// El módulo se registra desde server.js con registerConsoleRoutes({...}).

export function ensureConsoleTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      agent_id TEXT,
      model TEXT NOT NULL DEFAULT 'zoco-plus',
      title TEXT NOT NULL DEFAULT 'Nueva conversación',
      preview TEXT DEFAULT '',
      message_count INTEGER NOT NULL DEFAULT 0,
      attached_file_ids TEXT NOT NULL DEFAULT '[]',
      active_skill_ids TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS session_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      attachments TEXT NOT NULL DEFAULT '[]',
      skills TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages (session_id, created_at);
    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'normal',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS support_messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      is_staff INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '[]',
      secret TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      last_triggered_at INTEGER,
      last_status INTEGER,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Lote sin nombre',
      status TEXT NOT NULL DEFAULT 'queued',
      model TEXT,
      agent_id TEXT,
      total INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      finished_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS batch_requests (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      custom_id TEXT,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      result TEXT,
      error TEXT,
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_batch_requests_batch ON batch_requests (batch_id, idx);
    CREATE TABLE IF NOT EXISTS environments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'development',
      active INTEGER NOT NULL DEFAULT 0,
      variables TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS deployments_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      target_id TEXT,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. LOTES — cola de procesamiento secuencial contra el motor Ollama.
//    Concurrencia 1 (amable con un servidor local: los modelos comparten
//    VRAM) y reanudación de lotes interrumpidos al arrancar el servidor.
// ─────────────────────────────────────────────────────────────────────────────

const activeBatchWorkers = new Set();

async function processBatch(db, batchId, processChatCompletion) {
  if (activeBatchWorkers.has(batchId)) return;
  activeBatchWorkers.add(batchId);
  try {
    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
    if (!batch || batch.status === 'completed' || batch.status === 'cancelled') return;
    db.prepare(`UPDATE batches SET status = 'processing' WHERE id = ?`).run(batchId);

    const pending = db.prepare(
      `SELECT * FROM batch_requests WHERE batch_id = ? AND status = 'queued' ORDER BY idx ASC`
    ).all(batchId);

    for (const reqRow of pending) {
      // Releer el estado por si el usuario canceló el lote a mitad.
      const current = db.prepare('SELECT status FROM batches WHERE id = ?').get(batchId);
      if (!current || current.status === 'cancelled') break;
      try {
        const out = await processChatCompletion(batch.user_id, {
          agentId: batch.agent_id || undefined,
          model: batch.model || undefined,
          messages: [{ role: 'user', content: reqRow.prompt }],
        });
        const text = out?.choices?.[0]?.message?.content ?? out?.response ?? '';
        db.prepare(`UPDATE batch_requests SET status = 'completed', result = ?, finished_at = ? WHERE id = ?`)
          .run(String(text), Date.now(), reqRow.id);
        db.prepare(`UPDATE batches SET completed = completed + 1 WHERE id = ?`).run(batchId);
      } catch (err) {
        db.prepare(`UPDATE batch_requests SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`)
          .run(String(err.message || err), Date.now(), reqRow.id);
        db.prepare(`UPDATE batches SET failed = failed + 1 WHERE id = ?`).run(batchId);
      }
    }

    const final = db.prepare('SELECT status FROM batches WHERE id = ?').get(batchId);
    if (final && final.status !== 'cancelled') {
      db.prepare(`UPDATE batches SET status = 'completed', finished_at = ? WHERE id = ?`).run(Date.now(), batchId);
    }
  } finally {
    activeBatchWorkers.delete(batchId);
  }
}

export function resumeInterruptedBatches(db, processChatCompletion) {
  try {
    const stuck = db.prepare(`SELECT id FROM batches WHERE status IN ('queued','processing')`).all();
    for (const b of stuck) {
      console.log(`[zoco-console] Reanudando lote interrumpido ${b.id}...`);
      processBatch(db, b.id, processChatCompletion).catch(err =>
        console.error(`[zoco-console] Error reanudando lote ${b.id}:`, err.message));
    }
  } catch (err) {
    console.error('[zoco-console] No se pudieron reanudar lotes:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Registro de rutas
// ─────────────────────────────────────────────────────────────────────────────

export function registerConsoleRoutes({ app, db, authMiddleware, uuidv4, processChatCompletion }) {
  ensureConsoleTables(db);

  // ══ LOTES ══════════════════════════════════════════════════════════════

  app.get('/api/lotes', authMiddleware, (req, res) => {
    const lotes = db.prepare(
      `SELECT id, name, status, model, agent_id, total, completed, failed, created_at, finished_at
       FROM batches WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`
    ).all(req.auth.sub);
    res.json(lotes);
  });

  // Crear lote: { name, model?, agentId?, requests: [{custom_id?, prompt}] }
  // También acepta texto JSONL en `jsonl` (una petición por línea, formato
  // {"custom_id":"x","prompt":"..."} — como los batches de Anthropic/OpenAI).
  app.post('/api/lotes', authMiddleware, (req, res) => {
    const { name, model, agentId, requests, jsonl } = req.body || {};
    let items = Array.isArray(requests) ? requests : [];
    if (!items.length && typeof jsonl === 'string' && jsonl.trim()) {
      const errors = [];
      items = jsonl.split('\n').map(l => l.trim()).filter(Boolean).map((line, i) => {
        try {
          const obj = JSON.parse(line);
          return { custom_id: obj.custom_id || `req-${i + 1}`, prompt: String(obj.prompt || obj.message || '') };
        } catch { errors.push(i + 1); return null; }
      }).filter(Boolean);
      if (errors.length) return res.status(400).json({ error: `Líneas JSONL inválidas: ${errors.join(', ')}` });
    }
    items = items.filter(it => it && String(it.prompt || '').trim());
    if (!items.length) return res.status(400).json({ error: 'El lote necesita al menos una petición con prompt' });
    if (items.length > 500) return res.status(400).json({ error: 'Máximo 500 peticiones por lote' });

    const batchId = uuidv4();
    const insertReq = db.prepare(
      `INSERT INTO batch_requests (id, batch_id, idx, custom_id, prompt) VALUES (?, ?, ?, ?, ?)`
    );
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO batches (id, user_id, name, model, agent_id, total) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(batchId, req.auth.sub, String(name || 'Lote sin nombre').slice(0, 120), model || null, agentId || null, items.length);
      items.forEach((it, i) =>
        insertReq.run(uuidv4(), batchId, i, String(it.custom_id || `req-${i + 1}`).slice(0, 64), String(it.prompt)));
    });
    tx();

    // Arrancar el worker en segundo plano (no bloquea la respuesta).
    processBatch(db, batchId, processChatCompletion).catch(err =>
      console.error(`[zoco-console] Error procesando lote ${batchId}:`, err.message));

    res.status(201).json({ id: batchId, status: 'queued', total: items.length });
  });

  app.get('/api/lotes/:id', authMiddleware, (req, res) => {
    const lote = db.prepare(`SELECT * FROM batches WHERE id = ? AND user_id = ?`).get(req.params.id, req.auth.sub);
    if (!lote) return res.status(404).json({ error: 'Lote no encontrado' });
    const requests = db.prepare(
      `SELECT id, idx, custom_id, prompt, status, result, error, finished_at
       FROM batch_requests WHERE batch_id = ? ORDER BY idx ASC`
    ).all(lote.id);
    res.json({ ...lote, requests });
  });

  // Descargar resultados en JSONL (como el results endpoint de los batches).
  app.get('/api/lotes/:id/resultados', authMiddleware, (req, res) => {
    const lote = db.prepare(`SELECT * FROM batches WHERE id = ? AND user_id = ?`).get(req.params.id, req.auth.sub);
    if (!lote) return res.status(404).json({ error: 'Lote no encontrado' });
    const rows = db.prepare(
      `SELECT custom_id, status, result, error FROM batch_requests WHERE batch_id = ? ORDER BY idx ASC`
    ).all(lote.id);
    const jsonl = rows.map(r => JSON.stringify({
      custom_id: r.custom_id, status: r.status,
      ...(r.status === 'completed' ? { result: r.result } : {}),
      ...(r.status === 'failed' ? { error: r.error } : {}),
    })).join('\n');
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="lote-${lote.id.slice(0, 8)}-resultados.jsonl"`);
    res.send(jsonl);
  });

  app.post('/api/lotes/:id/cancelar', authMiddleware, (req, res) => {
    const lote = db.prepare(`SELECT * FROM batches WHERE id = ? AND user_id = ?`).get(req.params.id, req.auth.sub);
    if (!lote) return res.status(404).json({ error: 'Lote no encontrado' });
    if (lote.status === 'completed') return res.status(400).json({ error: 'El lote ya está completado' });
    db.prepare(`UPDATE batches SET status = 'cancelled', finished_at = ? WHERE id = ?`).run(Date.now(), lote.id);
    res.json({ ok: true, status: 'cancelled' });
  });

  app.delete('/api/lotes/:id', authMiddleware, (req, res) => {
    const lote = db.prepare(`SELECT id, status FROM batches WHERE id = ? AND user_id = ?`).get(req.params.id, req.auth.sub);
    if (!lote) return res.status(404).json({ error: 'Lote no encontrado' });
    if (lote.status === 'processing') return res.status(400).json({ error: 'Cancela el lote antes de eliminarlo' });
    db.prepare(`DELETE FROM batch_requests WHERE batch_id = ?`).run(lote.id);
    db.prepare(`DELETE FROM batches WHERE id = ?`).run(lote.id);
    res.json({ ok: true });
  });

  // ══ ENTORNOS ═══════════════════════════════════════════════════════════

  app.get('/api/entornos', authMiddleware, (req, res) => {
    const rows = db.prepare(`SELECT * FROM environments WHERE user_id = ? ORDER BY created_at ASC`).all(req.auth.sub);
    res.json(rows.map(r => ({ ...r, variables: safeJson(r.variables) || {}, active: !!r.active })));
  });

  app.post('/api/entornos', authMiddleware, (req, res) => {
    const { name, kind, variables } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre del entorno es obligatorio' });
    const id = uuidv4();
    db.prepare(`INSERT INTO environments (id, user_id, name, kind, variables) VALUES (?, ?, ?, ?, ?)`)
      .run(id, req.auth.sub, String(name).trim().slice(0, 80),
           kind === 'production' ? 'production' : 'development',
           JSON.stringify(sanitizeVars(variables)));
    res.status(201).json({ id });
  });

  app.put('/api/entornos/:id', authMiddleware, (req, res) => {
    const env = db.prepare(`SELECT * FROM environments WHERE id = ? AND user_id = ?`).get(req.params.id, req.auth.sub);
    if (!env) return res.status(404).json({ error: 'Entorno no encontrado' });
    const { name, kind, variables, active } = req.body || {};
    // Solo un entorno activo a la vez (como seleccionar el environment en la consola).
    if (active === true) {
      db.prepare(`UPDATE environments SET active = 0 WHERE user_id = ?`).run(req.auth.sub);
    }
    db.prepare(`UPDATE environments SET name = ?, kind = ?, variables = ?, active = ? WHERE id = ?`)
      .run(
        name !== undefined ? String(name).trim().slice(0, 80) : env.name,
        kind !== undefined ? (kind === 'production' ? 'production' : 'development') : env.kind,
        variables !== undefined ? JSON.stringify(sanitizeVars(variables)) : env.variables,
        active !== undefined ? (active ? 1 : 0) : env.active,
        env.id,
      );
    res.json({ ok: true });
  });

  app.delete('/api/entornos/:id', authMiddleware, (req, res) => {
    const env = db.prepare(`SELECT id FROM environments WHERE id = ? AND user_id = ?`).get(req.params.id, req.auth.sub);
    if (!env) return res.status(404).json({ error: 'Entorno no encontrado' });
    db.prepare(`DELETE FROM environments WHERE id = ?`).run(env.id);
    res.json({ ok: true });
  });

  // ══ IMPLEMENTACIONES ═══════════════════════════════════════════════════
  // Conectadas a las APIs reales de Railway (GraphQL v2) y Vercel. El token
  // se toma de: variables del entorno ACTIVO del usuario (RAILWAY_TOKEN /
  // VERCEL_TOKEN) → variables de entorno del servidor. Cada acción queda
  // registrada en deployments_log.

  function resolveDeployToken(userId, provider) {
    const activeEnv = db.prepare(`SELECT variables FROM environments WHERE user_id = ? AND active = 1`).get(userId);
    const vars = activeEnv ? (safeJson(activeEnv.variables) || {}) : {};
    if (provider === 'railway') return vars.RAILWAY_TOKEN || process.env.RAILWAY_API_TOKEN || null;
    if (provider === 'vercel') return vars.VERCEL_TOKEN || process.env.VERCEL_API_TOKEN || null;
    return null;
  }

  app.get('/api/implementaciones', authMiddleware, (req, res) => {
    const logs = db.prepare(
      `SELECT * FROM deployments_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
    ).all(req.auth.sub);
    res.json({
      logs,
      railwayConfigured: !!resolveDeployToken(req.auth.sub, 'railway'),
      vercelConfigured: !!resolveDeployToken(req.auth.sub, 'vercel'),
    });
  });

  // Listar servicios de Railway del token configurado (para elegir qué redesplegar).
  app.get('/api/implementaciones/railway/servicios', authMiddleware, async (req, res) => {
    const token = resolveDeployToken(req.auth.sub, 'railway');
    if (!token) return res.status(400).json({ error: 'RAILWAY_TOKEN no configurado (añádelo como variable en tu entorno activo)' });
    try {
      const resp = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          query: `query { projects { edges { node { id name services { edges { node { id name } } } } } } }`,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.errors) {
        return res.status(502).json({ error: 'Railway rechazó la consulta', detail: data.errors || data });
      }
      const projects = (data.data?.projects?.edges || []).map(p => ({
        id: p.node.id,
        name: p.node.name,
        services: (p.node.services?.edges || []).map(s => ({ id: s.node.id, name: s.node.name })),
      }));
      res.json({ projects });
    } catch (err) {
      res.status(502).json({ error: `No se pudo contactar con Railway: ${err.message}` });
    }
  });

  // Ejecutar acción de despliegue: { provider: 'railway'|'vercel', action: 'redeploy', targetId }
  app.post('/api/implementaciones/accion', authMiddleware, async (req, res) => {
    const { provider, action, targetId } = req.body || {};
    if (!['railway', 'vercel'].includes(provider)) return res.status(400).json({ error: 'provider debe ser railway o vercel' });
    if (action !== 'redeploy') return res.status(400).json({ error: 'Acción no soportada (disponible: redeploy)' });
    if (!targetId || !String(targetId).trim()) return res.status(400).json({ error: 'targetId (serviceId/proyecto) es obligatorio' });
    const token = resolveDeployToken(req.auth.sub, provider);
    if (!token) return res.status(400).json({ error: `${provider.toUpperCase()}_TOKEN no configurado (añádelo como variable en tu entorno activo)` });

    let status = 'error'; let detail = '';
    try {
      if (provider === 'railway') {
        const resp = await fetch('https://backboard.railway.app/graphql/v2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            query: `mutation($serviceId: String!) { serviceInstanceRedeploy(serviceId: $serviceId) }`,
            variables: { serviceId: String(targetId) },
          }),
        });
        const data = await resp.json();
        status = resp.ok && !data.errors ? 'ok' : 'error';
        detail = JSON.stringify(data).slice(0, 2000);
      } else {
        const resp = await fetch('https://api.vercel.com/v13/deployments', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: String(targetId), target: 'production' }),
        });
        const data = await resp.json();
        status = resp.ok ? 'ok' : 'error';
        detail = JSON.stringify(data).slice(0, 2000);
      }
    } catch (err) {
      detail = String(err.message || err);
    }

    const logId = uuidv4();
    db.prepare(`INSERT INTO deployments_log (id, user_id, provider, target_id, action, status, detail) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(logId, req.auth.sub, provider, String(targetId), action, status, detail);
    res.status(status === 'ok' ? 200 : 502).json({ id: logId, status, detail: safeJson(detail) || detail });
  });


  // ══ SESIONES ═══════════════════════════════════════════════════════════════
  app.get('/api/sesiones', authMiddleware, (req, res) => {
    const rows = db.prepare(`
      SELECT id, agent_id as agentId, model, title, preview, message_count as messageCount,
             attached_file_ids as attachedFileIds, active_skill_ids as activeSkillIds,
             created_at as createdAt, updated_at as updatedAt
      FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100
    `).all(req.auth.sub);
    res.json(rows.map(r => ({
      ...r,
      attachedFileIds: safeJson(r.attachedFileIds) || [],
      activeSkillIds: safeJson(r.activeSkillIds) || [],
    })));
  });

  app.post('/api/sesiones', authMiddleware, (req, res) => {
    const { agentId, model, attachedFileIds, activeSkillIds } = req.body || {};
    const id = uuidv4(); const now = Date.now();
    db.prepare(`INSERT INTO sessions (id, user_id, agent_id, model, title, preview, attached_file_ids, active_skill_ids, created_at, updated_at) VALUES (?, ?, ?, ?, 'Nueva conversación', '', ?, ?, ?, ?)`)
      .run(id, req.auth.sub, agentId || null, model || 'zoco-plus', JSON.stringify(attachedFileIds || []), JSON.stringify(activeSkillIds || []), now, now);
    const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    res.json({ ...s, agentId: s.agent_id, messageCount: s.message_count, attachedFileIds: safeJson(s.attached_file_ids) || [], activeSkillIds: safeJson(s.active_skill_ids) || [] });
  });

  app.get('/api/sesiones/:id', authMiddleware, (req, res) => {
    const s = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
    if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });
    const msgs = db.prepare('SELECT role, content FROM session_messages WHERE session_id = ? ORDER BY created_at ASC').all(s.id);
    res.json({ ...s, agentId: s.agent_id, messageCount: s.message_count, attachedFileIds: safeJson(s.attached_file_ids) || [], activeSkillIds: safeJson(s.active_skill_ids) || [], messages: msgs });
  });

  app.put('/api/sesiones/:id', authMiddleware, (req, res) => {
    const { title } = req.body || {};
    const s = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
    if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });
    db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(String(title || '').slice(0, 200), Date.now(), s.id);
    res.json({ ok: true });
  });

  app.delete('/api/sesiones/:id', authMiddleware, (req, res) => {
    const s = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
    if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });
    db.prepare('DELETE FROM session_messages WHERE session_id = ?').run(s.id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id);
    res.json({ ok: true });
  });

  app.post('/api/sesiones/:id/mensajes', authMiddleware, async (req, res) => {
    const s = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
    if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });
    const { message, attachments, skills } = req.body || {};
    if (!message || !String(message).trim()) return res.status(400).json({ error: 'Falta el mensaje' });
    db.prepare('INSERT INTO session_messages (id, session_id, user_id, role, content, attachments, skills, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), s.id, req.auth.sub, 'user', String(message), JSON.stringify(attachments || []), JSON.stringify(skills || []), Date.now());
    try {
      const history = db.prepare('SELECT role, content FROM session_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 40').all(s.id);
      const result = await processChatCompletion(req.auth.sub, { agentId: s.agent_id || undefined, model: s.model || 'zoco-plus', messages: history });
      const response = result?.choices?.[0]?.message?.content || '';
      db.prepare('INSERT INTO session_messages (id, session_id, user_id, role, content, attachments, skills, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(uuidv4(), s.id, req.auth.sub, 'assistant', response, '[]', '[]', Date.now());
      const preview = String(message).slice(0, 120);
      const title = s.title === 'Nueva conversación' ? String(message).slice(0, 60) : s.title;
      db.prepare('UPDATE sessions SET title = ?, preview = ?, message_count = message_count + 2, updated_at = ? WHERE id = ?').run(title, preview, Date.now(), s.id);
      res.json({ response, sessionId: s.id });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'Error al procesar el mensaje' });
    }
  });

  // ══ SOPORTE (TICKETS) ══════════════════════════════════════════════════════
  app.get('/api/soporte/tickets', authMiddleware, (req, res) => {
    const isAdmin = req.auth.isAdmin || req.auth.isSupport;
    const rows = isAdmin
      ? db.prepare(`SELECT t.*, u.email, u.nombre, (SELECT COUNT(*) FROM support_messages WHERE ticket_id = t.id) as msg_count FROM support_tickets t JOIN users u ON u.id = t.user_id ORDER BY t.updated_at DESC LIMIT 200`).all()
      : db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM support_messages WHERE ticket_id = t.id) as msg_count FROM support_tickets t WHERE t.user_id = ? ORDER BY t.updated_at DESC`).all(req.auth.sub);
    res.json(rows);
  });

  app.post('/api/soporte/tickets', authMiddleware, (req, res) => {
    const { subject, message, priority } = req.body || {};
    if (!subject || !message) return res.status(400).json({ error: 'Faltan subject y message' });
    const id = uuidv4(); const msgId = uuidv4(); const now = Date.now();
    db.prepare('INSERT INTO support_tickets (id, user_id, subject, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, req.auth.sub, String(subject).slice(0, 200), 'open', priority || 'normal', now, now);
    db.prepare('INSERT INTO support_messages (id, ticket_id, user_id, is_staff, content, created_at) VALUES (?, ?, ?, 0, ?, ?)')
      .run(msgId, id, req.auth.sub, String(message).slice(0, 5000), now);
    res.json({ id, subject, status: 'open', priority: priority || 'normal', createdAt: now });
  });

  app.get('/api/soporte/tickets/:id', authMiddleware, (req, res) => {
    const isAdmin = req.auth.isAdmin || req.auth.isSupport;
    const t = isAdmin ? db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id)
      : db.prepare('SELECT * FROM support_tickets WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
    if (!t) return res.status(404).json({ error: 'Ticket no encontrado' });
    const msgs = db.prepare('SELECT sm.*, u.nombre, u.email FROM support_messages sm JOIN users u ON u.id = sm.user_id WHERE sm.ticket_id = ? ORDER BY sm.created_at ASC').all(t.id);
    res.json({ ...t, messages: msgs });
  });

  app.post('/api/soporte/tickets/:id/mensajes', authMiddleware, (req, res) => {
    const isAdmin = req.auth.isAdmin || req.auth.isSupport;
    const t = isAdmin ? db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id)
      : db.prepare('SELECT * FROM support_tickets WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
    if (!t) return res.status(404).json({ error: 'Ticket no encontrado' });
    const { content } = req.body || {};
    if (!content) return res.status(400).json({ error: 'Falta el contenido' });
    const id = uuidv4(); const now = Date.now();
    db.prepare('INSERT INTO support_messages (id, ticket_id, user_id, is_staff, content, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, t.id, req.auth.sub, isAdmin ? 1 : 0, String(content).slice(0, 5000), now);
    db.prepare('UPDATE support_tickets SET updated_at = ?, status = ? WHERE id = ?').run(now, isAdmin ? 'answered' : 'open', t.id);
    res.json({ ok: true, id });
  });

  app.put('/api/soporte/tickets/:id', authMiddleware, (req, res) => {
    const isAdmin = req.auth.isAdmin || req.auth.isSupport;
    if (!isAdmin) return res.status(403).json({ error: 'Solo el equipo de soporte puede actualizar tickets' });
    const { status, priority } = req.body || {};
    db.prepare('UPDATE support_tickets SET status = COALESCE(?, status), priority = COALESCE(?, priority), updated_at = ? WHERE id = ?')
      .run(status || null, priority || null, Date.now(), req.params.id);
    res.json({ ok: true });
  });

  // ══ WEBHOOKS ═══════════════════════════════════════════════════════════════
  app.get('/api/webhooks', authMiddleware, (req, res) => {
    const rows = db.prepare('SELECT id, name, url, events, active, last_triggered_at as lastTriggeredAt, last_status as lastStatus, created_at as createdAt FROM webhooks WHERE user_id = ? ORDER BY created_at DESC').all(req.auth.sub);
    res.json(rows.map(r => ({ ...r, events: safeJson(r.events) || [] })));
  });

  app.post('/api/webhooks', authMiddleware, (req, res) => {
    const { name, url, events, secret } = req.body || {};
    if (!name || !url) return res.status(400).json({ error: 'Faltan name y url' });
    try { new URL(url); } catch { return res.status(400).json({ error: 'URL inválida' }); }
    const id = uuidv4(); const now = Date.now();
    db.prepare('INSERT INTO webhooks (id, user_id, name, url, events, secret, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)')
      .run(id, req.auth.sub, String(name).slice(0, 100), String(url).slice(0, 500), JSON.stringify(events || []), secret ? String(secret).slice(0, 200) : null, now, now);
    res.json({ id, name, url, events: events || [], active: true, createdAt: now });
  });

  app.put('/api/webhooks/:id', authMiddleware, (req, res) => {
    const w = db.prepare('SELECT id FROM webhooks WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
    if (!w) return res.status(404).json({ error: 'Webhook no encontrado' });
    const { name, url, events, active, secret } = req.body || {};
    if (url) { try { new URL(url); } catch { return res.status(400).json({ error: 'URL inválida' }); } }
    db.prepare('UPDATE webhooks SET name = COALESCE(?, name), url = COALESCE(?, url), events = COALESCE(?, events), active = COALESCE(?, active), secret = COALESCE(?, secret), updated_at = ? WHERE id = ?')
      .run(name || null, url || null, events ? JSON.stringify(events) : null, active !== undefined ? (active ? 1 : 0) : null, secret || null, Date.now(), w.id);
    res.json({ ok: true });
  });

  app.delete('/api/webhooks/:id', authMiddleware, (req, res) => {
    const w = db.prepare('SELECT id FROM webhooks WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
    if (!w) return res.status(404).json({ error: 'Webhook no encontrado' });
    db.prepare('DELETE FROM webhooks WHERE id = ?').run(w.id);
    res.json({ ok: true });
  });

  app.post('/api/webhooks/:id/test', authMiddleware, async (req, res) => {
    const w = db.prepare('SELECT * FROM webhooks WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
    if (!w) return res.status(404).json({ error: 'Webhook no encontrado' });
    const payload = { event: 'webhook.test', timestamp: Date.now(), webhook_id: w.id, message: 'Prueba de Zoco IA' };
    try {
      const r = await fetch(w.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Zoco-Event': 'webhook.test' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
      db.prepare('UPDATE webhooks SET last_triggered_at = ?, last_status = ? WHERE id = ?').run(Date.now(), r.status, w.id);
      res.json({ ok: r.ok, status: r.status, message: r.ok ? 'Webhook enviado correctamente' : `El servidor respondió con ${r.status}` });
    } catch (err) {
      db.prepare('UPDATE webhooks SET last_triggered_at = ?, last_status = 0 WHERE id = ?').run(Date.now(), w.id);
      res.status(502).json({ error: `No se pudo conectar: ${err.message}` });
    }
  });

  // ══ ALMACENES DE MEMORIA ═══════════════════════════════════════════════

  // Resumen por agente: cuántos recuerdos, último acceso.
  app.get('/api/memoria/almacenes', authMiddleware, (req, res) => {
    const rows = db.prepare(`
      SELECT r.id as agente_id, r.name as agente, COUNT(m.id) as recuerdos, MAX(m.created_at) as ultimo
      FROM resources r
      LEFT JOIN agent_memory m ON m.agente_id = r.id
      WHERE r.user_id = ? AND r.type = 'agente'
      GROUP BY r.id ORDER BY recuerdos DESC
    `).all(req.auth.sub);
    res.json(rows);
  });

  // Búsqueda global sobre la memoria: q en el contenido, con ranking por
  // número de coincidencias y recencia. Filtro opcional por agente.
  app.get('/api/memoria/buscar', authMiddleware, (req, res) => {
    const q = String(req.query.q || '').trim();
    const agenteId = String(req.query.agenteId || '').trim();
    if (!q) return res.status(400).json({ error: 'Falta el parámetro q' });
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);

    const base = agenteId
      ? db.prepare(`
          SELECT m.id, m.agente_id, r.name as agente, m.role, m.content, m.created_at
          FROM agent_memory m JOIN resources r ON r.id = m.agente_id
          WHERE m.user_id = ? AND m.agente_id = ? ORDER BY m.created_at DESC LIMIT 2000`).all(req.auth.sub, agenteId)
      : db.prepare(`
          SELECT m.id, m.agente_id, r.name as agente, m.role, m.content, m.created_at
          FROM agent_memory m JOIN resources r ON r.id = m.agente_id
          WHERE m.user_id = ? ORDER BY m.created_at DESC LIMIT 2000`).all(req.auth.sub);

    const scored = [];
    for (const row of base) {
      const text = String(row.content || '').toLowerCase();
      let score = 0;
      for (const t of terms) {
        let i = text.indexOf(t);
        while (i !== -1) { score++; i = text.indexOf(t, i + t.length); }
      }
      if (score > 0) {
        // Fragmento centrado en la primera coincidencia (resaltable en el frontend)
        const first = text.indexOf(terms[0]);
        const start = Math.max(0, first - 80);
        const snippet = String(row.content).slice(start, start + 240);
        scored.push({ ...row, score, snippet: (start > 0 ? '…' : '') + snippet + '…' });
      }
    }
    scored.sort((a, b) => b.score - a.score || b.created_at - a.created_at);
    res.json({ total: scored.length, results: scored.slice(0, 50).map(({ content, ...rest }) => rest) });
  });
}

// Construye el bloque de contexto operativo del entorno activo del usuario,
// para inyectarlo en el system prompt de las llamadas de chat.
export function buildEnvironmentContext(db, userId) {
  try {
    const env = db.prepare(`SELECT name, kind, variables FROM environments WHERE user_id = ? AND active = 1`).get(userId);
    if (!env) return '';
    const vars = safeJson(env.variables) || {};
    const safeEntries = Object.entries(vars)
      .filter(([k]) => !/TOKEN|SECRET|KEY|PASSWORD/i.test(k)) // nunca filtrar secretos al modelo
      .map(([k, v]) => `${k}=${v}`);
    return `\n\n[ENTORNO ACTIVO: ${env.name} (${env.kind})]` +
      (safeEntries.length ? `\nVariables de contexto: ${safeEntries.join(', ')}` : '') +
      `\nAdapta tus respuestas y ejemplos a este entorno.`;
  } catch {
    return '';
  }
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function sanitizeVars(variables) {
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) return {};
  const out = {};
  for (const [k, v] of Object.entries(variables)) {
    const key = String(k).trim().slice(0, 64);
    if (key) out[key] = String(v ?? '').slice(0, 2000);
  }
  return out;
}
