/**
 * manus-agent/tools/workspace.js
 *
 * Funciones reales de sistema de archivos que el agente usa dentro de un
 * "workspace" local: la carpeta temporal donde se clona el repo de
 * GitHub (ver tools/github.js). Toda ruta se resuelve SIEMPRE dentro del
 * workspace de la tarea: se bloquea cualquier intento de escapar con
 * "../" o rutas absolutas.
 */

import { promises as fs } from 'fs';
import path from 'path';

export class WorkspaceError extends Error {}

function resolveSafePath(workspaceDir, relativePath) {
  if (path.isAbsolute(relativePath)) {
    throw new WorkspaceError(
      `Ruta no permitida (absoluta): ${relativePath}. Usa rutas relativas al repo.`
    );
  }
  const resolved = path.normalize(path.join(workspaceDir, relativePath));
  const workspaceRoot = path.normalize(workspaceDir + path.sep);
  if (!resolved.startsWith(workspaceRoot) && resolved !== path.normalize(workspaceDir)) {
    throw new WorkspaceError(`Ruta fuera del workspace bloqueada: ${relativePath}`);
  }
  return resolved;
}

export async function readFile(workspaceDir, relativePath) {
  const fullPath = resolveSafePath(workspaceDir, relativePath);
  const stat = await fs.stat(fullPath).catch(() => null);
  if (!stat || !stat.isFile()) {
    throw new WorkspaceError(`Archivo no encontrado: ${relativePath}`);
  }
  const MAX_BYTES = 300_000;
  if (stat.size > MAX_BYTES) {
    throw new WorkspaceError(
      `Archivo demasiado grande (${stat.size} bytes) para leerlo completo: ${relativePath}`
    );
  }
  const content = await fs.readFile(fullPath, 'utf-8');
  return { path: relativePath, content, size_bytes: stat.size };
}

export async function writeFile(workspaceDir, relativePath, content) {
  const fullPath = resolveSafePath(workspaceDir, relativePath);
  const existed = await fs.stat(fullPath).then(() => true).catch(() => false);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
  return {
    path: relativePath,
    action: existed ? 'modified' : 'created',
    bytes_written: Buffer.byteLength(content, 'utf-8'),
  };
}

export async function deleteFile(workspaceDir, relativePath) {
  const fullPath = resolveSafePath(workspaceDir, relativePath);
  await fs.unlink(fullPath);
  return { path: relativePath, action: 'deleted' };
}

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.turbo']);

export async function listFiles(workspaceDir, relativePath = '.', maxDepth = 4) {
  const startPath = resolveSafePath(workspaceDir, relativePath);
  const results = [];

  async function walk(dir, depth) {
    if (depth > maxDepth) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(workspaceDir, abs);
      if (entry.isDirectory()) {
        results.push({ path: rel, type: 'directory' });
        await walk(abs, depth + 1);
      } else {
        results.push({ path: rel, type: 'file' });
      }
    }
  }

  await walk(startPath, 0);
  return results;
}
