import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';

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
      name: 'executeCode',
      description:
        'Ejecuta código Node.js o Python en un entorno aislado del workspace y devuelve stdout/stderr. Solo para cálculo o pruebas, nunca acciones irreversibles.',
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
 * AVISO DE SEGURIDAD: ejecución vía child_process con timeout y sin heredar
 * variables de entorno del servidor. Suficiente para un entorno interno de
 * confianza, pero NO es aislamiento real (no hay límites de CPU/RAM/red ni
 * separación de kernel). Si algún día usuarios no confiables pueden invocar
 * agentes con executeCode habilitado, esto debería moverse a un contenedor
 * desechable por ejecución (Docker/Firecracker) o a un sandbox externo tipo
 * E2B/Modal antes de exponerlo en producción.
 */
async function executeCode(workspaceDir, { language, code }) {
  const tmpFile = path.join(workspaceDir, `__exec_${Date.now()}.${language === 'python' ? 'py' : 'js'}`);
  await fs.writeFile(tmpFile, code ?? '', 'utf8');
  const command = language === 'python' ? 'python3' : 'node';

  return new Promise((resolve) => {
    execFile(
      command,
      [tmpFile],
      { cwd: workspaceDir, timeout: 8000, maxBuffer: 1024 * 1024, env: {} },
      async (error, stdout, stderr) => {
        await fs.unlink(tmpFile).catch(() => {});
        if (error && error.killed) {
          resolve({ success: false, error: 'Timeout: la ejecución superó 8 segundos' });
        } else if (error) {
          resolve({ success: false, error: stderr || error.message });
        } else {
          resolve({ success: true, stdout, stderr });
        }
      }
    );
  });
}

const EXECUTORS = { createFile, createFolder, readFile, executeCode };

/**
 * Ejecuta una tool ya autorizada para el agente.
 * workspacesRoot: carpeta raíz (persistente) de todos los workspaces
 * workspaceId: normalmente el agentId
 * allowedTools: array de nombres permitidos para este agente concreto
 */
export async function runTool(name, args, { workspacesRoot, workspaceId, allowedTools }) {
  if (!allowedTools.includes(name)) {
    return { success: false, error: `Tool "${name}" no permitida para este agente` };
  }
  const fn = EXECUTORS[name];
  if (!fn) return { success: false, error: `Tool "${name}" no existe` };

  try {
    const workspaceDir = await ensureWorkspace(workspacesRoot, workspaceId);
    return await fn(workspaceDir, args || {});
  } catch (err) {
    return { success: false, error: err.message };
  }
}

const MAX_TOOL_ITERATIONS = 5;

/**
 * Bucle de function-calling: llama al modelo, si pide tools las ejecuta,
 * reinyecta el resultado y repite. callModel debe ser una función:
 *   async (messages, tools) => rawResponseJson (formato OpenAI /chat/completions)
 * y debe encargarse ella misma de timeouts/fallback Ollama→Groq.
 */
export async function runToolLoop({ messages, callModel, allowedTools, workspacesRoot, workspaceId }) {
  const tools = TOOL_DEFINITIONS.filter((t) => allowedTools.includes(t.function.name));
  const usageTotal = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let working = [...messages];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const data = await callModel(working, tools.length ? tools : undefined);
    const usage = data.usage || {};
    usageTotal.prompt_tokens += usage.prompt_tokens || 0;
    usageTotal.completion_tokens += usage.completion_tokens || 0;
    usageTotal.total_tokens += usage.total_tokens || 0;

    const message = data.choices?.[0]?.message || {};

    if (message.tool_calls && message.tool_calls.length > 0) {
      working.push({ role: 'assistant', content: message.content || null, tool_calls: message.tool_calls });

      for (const call of message.tool_calls) {
        const name = call.function?.name;
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || '{}');
        } catch {
          args = {};
        }
        const result = await runTool(name, args, { workspacesRoot, workspaceId, allowedTools });
        working.push({
          role: 'tool',
          tool_call_id: call.id,
          name,
          content: JSON.stringify(result),
        });
      }
      continue; // siguiente vuelta del loop con el resultado ya disponible
    }

    return { finalMessage: message.content || '', usage: usageTotal };
  }

  return {
    finalMessage: 'He ejecutado varias acciones pero necesito más contexto para continuar. ¿Puedes darme más detalles?',
    usage: usageTotal,
  };
}
