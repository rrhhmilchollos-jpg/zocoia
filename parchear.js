// parchear.js — Migraciones y comprobaciones ligeras previas al arranque.
// Este script se ejecuta en "npm start" antes de server.js. Si no hay nada
// que parchear, termina en silencio con código 0 para no bloquear el deploy.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  // Asegurar que el directorio de datos existe (Coolify/volúmenes)
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  console.log('✅ parchear.js: entorno verificado, arrancando servidor…');
} catch (err) {
  console.warn('⚠️  parchear.js:', err.message);
}
process.exit(0);
