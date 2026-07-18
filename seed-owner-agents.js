// seed-owner-agents.js
//
// Siembra automática de los 11 agentes reales (extraídos de Marisai) en la
// cuenta del propietario. Se ejecuta UNA VEZ al arrancar el servidor (la
// llamada vive al final de server.js) y es completamente idempotente: si
// la cuenta ya tiene agentes, no toca nada — así nunca pisa ediciones
// manuales que hayas hecho desde el Dashboard.
//
// Requisito explícito: "verifique si la tabla de agentes está vacía... y
// la rellene" — eso es exactamente lo que hace seedOwnerAgentsIfEmpty().

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

// REGLA DE FORMATO SEGURO PARA DEEPSEEK-R1 — se añade al FINAL del system
// prompt de TODOS los agentes sembrados. El motor real detrás de las API
// Keys de Zoco IA es DeepSeek-R1 (endpoint OpenAI-compatible); sin esta
// instrucción, los agentes tienden a devolver descripciones de campos o
// esquemas en vez del código real dentro de los archivos.
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

// Habilidades EXACTAS que pediste para cada agente (estas son decisiones
// de producto tuyas, no algo extraído del código de Marisai — se guardan
// tal cual las diste).
const AGENTS = [
  {
    name: 'Agente de Investigación (Researcher)',
    tipo: 'prompted',
    systemPrompt: RESEARCHER_SYSTEM_PROMPT,
    habilidades: ['Búsqueda Web Avanzada', 'Extracción de Requisitos', 'Análisis de Competencia', 'Generación de Brief de Producto'],
    busquedaWeb: true,
  },
  {
    name: 'Agente Arquitecto',
    tipo: 'prompted',
    systemPrompt: ARCHITECT_SYSTEM_PROMPT,
    habilidades: ['Diseño de Arquitectura', 'Definición de Modelos de Datos', 'Estructuración de Archivos', 'Ruteo con Wouter'],
    busquedaWeb: false,
  },
  {
    name: 'Agente de Diseño (Diseñador)',
    tipo: 'prompted',
    systemPrompt: DESIGNER_SYSTEM_PROMPT,
    habilidades: ['Sistemas de Diseño UI/UX', 'Paletas de Colores Tailwind', 'Tipografías Web', 'Tokens CSS'],
    busquedaWeb: false,
  },
  {
    name: 'Agente de Interfaz',
    tipo: 'prompted',
    systemPrompt: FRONTEND_SYSTEM_PROMPT,
    habilidades: ['Desarrollo React 18', 'Estilado Tailwind CSS v3', 'Configuración PWA / Service Worker', 'Manejo de Estado'],
    busquedaWeb: false,
  },
  {
    name: 'Agente de Backend',
    tipo: 'prompted',
    systemPrompt: BACKEND_SYSTEM_PROMPT_MONGO,
    habilidades: ['Desarrollo Node.js / Express', 'Creación de Endpoints API', 'Validación de Payloads', 'Gestión de Errores'],
    busquedaWeb: false,
  },
  {
    name: 'Agente de Base de Datos',
    tipo: 'prompted',
    systemPrompt: DATABASE_SYSTEM_PROMPT,
    habilidades: ['Modelado de Esquemas', 'Migraciones', 'Índices y Rendimiento', 'Transacciones y Concurrencia'],
    busquedaWeb: false,
  },
  {
    name: 'Agente de Integraciones',
    tipo: 'prompted',
    systemPrompt: INTEGRATION_SYSTEM_PROMPT,
    habilidades: ['Integración de Pasarelas de Pago', 'Autenticación OAuth2', 'Webhooks Entrantes/Salientes', 'Conectores ERP/CRM'],
    busquedaWeb: false,
  },
  {
    name: 'Agente de Control de Calidad (QA)',
    tipo: 'prompted',
    systemPrompt: QA_SYSTEM_PROMPT,
    habilidades: ['Auditoría de Código', 'Detección de Bugs JSX/TS', 'Pruebas de Accesibilidad WCAG', 'Validación de Rendimiento'],
    busquedaWeb: false,
  },
  {
    name: 'Agente Corrector Automatizado (Patcher)',
    tipo: 'prompted',
    systemPrompt: PATCHER_SYSTEM_PROMPT,
    habilidades: ['Aplicación de Parches de Código', 'Resolución de Conflictos', 'Hot-fixing Automatizado'],
    busquedaWeb: false,
  },
  {
    name: 'Agente de Reparación',
    tipo: 'prompted',
    systemPrompt: REPAIR_SYSTEM_PROMPT,
    habilidades: ['Diagnóstico de Errores en Producción', 'Reparación Automática de Bundles', 'Validación Post-Reparación'],
    busquedaWeb: false,
  },
  {
    name: 'Agente DevOps',
    // DevOps es el único de los 11 que en el código real de Marisai NO es
    // un agente con System Prompt — es código real (routes/railway.ts,
    // lib/railwayDeploy.ts, lib/vercelDeploy.ts) que llama a las APIs de
    // Railway/Vercel directamente. Se sembró como determinista (sin LLM)
    // para no inventar una persona que no existe en el original.
    tipo: 'deterministic',
    executorType: 'railway_api',
    systemPrompt: null,
    habilidades: ['Configuración Railway/Vercel', 'Despliegue Automatizado', 'Gestión de Variables de Entorno'],
    busquedaWeb: false,
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

export function seedOwnerAgentsIfEmpty(db) {
  const owner = db.prepare('SELECT id FROM users WHERE email = ?').get(OWNER_EMAIL);
  if (!owner) {
    console.log(`[seed-owner-agents] No existe todavía la cuenta ${OWNER_EMAIL} — se sembrará en cuanto se registre (no se hace nada ahora).`);
    return;
  }

  const yaTieneAgentes = db.prepare(`SELECT COUNT(*) as n FROM resources WHERE user_id = ? AND type = 'agente'`).get(owner.id).n;
  if (yaTieneAgentes > 0) {
    console.log(`[seed-owner-agents] La cuenta owner ya tiene ${yaTieneAgentes} agente(s) — no se resiembra (evita pisar ediciones manuales).`);
    return;
  }

  console.log('[seed-owner-agents] Tabla de agentes vacía para el owner — sembrando los 11 agentes reales...');

  const skillCache = new Map();
  const insertAgente = db.prepare(`INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, 'agente', ?, ?)`);

  const seedTx = db.transaction(() => {
    for (const agente of AGENTS) {
      const skillIds = agente.habilidades.map(h => findOrCreateSkill(db, owner.id, h, skillCache));

      const data = {
        tipo: agente.tipo,
        // Todos los prompts se siembran con la regla de formato seguro para
        // DeepSeek-R1 al final (los agentes deterministas tienen prompt null).
        systemPrompt: withSafeRule(agente.systemPrompt),
        executorType: agente.executorType || null,
        modelo: 'zoco-plus',
        habilidadesActivas: skillIds,
        allowedTools: undefined, // hereda el default de ALL_TOOL_NAMES si tu server.js lo aplica al leer un agente sin este campo
        num_predict: 4096,
        num_ctx: 8192,
        temperature: 0.7,
        busquedaWeb: agente.busquedaWeb,
      };
      // No guardar la clave con valor undefined en el JSON:
      if (data.allowedTools === undefined) delete data.allowedTools;

      insertAgente.run(uuidv4(), owner.id, agente.name, JSON.stringify(data));
    }
  });

  seedTx();
  console.log(`[seed-owner-agents] ✅ ${AGENTS.length} agentes + ${skillCache.size} habilidades sembrados para ${OWNER_EMAIL}.`);
}
