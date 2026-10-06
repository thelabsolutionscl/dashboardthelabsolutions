# Auditoría de VISUAL AI

## Actualización 2026-10-06 — cierre operacional de #102

Se reabrió el cierre de Visual AI después del PR #430 porque aún faltaban acciones exigidas por el criterio de aceptación y la cuota previa no mostraba consumo real.

**Cerrado en esta pasada:**

- la consulta de cuota ahora lee el contador real del Durable Object sin reservar ni consumir una generación y devuelve usadas, límite y restantes;
- cuando MuAPI no expone una tarifa previa fiable, la interfaz lo dice explícitamente como **costo previo no disponible** en lugar de inventar una estimación;
- **Drive** guarda el archivo remoto real dentro de una carpeta `Visual AI`; exige HTTPS, descarga sin credenciales, rechaza redirects, limita a 25 MB y valida MIME antes de subir;
- si el asset remoto no puede descargarse (por ejemplo, CORS/host no compatible), Drive falla de forma visible y no declara un guardado ficticio;
- **Referencia visual/producto** usa la tabla editorial real `Contenido`, verificada contra Airtable, y crea una fila en estado `Idea` con `Título post`, `Sugerencia visual` y trazabilidad del job/modelo;
- **Redes Sociales** crea únicamente un registro `Social_Posts` en estado `Borrador`; Visual AI nunca marca un resultado como publicado;
- Cliente, Cotización y Pedido conservan la vinculación directa incorporada en #430;
- `Contenido` entra al catálogo Access como tabla admin-only hasta que exista un alcance por registro/campo específico;
- el historial sigue siendo deliberadamente **de esta sesión** y así se informa en la interfaz, cumpliendo la alternativa segura definida por la auditoría.

Con esto, el flujo funcional cubre Drive + Cliente + Cotización + Pedido + referencia editorial/producto + borrador de Redes. La única dependencia externa restante es la configuración productiva final de `MUAPI_KEY` y el smoke real de hosts/CORS de assets, agrupados con el cutover de seguridad.

## Actualización 2026-10-06 — cierre de seguridad e integración

Se revalidó Visual AI contra el dashboard actual y OpenGen Studio. La integración
seguía activa, pero conservaba los riesgos principales de la auditoría original.

**Corregido en esta pasada:**

- OpenGen elimina `corsproxy.io` y cualquier API key de MuAPI del navegador;
- `MUAPI_KEY` queda exclusivamente en el Worker/proxy TLS;
- nueva ruta `POST /visual-ai/rpc`, protegida por Cloudflare Access y RBAC;
- OpenGen embebido usa un contrato `postMessage` versionado con origen exacto,
  source validado y handshake `ready/host-ready`;
- OpenGen abierto en nueva pestaña puede usar el mismo proxy directamente, sin
  `APP_KEY`, pero únicamente con identidad Cloudflare Access firmada;
- Durable Object reserva cada `jobId`, evita duplicados/resultados inciertos y
  aplica cuota diaria antes de contactar al proveedor;
- endpoint/modelo, payload, uploads y URLs de resultado tienen allowlists y
  validación fail-closed;
- archivos locales validan MIME, extensión, firma, tamaño y dimensiones antes de
  leer/subir el contenido;
- jobs congelan sección/modelo/parámetros, usan `AbortController`, backoff,
  timeout total y reintento limitado de errores transitorios;
- errores, resultados e historial construyen DOM con `textContent/createElement`
  y validan URLs HTTPS;
- video/audio requieren confirmación adicional y toda generación exige confirmar
  derechos/autorización sobre material, rostro o voz;
- historial queda rotulado explícitamente como **de esta sesión**;
- se muestran cuota, duración y costo real cuando MuAPI lo informa; si no existe
  costo en la respuesta se declara expresamente;
- iframe se endurece antes de cargar el remoto: sandbox mínimo, no-referrer,
  permisos reducidos, timeout/retry y descarga al abandonar la sección;
- resultados pueden vincularse desde OpenGen a Cliente, Cotización o Pedido sin
  descarga/re-subida manual;
- OpenGen aplica CSP, Referrer-Policy y Permissions-Policy.

**Configuración productiva pendiente:** crear/rotar `MUAPI_KEY` como secreto del
proxy y realizar un smoke real contra MuAPI para confirmar hosts de assets. La
allowlist de URLs de resultado falla cerrada ante dominios no reconocidos.

**Pruebas activas:**

- `tests/visual-ai-wiring.test.js`;
- `tests/access-visual-ai-route.test.js`;
- `Open-Generative-AI/tests/opengen-wiring.test.js`.

Fecha: 2026-08-02

## Alcance

La sección `visual` no implementa la generación dentro del dashboard. Carga mediante iframe la aplicación externa:

- `thelabsolutionscl/Open-Generative-AI`
- publicación: `https://thelabsolutionscl.github.io/Open-Generative-AI/`

Se revisaron ambos lados:

1. integración y ciclo de vida del iframe en `dashboardthelabsolutions`;
2. generación, uploads, API key, polling, resultados e historial en OpenGen Studio.

## Flujo actual verificado

1. El usuario abre VISUAL AI.
2. El dashboard reemplaza `about:blank` por la URL de OpenGen únicamente al activar la pestaña.
3. El iframe oculta el fallback cuando dispara `load`.
4. OpenGen permite elegir entre Texto→Imagen, Editar, Imagen→Video, Texto→Video, VFX, Audio y Upscale.
5. La API key se mantiene en una variable de memoria y no se guarda en `localStorage`.
6. Una imagen local se convierte a JPEG, se comprime y se sube antes de crear la solicitud.
7. La solicitud se envía a MuAPI y se consulta su estado hasta éxito, error o timeout.
8. El resultado se muestra con opción de descarga y se agrega a un historial temporal.

## Cobertura automática

Dashboard:

- `tests/visual-ai-wiring.test.js`
- `.github/workflows/visual-ai-audit.yml`

OpenGen:

- `tests/opengen-wiring.test.js`
- `.github/workflows/opengen-audit.yml`

## Hallazgos originales de la auditoría (histórico)

> Esta lista conserva el diagnóstico inicial. Las correcciones vigentes están documentadas en las actualizaciones superiores y no debe leerse como estado actual de `main`.


### 1. Credenciales y contenido pasan por un proxy público

OpenGen envía la API key, prompts, imágenes y polling mediante `corsproxy.io`.

Aunque la key no persiste en el navegador, queda expuesta a un tercero que no forma parte de la arquitectura de The Lab. También pasan por ese servicio imágenes y material potencialmente confidencial de clientes.

Corrección esperada: Worker/backend propio, autenticado, con allowlist de endpoints, límites, auditoría y secretos del proveedor almacenados en servidor.

### 2. Inyección de HTML desde respuestas remotas

`setResultError()`, `setResultMedia()` y `renderHistory()` interpolan mensajes y URLs dentro de `innerHTML`.

Una respuesta manipulada del proveedor o proxy podría introducir atributos o HTML ejecutable.

Corrección esperada: crear nodos DOM, usar `textContent`, validar URLs y aceptar únicamente `https:` desde hosts autorizados.

### 3. Uploads sin validación suficiente

`handleDrop()` comprueba superficialmente `image/*`, pero `handleFileInput()` envía cualquier archivo seleccionado a `readFile()`. No existe límite explícito de tamaño, dimensiones, extensión o firma real.

La compresión posterior no evita que un archivo enorme se lea completo en memoria.

### 4. URLs externas sin política restrictiva

`handleUrlInput()` acepta cualquier URL reconocida por `new URL()`. Debe restringirse a HTTPS y validar que el recurso sea una imagen permitida antes de enviarlo al proveedor.

### 5. Generaciones cruzadas al cambiar de sección

`generate()` captura parte del contexto, pero durante el polling sigue leyendo `currentSection`. Si el usuario cambia de sección, el progreso, tipo y metadatos pueden quedar asociados al panel equivocado.

Se requiere un objeto de trabajo inmutable y `AbortController` para cancelar.

### 6. Polling sin tolerancia operativa

Las consultas de estado no verifican `response.ok` antes de decodificar JSON, usan intervalo fijo y no distinguen errores transitorios.

Se requiere backoff, límite temporal explícito, cancelación y recuperación de trabajos pendientes.

### 7. Sin costo ni límites visibles

La interfaz permite iniciar modelos de imagen, video, audio y voz sin mostrar costo estimado, saldo, cuota o confirmación reforzada para procesos caros.

Debe registrarse proveedor, modelo, costo estimado/real, duración, usuario y resultado.

### 8. Privacidad, licencias y voz

No existe una advertencia visible sobre:

- material confidencial de clientes;
- derechos sobre imágenes de referencia;
- autorización para usar rostros o clonar voces;
- retención del proveedor;
- contenido generado y licencia de uso.

### 9. Historial únicamente temporal

El historial se conserva solo en una variable JavaScript. Se pierde al recargar, no identifica al usuario y no puede consultarse desde otro dispositivo.

La pantalla debe indicarlo explícitamente o guardar metadatos y archivos en una fuente compartida segura.

### 10. Tecla Enter no guarda la primera key

El listener del modal ejecuta `saveKey()` con Enter únicamente cuando `apiKey` ya tiene valor. La primera configuración requiere hacer clic.

### 11. Código muerto de subida

`uploadToImgbb()` contiene una clave temporal ficticia y no participa en el flujo actual. Debe eliminarse para evitar confusión o una futura reactivación insegura.

### 12. Iframe sin aislamiento suficiente

El iframe solicita cámara, micrófono, portapapeles y fullscreen. No declara `sandbox` ni `referrerpolicy`.

Los enlaces que abren otra pestaña tampoco garantizan `rel="noopener noreferrer"`.

### 13. `load` no demuestra que OpenGen esté operativo

El dashboard oculta el fallback y marca “Live” al recibir `iframe.onload`. Una página de error, login, bloqueo o versión incompatible también puede disparar ese evento.

Se requiere un handshake `postMessage` con:

- origen exacto permitido;
- versión del contrato;
- estado `ready`;
- capacidades disponibles;
- error de inicialización;
- costo/resultado de cada trabajo.

### 14. Sin vínculo con CRM ni operaciones

Los resultados solo pueden descargarse. No existe una acción para:

- guardar en Drive;
- asociar a Cliente;
- adjuntar a Cotización o Pedido;
- crear un producto o referencia visual;
- enviar a Redes Sociales.

Esto rompe el orden lógico entre creación visual y ejecución comercial.

### 15. Sin política CSP propia

OpenGen es una página HTML pública con scripts inline y múltiples conexiones externas. Debe aplicar Content-Security-Policy, Referrer-Policy y Permissions-Policy coherentes con sus funciones reales.

## Criterio de cierre

- Backend propio; ninguna key o imagen de cliente pasa por un proxy público.
- DOM y URLs remotas sanitizados.
- Uploads y URLs validados antes de leer/subir.
- Jobs cancelables, inmutables y recuperables.
- Costos, cuotas y auditoría visibles.
- Consentimiento y privacidad para imágenes, personas y voces.
- Iframe aislado y handshake versionado por origen.
- Resultados vinculables con Drive, CRM, cotizaciones, pedidos y redes.
- Todos los `test.todo` convertidos en controles activos.
- Workflows `Visual AI audit` y `OpenGen audit` en verde.
