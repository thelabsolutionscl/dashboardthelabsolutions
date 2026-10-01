# Centro de Conexiones · Conectar y verificar

El **Centro de conexiones**, accesible desde el menú de usuario (**Mi cuenta → Centro de conexiones**), ofrece dos acciones separadas por integración: **Conectar / configurar** y **Verificar conexión**. El semáforo verde solo se muestra si una prueba de solo lectura responde correctamente; tener una credencial presente NO significa que sea válida. No se llama a modelos de IA para verificarlos.

## Verificaciones de bajo impacto

- Claude: el proxy llama a `GET https://api.anthropic.com/v1/models?limit=1` con su secreto `ANTHROPIC_TOKEN`. No ejecuta mensajes ni consume tokens de inferencia.
- OpenAI: el proxy llama a `GET https://api.openai.com/v1/models` con `OPENAI_TOKEN`. No genera chat, imágenes ni embeddings.
- Make: requiere los nuevos secretos de Cloudflare `MAKE_API_TOKEN` y `MAKE_API_ZONE` (uno de `eu1`, `eu2`, `us1`, `us2`, `ca1`, `au1`; por defecto `eu1`). El token necesita `organizations:read` para `GET /api/v2/organizations`. El monitor NO dispara webhooks.
- Meta: opcional `META_ACCESS_TOKEN` en el proxy, con permiso de lectura de identidad. GET `/me?fields=id`; no publica.
- Resend: agregar el `mail-api.php` actualizado al servidor **mail-api.thelab.solutions**. Después de autenticar una cuenta IMAP, verifica el permiso de envío contra `POST /emails` con un payload vacío. Resend debe responder 422 por validación: eso confirma que la clave puede usar la ruta de envío sin crear ni entregar ningún correo. La clave nunca abandona el servidor y funciona con API keys `Sending access`.
- Google Ads: GET existente al endpoint de Google Apps Script (`days=1`). Solo se permiten URLs de `script.google.com`. El éxito certifica lectura, no permiso para editar campañas.

Todos los métodos del proxy para comprobar integraciones externas son GET, con proveedor y destinos fijos, sin redirecciones y sin devolver cuerpos externos, API keys o datos personales. Cloudflare Access, cuando está habilitado, exige rol `admin`; el modo legado sigue usando clave compartida y origen validado, por lo que la configuración de Access sigue siendo necesaria para asegurar el backend.

## Acciones de conexión

Google Calendar y Drive usan el OAuth existente, siempre tras clic del usuario; IMAP abre el acceso de Correo; Google Ads lleva a su configuración de WEB. El proxy, bridge y Airtable se configuran desde Mi cuenta. Las claves de Claude, OpenAI, Make y Meta se ingresan únicamente como secretos en Cloudflare; la de Resend se instala únicamente en el servidor de correo. Cada guía abre la consola oficial correspondiente en una pestaña nueva, nunca un formulario de claves embebido en Pages.

## Comprobación tras despliegue

1. Verificar que GitHub Pages y Cloudflare Worker publicaron el mismo cambio y que las pruebas CI aprobaron.
2. En sesión de administrador, abrir **Mi cuenta → Centro de conexiones** y pulsar **Verificar conexión** en las APIs. Una clave válida debe pasar a verde, una inválida a rojo y una no configurada a gris.
3. Conectar Google Calendar y Drive en la sesión real; después volver a verificar. Verificar IMAP autenticando la casilla y comprobando carpetas. 
4. El `mail-api.php` del alojamiento se actualiza de forma manual; sin esa instalación el diagnóstico de Resend debe permanecer amarillo y NO declarar una conexión verificada.
5. No publicar claves en GitHub, tickets, screenshots, URL del navegador o campos de la página.
