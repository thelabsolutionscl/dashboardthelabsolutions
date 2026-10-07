# Cutover final de seguridad y producción

> Estado: preparado en código, **no ejecutar parcialmente**.  
> Issues de cierre: #306 (seguridad/cutovers) y #113 (protección de main/aceptación).

## Regla de oro

No retirar, rotar ni invalidar una credencial legacy hasta que la ruta nueva equivalente
haya sido probada desde los navegadores/equipos reales. No marcar un bloque como aprobado
por el solo hecho de que el código o el deploy estén verdes.

## 0. Precondiciones automáticas

Antes de tocar producción:

- `main` sin PRs funcionales pendientes.
- Tests, Quality gate, Source security guards y CodeQL verdes.
- Deploy Dashboard y Deploy Cloudflare Workers verdes.
- `dashboard.thelab.solutions` publica el SHA esperado.
- `proxy.thelab.solutions` resuelve por DNS y `/health` responde.
- Habilitar GitHub Dependency Graph para que Dependency Review pueda ejecutarse.

Si cualquiera falla, detener el cutover.

## 1. DNS y Cloudflare Access

1. Crear/confirmar `proxy.thelab.solutions` apuntando al Worker correcto.
2. Proteger el hostname y el acceso directo `workers.dev` con Cloudflare Access.
3. Configurar juntos en `airtable-proxy`:
   - `ACCESS_ENFORCE=true`
   - `ACCESS_TEAM_DOMAIN`
   - `ACCESS_AUD`
   - `ACCESS_ROLE_MAP`
   - `ACCESS_SELLER_MAP` cuando corresponda.
4. Crear el Service Token exclusivo del lead-worker y configurar sus dos credenciales.
5. Comprobar OPTIONS/CORS desde `https://dashboard.thelab.solutions`.
6. Ejecutar **Verify Access rollout (read-only)** en etapa `before`.

### Aceptación

- sin sesión: 401/Access login, nunca datos;
- usuario sin rol: denegado;
- viewer: solo lectura autorizada;
- operator: operaciones permitidas, sin finanzas;
- finance: finanzas/SII según matriz;
- admin: administración dentro de rutas reconocidas;
- sales: solo registros de su propietario;
- Origin hostil: sin CORS credentialed.

## 2. Retiro de PROXY_KEY del navegador

Este bloque es obligatorio antes de declarar el artifact libre de secretos.

1. Cambiar el proxy para que `APP_KEY` sea requisito **solo en modo legacy**.
2. Con Access activo, la identidad firmada debe autorizar sin depender de una clave compartida.
3. Migrar el navegador a URL + sesión Access.
4. Eliminar `PROXY_KEY` del artifact Pages y purgar `proxy_key` histórico de Web Storage.
5. Mantener rollback al modo legacy hasta completar los E2E.
6. Ejecutar el escaneo `post`; debe demostrar que Pages no contiene:
   - `PROXY_KEY`
   - `SII_WORKER_KEY`
   - `PORTAL_ADMIN_KEY`
   - `PRINTER_TUNNEL_TOKEN`

No rotar PROXY_KEY hasta que el paso 4 esté confirmado.

## 3. CRM y estado compartido

Probar desde dos navegadores/equipos:

- lectura y escritura por rol;
- Calendario: crear/editar en A y comprobar en B;
- Agenda/estado compartido sin resurrectar versiones viejas;
- Cola/agentes y odómetro después de recargar;
- mutaciones concurrentes de Cliente → Cotización → Pedido;
- error/reintento ambiguo sin duplicados;
- modelo IA no autorizado → 403.

## 4. Correo

1. Validar cadena TLS real de `mail.thelab.solutions:993`.
2. Desplegar en cPanel exactamente el `mail-api.php` de `main`.
3. Proteger `mail-api.thelab.solutions/*` con Access/WAF según diseño.
4. Confirmar cuentas autorizadas y modo de cutover.
5. Probar: folders, list, snippets, read, send, trash/spam, mark, search,
   attachment y check.
6. Verificar 403 Origin, 405 método, 429 + Retry-After e idempotencia.
7. Confirmar SPF, DKIM y DMARC.

## 5. Printer Bridge / Farm Controller

1. Sincronizar Farm Controller del iMac con `main`.
2. Configurar en el iMac:
   - `BRIDGE_VIEWER_TOKEN`
   - `BRIDGE_OPERATOR_TOKEN`
   - `BRIDGE_ADMIN_TOKEN`
3. Configurar los valores equivalentes como secretos privados del proxy.
4. Proteger `printers.thelab.solutions` con Access; sin port-forwarding público.
5. Probar por rol:
   - telemetría;
   - cámaras;
   - WebSocket;
   - pause/resume/stop;
   - temperaturas/ejes solo donde corresponda.
6. Activar `PRINTER_ACCESS_MODE=true` y `PRINTER_CUTOVER_VERIFIED=true`.
7. Confirmar artifact sin token maestro y recién entonces revocarlo/rotarlo.

## 6. Portal y feedback

1. Configurar secretos privados del proxy/lead-worker.
2. Probar generar y revocar enlaces con usuarios reales.
3. Activar `PORTAL_ACCESS_MODE` + `PORTAL_CUTOVER_VERIFIED`.
4. Activar feedback firmado solo después del portal.
5. Confirmar que links legacy quedan rechazados y que Pages no contiene
   `PORTAL_ADMIN_KEY`.
6. Rotar la clave antigua después de la verificación.

## 7. SII

1. Configurar `SII_WORKER_URL` y `SII_WORKER_KEY` solo server-side.
2. Probar en certificación con roles finance/admin; viewer/operator deben fallar.
3. Conciliar CAF y folios antes de emitir.
4. Probar pérdida de respuesta: no reenviar automáticamente; conciliar primero.
5. Activar juntos:
   - `SII_ACCESS_MODE=true`
   - `SII_CUTOVER_VERIFIED=true`
6. Confirmar Pages sin clave fiscal.
7. Rotar la clave anteriormente publicada y limpiar caches.

## 8. Proveedores

- ejecutar `/suppliers/bootstrap` como admin;
- comprobar permisos schema del PAT;
- revisar casos históricos ambiguos;
- probar dos equipos reservando OC simultáneamente;
- confirmar que no se duplica correlativo y que relaciones históricas sobreviven.

## 9. LinkedIn

1. App aprobada para Lead Sync.
2. Permiso `r_marketing_leadgen_automation`.
3. Guardar Client ID/secret/tokens/admin key solo en Cloudflare.
4. Verificar challenge.
5. Verificar `X-LI-Signature` sobre body raw.
6. Probar dedupe de notificaciones y `leadFormResponses`.
7. Probar crear/listar/eliminar `leadNotifications`.
8. Probar conversión simultánea desde dos equipos.
9. Validar RBAC marketing/sales/operator/admin/finance.

## 10. Backups

- generar backup cifrado nuevo;
- descargar/restaurar una copia en entorno seguro;
- comparar conteos/estructura con la fuente;
- comprobar que un backup legacy no se elimina antes de cifrado + verificación;
- rotar la clave de backup únicamente después de validar restauración.

## 11. GitHub

En Settings → Security analysis:

- habilitar Dependency Graph.

En branch protection/ruleset de `main`:

- PR obligatorio;
- rama actualizada antes de merge;
- Quality gate requerido;
- Source security guards requerido;
- CodeQL requerido;
- Dependency review requerido;
- conversaciones resueltas;
- force push bloqueado;
- borrado de `main` bloqueado.

## 12. Aceptación final

Ejecutar **Verify Access rollout (read-only)** en etapa `post`.

Además:

- dos navegadores/equipos;
- todos los roles;
- Modo TV y fecha `America/Santiago`;
- correo real;
- impresoras/cámaras/WebSocket;
- restauración backup;
- artifact sin secretos;
- smoke público verde;
- revisar logs y métricas durante 24 h.

Solo después de 24 h sin errores críticos:

1. revocar definitivamente credenciales legacy;
2. eliminar excepciones temporales;
3. cerrar #306;
4. cerrar #113.

## Rollback

Ante un fallo durante el cutover:

1. no rotar la credencial legacy todavía;
2. revertir únicamente el flag del bloque afectado;
3. redeploy del último SHA conocido bueno;
4. conservar logs y revisions para diagnóstico;
5. no reintentar escrituras de resultado ambiguo a ciegas;
6. volver a ejecutar readiness antes de reanudar.
