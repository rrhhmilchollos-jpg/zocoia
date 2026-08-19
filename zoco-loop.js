// -----------------------------------------------------------------------------
// zoco-loop.js — Bucle agéntico de "El Ordenador de Zoco".
//
// Reescritura completa del bucle original, que tenía cuatro defectos graves:
//
//   1. Terminaba en la iteración 1 cuando el modelo respondía con texto sin
//      llamar a ninguna herramienta (el caso típico cuando el canal de tool use
//      falla): marcaba la tarea como "completada" sin haber hecho nada.
//   2. El historial se construía una sola vez al arrancar, así que los mensajes
//      que el usuario enviaba durante la ejecución NUNCA llegaban al modelo.
//   3. No emitía el razonamiento del modelo, de modo que el panel mostraba
//      siempre el texto genérico "analizando estado…".
//   4. No sobrevivía a un reinicio del proceso: las tareas quedaban "en_curso"
//      para siempre, sin nadie ejecutándolas.
//
// Este módulo los corrige y añade control de crecimiento del contexto.
// -----------------------------------------------------------------------------

const MAX_ITERATIONS = parseInt(process.env.COMPUTER_MAX_ITERATIONS || '60', 10);
// Nº de turnos (mensajes) que se conservan íntegros en el contexto. Los más
// antiguos se resumen para no exceder la ventana del modelo en tareas largas.
const MAX_CONTEXT_MESSAGES = Math.min(32, Math.max(8, parseInt(process.env.COMPUTER_MAX_CONTEXT_MESSAGES || '24', 10)));
// Recordatorios consecutivos sin tool call antes de rendirse.
// En un motor local lento, repetir varios turnos sin una acción real convierte una
// tarea vacía en varios minutos de espera. Un único aviso basta: se pausa y queda
// disponible para que el usuario aclare el siguiente paso.
const MAX_NUDGES = 1;
const MAX_REPEATED_TOOL_CALLS = Math.min(
  5,
  Math.max(2, parseInt(process.env.COMPUTER_MAX_REPEATED_TOOL_CALLS || '3', 10))
);
// Una repetición no debe detener una tarea útil de inmediato: primero se obliga
// al modelo a replantear la estrategia y se rechazan los duplicados posteriores
// sin volver a ejecutar la herramienta. Solo se pausa si ignora repetidamente
// esa recuperación explícita.
const MAX_REPEATED_TOOL_REJECTIONS = 3;

function truncar(texto, limite = 1200) {
  const valor = String(texto || '');
  return valor.length > limite ? `${valor.slice(0, limite)}\n… [salida truncada]` : valor;
}

// Algunos modelos locales pequeños pueden devolver una llamada de herramienta
// como texto (`{"name": gestionar_plan}`) aunque reciban el esquema OpenAI.
// Recuperamos únicamente nombres conocidos y nunca ejecutamos texto arbitrario.
function recoverTextToolCall(text, tools, uuidv4) {
  const cleaned = String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned || cleaned.length > 8000) return null;

  const aliases = {
    gestionarPlan: 'gestionar_plan',
    gestionar_plan_de_tareas: 'gestionar_plan',
    createFile: 'escribir_archivo',
    crear_archivo: 'escribir_archivo',
    escribirArchivo: 'escribir_archivo',
    createFolder: 'crear_carpeta',
    crear_carpeta: 'crear_carpeta',
    readFile: 'leer_archivo',
    leer_archivo: 'leer_archivo',
    listFiles: 'listar_archivos',
    listar_archivos: 'listar_archivos',
    deleteFile: 'eliminar_archivo',
    eliminar_archivo: 'eliminar_archivo',
    executeCode: 'ejecutar_codigo',
    abrirTerminalLinux: 'terminal',
    abrir_terminal_linux: 'terminal',
    busquedaWeb: 'busqueda_web',
    leerPagina: 'leer_pagina',
    browser: 'navegador',
  };
  const known = new Set((tools || []).map((tool) => tool?.function?.name).filter(Boolean));
  let parsed = null;
  try { parsed = JSON.parse(cleaned); } catch {}

  let rawName = parsed?.name || parsed?.tool || parsed?.function?.name;
  let compactArgs = null;
  if (!rawName) {
    const nameMatch = cleaned.match(/["']?name["']?\s*:\s*["']?([A-Za-z0-9_-]+)["']?/i);
    rawName = nameMatch?.[1];
  }
  // Qwen a veces expresa una tool call como `{gestionar_plan [fases] {...}}`
  // en vez del JSON OpenAI. Solo recuperamos el nombre y el último objeto JSON;
  // no se evalúa texto arbitrario ni se aceptan herramientas no declaradas.
  if (!rawName) {
    const compact = cleaned.match(/^\{?\s*([A-Za-z_][A-Za-z0-9_-]*)\s*(?:\[[^\]]+\])?\s*(\{[\s\S]*\})\s*\}?$/);
    if (compact) {
      rawName = compact[1];
      try { compactArgs = JSON.parse(compact[2]); } catch { compactArgs = null; }
    }
  }
  const candidates = [rawName, aliases[rawName]].filter(Boolean);
  const name = candidates.find((candidate) => known.has(candidate));
  if (!name) return null;

  let args = parsed?.arguments ?? parsed?.args ?? parsed?.parameters ?? parsed?.input ?? compactArgs ?? {};
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { args = {}; }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
  if (name === 'gestionar_plan' && args.fases && !Array.isArray(args.fases)) args = { ...args, fases: [args.fases] };
  return {
    id: `text-tool-${uuidv4()}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

function stableToolSignature(name, args) {
  const normalise = (value) => {
    if (Array.isArray(value)) return value.map(normalise);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((out, key) => {
        out[key] = normalise(value[key]);
        return out;
      }, {});
    }
    return value;
  };
  return `${String(name || '')}:${JSON.stringify(normalise(args || {}))}`;
}

// ─── Construcción del historial ──────────────────────────────────────────────

// Poda el historial conservando el mensaje de sistema y los turnos recientes.
// Nunca corta entre un `assistant` con tool_calls y sus `tool` correspondientes,
// porque Anthropic rechazaría el historial por tool_use_id huérfano.
function pruneHistory(messages) {
  if (messages.length <= MAX_CONTEXT_MESSAGES) return messages;

  const system = messages[0];
  const rest = messages.slice(1);
  const keep = rest.slice(-MAX_CONTEXT_MESSAGES);

  // Si el primer mensaje conservado es un resultado de herramienta, su llamada
  // quedó fuera: avanzamos hasta el siguiente turno de usuario "limpio".
  let start = 0;
  while (start < keep.length && keep[start].role === 'tool') start++;

  const descartados = rest.length - (keep.length - start);
  const resumen = {
    role: 'user',
    content:
      `[Contexto anterior resumido: se han omitido ${descartados} mensajes de las primeras ` +
      `iteraciones de esta tarea para no exceder el límite de contexto. El trabajo ya realizado ` +
      `sigue guardado en el workspace: usa "listar_archivos" y "leer_archivo" si necesitas ` +
      `recuperar detalles concretos.]`,
  };

  return [system, resumen, ...keep.slice(start)];
}

// ─── Bucle principal ─────────────────────────────────────────────────────────

export async function runAgentLoop({
  db,
  uuidv4,
  task,
  workspaceDir,
  callModel,
  recordEvent,
  setRuntimeState = () => {},
  executeTool,
  buildSystemPrompt,
  tools,
  context,
}) {
  // ── Estado del historial ──
  // Se persiste el índice del último mensaje de usuario ya incorporado, para
  // poder inyectar en caliente los mensajes que llegan durante la ejecución.
  const systemPromptBase = buildSystemPrompt();
  const messages = [
    { role: 'system', content: systemPromptBase },
  ];

  const recitarContexto = () => {
    let contextoPersistente = '';
    try {
      contextoPersistente = typeof context?.reciteTaskContext === 'function'
        ? String(context.reciteTaskContext() || '')
        : '';
    } catch { /* La tarea sigue funcionando aunque el archivo no esté disponible. */ }
    messages[0] = {
      role: 'system',
      content: contextoPersistente
        ? `${systemPromptBase}\n\n--- CONTEXTO RECITABLE DE LA TAREA (todo.md) ---\n${contextoPersistente}\n--- FIN DEL CONTEXTO RECITABLE ---`
        : systemPromptBase,
    };
  };
  recitarContexto();

  const prevMsgs = db
    .prepare('SELECT id, role, content FROM computer_messages WHERE task_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(task.id);
  const vistos = new Set();
  for (const m of prevMsgs) {
    vistos.add(m.id);
    // Solo los turnos de conversación real entran en el historial base.
    if (m.role === 'user' || m.role === 'assistant') {
      messages.push({ role: m.role, content: m.content });
    }
  }
  // Si no hay ningún turno de usuario (caso raro), sembramos con el título.
  if (!messages.some(m => m.role === 'user')) {
    messages.push({ role: 'user', content: task.title });
  }

  // Detecta mensajes nuevos del usuario escritos mientras el agente trabaja y
  // los inyecta como un turno más. Esto es lo que permite "hablarle en caliente".
  const absorberMensajesNuevos = () => {
    const nuevos = db
      .prepare("SELECT id, content FROM computer_messages WHERE task_id = ? AND role = 'user' ORDER BY created_at ASC, rowid ASC")
      .all(task.id)
      .filter(m => !vistos.has(m.id));
    for (const m of nuevos) {
      vistos.add(m.id);
      messages.push({
        role: 'user',
        content: `[Mensaje nuevo del usuario, recibido mientras trabajabas — atiéndelo ahora]\n${m.content}`,
      });
    }
    return nuevos.length;
  };

  let finished = false;
  let nudges = 0;
  let lastToolSignature = '';
  let repeatedToolCalls = 0;
  let repeatRecoveryIssued = false;

  for (let i = 0; i < MAX_ITERATIONS && !finished; i++) {
    // ── 1. Comprobar si el usuario ha detenido o pausado la tarea ──
    const current = db.prepare('SELECT status FROM computer_tasks WHERE id = ?').get(task.id);
    if (!current) return;
    if (current.status === 'detenida' || context?.isCancelled?.()) {
      setRuntimeState(db, task.id, { phase: 'stopped', active_tool: null, status_detail: 'Tarea detenida; no se iniciarán más acciones.' });
      recordEvent(db, task.id, 'stopped', { channel: 'agent' });
      return;
    }

    // ── 2. Absorber mensajes enviados en caliente y recitar el plan persistente ──
    absorberMensajesNuevos();
    recitarContexto();

    setRuntimeState(db, task.id, {
      phase: 'model_wait', iteration: i + 1, active_tool: null,
      status_detail: 'El modelo está preparando la siguiente acción.',
    });
    recordEvent(db, task.id, 'thinking', { iteracion: i + 1, contexto: 'todo.md', channel: 'agent' });

    // ── 3. Llamar al modelo ──
    // Ollama en CPU puede tardar en preparar el contexto. El latido deja una
    // evidencia verificable en la interfaz sin fingir razonamiento ni ocultar
    // que el modelo sigue calculando.
    const inferenceStartedAt = Date.now();
    const inferenceHeartbeat = setInterval(() => {
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - inferenceStartedAt) / 1000));
      setRuntimeState(db, task.id, {
        phase: 'model_wait', iteration: i + 1, active_tool: null,
        elapsed_seconds: elapsedSeconds,
        status_detail: 'El modelo local continúa preparando la siguiente acción.',
      });
      recordEvent(db, task.id, 'model_waiting', {
        iteracion: i + 1,
        segundos: elapsedSeconds,
        mensaje: `El modelo local continúa preparando la siguiente acción (${elapsedSeconds}s).`,
        channel: 'agent',
      });
    }, 8000);
    let data;
    try {
      data = await callModel(pruneHistory(messages), tools, 'auto');
    } catch (err) {
      // Un timeout de Ollama no se reintenta en silencio: si se repite, una sola
      // tarea puede consumir muchos minutos sin ejecutar una herramienta. Se pausa
      // de forma recuperable y deja el motivo explícito en el runtime.
      if (err?.status === 504) {
        const aviso = 'El modelo local tardó demasiado en responder. La tarea se ha pausado para evitar más espera; puedes reanudarla cuando el motor esté disponible o cambiar de estrategia.';
        db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?, ?, ?, ?)')
          .run(uuidv4(), task.id, 'assistant', aviso);
        db.prepare("UPDATE computer_tasks SET status = 'pausada', result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(aviso, task.id);
        setRuntimeState(db, task.id, { phase: 'paused', active_tool: null, status_detail: aviso });
        recordEvent(db, task.id, 'paused', { mensaje: aviso, channel: 'agent' });
        return;
      }
      // Los errores transitorios no relacionados con timeout reciben un único reintento.
      const transitorio = /429|5\d\d|ECONNRESET|overloaded|rate.?limit/i.test(err.message || '');
      if (transitorio && i < MAX_ITERATIONS - 1) {
        const espera = Math.min(30000, 3000 * (nudges + 1));
        recordEvent(db, task.id, 'thinking', {
          iteracion: i + 1,
          texto: `El modelo devolvió un error transitorio (${err.message}). Reintentando en ${Math.round(espera / 1000)}s…`,
        });
        await new Promise(r => setTimeout(r, espera));
        nudges++;
        continue;
      }
      setRuntimeState(db, task.id, { phase: 'error', active_tool: null, status_detail: `Error del modelo: ${err.message}` });
      recordEvent(db, task.id, 'error', { mensaje: `Error del modelo: ${err.message}`, channel: 'agent' });
      db.prepare("UPDATE computer_tasks SET status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);
      return;
    } finally {
      clearInterval(inferenceHeartbeat);
    }

    const afterInference = db.prepare('SELECT status FROM computer_tasks WHERE id = ?').get(task.id);
    if (!afterInference || afterInference.status === 'detenida' || context?.isCancelled?.()) {
      setRuntimeState(db, task.id, { phase: 'stopped', active_tool: null, status_detail: 'Tarea detenida durante la inferencia.' });
      recordEvent(db, task.id, 'stopped', { channel: 'agent', mensaje: 'La inferencia terminó después de solicitar la cancelación; no se ejecutarán herramientas.' });
      return;
    }

    const msg = data.choices?.[0]?.message || {};
    let toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    const texto = String(msg.content || '').trim();
    if (toolCalls.length === 0) {
      const recovered = recoverTextToolCall(texto, tools, uuidv4);
      if (recovered) toolCalls = [recovered];
    }

    // ── 4. Emitir el razonamiento real del modelo ──
    // El texto que acompaña a una tool call es el "pensamiento" que el usuario ve.
    if (texto) {
      recordEvent(db, task.id, 'thinking', { iteracion: i + 1, texto });
    }

    // ── 5. Si no hay tool calls, NO terminamos: empujamos al modelo a actuar ──
    if (toolCalls.length === 0) {
      nudges++;

      // Guardamos su texto como mensaje visible (puede ser una pregunta útil).
      if (texto) {
        db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?, ?, ?, ?)')
          .run(uuidv4(), task.id, 'assistant', texto);
        recordEvent(db, task.id, 'assistant_message', { texto });
        messages.push({ role: 'assistant', content: texto });
      }

      if (nudges >= MAX_NUDGES) {
        // Tras varios avisos sigue sin usar herramientas: cerramos con lo que hay,
        // pero de forma honesta y dejando la tarea reanudable.
        const aviso = texto ||
          'No he conseguido continuar de forma autónoma. Dime cómo quieres que siga.';
        db.prepare("UPDATE computer_tasks SET status = 'pausada', result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(aviso, task.id);
        recordEvent(db, task.id, 'paused', {
          mensaje: 'El agente ha pedido intervención. Envíale un mensaje para continuar.',
        });
        return;
      }

      messages.push({
        role: 'user',
        content:
          '[Sistema] Has respondido con texto pero sin llamar a ninguna herramienta, así que no se ' +
          'ha ejecutado ninguna acción real y la tarea NO está terminada. Debes responder llamando ' +
          'a una herramienta: usa "gestionar_plan" si aún no hay plan, las herramientas de trabajo ' +
          'para avanzar, o "entregar_resultado" si de verdad ya has completado todo y los ' +
          'entregables existen en el workspace.',
      });
      continue;
    }

    // Hubo tool calls: reiniciamos el contador de avisos.
    nudges = 0;

    // ── 6. Registrar el turno del asistente con sus bloques nativos ──
    // Preferimos los bloques originales de Anthropic (conservan los tool_use_id
    // exactos); si no están, reconstruimos desde el formato OpenAI.
    messages.push({
      role: 'assistant',
      content: Array.isArray(msg._anthropicBlocks) && msg._anthropicBlocks.length
        ? msg._anthropicBlocks
        : (texto || ''),
      ...(Array.isArray(msg._anthropicBlocks) && msg._anthropicBlocks.length ? {} : { tool_calls: toolCalls }),
    });

    // ── 7. Ejecutar cada herramienta y devolver su resultado real ──
    for (const tc of toolCalls) {
      const name = tc.function?.name;
      let args = {};
      let argsError = null;
      try {
        args = JSON.parse(tc.function?.arguments || '{}');
      } catch (err) {
        argsError = `Los argumentos JSON de la llamada no son válidos (${err.message}). Vuelve a llamar a la herramienta con JSON correcto.`;
      }

      const toolSignature = stableToolSignature(name, args);
      const isRepeatedSignature = toolSignature === lastToolSignature;
      if (!isRepeatedSignature) repeatRecoveryIssued = false;
      repeatedToolCalls = isRepeatedSignature ? repeatedToolCalls + 1 : 1;
      lastToolSignature = toolSignature;

      const toolRunId = uuidv4();
      const toolChannel = /^(terminal|sandbox|exponer_puerto)/.test(name || '') ? 'terminal'
        : /^(escribir_archivo|leer_archivo|editar_archivo|listar_archivos)$/.test(name || '') ? 'files'
        : /^(navegador|leer_pagina|busqueda_web)$/.test(name || '') ? 'web' : 'agent';
      setRuntimeState(db, task.id, {
        phase: 'tool_running', iteration: i + 1, active_tool: name || 'desconocida',
        tool_run_id: toolRunId, channel: toolChannel, status_detail: `Ejecutando ${name || 'herramienta'}.`,
      });
      recordEvent(db, task.id, 'tool_call', {
        herramienta: name,
        argumentos: JSON.stringify(args).slice(0, 1500),
        tool_run_id: toolRunId,
        channel: toolChannel,
      });
      recordEvent(db, task.id, 'tool_started', {
        herramienta: name, tool_run_id: toolRunId, channel: toolChannel,
      });

      let recoveryDirective = '';
      let result;
      if (argsError) {
        result = argsError;
      } else if (repeatedToolCalls > MAX_REPEATED_TOOL_CALLS) {
        // Evitamos consumir más recursos repitiendo una llamada idéntica. El
        // modelo recibe una observación concreta y puede elegir otra herramienta
        // o cambiar argumentos en la siguiente iteración.
        const rejected = repeatedToolCalls - MAX_REPEATED_TOOL_CALLS;
        result =
          `Llamada repetida rechazada (${rejected}/${MAX_REPEATED_TOOL_REJECTIONS} tras el aviso de recuperación): ` +
          `no ejecutes de nuevo ${name} con los mismos argumentos. Analiza el último resultado, ` +
          `usa una herramienta distinta o modifica los argumentos de forma verificable.`;
        recordEvent(db, task.id, 'tool_rejected', { herramienta: name, mensaje: result });

        if (rejected >= MAX_REPEATED_TOOL_REJECTIONS) {
          const aviso =
            `La tarea se ha pausado después de ${repeatedToolCalls} intentos idénticos de ${name}, ` +
            `incluyendo una recuperación guiada y ${rejected} rechazos. Revisa el último resultado o añade una instrucción nueva.`;
          db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?, ?, ?, ?)')
            .run(uuidv4(), task.id, 'assistant', aviso);
          db.prepare("UPDATE computer_tasks SET status = 'pausada', result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(aviso, task.id);
          setRuntimeState(db, task.id, { phase: 'paused', active_tool: null, status_detail: aviso });
    recordEvent(db, task.id, 'paused', { mensaje: aviso, channel: 'agent' });
          return;
        }
      } else {
        try {
          result = await executeTool(db, task, workspaceDir, name, args, context, { toolRunId, channel: toolChannel });
        } catch (err) {
          // El error se devuelve al modelo como observación para que se corrija,
          // en lugar de abortar la tarea entera.
          result = `Error ejecutando ${name}: ${err.message}`;
          recordEvent(db, task.id, 'tool_error', { herramienta: name, mensaje: err.message });
        }
      }

      recordEvent(db, task.id, 'tool_completed', {
        herramienta: name, tool_run_id: toolRunId, channel: toolChannel,
        resumen: truncar(String(result && result.__finish ? result.resumen : result || ''), 1000),
      });
      setRuntimeState(db, task.id, {
        phase: 'agent_ready', iteration: i + 1, active_tool: null,
        last_tool: name || null, last_tool_run_id: toolRunId,
        status_detail: `Finalizó ${name || 'la herramienta'}.`,
      });

      if (repeatedToolCalls === MAX_REPEATED_TOOL_CALLS && !repeatRecoveryIssued) {
        repeatRecoveryIssued = true;
        recoveryDirective =
          '[Sistema] Se ha detectado una repetición exacta de herramienta. No finalices ni pauses todavía: ' +
          'revisa el resultado recibido, actualiza el plan y cambia de estrategia. La próxima llamada ' +
          'idéntica será rechazada sin ejecutarse.';
        recordEvent(db, task.id, 'strategy_recovery', { herramienta: name, repeticion: repeatedToolCalls });
      }


      // Señal de finalización explícita
      if (result && typeof result === 'object' && result.__finish) {
        const resumen = result.resumen || 'Tarea completada.';
        db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?, ?, ?, ?)')
          .run(uuidv4(), task.id, 'assistant', resumen);
        db.prepare("UPDATE computer_tasks SET status = 'completada', result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(resumen, task.id);
        setRuntimeState(db, task.id, { phase: 'completed', active_tool: null, status_detail: 'Tarea completada.', completed_at: new Date().toISOString() });
        recordEvent(db, task.id, 'finished', { resumen, archivos: result.archivos || [], channel: 'agent' });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Resultado entregado al usuario.' });
        finished = true;
        break;
      }

      messages.push({ role: 'tool', tool_call_id: tc.id, content: String(result) });
      if (recoveryDirective) {
        messages.push({ role: 'user', content: recoveryDirective });
      }
    }
  }

  // ── 8. Límite de iteraciones: pausa reanudable, no error ──
  if (!finished) {
    const aviso =
      `He alcanzado el límite de ${MAX_ITERATIONS} iteraciones en esta ejecución. El trabajo ` +
      `realizado está guardado en el workspace. Envíame un mensaje para que continúe desde aquí.`;
    db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), task.id, 'assistant', aviso);
    db.prepare("UPDATE computer_tasks SET status = 'pausada', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);
    setRuntimeState(db, task.id, { phase: 'paused', active_tool: null, status_detail: aviso });
    recordEvent(db, task.id, 'paused', { mensaje: aviso, channel: 'agent' });
  }
}

// ─── Recuperación tras reinicio del proceso ──────────────────────────────────

// Coolify reinicia el contenedor en cada despliegue. Las tareas que estaban
// "en_curso" quedarían huérfanas: nadie las ejecuta, pero el frontend las
// muestra girando para siempre. Al arrancar, las marcamos como pausadas y
// avisamos, de modo que el usuario pueda reanudarlas con un mensaje.
export function recoverOrphanTasks(db, recordEvent) {
  const huerfanas = db.prepare("SELECT id FROM computer_tasks WHERE status = 'en_curso'").all();
  for (const t of huerfanas) {
    db.prepare("UPDATE computer_tasks SET status = 'pausada', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(t.id);
    try {
      recordEvent(db, t.id, 'paused', {
        mensaje: 'El servidor se reinició mientras esta tarea estaba en marcha. ' +
                 'Envíame un mensaje para que la reanude desde donde quedó.',
      });
    } catch { /* la tarea puede haber sido borrada */ }
  }
  if (huerfanas.length) {
    console.log(`[ZocoComputer] ${huerfanas.length} tarea(s) huérfana(s) recuperada(s) como pausadas.`);
  }
  return huerfanas.length;
}
