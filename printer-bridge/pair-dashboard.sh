#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${BRIDGE_PORT:-8347}"
BASE="http://127.0.0.1:${PORT}"
HEALTH_URL="${BASE}/healthz"
PAIR_URL="${BASE}/farm/local-pair"
PUBLIC_BASE="${PRINTER_PUBLIC_URL:-https://printers.thelab.solutions}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/tls-pair.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
HEADERS="$TMP/headers"
BODY="$TMP/body"
AUTH_CFG="$TMP/curl-auth"

red(){ printf '\033[31m%s\033[0m\n' "$*" >&2; }
grn(){ printf '\033[32m%s\033[0m\n' "$*"; }
ylw(){ printf '\033[33m%s\033[0m\n' "$*"; }

health_json(){
  curl -q -fsS -m 4 "$HEALTH_URL" 2>/dev/null || true
}

repo_revision(){
  git -C "$HERE/.." rev-parse --short=12 HEAD 2>/dev/null || true
}

controller_revision(){
  printf '%s' "$1" | sed -n 's/.*"revision":"\([^"]*\)".*/\1/p'
}

controller_is_current(){
  local h want got
  h="$(health_json)"
  [[ "$h" == *'"ok":true'* && "$h" == *'"service":"farm-controller"'* ]] || return 1
  want="$(repo_revision)"
  got="$(controller_revision "$h")"
  # Si tenemos un repo Git local, exigir que el proceso cargado corresponda al
  # mismo commit. Un Controller anterior a esta comprobación no anuncia revision
  # y por eso se reinstala/reinicia una sola vez.
  [[ -z "$want" || "$got" == "$want" ]]
}

repair_controller(){
  if [[ "$(uname -s)" != "Darwin" ]]; then
    red "✗ 127.0.0.1:${PORT} no está ejecutando el Farm Controller esperado."
    red "  En este equipo debes iniciar/reinstalar printer-bridge/farm-controller.js manualmente."
    return 1
  fi
  if [[ ! -f "$HERE/install-farm-controller.sh" ]]; then
    red "✗ Falta $HERE/install-farm-controller.sh"
    return 1
  fi
  ylw "→ Reparando/reiniciando Farm Controller de macOS…"
  bash "$HERE/install-farm-controller.sh"
}

issue_pair(){
  : >"$HEADERS"
  : >"$BODY"
  PAIR_STATUS="$(curl -q -sS -m 6 --max-redirs 0 -D "$HEADERS" -o "$BODY" -w '%{http_code}' "$PAIR_URL" 2>/dev/null || true)"
  LOCATION="$(tr -d '\r' <"$HEADERS" | sed -n 's/^Location:[[:space:]]*//p' | tail -n 1)"
  [[ "$PAIR_STATUS" == "302" && "$LOCATION" == https://dashboard.thelab.solutions/#printer_pair=* ]]
}

if ! controller_is_current; then
  ylw "→ El puerto ${PORT} no corresponde al Farm Controller nuevo; intentando reparación local."
  repair_controller || exit 1
fi

if ! controller_is_current; then
  red "✗ El Farm Controller sigue sin responder correctamente en $HEALTH_URL"
  red "  Revisa: ~/Library/Application Support/TheLabFarm/farm-controller.err"
  exit 1
fi

RUNNING_REV="$(controller_revision "$(health_json)")"
grn "✓ Farm Controller correcto en 127.0.0.1:${PORT}${RUNNING_REV:+ · revisión $RUNNING_REV}"

PAIR_STATUS=""
LOCATION=""
if ! issue_pair; then
  ylw "→ /farm/local-pair no respondió como esperaba (HTTP ${PAIR_STATUS:-sin respuesta})."
  ylw "→ Reiniciando el Controller para cargar el código del repositorio actual…"
  repair_controller || exit 1
  sleep 2
  if ! controller_is_current || ! issue_pair; then
    red "✗ No se pudo crear el emparejamiento local (HTTP ${PAIR_STATUS:-sin respuesta})."
    if [[ -s "$BODY" ]]; then
      red "  Respuesta: $(tr '\n' ' ' <"$BODY" | cut -c1-300)"
    fi
    red "  Logs: ~/Library/Application Support/TheLabFarm/farm-controller.err"
    exit 1
  fi
fi

PAIR_TOKEN="${LOCATION#*#printer_pair=}"
if [[ ! "$PAIR_TOKEN" =~ ^[A-Za-z0-9_-]{32,200}$ ]]; then
  red "✗ El Controller devolvió una credencial de emparejamiento inválida."
  exit 1
fi

chmod 700 "$TMP"
printf 'header = "X-Bridge-Token: %s"\n' "$PAIR_TOKEN" >"$AUTH_CFG"
chmod 600 "$AUTH_CFG"

SESSION_JSON="$(curl -q --config "$AUTH_CFG" -fsS -m 5 -X POST "$BASE/farm/session" 2>/dev/null || true)"
if [[ "$SESSION_JSON" != *'"ok":true'* || "$SESSION_JSON" != *'"role":"admin"'* ]]; then
  red "✗ La credencial fue emitida, pero el Controller no la acepta."
  exit 1
fi
grn "✓ Credencial local validada por el Farm Controller"

# Probar la cadena que realmente alimenta “Telemetría reciente”: Controller →
# registry → Moonraker. /farm/session por sí solo sólo prueba autenticación.
FLEET_JSON="$(curl -q --config "$AUTH_CFG" -fsS -m 20 -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/farm/health/probe" 2>/dev/null || true)"
FLEET_INFO="$(printf '%s' "$FLEET_JSON" | node -e '
let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{
  try{
    const d=JSON.parse(s),h=d.health||{},m=Array.isArray(h.machines)?h.machines:[],sum=h.summary||{};
    const first=m.find(x=>x&&x.online&&x.ip)||m.find(x=>x&&x.ip)||{};
    process.stdout.write([Number(sum.online||0),Number(sum.total||m.length||0),String(first.ip||"")].join("|"));
  }catch(_){}
});' 2>/dev/null || true)"
IFS='|' read -r FLEET_ONLINE FLEET_TOTAL FIRST_IP <<<"$FLEET_INFO"
if [[ -n "${FLEET_TOTAL:-}" ]]; then
  if [[ "${FLEET_ONLINE:-0}" -gt 0 ]]; then
    grn "✓ Controller llega a Moonraker: ${FLEET_ONLINE}/${FLEET_TOTAL} impresoras responden desde el iMac"
  else
    ylw "⚠ Controller llega a 0/${FLEET_TOTAL} impresoras por Moonraker."
    ylw "  El problema está en IPs/red local/Moonraker, no en el navegador ni en Cloudflare."
  fi
else
  ylw "⚠ No se pudo obtener el diagnóstico central de la granja."
fi

PUBLIC_STATUS="$(curl -q --config "$AUTH_CFG" -sS -m 8 -X POST -o "$TMP/public-body" -w '%{http_code}' "$PUBLIC_BASE/farm/session" 2>/dev/null || true)"
if [[ "$PUBLIC_STATUS" == "200" || "$PUBLIC_STATUS" == "201" ]]; then
  grn "✓ Túnel público acepta la credencial"
else
  ylw "⚠ El túnel público no confirmó la sesión (HTTP ${PUBLIC_STATUS:-sin respuesta})."
  ylw "  El navegador se abrirá igual; si Máquinas sigue 0/14, el problema ya está entre Cloudflare Tunnel y el Controller."
fi

# Probar además la MISMA query Moonraker que usa el dashboard. Esto detecta
# regresiones donde /farm/session funciona pero /IP/printer/objects/query no.
if [[ -n "${FIRST_IP:-}" ]]; then
  PUBLIC_TELEMETRY_STATUS="$(curl -q --config "$AUTH_CFG" -sS -m 10 -o "$TMP/public-telemetry" -w '%{http_code}' "$PUBLIC_BASE/$FIRST_IP/printer/objects/query?print_stats&extruder&webhooks" 2>/dev/null || true)"
  if [[ "$PUBLIC_TELEMETRY_STATUS" == "200" ]] && grep -q '"result"' "$TMP/public-telemetry" 2>/dev/null; then
    grn "✓ Telemetría extremo a extremo confirmada por el túnel (${FIRST_IP})"
  else
    ylw "⚠ La sesión funciona, pero la consulta Moonraker real falló por el túnel (HTTP ${PUBLIC_TELEMETRY_STATUS:-sin respuesta})."
    if [[ -s "$TMP/public-telemetry" ]]; then
      ylw "  Respuesta: $(tr '\\n' ' ' <"$TMP/public-telemetry" | cut -c1-240)"
    fi
  fi
fi

case "$(uname -s)" in
  Darwin)
    open "$LOCATION"
    ;;
  Linux)
    if command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$LOCATION"
    else
      echo "Abre en este equipo: $LOCATION"
    fi
    ;;
  *)
    echo "Abre en este equipo: $LOCATION"
    ;;
esac

grn "✓ Emparejamiento iniciado. El dashboard recibió la credencial por fragmento local y la URL se limpiará al cargar."
