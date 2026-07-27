/**
 * manus-agent/tools/index.js
 *
 * Une las funciones "reales" (workspace.js, github.js, coolify.js) con el
 * formato de function-calling estilo OpenAI (el que ya habla
 * processChatCompletion() en server.js con Ollama, en modo passthrough
 * de tools del cliente), y expone un único executeTool().
 */

import * as workspace from './workspace.js';
import * as github from './github.js';
import * as coolify from './coolify.js';

export const TOOL_DEFINITIONS = [
  {
    name: 'list_files',
    description:
      'Lista archivos y carpetas del repositorio clonado, para explorar su estructura antes de editar.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: "Ruta relativa a explorar. Usa '.' para la raíz del repo." },
      },
      required: [],
    },
  },
  {
    name: 'read_file',
    description: 'Lee el contenido completo de un archivo del repositorio.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ruta relativa del archivo dentro del repo.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Crea o sobrescribe un archivo con el contenido dado. Usa esto para aplicar cambios de código.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ruta relativa del archivo dentro del repo.' },
        content: { type: 'string', description: 'Contenido completo y final del archivo.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'delete_file',
    description: 'Elimina un archivo del repositorio.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ruta relativa del archivo a borrar.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'finish_task',
    description:
      'Marca la tarea como terminada. Llama a esta herramienta SOLO cuando ya hayas hecho todos los cambios necesarios. Provee un resumen claro de lo que cambiaste.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Resumen en español de los cambios realizados, para mostrar al usuario.',
        },
      },
      required: ['summary'],
    },
  },
];

export async function executeTool(name, input, ctx) {
  try {
    switch (name) {
      case 'list_files': {
        const files = await workspace.listFiles(ctx.workspaceDir, input.path || '.');
        return { ok: true, output: files };
      }

      case 'read_file': {
        const result = await workspace.readFile(ctx.workspaceDir, input.path);
        return { ok: true, output: result };
      }

      case 'write_file': {
        if (!ctx.filesTouched.has(input.path)) {
          const before = await workspace
            .readFile(ctx.workspaceDir, input.path)
            .then((r) => r.content)
            .catch(() => undefined);
          ctx.filesTouched.set(input.path, { before });
        }
        const result = await workspace.writeFile(ctx.workspaceDir, input.path, input.content);
        return { ok: true, output: result };
      }

      case 'delete_file': {
        if (!ctx.filesTouched.has(input.path)) {
          const before = await workspace
            .readFile(ctx.workspaceDir, input.path)
            .then((r) => r.content)
            .catch(() => undefined);
          ctx.filesTouched.set(input.path, { before });
        }
        const result = await workspace.deleteFile(ctx.workspaceDir, input.path);
        return { ok: true, output: result };
      }

      case 'finish_task':
        return { ok: true, output: { summary: input.summary } };

      default:
        return { ok: false, output: null, error: `Herramienta desconocida: ${name}` };
    }
  } catch (err) {
    return { ok: false, output: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export { github, coolify, workspace };
