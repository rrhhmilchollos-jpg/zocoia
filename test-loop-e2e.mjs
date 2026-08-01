// Test end-to-end del bucle agéntico con un modelo SIMULADO.
// Verifica el comportamiento crítico sin gastar tokens ni requerir la API key:
//   1. Que NO termina en la iteración 1 cuando el modelo responde solo texto.
//   2. Que ejecuta herramientas reales y les pasa el resultado de vuelta.
//   3. Que absorbe mensajes del usuario enviados durante la ejecución.
//   4. Que solo termina con entregar_resultado.
//   5. Que recupera tareas huérfanas tras un reinicio.

import Database from 'better-sqlite3';
import { runAgentLoop, recoverOrphanTasks } from './zoco-loop.js';
import { ensureComputerTables } from './zoco-computer.js';
import fs from 'fs';

const uuidv4 = () => 'id-' + Math.random().toString(36).slice(2, 11);
const db = new Database(':memory:');
ensureComputerTables(db);

const workspaceDir = '/tmp/zoco-test-ws';
fs.rmSync(workspaceDir, { recursive: true, force: true });
fs.mkdirSync(workspaceDir, { recursive: true });

const TASK_ID = 'task-test-1';
db.prepare('INSERT INTO computer_tasks (id, user_id, title, status, model) VALUES (?,?,?,?,?)')
  .run(TASK_ID, 'u1', 'Escribe un informe de prueba', 'en_curso', 'zoco-plus');
db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?,?,?,?)')
  .run(uuidv4(), TASK_ID, 'user', 'Escribe un informe de prueba');

const task = db.prepare('SELECT * FROM computer_tasks WHERE id = ?').get(TASK_ID);

const eventos = [];
const recordEvent = (_db, taskId, type, payload) => {
  eventos.push({ type, ...payload });
  _db.prepare('INSERT INTO computer_events (task_id, type, payload) VALUES (?,?,?)')
    .run(taskId, type, JSON.stringify(payload || {}));
};

// Herramientas simuladas: registran qué se llamó y devuelven salida realista.
const llamadas = [];
const executeTool = async (_db, _task, _ws, name, args) => {
  llamadas.push({ name, args });
  if (name === 'gestionar_plan') return 'Plan actualizado.';
  if (name === 'ejecutar_terminal') return 'total 0\ndrwxr-xr-x 2 ubuntu ubuntu 4096 .';
  if (name === 'escribir_archivo') {
    fs.writeFileSync(`${workspaceDir}/${args.ruta}`, args.contenido || '');
    return `Archivo escrito: ${args.ruta}`;
  }
  if (name === 'entregar_resultado') {
    return { __finish: true, resumen: args.resumen, archivos: args.archivos || [] };
  }
  return 'ok';
};

// Guion del modelo simulado. El paso 0 devuelve SOLO texto: el bucle antiguo
// habría terminado aquí marcando "completada" sin hacer nada.
const guion = [
  { content: 'Voy a completar esta tarea ahora mismo. Ya está lista.', tool_calls: [] },
  { content: 'Primero creo el plan de trabajo.', tool_calls: [{ id: 't1', function: { name: 'gestionar_plan', arguments: JSON.stringify({ fases: [{ titulo: 'Investigar', estado: 'en_curso' }, { titulo: 'Redactar', estado: 'pendiente' }] }) } }] },
  { content: 'Inspecciono el workspace.', tool_calls: [{ id: 't2', function: { name: 'ejecutar_terminal', arguments: JSON.stringify({ comando: 'ls -la' }) } }] },
  { content: 'Escribo el informe.', tool_calls: [{ id: 't3', function: { name: 'escribir_archivo', arguments: JSON.stringify({ ruta: 'informe.md', contenido: '# Informe\n\nContenido de prueba.' }) } }] },
  { content: 'Entrego el resultado.', tool_calls: [{ id: 't4', function: { name: 'entregar_resultado', arguments: JSON.stringify({ resumen: 'Informe completado.', archivos: ['informe.md'] }) } }] },
];

let paso = 0;
const historialVisto = [];
const callModel = async (messages) => {
  historialVisto.push(JSON.parse(JSON.stringify(messages)));
  // Inyectamos un mensaje del usuario en caliente antes del 3er paso
  if (paso === 2) {
    db.prepare('INSERT INTO computer_messages (id, task_id, role, content) VALUES (?,?,?,?)')
      .run(uuidv4(), TASK_ID, 'user', 'Añade también una conclusión, por favor.');
  }
  const r = guion[Math.min(paso, guion.length - 1)];
  paso++;
  return { choices: [{ message: r }] };
};

await runAgentLoop({
  db, uuidv4, task, workspaceDir, callModel, recordEvent, executeTool,
  tools: [], context: {},
  buildSystemPrompt: () => 'SYSTEM PROMPT DE PRUEBA',
});

// ─── Comprobaciones ───
let fallos = 0;
const check = (ok, msg) => { console.log(`${ok ? '✅' : '❌'} ${msg}`); if (!ok) fallos++; };

const finalTask = db.prepare('SELECT status, result FROM computer_tasks WHERE id = ?').get(TASK_ID);

check(finalTask.status === 'completada', `La tarea acaba como "completada" (real: ${finalTask.status})`);
check(paso > 1, `NO terminó en la iteración 1 pese al texto sin tool call (iteraciones: ${paso})`);
check(llamadas.length === 4, `Ejecutó las 4 herramientas del guion (real: ${llamadas.length})`);
check(llamadas[0]?.name === 'gestionar_plan', 'La primera herramienta fue gestionar_plan');
check(fs.existsSync(`${workspaceDir}/informe.md`), 'El archivo entregable existe realmente en el workspace');

const nudge = historialVisto[1]?.find(m => typeof m.content === 'string' && m.content.includes('[Sistema]'));
check(Boolean(nudge), 'Se inyectó el recordatorio de "debes llamar a una herramienta"');

const inyectado = historialVisto[3]?.find(m => typeof m.content === 'string' && m.content.includes('conclusión'));
check(Boolean(inyectado), 'El mensaje del usuario enviado en caliente llegó al modelo');

const tieneToolResult = historialVisto[2]?.some(m => m.role === 'tool');
check(Boolean(tieneToolResult), 'Los resultados de herramientas se devuelven al modelo como role=tool');

const razonamientos = eventos.filter(e => e.type === 'thinking' && e.texto);
check(razonamientos.length >= 3, `Se emitió el razonamiento real del modelo (${razonamientos.length} eventos con texto)`);
check(eventos.some(e => e.type === 'finished'), 'Se emitió el evento finished');

// ─── Test de recuperación de huérfanas ───
db.prepare("UPDATE computer_tasks SET status = 'en_curso' WHERE id = ?").run(TASK_ID);
const recuperadas = recoverOrphanTasks(db, recordEvent);
const tras = db.prepare('SELECT status FROM computer_tasks WHERE id = ?').get(TASK_ID);
check(recuperadas === 1 && tras.status === 'pausada', 'Las tareas huérfanas tras reinicio pasan a "pausada"');

console.log(`\n${fallos === 0 ? '🎉 TODOS LOS TESTS PASAN' : `⚠️  ${fallos} test(s) fallidos`}`);
process.exit(fallos === 0 ? 0 : 1);
