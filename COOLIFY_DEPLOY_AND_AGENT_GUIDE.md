# Guía de Despliegue en Coolify y Configuración del Agente Autónomo

Esta guía detalla los pasos para desplegar la nueva arquitectura de **Zoco IA** en tu servidor Coolify y activar el panel de **Agente Autónomo**.

## 1. Script de Despliegue para Coolify

Coolify detectará automáticamente el `Dockerfile` en la raíz del proyecto. Sin embargo, para asegurar que la base de datos sea persistente y los agentes funcionen, usa esta configuración en la sección **Docker Compose** o **Service Configuration** de Coolify:

```yaml
version: '3.8'
services:
  zocoia:
    build:
      context: .
      dockerfile: Dockerfile
    image: zocoia-app:latest
    container_name: zocoia-prod
    restart: always
    environment:
      - NODE_ENV=production
      - PORT=8080
      - JWT_SECRET=${JWT_SECRET}
      - DB_PATH=/data/zocoia.db
      - GROQ_API_KEY=${GROQ_API_KEY}
      - E2B_API_KEY=${E2B_API_KEY}
      - TAVILY_API_KEY=${TAVILY_API_KEY}
      - OLLAMA_BASE_URL=http://tu-servidor-ollama:11434
    volumes:
      - zocoia_data:/data
    networks:
      - coolify

volumes:
  zocoia_data:
    driver: local
```

### Pasos en el Panel de Coolify:
1. **Source:** Conecta tu repositorio de GitHub y selecciona la rama `main`.
2. **Environment Variables:** Añade obligatoriamente `GROQ_API_KEY` y `E2B_API_KEY`.
3. **Persistent Storage:** Asegúrate de que el volumen `/data` esté configurado para que no pierdas tus agentes y claves API al reiniciar.
4. **Build & Deploy:** Pulsa "Deploy" y Coolify compilará el frontend (Vite) y arrancará el backend (Express).

---

## 2. Configuración del Panel 'Agente Autónomo'

El nuevo panel **Agente Autónomo** permite que la IA use el ordenador virtual (Computer Use) mediante E2B Desktop.

### Requisitos Previos:
- **E2B API Key:** Consíguela en [e2b.dev](https://e2b.dev).
- **Groq API Key:** Necesaria para el razonamiento rápido (Llama 3.1 70B o 405B recomendados).

### Pasos para Activar el Panel:
1. **Acceso:** En la barra lateral de Zoco IA, ve a **Agentes gestionados** -> **Agente Autónomo**.
2. **Interfaz de Terminal:** Verás una terminal estilo retro. Esta terminal muestra el flujo de eventos SSE (Server-Sent Events) en tiempo real.
3. **Inicio de Tarea:** Escribe una instrucción compleja (ej: *"Busca las últimas noticias de IA y crea un reporte en un archivo .txt"*) y pulsa **Ejecutar**.
4. **Bucle de Control:** 
   - El backend creará una sandbox de **E2B Desktop**.
   - El agente enviará comandos de terminal, usará el navegador y gestionará archivos.
   - Podrás ver cada paso ("Pensando...", "Ejecutando comando...", "Resultado") en la terminal en vivo.

### Monitorización Técnica:
Si quieres ver qué está pasando bajo el capó, el backend emite eventos a través de la ruta:
`GET /api/agentes/:id/eventos`
El componente `ManusAgentPanel.tsx` ya está configurado para reconectar automáticamente si hay microcortes.

---

## 3. Notas de Mantenimiento
- **Carga en Caliente:** Si editas un System Prompt en el Dashboard, el Agente Autónomo usará la nueva configuración en su siguiente tarea sin necesidad de reiniciar nada.
- **Seguridad:** Todas las claves API que añadas en el nuevo modal están encriptadas con **AES-256-GCM**.
