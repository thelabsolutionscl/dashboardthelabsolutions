#!/bin/bash
set -euo pipefail

# Only run in remote (web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo "Session start: proyecto HTML estático — no hay dependencias que instalar."

# Verify the main file exists
if [ ! -f "${CLAUDE_PROJECT_DIR}/index.html" ]; then
  echo "WARNING: index.html not found in project root"
  exit 1
fi

echo "index.html verificado correctamente."
