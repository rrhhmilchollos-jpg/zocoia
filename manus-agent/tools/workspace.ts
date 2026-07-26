/**
 * manus-agent/tools/workspace.ts
 *
 * Funciones reales de sistema de archivos que el agente usa dentro de un
 * "workspace" local: una carpeta temporal por tarea, normalmente el clon
 * del repositorio de GitHub (ver tools/github.ts).
 *
 * Toda ruta se resuelve SIEMPRE dentro del workspace de la tarea. Se
 * bloquea cualquier intento de escapar con "../" o rutas absolutas para
 * que el modelo no pueda leer/escribir fuera de su sandbox.
 */

import { promises as fs } from "fs";
import path from "path";

export class WorkspaceError extends Error {}

/** Resuelve una ruta relativa dentro del workspace y valida que no escape de él. */
function resolveSafePath(workspaceDir: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new WorkspaceError(
      `Ruta no permitida (absoluta): ${relativePath}. Usa rutas relativas al repo.`
    );
  }
  const resolved = path.normalize(path.join(workspaceDir, relativePath));
  const workspaceRoot = path.normalize(workspaceDir + path.sep);
  if (!resolved.startsWith(workspaceRoot) && resolved !== path.normalize(workspaceDir)) {
    throw new WorkspaceError(
      `Ruta fuera del workspace bloqueada: ${relativePath}`
    );
  }
  return resolved;
}

export interface ReadFileResult {
  path: string;
  content: string;
  size_bytes: number;
}

export async function readFile(
  workspaceDir: string,
  relativePath: string
): Promise<ReadFileResult> {
  const fullPath = resolveSafePath(workspaceDir, relativePath);
  const stat = await fs.stat(fullPath).catch(() => null);
  if (!stat || !stat.isFile()) {
    throw new WorkspaceError(`Archivo no encontrado: ${relativePath}`);
  }
  // Límite de seguridad: no cargar archivos gigantes en el contexto del modelo.
  const MAX_BYTES = 300_000;
  if (stat.size > MAX_BYTES) {
    throw new WorkspaceError(
      `Archivo demasiado grande (${stat.size} bytes) para leerlo completo: ${relativePath}`
    );
  }
  const content = await fs.readFile(fullPath, "utf-8");
  return { path: relativePath, content, size_bytes: stat.size };
}

export interface WriteFileResult {
  path: string;
  action: "created" | "modified";
  bytes_written: number;
}

export async function writeFile(
  workspaceDir: string,
  relativePath: string,
  content: string
): Promise<WriteFileResult> {
  const fullPath = resolveSafePath(workspaceDir, relativePath);
  const existed = await fs
    .stat(fullPath)
    .then(() => true)
    .catch(() => false);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
  return {
    path: relativePath,
    action: existed ? "modified" : "created",
    bytes_written: Buffer.byteLength(content, "utf-8"),
  };
}

export interface DeleteFileResult {
  path: string;
  action: "deleted";
}

export async function deleteFile(
  workspaceDir: string,
  relativePath: string
): Promise<DeleteFileResult> {
  const fullPath = resolveSafePath(workspaceDir, relativePath);
  await fs.unlink(fullPath);
  return { path: relativePath, action: "deleted" };
}

export interface ListFilesEntry {
  path: string;
  type: "file" | "directory";
}

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
]);

/** Lista archivos recursivamente (para que el modelo explore la estructura del repo). */
export async function listFiles(
  workspaceDir: string,
  relativePath: string = ".",
  maxDepth: number = 4
): Promise<ListFilesEntry[]> {
  const startPath = resolveSafePath(workspaceDir, relativePath);
  const results: ListFilesEntry[] = [];

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(workspaceDir, abs);
      if (entry.isDirectory()) {
        results.push({ path: rel, type: "directory" });
        await walk(abs, depth + 1);
      } else {
        results.push({ path: rel, type: "file" });
      }
    }
  }

  await walk(startPath, 0);
  return results;
}
