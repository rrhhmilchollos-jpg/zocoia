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
      {
        cwd: workspaceDir,
        timeout: Number(process.env.EXEC_CODE_TIMEOUT_MS || 60000),
        maxBuffer: Number(process.env.EXEC_CODE_MAX_BUFFER || 10 * 1024 * 1024),
        env: {},
      },
      async (error, stdout, stderr) => {
        await fs.unlink(tmpFile).catch(() => {});
        if (error && error.killed) {
          resolve({ success: false, error: `Timeout: la ejecución superó ${Number(process.env.EXEC_CODE_TIMEOUT_MS || 60000) / 1000}s` });
        } else if (error) {
          resolve({ success: false, error: stderr || error.message });
        } else {
          resolve({ success: true, stdout, stderr });
        }
      }
    );
  });
}

/**
 * Búsqueda web real vía Tavily. La clave NO se lee de variables de entorno
 * globales: se recibe en `context.tavilyApiKey`, que server.js resuelve por
 * usuario (leyendo su recurso 'credencial'/'habilidad' llamado TAVILY_API_KEY
 * antes de arrancar el tool loop). Así cada usuario usa su propia clave.
 * Nunca lanza: cualquier fallo (clave ausente, timeout, error de Tavily)
 * se devuelve como { success: false, error } para que el modelo lo explique
 * al usuario en vez de tumbar la petición con un 502.
 */
async function busquedaWeb(workspaceDir, { query }, context) {
  const apiKey = context?.tavilyApiKey;
  if (!apiKey) {
    return {
      success: false,
      // Mensaje deliberadamente directivo: algunos modelos (p.ej. DeepSeek-R1
      // vía Ollama) reciben un tool result de error y, en vez de aceptarlo,
      // vuelven a intentar la misma tool — esto se combina con el freno de
      // bucle de runToolLoop() más abajo, pero un texto claro aquí reduce
      // las probabilidades de que el modelo reintente en primer lugar.
      error: 'No hay una clave de Tavily configurada para este usuario, así que la búsqueda web NO está disponible ahora mismo. NO vuelvas a llamar a busqueda_web en este turno: responde directamente al usuario con tu propio conocimiento, e indícale que puede añadir una clave de Tavily en "Almacén de credenciales" (nombre TAVILY_API_KEY) para activar la búsqueda real.',
    };
  }
  if (!query || !query.trim()) {
    return { success: false, error: 'Falta el término de búsqueda (query). No reintentes la misma tool sin especificar un query válido.' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, include_answer: true, max_results: 5 }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      return {
        success: false,
        error: `Tavily respondió con error ${resp.status}: ${errBody.detail || errBody.error || 'token inválido o límite de cuota alcanzado'}`,
      };
    }

    const data = await resp.json();
    return {
      success: true,
      answer: data.answer || null,
      results: (data.results || []).slice(0, 5).map((r) => ({ title: r.title, url: r.url, content: r.content })),
    };
  } catch (err) {
    return {
      success: false,
      error: err.name === 'AbortError' ? 'Timeout al buscar en Tavily (10s)' : `No se pudo obtener respuesta de internet: ${err.message}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

const EXECUTORS = { createFile, createFolder, readFile, executeCode, busqueda_web: busquedaWeb };

/**
 * Ejecuta una tool ya autorizada para el agente.
 * workspacesRoot: carpeta raíz (persistente) de todos los workspaces
 * workspaceId: normalmente el agentId
 * allowedTools: array de nombres permitidos para este agente concreto
 * context: datos externos que algunas tools necesitan (ej: tavilyApiKey)
 */
export async function runTool(name, args, { workspacesRoot, workspaceId, allowedTools, context }) {
  if (!allowedTools.includes(name)) {
    return { success: false, error: `Tool "${name}" no permitida para este agente` };
  }
  const fn = EXECUTORS[name];
  if (!fn) return { success: false, error: `Tool "${name}" no existe` };

  try {
    const workspaceDir = await ensureWorkspace(workspacesRoot, workspaceId);
    return await fn(workspaceDir, args || {}, context);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

const MAX_TOOL_ITERATIONS = Number(process.env.MAX_TOOL_ITERATIONS || 25);

/**
 * Bucle de function-calling: llama al modelo, si pide tools las ejecuta,
 * reinyecta el resultado y repite. callModel debe ser una función:
 *   async (messages, tools) => rawResponseJson (formato OpenAI /chat/completions)
 * y debe encargarse ella misma de timeouts/fallback Ollama→Groq.
 * context: datos externos por-usuario que algunas tools necesitan (ej: tavilyApiKey).
 */
export async function runToolLoop({ messages, callModel, allowedTools, workspacesRoot, workspaceId, context }) {
  const tools = TOOL_DEFINITIONS.filter((t) => allowedTools.includes(t.function.name));
  const usageTotal = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let working = [...messages];

  // BLINDAJE — FRENO DE BUCLE: algunos modelos (DeepSeek-R1 vía Ollama en
  // particular) pueden quedarse pidiendo la misma tool una y otra vez si no
  // "aceptan" bien un resultado de error como final. En vez de esperar a
  // agotar las MAX_TOOL_ITERATIONS (25) vueltas reales -incluyendo llamadas
  // de red reales a Tavily cada vez-, se cuenta cuántas veces SEGUIDAS se
  // pide el mismo nombre de tool. Al superar el límite, se le devuelve un
  // resultado de tool que le prohíbe explícitamente reintentar, y en la
  // siguiente vuelta se le quitan las tools por completo (forceNoTools),
  // obligándolo a responder solo con texto.
  const MAX_CONSECUTIVE_SAME_TOOL = Number(process.env.MAX_CONSECUTIVE_SAME_TOOL || 2);
  let lastToolName = null;
  let consecutiveSameTool = 0;
  let forceNoTools = false;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const data = await callModel(working, !forceNoTools && tools.length ? tools : undefined);
    const usage = data.usage || {};
    usageTotal.prompt_tokens += usage.prompt_tokens || 0;
    usageTotal.completion_tokens += usage.completion_tokens || 0;
    usageTotal.total_tokens += usage.total_tokens || 0;

    const message = data.choices?.[0]?.message || {};

    if (message.tool_calls && message.tool_calls.length > 0 && !forceNoTools) {
      working.push({ role: 'assistant', content: message.content || null, tool_calls: message.tool_calls });

      for (const call of message.tool_calls) {
        const name = call.function?.name;
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || '{}');
        } catch {
          args = {};
        }

        consecutiveSameTool = name === lastToolName ? consecutiveSameTool + 1 : 1;
        lastToolName = name;

        if (consecutiveSameTool > MAX_CONSECUTIVE_SAME_TOOL) {
          // No se ejecuta de nuevo (evita otra llamada real de red/coste si
          // es busqueda_web u otra tool cara) — se corta aquí mismo con un
          // resultado explícito, y se desactivan las tools para el resto
          // del turno.
          forceNoTools = true;
          working.push({
            role: 'tool',
            tool_call_id: call.id,
            name,
            content: JSON.stringify({
              success: false,
              error: `Has llamado a "${name}" ${consecutiveSameTool} veces seguidas. Está BLOQUEADA por el resto de este turno. Responde ahora directamente al usuario en texto plano con la mejor respuesta que puedas dar con la información que ya tienes, sin pedir ninguna otra tool.`,
            }),
          });
          continue;
        }

        const result = await runTool(name, args, { workspacesRoot, workspaceId, allowedTools, context });
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
