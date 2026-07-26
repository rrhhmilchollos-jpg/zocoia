/**
 * manus-agent/routes.ts
 *
 * Expone el agente como endpoints Express, listos para montar en tu
 * server.js existente (ver README_INTEGRACION.md).
 *
 *   POST /api/agent/run        -> ejecuta la tarea y devuelve el JSON final
 *   POST /api/agent/run/stream -> igual, pero transmite cada paso por SSE
 *                                  para que el panel lo pinte en vivo
 *
 * IMPORTANTE: monta este router detrás de tu middleware de autenticación
 * (el JWT que ya usa el proyecto en server.js) para que no cualquiera
 * pueda ejecutar el agente contra tus repos.
 */

import { Router, Request, Response } from "express";
import { runManusAgent } from "./manusAgent";
import { AgentRunRequest } from "./types";

export const agentRouter = Router();

function validateRequest(body: unknown): { ok: true; data: AgentRunRequest } | { ok: false; error: string } {
  const b = body as Partial<AgentRunRequest> | null;
  if (!b || typeof b !== "object") return { ok: false, error: "Body vacío o inválido." };
  if (!b.instructions || typeof b.instructions !== "string") {
    return { ok: false, error: "Falta 'instructions' (string)." };
  }
  if (!b.repo_url || typeof b.repo_url !== "string") {
    return { ok: false, error: "Falta 'repo_url' (string, URL de GitHub)." };
  }
  return {
    ok: true,
    data: {
      instructions: b.instructions,
      repo_url: b.repo_url,
      base_branch: b.base_branch,
      target_files: b.target_files,
      auto_deploy: Boolean(b.auto_deploy),
      create_pull_request: b.create_pull_request ?? true, // por defecto, PR en vez de push directo
      github_token: b.github_token, // opcional: si no viene, se usa el del servidor
      max_steps: b.max_steps,
    },
  };
}

/** Ejecución normal: espera a que termine todo y devuelve el JSON completo. */
agentRouter.post("/api/agent/run", async (req: Request, res: Response) => {
  const validation = validateRequest(req.body);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const result = await runManusAgent(validation.data);
    return res.status(result.status === "completed" ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Error desconocido en el agente.",
    });
  }
});

/** Ejecución en streaming: cada paso se manda como evento SSE al panel. */
agentRouter.post("/api/agent/run/stream", async (req: Request, res: Response) => {
  const validation = validateRequest(req.body);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await runManusAgent(validation.data, (stepEvent) => {
      send("step", stepEvent);
    });
    send("result", result);
  } catch (err) {
    send("error", { error: err instanceof Error ? err.message : "Error desconocido." });
  } finally {
    res.end();
  }
});
