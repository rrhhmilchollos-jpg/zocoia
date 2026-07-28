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
        'Controla un ordenador virtual real en la nube (escritorio Linux con navegador) para tareas que requieren interactuar con páginas web como lo haría una persona: abrir una URL, hacer clic, escribir texto, hacer scroll o mirar la pantalla. Usa "screenshot" para ver el estado actual antes de decidir la siguiente acción. La sesión persiste entre llamadas mientras dure la conversación.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['navigate', 'click', 'type', 'scroll', 'screenshot', 'get_url'],
            description: 'Acción a realizar en el ordenador virtual',
          },
          url: { type: 'string', description: 'URL a abrir (solo para action=navigate)' },
          x: { type: 'number', description: 'Coordenada X del clic (solo para action=click)' },
          y: { type: 'number', description: 'Coordenada Y del clic (solo para action=click)' },
          text: { type: 'string', description: 'Texto a escribir (solo para action=type)' },
          amount: { type: 'number', description: 'Cantidad de scroll, positivo=abajo (solo para action=scroll)' },
        },
        required: ['action'],
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
      stdout: execution.logs?.stdout?.join('\n') || execution.text || '',
      stderr: execution.logs?.stderr?.join('\n') || '',
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Abre/reutiliza una terminal Linux real dentro del MISMO sandbox de código
 * que usa `executeCode` (comparten el mapa `codeSandboxes` por workspaceId),
 * para no gastar créditos duplicados levantando dos microVMs por agente.
 * Usa la API nativa de comandos del SDK de code-interpreter
 * (`sbx.commands.run`), que ejecuta el comando en el sistema de archivos
 * persistente del sandbox y devuelve stdout/stderr/exitCode reales.
 */
async function abrirTerminalLinux(workspaceDir, { command }, context) {
  const apiKey = context?.e2bApiKey;
  if (!apiKey) {
    return {
      success: false,
      error: 'E2B_API_KEY no configurada. Añádela como credencial del usuario (E2B_API_KEY) para poder usar la terminal Linux real.',
    };
  }
  if (!command || !command.trim()) {
    return { success: false, error: 'Falta "command": el comando bash exacto a ejecutar' };
  }

  try {
    const sbx = await getCodeSandbox(context.workspaceId, apiKey);
    const execution = await withHardTimeout(
      sbx.commands.run(command),
      E2B_CALL_TIMEOUT_MS,
      'ejecución de comando en terminal'
    );
    return {
      success: true,
      command,
      stdout: execution.stdout || '',
      stderr: execution.stderr || '',
      exitCode: execution.exitCode ?? 0,
    };
  } catch (err) {
    // sbx.commands.run lanza si el comando devuelve un exit code distinto de 0
    // (a diferencia de runCode, que devuelve el error dentro del objeto).
    // Se captura aquí para no romper el tool loop y devolver stdout/stderr
    // parciales si el SDK los incluye en el error.
    return {
      success: false,
      command,
      error: err.message,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.exitCode ?? 1,
    };
  }
}

/**
 * Controla un escritorio virtual real (E2B Desktop Sandbox) — el mismo tipo
 * de "ordenador" que usa Manus por debajo. Cada acción devuelve también
 * `liveViewUrl`: la URL de streaming VNC en vivo, para poder enseñársela al
 * usuario en el frontend igual que el panel "Manus's Computer".
 */
async function controlarOrdenador(workspaceDir, { action, url, x, y, text, amount }, context) {
  const apiKey = context?.e2bApiKey;
  if (!apiKey) {
    return {
      success: false,
      error: 'E2B_API_KEY no configurada. Añádela como credencial del usuario (E2B_API_KEY) para poder usar el ordenador virtual.',
    };
  }

  try {
    const sbx = await getDesktopSandbox(context.workspaceId, apiKey);
    const liveViewUrl = sbx.stream.getUrl();

    const run = (p) => withHardTimeout(p, E2B_CALL_TIMEOUT_MS, `acción de escritorio (${action})`);

    switch (action) {
      case 'navigate': {
        if (!url) return { success: false, error: 'Falta "url" para action=navigate' };
        await run(sbx.commands.run(`xdotool search --name "Chromium" windowactivate || (google-chrome --new-window "${url}" &)`));
        await run(sbx.launch ? sbx.launch('google-chrome') : Promise.resolve());
        await new Promise((r) => setTimeout(r, 2000));
        return { success: true, action, url, liveViewUrl };
      }
      case 'click':
        if (x == null || y == null) return { success: false, error: 'Faltan "x"/"y" para action=click' };
        await run(sbx.leftClick(x, y));
        return { success: true, action, x, y, liveViewUrl };
      case 'type':
        if (!text) return { success: false, error: 'Falta "text" para action=type' };
        await run(sbx.write(text));
        return { success: true, action, liveViewUrl };
      case 'scroll':
        await run(sbx.scroll(amount ?? 5));
        return { success: true, action, liveViewUrl };
      case 'screenshot': {
        const img = await run(sbx.screenshot());
        return { success: true, action, screenshotBase64: Buffer.from(img).toString('base64'), liveViewUrl };
      }
      case 'get_url':
        return { success: true, action, liveViewUrl };
      default:
        return { success: false, error: `Acción "${action}" no soportada` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function listFiles(workspaceDir, { path: relPath }) {
  const target = resolveSafePath(workspaceDir, relPath || '.');
  try {
    const entries = await fs.readdir(target, { withFileTypes: true });
    return {
      success: true,
      path: relPath || '.',
      items: entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' })),
    };
  } catch {
    return { success: false, path: relPath || '.', error: 'Carpeta no encontrada' };
  }
}

async function deleteFile(workspaceDir, { path: relPath }) {
  const target = resolveSafePath(workspaceDir, relPath);
  try {
    await fs.unlink(target);
    return { success: true, path: relPath };
  } catch {
    return { success: false, path: relPath, error: 'Archivo no encontrado o no se pudo eliminar' };
  }
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
/**
 * Fallback gratuito (sin API key) vía DuckDuckGo, para que la tool
 * busqueda_web funcione desde el primer momento aunque el usuario no se
 * haya dado de alta todavía en Tavily. Menos completo que Tavily (sin
 * `answer` sintetizado), pero da resultados reales sin fricción de setup.
 */
async function duckDuckGoFallback(query) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZocoIA/1.0)' },
      signal: controller.signal,
    });
    if (!resp.ok) return { success: false, error: `DuckDuckGo respondió ${resp.status}` };
    const html = await resp.text();
    const snippets = [...html.matchAll(/<a class="result__snippet"[^>]*>(.*?)<\/a>/gs)]
      .slice(0, 5)
      .map((m) => m[1].replace(/<[^>]+>/g, '').trim())
      .filter(Boolean);
    if (!snippets.length) return { success: false, error: 'Sin resultados' };
    return {
      success: true,
      source: 'duckduckgo-fallback',
      answer: null,
      results: snippets.map((s) => ({ title: null, url: null, content: s })),
    };
  } catch (err) {
    return { success: false, error: err.name === 'AbortError' ? 'Timeout en DuckDuckGo (8s)' : err.message };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function busquedaWeb(workspaceDir, { query }, context) {
  if (!query || !query.trim()) {
    return { success: false, error: 'Falta el término de búsqueda (query)' };
  }

  const apiKey = context?.tavilyApiKey;
  if (!apiKey) {
    // Sin Tavily configurado: se usa el fallback gratuito en vez de fallar.
    return duckDuckGoFallback(query);
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
      // Tavily falló (cuota agotada, key inválida...): en vez de devolver el
      // error tal cual, se intenta el fallback gratuito antes de rendirse.
      const fallback = await duckDuckGoFallback(query);
      if (fallback.success) return fallback;
      const errBody = await resp.json().catch(() => ({}));
      return {
        success: false,
        error: `Tavily respondió con error ${resp.status}: ${errBody.detail || errBody.error || 'token inválido o límite de cuota alcanzado'}`,
      };
    }

    const data = await resp.json();
    return {
      success: true,
      source: 'tavily',
      answer: data.answer || null,
      results: (data.results || []).slice(0, 5).map((r) => ({ title: r.title, url: r.url, content: r.content })),
    };
  } catch (err) {
    const fallback = await duckDuckGoFallback(query);
    if (fallback.success) return fallback;
    return {
      success: false,
      error: err.name === 'AbortError' ? 'Timeout al buscar en Tavily (10s)' : `No se pudo obtener respuesta de internet: ${err.message}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

const EXECUTORS = {
  createFile,
  createFolder,
  readFile,
  listFiles,
  deleteFile,
  executeCode,
  abrirTerminalLinux,
  controlarOrdenador,
  busqueda_web: busquedaWeb,
};

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
        // Parche Zoco IA: Resiliencia ante alucinaciones de herramientas.
        // Si el modelo inventa una tool de búsqueda inexistente, se redirige
        // a la herramienta real 'busqueda_web' en vez de fallar.
        let nombreFinal = name;
        if (nombreFinal && !allowedTools.includes(nombreFinal) && (nombreFinal.includes('search') || nombreFinal.includes('brave') || nombreFinal.includes('google'))) {
          console.log('🔄 Redirigiendo alucinación de herramienta "' + nombreFinal + '" a busqueda_web...');
          nombreFinal = 'busqueda_web';
        }
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || '{}');
        } catch {
          args = {};
        }
        const result = await runTool(nombreFinal, args, { workspacesRoot, workspaceId, allowedTools, context });
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
