// ─── MOTOR: CLAUDE ANTHROPIC (SDK nativo) ────────────────────────────────────
// Migrado desde OpenAI/Ollama/DeepSeek a la API oficial de Anthropic.
// Modelos activos (IDs exactos verificados en docs.anthropic.com, agosto 2026):
//   zoco-flash / maris-velox  →  claude-haiku-4-5-20251001   (rápido, barato)
//   zoco-plus  / maris-core   →  claude-sonnet-4-6            (equilibrado)
//   zoco-max   / maris-pro    →  claude-opus-4-8              (máxima capacidad)
//   zoco-lab   / maris-beta   →  claude-opus-4-8              (experimental)
// El código de Ollama/OpenAI/DeepSeek/Groq queda comentado más abajo
// por si fuera necesario volver atrás.
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./logger";
import { recordApiUsage } from "./usageMeter";

// ─── CLIENTE ANTHROPIC ───────────────────────────────────────────────────────
let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY no configurada. Añádela como variable de entorno en Coolify."
      );
    }
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

// ─── MAPA DE MODELOS: nombres internos de Zoco IA → IDs reales de Claude ────
const CLAUDE_MODEL_MAP: Record<string, string> = {
  // Nivel flash/velox → Haiku (el más rápido y barato)
  "zoco-flash":       "claude-haiku-4-5-20251001",
  "maris-velox":      "claude-haiku-4-5-20251001",
  "maris-velox-1b":   "claude-haiku-4-5-20251001",
  // Nivel plus/core → Sonnet (equilibrado, default)
  "zoco-plus":        "claude-sonnet-4-6",
  "maris-core":       "claude-sonnet-4-6",
  "maris-core-7b":    "claude-sonnet-4-6",
  // Nivel max/pro → Opus (máxima capacidad)
  "zoco-max":         "claude-opus-4-8",
  "maris-pro":        "claude-opus-4-8",
  "maris-pro-32b":    "claude-opus-4-8",
  // Nivel lab/beta → Opus (experimental)
  "zoco-lab":         "claude-opus-4-8",
  "maris-beta":       "claude-opus-4-8",
  "maris-beta-70b":   "claude-opus-4-8",
};

// Resuelve el ID real de Claude para un nombre de modelo interno.
// Si ya viene un ID directo de Claude (ej. "claude-sonnet-4-6"), lo usa tal cual.
function claudeModelFor(model: string): string {
  const m = String(model || "zoco-plus");
  // Si ya es un ID de Claude real, usarlo directamente
  if (m.startsWith("claude-")) return m;
  // Mapear nombres internos de Zoco IA
  return CLAUDE_MODEL_MAP[m] || "claude-sonnet-4-6";
}

// ─── CÓDIGO ANTIGUO COMENTADO (Ollama / OpenAI / DeepSeek / Groq) ────────────
/*
import OpenAI from "openai";

let _groq: OpenAI | null = null;
function getGroq(): OpenAI | null {
  const zocoKey = process.env.ZOCOIA_API_KEY;
  const zocoUrl = process.env.ZOCOIA_API_URL || "https://zocoia.es";
  const ollamaUrl = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL;
  if (!_groq) {
    if (zocoUrl && zocoKey && zocoKey.startsWith('sk-zoco-')) {
      _groq = new OpenAI({ baseURL: `${zocoUrl.replace(/\/+$/, '')}/v1`, apiKey: zocoKey });
    } else if (ollamaUrl) {
      _groq = new OpenAI({ baseURL: `${ollamaUrl.replace(/\/+$/, '')}/v1`, apiKey: process.env.OLLAMA_API_KEY || 'ollama' });
    } else {
      return null;
    }
  }
  return _groq;
}

async function callGroqFallback(params: any): Promise<{ content: Array<{ type: string; text: string }> }> {
  const groq = getGroq();
  if (!groq) throw new Error('Motor local no configurado');
  const groqModel = process.env.OLLAMA_MODEL_PLUS || 'Zoco Max';
  const systemMsg = params.system
    ? [{ role: 'system' as const, content: typeof params.system === 'string' ? params.system : (params.system as any[]).map((b: any) => b.text || '').join('\n') }]
    : [];
  const userMessages = (params.messages || []).map((m: any) => ({
    role: m.role as 'user' | 'assistant',
    content: Array.isArray(m.content) ? m.content.map((b: any) => b.text || '').join('') : String(m.content || ''),
  }));
  const response = await groq.chat.completions.create({
    model: groqModel,
    messages: [...systemMsg, ...userMessages],
    max_tokens: params.max_tokens || 2048,
    temperature: 0.7,
  });
  const text = response.choices[0]?.message?.content || '';
  recordApiUsage({ jobId: undefined, model: groqModel, inputTokens: response.usage?.prompt_tokens || 0, outputTokens: response.usage?.completion_tokens || 0, agent: 'groq-fallback' });
  return { content: [{ type: 'text', text }] };
}

async function callOllamaFallback(role: AgentRole, params: any): Promise<any> {
  const ollamaUrl = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL;
  if (!ollamaUrl) throw new Error('Ollama URL no configurada');
  const ollamaModel = process.env.OLLAMA_MODEL_PLUS || 'Zoco Max';
  const messages = (params.messages || []).map((m: any) => ({
    role: m.role,
    content: Array.isArray(m.content) ? m.content.map((b: any) => b.text || '').join('') : String(m.content || ''),
  }));
  if (params.system) {
    messages.unshift({ role: 'system', content: typeof params.system === 'string' ? params.system : (params.system as any[]).map((b: any) => b.text || '').join('\n') });
  }
  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ollamaModel, messages, options: { temperature: params.temperature || 0.7, num_predict: params.max_tokens || 2048 } }),
  });
  if (!response.ok) { const errorText = await response.text(); throw new Error(`Ollama API error: ${response.status} - ${errorText}`); }
  const data = await response.json();
  const text = data.message?.content || '';
  recordApiUsage({ jobId: undefined, model: ollamaModel, inputTokens: 0, outputTokens: 0, agent: 'ollama-fallback' });
  return { content: [{ type: 'text', text }] };
}

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const zocoUrl = process.env.ZOCOIA_API_URL || "https://zocoia.es";
    const ollamaUrl = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL;
    if (zocoUrl) {
      _openai = new OpenAI({ baseURL: `${zocoUrl.replace(/\/+$/, "")}/v1`, apiKey: process.env.ZOCOIA_API_KEY || "dummy" });
    } else if (ollamaUrl) {
      _openai = new OpenAI({ baseURL: `${ollamaUrl.replace(/\/+$/, "")}/v1`, apiKey: process.env.OLLAMA_API_KEY || "ollama" });
    } else {
      throw new Error("Motor local no configurado");
    }
  }
  return _openai;
}

function zocoModelFor(model: string): string {
  const m = String(model || "");
  if (/^zoco-/.test(m)) return m;
  if (/haiku|flash/i.test(m)) return "zoco-flash";
  if (/opus|max/i.test(m)) return "zoco-max";
  return "zoco-plus";
}

function systemToText(system: any): string {
  if (!system) return "";
  const text = typeof system === "string" ? system : (system as any[]).map((b: any) => b?.text || "").join("\n");
  return text.includes("DeepSeek-R1/OpenAI compatible endpoint") ? text : text + DEEPSEEK_SAFE_FORMAT_RULE;
}

function anthropicMessagesToOpenAI(messages: any[]): any[] { ... }
function anthropicToolsToOpenAI(tools: any[]): any[] { ... }
*/
// ─── FIN CÓDIGO ANTIGUO ───────────────────────────────────────────────────────

// DEEPSEEK_SAFE_FORMAT_RULE se mantiene exportada para compatibilidad con
// seed-owner-agents.js que la importa, pero ya no se inyecta en los prompts
// (Claude no necesita esta instrucción).
export const DEEPSEEK_SAFE_FORMAT_RULE = "";

// stripReasoning se mantiene por compatibilidad — Claude no emite <think>,
// pero no hace daño tenerla y otros módulos pueden llamarla.
export function stripReasoning(text: string): string {
  if (!text) return "";
  let out = String(text);
  out = out.replace(/<think>[\s\S]*?<\/think>/g, "");
  const openIdx = out.indexOf("<think>");
  if (openIdx !== -1 && out.indexOf("</think>", openIdx) === -1) out = out.slice(0, openIdx);
  const orphanClose = out.indexOf("</think>");
  if (orphanClose !== -1 && out.lastIndexOf("<think>", orphanClose) === -1) out = out.slice(orphanClose + "</think>".length);
  return out.trim();
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
  | "starting" | "researching" | "architecting" | "designing" | "schema"
  | "frontend" | "backend" | "generating" | "integrations" | "integrating"
  | "testing" | "reviewing" | "qa" | "patching" | "validating" | "fixing"
  | "parsing" | "queued" | "ready" | "failed";

export interface GenerateProgress {
  phase: GeneratePhase;
  progress: number;
  note?: string;
}

export type AgentLog = (agent: string, message: string, level?: "info" | "warn" | "error") => void;

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

export function extractResilientFilePlan(raw: string): MultiFilePlanItem[] {
  const plans: MultiFilePlanItem[] = [];
  const fileRegex = /<file>\s*<path>([\s\S]*?)<\/path>\s*<action>(rewrite|create|delete)<\/action>\s*<reason>([\s\S]*?)<\/reason>\s*<\/file>/g;
  let match: RegExpExecArray | null;
  while ((match = fileRegex.exec(raw)) !== null) {
    const path = match[1].trim();
    if (!path) continue;
    plans.push({ path, action: match[2] as "rewrite" | "create" | "delete", reason: match[3].trim() });
  }
  return plans;
}

export async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

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

// ─── FUNCIÓN PRINCIPAL: llamada a Claude Anthropic con reintentos ─────────────
export async function createClaudeMessageWithFallback(
  role: AgentRole,
  model: string,
  params: any,
  meterOpts?: { jobId?: string },
): Promise<any> {
  const claudeModel = claudeModelFor(model);
  const MAX_RETRIES = 3;
  let lastError: unknown;

  // Extraer system prompt como string plano
  const systemText: string = !params.system
    ? ""
    : typeof params.system === "string"
      ? params.system
      : Array.isArray(params.system)
        ? params.system.map((b: any) => b?.text || "").join("\n")
        : String(params.system);

  // Convertir mensajes al formato nativo de Anthropic (sin role "system" en messages)
  const messages = (params.messages || [])
    .filter((m: any) => m && m.role !== "system")
    .map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: Array.isArray(m.content)
        ? m.content.map((b: any) => (typeof b === "string" ? { type: "text", text: b } : b))
        : String(m.content ?? ""),
    }));

  // Comprimir historial largo (conserva comportamiento original)
  if (messages.length > 10) {
    logger.info({ role, originalLength: messages.length }, "CONTEXT OPTIMIZER: Comprimiendo historial...");
    const lastMsg = messages.pop();
    const middleMessages = messages.slice(-4);
    const firstMsg = messages[0];
    const compressed = [
      firstMsg,
      { role: "user", content: "... [Contexto antiguo comprimido] ..." },
      { role: "assistant", content: "Entendido." },
      ...middleMessages,
      lastMsg,
    ].filter(Boolean);
    messages.length = 0;
    messages.push(...compressed);
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await new Promise(r => setTimeout(r, Math.random() * 300));
      logger.info({ role, model: claudeModel }, "Llamando a Claude Anthropic...");

      const response = await raceWithTimeout(
        getAnthropic().messages.create({
          model: claudeModel,
          max_tokens: params.max_tokens || 4096,
          temperature: params.temperature ?? 0.7,
          ...(systemText ? { system: systemText } : {}),
          messages,
        }),
        AI_CALL_TIMEOUT_MS,
        `${role} (modelo ${claudeModel})`,
      );

      const text = response.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");

      recordApiUsage({
        jobId: meterOpts?.jobId,
        model: claudeModel,
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
        agent: role,
      });

      return { content: [{ type: "text", text }] };

    } catch (err: any) {
      lastError = err;
      const isRateLimit = err?.status === 429 || String(err).includes("rate_limit");
      const isTransient = isRateLimit
        || err?.status >= 500
        || /timed out|timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|network|fetch failed/i.test(String(err?.message || err));

      if (isTransient && attempt < MAX_RETRIES - 1) {
        const delay = Math.pow(2, attempt) * 1500 + Math.random() * 1000;
        logger.warn({ role, model: claudeModel, attempt, delay }, "Claude: fallo transitorio, reintentando...");
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      logger.error({ role, model: claudeModel, err }, "Claude: todos los intentos fallaron");
      break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ─── TOOL CALLING con Claude Anthropic ───────────────────────────────────────
export async function createClaudeToolCallWithFallback(
  role: AgentRole,
  model: string,
  params: any,
): Promise<any> {
  const claudeModel = claudeModelFor(model);
  const MAX_RETRIES = 3;
  let lastError: unknown;

  const systemText: string = !params.system
    ? ""
    : typeof params.system === "string"
      ? params.system
      : Array.isArray(params.system)
        ? params.system.map((b: any) => b?.text || "").join("\n")
        : String(params.system);

  const messages = (params.messages || [])
    .filter((m: any) => m && m.role !== "system")
    .map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: Array.isArray(m.content)
        ? m.content
        : String(m.content ?? ""),
    }));

  const hasTools = Array.isArray(params.tools) && params.tools.length > 0;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await raceWithTimeout(
        getAnthropic().messages.create({
          model: claudeModel,
          max_tokens: params.max_tokens || 2048,
          temperature: params.temperature ?? 0.7,
          ...(systemText ? { system: systemText } : {}),
          messages,
          ...(hasTools ? { tools: params.tools } : {}),
          ...(hasTools && params.tool_choice ? { tool_choice: params.tool_choice } : {}),
        }),
        AI_CALL_TIMEOUT_MS,
        `${role} tool call (modelo ${claudeModel})`,
      );

      const usage = {
        input_tokens: response.usage?.input_tokens ?? 0,
        output_tokens: response.usage?.output_tokens ?? 0,
      };

      // Claude devuelve tool_use directamente en content — ya en formato Anthropic nativo
      return {
        content: response.content,
        stop_reason: response.stop_reason,
        usage,
      };

    } catch (err: any) {
      lastError = err;
      const isRateLimit = err?.status === 429 || String(err).includes("rate_limit");
      const isTransient = isRateLimit
        || err?.status >= 500
        || /timed out|timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|network|fetch failed/i.test(String(err?.message || err));

      if (isTransient && attempt < MAX_RETRIES - 1) {
        const delay = Math.pow(2, attempt) * 1500 + Math.random() * 1000;
        logger.warn({ role, model: claudeModel, attempt, delay }, "Claude tool call: reintentando...");
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      logger.error({ role, model: claudeModel, err }, "Claude tool call: todos los intentos fallaron");
      break;
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
  return `You are Maris AI's Fast Patcher. Apply ONLY the requested change to the frontend bundle.\nOutput STRICT JSON only:\n{"changedFiles":{"src/App.tsx":"full file content here"},"deletedFiles":["src/OldComponent.tsx"]}\n\nOPERATION SEMANTICS — obey the user literally:\n- ADD / AÑADIR / AGREGAR means add the requested element/file/data only.\n- MODIFY / MODIFICAR / CAMBIAR / EDITAR means alter the existing target only.\n- DELETE / ELIMINAR / BORRAR / QUITAR means remove the requested target only.\n\nRULES:\n- Identify the exact file(s) that need to change. Usually just 1 file.\n- Return the COMPLETE content of each changed file (not a diff, the full file).\n- Keep ALL other files exactly as they are.\n- Output ONLY the JSON object. No markdown, no backticks, no explanation.`;
}

export async function patchBundle(
  frontendCode: string,
  issues: QAIssue[],
  language: GenLanguage = "typescript",
  memoryContext: string = "",
  model: string = "zoco-plus",
  jobId?: string,
): Promise<string | null> {
  if (issues.length === 0) return null;
  const affectedFiles = new Set(issues.map(i => i.file).filter(Boolean));
  if (affectedFiles.size > 5) {
    console.warn(`[MARIS-SHIELD] patchBundle rechazado: ${affectedFiles.size} archivos supera el límite de 5.`);
    return null;
  }
  const issueList = issues.map((i, idx) => `${idx + 1}. [${i.file}] Problem: ${i.problem}\n   Fix: ${i.fix}`).join("\n");
  const issueHints = issues.flatMap((i) => [i.file, i.problem]);
  const compactedBundle = compactBundleForPrompt(frontendCode, issueHints, 70_000);

  return withTimeout(
    (async () => {
      try {
        const response = await createClaudeMessageWithFallback("patcher", model, {
          max_tokens: 24000,
          system: buildPatcherSystemPrompt(language) + "\nOutput JSON only.",
          messages: [{ role: "user", content: `ISSUES TO FIX:\n${issueList}\n${memoryContext}\nCURRENT FRONTEND BUNDLE:\n${compactedBundle}\n\nReturn ONLY the changed/added files as JSON: {"changedFiles":{"path":"full content"},"deletedFiles":["path"]}.` }],
        }, { jobId });
        const raw = (response.content[0] as any).text ?? "";
        const parsed = extractJsonObject<{ changedFiles?: Record<string, string>; deletedFiles?: string[] }>(raw);
        if (!parsed || typeof parsed.changedFiles !== "object" || parsed.changedFiles === null) return null;
        const changedFiles = parsed.changedFiles;
        const deletedFiles = Array.isArray(parsed.deletedFiles) ? parsed.deletedFiles.map(String) : [];
        if (Object.keys(changedFiles).length === 0 && deletedFiles.length === 0) return null;
        const merged = mergePatchIntoBundle(frontendCode, changedFiles, deletedFiles);
        if (!merged || merged.length < 100) return null;
        return merged;
      } catch { return null; }
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

async function planMultiFileRepair(bundle: string, errorSummary: string, language: GenLanguage, model: string): Promise<MultiFilePlanItem[] | null> {
  const compactedBundle = compactBundleForPrompt(bundle, [errorSummary], 70_000);
  return withTimeout(
    (async () => {
      try {
        const response = await createClaudeMessageWithFallback("planner", model, {
          max_tokens: 4000,
          system: `You are Maris AI's multi-file repair planner.\nOutput STRICT XML only, using <file><path>...</path><action>...</action><reason>...</reason></file> tags.\nERROR SUMMARY:\n${errorSummary}\nCURRENT FRONTEND BUNDLE:\n${compactedBundle}\nReturn ONLY the XML plan.`,
          messages: [{ role: "user", content: "Generate the repair plan." }],
        });
        return extractResilientFilePlan((response.content[0] as any).text ?? "");
      } catch (err) {
        logger.error({ err }, "Error planning multi-file repair");
        return null;
      }
    })(),
    AI_CALL_TIMEOUT_MS,
    null,
  );
}

async function generateFilePatch(bundle: string, planItem: MultiFilePlanItem, errorSummary: string, language: GenLanguage, model: string): Promise<string | null> {
  const { path, action, reason } = planItem;
  if (action === "delete") return null;
  const compactedBundle = compactBundleForPrompt(bundle, [path, reason, errorSummary], 70_000);
  return withTimeout(
    (async () => {
      try {
        const response = await createClaudeMessageWithFallback("patcher", model, {
          max_tokens: 16000,
          system: buildPatcherSystemPrompt(language) + `\nYour current task is to ${action} the file ${path} because: ${reason}.\nOutput JSON only.`,
          messages: [{ role: "user", content: `CURRENT FRONTEND BUNDLE:\n${compactedBundle}\n\nGenerate the full content for ${path}. Return ONLY: {"changedFiles":{"${path}":"full content"},"deletedFiles":[]}.` }],
        });
        const parsed = extractJsonObject<{ changedFiles?: Record<string, string> }>((response.content[0] as any).text ?? "");
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

export async function patchBundleMultiFile(frontendCode: string, errorSummary: string, language: GenLanguage = "typescript", model: string = "zoco-plus", jobId?: string): Promise<string | null> {
  const plan = await planMultiFileRepair(frontendCode, errorSummary, language, model);
  if (!plan || plan.length === 0) return null;

  let currentBundle = frontendCode;
  const changedFiles: Record<string, string> = {};
  const deletedFiles: string[] = [];

  for (const planItem of plan) {
    if (planItem.action === "delete") { deletedFiles.push(planItem.path); continue; }
    let fileContent = await generateFilePatch(currentBundle, planItem, errorSummary, language, model);
    if (!fileContent) {
      logger.warn({ path: planItem.path }, "Reintentando generación de archivo...");
      fileContent = await generateFilePatch(currentBundle, planItem, errorSummary, language, model);
    }
    if (fileContent) {
      changedFiles[planItem.path] = fileContent;
      currentBundle = mergePatchIntoBundle(currentBundle, { [planItem.path]: fileContent });
    } else {
      logger.error({ path: planItem.path }, "Segundo intento fallido. Saltando archivo.");
    }
  }

  if (Object.keys(changedFiles).length === 0 && deletedFiles.length === 0) return null;
  return mergePatchIntoBundle(frontendCode, changedFiles, deletedFiles);
}

export async function createFastPatch(frontendCode: string, userPrompt: string, language: GenLanguage = "typescript", model: string = "zoco-plus", jobId?: string): Promise<string | null> {
  const compactedBundle = compactBundleForPrompt(frontendCode, [userPrompt], 70_000);
  return withTimeout(
    (async () => {
      try {
        const response = await createClaudeMessageWithFallback("patcher", model, {
          max_tokens: 16000,
          system: buildFastPatchPrompt(),
          messages: [{ role: "user", content: `USER REQUEST:\n${userPrompt}\n\nCURRENT FRONTEND BUNDLE:\n${compactedBundle}\n\nReturn ONLY: {"changedFiles":{"path":"full content"},"deletedFiles":["path"]}.` }],
        }, { jobId });
        const raw = (response.content[0] as any).text ?? "";
        const parsed = extractJsonObject<{ changedFiles?: Record<string, string>; deletedFiles?: string[] }>(raw);
        if (!parsed || typeof parsed.changedFiles !== "object" || parsed.changedFiles === null) return null;
        const changedFiles = parsed.changedFiles;
        const deletedFiles = Array.isArray(parsed.deletedFiles) ? parsed.deletedFiles.map(String) : [];
        if (Object.keys(changedFiles).length === 0 && deletedFiles.length === 0) return null;
        const merged = mergePatchIntoBundle(frontendCode, changedFiles, deletedFiles);
        if (!merged || merged.length < 100) return null;
        return merged;
      } catch { return null; }
    })(),
    240_000,
    null,
  );
}

// Aliases para compatibilidad con el resto del pipeline
export const createChatCompletion = createClaudeMessageWithFallback;
export const createToolCallCompletion = createClaudeToolCallWithFallback;

export async function createChatCompletionStream(role: AgentRole, model: string, params: any, meterOpts?: { jobId?: string }): Promise<AsyncIterable<any>> {
  const response = await createClaudeMessageWithFallback(role, model, params, meterOpts);
  return (async function* () {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: response.content[0].text } };
  })();
}

export async function createToolCallCompletionStream(role: AgentRole, model: string, params: any, meterOpts?: { jobId?: string }): Promise<AsyncIterable<any>> {
  const response = await createClaudeToolCallWithFallback(role, model, params);
  return (async function* () {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: response.content[0]?.text || "" } };
  })();
}
