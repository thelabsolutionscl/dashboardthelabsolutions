#!/usr/bin/env bash
# Pure selector: print GitHub Actions step outputs; never deploy or read secrets.
# push: read changed repository paths on stdin; manual: explicit target argument.
set -euo pipefail
mode="${1:-push}"
target="${2:-all}"
lead=false
proxy=false
sii=false
case "$mode" in
  manual)
    case "$target" in
      all) lead=true;proxy=true;sii=true ;;
      lead) lead=true ;;
      proxy) proxy=true ;;
      sii) sii=true ;;
      *) echo "Invalid manual worker target" >&2; exit 2 ;;
    esac
    ;;
  push)
    while IFS= read -r file; do
      case "$file" in
        lead-worker/*) lead=true ;;
        airtable-proxy/*) proxy=true ;;
        sii-worker/*) sii=true ;;
      esac
    done
    ;;
  *) echo "Invalid worker deployment mode" >&2; exit 2 ;;
esac
printf 'lead=%s\nproxy=%s\nsii=%s\n' "$lead" "$proxy" "$sii"
