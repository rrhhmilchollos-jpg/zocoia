import puppeteer from 'puppeteer-core';

const browserByTask = new Map();
const profileLocks = new Map();
const BROWSER_WS_ENDPOINT = process.env.ZOCO_BROWSER_WS_ENDPOINT || 'ws://zoco-browser:3000';
const BROWSER_TOKEN = process.env.ZOCO_BROWSER_TOKEN || '';
const BROWSER_PROFILE_ROOT = process.env.ZOCO_BROWSER_PROFILE_ROOT || '/profiles';
const BROWSER_ACTION_TIMEOUT_MS = Math.min(60000, Math.max(5000, Number(process.env.ZOCO_BROWSER_ACTION_TIMEOUT_MS || 30000)));

function safeProfileId(profileId) {
  const normalized = String(profileId || 'guest').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
  return normalized || 'guest';
}

function isPersistentProfile(profileId) {
  return Boolean(profileId && safeProfileId(profileId) !== 'guest');
}

function endpointForConnection(profileId) {
  const url = new URL(BROWSER_WS_ENDPOINT);
  if (BROWSER_TOKEN) url.searchParams.set('token', BROWSER_TOKEN);
  // Cada perfil conserva exclusivamente sus propios cookies, localStorage y
  // preferencias en un volumen privado del contenedor Browserless.
  if (isPersistentProfile(profileId)) {
    const launch = { args: [`--user-data-dir=${BROWSER_PROFILE_ROOT}/${safeProfileId(profileId)}`] };
    url.searchParams.set('launch', Buffer.from(JSON.stringify(launch)).toString('base64'));
  }
  return url.toString();
}

function emit(onEvent, type, payload = {}) {
  try { onEvent?.(type, payload); } catch { /* Los eventos no deben romper una acción del navegador. */ }
}

function keyForBrowser(key) {
  const map = { Return: 'Enter', Intro: 'Enter', Esc: 'Escape', Espacio: ' ', FlechaArriba: 'ArrowUp', FlechaAbajo: 'ArrowDown' };
  return map[String(key || '')] || String(key || '');
}

async function bounded(promise, label) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} superó ${Math.round(BROWSER_ACTION_TIMEOUT_MS / 1000)} segundos.`)), BROWSER_ACTION_TIMEOUT_MS); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getPage(taskId, profileId) {
  const normalizedProfile = safeProfileId(profileId);
  let entry = browserByTask.get(taskId);
  try {
    if (entry?.browser?.connected && !entry.page?.isClosed() && entry.profileId === normalizedProfile) return entry.page;
  } catch { /* Se reconecta abajo. */ }

  if (isPersistentProfile(normalizedProfile)) {
    const lockedBy = profileLocks.get(normalizedProfile);
    if (lockedBy && lockedBy !== taskId) {
      throw new Error('El perfil de navegador ya está siendo usado por otra tarea. Espera a que finalice o detén aquella ejecución.');
    }
  }

  const browser = await puppeteer.connect({ browserWSEndpoint: endpointForConnection(normalizedProfile), defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(candidate => !candidate.isClosed()) || await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  page.setDefaultTimeout(BROWSER_ACTION_TIMEOUT_MS);
  entry = { browser, page, profileId: normalizedProfile };
  browserByTask.set(taskId, entry);
  if (isPersistentProfile(normalizedProfile)) profileLocks.set(normalizedProfile, taskId);
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

export async function browserActionLocal({ taskId, profileId = 'guest', accion, url, x, y, texto, tecla, direccion, cantidad, onEvent = null }) {
  const normalizedProfile = safeProfileId(profileId);
  emit(onEvent, 'browser_action_start', {
    accion,
    url: url || null,
    perfil: isPersistentProfile(normalizedProfile) ? 'persistente' : 'invitado_aislado',
    coordenadas: Number.isFinite(x) && Number.isFinite(y) ? { x: Math.round(x), y: Math.round(y) } : null,
  });

  try {
    const page = await bounded(getPage(taskId, normalizedProfile), 'La conexión con Chromium');
    switch (accion) {
      case 'navegar':
        if (!url || !/^https?:\/\//i.test(url)) throw new Error('Indica una URL completa que empiece por http:// o https://.');
        await bounded(page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_ACTION_TIMEOUT_MS }), 'La carga de la página');
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

    const estado = await bounded(snapshot(page), 'La captura de la página');
    emit(onEvent, 'browser_screenshot', { imagen: estado.captura, accion, url: estado.url, titulo: estado.title, perfil: isPersistentProfile(normalizedProfile) ? 'persistente' : 'invitado_aislado', proveedor: 'chromium_aislado' });
    emit(onEvent, 'browser_action_success', { accion, url: estado.url, titulo: estado.title, perfil: isPersistentProfile(normalizedProfile) ? 'persistente' : 'invitado_aislado', proveedor: 'chromium_aislado' });
    return {
      disponible: true,
      captura: estado.captura,
      url: estado.url,
      texto: `Navegador visual aislado en ${estado.url}${estado.title ? ` · ${estado.title}` : ''}.\n\nContenido visible:\n${estado.text || '(sin texto visible)'}`,
      streamUrl: null,
    };
  } catch (error) {
    await closeLocalBrowser(taskId);
    const message = `Navegador visual aislado no disponible: ${error.message}`;
    emit(onEvent, 'browser_action_error', { accion, error: message });
    return { disponible: false, captura: null, url: null, texto: message, streamUrl: null };
  }
}

export async function closeLocalBrowser(taskId) {
  const entry = browserByTask.get(taskId);
  browserByTask.delete(taskId);
  if (entry?.profileId && profileLocks.get(entry.profileId) === taskId) profileLocks.delete(entry.profileId);
  try {
    // `close()` finaliza únicamente esta sesión CDP y libera la ranura visual.
    if (entry?.browser?.connected) await entry.browser.close();
  } catch { /* La sesión puede haber terminado durante una cancelación. */ }
}
