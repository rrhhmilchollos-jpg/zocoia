// shared-agents.ts
//
// Módulo de orquestación de agentes para Zoco IA.
// Implementa el puente entre los agentes del sistema y los proveedores de IA.
//
// CONFIGURACIÓN CRÍTICA (Directrices de Ingeniería):
// 1. Motor Principal: Groq Cloud (llama-3.3-70b-versatile o similar).
// 2. Motor de Respaldo/Local: Ollama (Zoco Max / Zoco Plus).
// 3. Soporte para Agentes Autónomos: Integración con E2B Desktop.

import OpenAI from "openai";
import { logger } from "./logger.js";
import { recordApiUsage } from "./usageMeter.js";

// ─── CONFIGURACIÓN DE PROVEEDORES ──────────────────────────────────────────

// Cliente Groq Cloud — MOTOR PRINCIPAL (Alta velocidad y rendimiento)
let _groq: OpenAI | null = null;
function getGroq(): OpenAI | null {
  if (!_groq) {
    const apiKey = process.env.GROQ_API_KEY;
    if (apiKey) {
      _groq = new OpenAI({
        baseURL: process.env.GROQ_API_BASE_URL || "https://api.groq.com/openai/v1",
        apiKey: apiKey,
      });
    }
  }
  return _groq;
}

// Cliente Zoco IA / Ollama — CANAL SECUNDARIO / LOCAL
let _zoco: OpenAI | null = null;
function getZocoOpenAI(): OpenAI {
  if (!_zoco) {
    const zocoUrl = process.env.ZOCOIA_API_URL || "https://zocoia.es";
    const ollamaUrl = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL;
    
    if (zocoUrl && process.env.ZOCOIA_API_KEY) {
      _zoco = new OpenAI({
        baseURL: `${zocoUrl.replace(/\/+$/, "")}/v1`,
        apiKey: process.env.ZOCOIA_API_KEY,
      });
    } else if (ollamaUrl) {
      _zoco = new OpenAI({
        baseURL: `${ollamaUrl.replace(/\/+$/, "")}/v1`,
        apiKey: process.env.OLLAMA_API_KEY || "ollama",
      });
    } else {
      // Fallback a un cliente dummy para evitar errores de inicialización, 
      // pero lanzará error al intentar usarlo si no hay config.
      _zoco = new OpenAI({ baseURL: "http://localhost:11434/v1", apiKey: "dummy" });
    }
  }
  return _zoco;
}

// ─── UTILIDADES DE COMPATIBILIDAD ──────────────────────────────────────────

export const DEEPSEEK_SAFE_FORMAT_RULE =
  "\n\nIMPORTANT: Return the absolute raw code inside the file contents. Do not wrap code blocks in metadata definitions. " +
  "Never output field descriptions, JSON schemas or placeholders instead of the real code — always emit the complete, working file content. " +
  "When asked for JSON, return a single pure JSON object with no markdown fences and no commentary.";

export function stripReasoning(text: string): string {
  if (!text) return "";
  let out = String(text);
  out = out.replace(/<think>[\s\S]*?<\/think>/g, "");
  const openIdx = out.indexOf("<think>");
  if (openIdx !== -1 && out.indexOf("</think>", openIdx) === -1) out = out.slice(0, openIdx);
  const orphanClose = out.indexOf("</think>");
  if (orphanClose !== -1 && out.lastIndexOf("<think>", orphanClose) === -1) out = out.slice(orphanClose + 8);
  return out.trim();
}

function systemToText(system: any): string {
  if (!system) return "";
  const text = typeof system === "string"
    ? system
    : (system as any[]).map((b: any) => b?.text || "").join("\n");
  return text.includes("IMPORTANT: Return the absolute raw code") ? text : text + DEEPSEEK_SAFE_FORMAT_RULE;
}

function zocoMessagesToOpenAI(messages: any[]): any[] {
  const out: any[] = [];
  for (const m of messages || []) {
    if (!m) continue;
    if (typeof m.content === "string" || m.content == null) {
      out.push({ role: m.role, content: String(m.content ?? "") });
      continue;
    }
    const blocks = Array.isArray(m.content) ? m.content : [m.content];
    const texts = blocks
      .filter((b: any) => b?.type === "text" || typeof b === "string")
      .map((b: any) => (typeof b === "string" ? b : b.text || ""))
      .join("");
    
    // Simplificación: Groq/Ollama no siempre manejan bien tool_use complejo en este nivel,
    // se pasan como texto plano o se gestionan en el bucle superior.
    out.push({ role: m.role, content: texts });
  }
  return out;
}

// Mapeo de modelos según el proveedor activo
function resolveModel(requestedModel: string, provider: 'groq' | 'zoco'): string {
  if (provider === 'groq') {
    // Modelos de Groq recomendados
    if (/max|opus|architect|frontend|backend/i.test(requestedModel)) return "llama-3.3-70b-versatile";
    if (/flash|haiku|researcher|qa/i.test(requestedModel)) return "llama-3.1-8b-instant";
    return "llama-3.3-70b-versatile";
  } else {
    // Modelos de Zoco/Ollama
    const m = String(requestedModel || "");
    if (/^zoco-/.test(m)) return m;
    if (/haiku|flash/i.test(m)) return "zoco-flash";
    if (/opus|max/i.test(m)) return "zoco-max";
    return "zoco-plus";
  }
}

// ─── FUNCIÓN PRINCIPAL DE MENSAJERÍA ───────────────────────────────────────

export async function createZocoMessageWithFallback(
  role: string,
  model: string,
  params: any,
  meterOpts?: { jobId?: string },
): Promise<any> {
  const openaiMessages = [
    ...(params.system ? [{ role: "system" as const, content: systemToText(params.system) }] : []),
    ...zocoMessagesToOpenAI(params.messages || []),
  ];

  const groq = getGroq();
  const useGroq = !!groq;
  const primaryClient = useGroq ? groq : getZocoOpenAI();
  const primaryProvider = useGroq ? 'groq' : 'zoco';
  const primaryModel = resolveModel(model, primaryProvider);

  try {
    logger.info({ role, provider: primaryProvider, model: primaryModel }, `Iniciando petición con ${primaryProvider}...`);

    const response = await primaryClient.chat.completions.create({
      model: primaryModel,
      messages: openaiMessages,
      max_tokens: params.max_tokens || 4096,
      temperature: params.temperature ?? 0.7,
      stream: false, // Por ahora no-streaming para compatibilidad simple
    });

    const text = stripReasoning(response.choices[0]?.message?.content || "");
    
    recordApiUsage({
      jobId: meterOpts?.jobId,
      model: primaryModel,
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
      agent: role,
    });

    return {
      content: [{ type: "text", text }],
      usage: response.usage,
    };
  } catch (err: any) {
    logger.error({ role, error: err.message }, `Error con ${primaryProvider}, intentando fallback...`);
    
    // Si falló Groq, intentamos Zoco/Ollama local
    if (useGroq) {
      const fallbackClient = getZocoOpenAI();
      const fallbackModel = resolveModel(model, 'zoco');
      
      const response = await fallbackClient.chat.completions.create({
        model: fallbackModel,
        messages: openaiMessages,
        max_tokens: params.max_tokens || 4096,
        temperature: params.temperature ?? 0.7,
      });

      const text = stripReasoning(response.choices[0]?.message?.content || "");
      return {
        content: [{ type: "text", text }],
        usage: response.usage,
      };
    }
    
    throw err;
  }
}

// ─── TIPOS Y EXPORTACIONES ──────────────────────────────────────────────────

export type AgentRole = "researcher" | "architect" | "designer" | "frontend" | "backend" | "database" | "integrator" | "qa" | "devops" | "patcher" | "repair" | "system" | "memory" | "validator" | "testing" | "fixing" | "patching" | "coder" | "visual-evaluator" | "chat" | "classifier" | "crew" | "rag" | "tools" | "planner" | "data-ops" | "error-analysis" | "image-analysis" | "code-review" | "gating";

export interface QAReport {
  ok: boolean;
  issues: Array<{ file: string; problem: string; fix: string }>;
}

export const AI_CALL_TIMEOUT_MS = 90_000;

export async function raceWithTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout (${label}): sin respuesta tras ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}
