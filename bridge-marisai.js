// bridge-marisai.js
// -----------------------------------------------------------------------------
// Puente entre el gateway de chat (server.js) y dos cosas distintas:
//
//   1. Un sandbox Docker REAL (Dockerode) para tareas agenticas de ejecucion
//      de comandos — runAgenticTask() / shutdownAllSandboxes().
//   2. Las piezas que server.js necesita para los agentes "generic_prompted"
//      y "deterministic": plantillas maestras de prompt, ejecutores sin LLM,
//      y las rutas admin del puente con Marisai (import de prompts As-Is).
//
// Este archivo se sobrescribio en un commit anterior solo con la parte (1)
// (el sandbox Docker), perdiendo la parte (2) que server.js sigue
// importando y usando (ensureBridgeTables/resolveTemplatePrompt/
// runDeterministicAgent/registerBridgeAdminRoutes). Aqui se fusionan ambas.
// -----------------------------------------------------------------------------

import Docker from 'dockerode';
// Node 18+ incluye fetch nativo (undici) en el ámbito global, así que no hace
// falta la dependencia externa 'node-fetch'. Además NO estaba declarada en
// package.json, por lo que este import hacía caer el servidor al arrancar con
// ERR_MODULE_NOT_FOUND antes de atender ninguna petición.
import { randomUUID } from 'crypto';

const docker = new Docker(); // usa /var/run/docker.sock por defecto

// ─── Configuracion sandbox ──────────────────────────────────────────────────

const MAX_ITERATIONS = parseInt(process.env.AGENT_MAX_ITERATIONS || '8', 10);
const COMMAND_TIMEOUT_MS = parseInt(process.env.AGENT_COMMAND_TIMEOUT_MS || '60000', 10);
const SESSION_IDLE_TTL_MS = parseInt(process.env.AGENT_SESSION_TTL_MS || '600000', 10); // 10 min
const SANDBOX_IMAGE = process.env.AGENT_SANDBOX_IMAGE || 'python:3.12-slim';

// Si true, el contenedor de la sesion se crea con red (para pip/npm install).
// Recomendado: red dedicada 'zoco-sandbox-net' con reglas de firewall/egress
// en el host que solo permitan salida a los registries (pypi.org, npmjs.org,
// etc.), nunca 'bridge' abierta a todo internet.
const ALLOW_NETWORK_FOR_INSTALLS = process.env.AGENT_ALLOW_NETWORK === 'true';
const SANDBOX_NETWORK = process.env.AGENT_SANDBOX_NETWORK || 'zoco-sandbox-net';

// Registro en memoria de sesiones activas: sessionId -> { container, timer }
const activeSessions = new Map();

// ─── Prompt de sistema: protocolo unico <execute_command> ───────────────────

export const SYSTEM_PROMPT_EXECUTE = `Eres Zoco-Max, un agente autonomo con acceso a un sandbox Linux real,
aislado y efimero. Tienes memoria de todo lo ejecutado en esta sesion.

Cuando necesites manipular archivos, instalar paquetes, ejecutar scripts o
inspeccionar el entorno, responde EXCLUSIVAMENTE con un unico bloque:

<execute_command>
comando_bash_aqui
</execute_command>

Reglas estrictas:
- Un unico bloque <execute_command> por respuesta. Nunca mezclado con texto
  explicativo antes o despues si vas a ejecutar algo.
- Los comandos deben ser no interactivos (usa flags como -y, --yes,
  DEBIAN_FRONTEND=noninteractive, etc. para evitar que el proceso se quede
  esperando input).
- Tras cada ejecucion recibiras un mensaje "[RESULTADO DE TERMINAL REAL]"
  con el stdout/stderr real. No lo inventes nunca: si no has recibido ese
  mensaje, el comando NO se ha ejecutado todavia.
- Cuando la tarea este completa, responde con texto normal SIN el tag
  <execute_command>. Eso senaliza el fin de la tarea.
- Si un comando falla, analiza el error real recibido y corrige tu siguiente
  intento; no repitas el mismo comando que ya fallo sin cambiarlo.`;

// ─── Gestion del contenedor sandbox (uno por sesion) ────────────────────────

async function getOrCreateSandbox(sessionId) {
  const existing = activeSessions.get(sessionId);
  if (existing) {
    resetIdleTimer(sessionId);
    return existing.container;
  }

  const containerName = `zoco-sandbox-${sessionId}-${randomUUID().slice(0, 8)}`;

  const hostConfig = {
    Memory: 512 * 1024 * 1024, // 512MB
    NanoCpus: 1e9, // 1 CPU
    PidsLimit: 128,
    ReadonlyRootfs: false, // necesitamos escribir en /workspace, ver Tmpfs
    Tmpfs: { '/workspace': 'rw,size=256m,exec' },
    AutoRemove: true,
  };

  if (!ALLOW_NETWORK_FOR_INSTALLS) {
    hostConfig.NetworkMode = 'none';
  } else {
    hostConfig.NetworkMode = SANDBOX_NETWORK; // red restringida, ver comentario arriba
  }

  let container;
  try {
    container = await docker.createContainer({
      name: containerName,
      Image: SANDBOX_IMAGE,
      Cmd: ['sleep', 'infinity'], // se mantiene vivo; ejecutamos via exec
      WorkingDir: '/workspace',
      User: '1000:1000', // no-root
      HostConfig: hostConfig,
      Tty: false,
    });
    await container.start();
  } catch (err) {
    throw new Error(`No se pudo crear el sandbox: ${err.message}`);
  }

  activeSessions.set(sessionId, { container, timer: null });
  resetIdleTimer(sessionId);
  return container;
}

function resetIdleTimer(sessionId) {
  const entry = activeSessions.get(sessionId);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => destroySandbox(sessionId), SESSION_IDLE_TTL_MS);
}

async function destroySandbox(sessionId) {
  const entry = activeSessions.get(sessionId);
  if (!entry) return;
  activeSessions.delete(sessionId);
  if (entry.timer) clearTimeout(entry.timer);
  try {
    await entry.container.stop({ t: 2 });
  } catch (_) {
    // si ya estaba parado o AutoRemove lo quito, ignoramos
  }
}

// ─── Ejecucion real de un comando dentro del sandbox ────────────────────────

function runWithTimeout(promise, ms, onTimeoutCleanup) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(async () => {
      if (onTimeoutCleanup) {
        try { await onTimeoutCleanup(); } catch (_) {}
      }
      reject(new Error(`Timeout tras ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function execInSandbox(container, bashCommand) {
  let exec;
  try {
    exec = await container.exec({
      Cmd: ['bash', '-lc', bashCommand],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
  } catch (err) {
    return { success: false, stdout: '', stderr: `No se pudo iniciar exec: ${err.message}` };
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    exec.start({}, (err, stream) => {
      if (err) {
        resolve({ success: false, stdout: '', stderr: `Fallo al iniciar stream: ${err.message}` });
        return;
      }

      const stdoutChunks = [];
      const stderrChunks = [];
      docker.modem.demuxStream(
        stream,
        { write: (chunk) => stdoutChunks.push(chunk) },
        { write: (chunk) => stderrChunks.push(chunk) }
      );

      stream.on('end', async () => {
        stdout = Buffer.concat(stdoutChunks).toString('utf8');
        stderr = Buffer.concat(stderrChunks).toString('utf8');
        try {
          const inspect = await exec.inspect();
          resolve({
            success: inspect.ExitCode === 0,
            stdout,
            stderr,
            exitCode: inspect.ExitCode,
          });
        } catch (inspectErr) {
          resolve({ success: false, stdout, stderr: stderr + '\n' + inspectErr.message });
        }
      });

      stream.on('error', (streamErr) => {
        resolve({ success: false, stdout, stderr: `Error de stream: ${streamErr.message}` });
      });
    });
  });
}

// ─── Parseo del tag <execute_command> ───────────────────────────────────────

function extractExecuteCommand(text) {
  const match = /<execute_command>([\s\S]*?)<\/execute_command>/.exec(text);
  if (!match) return null;
  return match[1].trim();
}

function stripExecuteTag(text) {
  return text.replace(/<execute_command>[\s\S]*?<\/execute_command>/, '').trim();
}

// ─── Llamada al modelo via el gateway existente (server.js) ────────────────

async function askModelViaGateway({ gatewayUrl, gatewayApiKey, model, messages }) {
  const res = await fetch(`${gatewayUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${gatewayApiKey}`,
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gateway respondio ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('Respuesta del gateway sin contenido de texto valido.');
  }
  return content;
}

// ─── Bucle agentico principal (sandbox Docker) ──────────────────────────────

/**
 * Ejecuta una tarea de agente completa: llama al modelo, si pide ejecutar
 * un comando lo corre en el sandbox real, le devuelve el resultado, y repite
 * hasta que el modelo responda sin tag <execute_command> o se agoten los
 * intentos. Emite eventos por WebSocket en cada paso.
 */
export async function runAgenticTask({
  userId,
  sessionId,
  task,
  model = 'zoco-max',
  gatewayUrl,
  gatewayApiKey,
  emit = () => {},
}) {
  if (!sessionId) throw new Error('sessionId es obligatorio (aislamiento por sesion).');
  if (!gatewayApiKey) throw new Error('Falta gatewayApiKey.');

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT_EXECUTE },
    { role: 'user', content: task },
  ];

  emit(sessionId, { type: 'terminal_status', stage: 'spawning_sandbox' });

  let container;
  try {
    container = await getOrCreateSandbox(sessionId);
  } catch (err) {
    emit(sessionId, { type: 'terminal_status', stage: 'sandbox_error', error: err.message });
    return { success: false, error: `No se pudo crear el sandbox: ${err.message}` };
  }

  emit(sessionId, { type: 'terminal_status', stage: 'sandbox_ready' });

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    emit(sessionId, { type: 'terminal_status', stage: 'querying_model', iteration });

    let raw;
    try {
      raw = await askModelViaGateway({ gatewayUrl, gatewayApiKey, model, messages });
    } catch (err) {
      emit(sessionId, { type: 'terminal_status', stage: 'model_error', error: err.message });
      return { success: false, error: `Fallo al consultar el modelo: ${err.message}` };
    }

    const command = extractExecuteCommand(raw);

    if (!command) {
      // Respuesta final: sin tag de ejecucion, tarea terminada.
      const finalText = stripExecuteTag(raw);
      emit(sessionId, { type: 'terminal_status', stage: 'task_complete' });
      resetIdleTimer(sessionId); // mantenemos el sandbox vivo por si hay turnos siguientes
      return { success: true, output: finalText, iterations: iteration };
    }

    emit(sessionId, { type: 'terminal_log', chunk: `$ ${command}\n` });
    emit(sessionId, { type: 'terminal_status', stage: 'executing_command', iteration });

    let result;
    try {
      result = await runWithTimeout(
        execInSandbox(container, command),
        COMMAND_TIMEOUT_MS,
        () => destroySandbox(sessionId) // si se cuelga, matamos el sandbox entero
      );
    } catch (err) {
      result = { success: false, stdout: '', stderr: `Timeout o fallo de ejecucion: ${err.message}` };
    }

    const outputChunk = (result.stdout || '') + (result.stderr ? `\n[stderr]\n${result.stderr}` : '');
    emit(sessionId, { type: 'terminal_log', chunk: outputChunk || '(sin salida)' });
    emit(sessionId, {
      type: 'terminal_status',
      stage: result.success ? 'command_success' : 'command_failed',
      iteration,
    });

    messages.push({ role: 'assistant', content: raw });
    messages.push({
      role: 'user',
      content:
        `[RESULTADO DE TERMINAL REAL] exit_code=${result.exitCode ?? 'desconocido'}\n` +
        `stdout:\n${result.stdout || '(vacio)'}\n` +
        `stderr:\n${result.stderr || '(vacio)'}`,
    });
  }

  emit(sessionId, { type: 'terminal_status', stage: 'max_iterations_reached' });
  return { success: false, error: `Limite de ${MAX_ITERATIONS} iteraciones alcanzado sin respuesta final.` };
}

export async function shutdownAllSandboxes() {
  const ids = [...activeSessions.keys()];
  await Promise.allSettled(ids.map((id) => destroySandbox(id)));
}

process.on('SIGTERM', shutdownAllSandboxes);
process.on('SIGINT', shutdownAllSandboxes);

// =============================================================================
// ─── PARTE 2: puente de plantillas + agentes deterministas + rutas admin ───
// (Esto es lo que faltaba y server.js sigue importando/usando)
// =============================================================================

function safeParseJSON(text, fallback = {}) {
  try { return JSON.parse(text || '{}'); } catch { return fallback; }
}

function getUserCredential(db, userId, name) {
  const row = db.prepare(
    "SELECT data FROM resources WHERE user_id = ? AND type IN ('credencial','habilidad') AND name = ?"
  ).get(userId, name);
  if (!row) return null;
  try { return JSON.parse(row.data || '{}').valor || null; } catch { return null; }
}

// ─── Plantillas maestras por defecto ────────────────────────────────────────
// Placeholders con la sintaxis {{variable}}. Editables en caliente desde
// /admin/bridge/templates sin necesidad de tocar código ni redeploy — estos
// valores solo se usan como fallback si la plantilla no existe aún en la BD.
const DEFAULT_MASTER_TEMPLATES = {
  tpl_frontend_master: `Eres el Agente de Interfaz (Frontend) de Zoco IA. Implementas componentes de
frontend en {{framework}} con {{styling}}, priorizando accesibilidad, código
limpio y componentes reutilizables. Sigues las convenciones del proyecto
existente en vez de imponer las tuyas. Cuando generes código, entrégalo
completo y funcional, nunca fragmentos a medias.`,
  tpl_database_master: `Eres el Agente de Base de Datos de Zoco IA. Diseñas esquemas para
{{motor}}, escribes migraciones seguras (nunca destructivas sin
confirmación explícita), consultas eficientes con índices apropiados, y
explicas el razonamiento detrás de cada decisión de modelado de datos.`,
};

// ─── ensureBridgeTables ─────────────────────────────────────────────────────
// Crea (si no existen) las tablas propias del puente: plantillas maestras
// y el log de imports As-Is desde Marisai. Idempotente — segura de llamar
// en cada arranque o en cada request a las rutas admin.
export function ensureBridgeTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_templates (
      template_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      default_vars TEXT DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bridge_imports_log (
      id TEXT PRIMARY KEY,
      agente_id TEXT NOT NULL,
      admin_user_id TEXT NOT NULL,
      source TEXT DEFAULT 'marisai',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ─── resolveTemplatePrompt ───────────────────────────────────────────────────
// Usado por server.js cuando agenteData.tipo === 'generic_prompted': resuelve
// el prompt final sustituyendo {{variable}} por overrideVars (o los valores
// por defecto guardados junto a la plantilla). Si la plantilla no existe ni
// en BD ni en los defaults hardcodeados, degrada a un prompt genérico en vez
// de lanzar una excepción (para no tumbar el chat por un templateId mal escrito).
export function resolveTemplatePrompt({ db, templateId, overrideVars }) {
  ensureBridgeTables(db);
  const row = db.prepare('SELECT * FROM prompt_templates WHERE template_id = ?').get(templateId);
  const baseTemplate = row ? row.prompt_text : (DEFAULT_MASTER_TEMPLATES[templateId] || null);

  if (!baseTemplate) {
    return `Eres un agente de Zoco IA (la plantilla "${templateId}" no está configurada todavía). Ayuda de forma útil y precisa.`;
  }

  const vars = { ...(row ? safeParseJSON(row.default_vars) : {}), ...(overrideVars || {}) };
  return baseTemplate.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  );
}

// ─── Ejecutores deterministas (sin LLM) ─────────────────────────────────────

async function runVercelDevOpsExecutor(db, userId, userText) {
  const token = getUserCredential(db, userId, 'VERCEL_TOKEN') || process.env.VERCEL_TOKEN;
  if (!token) {
    return 'El Agente DevOps necesita una credencial "VERCEL_TOKEN" configurada en el Almacén de credenciales para poder consultar/gestionar despliegues en Vercel. Añádela desde el panel y vuelve a intentarlo.';
  }
  try {
    const resp = await fetch('https://api.vercel.com/v6/deployments?limit=5', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return `Vercel respondió con un error (${resp.status}): ${err.error?.message || 'sin detalles'}.`;
    }
    const data = await resp.json();
    const deployments = data.deployments || [];
    if (deployments.length === 0) return 'No se encontraron despliegues recientes en la cuenta de Vercel conectada.';
    const resumen = deployments
      .map(d => `• ${d.name} — estado: ${d.state || d.readyState} — ${new Date(d.created).toLocaleString('es-ES')}`)
      .join('\n');
    return `Últimos despliegues en Vercel:\n${resumen}`;
  } catch (err) {
    return `No se pudo contactar con la API de Vercel: ${err.message}`;
  }
}

function runStaticCodeAnalysisExecutor(userText) {
  const problemas = [];
  if (/console\.log\(/.test(userText)) problemas.push('Se detectaron llamadas a console.log — revisa si deben quitarse antes de producción.');
  if (/\bTODO\b|\bFIXME\b/.test(userText)) problemas.push('Hay marcadores TODO/FIXME pendientes en el código.');
  if (/\bvar\s+/.test(userText)) problemas.push('Uso de "var" — se recomienda "const"/"let" en código moderno.');
  if (/catch\s*\(\s*\)\s*{\s*}/.test(userText)) problemas.push('Hay bloques catch vacíos que silencian errores sin registrarlos.');
  if (/await\s+[^;]+;(?![^{]*catch)/.test(userText) && !/try\s*{/.test(userText)) {
    problemas.push('Hay `await` sin un bloque try/catch visible alrededor — posible error no controlado.');
  }
  if (problemas.length === 0) {
    return 'Análisis estático básico: no se detectaron patrones problemáticos comunes en el fragmento proporcionado.';
  }
  return `Análisis estático — hallazgos:\n${problemas.map(p => `• ${p}`).join('\n')}`;
}

async function runSandboxRepairExecutor({ userId, agenteId, userText }) {
  const gatewayUrl = process.env.GATEWAY_URL;
  const gatewayApiKey = process.env.GATEWAY_API_KEY;
  if (!gatewayUrl || !gatewayApiKey) {
    return 'El Agente de Reparación necesita GATEWAY_URL y GATEWAY_API_KEY configurados en el servidor para poder ejecutar comandos reales en el sandbox. Configúralos y vuelve a intentarlo.';
  }
  try {
    const result = await runAgenticTask({
      userId,
      sessionId: `repair-${agenteId}-${userId}`,
      task: userText,
      model: 'zoco-max',
      gatewayUrl,
      gatewayApiKey,
    });
    if (!result.success) return `La reparación automática no pudo completarse: ${result.error}`;
    return result.output || 'Reparación completada sin salida de texto adicional.';
  } catch (err) {
    return `Error ejecutando la reparación en el sandbox: ${err.message}`;
  }
}

// ─── runDeterministicAgent ───────────────────────────────────────────────────
// Usado por server.js cuando agenteData.tipo === 'deterministic'. Empaqueta
// la respuesta en el mismo formato { choices, usage, model } que devuelve
// processChatCompletion() para una llamada normal a un LLM, para que el
// resto del flujo (memoria, facturación, /v1/messages, etc.) no note la
// diferencia.
export async function runDeterministicAgent({ db, uuidv4, userId, agente, agenteData, userMessage }) {
  const executorType = agenteData.executorType;
  const userText = userMessage?.content ? String(userMessage.content) : '';

  let responseText;
  switch (executorType) {
    case 'vercel_api':
      responseText = await runVercelDevOpsExecutor(db, userId, userText);
      break;
    case 'static_code_analysis':
      responseText = runStaticCodeAnalysisExecutor(userText);
      break;
    case 'sandbox_repair':
      responseText = await runSandboxRepairExecutor({ userId, agenteId: agente.id, userText });
      break;
    default:
      responseText = `El agente "${agente.name}" está marcado como determinista pero no tiene un executorType reconocido ("${executorType}"). Contacta con soporte.`;
  }

  return {
    choices: [{
      message: { role: 'assistant', content: responseText },
      finish_reason: 'stop',
    }],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
    },
    model: `determinista:${executorType || 'desconocido'}`,
  };
}

// ─── registerBridgeAdminRoutes ───────────────────────────────────────────────
// Rutas admin del puente con Marisai, todas bajo /admin/bridge/* + la ruta
// de import As-Is bajo /admin/agentes/:id/import-marisai. Reutilizan
// authMiddleware + requireAdmin ya existentes en server.js.
export function registerBridgeAdminRoutes({ app, db, authMiddleware, requireAdmin, uuidv4 }) {
  ensureBridgeTables(db);

  // Listar plantillas maestras configuradas
  app.get('/admin/bridge/templates', authMiddleware, requireAdmin, (req, res) => {
    const rows = db.prepare('SELECT * FROM prompt_templates ORDER BY updated_at DESC').all();
    res.json(rows.map(r => ({
      templateId: r.template_id,
      name: r.name,
      promptText: r.prompt_text,
      defaultVars: safeParseJSON(r.default_vars),
      updatedAt: r.updated_at,
    })));
  });

  // Crear o actualizar una plantilla maestra (tpl_frontend_master, tpl_database_master, o una nueva)
  app.put('/admin/bridge/templates/:templateId', authMiddleware, requireAdmin, (req, res) => {
    const { name, promptText, defaultVars } = req.body || {};
    if (!name || !promptText) return res.status(400).json({ error: 'name y promptText son obligatorios' });
    const templateId = req.params.templateId;

    const existing = db.prepare('SELECT template_id FROM prompt_templates WHERE template_id = ?').get(templateId);
    if (existing) {
      db.prepare('UPDATE prompt_templates SET name = ?, prompt_text = ?, default_vars = ?, updated_at = CURRENT_TIMESTAMP WHERE template_id = ?')
        .run(name, promptText, JSON.stringify(defaultVars || {}), templateId);
    } else {
      db.prepare('INSERT INTO prompt_templates (template_id, name, prompt_text, default_vars) VALUES (?, ?, ?, ?)')
        .run(templateId, name, promptText, JSON.stringify(defaultVars || {}));
    }
    res.json({ ok: true, templateId });
  });

  app.delete('/admin/bridge/templates/:templateId', authMiddleware, requireAdmin, (req, res) => {
    db.prepare('DELETE FROM prompt_templates WHERE template_id = ?').run(req.params.templateId);
    res.json({ ok: true });
  });

  // Import As-Is de un prompt migrado de Marisai: sobrescribe directamente
  // el systemPrompt del agente indicado (agentes tipo 'prompted'), sin pasar
  // por ninguna plantilla — para los 6 agentes con prompt dedicado.
  app.post('/admin/agentes/:id/import-marisai', authMiddleware, requireAdmin, (req, res) => {
    const { systemPrompt } = req.body || {};
    if (!systemPrompt || !String(systemPrompt).trim()) {
      return res.status(400).json({ error: 'systemPrompt es obligatorio' });
    }
    const row = db.prepare("SELECT * FROM resources WHERE id = ? AND type = 'agente'").get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Agente no encontrado' });

    const data = row.data ? JSON.parse(row.data) : {};
    data.systemPrompt = String(systemPrompt);
    db.prepare('UPDATE resources SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(data), row.id);

    db.prepare('INSERT INTO bridge_imports_log (id, agente_id, admin_user_id, source) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), row.id, req.auth.sub, 'marisai');

    res.json({ ok: true });
  });

  app.get('/admin/bridge/imports-log', authMiddleware, requireAdmin, (req, res) => {
    const rows = db.prepare('SELECT * FROM bridge_imports_log ORDER BY created_at DESC LIMIT 100').all();
    res.json(rows);
  });
}
