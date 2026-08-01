# El Ordenador de Zoco — Guía técnica y de despliegue

Este documento describe el núcleo agéntico de **El Ordenador de Zoco**, el agente
autónomo disponible en la ruta `/computer`, así como los pasos exactos para
dejarlo funcionando en producción sobre `zocoia.es`.

## 1. Qué se ha corregido

El sistema ya existía en el repositorio, pero no llegaba a funcionar. Se
localizaron y corrigieron cuatro fallos, tres de ellos bloqueantes.

| # | Fallo | Efecto observable | Corrección |
|---|---|---|---|
| 1 | `@anthropic-ai/sdk` importado pero ausente de `package.json` | El servidor moría al arrancar con `ERR_MODULE_NOT_FOUND`; en producción ningún endpoint respondía | Dependencia declarada y fijada en el lockfile |
| 2 | `node-fetch` importado en `bridge-marisai.js` y tampoco declarado | Mismo efecto: proceso caído antes de atender peticiones | Import eliminado; se usa el `fetch` nativo de Node 22 |
| 3 | Conversión de mensajes al formato de Anthropic con pérdida de datos | El agente escribía la llamada a la herramienta como texto (` ```json {"name": ...} ``` `) y la tarea se cerraba en la iteración 1 sin hacer nada | Protocolo `tool_use` / `tool_result` implementado correctamente |
| 4 | `registerEventStreamRoute` invocada con argumentos posicionales | La ruta de eventos en vivo se descartaba en un `catch` silencioso | Se pasa el objeto `{ app, jwt, JWT_SECRET, db }` que la función espera |

### El fallo raíz, en detalle

La API de Anthropic **no admite mensajes con `role: "tool"`**. El resultado de
una herramienta debe viajar como un bloque `tool_result` dentro de un mensaje
con `role: "user"`, y cada bloque debe referenciar el `tool_use_id` emitido por
el asistente. El código anterior hacía esto:

```js
messages.map(m => ({ role: m.role, content: m.content }))
```

Ese `.map()` descartaba el campo `tool_calls` del turno del asistente y enviaba
`role: 'tool'` tal cual. Sin un canal de herramientas válido, el modelo
**imitaba** la llamada escribiéndola como texto plano. El bucle no detectaba
ninguna herramienta, interpretaba que el agente había terminado y marcaba la
tarea como completada en la primera iteración.

## 2. Arquitectura

```
src/pages/ZocoComputer.tsx   Interfaz: chat + plan + visor "ordenador"
        │  HTTP + SSE
        ▼
zoco-computer.js             Rutas /api/computer/*, tablas, catálogo de
                             herramientas, ejecución y difusión de eventos
        │
        ├── zoco-loop.js     Bucle agéntico: iteraciones, contexto, mensajes
        │                    en caliente, reanudación
        ├── zoco-prompt.js   Prompt de sistema
        └── zoco-tools-extra.js  Edición quirúrgica, navegador visual, puertos
        │
        ▼
server.js  →  callChatModel()  →  API de Anthropic (Claude)
```

### Herramientas disponibles

| Herramienta | Función |
|---|---|
| `gestionar_plan` | Crea y actualiza el plan de fases mostrado en vivo |
| `ejecutar_terminal` | Ejecuta comandos de shell reales en el workspace |
| `escribir_archivo` | Crea o sobrescribe archivos completos |
| `editar_archivo` | Reemplazos quirúrgicos con detección de ambigüedad |
| `leer_archivo` | Lee archivos, con soporte de rangos de líneas |
| `listar_archivos` | Inspecciona el árbol del workspace |
| `buscar_web` | Búsqueda web (Tavily si hay clave; buscador de reserva si no) |
| `navegar_web` | Extrae el contenido textual de una URL |
| `navegador` | Navegador visual real con capturas (requiere E2B) |
| `exponer_puerto` | Publica un servicio local en una URL accesible |
| `entregar_resultado` | Único modo válido de finalizar una tarea |

## 3. Comportamiento del bucle

- **Multi-iteración real.** Si el modelo responde texto sin llamar a ninguna
  herramienta, no se da la tarea por terminada: se le recuerda que debe usar
  una herramienta y el bucle continúa.
- **Finalización explícita.** Una tarea solo se completa cuando el agente
  invoca `entregar_resultado`.
- **Mensajes en caliente.** Las instrucciones enviadas mientras la tarea corre
  se inyectan en el contexto de la siguiente iteración.
- **Límite seguro.** Al alcanzar `COMPUTER_MAX_ITERATIONS` la tarea queda
  *pausada*, nunca perdida, y se puede reanudar con un mensaje.
- **Reanudación tras reinicio.** Al arrancar, las tareas que quedaron marcadas
  como *en curso* se recuperan como *pausadas*.
- **Errores de herramienta no abortan.** El fallo se devuelve al modelo para
  que lo corrija en la iteración siguiente.

## 4. Variables de entorno

Configúralas en el panel de Coolify. La plantilla completa está en
`.env.example`.

### Obligatorias

| Variable | Descripción |
|---|---|
| `ANTHROPIC_API_KEY` | Clave de Claude. **Sin ella el chat y el Ordenador no funcionan.** |
| `JWT_SECRET` | Secreto de firma de sesiones. Genérala con `openssl rand -hex 48` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Cuenta de administración inicial |
| `DB_PATH` | Ruta de la base de datos, en un **volumen persistente** (ver aviso) |

### Recomendadas

| Variable | Valor sugerido | Descripción |
|---|---|---|
| `COMPUTER_MAX_ITERATIONS` | `60` | Iteraciones antes de pausar |
| `COMPUTER_MAX_CONTEXT_MESSAGES` | `80` | Mensajes íntegros antes de resumir |
| `COMPUTER_PUBLIC_BASE` | `https://zocoia.es` | Base para URLs publicadas |
| `E2B_API_KEY` | — | Opcional: navegador visual con capturas |
| `TAVILY_API_KEY` | — | Opcional: búsqueda web de mayor calidad |

> **Aviso sobre persistencia.** Si no existe un volumen persistente montado en
> `/data`, la base de datos se pierde en cada despliegue: se borrarían usuarios,
> tareas e historial. En Coolify, añade un volumen persistente en `/data` y fija
> `DB_PATH=/data/zocoia.db`.

## 5. Despliegue

1. Confirma que la rama `zoco-ia-1` está actualizada en GitHub.
2. En Coolify, define las variables de entorno de la sección anterior.
3. Añade el volumen persistente en `/data`.
4. Lanza el redespliegue.
5. Verificación posterior:

```bash
curl https://zocoia.es/health
# Esperado: {"status":"ok","message":"Zoco IA conectado con éxito"}
```

6. Abre `https://zocoia.es/computer`, inicia sesión y lanza una tarea de prueba
   como «Crea un archivo `hola.txt` con el texto HOLA y entrégamelo». Deberías
   ver el plan de fases, la terminal en vivo y el archivo final.

### Requisito del proxy inverso

El panel en vivo usa **Server-Sent Events**. El backend ya envía
`X-Accel-Buffering: no` y `Cache-Control: no-transform`, pero si el proxy
bufferiza respuestas, los eventos llegarían todos de golpe al final. Si observas
ese comportamiento, desactiva el buffering para `/api/computer/`.

## 6. Pruebas incluidas

```bash
node test-anthropic-protocol.mjs   # Conversión al protocolo de Anthropic
node test-loop-e2e.mjs             # Bucle completo con modelo simulado
./test-api-integracion.sh          # Contrato HTTP contra el servidor real
```

El segundo test cubre expresamente la regresión del fallo raíz: verifica que una
respuesta de texto sin herramienta **no** cierra la tarea en la primera
iteración.
