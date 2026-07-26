/**
 * manus-agent/config.ts
 *
 * Toda la configuración sensible vive SOLO en variables de entorno del
 * servidor. Nunca se exponen al frontend ni se devuelven en las respuestas
 * JSON del agente. Añade estas claves a tu .env / panel de Coolify:
 *
 *   ZOCOIA_API_URL=https://zocoia.es/v1        # tu gateway (clon de Claude Console / litellm)
 *   ZOCOIA_API_KEY=sk-zoco-...                  # API key generada en tu propio panel
 *   ZOCOIA_MODEL=ollama/llama3.1:70b            # o el modelo que tengas montado en Ollama
 *   GITHUB_TOKEN=ghp_...                        # fallback si la request no trae uno
 *   COOLIFY_API_URL=https://coolify.tu-dominio.com/api/v1
 *   COOLIFY_API_TOKEN=...
 *   COOLIFY_SERVER_UUID=...
 *   COOLIFY_PROJECT_UUID=...
 *   AGENT_WORKSPACE_DIR=/tmp/manus-agent-workspaces
 *   AGENT_MAX_STEPS=25
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[manus-agent] Falta la variable de entorno obligatoria: ${name}`
    );
  }
  return value;
}

export const config = {
  // Cliente LLM: apunta a TU gateway (zocoia.es), no a Anthropic directamente.
  // Al ser un clon de Claude Console con soporte Ollama, se asume compatible
  // con el formato de "chat completions" estilo OpenAI (el que usa litellm
  // por defecto para servir modelos de Ollama). Si tu gateway expone en su
  // lugar el formato /v1/messages de Anthropic, cambia manusAgent.ts para
  // usar @anthropic-ai/sdk con `baseURL: config.llm.baseUrl` en su lugar.
  llm: {
    get apiKey(): string {
      return requireEnv("ZOCOIA_API_KEY");
    },
    get baseUrl(): string {
      return requireEnv("ZOCOIA_API_URL").replace(/\/+$/, "");
    },
    model: process.env.ZOCOIA_MODEL || "ollama/llama3.1:70b",
    maxTokens: Number(process.env.LLM_MAX_TOKENS || 8192),
  },
  github: {
    get defaultToken(): string {
      return requireEnv("GITHUB_TOKEN");
    },
  },
  coolify: {
    get apiUrl(): string {
      return requireEnv("COOLIFY_API_URL").replace(/\/+$/, "");
    },
    get apiToken(): string {
      return requireEnv("COOLIFY_API_TOKEN");
    },
    serverUuid: process.env.COOLIFY_SERVER_UUID || "",
    projectUuid: process.env.COOLIFY_PROJECT_UUID || "",
  },
  agent: {
    workspaceDir: process.env.AGENT_WORKSPACE_DIR || "/tmp/manus-agent-workspaces",
    maxSteps: Number(process.env.AGENT_MAX_STEPS || 25),
  },
};
