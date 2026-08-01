// Test unitario del conversor de historial OpenAI → Anthropic.
// Replica la función de server.js para validarla de forma aislada, sin
// necesidad de arrancar el servidor ni consumir la API.
import assert from 'assert';

function openAIMessagesToAnthropic(messages) {
  const out = [];
  const pushBlock = (role, block) => {
    const last = out[out.length - 1];
    if (last && last.role === role && Array.isArray(last.content)) last.content.push(block);
    else out.push({ role, content: [block] });
  };
  for (const m of messages) {
    if (!m || m.role === 'system') continue;
    if (m.role === 'tool') {
      pushBlock('user', {
        type: 'tool_result',
        tool_use_id: m.tool_call_id || m.toolCallId || '',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
        ...(m.is_error ? { is_error: true } : {}),
      });
      continue;
    }
    if (m.role === 'assistant') {
      const blocks = [];
      if (Array.isArray(m.content)) blocks.push(...m.content);
      else if (typeof m.content === 'string' && m.content.trim()) blocks.push({ type: 'text', text: m.content });
      for (const tc of (Array.isArray(m.tool_calls) ? m.tool_calls : [])) {
        let input = {};
        const raw = tc.function?.arguments ?? tc.input ?? '{}';
        if (typeof raw === 'string') { try { input = JSON.parse(raw || '{}'); } catch { input = {}; } }
        else if (raw && typeof raw === 'object') { input = raw; }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function?.name || tc.name, input });
      }
      if (!blocks.length) continue;
      out.push({ role: 'assistant', content: blocks });
      continue;
    }
    if (Array.isArray(m.content)) out.push({ role: 'user', content: m.content });
    else {
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
      if (text.trim()) pushBlock('user', { type: 'text', text });
    }
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

// ─── Caso 1: historial típico del bucle agéntico ─────────────────────────────
const historial = [
  { role: 'system', content: 'Eres Zoco.' },
  { role: 'user', content: 'Investiga las últimas tendencias de IA' },
  { role: 'assistant', content: 'Voy a crear un plan.', tool_calls: [
    { id: 'toolu_01', type: 'function', function: { name: 'gestionar_plan', arguments: '{"fases":[{"titulo":"Buscar","estado":"en_curso"}]}' } },
  ] },
  { role: 'tool', tool_call_id: 'toolu_01', content: 'Plan actualizado con 1 fases.' },
  { role: 'assistant', content: '', tool_calls: [
    { id: 'toolu_02', type: 'function', function: { name: 'busqueda_web', arguments: '{"consulta":"tendencias IA 2026"}' } },
    { id: 'toolu_03', type: 'function', function: { name: 'ejecutar_terminal', arguments: '{"comando":"date"}' } },
  ] },
  { role: 'tool', tool_call_id: 'toolu_02', content: '1. Resultado A' },
  { role: 'tool', tool_call_id: 'toolu_03', content: '[exit code: 0]\nsáb ago  1' },
];

const r = openAIMessagesToAnthropic(historial);

// Solo roles válidos para Anthropic
assert.ok(r.every(m => m.role === 'user' || m.role === 'assistant'), 'Solo user/assistant permitidos');
// Debe empezar por user
assert.strictEqual(r[0].role, 'user', 'Debe empezar por un turno user');
// El turno del asistente conserva el bloque tool_use con su id
const primerAssistant = r.find(m => m.role === 'assistant');
const toolUse = primerAssistant.content.find(b => b.type === 'tool_use');
assert.strictEqual(toolUse.id, 'toolu_01', 'El id del tool_use se conserva');
assert.strictEqual(toolUse.name, 'gestionar_plan');
assert.deepStrictEqual(toolUse.input, { fases: [{ titulo: 'Buscar', estado: 'en_curso' }] }, 'input parseado a objeto');
// El resultado va como tool_result en un turno user
const turnoResult = r[2];
assert.strictEqual(turnoResult.role, 'user');
assert.strictEqual(turnoResult.content[0].type, 'tool_result');
assert.strictEqual(turnoResult.content[0].tool_use_id, 'toolu_01');
// Dos tool_calls paralelas → un solo turno assistant con 2 bloques tool_use
const segundoAssistant = r.filter(m => m.role === 'assistant')[1];
assert.strictEqual(segundoAssistant.content.filter(b => b.type === 'tool_use').length, 2, 'Dos tool_use en el mismo turno');
// Sus dos resultados se fusionan en UN turno user con 2 bloques tool_result
const ultimoTurno = r[r.length - 1];
assert.strictEqual(ultimoTurno.role, 'user');
assert.strictEqual(ultimoTurno.content.filter(b => b.type === 'tool_result').length, 2, 'Dos tool_result fusionados');
// Alternancia estricta user/assistant
for (let i = 1; i < r.length; i++) {
  assert.notStrictEqual(r[i].role, r[i - 1].role, `Turnos consecutivos con el mismo rol en índice ${i}`);
}

// ─── Caso 2: turnos vacíos y bloques nativos ────────────────────────────────
const r2 = openAIMessagesToAnthropic([
  { role: 'user', content: 'hola' },
  { role: 'assistant', content: '' },            // debe descartarse (turno vacío)
  { role: 'assistant', content: [{ type: 'text', text: 'nativo' }] },
]);
assert.strictEqual(r2.length, 2, 'El turno assistant vacío se descarta');
assert.strictEqual(r2[1].content[0].text, 'nativo', 'Los bloques nativos se respetan');

// ─── Caso 3: historial que empieza por assistant ────────────────────────────
const r3 = openAIMessagesToAnthropic([
  { role: 'assistant', content: 'huérfano' },
  { role: 'user', content: 'ahora sí' },
]);
assert.strictEqual(r3[0].role, 'user', 'Se descartan turnos iniciales que no son user');

console.log('✅ TODOS LOS TESTS DEL PROTOCOLO ANTHROPIC PASAN');
console.log(JSON.stringify(r, null, 2));
