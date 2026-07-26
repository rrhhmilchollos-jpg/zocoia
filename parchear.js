// parchear.js — Parche de resiliencia para tools.js
//
// Objetivo: si el modelo "alucina" un nombre de herramienta de búsqueda que
// no existe (search / brave / google...), se redirige a la herramienta real
// 'busqueda_web' en vez de fallar.
//
// BLINDAJE: la versión anterior inyectaba el snippet justo después del texto
// "async function runToolLoop", es decir, ENTRE el nombre de la función y su
// lista de parámetros — eso producía un SyntaxError que tiraba abajo el
// arranque (npm start ejecuta este script antes de server.js). Ahora:
//   1. El punto de anclaje es el interior del bucle de tool_calls, donde la
//      variable `call` sí existe y el código es sintácticamente válido.
//   2. Antes de sobrescribir tools.js se valida la sintaxis del resultado
//      con node --check; si no compila, NO se toca el archivo original.
//   3. Cualquier error aquí nunca rompe el arranque: el proceso siempre
//      termina con código 0 y server.js arranca igualmente.

import fs from 'fs';
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';

const MARCA = 'Parche Zoco IA';
// Punto de anclaje real y seguro dentro de runToolLoop (bucle de tool_calls).
const ANCLA = "        const name = call.function?.name;";
const PARCHE = `        const name = call.function?.name;
        // ${MARCA}: Resiliencia ante alucinaciones de herramientas.
        // Si el modelo inventa una tool de búsqueda inexistente, se redirige
        // a la herramienta real 'busqueda_web' en vez de fallar.
        let nombreFinal = name;
        if (nombreFinal && !allowedTools.includes(nombreFinal) && (nombreFinal.includes('search') || nombreFinal.includes('brave') || nombreFinal.includes('google'))) {
          console.log('🔄 Redirigiendo alucinación de herramienta "' + nombreFinal + '" a busqueda_web...');
          nombreFinal = 'busqueda_web';
        }`;

try {
  let contenido = fs.readFileSync('tools.js', 'utf8');

  if (contenido.includes(MARCA)) {
    console.log('ℹ️  El parche de resiliencia ya estaba aplicado en tools.js — no se hace nada.');
    process.exit(0);
  }

  if (!contenido.includes(ANCLA)) {
    console.log('⚠️  No se encontró el punto de anclaje en runToolLoop — se omite el parche (el servidor arranca igualmente).');
    process.exit(0);
  }

  let nuevo = contenido.replace(ANCLA, PARCHE);
  // Tras redirigir el nombre, el resto del bloque debe usar nombreFinal.
  nuevo = nuevo.replace(
    "const result = await runTool(name, args, { workspacesRoot, workspaceId, allowedTools, context });",
    "const result = await runTool(nombreFinal, args, { workspacesRoot, workspaceId, allowedTools, context });"
  );

  // Validación de sintaxis ANTES de sobrescribir el archivo real.
  const tmp = path.join(os.tmpdir(), `tools-parcheado-${Date.now()}.js`);
  fs.writeFileSync(tmp, nuevo, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  } catch (syntaxErr) {
    fs.unlinkSync(tmp);
    console.error('❌ El parche generaría un SyntaxError — se conserva tools.js original intacto.');
    process.exit(0); // nunca bloquear el arranque
  }
  fs.unlinkSync(tmp);

  fs.writeFileSync('tools.js', nuevo, 'utf8');
  console.log('✅ PARCHE DE RESILIENCIA APLICADO CON ÉXITO EN TOOLS.JS');
} catch (e) {
  console.error('❌ Error al aplicar el parche (el servidor arranca igualmente):', e.message);
}
process.exit(0);
