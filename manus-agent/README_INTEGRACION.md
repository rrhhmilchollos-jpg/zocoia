# Manus-Agent — integrado en zocoia.es (rama `zoco-ia-1`)

## Cómo funciona (arquitectura real, ya conectada)

El agente **no llama a ningún proveedor de IA externo ni necesita su
propia API key**. Se ejecuta dentro del mismo proceso Node que sirve
zocoia.es y reutiliza directamente `processChatCompletion()` — la misma
función que ya usan `/api/chat` y `/v1/chat/completions` — pasándole
`tools` en formato OpenAI. `processChatCompletion()` ya soportaba esto
en modo *passthrough* (tools del cliente), así que no hizo falta tocar
su lógica interna, solo aprovecharla.

```
Panel React (ManusAgentPanel)
   │  POST /api/agent/run/stream   (con el JWT del usuario)
   ▼
server.js
   │  app.use('/api/agent', authMiddleware, createAgentRouter({ processChatCompletion }))
   ▼
manus-agent/routes.js  →  manus-agent/manusAgent.js
   │  bucle de function-calling llamando a processChatCompletion(authSub, { tools, ... })
   ▼
Ollama (motor local ya configurado: OLLAMA_URL / OLLAMA_MODEL_MAP)
```

Las tools reales (leer/escribir archivos, GitHub, Coolify) están en
`manus-agent/tools/`.

## Ya está montado

- `server.js` importa `createAgentRouter` desde `./manus-agent/index.js`
  y monta `/api/agent/run` y `/api/agent/run/stream` detrás de
  `authMiddleware`, sin tocar ninguna otra ruta.
- `Dockerfile`: corregido para copiar `manus-agent/` a la imagen de
  producción (de paso, se corrigió un bug ya existente: la imagen no
  copiaba `bridge-marisai.js`, `seed-owner-agents.js`, `zoco-sessions.js`
  ni `zoco-console.js`, que `server.js` ya importaba).
- `package.json`: añadidas `@octokit/rest` y `simple-git` (dependencias
  reales usadas por las tools de GitHub).
- `src/components/ManusAgentPanel.tsx`: panel con pestañas
  Diferencia / Original / Modificado, consumiendo el streaming SSE.

## Variables de entorno que SÍ tienes que rellenar tú

El agente en sí no necesita API key de IA (usa el motor interno), pero
sí necesita credenciales para tocar repos de GitHub y desplegar en
Coolify — esto no lo puedo generar yo, son cuentas tuyas:

```bash
# GitHub: Personal Access Token con permisos "repo".
# Genera uno NUEVO y dedicado en https://github.com/settings/tokens
# (nunca reutilices uno que se haya compartido fuera de un gestor de secretos).
GITHUB_TOKEN=

# Coolify: Panel Coolify -> Keys & Tokens -> API tokens
COOLIFY_API_URL=
COOLIFY_API_TOKEN=
COOLIFY_SERVER_UUID=       # opcional si prefieres que el agente busque la app por su repo
COOLIFY_PROJECT_UUID=      # opcional, informativo

# Opcionales, con valores por defecto sensatos:
AGENT_WORKSPACE_DIR=/tmp/manus-agent-workspaces   # carpeta temporal de trabajo
AGENT_MAX_STEPS=25                                # límite de iteraciones del bucle
AGENT_DEFAULT_MODEL=zoco-max                       # una de: zoco-flash | zoco-plus | zoco-max | zoco-lab
```

Añádelas en el panel de variables de entorno de Railway (donde corre
`server.js`), no en `.env` local ni en el repo.

## Añadir el panel a tu Dashboard

No se tocó `src/pages/Dashboard.tsx` (900+ líneas ya en producción) para
no arriesgar nada ahí. Para mostrarlo, añade una pestaña:

```tsx
import ManusAgentPanel from '../components/ManusAgentPanel';

{activeTab === 'agente' && <ManusAgentPanel />}
```

y un botón que haga `setActiveTab('agente')`. El componente es
autocontenido (solo usa `useAuth()`, ya disponible en toda la app).

## ⚠️ Problema encontrado, NO relacionado con este agente

`seed-owner-agents.js` importa `./bridge-marisai-prompts.js`, un
archivo que **no existe en ningún punto del historial de git de este
repositorio** (revisado en todas las ramas). Si es así también en el
commit que Railway está desplegando ahora mismo, `node server.js`
debería fallar al arrancar con `ERR_MODULE_NOT_FOUND` — es decir, es un
problema previo a este PR, no algo que yo haya introducido. Antes de
mergear, confirma que ese archivo existe donde Railway construye la
imagen (o recupéralo y añádelo al repo) para no encontrarte con un
arranque roto por un motivo aparte del agente.

## Seguridad

- El agente corre "como" el usuario autenticado (`req.auth.sub`), con
  su mismo saldo/créditos del sistema Ollama existente.
- Por defecto abre Pull Request en vez de tocar `zoco-ia-1` directamente
  (`create_pull_request: true`).
- `AGENT_MAX_STEPS` limita las iteraciones del bucle.
- El workspace de cada tarea se borra siempre al terminar.
