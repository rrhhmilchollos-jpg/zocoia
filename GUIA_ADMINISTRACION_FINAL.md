# 📘 Guía de Administración de Zoco IA - Versión Final

¡Bienvenido! Tu infraestructura de IA está ahora completamente en la nube y funcionando 24/7. Esta guía te explica **exactamente** qué hacer para administrar tu plataforma sin complicaciones.

---

## 🎯 Lo Que Tienes Ahora

Tu Zoco IA consta de tres partes que trabajan juntas:

1. **Dashboard Web** (en Railway) - Lo que ven tus clientes
2. **Gateway** (en Railway) - El "cerebro" que gestiona todo
3. **Base de Datos** (en Railway) - Donde se guardan todos los datos

**Todo está en la nube. Tu PC no necesita estar encendido.**

---

## 🌐 Acceso a tu Plataforma

### Desde el Navegador

Simplemente abre: **https://zocoia.com**

(Si aún no funciona, es porque los DNS de Piensa Solutions están actualizándose. Espera 24-48 horas o usa la URL temporal de Railway)

### Credenciales de Admin

```
Email: rrhh.milchollos@gmail.com
Contraseña: 19862210Des
```

---

## 📊 Panel de Administración - Qué Puedes Hacer

### 1. Gestionar Clientes

**Ubicación:** Dashboard → Panel de Control → Usuarios

- Ver todos tus clientes registrados
- Ver cuántos tokens han comprado
- Ver cuántos tokens han usado
- Desactivar clientes si es necesario

### 2. Gestionar Claves API

**Ubicación:** Dashboard → Panel de Control → Claves API

- Ver todas las claves activas
- Crear nuevas claves para clientes
- Desactivar claves comprometidas
- Ver el uso de cada clave

### 3. Monitorear Uso y Facturación

**Ubicación:** Dashboard → Estadísticas

- Tokens totales usados este mes
- Ingresos generados
- Número de solicitudes
- Clientes activos

### 4. Gestionar Agentes

**Ubicación:** Dashboard → Agentes

- Ver todos los agentes creados
- Activar/desactivar agentes
- Ver estadísticas de uso por agente

---

## 💰 Cómo Ganan Dinero tus Clientes

### Paso 1: Comprar Tokens

Tus clientes entran a `https://zocoia.com` y hacen clic en **"Comprar Tokens"**.

Pueden elegir entre:
- **Starter:** 100,000 tokens por $10
- **Professional:** 500,000 tokens por $40
- **Enterprise:** 2,000,000 tokens por $150
- **Unlimited:** Acceso ilimitado por $500/mes

### Paso 2: Obtener su Clave API

Una vez comprados, reciben una **clave API única** que pueden usar en sus aplicaciones.

### Paso 3: Usar la API

Tus clientes pueden hacer llamadas como:

```bash
curl https://zocoia.com/v1/chat/completions \
  -H "Authorization: Bearer sk-marisai-XXXXX" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "maris-velox-1b",
    "messages": [{"role": "user", "content": "Hola"}]
  }'
```

**Tú ganas dinero:** Cada 1,000 tokens que usen, les cobras (configurado en `PRICE_PER_1K_TOKENS`).

---

## 🔧 Configuración Avanzada (Si Necesitas Cambiar Algo)

### Cambiar el Precio por Token

1. Ve a: https://railway.app/project/7c1bcb64-c063-4cbf-a8a6-f8202d426e78
2. Selecciona el servicio "MIS-MODELOS-IA-propios"
3. Ve a **Variables**
4. Busca `PRICE_PER_1K_TOKENS` y cambia el valor
5. Haz clic en **Deploy** para aplicar

### Cambiar la Clave Maestra

⚠️ **Cuidado:** Esto afecta a todo el sistema.

1. Ve a **Variables** en Railway
2. Busca `ADMIN_KEY`
3. Cambia el valor a una nueva clave
4. Haz clic en **Deploy**

### Conectar Modelos Diferentes

Si quieres usar modelos de OpenAI, Anthropic o Groq en lugar de locales:

1. Ve a **Variables** en Railway
2. Añade `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` o `GROQ_API_KEY` con tu clave
3. Modifica el `VLLM_URL` para apuntar al servicio correcto
4. Haz clic en **Deploy**

---

## 🆘 Solución de Problemas

### "No puedo acceder a zocoia.com"

**Causa:** Los DNS aún se están actualizando.

**Solución:** 
- Espera 24-48 horas
- Mientras tanto, usa la URL temporal de Railway (te la doy si la necesitas)

### "Recibo error 401 en la API"

**Causa:** La clave API del cliente es inválida o ha expirado.

**Solución:**
- Ve al Panel de Admin → Claves API
- Verifica que la clave esté activa
- Crea una nueva clave si es necesario

### "Los tokens no se están descontando"

**Causa:** Posiblemente el Gateway no está procesando las solicitudes.

**Solución:**
- Ve a Railway → Logs
- Busca errores
- Si hay problemas, haz un nuevo Deploy

### "Necesito ver la base de datos"

La base de datos está en Railway en `/data/gateway.db`. Es un archivo SQLite. Si necesitas acceder:

1. Ve a Railway → Console
2. Escribe: `sqlite3 /data/gateway.db`
3. Ejecuta comandos SQL

---

## 📅 Mantenimiento Básico

### Cada Semana

- Revisa el Dashboard para ver si hay nuevos clientes
- Verifica que no hay errores en los Logs

### Cada Mes

- Revisa las estadísticas de facturación
- Comprueba que todos los clientes activos tienen saldo

### Cada Trimestre

- Actualiza los precios si es necesario
- Revisa la seguridad (cambia claves si es necesario)

---

## 🚀 Lo Que NO Tienes Que Hacer

❌ Abrir Docker Desktop
❌ Ejecutar comandos en la terminal
❌ Mantener tu PC encendido
❌ Actualizar manualmente el código
❌ Gestionar servidores

**Railway se encarga de todo eso automáticamente.**

---

## 📞 Soporte Rápido

Si algo no funciona:

1. **Revisa los Logs en Railway:** https://railway.app/project/7c1bcb64-c063-4cbf-a8a6-f8202d426e78/service/6a093832-de61-4338-8817-ee53cda21b2a/logs
2. **Verifica las Variables:** https://railway.app/project/7c1bcb64-c063-4cbf-a8a6-f8202d426e78/service/6a093832-de61-4338-8817-ee53cda21b2a/variables
3. **Haz un Deploy nuevo:** A veces simplemente re-desplegar soluciona problemas

---

## 🎉 ¡Felicidades!

Tu infraestructura de IA está lista para generar ingresos. Tus clientes pueden:

✅ Registrarse en tu web
✅ Comprar tokens
✅ Usar la API para crear agentes
✅ Pagar por cada token que usen

**Y tú ganas dinero automáticamente.**

¡Que disfrutes tu plataforma! 🚀
