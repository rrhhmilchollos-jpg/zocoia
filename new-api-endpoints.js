/**
 * new-api-endpoints.js
 * 
 * Registra nuevos endpoints para la gestión de agentes, claves API y herramientas.
 */

import { v4 as uuidv4 } from 'uuid';

export default function registerNewApiEndpoints(app, db, authMiddleware) {
  
  // ── Gestión de Agentes ──────────────────────────────────────────────────
  
  app.get('/api/agentes', authMiddleware, async (req, res) => {
    try {
      const agentes = db.prepare("SELECT * FROM resources WHERE user_id = ? AND type = 'agente'").all(req.auth.sub);
      res.json(agentes.map(a => ({ ...a, data: JSON.parse(a.data) })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/agentes', authMiddleware, async (req, res) => {
    try {
      const { name, data } = req.body;
      const id = uuidv4();
      db.prepare("INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, 'agente', ?, ?)")
        .run(id, req.auth.sub, name, JSON.stringify(data));
      res.status(201).json({ id, name, data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Gestión de API Keys ─────────────────────────────────────────────────
  
  app.get('/api/keys', authMiddleware, async (req, res) => {
    try {
      const keys = db.prepare("SELECT id, name, key_prefix, created_at, last_used_at FROM api_keys WHERE user_id = ? AND revoked = 0")
        .all(req.auth.sub);
      res.json(keys);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/keys', authMiddleware, async (req, res) => {
    try {
      const { name, key } = req.body;
      const id = uuidv4();
      const key_prefix = key.slice(0, 7);
      const key_hash = key; // En producción deberías hashear esto
      db.prepare("INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash) VALUES (?, ?, ?, ?, ?)")
        .run(id, req.auth.sub, name, key_prefix, key_hash);
      res.status(201).json({ id, name, key_prefix });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Gestión de Herramientas (Toolbox) ───────────────────────────────────
  
  app.get('/api/habilidades', authMiddleware, async (req, res) => {
    try {
      const habilidades = db.prepare("SELECT * FROM resources WHERE user_id = ? AND type = 'habilidad'").all(req.auth.sub);
      res.json(habilidades.map(h => ({ ...h, data: JSON.parse(h.data) })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/habilidades', authMiddleware, async (req, res) => {
    try {
      const { name, data } = req.body;
      const id = uuidv4();
      db.prepare("INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, 'habilidad', ?, ?)")
        .run(id, req.auth.sub, name, JSON.stringify(data));
      res.status(201).json({ id, name, data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
