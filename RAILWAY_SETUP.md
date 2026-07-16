# Guía de Configuración: Railway + Docker Local

Esta guía explica cómo conectar tu infraestructura local (Ollama/Docker Desktop) con el panel de Zoco IA desplegado en Railway.

## 1. Configuración de Variables de Entorno (ENV) en Railway

En tu proyecto de Railway, debes añadir las siguientes variables de entorno en la sección **Settings > Variables**:

| Variable | Valor Sugerido | Descripción |
| :--- | :--- | :--- |
| `VITE_API_URL` | `https://tu-gateway-publico.com/v1` | URL pública de tu Gateway (ver paso 2) |
| `ADMIN_KEY` | `sk-marisai-master-19862210...` | Tu clave maestra para el panel de administración |
| `NODE_ENV` | `production` | Entorno de ejecución |
| `PORT` | `3000` | Puerto en el que Railway servirá el frontend |

> **Nota:** Si estás usando el frontend estático directamente en Railway, asegúrate de que el `VITE_API_URL` apunte a la dirección donde tu Gateway es accesible desde internet.

## 2. Vincular Docker Local con Railway (El "Puente")

Dado que Railway está en la nube y tu Docker está en tu PC, Railway no puede ver `localhost`. Necesitas exponer tu puerto local `4000` (Gateway) o `11434` (Ollama) de forma segura.

### Opción A: Usar ngrok (Recomendado para pruebas rápidas)
1. Instala ngrok en tu PC.
2. Ejecuta: `ngrok http 4000`
3. ngrok te dará una URL como `https://random-id.ngrok-free.app`.
4. Usa esa URL en la variable `VITE_API_URL` de Railway.

### Opción B: Cloudflare Tunnel (Más estable y profesional)
1. Crea un túnel en Cloudflare Zero Trust.
2. Apunta un subdominio (ej: `api.zocoia.com`) al puerto `4000` de tu máquina local.
3. Configura `VITE_API_URL=https://api.zocoia.com/v1` en Railway.

## 3. Configuración del Gateway (server.js)

Para que el Gateway en tu PC pueda recibir peticiones de Railway, asegúrate de que en tu `docker-compose.yml` el servicio `gateway` tenga los puertos correctamente mapeados:

```yaml
gateway:
  ports:
    - "4000:4000" # Esto permite que el puerto sea accesible fuera de Docker
  environment:
    - VLLM_URL=http://ollama:11434/v1
    - ADMIN_KEY=tu-clave-maestra
```

## 4. ¿Cómo funciona todo junto?

1. **Usuario entra en Zoco IA (Railway):** El navegador carga el dashboard desde Railway.
2. **Dashboard pide datos:** El frontend hace peticiones a `VITE_API_URL` (que es tu túnel hacia tu PC).
3. **Gateway local procesa:** Tu Gateway en Docker recibe la petición, valida la API Key contra la base de datos local y pide la inferencia a Ollama.
4. **Ollama responde:** El modelo procesa la petición y devuelve el texto al Gateway.
5. **Gateway registra uso:** Se guardan los tokens usados en tu SQLite local y se devuelve la respuesta al dashboard.

## 5. Automatización de API Keys

Como ya tienes el sistema de creación de llaves en el Gateway:
- Cuando un cliente "compra" tokens en el dashboard, el frontend llama al endpoint `POST /admin/keys` de tu Gateway local.
- Tu Gateway local genera la llave y la guarda en **TU** base de datos local.
- Railway no guarda nada sensible, solo sirve la interfaz. Todo el "cerebro" y los datos están seguros en tu infraestructura local.

## 6. Verificación de Modelos

En tu dashboard, verás los modelos definidos en `models_registry` de tu base de datos local. Si quieres añadir más modelos, hazlo directamente en tu Gateway local o mediante el panel de administración si lo habilitas para ello.
