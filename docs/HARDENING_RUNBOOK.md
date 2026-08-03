# Runbook de hardening y puesta en producción

Este documento separa cambios de código ya implementados de operaciones que
requieren acceso humano a Cloudflare, GitHub Secrets, Airtable, proveedores de
IA, cPanel y el iMac del taller.

## Estado de componentes

| Componente | Código | Configuración externa |
|---|---|---|
| Deploy seguro | Implementado | Activar protección de rama |
| Backups cifrados | Implementado | Crear `BACKUP_ENCRYPTION_KEY` y borrar artifacts antiguos |
| Dashboard Gateway | Implementado | Access, AUD, roles, secretos, KV y Audit_Log |
| Cliente de Gateway | Implementado | Iniciar sesión Access una vez por navegador |
| Calendario compartido | Implementado | KV `DASHBOARD_STATE` |
| Cola/odómetro compartidos | Implementado | KV `DASHBOARD_STATE` |
| Modo TV | Implementado | Prueba visual en televisor real |
| Printer Bridge seguro | Implementado | `printers.json`, Access, instalación en iMac |
| Correo TLS/rate limit | Parche preparado | Subir PHP endurecido a cPanel |
| Rotación de secretos | No automatizable | Ejecutar checklist de este documento |

## Fase 0 — congelar y respaldar

1. Evitar cambios manuales en Airtable mientras se prueba la migración.
2. Descargar una copia de seguridad actual por un canal privado.
3. Guardar una copia del `mail-api.php` desplegado y de la configuración del
   Printer Bridge actual.
4. Anotar todos los secretos que deben rotarse, sin pegarlos en issues o PRs.

## Fase 1 — artifacts históricos

En GitHub:

1. Actions → workflow **Automatización semanal**.
2. Abrir ejecuciones históricas.
3. Eliminar todos los artifacts `backup-crm-*` no cifrados.
4. Settings → Actions → Artifacts and logs: confirmar retención adecuada.
5. Crear secret `BACKUP_ENCRYPTION_KEY` con 32+ caracteres aleatorios.
6. Guardar la misma clave en el gestor de contraseñas empresarial.
7. Ejecutar manualmente el workflow nuevo.
8. Descargar `.json.enc` y probar:

```bash
BACKUP_ENCRYPTION_KEY='...' \
node scripts/decrypt-backup.mjs backup-crm-AAAA-MM-DD.json.enc restaurado.json
```

9. Abrir el JSON restaurado y confirmar tablas/recuentos.
10. Borrar la copia restaurada del computador usado para la prueba.

## Fase 2 — Cloudflare Access para el Dashboard Gateway

1. Crear un hostname dedicado, por ejemplo `gateway.thelab.solutions`.
2. Zero Trust → Access → Applications → Self-hosted.
3. Proteger `gateway.thelab.solutions/*`.
4. Política Allow solo para cuentas The Lab autorizadas.
5. Copiar el **Application Audience Tag**.
6. Configurar:

```text
CF_ACCESS_TEAM_DOMAIN=https://<equipo>.cloudflareaccess.com
CF_ACCESS_AUD=<AUD>
WRITE_EMAILS=<equipo que modifica CRM>
ADMIN_EMAILS=<administradores>
ALLOW_LEGACY_APP_KEY=false
ALLOW_AIRTABLE_DELETE=false
```

7. Crear la tabla `Audit_Log` o cambiar `AUDIT_TABLE` a una tabla existente.
8. Revisar `AIRTABLE_ALLOWED_TABLES` y eliminar las no utilizadas.
9. Crear KV:

```bash
cd airtable-proxy
npx wrangler kv namespace create DASHBOARD_STATE
```

10. Agregar el binding real a `wrangler.toml`.
11. Instalar secretos nuevos:

```bash
npx wrangler secret put AIRTABLE_TOKEN
npx wrangler secret put ANTHROPIC_TOKEN
npx wrangler secret put OPENAI_TOKEN
npx wrangler secret put CF_ACCESS_AUD
```

12. Desplegar y comprobar `/health`.
13. Iniciar sesión Access y probar una lectura, escritura permitida y escritura
    denegada con un usuario reader.

## Fase 3 — rotar credenciales

Para cada proveedor:

1. Crear credencial nueva con mínimo alcance.
2. Configurar límites de gasto/uso.
3. Guardarla server-side.
4. Probar una operación real.
5. Revocar la anterior.

Orden recomendado:

- Airtable.
- Anthropic.
- OpenAI.
- ElevenLabs.
- Resend si estuvo expuesta.
- Clave APP/Proxy legacy.
- Token antiguo de impresoras.
- Clave administrativa del portal si existió en HTML.

Eliminar de GitHub Secrets los valores que el frontend ya no utiliza:

```text
OPENAI
CLAUDE
ELEVENLABS
PROXY_KEY
PRINTER_TUNNEL_TOKEN
PORTAL_ADMIN_KEY
```

Mantener solo secretos realmente usados por componentes server-side.

## Fase 4 — Printer Bridge

En el iMac:

```bash
cd ~/dashboardthelabsolutions/printer-bridge
cp printers.example.json printers.json
nano printers.json
```

Ingresar todas y solo las IP reales.

Configurar roles:

```bash
export BRIDGE_ADMIN_EMAILS='...'
export BRIDGE_WRITE_EMAILS='...'
./install-launchd.sh
```

Cloudflare:

1. Tunnel → `printers.thelab.solutions` → `http://127.0.0.1:8347`.
2. Access → proteger `printers.thelab.solutions/*`.
3. No abrir puertos en el router.
4. Confirmar que la URL directa de Workers/Tunnel no tenga bypass.

Pruebas:

- reader ve telemetría y cámara;
- reader no puede pausar ni subir archivo;
- writer pausa/reanuda;
- writer no ejecuta G-code;
- admin ejecuta una operación controlada;
- una IP no declarada devuelve 403;
- `?bt=algo` no entrega acceso;
- logs contienen `bridgeAudit` sin tokens.

## Fase 5 — correo

1. Confirmar que `mail.thelab.solutions` presenta un certificado válido para el
   hostname usado por IMAP.
2. Subir el `mail-api.php` endurecido a cPanel.
3. Proteger `mail-api.thelab.solutions/*` con Access o WAF.
4. Probar:

```bash
curl -i https://mail-api.thelab.solutions/mail-api.php
```

Debe responder JSON, `no-store` y nunca mostrar errores internos.

5. Probar Origin no permitido: debe devolver 403.
6. Probar certificado inválido en staging: la conexión IMAP debe fallar, no
   continuar silenciosamente.
7. Probar envío, lectura, papelera, adjuntos y búsqueda.
8. Verificar SPF, DKIM y DMARC.

## Fase 6 — dashboard

1. Configurar `PROXY_URL` y `PRINTER_TUNNEL` con los hostnames Access.
2. Lanzar el deploy.
3. Ver código fuente y buscar:

```text
sk-
sk-ant-
pat
re_
PROXY_KEY
PRINTER_TUNNEL_TOKEN
```

No debe aparecer ninguna credencial real.

4. Abrir el Gateway y Printer Bridge una vez para iniciar sesión Access.
5. Probar CRM, agentes, PDFs, correo, impresoras, calendario, Modo TV y offline.
6. Confirmar que Calendario muestra “Sincronizado”.
7. Abrir dos navegadores y verificar que etapa, bloqueo y cola se replican.

## Fase 7 — branch protection

En Settings → Branches/Rulesets para `main` exigir:

- PR obligatorio.
- Branch actualizado antes de merge.
- Quality gate.
- Source security guards.
- CodeQL.
- Dependency review cuando aplique.
- Conversaciones resueltas.
- Bloqueo de force push y borrado de `main`.

## Smoke tests posteriores al deploy

- HTML y assets responden 200.
- Service worker instala la versión nueva.
- No hay errores no controlados en consola.
- Gateway health responde.
- Airtable lectura/escritura autorizada funciona.
- Usuario reader recibe 403 al escribir.
- IA rechaza un modelo no permitido.
- Estado KV incrementa ETag.
- Impresoras reportan telemetría reciente.
- Modo TV rota sin reiniciar timer.
- “Hoy” coincide con fecha de Santiago entre 20:00 y 23:59.
- Backup semanal cifrado y restaurable.

## Rollback

Si el gateway nuevo bloquea la operación:

1. No reinsertar secretos en el HTML.
2. Mantener frontend en modo solo lectura/local.
3. Revertir el Worker al despliegue anterior server-side.
4. Corregir Access/AUD/roles.
5. Desplegar nuevamente y probar con usuario reader primero.

Si el Printer Bridge falla:

1. Detener `secure-launcher.js`.
2. Conservar el túnel cerrado; no publicar `server.js` en internet.
3. Usar acceso local directo temporalmente desde el taller.
4. Corregir allowlist/configuración y reinstalar.

## Criterio de cierre

La migración se considera terminada solo cuando:

- no existen artifacts CRM planos;
- todos los secretos antiguos están revocados;
- Access protege ambos hostnames;
- KV y auditoría funcionan;
- Printer Bridge seguro está instalado;
- mail API valida TLS;
- branch protection exige CI;
- una restauración cifrada fue probada;
- smoke tests productivos están documentados.
