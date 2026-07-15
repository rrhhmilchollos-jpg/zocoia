# Guía de Zoco IA — Tu consola de infraestructura en vivo

Zoco IA ya está funcionando **en producción, en la nube, las 24 horas**, sin depender de tu ordenador ni de Docker Desktop. Esta guía resume todo lo que necesitas saber para usarla y administrarla sin conocimientos técnicos.

## 1. Direcciones de tu plataforma

| Qué es | Dirección |
| --- | --- |
| **Tu web en vivo (usar ya)** | https://mis-modelos-ia-propios-production.up.railway.app |
| Tu dominio propio (cuando configures los DNS) | https://zocoia.es |
| Panel de Railway (hosting) | https://railway.com → proyecto *unique-vibrancy* |
| Código fuente (GitHub) | https://github.com/rrhhmilchollos-jpg/MIS-MODELOS-IA-propios |

## 2. Tus credenciales

| Rol | Email | Contraseña |
| --- | --- | --- |
| **Administradora (tú)** | rrhh.milchollos@gmail.com | 19862210Des |

Tu clave maestra de API (no la compartas con nadie):

> `sk-marisai-00721f5f89c10d78b286ad7f3bda6d457068b4ea10d53a5d`

## 3. Qué puede hacer cada persona

**Tus clientes** entran en la web, pulsan "Regístrate gratis" y automáticamente reciben 5 US$ de créditos de bienvenida y una clave de API propia (formato `sk-zocoia-...`). Desde su consola pueden crear más claves, crear agentes, chatear con los modelos en el Área de trabajo, comprar créditos (paquetes con Viva.com) y ver su uso.

**Tú, como administradora**, ves todo lo anterior más la sección **Administración** (menú lateral), donde puedes ver todos los usuarios registrados, sus créditos y gastos, añadirles créditos manualmente, desactivar o eliminar claves de API de cualquier cliente, y consultar los ingresos y transacciones globales.

## 4. Tus modelos e infraestructura

| Tarjeta | Modelo interno | Equivalente |
| --- | --- | --- |
| Fable 5 | maris-fable-70b | Más capaz, investigación |
| Opus 4.8 | maris-pro-32b | Proyectos complejos, programación |
| Sonnet 5 | maris-core-7b | Tareas cotidianas, escritura |
| Haiku 4.5 | maris-velox-1b | Más rápido, menor coste |

Tus **11 agentes** (Analista de Requisitos, Investigador de Mercado, Arquitecto de Software, Maquetador HTML, Estilista CSS, Desarrollador JS, Ingeniero Backend, Especialista en Seguridad, Tester QA, Depurador de Código y Desplegador DevOps) están precargados en la sección **Agentes** y pueden ejecutarse en cadena (pipeline) desde **Inicio rápido**.

La API es compatible con el formato OpenAI/Anthropic: los clientes pueden llamar a `POST /v1/chat/completions` con su clave `sk-zocoia-...`.

## 5. Conectar un motor de IA real (opcional)

Ahora mismo el sistema responde con un motor de demostración integrado. Para que las respuestas las genere un LLM real tienes dos opciones:

1. **Ollama en la nube:** despliega Ollama como servicio en Railway y añade en las Variables del servicio `OLLAMA_URL` con su dirección interna (por ejemplo `http://ollama.railway.internal:11434`). El sistema lo usará automáticamente.
2. **Tu PC con Docker (como antes):** si algún día quieres usar los modelos de tu ordenador, enciende Docker Desktop y ejecuta el túnel; pero ya **no es necesario** para que la web funcione.

## 6. Activar tu dominio zocoia.es (Piensa Solutions)

Entra en tu panel de Piensa Solutions → gestión de DNS del dominio **zocoia.es** y añade estos registros. En unos minutos u horas, zocoia.es mostrará tu consola con candado de seguridad (HTTPS automático).

| Tipo | Nombre/Host | Valor |
| --- | --- | --- |
| CNAME (o ALIAS/ANAME para el dominio raíz) | @ | `olkux4m8.up.railway.app` |
| TXT | `_railway-verify` | `railway-verify=fbf3cda42ebc521cb31ec38b832812d4` |

Si Piensa Solutions no permite CNAME en el dominio raíz (@), crea el CNAME en `www` y una redirección de zocoia.es a www.zocoia.es, o pide a su soporte que active un registro ALIAS.

## 7. Muy importante: pago pendiente en Railway

Railway muestra el aviso **"Your subscription is past due"** (suscripción con pago atrasado). Si no pones al día el pago en Railway → Workspace → Billing, pueden suspender el servicio y la web dejaría de funcionar. Es lo único que puede tumbar la plataforma ahora mismo.

## 8. Mantenimiento del día a día

No necesitas hacer nada para que la web siga en marcha. Cualquier cambio que se suba a GitHub (rama main) se despliega solo en Railway en 2-3 minutos. Los datos (usuarios, claves, agentes, transacciones) se guardan en el servidor; ten en cuenta que si Railway reinicia el contenedor sin un volumen persistente, los registros nuevos podrían perderse — si el negocio crece, el siguiente paso recomendable es añadir un volumen o base de datos PostgreSQL en Railway (se puede hacer cuando quieras).
