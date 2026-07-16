// Zoco IA — agente autonomo con auto-correccion
// Pide codigo al modelo via tu propio gateway (nunca directo a vLLM, para que
// quede medido y facturado), lo ejecuta en un sandbox Docker REAL (no simulado),
// y si falla, le devuelve el error al modelo para que lo corrija, hasta un
// numero maximo de intentos.

const fetch = require('node-fetch');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4000/v1';
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY;
const MODEL = process.env.AGENT_MODEL || 'Qwen/Qwen2.5-Coder-32B-Instruct';
const MAX_ATTEMPTS = parseInt(process.env.AGENT_MAX_ATTEMPTS || '3', 10);
const WORKSPACE = '/workspace';

if (!GATEWAY_API_KEY) {
  console.error('Falta GATEWAY_API_KEY. Crea una key con: docker compose exec gateway node server.js create-key "agent-interno"');
  process.exit(1);
}

const SYSTEM_PROMPT =
  'Eres un ingeniero de software experto. Cuando te pidan codigo, responde ' +
  'SOLO con un bloque de codigo python delimitado por triple backtick, ' +
  'ejecutable y autocontenido, sin explicaciones ni texto fuera del bloque. ' +
  'Si te indican que una version anterior fallo, corrige el error concreto que se te muestra.';

// Llama al modelo via el gateway, pasando el historial completo de la
// conversacion (para que pueda ver el codigo previo y el error al corregir).
async function askModel(messages) {
  const res = await fetch(GATEWAY_URL + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + GATEWAY_API_KEY
    },
    body: JSON.stringify({ model: MODEL, messages })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error('Gateway respondio ' + res.status + ': ' + text);
  }

  const data = await res.json();
  return data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
}

function extractCode(markdown) {
  const fence = '```';
  const start = markdown.indexOf(fence);
  if (start === -1) return markdown;
  let bodyStart = start + fence.length;
  // saltar el identificador de lenguaje si lo hay, ej. "python\n"
  const newline = markdown.indexOf('\n', bodyStart);
  if (newline !== -1 && newline - bodyStart < 20) {
    bodyStart = newline + 1;
  }
  const end = markdown.indexOf(fence, bodyStart);
  if (end === -1) return markdown.slice(bodyStart);
  return markdown.slice(bodyStart, end);
}

// Ejecuta el codigo en un contenedor Docker efimero y aislado:
// --network none (sin acceso a red), memoria y CPU limitadas, filesystem
// de solo lectura salvo el propio script montado. No usa Docker-in-Docker
// simulado: lanza un contenedor real a traves del socket montado.
function runInSandbox(code) {
  return new Promise((resolve) => {
    const scriptPath = path.join(WORKSPACE, 'run_' + Date.now() + '.py');
    fs.writeFileSync(scriptPath, code);

    const args = [
      'run', '--rm',
      '--network', 'none',
      '--memory', '256m',
      '--cpus', '0.5',
      '--read-only',
      '-v', scriptPath + ':/tmp/script.py:ro',
      'python:3.12-slim',
      'python', '/tmp/script.py'
    ];

    execFile('docker', args, { timeout: 20000 }, (err, stdout, stderr) => {
      fs.unlinkSync(scriptPath);
      // No rechazamos la promesa en caso de fallo: el resultado (exito o
      // fallo) es informacion que el bucle de auto-correccion necesita.
      resolve({
        success: !err,
        stdout: stdout || '',
        stderr: stderr || (err ? err.message : '')
      });
    });
  });
}

async function runTaskWithSelfCorrection(task) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: task }
  ];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log('\n[Intento ' + attempt + '/' + MAX_ATTEMPTS + '] Pidiendo codigo al modelo via gateway...');

    const raw = await askModel(messages);
    const code = extractCode(raw);

    console.log('\n--- Codigo generado ---');
    console.log(code);

    console.log('\n--- Ejecutando en sandbox Docker real (sin red, memoria/CPU limitadas) ---');
    const result = await runInSandbox(code);

    if (result.success) {
      console.log('\n[EXITO] El codigo se ejecuto sin errores.');
      console.log(result.stdout);
      return { success: true, code: code, output: result.stdout, attempts: attempt };
    }

    console.log('\n[FALLO] El sandbox devolvio un error:\n' + result.stderr);

    // Retroalimentamos el historial con el codigo que fallo y el error real
    // (no simulado) para que el modelo lo corrija en el siguiente intento.
    messages.push({ role: 'assistant', content: raw });
    messages.push({
      role: 'user',
      content: 'El codigo anterior fallo al ejecutarse en el sandbox con este error:\n' +
        result.stderr + '\nCorrigelo y devuelve la version completa corregida.'
    });
  }

  console.log('\n[LIMITE ALCANZADO] No se corrigio el error tras ' + MAX_ATTEMPTS + ' intentos. Deteniendo para revision humana.');
  return { success: false, attempts: MAX_ATTEMPTS };
}

async function main() {
  const task = process.argv.slice(2).join(' ') || 'Escribe una funcion que calcule fibonacci(10) y lo imprima.';
  console.log('Tarea: ' + task);
  await runTaskWithSelfCorrection(task);
}

main().catch((e) => {
  console.error('Error del agente:', e.message);
  process.exit(1);
});
