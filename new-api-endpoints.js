/**

 * new-api-endpoints.js

 * Registra endpoints complementarios de Zoco IA.

 */

import { v4 as uuidv4 } from 'uuid';

import crypto from 'node:crypto';



export default function registerNewApiEndpoints(app, db, authMiddleware) {
  
  app.get('/api/agentes', authMiddleware, async (req, res) => {
    
    try {
      
      const agentes = db.prepare("SELECT * FROM resources WHERE user_id = ? AND type = 'agente'").all(req.auth.sub);
      
      res.json(agentes.map(a => ({ ...a, data: JSON.parse(a.data) })));
      
    } catch (err) { res.status(500).json({ error: err.message }); }
    
  });
  

  
  app.post('/api/agentes', authMiddleware, async (req, res) => {
    
    try {
      
      const { name, data } = req.body || {};
      
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
      
      const id = uuidv4();
      
      db.prepare("INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, 'agente', ?, ?)").run(id, req.auth.sub, String(name).trim(), JSON.stringify(data || {}));
      
      res.status(201).json({ id, name: String(name).trim(), data: data || {} });
      
    } catch (err) { res.status(500).json({ error: err.message }); }
    
  });
  

  
  app.get('/api/keys', authMiddleware, async (req, res) => {
    
    try {
      
      const keys = db.prepare("SELECT id, name, key_prefix, created_at, last_used_at, revoked, key_type FROM api_keys WHERE user_id = ? ORDER BY created_at DESC").all(req.auth.sub);
      
      res.json(keys.map(k => ({ ...k, display: `${k.key_prefix || 'sk-zoco-'}${'•'.repeat(16)}`, type: k.key_type || 'pago', revoked: !!k.revoked })));
      
    } catch (err) { res.status(500).json({ error: err.message }); }
    
  });
  

  
  app.post('/api/keys', authMiddleware, async (req, res) => {
    
    try {
      
      const { name, type } = req.body || {};
      
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre de la clave es obligatorio' });
      
      const keyType = type === 'gratuita' ? 'gratuita' : 'pago';
      
      const rawSecret = crypto.randomBytes(24).toString('hex');
      
      const fullKey = `sk-zoco-${rawSecret}`;
      
      const keyPrefix = `sk-zoco-${rawSecret.slice(0, 6)}`;
      
      const keyHash = crypto.createHash('sha256').update(fullKey).digest('hex');
      
      const id = uuidv4();
      
      db.prepare('INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, key_type) VALUES (?, ?, ?, ?, ?, ?)').run(id, req.auth.sub, String(name).trim(), keyPrefix, keyHash, keyType);
      
      res.status(201).json({ id, name: String(name).trim(), key: fullKey, type: keyType, createdAt: new Date().toISOString() });
      
    } catch (err) {
      
      console.error('[api/keys] creation failed:', err);
      
      res.status(500).json({ error: 'No se pudo crear la clave API' });
      
    }
    
  });
  

  
  app.get('/api/habilidades', authMiddleware, async (req, res) => {
    
    try {
      
      const habilidades = db.prepare("SELECT * FROM resources WHERE user_id = ? AND type = 'habilidad'").all(req.auth.sub);
      
      res.json(habilidades.map(h => ({ ...h, data: JSON.parse(h.data) })));
      
    } catch (err) { res.status(500).json({ error: err.message }); }
    
  });
  

  
  app.post('/api/habilidades', authMiddleware, async (req, res) => {
    
    try {
      
      const { name, data } = req.body || {};
      
      const id = uuidv4();
      
      db.prepare("INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, 'habilidad', ?, ?)").run(id, req.auth.sub, name, JSON.stringify(data || {}));
      
      res.status(201).json({ id, name, data: data || {} });
      
    } catch (err) { res.status(500).json({ error: err.message }); }
    
  });
  
}



























































