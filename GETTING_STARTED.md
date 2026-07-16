# Guía de arranque — Zoco IA desde cero

Sigue las fases en orden. No saltes ninguna la primera vez.

## Fase 0 — Antes de empezar
- Tarjeta de crédito/débito (RunPod + dominio son costes reales)
- Cuenta de GitHub
- 30-60 minutos sin prisa

## Fase 1 — Sube el proyecto a GitHub
```bash
cd ruta/donde/descargaste/zocoia
git init
git add .
git commit -m "Primer commit de Zoco IA"
```
Crea el repo privado `zocoia` en GitHub, luego:
```bash
git remote add origin https://github.com/rrhhmilchollos-jpg/zocoia.git
git branch -M main
git push -u origin main
```

## Fase 2 — Registra el dominio
Registra `zocoia.com` en DonDominio (o tu registrador habitual). No toques el DNS aún.

## Fase 3 — RunPod: crea la GPU
1. Cuenta en runpod.io + método de pago
2. Pods → Deploy → GPU RTX 4090
3. Template con Docker + CUDA preinstalado
4. Expone puertos 80, 443, 8000
5. Deploy y espera "Running"

## Fase 4 — Conéctate por SSH
Usa el botón "Connect" del pod, o la terminal web si no tienes claves SSH configuradas.

## Fase 5 — Instala Docker (si falta)
```bash
docker --version
curl -fsSL https://get.docker.com | sh   # solo si no estaba instalado
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
```
Si falla la GPU dentro de Docker:
```bash
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | tee /etc/apt/sources.list.d/nvidia-docker.list
apt-get update && apt-get install -y nvidia-container-toolkit
systemctl restart docker
```

## Fase 6 — Clona el proyecto en el servidor
```bash
git clone https://github.com/rrhhmilchollos-jpg/zocoia.git
cd zocoia
```

## Fase 7 — Levanta vLLM y el gateway
```bash
docker compose up -d vllm
docker compose logs -f vllm     # espera "Uvicorn running on http://0.0.0.0:8000"
curl http://localhost:8000/v1/models
docker compose up -d gateway
```

## Fase 8 — Primera API key
```bash
docker compose exec gateway node server.js create-key "prueba-ivan" 500000
```
Guarda la key `sk-priv-...` — solo se muestra una vez.

## Fase 9 — Prueba en local
```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer sk-priv-TU_KEY_AQUI" \
  -H "Content-Type: application/json" \
  -d '{"model": "Qwen/Qwen2.5-Coder-32B-Instruct", "messages": [{"role": "user", "content": "Hola, responde en una frase"}]}'
```
Si responde, el corazón del sistema funciona. El resto es exponerlo al público con seguridad.

## Fase 10 — DNS
En DonDominio, entradas DNS de zocoia.com:
- Registro A `@` → IP pública del pod
- Registro A `www` → misma IP

Verifica propagación:
```bash
dig zocoia.com
```

## Fase 11 — SSL
```bash
apt-get install -y certbot
mkdir -p /var/www/certbot
certbot certonly --webroot -w /var/www/certbot -d zocoia.com -d www.zocoia.com

mkdir -p ~/zocoia/nginx/certs
cp /etc/letsencrypt/live/zocoia.com/fullchain.pem ~/zocoia/nginx/certs/
cp /etc/letsencrypt/live/zocoia.com/privkey.pem ~/zocoia/nginx/certs/
```

## Fase 12 — Levanta Nginx
```bash
docker compose up -d nginx
```

## Fase 13 — Prueba final en producción
Desde tu propio ordenador:
```bash
curl https://zocoia.com/v1/chat/completions \
  -H "Authorization: Bearer sk-priv-TU_KEY_AQUI" \
  -H "Content-Type: application/json" \
  -d '{"model": "Qwen/Qwen2.5-Coder-32B-Instruct", "messages": [{"role": "user", "content": "Hola"}]}'
```

Si responde: Zoco IA está en producción, con dominio propio, SSL y control de acceso por API key.

## Si algo falla
- `docker compose logs -f <servicio>` para ver qué está pasando (vllm, gateway o nginx)
- `docker compose ps` para ver qué contenedores están corriendo
- Si vLLM no arranca, suele ser falta de VRAM — prueba con un modelo más pequeño (`Qwen/Qwen2.5-Coder-7B-Instruct`) mientras confirmas que todo lo demás funciona
