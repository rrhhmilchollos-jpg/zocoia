import { getDesktopSandbox, withHardTimeout, emitLive } from './e2b-utils.js';

/**
 * Controlador para las acciones de "El Ordenador de Zoco" (E2B Desktop).
 * @param {string} workspaceId - ID del workspace para el sandbox.
 * @param {string} apiKey - Clave API de E2B.
 * @param {object} actionParams - Parámetros de la acción a ejecutar.
 * @param {function} onEvent - Función para emitir eventos en vivo al frontend.
 * @returns {Promise<object>} - Resultado de la acción, incluyendo screenshot en Base64.
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
  let currentUrl = null;

  emitLive({ workspaceId, onEvent }, { type: 'action_start', action: actionParams.action, params: actionParams });

  try {
    switch (actionParams.action) {
      case 'navigate':
        if (!actionParams.url) throw new Error('URL es requerida para la acción navigate.');
        emitLive({ workspaceId, onEvent }, { type: 'navigate', url: actionParams.url });
        await withHardTimeout(sbx.browser.goto(actionParams.url), 30000, 'navigate');
        break;
      case 'click':
        if (typeof actionParams.x !== 'number' || typeof actionParams.y !== 'number') {
          throw new Error('Coordenadas x e y son requeridas para la acción click.');
        }
        emitLive({ workspaceId, onEvent }, { type: 'click', x: actionParams.x, y: actionParams.y });
        await withHardTimeout(sbx.browser.click(actionParams.x, actionParams.y), 10000, 'click');
        break;
      case 'doubleClick':
        if (typeof actionParams.x !== 'number' || typeof actionParams.y !== 'number') {
          throw new Error('Coordenadas x e y son requeridas para la acción doubleClick.');
        }
        emitLive({ workspaceId, onEvent }, { type: 'doubleClick', x: actionParams.x, y: actionParams.y });
        await withHardTimeout(sbx.browser.doubleClick(actionParams.x, actionParams.y), 10000, 'doubleClick');
        break;
      case 'rightClick':
        if (typeof actionParams.x !== 'number' || typeof actionParams.y !== 'number') {
          throw new Error('Coordenadas x e y son requeridas para la acción rightClick.');
        }
        emitLive({ workspaceId, onEvent }, { type: 'rightClick', x: actionParams.x, y: actionParams.y });
        await withHardTimeout(sbx.browser.rightClick(actionParams.x, actionParams.y), 10000, 'rightClick');
        break;
      case 'type':
        if (!actionParams.text) throw new Error('Texto es requerido para la acción type.');
        emitLive({ workspaceId, onEvent }, { type: 'type', text: actionParams.text });
        await withHardTimeout(sbx.browser.type(actionParams.text), 10000, 'type');
        break;
      case 'keyPress':
        if (!actionParams.key) throw new Error('La tecla es requerida para la acción keyPress.');
        emitLive({ workspaceId, onEvent }, { type: 'keyPress', key: actionParams.key });
        await withHardTimeout(sbx.browser.press(actionParams.key), 10000, 'keyPress');
        break;
      case 'drag':
        if (typeof actionParams.x !== 'number' || typeof actionParams.y !== 'number' || typeof actionParams.toX !== 'number' || typeof actionParams.toY !== 'number') {
          throw new Error('Coordenadas x, y, toX y toY son requeridas para la acción drag.');
        }
        emitLive({ workspaceId, onEvent }, { type: 'drag', x: actionParams.x, y: actionParams.y, toX: actionParams.toX, toY: actionParams.toY });
        await withHardTimeout(sbx.browser.dragAndDrop(actionParams.x, actionParams.y, actionParams.toX, actionParams.toY), 10000, 'drag');
        break;
      case 'scroll':
        if (typeof actionParams.amount !== 'number') {
          throw new Error('Cantidad de scroll es requerida para la acción scroll.');
        }
        emitLive({ workspaceId, onEvent }, { type: 'scroll', amount: actionParams.amount });
        await withHardTimeout(sbx.browser.scroll(actionParams.amount), 10000, 'scroll');
        break;
      case 'moveMouse':
        if (typeof actionParams.x !== 'number' || typeof actionParams.y !== 'number') {
          throw new Error('Coordenadas x e y son requeridas para la acción moveMouse.');
        }
        emitLive({ workspaceId, onEvent }, { type: 'moveMouse', x: actionParams.x, y: actionParams.y });
        await withHardTimeout(sbx.browser.moveMouse(actionParams.x, actionParams.y), 10000, 'moveMouse');
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
        emitLive({ workspaceId, onEvent }, { type: 'get_url_request' });
        currentUrl = await withHardTimeout(sbx.browser.getURL(), 5000, 'get_url');
        result.url = currentUrl;
        break;
      default:
        throw new Error(`Acción no soportada: ${actionParams.action}`);
    }

    // Siempre tomar una captura de pantalla después de cada acción (excepto screenshot en sí)
    if (actionParams.action !== 'screenshot') {
      const screenshotBuffer = await withHardTimeout(sbx.browser.screenshot(), 20000, 'screenshot');
      screenshot = screenshotBuffer.toString('base64');
      emitLive({ workspaceId, onEvent }, { type: 'screenshot_taken', size: screenshotBuffer.length });
    }

    // Obtener la URL actual después de cada acción (si no se hizo ya con get_url)
    if (!currentUrl) {
      currentUrl = await withHardTimeout(sbx.browser.getURL(), 5000, 'get_url_after_action');
      result.url = currentUrl;
    }

    emitLive({ workspaceId, onEvent }, { type: 'action_success', action: actionParams.action, result });
    return { success: true, screenshot, url: currentUrl, result };
  } catch (err) {
    console.error(`Error en acción de Ordenador de Zoco (${actionParams.action}):`, err);
    emitLive({ workspaceId, onEvent }, { type: 'action_error', action: actionParams.action, error: err.message });
    return { success: false, error: err.message, screenshot: null, url: currentUrl };
  }
}
