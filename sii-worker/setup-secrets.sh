#!/bin/bash
# ============================================================
# SETUP SECRETS — Cloudflare Worker SII DTE
# Ejecutar desde la carpeta sii-worker/ en tu máquina local:
#   cd sii-worker && bash setup-secrets.sh
# ============================================================
set -e

WORKER_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$WORKER_DIR"

echo "🔐 Configurando secrets del Worker SII"
echo "   (Introduce los datos de TU empresa cuando se te pidan)"
echo ""

# ── Certificado digital ──────────────────────────────────────
echo "📋 [1/12] Certificado digital (CERT_PFX_BASE64)..."
read -rp 'Ruta a tu archivo .pfx [../cert/TU_CERT.pfx]: ' _PFXPATH
_PFXPATH="${_PFXPATH:-../cert/TU_CERT.pfx}"
base64 -i "$_PFXPATH" | tr -d '\n' | npx wrangler secret put CERT_PFX_BASE64; unset _PFXPATH

echo "🔑 [2/12] Contraseña del certificado..."
read -rsp 'CERT_PFX_PASSWORD: ' _PFXPW; echo
printf '%s' "$_PFXPW" | npx wrangler secret put CERT_PFX_PASSWORD; unset _PFXPW

# ── Datos del emisor ─────────────────────────────────────────
echo "🏢 [3/12] RUT del emisor (ej: 11.111.111-1)..."
read -rp 'RUT_EMISOR: ' _V; printf '%s' "${_V:-TU_RUT_EMISOR}" | npx wrangler secret put RUT_EMISOR; unset _V

echo "🏢 [4/12] Razón social..."
read -rp 'RAZON_SOCIAL: ' _V; printf '%s' "${_V:-TU_RAZON_SOCIAL}" | npx wrangler secret put RAZON_SOCIAL; unset _V

echo "📦 [5/12] Giro..."
read -rp 'GIRO_EMISOR: ' _V; printf '%s' "${_V:-TU_GIRO}" | npx wrangler secret put GIRO_EMISOR; unset _V

echo "🔢 [6/12] Código actividad económica (ACTECO)..."
read -rp 'ACTECO: ' _V; printf '%s' "${_V:-TU_ACTECO}" | npx wrangler secret put ACTECO; unset _V

echo "📍 [7/12] Dirección..."
read -rp 'DIR_EMISOR: ' _V; printf '%s' "${_V:-TU_DIRECCION}" | npx wrangler secret put DIR_EMISOR; unset _V

echo "🏙 [8/12] Comuna..."
read -rp 'CMNA_EMISOR: ' _V; printf '%s' "${_V:-TU_COMUNA}" | npx wrangler secret put CMNA_EMISOR; unset _V

echo "🌆 [9/12] Ciudad..."
read -rp 'CIUDAD_EMISOR: ' _V; printf '%s' "${_V:-TU_CIUDAD}" | npx wrangler secret put CIUDAD_EMISOR; unset _V

# ── Resolución SII ───────────────────────────────────────────
# Ver en: mipyme.sii.cl → Mi empresa → o en el PDF de autorización SII
echo "📄 [10/12] Fecha resolución SII (AAAA-MM-DD)..."
read -rp 'RESOLUCION_FECHA: ' _V; printf '%s' "${_V:-AAAA-MM-DD}" | npx wrangler secret put RESOLUCION_FECHA; unset _V

echo "🔢 [11/12] Número resolución..."
read -rp 'RESOLUCION_NUMERO: ' _V; printf '%s' "${_V:-TU_NUMERO_RESOLUCION}" | npx wrangler secret put RESOLUCION_NUMERO; unset _V

# ── Seguridad ────────────────────────────────────────────────
echo "🔒 [12/12] API key para proteger la API (header X-SII-Key)..."
echo "   Deja vacío para generar una aleatoria. (Vacío real = API sin protección)"
read -rp 'SII_API_KEY [autogenerar]: ' _APIKEY
if [ -z "$_APIKEY" ]; then
  _APIKEY="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n')"
  echo "   → API key generada: $_APIKEY"
  echo "   → Guárdala: el dashboard debe enviarla en el header X-SII-Key."
fi
printf '%s' "$_APIKEY" | npx wrangler secret put SII_API_KEY; unset _APIKEY

echo ""
echo "✅ Secrets configurados."
echo ""
echo "ℹ Opcional: para habilitar diagnóstico/logging detallado define el secret SII_DEBUG=1"
echo "   y para restringir CORS define SII_ALLOW_ORIGIN con el dominio del dashboard:"
echo "     echo 1 | npx wrangler secret put SII_DEBUG"
echo "     echo https://tu-dashboard.example.com | npx wrangler secret put SII_ALLOW_ORIGIN"
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
