/**
 * zoco-computer.js — El Ordenador de Zoco
 * Agente autónomo estilo Manus.im
 *
 * Usa Claude de Anthropic como motor de razonamiento con tool-calling nativo.
 * Emite eventos SSE en tiempo real al panel derecho (terminal, editor, navegador).
 * Ejecuta comandos reales en un sandbox seguro dentro del propio contenedor.
 *
 * Herramientas disponibles (igual que Manus):
 *   - bash        → ejecutar comandos de terminal
 *   - read_file   → leer un archivo
 *   - write_file  → escribir/crear un archivo
 *   - browser     → abrir una URL y obtener el contenido
 *   - finish      → finalizar la tarea con un resumen
 */

import Anthropic from "@anthropic-ai/sdk";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";

const execAsync = promisify(exec);

// ─── Configuración ────────────────────────────────────────────────────────────

const ANTHROPIC_MODEL = process.env.ANTHROPIC_COMPUTER_MODEL || "claude-sonnet-4-6";
const MAX_ITERATIONS = parseInt(process.env.COMPUTER_MAX_ITERATIONS || "30", 10);
const TOOL_TIMEOUT_MS = parseInt(process.env.COMPUTER_TOOL_TIMEOUT_MS || "30000", 10);
const SANDBOX_DIR = process.env.COMPUTER_SANDBOX_DIR || "/tmp/zoco-sandbox";
const MAX_OUTPUT_CHARS = 8000;

// ─── Cliente Anthropic ────────────────────────────────────────────────────────

let _anthropic = null;
function getAnthropic() {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY no configurada.");
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

// ─── Herramientas (tool-calling nativo de Anthropic) ─────────────────────────

const TOOLS = [
  {
    name: "bash",
    description: "Ejecuta un comando de bash en el sandbox seguro. Úsalo para leer directorios, instalar paquetes, ejecutar scripts, hacer git, curl, etc. El directorio de trabajo por defecto es el sandbox.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "El comando bash a ejecutar. Puede ser multi-línea usando &&, pipes, etc.",
        },
        timeout_ms: {
          type: "number",
          description: "Timeout en milisegundos (opcional, máx 60000).",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Lee el contenido completo de un archivo. Úsalo para leer código, configuraciones, logs, etc.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Ruta absoluta o relativa al sandbox del archivo a leer.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Escribe o sobreescribe un archivo con el contenido especificado. Crea directorios intermedios si no existen.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Ruta del archivo a escribir (relativa al sandbox o absoluta).",
        },
        content: {
          type: "string",
          description: "Contenido completo a escribir en el archivo.",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "browser",
    description: "Obtiene el contenido de una URL (texto plano, sin JavaScript). Úsalo para buscar documentación, APIs, páginas web, etc.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL completa a visitar (debe empezar por http:// o https://).",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "finish",
    description: "Finaliza la tarea con un resumen de lo que se hizo y el resultado final. SIEMPRE usa esta herramienta al terminar.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Resumen completo de lo que se hizo, en español, con el resultado final de la tarea.",
        },
        result: {
          type: "string",
          description: "El resultado o artefacto principal generado (código, informe, respuesta, etc.).",
        },
      },
      required: ["summary", "result"],
    },
  },
];

// ─── Prompt del sistema ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres el Ordenador de Zoco, un agente de IA autónomo estilo Manus.im. Eres capaz de realizar cualquier tarea usando herramientas reales: ejecutar comandos de terminal, leer y escribir archivos, navegar por internet, y mucho más.

COMPORTAMIENTO:
- Trabaja de forma autónoma, paso a paso, hasta completar la tarea.
- Usa las herramientas de forma secuencial y razonada.
- Después de cada herramienta, analiza el resultado y decide el siguiente paso.
- Si algo falla, adapta tu estrategia y prueba alternativas.
- Siempre finaliza con la herramienta "finish" cuando la tarea esté completa.

REGLAS:
- Responde SIEMPRE en español.
- Nunca ejecutes comandos destructivos (rm -rf /, format, etc.) sin confirmación explícita.
- El directorio de trabajo es ${SANDBOX_DIR} — trabaja dentro de él.
- Si necesitas clonar repos, instalar paquetes o crear archivos, hazlo en el sandbox.
- Para tareas de investigación, usa la herramienta browser para buscar información real.
- Muestra tu razonamiento antes de usar cada herramienta.

FORMATO DE RESPUESTA:
- Antes de usar una herramienta, explica brevemente QUÉ vas a hacer y POR QUÉ.
- Después de recibir el resultado de una herramienta, analiza lo que encontraste.
- Sé conciso pero informativo en tus explicaciones.`;

// ─── Ejecutores de herramientas ───────────────────────────────────────────────

async function executeBash(command, timeoutMs = TOOL_TIMEOUT_MS) {
  // Asegura que el sandbox existe
  fs.mkdirSync(SANDBOX_DIR, { recursive: true });

  const timeout = Math.min(timeoutMs || TOOL_TIMEOUT_MS, 60000);

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: SANDBOX_DIR,
      timeout,
      maxBuffer: 1024 * 1024 * 5, // 5MB
      shell: "/bin/bash",
    });

    let output = "";
    if (stdout) output += stdout;
    if (stderr) output += stderr ? `\n[stderr]: ${stderr}` : "";
    if (!output.trim()) output = "(sin salida)";

    // Truncar si es muy largo
    if (output.length > MAX_OUTPUT_CHARS) {
      output = output.slice(0, MAX_OUTPUT_CHARS) + `\n...[salida truncada, ${output.length} chars totales]`;
    }

    return { success: true, output };
  } catch (err) {
    const errMsg = err.killed
      ? `Timeout (${timeout}ms): el comando tardó demasiado.`
      : err.stderr || err.message || String(err);
    return { success: false, output: `Error: ${errMsg}` };
  }
}

async function executeReadFile(filePath) {
  try {
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(SANDBOX_DIR, filePath);

    if (!fs.existsSync(resolvedPath)) {
      return { success: false, output: `Archivo no encontrado: ${resolvedPath}` };
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.size > 1024 * 1024) {
      return { success: false, output: `Archivo demasiado grande (${Math.round(stat.size / 1024)}KB). Usa bash con head/tail para leer partes.` };
    }

    let content = fs.readFileSync(resolvedPath, "utf-8");
    if (content.length > MAX_OUTPUT_CHARS) {
      content = content.slice(0, MAX_OUTPUT_CHARS) + `\n...[truncado, ${content.length} chars totales]`;
    }

    return { success: true, output: content };
  } catch (err) {
    return { success: false, output: `Error leyendo archivo: ${err.message}` };
  }
}

async function executeWriteFile(filePath, content) {
  try {
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(SANDBOX_DIR, filePath);

    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, content, "utf-8");

    return {
      success: true,
      output: `Archivo escrito correctamente: ${resolvedPath} (${content.length} chars)`,
    };
  } catch (err) {
    return { success: false, output: `Error escribiendo archivo: ${err.message}` };
  }
}

async function executeBrowser(url) {
  try {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return { success: false, output: "URL inválida. Debe empezar por http:// o https://" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ZocoBot/1.0)",
        Accept: "text/html,text/plain,application/json",
      },
    });

    clearTimeout(timeout);

    const contentType = response.headers.get("content-type") || "";
    let text = await response.text();

    // Limpiar HTML básico
    if (contentType.includes("text/html")) {
      text = text
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{3,}/g, "\n\n")
        .trim();
    }

    if (text.length > MAX_OUTPUT_CHARS) {
      text = text.slice(0, MAX_OUTPUT_CHARS) + `\n...[truncado, ${text.length} chars totales]`;
    }

    return {
      success: true,
      output: `[${response.status} ${response.statusText}] ${url}\n\n${text}`,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      return { success: false, output: `Timeout al cargar ${url}` };
    }
    return { success: false, output: `Error cargando URL: ${err.message}` };
  }
}

// ─── Dispatcher de herramientas ───────────────────────────────────────────────

async function executeTool(toolName, toolInput) {
  switch (toolName) {
    case "bash":
      return executeBash(toolInput.command, toolInput.timeout_ms);
    case "read_file":
      return executeReadFile(toolInput.path);
    case "write_file":
      return executeWriteFile(toolInput.path, toolInput.content);
    case "browser":
      return executeBrowser(toolInput.url);
    case "finish":
      return {
        success: true,
        output: toolInput.summary,
        result: toolInput.result,
        finished: true,
      };
    default:
      return { success: false, output: `Herramienta desconocida: ${toolName}` };
  }
}

// ─── Emisor de eventos SSE ────────────────────────────────────────────────────

function sendSSE(res, eventType, data) {
  if (res.writableEnded) return;
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  res.write(`event: ${eventType}\ndata: ${payload}\n\n`);
}

// ─── Motor del agente ─────────────────────────────────────────────────────────

async function runAgent(taskId, task, userId, db, res) {
  const anthropic = getAnthropic();

  // Estado del agente
  const messages = [];
  let iteration = 0;
  let finished = false;
  let finalResult = null;

  // Inicializar sandbox
  fs.mkdirSync(SANDBOX_DIR, { recursive: true });

  // Notificar inicio
  sendSSE(res, "status", { type: "started", taskId, task, timestamp: Date.now() });

  // Agregar tarea inicial
  messages.push({ role: "user", content: task });

  while (!finished && iteration < MAX_ITERATIONS) {
    iteration++;

    sendSSE(res, "thinking", {
      type: "thinking",
      iteration,
      message: `Iteración ${iteration}: analizando estado y decidiendo siguiente acción...`,
    });

    let response;
    try {
      response = await anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        tool_choice: { type: "auto" },
        messages,
      });
    } catch (err) {
      sendSSE(res, "error", {
        type: "error",
        message: `Error llamando a Anthropic: ${err.message}`,
      });
      throw err;
    }

    // Procesar bloques de respuesta
    const assistantContent = [];

    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        // Texto/razonamiento del agente — mostrar en el chat principal
        assistantContent.push(block);

        sendSSE(res, "message", {
          type: "text",
          content: block.text,
          iteration,
        });
      } else if (block.type === "tool_use") {
        assistantContent.push(block);

        // Notificar qué herramienta se va a usar
        sendSSE(res, "tool_start", {
          type: "tool_start",
          tool: block.name,
          input: block.input,
          iteration,
        });

        // Ejecutar la herramienta
        let toolResult;
        try {
          toolResult = await executeTool(block.name, block.input);
        } catch (err) {
          toolResult = { success: false, output: `Error ejecutando ${block.name}: ${err.message}` };
        }

        // Notificar resultado al panel derecho (terminal/editor/navegador)
        sendSSE(res, "tool_result", {
          type: "tool_result",
          tool: block.name,
          input: block.input,
          output: toolResult.output,
          success: toolResult.success,
          iteration,
          // Determinar qué panel mostrar
          panel: block.name === "bash" ? "terminal"
            : block.name === "browser" ? "browser"
            : block.name === "write_file" || block.name === "read_file" ? "editor"
            : "terminal",
        });

        // Agregar resultado al historial para el siguiente turno
        messages.push({ role: "assistant", content: assistantContent });
        assistantContent.length = 0; // Limpiar para el próximo bloque

        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: block.id,
              content: toolResult.output,
            },
          ],
        });

        // Verificar si la tarea terminó
        if (toolResult.finished) {
          finished = true;
          finalResult = toolResult.result;
          break;
        }
      }
    }

    // Si quedaron bloques de asistente sin procesar
    if (assistantContent.length > 0) {
      messages.push({ role: "assistant", content: assistantContent });
    }

    // Verificar stop_reason
    if (response.stop_reason === "end_turn" && !finished) {
      // El modelo terminó sin usar finish — crear un resumen automático
      const lastText = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
      finished = true;
      finalResult = lastText || "Tarea completada.";
    }
  }

  // Timeout de iteraciones
  if (!finished) {
    finalResult = `Tarea detenida tras ${MAX_ITERATIONS} iteraciones. Último estado: en progreso.`;
    sendSSE(res, "warning", {
      type: "warning",
      message: `Se alcanzó el límite de ${MAX_ITERATIONS} iteraciones.`,
    });
  }

  // Guardar en BD
  try {
    if (db && taskId) {
      db.prepare(
        "UPDATE computer_tasks SET status = 'completed', result = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(finalResult, taskId);
    }
  } catch {}

  // Evento de finalización
  sendSSE(res, "completed", {
    type: "completed",
    taskId,
    result: finalResult,
    iterations: iteration,
    timestamp: Date.now(),
  });

  return finalResult;
}

// ─── Registro de rutas Express ────────────────────────────────────────────────

export function registerComputerRoutes({ app, db, authMiddleware, uuidv4 }) {
  // Asegurar que la tabla existe
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS computer_tasks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        task TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        result TEXT,
        agent_model TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);
  } catch {}

  // GET /api/computer/tasks — listar tareas del usuario
  app.get("/api/computer/tasks", authMiddleware, (req, res) => {
    try {
      const tasks = db
        .prepare(
          "SELECT id, task, status, result, agent_model, created_at, completed_at FROM computer_tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
        )
        .all(req.auth.sub);
      res.json(tasks);
    } catch (err) {
      res.status(500).json({ error: "Error obteniendo tareas" });
    }
  });

  // POST /api/computer/tasks — crear nueva tarea y ejecutarla en streaming SSE
  app.post("/api/computer/tasks", authMiddleware, async (req, res) => {
    const { task, model } = req.body || {};

    if (!task || !String(task).trim()) {
      return res.status(400).json({ error: "La tarea es obligatoria" });
    }

    // Verificar API key de Anthropic
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error: "ANTHROPIC_API_KEY no configurada. Añade tu clave de API de Anthropic en las variables de entorno.",
      });
    }

    const taskId = uuidv4();
    const selectedModel = model || ANTHROPIC_MODEL;

    // Guardar tarea en BD
    try {
      db.prepare(
        "INSERT INTO computer_tasks (id, user_id, task, status, agent_model) VALUES (?, ?, ?, 'running', ?)"
      ).run(taskId, req.auth.sub, task.trim(), selectedModel);
    } catch (err) {
      console.error("Error guardando tarea:", err);
    }

    // Configurar SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Desactiva buffering en Nginx/Traefik
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    // Keepalive para evitar que Traefik corte la conexión
    const keepalive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(": keepalive\n\n");
      } else {
        clearInterval(keepalive);
      }
    }, 15000);

    // Detectar desconexión del cliente
    req.on("close", () => {
      clearInterval(keepalive);
    });

    // Ejecutar el agente
    try {
      await runAgent(taskId, task.trim(), req.auth.sub, db, res);
    } catch (err) {
      console.error(`[computer] Error en tarea ${taskId}:`, err);
      sendSSE(res, "error", {
        type: "error",
        message: err.message || "Error interno del agente",
      });

      // Marcar como fallida en BD
      try {
        db.prepare(
          "UPDATE computer_tasks SET status = 'failed', result = ? WHERE id = ?"
        ).run(err.message, taskId);
      } catch {}
    } finally {
      clearInterval(keepalive);
      if (!res.writableEnded) res.end();
    }
  });

  // GET /api/computer/tasks/:id — obtener una tarea específica
  app.get("/api/computer/tasks/:id", authMiddleware, (req, res) => {
    try {
      const task = db
        .prepare(
          "SELECT * FROM computer_tasks WHERE id = ? AND user_id = ?"
        )
        .get(req.params.id, req.auth.sub);

      if (!task) return res.status(404).json({ error: "Tarea no encontrada" });
      res.json(task);
    } catch (err) {
      res.status(500).json({ error: "Error obteniendo tarea" });
    }
  });

  // DELETE /api/computer/tasks/:id — eliminar una tarea
  app.delete("/api/computer/tasks/:id", authMiddleware, (req, res) => {
    try {
      const task = db
        .prepare("SELECT id FROM computer_tasks WHERE id = ? AND user_id = ?")
        .get(req.params.id, req.auth.sub);

      if (!task) return res.status(404).json({ error: "Tarea no encontrada" });

      db.prepare("DELETE FROM computer_tasks WHERE id = ?").run(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Error eliminando tarea" });
    }
  });

  // GET /api/computer/models — modelos disponibles
  app.get("/api/computer/models", authMiddleware, (req, res) => {
    res.json([
      {
        id: "claude-sonnet-4-6",
        name: "Zoco Plus",
        description: "Equilibrio perfecto entre velocidad y capacidad. Ideal para la mayoría de tareas.",
        tier: "standard",
      },
      {
        id: "claude-opus-4-8",
        name: "Zoco Max",
        description: "El modelo más potente. Mejor para tareas complejas, código avanzado y análisis profundo.",
        tier: "max",
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Zoco Flash",
        description: "El más rápido y económico. Ideal para tareas simples y respuestas rápidas.",
        tier: "flash",
      },
    ]);
  });

  console.log("✅ El Ordenador de Zoco registrado (Claude Anthropic + tool-calling nativo)");
}
