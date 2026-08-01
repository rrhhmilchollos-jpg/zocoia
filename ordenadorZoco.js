import { getDesktopSandbox, withHardTimeout, emitLive } from './e2b-utils.js';

/**
 * Controlador para las acciones de "El Ordenador de Zoco" (E2B Desktop).
 * @param {string} workspaceId - ID del workspace para el sandbox.
 * @param {string} apiKey - Clave API de E2B.
 * @param {object} actionParams - Parámetros de la acción a ejecutar.
 * @param {function} onEvent - Función para emitir eventos en vivo al frontend.
 * @returns {Promise<object>} - Resultado de la acción, incluyendo screenshot en Base64.
 *
 * NOTA IMPORTANTE: el SDK @e2b/desktop (v2.3.1) NO expone un objeto `.browser`.
 * Todos los métodos (click, write, press, scroll, open, screenshot, etc.) están
 * directamente en la instancia del sandbox (`sbx.metodo(...)`), no en `sbx.browser.metodo(...)`.
 * Tampoco existe ningún método para leer la URL actual (no hay `getURL`/`get_url`
 * real en este SDK), así que esa acción se mantiene solo por compatibilidad de la
 * API del backend, pero siempre devuelve `url: null`.
 */
export async function handleOrdenadorZocoAction(workspaceId, apiKey, actionParams, onEvent) {
  if (!apiKey) {
    return {
      success: false,
      error: 'E2B_API_KEY no configurada. Añádela como credencial del usuario (E2B_API_KEY) para poder controlar el ordenador virtual.',
    };
  }

  const sbx = await getDesktopSandbox(workspaceId, apiKey);

  let result = {};
  let screenshot = null;
  let currentUrl = null; // el SDK actual no permite leer la URL activa; se mantiene por compatibilidad

  emitLive({ workspaceId, onEvent }, { type: 'action_start', action: actionParams.action, params: actionParams });

  try {
    switch (actionParams.action) {
      case 'navigate':
        if (!actionParams.url) throw new Error('URL es requerida para la acción navigate.');
        emitLive({ workspaceId, onEvent }, { type: 'navigate', url: actionParams.url });
        // No hay navegación "dentro" de un browser controlado; `open` lanza la URL
        // en la aplicación por defecto del escritorio virtual (normalmente el navegador).
        await withHardTimeout(sbx.open(actionParams.url), 30000, 'navigate');
        break;
      case 'click':
        if (typeof actionParams.x !== 'number' || typeof actionParams.y !== 'number') {
          throw new Error('Coordenadas x e y son requeridas para la acción click.');
        }
        emitLive({ workspaceId, onEvent }, { type: 'click', x: actionParams.x, y: actionParams.y });
        await withHardTimeout(sbx.leftClick(actionParams.x, actionParams.y), 10000, 'click');
        break;
      case 'doubleClick':
        if (typeof actionParams.x !== 'number' || typeof actionParams.y !== 'number') {
          throw new Error('Coordenadas x e y son requeridas para la acción doubleClick.');
        }
        emitLive({ workspaceId, onEvent }, { type: 'doubleClick', x: actionParams.x, y: actionParams.y });
        await withHardTimeout(sbx.doubleClick(actionParams.x, actionParams.y), 10000, 'doubleClick');
        break;
      case 'rightClick':
        if (typeof actionParams.x !== 'number' || typeof actionParams.y !== 'number') {
          throw new Error('Coordenadas x e y son requeridas para la acción rightClick.');
        }
        emitLive({ workspaceId, onEvent }, { type: 'rightClick', x: actionParams.x, y: actionParams.y });
        await withHardTimeout(sbx.rightClick(actionParams.x, actionParams.y), 10000, 'rightClick');
        break;
      case 'type':
        if (!actionParams.text) throw new Error('Texto es requerido para la acción type.');
        emitLive({ workspaceId, onEvent }, { type: 'type', text: actionParams.text });
        await withHardTimeout(sbx.write(actionParams.text), 10000, 'type');
        break;
      case 'keyPress':
        if (!actionParams.key) throw new Error('La tecla es requerida para la acción keyPress.');
        emitLive({ workspaceId, onEvent }, { type: 'keyPress', key: actionParams.key });
        await withHardTimeout(sbx.press(actionParams.key), 10000, 'keyPress');
        break;
      case 'drag':
        if (typeof actionParams.x !== 'number' || typeof actionParams.y !== 'number' || typeof actionParams.toX !== 'number' || typeof actionParams.toY !== 'number') {
          throw new Error('Coordenadas x, y, toX y toY son requeridas para la acción drag.');
        }
        emitLive({ workspaceId, onEvent }, { type: 'drag', x: actionParams.x, y: actionParams.y, toX: actionParams.toX, toY: actionParams.toY });
        await withHardTimeout(sbx.drag([actionParams.x, actionParams.y], [actionParams.toX, actionParams.toY]), 10000, 'drag');
        break;
      case 'scroll':
        if (typeof actionParams.amount !== 'number') {
          throw new Error('Cantidad de scroll es requerida para la acción scroll.');
        }
        emitLive({ workspaceId, onEvent }, { type: 'scroll', amount: actionParams.amount });
        // El SDK espera (direction, amount) con direction 'up'|'down'; deducimos la
        // dirección del signo y usamos el valor absoluto como cantidad.
        await withHardTimeout(
          sbx.scroll(actionParams.amount < 0 ? 'up' : 'down', Math.abs(actionParams.amount)),
          10000,
          'scroll'
        );
        break;
      case 'moveMouse':
        if (typeof actionParams.x !== 'number' || typeof actionParams.y !== 'number') {
          throw new Error('Coordenadas x e y son requeridas para la acción moveMouse.');
        }
        emitLive({ workspaceId, onEvent }, { type: 'moveMouse', x: actionParams.x, y: actionParams.y });
        await withHardTimeout(sbx.moveMouse(actionParams.x, actionParams.y), 10000, 'moveMouse');
        break;
      case 'wait':
        if (typeof actionParams.ms !== 'number') {
          throw new Error('Milisegundos son requeridos para la acción wait.');
        }
        emitLive({ workspaceId, onEvent }, { type: 'wait', ms: actionParams.ms });
        await new Promise(resolve => setTimeout(resolve, actionParams.ms));
        break;
      case 'screenshot':
        emitLive({ workspaceId, onEvent }, { type: 'screenshot_request' });
        // La captura de pantalla se realiza al final de cada acción para asegurar el estado actual
        break;
      case 'get_url':
        // No soportado por el SDK @e2b/desktop actual: no existe forma de leer la
        // URL activa del navegador dentro del escritorio virtual. Se devuelve null
        // en vez de lanzar un error, para no romper flujos que llamen a esta acción.
        emitLive({ workspaceId, onEvent }, { type: 'get_url_request' });
        result.url = null;
        result.warning = 'get_url no está soportado por el SDK @e2b/desktop actual.';
        break;
      default:
        throw new Error(`Acción no soportada: ${actionParams.action}`);
    }

    // Siempre se toma una captura de pantalla al final (sirve tanto para la acción
    // 'screenshot' explícita como para dar feedback visual tras cualquier otra acción).
    const screenshotBuffer = await withHardTimeout(sbx.screenshot(), 20000, 'screenshot');
    screenshot = Buffer.from(screenshotBuffer).toString('base64');
    emitLive({ workspaceId, onEvent }, { type: 'screenshot_taken', size: screenshotBuffer.length });

    emitLive({ workspaceId, onEvent }, { type: 'action_success', action: actionParams.action, result });
    return { success: true, screenshot, url: currentUrl, result };
  } catch (err) {
    console.error(`Error en acción de Ordenador de Zoco (${actionParams.action}):`, err);
    emitLive({ workspaceId, onEvent }, { type: 'action_error', action: actionParams.action, error: err.message });
    return { success: false, error: err.message, screenshot: null, url: currentUrl };
  }
}
