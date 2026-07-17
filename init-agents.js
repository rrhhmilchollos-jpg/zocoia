/**
 * init-agents.js
 * ---------------------------------------------------------
 * Puebla la tabla `resources` de Zoco IA (la misma base SQLite que usa
 * server.js) con:
 *   - 2 habilidades base   (type = 'habilidad')
 *   - 1 entorno base       (type = 'entorno')
 *   - 11 agentes           (type = 'agente'), con las habilidades ya
 *                            enlazadas en `habilidadesActivas`
 *
 * Usa EXACTAMENTE el mismo esquema que server.js:
 *   resources(id, user_id, type, name, data, created_at, updated_at)
 * y el mismo formato de `data` que genera el modal "Nuevo agente" del
 * Dashboard, para que aparezcan en el panel exactamente igual que si
 * los hubieras creado a mano.
 *
 * A qué usuario se asignan los recursos:
 *   1. Si defines AGENTS_USER_EMAIL, usa ese email.
 *   2. Si no, usa ADMIN_EMAIL (la misma variable que ya usa server.js
 *      para crear la cuenta admin).
 *   3. Si tampoco existe, usa el primer usuario que encuentre.
 *
 * Es IDEMPOTENTE: si ese usuario ya tiene agentes (type='agente'), no
 * inserta nada — usa --force para forzar la inserción de todos modos.
 *
 * Uso (en local o en la consola/shell de Railway, en la raíz del proyecto):
 *   node init-agents.js
 *   AGENTS_USER_EMAIL=otro@correo.com node init-agents.js
 *   node init-agents.js --force
 * ---------------------------------------------------------
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ---------- 1. CONFIGURACIÓN (idéntica a la de server.js) ----------------

const DB_PATH =
  process.env.DB_PATH ||
  (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'app.db')
    : path.join(__dirname, 'data', 'app.db'));

const TARGET_EMAIL = (process.env.AGENTS_USER_EMAIL || process.env.ADMIN_EMAIL || '').toLowerCase();
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'zoco-plus';

// ---------- 2. HABILIDADES Y ENTORNO BASE ----------------

const HABILIDADES = [
  { nombre: 'Búsqueda web', valor: 'busqueda_web', descripcion: 'Permite al agente buscar información actualizada en internet.' },
  { nombre: 'Ejecutar código', valor: 'ejecutar_codigo', descripcion: 'Permite al agente ejecutar código (sandbox) para probar o generar resultados.' },
];

const ENTORNOS = [
  { nombre: 'Entorno de producción', valor: 'produccion', descripcion: 'Entorno principal donde operan los 11 agentes por defecto.' },
];

// ---------- 3. LOS 11 AGENTES ----------------
// (mismo contenido/roles que seed-agentes.js, en el formato que espera
// el Dashboard: descripcion, modelo, systemPrompt, habilidadesActivas)

const AGENTES = [
  {
    nombre: 'Agente de Investigación',
    modelo: 'zoco-lab',
    descripcion: 'Investiga el sector, analiza a la competencia y define los requisitos completos del proyecto en un brief estructurado.',
    systemPrompt:
      'Eres el Agente de Investigación de Zoco IA. Tu trabajo es el primer paso de todo proyecto: ' +
      'analizar la petición del usuario, investigar el sector y la competencia relevante, y traducir ' +
      'todo eso en un brief de requisitos completo y estructurado (objetivo, alcance, funcionalidades ' +
      'clave, restricciones y criterios de aceptación). No escribes código ni tomas decisiones técnicas ' +
      'de implementación — eso es trabajo del Agente Arquitecto, que recibirá tu brief como punto de partida.',
    habilidadesSugeridas: ['busqueda_web'],
  },
  {
    nombre: 'Agente Arquitecto',
    modelo: 'zoco-lab',
    descripcion: 'Diseña toda la estructura técnica, páginas y rutas antes de que se empiece a programar.',
    systemPrompt:
      'Eres el Agente Arquitecto de Zoco IA, el director de orquesta técnico del pipeline. A partir del ' +
      'brief de requisitos del Agente de Investigación, diseñas la estructura completa del proyecto: ' +
      'módulos, páginas/rutas, contratos de API entre frontend y backend, y el esquema de datos de alto ' +
      'nivel. Sé explícito y sin ambigüedad para que el resto del equipo pueda trabajar en paralelo.',
    habilidadesSugeridas: [],
  },
  {
    nombre: 'Agente Diseñador',
    modelo: 'zoco-plus',
    descripcion: 'Define la interfaz visual, los componentes estéticos y la experiencia de usuario (UX/UI).',
    systemPrompt:
      'Eres el Agente Diseñador de Zoco IA. A partir de los planos técnicos del Agente Arquitecto, defines ' +
      'la interfaz visual: paleta de colores, tipografía, jerarquía visual, componentes reutilizables y el ' +
      'flujo de experiencia de usuario (UX) de cada pantalla. No escribes código de producción, solo ' +
      'especificación de diseño.',
    habilidadesSugeridas: [],
  },
  {
    nombre: 'Agente Frontend',
    modelo: 'zoco-plus',
    descripcion: 'Traduce los diseños en código visual interactivo, principalmente con React.',
    systemPrompt:
      'Eres el Agente Frontend de Zoco IA. Tomas los planos técnicos del Agente Arquitecto y la ' +
      'especificación visual del Agente Diseñador, y los traduces en código de interfaz funcional, ' +
      'principalmente con React. Escribes componentes limpios, reutilizables y bien tipados.',
    habilidadesSugeridas: ['ejecutar_codigo'],
  },
  {
    nombre: 'Agente Backend',
    modelo: 'zoco-max',
    descripcion: 'Desarrolla la lógica del servidor y las funciones internas de la aplicación.',
    systemPrompt:
      'Eres el Agente Backend de Zoco IA. Implementas la lógica de servidor siguiendo los planos técnicos ' +
      'del Agente Arquitecto: endpoints, autenticación, validación, reglas de negocio, principalmente sobre ' +
      'entornos Express/Node. Priorizas seguridad y manejo de errores explícito sobre atajos rápidos.',
    habilidadesSugeridas: ['ejecutar_codigo'],
  },
  {
    nombre: 'Agente de Base de Datos',
    modelo: 'zoco-max',
    descripcion: 'Diseña los esquemas y gestiona el almacenamiento de la información.',
    systemPrompt:
      'Eres el Agente de Base de Datos de Zoco IA. Diseñas los esquemas de datos y las estrategias de ' +
      'almacenamiento a partir de los planos técnicos del Agente Arquitecto. Defines colecciones/tablas, ' +
      'índices, relaciones y validaciones a nivel de esquema.',
    habilidadesSugeridas: [],
  },
  {
    nombre: 'Agente de Integraciones',
    modelo: 'zoco-max',
    descripcion: 'Conecta la aplicación con herramientas y APIs de terceros para ampliar sus funcionalidades.',
    systemPrompt:
      'Eres el Agente de Integraciones de Zoco IA. Tu trabajo es conectar la aplicación con herramientas y ' +
      'APIs de terceros (pagos, email, almacenamiento, IA externa, etc.). Usas siempre las credenciales del ' +
      'Almacén de Credenciales de Zoco IA — nunca las escribes en el código en claro.',
    habilidadesSugeridas: [],
  },
  {
    nombre: 'Agente de Control de Calidad',
    modelo: 'zoco-plus',
    descripcion: 'Supervisa que el código cumpla con los estándares técnicos y la calidad esperada (QA).',
    systemPrompt:
      'Eres el Agente de Control de Calidad (QA) de Zoco IA. Revisas el código entregado por el resto del ' +
      'equipo en busca de bugs, malas prácticas y desviaciones respecto a los planos técnicos. Entregas un ' +
      'informe claro con problemas encontrados, su severidad, y una recomendación concreta de corrección.',
    habilidadesSugeridas: [],
  },
  {
    nombre: 'Agente DevOps',
    modelo: 'zoco-max',
    descripcion: 'Automatiza el despliegue, la infraestructura en la nube y la configuración del entorno técnico.',
    systemPrompt:
      'Eres el Agente DevOps de Zoco IA. Te encargas de automatizar el despliegue, la infraestructura y la ' +
      'configuración del entorno técnico para que la aplicación llegue a producción de forma fiable: ' +
      'Dockerfiles, docker-compose, variables de entorno, pipelines de CI/CD.',
    habilidadesSugeridas: [],
  },
  {
    nombre: 'Agente de Pruebas',
    modelo: 'zoco-plus',
    descripcion: 'Ejecuta tests automáticos para asegurar que todas las rutas y botones funcionen exactamente como deben.',
    systemPrompt:
      'Eres el Agente de Pruebas (Testing) de Zoco IA. Escribes y ejecutas tests automáticos —de rutas de ' +
      'API, de componentes de interfaz y de flujos end-to-end— para asegurar que todo funciona exactamente ' +
      'como está especificado en los planos técnicos.',
    habilidadesSugeridas: ['ejecutar_codigo'],
  },
  {
    nombre: 'Agente de Reparación',
    modelo: 'zoco-max',
    descripcion: 'Detecta y soluciona bugs o fallos de código de manera autónoma.',
    systemPrompt:
      'Eres el Agente de Reparación de Zoco IA. Recibes reportes de fallos (del Agente de Pruebas, del ' +
      'Agente de Control de Calidad, o errores reales de ejecución) y trabajas de forma autónoma para ' +
      'localizar la causa raíz y corregirla, devolviendo el código corregido completo.',
    habilidadesSugeridas: ['ejecutar_codigo'],
  },
];

// ---------- 4. LÓGICA DEL SCRIPT ----------------

function loadBetterSqlite3() {
  try {
    return require('better-sqlite3');
  } catch (e) {
    console.error('\n❌ No se encontró el paquete "better-sqlite3". Instálalo con: npm install\n');
    process.exit(1);
  }
}

function resolveUserId(db) {
  if (TARGET_EMAIL) {
    const row = db.prepare('SELECT id, email FROM users WHERE email = ?').get(TARGET_EMAIL);
    if (row) {
      console.log(`ℹ️  Usando el usuario ${row.email} (AGENTS_USER_EMAIL / ADMIN_EMAIL).`);
      return row.id;
    }
    console.warn(`⚠️  No existe ningún usuario con email "${TARGET_EMAIL}". Buscando el primer usuario disponible...`);
  }
  const first = db.prepare('SELECT id, email FROM users ORDER BY created_at ASC LIMIT 1').get();
  if (!first) {
    console.error('\n❌ No hay ningún usuario en la base de datos todavía.');
    console.error('   Registra primero una cuenta (o arranca server.js con ADMIN_EMAIL/ADMIN_PASSWORD)');
    console.error('   para que exista un usuario al que asignar los agentes.\n');
    process.exit(1);
  }
  console.log(`ℹ️  Usando el primer usuario encontrado: ${first.email}`);
  return first.id;
}

function insertResource(db, { userId, type, name, data }) {
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO resources (id, user_id, type, name, data) VALUES (?, ?, ?, ?, ?)'
  ).run(id, userId, type, name, JSON.stringify(data));
  return { id, type, name, data };
}

function main() {
  const force = process.argv.includes('--force');

  if (!fs.existsSync(DB_PATH)) {
    console.error(`\n❌ No se encontró la base de datos en: ${DB_PATH}`);
    console.error('   Ajusta DB_PATH (o RAILWAY_VOLUME_MOUNT_PATH) para que apunte al mismo sitio que usa server.js.\n');
    process.exit(1);
  }

  const Database = loadBetterSqlite3();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  const userId = resolveUserId(db);

  const yaExisten = db
    .prepare("SELECT COUNT(*) as n FROM resources WHERE user_id = ? AND type = 'agente'")
    .get(userId).n;

  if (yaExisten > 0 && !force) {
    console.log(`✅ El usuario ya tiene ${yaExisten} agente(s) creados. No se inserta nada.`);
    console.log('   (Usa "node init-agents.js --force" para insertar igualmente)\n');
    db.close();
    return;
  }

  console.log(`🚀 Creando habilidades, entorno y ${AGENTES.length} agentes...\n`);

  // 1) Habilidades
  const habilidadesCreadas = {};
  for (const h of HABILIDADES) {
    const creado = insertResource(db, {
      userId,
      type: 'habilidad',
      name: h.nombre,
      data: { descripcion: h.descripcion, valor: h.valor },
    });
    habilidadesCreadas[h.valor] = creado.id;
    console.log(`✅ Habilidad "${h.nombre}" → id: ${creado.id}`);
  }

  // 2) Entorno base
  for (const e of ENTORNOS) {
    const creado = insertResource(db, {
      userId,
      type: 'entorno',
      name: e.nombre,
      data: { descripcion: e.descripcion, valor: e.valor },
    });
    console.log(`✅ Entorno "${e.nombre}" → id: ${creado.id}`);
  }

  // 3) Agentes (con las habilidades ya enlazadas por id)
  const idsCreados = {};
  for (const agente of AGENTES) {
    const habilidadesActivas = (agente.habilidadesSugeridas || [])
      .map(valor => habilidadesCreadas[valor])
      .filter(Boolean);

    const creado = insertResource(db, {
      userId,
      type: 'agente',
      name: agente.nombre,
      data: {
        descripcion: agente.descripcion,
        modelo: agente.modelo || DEFAULT_MODEL,
        systemPrompt: agente.systemPrompt,
        habilidadesActivas,
      },
    });
    idsCreados[agente.nombre] = creado.id;
    console.log(`✅ ${agente.nombre} → id: ${creado.id} (modelo: ${agente.modelo || DEFAULT_MODEL})`);
  }

  console.log('\n📋 Resumen de ids creados:');
  console.log(JSON.stringify(idsCreados, null, 2));

  db.close();
}

main();
