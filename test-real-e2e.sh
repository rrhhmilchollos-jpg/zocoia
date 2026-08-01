#!/usr/bin/env bash
# Prueba de humo con el modelo real: crea una tarea que obliga a usar varias
# herramientas (plan, terminal, escritura y entrega) y sigue el SSE hasta que
# el bucle termina. Sirve para confirmar que el Ordenador funciona de verdad,
# no solo que el contrato HTTP responde.
set -uo pipefail
BASE="${BASE:-http://localhost:8080}"
EMAIL="${ADMIN_EMAIL:-admin@zocoia.es}"
PASS="${ADMIN_PASSWORD:-TestLocal123!}"
MODEL="${MODEL:-zoco-flash}"

TOKEN=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).token||'')}catch{console.log('')}})")
[ -z "$TOKEN" ] && { echo "❌ Sin login no se puede probar."; exit 1; }
echo "✅ Autenticado"

PROMPT='Calcula cuantos segundos hay en 3 dias usando la terminal, guarda el resultado en segundos.txt y entregame ese archivo.'
CREATE=$(curl -s -X POST "$BASE/api/computer/tasks" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"prompt\":\"$PROMPT\",\"model\":\"$MODEL\"}")
TASK_ID=$(echo "$CREATE" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).id||'')}catch{console.log('')}})")
[ -z "$TASK_ID" ] && { echo "❌ No se creó la tarea: $CREATE"; exit 1; }
echo "✅ Tarea creada: $TASK_ID"
echo "── Siguiendo el stream (máx 150s) ──"

timeout 150 curl -sN "$BASE/api/computer/tasks/$TASK_ID/events?token=$TOKEN" \
  | while IFS= read -r line; do
      case "$line" in
        "event: "*) printf '  ▸ %s' "${line#event: }" ;;
        "data: "*)  echo "$line" | head -c 260 | sed 's/^data: / → /' ;;
        "") echo "" ;;
      esac
      case "$line" in *'"type":"finished"'*|*'"type":"error"'*) sleep 1; break ;; esac
    done

echo ""
echo "── Estado final ──"
curl -s "$BASE/api/computer/tasks/$TASK_ID" -H "Authorization: Bearer $TOKEN" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
      const t=JSON.parse(d);
      console.log('estado:', t.status);
      console.log('herramientas usadas:', (t.events||[]).filter(e=>e.type==='tool_call').map(e=>e.herramienta).join(', ')||'(ninguna)');
      console.log('resultado:', (t.result||'(vacío)').slice(0,400));
    })"
echo ""
echo "── Archivos del workspace ──"
ls -la "/home/ubuntu/zocoia/data/workspaces/$TASK_ID" 2>/dev/null || \
  find /home/ubuntu/zocoia/data -name 'segundos.txt' 2>/dev/null | head -5
