/**
 * manus-agent/routes.js
 *
 * Expone el agente como endpoints Express, con rutas RELATIVAS (/run,
 * /run/stream) para poder montarse con prefijo y middleware propios en
 * server.js, sin afectar al resto de la app:
 *
 *   app.use('/api/agent', authMiddleware, createAgentRouter({ processChatCompletion }));
 *
 * Al ir detrás de authMiddleware, req.auth.sub (el usuario autenticado)
 * está disponible: el agente ejecuta las tareas "como" ese usuario,
 * usando el mismo motor de IA (y el mismo sistema de créditos) que el
 * resto del chat.
 *
 *   POST /api/agent/run         -> ejecuta la tarea y devuelve el JSON final
 *   POST /api/agent/run/stream  -> igual, pero transmite cada paso por SSE
 */

import { Router } from 'express';
import { runManusAgent } from './manusAgent.js';

function validateRequest(body) {
  const b = body || {};
  if (typeof b !== 'object') return { ok: false, error: 'Body vacío o inválido.' };
  if (!b.instructions || typeof b.instructions !== 'string') {
    return { ok: false, error: "Falta 'instructions' (string)." };
  }
  if (!b.repo_url || typeof b.repo_url !== 'string') {
    return { ok: false, error: "Falta 'repo_url' (string, URL de GitHub)." };
  }
  return {
    ok: true,
    data: {
      instructions: b.instructions,
      repo_url: b.repo_url,
      base_branch: b.base_branch,
      target_files: b.target_files,
      auto_deploy: Boolean(b.auto_deploy),
      create_pull_request: b.create_pull_request ?? true,
      github_token: b.github_token,
      max_steps: b.max_steps,
      model: b.model,
      agentId: b.agentId,
    },
  };
}

/**
 * @param {object} deps - { processChatCompletion } inyectado desde server.js.
 */
export function createAgentRouter(deps) {
  const router = Router();

  router.post('/run', async (req, res) => {
    const validation = validateRequest(req.body);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    try {
      const result = await runManusAgent(validation.data, {
        processChatCompletion: deps.processChatCompletion,
        authSub: req.auth?.sub,
      });
      return res.status(result.status === 'completed' ? 200 : 500).json(result);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Error desconocido en el agente.' });
    }
  });

  router.post('/run/stream', async (req, res) => {
    const validation = validateRequest(req.body);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await runManusAgent(
        validation.data,
        { processChatCompletion: deps.processChatCompletion, authSub: req.auth?.sub },
        (stepEvent) => send('step', stepEvent)
      );
      send('result', result);
    } catch (err) {
      send('error', { error: err instanceof Error ? err.message : 'Error desconocido.' });
    } finally {
      res.end();
    }
  });

  return router;
}
