#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "Falta Node.js >=18" >&2; exit 1; }

if [ "$(uname -s)" = "Darwin" ]; then
  DATA="$HOME/Library/Application Support/TheLabFarm"
  mkdir -p "$DATA"
  chmod 700 "$DATA"
  PLIST="$HOME/Library/LaunchAgents/com.thelab.farm-controller.plist"
  sed -e "s|__NODE__|$NODE|g" -e "s|__REPO__|$REPO|g" -e "s|__DATA__|$DATA|g" \
    "$HERE/com.thelab.farm-controller.plist" > "$PLIST"
  launchctl bootout "gui/$(id -u)/com.thelab.printer-bridge" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)/com.thelab.farm-controller" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  launchctl kickstart -k "gui/$(id -u)/com.thelab.farm-controller"
  echo "Farm Controller instalado en macOS. Datos: $DATA"
  echo "El launchd antiguo printer-bridge quedó detenido: el controller ahora lo ejecuta internamente."
  exit 0
fi

echo "Instalación Linux: ejecuta como root los pasos de docs/FARM_CONTROLLER.md"
echo "Servicio de referencia: $HERE/farm-controller.service"
