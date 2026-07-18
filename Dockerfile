# Cache bust: 2026-07-16T04:37:38.342669
# Build stage for the frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Production stage
FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install dependencies for the server
COPY package*.json ./
RUN npm install --omit=dev

# Copy built frontend from previous stage
COPY --from=frontend-builder /app/dist ./public

# Copy the server script and its local modules
COPY server.js tools.js bridge-marisai.js ./

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# BLINDAJE DE DATOS: la persistencia real NO se declara aquí. Railway
# RECHAZA explícitamente la directiva `VOLUME` de Docker ("dockerfile
# invalid: docker VOLUME ... is not supported, use Railway Volumes") —
# tuvo que quitarse de este Dockerfile porque directamente rompía el deploy.
# El único paso que hace persistente /data es 100% de configuración, fuera
# de este archivo: Railway dashboard → este servicio → Command Palette ⌘K
# → "Create Volume" → móntalo en /data. En cuanto exista, Railway inyecta
# RAILWAY_VOLUME_MOUNT_PATH=/data automáticamente y server.js ya lo detecta
# y lo usa sin tocar nada más (ver DB_PATH en server.js).
RUN mkdir -p /data

EXPOSE 8080

CMD ["node", "server.js"]
