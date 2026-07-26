# Integración del Manus-Agent en zocoia.es (rama `zoco-ia-1`)

## 1. Dónde están los archivos

Ya están en la raíz del repo, al mismo nivel que `server.js`, `agent/` y
`gateway/`:

```
zocoia/
├── agent/
├── gateway/
├── src/
├── manus-agent/          <-- este módulo
│   ├── types.ts
│   ├── config.ts
│   ├── manusAgent.ts
│   ├── routes.ts
│   ├── index.ts
│   └── tools/
│       ├── workspace.ts
│       ├── github.ts
│       ├── coolify.ts
│       └── index.ts
├── server.js
├── package.json
└── ...
```

## 2. Dependencias nuevas

```bash
npm install openai @octokit/rest simple-git
npm install --save-dev @types/express tsx
```

Se usa el paquete `openai` (no `@anthropic-ai/sdk`) porque el orquestador
habla con **tu propio gateway de zocoia.es**, no con Anthropic
directamente. zocoia.es actúa como tu Claude Console + litellm, sirviendo
modelos de Ollama por detrás con un endpoint de chat compatible con
OpenAI (`/v1/chat/completions`, con function calling).

> Si en algún momento cambias tu gateway para exponer en su lugar el
> formato `/v1/messages` de Anthropic, solo hay que cambiar el bloque de
> cliente en `manusAgent.ts` por `@anthropic-ai/sdk` con
> `baseURL: config.llm.baseUrl`. El resto del agente (tools, github,
> coolify, panel) no cambia.

## 3. Variables de entorno

```bash
# Tu gateway (zocoia.es) en vez de Anthropic
ZOCOIA_API_URL=https://zocoia.es/v1
ZOCOIA_API_KEY=sk-zoco-xxxxxxxxxxxxxxxx     # generada en tu propio panel de zocoia.es
ZOCOIA_MODEL=ollama/llama3.1:70b            # el modelo que tengas montado; usa uno con soporte de "tools"/function calling

# GitHub (Personal Access Token con permisos "repo")
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx

# Coolify
COOLIFY_API_URL=https://tu-instancia-coolify.com/api/v1
COOLIFY_API_TOKEN=xxxxxxxxxxxxxxxx
COOLIFY_SERVER_UUID=uuid-de-la-app-a-redesplegar   # opcional si usas búsqueda automática por repo
COOLIFY_PROJECT_UUID=uuid-del-proyecto             # opcional, informativo

# Agente
AGENT_WORKSPACE_DIR=/tmp/manus-agent-workspaces
AGENT_MAX_STEPS=25
```

> ⚠️ **Genera un `GITHUB_TOKEN` nuevo** antes de poner esto en producción.
> El que se usó para crear este Pull Request se compartió en texto plano
> en un chat — revócalo en
> https://github.com/settings/tokens y crea uno nuevo solo para el
> servidor (variable de entorno, nunca en el frontend ni en commits).

> ⚠️ **Modelo con soporte de "tool calling"**: no todos los modelos de
> Ollama soportan function calling de forma fiable. Modelos recomendados:
> `llama3.1` (8B/70B), `qwen2.5`, `mistral-nemo`. Si tu modelo no soporta
> tools, litellm puede fallar el `tool_choice: "auto"` — prueba primero
> con una petición corta antes de confiar tareas grandes al agente.

## 4. Montar las rutas en `server.js`

```js
// server.js
import { agentRouter } from "./manus-agent/index.ts";
// ... tus imports y middlewares existentes (cors, express.json(), authMiddleware, etc.)

app.use(authMiddleware); // el que ya usas para proteger rutas (jsonwebtoken)
app.use(agentRouter);
```

Para poder importar los `.ts` sin compilar aparte, la opción más simple
es arrancar el server con `tsx` en vez de `node`:

```json
"scripts": {
  "start": "node parchear.js && tsx server.js"
}
```

o compilar `manus-agent/` con `tsc` como paso de build en el
`Dockerfile` (`RUN npx tsc --project manus-agent/tsconfig.json`) e
importar desde `manus-agent/dist/index.js`.

## 5. Cómo lo llama el panel visual

```json
POST /api/agent/run/stream
{
  "instructions": "Añade un endpoint GET /health que devuelva { status: 'ok' }",
  "repo_url": "https://github.com/rrhhmilchollos-jpg/zocoia",
  "base_branch": "zoco-ia-1",
  "auto_deploy": true,
  "create_pull_request": true
}
```

Devuelve eventos SSE (`event: step`) paso a paso y un evento final
(`event: result`) con el `AgentRunResult` completo. El componente React
`ManusAgentPanel.tsx` (en `src/components/`) ya consume este endpoint y
pinta las pestañas Diferencia / Original / Modificado.

## 5.1. Añadir el panel a tu Dashboard

No he tocado `src/pages/Dashboard.tsx` directamente para no arriesgar nada
en un archivo de 900+ líneas que ya funciona. Para mostrar el panel,
añade tú una pestaña nueva donde ya tienes `activeTab`/`RESOURCE_SECTIONS`:

```tsx
import ManusAgentPanel from '../components/ManusAgentPanel';

// dentro del render, donde pintas el contenido según activeTab:
{activeTab === 'agente' && <ManusAgentPanel />}
```

y un botón más en tu barra de pestañas que haga `setActiveTab('agente')`.
Es un componente autocontenido: no necesita props ni contexto adicional
aparte de `useAuth()`, que ya está disponible en toda la app.

## 6. Seguridad

- El endpoint del agente debe estar **siempre** detrás de tu
  `authMiddleware` (JWT).
- Por defecto `create_pull_request: true`: abre PR en vez de tocar
  `zoco-ia-1` directamente. Cámbialo a `false` solo cuando confíes en el
  flujo para repos concretos.
- `AGENT_MAX_STEPS` limita las iteraciones del bucle.
- El workspace de cada tarea se borra siempre al terminar.
