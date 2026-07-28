# Plan de Arquitectura para el Rediseño de zocoia.es

## 1. Introducción

Este documento detalla el plan de arquitectura para la completa reconstrucción de la plataforma zocoia.es, con el objetivo de transformarla en un clon ultra-profesional y robusto de Claude Console (de Anthropic). Se abordarán tanto el frontend (React con Tailwind CSS) como el backend (Node.js/Express con SQLite).

## 2. Arquitectura del Frontend (React con Tailwind CSS)

El frontend actual utiliza `window.prompt` para interacciones críticas, lo cual será reemplazado por componentes React modernos y modales estilizados. Se reorganizará la gestión de agentes, claves API y habilidades.

### 2.1. Componentes Principales

*   **`AgentManagementScreen.tsx`**: Componente principal que orquesta la visualización y gestión de todos los agentes. Contendrá subcomponentes para la lista de agentes y la configuración del agente seleccionado.
*   **`AgentModal.tsx`**: Un modal genérico de React, estilizado con Tailwind CSS, que se utilizará para crear y editar agentes. Incluirá transiciones suaves, estados de carga y manejo de errores. Este modal reemplazará la funcionalidad de `window.prompt` para la creación de agentes.
*   **`AgentConfigurationPanel.tsx`**: Panel dentro de `AgentManagementScreen` o un modal dedicado para la configuración avanzada de un agente. Incluirá:
    *   **`SystemPromptEditor.tsx`**: Componente para editar en vivo los `System Prompts` del agente, con un editor de texto enriquecido o un `textarea` avanzado.
    *   **`HyperparameterSettings.tsx`**: Componente para ajustar hiperparámetros como Temperatura, Contexto y penalizaciones, utilizando sliders o campos numéricos.
    *   **`ToolAssignment.tsx`**: Componente para activar/desactivar herramientas asociadas al agente, utilizando checkboxes o un sistema de tags arrastrables.
*   **`ApiKeyFormModal.tsx`**: Modal para la creación de nuevas API Keys. Este formulario enviará la clave al backend para validación en caliente antes de guardarla.
*   **`ApiKeyDisplayTable.tsx`**: Tabla para mostrar las API Keys existentes, con enmascaramiento seguro (ej: `sk-...xrFk`) y un botón de 

`Copiar al portapapeles` seguro.

### 2.2. Gestión Dinámica de Habilidades (Toolbox)

*   **`ToolboxPanel.tsx`**: Un panel interactivo para crear, editar y eliminar habilidades (`tools`). Utilizará un formulario para la entrada de JSON Schema, con validación en tiempo real. Se integrará con el backend para la persistencia de las habilidades.
*   **`AgentToolAssignment.tsx`**: Componente que permitirá asignar o revocar habilidades a cada agente. Se implementará mediante checkboxes o un sistema de etiquetas (Tags) arrastrables que actualice la base de datos en tiempo real.

### 2.3. Lógica de Conectividad en Producción

*   Se utilizarán `fetch` o `Axios` para todas las comunicaciones con el backend. Se implementará un manejo robusto de errores y estados HTTP, mostrando avisos de reintento suaves en caso de microcortes o errores de red.
*   Se asegurará que los cambios en la configuración de un agente (habilidad o prompt) sean asimilados por el motor de ejecución en caliente (`server.js`) de inmediato, sin necesidad de reiniciar el contenedor de Coolify. Esto probablemente implicará el uso de WebSockets o Server-Sent Events (SSE) para notificar al backend sobre los cambios y que este actualice su estado interno o recargue la configuración del agente afectado.

## 3. Arquitectura del Backend (Node.js/Express con SQLite)

El backend actual (`server.js`) ya utiliza Node.js con Express y SQLite. Se extenderá y modificará para soportar las nuevas funcionalidades del frontend.

### 3.1. Endpoints y Lógica de Negocio

*   **`/api/agents`**: Endpoints para la creación, lectura, actualización y eliminación (CRUD) de agentes. La creación de agentes ya no usará `window.prompt` sino que recibirá los datos del `AgentModal.tsx`.
*   **`/api/agents/:id/config`**: Endpoint para la configuración avanzada de agentes, incluyendo la actualización de `System Prompts`, hiperparámetros y asignación de herramientas.
*   **`/api/keys`**: Endpoints para la creación y gestión de API Keys. El endpoint de creación incluirá lógica de validación de la estructura de la clave antes de la inserción en la base de datos.
*   **`/api/tools`**: Endpoints CRUD para la gestión de habilidades (tools) en formato JSON Schema. Se validará el formato JSON Schema antes de guardar.
*   **`/api/agents/:id/tools`**: Endpoint para asignar/revocar habilidades a un agente específico.

### 3.2. Base de Datos (SQLite)

*   Se revisará y actualizará el esquema de la base de datos (`init_db.sql`) para incluir los campos necesarios para la configuración avanzada de agentes (hiperparámetros, herramientas asociadas) y la gestión de habilidades (JSON Schema).
*   Se asegurará la atomicidad de las operaciones de base de datos para mantener la integridad de los datos.

### 3.3. Integración con el Motor de Ejecución en Caliente

*   Se implementará un mecanismo de notificación (ej. WebSockets, SSE o un sistema de colas ligero) para que el `server.js` sea notificado de los cambios en la configuración de los agentes. Al recibir una notificación, el motor de ejecución deberá recargar la configuración del agente afectado o actualizar su estado interno para reflejar los cambios de inmediato sin reiniciar el proceso.


## 4. Especificaciones Técnicas Detalladas

### 4.1. Módulo de Gestión de Agentes (Estilo Claude Console)

*   **Modales de React**: Se utilizarán librerías de componentes UI como Headless UI o Radix UI para construir modales accesibles y estilizados con Tailwind CSS. Se implementarán transiciones CSS para una experiencia de usuario fluida. Los estados de carga se gestionarán con React Query o SWR para una mejor UX asíncrona. Los errores se mostrarán de forma clara dentro del modal.
*   **Configuración Avanzada de Agentes**: La `data` del recurso `agente` en la base de datos se expandirá para incluir campos como `systemPrompt` (TEXT), `temperatura` (REAL), `contexto` (INTEGER), `penalizaciones` (JSON/TEXT) y `herramientasAsociadas` (JSON/TEXT). Estos campos se editarán a través de los componentes mencionados en la sección 2.1.

### 4.2. Sistema de Validación y Robustez de API Keys

*   **Validación en Caliente**: Cuando el usuario introduzca una API Key en el `ApiKeyFormModal.tsx`, el frontend enviará la clave al backend (`/api/keys/validate`). El backend, en `server.js`, implementará una función que intentará realizar una llamada de prueba a la API externa correspondiente (ej. OpenAI, Anthropic) con la clave proporcionada. Si la llamada es exitosa, la clave se considerará válida y se guardará en la base de datos. Si falla, se devolverá un error al frontend.
*   **Enmascaramiento Seguro**: En `ApiKeyDisplayTable.tsx`, la clave completa nunca se mostrará. Solo se mostrará un prefijo y sufijo (ej. `sk-...xrFk`). El botón `Copiar al portapapeles` utilizará la API `navigator.clipboard.writeText` para copiar la clave completa de forma segura (que se obtendrá del backend solo para esa acción específica y no se almacenará en el frontend).

### 4.3. Gestión Dinámica de Habilidades (Toolbox)

*   **Panel Interactivo**: El `ToolboxPanel.tsx` permitirá la creación y edición de habilidades. Cada habilidad se almacenará como un recurso de tipo `habilidad` en la base de datos, con su `data` conteniendo el JSON Schema de la herramienta. Se utilizará un editor de texto para el JSON Schema con validación en tiempo real (ej. `json-schema-validator`).
*   **Asignación de Habilidades**: El `AgentToolAssignment.tsx` mostrará una lista de habilidades disponibles. Para cada agente, se permitirá seleccionar qué habilidades tiene activas. Esta relación se almacenará en el campo `herramientasAsociadas` del recurso `agente` como un array de IDs de habilidades.

### 4.4. Lógica de Conectividad en Producción

*   **Manejo de Errores de Red**: Se implementarán interceptores globales en Axios o lógica `try-catch` en `fetch` para detectar errores de red. En caso de fallo, se mostrará un componente de notificación (ej. un toast) con un mensaje amigable y un botón de reintento. Se utilizará un patrón de reintentos con backoff exponencial para evitar saturar el servidor.
*   **Actualización en Caliente**: Para la actualización de la configuración de agentes, se explorarán dos opciones:
    1.  **WebSockets/SSE**: Implementar un canal de comunicación en tiempo real entre el frontend y el backend. Cuando se guarda un cambio en un agente, el frontend envía el cambio al backend, que a su vez emite un evento a todos los procesos `server.js` activos (si hay múltiples instancias). Cada instancia de `server.js` escucharía este evento y recargaría la configuración del agente afectado de su base de datos.
    2.  **Polling con Cache Invalidation**: Menos eficiente pero más simple. El `server.js` podría tener una caché de configuraciones de agentes con un TTL corto. Cuando se guarda un cambio, se invalida la entrada de la caché para ese agente, forzando una recarga de la base de datos en la siguiente solicitud. Esto requeriría que todas las instancias de `server.js` compartan una caché distribuida (ej. Redis) o que el TTL sea muy corto.
    Se priorizará la opción de WebSockets/SSE para una respuesta más inmediata y eficiente.

## 5. Cambios en el Esquema de la Base de Datos (SQLite)

Se modificarán las tablas `resources` y `api_keys` y se podría añadir una nueva tabla para `tools` si se considera más eficiente que almacenarlas como recursos genéricos.

### 5.1. Tabla `resources`

Se añadirán o modificarán los siguientes campos en la columna `data` (JSON) para los recursos de tipo `agente`:

*   `systemPrompt`: TEXT (para el prompt del sistema del agente)
*   `temperatura`: REAL (valor numérico para la temperatura del modelo)
*   `contexto`: INTEGER (tamaño del contexto en tokens)
*   `penalizaciones`: JSON/TEXT (objeto JSON para penalizaciones, ej. `{"frecuencia": 0.5, "presencia": 0.2}`)
*   `herramientasAsociadas`: JSON/TEXT (array de IDs de herramientas asociadas, ej. `["tool_id_1", "tool_id_2"]`)

### 5.2. Tabla `api_keys`

Se añadirán los siguientes campos:

*   `api_provider`: TEXT (ej. "openai", "anthropic", "custom")
*   `api_key_full`: TEXT (la clave completa, almacenada de forma encriptada en la base de datos y solo desencriptada para validación o copia al portapapeles).

### 5.3. Tabla `tools` (Opcional, si no se usa `resources` para herramientas)

Si se decide crear una tabla separada para herramientas, su esquema sería:

*   `id`: TEXT PRIMARY KEY
*   `user_id`: TEXT NOT NULL (FOREIGN KEY a `users`)
*   `name`: TEXT NOT NULL
*   `description`: TEXT
*   `json_schema`: TEXT (el JSON Schema de la herramienta)
*   `created_at`: TEXT DEFAULT CURRENT_TIMESTAMP
*   `updated_at`: TEXT DEFAULT CURRENT_TIMESTAMP

## 6. Consideraciones de Seguridad

*   **API Keys**: La clave completa (`api_key_full`) se almacenará encriptada en la base de datos. La desencriptación solo ocurrirá en el backend para la validación o para ser enviada al frontend de forma efímera para la función de copiar. Nunca se expondrá en logs o en el frontend de forma persistente.
*   **Validación de Entrada**: Todas las entradas del usuario (prompts, hiperparámetros, JSON Schema de herramientas) se validarán rigurosamente en el backend para prevenir inyecciones de código o datos maliciosos.
*   **Autenticación/Autorización**: Se mantendrá el sistema de autenticación JWT existente. Todas las operaciones sobre recursos de agentes, claves y herramientas requerirán autorización adecuada (ej. solo el propietario puede modificar sus recursos).

## 7. Próximos Pasos

1.  **Refactorización del Frontend**: Crear los componentes React Modales y de Configuración de Agentes.
2.  **Desarrollo del Backend**: Implementar los nuevos endpoints y la lógica de validación de API Keys y gestión de herramientas.
3.  **Actualización de la Base de Datos**: Aplicar los cambios en el esquema de SQLite.
4.  **Integración**: Conectar el frontend y el backend, implementando la lógica de actualización en caliente.
5.  **Pruebas**: Realizar pruebas exhaustivas de todas las nuevas funcionalidades.
