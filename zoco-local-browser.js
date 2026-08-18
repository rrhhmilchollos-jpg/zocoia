import puppeteer from 'puppeteer-core';

const browserByTask = new Map();
const BROWSER_WS_ENDPOINT = process.env.ZOCO_BROWSER_WS_ENDPOINT || 'ws://zoco-browser:3000';
const BROWSER_TOKEN = process.env.ZOCO_BROWSER_TOKEN || '';
const BROWSER_ACTION_TIMEOUT_MS = Math.min(60000, Math.max(5000, Number(process.env.ZOCO_BROWSER_ACTION_TIMEOUT_MS || 30000)));

function endpointForConnection() {
  if (!BROWSER_TOKEN) return BROWSER_WS_ENDPOINT;
  const url = new URL(BROWSER_WS_ENDPOINT);
  url.searchParams.set('token', BROWSER_TOKEN);
  return url.toString();
}

function emit(onEvent, type, payload = {}) {
  try { onEvent?.(type, payload); } catch { /* Los eventos no deben romper una acción del navegador. */ }
}

function keyForBrowser(key) {
  const map = { Return: 'Enter', Intro: 'Enter', Esc: 'Escape', Espacio: ' ', FlechaArriba: 'ArrowUp', FlechaAbajo: 'ArrowDown' };
  return map[String(key || '')] || String(key || '');
}

async function getPage(taskId) {
  let entry = browserByTask.get(taskId);
  try {
    if (entry?.browser?.connected && !entry.page?.isClosed()) return entry.page;
  } catch { /* Se reconecta abajo. */ }

  const browser = await puppeteer.connect({ browserWSEndpoint: endpointForConnection(), defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(candidate => !candidate.isClosed()) || await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  page.setDefaultTimeout(BROWSER_ACTION_TIMEOUT_MS);
  entry = { browser, page };
  browserByTask.set(taskId, entry);
  return page;
}

async function snapshot(page) {
  const [title, url, text, png] = await Promise.all([
    page.title().catch(() => ''),
    Promise.resolve(page.url()),
    page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2500)).catch(() => ''),
    page.screenshot({ type: 'png', fullPage: false }),
  ]);
  return { title, url, text, captura: Buffer.from(png).toString('base64') };
}

export async function browserActionLocal({ taskId, accion, url, x, y, texto, tecla, direccion, cantidad, onEvent = null }) {
  emit(onEvent, 'browser_action_start', {
    accion,
    url: url || null,
    coordenadas: Number.isFinite(x) && Number.isFinite(y) ? { x: Math.round(x), y: Math.round(y) } : null,
  });

  try {
    const page = await getPage(taskId);
    switch (accion) {
      case 'navegar':
        if (!url || !/^https?:\/\//i.test(url)) throw new Error('Indica una URL completa que empiece por http:// o https://.');
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_ACTION_TIMEOUT_MS });
        await new Promise(resolve => setTimeout(resolve, 1200));
        break;
      case 'clic':
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Las coordenadas x e y son obligatorias para hacer clic.');
        await page.mouse.click(Math.round(x), Math.round(y));
        await new Promise(resolve => setTimeout(resolve, 500));
        break;
      case 'escribir':
        if (!texto) throw new Error('Falta el texto que se debe escribir.');
        await page.keyboard.type(String(texto), { delay: 8 });
        break;
      case 'tecla':
        if (!tecla) throw new Error('Falta la tecla que se debe pulsar.');
        await page.keyboard.press(keyForBrowser(tecla));
        await new Promise(resolve => setTimeout(resolve, 400));
        break;
      case 'scroll':
        await page.mouse.wheel({ deltaY: Math.max(100, Math.min(2400, Math.abs(Number(cantidad) || 700))) * (direccion === 'arriba' ? -1 : 1) });
        await new Promise(resolve => setTimeout(resolve, 400));
        break;
      case 'captura':
        break;
      default:
        throw new Error(`Acción de navegador no soportada: ${accion}.`);
    }

    const estado = await snapshot(page);
    emit(onEvent, 'browser_screenshot', { imagen: estado.captura, accion, url: estado.url, titulo: estado.title, proveedor: 'chromium_aislado' });
    emit(onEvent, 'browser_action_success', { accion, url: estado.url, titulo: estado.title, proveedor: 'chromium_aislado' });
    return {
      disponible: true,
      captura: estado.captura,
      url: estado.url,
      texto: `Navegador visual aislado en ${estado.url}${estado.title ? ` · ${estado.title}` : ''}.\n\nContenido visible:\n${estado.text || '(sin texto visible)'}`,
      streamUrl: null,
    };
  } catch (error) {
    const message = `Navegador visual aislado no disponible: ${error.message}`;
    emit(onEvent, 'browser_action_error', { accion, error: message });
    return { disponible: false, captura: null, url: null, texto: message, streamUrl: null };
  }
}

export async function closeLocalBrowser(taskId) {
  const entry = browserByTask.get(taskId);
  browserByTask.delete(taskId);
  try { await entry?.browser?.disconnect(); } catch { /* El navegador compartido continúa para otras tareas. */ }
}
