#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
LABEL="com.thelab.farm-controller"
OLD_LABEL="com.thelab.printer-bridge"
UID_GUI="gui/$(id -u)"
NODE="$(command -v node || true)"
PORT="${BRIDGE_PORT:-8347}"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
grn() { printf '\033[32m%s\033[0m\n' "$*"; }
ylw() { printf '\033[33m%s\033[0m\n' "$*"; }

[[ -n "$NODE" && -x "$NODE" ]] || { red "✗ Falta Node.js >=18"; exit 1; }
[[ -f "$HERE/farm-controller.js" ]] || { red "✗ Falta $HERE/farm-controller.js"; exit 1; }
[[ -f "$HERE/server.js" ]] || { red "✗ Falta $HERE/server.js"; exit 1; }

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Instalación Linux: sigue docs/FARM_CONTROLLER.md"
  echo "Servicio de referencia: $HERE/farm-controller.service"
  exit 0
fi

DATA="$HOME/Library/Application Support/TheLabFarm"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
OLD_PLIST="$HOME/Library/LaunchAgents/$OLD_LABEL.plist"
TEMPLATE="$HERE/com.thelab.farm-controller.plist"
mkdir -p "$DATA" "$HOME/Library/LaunchAgents"
chmod 700 "$DATA"

[[ -f "$TEMPLATE" ]] || { red "✗ Falta $TEMPLATE"; exit 1; }

old_was_loaded=0
if launchctl print "$UID_GUI/$OLD_LABEL" >/dev/null 2>&1; then
  old_was_loaded=1
fi

rollback() {
  red "✗ Farm Controller no quedó saludable. Restaurando el bridge anterior..."
  launchctl bootout "$UID_GUI/$LABEL" 2>/dev/null || true
  if [[ "$old_was_loaded" == "1" && -f "$OLD_PLIST" ]]; then
    launchctl bootout "$UID_GUI/$OLD_LABEL" 2>/dev/null || true
    if launchctl bootstrap "$UID_GUI" "$OLD_PLIST" 2>/dev/null; then
      launchctl kickstart -k "$UID_GUI/$OLD_LABEL" 2>/dev/null || true
    else
      launchctl load -w "$OLD_PLIST" 2>/dev/null || true
    fi
    ylw "↩ Bridge anterior restaurado."
  else
    ylw "↩ No había un bridge anterior cargado que restaurar."
  fi
  ylw "Logs del controller: $DATA/farm-controller.err"
}
trap 'rollback' ERR

sed \
  -e "s|__NODE__|$NODE|g" \
  -e "s|__REPO__|$REPO|g" \
  -e "s|__DATA__|$DATA|g" \
  "$TEMPLATE" > "$PLIST"
chmod 600 "$PLIST"

ylw "→ Node: $NODE ($("$NODE" -v))"
ylw "→ Datos persistentes: $DATA"

# El controller ocupa el puerto público y ejecuta server.js internamente en localhost:8348.
# Por eso el launchd antiguo debe detenerse antes del corte.
launchctl bootout "$UID_GUI/$OLD_LABEL" 2>/dev/null || true
launchctl unload "$OLD_PLIST" 2>/dev/null || true
launchctl bootout "$UID_GUI/$LABEL" 2>/dev/null || true

launchctl bootstrap "$UID_GUI" "$PLIST"
launchctl kickstart -k "$UID_GUI/$LABEL"

ok=""
for _ in $(seq 1 12); do
  if curl -fsS -m 2 "http://127.0.0.1:$PORT/healthz" | grep -q '"ok":true'; then
    ok=1
    break
  fi
  sleep 1
done

[[ -n "$ok" ]] || false
trap - ERR

grn "✓ Farm Controller activo en http://127.0.0.1:$PORT/healthz"
grn "✓ El bridge legado ahora corre sólo detrás del controller en localhost:8348"
if [[ "$old_was_loaded" == "1" ]]; then
  grn "✓ El servicio antiguo quedó detenido, pero su plist se conserva para rollback"
fi

echo
ylw "Pruebas recomendadas antes de tocar Cloudflare Tunnel:"
echo "  curl -s http://127.0.0.1:$PORT/healthz"
echo "  curl -s 'http://127.0.0.1:$PORT/authcheck?bt=TU_TOKEN'"
echo
ylw "Rollback manual: $HERE/rollback-farm-controller.sh"
ylw "Guía completa: $REPO/docs/FARM_CONTROLLER.md"
