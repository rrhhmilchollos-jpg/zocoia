/**
 * manus-agent/manusAgent.ts
 *
 * El orquestador. Implementa el bucle "estilo Manus" hablando con TU
 * gateway (zocoia.es) en vez de con Anthropic directamente. zocoia.es
 * es un clon de Claude Console con soporte Ollama vía litellm, así que
 * usamos el SDK de `openai` apuntando a config.llm.baseUrl: litellm
 * expone un endpoint /chat/completions compatible con OpenAI (incluido
 * function calling) para cualquier modelo que tengas montado en Ollama.
 *
 *   1. Clona el repo de GitHub en un workspace aislado.
 *   2. Entra en un bucle de function-calling con tu gateway: el modelo
 *      pide leer/listar/escribir archivos -> ejecutamos la tool real ->
 *      le devolvemos el resultado -> repite hasta que llama a
 *      `finish_task` o se acaba el nº máximo de pasos.
 *   3. Hace commit + push (y PR si se pidió) de los cambios.
 *   4. Si auto_deploy=true, dispara el redespliegue en Coolify.
 *   5. Devuelve un AgentRunResult (JSON limpio) y, si se le pasa un
 *      emisor, transmite cada paso en vivo (para el panel visual).
 *
 * Requiere:  npm install openai simple-git @octokit/rest
 *
 * Si en vez de un endpoint estilo OpenAI, tu panel de zocoia.es expone
 * el formato /v1/messages de Anthropic (algunos clones de Claude Console
 * lo hacen para ser "drop-in" con el SDK de Claude), cambia el bloque
 * marcado más abajo por @anthropic-ai/sdk con `baseURL: config.llm.baseUrl`.
 */

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { randomUUID } from "crypto";
import path from "path";

import { config } from "./config";
import {
  AgentRunRequest,
  AgentRunResult,
  AgentStepEvent,
  FileChange,
} from "./types";
import { TOOL_DEFINITIONS, executeTool, ToolContext } from "./tools";
import * as github from "./tools/github";
import * as coolify from "./tools/coolify";

const SYSTEM_PROMPT = `Eres un ingeniero de software autónomo que trabaja dentro de un repositorio
de código ya clonado en disco. Tu objetivo es cumplir la instrucción del
usuario haciendo los cambios de código necesarios, usando SOLO las
herramientas disponibles (list_files, read_file, write_file, delete_file).

Reglas:
- Antes de escribir un archivo nuevo, explora la estructura del repo con
  list_files y lee los archivos relevantes con read_file para entender
  las convenciones existentes (estilo, imports, frameworks usados).
- Haz cambios mínimos y quirúrgicos: no reescribas archivos enteros si
  solo hace falta cambiar una función.
- Cuando termines TODOS los cambios necesarios, llama a la herramienta
  finish_task con un resumen claro en español.
- Si algo no es posible o falta información, explica por qué en tu
  respuesta de texto y llama a finish_task igualmente con el resumen de
  lo que sí se pudo hacer.
- No inventes rutas de archivo: verifícalas primero con list_files.
- Responde y razona siempre en español.`;

export type StepEmitter = (event: AgentStepEvent) => void;

function emit(
  log: AgentStepEvent[],
  emitter: StepEmitter | undefined,
  event: AgentStepEvent
) {
  log.push(event);
  emitter?.(event);
}

/** Convierte TOOL_DEFINITIONS (formato interno) al tipo exacto que exige el SDK de OpenAI. */
function buildOpenAITools(): ChatCompletionTool[] {
  return TOOL_DEFINITIONS.map((def) => ({
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  }));
}

export async function runManusAgent(
  request: AgentRunRequest,
  emitter?: StepEmitter
): Promise<AgentRunResult> {
  const taskId = randomUUID();
  const startedAt = new Date().toISOString();
  const steps: AgentStepEvent[] = [];
  let stepCounter = 0;

  const nextStep = (partial: Omit<AgentStepEvent, "task_id" | "step" | "timestamp">) => {
    stepCounter += 1;
    emit(steps, emitter, {
      task_id: taskId,
      step: stepCounter,
      timestamp: new Date().toISOString(),
      ...partial,
    });
  };

  const workspaceDir = path.join(config.agent.workspaceDir, taskId);
  const githubToken = request.github_token || config.github.defaultToken;
  const maxSteps = request.max_steps || config.agent.maxSteps;

  let repoInfo: { owner: string; name: string; baseBranch: string; workBranch: string } | null =
    null;

  try {
    // ---------- 1. Clonar el repo ----------
    nextStep({
      type: "tool_call",
      tool: "github_clone",
      title: `Clonando ${request.repo_url}`,
      status: "running",
    });

    const parsed = github.parseRepoUrl(request.repo_url);
    const clone = await github.cloneRepo({
      repoUrl: request.repo_url,
      workspaceDir,
      token: githubToken,
      baseBranch: request.base_branch,
    });
    repoInfo = {
      owner: parsed.owner,
      name: parsed.name,
      baseBranch: clone.baseBranch,
      workBranch: clone.workBranch,
    };

    nextStep({
      type: "tool_result",
      tool: "github_clone",
      title: `Repo clonado en rama de trabajo ${clone.workBranch}`,
      status: "success",
      data: { baseBranch: clone.baseBranch, workBranch: clone.workBranch },
    });

    // ---------- 2. Bucle agéntico contra tu gateway (zocoia.es) ----------
    const llm = new OpenAI({
      apiKey: config.llm.apiKey,
      baseURL: config.llm.baseUrl, // ej: https://zocoia.es/v1
    });

    const toolCtx: ToolContext = {
      workspaceDir,
      repoUrl: request.repo_url,
      githubToken,
      baseBranch: clone.baseBranch,
      workBranch: clone.workBranch,
      filesTouched: new Map(),
    };

    const userPrompt = [
      `Instrucción: ${request.instructions}`,
      request.target_files?.length
        ? `Pistas de archivos relevantes: ${request.target_files.join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];

    const tools = buildOpenAITools();
    let finished = false;
    let finalSummary = "";

    for (let i = 0; i < maxSteps && !finished; i++) {
      const response = await llm.chat.completions.create({
        model: config.llm.model,
        max_tokens: config.llm.maxTokens,
        messages,
        tools,
        tool_choice: "auto",
      });

      const choice = response.choices[0];
      const message = choice.message;
      messages.push(message);

      if (message.content && message.content.trim()) {
        nextStep({
          type: "thinking",
          title: "Analizando el siguiente paso",
          detail: message.content.trim(),
          status: "success",
        });
      }

      const toolCalls = message.tool_calls || [];

      if (toolCalls.length === 0) {
        if (choice.finish_reason === "stop") {
          messages.push({
            role: "user",
            content:
              "Continúa. Si ya terminaste todos los cambios, llama a finish_task con el resumen.",
          });
          continue;
        }
        break;
      }

      for (const call of toolCalls) {
        const toolName = call.function.name;
        let toolInput: Record<string, unknown> = {};
        try {
          toolInput = JSON.parse(call.function.arguments || "{}");
        } catch {
          toolInput = {};
        }

        nextStep({
          type: "tool_call",
          tool: toolName,
          title: describeToolCall(toolName, toolInput),
          status: "running",
          data: { input: toolInput },
        });

        if (toolName === "finish_task") {
          finished = true;
          finalSummary = (toolInput.summary as string) || "Tarea completada.";
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: "Tarea marcada como finalizada.",
          });
          nextStep({
            type: "tool_result",
            tool: "finish_task",
            title: "Tarea marcada como finalizada",
            status: "success",
          });
          continue;
        }

        const result = await executeTool(toolName, toolInput, toolCtx);

        nextStep({
          type: "tool_result",
          tool: toolName,
          title: result.ok
            ? `${toolName} ejecutada correctamente`
            : `Error en ${toolName}: ${result.error}`,
          status: result.ok ? "success" : "error",
          data: { output: result.output, error: result.error },
        });

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result.ok ? result.output : { error: result.error }),
        });
      }
    }

    if (!finished) {
      finalSummary =
        "Se alcanzó el número máximo de pasos sin que el modelo llamara a finish_task. Revisa los cambios parciales.";
    }

    // ---------- 3. Construir los diffs para el panel ----------
    const filesChanged: FileChange[] = [];
    for (const [relPath, { before }] of toolCtx.filesTouched.entries()) {
      const fullPath = path.join(workspaceDir, relPath);
      const after = await github.readFileIfExists(fullPath);
      filesChanged.push({
        path: relPath,
        action: before === undefined ? "created" : after === undefined ? "deleted" : "modified",
        original_content: before,
        new_content: after,
        language: github.guessLanguage(relPath),
      });
    }

    // ---------- 4. Commit, push y (opcional) PR ----------
    let commitSha: string | undefined;
    let pullRequestUrl: string | undefined;

    if (filesChanged.length > 0) {
      nextStep({
        type: "tool_call",
        tool: "github_commit_push",
        title: "Haciendo commit y push de los cambios",
        status: "running",
      });

      const commitResult = await github.commitAndPush({
        workspaceDir,
        workBranch: clone.workBranch,
        token: githubToken,
        repoUrl: request.repo_url,
        commitMessage: `agent: ${finalSummary.slice(0, 200)}`,
      });
      commitSha = commitResult.commit_sha || undefined;

      nextStep({
        type: "tool_result",
        tool: "github_commit_push",
        title: commitResult.had_changes
          ? `Push realizado en ${commitResult.branch}`
          : "No hubo cambios que commitear",
        status: "success",
        data: commitResult,
      });

      if (request.create_pull_request && commitResult.had_changes) {
        nextStep({
          type: "tool_call",
          tool: "github_create_pr",
          title: "Abriendo Pull Request",
          status: "running",
        });
        const pr = await github.createPullRequest({
          repoUrl: request.repo_url,
          token: githubToken,
          baseBranch: clone.baseBranch,
          workBranch: clone.workBranch,
          title: finalSummary.slice(0, 80) || "Cambios generados por Zoco IA Agent",
          body: `${finalSummary}\n\n---\nGenerado automáticamente por el agente de Zoco IA (tarea ${taskId}).`,
        });
        pullRequestUrl = pr.pull_request_url;
        nextStep({
          type: "tool_result",
          tool: "github_create_pr",
          title: `Pull Request creado: ${pr.pull_request_url}`,
          status: "success",
          data: pr,
        });
      } else if (commitResult.had_changes) {
        await github.pushDirectlyToBase({
          workspaceDir,
          baseBranch: clone.baseBranch,
          workBranch: clone.workBranch,
          repoUrl: request.repo_url,
          token: githubToken,
        });
        nextStep({
          type: "tool_result",
          tool: "github_push_direct",
          title: `Cambios fusionados directamente en ${clone.baseBranch}`,
          status: "success",
        });
      }
    }

    // ---------- 5. Deploy opcional en Coolify ----------
    let deployment: AgentRunResult["deployment"] = { triggered: false };

    if (request.auto_deploy && filesChanged.length > 0) {
      nextStep({
        type: "tool_call",
        tool: "coolify_deploy",
        title: "Buscando la aplicación en Coolify",
        status: "running",
      });

      const app =
        (config.coolify.serverUuid &&
          (await coolify.getApplication(config.coolify.serverUuid).catch(() => null))) ||
        (await coolify.findApplicationByRepo(parsed.owner, parsed.name));

      if (!app) {
        nextStep({
          type: "tool_result",
          tool: "coolify_deploy",
          title: "No se encontró una aplicación en Coolify para este repo",
          status: "error",
        });
      } else {
        const deployResult = await coolify.triggerDeploy(app.uuid);
        deployment = {
          triggered: true,
          application_uuid: app.uuid,
          deployment_uuid: deployResult.deployment_uuid,
          public_url: app.fqdn,
        };
        nextStep({
          type: "tool_result",
          tool: "coolify_deploy",
          title: `Despliegue disparado en Coolify (${app.name})`,
          status: "success",
          data: deployment,
        });
      }
    }

    nextStep({ type: "done", title: "Tarea completada", status: "success" });

    return {
      task_id: taskId,
      status: "completed",
      summary: finalSummary,
      instructions: request.instructions,
      repo: {
        owner: parsed.owner,
        name: parsed.name,
        base_branch: clone.baseBranch,
        work_branch: clone.workBranch,
        commit_sha: commitSha,
        pull_request_url: pullRequestUrl,
      },
      files_changed: filesChanged,
      deployment,
      steps,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    nextStep({ type: "error", title: "La tarea falló", detail: message, status: "error" });
    return {
      task_id: taskId,
      status: "failed",
      summary: "La tarea no se pudo completar.",
      instructions: request.instructions,
      repo: repoInfo
        ? {
            owner: repoInfo.owner,
            name: repoInfo.name,
            base_branch: repoInfo.baseBranch,
            work_branch: repoInfo.workBranch,
          }
        : undefined,
      files_changed: [],
      steps,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      error: message,
    };
  } finally {
    await github.cleanupWorkspace(workspaceDir).catch(() => undefined);
  }
}

function describeToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "list_files":
      return `Explorando carpeta: ${(input.path as string) || "."}`;
    case "read_file":
      return `Leyendo ${input.path}`;
    case "write_file":
      return `Escribiendo ${input.path}`;
    case "delete_file":
      return `Eliminando ${input.path}`;
    default:
      return `Ejecutando ${name}`;
  }
}
