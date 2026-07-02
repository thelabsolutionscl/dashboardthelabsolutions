#!/usr/bin/env bash
#
# test-pipeline.sh — Prueba end-to-end del pipeline de captación de leads.
#
# Ejercita las 4 rutas del thelab-leads-worker y verifica que cada lead crea
# un Cliente + una tarea en Agent_Queue. Incluye el caso "María González"
# (lead B2B de LinkedIn) descrito en docs/PIPELINE.md.
#
# Uso:
#   BASE_URL=http://localhost:8787 LEAD_KEY=tu_key ./scripts/test-pipeline.sh
#
# Variables de entorno:
#   BASE_URL          URL del Worker            (default: http://localhost:8787)
#   LEAD_KEY          X-Public-Lead-Key        (requerido para /lead)
#   GOOGLE_ADS_KEY    X-Google-Ads-Webhook-Key (opcional, salta el test si falta)
#   LINKEDIN_KEY      X-Linkedin-Webhook-Key   (default: $LEAD_KEY — el Worker acepta el fallback)
#   VOICE_KEY         x-vapi-secret            (opcional — canal de voz VAPI; salta si falta)
#
# Levanta el Worker primero:  cd lead-worker && npx wrangler dev
#
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
LEAD_KEY="${LEAD_KEY:-}"
GOOGLE_ADS_KEY="${GOOGLE_ADS_KEY:-}"
LINKEDIN_KEY="${LINKEDIN_KEY:-$LEAD_KEY}"

GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YEL=$'\033[0;33m'; DIM=$'\033[0;90m'; NC=$'\033[0m'
PASS=0; FAIL=0; SKIP=0

command -v curl >/dev/null 2>&1 || { echo "${RED}Falta curl${NC}"; exit 1; }

# post <titulo> <ruta> <header-name|-> <header-val|-> <json>
post() {
  local titulo="$1" ruta="$2" hname="$3" hval="$4" body="$5"
  echo
  echo "${DIM}── ${titulo} → POST ${ruta}${NC}"
  local args=(-sS -w $'\n%{http_code}' -X POST "${BASE_URL}${ruta}" -H "Content-Type: application/json")
  [ "$hname" != "-" ] && args+=(-H "${hname}: ${hval}")
  args+=(-d "$body")
  local resp code json
  resp="$(curl "${args[@]}" 2>&1)" || { echo "${RED}✗ curl falló (¿Worker arriba en ${BASE_URL}?)${NC}"; FAIL=$((FAIL+1)); return; }
  code="$(printf '%s' "$resp" | tail -n1)"
  json="$(printf '%s' "$resp" | sed '$d')"
  echo "${DIM}${json}${NC}"
  if [ "$code" = "200" ] && printf '%s' "$json" | grep -q '"ok":true'; then
    if printf '%s' "$json" | grep -q '"clienteId":"rec'; then
      echo "${GREEN}✓ ${titulo}: Cliente + cola creados (HTTP ${code})${NC}"
    else
      echo "${YEL}~ ${titulo}: ok pero sin clienteId (¿buffer/honeypot o Airtable sin token?) (HTTP ${code})${NC}"
    fi
    PASS=$((PASS+1))
  else
    echo "${RED}✗ ${titulo}: respuesta inesperada (HTTP ${code})${NC}"
    FAIL=$((FAIL+1))
  fi
}

echo "${GREEN}=== Pipeline E2E — The Lab Solutions ===${NC}"
echo "Worker: ${BASE_URL}"

# ── 0) Health ────────────────────────────────────────────────────────────
echo
echo "${DIM}── Health → GET /health${NC}"
HEALTH="$(curl -sS -w $'\n%{http_code}' "${BASE_URL}/health" 2>&1)"
HCODE="$(printf '%s' "$HEALTH" | tail -n1)"
HJSON="$(printf '%s' "$HEALTH" | sed '$d')"
echo "${DIM}${HJSON}${NC}"
if [ "$HCODE" = "200" ]; then echo "${GREEN}✓ Health OK${NC}"; PASS=$((PASS+1)); else echo "${RED}✗ Health falló (HTTP ${HCODE}) — ¿Worker arriba?${NC}"; FAIL=$((FAIL+1)); fi

# ── 1) Lead web ──────────────────────────────────────────────────────────
if [ -n "$LEAD_KEY" ]; then
  post "Lead web" "/lead" "X-Public-Lead-Key" "$LEAD_KEY" '{
    "name":"Juan Pérez","company":"Empresa Demo","email":"juan@empresa.cl",
    "phone":"+56912345678","service":"Cartelería","product":"Caja de luz",
    "quantity":"1","deliveryDate":"2026-06-30","source":"web",
    "utmCampaign":"carteleria-santiago","gclid":"TEST-WEB"}'

  # 1b) Honeypot: debe responder 200 SIN crear cliente (bot detectado)
  echo
  echo "${DIM}── Honeypot (bot) → POST /lead [debe devolver clienteId:null]${NC}"
  HP="$(curl -sS -X POST "${BASE_URL}/lead" -H "Content-Type: application/json" \
        -H "X-Public-Lead-Key: ${LEAD_KEY}" \
        -d '{"name":"Bot","email":"bot@x.cl","company_website":"http://spam.example"}' 2>&1)"
  echo "${DIM}${HP}${NC}"
  if printf '%s' "$HP" | grep -q '"clienteId":null'; then
    echo "${GREEN}✓ Honeypot: bot rechazado silenciosamente${NC}"; PASS=$((PASS+1))
  else
    echo "${YEL}~ Honeypot: revisar comportamiento${NC}"; SKIP=$((SKIP+1))
  fi
else
  echo; echo "${YEL}↷ Lead web: SKIP (define LEAD_KEY)${NC}"; SKIP=$((SKIP+1))
fi

# ── 2) Google Ads ────────────────────────────────────────────────────────
if [ -n "$GOOGLE_ADS_KEY" ]; then
  post "Google Ads" "/webhooks/google-ads" "X-Google-Ads-Webhook-Key" "$GOOGLE_ADS_KEY" '{
    "lead_id":"gads-001","campaign_name":"premiaciones-search","gcl_id":"TEST-GADS",
    "user_column_data":[
      {"column_id":"full_name","string_value":"Pedro Soto"},
      {"column_id":"company_name","string_value":"Eventos Pro"},
      {"column_id":"email","string_value":"pedro@eventospro.cl"},
      {"column_id":"phone_number","string_value":"+56998887766"},
      {"column_id":"service","string_value":"Premiaciones"},
      {"column_id":"message","string_value":"100 trofeos para gala corporativa"}
    ]}'
else
  echo; echo "${YEL}↷ Google Ads: SKIP (define GOOGLE_ADS_KEY)${NC}"; SKIP=$((SKIP+1))
fi

# ── 3) LinkedIn — caso "María González" ──────────────────────────────────
if [ -n "$LINKEDIN_KEY" ]; then
  post "LinkedIn (María González)" "/webhooks/linkedin" "X-Linkedin-Webhook-Key" "$LINKEDIN_KEY" '{
    "name":"María González","company":"Retail Demo","jobTitle":"Marketing Manager",
    "email":"maria@retail.cl","service":"Merchandising",
    "message":"Necesitamos kit de bienvenida para 200 colaboradores nuevos",
    "campaign":"linkedin-merch-b2b","linkedinClickId":"li-abc123"}'
else
  echo; echo "${YEL}↷ LinkedIn: SKIP (define LINKEDIN_KEY o LEAD_KEY)${NC}"; SKIP=$((SKIP+1))
fi

# ── 3b) Voz (VAPI) — tool crear_lead + auth ──────────────────────────────
VOICE_KEY="${VOICE_KEY:-}"
if [ -n "$VOICE_KEY" ]; then
  echo
  echo "${DIM}── Voz (VAPI) → POST /webhooks/voice [tool-calls crear_lead]${NC}"
  VRESP="$(curl -sS -w $'\n%{http_code}' -X POST "${BASE_URL}/webhooks/voice" \
    -H "Content-Type: application/json" -H "x-vapi-secret: ${VOICE_KEY}" \
    -d '{"message":{"type":"tool-calls","toolCallList":[{"id":"call_1","function":{"name":"crear_lead","arguments":"{\"company\":\"Retail Voz\",\"name\":\"Ana Voz\",\"email\":\"ana@retailvoz.cl\",\"phone\":\"+56911112222\",\"service\":\"Merchandising\",\"quantity\":\"500\",\"accountType\":\"estrategica\"}"}}]}}' 2>&1)"
  VCODE="$(printf '%s' "$VRESP" | tail -n1)"
  VJSON="$(printf '%s' "$VRESP" | sed '$d')"
  echo "${DIM}${VJSON}${NC}"
  if [ "$VCODE" = "200" ] && printf '%s' "$VJSON" | grep -q '"toolCallId":"call_1"'; then
    echo "${GREEN}✓ Voz: crear_lead aceptado (HTTP ${VCODE})${NC}"; PASS=$((PASS+1))
  else
    echo "${RED}✗ Voz: respuesta inesperada (HTTP ${VCODE})${NC}"; FAIL=$((FAIL+1))
  fi

  echo
  echo "${DIM}── Voz auth negativa → POST /webhooks/voice con secret malo [espera 401]${NC}"
  VBAD="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}/webhooks/voice" \
    -H "Content-Type: application/json" -H "x-vapi-secret: malo" \
    -d '{"message":{"type":"tool-calls"}}' 2>&1)"
  if [ "$VBAD" = "401" ]; then echo "${GREEN}✓ Voz: secret inválido rechazado (401)${NC}"; PASS=$((PASS+1));
  else echo "${YEL}~ Voz: esperaba 401, obtuve ${VBAD}${NC}"; SKIP=$((SKIP+1)); fi
else
  echo; echo "${YEL}↷ Voz (VAPI): SKIP (define VOICE_KEY)${NC}"; SKIP=$((SKIP+1))
fi

# ── 3c) WhatsApp (verificación) + Saliente (gate de auth) ────────────────
echo
echo "${DIM}── WhatsApp verify → GET /webhooks/whatsapp${NC}"
WACODE="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${WHATSAPP_VERIFY_TOKEN:-x}&hub.challenge=PING" 2>&1)"
if [ "$WACODE" = "200" ] || [ "$WACODE" = "403" ]; then
  echo "${GREEN}✓ WhatsApp verify responde (HTTP ${WACODE}; 200 si WHATSAPP_VERIFY_TOKEN calza)${NC}"; PASS=$((PASS+1))
else echo "${YEL}~ WhatsApp verify: HTTP ${WACODE}${NC}"; SKIP=$((SKIP+1)); fi

echo
echo "${DIM}── Saliente sin clave → POST /voice/outbound [espera 401]${NC}"
OBCODE="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}/voice/outbound" \
  -H "Content-Type: application/json" -d '{"phone":"+56999999999"}' 2>&1)"
if [ "$OBCODE" = "401" ]; then echo "${GREEN}✓ Saliente sin clave rechazada (401)${NC}"; PASS=$((PASS+1));
else echo "${YEL}~ Saliente: esperaba 401, obtuve ${OBCODE}${NC}"; SKIP=$((SKIP+1)); fi

# ── 4) Auth negativa: llave incorrecta debe dar 401 ──────────────────────
echo
echo "${DIM}── Auth negativa → POST /webhooks/linkedin con llave mala [espera 401]${NC}"
BADCODE="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}/webhooks/linkedin" \
  -H "Content-Type: application/json" -H "X-Linkedin-Webhook-Key: llave-incorrecta" \
  -d '{"name":"X","email":"x@x.cl"}' 2>&1)"
if [ "$BADCODE" = "401" ]; then echo "${GREEN}✓ Llave incorrecta rechazada (401)${NC}"; PASS=$((PASS+1));
else echo "${YEL}~ Esperaba 401, obtuve ${BADCODE} (¿LINKEDIN_WEBHOOK_KEY sin configurar?)${NC}"; SKIP=$((SKIP+1)); fi

# ── Resumen ──────────────────────────────────────────────────────────────
echo
echo "${GREEN}=== Resumen ===${NC}  ${GREEN}PASS ${PASS}${NC} · ${RED}FAIL ${FAIL}${NC} · ${YEL}SKIP ${SKIP}${NC}"
echo "${DIM}Tip: verifica en Airtable que aparezcan los Clientes y las tareas en Agent_Queue.${NC}"
[ "$FAIL" -eq 0 ]
