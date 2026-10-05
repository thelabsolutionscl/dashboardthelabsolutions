#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
LABEL="com.thelab.farm-controller"
OLD_LABEL="com.thelab.printer-bridge"
UID_GUI="gui/$(id -u)"
NODE="$(command -v node || true)"
PORT="${BRIDGE_PORT:-8347}"
INTERNAL_PORT="${LEGACY_BRIDGE_PORT:-8348}"
FALLBACK_PID="$HOME/Library/Application Support/TheLabFarm/farm-controller.pid"
FALLBACK_STARTED=0

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

stop_direct_fallback() {
  local pid=""
  [[ -f "$FALLBACK_PID" ]] && pid="$(cat "$FALLBACK_PID" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 10); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.2
    done
  fi
  rm -f "$FALLBACK_PID"
}


cleanup_stale_internal_bridge() {
  local lsof_bin="" pids="" pid="" cmd=""
  for candidate in /usr/sbin/lsof /usr/bin/lsof "$(command -v lsof 2>/dev/null || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then lsof_bin="$candidate"; break; fi
  done
  [[ -n "$lsof_bin" ]] || return 0
  pids="$("$lsof_bin" -nP -tiTCP:"$INTERNAL_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -n "$pids" ]] || return 0
  for pid in $pids; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$cmd" == *"$HERE/server.js"* ]]; then
      ylw "→ Eliminando bridge interno huérfano en :$INTERNAL_PORT (PID $pid)…"
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 15); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.2
      done
      if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid" 2>/dev/null || true; fi
    else
      red "✗ El puerto interno $INTERNAL_PORT está ocupado por otro proceso: $cmd"
      red "  No lo cerraré automáticamente porque no corresponde a printer-bridge/server.js."
      return 1
    fi
  done
}

start_direct_fallback() {
  ylw "→ launchd sigue rechazando el servicio; iniciando Farm Controller directo en segundo plano…"
  stop_direct_fallback
  (
    export BRIDGE_ALLOW_ORIGIN="https://dashboard.thelab.solutions"
    export FARM_DATA_DIR="$DATA"
    export BRIDGE_REPO_DIR="$REPO"
    nohup "$NODE"       -r "$HERE/farm-production-preload.js"       -r "$HERE/farm-drift-preload.js"       -r "$HERE/farm-health-preload.js"       "$HERE/farm-controller.js"       >>"$DATA/farm-controller.log" 2>>"$DATA/farm-controller.err" </dev/null &
    echo $! >"$FALLBACK_PID"
  )
  chmod 600 "$FALLBACK_PID"
  FALLBACK_STARTED=1
}

rollback() {
  red "✗ Farm Controller no quedó saludable. Restaurando el bridge anterior..."
  if [[ "$FALLBACK_STARTED" == "1" ]]; then stop_direct_fallback; fi
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

if ! plutil -lint "$PLIST" >/dev/null; then
  red "✗ El LaunchAgent generado no es un plist válido"
  plutil -lint "$PLIST" || true
  exit 1
fi

ylw "→ Node: $NODE ($("$NODE" -v))"
ylw "→ Datos persistentes: $DATA"

# El controller ocupa el puerto público y ejecuta server.js internamente en localhost:8348.
# Por eso el launchd antiguo debe detenerse antes del corte.
launchctl bootout "$UID_GUI/$OLD_LABEL" 2>/dev/null || true
launchctl unload "$OLD_PLIST" 2>/dev/null || true
launchctl bootout "$UID_GUI/$LABEL" 2>/dev/null || true
launchctl remove "$LABEL" 2>/dev/null || true
stop_direct_fallback
cleanup_stale_internal_bridge
# launchctl recuerda servicios deshabilitados incluso después de borrar el plist.
# Rehabilitar explícitamente evita "Bootstrap failed: 5: Input/output error"
# en equipos donde una instalación/rollback anterior dejó el label disabled.
launchctl enable "$UID_GUI/$LABEL" 2>/dev/null || true

launchd_ok=0
if launchctl bootstrap "$UID_GUI" "$PLIST"; then
  launchd_ok=1
else
  ylw "→ bootstrap inicial rechazado; limpiando estado stale de launchd y reintentando..."
  launchctl bootout "$UID_GUI/$LABEL" 2>/dev/null || true
  launchctl remove "$LABEL" 2>/dev/null || true
  launchctl enable "$UID_GUI/$LABEL" 2>/dev/null || true
  sleep 1
  if launchctl bootstrap "$UID_GUI" "$PLIST"; then
    launchd_ok=1
  else
    ylw "→ launchctl bootstrap volvió a fallar. Probando API legacy load -w…"
    if launchctl load -w "$PLIST" 2>/dev/null; then
      launchd_ok=1
    fi
  fi
fi

if [[ "$launchd_ok" == "1" ]]; then
  launchctl kickstart -k "$UID_GUI/$LABEL" 2>/dev/null || true
else
  start_direct_fallback
fi

ok=""
for _ in $(seq 1 15); do
  if curl -fsS -m 2 "http://127.0.0.1:$PORT/healthz" | grep -q '"legacyReady":true'; then
    ok=1
    break
  fi
  sleep 1
done

[[ -n "$ok" ]] || false
trap - ERR

grn "✓ Farm Controller activo en http://127.0.0.1:$PORT/healthz"
if [[ "$launchd_ok" == "1" ]]; then
  grn "✓ Persistencia macOS: LaunchAgent activo"
else
  ylw "⚠ Persistencia macOS: modo directo de contingencia (funciona ahora; launchd sigue pendiente de reparar)"
  ylw "  PID: $(cat "$FALLBACK_PID" 2>/dev/null || echo desconocido)"
fi
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
