import urllib.request, json, time

url = "http://localhost:8000/api/chat"

def hablar_con_ia(rol, prompt):
    data = json.dumps({
        "model": "llama3.2:1b", 
        "messages": [
            {"role": "system", "content": "Eres el " + rol}, 
            {"role": "user", "content": prompt}
        ], 
        "stream": False
    })
    req = urllib.request.Request(url, data=data.encode("utf-8"), headers={"Content-Type": "application/json"})
    try:
        res = urllib.request.urlopen(req).read().decode("utf-8")
        return json.loads(res)["message"]["content"]
    except Exception as e:
        return "Error de conexion: " + str(e)

print("=== CONEXION EN VIVO: 2 AGENTES HABLANDO ===")
r1 = hablar_con_ia("Analista", "Crea una idea de negocio muy corta de un SaaS para tiendas locales.")
print("\n[AGENTE 1]:\n" + r1)

time.sleep(1)

r2 = hablar_con_ia("Programador", "Dame 2 pasos tecnicos para desarrollar: " + r1)
print("\n[AGENTE 2]:\n" + r2)
