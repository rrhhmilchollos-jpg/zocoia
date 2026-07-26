/**
 * manus-agent/tools/coolify.ts
 *
 * Integración con la API v4 de Coolify. Endpoints reales usados:
 *   GET  /api/v1/applications/{uuid}            -> estado de la app
 *   POST /api/v1/deploy?uuid={uuid}             -> dispara un nuevo deploy
 *   GET  /api/v1/deployments/{deployment_uuid}  -> estado de un deploy en curso
 *
 * Referencia: https://coolify.io/docs/api-reference
 *
 * El token, la URL base y los UUIDs de servidor/proyecto NUNCA viajan al
 * frontend: se leen siempre de config.ts (variables de entorno).
 */

import { config } from "../config";

export class CoolifyToolError extends Error {}

async function coolifyFetch<T>(
  endpoint: string,
  init: RequestInit = {}
): Promise<T> {
  const url = `${config.coolify.apiUrl}${endpoint}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.coolify.apiToken}`,
      ...(init.headers || {}),
    },
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  if (!res.ok) {
    const message =
      (json as { message?: string })?.message || `Coolify API error: ${res.statusText}`;
    throw new CoolifyToolError(`${message} (HTTP ${res.status}) en ${endpoint}`);
  }

  return json as T;
}

export interface CoolifyApplication {
  uuid: string;
  name: string;
  fqdn?: string;
  git_repository?: string;
  git_branch?: string;
  status?: string;
}

/** Obtiene el detalle de una aplicación por UUID. */
export async function getApplication(
  applicationUuid: string
): Promise<CoolifyApplication> {
  return coolifyFetch<CoolifyApplication>(`/applications/${applicationUuid}`);
}

/** Busca la aplicación en Coolify cuyo repo de GitHub coincide con el que trabajó el agente. */
export async function findApplicationByRepo(
  owner: string,
  repoName: string
): Promise<CoolifyApplication | null> {
  const apps = await coolifyFetch<CoolifyApplication[]>(`/applications`);
  const needle = `${owner}/${repoName}`.toLowerCase();
  return (
    apps.find((app) =>
      (app.git_repository || "").toLowerCase().includes(needle)
    ) || null
  );
}

export interface TriggerDeployResult {
  deployment_uuid: string;
  message: string;
}

/** Dispara un redespliegue de la aplicación indicada. */
export async function triggerDeploy(
  applicationUuid: string
): Promise<TriggerDeployResult> {
  if (!applicationUuid) {
    throw new CoolifyToolError(
      "COOLIFY_SERVER_UUID / applicationUuid no configurado: no se puede desplegar."
    );
  }
  const result = await coolifyFetch<{
    deployments: { deployment_uuid: string; message?: string }[];
  }>(`/deploy?uuid=${encodeURIComponent(applicationUuid)}`, {
    method: "GET",
  });

  const first = result.deployments?.[0];
  if (!first) {
    throw new CoolifyToolError("Coolify no devolvió información del despliegue disparado.");
  }
  return {
    deployment_uuid: first.deployment_uuid,
    message: first.message || "Despliegue encolado correctamente.",
  };
}

export interface DeploymentStatus {
  uuid: string;
  status: "queued" | "in_progress" | "finished" | "failed" | string;
  finished_at?: string;
}

export async function getDeploymentStatus(
  deploymentUuid: string
): Promise<DeploymentStatus> {
  return coolifyFetch<DeploymentStatus>(`/deployments/${deploymentUuid}`);
}

/** Espera (con polling) a que un despliegue termine, con timeout de seguridad. */
export async function waitForDeployment(
  deploymentUuid: string,
  { timeoutMs = 5 * 60_000, intervalMs = 5_000 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<DeploymentStatus> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await getDeploymentStatus(deploymentUuid);
    if (status.status === "finished" || status.status === "failed") {
      return status;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new CoolifyToolError(
    `Timeout esperando el despliegue ${deploymentUuid} (más de ${timeoutMs}ms).`
  );
}
