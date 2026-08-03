# Seguridad — Dashboard The Lab Solutions

## Principios obligatorios

1. **Ninguna credencial de servicio vive en el navegador.**
2. **CORS no reemplaza autenticación.**
3. **Toda escritura requiere identidad y rol.**
4. **Los respaldos salen cifrados antes de abandonar el runner.**
5. **Las impresoras se controlan mediante allowlist exacta y mínimo privilegio.**
6. **Un despliegue no ocurre si fallan pruebas o guardas de seguridad.**

## Arquitectura

```text
Navegador
  ├─ Cloudflare Access cookie ─▶ Dashboard Gateway
  │                              ├─ Airtable allowlist
  │                              ├─ Anthropic/OpenAI allowlist
  │                              └─ KV de estado operacional
  └─ Cloudflare Access cookie ─▶ Printer Bridge seguro
                                 └─ impresoras declaradas
```

GitHub Pages recibe únicamente archivos de `dist/`. El workflow excluye código
server-side, scripts, tests, documentación y configuraciones privadas.

## Configuración pública permitida

Los únicos valores que el build puede insertar son identificadores o URLs
públicas:

- `GOOGLE_CLIENT_ID`
- `SII_WORKER_URL`, `SII_RUT_EMISOR`, `SII_RAZON_SOCIAL`
- `PROXY_URL`
- `PRINTER_TUNNEL`
- `ADS_WEBAPP`, `ADS_CUSTOMER`
- `LEAD_WORKER_URL`, `PUBLIC_LEAD_KEY`
- `TURNSTILE_SITE_KEY`

El script `scripts/inject-public-config.mjs` elimina y comprueba que no queden:

- Airtable PAT.
- OpenAI/Anthropic/ElevenLabs keys.
- `PROXY_KEY`.
- `PRINTER_TUNNEL_TOKEN`.
- Claves administrativas del portal.

No existe un modo de despliegue que vuelva a hornear esos secretos.

## Dashboard Gateway

`airtable-proxy/src/worker.js` funciona como gateway autenticado:

- Valida el JWT RS256 emitido por Cloudflare Access.
- Comprueba `issuer`, `audience`, expiración e identidad.
- Asigna roles por email: `reader`, `writer`, `admin`.
- Restringe Airtable a una base y tablas explícitas.
- Bloquea DELETE salvo habilitación extraordinaria + rol admin.
- Limita rutas y modelos de IA.
- Limita tamaño, frecuencia y `max_tokens`.
- Registra operaciones sensibles en una tabla de auditoría opcional.
- Expone estado compartido versionado para Calendario, cola y odómetro.

La compatibilidad `APP_KEY` está apagada por defecto y solo puede activarse para
una migración controlada. Incluso en ese modo exige un Origin permitido.

## Cloudflare Access

Variables mínimas del gateway:

```text
CF_ACCESS_TEAM_DOMAIN=https://EQUIPO.cloudflareaccess.com
CF_ACCESS_AUD=<Application Audience Tag>
WRITE_EMAILS=...
ADMIN_EMAILS=...
AIRTABLE_BASE_ID=...
AIRTABLE_ALLOWED_TABLES=...
```

Secrets server-side:

```bash
cd airtable-proxy
npx wrangler secret put AIRTABLE_TOKEN
npx wrangler secret put ANTHROPIC_TOKEN
npx wrangler secret put OPENAI_TOKEN
npx wrangler secret put CF_ACCESS_AUD
```

El hostname del Worker debe estar protegido completamente por Access y
`workers_dev=false` evita una segunda URL sin esa política.

## Estado operacional compartido

Crear un namespace KV y vincularlo como `DASHBOARD_STATE`:

```bash
cd airtable-proxy
npx wrangler kv namespace create DASHBOARD_STATE
```

Después agregar el ID real a `wrangler.toml` y desplegar. Sin KV, Calendario y
producción mantienen fallback local y muestran el error de sincronización; no
fingen que están compartidos.

## Printer Bridge

Usar `printer-bridge/secure-launcher.js`, no publicar `server.js` directamente.

- Escucha en `127.0.0.1`.
- Cloudflare Tunnel apunta a ese loopback.
- Cloudflare Access entrega el email autenticado.
- `printers.json` contiene IPs exactas.
- Lectura, producción y administración son permisos separados.
- `?bt=` se elimina.
- El token interno nunca sale del iMac.
- El bridge legado también queda en loopback y no imprime su token.

Detalles en `printer-bridge/README.md`.

## Correo

`mail-api.php` debe cumplir:

- IMAP TLS con certificado validado: `/imap/ssl`, nunca `novalidate-cert`.
- Origin exacto y rechazo 403 para cualquier otro.
- Solo POST/OPTIONS.
- `Cache-Control: no-store`.
- Rate limit local más protección del edge.
- Resend key solo en el servidor.
- Sin mensajes internos o credenciales en las respuestas.

El correo todavía usa usuario/contraseña para abrir IMAP. Como siguiente etapa,
el dominio debe quedar detrás de Cloudflare Access y migrarse a una sesión
HttpOnly breve. Hasta entonces, CSP/XSS, rate limit y TLS son controles críticos.

## Backups

El workflow semanal:

1. Descarga Airtable a un archivo temporal.
2. Cifra con AES-256-GCM y scrypt.
3. Verifica que no quede JSON plano.
4. Publica únicamente `.json.enc` y `manifest.json`.
5. Retiene 30 días.

Secret obligatorio:

```text
BACKUP_ENCRYPTION_KEY=<frase aleatoria de 24+ caracteres>
```

La clave debe guardarse también fuera de GitHub, en el gestor de contraseñas de
la empresa. Sin esa copia, el respaldo no se puede restaurar.

Restauración:

```bash
BACKUP_ENCRYPTION_KEY='...' \
node scripts/decrypt-backup.mjs backup/backup-crm-AAAA-MM-DD.json.enc
```

Realizar una restauración de prueba mensualmente.

## Rotación inicial obligatoria

Como valores antiguos pudieron aparecer en HTML o URLs, rotar después de
configurar el nuevo gateway:

- Airtable PAT.
- Anthropic API key.
- OpenAI API key.
- ElevenLabs key.
- APP/Proxy key anterior.
- Token anterior del Printer Bridge.
- Claves administrativas públicas anteriores.

Orden seguro:

1. Crear credencial nueva.
2. Instalarla server-side.
3. Probar health + operación real.
4. Revocar la antigua.
5. Revisar logs y gasto durante 24 horas.

## Respuesta a incidentes

1. Deshabilitar la aplicación o sesión comprometida en Cloudflare Access.
2. Rotar la credencial afectada.
3. Bloquear escrituras del gateway (`WRITE_EMAILS` y `ADMIN_EMAILS` vacíos).
4. Revisar Audit_Log, logs del Worker y `bridgeAudit`.
5. Confirmar que el artifact público no contiene patrones `sk-`, `sk-ant-`,
   `pat...` o `re_...`.
6. Revisar cambios de Airtable y operaciones de impresoras.
7. Documentar alcance, tiempo y recuperación.

## Reporte responsable

No abrir un issue público con datos sensibles. Reportar directamente al dueño
del repositorio incluyendo:

- componente afectado;
- pasos mínimos de reproducción;
- impacto probable;
- hora aproximada;
- request ID, sin copiar tokens ni datos de clientes.
