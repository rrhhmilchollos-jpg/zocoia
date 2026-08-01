// MOTOR DE IA: API oficial de Anthropic — llamadas directas a modelos Claude.
// Se ha eliminado por completo el enrutado a Zoco IA / Ollama / Groq: este
// archivo ya NO depende de ningún servidor local ni de ninguna clave
// ZOCOIA_API_KEY / OLLAMA_BASE_URL. Solo necesita ANTHROPIC_API_KEY.
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./logger";
import { recordApiUsage } from "./usageMeter";

// ─── Cliente Anthropic (lazy) ────────────────────────────────────────────────
let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY no configurada. Añade tu clave de la API de Anthropic a las variables de entorno.",
      );
    }
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

/* ----------------------------- types -------------------------------------- */

export type GenLanguage = "typescript" | "javascript";

export interface QAIssue {
  file: string;
  problem: string;
  fix: string;
}

export interface QAReport {
  ok: boolean;
  issues: QAIssue[];
}

export interface BuildIssue {
  file: string;
  message: string;
  line?: number;
}

export interface ValidationReport {
  ok: boolean;
  issues: BuildIssue[];
  filesAnalyzed: number;
}

export type AgentRole = "researcher" | "architect" | "designer" | "frontend" | "backend" | "database" | "integrator" | "qa" | "devops" | "patcher" | "repair" | "system" | "memory" | "validator" | "testing" | "fixing" | "patching" | "coder" | "visual-evaluator" | "chat" | "classifier" | "crew" | "rag" | "tools" | "planner" | "data-ops" | "error-analysis" | "image-analysis" | "code-review" | "gating";

export type ComplexityTier = "basic" | "standard" | "robust" | "ultra";

export type GeneratePhase = 
  | "starting"
  | "researching"
  | "architecting"
  | "designing"
  | "schema"
  | "frontend"
  | "backend"
  | "generating"
  | "integrations"
  | "integrating"
  | "testing"
  | "reviewing"
  | "qa"
  | "patching"
  | "validating"
  | "fixing"
  | "parsing"
  | "queued"
  | "ready"
  | "failed";

export interface GenerateProgress {
  phase: GeneratePhase;
  progress: number;
  note?: string;
}

export type AgentLog = (
  agent: string,
  message: string,
  level?: "info" | "warn" | "error",
) => void;

export interface AgentModelChoice {
  role: AgentRole;
  label: string;
  model: any;
  reason: string;
}

export interface AgentModelPlan {
  tier: ComplexityTier;
  score: number;
  selectedCoderModel: string;
  auto: boolean;
  agents: Record<AgentRole, AgentModelChoice>;
}

/* ----------------------------- helpers ------------------------------------ */

export function extractJsonObject<T = any>(raw: string): T | null {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  const first = s.indexOf("{");
  if (first === -1) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = first; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(s.slice(first, i + 1)) as T; } catch {}
      }
    }
  }
  try { return JSON.parse(s) as T; } catch {}
  return null;
}

/**
 * Reemplaza extractJsonObject para el plan de reparación multi-archivo
 * (planMultiFileRepair) — formato de etiquetas tipo XML en vez de JSON.
 * Cada <file>...</file> es un bloque independiente: un corte de tokens a
 * mitad del archivo N nunca invalida los N-1 anteriores, que sí llegaron
 * a cerrarse (a diferencia de un único objeto JSON balanceado).
 */
export function extractResilientFilePlan(raw: string): MultiFilePlanItem[] {
  const plans: MultiFilePlanItem[] = [];
  const fileRegex = /<file>\s*<path>([\s\S]*?)<\/path>\s*<action>(rewrite|create|delete)<\/action>\s*<reason>([\s\S]*?)<\/reason>\s*<\/file>/g;
  let match: RegExpExecArray | null;
  while ((match = fileRegex.exec(raw)) !== null) {
    const path = match[1].trim();
    if (!path) continue;
    plans.push({
      path,
      action: match[2] as "rewrite" | "create" | "delete",
      reason: match[3].trim(),
    });
  }
  return plans;
}

export async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// ─── Modelos Claude reales, de más capaz a más rápido ────────────────────────
// Nombres verificados contra la API real de Anthropic. "auto"/ids legados
// (zoco-*, gemini-*, etc.) se remapean aquí a un modelo real equivalente.
export const CLAUDE_SONNET = "claude-sonnet-4-6";
export const CLAUDE_OPUS = "claude-opus-4-8";
export const CLAUDE_HAIKU = "claude-haiku-4-5-20251001";

const CLAUDE_MODELS = [CLAUDE_SONNET, CLAUDE_OPUS, CLAUDE_HAIKU];

// Normaliza cualquier identificador legado (zoco-flash/zoco-plus/zoco-max,
// gemini-*, auto, etc.) a un modelo real de Claude.
function claudeModelFor(model: string): string {
  const m = String(model || "").toLowerCase();
  if (CLAUDE_MODELS.includes(model)) return model;
  if (/haiku|flash|lab/.test(m)) return CLAUDE_HAIKU;
  if (/opus|max/.test(m)) return CLAUDE_OPUS;
  if (/sonnet|plus|auto|default|^$/.test(m)) return CLAUDE_SONNET;
  return CLAUDE_SONNET;
}

function fallbackClaudeModels(model: string): string[] {
  const primary = claudeModelFor(model);
  return [primary, ...CLAUDE_MODELS.filter((m) => m !== primary)];
}

// Timeout duro para cualquier llamada a Anthropic dentro de este archivo.
// Sin esto, una llamada no-streaming puede colgarse minutos si el proveedor
// se degrada — el job entero quedaría en silencio hasta el watchdog global
// (12 min), perdiendo todo el trabajo ya hecho.
export async function raceWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}
export const AI_CALL_TIMEOUT_MS = 90_000;

/**
 * Llamada principal de chat/completion — API nativa de Anthropic
 * (anthropic.messages.stream), con reintento y fallback entre modelos
 * Claude reales (Sonnet → Opus → Haiku) ante fallos transitorios.
 */
export async function createClaudeMessageWithFallback(
  role: AgentRole,
  model: string,
  params: any,
  meterOpts?: { jobId?: string },
): Promise<any> {
  let lastError: unknown;
  const MAX_RETRIES = 3;

  // Prompt caching: system prompts largos y estáticos se marcan como
  // cacheable para reducir coste/latencia en llamadas repetidas.
  const MIN_CACHEABLE_CHARS = 3500;
  if (typeof params.system === "string" && params.system.length >= MIN_CACHEABLE_CHARS) {
    params = {
      ...params,
      system: [{ type: "text", text: params.system, cache_control: { type: "ephemeral" } }],
    };
  }

  // Compresión de historiales muy largos para no saturar la ventana de contexto.
  if (params.messages && params.messages.length > 10) {
    logger.info({ role, originalLength: params.messages.length }, "CONTEXT OPTIMIZER: Comprimiendo historial...");
    const systemInstruction = params.messages[0].role === "system" ? params.messages.shift() : null;
    const lastUserMessage = params.messages.pop();
    const middleMessages = params.messages.slice(-4);
    const firstMessage = params.messages[0];

    params.messages = [
      ...(systemInstruction ? [systemInstruction] : []),
      firstMessage,
      { role: "user", content: "... [Contexto antiguo comprimido] ..." },
      ...middleMessages,
      lastUserMessage,
    ].filter(Boolean);
  }

  for (const candidate of fallbackClaudeModels(model)) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await new Promise((r) => setTimeout(r, Math.random() * 300));
        logger.info({ role, model: candidate }, "Iniciando stream con Anthropic...");

        let fullText = "";
        let usageInputTokens = 0;
        let usageOutputTokens = 0;
        let cacheReadTokens = 0;

        const stream = getAnthropic().messages.stream({
          model: candidate,
          max_tokens: params.max_tokens || 4096,
          temperature: params.temperature ?? 0.7,
          system: params.system,
          messages: params.messages || [],
        });

        // Timeout de inactividad real: si pasan AI_CALL_TIMEOUT_MS sin recibir
        // ni un solo evento nuevo del stream, se considera colgado y se pasa
        // al siguiente intento/modelo, en vez de esperar indefinidamente.
        const iterator = stream[Symbol.asyncIterator]();
        while (true) {
          const { value: chunk, done } = await raceWithTimeout(
            iterator.next(),
            AI_CALL_TIMEOUT_MS,
            `${role} stream chunk (modelo ${candidate})`,
          );
          if (done) break;
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            fullText += chunk.delta.text;
          }
          if (chunk.type === "message_start") {
            usageInputTokens = chunk.message.usage?.input_tokens ?? 0;
            cacheReadTokens = (chunk.message.usage as any)?.cache_read_input_tokens ?? 0;
          }
          if (chunk.type === "message_delta") {
            usageOutputTokens = chunk.usage?.output_tokens ?? usageOutputTokens;
          }
        }

        if (!fullText) throw new Error("Stream vacío");

        recordApiUsage({
          jobId: meterOpts?.jobId,
          model: candidate,
          inputTokens: usageInputTokens,
          outputTokens: usageOutputTokens,
          agent: role,
        });

        return {
          content: [{ type: "text", text: fullText }],
          usage: {
            input_tokens: usageInputTokens,
            output_tokens: usageOutputTokens,
            cache_read_input_tokens: cacheReadTokens,
          },
          model: candidate,
        };
      } catch (err: any) {
        lastError = err;
        const isRateLimit = err?.status === 429;
        const isOverloaded = err?.status === 529;
        const isTransient = isRateLimit || isOverloaded
          || err?.status >= 500
          || /timed out|timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|network|fetch failed|Stream vacío/i.test(String(err?.message || err));

        if (isTransient && attempt < MAX_RETRIES - 1) {
          const delay = Math.pow(2, attempt) * 1500 + Math.random() * 1000;
          logger.warn({ role, model: candidate, attempt, delay, isRateLimit, isOverloaded }, "Fallo transitorio; reintentando...");
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        logger.warn({ role, model: candidate, err }, "Modelo falló; probando siguiente modelo de fallback");
        break;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Variante de createClaudeMessageWithFallback para llamadas con tool-calling
 * (bucles agenticos como marisCrewAI.ts y agentTools.ts). Usa el formato
 * nativo de Anthropic (tools con input_schema, bloques tool_use/tool_result),
 * así que no hace falta ninguna conversión de formato.
 */
export async function createClaudeToolCallWithFallback(
  role: AgentRole,
  model: string,
  params: any,
  meterOpts?: { jobId?: string },
): Promise<any> {
  let lastError: unknown;
  const MAX_RETRIES = 3;

  for (const candidate of fallbackClaudeModels(model)) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const request: any = {
          model: candidate,
          max_tokens: params.max_tokens || 2048,
          temperature: params.temperature ?? 0.7,
          system: params.system,
          messages: params.messages || [],
        };
        if (Array.isArray(params.tools) && params.tools.length > 0) {
          request.tools = params.tools;
          if (params.tool_choice) request.tool_choice = params.tool_choice;
        }

        const response = await raceWithTimeout(
          getAnthropic().messages.create(request) as unknown as Promise<any>,
          AI_CALL_TIMEOUT_MS,
          `${role} tool call (modelo ${candidate})`,
        );

        recordApiUsage({
          jobId: meterOpts?.jobId,
          model: candidate,
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          agent: role,
        });

        return {
          content: response.content,
          stop_reason: response.stop_reason,
          usage: {
            input_tokens: response.usage?.input_tokens ?? 0,
            output_tokens: response.usage?.output_tokens ?? 0,
          },
          model: candidate,
        };
      } catch (err: any) {
        lastError = err;
        const isRateLimit = err?.status === 429;
        const isOverloaded = err?.status === 529;
        const isTransient = isRateLimit || isOverloaded
          || err?.status >= 500
          || /timed out|timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|network|fetch failed/i.test(String(err?.message || err));

        if (isTransient && attempt < MAX_RETRIES - 1) {
          const delay = Math.pow(2, attempt) * 1500 + Math.random() * 1000;
          logger.warn({ role, model: candidate, attempt, delay, isRateLimit, isOverloaded }, "Tool call: fallo transitorio; reintentando...");
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        logger.warn({ role, model: candidate, err }, "Tool call: modelo falló; probando siguiente modelo de fallback");
        break;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function estimatePromptTokens(text: string): number {
  return Math.ceil(String(text || "").length / 4);
}

function bundleFilesForPrompt(bundle: string): Array<{ path: string; content: string; raw: string }> {
  const out: Array<{ path: string; content: string; raw: string }> = [];
  const parts = String(bundle || "").split(/\/\/\s*===\s*FILE:\s*/);
  for (const part of parts) {
    if (!part.trim()) continue;
    const nl = part.indexOf("\n");
    if (nl === -1) continue;
    const path = part.slice(0, nl).trim().replace(/\s*===$/, "");
    const content = part.slice(nl + 1);
    if (path) out.push({ path, content, raw: `// === FILE: ${path} ===\n${content}` });
  }
  return out;
}

export function compactBundleForPrompt(bundle: string, hints: string[] = [], maxChars = 70_000): string {
  const files = bundleFilesForPrompt(bundle);
  if (files.length === 0) return String(bundle || "").slice(0, maxChars);
  const normalizedHints = hints.join(" ").toLowerCase();
  const critical = /(^|\/)(package\.json|vite\.config\.[jt]s|index\.html|src\/main\.[jt]sx?|src\/app\.[jt]sx?|src\/index\.(css|scss)|src\/styles?\.(css|scss))$/i;
  const scored = files.map((file, index) => {
    const haystack = `${file.path}\n${file.content.slice(0, 2000)}`.toLowerCase();
    let score = critical.test(file.path) ? 100 : 0;
    for (const hint of normalizedHints.split(/[^a-z0-9_\-/]+/).filter((h) => h.length >= 3)) {
      if (haystack.includes(hint)) score += 10;
      if (file.path.toLowerCase().includes(hint)) score += 25;
    }
    if (/component|page|route|modal|button|form|table|header|footer|navbar/i.test(file.path)) score += 5;
    return { ...file, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index);

  const selected: typeof scored = [];
  let used = 0;
  for (const file of scored) {
    const size = file.raw.length + 2;
    if (selected.length > 0 && used + size > maxChars) continue;
    selected.push(file);
    used += size;
    if (used >= maxChars) break;
  }
  selected.sort((a, b) => a.index - b.index);
  const omitted = files.filter((f) => !selected.some((s) => s.path === f.path));
  const header = [
    `// === MARIS_PROMPT_CONTEXT: compacted bundle ===`,
    `// Included ${selected.length}/${files.length} files. Approx input tokens saved: ${Math.max(0, estimatePromptTokens(bundle) - estimatePromptTokens(selected.map((f) => f.raw).join("\n")))}.`,
    omitted.length ? `// Omitted files: ${omitted.map((f) => f.path).slice(0, 80).join(", ")}${omitted.length > 80 ? ", ..." : ""}` : `// No files omitted.`,
  ].join("\n");
  return `${header}\n${selected.map((f) => f.raw).join("\n")}`;
}

/* ----------------------------- patcher ------------------------------------ */

export function mergePatchIntoBundle(
  originalBundle: string,
  changedFiles: Record<string, string>,
  deletedFiles: string[] = []
): string {
  const files: Record<string, string> = {};
  const parts = originalBundle.split(/\/\/ === FILE: /);
  for (const part of parts) {
    if (!part.trim()) continue;
    const nl = part.indexOf("\n");
    if (nl === -1) continue;
    const path = part.slice(0, nl).trim().replace(/ ===$/, "");
    if (path) files[path] = "// === FILE: " + part;
  }
  for (const path of deletedFiles) {
    const normalizedPath = path.replace(/^\//, "").trim();
    if (normalizedPath) delete files[normalizedPath];
  }
  for (const [path, content] of Object.entries(changedFiles)) {
    const normalizedPath = path.replace(/^\//, "").trim();
    if (!normalizedPath) continue;
    files[normalizedPath] = `// === FILE: ${normalizedPath} ===\n${content}`;
  }
  return Object.values(files).join("\n");
}

export function buildPatcherSystemPrompt(language: GenLanguage): string {
  const isTS = language === "typescript";
  const tsLine = isTS
    ? "- TypeScript bundle (.tsx/.ts): type annotations required. Fix type errors, missing interfaces, wrong generics."
    : "- JavaScript bundle (.jsx/.js): do NOT introduce TypeScript syntax. Fix JS-only issues.";
  return `You are Maris AI's testing-agent — the most advanced technical repair expert in the system.\nYour mission: receive a list of errors detected in a React frontend bundle and FIX ALL OF THEM with surgical precision.\nYou are a senior full-stack engineer with 15+ years of experience in React, TypeScript, Vite, Tailwind, and modern web development.\nOutput STRICT JSON only:\n{"changedFiles":{"src/App.tsx":"full updated content for changed file only"},"deletedFiles":[]}\n\nLANGUAGE RULES:\n- ALL user-visible copy MUST be in Spanish (es-ES).\n- Code identifiers, variable names, file names → English only.\n\nSYNTAX REPAIR:\n${tsLine}\n- Remove every ,, patterns.\n- Every brace, bracket, paren and JSX tag must close.\n- Match every import { X } to a named export and every import X from to a default export.\n- Link in wouter v3 already renders as anchor. Never nest <a> inside <Link>.\n\nReturn ONLY changed files, not the full bundle. Output ONLY the JSON object.`;
}

export function buildFastPatchPrompt(): string {
  return `You are Maris AI's Fast Patcher. Apply ONLY the requested change to the frontend bundle.\nOutput STRICT JSON only:\n{"changedFiles":{"src/App.tsx":"full file content here"},"deletedFiles":["src/OldComponent.tsx"]}\n\nOPERATION SEMANTICS — obey the user literally:\n- ADD / AÑADIR / AGREGAR means add the requested element/file/data only. Do not rewrite unrelated content.\n- MODIFY / MODIFICAR / CAMBIAR / EDITAR means alter the existing target only. Do not duplicate it and do not create replacements unless asked.\n- DELETE / ELIMINAR / BORRAR / QUITAR means remove the requested target only. Put removed file paths in deletedFiles; for inline removals, return only the file that contains the removal.\n\nRULES:\n- Identify the exact file(s) that need to change. Usually just 1 file.\n- The key must match the exact filename in the bundle (e.g. "index.html", "src/App.tsx").\n- Return the COMPLETE content of each changed file (not a diff, the full file).\n- Keep ALL other files exactly as they are - do NOT include unchanged files.\n- Never perform a full redesign/rebuild from a small add/modify/delete request.\n- Output ONLY the JSON object. No markdown, no backticks, no explanation.`;
}

export async function patchBundle(
  frontendCode: string,
  issues: QAIssue[],
  language: GenLanguage = "typescript",
  memoryContext: string = "",
  model: string = CLAUDE_SONNET,
  jobId?: string,
): Promise<string | null> {
  if (issues.length === 0) return null;

  // MARIS-SHIELD: rechazar reparaciones masivas (>5 archivos distintos).
  // El pipeline clásico de una sola pasada falla matemáticamente con 15+
  // archivos simultáneos saturando la ventana de contexto. Si hay muchos
  // archivos afectados, el CoreOrchestrator por hitos debe manejar la
  // reparación (1 archivo por llamada).
  const affectedFiles = new Set(issues.map(i => i.file).filter(Boolean));
  if (affectedFiles.size > 5) {
    console.warn(`[MARIS-SHIELD] patchBundle rechazado: ${affectedFiles.size} archivos afectados supera el límite de 5. Delegando al orquestador por hitos.`);
    return null;
  }
  const issueList = issues
    .map((i, idx) => `${idx + 1}. [${i.file}] Problem: ${i.problem}\n   Fix: ${i.fix}`)
    .join("\n");

  const issueHints = issues.flatMap((i) => [i.file, i.problem]);
  const compactedBundle = compactBundleForPrompt(frontendCode, issueHints, 70_000);

  return withTimeout(
    (async () => {
      try {
        const response = await createClaudeMessageWithFallback("patcher", model, {
          max_tokens: 24000,
          system: buildPatcherSystemPrompt(language) + "\nOutput JSON only.",
          messages: [
            {
              role: "user",
              content: `ISSUES TO FIX:\n${issueList}\n${memoryContext}\nCURRENT FRONTEND BUNDLE (only the most relevant files are shown — files NOT shown here are unrelated to these issues and must NOT be referenced as missing):\n${compactedBundle}\n\nReturn ONLY the changed/added files as JSON: {\"changedFiles\":{\"path\":\"full content\"},\"deletedFiles\":[\"path\"]}.`,
            },
          ],
        }, { jobId });
        const raw = (response.content[0] as any).text ?? "";
        const parsed = extractJsonObject<{ changedFiles?: Record<string, string>; deletedFiles?: string[] }>(raw);
        if (!parsed || typeof parsed.changedFiles !== "object" || parsed.changedFiles === null) {
          return null;
        }
        const changedFiles = parsed.changedFiles;
        const deletedFiles = Array.isArray(parsed.deletedFiles) ? parsed.deletedFiles.map(String) : [];
        if (Object.keys(changedFiles).length === 0 && deletedFiles.length === 0) return null;
        const merged = mergePatchIntoBundle(frontendCode, changedFiles, deletedFiles);
        if (!merged || merged.length < 100) return null;
        return merged;
      } catch {
        return null;
      }
    })(),
    240_000,
    null,
  );
}

/* ----------------------- multi-file patcher -------------------------------- */
export interface MultiFilePlanItem {
  path: string;
  action: "rewrite" | "create" | "delete";
  reason: string;
}

async function planMultiFileRepair(
  bundle: string,
  errorSummary: string,
  language: GenLanguage,
  model: string,
): Promise<MultiFilePlanItem[] | null> {
  const issueHints = [errorSummary];
  const compactedBundle = compactBundleForPrompt(bundle, issueHints, 70_000);

  return withTimeout(
    (async () => {
      try {
        const response = await createClaudeMessageWithFallback("planner", model, {
          max_tokens: 4000,
          system: `You are Maris AI's multi-file repair planner. Your task is to analyze a frontend bundle and a summary of errors, then propose a plan to fix them across multiple files.\nOutput STRICT XML only, using <file><path>...</path><action>...</action><reason>...</reason></file> tags. Actions can be 'rewrite', 'create', or 'delete'.\n\nERROR SUMMARY:\n${errorSummary}\n\nCURRENT FRONTEND BUNDLE (only the most relevant files are shown — files NOT shown here are unrelated to these issues and must NOT be referenced as missing):\n${compactedBundle}\n\nReturn ONLY the XML plan. No markdown, no backticks, no explanation.`,
          messages: [
            {
              role: "user",
              content: `Based on the error summary and the provided bundle, generate a plan to fix the issues. Focus on identifying which files need to be rewritten, created, or deleted. For each file, provide a brief reason for the action.`,
            },
          ],
        });
        const raw = (response.content[0] as any).text ?? "";
        return extractResilientFilePlan(raw);
      } catch (err) {
        logger.error({ err }, "Error planning multi-file repair");
        return null;
      }
    })(),
    AI_CALL_TIMEOUT_MS,
    null,
  );
}

async function generateFilePatch(
  bundle: string,
  planItem: MultiFilePlanItem,
  errorSummary: string,
  language: GenLanguage,
  model: string,
): Promise<string | null> {
  const { path, action, reason } = planItem;
  if (action === "delete") return null;

  const issueHints = [path, reason, errorSummary];
  const compactedBundle = compactBundleForPrompt(bundle, issueHints, 70_000);

  return withTimeout(
    (async () => {
      try {
        const response = await createClaudeMessageWithFallback("patcher", model, {
          max_tokens: 16000,
          system: buildPatcherSystemPrompt(language) + `\nYour current task is to ${action} the file ${path} because: ${reason}.\nOutput JSON only.`,
          messages: [
            {
              role: "user",
              content: `CURRENT FRONTEND BUNDLE (only the most relevant files are shown — files NOT shown here are unrelated to this issue and must NOT be referenced as missing):\n${compactedBundle}\n\nGenerate the full content for the file ${path} based on the plan. Return ONLY the changed/added files as JSON: {\"changedFiles\":{\"${path}\":\"full content\"},\"deletedFiles\":[]}.`,
            },
          ],
        });
        const raw = (response.content[0] as any).text ?? "";
        const parsed = extractJsonObject<{ changedFiles?: Record<string, string> }>(raw);
        return parsed?.changedFiles?.[path] || null;
      } catch (err) {
        logger.error({ err, path }, "Error generating file patch");
        return null;
      }
    })(),
    AI_CALL_TIMEOUT_MS,
    null,
  );
}

export async function patchBundleMultiFile(
  frontendCode: string,
  errorSummary: string,
  language: GenLanguage = "typescript",
  model: string = CLAUDE_SONNET,
  jobId?: string,
): Promise<string | null> {
  const plan = await planMultiFileRepair(frontendCode, errorSummary, language, model);
  if (!plan || plan.length === 0) return null;

  let currentBundle = frontendCode;
  const changedFiles: Record<string, string> = {};
  const deletedFiles: string[] = [];

  for (const planItem of plan) {
    if (planItem.action === "delete") {
      deletedFiles.push(planItem.path);
      continue;
    }

    let fileContent = await generateFilePatch(currentBundle, planItem, errorSummary, language, model);
    if (!fileContent) {
      logger.warn({ path: planItem.path }, "Primer intento de generación de archivo fallido, reintentando...");
      fileContent = await generateFilePatch(currentBundle, planItem, errorSummary, language, model);
    }

    if (fileContent) {
      changedFiles[planItem.path] = fileContent;
      currentBundle = mergePatchIntoBundle(currentBundle, { [planItem.path]: fileContent });
    } else {
      logger.error({ path: planItem.path }, "Segundo intento de generación de archivo fallido. Saltando este archivo.");
    }
  }

  if (Object.keys(changedFiles).length === 0 && deletedFiles.length === 0) return null;

  return mergePatchIntoBundle(frontendCode, changedFiles, deletedFiles);
}

export async function createFastPatch(
  frontendCode: string,
  userPrompt: string,
  language: GenLanguage = "typescript",
  model: string = CLAUDE_SONNET,
  jobId?: string,
): Promise<string | null> {
  const issueHints = [userPrompt];
  const compactedBundle = compactBundleForPrompt(frontendCode, issueHints, 70_000);

  return withTimeout(
    (async () => {
      try {
        const response = await createClaudeMessageWithFallback("patcher", model, {
          max_tokens: 16000,
          system: buildFastPatchPrompt(),
          messages: [
            {
              role: "user",
              content: `USER REQUEST:\n${userPrompt}\n\nCURRENT FRONTEND BUNDLE (only the most relevant files are shown — files NOT shown here are unrelated to this issue and must NOT be referenced as missing):\n${compactedBundle}\n\nReturn ONLY the changed/added files as JSON: {\"changedFiles\":{\"path\":\"full content\"},\"deletedFiles\":[\"path\"]}.`,
            },
          ],
        }, { jobId });
        const raw = (response.content[0] as any).text ?? "";
        const parsed = extractJsonObject<{ changedFiles?: Record<string, string>; deletedFiles?: string[] }>(raw);
        if (!parsed || typeof parsed.changedFiles !== "object" || parsed.changedFiles === null) {
          return null;
        }
        const changedFiles = parsed.changedFiles;
        const deletedFiles = Array.isArray(parsed.deletedFiles) ? parsed.deletedFiles.map(String) : [];
        if (Object.keys(changedFiles).length === 0 && deletedFiles.length === 0) return null;
        const merged = mergePatchIntoBundle(frontendCode, changedFiles, deletedFiles);
        if (!merged || merged.length < 100) return null;
        return merged;
      } catch {
        return null;
      }
    })(),
    240_000,
    null,
  );
}

export async function createChatCompletion(
  role: AgentRole,
  model: string,
  params: any,
  meterOpts?: { jobId?: string },
): Promise<any> {
  return createClaudeMessageWithFallback(role, model, params, meterOpts);
}

export async function createToolCallCompletion(
  role: AgentRole,
  model: string,
  params: any,
  meterOpts?: { jobId?: string },
): Promise<any> {
  return createClaudeToolCallWithFallback(role, model, params, meterOpts);
}

export async function createChatCompletionStream(
  role: AgentRole,
  model: string,
  params: any,
  meterOpts?: { jobId?: string },
): Promise<AsyncIterable<any>> {
  const response = await createClaudeMessageWithFallback(role, model, params, meterOpts);
  return (async function* () {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: response.content[0].text } };
  })();
}

export async function createToolCallCompletionStream(
  role: AgentRole,
  model: string,
  params: any,
  meterOpts?: { jobId?: string },
): Promise<AsyncIterable<any>> {
  const response = await createClaudeToolCallWithFallback(role, model, params, meterOpts);
  return (async function* () {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: response.content[0].text } };
  })();
}
