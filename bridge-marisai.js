// bridge-marisai.js
// -----------------------------------------------------------------------------
// Puente entre el gateway de chat (server.js) y un sandbox Docker REAL,
// usando Dockerode. Sustituye la version "CLI-only" de agent.js por un
// bucle agentico que se puede invocar desde una peticion HTTP/WS normal.
//
// Diseño:
//  - Un contenedor Docker POR SESION DE USUARIO (no por comando), para que
//    los comandos compartan estado (ficheros, paquetes instalados) durante
//    la tarea, igual que Manus/Claude Code.
//  - El contenedor se destruye al terminar la tarea o al expirar un TTL de
//    inactividad (evita contenedores zombie acumulandose en el host).
//  - Limites duros de memoria/CPU/pids, usuario no root, filesystem con
//    tamano limitado (tmpfs), y timeout por comando.
//  - Red: OFF por defecto. Si una tarea necesita instalar paquetes, se activa
//    una red dedicada con egress restringido (ver SANDBOX_NETWORK abajo) en
//    lugar de dar acceso abierto a internet. Esto es lo mas importante que
//    NO debes saltarte: bash arbitrario + red abierta == tu servidor puede
//    acabar siendo usado como proxy de salida por cualquier cosa que el
//    modelo (o un usuario malicioso via prompt injection) le pida ejecutar.
//
// Uso esperado desde server.js / zoco-sessions.js:
//
//   import { runAgenticTask } from './bridge-marisai.js';
//   await runAgenticTask({
//     userId, sessionId, task: userMessage,
//     model: 'zoco-max',
//     gatewayUrl: 'http://localhost:4000/v1',
//     gatewayApiKey: process.env.GATEWAY_API_KEY,
//     emit: (sessionId, payload) => wsHub.broadcast(sessionId, payload),
//   });
// -----------------------------------------------------------------------------

import Docker from 'dockerode';
import fetch from 'node-fetch';
import { randomUUID } from 'crypto';

const docker = new Docker(); // usa /var/run/docker.sock por defecto

// ─── Configuracion ───────────────────────────────────────────────────────────

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

// ─── Bucle agentico principal ───────────────────────────────────────────────

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

// ─── Limpieza al cerrar el proceso ──────────────────────────────────────────

export async function shutdownAllSandboxes() {
  const ids = [...activeSessions.keys()];
  await Promise.allSettled(ids.map((id) => destroySandbox(id)));
}

process.on('SIGTERM', shutdownAllSandboxes);
process.on('SIGINT', shutdownAllSandboxes);
