import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ensureSchema, executeTool } from './zoco-computer.js';

const db = new Database(':memory:');
ensureSchema(db);
const task = {
  id: 'live-terminal-test',
  user_id: 'test-user',
  title: 'Verificar salida de terminal en vivo',
  status: 'en_curso',
};
db.prepare('INSERT INTO computer_tasks (id, user_id, title, status) VALUES (?, ?, ?, ?)')
  .run(task.id, task.user_id, task.title, task.status);

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'zoco-live-terminal-'));
try {
  const result = await executeTool(
    db,
    task,
    workspace,
    'terminal',
    { comando: "printf 'PRIMER_FRAGMENTO\\n'; sleep 0.03; printf 'SEGUNDO_FRAGMENTO\\n'" },
    { uuidv4: () => 'test-event' },
  );

  assert.match(result, /PRIMER_FRAGMENTO/);
  assert.match(result, /SEGUNDO_FRAGMENTO/);

  const events = db.prepare('SELECT type, payload FROM computer_events WHERE task_id = ? ORDER BY id ASC').all(task.id)
    .map((event) => ({ type: event.type, ...JSON.parse(event.payload) }));
  assert.equal(events[0].type, 'terminal_start');
  assert.ok(events.some((event) => event.type === 'terminal_output' && event.salida.includes('PRIMER_FRAGMENTO')));
  assert.ok(events.some((event) => event.type === 'terminal_output' && event.salida.includes('SEGUNDO_FRAGMENTO')));
  assert.equal(events.at(-1).type, 'tool_result');
  assert.ok(events.every((event) => Boolean(event.ts)), 'cada evento debe llevar marca temporal');
  console.log('✅ Eventos incrementales de terminal verificados');
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
  db.close();
}
