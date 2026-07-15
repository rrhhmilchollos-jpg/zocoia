import urllib.request
import json

# CONFIGURACIÓN DEL SISTEMA COMERCIAL
API_URL = "http://127.0.0.1:5050"
API_KEY = "sk-cliente-juan-50usd"  
MODELO = "claude-3-5-sonnet"

def consultar_agente(rol, instrucciones, pregunta):
    """Función que conecta al agente con tu pasarela de pago en el puerto 5050"""
    # Combinamos las instrucciones para máxima compatibilidad con modelos locales
    contenido_instruccion = f"Actúa estrictamente como un {rol}. Instrucciones especiales: {instrucciones}\n\nPregunta: {pregunta}"
    
    payload = {
        "model": MODELO,
        "messages": [
            {"role": "user", "content": contenido_instruccion}
        ],
        "max_tokens": 150
    }
    
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode('utf-8'),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}"
        }
    )
    
    try:
        with urllib.request.urlopen(req) as response:
            datos = json.loads(response.read().decode('utf-8'))
            return datos['choices'][0]['message']['content']
    except Exception as e:
        return f"Error en el agente: {str(e)}"

# =====================================================================
# EJECUCIÓN DEL SISTEMA DE AGENTES EN CASCADA
# =====================================================================
print("--- INICIANDO SISTEMA DE AGENTES DE IA ---")
tema_negocio = "Tendencias de Inteligencia Artificial para este ano"

# AGENTE 1: INVESTIGADOR
print("\n[Agente 1] Investigador recopilando informacion clave...")
instrucciones_investigador = "Busca los 3 puntos mas importantes y disruptivos sobre el tema solicitado. Se muy breve."
datos_investigacion = consultar_agente("Investigador de Mercado", instrucciones_investigador, f"Investiga sobre: {tema_negocio}")
print(f"-> Respuesta del Investigador:\n{datos_investigacion}")

# AGENTE 2: ESCRITOR
print("\n[Agente 2] Escritor redactando el informe final...")
instrucciones_escritor = "Toma los datos que te dara el investigador y redactalos en un parrafo profesional de tipo resumen ejecutivo."
informe_final = consultar_agente("Escritor de Contenido", instrucciones_escritor, f"Redacta un informe basado en estos puntos: {datos_investigacion}")
print(f"-> Informe Final del Sistema de Agentes:\n{informe_final}")
print("\n--- TAREA COMPLETADA ---")
