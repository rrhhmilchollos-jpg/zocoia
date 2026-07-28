import { Sandbox as CodeSandbox } from '@e2b/code-interpreter';
import { Sandbox as DesktopSandbox } from '@e2b/desktop';

const codeSandboxes = new Map(); // workspaceId -> CodeSandbox
const desktopSandboxes = new Map(); // workspaceId -> DesktopSandbox

const E2B_SANDBOX_TIMEOUT_MS = Number(process.env.E2B_SANDBOX_TIMEOUT_MS || 10 * 60 * 1000); // 10 min de vida del sandbox
const E2B_CALL_TIMEOUT_MS = Number(process.env.E2B_CALL_TIMEOUT_MS || 45 * 1000); // timeout duro por acción individual

export function withHardTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout (${label}): sin respuesta tras ${ms / 1000}s`)), ms)),
  ]);
}

export function emitLive(context, payload) {
  try {
    context?.onEvent?.({ workspaceId: context?.workspaceId, ...payload });
  } catch {
    // un fallo del listener del frontend nunca debe tumbar la ejecución de la tool
  }
}

export async function getCodeSandbox(workspaceId, apiKey) {
  let sbx = codeSandboxes.get(workspaceId);
  if (sbx) {
    try {
      await sbx.setTimeout(E2B_SANDBOX_TIMEOUT_MS); // sigue viva, renovamos el TTL
      return sbx;
    } catch {
      codeSandboxes.delete(workspaceId); // se murió/expiró, se recrea abajo
    }
  }
  sbx = await withHardTimeout(
    CodeSandbox.create({ apiKey, timeoutMs: E2B_SANDBOX_TIMEOUT_MS }),
    E2B_CALL_TIMEOUT_MS,
    'crear sandbox de código'
  );
  codeSandboxes.set(workspaceId, sbx);
  return sbx;
}

export async function getDesktopSandbox(workspaceId, apiKey) {
  let sbx = desktopSandboxes.get(workspaceId);
  if (sbx) {
    try {
      await sbx.setTimeout(E2B_SANDBOX_TIMEOUT_MS);
      return sbx;
    } catch {
      desktopSandboxes.delete(workspaceId);
    }
  }
  sbx = await withHardTimeout(
    DesktopSandbox.create({ apiKey, timeoutMs: E2B_SANDBOX_TIMEOUT_MS, resolution: [1280, 800] }),
    E2B_CALL_TIMEOUT_MS,
    'crear sandbox de escritorio'
  );
  await sbx.stream.start(); // Iniciar el stream para capturas de pantalla
  desktopSandboxes.set(workspaceId, sbx);
  return sbx;
}
