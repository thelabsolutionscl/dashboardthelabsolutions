#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# The Lab Solutions — Instalador de autoarranque del Printer Bridge (macOS)
#
# Deja el bridge corriendo siempre: arranca al encender el iMac y se reinicia
# solo si se cae (launchd / LaunchAgent). Es idempotente: puedes volver a
# correrlo cuando quieras (p. ej. tras actualizar Node con nvm) y se reconfigura.
#
#   cd ~/dashboardthelabsolutions/printer-bridge
#   ./install-launchd.sh
#
# Para desinstalarlo:  ./install-launchd.sh --uninstall
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

LABEL="com.thelab.printer-bridge"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_JS="$SCRIPT_DIR/server.js"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT="${BRIDGE_PORT:-8347}"

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
ylw()  { printf '\033[33m%s\033[0m\n' "$*"; }

unload() { launchctl unload "$PLIST" 2>/dev/null || true; }

if [[ "${1:-}" == "--uninstall" ]]; then
  unload
  rm -f "$PLIST"
  grn "✅ Autoarranque desinstalado ($LABEL). El bridge ya no arrancará solo."
  exit 0
fi

# 1) Comprobaciones
[[ -f "$SERVER_JS" ]] || { red "✗ No encuentro server.js en $SCRIPT_DIR"; exit 1; }

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do
    [[ -x "$c" ]] && NODE_BIN="$c"
  done
fi
[[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || {
  red "✗ No encuentro Node. Instálalo (brew install node) o carga nvm y reintenta."
  exit 1
}
ylw "→ Node:      $NODE_BIN ($("$NODE_BIN" -v))"
ylw "→ server.js: $SERVER_JS"

# 2) Generar el plist con las rutas reales de este equipo
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$SERVER_JS</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$SCRIPT_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>/tmp/printer-bridge.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/printer-bridge.err</string>
</dict>
</plist>
PLIST
grn "✓ Escrito $PLIST"

# 3) (Re)cargar en launchd
unload
launchctl load -w "$PLIST"
grn "✓ Cargado en launchd (arrancará solo al encender el iMac)"

# 4) Verificar que responde
ok=""
for _ in $(seq 1 10); do
  if curl -fsS -m 2 "http://localhost:$PORT/healthz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done

echo
if [[ -n "$ok" ]]; then
  grn "✅ Bridge ACTIVO y respondiendo en http://localhost:$PORT/healthz"
else
  red "⚠ El bridge no respondió en localhost:$PORT todavía."
  ylw "  Revisa los logs:  tail -n 40 /tmp/printer-bridge.err /tmp/printer-bridge.log"
fi

# 5) Mostrar el token para pegarlo en el dashboard
if [[ -n "${BRIDGE_TOKEN:-}" ]]; then
  echo; ylw "Token (fijo por BRIDGE_TOKEN): $BRIDGE_TOKEN"
elif [[ -f "$SCRIPT_DIR/.bridge-token" ]]; then
  echo; ylw "Token del bridge (pégalo en el dashboard → Mi cuenta → Túnel Impresoras):"
  grn "  $(cat "$SCRIPT_DIR/.bridge-token")"
fi
echo
ylw "Comandos útiles:"
echo "  Estado:      launchctl list | grep printer-bridge"
echo "  Reiniciar:   launchctl unload \"$PLIST\" && launchctl load -w \"$PLIST\""
echo "  Quitar auto: ./install-launchd.sh --uninstall"
