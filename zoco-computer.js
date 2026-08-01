/**
 * zoco-computer.js — El Ordenador de Zoco
 * Agente autónomo general, equivalente funcional a Manus.
 *
 * ARQUITECTURA
 *   · El bucle de razonamiento vive en `zoco-loop.js` (multi-iteración real,
 *     antinudge, inyección de mensajes en caliente, recuperación tras reinicio).
 *   · El prompt de sistema vive en `zoco-prompt.js`.
 *   · Las herramientas avanzadas viven en `zoco-tools-extra.js`.
 *   · Este archivo es el ENSAMBLADOR: esquema de BD, catálogo de herramientas,
 *     ejecutor, emisión/persistencia de eventos y rutas Express.
 *
 * DECISIONES DE DISEÑO IMPORTANTES
 *   1. La ejecución está DESACOPLADA de la petición HTTP. Crear una tarea
 *      devuelve JSON inmediatamente y el agente sigue trabajando en segundo
 *      plano; el panel se suscribe aparte a `/events`. Así cerrar el navegador
 *      no mata la tarea (el fallo del diseño anterior).
 *   2. TODOS los eventos se persisten en `computer_events` con un `seq`
 *      incremental, de modo que el stream puede reanudarse con `lastEventId`
 *      sin perder ni duplicar nada.
 *   3. No se usa `node-fetch`: Node 18+ ya trae `fetch` nativo. Declararlo
 *      sin tenerlo en package.json tumbaba el contenedor al arrancar.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

import { buildComputerSystemPrompt } from './zoco-prompt.js';
import { runAgentLoop, recoverOrphanTasks } from './zoco-loop.js';
import { applyFileEdits, browserAction, exposePort } from './zoco-tools-extra.js';

// ─── Configuración ────────────────────────────────────────────────────────────

let WORKSPACE_ROOT = process.env.COMPUTER_WORKSPACE_ROOT || '/tmp/zoco-workspaces';
const TOOL_TIMEOUT_MS = parseInt(process.env.COMPUTER_TOOL_TIMEOUT_MS || '180000', 10);
const MAX_OUTPUT_CHARS = parseInt(process.env.COMPUTER_MAX_OUTPUT_CHARS || '12000', 10);
const PUBLIC_BASE = process.env.COMPUTER_PUBLIC_BASE || '';
const E2B_API_KEY = process.env.E2B_API_KEY || '';

// Modelos ofrecidos al usuario, con la nomenclatura comercial de Zoco.
// Los identificadores de la derecha se han verificado uno a uno contra
// GET https://api.anthropic.com/v1/models con la clave de producción: usar un
// identificador inexistente provoca un 404 en cada iteración del bucle.
const MODELOS = [
  {
    id: 'zoco-plus',
    modelo: process.env.ANTHROPIC_MODEL_PLUS || 'claude-sonnet-4-6',
    name: 'Zoco Plus',
    description: 'Equilibrio entre velocidad y capacidad. Recomendado para la mayoría de tareas.',
    tier: 'standard',
  },
  {
    id: 'zoco-max',
    modelo: process.env.ANTHROPIC_MODEL_MAX || 'claude-opus-4-8',
    name: 'Zoco Max',
    description: 'Máxima capacidad de razonamiento para tareas complejas y código avanzado.',
    tier: 'max',
  },
  {
    id: 'zoco-flash',
    modelo: process.env.ANTHROPIC_MODEL_FLASH || 'claude-haiku-4-5-20251001',
    name: 'Zoco Flash',
    description: 'El más rápido y económico. Ideal para tareas cortas.',
    tier: 'flash',
  },
];

function resolverModelo(idOModelo) {
  if (!idOModelo) return MODELOS[0].modelo;
  const encontrado = MODELOS.find(m => m.id === idOModelo || m.modelo === idOModelo);
  return encontrado ? encontrado.modelo : idOModelo;
}

// ─── Esquema de base de datos ─────────────────────────────────────────────────

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS computer_tasks (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      title       TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'en_curso',
      model       TEXT,
      plan        TEXT,
      result      TEXT,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS computer_messages (
      id         TEXT PRIMARY KEY,
      task_id    TEXT NOT NULL,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- La clave primaria se llama "id" (no "seq") por compatibilidad con las
    -- bases de datos ya desplegadas en producción: renombrarla obligaría a
    -- migrar y se perdería el historial de eventos de las tareas existentes.
    CREATE TABLE IF NOT EXISTS computer_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    TEXT NOT NULL,
      type       TEXT NOT NULL,
      payload    TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_computer_tasks_user   ON computer_tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_computer_msgs_task    ON computer_messages(task_id);
    CREATE INDEX IF NOT EXISTS idx_computer_events_task  ON computer_events(task_id, id);
  `);

  // Migración tolerante desde el esquema antiguo (columna `task` en inglés y
  // estados pending/running/completed/failed). No aborta si ya está migrado.
  try {
    const cols = db.prepare('PRAGMA table_info(computer_tasks)').all().map(c => c.name);
    if (cols.includes('task') && !cols.includes('title')) {
      db.exec('ALTER TABLE computer_tasks RENAME COLUMN task TO title');
    }
    if (!cols.includes('model')) db.exec('ALTER TABLE computer_tasks ADD COLUMN model TEXT');
    if (!cols.includes('plan')) db.exec('ALTER TABLE computer_tasks ADD COLUMN plan TEXT');
    if (!cols.includes('updated_at')) db.exec('ALTER TABLE computer_tasks ADD COLUMN updated_at TEXT');
    db.exec(`
      UPDATE computer_tasks SET status = CASE status
        WHEN 'running'   THEN 'en_curso'
        WHEN 'pending'   THEN 'en_curso'
        WHEN 'completed' THEN 'completada'
        WHEN 'failed'    THEN 'error'
        ELSE status END
      WHERE status IN ('running','pending','completed','failed');
    `);
  } catch (err) {
    console.warn('[ZocoComputer] migración de esquema omitida:', err.message);
  }
}

// ─── Eventos: persistencia + difusión en vivo ────────────────────────────────

// Suscriptores SSE activos, indexados por task_id.
const suscriptores = new Map(); // task_id -> Set<res>

function broadcast(taskId, seq, type, payload) {
  const set = suscriptores.get(taskId);
  if (!set || set.size === 0) return;
  const data = JSON.stringify({ type, ...payload });
  for (const res of set) {
    try {
      if (res.writableEnded) { set.delete(res); continue; }
      // El campo `id:` permite que el navegador reanude con Last-Event-ID.
      res.write(`id: ${seq}\nevent: ${type}\ndata: ${data}\n\n`);
    } catch {
      set.delete(res);
    }
  }
}

// Registra un evento: lo persiste y lo difunde. Es la única vía de emisión, de
// modo que quien se conecte tarde puede reconstruir la historia completa.
function recordEvent(db, taskId, type, payload = {}) {
  const cuerpo = JSON.stringify(payload ?? {});
  const info = db
    .prepare('INSERT INTO computer_events (task_id, type, payload) VALUES (?, ?, ?)')
    .run(taskId, type, cuerpo);
  broadcast(taskId, info.lastInsertRowid, type, payload);
  return info.lastInsertRowid;
}

// ─── Workspace por tarea ─────────────────────────────────────────────────────

function workspaceFor(taskId) {
  const dir = path.join(WORKSPACE_ROOT, taskId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Impide que el agente escriba fuera de su workspace (defensa en profundidad:
// el prompt ya lo indica, pero una ruta con `../` no debe escapar).
function resolveInside(workspaceDir, rutaRelativa) {
  const destino = path.resolve(workspaceDir, String(rutaRelativa || '.'));
  const raiz = path.resolve(workspaceDir);
  if (destino !== raiz && !destino.startsWith(raiz + path.sep)) {
    throw new Error(
      `Ruta fuera del workspace: "${rutaRelativa}". Trabaja con rutas relativas dentro de tu directorio.`
    );
  }
  return destino;
}

function truncar(texto, limite = MAX_OUTPUT_CHARS) {
  const s = String(texto ?? '');
  if (s.length <= limite) return s;
  return s.slice(0, limite) + `\n…[salida truncada; ${s.length} caracteres en total]`;
}

// ─── Catálogo de herramientas (formato OpenAI; server.js lo traduce) ─────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'gestionar_plan',
      description:
        'Crea o actualiza el plan de fases de la tarea. Llámala al empezar cualquier tarea no trivial y cada vez que completes una fase, pasando SIEMPRE la lista completa actualizada. El usuario ve este plan en vivo.',
      parameters: {
        type: 'object',
        properties: {
          fases: {
            type: 'array',
            description: 'Lista completa de fases, entre 2 y 8.',
            items: {
              type: 'object',
              properties: {
                titulo: { type: 'string', description: 'Título breve de la fase.' },
                estado: {
                  type: 'string',
                  enum: ['pendiente', 'en_curso', 'completada'],
                  description: 'Estado actual de la fase.',
                },
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
      name: 'terminal',
      description:
        'Ejecuta un comando de shell no interactivo en el workspace. Úsalo para instalar dependencias, ejecutar código, manipular archivos, git, curl, etc.',
      parameters: {
        type: 'object',
        properties: {
          comando: { type: 'string', description: 'Comando bash a ejecutar.' },
          directorio: { type: 'string', description: 'Subdirectorio relativo donde ejecutarlo (opcional).' },
          timeout_ms: { type: 'number', description: 'Timeout en ms (opcional, máx 600000).' },
        },
        required: ['comando'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'escribir_archivo',
      description: 'Crea un archivo nuevo o reescribe uno existente por completo. Crea los directorios intermedios.',
      parameters: {
        type: 'object',
        properties: {
          ruta: { type: 'string', description: 'Ruta relativa al workspace.' },
          contenido: { type: 'string', description: 'Contenido completo del archivo.' },
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
          ruta: { type: 'string', description: 'Ruta relativa al workspace.' },
          desde_linea: { type: 'number', description: 'Línea inicial (1-indexada, opcional).' },
          hasta_linea: { type: 'number', description: 'Línea final (opcional, -1 para el final).' },
        },
        required: ['ruta'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'editar_archivo',
      description:
        'Edición quirúrgica por búsqueda y reemplazo exacto. Más eficiente que reescribir archivos largos. Es atómica: si algún fragmento no se encuentra o es ambiguo, no se modifica nada.',
      parameters: {
        type: 'object',
        properties: {
          ruta: { type: 'string', description: 'Ruta relativa al workspace.' },
          ediciones: {
            type: 'array',
            description: 'Lista de ediciones a aplicar en orden.',
            items: {
              type: 'object',
              properties: {
                buscar: { type: 'string', description: 'Texto exacto a buscar, con sus espacios y saltos de línea.' },
                reemplazar: { type: 'string', description: 'Texto que lo sustituye.' },
                todas: { type: 'boolean', description: 'Reemplazar todas las ocurrencias (por defecto false).' },
              },
              required: ['buscar', 'reemplazar'],
            },
          },
        },
        required: ['ruta', 'ediciones'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_archivos',
      description: 'Lista el contenido del workspace en forma de árbol, para saber qué has creado ya.',
      parameters: {
        type: 'object',
        properties: {
          ruta: { type: 'string', description: 'Subdirectorio relativo (opcional, por defecto la raíz).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'busqueda_web',
      description:
        'Busca en internet y devuelve resultados con título, URL y extracto. Úsala para descubrir fuentes; después abre las relevantes con "leer_pagina".',
      parameters: {
        type: 'object',
        properties: {
          consulta: { type: 'string', description: 'Términos de búsqueda.' },
        },
        required: ['consulta'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'leer_pagina',
      description: 'Descarga una URL y devuelve su contenido como texto legible. Es la vía rápida para leer artículos y documentación.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL completa, con http:// o https://.' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navegador',
      description:
        'Navegador visual real con capturas de pantalla. Úsalo cuando la página necesite JavaScript, interacción, inicio de sesión o inspección visual.',
      parameters: {
        type: 'object',
        properties: {
          accion: {
            type: 'string',
            enum: ['navegar', 'clic', 'escribir', 'tecla', 'scroll', 'captura'],
            description: 'Acción a realizar.',
          },
          url: { type: 'string', description: 'URL a abrir (para "navegar").' },
          x: { type: 'number', description: 'Coordenada X (para "clic").' },
          y: { type: 'number', description: 'Coordenada Y (para "clic").' },
          texto: { type: 'string', description: 'Texto a escribir (para "escribir").' },
          tecla: { type: 'string', description: 'Tecla a pulsar, p. ej. Return, Tab, Escape.' },
          direccion: { type: 'string', enum: ['arriba', 'abajo'], description: 'Dirección del scroll.' },
          cantidad: { type: 'number', description: 'Cantidad de scroll.' },
        },
        required: ['accion'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'exponer_puerto',
      description: 'Publica un servicio que hayas arrancado en un puerto local y devuelve una URL accesible por el usuario.',
      parameters: {
        type: 'object',
        properties: {
          puerto: { type: 'number', description: 'Puerto local del servicio (1024-65535).' },
        },
        required: ['puerto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mensaje_usuario',
      description:
        'Envía un mensaje al usuario para informar de un hito relevante. No lo uses en cada iteración: el usuario ya ve todas tus acciones.',
      parameters: {
        type: 'object',
        properties: {
          texto: { type: 'string', description: 'Mensaje en una a tres frases.' },
        },
        required: ['texto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'entregar_resultado',
      description:
        'Cierra la tarea entregando el resultado. Úsala SOLO cuando el objetivo esté cumplido y los entregables existan realmente en el workspace.',
      parameters: {
        type: 'object',
        properties: {
          resumen: { type: 'string', description: 'Informe en Markdown, autosuficiente, de lo hecho y hallado.' },
          archivos: {
            type: 'array',
            items: { type: 'string' },
            description: 'Rutas relativas de todos los entregables generados.',
          },
        },
        required: ['resumen'],
      },
    },
  },
];

// ─── Ejecutores ──────────────────────────────────────────────────────────────

// Ejecuta un comando con spawn y timeout duro. Se usa spawn en lugar de exec
// para poder matar todo el grupo de procesos si se agota el tiempo: con exec,
// un hijo que ignora SIGTERM dejaba el agente colgado indefinidamente.
function runShell(comando, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const limite = Math.min(Math.max(parseInt(timeoutMs, 10) || TOOL_TIMEOUT_MS, 1000), 600000);
    const hijo = spawn('bash', ['-lc', comando], {
      cwd,
      detached: true,
      env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive', CI: 'true' },
    });

    let salida = '';
    let cerrado = false;
    const acumular = (buf) => {
      if (salida.length < MAX_OUTPUT_CHARS * 2) salida += buf.toString();
    };
    hijo.stdout.on('data', acumular);
    hijo.stderr.on('data', acumular);

    const temporizador = setTimeout(() => {
      if (cerrado) return;
      try { process.kill(-hijo.pid, 'SIGKILL'); } catch { /* ya murió */ }
      cerrado = true;
      resolve({
        code: 124,
        salida: truncar(salida) +
          `\n[El comando excedió el límite de ${Math.round(limite / 1000)}s y fue interrumpido. ` +
          `Si necesitas un proceso persistente, lánzalo en segundo plano con "&" y redirige la salida a un log.]`,
      });
    }, limite);

    hijo.on('error', (err) => {
      if (cerrado) return;
      clearTimeout(temporizador);
      cerrado = true;
      resolve({ code: -1, salida: `No se pudo ejecutar el comando: ${err.message}` });
    });

    hijo.on('close', (code) => {
      if (cerrado) return;
      clearTimeout(temporizador);
      cerrado = true;
      resolve({ code: code ?? 0, salida: truncar(salida) || '(sin salida)' });
    });
  });
}

async function arbolDeArchivos(dir, base, prefijo = '', profundidad = 0) {
  if (profundidad > 3) return '';
  let out = '';
  const entradas = (await fsp.readdir(dir, { withFileTypes: true }))
    .filter(e => !['node_modules', '.git', '__pycache__', '.venv'].includes(e.name))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, 80);
  for (const e of entradas) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      out += `${prefijo}${e.name}/\n`;
      out += await arbolDeArchivos(abs, base, prefijo + '  ', profundidad + 1);
    } else {
      let tam = '';
      try { tam = ` (${(await fsp.stat(abs)).size} B)`; } catch { /* ignorar */ }
      out += `${prefijo}${e.name}${tam}\n`;
    }
  }
  return out;
}

async function leerPagina(url) {
  if (!/^https?:\/\//i.test(url)) {
    return 'URL inválida: debe empezar por http:// o https://.';
  }
  const controlador = new AbortController();
  const t = setTimeout(() => controlador.abort(), 25000);
  try {
    // `fetch` es nativo en Node 18+. No se importa node-fetch a propósito.
    const r = await fetch(url, {
      signal: controlador.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
    });
    const tipo = r.headers.get('content-type') || '';
    let texto = await r.text();
    if (tipo.includes('html')) {
      texto = texto
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }
    return `[HTTP ${r.status}] ${url}\n\n${truncar(texto)}`;
  } catch (err) {
    return err.name === 'AbortError'
      ? `Tiempo de espera agotado al cargar ${url}.`
      : `Error al cargar ${url}: ${err.message}`;
  } finally {
    clearTimeout(t);
  }
}

// Búsqueda web sin depender de una API de pago: DuckDuckGo HTML. Si falla, se
// informa con honestidad para que el modelo pruebe otra vía (leer_pagina directa).
async function busquedaWeb(consulta) {
  const endpoint = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(consulta);
  const controlador = new AbortController();
  const t = setTimeout(() => controlador.abort(), 20000);
  try {
    const r = await fetch(endpoint, {
      signal: controlador.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
    });
    const html = await r.text();
    const resultados = [];
    const re = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) && resultados.length < 10) {
      let href = m[1];
      // DuckDuckGo envuelve los enlaces en un redirector: extraemos uddg.
      const envuelto = /[?&]uddg=([^&]+)/.exec(href);
      if (envuelto) href = decodeURIComponent(envuelto[1]);
      const titulo = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (titulo && /^https?:/i.test(href)) resultados.push({ titulo, url: href });
    }
    if (!resultados.length) {
      return `La búsqueda de "${consulta}" no devolvió resultados analizables. ` +
             `Prueba con otros términos o abre directamente una URL conocida con "leer_pagina".`;
    }
    return resultados.map((x, i) => `${i + 1}. ${x.titulo}\n   ${x.url}`).join('\n');
  } catch (err) {
    return `No se pudo completar la búsqueda web (${err.message}). Usa "leer_pagina" con una URL concreta.`;
  } finally {
    clearTimeout(t);
  }
}

// Dispatcher. Devuelve SIEMPRE un string (observación para el modelo), salvo
// `entregar_resultado`, que devuelve el objeto de finalización que espera el bucle.
async function executeTool(db, task, workspaceDir, name, args, context) {
  switch (name) {
    case 'gestionar_plan': {
      const fases = Array.isArray(args.fases) ? args.fases : [];
      if (!fases.length) return 'El plan debe incluir al menos una fase.';
      const normalizadas = fases.map((f, i) => ({
        id: i + 1,
        titulo: String(f.titulo || `Fase ${i + 1}`),
        estado: ['pendiente', 'en_curso', 'completada'].includes(f.estado) ? f.estado : 'pendiente',
      }));
      db.prepare('UPDATE computer_tasks SET plan = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(JSON.stringify(normalizadas), task.id);
      recordEvent(db, task.id, 'plan_updated', { fases: normalizadas });
      const actual = normalizadas.find(f => f.estado === 'en_curso');
      return `Plan actualizado con ${normalizadas.length} fases.` +
             (actual ? ` Fase en curso: "${actual.titulo}".` : '');
    }

    case 'terminal': {
      const comando = String(args.comando || '').trim();
      if (!comando) return 'Falta el comando a ejecutar.';
      const cwd = args.directorio ? resolveInside(workspaceDir, args.directorio) : workspaceDir;
      fs.mkdirSync(cwd, { recursive: true });
      const { code, salida } = await runShell(comando, cwd, args.timeout_ms);
      recordEvent(db, task.id, 'tool_result', {
        herramienta: 'terminal', comando, codigo: code, salida: truncar(salida, 4000),
      });
      return `[código de salida ${code}]\n${salida}`;
    }

    case 'escribir_archivo': {
      const abs = resolveInside(workspaceDir, args.ruta);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      const contenido = String(args.contenido ?? '');
      await fsp.writeFile(abs, contenido, 'utf8');
      recordEvent(db, task.id, 'file_write', {
        ruta: path.relative(workspaceDir, abs),
        bytes: Buffer.byteLength(contenido),
        vista: truncar(contenido, 3000),
      });
      return `Archivo escrito: ${path.relative(workspaceDir, abs)} (${Buffer.byteLength(contenido)} bytes).`;
    }

    case 'leer_archivo': {
      const abs = resolveInside(workspaceDir, args.ruta);
      let contenido;
      try {
        contenido = await fsp.readFile(abs, 'utf8');
      } catch (err) {
        return err.code === 'ENOENT'
          ? `El archivo "${args.ruta}" no existe. Usa "listar_archivos" para ver qué hay en el workspace.`
          : `No se pudo leer "${args.ruta}": ${err.message}`;
      }
      if (args.desde_linea || args.hasta_linea) {
        const lineas = contenido.split('\n');
        const desde = Math.max(1, parseInt(args.desde_linea, 10) || 1);
        const hastaBruto = parseInt(args.hasta_linea, 10);
        const hasta = (!hastaBruto || hastaBruto === -1) ? lineas.length : Math.min(lineas.length, hastaBruto);
        contenido = lineas.slice(desde - 1, hasta)
          .map((l, i) => `${desde + i}\t${l}`).join('\n');
      }
      recordEvent(db, task.id, 'file_read', { ruta: path.relative(workspaceDir, abs) });
      return truncar(contenido);
    }

    case 'editar_archivo': {
      const abs = resolveInside(workspaceDir, args.ruta);
      const ediciones = Array.isArray(args.ediciones) ? args.ediciones : [];
      if (!ediciones.length) return 'Debes indicar al menos una edición.';
      try {
        const { resumen, contenido } = await applyFileEdits(abs, ediciones);
        recordEvent(db, task.id, 'file_edit', {
          ruta: path.relative(workspaceDir, abs),
          ediciones: ediciones.length,
          vista: truncar(contenido, 3000),
        });
        return resumen;
      } catch (err) {
        // Error de edición = observación para que el modelo se corrija, no fallo fatal.
        return `No se aplicó ninguna edición. ${err.message}`;
      }
    }

    case 'listar_archivos': {
      const abs = args.ruta ? resolveInside(workspaceDir, args.ruta) : workspaceDir;
      try {
        const arbol = await arbolDeArchivos(abs, workspaceDir);
        return arbol.trim()
          ? `Contenido de ${path.relative(workspaceDir, abs) || '.'}:\n${arbol}`
          : 'El workspace está vacío por ahora.';
      } catch (err) {
        return `No se pudo listar "${args.ruta || '.'}": ${err.message}`;
      }
    }

    case 'busqueda_web': {
      const consulta = String(args.consulta || '').trim();
      if (!consulta) return 'Falta la consulta de búsqueda.';
      const salida = await busquedaWeb(consulta);
      recordEvent(db, task.id, 'web_search', { consulta, resultados: truncar(salida, 2000) });
      return salida;
    }

    case 'leer_pagina': {
      const url = String(args.url || '').trim();
      const salida = await leerPagina(url);
      recordEvent(db, task.id, 'web_read', { url, vista: truncar(salida, 2000) });
      return salida;
    }

    case 'navegador': {
      try {
        const r = await browserAction({
          taskId: task.id,
          apiKey: E2B_API_KEY,
          accion: args.accion,
          url: args.url,
          x: args.x, y: args.y,
          texto: args.texto, tecla: args.tecla,
          direccion: args.direccion, cantidad: args.cantidad,
        });
        recordEvent(db, task.id, 'browser_action', {
          accion: args.accion, url: args.url || null, texto: r.texto, streamUrl: r.streamUrl || null,
        });
        if (r.captura) {
          recordEvent(db, task.id, 'browser_screenshot', {
            imagen: r.captura, accion: args.accion, streamUrl: r.streamUrl || null,
          });
        }
        return r.texto;
      } catch (err) {
        return `El navegador visual falló: ${err.message}. Usa "leer_pagina" como alternativa.`;
      }
    }

    case 'exponer_puerto': {
      try {
        const r = exposePort({ puerto: args.puerto, publicBase: PUBLIC_BASE, taskId: task.id });
        if (r.url) recordEvent(db, task.id, 'port_exposed', { puerto: args.puerto, url: r.url });
        return r.texto;
      } catch (err) {
        return `No se pudo exponer el puerto: ${err.message}`;
      }
    }

    case 'mensaje_usuario': {
      const texto = String(args.texto || '').trim();
      if (!texto) return 'El mensaje no puede estar vacío.';
      db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?, ?, ?, ?)')
        .run(context.uuidv4(), task.id, 'assistant', texto);
      recordEvent(db, task.id, 'assistant_message', { texto });
      return 'Mensaje entregado al usuario. Continúa con la tarea.';
    }

    case 'entregar_resultado': {
      const resumen = String(args.resumen || 'Tarea completada.');
      const archivos = Array.isArray(args.archivos) ? args.archivos : [];
      // Verificamos que los entregables existan de verdad: si el modelo declara
      // archivos inexistentes, se lo devolvemos para que lo corrija.
      const faltantes = [];
      for (const rel of archivos) {
        try {
          await fsp.access(resolveInside(workspaceDir, rel));
        } catch {
          faltantes.push(rel);
        }
      }
      if (faltantes.length) {
        return `No puedo cerrar la tarea: estos entregables no existen en el workspace: ` +
               `${faltantes.join(', ')}. Créalos o corrige las rutas y vuelve a llamar a "entregar_resultado".`;
      }
      return { __finish: true, resumen, archivos };
    }

    default:
      return `Herramienta desconocida: "${name}". Usa solo las herramientas declaradas.`;
  }
}

// ─── Arranque de una tarea en segundo plano ──────────────────────────────────

// Tareas vivas en este proceso, para poder consultarlas y evitar duplicados.
const enEjecucion = new Set();

function lanzarTarea({ db, uuidv4, task, makeCallModel }) {
  if (enEjecucion.has(task.id)) return;
  enEjecucion.add(task.id);

  const workspaceDir = workspaceFor(task.id);

  recordEvent(db, task.id, 'task_started', { titulo: task.title, modelo: task.model });

  // `makeCallModel` construye el invocador ya ligado al usuario: comprueba
  // créditos y cuenta activa, descuenta el consumo y devuelve la forma
  // OpenAI `data.choices[0].message` que espera el bucle.
  const callModel = makeCallModel({ userId: task.user_id, model: task.model });

  // Deliberadamente NO se espera esta promesa: la petición HTTP ya respondió.
  runAgentLoop({
    db,
    uuidv4,
    task,
    workspaceDir,
    callModel,
    recordEvent,
    executeTool,
    buildSystemPrompt: () => buildComputerSystemPrompt({
      taskTitle: task.title,
      workspaceDir,
      tieneNavegador: Boolean(E2B_API_KEY),
    }),
    tools: TOOLS,
    context: { uuidv4, publicBase: PUBLIC_BASE },
  })
    .catch((err) => {
      console.error(`[ZocoComputer] fallo no capturado en la tarea ${task.id}:`, err);
      try {
        recordEvent(db, task.id, 'error', { mensaje: `Error interno del agente: ${err.message}` });
        db.prepare("UPDATE computer_tasks SET status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(task.id);
      } catch { /* la BD puede estar cerrándose */ }
    })
    .finally(() => {
      enEjecucion.delete(task.id);
    });
}

// ─── Rutas Express ───────────────────────────────────────────────────────────

export function registerComputerRoutes({
  app, db, authMiddleware, uuidv4, workspacesRoot, makeCallModel, jwt, JWT_SECRET,
}) {
  ensureSchema(db);

  if (typeof makeCallModel !== 'function') {
    throw new Error('registerComputerRoutes requiere `makeCallModel` para hablar con el modelo.');
  }

  // El servidor decide dónde viven los workspaces (volumen persistente en
  // producción); si no lo indica, se mantiene el valor por defecto.
  if (workspacesRoot) WORKSPACE_ROOT = path.join(workspacesRoot, 'computer');
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });

  // Al arrancar, las tareas que quedaron "en_curso" tras un reinicio del
  // contenedor se marcan como pausadas y reanudables.
  try {
    recoverOrphanTasks(db, recordEvent);
  } catch (err) {
    console.warn('[ZocoComputer] no se pudieron recuperar tareas huérfanas:', err.message);
  }

  const propietario = (req, id) =>
    db.prepare('SELECT * FROM computer_tasks WHERE id = ? AND user_id = ?').get(id, req.auth.sub);

  // `EventSource` del navegador no permite enviar cabeceras personalizadas, por
  // lo que el token del stream SSE viaja en la query. Este middleware lo
  // traslada a la cabecera Authorization antes de delegar en el guardia normal,
  // de modo que la verificación de firma y caducidad sigue siendo la misma.
  const authSSE = (req, res, next) => {
    if (!req.headers.authorization && req.query?.token) {
      req.headers.authorization = `Bearer ${req.query.token}`;
    }
    return authMiddleware(req, res, next);
  };

  // ── Listar tareas ──
  app.get('/api/computer/tasks', authMiddleware, (req, res) => {
    try {
      const tareas = db.prepare(
        `SELECT id, title, status, model, plan, result, created_at, updated_at
           FROM computer_tasks WHERE user_id = ?
          ORDER BY datetime(COALESCE(updated_at, created_at)) DESC LIMIT 100`
      ).all(req.auth.sub);
      res.json(tareas);
    } catch (err) {
      console.error('[ZocoComputer] error listando tareas:', err);
      res.status(500).json({ error: 'No se pudieron obtener las tareas.' });
    }
  });

  // ── Crear tarea (responde de inmediato; el agente sigue en segundo plano) ──
  app.post('/api/computer/tasks', authMiddleware, (req, res) => {
    try {
      const titulo = String(req.body?.prompt ?? req.body?.task ?? req.body?.title ?? '').trim();
      if (!titulo) return res.status(400).json({ error: 'El prompt de la tarea es obligatorio.' });

      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(503).json({
          error: 'El motor de IA no está configurado en el servidor (falta ANTHROPIC_API_KEY).',
        });
      }

      const id = uuidv4();
      const modelo = resolverModelo(req.body?.model);

      db.prepare(
        `INSERT INTO computer_tasks (id, user_id, title, status, model, created_at, updated_at)
         VALUES (?, ?, ?, 'en_curso', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).run(id, req.auth.sub, titulo, modelo);

      db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), id, 'user', titulo);

      const task = db.prepare('SELECT * FROM computer_tasks WHERE id = ?').get(id);

      // Respondemos ya: el panel se suscribirá al stream por separado.
      res.status(201).json({ id, title: titulo, status: 'en_curso', model: modelo });

      lanzarTarea({ db, uuidv4, task, makeCallModel });
    } catch (err) {
      console.error('[ZocoComputer] error creando tarea:', err);
      if (!res.headersSent) res.status(500).json({ error: 'No se pudo crear la tarea.' });
    }
  });

  // ── Detalle de una tarea, con mensajes y eventos ──
  app.get('/api/computer/tasks/:id', authMiddleware, (req, res) => {
    try {
      const task = propietario(req, req.params.id);
      if (!task) return res.status(404).json({ error: 'Tarea no encontrada.' });

      const mensajes = db.prepare(
        'SELECT id, role, content, created_at FROM computer_messages WHERE task_id = ? ORDER BY created_at ASC, rowid ASC'
      ).all(task.id);

      const eventos = db.prepare(
        'SELECT id, type, payload, created_at FROM computer_events WHERE task_id = ? ORDER BY id ASC LIMIT 2000'
      ).all(task.id).map(e => ({
        seq: e.id,
        type: e.type,
        created_at: e.created_at,
        ...(() => { try { return JSON.parse(e.payload || '{}'); } catch { return {}; } })(),
      }));

      let plan = [];
      try { plan = task.plan ? JSON.parse(task.plan) : []; } catch { plan = []; }

      // Se exponen ambos juegos de claves: el frontend actual consume las
      // castellanas y los tests/integraciones externas las inglesas.
      res.json({
        ...task, plan,
        mensajes, eventos,
        messages: mensajes, events: eventos,
        viva: enEjecucion.has(task.id),
      });
    } catch (err) {
      console.error('[ZocoComputer] error obteniendo tarea:', err);
      res.status(500).json({ error: 'No se pudo obtener la tarea.' });
    }
  });

  // ── Stream de eventos en vivo (SSE) con reanudación ──
  app.get('/api/computer/tasks/:id/events', authSSE, (req, res) => {
    const task = propietario(req, req.params.id);
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada.' });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    // Imprescindible para que Traefik/Nginx no bufferice el stream.
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    // Reemisión de lo ya ocurrido, para que quien llega tarde no pierda nada.
    const desde = parseInt(req.headers['last-event-id'] || req.query.lastEventId || '0', 10) || 0;
    try {
      const previos = db.prepare(
        'SELECT id, type, payload FROM computer_events WHERE task_id = ? AND id > ? ORDER BY id ASC LIMIT 3000'
      ).all(task.id, desde);
      for (const e of previos) {
        res.write(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify({
          type: e.type,
          ...(() => { try { return JSON.parse(e.payload || '{}'); } catch { return {}; } })(),
        })}\n\n`);
      }
    } catch (err) {
      console.warn('[ZocoComputer] no se pudieron reemitir eventos previos:', err.message);
    }

    if (!suscriptores.has(task.id)) suscriptores.set(task.id, new Set());
    suscriptores.get(task.id).add(res);

    // Comentario periódico: mantiene viva la conexión frente a timeouts de proxy.
    const latido = setInterval(() => {
      if (res.writableEnded) return clearInterval(latido);
      try { res.write(': latido\n\n'); } catch { clearInterval(latido); }
    }, 15000);

    const cerrar = () => {
      clearInterval(latido);
      const set = suscriptores.get(task.id);
      if (set) {
        set.delete(res);
        if (set.size === 0) suscriptores.delete(task.id);
      }
    };
    req.on('close', cerrar);
    req.on('error', cerrar);
  });

  // ── Enviar un mensaje a una tarea (en caliente o para reanudarla) ──
  app.post('/api/computer/tasks/:id/messages', authMiddleware, (req, res) => {
    try {
      const task = propietario(req, req.params.id);
      if (!task) return res.status(404).json({ error: 'Tarea no encontrada.' });

      const texto = String(req.body?.mensaje ?? req.body?.message ?? req.body?.content ?? '').trim();
      if (!texto) return res.status(400).json({ error: 'El mensaje no puede estar vacío.' });

      db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), task.id, 'user', texto);
      recordEvent(db, task.id, 'user_message', { texto });

      // Si la tarea no está viva (pausada, completada o tras un reinicio), el
      // mensaje la reanuda en lugar de quedarse sin efecto.
      let reanudada = false;
      if (!enEjecucion.has(task.id)) {
        db.prepare("UPDATE computer_tasks SET status = 'en_curso', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(task.id);
        const fresca = db.prepare('SELECT * FROM computer_tasks WHERE id = ?').get(task.id);
        lanzarTarea({ db, uuidv4, task: fresca, makeCallModel });
        reanudada = true;
      }

      res.json({ ok: true, reanudada });
    } catch (err) {
      console.error('[ZocoComputer] error enviando mensaje:', err);
      res.status(500).json({ error: 'No se pudo enviar el mensaje.' });
    }
  });

  // ── Detener una tarea ──
  app.post('/api/computer/tasks/:id/stop', authMiddleware, (req, res) => {
    try {
      const task = propietario(req, req.params.id);
      if (!task) return res.status(404).json({ error: 'Tarea no encontrada.' });
      db.prepare("UPDATE computer_tasks SET status = 'detenida', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(task.id);
      recordEvent(db, task.id, 'stopped', { mensaje: 'Tarea detenida por el usuario.' });
      res.json({ ok: true });
    } catch (err) {
      console.error('[ZocoComputer] error deteniendo tarea:', err);
      res.status(500).json({ error: 'No se pudo detener la tarea.' });
    }
  });

  // ── Descargar un entregable ──
  app.get('/api/computer/tasks/:id/files/*', authMiddleware, (req, res) => {
    try {
      const task = propietario(req, req.params.id);
      if (!task) return res.status(404).json({ error: 'Tarea no encontrada.' });
      const rel = req.params[0] || '';
      const workspaceDir = workspaceFor(task.id);
      let abs;
      try {
        abs = resolveInside(workspaceDir, rel);
      } catch {
        return res.status(400).json({ error: 'Ruta no permitida.' });
      }
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return res.status(404).json({ error: 'Archivo no encontrado.' });
      }
      res.download(abs, path.basename(abs));
    } catch (err) {
      console.error('[ZocoComputer] error descargando archivo:', err);
      res.status(500).json({ error: 'No se pudo descargar el archivo.' });
    }
  });

  // ── Eliminar una tarea ──
  app.delete('/api/computer/tasks/:id', authMiddleware, (req, res) => {
    try {
      const task = propietario(req, req.params.id);
      if (!task) return res.status(404).json({ error: 'Tarea no encontrada.' });
      db.prepare("UPDATE computer_tasks SET status = 'detenida' WHERE id = ?").run(task.id);
      db.prepare('DELETE FROM computer_events WHERE task_id = ?').run(task.id);
      db.prepare('DELETE FROM computer_messages WHERE task_id = ?').run(task.id);
      db.prepare('DELETE FROM computer_tasks WHERE id = ?').run(task.id);
      try { fs.rmSync(workspaceFor(task.id), { recursive: true, force: true }); } catch { /* ignorar */ }
      res.json({ ok: true });
    } catch (err) {
      console.error('[ZocoComputer] error eliminando tarea:', err);
      res.status(500).json({ error: 'No se pudo eliminar la tarea.' });
    }
  });

  // ── Modelos disponibles ──
  app.get('/api/computer/models', authMiddleware, (_req, res) => {
    res.json(MODELOS.map(({ id, name, description, tier }) => ({ id, name, description, tier })));
  });

  console.log('[ZocoComputer] El Ordenador de Zoco registrado: 12 herramientas, SSE con reanudación, tareas en segundo plano.');
}

// Exportado para los tests. `ensureComputerTables` es el nombre histórico del
// creador de esquema y se mantiene como alias para no romper la suite.
export {
  executeTool, TOOLS, recordEvent, resolveInside, busquedaWeb, leerPagina,
  ensureSchema, ensureSchema as ensureComputerTables,
};
