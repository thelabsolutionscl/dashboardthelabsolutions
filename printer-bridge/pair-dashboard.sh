#!/usr/bin/env bash
set -euo pipefail

PORT="${BRIDGE_PORT:-8347}"
URL="http://127.0.0.1:${PORT}/farm/local-pair"

if ! curl -fsS -m 3 "http://127.0.0.1:${PORT}/healthz" >/dev/null; then
  echo "✗ Farm Controller no responde en 127.0.0.1:${PORT}" >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin) open "$URL" ;;
  Linux)
    if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
    else echo "Abre en este equipo: $URL"; fi
    ;;
  *) echo "Abre en este equipo: $URL" ;;
esac

echo "✓ Emparejamiento local iniciado. El navegador será redirigido al dashboard."
