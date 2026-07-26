# Configuración del Dashboard Zoco IA

## 🚀 Inicio Rápido

### Credenciales de Acceso

#### Administrador
- **Email:** `rrhh.milchollos@gmail.com`
- **Contraseña:** `19862210Des`
- **Rol:** Admin con acceso completo

#### Cliente de Prueba
- **Email:** `cliente@example.com`
- **Contraseña:** `cliente123`
- **Rol:** Cliente

## 📊 Características del Dashboard

### Panel de Cliente

#### 1. Dashboard Principal
- Saldo de la cuenta en tiempo real
- Tokens disponibles y utilizados
- Cache guardada con ahorros estimados
- Gráfico de volumen de tokens (últimos 7 días)
- Estado de modelos de infraestructura

#### 2. Compra de Tokens
Cuatro paquetes disponibles:
- **Starter:** 100K tokens - $10
- **Professional:** 500K tokens - $45 (10% descuento)
- **Enterprise:** 2M tokens - $160 (20% descuento)
- **Unlimited:** 10M tokens - $700 (30% descuento)

#### 3. Gestión de Claves API
- Crear nuevas claves API
- Establecer límites mensuales
- Revocar claves activas
- Ver uso y estado

#### 4. Gestión de Agentes
- Crear nuevos agentes de IA
- Seleccionar modelo de infraestructura
- Monitorear estado (activo/inactivo/error)
- Ver sesiones y última actividad

#### 5. Sesiones
- Tabla de todas las sesiones
- Información de tokens utilizados
- Estado de cada sesión

#### 6. Analíticas
- Estadísticas de uso general
- Tokens por día
- Uso por modelo
- Métricas de rendimiento

#### 7. Recarga de Fondos
- Integración con Viva.com
- Montos predefinidos o personalizados
- Resumen de pago en tiempo real

### Panel de Administración

#### 1. Dashboard Administrativo
- Usuarios activos
- Tokens totales en el sistema
- Ingresos del mes
- Modelos online

#### 2. Gestión de Usuarios
- Lista completa de usuarios
- Roles (cliente/admin)
- Saldo y tokens comprados
- Fecha de registro

#### 3. Gestión de Claves API
- Todas las claves del sistema
- Propietario de cada clave
- Límites y uso
- Estado (activa/suspendida)

## 🔐 Sistema de Autenticación

### Flujo de Login
1. Usuario ingresa email y contraseña
2. Sistema valida credenciales
3. Se asigna rol (cliente o admin)
4. Se redirige al dashboard correspondiente

### Roles y Permisos

#### Cliente
- Ver su propio dashboard
- Comprar tokens
- Gestionar sus claves API
- Crear y gestionar agentes
- Ver sus sesiones y analíticas

#### Admin
- Acceso a panel administrativo
- Gestionar todos los usuarios
- Ver estadísticas globales
- Gestionar claves API del sistema
- Control total del sistema

## 🗄️ Base de Datos

### Tablas Principales

#### users
```sql
- id (INTEGER PRIMARY KEY)
- email (TEXT UNIQUE)
- password_hash (TEXT)
- nombre (TEXT)
- rol (TEXT: 'cliente' | 'admin')
- saldo (REAL)
- tokens_comprados (INTEGER)
- tokens_usados (INTEGER)
- activo (INTEGER)
- created_at (TEXT)
```

#### api_keys
```sql
- id (INTEGER PRIMARY KEY)
- key_hash (TEXT UNIQUE)
- owner_name (TEXT)
- owner_email (TEXT)
- owner_id (INTEGER FK)
- active (INTEGER)
- monthly_token_limit (INTEGER)
- monthly_usd_limit (REAL)
- price_per_1k_tokens (REAL)
- created_at (TEXT)
- notes (TEXT)
```

#### usage_log
```sql
- id (INTEGER PRIMARY KEY)
- key_id (INTEGER FK)
- prompt_tokens (INTEGER)
- completion_tokens (INTEGER)
- model (TEXT)
- endpoint (TEXT)
- created_at (TEXT)
```

#### agents
```sql
- id (INTEGER PRIMARY KEY)
- user_id (INTEGER FK)
- nombre (TEXT)
- modelo (TEXT)
- estado (TEXT: 'activo' | 'inactivo' | 'error')
- sesiones (INTEGER)
- ultima_actividad (TEXT)
- created_at (TEXT)
```

#### transactions
```sql
- id (INTEGER PRIMARY KEY)
- user_id (INTEGER FK)
- tipo (TEXT: 'compra' | 'recarga' | 'uso')
- monto (REAL)
- tokens (INTEGER)
- descripcion (TEXT)
- created_at (TEXT)
```

## 🔌 Endpoints de API

### Autenticación
- `POST /auth/register` - Registrar nuevo usuario
- `POST /auth/login` - Iniciar sesión

### Inferencia (OpenAI Compatible)
- `POST /v1/chat/completions` - Completar chat
- `GET /v1/models` - Listar modelos
- `GET /v1/usage` - Ver uso

### Administración
- `GET /admin/users` - Listar usuarios
- `GET /admin/keys` - Listar claves API
- `POST /admin/keys` - Crear clave API
- `DELETE /admin/keys/:id` - Eliminar clave
- `GET /admin/stats` - Estadísticas globales

## 🎨 Diseño y Colores

### Paleta de Colores
- **Fondo:** `#0b0f19` (Azul muy oscuro)
- **Sidebar:** `#0d1117` (Azul oscuro)
- **Tarjetas:** `#161b27` (Azul oscuro)
- **Borde:** `#1e2a3a` (Azul grisáceo)
- **Acento:** `#22d3ee` (Cian)
- **Verde:** `#34d399` (Verde menta)
- **Rojo:** `#f87171` (Rojo coral)
- **Amarillo:** `#fbbf24` (Amarillo dorado)
- **Gris:** `#6b7280` (Gris)
- **Blanco:** `#f1f5f9` (Blanco suave)

## 📦 Dependencias

### Frontend
- React 18.2.0
- React DOM 18.2.0
- TypeScript 5.0.0
- Vite 4.4.0

### Backend
- Express.js
- better-sqlite3
- node-fetch

## 🚀 Despliegue

### Desarrollo Local
```bash
# Frontend
npm install
npm run dev

# Backend
cd gateway
npm install
npm start
```

### Producción
```bash
# Build frontend
npm run build

# Iniciar backend con variables de entorno
VLLM_URL=http://vllm:8000/v1 \
DB_PATH=/data/gateway.db \
ADMIN_KEY=tu-clave-admin-secreta \
npm start
```

## 📝 Notas Importantes

1. **Seguridad:** Las contraseñas se almacenan con hash SHA256. En producción, usar bcrypt.
2. **Tokens API:** Se generan aleatoriamente y se almacenan solo los hashes.
3. **Admin Predefinido:** El usuario admin se crea automáticamente en la primera ejecución.
4. **CORS:** Habilitado para acceso desde cualquier origen (configurar en producción).

## 🔄 Próximas Mejoras

- [ ] Integración real con Viva.com
- [ ] Sistema de notificaciones
- [ ] Dashboard de métricas avanzadas
- [ ] Soporte para múltiples organizaciones
- [ ] Webhooks para eventos
- [ ] Exportación de reportes
- [ ] Autenticación OAuth2
- [ ] 2FA (Two-Factor Authentication)

## 📞 Soporte

Para problemas o preguntas, contactar al equipo de desarrollo.
