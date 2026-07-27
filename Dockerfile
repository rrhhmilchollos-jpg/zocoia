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
RUN apt-get update && apt-get install -y python3 make g++ curl && rm -rf /var/lib/apt/lists/*

# Install dependencies for the server
COPY package*.json ./
RUN npm install --omit=dev

# Copy built frontend from previous stage
COPY --from=frontend-builder /app/dist ./public

# Copy TODOS los .js sueltos de la raiz del repo (server.js + todos sus
# modulos locales: tools.js, bridge-marisai.js, bridge-marisai-prompts.js,
# seed-owner-agents.js, zoco-sessions.js, zoco-console.js, y cualquier
# modulo nuevo que se añada en el futuro) -- evita tener que acordarse de
# añadir cada archivo nuevo a mano en este Dockerfile.
COPY *.js ./

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Usa el endpoint /health que ya existe en server.js para que el
# orquestador (Coolify/Railway) sepa si el contenedor esta realmente vivo,
# no solo arrancado.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["node", "server.js"]
