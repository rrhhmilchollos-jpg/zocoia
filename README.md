# Zoco IA — infraestructura propia de inferencia

Proyecto independiente. No comparte código, base de datos ni infraestructura con Maris AI.

Zoco IA es tu propio "mercado" de acceso a modelos de IA open source: alojas la inferencia,
y vendes acceso por API key con medición de consumo y facturación vía Viva.com.

## Arquitectura

```
Internet → Nginx (TLS, rate limit) → Gateway (auth + medición) → vLLM (GPU) → modelo
                                            ↓
                                     SQLite (api_keys, usage_log)
```

- **vLLM**: sirve el modelo open source (Qwen2.5-Coder-32B por defecto), API compatible con OpenAI.
- **Gateway**: capa propia en Express. Sin esto no puedes controlar ni cobrar a nadie — es lo que faltaba en el manual original.
- **Nginx**: TLS + rate limiting delante de todo.
- **Agent**: script de ejemplo con sandbox de ejecución REAL vía Docker (no simulado).

## Coste real (para que no haya sorpresas)

Esto NO es gratis. Cambias coste por token por coste de GPU + tu tiempo de operación:

- GPU en RunPod/Vast.ai: desde ~0.20-0.50 $/hora para una RTX 4090, más para A100/H100.
- Si la dejas encendida 24/7: aproximadamente 150-350 $/mes según GPU.
- Tiempo de mantenimiento: cuenta con algunas horas al mes tuyas (actualizar imágenes, vigilar logs, rotar claves).

Esto solo compensa frente a la API de Anthropic/OpenAI si tu volumen mensual es alto (varios millones de tokens/mes de forma sostenida). Para volumen bajo, sigue costando más que pagar por token — el ahorro real llega cuando factures a terceros lo suficiente para cubrir la GPU fija.

## Paso 1 — Conseguir una GPU (no necesitas hardware propio)

Opciones sin comprar nada:

**RunPod** (recomendado para empezar):
1. Crea cuenta en runpod.io
2. Despliega un "Pod" con plantilla "vLLM" o una imagen base con CUDA, GPU RTX 4090 o A10G
3. Anota la IP pública o usa su proxy HTTPS integrado

**Vast.ai** (más barato, menos garantías de uptime):
1. Busca oferta de GPU por hora (filtra por VRAM ≥ 24GB para el modelo de 32B)
2. Lanza instancia con imagen Docker `vllm/vllm-openai:latest`

Una vez tengas la IP del servidor con GPU, sustituye la sección `vllm` de `docker-compose.yml` para que apunte ahí, o despliega el `docker-compose.yml` completo directamente en esa máquina si tiene Docker + nvidia-container-toolkit instalados.

## Paso 2 — Levantar el stack

En la máquina con GPU (o localmente si tienes una):

```bash
git clone <tu-repo>
cd ai-infra-propia
docker compose up -d vllm
docker compose up -d gateway
```

Verifica que vLLM responde:
```bash
curl http://localhost:8000/v1/models
```

## Paso 3 — Crear tu primera API key para vender acceso

```bash
docker compose exec gateway node server.js create-key "nombre-del-cliente" 1000000
```
(El segundo argumento es el límite mensual de tokens, opcional — omítelo para ilimitado)

Guarda la key que te devuelve — es la única vez que se muestra en claro.

## Paso 4 — Probar el gateway como lo haría un cliente

```bash
curl https://tu-dominio.com/v1/chat/completions \
  -H "Authorization: Bearer sk-priv-xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen2.5-Coder-32B-Instruct",
    "messages": [{"role": "user", "content": "Hola"}]
  }'
```

## Paso 5 — Nginx + dominio propio (para venderlo con cara seria)

1. Dominio: `zocoia.com`
2. Apunta el DNS (registro A) a la IP de tu servidor con GPU o a un balanceador
3. Genera certificados con certbot:
   ```bash
   certbot certonly --webroot -w /var/www/certbot -d tu-dominio.com
   ```
4. Copia los certificados a `./nginx/certs/`
5. `docker compose up -d nginx` (el dominio `zocoia.com` ya está configurado en `nginx.conf`)

## Pendiente de decidir contigo

- Modelo(s) a servir además de Qwen2.5-Coder (¿necesitas uno de propósito general, no solo código?)
- Sistema de facturación real (Viva.com conectado al gateway, para cobrar automáticamente por consumo)
- Panel de administración web (ahora mismo crear keys es solo por CLI)

## Marca

- Nombre: **Zoco IA**
- Dominio: `zocoia.com`
- Naming interno de servicios: `zocoia-gateway`, `zocoia-vllm`, `zocoia-nginx`
