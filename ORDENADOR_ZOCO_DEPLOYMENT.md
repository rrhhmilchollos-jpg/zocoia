# El Ordenador de Zoco - Guía de Despliegue y Documentación

## Descripción General

**El Ordenador de Zoco** es un módulo nativo de **Computer Use** (control de ordenador virtual) para zocoia.es, que replica la arquitectura de Claude Console. Permite que agentes de IA interactúen con un escritorio virtual Linux en la nube mediante E2B Desktop, proporcionando capacidades de navegación web, interacción con interfaces y automatización de tareas.

---

## Arquitectura del Sistema

### Componentes Principales

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React)                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  OrdenadorZocoPanel.tsx                              │   │
│  │  - Captura de pantalla en tiempo real (Base64)       │   │
│  │  - Barra de direcciones (URL)                        │   │
│  │  - Panel de registros de eventos                     │   │
│  │  - Controles interactivos (clic, scroll, etc.)       │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↓ HTTP POST
┌─────────────────────────────────────────────────────────────┐
│                    Backend (Node.js/Express)                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  /api/ordenador-zoco (POST)                          │   │
│  │  - Recibe acciones (navigate, click, type, etc.)     │   │
│  │  - Valida parámetros                                 │   │
│  │  - Llama a handleOrdenadorZocoAction()               │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  ordenadorZoco.js                                    │   │
│  │  - handleOrdenadorZocoAction()                       │   │
│  │  - Ejecuta acciones en E2B Desktop                   │   │
│  │  - Emite eventos en vivo (emitLive)                  │   │
│  │  - Retorna screenshot en Base64                      │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  e2b-utils.js                                        │   │
│  │  - getDesktopSandbox() - Gestión de sesiones         │   │
│  │  - withHardTimeout() - Timeouts duros                │   │
│  │  - emitLive() - Emisión de eventos                   │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  tools.js (actualizado)                              │   │
│  │  - CONTROLAR_ORDENADOR_TOOL_SCHEMA                   │   │
│  │  - Integración con Ollama/motor local                │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↓ SDK E2B
┌─────────────────────────────────────────────────────────────┐
│                    E2B Cloud (Desktop Sandbox)               │
│  - Linux + Chromium aislado                                 │
│  - Resolución: 1280x800                                     │
│  - TTL: 10 minutos (renovable)                              │
│  - Timeout por acción: 45 segundos                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Archivos Implementados

### 1. **ollama-tools-schema.js**
Define el esquema JSON Schema de la herramienta `controlarOrdenador` para Ollama.

**Acciones soportadas:**
- `navigate` - Abrir URL en navegador
- `click` - Clic izquierdo en coordenadas (x, y)
- `doubleClick` - Doble clic
- `rightClick` - Clic derecho
- `type` - Escribir texto
- `keyPress` - Pulsar tecla o combinación (ej: "ctrl+a", "enter")
- `drag` - Arrastrar desde (x, y) a (toX, toY)
- `scroll` - Desplazar (positivo=abajo, negativo=arriba)
- `moveMouse` - Mover ratón a (x, y)
- `wait` - Esperar N milisegundos
- `screenshot` - Capturar pantalla
- `get_url` - Obtener URL actual

### 2. **e2b-utils.js**
Funciones reutilizables para gestión de E2B Desktop.

**Exporta:**
- `withHardTimeout(promise, ms, label)` - Timeout duro independiente
- `emitLive(context, payload)` - Emisión de eventos en vivo (sin bloqueos)
- `getCodeSandbox(workspaceId, apiKey)` - Obtener/crear sandbox de código
- `getDesktopSandbox(workspaceId, apiKey)` - Obtener/crear sandbox de escritorio

### 3. **ordenadorZoco.js**
Controlador principal para ejecutar acciones en el escritorio virtual.

**Función principal:**
```javascript
export async function handleOrdenadorZocoAction(
  workspaceId: string,
  apiKey: string,
  actionParams: { action: string, ...params },
  onEvent: (payload) => void
): Promise<{ success: boolean, screenshot?: string, url?: string, error?: string }>
```

**Características:**
- Manejo robusto de errores
- Timeouts duros (45s por acción)
- Emisión de eventos en vivo
- Screenshots automáticos en Base64 tras cada acción
- Obtención de URL actual tras cada acción

### 4. **src/components/OrdenadorZocoPanel.tsx**
Componente React profesional para la interfaz visual.

**Características:**
- Captura de pantalla en tiempo real (clickeable para interactuar)
- Barra de direcciones con navegación
- Panel de registros con timestamps
- Controles: Captura, Arriba, Abajo, Enter
- Modo maximizado/minimizado
- Indicador de estado (Procesando/Listo)
- Contador de eventos
- Copia de URL al portapapeles

### 5. **server.js (actualizado)**
Nuevo endpoint y importaciones.

```javascript
import { handleOrdenadorZocoAction } from './ordenadorZoco.js';

app.post('/api/ordenador-zoco', authMiddleware, async (req, res) => {
  try {
    const { action, ...params } = req.body;
    const workspaceId = req.auth.sub;
    const e2bApiKey = process.env.E2B_API_KEY;
    const onEvent = (payload) => { /* eventos en vivo */ };
    
    const result = await handleOrdenadorZocoAction(
      workspaceId,
      e2bApiKey,
      { action, ...params },
      onEvent
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

### 6. **tools.js (actualizado)**
Integración con el sistema de herramientas de Ollama.

```javascript
import { CONTROLAR_ORDENADOR_TOOL_SCHEMA } from './ollama-tools-schema.js';
import { handleOrdenadorZocoAction } from './ordenadorZoco.js';

export const TOOL_DEFINITIONS = [
  CONTROLAR_ORDENADOR_TOOL_SCHEMA,
  // ... otras herramientas
];

export async function runToolLoop(toolCall, workspaceId, context) {
  // ...
  const toolsImplementations = {
    controlarOrdenador: (args) => handleOrdenadorZocoAction(
      context.workspaceId,
      context.e2bApiKey,
      args,
      context.onEvent
    ),
    // ... otras herramientas
  };
}
```

---

## Requisitos de Configuración

### Variables de Entorno

```bash
# E2B API Key (obligatorio para funcionalidad)
E2B_API_KEY=tu_clave_api_e2b_aqui

# Timeouts (opcional, valores por defecto)
E2B_SANDBOX_TIMEOUT_MS=600000      # 10 minutos
E2B_CALL_TIMEOUT_MS=45000          # 45 segundos
```

### Dependencias NPM

```json
{
  "dependencies": {
    "@e2b/code-interpreter": "^latest",
    "@e2b/desktop": "^latest",
    "express": "^latest",
    "react": "^18.0.0",
    "lucide-react": "^latest"
  }
}
```

---

## Guía de Integración en Coolify/Hetzner

### 1. **Preparar el Repositorio**

```bash
# En tu servidor
cd /ruta/a/zocoia
git fetch origin
git checkout zoco-ia-1
```

### 2. **Instalar Dependencias**

```bash
npm install @e2b/desktop @e2b/code-interpreter
```

### 3. **Configurar Variables de Entorno**

En tu archivo `.env` o en Coolify:

```bash
E2B_API_KEY=tu_clave_api_e2b_aqui
E2B_SANDBOX_TIMEOUT_MS=600000
E2B_CALL_TIMEOUT_MS=45000
```

### 4. **Compilar Frontend (si es necesario)**

```bash
npm run build
```

### 5. **Reiniciar el Servicio**

```bash
# En Coolify, el redeploy automático debería detectar cambios
# O manualmente:
npm start
# o
node server.js
```

### 6. **Verificar Funcionamiento**

```bash
# Test del endpoint
curl -X POST http://localhost:3000/api/ordenador-zoco \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer tu_token_jwt" \
  -d '{"action":"screenshot"}'
```

---

## Uso desde el Frontend

### Integración en Dashboard

```typescript
import OrdenadorZocoPanel from '@/components/OrdenadorZocoPanel';

export default function Dashboard() {
  const [isOrdenadorOpen, setIsOrdenadorOpen] = useState(false);

  return (
    <>
      <button onClick={() => setIsOrdenadorOpen(true)}>
        Abrir El Ordenador de Zoco
      </button>
      <OrdenadorZocoPanel
        isOpen={isOrdenadorOpen}
        onClose={() => setIsOrdenadorOpen(false)}
      />
    </>
  );
}
```

### API REST Directa

```javascript
// Navegar a una URL
const response = await fetch('/api/ordenador-zoco', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    action: 'navigate',
    url: 'https://www.example.com'
  })
});

const data = await response.json();
console.log(data.screenshot); // Base64 PNG
console.log(data.url);        // URL actual
```

---

## Flujo de Ejecución Típico

1. **Usuario abre El Ordenador de Zoco** → Panel React se renderiza
2. **Usuario navega a URL** → POST `/api/ordenador-zoco` con `action: 'navigate'`
3. **Backend** → Obtiene/crea sandbox de E2B, ejecuta `sbx.browser.goto(url)`
4. **Backend** → Captura screenshot, obtiene URL actual
5. **Backend** → Retorna `{ success: true, screenshot: "base64...", url: "..." }`
6. **Frontend** → Renderiza screenshot, actualiza URL en barra
7. **Usuario hace clic en screenshot** → POST `/api/ordenador-zoco` con `action: 'click', x, y`
8. **Ciclo se repite** → Screenshot automático tras cada acción

---

## Manejo de Errores y Timeouts

### Timeout Duro (45s por acción)
Si una acción tarda más de 45 segundos, se rechaza automáticamente:
```
Error: Timeout (navigate): sin respuesta tras 45s
```

### Sandbox Expirado
Si el sandbox de E2B expira (10 min), se recrea automáticamente en la siguiente acción.

### API Key No Configurada
```json
{
  "success": false,
  "error": "E2B_API_KEY no configurada. Añádela como credencial..."
}
```

---

## Monitorización y Logs

### Logs del Backend
```javascript
// En ordenadorZoco.js
console.error(`Error en acción de Ordenador de Zoco (${action}):`, err);
```

### Eventos en Vivo
```javascript
emitLive({ workspaceId, onEvent }, {
  type: 'action_success',
  action: 'navigate',
  result: { url: 'https://...' }
});
```

### Panel de Registros (Frontend)
Visible en OrdenadorZocoPanel.tsx con timestamps y estados:
- 🟡 **Pending** - Acción en proceso
- 🟢 **Success** - Acción completada
- 🔴 **Error** - Acción fallida

---

## Seguridad

### Autenticación
- Requiere JWT válido (authMiddleware)
- workspaceId se extrae de `req.auth.sub`
- Cada usuario tiene su propio sandbox aislado

### Aislamiento
- E2B Desktop proporciona sandbox Linux aislado
- Cada sesión tiene TTL de 10 minutos
- Navegador Chromium aislado por sesión

### Validación
- Parámetros validados antes de ejecutar
- Timeouts duros previenen bloqueos
- Errores capturados y reportados sin exponer internals

---

## Troubleshooting

| Problema | Causa | Solución |
|----------|-------|----------|
| "E2B_API_KEY no configurada" | Variable de entorno faltante | Añadir `E2B_API_KEY` a `.env` |
| Timeout tras 45s | Acción lenta en E2B | Reintentar o aumentar `E2B_CALL_TIMEOUT_MS` |
| Screenshot vacío | Sandbox no iniciado | Llamar a `screenshot` primero |
| URL no se actualiza | getURL() falla | Verificar que el navegador está abierto |
| Panel no aparece | Componente no importado | Importar `OrdenadorZocoPanel` en Dashboard |

---

## Próximos Pasos Opcionales

1. **WebSocket para eventos en vivo** - Reemplazar polling con SSE/WebSocket
2. **Grabación de sesiones** - Guardar video de interacciones
3. **Historial de acciones** - Reproducir secuencias de pasos
4. **Atajos de teclado** - Ctrl+C para copiar, Ctrl+V para pegar
5. **OCR de pantalla** - Leer texto de la captura con Tesseract
6. **Gestos multi-touch** - Soporte para pinch, swipe en pantalla táctil

---

## Contacto y Soporte

Para problemas o mejoras, consulta:
- Documentación de E2B: https://e2b.dev/docs
- Rama del proyecto: `zoco-ia-1`
- Commit: `0779b08` (feat: Implementar El Ordenador de Zoco)

---

**Versión:** 1.0  
**Fecha:** Julio 2026  
**Autor:** Manus AI  
**Estado:** Listo para Producción ✓
