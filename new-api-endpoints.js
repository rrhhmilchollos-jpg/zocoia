/**
 * Nuevos Endpoints del Backend para Zocoia
 * Incluye: Gestión de Agentes, Validación de API Keys, Gestión de Herramientas
 * 
 * Estos endpoints deben añadirse a server.js después de la configuración de middleware
 */

import { validateApiKey, encryptApiKey, decryptApiKey, maskApiKey } from './api-key-validator.js';
import { validateToolData, createToolData, validateAgentTools, getAgentTools, updateAgentTools } from './tools-manager.js';

/**
 * Registra todos los nuevos endpoints en la aplicación Express
 */
export function registerNewApiEndpoints(app, db, authMiddleware) {
  
  // ==================== ENDPOINTS DE AGENTES ====================

  /**
   * GET /api/agents/:id
   * Obtiene un agente específico con su configuración completa
   */
  app.get('/api/agents/:id', authMiddleware, (req, res) => {
    try {
      const { id } = req.params;
      const agent = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?')
        .get(id, req.auth.sub, 'agente');

      if (!agent) {
        return res.status(404).json({ error: 'Agente no encontrado' });
      }

      const agentData = typeof agent.data === 'string' ? JSON.parse(agent.data) : agent.data || {};
      
      res.json({
        id: agent.id,
        name: agent.name,
        type: agent.type,
        data: agentData,
        createdAt: agent.created_at,
        updatedAt: agent.updated_at,
      });
    } catch (err) {
      console.error('Error getting agent:', err);
      res.status(500).json({ error: 'Error al obtener el agente' });
    }
  });

  /**
   * PUT /api/agents/:id/config
   * Actualiza la configuración avanzada de un agente
   */
  app.put('/api/agents/:id/config', authMiddleware, (req, res) => {
    try {
      const { id } = req.params;
      const { systemPrompt, temperatura, contexto, penalizaciones } = req.body;

      const agent = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?')
        .get(id, req.auth.sub, 'agente');

      if (!agent) {
        return res.status(404).json({ error: 'Agente no encontrado' });
      }

      const agentData = typeof agent.data === 'string' ? JSON.parse(agent.data) : agent.data || {};
      
      // Actualizar solo los campos proporcionados
      if (systemPrompt !== undefined) agentData.systemPrompt = systemPrompt;
      if (temperatura !== undefined) agentData.temperatura = parseFloat(temperatura);
      if (contexto !== undefined) agentData.contexto = parseInt(contexto);
      if (penalizaciones !== undefined) agentData.penalizaciones = penalizaciones;

      db.prepare('UPDATE resources SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(JSON.stringify(agentData), id);

      res.json({
        id: agent.id,
        name: agent.name,
        data: agentData,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error updating agent config:', err);
      res.status(500).json({ error: 'Error al actualizar la configuración del agente' });
    }
  });

  // ==================== ENDPOINTS DE API KEYS (CLAVES EXTERNAS) ====================
  // IMPORTANTE: estos endpoints gestionan claves de API de PROVEEDORES EXTERNOS
  // que el propio usuario aporta (ej. su propia clave de OpenAI/Anthropic/etc.),
  // NO las claves de Zoco IA que genera el propio sistema (esas viven en
  // server.js bajo la misma ruta base /api/keys, sin /external).
  //
  // CORREGIDO: antes este archivo registraba también POST /api/keys (sin
  // /external), colisionando con la definición real de server.js que crea
  // las claves sk-zoco-... a partir de { name, type }. Como este módulo se
  // registra ANTES en server.js, Express usaba SIEMPRE esta versión (que
  // exige { name, apiKey, provider }), y el formulario real del frontend
  // (que solo envía "name" y "type") recibía el error "Nombre, API Key y
  // proveedor son requeridos" sin poder crear nunca una clave de Zoco IA.
  // Renombrado a /api/keys/external para eliminar el conflicto de rutas.

  /**
   * POST /api/keys/validate
   * Valida una API Key de un proveedor externo antes de guardarla
   */
  app.post('/api/keys/validate', authMiddleware, async (req, res) => {
    try {
      const { apiKey, provider } = req.body;

      if (!apiKey || !provider) {
        return res.status(400).json({ error: 'API Key y proveedor son requeridos' });
      }

      const validation = await validateApiKey(apiKey, provider);

      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      res.json({ valid: true, provider: validation.provider });
    } catch (err) {
      console.error('Error validating API key:', err);
      res.status(500).json({ error: 'Error al validar la API Key' });
    }
  });

  /**
   * POST /api/keys/external
   * Guarda una API Key de un proveedor externo (traída por el propio usuario),
   * validándola primero. Distinto de POST /api/keys (server.js), que genera
   * claves propias de Zoco IA (sk-zoco-...).
   */
  app.post('/api/keys/external', authMiddleware, async (req, res) => {
    try {
      const { name, apiKey, provider } = req.body;

      if (!name || !apiKey || !provider) {
        return res.status(400).json({ error: 'Nombre, API Key y proveedor son requeridos' });
      }

      // Validar la API Key
      const validation = await validateApiKey(apiKey, provider);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      // Encriptar la API Key
      let encryptedKey;
      try {
        encryptedKey = encryptApiKey(apiKey);
      } catch (err) {
        console.error('Encryption error:', err);
        return res.status(500).json({ error: 'Error al encriptar la clave' });
      }

      // Generar prefijo y sufijo para visualización
      const displayKey = maskApiKey(apiKey);

      // Guardar en la base de datos
      const keyId = require('uuid').v4();
      db.prepare(`
        INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, api_provider, api_key_full, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        keyId,
        req.auth.sub,
        name,
        apiKey.substring(0, 3),
        require('crypto').createHash('sha256').update(apiKey).digest('hex'),
        provider,
        encryptedKey
      );

      res.status(201).json({
        id: keyId,
        name,
        display: displayKey,
        provider,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error creating external API key:', err);
      res.status(500).json({ error: 'Error al crear la API Key externa' });
    }
  });

  /**
   * GET /api/keys/:id/copy
   * Obtiene la clave completa para copiar al portapapeles (solo una vez)
   */
  app.get('/api/keys/:id/copy', authMiddleware, (req, res) => {
    try {
      const { id } = req.params;

      const key = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?')
        .get(id, req.auth.sub);

      if (!key) {
        return res.status(404).json({ error: 'Clave no encontrada' });
      }

      if (key.revoked) {
        return res.status(400).json({ error: 'Esta clave ha sido revocada' });
      }

      try {
        const decryptedKey = decryptApiKey(key.api_key_full);
        res.json({ key: decryptedKey });
      } catch (err) {
        console.error('Decryption error:', err);
        res.status(500).json({ error: 'Error al desencriptar la clave' });
      }
    } catch (err) {
      console.error('Error copying API key:', err);
      res.status(500).json({ error: 'Error al obtener la clave' });
    }
  });

  // ==================== ENDPOINTS DE HERRAMIENTAS ====================

  /**
   * POST /api/tools
   * Crea una nueva herramienta
   */
  app.post('/api/tools', authMiddleware, (req, res) => {
    try {
      const { name, description, jsonSchema } = req.body;

      // Validar datos
      const validation = validateToolData(name, description, jsonSchema);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.errors.join('; ') });
      }

      // Crear herramienta normalizada
      const toolData = createToolData(name, description, jsonSchema);

      // Guardar como recurso de tipo 'habilidad'
      const toolId = require('uuid').v4();
      db.prepare(`
        INSERT INTO resources (id, user_id, type, name, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        toolId,
        req.auth.sub,
        'habilidad',
        name,
        JSON.stringify(toolData)
      );

      res.status(201).json({
        id: toolId,
        name,
        description,
        jsonSchema: toolData.jsonSchema,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error creating tool:', err);
      res.status(500).json({ error: err.message || 'Error al crear la herramienta' });
    }
  });

  /**
   * PUT /api/tools/:id
   * Actualiza una herramienta existente
   */
  app.put('/api/tools/:id', authMiddleware, (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, jsonSchema } = req.body;

      const tool = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?')
        .get(id, req.auth.sub, 'habilidad');

      if (!tool) {
        return res.status(404).json({ error: 'Herramienta no encontrada' });
      }

      // Validar datos
      const validation = validateToolData(name || tool.name, description, jsonSchema);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.errors.join('; ') });
      }

      // Crear herramienta normalizada
      const toolData = createToolData(name || tool.name, description, jsonSchema);

      db.prepare('UPDATE resources SET name = ?, data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(name || tool.name, JSON.stringify(toolData), id);

      res.json({
        id,
        name: name || tool.name,
        description,
        jsonSchema: toolData.jsonSchema,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error updating tool:', err);
      res.status(500).json({ error: err.message || 'Error al actualizar la herramienta' });
    }
  });

  /**
   * DELETE /api/tools/:id
   * Elimina una herramienta
   */
  app.delete('/api/tools/:id', authMiddleware, (req, res) => {
    try {
      const { id } = req.params;

      const tool = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?')
        .get(id, req.auth.sub, 'habilidad');

      if (!tool) {
        return res.status(404).json({ error: 'Herramienta no encontrada' });
      }

      db.prepare('DELETE FROM resources WHERE id = ?').run(id);

      res.json({ success: true, message: 'Herramienta eliminada' });
    } catch (err) {
      console.error('Error deleting tool:', err);
      res.status(500).json({ error: 'Error al eliminar la herramienta' });
    }
  });

  // ==================== ENDPOINTS DE ASIGNACIÓN DE HERRAMIENTAS ====================

  /**
   * PUT /api/agents/:id/tools
   * Asigna herramientas a un agente
   */
  app.put('/api/agents/:id/tools', authMiddleware, (req, res) => {
    try {
      const { id } = req.params;
      const { toolIds } = req.body;

      const agent = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?')
        .get(id, req.auth.sub, 'agente');

      if (!agent) {
        return res.status(404).json({ error: 'Agente no encontrado' });
      }

      // Obtener todas las herramientas disponibles del usuario
      const availableTools = db.prepare('SELECT id FROM resources WHERE user_id = ? AND type = ?')
        .all(req.auth.sub, 'habilidad');

      // Validar que las herramientas existan
      const validation = validateAgentTools(toolIds || [], availableTools);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      // Actualizar el agente
      const agentData = typeof agent.data === 'string' ? JSON.parse(agent.data) : agent.data || {};
      const updatedData = updateAgentTools(agentData, toolIds);

      db.prepare('UPDATE resources SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(JSON.stringify(updatedData), id);

      res.json({
        id,
        name: agent.name,
        tools: toolIds,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error assigning tools:', err);
      res.status(500).json({ error: 'Error al asignar herramientas' });
    }
  });

  /**
   * GET /api/agents/:id/tools
   * Obtiene las herramientas asignadas a un agente
   */
  app.get('/api/agents/:id/tools', authMiddleware, (req, res) => {
    try {
      const { id } = req.params;

      const agent = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?')
        .get(id, req.auth.sub, 'agente');

      if (!agent) {
        return res.status(404).json({ error: 'Agente no encontrado' });
      }

      const agentData = typeof agent.data === 'string' ? JSON.parse(agent.data) : agent.data || {};
      const toolIds = agentData.herramientasAsociadas || [];

      // Obtener detalles de las herramientas
      const tools = db.prepare(`
        SELECT id, name, data FROM resources 
        WHERE user_id = ? AND type = ? AND id IN (${toolIds.map(() => '?').join(',')})
      `).all(req.auth.sub, 'habilidad', ...toolIds);

      res.json({
        agentId: id,
        tools: tools.map(t => ({
          id: t.id,
          name: t.name,
          data: typeof t.data === 'string' ? JSON.parse(t.data) : t.data,
        })),
      });
    } catch (err) {
      console.error('Error getting agent tools:', err);
      res.status(500).json({ error: 'Error al obtener las herramientas del agente' });
    }
  });
}

export default registerNewApiEndpoints;
