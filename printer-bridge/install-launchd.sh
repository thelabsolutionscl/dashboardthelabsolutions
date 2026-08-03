#!/usr/bin/env bash
# The Lab Solutions — instalador del Printer Bridge seguro para macOS.
set -euo pipefail

LABEL="com.thelab.printer-bridge"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_JS="$SCRIPT_DIR/secure-launcher.js"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT="${BRIDGE_PORT:-8347}"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
grn() { printf '\033[32m%s\033[0m\n' "$*"; }
ylw() { printf '\033[33m%s\033[0m\n' "$*"; }
unload() { launchctl unload "$PLIST" 2>/dev/null || true; }

if [[ "${1:-}" == "--uninstall" ]]; then
  unload
  rm -f "$PLIST"
  grn "✅ Autoarranque desinstalado ($LABEL)."
  exit 0
fi

[[ -f "$SERVER_JS" ]] || { red "✗ No encuentro secure-launcher.js en $SCRIPT_DIR"; exit 1; }
[[ -f "$SCRIPT_DIR/server.js" ]] || { red "✗ No encuentro server.js, requerido como bridge interno"; exit 1; }

if [[ ! -f "$SCRIPT_DIR/printers.json" && -z "${BRIDGE_PRINTERS:-}" ]]; then
  red "✗ Falta la allowlist exacta de impresoras."
  echo "  Copia printers.example.json a printers.json y reemplaza las IP de ejemplo:"
  echo "  cp '$SCRIPT_DIR/printers.example.json' '$SCRIPT_DIR/printers.json'"
  exit 1
fi

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do
    [[ -x "$candidate" ]] && NODE_BIN="$candidate"
  done
fi
[[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || { red "✗ No encuentro Node.js ≥18."; exit 1; }

NODE_MAJOR="$($NODE_BIN -p 'Number(process.versions.node.split(".")[0])')"
[[ "$NODE_MAJOR" -ge 18 ]] || { red "✗ Node.js 18 o superior requerido; actual: $($NODE_BIN -v)"; exit 1; }

# Comprobar sintaxis antes de reemplazar el proceso activo.
"$NODE_BIN" --check "$SERVER_JS"
"$NODE_BIN" --check "$SCRIPT_DIR/server.js"
ylw "→ Node: $NODE_BIN ($($NODE_BIN -v))"
ylw "→ Gateway: $SERVER_JS"

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
  <key>EnvironmentVariables</key>
  <dict>
    <key>BRIDGE_HOST</key>
    <string>127.0.0.1</string>
    <key>BRIDGE_PORT</key>
    <string>$PORT</string>
    <key>BRIDGE_ALLOW_ORIGINS</key>
    <string>${BRIDGE_ALLOW_ORIGINS:-https://dashboard.thelab.solutions,https://thelabsolutionscl.github.io}</string>
    <key>BRIDGE_ADMIN_EMAILS</key>
    <string>${BRIDGE_ADMIN_EMAILS:-}</string>
    <key>BRIDGE_WRITE_EMAILS</key>
    <string>${BRIDGE_WRITE_EMAILS:-}</string>
    <key>BRIDGE_ALLOW_LEGACY_TOKEN</key>
    <string>false</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>/tmp/printer-bridge.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/printer-bridge.err</string>
</dict>
</plist>
PLIST
chmod 600 "$PLIST"
grn "✓ Escrito $PLIST"

unload
launchctl load -w "$PLIST"
grn "✓ Bridge seguro cargado en launchd"

ok=""
for _ in $(seq 1 15); do
  if curl -fsS -m 2 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done

echo
if [[ -n "$ok" ]]; then
  grn "✅ Gateway activo en http://127.0.0.1:$PORT/healthz"
else
  red "⚠ El gateway no respondió."
  ylw "  Revisa: tail -n 80 /tmp/printer-bridge.err /tmp/printer-bridge.log"
  exit 1
fi

# Los tokens locales son para diagnóstico desde el iMac. No se pegan en el HTML.
if [[ -f "$SCRIPT_DIR/.bridge-read-token" ]]; then
  echo; ylw "Token local de solo lectura (guardar en un gestor de contraseñas):"
  grn "  $(cat "$SCRIPT_DIR/.bridge-read-token")"
fi
if [[ -f "$SCRIPT_DIR/.bridge-admin-token" ]]; then
  echo; ylw "Token local administrativo (no compartir con el navegador):"
  grn "  $(cat "$SCRIPT_DIR/.bridge-admin-token")"
fi

echo
ylw "Siguiente paso obligatorio: proteger printers.thelab.solutions con Cloudflare Access."
echo "Comandos:"
echo "  Estado:    launchctl list | grep printer-bridge"
echo "  Logs:      tail -f /tmp/printer-bridge.log /tmp/printer-bridge.err"
echo "  Reiniciar: launchctl unload '$PLIST' && launchctl load -w '$PLIST'"
echo "  Quitar:    ./install-launchd.sh --uninstall"
