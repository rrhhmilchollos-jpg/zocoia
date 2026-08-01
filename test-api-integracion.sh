#!/usr/bin/env bash
# Test de integración de las rutas HTTP del Ordenador de Zoco contra el
# servidor real, con autenticación JWT real. No requiere ANTHROPIC_API_KEY
# para la mayoría de comprobaciones: verifica el contrato HTTP, la seguridad
# y la persistencia. Si la clave está presente, prueba también el bucle en vivo.
set -uo pipefail

BASE="${BASE:-http://localhost:8080}"
EMAIL="${ADMIN_EMAIL:-admin@zocoia.es}"
PASS="${ADMIN_PASSWORD:-TestLocal123!}"
fallos=0

check() {
  if [ "$1" = "ok" ]; then echo "✅ $2"; else echo "❌ $2  → $3"; fallos=$((fallos+1)); fi
}

echo "── 1. Autenticación ──"
LOGIN=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
TOKEN=$(echo "$LOGIN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).token||'')}catch{console.log('')}})")
[ -n "$TOKEN" ] && check ok "Login correcto, JWT obtenido" || check fail "Login correcto" "$LOGIN"
[ -z "$TOKEN" ] && { echo "Sin token no se puede continuar."; exit 1; }
AUTH="Authorization: Bearer $TOKEN"

echo "── 2. Seguridad: sin token debe rechazar ──"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/computer/tasks")
[ "$CODE" = "401" ] && check ok "GET /tasks sin token devuelve 401" || check fail "GET /tasks sin token devuelve 401" "devolvió $CODE"

echo "── 3. Listado de tareas ──"
LIST=$(curl -s "$BASE/api/computer/tasks" -H "$AUTH")
echo "$LIST" | grep -q '^\[' && check ok "GET /tasks devuelve un array JSON" || check fail "GET /tasks devuelve un array JSON" "$LIST"

echo "── 4. Validación de entrada ──"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/computer/tasks" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{}')
[ "$CODE" = "400" ] && check ok "POST /tasks sin prompt devuelve 400" || check fail "POST /tasks sin prompt devuelve 400" "devolvió $CODE"

echo "── 5. Tarea inexistente ──"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/computer/tasks/no-existe-xyz" -H "$AUTH")
[ "$CODE" = "404" ] && check ok "GET de tarea inexistente devuelve 404" || check fail "GET de tarea inexistente devuelve 404" "devolvió $CODE"

echo "── 6. Creación de tarea real ──"
CREATE=$(curl -s -X POST "$BASE/api/computer/tasks" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"prompt":"Crea un archivo prueba.txt con el texto HOLA y entrégamelo","model":"zoco-flash"}')
TASK_ID=$(echo "$CREATE" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).id||'')}catch{console.log('')}})")
[ -n "$TASK_ID" ] && check ok "POST /tasks crea la tarea (id: $TASK_ID)" || check fail "POST /tasks crea la tarea" "$CREATE"

if [ -n "$TASK_ID" ]; then
  echo "── 7. Detalle y persistencia ──"
  DETAIL=$(curl -s "$BASE/api/computer/tasks/$TASK_ID" -H "$AUTH")
  echo "$DETAIL" | grep -q '"messages"' && check ok "GET /tasks/:id devuelve mensajes persistidos" || check fail "GET /tasks/:id devuelve mensajes" "$DETAIL"
  echo "$DETAIL" | grep -q '"events"' && check ok "GET /tasks/:id devuelve eventos persistidos" || check fail "GET /tasks/:id devuelve eventos" "$DETAIL"

  echo "── 8. Stream SSE en vivo (5s) ──"
  SSE=$(timeout 5 curl -sN "$BASE/api/computer/tasks/$TASK_ID/events?token=$TOKEN" 2>/dev/null | head -c 2000)
  echo "$SSE" | grep -q 'data:' && check ok "El endpoint SSE emite eventos con formato data:" || check fail "El endpoint SSE emite eventos" "(vacío)"
  echo "$SSE" | grep -q '^id:' && check ok "El SSE incluye el campo id: para reanudación" || check fail "El SSE incluye campo id:" "(ausente)"

  echo "── 9. Detener la tarea ──"
  STOP=$(curl -s -X POST "$BASE/api/computer/tasks/$TASK_ID/stop" -H "$AUTH")
  echo "$STOP" | grep -q 'ok\|detenida\|status' && check ok "POST /stop responde correctamente" || check fail "POST /stop responde" "$STOP"
fi

echo ""
[ "$fallos" -eq 0 ] && echo "🎉 TODOS LOS TESTS DE API PASAN" || echo "⚠️  $fallos test(s) de API fallidos"
exit $([ "$fallos" -eq 0 ] && echo 0 || echo 1)
