# Variables de Entorno para Railway - Zoco IA

Este documento contiene TODAS las variables que necesitas configurar en Railway para que tu infraestructura funcione 24/7 sin dependencias locales.

## 🔐 Variables de Seguridad

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `ADMIN_KEY` | `sk-marisai-00721f5f89c10d78b286ad7f3bda6d457068b4ea10d53a5d` | Clave maestra para acceso administrativo |
| `NODE_ENV` | `production` | Entorno de ejecución |

## 🌐 Variables de Red y Dominio

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `PORT` | `8080` | Puerto en el que escucha el servicio (Railway lo asigna automáticamente) |
| `VITE_API_URL` | `https://zocoia.com/v1` | URL pública del Gateway (después de configurar DNS) |
| `VLLM_URL` | `http://localhost:8000/v1` | URL del servidor de modelos (si usas local) |

## 💾 Variables de Base de Datos

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `DB_PATH` | `/data/gateway.db` | Ruta persistente de la base de datos SQLite |
| `DATABASE_URL` | (Opcional) | Si usas PostgreSQL en Railway |

## 🤖 Variables de Modelos de IA (Opcional)

Si quieres usar modelos en la nube en lugar de locales:

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `OPENAI_API_KEY` | `sk-...` | Clave de OpenAI (si usas GPT) |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Clave de Anthropic (si usas Claude) |
| `GROQ_API_KEY` | `gsk_...` | Clave de Groq (si usas modelos rápidos) |

## 📊 Variables de Facturación

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `PRICE_PER_1K_TOKENS` | `0.001` | Precio por cada 1000 tokens (en USD) |
| `CURRENCY` | `USD` | Moneda de facturación |

---

## ✅ Cómo Configurar en Railway

1. Ve a tu proyecto en Railway: https://railway.app/project/7c1bcb64-c063-4cbf-a8a6-f8202d426e78
2. Selecciona el servicio "MIS-MODELOS-IA-propios"
3. Ve a la pestaña **Variables**
4. Añade cada variable de la tabla anterior
5. Haz clic en **Deploy** para aplicar los cambios

---

## 🚀 Estado Actual

✅ **Configurado:**
- `ADMIN_KEY` - Clave maestra
- `VITE_API_URL` - Apunta a `https://zocoia.com/v1`
- `PORT` - Automático en Railway

⏳ **Pendiente de Configurar:**
- `DB_PATH` - Asegurar que apunta a `/data/gateway.db`
- `VLLM_URL` - Configurar según tus modelos

---

## 📝 Notas Importantes

- **Base de Datos:** Railway mantiene el archivo `gateway.db` persistente en el volumen `/data`. Tus datos se guardan automáticamente.
- **Modelos Locales:** Si quieres seguir usando Ollama en tu PC, mantén `VLLM_URL` como está. Si prefieres modelos en la nube, usa las variables de OpenAI/Anthropic/Groq.
- **Actualizaciones:** Cualquier cambio en estas variables requiere un nuevo Deploy en Railway.

---

## 🔄 Próximos Pasos

1. Verifica que todas las variables estén configuradas en Railway
2. Haz un Deploy nuevo
3. Prueba accediendo a `https://zocoia.com` desde tu navegador
4. Inicia sesión con: `rrhh.milchollos@gmail.com` / `19862210Des`
