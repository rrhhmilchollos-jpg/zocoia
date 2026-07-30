/**
 * agent-stream.js
 * 
 * Implementación del bucle agéntico autónomo con E2B Desktop y Server-Sent Events (SSE).
 * Permite ejecutar comandos reales en un sandbox seguro y transmitir la salida en vivo.
 */

import pkg from '@e2b/desktop';
const { Sandbox: DesktopSandbox } = pkg;
import { logger } from './logger.js';

/**
 * Registra las rutas de streaming del agente autónomo
 */
export function registerAgentStreamRoutes(app, authMiddleware) {
  
  app.get('/api/agent/run/stream', authMiddleware, async (req, res) => {
    const { prompt } = req.query;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt es requerido' });
    }

    // Configurar cabeceras para SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (type, data) => {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let sandbox;
    try {
      sendEvent('status', { message: '🚀 Inicializando sandbox de E2B...' });
      
      sandbox = await DesktopSandbox.create({
        apiKey: process.env.E2B_API_KEY,
      });

      sendEvent('status', { message: '✅ Sandbox listo. Ejecutando comando...' });
      sendEvent('log', { message: `Prompt recibido: ${prompt}`, type: 'info' });

      // Simulación de bucle de pensamiento del agente
      // En una implementación real, aquí llamaríamos a un LLM para decidir qué comando ejecutar.
      // Por ahora, ejecutamos el prompt directamente si parece un comando, o un comando de prueba.
      
      const command = prompt.startsWith('!') ? prompt.slice(1) : `echo "Analizando: ${prompt}" && ls -la`;
      
      sendEvent('command', { command });

      const execution = await sandbox.commands.run(command, {
        onStdout: (data) => {
          sendEvent('stdout', { chunk: data });
        },
        onStderr: (data) => {
          sendEvent('stderr', { chunk: data });
        }
      });

      await execution.wait();

      sendEvent('status', { message: '🏁 Ejecución completada con éxito.' });
      sendEvent('done', { exitCode: execution.exitCode });

    } catch (err) {
      logger.error({ err }, 'Error en el bucle del agente autónomo');
      sendEvent('error', { message: err.message });
    } finally {
      if (sandbox) {
        await sandbox.close();
      }
      res.end();
    }
  });
}
