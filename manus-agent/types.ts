/**
 * manus-agent/types.ts
 *
 * Contratos de datos compartidos entre el orquestador, las herramientas
 * y el panel visual del frontend de Zoco (el "Editor" que se ve en la
 * captura de Manus, con pestañas Diferencia / Original / Modificado).
 */

/** Estado de una tarea del agente. */
export type AgentTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** Tipo de evento emitido paso a paso (se envían por SSE al panel). */
export type AgentEventType =
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "message"
  | "file_diff"
  | "error"
  | "done";

/** Un evento individual del bucle del agente, lista para pintar en el panel. */
export interface AgentStepEvent {
  task_id: string;
  step: number;
  type: AgentEventType;
  tool?: string;
  title: string;
  detail?: string;
  status: "running" | "success" | "error";
  timestamp: string;
  data?: Record<string, unknown>;
}

/** Un archivo modificado por el agente, con su contenido antes/después. */
export interface FileChange {
  path: string;
  action: "created" | "modified" | "deleted";
  original_content?: string;
  new_content?: string;
  language?: string;
}

/** Info del repositorio de GitHub sobre el que se trabajó. */
export interface RepoInfo {
  owner: string;
  name: string;
  base_branch: string;
  work_branch: string;
  commit_sha?: string;
  pull_request_url?: string;
}

/** Info del despliegue disparado en Coolify (si el agente lo hizo). */
export interface DeploymentInfo {
  triggered: boolean;
  application_uuid?: string;
  deployment_uuid?: string;
  deployment_url?: string;
  public_url?: string;
}

/** Resultado final de una ejecución completa del agente. JSON limpio para el panel. */
export interface AgentRunResult {
  task_id: string;
  status: AgentTaskStatus;
  summary: string;
  instructions: string;
  repo?: RepoInfo;
  files_changed: FileChange[];
  deployment?: DeploymentInfo;
  steps: AgentStepEvent[];
  started_at: string;
  finished_at?: string;
  error?: string;
}

/** Parámetros de entrada para lanzar una tarea del agente. */
export interface AgentRunRequest {
  instructions: string;
  repo_url: string;
  base_branch?: string;
  target_files?: string[];
  auto_deploy?: boolean;
  create_pull_request?: boolean;
  github_token?: string;
  max_steps?: number;
}

/**
 * Definición de una herramienta en formato "function calling" estilo
 * OpenAI/litellm (el que habla tu gateway de zocoia.es con los modelos
 * de Ollama). Se envuelve en { type: "function", function: ... } al
 * construir la llamada real (ver manusAgent.ts).
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema de los argumentos
}
