// -----------------------------------------------------------------------------
// zoco-tools-extra.js — Herramientas avanzadas de "El Ordenador de Zoco".
//
//   · editar_archivo   : edición quirúrgica por búsqueda/reemplazo exacto.
//   · navegador        : navegador visual real (E2B Desktop) con capturas.
//   · exponer_puerto   : URL pública temporal de un servicio local.
//
// Se mantienen separadas del núcleo para que zoco-computer.js siga legible y
// para que un fallo de E2B (dependencia externa opcional) nunca tumbe el resto
// del agente: las importaciones son dinámicas y degradan con elegancia.
// -----------------------------------------------------------------------------

import fsp from 'fs/promises';

// ─── Edición quirúrgica de archivos ──────────────────────────────────────────

// Aplica una lista de ediciones {buscar, reemplazar, todas?} sobre un archivo.
// Es atómico: si alguna cadena no aparece (o aparece de forma ambigua cuando no
// se pide `todas`), no se escribe nada y se informa del motivo. Así el modelo
// recibe un error claro en vez de corromper el archivo a medias.
export async function applyFileEdits(absPath, edits) {
  const original = await fsp.readFile(absPath, 'utf8');
  let content = original;
  const aplicadas = [];

  for (const [i, ed] of edits.entries()) {
    const buscar = String(ed?.buscar ?? '');
    const reemplazar = String(ed?.reemplazar ?? '');
    if (!buscar) {
      throw new Error(`Edición ${i + 1}: el campo "buscar" no puede estar vacío.`);
    }
    const ocurrencias = content.split(buscar).length - 1;
    if (ocurrencias === 0) {
      throw new Error(
        `Edición ${i + 1}: no se encontró el texto a buscar. No se ha modificado nada. ` +
        `Lee el archivo con "leer_archivo" y copia el fragmento exacto, respetando espacios y saltos de línea.`
      );
    }
    if (ocurrencias > 1 && !ed.todas) {
      throw new Error(
        `Edición ${i + 1}: el texto aparece ${ocurrencias} veces y sería ambiguo. ` +
        `Añade más contexto alrededor para que sea único, o pon "todas": true para reemplazar todas.`
      );
    }
    content = ed.todas ? content.split(buscar).join(reemplazar) : content.replace(buscar, reemplazar);
    aplicadas.push(`${i + 1}: ${ocurrencias} reemplazo(s)`);
  }

  await fsp.writeFile(absPath, content, 'utf8');
  return {
    resumen: `Archivo editado. Ediciones aplicadas → ${aplicadas.join('; ')}. ` +
             `Tamaño: ${original.length} → ${content.length} caracteres.`,
    contenido: content,
  };
}

// ─── Navegador visual real (E2B Desktop) ─────────────────────────────────────

// Devuelve el sandbox de escritorio reutilizable, o null si E2B no está
// configurado. La importación es dinámica para que el agente arranque aunque el
// paquete no esté instalado en el entorno de producción.
async function getDesktop(taskId, apiKey) {
  if (!apiKey) return null;
  try {
    const mod = await import('./e2b-utils.js');
    return await mod.getDesktopSandbox(taskId, apiKey);
  } catch (err) {
    throw new Error(`Navegador visual no disponible: ${err.message}`);
  }
}

// Ejecuta una acción del navegador visual. Devuelve texto para el modelo y,
// opcionalmente, una captura en base64 y la URL del stream en vivo.
export async function browserAction({ taskId, apiKey, accion, url, x, y, texto, tecla, direccion, cantidad }) {
  const desktop = await getDesktop(taskId, apiKey);
  if (!desktop) {
    return {
      texto: 'El navegador visual no está configurado en este servidor (falta E2B_API_KEY). ' +
             'Usa "leer_pagina" para leer el contenido de la URL como texto.',
      disponible: false,
    };
  }

  const streamUrl = (() => {
    try { return desktop.stream.getUrl(); } catch { return null; }
  })();

  // Captura + descripción del estado tras cada acción, para que el modelo vea
  // siempre el resultado real de lo que acaba de hacer.
  const capturar = async (mensaje) => {
    const png = await desktop.screenshot();
    // El título de la ventana activa ayuda al modelo a saber dónde está sin ver
    // la imagen (útil cuando el modelo no recibe la captura por límite de tokens).
    let ventana = null;
    try { ventana = await desktop.getWindowTitle(await desktop.getCurrentWindowId()); } catch { /* no crítico */ }
    return {
      texto: ventana ? `${mensaje} (ventana activa: ${ventana})` : mensaje,
      captura: Buffer.from(png).toString('base64'),
      streamUrl,
      disponible: true,
    };
  };

  const esperar = (ms) => new Promise(r => setTimeout(r, ms));

  switch (accion) {
    case 'navegar': {
      if (!url) throw new Error('Falta la URL para navegar.');
      await desktop.open(url);
      await esperar(4000); // dar tiempo al render y a la carga de JS
      return capturar(`Navegador abierto en ${url}. Observa la captura para decidir el siguiente paso.`);
    }
    case 'clic': {
      // El SDK acepta coordenadas opcionales; si no se dan, usa la posición actual
      if (Number.isFinite(x) && Number.isFinite(y)) {
        await desktop.leftClick(Math.round(x), Math.round(y));
      } else {
        await desktop.leftClick();
      }
      await esperar(2000);
      const coords = Number.isFinite(x) && Number.isFinite(y) ? ` en (${Math.round(x)}, ${Math.round(y)})` : '';
      return capturar(`Clic realizado${coords}.`);
    }
    case 'escribir': {
      if (!texto) throw new Error('Falta el texto a escribir.');
      await desktop.write(String(texto));
      await esperar(1000);
      return capturar(`Texto escrito: "${String(texto).slice(0, 80)}".`);
    }
    case 'tecla': {
      if (!tecla) throw new Error('Falta la tecla a pulsar (ej: Return, Tab, Escape).');
      await desktop.press(String(tecla));
      await esperar(1500);
      return capturar(`Tecla pulsada: ${tecla}.`);
    }
    case 'scroll': {
      const dir = direccion === 'arriba' ? 'up' : 'down';
      await desktop.scroll(dir, Math.max(1, Math.min(20, Math.round(cantidad || 5))));
      await esperar(1000);
      return capturar(`Scroll hacia ${direccion || 'abajo'}.`);
    }
    case 'captura': {
      return capturar('Captura de pantalla del estado actual.');
    }
    default:
      throw new Error(
        `Acción de navegador no soportada: ${accion}. ` +
        `Usa una de: navegar, clic, escribir, tecla, scroll, captura.`
      );
  }
}

// ─── Exposición de puertos ───────────────────────────────────────────────────

// En un servidor propio (Coolify) no hay un proxy dinámico como en un sandbox
// gestionado, así que se resuelve por convención: si el operador define
// COMPUTER_PUBLIC_BASE (p. ej. https://zocoia.es), se construye una URL de
// preview servida por el propio backend. Si no, se informa con honestidad.
export function exposePort({ puerto, publicBase, taskId }) {
  const p = parseInt(puerto, 10);
  if (!Number.isInteger(p) || p < 1024 || p > 65535) {
    throw new Error('Puerto inválido. Usa un puerto entre 1024 y 65535.');
  }
  if (!publicBase) {
    return {
      url: null,
      texto: `El servicio está escuchando en el puerto ${p} dentro del ordenador, pero este ` +
             `servidor no tiene configurada una base pública (COMPUTER_PUBLIC_BASE) para exponerlo. ` +
             `Entrega los archivos del sitio como entregables para que el usuario pueda abrirlos.`,
    };
  }
  const url = `${publicBase.replace(/\/$/, '')}/api/computer/tasks/${taskId}/preview/${p}/`;
  return { url, texto: `Servicio expuesto públicamente en: ${url}` };
}
