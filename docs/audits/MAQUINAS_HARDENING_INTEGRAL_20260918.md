# Máquinas — hardening integral 2026-09-18

## Objetivo

La sección **MÁQUINAS** deja de tratar planificación, telemetría y ejecución como si fueran la misma fuente. El principio aplicado es:

- **MachineOps** planifica, relaciona pedido/material/perfil y presenta preflight.
- **Moonraker** confirma el estado físico actual.
- **Farm Registry** define identidad/IP/configuración física estable.
- **Farm Controller** es la puerta única de ejecución y posee el lifecycle durable.
- **PrinterHistory** conserva cierres/odómetro central.
- **Airtable** conserva estado administrativo, agenda y mantenciones.
- localStorage queda como caché/outbox, nunca como confirmación de ejecución.

## Correcciones aplicadas

### Cola y ejecución
- Cada envío al Controller usa idempotencyKey.
- Un timeout ya no crea una cola local paralela de respaldo.
- El fallback local legado no elimina el trabajo hasta confirmar print/start.
- Reimprimir desde **Archivos** crea un trabajo MachineOps y pasa por preflight.
- MachineOps revalida el preflight inmediatamente antes del comando físico.
- Los inicios desde MachineOps usan /farm/queue/existing; no llaman Moonraker directamente.
- El Controller reconcilia started → printing/paused → completed/cancelled/failed.
- Los cierres del Controller se escriben en /farm/production/events.
- MachineOps reconcilia su estado desde el lifecycle durable mediante farmJobId / executionId.
- La cola terminal se poda con retención, evitando crecimiento ilimitado.

### Cama libre
print_stats.state=complete ya no significa automáticamente “máquina disponible”.

El operador debe confirmar **pieza retirada / cama libre**. La confirmación:
1. se guarda en MachineOps;
2. se sincroniza al Controller;
3. se compara contra la firma de la impresión terminada;
4. se invalida al iniciar el siguiente trabajo.

Esto evita que una cola arranque sobre una pieza todavía en la cama.

### CFS
La configuración física oficial es:
- **K1 #1**: CFS.
- **K2 Plus #11**: CFS.
- K2 normales: sin CFS.

Los objetos box, filament_rack, sensor de filamento y temperatura de cámara se consultan tanto por polling como por WebSocket sólo en los equipos que físicamente tienen CFS.

### Compatibilidad
- Dimensiones X/Y/Z parciales bloquean compatibilidad.
- Dimensiones no registradas se muestran como dato desconocido, no como “verificado”.
- La boquilla instalada puede registrarse en la conexión de la impresora y se sincroniza al Farm Registry.
- Un mismatch entre boquilla del trabajo y boquilla física bloquea el preflight.
- Se eliminaron multiplicadores hardcodeados de velocidad por modelo del Auto-plan.

### Estados administrativos
- Un clic rápido sólo alterna disponible ↔ mantencion.
- Estados como fuera_servicio, esperando_repuesto, calibrando, etc. no pueden reactivarse accidentalmente.
- Volver a disponible requiere confirmación humana.
- Cambios sin Airtable quedan en outbox y se reintentan.

### Agenda y mantención
- La agenda usa una outbox de operaciones set/delete.
- Tras recuperar red, se carga primero el estado remoto y luego se aplican los cambios locales pendientes.
- Mantenciones fallidas quedan en outbox; antes de reintentar se comprueba si el registro remoto ya existe para reducir duplicados.
- Ya no se sugieren “horas de máquina” desde el monto comercial del pedido; sólo desde trabajos técnicos MachineOps.

### Historial
- Una sesión abierta tras reload recupera su inicio desde print_stats.print_duration.
- Si la impresión pertenece al Farm Controller, el navegador no duplica el cierre local.
- Los nuevos inicios controlados quedan asociados a un farmJobId.

### Seguridad
- Un token operator puede sincronizar lectura/cámaras, pero no reemplazar la configuración estricta central.
- La parada de emergencia sólo muestra éxito cuando el HTTP fue realmente aceptado.
- La cola sólo acepta impresoras existentes en Farm Registry; una IP privada arbitraria ya no basta.

### Cámaras
- Las cámaras/snapshots se suspenden cuando el documento queda oculto y se reanudan al volver.
- La recuperación automática existente sigue verificando la cámara desde la LAN antes de reiniciar su stack.

### UX
El Centro inteligente incorpora **Estado de servicios**:
- Controller
- Telemetría
- Registry
- Historial
- Salud central
- Seguridad
- Cámaras
- Airtable

Cada fuente muestra estado y antigüedad para que el operador pueda decidir si confiar en el dato antes de actuar.

## Invariantes de regresión

Los tests nuevos comprueban, entre otros:
- CFS sólo K1 #1 y K2 Plus.
- complete requiere cama liberada.
- No hay reimpresión directa a Moonraker.
- START se revalida y pasa por Controller.
- La cola durable no cae a una cola local ambigua.
- print/start local debe responder OK antes de consumir la cola.
- El Controller posee lifecycle y registra cierres.
- La boquilla física participa del preflight.
- Los estados críticos no vuelven a disponible con un click.
- Agenda/estado/mantención tienen recuperación de sincronización.
- No existen multiplicadores ocultos de velocidad por modelo.