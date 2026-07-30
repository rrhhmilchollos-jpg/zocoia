/**
 * eventos-agente.js
 * 
 * Gestiona la emisión y suscripción a eventos de agentes en tiempo real
 * utilizando Server-Sent Events (SSE).
 */

import { logger } from './logger.js';

// Mapa de clientes conectados: userId -> Set(res)
const clients = new Map();

/**
 * Registra la ruta de eventos SSE
 */
export function registerEventStreamRoute({ app, jwt, JWT_SECRET, db }) {
  if (!app) {
    console.error('[eventos-agente] No se pudo registrar: "app" es undefined');
    return;
  }

  app.get('/api/events/stream', async (req, res) => {
    const token = req.query.token;
    if (!token) {
      return res.status(401).json({ error: 'Token requerido' });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const userId = decoded.sub;

      // Configurar cabeceras SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      // Añadir cliente al mapa
      if (!clients.has(userId)) {
        clients.set(userId, new Set());
      }
      clients.get(userId).add(res);

      // Enviar evento inicial de conexión
      res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Conectado al flujo de eventos de Zoco IA' })}\n\n`);

      // Manejar cierre de conexión
      req.on('close', () => {
        if (clients.has(userId)) {
          clients.get(userId).delete(res);
          if (clients.get(userId).size === 0) {
            clients.delete(userId);
          }
        }
      });

    } catch (err) {
      return res.status(401).json({ error: 'Token inválido' });
    }
  });
}

/**
 * Emite un evento a todos los clientes conectados de un usuario
 */
export function emitirEventoAgente(userId, eventData) {
  const userClients = clients.get(userId);
  if (userClients) {
    const payload = `data: ${JSON.stringify(eventData)}\n\n`;
    userClients.forEach(res => res.write(payload));
  }
}
