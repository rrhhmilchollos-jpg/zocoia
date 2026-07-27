// zoco-sessions.js
// Zoco IA — Validación de API Keys + rutas de Sesiones / Archivos / Credenciales
//
// Este módulo NO crea tablas nuevas: reutiliza la tabla `resources` que ya
// existe en server.js (con type IN ('sesion','archivo','credencial', ...)).
// Así evitamos migraciones duplicadas y mantenemos un único lugar de verdad
// para el esquema de la base de datos (server.js).

import crypto from 'crypto';

// ---------------------------------------------------------------------------
// 1) validateZocoApiKey — CRÍTICO: si esto falla, se cae todo el login por
//    API key en authMiddleware (server.js línea ~471). Contrato exacto:
//
//    validateZocoApiKey(db, token) -> { valid, reason, keyId, ownerId }
//
//    Se llama únicamente cuando token.startsWith('sk-zoco-'), pero esta
//    función es defensiva por sí misma de todas formas.
// ---------------------------------------------------------------------------

export function validateZocoApiKey(db, token) {
  if (!token || typeof token !== 'string' || !token.startsWith('sk-zoco-')) {
    return { valid: false, reason: 'Formato de clave no reconocido', keyId: null, ownerId: null };
  }

  // Las claves se generan como `sk-zoco-${crypto.randomBytes(24).toString('hex')}`
  // y se guardan hasheadas con sha256 en api_keys.key_hash (ver /api/keys POST
  // en server.js). Nunca se guarda ni se compara la clave en claro.
  const keyHash = crypto.createHash('sha256').update(token).digest('hex');

  let row;
  try {
    row = db
      .prepare('SELECT id, user_id, revoked FROM api_keys WHERE key_hash = ?')
      .get(keyHash);
  } catch (err) {
    console.error('[validateZocoApiKey] Error consultando api_keys:', err);
    return { valid: false, reason: 'Error interno validando la clave', keyId: null, ownerId: null };
  }

  if (!row) {
    return { valid: false, reason: 'Clave no encontrada', keyId: null, ownerId: null };
  }

  if (row.revoked) {
    return { valid: false, reason: 'Clave revocada', keyId: row.id, ownerId: row.user_id };
  }

  return { valid: true, reason: null, keyId: row.id, ownerId: row.user_id };
}

// ---------------------------------------------------------------------------
// 2) registerSessionRoutes — Sesiones (chat con memoria ligera, sin necesidad
//    de crear un "agente" completo) + Archivos + Credenciales.
//
//    Diseño: todo vive en la tabla `resources` ya existente:
//      - type = 'sesion'     -> data = { model, messages: [{role, content, ts}] }
//      - type = 'archivo'    -> data = { mimeType, size, content (base64 o texto) }
//      - type = 'credencial' -> data = { valor }  (el valor NUNCA se devuelve
//                                en listados; solo al crearla)
//
//    Esto es una superficie razonable y documentada — ajusta rutas/payloads
//    si el frontend real espera algo distinto; no hay consumidor confirmado.
// ---------------------------------------------------------------------------

export function registerSessionRoutes({ app, db, authMiddleware, uuidv4, serverSecret, processChatCompletion }) {
  const getResourceOr404 = (id, userId, type, res) => {
    const row = db
      .prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?')
      .get(id, userId, type);
    if (!row) {
      res.status(404).json({ error: `${type} no encontrado` });
      return null;
    }
    return row;
  };

  const parseData = (row) => {
    try {
      return JSON.parse(row.data || '{}');
    } catch {
      return {};
    }
  };

  // -------------------------------------------------------------------
  // SESIONES — chats ligeros con historial, sin crear un "agente" formal
  // -------------------------------------------------------------------

  // Listar sesiones del usuario (sin el historial completo, solo metadata)
  app.get('/api/sessions', authMiddleware, (req, res) => {
    const rows = db
      .prepare("SELECT * FROM resources WHERE user_id = ? AND type = 'sesion' ORDER BY updated_at DESC")
      .all(req.auth.sub);

    res.json(
      rows.map((r) => {
        const data = parseData(r);
        return {
          id: r.id,
          name: r.name,
          model: data.model || null,
          messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        };
      })
    );
  });

  // Crear sesión nueva
  app.post('/api/sessions', authMiddleware, (req, res) => {
    const { name, model } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'El nombre de la sesión es obligatorio' });
    }

    const id = uuidv4();
    const data = { model: model || null, messages: [] };
    db.prepare('INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, ?, ?, ?)').run(
      id,
      req.auth.sub,
      'sesion',
      name.trim(),
      JSON.stringify(data)
    );

    const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(id);
    res.status(201).json({ id: row.id, name: row.name, model: data.model, messages: [], createdAt: row.created_at });
  });

  // Obtener una sesión con su historial completo
  app.get('/api/sessions/:id', authMiddleware, (req, res) => {
    const row = getResourceOr404(req.params.id, req.auth.sub, 'sesion', res);
    if (!row) return;
    const data = parseData(row);
    res.json({
      id: row.id,
      name: row.name,
      model: data.model || null,
      messages: data.messages || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  });

  // Renombrar sesión / cambiar modelo
  app.put('/api/sessions/:id', authMiddleware, (req, res) => {
    const row = getResourceOr404(req.params.id, req.auth.sub, 'sesion', res);
    if (!row) return;
    const data = parseData(row);
    const { name, model } = req.body || {};

    const newName = (name && name.trim()) || row.name;
    const newData = { ...data, model: model !== undefined ? model : data.model };

    db.prepare('UPDATE resources SET name = ?, data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      newName,
      JSON.stringify(newData),
      row.id
    );
    res.json({ id: row.id, name: newName, model: newData.model });
  });

  // Borrar sesión
  app.delete('/api/sessions/:id', authMiddleware, (req, res) => {
    const row = getResourceOr404(req.params.id, req.auth.sub, 'sesion', res);
    if (!row) return;
    db.prepare('DELETE FROM resources WHERE id = ?').run(row.id);
    res.json({ ok: true });
  });

  // Enviar un mensaje a la sesión: usa processChatCompletion con el
  // historial acumulado, guarda ambos mensajes (user + assistant) y
  // devuelve la respuesta. No pasa agentId: es una sesión "suelta", no
  // ligada a un agente concreto.
  app.post('/api/sessions/:id/messages', authMiddleware, async (req, res) => {
    const row = getResourceOr404(req.params.id, req.auth.sub, 'sesion', res);
    if (!row) return;

    const { message } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'El mensaje es obligatorio' });
    }

    const data = parseData(row);
    const historial = Array.isArray(data.messages) ? data.messages : [];

    const mensajesParaModelo = [
      ...historial.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: String(message) },
    ];

    try {
      const result = await processChatCompletion(req.auth.sub, {
        messages: mensajesParaModelo,
        model: data.model || undefined,
        apiKeyId: req.auth.viaApiKey ? req.auth.apiKeyId : undefined,
        apiKeyType: req.auth.viaApiKey ? req.auth.apiKeyType : undefined,
      });

      const respuesta = result.choices?.[0]?.message?.content || '';
      const now = new Date().toISOString();

      const nuevosMensajes = [
        ...historial,
        { role: 'user', content: String(message), ts: now },
        { role: 'assistant', content: respuesta, ts: now },
      ];

      db.prepare('UPDATE resources SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        JSON.stringify({ ...data, messages: nuevosMensajes }),
        row.id
      );

      res.json({ response: respuesta, usage: result.usage, model: result.model });
    } catch (err) {
      console.error('Error en /api/sessions/:id/messages:', err);
      const status = err.status || 500;
      res.status(status).json({ error: err.message || 'Error interno al procesar el mensaje', ...(err.code ? { code: err.code } : {}) });
    }
  });

  // Vaciar historial de la sesión (sin borrar la sesión en sí)
  app.delete('/api/sessions/:id/messages', authMiddleware, (req, res) => {
    const row = getResourceOr404(req.params.id, req.auth.sub, 'sesion', res);
    if (!row) return;
    const data = parseData(row);
    db.prepare('UPDATE resources SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      JSON.stringify({ ...data, messages: [] }),
      row.id
    );
    res.json({ ok: true });
  });

  // -------------------------------------------------------------------
  // ARCHIVOS
  // -------------------------------------------------------------------

  app.get('/api/files', authMiddleware, (req, res) => {
    const rows = db
      .prepare("SELECT * FROM resources WHERE user_id = ? AND type = 'archivo' ORDER BY created_at DESC")
      .all(req.auth.sub);

    res.json(
      rows.map((r) => {
        const data = parseData(r);
        return {
          id: r.id,
          name: r.name,
          mimeType: data.mimeType || 'application/octet-stream',
          size: data.size ?? (data.content ? String(data.content).length : 0),
          createdAt: r.created_at,
        };
      })
    );
  });

  // Sube un archivo. `content` puede ser texto plano o base64 (marca
  // encoding: 'base64' si es binario); no interpretamos el contenido aquí.
  app.post('/api/files', authMiddleware, (req, res) => {
    const { name, content, mimeType, encoding } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre del archivo es obligatorio' });
    if (content === undefined || content === null) {
      return res.status(400).json({ error: 'El contenido del archivo es obligatorio' });
    }

    const id = uuidv4();
    const data = {
      mimeType: mimeType || 'application/octet-stream',
      encoding: encoding === 'base64' ? 'base64' : 'utf8',
      size: String(content).length,
      content: String(content),
    };

    db.prepare('INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, ?, ?, ?)').run(
      id,
      req.auth.sub,
      'archivo',
      name.trim(),
      JSON.stringify(data)
    );

    res.status(201).json({ id, name: name.trim(), mimeType: data.mimeType, size: data.size });
  });

  // Descarga/lee el contenido completo de un archivo
  app.get('/api/files/:id', authMiddleware, (req, res) => {
    const row = getResourceOr404(req.params.id, req.auth.sub, 'archivo', res);
    if (!row) return;
    const data = parseData(row);
    res.json({
      id: row.id,
      name: row.name,
      mimeType: data.mimeType || 'application/octet-stream',
      encoding: data.encoding || 'utf8',
      content: data.content || '',
      createdAt: row.created_at,
    });
  });

  app.put('/api/files/:id', authMiddleware, (req, res) => {
    const row = getResourceOr404(req.params.id, req.auth.sub, 'archivo', res);
    if (!row) return;
    const data = parseData(row);
    const { name, content, mimeType, encoding } = req.body || {};

    const newName = (name && name.trim()) || row.name;
    const newData = {
      ...data,
      mimeType: mimeType || data.mimeType,
      encoding: encoding === 'base64' ? 'base64' : data.encoding || 'utf8',
      content: content !== undefined ? String(content) : data.content,
      size: content !== undefined ? String(content).length : data.size,
    };

    db.prepare('UPDATE resources SET name = ?, data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      newName,
      JSON.stringify(newData),
      row.id
    );
    res.json({ id: row.id, name: newName, mimeType: newData.mimeType, size: newData.size });
  });

  app.delete('/api/files/:id', authMiddleware, (req, res) => {
    const row = getResourceOr404(req.params.id, req.auth.sub, 'archivo', res);
    if (!row) return;
    db.prepare('DELETE FROM resources WHERE id = ?').run(row.id);
    res.json({ ok: true });
  });

  // -------------------------------------------------------------------
  // CREDENCIALES — valores sensibles (p.ej. TAVILY_API_KEY, E2B_API_KEY,
  // que server.js ya lee de resources type IN ('credencial','habilidad')).
  // El `valor` real solo se devuelve en el POST de creación; en listados
  // y GET individual se enmascara, igual que hace /api/keys con las claves.
  // -------------------------------------------------------------------

  const maskValue = (valor) => {
    if (!valor || typeof valor !== 'string') return '••••••••';
    if (valor.length <= 8) return '•'.repeat(valor.length);
    return `${valor.slice(0, 4)}${'•'.repeat(Math.max(4, valor.length - 8))}${valor.slice(-4)}`;
  };

  app.get('/api/credentials', authMiddleware, (req, res) => {
    const rows = db
      .prepare("SELECT * FROM resources WHERE user_id = ? AND type = 'credencial' ORDER BY created_at DESC")
      .all(req.auth.sub);

    res.json(
      rows.map((r) => {
        const data = parseData(r);
        return {
          id: r.id,
          name: r.name,
          maskedValue: maskValue(data.valor),
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        };
      })
    );
  });

  app.post('/api/credentials', authMiddleware, (req, res) => {
    const { name, valor } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre de la credencial es obligatorio' });
    if (!valor || !String(valor).trim()) return res.status(400).json({ error: 'El valor de la credencial es obligatorio' });

    // Evita duplicar credenciales con el mismo nombre para el mismo usuario
    // (server.js las busca por user_id + name, p.ej. 'TAVILY_API_KEY').
    const existing = db
      .prepare("SELECT id FROM resources WHERE user_id = ? AND type = 'credencial' AND name = ?")
      .get(req.auth.sub, name.trim());
    if (existing) {
      return res.status(409).json({ error: 'Ya existe una credencial con ese nombre. Bórrala o actualízala primero.' });
    }

    const id = uuidv4();
    db.prepare('INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, ?, ?, ?)').run(
      id,
      req.auth.sub,
      'credencial',
      name.trim(),
      JSON.stringify({ valor: String(valor) })
    );

    // Única vez que se devuelve el valor en claro: justo tras crearla.
    res.status(201).json({ id, name: name.trim(), valor: String(valor) });
  });

  app.put('/api/credentials/:id', authMiddleware, (req, res) => {
    const row = getResourceOr404(req.params.id, req.auth.sub, 'credencial', res);
    if (!row) return;
    const { name, valor } = req.body || {};
    const data = parseData(row);

    const newName = (name && name.trim()) || row.name;
    const newData = { valor: valor !== undefined ? String(valor) : data.valor };

    db.prepare('UPDATE resources SET name = ?, data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      newName,
      JSON.stringify(newData),
      row.id
    );
    res.json({ id: row.id, name: newName, maskedValue: maskValue(newData.valor) });
  });

  app.delete('/api/credentials/:id', authMiddleware, (req, res) => {
    const row = getResourceOr404(req.params.id, req.auth.sub, 'credencial', res);
    if (!row) return;
    db.prepare('DELETE FROM resources WHERE id = ?').run(row.id);
    res.json({ ok: true });
  });

  // `serverSecret` queda reservado para casos futuros (p.ej. firmar enlaces
  // de descarga temporales para /api/files/:id) — no se usa todavía porque
  // no hay consumidor de frontend confirmado que lo necesite.
  void serverSecret;
}
