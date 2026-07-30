# 📘 Guía de Administración de Zoco IA - Versión Final (Coolify)

¡Bienvenido! Tu infraestructura de IA está ahora completamente en la nube y funcionando 24/7 en tu propio servidor a través de Coolify. Esta guía te explica **exactamente** qué hacer para administrar tu plataforma sin complicaciones.

---

## 🎯 Lo Que Tienes Ahora

Tu Zoco IA consta de tres partes que trabajan juntas:

1. **Dashboard Web** (en Coolify) - Lo que ven tus clientes
2. **Backend Engine** (en Coolify) - El "cerebro" que gestiona todo (Node.js + Groq Cloud)
3. **Base de Datos** (Local en /data/zocoia.db) - Donde se guardan todos los datos de forma persistente

**Todo está en la nube. Tu PC no necesita estar encendido.**

---

## 🌐 Acceso a tu Plataforma

### Desde el Navegador

Simplemente abre: **https://zocoia.es**

### Credenciales de Admin

```
Email: rrhh.milchollos@gmail.com
Contraseña: 19862210Des
```

---

## 📊 Panel de Administración - Qué Puedes Hacer

### 1. Gestionar Clientes

**Ubicación:** Dashboard → Panel Admin

- Ver todos tus clientes registrados
- Ver cuántos créditos han comprado
- Ver cuántos créditos han usado
- Activar/Desactivar clientes

### 2. Gestionar Claves API

**Ubicación:** Dashboard → Claves de API

- Ver todas las claves activas (enmascaradas para seguridad)
- Crear nuevas claves con validación en caliente
- Revocar claves comprometidas
- Ver el último uso de cada clave

### 3. Gestionar Agentes y Habilidades

**Ubicación:** Dashboard → Agentes / Habilidades

- Configurar los 11 agentes del pipeline avanzado
- Editar System Prompts e hiperparámetros (Temperatura, Contexto)
- Asignar habilidades dinámicamente mediante el Toolbox

---

## 🔧 Configuración Avanzada en Coolify

### Cambiar Variables de Entorno

1. Accede a tu panel de **Coolify**.
2. Selecciona el proyecto **zocoia**.
3. Ve a la pestaña **Variables**.
4. Aquí puedes configurar:
   - `GROQ_API_KEY`: Para el motor principal de alta velocidad.
   - `E2B_API_KEY`: Para los agentes autónomos.
   - `JWT_SECRET`: Para la seguridad de las sesiones.
5. Haz clic en **Save** y Coolify redesplegará automáticamente.

### Ver Logs en Tiempo Real

1. En Coolify, entra en el recurso **zocoia-app**.
2. Haz clic en **Logs**.
3. Aquí verás cada petición, error o evento del sistema.

---

## 🆘 Solución de Problemas

### "Los cambios en GitHub no se ven en la web"

**Causa:** Coolify podría estar observando una rama distinta o el build ha fallado.

**Solución:**
- Verifica que Coolify apunta a la rama `zoco-ia-1`.
- Haz un **Redeploy** manual desde el panel de Coolify.
- Limpia la caché del navegador.

### "Error 401: No autenticado"

**Causa:** La sesión ha caducado o el token es inválido.

**Solución:**
- Cierra sesión y vuelve a entrar.
- Verifica que el `JWT_SECRET` en Coolify no ha cambiado.

### "Necesito ver la base de datos"

La base de datos es un archivo SQLite persistente en `/data/zocoia.db`.

---

## 📅 Mantenimiento Básico

### Cada Semana
- Revisa los logs en Coolify para detectar errores silenciosos.
- Verifica que el saldo de Groq Cloud es suficiente.

### Cada Mes
- Realiza un backup del archivo `/data/zocoia.db`.
- Revisa las estadísticas de uso de los clientes.

---

## 🚀 Lo Que NO Tienes Que Hacer

❌ Abrir Docker Desktop en tu PC.
❌ Mantener tu PC encendido para que la web funcione.
❌ Gestionar servidores complejos por terminal (Coolify lo hace por ti).

---

## 📞 Soporte Rápido

Si algo no funciona:
1. **Revisa los Logs en Coolify.**
2. **Verifica las Variables de Entorno.**
3. **Haz un Deploy nuevo.**

---

**¡Que disfrutes tu plataforma Zoco IA v2.0!** 🚀
