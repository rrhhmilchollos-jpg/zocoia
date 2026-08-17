// -----------------------------------------------------------------------------
// zoco-sandbox-client.js — Cliente privado del runner efímero de Zoco.
//
// El proceso del agente nunca monta ni consulta /var/run/docker.sock. Solo habla
// con el runner en la red interna zocoia_control usando un token de servicio.
// -----------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 20_000;

function config() {
  const baseUrl = String(process.env.SANDBOX_RUNNER_URL || '').replace(/\/$/, '');
  const token = String(process.env.SANDBOX_RUNNER_TOKEN || '');
  if (!baseUrl || !token) {
    throw new Error('El runner de sandbox no está configurado para esta tarea.');
  }
  return { baseUrl, token };
}

async function request(method, route, body = undefined, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { baseUrl, token } = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Sandbox-Runner-Token': token,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || `Runner respondió HTTP ${response.status}`);
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('El runner de sandbox no respondió a tiempo.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function createSandboxSession(taskId) {
  return request('POST', '/v1/sessions', { task_id: taskId });
}

export async function executeInSandbox(sessionId, command, timeoutMs) {
  return request('POST', `/v1/sessions/${encodeURIComponent(sessionId)}/exec`, {
    command,
    timeout_seconds: Math.max(1, Math.min(600, Math.ceil((timeoutMs || 180000) / 1000))),
  }, Math.max(DEFAULT_TIMEOUT_MS, (timeoutMs || 180000) + 10_000));
}

export async function closeSandboxSession(sessionId) {
  if (!sessionId) return;
  try {
    await request('DELETE', `/v1/sessions/${encodeURIComponent(sessionId)}`);
  } catch (error) {
    // No se bloquea la finalización de la tarea: el TTL del runner limpiará la
    // sandbox que sobreviva a un reinicio o microcorte del control interno.
    console.warn('[ZocoSandbox] no se pudo cerrar la sesión:', error.message);
  }
}
