import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { Sandbox as CodeSandbox } from '@e2b/code-interpreter';
import { Sandbox as DesktopSandbox } from '@e2b/desktop';

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
      name: 'controlarOrdenador',
      description:
        'Controla el "Ordenador de Zoco": un escritorio virtual real en la nube (Linux + navegador) para tareas que requieren interactuar con páginas web como lo haría una persona. Usa "screenshot" SIEMPRE antes de decidir la siguiente acción y SIEMPRE después de una acción importante para verificar que ha surtido efecto — no asumas que un clic ha funcionado sin comprobarlo visualmente. La sesión persiste entre llamadas mientras dure la conversación.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'navigate',
              'click',
              'doubleClick',
              'rightClick',
              'type',
              'keyPress',
              'drag',
              'scroll',
              'moveMouse',
              'wait',
              'screenshot',
              'get_url',
            ],
            description: 'Acción a realizar en el ordenador virtual',
          },
          url: { type: 'string', description: 'URL a abrir (solo para action=navigate)' },
          x: { type: 'number', description: 'Coordenada X (para click, doubleClick, rightClick, moveMouse, o punto de origen de drag)' },
          y: { type: 'number', description: 'Coordenada Y (para click, doubleClick, rightClick, moveMouse, o punto de origen de drag)' },
          toX: { type: 'number', description: 'Coordenada X de destino (solo para action=drag)' },
          toY: { type: 'number', description: 'Coordenada Y de destino (solo para action=drag)' },
          text: { type: 'string', description: 'Texto a escribir (solo para action=type)' },
          key: {
            type: 'string',
            description:
              'Tecla o combinación a pulsar (solo para action=keyPress). Nombres simples en minúscula: "enter", "space", "backspace", "escape", "tab". Para combinaciones, sepáralas con "+": "ctrl+c", "ctrl+a".',
          },
          amount: { type: 'number', description: 'Cantidad de scroll, positivo=abajo (solo para action=scroll)' },
          ms: { type: 'number', description: 'Milisegundos a esperar (solo para action=wait, por defecto 1000)' },
        },
        required: ['action'],
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

function resolveSafePath(workspaceDir, relativePath) {
  const target = path.join(workspaceDir, relativePath || '');
  if (!target.startsWith(workspaceDir)) {
    throw new Error('Ruta inválida: intento de salir del workspace');
  }
  return target;
}

async function ensureWorkspace(workspacesRoot, workspaceId) {
  const dir = path.join(workspacesRoot, workspaceId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function createFile(workspaceDir, { path: relPath, content }) {
  const target = resolveSafePath(workspaceDir, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content ?? '', 'utf8');
  return { success: true, path: relPath, bytesWritten: Buffer.byteLength(content ?? '') };
}

async function createFolder(workspaceDir, { path: relPath }) {
  const target = resolveSafePath(workspaceDir, relPath);
  await fs.mkdir(target, { recursive: true });
  return { success: true, path: relPath };
}

async function readFile(workspaceDir, { path: relPath }) {
  const target = resolveSafePath(workspaceDir, relPath);
  try {
    const content = await fs.readFile(target, 'utf8');
    return { success: true, path: relPath, content };
  } catch {
    return { success: false, path: relPath, error: 'Archivo no encontrado o ilegible' };
  }
}

/**
 * Sesiones de sandbox E2B activas, una por workspace (= por agente/conversación).
 * En memoria del proceso: si el servidor se reinicia se pierden y se crean
 * de nuevo en la siguiente llamada — es una limitación aceptada de la v1,
 * no persistimos sandboxes vivos en la base de datos.
 */
const codeSandboxes = new Map(); // workspaceId -> CodeSandbox
const desktopSandboxes = new Map(); // workspaceId -> DesktopSandbox

const E2B_SANDBOX_TIMEOUT_MS = Number(process.env.E2B_SANDBOX_TIMEOUT_MS || 10 * 60 * 1000); // 10 min de vida del sandbox
const E2B_CALL_TIMEOUT_MS = Number(process.env.E2B_CALL_TIMEOUT_MS || 45 * 1000); // timeout duro por acción individual

/**
 * Envuelve cualquier llamada a E2B con un timeout duro propio, independiente
 * del timeout interno del SDK — así, si Ollama está saturado reenviando
 * peticiones o E2B tarda en responder, el hilo del chat nunca se queda
 * colgado: a los E2B_CALL_TIMEOUT_MS se devuelve error y el modelo puede
 * reintentar en la siguiente vuelta del tool loop en vez de bloquear.
 */
function withHardTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout (${label}): sin respuesta tras ${ms / 1000}s`)), ms)),
  ]);
}

/**
 * Emite un evento en vivo hacia el frontend (panel "Ordenador de Zoco"),
 * IGUAL que el `emit(sessionId, {...})` que viste en el ordenador de Manus.
 * context.onEvent es opcional: si server.js no lo pasa (ej. modo API sin
 * websocket/SSE abierto), simplemente no se emite nada y todo sigue
 * funcionando igual — nunca lanza ni bloquea la ejecución de la tool.
 */
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
 
