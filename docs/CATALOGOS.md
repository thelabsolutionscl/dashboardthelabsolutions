# Catálogos TLS · biblioteca compartida de PDF

La pestaña **Catálogos** permite subir PDF, buscar, filtrar, previsualizar en el
dashboard, descargar y eliminar. El diseño sigue la identidad oscura/turquesa de
The Lab Solutions y se adapta a escritorio y móvil.

## Requisitos para activarlo

1. **Antes del merge/despliegue del Worker**, crear un bucket R2 privado en la
   misma cuenta Cloudflare donde corre `airtable-proxy`:

   ```bash
   cd airtable-proxy
   npx wrangler r2 bucket create tls-catalogos
   ```

   Alternativamente, Cloudflare Dashboard → R2 → Crear bucket → `tls-catalogos`.
   No habilitar `r2.dev` ni dominio público. Ya está declarado en
   `airtable-proxy/wrangler.toml` con binding `CATALOGOS_BUCKET`.

2. Habilitar **Cloudflare Access firmado** en el proxy existente: `ACCESS_ENFORCE=true`,
   `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ACCESS_ROLE_MAP`, y, para cuentas
   comerciales, `ACCESS_SELLER_MAP`. Ver la guía de seguridad existente.
   La contraseña local del dashboard y la antigua `APP_KEY` **no sustituyen**
   la identidad verificada por Access.

3. Desplegar el Worker y el dashboard por sus workflows existentes
   (`.github/workflows/deploy-worker.yml` y `deploy.yml`). La pestaña está
   incluida en el menú desktop y móvil y su código se cache-bustea con
   `%%BUILD%%`.

## Permisos efectivos (servidor)

| Acción | Rol Access |
| --- | --- |
| Listar y visualizar PDF | viewer, sales, operator, finance, admin |
| Subir PDF | sales, operator, finance, admin |
| Eliminar PDF | **admin** únicamente |

Cada solicitud se valida de nuevo en el Worker; los controles ocultos del
frontend son solo una comodidad. Los PDF no se almacenan en GitHub Pages ni en
`localStorage`.

## API

- `GET /catalogos` — lista hasta 200 documentos; `?cursor=...` para continuar.
- `POST /catalogos` — `multipart/form-data` con `file`, `name`, `category`.
  Máximo 25 MiB, PDF con firma `%PDF-`.
- `GET /catalogos/:uuid` — PDF inline y protegido; solo navegador autorizado.
- `DELETE /catalogos/:uuid` — borrado permanente, solo administrador.

Todos los endpoints requieren la sesión JWT Cloudflare Access. Los objetos R2
se guardan como `catalogos/<uuid>.pdf` con nombre, categoría, fecha y autor
en customMetadata. Las vistas usan Blob URLs temporales revocadas al cerrarse,
sin publicar enlaces compartibles.

## Validación antes de habilitarlo en producción

- Ejecutar `node --test tests/catalogos.test.js` y el CI completo.
- Probar con una cuenta admin: cargar, visualizar, descargar, filtrar y borrar.
- Probar con una cuenta comercial: cargar y visualizar, sin opción de eliminar.
- Probar sin sesión Cloudflare Access: 401 y ningún PDF legible.
- Comprobar con un PDF de más de 25 MB y un fichero renombrado a `.pdf`:
  ambos deben rechazarse.
- Comprobar que el bucket R2 no tiene endpoint público.

**Limitación de lanzamiento:** el código de la pestaña no provisiona recursos
Cloudflare. Si el bucket aún no existe, el despliegue del Worker puede fallar
por el binding R2; si falta el binding en ejecución, la API responde 503 con
mensaje explícito. Preparar Cloudflare antes de integrar el PR.
