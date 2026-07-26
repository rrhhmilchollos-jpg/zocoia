import http.server
import json
import urllib.request
import urllib.error
import os

DB_FILE = "saldos.json"

# Crear base de datos de clientes si no existe
if not os.path.exists(DB_FILE):
    CLIENTES_DEFAULT = {
        "sk-cliente-juan-50usd": {"max_budget": 50.00, "spend": 0.00, "name": "Juan Agentes"},
        "sk-cliente-maria-50usd": {"max_budget": 50.00, "spend": 0.00, "name": "Maria Sistemas"}
    }
    with open(DB_FILE, "w") as f:
        json.dump(CLIENTES_DEFAULT, f, indent=4)

def cargar_clientes():
    with open(DB_FILE, "r") as f:
        return json.load(f)

def guardar_clientes(data):
    with open(DB_FILE, "w") as f:
        json.dump(data, f, indent=4)

class ProxyHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        auth_header = self.headers.get('Authorization', '')
        api_key = auth_header.replace('Bearer ', '').strip()
        
        clientes = cargar_clientes()
        if api_key not in clientes:
            self.send_error_response(401, "API Key invalida. Contacta al administrador.")
            return
            
        cliente = clientes[api_key]
        if cliente["spend"] >= cliente["max_budget"]:
            self.send_error_response(402, f"Presupuesto mensual agotado ({cliente['max_budget']} USD).")
            return

        content_length = int(self.headers['Content-Length'])
        body = json.loads(self.rfile.read(content_length).decode('utf-8'))
        
        # Conexión directa a la IP limpia de la interfaz de vLLM
        vllm_url = "http://127.0.0"
        req = urllib.request.Request(vllm_url, data=json.dumps(body).encode('utf-8'), headers={"Content-Type": "application/json"})
        
        try:
            # Timeout estricto de 15 segundos para proteger el servidor de congelamientos
            with urllib.request.urlopen(req, timeout=15) as response:
                res_data = response.read()
                
                # Descontar saldo y guardar en tiempo real
                cliente["spend"] += 0.01
                guardar_clientes(clientes)
                print(f"[VENTA] {cliente['name']} consumio tokens. Registrado: {cliente['spend']:.2f}/{cliente['max_budget']} USD")
                
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(res_data)
        except urllib.error.HTTPError as e:
            # Captura el error 500 directo que escupe vLLM y lee su mensaje real
            error_msg = e.read().decode('utf-8')
            self.send_error_response(500, f"vLLM rechazo la peticion: {error_msg}")
        except Exception as e:
            self.send_error_response(504, f"El motor vLLM tardo demasiado en responder: {str(e)}")

    def send_error_response(self, code, msg):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"error": {"message": msg, "code": code}}).encode())

print("Servidor comercial blindado activo en el puerto 5050. Proteccion de Timeout encendida...")
http.server.HTTPServer(('0.0.0.0', 5050), ProxyHandler).serve_forever()
