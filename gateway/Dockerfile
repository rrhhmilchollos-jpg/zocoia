FROM node:20-slim

# better-sqlite3 compila nativo: necesitamos build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 4000

CMD ["node", "server.js"]
