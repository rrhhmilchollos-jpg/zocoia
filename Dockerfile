# Cache bust: 2026-07-18T12:52:00.000000
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
# RECHAZA la directiva `VOLUME` de Docker (rompía el build anterior), y
# tampoco hace falta `mkdir -p /data` a mano: en cuanto adjuntas un Railway
# Volume al servicio (dashboard → Command Palette ⌘K → "Create Volume",
# montado en /data), Railway crea y gestiona ese directorio en tiempo de
# arranque del contenedor — no en tiempo de build. RAILWAY_VOLUME_MOUNT_PATH
# se inyecta automáticamente y server.js ya lo usa sin tocar nada más.

EXPOSE 8080

CMD ["node", "server.js"]
