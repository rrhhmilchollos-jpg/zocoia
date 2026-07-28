/**
 * Definición de la herramienta 'controlarOrdenador' en formato JSON Schema
 * para el motor local de Ollama.
 */

export const CONTROLAR_ORDENADOR_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'controlarOrdenador',
    description:
      'Controla el "Ordenador de Zoco": un escritorio virtual real en la nube (Linux + navegador) para tareas que requieren interactuar con páginas web como lo haría una persona. Usa "screenshot" SIEMPRE antes de decidir la siguiente acción y SIEMPRE después de una acción importante para verificar que ha surtido efecto — no asumas que un clic ha funcionado sin comprobarlo visualmente. La sesión persiste entre llamadas mientras dure la conversación.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'navigate',
            'click',
            'doubleClick',
            'rightClick',
            'type',
            'keyPress',
            'drag',
            'scroll',
            'moveMouse',
            'wait',
            'screenshot',
            'get_url',
          ],
          description: 'Acción a realizar en el ordenador virtual',
        },
        url: { type: 'string', description: 'URL a abrir (solo para action=navigate)' },
        x: { type: 'number', description: 'Coordenada X (para click, doubleClick, rightClick, moveMouse, o punto de origen de drag)' },
        y: { type: 'number', description: 'Coordenada Y (para click, doubleClick, rightClick, moveMouse, o punto de origen de drag)' },
        toX: { type: 'number', description: 'Coordenada X de destino (solo para action=drag)' },
        toY: { type: 'number', description: 'Coordenada Y de destino (solo para action=drag)' },
        text: { type: 'string', description: 'Texto a escribir (solo para action=type)' },
        key: {
          type: 'string',
          description:
            'Tecla o combinación a pulsar (solo para action=keyPress). Nombres simples en minúscula: "enter", "space", "backspace", "escape", "tab". Para combinaciones, sepáralas con "+": "ctrl+c", "ctrl+a".',
        },
        amount: { type: 'number', description: 'Cantidad de scroll, positivo=abajo (solo para action=scroll)' },
        ms: { type: 'number', description: 'Milisegundos a esperar (solo para action=wait, por defecto 1000)' },
      },
      required: ['action'],
    },
  },
};
