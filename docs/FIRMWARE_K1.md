# Firmware K1 — bajar de multicolor (2.3.5.x) a monocolor (1.3.5.x)

Runbook para volver una K1 desde la rama **multicolor/CFS** (`V2.3.5.xx`) a la
rama **monocolor** (`V1.3.5.xx`). Caso de origen: **K1 #2**, que tiene
`V2.3.5.33` y se quiere dejar en `V1.3.5.22`.

> **"COLOR" y "MONOCROMÁTICO" no son el tipo de pantalla.** Son dos ramas
> distintas del firmware de Creality: la `2.x` trae soporte multicolor (CFS) y
> la `1.x` es la de un solo material. La pantalla es la misma en ambas.

---

## Antes de empezar

| Punto | Por qué importa |
|---|---|
| **No es un update, es un downgrade** | Creality no lo soporta oficialmente. La OTA compara versiones y rechaza `1.x` estando en `2.x` (`version_is_new`). Casi seguro hay que forzarlo por SSH. |
| **La máquina tiene que estar libre** | Nunca durante un print. Y ojo con la mantención automática de las **9:00** del bridge (`printer-bridge/maint-config.json`): si vas a flashear cerca de esa hora, desactívala o saca la impresora de la lista ese día. |
| **Energía estable** | Un corte a mitad de la OTA deja la máquina en brick. Enchufe directo, sin regletas dudosas. |
| **El `.img` es por modelo** | Flashear el archivo de otro modelo (K1C / K1 Max) es la forma más rápida de brickearla. Ver paso 1. |
| **El downgrade resetea la máquina** | Se pierde lo que esté en el overlay: config de Moonraker (CORS), macros propias, Helper Script, Fluidd/Mainsail instalados a mano. Respaldar antes (paso 2). |

---

## Paso 1 — Confirmar modelo y versión en la máquina

En la pantalla: **Ajustes → Acerca de**. Anota:

- **Modelo / código de máquina** (algo tipo `CR4CU220812S11`).
- **Versión de firmware** actual (debería decir `V2.3.5.33`).

El archivo que descargues tiene que empezar **exactamente con ese mismo código**.
Para la K1 el monocolor es:

```
CR4CU220812S11_ota_img_V1.3.5.22.img      (publicado 2026-07-10)
```

Si la pantalla muestra otro código (porque la #2 fuera K1C o K1 Max), baja el
`.img` monocolor **de ese modelo** desde el centro de descargas y usa ese nombre
en todos los comandos de abajo. No asumas que el archivo sirve para toda la serie K1.

Descarga: [Creality — K1 Downloads Center](https://www.creality.com/download/creality-k1-3d-printer)
· [Creality Cloud — Flagship Series](https://www.crealitycloud.com/downloads/firmware/flagship-series/k1)

## Paso 2 — Respaldar la configuración

Desde el iMac (misma red), con la IP de la K1 #2 (según
`maint-config.example.json` sería `192.168.100.22` — confírmala en el dashboard,
sección **Máquinas → 🔌 Conexión**):

```bash
ssh root@192.168.100.22            # password por defecto en K1 rooteada: creality
```

```bash
tar czf /tmp/backup-k1-2.tar.gz /usr/data/printer_data/config
exit
scp root@192.168.100.22:/tmp/backup-k1-2.tar.gz ~/Desktop/
```

Guarda ahí `printer.cfg`, `moonraker.conf` y las macros. Después del downgrade
**no restaures `printer.cfg` a ciegas** (cambia entre ramas de firmware): úsalo
solo como referencia para volver a aplicar lo tuyo.

## Paso 3 — USB con el firmware

- Pendrive en **FAT32**.
- El `.img` va en la **raíz** del pendrive, sin carpetas y sin renombrar.
- Enchúfalo en el puerto USB de la K1.

## Paso 4 — Intento normal (por pantalla)

**Ajustes → Actualizar firmware** (con el USB puesto) y confirma.

- Si arranca y termina → listo, salta al paso 6.
- Si dice que la versión instalada es más nueva / no aparece el archivo → es el
  bloqueo de downgrade esperado. Sigue al paso 5.

## Paso 5 — Forzar el downgrade por SSH

Requiere **root/SSH habilitado**. Algunas builds de la rama CFS lo traen
desactivado; si no puedes entrar por SSH, no sigas por acá — este camino se
cierra y hay que ir por soporte Creality (ver "Si algo sale mal").

```bash
ssh root@192.168.100.22

# 1. Limpiar overlay y montar el root en escritura
#    OJO: esto borra TODAS las modificaciones de la máquina. Respaldo del paso 2 hecho.
rm -rf /overlay/upper/*
mount -o remount,rw /

# 2. Copia del script de OTA sin el corte por versión
cp /etc/ota_bin/local_ota_update.sh /tmp/local_ota_update_forced.sh
sed -i 's/exit 1/echo "Ignoring lock..."/g' /tmp/local_ota_update_forced.sh
chmod +x /tmp/local_ota_update_forced.sh

# 3. Flashear (ajusta el nombre del archivo al que bajaste)
/tmp/local_ota_update_forced.sh /tmp/udisk/sda1/CR4CU220812S11_ota_img_V1.3.5.22.img
```

Termina con `ota: stoped success` y reinicia sola en la versión monocolor.
**No la desenchufes ni cortes la sesión SSH mientras corre.**

> Si el `.img` no está en `/tmp/udisk/sda1/`, búscalo con `ls /tmp/udisk/*` —
> según el pendrive puede montarse en `sda`, `sdb1`, etc.

## Paso 6 — Dejarla operativa de nuevo

1. **Ajustes → Acerca de** → confirma `V1.3.5.22`.
2. **Moonraker / CORS** (se perdió con el downgrade). En
   `~/printer_data/config/moonraker.conf`, según `printer-bridge/README.md` (Paso 4):
   ```ini
   [authorization]
   cors_domains:
     *
   trusted_clients:
     127.0.0.1
     192.168.100.0/24
   ```
   y reinicia Moonraker.
3. **Dashboard → Máquinas**: en modo `🌐 Remoto` la K1 #2 debe salir de "Offline"
   en ~15 s. Si no, revisa que Moonraker responda: `curl http://192.168.100.22:7125/printer/info`.
4. **Calibrar**: `G28` + `BED_MESH_CALIBRATE` (botón 📐 en la tarjeta de la máquina)
   y una pieza de prueba antes de mandarla a producción.
5. Vuelve a habilitar la mantención de las 9:00 si la desactivaste.

---

## Si algo sale mal

| Síntoma | Qué hacer |
|---|---|
| La OTA rechaza el archivo aun forzada | Verifica que el prefijo del `.img` coincide con el código de la pantalla (paso 1). Es el error más común. |
| No hay acceso SSH en la rama CFS | Sin SSH no hay downgrade por este camino. Pide a soporte Creality el paquete de recuperación para tu modelo. |
| Se cortó la luz a mitad / no arranca | Es recuperación por eMMC con soporte Creality. No insistas con más OTAs. |
| Volvió a 1.3.5.22 pero perdió nivelación / macros | Esperado: el overlay se borró. Recalibra y reaplica lo del respaldo del paso 2. |

## Fuentes

- [K1 — How to downgrade to monochrome firmware after installing multicolor firmware (foro Creality)](https://forum.creality.com/t/k1-how-to-downgrade-to-monochrome-firmware-after-installing-multicolor-firmware/48449)
- [New K1C firmware v1.3.5.22 (Mono-color) — foro Creality](https://forum.creality.com/t/new-k1c-firmware-v1-3-5-22-mono-color/52410)
- [K1 Max fails to downgrade or update Firmware for CFS-C — Creality-Helper-Script-Wiki #877](https://github.com/Guilouz/Creality-Helper-Script-Wiki/discussions/877) (de aquí sale el forzado por SSH del paso 5)
- [Firmware Upgrade Guidance — Creality Wiki](https://wiki.creality.com/en/k1-flagship-series/k1/quick-start-guide/firmware-upgrade-guidance)
