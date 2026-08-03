# Auditoría de NEWSLETTER

Fecha: 2026-08-02

## Alcance

Se revisaron conjuntamente:

- La pestaña Newsletter del dashboard (`index.html` + `js/redes.js`).
- El transporte reutilizado desde Correo (`js/correo.js` y `mail-api.php`).
- Las rutas públicas de suscripción, confirmación y baja (`lead-worker/src/index.js`).
- El contrato operativo documentado para Airtable, Make y Resend (`docs/NEWSLETTER.md`).

## Flujo observado

1. `Clientes` actúa como lista maestra de contactos y consentimiento.
2. `Newsletter_Campañas` guarda asunto, preheader, Markdown, HTML, estado y fecha.
3. `NEWSLETTER_AGENT` genera contenido y usa pedidos reales como contexto.
4. El dashboard permite seleccionar suscriptores, exclusiones, segmentos inteligentes y emails extra.
5. Existen dos caminos de envío:
   - Envío directo desde el dashboard mediante `MAIL.post`, un correo por destinatario.
   - Envío programado documentado mediante Make + Resend.
6. `Newsletter_Envios` debería ser la traza por campaña y destinatario para aperturas, clics, rebotes, quejas, bajas y leads calientes.
7. El Worker recibe altas web, aplica anti-bot/rate-limit y soporta doble opt-in con enlaces HMAC.

## Controles confirmados

- La audiencia base exige `Suscrito newsletter = true` y excluye `Baja newsletter = true`.
- Los destinatarios se deduplican por email sin distinguir mayúsculas.
- Los segmentos inteligentes se calculan desde `Newsletter_Envios`.
- Los envíos directos se hacen uno por uno y piden confirmación humana.
- El ciclo editorial contempla Borrador, En revisión, Programada y Enviada.
- El contenido Markdown escapa texto antes de generar HTML.
- El alta web incluye Turnstile opcional, rate-limit, doble opt-in y firma HMAC.
- Los leads calientes se convierten en tareas `FOLLOWUP_AGENT` con control anti-duplicado.
- La analítica deriva aperturas, clics y mejor horario desde eventos observados.
- Existe RBAC específico para la sección y para escrituras de marketing.

## Hallazgos

### Críticos

1. **El envío directo no crea `Newsletter_Envios`.**
   Se envía mediante `MAIL.post`, pero no se crea o reserva una fila por destinatario. El envío queda sin idempotencia, tracking, estado individual, rebote, queja ni evidencia exacta.

2. **El filtro “No reenviar (14 días)” no cubre los envíos directos.**
   `_nlRecentRecipients()` consulta `state.nlEnvios`, pero `nlDestSend()` no registra allí lo enviado. Una campaña directa puede repetirse sin que el filtro la detecte.

3. **El secreto de confirmación puede ser predecible o público.**
   `nlSecret()` cae desde `NEWSLETTER_SECRET` a `PUBLIC_LEAD_KEY`, luego a `AIRTABLE_TOKEN` y finalmente al texto fijo `thelab-newsletter`. El secreto de newsletter debe ser obligatorio, independiente y nunca reutilizar una clave publicada en el frontend.

4. **Una campaña parcial se cierra como Enviada.**
   Aunque existan destinatarios con error, el código intenta guardar `Estado = Enviada` y `Enviados = ok`. El fallo del PATCH final se silencia. Esto permite campañas incompletas, sin reanudación segura, o reenvíos posteriores desde Make si el estado no alcanzó a guardarse.

5. **Hay dos rutas autoritativas de envío sin conciliación.**
   El dashboard y Make pueden enviar la misma campaña. No existe lease, lock, idempotency key ni estado `Enviando` compartido que garantice que solo una ruta tome el trabajo.

### Altos

6. **Destinatarios, exclusiones y emails extra viven en `localStorage`.**
   La selección no viaja con la campaña a Airtable. Otro navegador, usuario o Make puede resolver una audiencia diferente.

7. **Los emails extra omiten el modelo de consentimiento.**
   `_nlDestResolve()` agrega direcciones externas aunque no tengan registro con opt-in en `Clientes`.

8. **La gestión manual marca opt-in sin evidencia.**
   Agregar o editar un destinatario fuerza `Suscrito newsletter = true` y `Baja newsletter = false`, pero no conserva fuente, fecha, usuario, evidencia ni motivo de la autorización.

9. **La baja del email es un `mailto` genérico.**
   La plantilla no genera un enlace firmado y personalizado al Worker. Tampoco incluye headers `List-Unsubscribe` y `List-Unsubscribe-Post`.

10. **La ruta de baja modifica estado mediante GET.**
    Un antivirus, scanner o previsualizador puede seguir el link automáticamente. Debe usarse token opaco y un flujo compatible con one-click POST, manteniendo una alternativa manual sencilla.

11. **Tracking documentado por email, no por envío exacto.**
    El escenario descrito busca por destinatario. Si una persona recibe varias campañas, un evento puede actualizar la fila equivocada. Debe correlacionarse por el tag/id de `Newsletter_Envios`.

12. **Cualquier clic puede transformarse en lead caliente.**
    Deben excluirse enlaces de baja, privacidad, imágenes, recursos técnicos y otros clics sin intención comercial.

### Medios

13. Rebotes y quejas no forman una lista de supresión obligatoria para próximos envíos.
14. Programar usa fecha, pero no hora, zona horaria explícita ni ventana de ejecución.
15. “Marcar enviada” permite alterar métricas sin evidencia de transporte.
16. La vista previa usa `srcdoc` sin `sandbox` y carga recursos remotos.
17. El modo sin Resend cae a single opt-in, reduciendo la calidad del consentimiento.
18. La documentación mantiene pasos y estados externos que pueden quedar desactualizados respecto de Make/Resend.

## Arquitectura recomendada

1. Guardar una versión inmutable de audiencia en Airtable al aprobar/programar.
2. Crear mediante upsert una fila `Newsletter_Envios` por `campaña + email` antes de enviar.
3. Cambiar la campaña de `Programada` a `Enviando` mediante lock/lease atómico.
4. Elegir un único worker de envío. El dashboard solo debe aprobar/disparar; el worker debe ejecutar.
5. Enviar con idempotency key y tag `envio=<recordId>`.
6. Registrar éxito/error por destinatario y cerrar como `Enviada`, `Parcial` o `Error`.
7. Generar baja firmada por destinatario y headers estándar.
8. Aplicar supresión por baja, rebote permanente y queja antes de cada envío.
9. Hacer obligatorio `NEWSLETTER_SECRET`, sin fallbacks.
10. Alimentar analítica y leads únicamente desde eventos asociados al `Newsletter_Envios` correcto.

## Criterios de aceptación

- Dos procesos concurrentes no pueden enviar la misma campaña.
- Reintentar una campaña no vuelve a enviar a destinatarios ya confirmados.
- Todo correo real tiene fila de envío, id externo y estado trazable.
- Un envío parcial conserva los errores y puede reanudarse únicamente para pendientes.
- La audiencia enviada coincide con la audiencia aprobada y queda versionada.
- Ninguna dirección sin opt-in o con baja/rebote/queja entra al lote.
- La baja funciona con un enlace individual y se refleja antes del siguiente envío.
- Aperturas y clics se atribuyen a campaña y destinatario exactos.
- Clics técnicos o de baja no crean leads comerciales.
- CI convierte los `TODO` de `tests/newsletter-wiring.test.js` en pruebas obligatorias al implementar cada corrección.
