# Guía de Integración: Nuevos Componentes y Endpoints

Este documento proporciona instrucciones paso a paso para integrar los nuevos componentes React y endpoints del backend en el proyecto zocoia.es.

## 1. Integración del Frontend

### 1.1. Actualizar el componente Dashboard.tsx

Reemplaza la función `handleCreateAgent` en `src/pages/Dashboard.tsx` para usar el nuevo `AgentModal`:

```typescript
// Antes (línea 96-101):
const handleCreateAgent = async () => {
  const name = prompt('Nombre del agente:'); if (!name) return;
  const r = await fetch(`${API_BASE}/api/resources`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ type: 'agente', name }) });
  if (r.ok) { const data = await r.json(); setAgentes(p => [...p, data]); load('/api/billing/summary', setBilling); }
  else { const e = await r.json(); alert(e.error || 'Error'); }
};

// Después:
const [showAgentModal, setShowAgentModal] = useState(false);
const [editingAgent, setEditingAgent] = useState<Recurso | null>(null);

const handleCreateAgent = () => {
  setEditingAgent(null);
  setShowAgentModal(true);
};

const handleAgentModalSuccess = (agent: Recurso) => {
  setAgentes(p => [...p, agent]);
  load('/api/billing/summary', setBilling);
};
```

### 1.2. Agregar el componente AgentModal al Dashboard

En el JSX del Dashboard, añade el modal después del cierre del contenedor principal:

```typescript
<AgentModal
  isOpen={showAgentModal}
  onClose={() => setShowAgentModal(false)}
  onSuccess={handleAgentModalSuccess}
  agent={editingAgent}
/>
```

### 1.3. Reemplazar la función handleCreateKey

Actualiza la creación de API Keys para usar el nuevo `ApiKeyModal`:

```typescript
// Añade estado para el modal
const [showApiKeyModal, setShowApiKeyModal] = useState(false);

// Reemplaza handleCreateKey
const handleCreateKey = () => {
  setShowApiKeyModal(true);
};

const handleApiKeyModalSuccess = (key: ApiKey) => {
  setKeys(p => [...p, key]);
};

// En el JSX, añade:
<ApiKeyModal
  isOpen={showApiKeyModal}
  onClose={() => setShowApiKeyModal(false)}
  onSuccess={handleApiKeyModalSuccess}
/>
```

### 1.4. Actualizar la tabla de API Keys

Reemplaza la sección de visualización de claves con el nuevo componente:

```typescript
// Importar el componente
import ApiKeyTable from '../components/ApiKeyTable';

// En el JSX, reemplaza la tabla actual con:
<ApiKeyTable
  keys={keys}
  onDelete={handleDeleteKey}
  onCopy={async (id) => {
    try {
      const response = await fetch(`${API_BASE}/api/keys/${id}/copy`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        await navigator.clipboard.writeText(data.key);
      }
    } catch (err) {
      console.error('Error copying key:', err);
    }
  }}
/>
```

### 1.5. Agregar el Gestor de Herramientas

En la sección de recursos o en una pestaña dedicada, añade el `ToolboxPanel`:

```typescript
// Importar el componente
import ToolboxPanel from '../components/ToolboxPanel';

// En el JSX, añade:
{activeTab === 'herramientas' && (
  <div className="p-6">
    <ToolboxPanel onToolsUpdate={() => load('/api/resources?type=habilidad', setResourcesByType)} />
  </div>
)}
```

### 1.6. Agregar la Asignación de Herramientas a Agentes

En la pantalla de configuración de agentes, añade:

```typescript
// Importar el componente
import AgentToolAssignment from '../components/AgentToolAssignment';

// En el JSX, cuando se selecciona un agente:
{expandedAgentId && (
  <div className="mt-4 p-4 bg-[#2a2a2a] rounded border border-[#444]">
    <AgentToolAssignment
      agentId={expandedAgentId}
      onUpdate={() => load(`/api/resources/${expandedAgentId}`, (agent) => {
        setAgentes(p => p.map(a => a.id === expandedAgentId ? agent : a));
      })}
    />
  </div>
)}
```

## 2. Integración del Backend

### 2.1. Actualizar el esquema de la base de datos

Ejecuta los siguientes comandos SQL en `init_db.sql` para actualizar las tablas:

```sql
-- Actualizar tabla api_keys
ALTER TABLE api_keys ADD COLUMN api_provider TEXT DEFAULT 'custom';
ALTER TABLE api_keys ADD COLUMN api_key_full TEXT;

-- Las columnas data de resources ya existen, solo se usan para almacenar JSON
-- No se necesitan cambios en el esquema, solo en la lógica de la aplicación
```

### 2.2. Importar los módulos de validación

En `server.js`, añade las siguientes importaciones al inicio del archivo:

```javascript
import { registerNewApiEndpoints } from './new-api-endpoints.js';
```

### 2.3. Registrar los nuevos endpoints

Después de la configuración de middleware en `server.js`, añade:

```javascript
// Después de app.use(express.json())
registerNewApiEndpoints(app, db, authMiddleware);
```

### 2.4. Configurar la clave de encriptación

Añade a tu archivo `.env` o variables de entorno de Coolify:

```
ENCRYPTION_KEY=<tu_clave_de_encriptacion_de_32_bytes_en_hex>
```

Si no está configurada, el sistema generará una clave temporal (no recomendado para producción).

### 2.5. Instalar dependencias adicionales (si es necesario)

Asegúrate de que `uuid` esté en `package.json`:

```bash
npm install uuid
```

## 3. Actualizar el Esquema de Datos de Agentes

Los agentes ahora soportan la siguiente estructura en su campo `data`:

```json
{
  "systemPrompt": "Tu prompt del sistema aquí",
  "temperatura": 0.7,
  "contexto": 4096,
  "penalizaciones": {
    "frecuencia": 0.5,
    "presencia": 0.2
  },
  "herramientasAsociadas": ["tool_id_1", "tool_id_2"]
}
```

## 4. Endpoints Disponibles

### Agentes
- `GET /api/agents/:id` - Obtener un agente
- `PUT /api/agents/:id/config` - Actualizar configuración del agente
- `PUT /api/agents/:id/tools` - Asignar herramientas
- `GET /api/agents/:id/tools` - Obtener herramientas del agente

### API Keys
- `POST /api/keys/validate` - Validar una API Key
- `POST /api/keys` - Crear una nueva API Key
- `GET /api/keys/:id/copy` - Obtener la clave completa para copiar

### Herramientas
- `POST /api/tools` - Crear una herramienta
- `PUT /api/tools/:id` - Actualizar una herramienta
- `DELETE /api/tools/:id` - Eliminar una herramienta

## 5. Consideraciones de Seguridad

1. **Encriptación de API Keys**: Las claves se almacenan encriptadas. Asegúrate de configurar `ENCRYPTION_KEY` en producción.
2. **Validación en Caliente**: Todas las API Keys se validan con el proveedor antes de guardarlas.
3. **Enmascaramiento**: Las claves se muestran enmascaradas en la UI (ej: `sk-...xrFk`).
4. **Autorización**: Todos los endpoints requieren autenticación JWT.

## 6. Pruebas Recomendadas

1. Crear un nuevo agente con el modal
2. Editar la configuración del agente (prompt, temperatura, contexto)
3. Crear una API Key y validarla
4. Crear una herramienta con JSON Schema
5. Asignar herramientas a un agente
6. Copiar una API Key al portapapeles
7. Revocar una API Key

## 7. Troubleshooting

### Error: "API Key inválida"
- Verifica que la API Key sea correcta para el proveedor seleccionado
- Comprueba que el proveedor esté configurado correctamente

### Error: "JSON Schema inválido"
- Asegúrate de que el JSON sea válido
- Verifica que tenga al menos un campo `type`, `properties` o `$ref`

### Error: "Herramienta no encontrada"
- Verifica que la herramienta exista y pertenezca al usuario actual
- Comprueba que el ID sea correcto

## 8. Próximos Pasos

1. Implementar WebSockets/SSE para actualización en caliente
2. Agregar más proveedores de API Keys (Hugging Face, Replicate, etc.)
3. Crear un editor visual para JSON Schema
4. Implementar versionado de herramientas
5. Agregar métricas de uso de herramientas por agente
