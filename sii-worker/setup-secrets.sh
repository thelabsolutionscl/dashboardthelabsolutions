#!/bin/bash
# ============================================================
# SETUP SECRETS — Cloudflare Worker SII DTE
# Ejecutar desde la carpeta sii-worker/
# ============================================================
set -e

WORKER_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$WORKER_DIR"

echo "🔐 Configurando secrets del Worker SII..."
echo ""

# ── Certificado digital ──────────────────────────────────────
echo "📋 Subiendo certificado digital (CERT_PFX_BASE64)..."
cat /tmp/cert_pfx_b64.txt | npx wrangler secret put CERT_PFX_BASE64

echo "🔑 Contraseña del certificado..."
echo -n "Primos2525" | npx wrangler secret put CERT_PFX_PASSWORD

# ── Datos del emisor ─────────────────────────────────────────
# RUT del emisor (quien firma y emite las facturas/boletas)
# Opciones:
#   a) RUT personal de Gustavo: 16937401-5
#   b) RUT de The Lab Solutions SpA (si la empresa es el emisor registrado en SII)
echo "🏢 RUT del emisor..."
echo -n "16937401-5" | npx wrangler secret put RUT_EMISOR

echo "🏢 Razón social..."
echo -n "GUSTAVO ANDRES KAISER ORTIZ" | npx wrangler secret put RAZON_SOCIAL

echo "📦 Giro..."
echo -n "Fabricación mediante impresión 3D" | npx wrangler secret put GIRO_EMISOR

echo "🔢 Código actividad económica (ACTECO)..."
echo -n "329900" | npx wrangler secret put ACTECO

echo "📍 Dirección..."
echo -n "Zaragoza 8882" | npx wrangler secret put DIR_EMISOR

echo "🏙 Comuna..."
echo -n "Las Condes" | npx wrangler secret put CMNA_EMISOR

echo "🌆 Ciudad..."
echo -n "Santiago" | npx wrangler secret put CIUDAD_EMISOR

# ── Resolución SII ───────────────────────────────────────────
# Obtener estos datos desde: mipyme.sii.cl → Mi empresa → Resolución
echo "📄 Fecha resolución SII (formato YYYY-MM-DD)..."
echo -n "2024-01-01" | npx wrangler secret put RESOLUCION_FECHA

echo "🔢 Número resolución (MiPymes usan 0)..."
echo -n "0" | npx wrangler secret put RESOLUCION_NUMERO

echo ""
echo "✅ Secrets configurados. Ahora ejecuta:"
echo "   npx wrangler deploy"
