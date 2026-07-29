import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { Sandbox as CodeSandbox } from '@e2b/code-interpreter';
import { Sandbox as DesktopSandbox } from '@e2b/desktop';
import { CONTROLAR_ORDENADOR_TOOL_SCHEMA } from './ollama-tools-schema.js';

/**
 * Raíz donde viven los "workspaces" de cada agente (uno por agentId).
 * Usamos el mismo directorio del volumen persistente donde ya vive app.db,
 * para que sobreviva a reinicios/redeploys en Railway.
 *
 * workspacesRoot debe pasarse desde server.js, calculado a partir de
 * path.dirname(DB_PATH), así no duplicamos esa lógica aquí.
 */
export function makeWorkspacesRoot(dbDir) {
  return path.join(dbDir, 'workspaces');
}

// ─── Definiciones de tools en formato OpenAI (Groq y Ollama /v1/chat/completions lo soportan) ───
export const TOOL_DEFINITIONS = [
  CONTROLAR_ORDENADOR_TOOL_SCHEMA,
  {
    type: 'function',
    function: {
      name: 'createFile',
      description:
        'Crea un archivo nuevo dentro del workspace del agente con el contenido indicado. Si ya existe, lo sobreescribe.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Ruta relativa del archivo, ej: "src/index.js"' },
          content: { type: 'string', description: 'Contenido de texto a escribir' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createFolder',
      description: 'Crea una carpeta (y subcarpetas necesarias) dentro del workspace del agente.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Ruta relativa de la carpeta a crear' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'readFile',
      description: 'Lee y devuelve el contenido de un archivo del workspace del agente.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Ruta relativa del archivo a leer' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listFiles',
      description: 'Lista los archivos y carpetas dentro de una ruta del workspace del agente (o de la raíz si no se indica ruta).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Ruta relativa a listar. Vacío para la raíz del workspace.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deleteFile',
      description: 'Elimina un archivo del workspace del agente.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Ruta relativa del archivo a eliminar' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'executeCode',
      description:
        'Ejecuta código Node.js o Python en un sandbox real aislado en la nube (E2B), no en este servidor. Mantiene estado entre llamadas dentro de la misma sesión de agente (variables, archivos, paquetes instalados). Úsalo para cálculo, scripts, pruebas o cualquier ejecución de código.',
      parameters: {
        type: 'object',
        properties: {
          language: { type: 'string', enum: ['node', 'python'] },
          code: { type: 'string' },
        },
        required: ['language', 'code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'abrirTerminalLinux',
      description:
        'Abre una terminal Linux real, segura e independiente en la nube usando el Sandbox de E2B. Úsala obligatoriamente cuando el usuario te pida ejecutar comandos Bash, ver directorios del sistema, instalar paquetes con npm, o comprobar qué se está ejecutando en el entorno.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'El comando bash exacto a ejecutar (ej: "ls -la", "npm install node-fetch")' },
        },
        required: ['command'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'gestionarPlan',
      description:
        'Gestiona el plan de tareas del agente (equivalente al "todo.md" de Manus). Úsalo OBLIGATORIAMENTE al empezar cualquier tarea con más de 2-3 pasos: primero "crear" el plan completo, luego "actualizar_paso" cada vez que termines o empieces uno, y "ver" cuando necesites recordar en qué punto vas. Esto es lo que te permite no perder el hilo en tareas largas.',
      parameters: {
        type: 'object',
        properties: {
          accion: { type: 'string', enum: ['crear', 'actualizar_paso', 'ver'], description: 'Qué operación hacer sobre el plan' },
          pasos: {
            type: 'array',
            items: { type: 'string' },
            description: 'Lista ordenada de pasos del plan (solo para accion=crear, sustituye cualquier plan anterior)',
          },
          indice: { type: 'number', description: 'Índice (empezando en 0) del paso a actualizar (solo para accion=actualizar_paso)' },
          estado: {
            type: 'string',
            enum: ['pendiente', 'en_progreso', 'hecho', 'bloqueado'],
            description: 'Nuevo estado del paso indicado (solo para accion=actualizar_paso)',
          },
        },
        required: ['accion'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'busqueda_web',
      description:
        'Busca información actualizada en internet usando Tavily. Úsala cuando necesites datos recientes, noticias, precios, fechas actuales, o cualquier información que pueda haber cambiado después del entrenamiento del modelo.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Términos de búsqueda' },
        },
        required: ['query'],
      },
    },
  },
];

export const ALL_TOOL_NAMES = TOOL_DEFINITIONS.map((t) => t.function.name);

const codeSandboxes = new Map(); // workspaceId -> CodeSandbox
const desktopSandboxes = new Map(); // workspaceId -> DesktopSandbox

const E2B_SANDBOX_TIMEOUT_MS = Number(process.env.E2B_SANDBOX_TIMEOUT_MS || 10 * 60 * 1000); // 10 min de vida del sandbox
const E2B_CALL_TIMEOUT_MS = Number(process.env.E2B_CALL_TIMEOUT_MS || 45 * 1000); // timeout duro por acción individual

function withHardTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout (${label}): sin respuesta tras ${ms / 1000}s`)), ms)),
  ]);
}

function emitLive(context, payload) {
  try {
    context?.onEvent?.({ workspaceId: context?.workspaceId, ...payload });
  } catch {
    // un fallo del listener del frontend nunca debe tumbar la ejecución de la tool
  }
}

async function getCodeSandbox(workspaceId, apiKey) {
  let sbx = codeSandboxes.get(workspaceId);
  if (sbx) {
    try {
      await sbx.setTimeout(E2B_SANDBOX_TIMEOUT_MS); // sigue viva, renovamos el TTL
      return sbx;
    } catch {
      codeSandboxes.delete(workspaceId); // se murió/expiró, se recrea abajo
    }
  }
  sbx = await withHardTimeout(
    CodeSandbox.create({ apiKey, timeoutMs: E2B_SANDBOX_TIMEOUT_MS }),
    E2B_CALL_TIMEOUT_MS,
    'crear sandbox de código'
  );
  codeSandboxes.set(workspaceId, sbx);
  return sbx;
}

async function getDesktopSandbox(workspaceId, apiKey) {
  let sbx = desktopSandboxes.get(workspaceId);
  if (sbx) {
    try {
      await sbx.setTimeout(E2B_SANDBOX_TIMEOUT_MS);
      return sbx;
    } catch {
      desktopSandboxes.delete(workspaceId);
    }
  }
  sbx = await withHardTimeout(
    DesktopSandbox.create({ apiKey, timeoutMs: E2B_SANDBOX_TIMEOUT_MS, resolution: [1280, 800] }),
    E2B_CALL_TIMEOUT_MS,
    'crear sandbox de escritorio'
  );
  await sbx.stream.start();
  desktopSandboxes.set(workspaceId, sbx);
  return sbx;
}

/**
 * Ejecuta código en un sandbox real de E2B (microVM aislada en la nube),
 * no en este servidor. Requiere context.e2bApiKey (resuelto por-usuario en
 * server.js igual que tavilyApiKey). Sin key configurada, falla con un
 * error claro en vez de silenciosamente caer a ejecución local insegura.
 */
async function executeCode(workspaceDir, { language, code }, context) {
  const apiKey = context?.e2bApiKey;
  if (!apiKey) {
    return {
      success: false,
      error: 'E2B_API_KEY no configurada. Añádela como credencial del usuario (E2B_API_KEY) para poder ejecutar código en el sandbox real.',
    };
  }

  try {
    const sbx = await getCodeSandbox(context.workspaceId, apiKey);
    const execution = await withHardTimeout(
      sbx.runCode(code ?? '', { language: language === 'python' ? 'python' : 'javascript' }),
      E2B_CALL_TIMEOUT_MS,
      'ejecución de código'
    );
    if (execution.error) {
      return { success: false, error: `${execution.error.name}: ${execution.error.value}\n${(execution.error.traceback || []).join('\n')}` };
    }
    return {
      success: true,
      logs: execution.logs.stderr.concat(execution.logs.stdout).join('\n'),
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function abrirTerminalLinux(workspaceDir, { command }, context) {
  const apiKey = context?.e2bApiKey;
  if (!apiKey) {
    return {
      success: false,
      error: 'E2B_API_KEY no configurada. Añádela como credencial del usuario (E2B_API_KEY) para poder ejecutar comandos en el sandbox real.',
    };
  }

  try {
    const sbx = await getCodeSandbox(context.workspaceId, apiKey);
    const proc = await withHardTimeout(sbx.process.start({ cmd: command ?? '' }), E2B_CALL_TIMEOUT_MS, 'ejecución de terminal');
    const output = await withHardTimeout(proc.wait(), E2B_CALL_TIMEOUT_MS, 'espera de terminal');

    if (output.exitCode !== 0) {
      return { success: false, error: output.stderr || `Comando falló con código ${output.exitCode}` };
    }
    return { success: true, logs: output.stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function runToolLoop(toolCall, workspaceId, context) {
  const toolName = toolCall.function.name;
  const toolArgs = toolCall.function.arguments;

  const toolsImplementations = {
    createFile: (args) => createFile(context.workspaceDir, args),
    createFolder: (args) => createFolder(context.workspaceDir, args),
    readFile: (args) => readFile(context.workspaceDir, args),
    listFiles: (args) => listFiles(context.workspaceDir, args),
    deleteFile: (args) => deleteFile(context.workspaceDir, args),
    executeCode: (args) => executeCode(context.workspaceDir, args, context),
    abrirTerminalLinux: (args) => abrirTerminalLinux(context.workspaceDir, args, context),
    controlarOrdenador: (args) => handleOrdenadorZocoAction(context.workspaceId, context.e2bApiKey, args, context.onEvent),
    gestionarPlan: (args) => gestionarPlan(context.workspaceDir, args, context),
    busqueda_web: (args) => busqueda_web(context.workspaceDir, args, context),
  };

  if (!toolsImplementations[toolName]) {
    throw new Error(`Tool ${toolName} no implementada.`);
  }

  return toolsImplementations[toolName](JSON.parse(toolArgs));
}

async function runDesktopTool(workspaceDir, { action, ...params }, context) {
  const apiKey = context?.e2bApiKey;
  if (!apiKey) {
    return {
      success: false,
      error: 'E2B_API_KEY no configurada. Añádela como credencial del usuario (E2B_API_KEY) para poder controlar el ordenador virtual.',
    };
  }

  const sbx = await getDesktopSandbox(context.workspaceId, apiKey);

  let result = {};
  let screenshot = null;
  let currentUrl = null;

  emitLive({ workspaceId: context.workspaceId, onEvent: context.onEvent }, { type: 'action_start', action, params });

  try {
    switch (action) {
      case 'navigate':
        if (!params.url) throw new Error('URL es requerida para la acción navigate.');
        emitLive({ workspaceId: context.workspaceId, onEvent: context.onEvent }, { type: 'navigate', url: params.url });
        await withHardTimeout(sbx.browser.goto(params.url), 30000, 'navigate');
        break;
      case 'click':
        if (typeof params.x !== 'number' || typeof params.y !== 'number') {
          throw new Error('Coordenadas x e y son requeridas para la acción click.');
        }
        emitLive({ workspaceId: context.workspaceId, onEvent: context.onEvent }, { type: 'click', x: params.x, y: params.y });
        await withHardTimeout(sbx.browser.click(params.x, params.y), 10000, 'click');
        break;
      case 'type':
        if (!params.text) throw new Error('Texto es requerido para la acción type.');
        emitLive({ workspaceId: context.workspaceId, onEvent: context.onEvent }, { type: 'type', text: params.text });
        await withHardTimeout(sbx.browser.type(params.text), 10000, 'type');
        break;
      case 'scroll':
        if (typeof params.amount !== 'number') {
          throw new Error('Cantidad de scroll es requerida para la acción scroll.');
        }
        emitLive({ workspaceId: context.workspaceId, onEvent: context.onEvent }, { type: 'scroll', amount: params.amount });
        await withHardTimeout(sbx.browser.scroll(params.amount), 10000, 'scroll');
        break;
      case 'screenshot':
        emitLive({ workspaceId: context.workspaceId, onEvent: context.onEvent }, { type: 'screenshot_request' });
        break;
      case 'get_url':
        emitLive({ workspaceId: context.workspaceId, onEvent: context.onEvent }, { type: 'get_url_request' });
        currentUrl = await withHardTimeout(sbx.browser.getURL(), 5000, 'get_url');
        result.url = currentUrl;
        break;
      default:
        throw new Error(`Acción no soportada: ${action}`);
    }

    if (action !== 'screenshot') {
      const screenshotBuffer = await withHardTimeout(sbx.browser.screenshot(), 20000, 'screenshot');
      screenshot = screenshotBuffer.toString('base64');
      emitLive({ workspaceId: context.workspaceId, onEvent: context.onEvent }, { type: 'screenshot_taken', size: screenshotBuffer.length });
    }

    if (!currentUrl) {
      currentUrl = await withHardTimeout(sbx.browser.getURL(), 5000, 'get_url_after_action');
      result.url = currentUrl;
    }

    emitLive({ workspaceId: context.workspaceId, onEvent: context.onEvent }, { type: 'action_success', action, result });
    return { success: true, screenshot, url: currentUrl, result };
  } catch (err) {
    console.error(`Error en acción de Ordenador de Zoco (${action}):`, err);
    emitLive({ workspaceId: context.workspaceId, onEvent: context.onEvent }, { type: 'action_error', action, error: err.message });
    return { success: false, error: err.message, screenshot: null, url: currentUrl };
  }
}

// Placeholder functions for now, will be implemented later or removed if not needed
async function gestionarPlan(workspaceDir, args, context) { return { success: true, message: 'gestionarPlan placeholder' }; }
async function busqueda_web(workspaceDir, args, context) { return { success: true, message: 'busqueda_web placeholder' }; }
