#!/bin/bash

# Script de despliegue automatizado para Railway
# Este script configura todas las variables y despliega Zoco IA

echo "🚀 Iniciando despliegue de Zoco IA en Railway..."

# Verificar que Railway CLI está instalado
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI no está instalado."
    echo "Instálalo desde: https://docs.railway.app/develop/cli"
    exit 1
fi

# Variables de entorno
export ADMIN_KEY="sk-marisai-00721f5f89c10d78b286ad7f3bda6d457068b4ea10d53a5d"
export PORT="8080"
export NODE_ENV="production"
export DB_PATH="/data/gateway.db"
export VITE_API_URL="https://zocoia.com/v1"
export VLLM_URL="http://localhost:8000/v1"

echo "✅ Variables de entorno configuradas"

# Hacer login en Railway
echo "🔐 Autenticándose en Railway..."
railway login

# Vincular proyecto
echo "📦 Vinculando proyecto..."
railway link

# Configurar variables
echo "⚙️  Configurando variables de entorno..."
railway variables set ADMIN_KEY="$ADMIN_KEY"
railway variables set PORT="$PORT"
railway variables set NODE_ENV="$NODE_ENV"
railway variables set DB_PATH="$DB_PATH"
railway variables set VITE_API_URL="$VITE_API_URL"
railway variables set VLLM_URL="$VLLM_URL"

echo "✅ Variables configuradas"

# Hacer deploy
echo "🚀 Desplegando en Railway..."
railway deploy

echo "✅ ¡Despliegue completado!"
echo ""
echo "Tu Zoco IA está ahora en vivo en: https://zocoia.com"
echo "Accede con:"
echo "  Email: rrhh.milchollos@gmail.com"
echo "  Contraseña: 19862210Des"
