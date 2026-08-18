const API_BASE = 'https://api.zocoia.es';
const status = document.querySelector('#status');
const codeInput = document.querySelector('#pairingCode');

async function setStatus(text) { status.textContent = text; }

async function currentConnection() {
  const { deviceToken } = await chrome.storage.local.get(['deviceToken']);
  await setStatus(deviceToken ? 'Sesión de Chrome vinculada a Zoco.' : 'Sin conexión.');
}

async function connect() {
  const code = String(codeInput.value || '').trim().toUpperCase();
  if (!code) return setStatus('Introduce el código temporal mostrado por Zoco.');
  try {
    await setStatus('Validando el código…');
    const response = await fetch(`${API_BASE}/api/browser-bridge/pair`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode: code, browser: 'chrome-extension' }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo vincular la sesión.');
    await chrome.storage.local.set({ apiBase: API_BASE, deviceToken: data.deviceToken });
    await chrome.runtime.sendMessage({ type: 'poll' });
    await setStatus('Sesión vinculada. Los dominios requieren aprobación desde Zoco.');
  } catch (error) {
    await setStatus(error.message || 'No se pudo completar la conexión.');
  }
}

async function disconnect() {
  await chrome.storage.local.remove(['deviceToken']);
  await setStatus('Sesión desconectada de Zoco.');
}

document.querySelector('#connect').addEventListener('click', () => void connect());
document.querySelector('#disconnect').addEventListener('click', () => void disconnect());
void currentConnection();
