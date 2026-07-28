// eventos-agente.js — Canal de eventos en vivo del "Ordenador de Zoco" vía
// Server-Sent Events. No añade dependencias nuevas (SSE es HTTP estándar,
// Express ya lo soporta con res.write), por eso no toca tu package.json.
//
// Un agente (workspaceId = agentId) puede tener 0, 1 o varios navegadores
// escuchando a la vez (ej. el usuario con dos pestañas abiertas) — por eso
// se guarda un Set de responses por workspaceId, no una sola.

const suscriptores = new Map(); // workspaceId -> Set<express.Response>

/**
 * Ruta Express que el frontend abre con EventSource:
 *   const es = new EventSource(`/api/agentes/${agentId}/eventos`, { withCredentials: false });
 *   es.onmessage = (e) => { const evento = JSON.parse(e.data); ... }
 *
 * Nota: EventSource nativo del navegador no permite headers custom, así que
 * NO puede llevar el JWT en Authorization. Por eso esta ruta acepta el token
 * como query param (?token=...) además del header, solo para esta ruta.
 */
export function registerEventStreamRoute({ app, jwt, JWT_SECRET, db }) {
  app.get('/api/agentes/:id/eventos', (req, res) => {
    const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
    let auth;
    try {
      auth = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).end();
    }

    const agente = db
      .prepare("SELECT id FROM resources WHERE id = ? AND user_id = ? AND type = 'agente'")
      .get(req.params.id, auth.sub);
    if (!agente) return res.status(404).end();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const workspaceId = req.params.id;
    if (!suscriptores.has(workspaceId)) suscriptores.set(workspaceId, new Set());
    suscriptores.get(workspaceId).add(res);

    // Ping cada 20s para que proxies/balanceadores (Coolify/Traefik) no
    // cierren la conexión por inactividad.
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);

    req.on('close', () => {
      clearInterval(ping);
      suscriptores.get(workspaceId)?.delete(res);
    });
  });
}

/**
 * Función a pasar como context.onEvent en runToolLoop (ver tools.js).
 * Nunca lanza: un fallo escribiendo a una conexión ya cerrada no debe tumbar
 * la ejecución de la tool que lo disparó.
 */
export function emitirEventoAgente(workspaceId, evento) {
  const listeners = suscriptores.get(workspaceId);
  if (!listeners || listeners.size === 0) return;
  const payload = `data: ${JSON.stringify(evento)}\n\n`;
  for (const res of listeners) {
    try {
      res.write(payload);
    } catch {
      listeners.delete(res);
    }
  }
}
