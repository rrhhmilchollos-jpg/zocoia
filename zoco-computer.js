// zoco-computer.js — "El Ordenador de Zoco": sistema completo de agente
// autónomo estilo Manus para zocoia.es.
// -----------------------------------------------------------------------------
// Replica el flujo de trabajo de un agente general autónomo de 0 a 100%:
//
//   1. PLANIFICACIÓN   — al recibir una tarea, el agente genera un plan de
//                        fases (visible y actualizable en vivo).
//   2. BUCLE AGÉNTICO  — itera: pensar → elegir herramienta → ejecutar →
//                        observar resultado → seguir, hasta completar la tarea.
//   3. HERRAMIENTAS    — shell (sandbox), archivos (workspace por tarea),
//                        búsqueda web, lectura de páginas web, gestión del
//                        plan y mensajes al usuario.
//   4. EVENTOS EN VIVO — cada acción se retransmite por SSE al frontend
//                        (panel "Ordenador de Zoco" tipo Manus: terminal,
//                        editor, navegador).
//   5. PERSISTENCIA    — tareas, mensajes, eventos y plan en SQLite; el
//                        historial sobrevive a recargas y reinicios.
//
// Sin dependencias nuevas: usa fetch nativo de Node 18+, child_process,
// better-sqlite3 (ya presente) y SSE estándar de Express.
// -----------------------------------------------------------------------------

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';

// ─── Configuración ───────────────────────────────────────────────────────────

const MAX_ITERATIONS = parseInt(process.env.COMPUTER_MAX_ITERATIONS || '30', 10);
const SHELL_TIMEOUT_MS = parseInt(process.env.COMPUTER_SHELL_TIMEOUT_MS || '120000', 10);
const MAX_OUTPUT_CHARS = 12000;
const MODEL_TIMEOUT_MS = parseInt(process.env.COMPUTER_MODEL_TIMEOUT_MS || '300000', 10);

// ─── Prompt de sistema del agente ────────────────────────────────────────────

export function buildComputerSystemPrompt({ taskTitle }) {
  const fecha = new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  return `Eres Zoco, un agente de IA general y autónomo creado por Zoco IA (zocoia.es).

Operas dentro de "El Ordenador de Zoco": un entorno de trabajo aislado con
acceso a terminal Linux, sistema de archivos, búsqueda web y lector de páginas.

Fecha actual: ${fecha}. Idioma de trabajo: español.

<bucle_de_agente>
Trabajas en un bucle iterativo hasta completar la tarea:
1. Analiza el estado actual y el objetivo.
2. Si la tarea es compleja, crea/actualiza un plan de fases con "gestionar_plan".
3. Ejecuta UNA herramienta por iteración y observa su resultado real.
4. Itera con paciencia: corrige errores, prueba alternativas, nunca inventes resultados.
5. Cuando la tarea esté completa, llama a "entregar_resultado" con el resumen
   final y las rutas de los archivos generados.
</bucle_de_agente>

<reglas>
- SIEMPRE responde llamando a una herramienta. Nunca respondas solo con texto.
- Crea un plan con "gestionar_plan" al inicio de cualquier tarea no trivial y
  marca las fases como completadas a medida que avanzas.
- Usa "mensaje_usuario" para informar de avances importantes (breve, 1-2 frases).
- Los comandos de terminal deben ser no interactivos (flags -y, --yes, etc.).
- Guarda los entregables como archivos en el workspace (informes en .md,
  código en su extensión, datos en .csv/.json).
- Si un comando falla, lee el error real y corrige; no repitas lo mismo.
- Usa "busqueda_web" + "leer_pagina" para información actualizada; cita fuentes.
- Al terminar llama SIEMPRE a "entregar_resultado". Es la única forma de
  finalizar la tarea correctamente.
</reglas>

Tarea actual: ${taskTitle}`;
}

// ─── Definición de herramientas (formato OpenAI function calling) ────────────

export const COMPUTER_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'gestionar_plan',
      description: 'Crea o actualiza el plan de fases de la tarea. Úsalo al empezar y cada vez que completes una fase.',
      parameters: {
        type: 'object',
        properties: {
          fases: {
            type: 'array',
            description: 'Lista completa de fases del plan',
            items: {
              type: 'object',
              properties: {
                titulo: { type: 'string', description: 'Título breve de la fase' },
                estado: { type: 'string', enum: ['pendiente', 'en_curso', 'completada'], description: 'Estado actual de la fase' },
              },
              required: ['titulo', 'estado'],
            },
          },
        },
        required: ['fases'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ejecutar_terminal',
      description: 'Ejecuta un comando bash en el terminal del workspace de la tarea y devuelve stdout/stderr reales.',
      parameters: {
        type: 'object',
        properties: {
          comando: { type: 'string', description: 'Comando bash no interactivo a ejecutar' },
        },
        required: ['comando'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'escribir_archivo',
      description: 'Crea o sobreescribe un archivo de texto en el workspace de la tarea.',
      parameters: {
        type: 'object',
        properties: {
          ruta: { type: 'string', description: 'Ruta relativa del archivo, ej: "informe.md"' },
          contenido: { type: 'string', description: 'Contenido completo del archivo' },
        },
        required: ['ruta', 'contenido'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'leer_archivo',
      description: 'Lee el contenido de un archivo del workspace.',
      parameters: {
        type: 'object',
        properties: {
          ruta: { type: 'string', description: 'Ruta relativa del archivo' },
        },
        required: ['ruta'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_archivos',
      description: 'Lista los archivos del workspace de la tarea (recursivo).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'busqueda_web',
      description: 'Busca información actualizada en la web. Devuelve títulos, URLs y extractos.',
      parameters: {
        type: 'object',
        properties: {
          consulta: { type: 'string', description: 'Consulta de búsqueda' },
        },
        required: ['consulta'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'leer_pagina',
      description: 'Descarga una URL y devuelve su contenido como texto plano legible.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL completa con https://' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mensaje_usuario',
      description: 'Envía un mensaje breve de progreso al usuario sin terminar la tarea.',
      parameters: {
        type: 'object',
        properties: {
          texto: { type: 'string', description: 'Mensaje de progreso (1-3 frases)' },
        },
        required: ['texto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'entregar_resultado',
      description: 'Finaliza la tarea entregando el resultado final al usuario. Llámala solo cuando todo esté completo.',
      parameters: {
        type: 'object',
        properties: {
          resumen: { type: 'string', description: 'Resumen completo del resultado en Markdown' },
          archivos: { type: 'array', items: { type: 'string' }, description: 'Rutas relativas de los archivos entregables' },
        },
        required: ['resumen'],
      },
    },
  },
];

// ─── SSE: suscriptores por tarea ─────────────────────────────────────────────

const subscribers = new Map(); // taskId -> Set<res>

function broadcast(taskId, event) {
  const set = subscribers.get(taskId);
  if (!set) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch { /* conexión cerrada */ }
  }
}

// ─── Persistencia ────────────────────────────────────────────────────────────

export function ensureComputerTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS computer_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendiente',
      plan TEXT,
      result TEXT,
      model TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS computer_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_computer_events_task ON computer_events(task_id, id);
    CREATE TABLE IF NOT EXISTS computer_messages (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function recordEvent(db, taskId, type, payload) {
  db.prepare('INSERT INTO computer_events (task_id, type, payload) VALUES (?, ?, ?)')
    .run(taskId, type, JSON.stringify(payload || {}));
  broadcast(taskId, { type, ...payload, ts: new Date().toISOString() });
}

// ─── Implementación de herramientas ──────────────────────────────────────────

function safePath(workspaceDir, rel) {
  const abs = path.resolve(workspaceDir, rel || '.');
  if (!abs.startsWith(path.resolve(workspaceDir))) {
    throw new Error('Ruta fuera del workspace no permitida');
  }
  return abs;
}

function truncate(text, max = MAX_OUTPUT_CHARS) {
  const s = String(text || '');
  return s.length > max ? s.slice(0, max) + `\n... [truncado, ${s.length} caracteres en total]` : s;
}

function runShell(workspaceDir, comando) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', comando], {
      cwd: workspaceDir,
      env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive', HOME: workspaceDir },
      timeout: SHELL_TIMEOUT_MS,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => resolve({ exitCode: -1, stdout, stderr: `${stderr}\n${err.message}` }));
    child.on('close', (code, signal) => {
      resolve({ exitCode: code ?? -1, stdout, stderr: signal === 'SIGTERM' ? `${stderr}\n[Timeout tras ${SHELL_TIMEOUT_MS / 1000}s]` : stderr });
    });
  });
}

async function webSearchTool(consulta, tavilyApiKey) {
  // 1) Tavily si hay API key (del entorno global o del usuario)
  const key = tavilyApiKey || process.env.TAVILY_API_KEY;
  if (key) {
    try {
      const resp = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key, query: consulta, max_results: 6, include_answer: true }),
        signal: AbortSignal.timeout(20000),
      });
      if (resp.ok) {
        const data = await resp.json();
        const items = (data.results || []).map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.content}`).join('\n\n');
        return `${data.answer ? `Respuesta directa: ${data.answer}\n\n` : ''}${items}` || 'Sin resultados.';
      }
    } catch { /* cae al fallback */ }
  }
  // 2) Fallback sin API key: DuckDuckGo HTML
  try {
    const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(consulta)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) ZocoComputer/1.0' },
      signal: AbortSignal.timeout(20000),
    });
    const html = await resp.text();
    const results = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && results.length < 6) {
      const url = decodeURIComponent((m[1].match(/uddg=([^&]+)/) || [])[1] || m[1]);
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      if (title && url.startsWith('http')) results.push(`${results.length + 1}. ${title}\n   URL: ${url}`);
    }
    return results.join('\n\n') || 'Sin resultados de búsqueda.';
  } catch (err) {
    return `Error en la búsqueda: ${err.message}`;
  }
}

async function readPageTool(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) ZocoComputer/1.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
  });
  const contentType = resp.headers.get('content-type') || '';
  const body = await resp.text();
  if (!contentType.includes('html')) return truncate(body);
  // Extracción de texto simple sin dependencias
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
  return truncate(text);
}

async function listFilesRecursive(dir, base = dir, depth = 0) {
  if (depth > 5) return [];
  let out = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full);
    if (e.isDirectory()) {
      out.push(`${rel}/`);
      out = out.concat(await listFilesRecursive(full, base, depth + 1));
    } else {
      const st = await fsp.stat(full).catch(() => null);
      out.push(`${rel} (${st ? st.size : '?'} bytes)`);
    }
  }
  return out;
}

// ─── Ejecución de una herramienta ────────────────────────────────────────────

async function executeTool(db, task, workspaceDir, name, args, context) {
  switch (name) {
    case 'gestionar_plan': {
      const fases = Array.isArray(args.fases) ? args.fases : [];
      db.prepare('UPDATE computer_tasks SET plan = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(JSON.stringify(fases), task.id);
      recordEvent(db, task.id, 'plan', { fases });
      return `Plan actualizado con ${fases.length} fases.`;
    }
    case 'ejecutar_terminal': {
      recordEvent(db, task.id, 'terminal_start', { comando: args.comando });
      const { exitCode, stdout, stderr } = await runShell(workspaceDir, args.comando);
      const salida = truncate(`${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`.trim() || '(sin salida)');
      recordEvent(db, task.id, 'terminal_output', { comando: args.comando, exitCode, salida });
      return `[exit code: ${exitCode}]\n${salida}`;
    }
    case 'escribir_archivo': {
      const abs = safePath(workspaceDir, args.ruta);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, String(args.contenido ?? ''), 'utf8');
      recordEvent(db, task.id, 'file_write', { ruta: args.ruta, contenido: truncate(String(args.contenido ?? ''), 4000) });
      return `Archivo escrito: ${args.ruta} (${String(args.contenido ?? '').length} caracteres)`;
    }
    case 'leer_archivo': {
      const abs = safePath(workspaceDir, args.ruta);
      const contenido = await fsp.readFile(abs, 'utf8');
      recordEvent(db, task.id, 'file_read', { ruta: args.ruta });
      return truncate(contenido);
    }
    case 'listar_archivos': {
      const files = await listFilesRecursive(workspaceDir);
      recordEvent(db, task.id, 'file_list', { total: files.length });
      return files.join('\n') || '(workspace vacío)';
    }
    case 'busqueda_web': {
      recordEvent(db, task.id, 'web_search', { consulta: args.consulta });
      const resultado = await webSearchTool(args.consulta, context.tavilyApiKey);
      recordEvent(db, task.id, 'web_search_result', { consulta: args.consulta, resultado: truncate(resultado, 3000) });
      return resultado;
    }
    case 'leer_pagina': {
      recordEvent(db, task.id, 'browse', { url: args.url });
      try {
        const texto = await readPageTool(args.url);
        recordEvent(db, task.id, 'browse_result', { url: args.url, extracto: truncate(texto, 2000) });
        return texto;
      } catch (err) {
        recordEvent(db, task.id, 'browse_result', { url: args.url, error: err.message });
        return `Error al leer la página: ${err.message}`;
      }
    }
    case 'mensaje_usuario': {
      const msgId = context.uuidv4();
      db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?, ?, ?, ?)')
        .run(msgId, task.id, 'assistant', String(args.texto || ''));
      recordEvent(db, task.id, 'assistant_message', { texto: String(args.texto || '') });
      return 'Mensaje enviado al usuario. Continúa con la tarea.';
    }
    case 'entregar_resultado': {
      return { __finish: true, resumen: String(args.resumen || ''), archivos: Array.isArray(args.archivos) ? args.archivos : [] };
    }
    default:
      return `Herramienta desconocida: ${name}`;
  }
}

// ─── Bucle principal del agente ──────────────────────────────────────────────

async function runAgentLoop({ db, uuidv4, task, workspaceDir, callModel, tavilyApiKey }) {
  const messages = [
    { role: 'system', content: buildComputerSystemPrompt({ taskTitle: task.title }) },
  ];

  // Reconstruir contexto previo de la conversación (mensajes usuario/asistente)
  const prevMsgs = db.prepare('SELECT role, content FROM computer_messages WHERE task_id = ? ORDER BY created_at ASC LIMIT 30').all(task.id);
  for (const m of prevMsgs) messages.push({ role: m.role, content: m.content });

  const context = { uuidv4, tavilyApiKey };
  let finished = false;

  for (let i = 0; i < MAX_ITERATIONS && !finished; i++) {
    // Comprobar si el usuario ha detenido la tarea
    const current = db.prepare('SELECT status FROM computer_tasks WHERE id = ?').get(task.id);
    if (!current || current.status === 'detenida') {
      recordEvent(db, task.id, 'stopped', {});
      return;
    }

    recordEvent(db, task.id, 'thinking', { iteracion: i + 1 });

    let data;
    try {
      data = await callModel(messages, COMPUTER_TOOLS, 'auto');
    } catch (err) {
      recordEvent(db, task.id, 'error', { mensaje: `Error del modelo: ${err.message}` });
      db.prepare("UPDATE computer_tasks SET status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);
      return;
    }

    const msg = data.choices?.[0]?.message || {};
    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];

    if (toolCalls.length === 0) {
      // El modelo respondió con texto: lo tratamos como resultado final implícito
      const texto = (msg.content || '').trim() || 'Tarea completada.';
      db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), task.id, 'assistant', texto);
      db.prepare("UPDATE computer_tasks SET status = 'completada', result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(texto, task.id);
      recordEvent(db, task.id, 'finished', { resumen: texto, archivos: [] });
      return;
    }

    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: toolCalls });

    for (const tc of toolCalls) {
      const name = tc.function?.name;
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch {}
      recordEvent(db, task.id, 'tool_call', { herramienta: name, argumentos: truncate(JSON.stringify(args), 1500) });

      let result;
      try {
        result = await executeTool(db, task, workspaceDir, name, args, context);
      } catch (err) {
        result = `Error ejecutando ${name}: ${err.message}`;
      }

      if (result && typeof result === 'object' && result.__finish) {
        const resumen = result.resumen;
        db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?, ?, ?, ?)')
          .run(uuidv4(), task.id, 'assistant', resumen);
        db.prepare("UPDATE computer_tasks SET status = 'completada', result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(resumen, task.id);
        recordEvent(db, task.id, 'finished', { resumen, archivos: result.archivos });
        finished = true;
        messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Resultado entregado.' });
        break;
      }

      messages.push({ role: 'tool', tool_call_id: tc.id, content: String(result) });
    }
  }

  if (!finished) {
    const aviso = `He alcanzado el límite de ${MAX_ITERATIONS} iteraciones. Puedes enviarme un mensaje para continuar la tarea.`;
    db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), task.id, 'assistant', aviso);
    db.prepare("UPDATE computer_tasks SET status = 'pausada', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);
    recordEvent(db, task.id, 'paused', { mensaje: aviso });
  }
}

// ─── Registro de rutas Express ───────────────────────────────────────────────

export function registerComputerRoutes({ app, db, authMiddleware, uuidv4, jwt, JWT_SECRET, workspacesRoot, makeCallModel, getUserTavilyKey }) {
  ensureComputerTables(db);

  const computerRoot = path.join(workspacesRoot, 'computer');
  fs.mkdirSync(computerRoot, { recursive: true });

  function taskWorkspace(taskId) {
    const dir = path.join(computerRoot, taskId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function getTask(taskId, userId) {
    return db.prepare('SELECT * FROM computer_tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
  }

  // Crear tarea y lanzar el agente
  app.post('/api/computer/tasks', authMiddleware, async (req, res) => {
    const { prompt, model } = req.body || {};
    if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'Falta el prompt de la tarea' });

    const taskId = uuidv4();
    const title = String(prompt).trim().slice(0, 200);
    const modelo = model || 'zoco-max';
    db.prepare('INSERT INTO computer_tasks (id, user_id, title, status, model) VALUES (?, ?, ?, ?, ?)')
      .run(taskId, req.auth.sub, title, 'en_curso', modelo);
    db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), taskId, 'user', String(prompt).trim());

    const task = getTask(taskId, req.auth.sub);
    res.json({ id: taskId, title, status: 'en_curso' });

    // Ejecutar el agente en segundo plano (no bloquea la respuesta HTTP)
    setImmediate(async () => {
      try {
        recordEvent(db, taskId, 'task_started', { titulo: title });
        const callModel = makeCallModel({ userId: req.auth.sub, model: modelo });
        const tavilyApiKey = getUserTavilyKey ? getUserTavilyKey(req.auth.sub) : null;
        await runAgentLoop({ db, uuidv4, task, workspaceDir: taskWorkspace(taskId), callModel, tavilyApiKey });
      } catch (err) {
        console.error('[ZocoComputer] Error en el bucle del agente:', err);
        db.prepare("UPDATE computer_tasks SET status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(taskId);
        recordEvent(db, taskId, 'error', { mensaje: err.message });
      }
    });
  });

  // Enviar mensaje a una tarea existente (reanuda el bucle)
  app.post('/api/computer/tasks/:id/messages', authMiddleware, async (req, res) => {
    const task = getTask(req.params.id, req.auth.sub);
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
    const { content } = req.body || {};
    if (!content || !String(content).trim()) return res.status(400).json({ error: 'Mensaje vacío' });

    db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), task.id, 'user', String(content).trim());
    recordEvent(db, task.id, 'user_message', { texto: String(content).trim() });

    if (task.status === 'en_curso') {
      // El bucle en marcha leerá el mensaje en la siguiente reconstrucción
      return res.json({ ok: true, status: task.status });
    }

    db.prepare("UPDATE computer_tasks SET status = 'en_curso', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);
    res.json({ ok: true, status: 'en_curso' });

    setImmediate(async () => {
      try {
        const fresh = getTask(task.id, req.auth.sub);
        const callModel = makeCallModel({ userId: req.auth.sub, model: fresh.model || 'zoco-max' });
        const tavilyApiKey = getUserTavilyKey ? getUserTavilyKey(req.auth.sub) : null;
        await runAgentLoop({ db, uuidv4, task: fresh, workspaceDir: taskWorkspace(task.id), callModel, tavilyApiKey });
      } catch (err) {
        console.error('[ZocoComputer] Error al reanudar:', err);
        db.prepare("UPDATE computer_tasks SET status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);
        recordEvent(db, task.id, 'error', { mensaje: err.message });
      }
    });
  });

  // Detener una tarea
  app.post('/api/computer/tasks/:id/stop', authMiddleware, (req, res) => {
    const task = getTask(req.params.id, req.auth.sub);
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
    db.prepare("UPDATE computer_tasks SET status = 'detenida', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);
    recordEvent(db, task.id, 'stopped', {});
    res.json({ ok: true });
  });

  // Listar tareas del usuario
  app.get('/api/computer/tasks', authMiddleware, (req, res) => {
    const tasks = db.prepare('SELECT id, title, status, model, created_at, updated_at FROM computer_tasks WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100').all(req.auth.sub);
    res.json(tasks);
  });

  // Detalle de una tarea: estado, plan, mensajes y eventos recientes
  app.get('/api/computer/tasks/:id', authMiddleware, (req, res) => {
    const task = getTask(req.params.id, req.auth.sub);
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
    const messages = db.prepare('SELECT role, content, created_at FROM computer_messages WHERE task_id = ? ORDER BY created_at ASC').all(task.id);
    const events = db.prepare('SELECT id, type, payload, created_at FROM computer_events WHERE task_id = ? ORDER BY id ASC LIMIT 500').all(task.id)
      .map(e => ({ id: e.id, type: e.type, ...(JSON.parse(e.payload || '{}')), ts: e.created_at }));
    res.json({ ...task, plan: task.plan ? JSON.parse(task.plan) : [], messages, events });
  });

  // Descargar un archivo del workspace de la tarea
  app.get('/api/computer/tasks/:id/files', authMiddleware, async (req, res) => {
    const task = getTask(req.params.id, req.auth.sub);
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
    const rel = String(req.query.path || '');
    if (!rel) {
      const files = await listFilesRecursive(taskWorkspace(task.id));
      return res.json({ files });
    }
    try {
      const abs = safePath(taskWorkspace(task.id), rel);
      const contenido = await fsp.readFile(abs, 'utf8');
      res.json({ path: rel, content: contenido });
    } catch (err) {
      res.status(404).json({ error: `No se pudo leer: ${err.message}` });
    }
  });

  // Stream SSE de eventos en vivo (EventSource no soporta headers → token por query)
  app.get('/api/computer/tasks/:id/events', (req, res) => {
    const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
    let auth;
    try { auth = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).end(); }
    const task = db.prepare('SELECT id FROM computer_tasks WHERE id = ? AND user_id = ?').get(req.params.id, auth.sub);
    if (!task) return res.status(404).end();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // Reemitir eventos posteriores a lastEventId si el cliente se reconecta
    const lastId = parseInt(req.query.lastEventId || '0', 10);
    if (lastId > 0) {
      const missed = db.prepare('SELECT id, type, payload, created_at FROM computer_events WHERE task_id = ? AND id > ? ORDER BY id ASC').all(req.params.id, lastId);
      for (const e of missed) {
        res.write(`data: ${JSON.stringify({ id: e.id, type: e.type, ...(JSON.parse(e.payload || '{}')), ts: e.created_at })}\n\n`);
      }
    }

    if (!subscribers.has(req.params.id)) subscribers.set(req.params.id, new Set());
    subscribers.get(req.params.id).add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
    req.on('close', () => {
      clearInterval(ping);
      subscribers.get(req.params.id)?.delete(res);
    });
  });

  console.log('🖥️  El Ordenador de Zoco (agente tipo Manus) montado en /api/computer');
}
