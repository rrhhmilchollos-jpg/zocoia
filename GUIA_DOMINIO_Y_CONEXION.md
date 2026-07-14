# 🚀 Guía Paso a Paso: Zoco IA, Dominio y Conexión

No te preocupes si parece complicado, aquí tienes la hoja de ruta clara para conectar todo.

## 1. ¿Qué es el Gateway y dónde está?

El **Gateway** es el "cerebro" que gestiona tus clientes y modelos. 
- **En tu PC:** Está dentro de la carpeta `gateway`. Cuando ejecutas Docker, es el contenedor llamado `marisai-gateway`.
- **Su función:** Recibe las peticiones del dashboard, comprueba si la API Key es válida, descuenta tokens y le pide el trabajo a Ollama.
- **Su dirección local:** `http://localhost:4000`.

## 2. Vincular tu Dominio (zocoia.com)

Para que la gente entre en tu web usando tu dominio, debes configurar los **DNS** donde compraste el dominio (ej. GoDaddy, Namecheap, Cloudflare):

### En Railway (Frontend/Dashboard):
1. Ve a tu proyecto en Railway.
2. Haz clic en el servicio del frontend.
3. Ve a **Settings > Domains**.
4. Haz clic en **Custom Domain** y escribe `zocoia.com` (o `app.zocoia.com`).
5. Railway te dará un valor (CNAME). Cópialo.

### En tu proveedor de Dominio:
1. Busca la sección de **DNS Management**.
2. Añade un registro tipo **CNAME**:
   - **Nombre:** `app` (o `@` si es el dominio principal).
   - **Valor:** El que te dio Railway.
3. ¡Listo! Ahora al entrar en `zocoia.com` verás tu dashboard.

## 3. Conectar el Dashboard con tu PC (El Túnel)

Como el dashboard está en Railway y tus modelos en tu PC, necesitamos que Railway sepa llegar a tu PC.

### Paso A: Exponer tu PC al mundo (ngrok)
1. Descarga ngrok (es gratis) y ábrelo en tu PC.
2. Escribe: `ngrok http 4000`
3. Verás una línea que dice `Forwarding: https://xxxx-xxxx.ngrok-free.app`. **Copia esa URL**.

### Paso B: Configurar Railway
1. En Railway, ve a **Variables**.
2. Crea una variable llamada `VITE_API_URL`.
3. Pega la URL de ngrok que copiaste, añadiendo `/v1` al final.
   - Ejemplo: `https://xxxx-xxxx.ngrok-free.app/v1`

## 4. Resumen de cómo queda todo

1. **Usuario** entra en `zocoia.com` (Railway).
2. El dashboard le pregunta a `VITE_API_URL` (tu PC vía ngrok).
3. Tu **PC (Gateway)** recibe la pregunta, usa **Ollama** para responder y guarda los datos en su base de datos local.
4. El **Usuario** recibe la respuesta en su pantalla.

## 💡 Consejos de Oro

- **Para producción:** En lugar de ngrok, usa **Cloudflare Tunnel**. Es más estable, profesional y te permite usar tu propio subdominio (ej. `api.zocoia.com`) para el Gateway.
- **Seguridad:** Nunca compartas tu `ADMIN_KEY`. Es la llave maestra de todo tu sistema.
- **Docker Desktop:** Mantén siempre encendidos los contenedores `marisai-gateway` y `marisai-ollama` para que el servicio no se corte.
