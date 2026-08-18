#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# The Lab Solutions — Llave SSH del iMac en las impresoras
#
# Deja al bridge capaz de recuperar la telemetría por su cuenta: copia la
# llave pública del iMac a cada impresora para que `POST /recover/{IP}`
# (el botón "Recuperar telemetría" del dashboard) entre sin contraseña.
#
#   cd ~/dashboardthelabsolutions/printer-bridge
#   ./install-printer-keys.sh            # barre la red y te muestra el mapa
#   ./install-printer-keys.sh 192.168.100.7 192.168.100.68 …
#
# Pide la contraseña de cada impresora una vez (en el parque es `creality`).
# Es idempotente: correrlo de nuevo sobre una máquina ya lista no hace daño.
# ─────────────────────────────────────────────────────────────────────
set -uo pipefail

KEY="${PRINTER_SSH_KEY:-$HOME/.ssh/id_ed25519}"
KEY_RSA="$(dirname "$KEY")/id_rsa"
USER_SSH="${PRINTER_SSH_USER:-root}"
SUBNET="${PRINTER_SUBNET:-192.168.100}"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
grn() { printf '\033[32m%s\033[0m\n' "$*"; }
ylw() { printf '\033[33m%s\033[0m\n' "$*"; }
dim() { printf '\033[90m%s\033[0m\n' "$*"; }

# La red del taller es de confianza y las impresoras regeneran su host key al
# reflashear o al heredar una IP por DHCP: guardarlas en known_hosts solo
# produce el "REMOTE HOST IDENTIFICATION HAS CHANGED" que bloquea la copia.
# El bridge usa exactamente las mismas opciones.
SSHOPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=8)

ensure_key() {   # $1 ruta  $2 tipo  $3 bits (opcional)
  [[ -f "$1" ]] && return 0
  ylw "Creando llave $2 en $1…"
  if [[ -n "${3:-}" ]]; then ssh-keygen -t "$2" -b "$3" -N '' -C "printer-bridge@$(hostname -s)" -f "$1" >/dev/null
  else ssh-keygen -t "$2" -N '' -C "printer-bridge@$(hostname -s)" -f "$1" >/dev/null; fi
}
verify_key() {   # $1 ip  $2 llave
  ssh -i "$2" -o BatchMode=yes -o IdentitiesOnly=yes "${SSHOPTS[@]}" "$USER_SSH@$1" 'echo ok' >/dev/null 2>&1
}
copy_key() {     # $1 ip  $2 llave  $3 log
  # IdentitiesOnly + PreferredAuthentications: sin esto ssh ofrece todas las
  # llaves del agente y las impresoras cortan con "Too many authentication
  # failures" antes de llegar a preguntar la contraseña.
  ssh-copy-id -i "$2.pub" "${SSHOPTS[@]}" -o IdentitiesOnly=yes \
    -o PreferredAuthentications=password,keyboard-interactive "$USER_SSH@$1" 2>&1 | tee "$3"
}

ensure_key "$KEY" ed25519 || { red "✗ No se pudo crear la llave"; exit 1; }

# ── Destinos: argumentos validados, o barrido de la red ──────────────
IPS=()
for a in "$@"; do
  if [[ "$a" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then IPS+=("$a")
  else red "✗ \"$a\" no es una IP — pásale la dirección real (p. ej. 192.168.100.7)."; fi
done
if [[ $# -gt 0 && ${#IPS[@]} -eq 0 ]]; then
  red "Ninguna IP válida. Corre el script sin argumentos y te las busca solo."
  exit 1
fi

SIN_SSH=()
if [[ ${#IPS[@]} -eq 0 ]]; then
  command -v nc >/dev/null 2>&1 || { red "✗ Falta nc para barrer la red — pásale las IPs como argumento."; exit 1; }
  ylw "Barriendo $SUBNET.0/24 (SSH · Moonraker · web)… ~25s"
  SCAN="$(mktemp)"
  for i in $(seq 2 254); do
    (
      ip="$SUBNET.$i"; s=no
      nc -z -G 2 -w 2 "$ip" 22 >/dev/null 2>&1 && s=si
      mk=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "http://$ip:7125/printer/info" 2>/dev/null)
      web=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "http://$ip/" 2>/dev/null)
      [[ "$s" == si || "$mk" != 000 || "$web" != 000 ]] && echo "$ip $s $mk $web" >> "$SCAN"
    ) &
  done
  wait
  printf '\n%-16s %-6s %-11s %s\n' "IP" "SSH" "MOONRAKER" "WEB"
  while read -r ip s mk web; do
    printf '%-16s %-6s %-11s %s\n' "$ip" "$s" "$mk" "$web"
    if [[ "$s" == si ]]; then IPS+=("$ip"); else SIN_SSH+=("$ip"); fi
  done < <(sort -t. -k4 -n "$SCAN" 2>/dev/null)
  rm -f "$SCAN"
  printf '\n'
  dim "moonraker:200 = sana · moonraker:000 + web:200 = telemetría caída · SSH no = no se puede recuperar"
  [[ ${#IPS[@]} -eq 0 ]] && { red "✗ Ninguna máquina con SSH abierto en $SUBNET.0/24."; exit 1; }
fi

# ── Copiar la llave y verificar ──────────────────────────────────────
LOG="$(mktemp)"
OK=0; BAD=0
for ip in "${IPS[@]}"; do
  printf '\n── %s ─────────────────\n' "$ip"
  ssh-keygen -R "$ip" >/dev/null 2>&1   # limpia la entrada vieja para tus ssh a mano
  if verify_key "$ip" "$KEY" || { [[ -f "$KEY_RSA" ]] && verify_key "$ip" "$KEY_RSA"; }; then
    grn "✅ $ip — ya entraba sin contraseña"; OK=$((OK+1)); continue
  fi
  copy_key "$ip" "$KEY" "$LOG"
  if verify_key "$ip" "$KEY"; then
    grn "✅ $ip — el bridge ya puede recuperarla sin contraseña"; OK=$((OK+1)); continue
  fi
  # Los dropbear viejos de las K1/Ender mips no soportan ed25519: la llave se
  # copia, dice "1 key added" y aun así no deja entrar. Con RSA sí.
  if grep -qi "key(s) added\|Permission denied (publickey" "$LOG"; then
    ylw "   La llave ed25519 no le sirve — probando con RSA (dropbear antiguo)…"
    ensure_key "$KEY_RSA" rsa 3072
    copy_key "$ip" "$KEY_RSA" "$LOG"
    if verify_key "$ip" "$KEY_RSA"; then
      grn "✅ $ip — lista (con llave RSA)"; OK=$((OK+1)); continue
    fi
  fi
  if grep -qi "no matching key exchange\|no matching host key" "$LOG"; then
    red "✗ $ip — SSH demasiado antiguo para negociar. Probablemente NO es una impresora del parque."
  elif grep -qi "Too many authentication failures" "$LOG"; then
    red "✗ $ip — la máquina cortó por exceso de intentos. Reintenta este IP solo."
  elif grep -qi "Permission denied" "$LOG"; then
    red "✗ $ip — contraseña rechazada. ¿No es \`creality\`? ¿root bloqueado en esa máquina?"
  else
    red "✗ $ip — no se pudo dejar la llave. Revisa la salida de arriba."
  fi
  BAD=$((BAD+1))
done
rm -f "$LOG"

printf '\n'
grn "$OK máquina(s) listas para el botón 🔧 Recuperar telemetría"
[[ $BAD -gt 0 ]] && ylw "$BAD sin llave — el bridge no podrá recuperarlas"
if [[ ${#SIN_SSH[@]} -gt 0 ]]; then
  ylw "Responden en la red pero SIN SSH: ${SIN_SSH[*]}"
  dim "  Si alguna es una impresora, actívale el modo root/SSH: sin eso no hay recuperación posible."
fi
exit 0
