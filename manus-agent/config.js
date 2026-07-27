/**
 * manus-agent/config.js
 *
 * Configuración del agente. El modelo se resuelve internamente con
 * processChatCompletion() (mismo motor Ollama que ya usa toda la app:
 * ver server.js), así que aquí NO hace falta ninguna API key ni URL de
 * gateway externo — el agente vive dentro del mismo proceso Node.
 *
 * Variables de entorno relevantes:
 *
 *   GITHUB_TOKEN=ghp_...                 # fallback si la request no trae uno
 *   COOLIFY_API_URL=https://coolify.tu-dominio.com/api/v1
 *   COOLIFY_API_TOKEN=...
 *   COOLIFY_SERVER_UUID=...
 *   COOLIFY_PROJECT_UUID=...
 *   AGENT_WORKSPACE_DIR=/tmp/manus-agent-workspaces
 *   AGENT_MAX_STEPS=25
 *   AGENT_DEFAULT_MODEL=zoco-max         # una de las claves de OLLAMA_MODEL_MAP en server.js
 */

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[manus-agent] Falta la variable de entorno obligatoria: ${name}`);
  }
  return value;
}

export const config = {
  github: {
    get defaultToken() {
      return requireEnv('GITHUB_TOKEN');
    },
  },
  coolify: {
    get apiUrl() {
      return requireEnv('COOLIFY_API_URL').replace(/\/+$/, '');
    },
    get apiToken() {
      return requireEnv('COOLIFY_API_TOKEN');
    },
    serverUuid: process.env.COOLIFY_SERVER_UUID || '',
    projectUuid: process.env.COOLIFY_PROJECT_UUID || '',
  },
  agent: {
    workspaceDir: process.env.AGENT_WORKSPACE_DIR || '/tmp/manus-agent-workspaces',
    maxSteps: Number(process.env.AGENT_MAX_STEPS || 25),
    defaultModel: process.env.AGENT_DEFAULT_MODEL || 'zoco-max',
  },
};
