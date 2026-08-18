const DEFAULT_API = 'https://api.zocoia.es';
const POLL_ALARM = 'zoco-bridge-poll';

async function config() {
  const values = await chrome.storage.local.get(['apiBase', 'deviceToken']);
  return { apiBase: values.apiBase || DEFAULT_API, deviceToken: values.deviceToken || null };
}

async function api(path, body) {
  const { apiBase, deviceToken } = await config();
  const response = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceToken, ...body }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
}

function originPattern(url) {
  try { return `${new URL(url).origin}/*`; } catch { return null; }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error('No hay una pestaña activa disponible.');
  return tab;
}

async function requireHost(url) {
  const pattern = originPattern(url);
  if (!pattern) throw new Error('La URL de destino no es válida.');
  const granted = await chrome.permissions.contains({ origins: [pattern] });
  if (!granted) throw new Error(`El usuario aún no autorizó este dominio en el puente local: ${new URL(url).hostname}.`);
}

async function snapshot(tab) {
  const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const title = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.title }).then(result => result?.[0]?.result || '');
  const text = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2500) }).then(result => result?.[0]?.result || '');
  return { url: tab.url, title, screenshot: image, text };
}

async function execute(command) {
  const tab = await activeTab();
  const action = command?.action || {};
  const destination = action.url || tab.url;
  await requireHost(destination);

  if (action.type === 'navigate') {
    await chrome.tabs.update(tab.id, { url: action.url });
    await new Promise(resolve => setTimeout(resolve, 1200));
    const refreshed = await activeTab();
    return snapshot(refreshed);
  }
  if (action.type === 'snapshot') return snapshot(tab);
  if (action.type === 'click') {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [action.x, action.y], func: (x, y) => {
      const node = document.elementFromPoint(Number(x), Number(y));
      if (!node) throw new Error('No existe un elemento en esas coordenadas.');
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: Number(x), clientY: Number(y) }));
    }});
    await new Promise(resolve => setTimeout(resolve, 500));
    return snapshot(tab);
  }
  if (action.type === 'type') {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [String(action.text || '')], func: (value) => {
      const element = document.activeElement;
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element?.isContentEditable)) throw new Error('Selecciona primero un campo de texto en la pestaña.');
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        element.textContent = value;
        element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
      }
    }});
    return snapshot(tab);
  }
  throw new Error(`Acción de puente no permitida: ${action.type || 'desconocida'}.`);
}

async function poll() {
  const { deviceToken } = await config();
  if (!deviceToken) return;
  try {
    const response = await api('/api/browser-bridge/poll', {});
    for (const command of response.commands || []) {
      try {
        const result = await execute(command);
        await api('/api/browser-bridge/events', { commandId: command.id, ok: true, result });
      } catch (error) {
        await api('/api/browser-bridge/events', { commandId: command.id, ok: false, error: error.message });
      }
    }
  } catch { /* La siguiente pulsación vuelve a intentar; no se expone información de sesión en consola. */ }
}

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 }));
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === POLL_ALARM) void poll(); });
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'poll') { void poll().then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message })); return true; }
  if (message?.type === 'saveConfig') { void chrome.storage.local.set({ apiBase: message.apiBase || DEFAULT_API, deviceToken: message.deviceToken || null }).then(() => sendResponse({ ok: true })); return true; }
  return false;
});
