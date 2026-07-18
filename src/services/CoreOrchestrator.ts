import fs from 'fs-extra';
import path from 'path';
import { anthropic } from "@workspace/integrations-anthropic-ai";
const isUltraComplex = true;
const projectTier = "ultra";
// ─────────────────────────────────────────────────────────────────────────────
// CoreOrchestrator v2 — "Task Splitting" real para proyectos ultra-complejos
// (ERPs, ecosistemas multi-módulo, sistemas de nivel empresarial).
//
// Diferencias clave frente a v1 (ver historial de git para la versión anterior):
// - Número de hitos DINÁMICO según la complejidad real del proyecto, no fijo en 4.
//   Un ERP necesita modelar cada módulo de negocio por separado (facturación,
//   inventario, clientes, reporting...), no comprimirlo en un solo archivo.
// - claude-sonnet-4-6 en planificación y generación de código, no Haiku — la
//   complejidad real de un sistema empresarial necesita el modelo capaz, no el
//   más rápido.
// - Contexto ACUMULATIVO real: cada hito recibe el código completo (no solo un
//   resumen en texto) de los hitos relevantes ya generados, para mantener
//   coherencia real entre archivos (mismos nombres de campos, mismos tipos).
// - Ejecución SECUENCIAL por capas (DB → Backend → Frontend → Integración),
//   no en paralelo ciego — el backend necesita conocer el esquema de datos ya
//   decidido, no adivinarlo en paralelo.
// - Reusa systemPromptOverrides inyectados desde apps.ts (los mismos prompts de
//   calidad — Zod, JWT, rate limiting, transacciones Prisma, OpenAPI — que ya
//   usa el pipeline estándar), para que un proyecto ultra-complejo no reciba
//   código de menor calidad que uno simple, solo más volumen.
// ─────────────────────────────────────────────────────────────────────────────

const PLANNER_SYSTEM_STATIC = `Eres el Arquitecto de Sistemas Senior de Maris AI. Recibes la idea de un proyecto de ALTA COMPLEJIDAD (sistema empresarial, ERP, ecosistema multi-módulo) y lo divides en hitos de construcción reales y manejables.

PRINCIPIO RECTOR: cada hito debe ser un archivo o conjunto de archivos coherente que un ingeniero senior real escribiría como una unidad — ni demasiado pequeño (no fragmentes en exceso) ni demasiado grande (no comprimas un módulo entero de negocio en un solo archivo).

DECISIÓN DE ARQUITECTURA — TÚ decides "monolith" vs "microservices" analizando el prompt del usuario (este planificador NO recibe ninguna decisión previa de otro agente — decide aquí, con el mismo criterio estricto que usa el resto de la plataforma para mantener coherencia):
Elige "microservices" SOLO cuando se cumplan AMBAS condiciones:
1. El proyecto es genuinamente complejo: varios dominios de negocio claramente independientes (ej: un ERP con facturación + inventario + RRHH + CRM, una plataforma con módulos que escalarían y se desplegarían por separado en una empresa real).
2. El usuario lo pide explícitamente o describe necesidades que solo tienen sentido con servicios independientes (ej: "que cada módulo escale por separado", "arquitectura de microservicios", "cada equipo debe poder desplegar su parte sin afectar al resto").
En CUALQUIER otro caso usa "monolith" (la opción por defecto, casi siempre la correcta): un monolito bien estructurado es más simple de mantener, depurar y desplegar que microservicios prematuros. Ante la duda, "monolith".

ARQUITECTURA — MONOLITO (caso por defecto, casi siempre correcto):
ESTRUCTURA POR CAPAS — genera los hitos agrupados en estas capas, EN ESTE ORDEN (cada capa depende de la anterior):
1. DATA LAYER — esquema de datos completo (todos los modelos/tablas con sus relaciones). Normalmente 1-2 hitos. targetWorkspace: "apps/api".
2. BACKEND CORE — autenticación, middleware, configuración base (helmet, cors, rate limit, logger, errors). 1 hito. targetWorkspace: "apps/api".
3. BACKEND MODULES — un hito POR CADA módulo de negocio real (ej: en un ERP: facturación, inventario, clientes, RRHH, contabilidad serían hitos separados). Esto es lo que hace que un proyecto complejo se modele bien: no comprimas 5 módulos de negocio en 1 archivo. targetWorkspace: "apps/api".
4. INTEGRATIONS — un hito por integración externa relevante si las hay (pagos, email, webhooks). targetWorkspace: "apps/api".
5. FRONTEND CORE — layout, routing, componentes compartidos (Navbar, Sidebar, auth guard). 1-2 hitos. targetWorkspace: "apps/web". OBLIGATORIO: uno de estos hitos debe generar el archivo "App.tsx" (exactamente ese nombre, en la raíz de src/) con la firma EXACTA "export default function App()" como componente raíz que monta el router y el layout — el sistema de testing automático busca específicamente este archivo y este patrón para validar el frontend generado; un nombre o firma distintos (Main, Root, Layout, etc.) hace que esa validación se omita aunque el código sea funcionalmente correcto.
6. FRONTEND MODULES — un hito por cada área funcional del frontend que corresponda a un módulo de backend (dashboard, listados, formularios de cada módulo). targetWorkspace: "apps/web".
7. DOCS — openapi.yaml documentando TODOS los endpoints reales generados en los hitos de backend. targetWorkspace: "apps/api".

ARQUITECTURA — MICROSERVICIOS (solo si decidiste "microservices" arriba):
Cada dominio de negocio independiente se convierte en su PROPIO servicio, NO en módulos dentro de un único "apps/api":
1. Por cada servicio identificado (ej: billing, inventory, customers): un hito DATA LAYER propio con targetWorkspace "services/<nombre-servicio>" y su propio esquema — los servicios NO comparten base de datos entre ellos (principio fundamental de microservicios reales).
2. Por cada servicio: un hito BACKEND CORE propio (su propio index.ts, su propio middleware, su propio package.json) — cada servicio es una app Express independiente y desplegable por separado, con targetWorkspace "services/<nombre-servicio>" y serviceName "<nombre-servicio>".
3. Por cada servicio: hito(s) BACKEND MODULE con la lógica de ese dominio — targetWorkspace "services/<nombre-servicio>".
4. Si un servicio necesita datos de otro (ej: facturación necesita el precio de inventory), el hito debe especificarlo en su description como "llama a la API HTTP de inventory en process.env.INVENTORY_SERVICE_URL" — NUNCA importar código directamente entre servicios ni compartir su base de datos.
5. Un hito adicional "packages/shared" con tipos/contratos TypeScript compartidos (ej: la forma de los eventos o payloads entre servicios) — esto SÍ se comparte, el código de negocio NO.
6. FRONTEND: igual que en monolito, pero las llamadas API del frontend deben distribuirse entre los distintos servicios según corresponda (ej: el frontend llama a billing-service para facturas, a inventory-service para stock) — documentar esto en la description del hito de cliente API del frontend.
7. Un hito final "docs" describiendo en un README.md la topología de servicios (qué servicio expone qué API, en qué puerto/URL se espera cada uno en desarrollo).
8. Un hito adicional "docs" (targetWorkspace "." — convención para la raíz del proyecto, fuera de apps/services/packages, filePath "docker-compose.yml") con un docker-compose real: un servicio Docker por cada microservicio generado (build desde su propio Dockerfile en services/<nombre>, puerto mapeado, variables de entorno con las URLs de los OTROS servicios inyectadas vía environment), MÁS un contenedor de base de datos por cada base de datos distinta que usen los servicios (postgres:16 / mongo:7 según corresponda, con su propio volumen para persistencia). Esto es lo que de verdad distingue "carpetas separadas" de "microservicios que el usuario puede levantar y probar juntos con un solo comando" (docker compose up). Genera también, por cada servicio, su Dockerfile mínimo (node:20-alpine, copy, npm install, npm run build, CMD) como un hito propio con targetWorkspace "services/<nombre-servicio>" y filePath "Dockerfile".

NÚMERO DE HITOS: no hay un número fijo. Un proyecto "ultra-complejo" real necesita entre 8 y 20 hitos en monolito, o más en microservicios (cada servicio repite su propia mini-estructura data+core+module). NO comprimas para reducir el número — eso es exactamente el error que produce sistemas incompletos.

Cada hito debe especificar "dependsOn": [ids de hitos que debe ver como contexto antes de generarse]. Por ejemplo, un módulo de backend depende del hito de la capa DATA de SU MISMO servicio (nunca de la capa DATA de otro servicio, en microservicios — esa dependencia debe ser por HTTP en runtime, no por contexto de generación).

STACK TECNOLÓGICO:
- Si el proyecto tiene transacciones multi-tabla críticas (pagos+stock, facturación, contabilidad): PostgreSQL + Prisma. En microservicios, esta decisión es POR SERVICIO — un servicio puede usar Postgres y otro Mongo, según lo que ese dominio concreto necesite.
- En el resto de casos: MongoDB + Mongoose.
- Backend: Node.js + Express + TypeScript + Zod.
- Frontend WEB (caso por defecto): React + TypeScript + Tailwind CSS.
- Frontend MÓVIL NATIVO ("platform":"mobile-native"): SOLO si el usuario pide explícitamente App Store/Google Play/app nativa/iOS/Android nativo. En ese caso usa React Native + Expo + TypeScript + React Navigation en vez de React+Tailwind para todos los hitos de capa frontend-core/frontend-module — sin Tailwind (no aplica igual en RN), sin vercel.json. Por defecto y ante la duda usa "web".

Devuelve ÚNICAMENTE un objeto JSON con este formato exacto:
{
  "database": "mongodb" | "postgresql",
  "platform": "web" | "mobile-native",
  "architecture": "monolith" | "microservices",
  "milestones": [
    { "id": 1, "layer": "data", "name": "Esquema de datos — Facturación", "targetWorkspace": "apps/api", "description": "Modelos Invoice, InvoiceLine, Customer con relaciones...", "filePath": "src/models/billing.ts", "dependsOn": [] },
    { "id": 2, "layer": "backend-core", "name": "Configuración base del servidor", "targetWorkspace": "apps/api", "description": "...", "filePath": "src/index.ts", "dependsOn": [1] },
    { "id": 3, "layer": "backend-module", "name": "Módulo de Facturación — API", "targetWorkspace": "apps/api", "description": "Endpoints CRUD + lógica de negocio de facturación, usando prisma.$transaction para emitir facturas y descontar stock atómicamente...", "filePath": "src/routes/billing.ts", "dependsOn": [1, 2] }
  ]
}
Ejemplo de un hito en arquitectura microservicios: { "id": 5, "layer": "backend-core", "name": "Inventory Service — núcleo", "targetWorkspace": "services/inventory", "serviceName": "inventory", "description": "Servidor Express independiente para el dominio de inventario, su propio package.json y .env.example con su propio puerto/DATABASE_URL", "filePath": "src/index.ts", "dependsOn": [4] }`;

const CODE_AGENT_STATIC = `Eres el Ingeniero de Software Senior de Maris AI, especializado en sistemas empresariales complejos.

REGLAS DE GENERACIÓN:
- Genera EXCLUSIVAMENTE el código fuente del archivo solicitado. Sin explicaciones, sin markdown, sin backticks.
- Código TypeScript real, completo y funcional. CERO TODOs, CERO stubs, CERO placeholders tipo "// implementar después".
- TRANSACCIONES ATÓMICAS — REGLA CRÍTICA, EVALÚALA TÚ MISMO EN CADA ENDPOINT, no esperes a que la descripción del hito use la palabra "transacción": cualquier operación que (a) modifique un SALDO/BALANCE/CRÉDITO de dinero real, (b) descuente o reserve INVENTARIO/STOCK compartido entre usuarios, (c) escriba en 2+ tablas/colecciones relacionadas donde una mitad sin la otra deja datos inconsistentes (ej. crear un pago Y actualizar el saldo del usuario; crear una apuesta Y descontar el saldo Y reservar la cuota), DEBE envolverse en una transacción real (\`prisma.$transaction([...])\` o una sesión de Mongoose con \`startTransaction()\`/\`commitTransaction()\`/\`abortTransaction()\`) — NUNCA dos escrituras sueltas seguidas sin esa garantía, aunque la descripción del hito no use la palabra "transaccional" explícitamente. ENCONTRADO en producción: depender de que el planificador mencionara la palabra correcta era frágil — un hito de "Apuestas y boleto" o "Depósitos y retiros" implica dinero real igual que uno que dijera literalmente "operación transaccional", y debe tratarse con el mismo rigor sin que nadie lo tenga que pedir con esas palabras exactas.
- Usa exactamente los nombres de campos, modelos y rutas que aparecen en el CONTEXTO DE HITOS ANTERIORES que se te proporciona — la coherencia entre archivos es la diferencia entre un sistema que funciona y uno que no.
- Validación con Zod en cada endpoint que reciba datos.
- Todos los textos de UI y mensajes de error en español (es-ES).
- Sigue el QUALITY BAR adicional si se proporciona en el mensaje de usuario (reglas específicas de seguridad, paginación, auditoría, etc.).

REGLAS CRÍTICAS DE LA PLATAFORMA (frontend con wouter) — incumplirlas produce un build que compila pero se ve roto (pantalla en blanco, 404 persistente, navegación que no funciona) sin que ningún validador de sintaxis lo detecte. ENCONTRADO en producción: estas reglas faltaban en este prompt concreto, distinto del usado en generación de una sola pasada, y eso causó exactamente este tipo de fallo en proyectos reales generados por hitos.

WOUTER v3 — \`<Link>\` ITSELF renders as the anchor tag. NEVER nest \`<a>\` (or \`<button>\`) inside \`<Link>\` — produces invalid \`<a><a>…</a></a>\` markup that crashes at runtime. Pass \`className\`/\`onClick\`/\`aria-label\` DIRECTLY to \`<Link>\`:
- WRONG: \`<Link href="/x"><a className="btn">Ir</a></Link>\`
- RIGHT: \`<Link href="/x" className="btn">Ir</Link>\`
The same applies to \`<Route>\` — render children directly, never wrap in \`<a>\`.
PROGRAMMATIC NAVIGATION — wouter has NO \`useNavigate\` or \`useHistory\` (those are react-router-dom). Importing either from "wouter" crashes the ENTIRE app at load with "module does not provide an export named...", before any component renders. Use \`const [, setLocation] = useLocation();\` then \`setLocation("/path")\`.
ROUTER ORDER — REGLA CRÍTICA (produce página en blanco/404 si se incumple): en el \`<Switch>\`, el catch-all que renderiza NotFound/404 DEBE ser SIEMPRE el ÚLTIMO elemento. Si lo colocas antes de las rutas reales, wouter lo evalúa primero y TODAS las rutas muestran 404:
  \`<Switch>
    <Route path="/" component={Home} />
    <Route path="/seccion-1" component={Seccion1} />
    {/* ÚLTIMO SIEMPRE — nunca antes de las rutas reales */}
    <Route component={NotFound} />
  </Switch>\`
EXPORTS & IMPORTS — cada \`import { X }\` debe coincidir con un \`export { X }\`/\`export function X\`/\`export const X\` real en el archivo destino. Cada \`import X from\` debe coincidir con un \`export default\`. Mezclar ambos da \`undefined\` y React no renderiza nada.`;

interface Milestone {
  id: number;
  layer: string;
  name: string;
  // Antes era un enum fijo de 4 valores (solo monolito). Ahora string libre
  // con convención: "apps/web" (frontend), "apps/api" (backend monolito),
  // "services/<nombre>" (un microservicio independiente, con su propia base
  // de datos y API — solo cuando plan.architecture === "microservices"),
  // "packages/shared" (código compartido entre servicios, ej. tipos comunes).
  targetWorkspace: string;
  /** Si pertenece a un microservicio, su nombre corto (ej. "billing", "inventory").
   *  Indiferente/undefined en arquitectura monolito. */
  serviceName?: string;
  description: string;
  filePath: string;
  dependsOn: number[];
}

interface GeneratedMilestone extends Milestone {
  code: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODO EDICIÓN POR HITOS — extensión para proyectos YA EXISTENTES (importados
// de otra IA, o cualquier proyecto previo de Maris AI), con el mismo rigor que
// buildProjectIncremental pero sin partir de cero: cada hito puede ser
// "modify_file" (toca un archivo real ya existente, recibiendo su contenido
// COMPLETO actual como contexto obligatorio para no perder nada) o
// "create_file" (archivo nuevo necesario para el cambio pedido, igual que un
// hito normal de construcción). A petición explícita del usuario tras varios
// incidentes reales con proyectos importados (ej. "club de swingers en
// Valencia") que se quedaban atascados en el límite de tokens del pipeline de
// edición de una sola pasada (singleEditPass) — la causa raíz era que ESE
// pipeline nunca trocea el trabajo, mientras que la construcción nueva sí lo
// hace desde el principio vía CoreOrchestrator. Esta extensión da a las
// ediciones el mismo troceo real por hitos pequeños que ya tiene la
// construcción nueva, eliminando el cuello de botella de fondo.
// ─────────────────────────────────────────────────────────────────────────────

interface EditMilestone {
  id: number;
  action: "modify_file" | "create_file";
  /** Ruta EXACTA tal como aparece en el bundle actual (// === FILE: <path> ===). */
  filePath: string;
  /** Qué cambiar en este archivo concreto — instrucción específica, no el prompt genérico del usuario. */
  description: string;
  dependsOn: number[];
}

interface GeneratedEditMilestone extends EditMilestone {
  code: string;
}

const EDIT_PLANNER_SYSTEM_STATIC = `Eres el Arquitecto de Sistemas Senior de Maris AI. Recibes una petición de MODIFICACIÓN sobre un proyecto que YA EXISTE (no es un proyecto nuevo) y la divides en hitos de edición reales y manejables.

PRINCIPIO RECTOR: NUNCA pierdas código existente. Cada hito debe describir el cambio CONCRETO que hay que hacer en UN archivo, no reescribir el proyecto entero. Si un archivo no necesita tocarse para cumplir la petición del usuario, NO generes un hito para él — solo incluye los archivos que de verdad hay que crear o modificar.

Recibirás la lista de archivos que YA EXISTEN en el proyecto (solo sus rutas, sin contenido — el contenido se te dará después, archivo por archivo, cuando se genere ese hito concreto). Con esa lista y la petición del usuario, decide:
- "modify_file": el cambio afecta a un archivo de la lista que YA EXISTE. Usa la ruta EXACTA tal como aparece en la lista.
- "create_file": el cambio necesita un archivo que NO está en la lista (ej. un componente nuevo, una ruta backend nueva).

NÚMERO DE HITOS: tantos como archivos distintos haya que tocar o crear — ni más ni menos. Una corrección de un bug visual puede ser 1-3 hitos; una funcionalidad nueva mediana puede ser 4-10. No fragmentes en exceso (no dividas un mismo archivo en varios hitos) ni comprimas en exceso (no metas cambios de archivos no relacionados en un mismo hito).

DIAGNÓSTICO CRÍTICO — BUG 404 / PANTALLA EN BLANCO (el caso más frecuente en reparaciones):
Cuando el problema es "la app muestra 404 en la ruta /" o "pantalla en blanco", la causa raíz es SIEMPRE una de estas tres, en este orden de probabilidad:
1. CATCH-ALL 404 ANTES DE LA RUTA RAÍZ: el router tiene una ruta catch-all o 404 (<Route path="*"> o <Route component={NotFound}>) colocada ANTES de <Route path="/"> — el router la evalúa primero y nunca llega a la ruta real. FIX: mover el catch-all al ÚLTIMO lugar de la lista de rutas.
2. COMPONENTE RAÍZ VACÍO O CON ERROR: App.tsx o el componente raíz de la ruta "/" está vacío, retorna null, o tiene un error de compilación que impide que React lo monte. FIX: reconstruir el componente con contenido real visible.
3. IMPORT ROTO: el componente que debería renderizarse en "/" importa algo que no existe (ruta incorrecta, nombre de archivo con distinta capitalización). FIX: corregir el import.
PARA BUG 404: SIEMPRE incluye src/App.tsx (o el archivo de router que exista) como primer hito modify_file con la descripción técnica exacta del fix.

Cada hito debe especificar "dependsOn": [ids de otros hitos de ESTA MISMA edición cuyo resultado necesita ver como contexto antes de generarse] — por ejemplo, si un hito de frontend depende de un endpoint nuevo creado en otro hito de backend en esta misma edición.

Devuelve ÚNICAMENTE un objeto JSON con este formato exacto:
{
  "milestones": [
    { "id": 1, "action": "modify_file", "filePath": "src/App.tsx", "description": "La ruta raíz '/' muestra 404 porque el catch-all <Route path='*' component={NotFound}/> está colocado ANTES de las rutas reales. Mover el catch-all al final de la lista de rutas. Verificar que <Route path='/' component={Dashboard}/> (o el componente principal) esté presente y sea el primero.", "dependsOn": [] },
    { "id": 2, "action": "modify_file", "filePath": "src/pages/HomePage.tsx", "description": "El componente de la ruta raíz estaba vacío — rellenarlo con el contenido real del dashboard de la clínica dental: métricas, pacientes del día, citas próximas.", "dependsOn": [1] }
  ]
}`;

const EDIT_CODE_AGENT_STATIC = `Eres el Ingeniero de Software Senior de Maris AI, especializado en EDITAR código existente sin perder nada que no se haya pedido cambiar.

REGLAS DE GENERACIÓN:
- Genera EXCLUSIVAMENTE el código fuente COMPLETO y final del archivo solicitado (el archivo entero, ya con el cambio aplicado) — sin explicaciones, sin markdown, sin backticks.
- Si el hito es "modify_file", se te da el CONTENIDO ACTUAL completo del archivo. Tu trabajo es devolver ese mismo archivo con el cambio pedido aplicado, conservando TODO lo que no esté relacionado con el cambio — imports, componentes, lógica, comentarios. NUNCA borres funcionalidad existente que no se pidió tocar.
- Si el hito es "create_file", el archivo es nuevo: escríbelo completo y coherente con las convenciones del resto del proyecto (mismo estilo de imports, mismas librerías ya usadas).
- Código TypeScript/JavaScript real, completo y funcional. CERO TODOs, CERO stubs, CERO placeholders tipo "// implementar después".
- TRANSACCIONES ATÓMICAS — REGLA CRÍTICA, EVALÚALA TÚ MISMO EN CADA ENDPOINT que toques o crees, no esperes a que la descripción del hito use la palabra "transacción": cualquier operación que (a) modifique un SALDO/BALANCE/CRÉDITO de dinero real, (b) descuente o reserve INVENTARIO/STOCK compartido entre usuarios, (c) escriba en 2+ tablas/colecciones relacionadas donde una mitad sin la otra deja datos inconsistentes, DEBE envolverse en una transacción real (\`prisma.$transaction([...])\` o una sesión de Mongoose con \`startTransaction()\`/\`commitTransaction()\`/\`abortTransaction()\`) — NUNCA dos escrituras sueltas seguidas sin esa garantía.
- Usa exactamente los nombres de componentes, funciones y rutas que aparecen en el CONTEXTO DE HITOS ANTERIORES o en el ARCHIVO ACTUAL que se te proporciona — la coherencia con el resto del proyecto es crítica.

REGLAS CRÍTICAS DE LA PLATAFORMA — incumplirlas produce un build roto que será descartado y deja al cliente sin el arreglo (mismas reglas que usa el generador de proyectos nuevos, OBLIGATORIAS también aquí):

WOUTER v3 (router de la app) — \`<Link>\` ITSELF renders as the anchor tag. NUNCA anidar \`<a>\` (ni \`<button>\`) dentro de \`<Link>\` — produce \`<a><a>…</a></a>\` inválido que rompe en runtime. Pasa \`className\`/\`onClick\`/\`aria-label\` DIRECTAMENTE a \`<Link>\`:
- MAL: \`<Link href="/x"><a className="btn">Ir</a></Link>\`
- BIEN: \`<Link href="/x" className="btn">Ir</Link>\`
Lo mismo aplica a \`<Route>\` — renderiza los hijos directamente, sin envolver en \`<a>\`.
NAVEGACIÓN PROGRAMÁTICA — wouter NO TIENE \`useNavigate\` ni \`useHistory\` (son de react-router-dom). Importarlos desde "wouter" rompe TODA la app al cargar con "module does not provide an export named...", antes de que cualquier componente renderice. Usa: \`const [, setLocation] = useLocation();\` y luego \`setLocation("/path")\`.
PARÁMETROS DE RUTA — wouter NO TIENE \`useParams\` (es de react-router-dom). Usa: \`const [match, params] = useRoute("/path/:id");\` y luego \`params.id\`.
ORDEN DEL ROUTER — REGLA CRÍTICA (produce página en blanco/404 si se incumple): en el \`<Switch>\`, el catch-all que renderiza NotFound/404 DEBE ser SIEMPRE el ÚLTIMO elemento. Si lo colocas antes de las rutas reales, wouter lo evalúa primero y TODAS las rutas muestran 404:
  \`<Switch>
    <Route path="/" component={Home} />
    <Route path="/seccion-1" component={Seccion1} />
    {/* ÚLTIMO SIEMPRE — nunca antes de las rutas reales */}
    <Route component={NotFound} />
  </Switch>\`
EXPORTS & IMPORTS — cada \`import { X }\` debe coincidir con un \`export { X }\`/\`export function X\`/\`export const X\` real en el archivo destino. Cada \`import X from\` debe coincidir con un \`export default\`. Mezclar ambos da \`undefined\` y React no renderiza nada.`;

export interface CoreOrchestratorOptions {
  /** Prompt de calidad adicional (las reglas de BACKEND_SYSTEM_PROMPT / BACKEND_SYSTEM_PROMPT_POSTGRES
   *  de apps.ts) para que los hitos de backend usen el mismo quality bar que el pipeline estándar. */
  backendQualityPrompt?: string;
  /** Modelo a usar — por defecto el más capaz disponible para proyectos complejos. */
  model?: string;
  /**
   * Máximo de hitos a generar en paralelo dentro de la misma capa (las
   * capas en sí son secuenciales, por las dependencias reales entre ellas
   * — ej. no se puede generar el frontend antes de que termine el backend
   * que consume). Subido de 4 a 8 (por defecto) a petición explícita del
   * usuario tras un incidente real con un cliente: con 22 hitos repartidos
   * en 7 capas (~3 por capa de media), muchas capas ya cabían en un solo
   * lote con concurrencia 4, pero las capas con más hitos (ej. todos los
   * módulos de backend de un dominio complejo) se beneficiaban de más
   * paralelismo real. El límite global de jobs simultáneos en toda la
   * plataforma (JOB_CONCURRENCY, hasta 25) es independiente de este valor
   * — esta concurrencia es DENTRO de un único job, así que subirla no
   * compite contra ese límite ni dispara más jobs en paralelo de los que
   * ya había, solo acelera el trabajo interno de uno que ya estaba activo.
   */
  concurrencyPerLayer?: number;
  /**
   * Si se especifica, el planificador NO puede generar más hitos que este
   * número. Usado para degradar proyectos ultra-complejos a un subconjunto
   * manejable cuando el usuario no ha pagado nunca (hasEverPaid=false) —
   * estrategia de conversión: genera el núcleo funcional de la app con un
   * coste de tokens mucho menor, y la interfaz le ofrece "expandir a la
   * arquitectura completa" a cambio de activar su primer plan de pago.
   * undefined = sin límite (comportamiento por defecto para usuarios de pago).
   */
  maxMilestonesOverride?: number;
  /**
   * Callback llamado cuando un hito agota todos sus intentos y cae al placeholder.
   * Se usa para enviar alertas al admin (WhatsApp + email) con los datos del fallo.
   * Si no se pasa, el fallo se registra solo en consola/logs.
   */
  onMilestoneStuck?: (opts: {
    milestoneName: string;
    layer: string;
    attempts: number;
    lastError: string;
  }) => void | Promise<void>;
  /**
   * Función de validación esbuild para comprobar el bundle de frontend al
   * terminar cada capa frontend. Si no se pasa, la validación por capa se
   * omite silenciosamente (comportamiento backward-compatible). Se pasa
   * desde apps.ts para reutilizar el mismo validador que el resto del pipeline.
   * 'issues' trae el archivo como campo estructurado (issue.file, formato
   * "appforge-vfs:src/...", tal cual lo reporta esbuild) en vez de un string
   * libre — evita tener que extraerlo con una regex frágil sobre un mensaje
   * con formato no garantizado.
   */
  validateFrontendBundle?: (bundle: string) => Promise<{ ok: boolean; issues: Array<{ file: string; message: string }> }>;
}

const LAYER_ORDER = ["data", "backend-core", "backend-module", "integration", "frontend-core", "frontend-module", "docs"];

export class CoreOrchestrator {
  private projectRoot: string;
  private generatedByMilestoneId: Map<number, GeneratedMilestone> = new Map();
  private options: CoreOrchestratorOptions;

  constructor(projectRoot: string, options: CoreOrchestratorOptions = {}) {
    this.projectRoot = projectRoot;
    this.options = {
      model: options.model ?? "claude-sonnet-4-6",
      concurrencyPerLayer: options.concurrencyPerLayer ?? 8,
      backendQualityPrompt: options.backendQualityPrompt ?? "",
      maxMilestonesOverride: options.maxMilestonesOverride,
    };
  }

  private cleanJsonResponse(text: string): string {
    // ENCONTRADO en producción (job 6a41707651a370bb964b513d y varios más,
    // mismo error repetido 5 veces consecutivas hasta agotar reintentos):
    // la regex original solo reconocía un bloque ```json ... ``` CERRADO.
    // Cuando la respuesta del planificador se trunca por max_tokens antes
    // de llegar al ``` de cierre (proyectos muy complejos, como
    // "FootballValue" con scraping+ML+múltiples módulos de apuestas), la
    // regex no encontraba coincidencia y el código caía a `text.trim()`,
    // devolviendo el texto CON el prefijo ```json todavía pegado —
    // JSON.parse fallaba con "Unexpected token '`'" de forma determinista
    // en cada uno de los 5 reintentos automáticos, porque la causa (el
    // texto truncado) era la misma cada vez. Ahora se quita el prefijo
    // ```json (o ```) exista o no el cierre, y se quita un ``` de cierre
    // solo si está presente.
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "");
    cleaned = cleaned.replace(/\s*```\s*$/, "");
    return cleaned.trim();
  }

  /**
   * FASE 1: PLANIFICACIÓN — divide el proyecto en hitos reales, en número
   * dinámico según la complejidad, agrupados por capas con dependencias.
   */
  async planMonorepoProject(userPrompt: string): Promise<{ database: "mongodb" | "postgresql"; platform: "web" | "mobile-native"; architecture: "monolith" | "microservices"; milestones: Milestone[] }> {
    // ENCONTRADO en producción (cliente real atascado, error confirmado en
    // el log exacto de Railway con stack trace completo): "Streaming is
    // required for operations that may take longer than 10 minutes" — un
    // rechazo duro del SDK de Anthropic en TypeScript (no del backend) para
    // llamadas NO-streaming cuando max_tokens es alto, porque ese tipo de
    // llamada puede tardar más de los 10 minutos que soporta una conexión
    // HTTP normal sin streaming. Subir max_tokens (necesario para evitar el
    // truncamiento del JSON, corregido en un fix anterior) hizo este error
    // más probable, no menos. FIX: .stream({...}).finalMessage() — devuelve
    // exactamente el mismo objeto Message completo que .create(), con la
    // única diferencia de que usa Server-Sent Events por debajo (mantiene
    // la conexión viva con eventos en vez de esperar en silencio), evitando
    // el límite de 10 minutos sin cambiar nada del resto de esta función.

    // PLAN GRATUITO — FACHADA INTERACTIVA (maxMilestonesOverride activo):
    // En vez de dejar que el arquitecto diseñe un plan de 20+ hitos y luego
    // truncarlo mecánicamente (lo que genera dependencias rotas y estructura
    // incompleta), inyectamos las instrucciones directamente en el prompt
    // para que el arquitecto piense desde el principio en términos de impacto
    // visual máximo con recursos mínimos — la estrategia real que usa Emergent.sh.
    // El usuario gratuito ve una app atractiva, funcional e impactante en
    // segundos. Si quiere la arquitectura completa con backend real, BD y
    // todos los módulos, pasa a plan de pago.
    const FREE_TIER_ARCHITECT_DIRECTIVE = this.options.maxMilestonesOverride
      ? `\n\n[DIRECTIVA PLAN GRATUITO — MÁXIMO ${this.options.maxMilestonesOverride} HITOS — LEE ESTO PRIMERO]\nEste proyecto se genera para un usuario del plan gratuito. Tu objetivo es IMPACTO VISUAL INMEDIATO con el mínimo de archivos posible. Sigue estas reglas estrictamente:

ARQUITECTURA OBLIGATORIA — "Fachada Interactiva" (Mocked Full-Stack):
- SIEMPRE "monolith" (nunca microservicios en plan gratuito).
- SIEMPRE "mongodb" como base de datos (más simple de simular).
- El backend completo en UN SOLO archivo: apps/api/src/index.ts (servidor Express mínimo, <50 líneas, solo levanta el puerto y tiene 2-3 rutas GET que devuelven JSON estático). Sin modelos, sin controladores, sin servicios separados.
- El frontend en 4-5 archivos máximo: main.tsx (punto de entrada), App.tsx (router con wouter, catch-all AL FINAL), mockData.ts (datos simulados), y 1-2 páginas visuales (Home.tsx, Dashboard.tsx o la equivalente al dominio pedido).

REGLAS DE IMPACTO VISUAL (obligatorias en todos los hitos de frontend):
- mockData.ts: arrays de objetos con datos realistas del dominio (usuarios, productos, reservas, etc.) + funciones con setTimeout para simular latencia de red. CERO llamadas reales a la BD — todo el estado vive en memoria mientras el usuario navega.
- Imágenes REALES: usa SIEMPRE URLs de Unsplash con palabras clave del dominio (formato: https://images.unsplash.com/photo-XXXXXXXX?w=800&q=80). NUNCA placeholder.it, NUNCA URLs inventadas, NUNCA "imagen de ejemplo". Una fotografía real cambia completamente la percepción de calidad del usuario.
- Tailwind CSS intensivo: botones con hover, tarjetas con sombra, gradientes, iconos SVG inline o de lucide-react. La app debe parecer un producto real de startup desde el primer segundo.
- Navegación fluida: el router de App.tsx debe permitir ir de la pantalla principal al dashboard/panel interior sin recargas.

ESTRUCTURA DE HITOS RECOMENDADA (máximo ${this.options.maxMilestonesOverride}):
1. mockData.ts — datos simulados del dominio (layer: "data", targetWorkspace: "apps/web")
2. server/index.ts — backend Express mínimo con 2-3 rutas GET estáticas (layer: "backend-core", targetWorkspace: "apps/api")
3. App.tsx — router principal con wouter, layout base, catch-all AL FINAL (layer: "frontend-core", targetWorkspace: "apps/web")
4. Home.tsx — pantalla principal con hero visual, imágenes Unsplash, botones atractivos (layer: "frontend-module", targetWorkspace: "apps/web")
5. Dashboard.tsx o la página interior equivalente — panel con datos del mockData, tablas/tarjetas interactivas (layer: "frontend-module", targetWorkspace: "apps/web")
Puedes añadir 1-2 hitos más si el dominio lo requiere (ej. una página de detalle o un formulario de contacto), pero NUNCA superes el límite de ${this.options.maxMilestonesOverride} hitos totales.

PROHIBICIONES ABSOLUTAS en plan gratuito:
- NO generes hitos de modelos de BD separados (schemas Mongoose/Prisma).
- NO generes middleware, auth, servicios, controladores como archivos separados.
- NO uses URLs de imágenes inventadas o placeholder.
- NO coloques el catch-all de wouter antes de las rutas reales (produce 404 en toda la app).
[FIN DIRECTIVA PLAN GRATUITO]\n`
      : "";

    const enrichedPrompt = FREE_TIER_ARCHITECT_DIRECTIVE + userPrompt;

    // Timeout de 120s para la planificación inicial — es una llamada más larga
    // que las de generación de código (hasta 24K tokens de salida) pero igualmente
    // vulnerable a congelarse si Anthropic tiene un pico de carga.
    const planAbortController = new AbortController();
    const planTimeoutId = setTimeout(() => {
      planAbortController.abort();
      console.warn("⏰ Timeout 120s en planMonorepoProject — abortando planificación");
    }, 120_000);
    let planResponse: any;
    try {
    planResponse = await anthropic.messages.stream({
      model: this.options.model!,
      // ENCONTRADO en producción: 4000 tokens (luego subido a 8000) seguían
      // resultando insuficientes para planificar proyectos verdaderamente
      // "ultra complejos" (score >= 10 — ej. un tipster deportivo con
      // scraping + ML + múltiples módulos de apuestas + frontend, score 14
      // confirmado en logs reales) — la respuesta se truncaba a mitad del
      // JSON antes de cerrar el bloque ```json, causando el bug de parseo
      // ya corregido en cleanJsonResponse (que ahora además maneja el caso
      // de truncamiento aunque vuelva a ocurrir). A petición explícita del
      // usuario tras un incidente real con un cliente, se sube a un valor
      // con mucho más margen — confirmado contra la documentación oficial
      // de Anthropic que claude-sonnet-4-6 soporta hasta 64.000 tokens de
      // salida en la API síncrona; 24.000 da margen real de sobra para
      // listar decenas de hitos con sus dependencias sin acercarse al
      // límite absoluto del modelo (evitando coste/latencia innecesarios
      // de pedir el máximo posible cuando no hace falta).
      max_tokens: 24000,
      system: [{ type: "text", text: PLANNER_SYSTEM_STATIC, cache_control: { type: "ephemeral" } }] as any,
      messages: [{ role: "user", content: enrichedPrompt }],
    }, { signal: planAbortController.signal as any }).finalMessage();
    } finally {
      clearTimeout(planTimeoutId);
    }
    const response = planResponse;

    const rawText = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const cleanedJson = this.cleanJsonResponse(rawText);

    try {
      const result = JSON.parse(cleanedJson);
      let milestones: Milestone[] = (result.milestones || []).map((m: any) => ({
        ...m,
        targetWorkspace: typeof m.targetWorkspace === "string" ? m.targetWorkspace : "apps/api",
        dependsOn: Array.isArray(m.dependsOn) ? m.dependsOn : [],
      }));
      // DEGRADACIÓN PARA USUARIOS GRATUITOS: si maxMilestonesOverride está
      // activo (viene de apps.ts cuando hasEverPaid=false en un proyecto
      // ultra-complejo), truncar la lista de hitos al máximo permitido.
      // Se conservan los hitos de las capas más críticas primero (data →
      // backend-core → frontend-core) según LAYER_ORDER, priorizando lo
      // que da una app visible y funcional con el mínimo de tokens.
      if (this.options.maxMilestonesOverride && milestones.length > this.options.maxMilestonesOverride) {
        const layerPriority = ["data", "backend-core", "frontend-core", "backend-module", "frontend-module", "integration", "docs"];
        milestones = milestones
          .slice()
          .sort((a, b) => (layerPriority.indexOf(a.layer) - layerPriority.indexOf(b.layer)))
          .slice(0, this.options.maxMilestonesOverride);
        console.warn(`[maxMilestonesOverride] Plan de ${result.milestones.length} hitos reducido a ${milestones.length} para usuario gratuito.`);
      }
      return {
        database: result.database === "postgresql" ? "postgresql" : "mongodb",
        platform: result.platform === "mobile-native" ? "mobile-native" : "web",
        architecture: result.architecture === "microservices" ? "microservices" : "monolith",
        milestones,
      };
    } catch (error) {
      // ENCONTRADO en producción (causa raíz real ya corregida en
      // apps.ts — un prompt de EDICIÓN, con un reporte largo pegado,
      // se enrutó por error a este planificador de PROYECTOS NUEVOS,
      // que respondió con texto conversacional, 'Analizando...', en
      // vez de JSON puro): como red de seguridad adicional para
      // cualquier otro caso futuro donde el modelo antepusiera texto
      // explicativo a pesar de la instrucción de "ÚNICAMENTE JSON",
      // se intenta una segunda extracción — buscar el primer bloque
      // {...} balanceado dentro del texto completo — antes de
      // rendirse. Esto no sustituye el fix de la causa raíz, es una
      // capa extra de tolerancia para no perder el job entero si el
      // JSON real sí está presente, solo rodeado de texto.
      const extracted = this.extractFirstJsonObject(rawText);
      if (extracted) {
        try {
          const result = JSON.parse(extracted);
          let milestones: Milestone[] = (result.milestones || []).map((m: any) => ({
            ...m,
            targetWorkspace: typeof m.targetWorkspace === "string" ? m.targetWorkspace : "apps/api",
            dependsOn: Array.isArray(m.dependsOn) ? m.dependsOn : [],
          }));
          if (this.options.maxMilestonesOverride && milestones.length > this.options.maxMilestonesOverride) {
            const layerPriority = ["data", "backend-core", "frontend-core", "backend-module", "frontend-module", "integration", "docs"];
            milestones = milestones
              .slice()
              .sort((a, b) => (layerPriority.indexOf(a.layer) - layerPriority.indexOf(b.layer)))
              .slice(0, this.options.maxMilestonesOverride);
            console.warn(`[maxMilestonesOverride fallback] Plan reducido a ${milestones.length} hitos para usuario gratuito.`);
          }
          console.warn("⚠️ El planificador devolvió texto junto al JSON — se recuperó el objeto JSON embebido correctamente.");
          return {
            database: result.database === "postgresql" ? "postgresql" : "mongodb",
            platform: result.platform === "mobile-native" ? "mobile-native" : "web",
            architecture: result.architecture === "microservices" ? "microservices" : "monolith",
            milestones,
          };
        } catch {
          // El bloque extraído tampoco era JSON válido — cae al error final de abajo.
        }
      }
      console.error("❌ Error parseando JSON de la planificación de hitos:", error);
      throw new Error("No se pudo generar el plan de hitos — respuesta del planificador inválida.");
    }
  }

  /**
   * Busca el primer objeto JSON balanceado ({...}) dentro de un texto que
   * puede contener contenido conversacional antes o después — red de
   * seguridad para cuando el modelo no sigue al pie de la letra la
   * instrucción de "devuelve ÚNICAMENTE JSON". Cuenta llaves respetando
   * strings entre comillas (para no confundir una "}" dentro de un string
   * con el cierre real del objeto).
   */
  private extractFirstJsonObject(text: string): string | null {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === "\\") {
        escapeNext = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  /** Construye el bloque de contexto con el código real de los hitos en los que depende uno nuevo. */
  private buildDependencyContext(milestone: Milestone): string {
    if (!milestone.dependsOn.length) return "Este es uno de los primeros hitos del proyecto — no hay contexto previo relevante.";
    const blocks = milestone.dependsOn
      .map((id) => this.generatedByMilestoneId.get(id))
      .filter((m): m is GeneratedMilestone => Boolean(m))
      .map((m) => `// === ARCHIVO YA GENERADO: ${m.filePath} (hito "${m.name}") ===\n${m.code.trim()}`);
    if (!blocks.length) return "Hitos de dependencia aún no disponibles — usa nombres y convenciones razonables.";
    return `CONTEXTO DE HITOS ANTERIORES (usa los mismos nombres de campos, modelos y rutas que aquí aparecen):\n\n${blocks.join("\n\n")}`;
  }

  private async generateMilestone(milestone: Milestone, database: "mongodb" | "postgresql", platform: "web" | "mobile-native" = "web"): Promise<GeneratedMilestone> {
    const MAX_ATTEMPTS = 3;
    let lastError: unknown;

    const dependencyContext = this.buildDependencyContext(milestone);
    const qualityBlock = this.options.backendQualityPrompt && milestone.targetWorkspace !== "apps/web"
      ? `\n\nQUALITY BAR OBLIGATORIO (mismas reglas que el resto de la plataforma):\n${this.options.backendQualityPrompt.slice(0, 6000)}`
      : "";
    const platformBlock = platform === "mobile-native" && milestone.targetWorkspace === "apps/web"
      ? `\n\nIMPORTANTE: este proyecto es una APP MÓVIL NATIVA, no web. Para este hito (capa ${milestone.layer}) usa React Native + Expo + TypeScript + React Navigation. NO uses Tailwind CSS, NO uses elementos HTML (div/span/button) — usa View/Text/Pressable de react-native con StyleSheet.create. NO generes vercel.json.`
      : "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // AbortController con timeout de 90s por hito.
        // Sin este timeout, si Anthropic se congela o Railway pierde
        // la conexión, el proceso espera indefinidamente — el watchdog
        // lo detecta como job muerto y lo reinicia desde cero (perdiendo
        // el progreso). Con el timeout, el intento falla limpiamente,
        // el bucle espera 2s y reintenta con una conexión nueva.
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => {
          abortController.abort();
          console.warn(`⏰ Timeout 90s en hito ${milestone.id} (${milestone.name}) — abortando y reintentando`);
        }, 90_000);
        let response: any;
        try {
          response = await anthropic.messages.stream({
            model: this.options.model!,
            max_tokens: 16000,
            system: [
              { type: "text", text: CODE_AGENT_STATIC, cache_control: { type: "ephemeral" } },
              { type: "text", text: `Base de datos del proyecto: ${database}.${qualityBlock}${platformBlock}` },
            ] as any,
            messages: [{
              role: "user",
              content: `Genera el archivo ${milestone.filePath} para el workspace ${milestone.targetWorkspace}.\n\nObjetivo del hito: ${milestone.description}\n\n${dependencyContext}\n\nDevuelve SOLO el código del archivo, sin explicaciones ni markdown.`,
            }],
          }, { signal: abortController.signal as any }).finalMessage();
        } finally {
          clearTimeout(timeoutId);
        }
        let code = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
        // Limpiar fences de markdown que el modelo a veces añade
        code = code.replace(/^```(?:tsx?|jsx?|typescript|javascript)?\n?/, "").replace(/\n?```$/, "").trim();
        // Validación de contenido mínimo
        const isReactFile = /\.(t|j)sx$/.test(milestone.filePath);
        const minLen = isReactFile ? 50 : 20;
        if (code && code.length >= minLen) return { ...milestone, code };
        if (code && code.length > 0 && code.length < minLen) {
          console.warn(`⚠️ Hito ${milestone.id} (${milestone.name}): respuesta demasiado corta (${code.length} chars) — reintentando...`);
        }
        throw new Error("Respuesta vacía o demasiado corta del modelo");
      } catch (error) {
        lastError = error;
        console.error(`⚠️ Hito ${milestone.id} (${milestone.name}) — intento ${attempt}/${MAX_ATTEMPTS}:`, error);
        if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    // FALLBACK: en vez de lanzar error fatal, generar un placeholder mínimo
    // para que el bundle no quede incompleto.
    console.warn(`⚠️ Hito ${milestone.id} (${milestone.name}) — usando placeholder tras ${MAX_ATTEMPTS} intentos fallidos.`);

    // Disparar alerta al admin (WhatsApp + email) si está configurado
    if (this.options.onMilestoneStuck) {
      try {
        await this.options.onMilestoneStuck({
          milestoneName: milestone.name,
          layer: milestone.layer,
          attempts: MAX_ATTEMPTS,
          lastError: String(lastError instanceof Error ? lastError.message : lastError).slice(0, 500),
        });
      } catch { /* no bloquear la generación por un fallo de alerta */ }
    }

    const isReactComp = /\.(t|j)sx$/.test(milestone.filePath);
    const compName = milestone.filePath.split("/").pop()?.replace(/\.[^.]+$/, "") || "Component";
    const placeholder = isReactComp
      ? `import React from "react";\n\nexport default function ${compName}() {\n  return (\n    <div className="p-8">\n      <h1 className="text-2xl font-bold">${compName}</h1>\n      <p className="text-gray-500 mt-2">Módulo en construcción.</p>\n    </div>\n  );\n}\n`
      : `// ${milestone.filePath} — placeholder\nexport {};\n`;
    return { ...milestone, code: placeholder };
  }

  /**
   * FASE 2: CONSTRUCCIÓN POR CAPAS — cada capa se genera en paralelo
   * internamente (con límite de concurrencia), pero las capas se ejecutan
   * SECUENCIALMENTE para que cada una pueda usar el contexto real de la
   * anterior. Esto es lo que evita la incoherencia entre archivos que tenía
   * la versión anterior (paralelismo total sin dependencias).
   */
  async buildProjectIncremental(userPrompt: string, wsNotificationCallback: Function) {
    const { database, platform, architecture, milestones } = await this.planMonorepoProject(userPrompt);

    const serviceNames = Array.from(new Set(milestones.map((m) => m.serviceName).filter(Boolean))) as string[];
    const archLabel = architecture === "microservices"
      ? `microservicios (${serviceNames.length || "?"} servicio(s): ${serviceNames.join(", ") || "sin nombre"})`
      : "monolito";
    wsNotificationCallback({
      status: `🚀 Plan de ${milestones.length} hito(s) aprobado (base de datos: ${database}, plataforma: ${platform === "mobile-native" ? "app nativa (Expo/React Native)" : "web"}, arquitectura: ${archLabel}). Iniciando construcción por capas...`,
      progress: 8,
    });

    const layers = LAYER_ORDER
      .map((layer) => milestones.filter((m) => m.layer === layer))
      .filter((group) => group.length > 0);
    // Cualquier hito con una capa no reconocida se añade al final para no perderlo.
    const knownIds = new Set(layers.flat().map((m) => m.id));
    const orphan = milestones.filter((m) => !knownIds.has(m.id));
    if (orphan.length) layers.push(orphan);

    let completed = 0;
    const total = milestones.length || 1;

    for (const layerMilestones of layers) {
      const concurrency = this.options.concurrencyPerLayer!;
      for (let i = 0; i < layerMilestones.length; i += concurrency) {
        const batch = layerMilestones.slice(i, i + concurrency);
        const results = await Promise.all(batch.map((m) => this.generateMilestone(m, database, platform)));
        for (const generated of results) {
          this.generatedByMilestoneId.set(generated.id, generated);
          await this.writeCodeToWorkspace(generated.targetWorkspace, generated.filePath, generated.code);
          completed++;
          wsNotificationCallback({
            status: `🔨 ${generated.name} integrado en ${generated.targetWorkspace}${generated.serviceName ? ` (servicio: ${generated.serviceName})` : ""}.`,
            progress: 8 + Math.round((completed / total) * 90),
            step: generated.id,
            previewAvailable: true,
          });
        }
      }

      // ── VALIDACIÓN ESBUILD POR CAPA FRONTEND ────────────────────────────────
      // Al terminar cualquier capa de frontend (FRONTEND_CORE o FRONTEND_MODULES),
      // compilamos el bundle acumulado con esbuild. Si hay errores de sintaxis
      // o imports rotos en esta capa, los detectamos AHORA (cuando el contexto
      // está fresco) y regeneramos solo los hitos problemáticos antes de
      // continuar con la siguiente capa. Esto evita que errores tempranos se
      // propaguen y contaminen las capas siguientes, que es exactamente lo
      // que causaba los 0/24 archivos fallidos al final.
      const isFrontendLayer = layerMilestones.some(
        (m) => m.targetWorkspace === "apps/web"
      );
      if (isFrontendLayer && layerMilestones.length > 0 && this.options.validateFrontendBundle) {
        const frontendSoFar = Array.from(this.generatedByMilestoneId.values())
          .filter((item) => item.targetWorkspace === "apps/web")
          .sort((a, b) => a.id - b.id)
          .map((item) => `// === FILE: ${item.filePath} ===\n${item.code.trim()}\n`)
          .join("\n");

        if (frontendSoFar.length > 200) {
          try {
            wsNotificationCallback({
              status: `🔍 Verificando compilación de capa frontend (${layerMilestones.length} hito(s))...`,
              progress: 8 + Math.round((completed / total) * 90),
            });

            const validation = await this.options.validateFrontendBundle(frontendSoFar);
            if (!validation.ok && validation.issues.length > 0) {
              // Identificar qué archivos tienen errores
              const failingFiles = validation.issues
                .map((issue) => {
                  const match = /appforge-vfs:(src\/[^\s:]+)/.exec(issue.file);
                  return match?.[1];
                })
                .filter(Boolean) as string[];

              const uniqueFailingFiles = [...new Set(failingFiles)];
              // Solo regenerar si son pocos archivos (<=5) — si hay más, el problema
              // es estructural y regenerar hito a hito no lo va a resolver
              if (uniqueFailingFiles.length > 0 && uniqueFailingFiles.length <= 5) {
                wsNotificationCallback({
                  status: `⚠️ ${uniqueFailingFiles.length} archivo(s) con errores — regenerando solo los afectados...`,
                  progress: 8 + Math.round((completed / total) * 90),
                });

                for (const filePath of uniqueFailingFiles) {
                  const affectedMilestone = layerMilestones.find(
                    (m) => m.filePath === filePath || m.filePath.endsWith(`/${filePath}`)
                  );
                  if (affectedMilestone) {
                    const errorContext = validation.issues
                      .filter((i) => i.file.includes(filePath))
                      .map((i) => i.message)
                      .join("\n")
                      .slice(0, 500);
                    const fixedMilestone = await this.generateMilestone(
                      {
                        ...affectedMilestone,
                        description: `${affectedMilestone.description}\n\nFIX REQUERIDO — este archivo falló la compilación con este error: ${errorContext}`,
                      },
                      database,
                      platform
                    );
                    this.generatedByMilestoneId.set(fixedMilestone.id, fixedMilestone);
                    await this.writeCodeToWorkspace(fixedMilestone.targetWorkspace, fixedMilestone.filePath, fixedMilestone.code);
                    wsNotificationCallback({
                      status: `✅ ${fixedMilestone.filePath} regenerado y corregido.`,
                      progress: 8 + Math.round((completed / total) * 90),
                    });
                  }
                }
              }
            } else if (validation.ok) {
              wsNotificationCallback({
                status: `✅ Capa frontend compilada correctamente.`,
                progress: 8 + Math.round((completed / total) * 90),
              });
            }
          } catch {
            // La validación es best-effort — si falla, continuamos sin bloquear
          }
        }
      }
    } // fin for (const layerMilestones of layers)

    wsNotificationCallback({ status: "🚀 ¡Proyecto completo generado e integrado!", progress: 100, step: total });

    const allGenerated = Array.from(this.generatedByMilestoneId.values());
    const toBundle = (items: GeneratedMilestone[]) => items
      .sort((a, b) => a.id - b.id)
      .map((item) => `// === FILE: ${item.filePath} ===\n${item.code.trim()}\n`)
      .join("\n");

    // En microservicios: un bundle de código SEPARADO por cada servicio (no
    // todo mezclado en un único backendCode) — refleja la realidad de que
    // cada servicio se despliega y mantiene de forma independiente. En
    // monolito: comportamiento idéntico al original (un único backendCode).
    const serviceBundles: Record<string, string> = {};
    if (architecture === "microservices") {
      for (const svc of serviceNames) {
        serviceBundles[svc] = toBundle(allGenerated.filter((item) => item.serviceName === svc));
      }
    }
    // ENCONTRADO: el hito de docker-compose.yml (targetWorkspace ".", sin
    // serviceName propio porque describe TODOS los servicios juntos) caía
    // en este mismo filtro "todo lo que no es apps/web" junto con el resto
    // del backend — terminaba mezclado dentro de backendCode con el mismo
    // formato "// === FILE: ..." que cualquier archivo backend normal, sin
    // ninguna distinción que permitiera presentárselo al usuario como el
    // archivo que de verdad distingue "carpetas de código separadas" de
    // "microservicios reales que se levantan con un solo comando" (el propio
    // prompt de arriba lo describe así, pero el código nunca lo trataba de
    // forma especial). Se extraen aquí explícitamente los archivos de
    // infraestructura a nivel raíz del proyecto (targetWorkspace ".") en su
    // propio campo, separados del resto del backend.
    const rootInfraFiles = allGenerated.filter((item) => item.targetWorkspace === ".");
    const rootInfraBundle = rootInfraFiles.length > 0 ? toBundle(rootInfraFiles) : "";
    const hasDockerCompose = rootInfraFiles.some((item) => item.filePath.toLowerCase().includes("docker-compose"));

    const nonWebBackend = architecture === "microservices"
      ? toBundle(allGenerated.filter((item) => item.targetWorkspace !== 'apps/web' && item.targetWorkspace !== '.' && !item.serviceName))
      : toBundle(allGenerated.filter((item) => item.targetWorkspace !== 'apps/web' && item.targetWorkspace !== '.'));

    return {
      database,
      platform,
      architecture,
      frontendCode: toBundle(allGenerated.filter((item) => item.targetWorkspace === 'apps/web')),
      backendCode: nonWebBackend,
      serviceBundles, // {} en monolito; { "billing": "...", "inventory": "..." } en microservicios
      rootInfraBundle, // "" si no hay archivos a nivel raíz; si no, docker-compose.yml + README de topología, listos para presentar como archivos propios del proyecto (no enterrados dentro de backendCode)
      hasDockerCompose,
      milestones: allGenerated,
    };
  }

  private async writeCodeToWorkspace(workspace: string, filePath: string, code: string) {
    const absolutePath = path.join(this.projectRoot, workspace, filePath);
    await fs.ensureDir(path.dirname(absolutePath));
    await fs.writeFile(absolutePath, code, 'utf-8');
    console.log(`💾 Guardado con éxito en: ${absolutePath}`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // MODO EDICIÓN POR HITOS — métodos equivalentes a planMonorepoProject /
  // generateMilestone / buildProjectIncremental, pero operando sobre un
  // bundle ya existente en vez de generar desde cero. Ver el comentario de
  // cabecera de EditMilestone más arriba para el porqué de esta extensión.
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Parsea un bundle "// === FILE: <path> ===" en un mapa { ruta → contenido }.
   * Implementación AUTOCONTENIDA y deliberadamente independiente de la
   * equivalente en artifacts/api-server/src/lib/fileToolsAgent.ts: este
   * paquete (@workspace/services) no depende del api-server en su
   * package.json (y el api-server SÍ depende de @workspace/services), así
   * que importar desde allí crearía una dependencia circular real entre
   * paquetes del monorepo. Misma lógica exacta, sin esa dependencia.
   */
  private parseBundleToMap(bundle: string): Map<string, string> {
    const files = new Map<string, string>();
    const parts = bundle.split(/\/\/ === FILE: /);
    for (const part of parts) {
      if (!part.trim()) continue;
      const nl = part.indexOf("\n");
      if (nl === -1) continue;
      const rawPath = part.slice(0, nl).trim().replace(/ ===$/, "").trim();
      if (!rawPath) continue;
      const content = part.slice(nl + 1);
      // Filtrar archivos con contenido vacío o insignificante (< 10 chars)
      // que podrían haberse generado por un parse mal formado.
      if (content.trim().length < 10 && /\.(t|j)sx?$/.test(rawPath)) {
        console.warn(`⚠️ parseBundleToMap: archivo "${rawPath}" tiene contenido vacío/insignificante (${content.trim().length} chars) — ignorado.`);
        continue;
      }
      files.set(rawPath, content);
    }
    return files;
  }

  private mapToBundle(files: Map<string, string>): string {
    const parts: string[] = [];
    for (const [filePath, content] of files.entries()) {
      parts.push(`// === FILE: ${filePath} ===\n${content}`);
    }
    return parts.join("\n\n");
  }

  /**
   * FASE 1 (modo edición): planifica los hitos de MODIFICACIÓN necesarios
   * para cumplir la petición del usuario sobre un proyecto que YA EXISTE.
   * Solo se le pasan las RUTAS de los archivos actuales (no su contenido
   * completo — eso inflaría el prompt del planificador sin necesidad; cada
   * hito recibe el contenido real del archivo concreto que le toca, no de
   * todos), igual de barato en tokens que planMonorepoProject.
   */
  async planProjectEdit(
    userPrompt: string,
    existingFilePaths: { frontend: string[]; backend: string[] },
  ): Promise<{ milestones: EditMilestone[] }> {
    const fileList = [
      ...existingFilePaths.frontend.map((p) => `- ${p} (frontend)`),
      ...existingFilePaths.backend.map((p) => `- ${p} (backend)`),
    ].join("\n");

    const response = await anthropic.messages.stream({
      model: this.options.model!,
      // Mismo límite que planMonorepoProject (24000) — el motivo es idéntico:
      // listas de hitos largas (proyectos importados grandes con muchos
      // archivos a tocar) no deben truncarse antes de cerrar el JSON.
      max_tokens: 24000,
      system: [{ type: "text", text: EDIT_PLANNER_SYSTEM_STATIC, cache_control: { type: "ephemeral" } }] as any,
      messages: [{
        role: "user",
        content: `ARCHIVOS QUE YA EXISTEN EN EL PROYECTO:\n${fileList || "(proyecto sin archivos detectados — trata todo como create_file)"}\n\nPETICIÓN DEL USUARIO:\n${userPrompt}`,
      }],
    }).finalMessage();

    const rawText = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const cleanedJson = this.cleanJsonResponse(rawText);

    try {
      const result = JSON.parse(cleanedJson);
      const milestones: EditMilestone[] = (result.milestones || []).map((m: any) => ({
        id: m.id,
        action: m.action === "create_file" ? "create_file" : "modify_file",
        filePath: String(m.filePath || "").trim(),
        description: String(m.description || ""),
        dependsOn: Array.isArray(m.dependsOn) ? m.dependsOn : [],
      })).filter((m: EditMilestone) => m.filePath);
      return { milestones };
    } catch (error) {
      // Misma red de seguridad que planMonorepoProject: si el modelo añadió
      // texto conversacional alrededor del JSON, lo recuperamos buscando el
      // primer objeto balanceado en vez de fallar directamente.
      const extracted = this.extractFirstJsonObject(rawText);
      if (extracted) {
        try {
          const result = JSON.parse(extracted);
          const milestones: EditMilestone[] = (result.milestones || []).map((m: any) => ({
            id: m.id,
            action: m.action === "create_file" ? "create_file" : "modify_file",
            filePath: String(m.filePath || "").trim(),
            description: String(m.description || ""),
            dependsOn: Array.isArray(m.dependsOn) ? m.dependsOn : [],
          })).filter((m: EditMilestone) => m.filePath);
          console.warn("⚠️ El planificador de edición devolvió texto junto al JSON — se recuperó el objeto JSON embebido correctamente.");
          return { milestones };
        } catch {
          /* el bloque extraído tampoco era JSON válido — cae al error final de abajo */
        }
      }
      console.error("❌ Error parseando JSON del plan de edición:", error);
      throw new Error("No se pudo generar el plan de edición — respuesta del planificador inválida.");
    }
  }

  /** Construye el bloque de contexto para un hito de edición: el archivo
   *  ACTUAL completo (si modify_file y existe) + los hitos de ESTA edición
   *  en los que depende (si ya se generaron). */
  private buildEditContext(
    milestone: EditMilestone,
    currentFiles: Map<string, string>,
    generatedByMilestoneId: Map<number, GeneratedEditMilestone>,
  ): string {
    const blocks: string[] = [];
    if (milestone.action === "modify_file") {
      const currentContent = currentFiles.get(milestone.filePath);
      blocks.push(
        currentContent
          ? `ARCHIVO ACTUAL (${milestone.filePath}) — modifícalo, NO lo reescribas desde cero, conserva todo lo que no esté relacionado con el cambio pedido:\n${currentContent.trim()}`
          : `AVISO: el planificador marcó este hito como "modify_file" pero el archivo "${milestone.filePath}" no se encontró en el bundle actual — trátalo como un archivo nuevo coherente con el resto del proyecto.`
      );
    }
    const depBlocks = milestone.dependsOn
      .map((id) => generatedByMilestoneId.get(id))
      .filter((m): m is GeneratedEditMilestone => Boolean(m))
      .map((m) => `// === ARCHIVO YA EDITADO/CREADO EN ESTA MISMA EDICIÓN: ${m.filePath} ===\n${m.code.trim()}`);
    if (depBlocks.length) blocks.push(`CONTEXTO DE OTROS HITOS DE ESTA EDICIÓN:\n\n${depBlocks.join("\n\n")}`);
    return blocks.join("\n\n") || "No hay contexto adicional relevante para este hito.";
  }

  private async generateEditMilestone(
    milestone: EditMilestone,
    currentFiles: Map<string, string>,
    generatedByMilestoneId: Map<number, GeneratedEditMilestone>,
  ): Promise<GeneratedEditMilestone> {
    const MAX_ATTEMPTS = 3;
    let lastError: unknown;
    const editContext = this.buildEditContext(milestone, currentFiles, generatedByMilestoneId);
    const qualityBlock = this.options.backendQualityPrompt && !milestone.filePath.startsWith("src/") && !milestone.filePath.includes("apps/web")
      ? `\n\nQUALITY BAR OBLIGATORIO (mismas reglas que el resto de la plataforma):\n${this.options.backendQualityPrompt.slice(0, 6000)}`
      : "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // Mismo motivo de .stream().finalMessage() que en generateMilestone:
        // evita el rechazo "Streaming is required..." del SDK para llamadas
        // que puedan tardar, sin cambiar el objeto Message devuelto.
        const response = await anthropic.messages.stream({
          model: this.options.model!,
          // Mismo límite que generateMilestone (8192) — cada hito de edición
          // es, por diseño del planificador, UN archivo concreto, así que el
          // mismo techo que ya demostró ser suficiente para un archivo de
          // construcción nueva lo es también aquí.
          max_tokens: 16000,
          system: [
            { type: "text", text: EDIT_CODE_AGENT_STATIC, cache_control: { type: "ephemeral" } },
            { type: "text", text: qualityBlock || "Sin reglas de calidad adicionales para este archivo." },
          ] as any,
          messages: [{
            role: "user",
            content: `Acción: ${milestone.action === "create_file" ? "CREAR archivo nuevo" : "MODIFICAR archivo existente"}.\nArchivo: ${milestone.filePath}\n\nCambio a aplicar: ${milestone.description}\n\n${editContext}\n\nDevuelve SOLO el código COMPLETO y final del archivo, sin explicaciones ni markdown.`,
          }],
        }).finalMessage();
        let code = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
        // Limpiar fences de markdown que el modelo a veces añade a pesar de la instrucción
        code = code.replace(/^```(?:tsx?|jsx?|typescript|javascript)?\n?/, "").replace(/\n?```$/, "").trim();
        // Validación de contenido mínimo: un archivo React válido tiene al menos
        // ~50 chars. Si es más corto, el modelo devolvió solo un comentario o texto parcial.
        const isReactFile = /\.(t|j)sx$/.test(milestone.filePath);
        const minLength = isReactFile ? 50 : 20;
        if (code && code.length >= minLength) return { ...milestone, code };
        if (code && code.length > 0 && code.length < minLength) {
          console.warn(`⚠️ Hito ${milestone.id} (${milestone.filePath}): respuesta demasiado corta (${code.length} chars) — reintentando...`);
        }
        throw new Error("Respuesta vacía o demasiado corta del modelo");
      } catch (error) {
        lastError = error;
        console.error(`⚠️ Hito de edición ${milestone.id} (${milestone.filePath}) — intento ${attempt}/${MAX_ATTEMPTS}:`, error);
        if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    // FALLBACK: en vez de lanzar error fatal que mata toda la edición,
    // usar el contenido original del archivo (para modify_file) o un
    // placeholder mínimo (para create_file) — así el bundle final nunca
    // queda con archivos vacíos ni se aborta la edición completa por un
    // solo archivo que el modelo no pudo generar.
    console.warn(`⚠️ Hito de edición ${milestone.id} (${milestone.filePath}) — usando fallback tras ${MAX_ATTEMPTS} intentos fallidos.`);
    if (milestone.action === "modify_file") {
      const originalContent = currentFiles.get(milestone.filePath);
      if (originalContent && originalContent.trim().length > 0) {
        console.warn(`  → Conservando contenido original de ${milestone.filePath} (${originalContent.length} chars).`);
        return { ...milestone, code: originalContent };
      }
    }
    // Para create_file o si el original está vacío, generar un placeholder
    // funcional mínimo que al menos no rompa el build.
    const ext = milestone.filePath.split(".").pop() || "";
    const isReactComponent = /\.(t|j)sx$/.test(milestone.filePath);
    const componentName = milestone.filePath.split("/").pop()?.replace(/\.[^.]+$/, "") || "Component";
    const placeholderCode = isReactComponent
      ? `import React from "react";\n\nexport default function ${componentName}() {\n  return (\n    <div className="p-8">\n      <h1 className="text-2xl font-bold">Cargando ${componentName}...</h1>\n      <p className="text-gray-500 mt-2">Este módulo se está generando.</p>\n    </div>\n  );\n}\n`
      : `// ${milestone.filePath} — placeholder generado automáticamente\nexport {};\n`;
    console.warn(`  → Usando placeholder para ${milestone.filePath}.`);
    return { ...milestone, code: placeholderCode };
  }

  /**
   * FASE 2 (modo edición): aplica los hitos planificados por planProjectEdit
   * sobre el bundle actual, archivo por archivo, sin reescribir nada que no
   * esté en el plan. Devuelve el bundle de frontend y backend actualizados,
   * con el MISMO formato (// === FILE: ...) que el resto del sistema espera,
   * para que sea compatible con runTestingAgent y con el resto del pipeline
   * de validación/guardado sin ningún cambio en esas partes.
   *
   * No hay capas secuenciales por dependencia de arquitectura como en
   * buildProjectIncremental (data → backend → frontend) porque una edición
   * no construye un sistema desde cero — sí se respeta dependsOn entre
   * hitos de la MISMA edición, ejecutando en orden topológico simple por
   * lotes (igual que el agrupado por capas, pero con una sola "capa" lógica
   * cuyo orden lo da dependsOn en vez de un layer fijo).
   */
  async editProjectIncremental(
    userPrompt: string,
    previousFrontendCode: string,
    previousBackendCode: string,
    wsNotificationCallback: Function,
  ): Promise<{ frontendCode: string; backendCode: string; milestones: GeneratedEditMilestone[] }> {
    const frontendFiles = this.parseBundleToMap(previousFrontendCode || "");
    const backendFiles = this.parseBundleToMap(previousBackendCode || "");
    const allCurrentFiles = new Map<string, string>([...frontendFiles, ...backendFiles]);

    const { milestones } = await this.planProjectEdit(userPrompt, {
      frontend: Array.from(frontendFiles.keys()),
      backend: Array.from(backendFiles.keys()),
    });

    if (!milestones.length) {
      throw new Error("El planificador de edición no devolvió ningún hito — no se pudo determinar qué archivos modificar.");
    }

    wsNotificationCallback({
      status: `🚀 Plan de edición aprobado: ${milestones.length} archivo(s) a ${milestones.filter((m) => m.action === "modify_file").length > 0 ? "modificar/crear" : "crear"}. Iniciando edición por hitos...`,
      progress: 8,
    });

    const generatedByMilestoneId = new Map<number, GeneratedEditMilestone>();
    const concurrency = this.options.concurrencyPerLayer!;
    const remaining = [...milestones];
    const done = new Set<number>();
    let completed = 0;
    const total = milestones.length;

    // Orden topológico simple por lotes: en cada vuelta, procesa todos los
    // hitos cuyas dependencias ya están resueltas (o no tienen ninguna),
    // hasta concurrency a la vez — mismo patrón de ejecución por lotes que
    // buildProjectIncremental usa por capa, aplicado aquí por dependencia
    // real en vez de por capa fija (una edición no tiene capas de
    // arquitectura, solo el orden que el propio plan declaró).
    let safetyCounter = 0;
    while (remaining.length > 0 && safetyCounter < total + 1) {
      safetyCounter++;
      const ready = remaining.filter((m) => m.dependsOn.every((id) => done.has(id)));
      // Si ningún hito restante tiene sus dependencias listas (plan con
      // referencias circulares o a IDs inexistentes), procesa el resto
      // igualmente para no bloquear la edición — mejor entregar algo que
      // quedarse colgado por un plan mal formado.
      const batchSource = ready.length > 0 ? ready : remaining;
      const batch = batchSource.slice(0, concurrency);

      const results = await Promise.all(batch.map((m) => this.generateEditMilestone(m, allCurrentFiles, generatedByMilestoneId)));
      for (const generated of results) {
        generatedByMilestoneId.set(generated.id, generated);
        // El archivo recién editado/creado pasa a estar disponible como
        // contexto "actual" también para hitos siguientes que dependan de
        // su ruta sin haberlo declarado explícitamente como dependsOn.
        allCurrentFiles.set(generated.filePath, generated.code);
        done.add(generated.id);
        completed++;
        wsNotificationCallback({
          status: `🔨 ${generated.filePath} ${generated.action === "create_file" ? "creado" : "actualizado"}.`,
          progress: 8 + Math.round((completed / total) * 90),
          step: generated.id,
          previewAvailable: true,
        });
        const idx = remaining.findIndex((m) => m.id === generated.id);
        if (idx !== -1) remaining.splice(idx, 1);
      }
    }

    wsNotificationCallback({ status: "🚀 ¡Edición completa aplicada e integrada!", progress: 100, step: total });

    // Reconstruye los bundles finales: cada archivo tocado/creado se aplica
    // sobre su mapa de origen (frontend o backend) según dónde estaba antes,
    // o según convención de ruta si es nuevo (apps/web o src/ del lado
    // frontend se asume frontend; el resto, backend) — el resto de archivos
    // NO tocados se conserva exactamente igual que estaba.
    const allGenerated = Array.from(generatedByMilestoneId.values());
    for (const generated of allGenerated) {
      // ENCONTRADO en producción con un caso real (app de clínica dental,
      // edición con 22 hitos): archivos backend NUEVOS como
      // "src/routes/auth.ts", "src/lib/auth.ts" o
      // "src/services/notifications.ts" se clasificaban como FRONTEND —
      // confirmado con código real ejecutado replicando exactamente esta
      // situación. La condición anterior, para archivos NUEVOS (no
      // presentes ya en frontendFiles ni backendFiles), solo comprobaba
      // si la ruta empezaba con "src/" — pero TANTO el frontend como el
      // backend de un proyecto Maris AI usan su propio "src/" interno
      // (src/App.tsx del lado web, src/index.ts o src/routes/*.ts del
      // lado servidor), así que ese patrón por sí solo no distingue nada
      // real. Archivos de servidor terminaban mezclados dentro del bundle
      // de frontendCode, corrompiendo su estructura de forma silenciosa
      // (cada archivo individual sigue compilando bien, solo está en el
      // bundle equivocado) — esto explica por qué el Testing Agent y QA
      // decían "todo bien" mientras Claude Vision veía un 404 puro: el
      // 404 no viene de un error de sintaxis, viene de que el frontend
      // real entregado al navegador no es el que se generó.
      // FIX: para archivos NUEVOS, primero se comprueban patrones de ruta
      // INEQUÍVOCAMENTE de backend (rutas de servidor, servicios, prisma,
      // middlewares, lib/auth del lado servidor) antes de asumir frontend
      // por defecto — el patrón de frontend ya no basta por sí solo.
      const looksLikeBackendPath = /^(src\/routes\/|src\/services\/|src\/middlewares?\/|src\/controllers\/|src\/models\/|prisma\/|apps\/api\/|server\/|api\/)/.test(generated.filePath)
        || /^src\/(index|server|app)\.(ts|js)$/.test(generated.filePath)
        || /^src\/lib\/(auth|db|database|prisma)\.(ts|js)$/.test(generated.filePath);
      const isFrontendFile = frontendFiles.has(generated.filePath)
        || (!backendFiles.has(generated.filePath) && !looksLikeBackendPath && /^(src\/|apps\/web\/|public\/|index\.html)/.test(generated.filePath));
      if (isFrontendFile) {
        frontendFiles.set(generated.filePath, generated.code);
      } else {
        backendFiles.set(generated.filePath, generated.code);
      }
    }

    return {
      frontendCode: this.mapToBundle(frontendFiles),
      backendCode: this.mapToBundle(backendFiles),
      milestones: allGenerated,
    };
  }
}
