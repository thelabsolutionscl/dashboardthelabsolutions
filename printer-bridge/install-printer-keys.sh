#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# The Lab Solutions — Llave SSH del iMac en las impresoras
#
# Deja al bridge capaz de recuperar la telemetría por su cuenta: copia la
# llave pública del iMac a cada impresora para que `POST /recover/{IP}`
# (el botón "Recuperar telemetría" del dashboard) entre sin contraseña.
#
#   cd ~/dashboardthelabsolutions/printer-bridge
#   ./install-printer-keys.sh 192.168.100.7 192.168.100.68 …
#   ./install-printer-keys.sh            # sin argumentos: barre la red buscando impresoras
#
# Pide la contraseña de cada impresora una vez (en el parque es `creality`).
# Es idempotente: correrlo de nuevo sobre una máquina ya configurada no hace daño.
# ─────────────────────────────────────────────────────────────────────
set -uo pipefail

KEY="${PRINTER_SSH_KEY:-$HOME/.ssh/id_ed25519}"
USER_SSH="${PRINTER_SSH_USER:-root}"
SUBNET="${PRINTER_SUBNET:-192.168.100}"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
grn() { printf '\033[32m%s\033[0m\n' "$*"; }
ylw() { printf '\033[33m%s\033[0m\n' "$*"; }

# 1) Llave del iMac (se crea sin passphrase: el bridge corre desatendido)
if [[ ! -f "$KEY" ]]; then
  ylw "No hay llave en $KEY — creando una…"
  ssh-keygen -t ed25519 -N '' -C "printer-bridge@$(hostname -s)" -f "$KEY" || { red "✗ No se pudo crear la llave"; exit 1; }
fi

# 2) Impresoras destino: las de los argumentos, o un barrido por el puerto de Moonraker
IPS=("$@")
if [[ ${#IPS[@]} -eq 0 ]]; then
  ylw "Barriendo $SUBNET.0/24 por el puerto 7125 (Moonraker)… ~15s"
  SCAN="$(mktemp)"
  for i in $(seq 2 254); do
    ( curl -s -m 6 -o /dev/null "http://$SUBNET.$i:7125/printer/info" && echo "$SUBNET.$i" >> "$SCAN" ) &
  done
  wait
  # Ojo: el barrido solo ve las que TIENEN Moonraker vivo. Una impresora con la
  # telemetría caída —justo la que hay que poder recuperar— no aparece aquí;
  # pásala a mano como argumento.
  while read -r ip; do IPS+=("$ip"); done < <(sort -t. -k4 -n "$SCAN" 2>/dev/null)
  rm -f "$SCAN"
  [[ ${#IPS[@]} -eq 0 ]] && { red "✗ No se encontró ninguna impresora. Pásalas como argumento."; exit 1; }
  grn "Encontradas: ${IPS[*]}"
fi

# 3) Copiar la llave y verificar
OK=0; BAD=0
for ip in "${IPS[@]}"; do
  printf '\n── %s ─────────────────\n' "$ip"
  # ssh-copy-id no viene en todos los macOS; el fallback hace lo mismo a mano.
  if command -v ssh-copy-id >/dev/null 2>&1; then
    ssh-copy-id -i "$KEY.pub" -o StrictHostKeyChecking=no "$USER_SSH@$ip" >/dev/null 2>&1 || \
      ssh-copy-id -i "$KEY.pub" -o StrictHostKeyChecking=no "$USER_SSH@$ip"
  else
    ssh -o StrictHostKeyChecking=no "$USER_SSH@$ip" \
      'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys' < "$KEY.pub"
  fi
  if ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=8 "$USER_SSH@$ip" 'echo ok' >/dev/null 2>&1; then
    grn "✅ $ip — el bridge ya puede recuperarla sin contraseña"; OK=$((OK+1))
  else
    red "✗ $ip — sigue pidiendo contraseña. Revisa usuario/clave y reintenta."; BAD=$((BAD+1))
  fi
done

printf '\n'
grn "$OK impresora(s) listas"; [[ $BAD -gt 0 ]] && ylw "$BAD con problemas"
cat <<EOF

Si tu llave NO es la de por defecto ($HOME/.ssh/id_ed25519), dile al bridge
cuál usar con PRINTER_SSH_KEY (en el .plist de launchd o en el entorno) y
reinícialo:

  PRINTER_SSH_KEY=$KEY node server.js

EOF
exit 0
