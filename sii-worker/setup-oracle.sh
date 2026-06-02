#!/bin/bash
# ============================================================
# SETUP Oracle Cloud — SII DTE Server
# Correr en el VPS Oracle (Ubuntu 22.04) como ubuntu o root:
#   bash setup-oracle.sh
# ============================================================
set -e

echo "📦 Instalando Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "📦 Instalando PM2..."
sudo npm install -g pm2

echo "📁 Clonando repositorio..."
git clone https://github.com/thelabsolutionscl/dashboardthelabsolutions.git
cd dashboardthelabsolutions/sii-worker

echo "📦 Instalando dependencias..."
npm install

echo "🔧 Creando archivo .env..."
cp .env.example .env
echo ""
echo "⚠️  IMPORTANTE: Edita el archivo .env con tus datos reales:"
echo "   nano .env"
echo ""
echo "   Especialmente CERT_PFX_BASE64 — genera con:"
echo "   base64 -w 0 /ruta/a/169374015.pfx"
echo ""
read -p "Presiona Enter cuando hayas editado .env..."

echo "🚀 Iniciando servidor con PM2..."
pm2 start server.js --name sii-dte-server --interpreter node
pm2 save
pm2 startup

echo "🔓 Abriendo puerto 3000 en firewall..."
sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || true

echo ""
echo "✅ Servidor corriendo."
echo ""
echo "👉 Pasos finales en Oracle Cloud Console:"
echo "   1. Ve a tu instancia → VCN → Security Lists"
echo "   2. Agrega Ingress Rule: TCP puerto 3000 desde 0.0.0.0/0"
echo ""
echo "👉 Subir CAF al servidor:"
echo "   Ver instrucciones en README o ejecutar upload-caf.sh"
echo ""
