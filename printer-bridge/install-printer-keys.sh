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

# 2) Impresoras destino: las de los argumentos (validadas) o un barrido de la red
IPS=()
for a in "$@"; do
  if [[ "$a" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    IPS+=("$a")
  else
    red "✗ \"$a\" no es una IP — pásale la dirección real (p. ej. 192.168.100.7)."
  fi
done
if [[ $# -gt 0 && ${#IPS[@]} -eq 0 ]]; then
  red "Ninguna IP válida. Corre el script sin argumentos y te las busca solo."
  exit 1
fi

# El barrido busca el puerto 22, no Moonraker: así también encuentra a las
# impresoras con la telemetría caída, que son justo las que hay que poder
# recuperar (con Moonraker muerto no aparecerían en un barrido del 7125).
if [[ ${#IPS[@]} -eq 0 ]]; then
  command -v nc >/dev/null 2>&1 || { red "✗ Falta nc para barrer la red — pásale las IPs como argumento."; exit 1; }
  ylw "Buscando impresoras con SSH abierto en $SUBNET.0/24… ~20s"
  SCAN="$(mktemp)"
  for i in $(seq 2 254); do
    ( nc -z -G 2 -w 2 "$SUBNET.$i" 22 >/dev/null 2>&1 && echo "$SUBNET.$i" >> "$SCAN" ) &
  done
  wait
  while read -r ip; do [[ -n "$ip" ]] && IPS+=("$ip"); done < <(sort -t. -k4 -n "$SCAN" 2>/dev/null)
  rm -f "$SCAN"
  if [[ ${#IPS[@]} -eq 0 ]]; then
    red "✗ Ninguna máquina con SSH abierto en $SUBNET.0/24."
    ylw "  O las IPs están en otra subred (PRINTER_SUBNET=…), o tienen SSH/modo root apagado."
    exit 1
  fi
  grn "Con SSH abierto: ${IPS[*]}"
fi

# 3) Copiar la llave y verificar
OK=0; BAD=0
for ip in "${IPS[@]}"; do
  printf '\n── %s ─────────────────\n' "$ip"
  # Primero el puerto: sin SSH escuchando, ssh-copy-id solo confunde. Un
  # "Connection refused" aquí suele ser una IP vieja (DHCP) o el modo root
  # apagado en la impresora.
  if command -v nc >/dev/null 2>&1 && ! nc -z -G 3 -w 3 "$ip" 22 >/dev/null 2>&1; then
    red "✗ $ip — nadie escucha en el puerto 22."
    ylw "   ¿IP correcta? (son DHCP y se mueven) ¿modo root/SSH activado en la máquina?"
    BAD=$((BAD+1)); continue
  fi
  if command -v ssh-copy-id >/dev/null 2>&1; then
    ssh-copy-id -i "$KEY.pub" -o StrictHostKeyChecking=no "$USER_SSH@$ip"
  else
    ssh -o StrictHostKeyChecking=no "$USER_SSH@$ip" \
      'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys' < "$KEY.pub"
  fi
  if ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=8 "$USER_SSH@$ip" 'echo ok' >/dev/null 2>&1; then
    grn "✅ $ip — el bridge ya puede recuperarla sin contraseña"; OK=$((OK+1))
  else
    red "✗ $ip — la llave no quedó instalada (¿contraseña incorrecta, o /home sin permiso de escritura?)"; BAD=$((BAD+1))
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
