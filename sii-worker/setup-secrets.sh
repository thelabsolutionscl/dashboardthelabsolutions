#!/bin/bash
# ============================================================
# SETUP SECRETS — Cloudflare Worker SII DTE
# Ejecutar desde la carpeta sii-worker/ en tu máquina local:
#   cd sii-worker && bash setup-secrets.sh
# ============================================================
set -e

WORKER_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$WORKER_DIR"

echo "🔐 Configurando secrets del Worker SII — WAST3D SPA"
echo ""

# ── Certificado digital ──────────────────────────────────────
echo "📋 [1/11] Certificado digital (CERT_PFX_BASE64)..."
echo "   Convirtiendo archivo .pfx a base64..."
base64 -i ../cert/169374015.pfx | tr -d '\n' | npx wrangler secret put CERT_PFX_BASE64
# Si el archivo está en otra ruta, ajusta la línea anterior. Alternativa:
#   base64 -i /ruta/a/tu.pfx | tr -d '\n' | npx wrangler secret put CERT_PFX_BASE64

echo "🔑 [2/11] Contraseña del certificado..."
printf 'Primos2525' | npx wrangler secret put CERT_PFX_PASSWORD

# ── Datos del emisor ─────────────────────────────────────────
echo "🏢 [3/11] RUT del emisor..."
printf '77.499.554-4' | npx wrangler secret put RUT_EMISOR

echo "🏢 [4/11] Razón social..."
printf 'WAST3D SPA' | npx wrangler secret put RAZON_SOCIAL

echo "📦 [5/11] Giro..."
printf 'Fabricación mediante impresión 3D' | npx wrangler secret put GIRO_EMISOR

echo "🔢 [6/11] Código actividad económica (ACTECO)..."
printf '329900' | npx wrangler secret put ACTECO

echo "📍 [7/11] Dirección..."
printf 'Eulogia Sanchez 065' | npx wrangler secret put DIR_EMISOR

echo "🏙 [8/11] Comuna..."
printf 'Providencia' | npx wrangler secret put CMNA_EMISOR

echo "🌆 [9/11] Ciudad..."
printf 'Santiago' | npx wrangler secret put CIUDAD_EMISOR

# ── Resolución SII ───────────────────────────────────────────
# Ver en: mipyme.sii.cl → Mi empresa → o en el PDF de autorización SII
echo "📄 [10/11] Fecha resolución SII..."
printf '2014-10-21' | npx wrangler secret put RESOLUCION_FECHA

echo "🔢 [11/11] Número resolución..."
printf '99' | npx wrangler secret put RESOLUCION_NUMERO

echo ""
echo "✅ Secrets configurados."
echo ""
echo "📌 IMPORTANTE: Actualiza RESOLUCION_FECHA con la fecha real de tu"
echo "   autorización SII antes de emitir DTEs en producción."
echo ""
echo "👉 Siguiente paso — desplegar el Worker:"
echo "   npx wrangler deploy"
echo ""
echo "👉 Luego crear el KV namespace (si no existe):"
echo "   npx wrangler kv namespace create FOLIOS_KV"
echo "   (Copia el id que devuelve y ponlo en wrangler.toml)"
