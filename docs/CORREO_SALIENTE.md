# Correo saliente — configuración operativa

## Estado y causa del error

El mensaje `Outgoing mail from "hola@thelab.solutions" has been suspended`
proviene del servidor SMTP compartido de SilverHost. No indica que el
destinatario sea inválido: el servidor bloqueó la salida de la casilla.

La recepción continúa por IMAP de SilverHost. La salida debe ir por Resend para
no depender de la cuenta SMTP suspendida.

## Thunderbird

Mantén la cuenta entrante como está y cambia únicamente el servidor saliente
asignado a `hola@thelab.solutions`:

| Campo | Valor |
|---|---|
| Servidor SMTP | `smtp.resend.com` |
| Puerto recomendado | `465` |
| Seguridad | SSL/TLS |
| Autenticación | Contraseña normal |
| Usuario | `resend` |
| Contraseña | API key de Resend (`re_...`) |
| Remitente | `hola@thelab.solutions` |

Alternativa: puerto `587` con STARTTLS. El dominio `thelab.solutions` debe
seguir verificado en Resend. La API key nunca debe guardarse en GitHub.

En Thunderbird, confirma además que “Copias y carpetas” guarde los mensajes
enviados en la carpeta IMAP “Sent/Enviados” de la cuenta, porque Resend solo
realiza el transporte de salida.

## Dashboard y automatizaciones

- `mail-api.php` envía exclusivamente por Resend.
- Si falta `RESEND_API_KEY`, responde HTTP 503 con un error explícito; no intenta
  el SMTP compartido.
- El backup semanal usa `scripts/send-weekly-report.mjs` y requiere los secrets
  `RESEND_API_KEY` y `REPORT_EMAIL` en GitHub Actions.
- Make debe conservar todos los escenarios de email en Resend/HTTP y no volver a
  usar la conexión SMTP antigua `8660580`.

## Verificación

1. En Resend, confirma que `thelab.solutions` figure como Verified.
2. Crea una API key restringida a envío y úsala en Thunderbird.
3. Envía una prueba a una casilla propia y comprueba que aparece en Resend Emails.
4. Confirma que Thunderbird copió el mensaje a “Enviados”.
5. Solicita a SilverHost levantar la suspensión de la casilla para conservar un
   respaldo futuro, pero no vuelvas a usar ese SMTP para automatizaciones.
