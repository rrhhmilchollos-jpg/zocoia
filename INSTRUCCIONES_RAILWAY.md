# Configuración de Producción en Railway para Zoco IA

Para que la aplicación funcione al 100% y los datos sean permanentes, debes seguir estos pasos en tu panel de Railway:

## 1. Configurar el Volumen Persistente
1. Ve a tu proyecto en Railway.
2. Haz clic en **"Add Service"** -> **"Volume"**.
3. Nómbralo `zocoia-data`.
4. En la configuración del servicio de la aplicación, ve a la pestaña **"Settings"**.
5. Busca la sección **"Volumes"** y haz clic en **"Mount Volume"**.
6. Selecciona el volumen `zocoia-data` y pon como punto de montaje (Mount Path): `/data`.

## 2. Configurar Variables de Entorno
En la pestaña **"Variables"** del servicio, asegúrate de tener las siguientes:

| Variable | Valor Sugerido | Descripción |
|----------|----------------|-------------|
| `JWT_SECRET` | `genera_una_cadena_larga_aleatoria` | Para mantener las sesiones activas tras reiniciar. |
| `ADMIN_EMAIL` | `rrhh.milchollos@gmail.com` | El email para tu cuenta de administrador. |
| `ADMIN_PASSWORD` | `tu_contraseña_segura` | La contraseña para tu cuenta de administrador. |
| `DB_PATH` | `/data/app.db` | Ruta al archivo de base de datos en el volumen. |
| `RAILWAY_VOLUME_MOUNT_PATH` | `/data` | Punto de montaje del volumen. |
| `VITE_API_URL` | `https://tu-app.up.railway.app` | La URL pública de tu backend. |

## 3. Despliegue
Una vez configurado el volumen y las variables, Railway redesplegará la aplicación automáticamente con los nuevos cambios que he subido al repositorio.
