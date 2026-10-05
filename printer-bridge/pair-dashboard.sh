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

controller_is_current(){
  local h
  h="$(health_json)"
  [[ "$h" == *'"ok":true'* && "$h" == *'"service":"farm-controller"'* ]]
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

grn "✓ Farm Controller correcto en 127.0.0.1:${PORT}"

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

PUBLIC_STATUS="$(curl -q --config "$AUTH_CFG" -sS -m 8 -X POST -o "$TMP/public-body" -w '%{http_code}' "$PUBLIC_BASE/farm/session" 2>/dev/null || true)"
if [[ "$PUBLIC_STATUS" == "200" || "$PUBLIC_STATUS" == "201" ]]; then
  grn "✓ Túnel público acepta la credencial"
else
  ylw "⚠ El túnel público no confirmó la sesión (HTTP ${PUBLIC_STATUS:-sin respuesta})."
  ylw "  El navegador se abrirá igual; si Máquinas sigue 0/14, el problema ya está entre Cloudflare Tunnel y el Controller."
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
