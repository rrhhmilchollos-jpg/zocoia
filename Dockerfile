# Build stage for the frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Production stage
FROM node:20-slim
WORKDIR /app

# Install dependencies for the server
COPY package*.json ./
RUN npm install --omit=dev

# Copy built frontend from previous stage
COPY --from=frontend-builder /app/dist ./public

# Copy the server script
COPY server.js ./

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
