# Maris AI — Infraestructura propia de inferencia

Plataforma propia para alojar modelos de IA open source, gestionar API keys de uso personal y alquilar acceso a clientes, similar a la consola de Anthropic/OpenAI pero con tu propia infraestructura.

## Arquitectura

```
Internet -> Nginx (TLS, rate limit) -> Gateway (auth + medicion) -> Ollama/vLLM -> modelo
                                              |
                                       SQLite (api_keys, usage_log, models_registry)
```

- **Gateway**: capa propia en Express. Autenticacion por API key, medicion de tokens, limites por cliente.
- **Ollama**: sirve modelos open source con API compatible OpenAI (sin GPU requerida).
- **vLLM**: alternativa con GPU para modelos grandes (Qwen2.5-Coder-32B, etc.).
- **Nginx**: TLS + rate limiting delante de todo.
- **Agent**: agente autonomo con sandbox Docker real y auto-correccion de errores.
- **Frontend**: consola React (index.tsx) — panel de control, claves API, agentes, analiticas.

## Modelos de infraestructura

| Modelo | Equivalencia | Backend |
|---|---|---|
| maris-velox-1b | Equiv. Haiku 4.5 | Ollama (CPU/GPU) |
| maris-core-7b | Equiv. Sonnet 5 | Ollama/vLLM |
| maris-pro-32b | Equiv. Opus 4.8 | vLLM (GPU A100) |

## Inicio rapido

### 1. Clonar y configurar

```bash
git clone https://github.com/rrhhmilchollos-jpg/zocoia.git
cd zocoia
cp .env.example .env
# Edita .env con tus valores reales
```

### 2. Levantar con Docker Compose (sin GPU)

```bash
docker compose up ollama gateway nginx -d
```

### 3. Crear tu primera API key

```bash
# Clave maestra personal
docker compose exec gateway node server.js create-key "Maria Admin" rrhh.milchollos@gmail.com

# Clave para un cliente con limite de 100k tokens/mes
docker compose exec gateway node server.js create-key "Cliente S.L." cliente@empresa.com 100000
```

### 4. Probar la API

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer sk-marisai-TU_CLAVE" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "maris-velox-1b",
    "messages": [{"role": "user", "content": "Hola, quien eres?"}]
  }'
```

## Endpoints del Gateway

| Metodo | Ruta | Descripcion | Auth |
|---|---|---|---|
| POST | /v1/chat/completions | Inferencia compatible OpenAI | API key |
| GET | /v1/models | Modelos disponibles | API key |
| GET | /v1/usage | Uso del mes actual | API key |
| GET | /admin/keys | Listar claves de clientes | ADMIN_KEY |
| POST | /admin/keys | Crear clave para cliente | ADMIN_KEY |
| DELETE | /admin/keys/:id | Revocar clave | ADMIN_KEY |
| GET | /admin/stats | Estadisticas globales | ADMIN_KEY |
| GET | /health | Health check | Publica |

## Uso con Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:4000/v1",
    api_key="sk-marisai-TU_CLAVE"
)

response = client.chat.completions.create(
    model="maris-velox-1b",
    messages=[{"role": "user", "content": "Hola"}]
)
print(response.choices[0].message.content)
```

## Modelo de negocio para alquiler de API keys

1. Levantas la infraestructura (Ollama en tu maquina o vLLM en RunPod/Vast.ai)
2. Creas claves para clientes con limites de tokens o USD
3. Cobras via Viva.com segun consumo
4. El gateway registra todo en SQLite para facturacion

## Costes estimados

| Opcion | Coste | Uso recomendado |
|---|---|---|
| Ollama en PC local | 0 USD/mes | Desarrollo, uso personal |
| RunPod RTX 4090 | ~150-200 USD/mes 24/7 | Produccion baja-media |
| RunPod A100 | ~600-800 USD/mes 24/7 | Produccion alta |

El ahorro frente a Anthropic/OpenAI empieza a ser significativo a partir de varios millones de tokens/mes de forma sostenida.

## Marca

- Nombre: **Maris AI**
- Propietaria: Maria (rrhh.milchollos@gmail.com)
- Infraestructura: Docker Desktop + Ollama + Gateway propio
