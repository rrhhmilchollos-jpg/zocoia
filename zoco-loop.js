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
const MAX_CONTEXT_MESSAGES = parseInt(process.env.COMPUTER_MAX_CONTEXT_MESSAGES || '80', 10);
// Recordatorios consecutivos sin tool call antes de rendirse.
const MAX_NUDGES = 3;

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
  executeTool,
  buildSystemPrompt,
  tools,
  context,
}) {
  // ── Estado del historial ──
  // Se persiste el índice del último mensaje de usuario ya incorporado, para
  // poder inyectar en caliente los mensajes que llegan durante la ejecución.
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
  ];

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

  for (let i = 0; i < MAX_ITERATIONS && !finished; i++) {
    // ── 1. Comprobar si el usuario ha detenido o pausado la tarea ──
    const current = db.prepare('SELECT status FROM computer_tasks WHERE id = ?').get(task.id);
    if (!current) return;
    if (current.status === 'detenida') {
      recordEvent(db, task.id, 'stopped', {});
      return;
    }

    // ── 2. Absorber mensajes enviados en caliente ──
    absorberMensajesNuevos();

    recordEvent(db, task.id, 'thinking', { iteracion: i + 1 });

    // ── 3. Llamar al modelo ──
    let data;
    try {
      data = await callModel(pruneHistory(messages), tools, 'auto');
    } catch (err) {
      // Los errores transitorios (429, 529, timeouts) merecen un reintento con
      // espera antes de declarar la tarea fallida.
      const transitorio = /429|5\d\d|timeout|ECONNRESET|overloaded|rate.?limit/i.test(err.message || '');
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
      recordEvent(db, task.id, 'error', { mensaje: `Error del modelo: ${err.message}` });
      db.prepare("UPDATE computer_tasks SET status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);
      return;
    }

    const msg = data.choices?.[0]?.message || {};
    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    const texto = String(msg.content || '').trim();

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

      recordEvent(db, task.id, 'tool_call', {
        herramienta: name,
        argumentos: JSON.stringify(args).slice(0, 1500),
      });

      let result;
      if (argsError) {
        result = argsError;
      } else {
        try {
          result = await executeTool(db, task, workspaceDir, name, args, context);
        } catch (err) {
          // El error se devuelve al modelo como observación para que se corrija,
          // en lugar de abortar la tarea entera.
          result = `Error ejecutando ${name}: ${err.message}`;
          recordEvent(db, task.id, 'tool_error', { herramienta: name, mensaje: err.message });
        }
      }

      // Señal de finalización explícita
      if (result && typeof result === 'object' && result.__finish) {
        const resumen = result.resumen || 'Tarea completada.';
        db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?, ?, ?, ?)')
          .run(uuidv4(), task.id, 'assistant', resumen);
        db.prepare("UPDATE computer_tasks SET status = 'completada', result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(resumen, task.id);
        recordEvent(db, task.id, 'finished', { resumen, archivos: result.archivos || [] });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Resultado entregado al usuario.' });
        finished = true;
        break;
      }

      messages.push({ role: 'tool', tool_call_id: tc.id, content: String(result) });
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
    recordEvent(db, task.id, 'paused', { mensaje: aviso });
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
