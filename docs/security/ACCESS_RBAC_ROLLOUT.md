# Activación controlada de identidad y permisos (Cloudflare Access)

La integración se incluye en código, **pero no está activada** mientras no se
configuren las variables Access del `airtable-proxy`. No confundir haber
integrado el código con haber protegido el dashboard publicado: la clave
compartida `APP_KEY` del frontend sigue siendo visible en modo legado.
Se necesita una transición conjunta de dominio, identidad, permisos, frontend
y rotación de credenciales. No modificar secretos durante esta fase.

## Protección incluida

- El proxy valida la firma RS256 del JWT `Cf-Access-Jwt-Assertion` contra
  `https://<equipo>.cloudflareaccess.com/cdn-cgi/access/certs`, además de
  emisor, aplicación (AUD), caducidad e identidad con rol explícito.
- Roles: `viewer` (lectura no financiera), `operator` (lectura y escritura
  operativa permitida), `finance` (datos comerciales y Facturas),
  `admin` (administración). El servidor deniega tablas, operaciones y rutas
  desconocidas sin un permiso explícito. Cualquier ruta o tabla que se añada
  en el futuro requiere revisión de los permisos.
- El rol se configura por identidad de correo verificada. Un JWT válido de
  otra aplicación, otro equipo o un correo sin rol no concede acceso.
- Si empieza a configurarse Access pero falta una variable, el proxy devuelve
  **503** en vez de volver a aceptar la clave compartida.
- Un registro de auditoría de las mutaciones autorizadas incluye identidad,
  rol, método y ruta (no carga útil, secretos ni documentos).

## Preparación para la activación, cuando se hagan todas las claves juntas

1. Crear una aplicación Cloudflare Access para el hostname del proxy y una
   política de acceso únicamente para usuarios autorizados. Configurar el
   navegador para mantener su sesión ante peticiones al proxy; probar OPTIONS
   y CORS desde el dominio real del dashboard. **No activar aún**: el frontend
   actual no implementa el inicio de sesión de Access.
2. En `airtable-proxy`, establecer **en conjunto** `ACCESS_ENFORCE=true`,
   `ACCESS_TEAM_DOMAIN=https://<equipo>.cloudflareaccess.com`,
   `ACCESS_AUD=<audiencia de la aplicación>` y `ACCESS_ROLE_MAP` como JSON,
   por ejemplo `{"finance@example.com":"finance","operador@example.com":"operator"}`.
   Los correos de ejemplo deben sustituirse por los reales. Guardar el mapa
   mediante las variables protegidas de Cloudflare, no en GitHub.
3. Antes de retirar la clave existente, migrar el frontend para usar la
   sesión Access y pasar por el proxy las llamadas privilegiadas actualmente
   hechas directamente a SII, portal y máquinas. Completar las pruebas de
   matriz de roles con los nombres de tablas reales, altas, bajas, aprobaciones
   y operaciones físicas. Los roles de este primer corte **solo** protegen
   el proxy Airtable/IA, no otros Workers.
4. Ensayar la transición con una cuenta por rol, otra sin rol y una sesión
   vencida, desde dos equipos. Verificar los endpoints GET y mutaciones
   del dashboard y que solicitudes con Origin falsificado y `X-App-Key`
   copiada no tengan acceso. Comprobar que los folios pendientes se concilien
   en certificación SII antes de probar emisión nueva.
5. Una vez verificada la ruta nueva, eliminar secretos maestros del HTML
   y del workflow GitHub Pages, revocar/rotar credenciales antiguas y
   verificar el código fuente del sitio publicado y sus caches.

En Cloudflare, proteger también el acceso directo a `workers.dev`. El
servidor verifica por sí mismo la firma del JWT y su audiencia aun cuando una
ruta de la red de distribución no esté protegida por Access. `/health`
del proxy permanece público, sin información personal.

**Importante:** esta etapa no es una afirmación de seguridad de producción
ni habilita el despliegue fiscal por sí sola. Requiere pruebas reales
y reconciliación de CAF/folios del SII.
