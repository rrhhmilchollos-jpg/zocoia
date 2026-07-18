// bridge-marisai.js
//
// Archivo NUEVO y autocontenible: no modifica tools.js ni ningún otro módulo
// existente. server.js lo importa y le pasa `db`/`uuidv4` explícitamente
// (este archivo no abre su propia conexión a la base de datos).
//
// Cubre las 3 piezas que faltaban del puente Zoco IA -> Marisai:
//   1) Prompts maestros para los 2 agentes "genéricos" (Frontend, Database)
//   2) Executors deterministas para los 3 agentes sin LLM (DevOps, Testing, Reparación)
//   3) Rutas admin para: importar prompts As-Is de Marisai, gestionar
//      templates, y configurar credenciales de los executors.

import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

// ── 1) Tabla de templates maestros ──────────────────────────────────────
// Se crea de forma aditiva (IF NOT EXISTS) — no toca ninguna tabla de server.js.
export function ensureBridgeTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_prompt TEXT NOT NULL,
      variables_json TEXT DEFAULT '{}',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deterministic_executors (
      agent_id TEXT PRIMARY KEY,
      executor_type TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      action_fee_eur REAL DEFAULT 0
    );
  `);

  const seedTemplates = db.prepare(`
    INSERT INTO prompt_templates (id, name, base_prompt, variables_json)
    VALUES (@id, @name, @base_prompt, @variables_json)
    ON CONFLICT(id) DO NOTHING
  `);

  seedTemplates.run({
    id: 'tpl_frontend_master',
    name: 'Frontend Master Prompt',
    base_prompt: `Eres el agente Frontend dentro de un pipeline de desarrollo autónomo multi-agente (Zoco IA / Marisai). Recibes especificaciones ya validadas por el Arquitecto y el Diseñador, y tu única responsabilidad es traducirlas en código de interfaz funcional, coherente con el stack indicado en {framework} y el sistema de diseño {design_system}.

REGLAS DE OPERACIÓN:
1. No tomas decisiones de arquitectura ni de modelo de datos: si detectas que falta información de backend/API, decláralo explícitamente en el campo "notes" del JSON de salida en vez de inventar contratos.
2. Todo componente que generes debe ser autocontenible: props tipadas, sin estado global implícito salvo que el input lo especifique.
3. Sigue las convenciones de nombrado y estructura de carpetas que se te pasen bajo la clave "project_conventions"; si no se pasan, usa PascalCase para componentes y kebab-case para archivos.
4. Tu respuesta completa es el JSON de salida, sin texto ni markdown fuera de él.
5. Ante ambigüedad de requisitos, elige la interpretación más simple y compatible con lo ya construido, y documenta la decisión en "notes".

FORMATO DE SALIDA (obligatorio, JSON estricto):
{"status":"ok"|"error","files":[{"path":"string","content":"string"}],"notes":"string"}`,
    variables_json: JSON.stringify({ framework: 'React', design_system: 'tailwind' }),
  });

  seedTemplates.run({
    id: 'tpl_database_master',
    name: 'Database Master Prompt',
    base_prompt: `Eres el agente Database dentro de un pipeline de desarrollo autónomo multi-agente (Zoco IA / Marisai). Tu responsabilidad es diseñar y/o modificar el esquema de datos usando el motor {db_engine}, a partir de las entidades y relaciones que te entrega el Arquitecto.

REGLAS DE OPERACIÓN:
1. Toda migración es ADITIVA por defecto: nunca generes DROP TABLE / DROP COLUMN salvo que el input lo pida explícitamente con "allow_destructive": true.
2. Usa claves primarias explícitas, y define índices para toda columna usada en JOIN o WHERE frecuente según el contexto dado.
3. Normaliza hasta 3FN salvo necesidad justificada de desnormalización (ej. tablas de logs/analíticas de alto volumen).
4. Toda tabla incluye "created_at" y, si aplica edición, "updated_at".
5. Si el motor es SQLite, evita features no soportadas (sin ENUM nativo, sin ALTER COLUMN); si es Postgres, puedes usar JSONB/ENUM/arrays cuando el input lo permita.
6. Nunca generes credenciales, tokens ni datos de ejemplo con apariencia de PII real.

FORMATO DE SALIDA (obligatorio, JSON estricto):
{"status":"ok"|"error","migration_sql":"string","schema_summary":"string","notes":"string"}`,
    variables_json: JSON.stringify({ db_engine: 'sqlite' }),
  });
}

// Resuelve el system prompt final de un agente "generic_prompted"
// interpolando las variables del template con overrides puntuales del agente.
export function resolveTemplatePrompt({ db, templateId, overrideVars }) {
  const tpl = db.prepare('SELECT * FROM prompt_templates WHERE id = ?').get(templateId);
  if (!tpl) return null;
  const vars = { ...JSON.parse(tpl.variables_json || '{}'), ...(overrideVars || {}) };
  let prompt = tpl.base_prompt;
  for (const [key, value] of Object.entries(vars)) {
    prompt = prompt.replaceAll(`{${key}}`, String(value));
  }
  return prompt;
}

// ── 2) Executors deterministas (DevOps, Testing, Reparación) ───────────
// No llaman a ningún LLM. Devuelven el mismo shape { choices, usage, model }
// que processChatCompletion(), para que /v1/messages y /api/chat no tengan
// que distinguir "esto lo respondió un modelo" de "esto lo ejecutó código".
export async function runDeterministicAgent({ db, uuidv4, userId, agente, agenteData, userMessage }) {
  ensureBridgeTables(db);
  const execConfig = db.prepare('SELECT * FROM deterministic_executors WHERE agent_id = ?').get(agente.id);
  const config = execConfig ? JSON.parse(execConfig.config_json) : {};
  const actionFee = execConfig?.action_fee_eur || 0;
  const contenido = String(userMessage?.content || '');

  let resultado;
  try {
    switch (agenteData.executorType) {
      case 'railway_api':
        resultado = await runRailwayAction(contenido, config);
        break;
      case 'vercel_api':
        resultado = await runVercelAction(contenido, config);
        break;
      case 'static_code_analysis':
        resultado = await runStaticAnalysis(contenido, config);
        break;
      case 'sandbox_repair':
        resultado = await runSandboxRepair(contenido, config);
        break;
      default:
        resultado = { status: 'error', notes: `executorType no configurado para ${agente.name}` };
    }
  } catch (err) {
    resultado = { status: 'error', notes: `fallo del executor: ${err.message}` };
  }

  // Se guarda en agent_memory igual que una respuesta normal, para que el
  // historial del agente en el Dashboard sea consistente.
  const textoRespuesta = JSON.stringify(resultado);
  db.prepare('INSERT INTO agent_memory (id, agente_id, user_id, role, content) VALUES (?, ?, ?, ?, ?)')
    .run(uuidv4(), agente.id, userId, 'user', contenido);
  db.prepare('INSERT INTO agent_memory (id, agente_id, user_id, role, content) VALUES (?, ?, ?, ?, ?)')
    .run(uuidv4(), agente.id, userId, 'assistant', textoRespuesta);

  if (actionFee > 0) {
    db.prepare('INSERT INTO usage_log (id, user_id, amount, kind, description) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), userId, actionFee, 'gasto', `Acción determinista: ${agente.name}`);
    db.prepare('UPDATE users SET creditos = creditos - ? WHERE id = ?').run(actionFee, userId);
  }

  return {
    choices: [{ message: { role: 'assistant', content: textoRespuesta } }],
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    model: `zoco-agent-${agente.name.toLowerCase().replace(/\s+/g, '-')}-deterministic`,
  };
}

async function runRailwayAction(userContent, config) {
  const { action, service_id } = safeParseAction(userContent);
  if (!config.railway_token) return { status: 'error', notes: 'railway_token no configurado en deterministic_executors' };

  if (action === 'redeploy') {
    const resp = await fetch('https://backboard.railway.app/graphql/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.railway_token}` },
      body: JSON.stringify({
        query: `mutation($serviceId: String!) { serviceInstanceRedeploy(serviceId: $serviceId) }`,
        variables: { serviceId: service_id },
      }),
    });
    const data = await resp.json();
    return { status: resp.ok ? 'ok' : 'error', action: 'redeploy', service_id, raw: data };
  }
  return { status: 'error', notes: `acción no soportada: ${action}` };
}

async function runVercelAction(userContent, config) {
  const { action, project_id } = safeParseAction(userContent);
  if (!config.vercel_token) return { status: 'error', notes: 'vercel_token no configurado en deterministic_executors' };

  if (action === 'redeploy') {
    const resp = await fetch(`https://api.vercel.com/v13/deployments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.vercel_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: project_id, target: 'production' }),
    });
    const data = await resp.json();
    return { status: resp.ok ? 'ok' : 'error', action: 'redeploy', deployment_id: data.id ?? null, raw: data };
  }
  return { status: 'error', notes: `acción no soportada: ${action}` };
}

// Testing/Patcher: análisis estático (eslint/tsc/etc.) en sandbox Docker
// --network none, igual que ya hace agent/agent.js para el agente autónomo.
async function runStaticAnalysis(userContent, config) {
  const { file_path, error_trace } = safeParseInput(userContent);
  if (!config.workspace_path) return { status: 'error', notes: 'workspace_path no configurado' };

  const { stdout } = await execFileAsync('docker', [
    'run', '--rm', '--network', 'none', '--memory', '256m', '--cpus', '0.5',
    '-v', `${config.workspace_path}:/workspace:ro`,
    config.image || 'zocoia/static-analyzer:latest',
    '--file', file_path || '', '--trace', error_trace || '',
  ], { timeout: 30_000 });

  const result = JSON.parse(stdout);
  return { status: 'ok', file_path, diff: result.diff, diagnostics: result.diagnostics };
}

// Reparación: ejecución + auto-corrección iterativa en sandbox.
async function runSandboxRepair(userContent, config) {
  const { file_path, max_attempts = 3 } = safeParseInput(userContent);
  if (!config.workspace_path) return { status: 'error', notes: 'workspace_path no configurado' };

  let attempt = 0, lastError = null;
  while (attempt < max_attempts) {
    attempt++;
    try {
      const { stdout, stderr } = await execFileAsync('docker', [
        'run', '--rm', '--network', 'none', '--memory', '256m', '--cpus', '0.5',
        '-v', `${config.workspace_path}:/workspace:rw`,
        config.image || 'zocoia/sandbox-runner:latest',
        '--file', file_path || '',
      ], { timeout: 20_000 });
      if (!stderr) return { status: 'ok', file_path, attempts: attempt, output: stdout };
      lastError = stderr;
    } catch (err) {
      lastError = err.message;
    }
  }
  return { status: 'error', file_path, attempts: attempt, notes: `no resuelto tras ${attempt} intentos: ${lastError}` };
}

function safeParseAction(content) {
  try { return JSON.parse(content); }
  catch { return { action: content.includes('redeploy') ? 'redeploy' : 'logs', service_id: null, project_id: null }; }
}
function safeParseInput(content) {
  try { return JSON.parse(content); }
  catch { return { file_path: null, error_trace: content }; }
}

// ── 3) Rutas admin del puente (solo owner/admin) ───────────────────────
export function registerBridgeAdminRoutes({ app, db, authMiddleware, requireAdmin, uuidv4 }) {
  ensureBridgeTables(db);

  // Sobrescribe el systemPrompt/jsonSchema de UN agente propio con el
  // prompt EXACTO migrado de Marisai (As-Is, sin reescritura ni parseo).
  app.put('/admin/bridge/agentes/:id/import-marisai', authMiddleware, requireAdmin, (req, res) => {
    const { systemPrompt, jsonSchema } = req.body || {};
    if (typeof systemPrompt !== 'string' || !systemPrompt.trim()) {
      return res.status(400).json({ error: 'systemPrompt es obligatorio (texto exacto de Marisai)' });
    }
    const agente = db.prepare("SELECT * FROM resources WHERE id = ? AND type = 'agente'").get(req.params.id);
    if (!agente) return res.status(404).json({ error: 'Agente no encontrado' });

    const data = JSON.parse(agente.data || '{}');
    data.systemPrompt = systemPrompt;       // As-Is: se guarda tal cual, sin tocar
    if (jsonSchema !== undefined) data.jsonSchema = jsonSchema;
    data.tipo = data.tipo === 'deterministic' ? data.tipo : 'prompted'; // deja de ser "genérico" al recibir prompt propio

    db.prepare('UPDATE resources SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(data), agente.id);
    res.json({ ok: true, agentId: agente.id });
  });

  // Configura credenciales/params de un executor determinista (Railway/Vercel/sandbox).
  app.put('/admin/bridge/agentes/:id/executor', authMiddleware, requireAdmin, (req, res) => {
    const { executorType, config, actionFeeEur } = req.body || {};
    if (!executorType) return res.status(400).json({ error: 'executorType es obligatorio' });

    db.prepare(`
      INSERT INTO deterministic_executors (agent_id, executor_type, config_json, action_fee_eur)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET executor_type = excluded.executor_type, config_json = excluded.config_json, action_fee_eur = excluded.action_fee_eur
    `).run(req.params.id, executorType, JSON.stringify(config || {}), actionFeeEur || 0);

    res.json({ ok: true });
  });

  // Editar/crear un template maestro (Frontend/Database u otros futuros).
  app.put('/admin/bridge/templates/:id', authMiddleware, requireAdmin, (req, res) => {
    const { name, basePrompt, variables } = req.body || {};
    if (!basePrompt) return res.status(400).json({ error: 'basePrompt es obligatorio' });
    db.prepare(`
      INSERT INTO prompt_templates (id, name, base_prompt, variables_json, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, base_prompt = excluded.base_prompt, variables_json = excluded.variables_json, updated_at = CURRENT_TIMESTAMP
    `).run(req.params.id, name || req.params.id, basePrompt, JSON.stringify(variables || {}));
    res.json({ ok: true });
  });

  app.get('/admin/bridge/templates', authMiddleware, requireAdmin, (req, res) => {
    res.json(db.prepare('SELECT * FROM prompt_templates').all());
  });
}
