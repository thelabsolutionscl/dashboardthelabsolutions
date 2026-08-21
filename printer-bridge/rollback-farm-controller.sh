#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.thelab.farm-controller"
OLD_LABEL="com.thelab.printer-bridge"
UID_GUI="gui/$(id -u)"
OLD_PLIST="$HOME/Library/LaunchAgents/$OLD_LABEL.plist"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
grn() { printf '\033[32m%s\033[0m\n' "$*"; }
ylw() { printf '\033[33m%s\033[0m\n' "$*"; }

if [[ "$(uname -s)" != "Darwin" ]]; then
  red "Este helper es para macOS/launchd. En Linux usa systemctl según docs/FARM_CONTROLLER.md."
  exit 1
fi

launchctl bootout "$UID_GUI/$LABEL" 2>/dev/null || true

if [[ ! -f "$OLD_PLIST" ]]; then
  red "No encuentro $OLD_PLIST"
  echo "Puedes regenerarlo con: $HERE/install-launchd.sh"
  exit 1
fi

launchctl bootout "$UID_GUI/$OLD_LABEL" 2>/dev/null || true
if launchctl bootstrap "$UID_GUI" "$OLD_PLIST" 2>/dev/null; then
  launchctl kickstart -k "$UID_GUI/$OLD_LABEL" 2>/dev/null || true
else
  launchctl load -w "$OLD_PLIST"
fi

ok=""
for _ in $(seq 1 10); do
  if curl -fsS -m 2 http://127.0.0.1:8347/healthz >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 1
done

if [[ -n "$ok" ]]; then
  grn "✓ Rollback completo: printer-bridge anterior responde en :8347"
else
  red "⚠ El servicio antiguo se cargó pero /healthz aún no responde."
  ylw "Revisa: tail -n 60 /tmp/printer-bridge.err /tmp/printer-bridge.log"
  exit 2
fi
