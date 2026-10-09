# QA independiente de Cloudflare Access y permisos del CRM

**Estado: preparado en código, NO desplegado. Producción sin cambios.**

## Base Airtable de pruebas
Base **The Lab Solutions - Pruebas**: ID app55FbVNr3yhTlbL.
Workspace: The Lab Solutions - Operaciones.
Contiene 18 registros **ficticios**: 6 Clientes, 6 Cotizaciones y 6 Pedidos,
con relaciones internas y 2 registros por vendedor
(florencia, nicanor, gustavo). No se copió información real.
Base operativa **prohibida** en QA: app1YtD74AqiPWQhy.

La aplicación Cloudflare Access existente
**The Lab - Airtable Proxy - Pruebas** protege solamente las URL preview de
airtable-proxy, pero no existe un Preview desplegado. Los Previews del Worker
de producción pueden usar recursos reales. Por eso se prepara un Worker
completamente independiente.

## Worker QA independiente

Código: airtable-proxy-qa/src/worker.js.
Identificador de despliegue: thelab-rbac-qa.
Destino futuro: https://qa-proxy.thelab.solutions.
El worker no se despliega automáticamente, no expone workers.dev y
no tiene KV, Durable Objects, SII, impresoras, correo, Make o IA.

Protecciones de fallo cerrado:

- Requiere hostname exacto qa-proxy.thelab.solutions, QA_MODE=true
  y QA_BASE_ID=app55FbVNr3yhTlbL.
- Requiere QA_AIRTABLE_TOKEN independiente, con permiso de SOLO LECTURA
  en la base QA. Jamás copiar AIRTABLE_TOKEN o APP_KEY de producción.
- Requiere ACCESS_ENFORCE=true, ACCESS_TEAM_DOMAIN, ACCESS_AUD,
  ACCESS_ROLE_MAP y ACCESS_SELLER_MAP configurados conjuntamente.
  Reutiliza la validación criptográfica RS256 de airtable-proxy.
- Solo admin y sales pueden leer. sales exige Vendedor explícito y
  solo ve registros propios. Filtro en consulta y verificación al responder.
- Las respuestas no incluyen IDs de relaciones ni campos financieros.
  GET /access/me y GET /crm/Clientes, /crm/Cotizaciones y /crm/Pedidos.
  También permite GET /crm/{tabla}/{id} solo cuando es propio.
- Se deniegan POST, PATCH, DELETE, query arbitrarias, host alternativo,
  ruta de producción, usuario sin rol y configuraciones incompletas.
- No se utiliza ningún dato real en el repositorio.

## Instalación pendiente, sin intervenir producción

1. Crear en Airtable un nuevo Personal Access Token **solo para esta base**
   con data.records:read y ninguna otra base; almacenarlo como secreto.
2. Crear una NUEVA aplicación Cloudflare Access Self-hosted para
   qa-proxy.thelab.solutions, con Allow únicamente a correos autorizados
   y One-time PIN. La aplicación anterior de Preview no sirve para este Worker.
3. Copiar AUD y Team Domain de esa nueva aplicación e introducir EN CONJUNTO
   en el Worker de QA:
   - QA_AIRTABLE_TOKEN: secreto del paso 1
   - ACCESS_ENFORCE: true
   - ACCESS_TEAM_DOMAIN: https://<equipo>.cloudflareaccess.com
   - ACCESS_AUD: audiencia de esta aplicación QA
   - ACCESS_ROLE_MAP: JSON correo -> admin o sales
   - ACCESS_SELLER_MAP: JSON correo comercial -> florencia
   Sustituir las direcciones de ejemplo por identidades reales.
4. Desplegar únicamente desde airtable-proxy-qa usando
   npx wrangler deploy, tras validar todos los secretos y políticas.
   workers_dev=false y preview_urls=false impiden un endpoint público
   sin hostname. Asociar únicamente qa-proxy.thelab.solutions
   bajo protección de Access.
5. Desde incógnito comprobar /access/me, /crm/Clientes, cotizaciones y
   pedidos con admin y con sales. Sales jamás debe ver datos de otro
   vendedor; un ID ajeno devuelve 404. POST/PATCH debe devolver 405.
   Verificar usuario sin rol, otro correo y JWT caducado.
6. Adaptar vistas comerciales de legacy frontend y las escrituras por
   propietario antes de la activación real del dashboard. La puesta
   en marcha de SII, portal, impresoras y eliminación de APP_KEY se
   mantiene separada, bajo docs/security/FINAL_CUTOVER_CHECKLIST.md.

**IMPORTANTE:** No activar ACCESS_ENFORCE ni SII_ACCESS_MODE en
airtable-proxy de producción, ni rotar credenciales actualmente utilizadas.
No fusionar registros ficticios a la base real.

## Limitaciones conocidas

- Este QA es de lectura; no es una réplica funcional del dashboard entero.
- La lista verificada de propietarios en el backend actual sigue limitada
  a florencia, nicanor y gustavo. Dar de alta futuros vendedores requiere
  actualizar opciones Vendedor y validar su asignación en el servidor;
  añadir solamente su correo a Cloudflare no alcanza.
- Las mutaciones comerciales en producción requieren corte de frontend,
  conciliación de escritores externos y aprobación de
  ACCESS_SALES_WRITES_ENABLED. Permanecen desactivadas.
- No se pueden ejecutar E2E de Cloudflare hasta crear la nueva aplicación
  Access, PAT restringido y hostname QA.

Pruebas automatizadas: node --test tests/access-qa-isolation.test.js.
Verificación criptográfica compartida: tests/access-rbac.test.js.
