/**
 * ordenadorZoco.js
 * 
 * Controlador para el control del ordenador virtual utilizando E2B Desktop.
 */

import pkg from '@e2b/desktop';
const { Sandbox: DesktopSandbox } = pkg;

/**
 * Maneja una acción en el ordenador virtual de Zoco
 */
export async function handleOrdenadorZocoAction(action, params) {
  let sandbox;
  try {
    sandbox = await DesktopSandbox.create({
      apiKey: process.env.E2B_API_KEY,
    });

    let result;
    switch (action) {
      case 'navigate':
        await sandbox.browser.navigate(params.url);
        result = { message: `Navegando a ${params.url}` };
        break;
      case 'click':
        await sandbox.mouse.click(params.x, params.y);
        result = { message: `Clic en X:${params.x}, Y:${params.y}` };
        break;
      case 'type':
        await sandbox.keyboard.type(params.text);
        result = { message: `Escribiendo texto` };
        break;
      case 'scroll':
        await sandbox.mouse.scroll(0, params.delta);
        result = { message: `Scroll delta: ${params.delta}` };
        break;
      case 'screenshot':
        const screenshot = await sandbox.takeScreenshot();
        result = { screenshot: screenshot.toString('base64') };
        break;
      default:
        throw new Error(`Acción desconocida: ${action}`);
    }

    return result;
  } finally {
    if (sandbox) {
      await sandbox.close();
    }
  }
}
