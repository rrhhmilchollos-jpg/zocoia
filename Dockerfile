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

# BLINDAJE DE DATOS: declara /data como volumen — documenta la intención de
# persistencia a nivel de imagen. NOTA IMPORTANTE: esto por sí solo NO basta
# en Railway; sigue siendo obligatorio adjuntar un Volume real desde el
# dashboard de Railway (Command Palette ⌘K → "Create Volume", montado en
# /data) para que RAILWAY_VOLUME_MOUNT_PATH exista y la base de datos
# sobreviva a los redeploys.
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8080

CMD ["node", "server.js"]
