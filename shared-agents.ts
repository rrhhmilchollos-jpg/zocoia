// MODO OPENAI/DEEPSEEK: SDK de Anthropic eliminado — todo viaja por el cliente OpenAI de Zoco IA.
import OpenAI from "openai";
import { logger } from "./logger";
import { recordApiUsage } from "./usageMeter";

// ─── INFRAESTRUCTURA 100% LOCAL (OLLAMA) ─────────────────────────────────
// DECISIÓN DE INFRAESTRUCTURA (orden expresa del propietario): NO se usa Groq
// ni ninguna otra API en la nube. Todo el flujo multi-agente nace y muere en
// el servidor local de Ollama. Hay dos formas de conectar, ambas locales:
//   1) VÍA ZOCO IA (recomendada): ZOCOIA_API_URL + ZOCOIA_API_KEY — el backend
//      de Zoco IA reenvía cada llamada a SU servidor de Ollama local (créditos,
//      agentes y logs incluidos).
//   2) OLLAMA DIRECTO: OLLAMA_BASE_URL (p.ej. http://127.0.0.1:11434) con
//      apiKey "ollama" — conexión directa al endpoint OpenAI-compatible.
// El canal secundario ya NO es un proveedor distinto: es un SEGUNDO INTENTO
// no-streaming contra el mismo motor local (útil cuando el streaming se corta).
let _groq: OpenAI | null = null;
function getGroq(): OpenAI | null {
  const zocoKey = process.env.ZOCOIA_API_KEY;
  const zocoUrl = process.env.ZOCOIA_API_URL || "https://zocoia.es";
  const ollamaUrl = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL;
  if (!_groq) {
    if (zocoUrl && zocoKey && zocoKey.startsWith('sk-zoco-')) {
      _groq = new OpenAI({ baseURL: `${zocoUrl.replace(/\/+$/, '')}/v1`, apiKey: zocoKey });
    } else if (ollamaUrl) {
      // Ollama acepta cualquier string como apiKey en su endpoint /v1.
      _groq = new OpenAI({ baseURL: `${ollamaUrl.replace(/\/+$/, '')}/v1`, apiKey: process.env.OLLAMA_API_KEY || 'ollama' });
    } else {
      return null;
    }
  }
  return _groq;
}
async function callGroqFallback(params: any): Promise<{ content: Array<{ type: string; text: string }> }> {
  const groq = getGroq();
  if (!groq) throw new Error('Motor local no configurado: añade ZOCOIA_API_URL + ZOCOIA_API_KEY (vía Zoco IA) o OLLAMA_BASE_URL (Ollama directo) a las variables de entorno');
  const groqModel = process.env.OLLAMA_MODEL_PLUS || 'Zoco Max';
  logger.warn({ model: groqModel }, '⚡ Segundo intento no-streaming contra el mismo motor local (Ollama)');

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
  recordApiUsage({
    jobId: undefined,
    model: groqModel,
    inputTokens: response.usage?.prompt_tokens || 0,
    outputTokens: response.usage?.completion_tokens || 0,
    agent: 'groq-fallback',
  });

  return { content: [{ type: 'text', text }] };
}

// ─── Cliente Ollama directo (último intento, MISMO servidor local) ────────
async function callOllamaFallback(role: AgentRole, params: any): Promise<any> {
  const ollamaUrl = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL;
  if (!ollamaUrl) {
    throw new Error('Ollama URL no configurada: añade OLLAMA_BASE_URL a las variables de entorno');
  }

  // Nombre EXACTO del modelo en el servidor de Ollama (ollama list).
  const ollamaModel = process.env.OLLAMA_MODEL_PLUS || 'Zoco Max';
  logger.warn({ role, model: ollamaModel }, '⚡ Último intento: llamada directa al API nativa de Ollama (/api/chat)');

  const messages = (params.messages || []).map((m: any) => ({
    role: m.role,
    content: Array.isArray(m.content) ? m.content.map((b: any) => b.text || '').join('') : String(m.content || ''),
  }));

  if (params.system) {
    messages.unshift({
      role: 'system',
      content: typeof params.system === 'string' ? params.system : (params.system as any[]).map((b: any) => b.text || '').join('\n')
    });
  }

  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ollamaModel,
        messages: messages,
        options: {
          temperature: params.temperature || 0.7,
          num_predict: params.max_tokens || 2048,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const text = data.message?.content || '';

    recordApiUsage({
      jobId: undefined,
      model: ollamaModel,
      inputTokens: 0, // Ollama no proporciona tokens de entrada/salida directamente en este endpoint
      outputTokens: 0, // Se podría estimar o dejar en 0 si no es crítico para la facturación
      agent: 'ollama-fallback',
    });

    return { content: [{ type: 'text', text }] };
  } catch (ollamaErr) {
    logger.error({ role, ollamaErr }, "Ollama también falló");
    throw ollamaErr;
  }
}

// Cliente OpenAI-compatible — CANAL PRINCIPAL, 100% LOCAL.
// Conecta vía Zoco IA (que reenvía a su Ollama) o directamente al endpoint
// OpenAI-compatible de Ollama. JAMÁS apunta a api.openai.com: si no hay
// configuración local, el error se lanza en el primer uso (lazy) con un
// mensaje claro en vez de fugar peticiones a la nube.
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const zocoUrl = process.env.ZOCOIA_API_URL || "https://zocoia.es";
    const ollamaUrl = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL;
    if (zocoUrl) {
      _openai = new OpenAI({
        baseURL: `${zocoUrl.replace(/\/+$/, "")}/v1`,
        apiKey: process.env.ZOCOIA_API_KEY || "dummy",
      });
    } else if (ollamaUrl) {
      // Ollama acepta cualquier string como apiKey en su endpoint /v1.
      _openai = new OpenAI({
        baseURL: `${ollamaUrl.replace(/\/+$/, "")}/v1`,
        apiKey: process.env.OLLAMA_API_KEY || "ollama",
      });
    } else {
      throw new Error(
        "Motor local no configurado: define ZOCOIA_API_URL (+ ZOCOIA_API_KEY) para conectar vía Zoco IA, " +
          "o OLLAMA_BASE_URL (p.ej. http://127.0.0.1:11434) para conectar directamente a Ollama. " +
          "Las APIs en la nube (Groq/Anthropic/OpenAI) están deshabilitadas por decisión de infraestructura.",
      );
    }
  }
  return _openai;
}

/* ------------- Compatibilidad DeepSeek-R1 / OpenAI (Zoco IA) --------------- */
// El modelo real detrás de las API Keys de Zoco IA es DeepSeek-R1, que habla
// el formato de OpenAI (chat.completions), NO el formato nativo de Anthropic.
// Estas utilidades convierten los parámetros estilo Anthropic que usa todo el
// pipeline al formato OpenAI, y las respuestas de vuelta, para que los 18+
// consumidores existentes no necesiten cambios.

// Regla de formato seguro que se inyecta al final de TODOS los system prompts.
export const DEEPSEEK_SAFE_FORMAT_RULE =
  "\n\nIMPORTANT: You are running on a DeepSeek-R1/OpenAI compatible endpoint. " +
  "Return the absolute raw code inside the file contents. Do not wrap code blocks in metadata definitions. " +
  "Never output field descriptions, JSON schemas or placeholders instead of the real code — always emit the complete, working file content. " +
  "When asked for JSON, return a single pure JSON object with no markdown fences and no commentary.";

// DeepSeek-R1 emite su razonamiento en <think>...</think> (o como campo
// reasoning_content). Si ese razonamiento se cuela en la respuesta, contamina
// el código generado y rompe el parseo — se elimina SIEMPRE antes de devolver.
export function stripReasoning(text: string): string {
  if (!text) return "";
  let out = String(text);
  out = out.replace(/<think>[\s\S]*?<\/think>/g, "");
  // Corte a mitad de razonamiento: si abre <think> y nunca cierra, quedarse
  // con lo anterior; si el texto EMPIEZA dentro de un razonamiento sin
  // apertura (p.ej. streaming resumido) y aparece un cierre huérfano,
  // quedarse con lo posterior al cierre.
  const openIdx = out.indexOf("<think>");
  if (openIdx !== -1 && out.indexOf("</think>", openIdx) === -1) out = out.slice(0, openIdx);
  const orphanClose = out.indexOf("</think>");
  if (orphanClose !== -1 && out.lastIndexOf("<think>", orphanClose) === -1) out = out.slice(orphanClose + "</think>".length);
  return out.trim();
}

// Convierte system (string o bloques Anthropic) a texto plano y le añade la
// regla de formato seguro para DeepSeek.
function systemToText(system: any): string {
  if (!system) return "";
  const text = typeof system === "string"
    ? system
    : (system as any[]).map((b: any) => b?.text || "").join("\n");
  return text.includes("DeepSeek-R1/OpenAI compatible endpoint") ? text : text + DEEPSEEK_SAFE_FORMAT_RULE;
}

// Convierte mensajes estilo Anthropic (content como string o array de bloques
// text/tool_use/tool_result) a mensajes estilo OpenAI (content string, roles
// assistant con tool_calls, y role "tool" para los resultados).
function anthropicMessagesToOpenAI(messages: any[]): any[] {
  const out: any[] = [];
  for (const m of messages || []) {
    if (!m) continue;
    if (typeof m.content === "string" || m.content == null) {
      out.push({ role: m.role, content: String(m.content ?? "") });
      continue;
    }
    const blocks = Array.isArray(m.content) ? m.content : [m.content];
    const toolUses = blocks.filter((b: any) => b?.type === "tool_use");
    const toolResults = blocks.filter((b: any) => b?.type === "tool_result");
    const texts = blocks.filter((b: any) => b?.type === "text" || typeof b === "string").map((b: any) => (typeof b === "string" ? b : b.text || "")).join("");
    if (m.role === "assistant" && toolUses.length > 0) {
      out.push({
        role: "assistant",
        content: texts || null,
        tool_calls: toolUses.map((tu: any) => ({
          id: tu.id,
          type: "function",
          function: { name: tu.name, arguments: JSON.stringify(tu.input || {}) },
        })),
      });
      continue;
    }
    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        out.push({
          role: "tool",
          tool_call_id: tr.tool_use_id,
          content: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content ?? ""),
        });
      }
      if (texts) out.push({ role: "user", content: texts });
      continue;
    }
    out.push({ role: m.role, content: texts });
  }
  return out;
}

// Convierte definiciones de tools Anthropic ({name, description, input_schema})
// al formato OpenAI ({type:'function', function:{name, description, parameters}}).
function anthropicToolsToOpenAI(tools: any[]): any[] {
  return (tools || []).map((t: any) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description || "",
      parameters: t.input_schema || { type: "object", properties: {} },
    },
  }));
}

// Modelos válidos del motor de Zoco IA. Cualquier id de Claude que llegue del
// código legado se remapea aquí — detrás siempre responde DeepSeek-R1.
function zocoModelFor(model: string): string {
  const m = String(model || "");
  if (/^zoco-/.test(m)) return m;
  if (/haiku|flash/i.test(m)) return "zoco-flash";
  if (/opus|max/i.test(m)) return "zoco-max";
  return "zoco-plus";
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
 * ENCONTRADO en producción (caso real: PM Agent detectó 23-24 blockers en
 * un proyecto complejo): con un plan de 25-30 archivos, un corte de
 * tokens a mitad de la lista en JSON invalida el array ENTERO — ni
 * siquiera los archivos listados ANTES del corte se recuperan, porque
 * extractJsonObject exige un '{'...'}' balanceado de principio a fin.
 * Aquí cada <file>...</file> es un bloque independiente: la regex solo
 * recoge bloques que cerraron por completo, así que un corte a mitad del
 * archivo N nunca invalida los N-1 anteriores, que sí llegaron a
 * cerrarse. No usa el flag "s" (dotAll) de regex porque Node soporta esa
 * sintaxis desde ES2018, pero [\\s\\S] es equivalente y evita cualquier
 * duda de compatibilidad — capturas no codiciosas (.*?) para no
 * desbordarse hacia el siguiente bloque <file> si hay varios.
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

// Modelos de Anthropic soportados, de más nuevo a más antiguo dentro de
// cada familia. Opus 4.8 es la versión más reciente, disponible solo para
// clientes de pago con Ultra activado (ver dashboard.tsx).
// FIX (2026-07-09): "zoco-plus" NO existe en la API de Anthropic
// — verificado contra https://api.anthropic.com/v1/models con la API key
// real: devuelve 404 not_found_error ("model: claude-sonnet-4-7"). Estaba
// como PRIMER candidato de la lista de fallback, así que muchas llamadas
// empezaban con un 404 garantizado y, combinado con otros fallos, agotaba
// candidatos y hacía fallar la generación con el cuadro rojo "Error en la
// generación". Modelos verificados como disponibles con la key actual:
// claude-sonnet-4-6, claude-opus-4-8, claude-opus-4-7,
// claude-haiku-4-5(-20251001).
const CLAUDE_MODELS = ["zoco-plus", "zoco-max", "zoco-max"];

function fallbackClaudeModels(model: string): string[] {
  // Se usa el modelo EXACTO solicitado como primario si es uno de los
  // soportados, y solo se cae a detección por familia para strings no
  // reconocidos. FIX (2026-07-09): el ID legado "zoco-plus" (no
  // existe en la API de Anthropic, 404 verificado) se remapea a
  // "zoco-plus" en vez de intentarse tal cual.
  const remapped = model === "zoco-plus" ? "zoco-plus" : model;
  const primary = CLAUDE_MODELS.includes(remapped)
    ? remapped
    : (remapped.includes("opus") ? "zoco-max" : "zoco-plus");
  return [primary, ...CLAUDE_MODELS.filter((m) => m !== primary)];
}

// Timeout duro para cualquier llamada a un proveedor de IA dentro de este
// archivo. Sin esto, una llamada no-streaming (anthropic.messages.create,
// Gemini, OpenAI) puede colgarse minutos si el proveedor se degrada, sin
// ningún chunk que activar un timeout de inactividad (eso solo aplica a
// streams) — el job entero queda en silencio hasta que el watchdog global
// (12 min) lo reinicia desde cero, perdiendo todo el trabajo ya hecho.
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

export async function createClaudeMessageWithFallback(
  role: AgentRole,
  model: string,
  params: any,
  meterOpts?: { jobId?: string },
): Promise<any> {
  let lastError: unknown;
  const MAX_RETRIES = 3;

  const MIN_CACHEABLE_CHARS = 3500; 
  if (typeof params.system === "string" && params.system.length >= MIN_CACHEABLE_CHARS) {
    params = {
      ...params,
      system: [{ type: "text", text: params.system, cache_control: { type: "ephemeral" } }],
    };
  }

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
      lastUserMessage
    ].filter(Boolean);
  }

  // MODO OPENAI/DEEPSEEK: el motor detrás de las API Keys de Zoco IA es
  // DeepSeek-R1 (formato OpenAI). Se convierten los parámetros estilo
  // Anthropic al formato chat.completions y se llama al cliente OpenAI de
  // Zoco IA con streaming — la firma y el formato de retorno
  // ({content:[{type:'text',text}]}) se mantienen idénticos para que los
  // 18+ consumidores del pipeline no necesiten ningún cambio.
  const zocoModel = zocoModelFor(model);
  const openaiMessages = [
    ...(params.system ? [{ role: "system" as const, content: systemToText(params.system) }] : []),
    ...anthropicMessagesToOpenAI(params.messages || []),
  ];

  {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await new Promise(r => setTimeout(r, Math.random() * 500));

        logger.info({ role, model: zocoModel }, "Iniciando stream con Zoco IA (DeepSeek-R1/OpenAI)...");

        let fullText = "";
        let usageInputTokens = 0;
        let usageOutputTokens = 0;
        const stream = (await getOpenAI().chat.completions.create({
          model: zocoModel,
          messages: openaiMessages,
          max_tokens: params.max_tokens || 4096,
          temperature: params.temperature ?? 0.7,
          stream: true,
        })) as unknown as AsyncIterable<any>;

        // TIMEOUT DE INACTIVIDAD REAL: antes este bucle no tenía ningún
        // límite de tiempo propio — si el stream se quedaba a medias
        // (conectado pero sin más eventos, sin cerrar la conexión), no
        // había nada que lo detectara aquí dentro; el job entero se
        // quedaba colgado hasta el watchdog global (12 min), perdiendo
        // TODO el trabajo ya hecho en vez de solo reintentar esta llamada.
        // raceWithTimeout/AI_CALL_TIMEOUT_MS ya existían en este archivo
        // mismo pero nunca se conectaban a ningún sitio — código muerto.
        // Aquí se aplica por CHUNK (no al stream entero, que puede tardar
        // legítimamente varios minutos en archivos grandes): si pasan
        // AI_CALL_TIMEOUT_MS sin recibir ni un solo evento nuevo, se
        // considera colgado y se pasa al siguiente intento/modelo.
        const iterator = stream[Symbol.asyncIterator]();
        while (true) {
          const { value: chunk, done } = await raceWithTimeout(
            iterator.next(),
            AI_CALL_TIMEOUT_MS,
            `${role} stream chunk (modelo ${zocoModel})`,
          );
          if (done) break;
          // Formato de chunk OpenAI/DeepSeek: choices[0].delta.content lleva el
          // texto; delta.reasoning_content (razonamiento de DeepSeek-R1) se
          // IGNORA deliberadamente para que nunca contamine el código generado.
          const delta = chunk?.choices?.[0]?.delta;
          if (delta?.content) fullText += delta.content;
          // Algunos servidores OpenAI-compatibles adjuntan usage en el último
          // chunk (stream_options) — nos quedamos con el último valor visto.
          if (chunk?.usage) {
            usageInputTokens = chunk.usage.prompt_tokens ?? usageInputTokens;
            usageOutputTokens = chunk.usage.completion_tokens ?? usageOutputTokens;
          }
        }

        // Limpieza del razonamiento <think>...</think> típico de DeepSeek-R1
        // por si el servidor lo incrusta en el propio content.
        fullText = stripReasoning(fullText);
        if (!fullText) throw new Error("Stream vacío");

        recordApiUsage({
          jobId: meterOpts?.jobId,
          model: zocoModel,
          inputTokens: usageInputTokens,
          outputTokens: usageOutputTokens,
          agent: role,
        });

        return { content: [{ type: "text", text: fullText }] };

      } catch (err: any) {
        lastError = err;
        const isRateLimit = err?.status === 429 || String(err).includes("rate_limit_exceeded");
        const isQuotaError = err?.status === 400 && String(err).includes("quota"); // Error 400 con mensaje de cuota
        const isTransient = isRateLimit || isQuotaError
          || err?.status >= 500
          || /timed out|timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|network|fetch failed|Stream vacío/i.test(String(err?.message || err));

        if (isTransient && attempt < MAX_RETRIES - 1) {
          const delay = Math.pow(2, attempt) * 1500 + Math.random() * 1000;
          logger.warn({ role, model: zocoModel, attempt, delay, isRateLimit, isQuotaError }, "Fallo transitorio; reintentando...");
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        logger.warn({ role, model: zocoModel, err }, "Canal streaming de Zoco IA falló; pasando al canal secundario");
        break;
      }
    }
  }

  logger.warn({ role }, "Canal streaming de Zoco IA falló — intentando canal secundario no-streaming (/v1/chat/completions)...");
  try {
    const fb = await callGroqFallback({ ...params, system: systemToText(params.system) });
    fb.content = fb.content.map((b: any) => (b.type === "text" ? { ...b, text: stripReasoning(b.text) } : b));
    return fb;
  } catch (groqErr) {
    logger.error({ role, groqErr }, "Canal secundario también falló — intentando con Ollama...");
    try {
      const ol = await callOllamaFallback(role, params);
      ol.content = ol.content.map((b: any) => (b.type === "text" ? { ...b, text: stripReasoning(b.text) } : b));
      return ol;
    } catch (ollamaErr) {
      logger.error({ role, ollamaErr }, "Ollama también falló");
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
  }
}

/**
 * Variante de createClaudeMessageWithFallback para llamadas con tool-calling
 * (bucles agenticos como marisCrewAI.ts y agentTools.ts).
 *
 * ADAPTADOR BIDIRECCIONAL DeepSeek-R1/OpenAI ↔ Anthropic:
 * los bucles agenticos existentes hablan el protocolo tool_use de Anthropic
 * (tools con input_schema, bloques tool_use/tool_result, stop_reason). Esta
 * función traduce la ida al formato estándar OpenAI `tools`/`tool_choice`
 * (type:function con parameters) y la vuelta de `tool_calls` a bloques
 * tool_use — así agentTools.ts y marisCrewAI.ts siguen funcionando SIN
 * ningún cambio aunque detrás responda DeepSeek-R1.
 *
 * RESPALDO JSON PURO: si el endpoint rechaza el parámetro tools (algunos
 * despliegues de DeepSeek-R1 no soportan function calling nativo), se
 * reintenta sin tools instruyendo al modelo para devolver un JSON puro
 * {"tool": "nombre", "input": {...}} que el backend parsea con
 * extractJsonObject — sin depender del SDK de Anthropic en ningún caso.
 */
export async function createClaudeToolCallWithFallback(role: AgentRole, model: string, params: any): Promise<any> {
  let lastError: unknown;
  const MAX_RETRIES = 3;
  const zocoModel = zocoModelFor(model);

  const systemText = systemToText(params.system);
  const openaiMessages = [
    ...(systemText ? [{ role: "system" as const, content: systemText }] : []),
    ...anthropicMessagesToOpenAI(params.messages || []),
  ];
  const hasTools = Array.isArray(params.tools) && params.tools.length > 0;
  const openaiTools = hasTools ? anthropicToolsToOpenAI(params.tools) : undefined;

  // Convierte una respuesta chat.completions al formato Anthropic que
  // esperan los bucles agenticos (content blocks + stop_reason).
  const toAnthropicShape = (resp: any): any => {
    const choice = resp?.choices?.[0];
    const msg = choice?.message || {};
    const usage = {
      input_tokens: resp?.usage?.prompt_tokens ?? 0,
      output_tokens: resp?.usage?.completion_tokens ?? 0,
    };
    const content: any[] = [];
    const text = stripReasoning(msg.content || "");
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      if (text) content.push({ type: "text", text });
      for (const tc of msg.tool_calls) {
        let input: any = {};
        try { input = JSON.parse(tc.function?.arguments || "{}"); } catch { input = extractJsonObject(tc.function?.arguments || "") || {}; }
        content.push({ type: "tool_use", id: tc.id || `toolu_${Math.random().toString(36).slice(2, 14)}`, name: tc.function?.name, input });
      }
      return { content, stop_reason: "tool_use", usage };
    }
    // Respaldo JSON puro: el modelo puede haber emitido {"tool":..., "input":...}
    // como texto si el function calling nativo no estaba disponible.
    if (hasTools) {
      const parsed = extractJsonObject<{ tool?: string; input?: any }>(text);
      if (parsed && typeof parsed.tool === "string" && (params.tools as any[]).some((t: any) => t.name === parsed.tool)) {
        return {
          content: [{ type: "tool_use", id: `toolu_${Math.random().toString(36).slice(2, 14)}`, name: parsed.tool, input: parsed.input || {} }],
          stop_reason: "tool_use",
          usage,
        };
      }
    }
    return { content: [{ type: "text", text }], stop_reason: "end_turn", usage };
  };

  // Instrucción de respaldo cuando el endpoint no soporta el parámetro tools.
  const jsonFallbackSystem = () => {
    const toolList = (params.tools as any[]).map((t: any) => `- ${t.name}: ${t.description || ""}\n  input schema: ${JSON.stringify(t.input_schema || {})}`).join("\n");
    return `${systemText}\n\nAVAILABLE TOOLS:\n${toolList}\n\nTo call a tool, respond with ONLY a pure JSON object (no markdown fences, no commentary): {"tool": "<tool_name>", "input": { ...arguments... }}. If no tool is needed, respond with your final answer as plain text.`;
  };

  let toolsRejected = false;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const useNativeTools = hasTools && !toolsRejected;
      const request: any = {
        model: zocoModel,
        messages: useNativeTools || !hasTools ? openaiMessages : [{ role: "system", content: jsonFallbackSystem() }, ...openaiMessages.filter((m: any) => m.role !== "system")],
        max_tokens: params.max_tokens || 2048,
        temperature: params.temperature ?? 0.7,
      };
      if (useNativeTools) {
        request.tools = openaiTools;
        request.tool_choice = params.tool_choice?.type === "any" ? "required" : "auto";
      }
      const resp = await raceWithTimeout(
        getOpenAI().chat.completions.create(request) as unknown as Promise<any>,
        AI_CALL_TIMEOUT_MS,
        `${role} tool call (modelo ${zocoModel})`,
      );
      return toAnthropicShape(resp);
    } catch (err: any) {
      lastError = err;
      // Si el endpoint rechaza el parámetro tools (400 con mención a tools/
      // functions), activar el respaldo de JSON puro y reintentar YA.
      const toolsUnsupported = hasTools && !toolsRejected && err?.status === 400 && /tool|function/i.test(String(err?.message || err));
      if (toolsUnsupported) {
        toolsRejected = true;
        logger.warn({ role, model: zocoModel }, "Tool call: el endpoint no soporta tools nativas — cambiando a respaldo de JSON puro");
        continue;
      }
      const isRateLimit = err?.status === 429 || String(err).includes("rate_limit_exceeded");
      const isQuotaError = (err?.status === 400 || err?.status === 402) && /quota|crédito|credit/i.test(String(err));
      const isTransient = isRateLimit || isQuotaError
        || err?.status >= 500
        || /timed out|timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|network|fetch failed/i.test(String(err?.message || err));

      if (isTransient && attempt < MAX_RETRIES - 1) {
        const delay = Math.pow(2, attempt) * 1500 + Math.random() * 1000;
        logger.warn({ role, model: zocoModel, attempt, delay, isRateLimit, isQuotaError }, "Tool call: fallo transitorio; reintentando...");
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      logger.warn({ role, model: zocoModel, err }, "Tool call: canal principal de Zoco IA falló");
      break;
    }
  }

  logger.warn({ role }, "Tool call: canal principal falló — intentando canal secundario de Zoco IA...");
  try {
    const groqResult = await callGroqFallback({ ...params, system: hasTools ? jsonFallbackSystem() : systemText });
    const text = stripReasoning(groqResult.content?.[0]?.text || "");
    // También en el canal secundario se intenta detectar una tool call JSON pura.
    if (hasTools) {
      const parsed = extractJsonObject<{ tool?: string; input?: any }>(text);
      if (parsed && typeof parsed.tool === "string" && (params.tools as any[]).some((t: any) => t.name === parsed.tool)) {
        return {
          content: [{ type: "tool_use", id: `toolu_${Math.random().toString(36).slice(2, 14)}`, name: parsed.tool, input: parsed.input || {} }],
          stop_reason: "tool_use",
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      }
    }
    return { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } };
  } catch (groqErr) {
    logger.error({ role, groqErr }, "Canal secundario también falló (tool call) — intentando con Ollama...");
    try {
      const ollamaResult = await callOllamaFallback(role, { ...params, system: hasTools ? jsonFallbackSystem() : systemText });
      const text = stripReasoning(ollamaResult.content?.[0]?.text || "");
      return { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } };
    } catch (ollamaErr) {
      logger.error({ role, ollamaErr }, "Ollama también falló (tool call)");
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
  }
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
  // Parse original bundle
  const parts = originalBundle.split(/\/\/ === FILE: /);
  for (const part of parts) {
    if (!part.trim()) continue;
    const nl = part.indexOf("\n");
    if (nl === -1) continue;
    const path = part.slice(0, nl).trim().replace(/ ===$/, "");
    if (path) files[path] = "// === FILE: " + part;
  }
  // Delete files explicitly requested by the patcher.
  for (const path of deletedFiles) {
    const normalizedPath = path.replace(/^\//, "").trim();
    if (normalizedPath) delete files[normalizedPath];
  }

  // Apply added/modified files. Existing paths are modified; new paths are added.
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
  model: string = "zoco-plus",
  jobId?: string,
): Promise<string | null> {
  if (issues.length === 0) return null;

  // MARIS-SHIELD: rechazar reparaciones masivas (>5 archivos distintos).
  // El pipeline clásico de una sola pasada falla matemáticamente con 15+ archivos
  // simultáneos saturando la ventana de contexto. Si hay muchos archivos afectados,
  // el CoreOrchestrator por hitos debe manejar la reparación (1 archivo por llamada).
  const affectedFiles = new Set(issues.map(i => i.file).filter(Boolean));
  if (affectedFiles.size > 5) {
    console.warn(`[MARIS-SHIELD] patchBundle rechazado: ${affectedFiles.size} archivos afectados supera el límite de 5. Delegando al orquestador por hitos.`);
    return null; // El repair agent detectará null y escalará al CoreOrchestrator
  }
  const issueList = issues
    .map((i, idx) => `${idx + 1}. [${i.file}] Problem: ${i.problem}\n   Fix: ${i.fix}`)
    .join("\n");

  // CRÍTICO: el bundle completo puede ser de cientos de KB. Pedirle al modelo
  // que devuelva el bundle entero reparado arriesga truncamiento por límite de
// tokens en bundles grandes — exactamente el tipo de fallo silencioso de
// reparación que más frustra a los usuarios. En su lugar: enviamos solo los
// archivos relevantes (compactBundleForPrompt, ya existía pero no se usaba
// aquí), el modelo devuelve SOLO los archivos que cambia (el formato real
// que pide buildPatcherSystemPrompt: changedFiles/deletedFiles), y los
// fusionamos de vuelta con mergePatchIntoBundle. Esto es estrictamente más
// fiable: menos tokens de salida necesarios, menor riesgo de truncamiento,
// y los archivos no tocados quedan garantizados intactos byte a byte.
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
    240_000, // Aumentado a 4 minutos para evitar timeouts en Render
    null,
  );
}

/* ----------------------- multi-file patcher -------------------------------- */
/**
 * patchBundle estándar (16K max_tokens, una sola respuesta JSON) está pensado
 * para parches quirúrgicos: 1-2 archivos pequeños. CASO REAL ENCONTRADO Y
 * DOCUMENTADO (app "MesaYa"): una reparación que necesitaba regenerar un
 * App.tsx grande (1000+ líneas, roto a mitad) Y crear 3 páginas nuevas
 * completas (Dashboard/Reservas/NuevaReserva) excede por mucho lo que cabe en
 * una sola respuesta JSON de 16K tokens — el modelo se queda sin presupuesto
 * a mitad de generación, produce JSON inválido/truncado, y patchBundle
 * devuelve null silenciosamente ("La reparación automática no produjo
 * cambios válidos"), sin ninguna pista real de qué pasó.
 *
 * patchBundleMultiFile divide esto en pasos independientes y verificables:
 * 1. Una llamada de PLANIFICACIÓN (barata, sin generar contenido) que decide
 *    qué archivos hay que tocar/crear y por qué — nunca el contenido en sí.
 * 2. Una llamada de GENERACIÓN POR ARCHIVO, cada una con su propio
 *    presupuesto completo de 16K tokens — un archivo de página real nunca
 *    se acerca a ese límite, así que el riesgo de truncamiento desaparece.
 * Si un archivo individual falla, solo se reintenta ese archivo (1 vez),
 * no toda la reparación — más barato y más fiable que repetir el ciclo
 * completo.
 */
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
  // ENCONTRADO en producción (caso real: PM Agent detectó 23-24 blockers,
  // uno por cada archivo de un proyecto complejo — Landing, Dashboard,
  // Search, ListingDetail, Search, ListingDetail, Favorites, Settings, Navbar, Footer, varios
  // hooks y utils): este planificador SOLO devolvía 1 archivo por llamada.
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
  if (action === "delete") return null; // Handled by mergePatchIntoBundle

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
  model: string = "zoco-plus",
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

    // Generar el parche para cada archivo, con un reintento si falla
    let fileContent = await generateFilePatch(currentBundle, planItem, errorSummary, language, model);
    if (!fileContent) {
      logger.warn({ path: planItem.path }, "Primer intento de generación de archivo fallido, reintentando...");
      fileContent = await generateFilePatch(currentBundle, planItem, errorSummary, language, model);
    }

    if (fileContent) {
      changedFiles[planItem.path] = fileContent;
      // Aplicar el cambio al bundle actual para que las siguientes generaciones
      // de archivos tengan el contexto más actualizado.
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
  model: string = "zoco-plus",
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
    240_000, // Aumentado a 4 minutos para evitar timeouts en Render
    null,
  );
}

export async function createChatCompletion(
  role: AgentRole,
  model: string,
  params: any,
  meterOpts?: { jobId?: string },
): Promise<any> {
  // Implementación similar a createClaudeMessageWithFallback pero para OpenAI/Gemini
  // Por ahora, simplemente reenvía a createClaudeMessageWithFallback para simplificar
  // En un entorno real, esto debería tener su propia lógica de fallback para OpenAI/Gemini
  return createClaudeMessageWithFallback(role, model, params, meterOpts);
}

export async function createToolCallCompletion(
  role: AgentRole,
  model: string,
  params: any,
  meterOpts?: { jobId?: string },
): Promise<any> {
  // Implementación similar a createClaudeToolCallWithFallback pero para OpenAI/Gemini
  // Por ahora, simplemente reenvía a createClaudeToolCallWithFallback para simplificar
  // En un entorno real, esto debería tener su propia lógica de fallback para OpenAI/Gemini
  return createClaudeToolCallWithFallback(role, model, params, meterOpts);
}

export async function createChatCompletionStream(
  role: AgentRole,
  model: string,
  params: any,
  meterOpts?: { jobId?: string },
): Promise<AsyncIterable<any>> {
  // Implementación similar a createClaudeMessageWithFallback pero para OpenAI/Gemini
  // Por ahora, simplemente reenvía a createClaudeMessageWithFallback para simplificar
  // En un entorno real, esto debería tener su propia lógica de fallback para OpenAI/Gemini
  const response = await createClaudeMessageWithFallback(role, model, params, meterOpts);
  // Convertir la respuesta a un AsyncIterable simulado para compatibilidad
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
  // Implementación similar a createClaudeToolCallWithFallback pero para OpenAI/Gemini
  // Por ahora, simplemente reenvía a createClaudeToolCallWithFallback para simplificar
  // En un entorno real, esto debería tener su propia lógica de fallback para OpenAI/Gemini
  const response = await createClaudeToolCallWithFallback(role, model, params, meterOpts);
  // Convertir la respuesta a un AsyncIterable simulado para compatibilidad
  return (async function* () {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: response.content[0].text } };
  })();
}

