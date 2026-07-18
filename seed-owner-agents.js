// seed-owner-agents.js
//
// Siembra de los 11 agentes reales de marisai.es en la cuenta del propietario,
// con TODA su potencia: prompts completos del pipeline real, herramientas
// conectadas por rol, habilidades y parámetros avanzados afinados por agente.
//
// SIEMBRA VERSIONADA (v2): además de sembrar cuando la tabla está vacía,
// ACTUALIZA los agentes ya sembrados en producción cuando sube SEED_VERSION —
// sin duplicarlos y sin pisar ediciones manuales de nombre. La versión aplicada
// se registra en la tabla seed_meta.

import { v4 as uuidv4 } from 'uuid';
import {
  RESEARCHER_SYSTEM_PROMPT,
  ARCHITECT_SYSTEM_PROMPT,
  DESIGNER_SYSTEM_PROMPT,
  FRONTEND_SYSTEM_PROMPT,
  BACKEND_SYSTEM_PROMPT_MONGO,
  DATABASE_SYSTEM_PROMPT,
  INTEGRATION_SYSTEM_PROMPT,
  QA_SYSTEM_PROMPT,
  PATCHER_SYSTEM_PROMPT,
  REPAIR_SYSTEM_PROMPT,
} from './bridge-marisai-prompts.js';

const OWNER_EMAIL = 'rrhh.milchollos@gmail.com';

// Sube este número cuando cambien los prompts/las configs de los agentes para
// que la siembra actualice las instalaciones existentes (sin duplicar).
const SEED_VERSION = 2;

// REGLA DE FORMATO SEGURO PARA DEEPSEEK-R1 — se añade al FINAL del system
// prompt de TODOS los agentes sembrados (el motor local sirve modelos de la
// familia DeepSeek-R1/OpenAI-compatible vía Ollama).
export const DEEPSEEK_SAFE_FORMAT_RULE =
  '\n\nIMPORTANT: You are running on a DeepSeek-R1/OpenAI compatible endpoint. ' +
  'Return the absolute raw code inside the file contents. Do not wrap code blocks in metadata definitions. ' +
  'Never output field descriptions, JSON schemas or placeholders instead of the real code — always emit the complete, working file content. ' +
  'When asked for JSON, return a single pure JSON object with no markdown fences and no commentary.';

// Añade la regla solo si el prompt no la lleva ya (idempotente ante resiembras).
const withSafeRule = (prompt) => {
  if (!prompt) return prompt;
  return String(prompt).includes('DeepSeek-R1/OpenAI compatible endpoint')
    ? prompt
    : prompt + DEEPSEEK_SAFE_FORMAT_RULE;
};

// Los 11 agentes del pipeline real de marisai.es, cada uno con:
// - systemPrompt: el prompt COMPLETO extraído del código real de maris-ai
// - habilidades: decisiones de producto del propietario (se conservan tal cual)
// - allowedTools: herramientas del sistema conectadas según el rol del agente
//   (createFile, createFolder, readFile, executeCode, busqueda_web)
// - num_predict/num_ctx/temperature: afinados según lo que hace cada agente en
//   el pipeline real (los generadores de código necesitan más tokens y los
//   agentes de precisión menos temperatura)
const AGENTS = [
  {
    name: 'Agente de Investigación (Researcher)',
    tipo: 'prompted',
    systemPrompt: RESEARCHER_SYSTEM_PROMPT,
    habilidades: ['Búsqueda Web Avanzada', 'Extracción de Requisitos', 'Análisis de Competencia', 'Generación de Brief de Producto'],
    busquedaWeb: true,
    allowedTools: ['busqueda_web', 'readFile', 'createFile'],
    num_predict: 4096, num_ctx: 8192, temperature: 0.7,
  },
  {
    name: 'Agente Arquitecto',
    tipo: 'prompted',
    systemPrompt: ARCHITECT_SYSTEM_PROMPT,
    habilidades: ['Diseño de Arquitectura', 'Definición de Modelos de Datos', 'Estructuración de Archivos', 'Ruteo con Wouter'],
    busquedaWeb: false,
    allowedTools: ['createFile', 'createFolder', 'readFile'],
    num_predict: 6144, num_ctx: 12288, temperature: 0.5,
  },
  {
    name: 'Agente de Diseño (Diseñador)',
    tipo: 'prompted',
    systemPrompt: DESIGNER_SYSTEM_PROMPT,
    habilidades: ['Sistemas de Diseño UI/UX', 'Paletas de Colores Tailwind', 'Tipografías Web', 'Tokens CSS'],
    busquedaWeb: false,
    allowedTools: ['createFile', 'readFile'],
    num_predict: 4096, num_ctx: 8192, temperature: 0.8,
  },
  {
    name: 'Agente de Interfaz',
    tipo: 'prompted',
    systemPrompt: FRONTEND_SYSTEM_PROMPT,
    habilidades: ['Desarrollo React 18', 'Estilado Tailwind CSS v3', 'Configuración PWA / Service Worker', 'Manejo de Estado'],
    busquedaWeb: false,
    // El Frontend Engineer genera bundles completos: máximo de tokens y contexto.
    allowedTools: ['createFile', 'createFolder', 'readFile', 'executeCode'],
    num_predict: 8192, num_ctx: 16384, temperature: 0.6,
  },
  {
    name: 'Agente de Backend',
    tipo: 'prompted',
    systemPrompt: BACKEND_SYSTEM_PROMPT_MONGO,
    habilidades: ['Desarrollo Node.js / Express', 'Creación de Endpoints API', 'Validación de Payloads', 'Gestión de Errores'],
    busquedaWeb: false,
    allowedTools: ['createFile', 'createFolder', 'readFile', 'executeCode'],
    num_predict: 8192, num_ctx: 16384, temperature: 0.6,
  },
  {
    name: 'Agente de Base de Datos',
    tipo: 'prompted',
    systemPrompt: DATABASE_SYSTEM_PROMPT,
    habilidades: ['Modelado de Esquemas', 'Migraciones', 'Índices y Rendimiento', 'Transacciones y Concurrencia'],
    busquedaWeb: false,
    allowedTools: ['createFile', 'readFile', 'executeCode'],
    num_predict: 4096, num_ctx: 8192, temperature: 0.4,
  },
  {
    name: 'Agente de Integraciones',
    tipo: 'prompted',
    systemPrompt: INTEGRATION_SYSTEM_PROMPT,
    habilidades: ['Integración de Pasarelas de Pago', 'Autenticación OAuth2', 'Webhooks Entrantes/Salientes', 'Conectores ERP/CRM'],
    busquedaWeb: true,
    allowedTools: ['busqueda_web', 'createFile', 'readFile'],
    num_predict: 4096, num_ctx: 8192, temperature: 0.5,
  },
  {
    name: 'Agente de Control de Calidad (QA)',
    tipo: 'prompted',
    systemPrompt: QA_SYSTEM_PROMPT,
    habilidades: ['Auditoría de Código', 'Detección de Bugs JSX/TS', 'Pruebas de Accesibilidad WCAG', 'Validación de Rendimiento'],
    busquedaWeb: false,
    // QA exige precisión: temperatura baja y contexto amplio para leer bundles.
    allowedTools: ['readFile', 'executeCode'],
    num_predict: 4096, num_ctx: 16384, temperature: 0.2,
  },
  {
    name: 'Agente Corrector Automatizado (Patcher)',
    tipo: 'prompted',
    systemPrompt: PATCHER_SYSTEM_PROMPT,
    habilidades: ['Aplicación de Parches de Código', 'Resolución de Conflictos', 'Hot-fixing Automatizado'],
    busquedaWeb: false,
    allowedTools: ['readFile', 'createFile', 'executeCode'],
    num_predict: 8192, num_ctx: 16384, temperature: 0.2,
  },
  {
    name: 'Agente de Reparación',
    tipo: 'prompted',
    systemPrompt: REPAIR_SYSTEM_PROMPT,
    habilidades: ['Diagnóstico de Errores en Producción', 'Reparación Automática de Bundles', 'Validación Post-Reparación'],
    busquedaWeb: false,
    allowedTools: ['readFile', 'createFile', 'executeCode'],
    num_predict: 8192, num_ctx: 16384, temperature: 0.3,
  },
  {
    name: 'Agente DevOps',
    // DevOps es el único de los 11 que en el código real de Marisai NO es
    // un agente con System Prompt — es código real (routes/railway.ts,
    // lib/railwayDeploy.ts, lib/vercelDeploy.ts) que llama a las APIs de
    // Railway/Vercel directamente. Se siembra como determinista (sin LLM)
    // para no inventar una persona que no existe en el original.
    tipo: 'deterministic',
    executorType: 'railway_api',
    systemPrompt: null,
    habilidades: ['Configuración Railway/Vercel', 'Despliegue Automatizado', 'Gestión de Variables de Entorno'],
    busquedaWeb: false,
    allowedTools: ['executeCode', 'readFile'],
    num_predict: 4096, num_ctx: 8192, temperature: 0.3,
  },
];

function findOrCreateSkill(db, userId, nombre, cache) {
  if (cache.has(nombre)) return cache.get(nombre);
  const existente = db.prepare(`SELECT id FROM resources WHERE user_id = ? AND type = 'habilidad' AND name = ?`).get(userId, nombre);
  if (existente) {
    cache.set(nombre, existente.id);
    return existente.id;
  }
  const id = uuidv4();
  db.prepare(`INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, 'habilidad', ?, ?)`)
    .run(id, userId, nombre, JSON.stringify({ descripcion: `Habilidad: ${nombre}` }));
  cache.set(nombre, id);
  return id;
}

function buildAgentData(agente, skillIds) {
  return {
    tipo: agente.tipo,
    systemPrompt: withSafeRule(agente.systemPrompt),
    executorType: agente.executorType || null,
    modelo: 'zoco-plus',
    habilidadesActivas: skillIds,
    allowedTools: agente.allowedTools,
    num_predict: agente.num_predict,
    num_ctx: agente.num_ctx,
    temperature: agente.temperature,
    busquedaWeb: agente.busquedaWeb,
  };
}

function getAppliedSeedVersion(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS seed_meta (k TEXT PRIMARY KEY, v TEXT)`);
  const row = db.prepare(`SELECT v FROM seed_meta WHERE k = 'owner_agents_seed_version'`).get();
  return row ? parseInt(row.v, 10) || 0 : 0;
}

function setAppliedSeedVersion(db, v) {
  db.prepare(`INSERT INTO seed_meta (k, v) VALUES ('owner_agents_seed_version', ?)
              ON CONFLICT(k) DO UPDATE SET v = excluded.v`).run(String(v));
}

export function seedOwnerAgentsIfEmpty(db) {
  const owner = db.prepare('SELECT id FROM users WHERE email = ?').get(OWNER_EMAIL);
  if (!owner) {
    console.log(`[seed-owner-agents] No existe todavía la cuenta ${OWNER_EMAIL} — se sembrará en cuanto se registre (no se hace nada ahora).`);
    return;
  }

  const skillCache = new Map();
  const yaTieneAgentes = db.prepare(`SELECT COUNT(*) as n FROM resources WHERE user_id = ? AND type = 'agente'`).get(owner.id).n;
  const appliedVersion = getAppliedSeedVersion(db);

  // ── Caso 1: tabla vacía → siembra completa ──
  if (yaTieneAgentes === 0) {
    console.log('[seed-owner-agents] Tabla de agentes vacía para el owner — sembrando los 11 agentes reales...');
    const insertAgente = db.prepare(`INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, 'agente', ?, ?)`);
    const seedTx = db.transaction(() => {
      for (const agente of AGENTS) {
        const skillIds = agente.habilidades.map(h => findOrCreateSkill(db, owner.id, h, skillCache));
        insertAgente.run(uuidv4(), owner.id, agente.name, JSON.stringify(buildAgentData(agente, skillIds)));
      }
      setAppliedSeedVersion(db, SEED_VERSION);
    });
    seedTx();
    console.log(`[seed-owner-agents] ✅ ${AGENTS.length} agentes + ${skillCache.size} habilidades sembrados (seed v${SEED_VERSION}) para ${OWNER_EMAIL}.`);
    return;
  }

  // ── Caso 2: agentes ya sembrados pero con versión anterior → ACTUALIZAR ──
  // Solo se actualizan los agentes cuyo nombre coincide con la siembra (si
  // renombraste uno a mano, ese se respeta y no se toca). Nunca se duplica.
  if (appliedVersion < SEED_VERSION) {
    console.log(`[seed-owner-agents] Actualizando agentes sembrados: seed v${appliedVersion} → v${SEED_VERSION}...`);
    let actualizados = 0;
    const updateTx = db.transaction(() => {
      for (const agente of AGENTS) {
        const existente = db.prepare(
          `SELECT id, data FROM resources WHERE user_id = ? AND type = 'agente' AND name = ?`
        ).get(owner.id, agente.name);
        if (!existente) continue; // renombrado o borrado a mano: se respeta
        const skillIds = agente.habilidades.map(h => findOrCreateSkill(db, owner.id, h, skillCache));
        const nuevo = buildAgentData(agente, skillIds);
        // Conservar campos personalizados que el usuario haya añadido al data
        // y que la siembra no gestiona (p.ej. notas, avatar...).
        let previo = {};
        try { previo = JSON.parse(existente.data || '{}'); } catch { /* data corrupto: se regenera */ }
        const merged = { ...previo, ...nuevo };
        db.prepare(`UPDATE resources SET data = ? WHERE id = ?`).run(JSON.stringify(merged), existente.id);
        actualizados++;
      }
      setAppliedSeedVersion(db, SEED_VERSION);
    });
    updateTx();
    console.log(`[seed-owner-agents] ✅ ${actualizados} agente(s) actualizados a seed v${SEED_VERSION} (los renombrados a mano se respetan).`);
    return;
  }

  console.log(`[seed-owner-agents] La cuenta owner ya tiene ${yaTieneAgentes} agente(s) en seed v${appliedVersion} — nada que hacer.`);
}
