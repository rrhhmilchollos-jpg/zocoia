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
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

import { buildComputerSystemPrompt } from './zoco-prompt.js';
import { runAgentLoop, recoverOrphanTasks } from './zoco-loop.js';
import { applyFileEdits, browserAction, exposePort } from './zoco-tools-extra.js';
import { closeLocalBrowser } from './zoco-local-browser.js';
import { createSandboxSession, executeInSandbox, closeSandboxSession } from './zoco-sandbox-client.js';

// ─── Configuración ────────────────────────────────────────────────────────────

let WORKSPACE_ROOT = process.env.COMPUTER_WORKSPACE_ROOT || '/tmp/zoco-workspaces';
const TOOL_TIMEOUT_MS = parseInt(process.env.COMPUTER_TOOL_TIMEOUT_MS || '180000', 10);
const MAX_OUTPUT_CHARS = parseInt(process.env.COMPUTER_MAX_OUTPUT_CHARS || '12000', 10);
const PUBLIC_BASE = process.env.COMPUTER_PUBLIC_BASE || '';
const E2B_API_KEY = process.env.E2B_API_KEY || '';
const BROWSER_PROVIDER = String(process.env.ZOCO_BROWSER_PROVIDER || 'local').trim().toLowerCase();

// Modelos ofrecidos al usuario con identificadores internos estables. El backend
// los resuelve al modelo físico del proveedor activo para evitar enviar IDs de
// Claude a Ollama (o viceversa) al cambiar de motor.
const MODELOS = [
  {
    id: 'zoco-plus',
    modelo: 'zoco-plus',
    name: 'Zoco Plus',
    description: 'Equilibrio entre velocidad y capacidad. Recomendado para la mayoría de tareas.',
    tier: 'standard',
  },
  {
    id: 'zoco-max',
    modelo: 'zoco-max',
    name: 'Zoco Max',
    description: 'Máxima capacidad de razonamiento para tareas complejas y código avanzado.',
    tier: 'max',
  },
  {
    id: 'zoco-flash',
    modelo: 'zoco-flash',
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
      runtime_state TEXT,
      last_event_id INTEGER DEFAULT 0,
      heartbeat_at TEXT,
      cancel_requested_at TEXT,
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

    -- Un perfil no almacena cookies en SQLite: solo contiene un identificador
    -- opaco para el directorio privado que Browserless mantiene por usuario.
    CREATE TABLE IF NOT EXISTS browser_profiles (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      label       TEXT NOT NULL,
      profile_key TEXT NOT NULL UNIQUE,
      status      TEXT NOT NULL DEFAULT 'activo',
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS browser_domain_permissions (
      id          TEXT PRIMARY KEY,
      profile_id  TEXT NOT NULL,
      domain      TEXT NOT NULL,
      permission  TEXT NOT NULL DEFAULT 'leer',
      expires_at  TEXT,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, domain)
    );

    CREATE TABLE IF NOT EXISTS browser_action_approvals (
      id          TEXT PRIMARY KEY,
      task_id     TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      profile_id  TEXT,
      domain      TEXT,
      action_json TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pendiente',
      expires_at  TEXT NOT NULL,
      resolved_at TEXT,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS browser_bridge_pairs (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      code_hash   TEXT NOT NULL UNIQUE,
      profile_id  TEXT NOT NULL,
      expires_at  TEXT NOT NULL,
      claimed_at  TEXT,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS browser_bridge_devices (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      profile_id  TEXT NOT NULL UNIQUE,
      token_hash  TEXT NOT NULL UNIQUE,
      status      TEXT NOT NULL DEFAULT 'activo',
      browser     TEXT,
      last_seen_at TEXT,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS browser_bridge_commands (
      id          TEXT PRIMARY KEY,
      task_id     TEXT,
      device_id   TEXT NOT NULL,
      action_json TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pendiente',
      result_json TEXT,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_computer_tasks_user   ON computer_tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_computer_msgs_task    ON computer_messages(task_id);
    CREATE INDEX IF NOT EXISTS idx_computer_events_task  ON computer_events(task_id, id);
    CREATE INDEX IF NOT EXISTS idx_browser_profiles_user ON browser_profiles(user_id);
    CREATE INDEX IF NOT EXISTS idx_browser_grants_profile ON browser_domain_permissions(profile_id, domain);
    CREATE INDEX IF NOT EXISTS idx_browser_approvals_task ON browser_action_approvals(task_id, status);
    CREATE INDEX IF NOT EXISTS idx_browser_bridge_pairs ON browser_bridge_pairs(code_hash, expires_at);
    CREATE INDEX IF NOT EXISTS idx_browser_bridge_commands ON browser_bridge_commands(device_id, status);
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
    if (!cols.includes('runtime_state')) db.exec('ALTER TABLE computer_tasks ADD COLUMN runtime_state TEXT');
    if (!cols.includes('last_event_id')) db.exec('ALTER TABLE computer_tasks ADD COLUMN last_event_id INTEGER DEFAULT 0');
    if (!cols.includes('heartbeat_at')) db.exec('ALTER TABLE computer_tasks ADD COLUMN heartbeat_at TEXT');
    if (!cols.includes('cancel_requested_at')) db.exec('ALTER TABLE computer_tasks ADD COLUMN cancel_requested_at TEXT');
    if (!cols.includes('browser_profile_id')) db.exec('ALTER TABLE computer_tasks ADD COLUMN browser_profile_id TEXT');
    const profileCols = db.prepare('PRAGMA table_info(browser_profiles)').all().map(c => c.name);
    if (!profileCols.includes('bridge_device_id')) db.exec('ALTER TABLE browser_profiles ADD COLUMN bridge_device_id TEXT');
    if (!profileCols.includes('profile_kind')) db.exec("ALTER TABLE browser_profiles ADD COLUMN profile_kind TEXT NOT NULL DEFAULT 'chromium_persistente'");
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
// Contexto efímero de la herramienta que está ejecutándose. Permite correlacionar
// los eventos internos ya existentes sin reescribir cada adaptador de una vez.
const activeToolRuns = new Map(); // task_id -> { tool_run_id, herramienta }

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function executeBrowserBridgeAction(db, task, args) {
  const profile = db.prepare("SELECT * FROM browser_profiles WHERE id = ? AND user_id = ? AND profile_kind = 'chrome_bridge' AND status = 'activo'").get(task.browser_profile_id, task.user_id);
  if (!profile?.bridge_device_id) return { disponible: false, texto: 'El perfil de Chrome vinculado ya no está disponible. Crea y vincula un perfil nuevo.' };
  const actionMap = { navegar: 'navigate', captura: 'snapshot', clic: 'click', escribir: 'type' };
  const type = actionMap[args.accion];
  if (!type) return { disponible: false, texto: `La acción ${args.accion || 'solicitada'} no está disponible todavía en el puente de Chrome.` };
  const commandId = crypto.randomUUID();
  const action = { type, url: args.url || null, x: args.x, y: args.y, text: args.texto || null };
  db.prepare("INSERT INTO browser_bridge_commands (id, task_id, device_id, action_json) VALUES (?, ?, ?, ?)")
    .run(commandId, task.id, profile.bridge_device_id, JSON.stringify(action));
  setRuntimeState(db, task.id, { phase: 'browser_bridge_waiting', active_tool: 'navegador', channel: 'web', status_detail: 'Esperando el resultado de la sesión de Chrome vinculada.' }, 'browser_bridge_command');
  recordEvent(db, task.id, 'browser_bridge_command', { channel: 'web', command_id: commandId, action: type, profile_id: profile.id });

  const deadline = Date.now() + 55000;
  while (Date.now() < deadline) {
    await sleep(1000);
    const command = db.prepare('SELECT status, result_json FROM browser_bridge_commands WHERE id = ?').get(commandId);
    if (!command || command.status === 'error') {
      const result = command?.result_json ? (() => { try { return JSON.parse(command.result_json); } catch { return {}; } })() : {};
      return { disponible: false, texto: result.error || 'El navegador vinculado rechazó la acción.' };
    }
    if (command.status === 'completado') {
      const result = (() => { try { return JSON.parse(command.result_json || '{}'); } catch { return {}; } })();
      if (result.screenshot) recordEvent(db, task.id, 'browser_screenshot', { channel: 'web', imagen: result.screenshot, proveedor: 'chrome_vinculado', url: result.url || null, titulo: result.title || null });
      setRuntimeState(db, task.id, { phase: 'browser_ready', active_tool: null, channel: 'web', browser_url: result.url || null, browser_domain: (() => { try { return new URL(result.url).hostname.toLowerCase(); } catch { return null; } })(), status_detail: `Sesión de Chrome observada: ${result.title || result.url || 'página activa'}.` }, 'browser_bridge_result');
      return { disponible: true, captura: result.screenshot || null, url: result.url || null, texto: `Navegador Chrome vinculado en ${result.url || 'página activa'}${result.title ? ` · ${result.title}` : ''}.\n\nContenido visible:\n${result.text || '(sin texto visible)'}` };
    }
  }
  return { disponible: false, texto: 'El navegador vinculado no respondió dentro de 55 segundos. Comprueba que la extensión Zoco Browser Bridge está instalada y conectada.' };
}

function eventChannel(type, payload = {}) {
  if (payload.channel) return payload.channel;
  if (/^(terminal|sandbox|port_)/.test(type)) return 'terminal';
  if (/^(file_|workspace_)/.test(type)) return 'files';
  if (/^(browser|web_)/.test(type)) return 'web';
  if (/^(tool_|plan_|assistant_message|user_message|model_|thinking|strategy_|task_|paused|stopped|finished|error|runtime_)/.test(type)) return 'agent';
  return 'system';
}

function parseRuntimeState(raw) {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

function setRuntimeState(db, taskId, patch = {}, reason = null) {
  const row = db.prepare('SELECT runtime_state FROM computer_tasks WHERE id = ?').get(taskId) || {};
  const now = new Date().toISOString();
  const state = {
    ...parseRuntimeState(row.runtime_state),
    ...patch,
    last_progress_at: now,
  };
  db.prepare('UPDATE computer_tasks SET runtime_state = ?, heartbeat_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(state), now, taskId);
  if (reason) recordEvent(db, taskId, 'runtime_state', { channel: 'agent', reason, runtime: state });
  return state;
}

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
  // La misma marca temporal viaja por SSE y queda persistida con el evento,
  // de modo que el runtime puede reproducir una secuencia verificable.
  const activeTool = activeToolRuns.get(taskId);
  const evento = {
    ...(payload ?? {}),
    channel: eventChannel(type, payload),
    ...(activeTool && !payload?.tool_run_id ? activeTool : {}),
    ts: new Date().toISOString(),
    schema_version: 2,
  };
  const cuerpo = JSON.stringify(evento);
  const info = db
    .prepare('INSERT INTO computer_events (task_id, type, payload) VALUES (?, ?, ?)')
    .run(taskId, type, cuerpo);
  db.prepare('UPDATE computer_tasks SET last_event_id = ?, heartbeat_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(info.lastInsertRowid, evento.ts, taskId);
  broadcast(taskId, info.lastInsertRowid, type, evento);
  return info.lastInsertRowid;
}

// ─── Workspace por tarea ─────────────────────────────────────────────────────

function workspaceFor(taskId) {
  const dir = path.join(WORKSPACE_ROOT, taskId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // El runner efímero ejecuta como UID/GID 10001. Cada workspace nuevo se
  // asigna exclusivamente a ese usuario; el proceso principal sigue pudiendo
  // leerlo como root, pero una sandbox nunca puede salir de su propia tarea.
  try {
    fs.chmodSync(dir, 0o700);
    fs.chownSync(dir, 10001, 10001);
  } catch (err) {
    console.warn(`[ZocoComputer] no se pudo preparar permisos de sandbox para ${taskId}: ${err.message}`);
  }
  return dir;
}

function todoPath(workspaceDir) {
  return path.join(workspaceDir, 'todo.md');
}

function normalizarPlanPersistente(plan) {
  if (Array.isArray(plan)) return plan;
  try {
    const parsed = JSON.parse(plan || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function sincronizarContextoTarea(db, task, workspaceDir, planForzado = null) {
  const row = db.prepare('SELECT plan, status, updated_at FROM computer_tasks WHERE id = ?').get(task.id) || {};
  const fases = planForzado || normalizarPlanPersistente(row.plan);
  const now = new Date().toISOString();
  const lineas = [
    '# Contexto persistente de tarea Zoco',
    '',
    `- Tarea: ${task.title}`,
    `- Estado: ${row.status || task.status || 'en_curso'}`,
    `- Actualizado: ${now}`,
    '',
    '## Plan global',
  ];
  if (fases.length) {
    for (const fase of fases) {
      const marca = fase.estado === 'completada' ? 'x' : fase.estado === 'en_curso' ? '>' : ' ';
      lineas.push(`- [${marca}] ${fase.titulo}`);
    }
  } else {
    lineas.push('- [>] Analizar el objetivo y crear un plan con la herramienta gestionar_plan.');
  }
  lineas.push('', '## Reglas de continuidad', '- Antes de repetir una herramienta, revisa el último resultado.', '- Mantén los entregables dentro del workspace.', '- Actualiza el plan al completar una fase.');
  const contenido = `${lineas.join('\n')}\n`;
  await fsp.writeFile(todoPath(workspaceDir), contenido, 'utf8');
  return { ruta: 'todo.md', contenido, fases };
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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
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
function runShell(comando, cwd, timeoutMs, onOutput = null) {
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
      const fragmento = buf.toString();
      if (salida.length < MAX_OUTPUT_CHARS * 2) salida += fragmento;
      // No se espera al final del comando: cada fragmento llega al runtime vivo.
      if (typeof onOutput === 'function' && fragmento) onOutput(fragmento);
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
async function executeTool(db, task, workspaceDir, name, args, context, runtime = {}) {
  const toolRun = {
    tool_run_id: runtime.toolRunId || context.uuidv4(),
    herramienta: name || 'desconocida',
  };
  activeToolRuns.set(task.id, toolRun);
  try {
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
      const contextoPersistente = await sincronizarContextoTarea(db, task, workspaceDir, normalizadas);
      recordEvent(db, task.id, 'plan_updated', { fases: normalizadas, contexto: contextoPersistente.ruta });
      const actual = normalizadas.find(f => f.estado === 'en_curso');
      return `Plan actualizado con ${normalizadas.length} fases.` +
             (actual ? ` Fase en curso: "${actual.titulo}".` : '');
    }

    case 'terminal': {
      const comando = String(args.comando || '').trim();
      if (!comando) return 'Falta el comando a ejecutar.';
      const cwd = args.directorio ? resolveInside(workspaceDir, args.directorio) : workspaceDir;
      fs.mkdirSync(cwd, { recursive: true });
      recordEvent(db, task.id, 'terminal_start', { comando, directorio: path.relative(workspaceDir, cwd) || '.' });
      if (!context.sandboxSessionId) {
        return 'La sandbox efímera no está disponible para esta tarea. No se ejecutará el comando en el servidor principal.';
      }
      const relativo = path.relative(workspaceDir, cwd) || '.';
      const comandoAislado = relativo === '.' ? comando : `cd -- ${shellQuote(relativo)} && ${comando}`;
      try {
        recordEvent(db, task.id, 'sandbox_command', { comando, directorio: relativo, sesion: 'efímera', channel: 'terminal' });
        const commandStartedAt = Date.now();
        const commandHeartbeat = setInterval(() => {
          const segundos = Math.max(1, Math.round((Date.now() - commandStartedAt) / 1000));
          setRuntimeState(db, task.id, {
            phase: 'tool_running', active_tool: 'terminal',
            elapsed_seconds: segundos, status_detail: 'Comando ejecutándose dentro de la sandbox aislada.',
          });
          recordEvent(db, task.id, 'tool_progress', {
            herramienta: 'terminal', segundos, channel: 'terminal',
            mensaje: `El comando continúa ejecutándose en la sandbox (${segundos}s).`,
          });
        }, 2500);
        let resultado;
        try {
          resultado = await executeInSandbox(context.sandboxSessionId, comandoAislado, args.timeout_ms);
        } finally {
          clearInterval(commandHeartbeat);
        }
        const salida = truncar(`${resultado.stdout || ''}${resultado.stderr || ''}`);
        if (salida) recordEvent(db, task.id, 'terminal_output', { comando, salida: truncar(salida, 4000) });
        recordEvent(db, task.id, 'tool_result', {
          herramienta: 'terminal', comando, codigo: resultado.exit_code, salida: truncar(salida, 4000), sandbox: true, channel: 'terminal',
        });
        return `[sandbox aislada · código de salida ${resultado.exit_code}]\n${salida || '(sin salida)'}`;
      } catch (err) {
        recordEvent(db, task.id, 'sandbox_error', { comando, mensaje: err.message, channel: 'terminal' });
        return `La sandbox aislada rechazó o no pudo ejecutar el comando: ${err.message}`;
      }
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
        const accion = String(args.accion || '');
        const esInteractiva = ['clic', 'escribir', 'tecla'].includes(accion);
        if (esInteractiva) {
          if (!task.browser_profile_id) {
            return 'Para escribir, pulsar teclas o hacer clic debes seleccionar un perfil de navegador persistente y aprobar el dominio. La navegación y las capturas públicas sí están permitidas con el perfil de invitado aislado.';
          }
          const state = parseRuntimeState(task.runtime_state);
          const targetUrl = String(args.url || state.browser_url || '');
          let domain = null;
          try { domain = new URL(targetUrl).hostname.toLowerCase(); } catch { /* se solicita una aprobación que el usuario puede revisar */ }
          const grant = domain ? db.prepare(`SELECT permission FROM browser_domain_permissions
            WHERE profile_id = ? AND domain = ? AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`).get(task.browser_profile_id, domain) : null;
          if (!grant || grant.permission !== 'interactuar') {
            const existing = db.prepare(`SELECT id FROM browser_action_approvals
              WHERE task_id = ? AND status = 'pendiente' AND datetime(expires_at) > datetime('now') ORDER BY created_at DESC LIMIT 1`).get(task.id);
            const approvalId = existing?.id || context.uuidv4();
            if (!existing) {
              db.prepare(`INSERT INTO browser_action_approvals (id, task_id, user_id, profile_id, domain, action_json, status, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, 'pendiente', datetime('now', '+10 minutes'))`)
                .run(approvalId, task.id, task.user_id, task.browser_profile_id, domain, JSON.stringify({ accion, url: targetUrl || null, texto: accion === 'escribir' ? String(args.texto || '').slice(0, 120) : null }));
            }
            setRuntimeState(db, task.id, { phase: 'awaiting_browser_approval', active_tool: null, channel: 'web', status_detail: `Esperando tu aprobación para interactuar con ${domain || 'esta página'}.` }, 'browser_approval_required');
            recordEvent(db, task.id, 'browser_approval_required', { channel: 'web', approval_id: approvalId, domain, accion, profile_id: task.browser_profile_id });
            db.prepare("UPDATE computer_tasks SET status = 'pausada', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);
            return `Acción web detenida por seguridad. Se creó la aprobación ${approvalId} para ${domain || 'la página actual'}. El usuario debe aprobarla desde el panel antes de reanudar.`;
          }
        }
        const profileKind = task.browser_profile_id
          ? db.prepare('SELECT profile_kind FROM browser_profiles WHERE id = ? AND user_id = ?').get(task.browser_profile_id, task.user_id)?.profile_kind
          : null;
        if (profileKind === 'chrome_bridge') {
          const bridged = await executeBrowserBridgeAction(db, task, args);
          recordEvent(db, task.id, 'browser_action_done', { accion: args.accion, url: bridged.url || args.url || null, texto: bridged.texto, proveedor: 'chrome_vinculado', channel: 'web' });
          return bridged.texto;
        }
        const r = await browserAction({
          taskId: task.id,
          profileId: task.browser_profile_id || 'guest',
          apiKey: E2B_API_KEY,
          accion: args.accion,
          url: args.url,
          x: args.x, y: args.y,
          texto: args.texto, tecla: args.tecla,
          direccion: args.direccion, cantidad: args.cantidad,
          onEvent: (type, payload) => recordEvent(db, task.id, type, payload),
        });
        const browserUrl = r.url || args.url || null;
        if (browserUrl) {
          setRuntimeState(db, task.id, { browser_url: browserUrl, browser_domain: (() => { try { return new URL(browserUrl).hostname.toLowerCase(); } catch { return null; } })() });
        }
        recordEvent(db, task.id, 'browser_action_done', {
          accion: args.accion, url: browserUrl, texto: r.texto, streamUrl: r.streamUrl || null,
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
  } finally {
    const actual = activeToolRuns.get(task.id);
    if (actual?.tool_run_id === toolRun.tool_run_id) activeToolRuns.delete(task.id);
  }
}

// ─── Arranque de una tarea en segundo plano ──────────────────────────────────

// Tareas vivas en este proceso, para poder consultarlas y evitar duplicados.
const enEjecucion = new Set();
// Recursos en curso por tarea: el botón Detener puede liberar sandbox y navegador
// inmediatamente, mientras el bucle comprueba la cancelación antes de cada acción.
const runtimeSessions = new Map(); // task_id -> { sandboxSessionId, cancelled }

function lanzarTarea({ db, uuidv4, task, makeCallModel }) {
  if (enEjecucion.has(task.id)) return;
  enEjecucion.add(task.id);

  const workspaceDir = workspaceFor(task.id);

  const iniciar = async () => {
    setRuntimeState(db, task.id, {
      phase: 'initializing', iteration: 0, active_tool: null,
      provider: process.env.AI_PROVIDER || 'ollama', model: task.model,
      started_at: new Date().toISOString(), status_detail: 'Preparando el workspace y el entorno aislado.',
    }, 'task_initializing');
    const contextoPersistente = await sincronizarContextoTarea(db, task, workspaceDir);
    let sandboxSessionId = null;
    try {
      const sandbox = await createSandboxSession(task.id);
      sandboxSessionId = sandbox.session_id;
      runtimeSessions.set(task.id, { sandboxSessionId, cancelled: false });
      setRuntimeState(db, task.id, { sandbox_session_id: sandboxSessionId, phase: 'sandbox_ready', status_detail: 'Sandbox efímera preparada.' });
      recordEvent(db, task.id, 'sandbox_started', { perfil: 'efímera restringida', red: 'interna sin salida', channel: 'terminal' });
    } catch (err) {
      recordEvent(db, task.id, 'sandbox_unavailable', { mensaje: err.message });
    }
    setRuntimeState(db, task.id, { phase: 'agent_ready', status_detail: 'Agente listo para planificar.' }, 'task_started');
    recordEvent(db, task.id, 'task_started', { titulo: task.title, modelo: task.model, contexto: contextoPersistente.ruta, channel: 'agent' });

    // Toda URL pública entregada por el usuario se abre primero en Chromium aislado.
    // La captura, URL final y texto visible llegan al panel Web antes del razonamiento,
    // de modo que el agente no sustituye la observación por curl ni por una conjetura.
    const visualMatch = String(task.title || '').match(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9.-]*\.(?:es|com|org|net)(?:\/[^\s]*)?/i);
    if (visualMatch) {
      const candidate = visualMatch[0];
      const visualUrl = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
      setRuntimeState(db, task.id, {
        phase: 'browser_loading', active_tool: 'navegador', channel: 'web',
        status_detail: `Abriendo ${visualUrl} en el navegador visual aislado.`,
      }, 'browser_preinspection_started');
      const visual = await browserAction({
        taskId: task.id,
        profileId: task.browser_profile_id || 'guest',
        apiKey: E2B_API_KEY,
        accion: 'navegar',
        url: visualUrl,
        onEvent: (type, payload) => recordEvent(db, task.id, type, { ...payload, channel: 'web', session_scope: task.browser_profile_id ? 'perfil_persistente' : 'invitado_aislado' }),
      });
      setRuntimeState(db, task.id, {
        phase: visual.disponible ? 'browser_ready' : 'browser_error', active_tool: null, channel: 'web',
        status_detail: visual.disponible ? `Página cargada: ${visual.url || visualUrl}` : visual.texto,
      }, 'browser_preinspection_finished');
      recordEvent(db, task.id, 'browser_action_done', {
        accion: 'navegar', url: visual.url || visualUrl, texto: visual.texto,
        proveedor: 'chromium_aislado', channel: 'web', session_scope: task.browser_profile_id ? 'perfil_persistente' : 'invitado_aislado',
      });
      if (task.browser_profile_id && visual.disponible) {
        db.prepare('UPDATE browser_profiles SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(task.browser_profile_id);
      }
      db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?, ?, ?, ?)').run(
        uuidv4(), task.id, 'user', `[Observación visual real ya disponible desde Chromium aislado. Resume esta captura y texto; no uses terminal para navegar.]\n${visual.texto}`
      );

      // Las peticiones que solo piden mostrar o describir una URL ya tienen un
      // resultado verificable. No se delegan de nuevo al modelo local, porque
      // eso añadía minutos de espera sin aportar una acción adicional.
      const esConsultaVisualDirecta = /\b(?:muestrame|muéstrame|qué ves|que ves|describe(?:\s+brevemente)?\s+(?:lo\s+)?que\s+ves|qué\s+se\s+ve)\b/i.test(String(task.title || ''))
        && !/\b(?:crea|construye|desarrolla|implementa|edita|corrige|proyecto|aplicaci[oó]n)\b/i.test(String(task.title || ''));
      if (visual.disponible && esConsultaVisualDirecta) {
        const resumen = `He abierto ${visual.url || visualUrl} en el navegador visual de Zoco.\n\n${String(visual.texto || '').slice(0, 2400)}\n\nLa captura real y el contenido observado están disponibles en la pestaña Web del ordenador.`;
        db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?, ?, ?, ?)').run(uuidv4(), task.id, 'assistant', resumen);
        db.prepare("UPDATE computer_tasks SET status = 'completada', result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(resumen, task.id);
        setRuntimeState(db, task.id, { phase: 'completed', active_tool: null, channel: 'web', status_detail: 'Inspección visual completada con captura y texto reales.', completed_at: new Date().toISOString() }, 'visual_inspection_completed');
        recordEvent(db, task.id, 'finished', { resumen, channel: 'agent', archivos: [] });
        closeSandboxSession(sandboxSessionId);
        void closeLocalBrowser(task.id);
        runtimeSessions.delete(task.id);
        enEjecucion.delete(task.id);
        return;
      }
    }

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
    setRuntimeState,
    buildSystemPrompt: () => buildComputerSystemPrompt({
      taskTitle: task.title,
      workspaceDir,
      tieneNavegador: BROWSER_PROVIDER !== 'e2b' || Boolean(E2B_API_KEY),
    }),
    tools: TOOLS,
      context: {
        uuidv4,
        publicBase: PUBLIC_BASE,
        sandboxSessionId,
        isCancelled: () => Boolean(runtimeSessions.get(task.id)?.cancelled),
        reciteTaskContext: () => {
        try { return fs.readFileSync(todoPath(workspaceDir), 'utf8'); } catch { return ''; }
      },
    },
  })
    .catch((err) => {
      console.error(`[ZocoComputer] fallo no capturado en la tarea ${task.id}:`, err);
      try {
        setRuntimeState(db, task.id, { phase: 'error', active_tool: null, status_detail: `Error interno: ${err.message}` });
        recordEvent(db, task.id, 'error', { mensaje: `Error interno del agente: ${err.message}`, channel: 'agent' });
        db.prepare("UPDATE computer_tasks SET status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(task.id);
      } catch { /* la BD puede estar cerrándose */ }
    })
    .finally(() => {
      closeSandboxSession(sandboxSessionId);
      void closeLocalBrowser(task.id);
      runtimeSessions.delete(task.id);
      enEjecucion.delete(task.id);
    });
  };

  iniciar().catch((err) => {
    console.error(`[ZocoComputer] no se pudo iniciar la tarea ${task.id}:`, err);
    recordEvent(db, task.id, 'error', { mensaje: `No se pudo preparar el contexto de tarea: ${err.message}` });
    db.prepare("UPDATE computer_tasks SET status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);
    enEjecucion.delete(task.id);
  });
}

// ─── Rutas Express ───────────────────────────────────────────────────────────

export function registerComputerRoutes({
  app, db, authMiddleware, uuidv4, workspacesRoot, makeCallModel, isAIConfigured = () => true, aiConfigurationError = () => null, jwt, JWT_SECRET,
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
  const perfilPropietario = (req, id) =>
    db.prepare('SELECT * FROM browser_profiles WHERE id = ? AND user_id = ?').get(id, req.auth.sub);
  const normalizarDominio = (raw) => {
    try { return new URL(/^https?:\/\//i.test(String(raw || '')) ? raw : `https://${raw}`).hostname.toLowerCase(); } catch { return null; }
  };
  const serializarPerfil = (perfil) => {
    const permisos = db.prepare('SELECT id, domain, permission, expires_at, created_at, updated_at FROM browser_domain_permissions WHERE profile_id = ? ORDER BY domain').all(perfil.id);
    return { id: perfil.id, label: perfil.label, status: perfil.status, created_at: perfil.created_at, last_used_at: perfil.last_used_at, permissions: permisos };
  };

  // ── Perfiles y permisos del navegador ──
  app.get('/api/computer/browser/profiles', authMiddleware, (req, res) => {
    const perfiles = db.prepare('SELECT * FROM browser_profiles WHERE user_id = ? ORDER BY datetime(created_at) DESC').all(req.auth.sub);
    res.json(perfiles.map(serializarPerfil));
  });

  app.post('/api/computer/browser/profiles', authMiddleware, (req, res) => {
    const label = String(req.body?.label || 'Mi navegador').trim().slice(0, 80);
    if (!label) return res.status(400).json({ error: 'El nombre del perfil es obligatorio.' });
    const id = uuidv4();
    // No se guarda ningún secreto ni cookie en SQLite; la clave solo identifica
    // el directorio privado de Chromium en el volumen aislado.
    const profileKey = `zoco_${req.auth.sub.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 36)}_${id.replace(/-/g, '')}`;
    db.prepare('INSERT INTO browser_profiles (id, user_id, label, profile_key, status) VALUES (?, ?, ?, ?, \'activo\')')
      .run(id, req.auth.sub, label, profileKey);
    res.status(201).json(serializarPerfil(perfilPropietario(req, id)));
  });

  app.patch('/api/computer/browser/profiles/:id', authMiddleware, (req, res) => {
    const perfil = perfilPropietario(req, req.params.id);
    if (!perfil) return res.status(404).json({ error: 'Perfil de navegador no encontrado.' });
    const label = req.body?.label === undefined ? perfil.label : String(req.body.label).trim().slice(0, 80);
    const status = req.body?.status === 'revocado' ? 'revocado' : req.body?.status === 'activo' ? 'activo' : perfil.status;
    if (!label) return res.status(400).json({ error: 'El nombre del perfil es obligatorio.' });
    db.prepare('UPDATE browser_profiles SET label = ?, status = ? WHERE id = ? AND user_id = ?').run(label, status, perfil.id, req.auth.sub);
    res.json(serializarPerfil(perfilPropietario(req, perfil.id)));
  });

  app.put('/api/computer/browser/profiles/:id/domains', authMiddleware, (req, res) => {
    const perfil = perfilPropietario(req, req.params.id);
    if (!perfil) return res.status(404).json({ error: 'Perfil de navegador no encontrado.' });
    const domain = normalizarDominio(req.body?.domain);
    const permission = ['leer', 'interactuar'].includes(req.body?.permission) ? req.body.permission : 'leer';
    if (!domain) return res.status(400).json({ error: 'Indica un dominio válido.' });
    const expiresAt = req.body?.expires_at ? new Date(req.body.expires_at).toISOString() : null;
    db.prepare(`INSERT INTO browser_domain_permissions (id, profile_id, domain, permission, expires_at, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(profile_id, domain) DO UPDATE SET permission = excluded.permission, expires_at = excluded.expires_at, updated_at = CURRENT_TIMESTAMP`)
      .run(uuidv4(), perfil.id, domain, permission, expiresAt);
    res.json(serializarPerfil(perfilPropietario(req, perfil.id)));
  });

  app.delete('/api/computer/browser/profiles/:id/domains/:domain', authMiddleware, (req, res) => {
    const perfil = perfilPropietario(req, req.params.id);
    const domain = normalizarDominio(req.params.domain);
    if (!perfil || !domain) return res.status(404).json({ error: 'Permiso de navegador no encontrado.' });
    db.prepare('DELETE FROM browser_domain_permissions WHERE profile_id = ? AND domain = ?').run(perfil.id, domain);
    res.status(204).end();
  });

  // ── Puente autenticado de navegador local ──
  // La extensión solo recibe un token de dispositivo revocable. Nunca recibe ni
  // transmite cookies, contraseñas o la sesión JWT de Zoco.
  app.post('/api/computer/browser/bridge/pairings', authMiddleware, (req, res) => {
    const label = String(req.body?.label || 'Chrome personal').trim().slice(0, 80);
    const profileId = uuidv4();
    const profileKey = `bridge_${req.auth.sub.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 36)}_${profileId.replace(/-/g, '')}`;
    const rawCode = crypto.randomBytes(5).toString('hex').toUpperCase();
    const pairingCode = `${rawCode.slice(0, 5)}-${rawCode.slice(5)}`;
    const codeHash = crypto.createHash('sha256').update(pairingCode).digest('hex');
    db.prepare(`INSERT INTO browser_profiles (id, user_id, label, profile_key, profile_kind, status)
                VALUES (?, ?, ?, ?, 'chrome_bridge', 'pendiente')`).run(profileId, req.auth.sub, label, profileKey);
    db.prepare(`INSERT INTO browser_bridge_pairs (id, user_id, code_hash, profile_id, expires_at)
                VALUES (?, ?, ?, ?, datetime('now', '+10 minutes'))`).run(uuidv4(), req.auth.sub, codeHash, profileId);
    res.status(201).json({ profile: serializarPerfil(perfilPropietario(req, profileId)), pairingCode, expires_in: '10 minutos' });
  });

  app.post('/api/browser-bridge/pair', (req, res) => {
    const pairingCode = String(req.body?.pairingCode || '').trim().toUpperCase();
    if (!/^[A-F0-9]{5}-[A-F0-9]{5}$/.test(pairingCode)) return res.status(400).json({ error: 'Código de emparejamiento inválido.' });
    const codeHash = crypto.createHash('sha256').update(pairingCode).digest('hex');
    const pair = db.prepare(`SELECT * FROM browser_bridge_pairs WHERE code_hash = ? AND claimed_at IS NULL AND datetime(expires_at) > datetime('now')`).get(codeHash);
    if (!pair) return res.status(410).json({ error: 'El código ha caducado, ya fue usado o no existe.' });
    const deviceId = uuidv4();
    const deviceToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(deviceToken).digest('hex');
    db.prepare(`INSERT INTO browser_bridge_devices (id, user_id, profile_id, token_hash, browser, last_seen_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(deviceId, pair.user_id, pair.profile_id, tokenHash, String(req.body?.browser || 'chrome-extension').slice(0, 80));
    db.prepare("UPDATE browser_bridge_pairs SET claimed_at = CURRENT_TIMESTAMP WHERE id = ?").run(pair.id);
    db.prepare("UPDATE browser_profiles SET bridge_device_id = ?, profile_kind = 'chrome_bridge', status = 'activo', last_used_at = CURRENT_TIMESTAMP WHERE id = ?").run(deviceId, pair.profile_id);
    res.json({ deviceToken });
  });

  const bridgeDevice = (rawToken) => {
    if (!rawToken) return null;
    const hash = crypto.createHash('sha256').update(String(rawToken)).digest('hex');
    return db.prepare("SELECT * FROM browser_bridge_devices WHERE token_hash = ? AND status = 'activo'").get(hash);
  };

  app.post('/api/browser-bridge/poll', (req, res) => {
    const device = bridgeDevice(req.body?.deviceToken);
    if (!device) return res.status(401).json({ error: 'Dispositivo de navegador no autorizado.' });
    db.prepare('UPDATE browser_bridge_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(device.id);
    const commands = db.prepare("SELECT id, action_json FROM browser_bridge_commands WHERE device_id = ? AND status = 'pendiente' ORDER BY datetime(created_at) ASC LIMIT 5").all(device.id)
      .map(row => ({ id: row.id, action: (() => { try { return JSON.parse(row.action_json); } catch { return {}; } })() }));
    if (commands.length) db.prepare("UPDATE browser_bridge_commands SET status = 'entregado' WHERE id IN (" + commands.map(() => '?').join(',') + ")").run(...commands.map(command => command.id));
    res.json({ commands });
  });

  app.post('/api/browser-bridge/events', (req, res) => {
    const device = bridgeDevice(req.body?.deviceToken);
    if (!device) return res.status(401).json({ error: 'Dispositivo de navegador no autorizado.' });
    const command = db.prepare('SELECT * FROM browser_bridge_commands WHERE id = ? AND device_id = ?').get(req.body?.commandId, device.id);
    if (!command || command.status !== 'entregado') return res.status(404).json({ error: 'Comando de navegador no encontrado.' });
    const result = req.body?.ok ? req.body?.result || {} : { error: String(req.body?.error || 'El navegador local no pudo ejecutar la acción.') };
    db.prepare("UPDATE browser_bridge_commands SET status = ?, result_json = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(req.body?.ok ? 'completado' : 'error', JSON.stringify(result), command.id);
    if (command.task_id) recordEvent(db, command.task_id, req.body?.ok ? 'browser_bridge_result' : 'browser_bridge_error', { channel: 'web', command_id: command.id, ...result });
    res.json({ ok: true });
  });

  app.get('/api/computer/browser/approvals', authMiddleware, (req, res) => {
    const rows = db.prepare(`SELECT id, task_id, profile_id, domain, action_json, status, expires_at, resolved_at, created_at
                             FROM browser_action_approvals WHERE user_id = ? AND status = 'pendiente' AND datetime(expires_at) > datetime('now')
                             ORDER BY datetime(created_at) DESC LIMIT 50`).all(req.auth.sub);
    res.json(rows.map(row => ({ ...row, action: (() => { try { return JSON.parse(row.action_json); } catch { return {}; } })() })));
  });

  app.post('/api/computer/browser/approvals/:id/resolve', authMiddleware, (req, res) => {
    const approval = db.prepare('SELECT * FROM browser_action_approvals WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
    if (!approval || approval.status !== 'pendiente') return res.status(404).json({ error: 'Aprobación pendiente no encontrada.' });
    const approved = req.body?.approved === true;
    const status = approved ? 'aprobada' : 'rechazada';
    db.prepare('UPDATE browser_action_approvals SET status = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, approval.id);
    if (approved && approval.profile_id && approval.domain) {
      db.prepare(`INSERT INTO browser_domain_permissions (id, profile_id, domain, permission, expires_at, updated_at)
                  VALUES (?, ?, ?, 'interactuar', datetime('now', '+8 hours'), CURRENT_TIMESTAMP)
                  ON CONFLICT(profile_id, domain) DO UPDATE SET permission = 'interactuar', expires_at = datetime('now', '+8 hours'), updated_at = CURRENT_TIMESTAMP`)
        .run(uuidv4(), approval.profile_id, approval.domain);
    }
    recordEvent(db, approval.task_id, approved ? 'browser_action_approved' : 'browser_action_rejected', { channel: 'web', domain: approval.domain, approval_id: approval.id, permission: approved ? 'interactuar durante 8 horas' : null });
    const task = db.prepare('SELECT * FROM computer_tasks WHERE id = ? AND user_id = ?').get(approval.task_id, req.auth.sub);
    if (approved && task && ['pausada', 'detenida'].includes(task.status) && !enEjecucion.has(task.id)) {
      db.prepare("UPDATE computer_tasks SET status = 'en_curso', cancel_requested_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);
      const refreshed = db.prepare('SELECT * FROM computer_tasks WHERE id = ?').get(task.id);
      setRuntimeState(db, task.id, { phase: 'resuming_after_browser_approval', active_tool: null, channel: 'web', status_detail: `Permiso concedido para ${approval.domain}. Reanudando la tarea.` }, 'browser_approval_resumed');
      setImmediate(() => lanzarTarea({ db, uuidv4, task: refreshed, makeCallModel }));
    }
    res.json({ id: approval.id, status, permission_expires_in: approved ? '8 horas' : null });
  });

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
        `SELECT id, title, status, model, browser_profile_id, plan, result, runtime_state, last_event_id, heartbeat_at, cancel_requested_at, created_at, updated_at
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

      if (!isAIConfigured()) {
        return res.status(503).json({
          error: aiConfigurationError() || 'El motor de IA no está configurado en el servidor.',
        });
      }

      const id = uuidv4();
      const modelo = resolverModelo(req.body?.model);
      const browserProfileId = req.body?.browserProfileId ? String(req.body.browserProfileId) : null;
      if (browserProfileId) {
        const profile = perfilPropietario(req, browserProfileId);
        if (!profile || profile.status !== 'activo') {
          return res.status(400).json({ error: 'El perfil de navegador seleccionado no existe, no te pertenece o está revocado.' });
        }
      }

      db.prepare(
        `INSERT INTO computer_tasks (id, user_id, title, status, model, browser_profile_id, runtime_state, created_at, updated_at)
         VALUES (?, ?, ?, 'en_curso', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).run(id, req.auth.sub, titulo, modelo, browserProfileId, JSON.stringify({
        phase: 'queued', iteration: 0, active_tool: null, provider: process.env.AI_PROVIDER || 'ollama',
        model: modelo, browser_profile_id: browserProfileId, started_at: null, last_progress_at: new Date().toISOString(), status_detail: 'Tarea en cola de preparación.',
      }));

      db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), id, 'user', titulo);

      const task = db.prepare('SELECT * FROM computer_tasks WHERE id = ?').get(id);
      recordEvent(db, id, 'task_queued', { channel: 'agent', titulo, modelo });

      // Respondemos ya: el panel se suscribirá al stream por separado.
      res.status(201).json({ id, title: titulo, status: 'en_curso', model: modelo, browser_profile_id: browserProfileId });

      lanzarTarea({ db, uuidv4, task, makeCallModel });
    } catch (err) {
      console.error('[ZocoComputer] error creando tarea:', err);
      if (!res.headersSent) res.status(500).json({ error: 'No se pudo crear la tarea.' });
    }
  });

  // ── Instantánea operacional: permite reanudar el panel sin inferir estados ──
  app.get('/api/computer/tasks/:id/runtime', authMiddleware, (req, res) => {
    try {
      const task = propietario(req, req.params.id);
      if (!task) return res.status(404).json({ error: 'Tarea no encontrada.' });
      const runtime = parseRuntimeState(task.runtime_state);
      const lastEvents = db.prepare(
        'SELECT id, type, payload, created_at FROM computer_events WHERE task_id = ? ORDER BY id DESC LIMIT 80'
      ).all(task.id).reverse().map(e => ({
        event_id: e.id, type: e.type, created_at: e.created_at,
        ...(() => { try { return JSON.parse(e.payload || '{}'); } catch { return {}; } })(),
      }));
      res.json({
        task: { id: task.id, title: task.title, status: task.status, model: task.model, browser_profile_id: task.browser_profile_id, result: task.result },
        runtime,
        live: enEjecucion.has(task.id),
        last_event_id: task.last_event_id || lastEvents.at(-1)?.event_id || 0,
        events: lastEvents,
      });
    } catch (err) {
      console.error('[ZocoComputer] error obteniendo runtime:', err);
      res.status(500).json({ error: 'No se pudo obtener el estado operativo.' });
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
        runtime: parseRuntimeState(task.runtime_state),
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

    // Primero se transmite la instantánea: el cliente conoce el estado real
    // incluso antes de recibir la reemisión o conectarse por primera vez.
    const runtime = parseRuntimeState(task.runtime_state);
    const snapshot = {
      type: 'runtime_snapshot', channel: 'agent', schema_version: 2,
      runtime, status: task.status, last_event_id: task.last_event_id || 0,
      live: enEjecucion.has(task.id), ts: new Date().toISOString(),
    };
    res.write(`event: runtime_snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

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
      const runtime = runtimeSessions.get(task.id);
      if (runtime) {
        runtime.cancelled = true;
        if (runtime.sandboxSessionId) void closeSandboxSession(runtime.sandboxSessionId);
      }
      db.prepare("UPDATE computer_tasks SET status = 'detenida', cancel_requested_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(new Date().toISOString(), task.id);
      setRuntimeState(db, task.id, { phase: 'cancelling', active_tool: null, status_detail: 'Cancelación solicitada; liberando recursos.' }, 'stop_requested');
      recordEvent(db, task.id, 'tool_cancelled', { channel: 'agent', mensaje: 'Cancelación solicitada por el usuario.' });
      recordEvent(db, task.id, 'stopped', { mensaje: 'Tarea detenida por el usuario.', channel: 'agent' });
      void closeLocalBrowser(task.id);
      res.json({ ok: true, cancelled: Boolean(runtime) });
    } catch (err) {
      console.error('[ZocoComputer] error deteniendo tarea:', err);
      res.status(500).json({ error: 'No se pudo detener la tarea.' });
    }
  });

  // ── Reintentar una tarea terminal ──
  app.post('/api/computer/tasks/:id/retry', authMiddleware, (req, res) => {
    try {
      const task = propietario(req, req.params.id);
      if (!task) return res.status(404).json({ error: 'Tarea no encontrada.' });
      if (task.status === 'en_curso') return res.status(409).json({ error: 'La tarea ya está en curso.' });
      if (!['error', 'pausada', 'detenida'].includes(task.status)) {
        return res.status(409).json({ error: 'Solo pueden reintentarse tareas fallidas, pausadas o detenidas.' });
      }
      if (!isAIConfigured()) {
        return res.status(503).json({ error: aiConfigurationError() || 'El motor de IA no está configurado en el servidor.' });
      }

      // Un reintento debe conservar el objetivo del usuario, no las respuestas
      // erróneas del modelo anterior: esas respuestas se reinyectarían como
      // contexto y pueden provocar que repita una estrategia fallida.
      db.transaction(() => {
        db.prepare("DELETE FROM computer_messages WHERE task_id = ? AND role = 'assistant'").run(task.id);
        db.prepare("UPDATE computer_tasks SET status = 'en_curso', plan = NULL, result = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);
        db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?, ?, ?, ?)')
          .run(uuidv4(), task.id, 'user', '[Reintento limpio] Ejecuta el objetivo original desde cero. Revisa los resultados de las herramientas y no repitas una acción fallida.');
      })();
      const fresh = db.prepare('SELECT * FROM computer_tasks WHERE id = ?').get(task.id);
      recordEvent(db, task.id, 'task_retried', { mensaje: 'Tarea reintentada desde un contexto limpio.' });
      lanzarTarea({ db, uuidv4, task: fresh, makeCallModel });
      res.json({ ok: true, id: task.id, status: 'en_curso' });
    } catch (err) {
      console.error('[ZocoComputer] error reintentando tarea:', err);
      res.status(500).json({ error: 'No se pudo reintentar la tarea.' });
    }
  });

  // ── Eliminar una tarea terminal y sus datos de trabajo ──
  app.delete('/api/computer/tasks/:id', authMiddleware, async (req, res) => {
    try {
      const task = propietario(req, req.params.id);
      if (!task) return res.status(404).json({ error: 'Tarea no encontrada.' });
      if (task.status === 'en_curso') {
        return res.status(409).json({ error: 'Detén la tarea antes de eliminarla.' });
      }

      const borrar = db.transaction(() => {
        db.prepare('DELETE FROM computer_events WHERE task_id = ?').run(task.id);
        db.prepare('DELETE FROM computer_messages WHERE task_id = ?').run(task.id);
        db.prepare('DELETE FROM computer_tasks WHERE id = ? AND user_id = ?').run(task.id, req.auth.sub);
      });
      borrar();
      await closeLocalBrowser(task.id);
      await fsp.rm(workspaceFor(task.id), { recursive: true, force: true });
      res.json({ ok: true, id: task.id });
    } catch (err) {
      console.error('[ZocoComputer] error eliminando tarea:', err);
      res.status(500).json({ error: 'No se pudo eliminar la tarea.' });
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
