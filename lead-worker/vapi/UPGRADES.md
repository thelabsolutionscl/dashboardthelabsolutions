# Upgrades del canal de voz + WhatsApp

Todo lo de abajo está **implementado en el Worker y probado** (smoke tests), y queda
**dormido/gateado por env**: sin las variables, degrada sin romper. Rutas y auth en
`../src/index.js`.

## 1. Firma HMAC del webhook de voz (endurecimiento)

`POST /webhooks/voice` acepta dos modos de auth:
- **HMAC (recomendado):** setea `VOICE_HMAC_SECRET`. El Worker valida
  `HMAC-SHA256(cuerpo_crudo)` contra el header (`VOICE_HMAC_HEADER`, default
  `x-vapi-signature`), acepta el valor con o sin prefijo `sha256=`. En VAPI: credencial
  HMAC en el `server` del asistente.
- **Secreto compartido (default):** `VOICE_WEBHOOK_KEY` vía `x-vapi-secret`/`Bearer`.

Además el endpoint aplica rate-limit (30/min/IP con KV `RL`).

## 2. Tabla `Llamadas` (histórico)

En `end-of-call-report`, además de enriquecer el Cliente, el Worker inserta un registro en
la tabla **`Llamadas`** (si existe). Campos: `Call ID`, `Teléfono`, `ID Cliente`,
`Duración (s)`, `Estado`, `Resumen`, `Transcripción`, `Grabación`, `Evaluación`, `Canal`,
`Fecha`. Es **opcional**: si la tabla no existe, se descarta sin romper. Crearla en
Airtable habilita el histórico/analytics de llamadas para el dashboard.

## 3. Relleno hablado en tools lentas

`assistant.json` incluye `messages` (`request-start`) en `crear_lead`,
`estimar_cotizacion` y `derivar_socio`, para que el agente diga algo mientras el Worker
responde (evita silencios).

## 4. WhatsApp — Fase 3 (texto + notas de voz)

Rutas `GET/POST /webhooks/whatsapp` (WhatsApp Cloud API). **Reutiliza el pipeline**: crea
el lead con `source: "whatsapp"` (Origen lead = `WhatsApp`) y el `LEAD_AGENT` lo procesa;
las **notas de voz** se transcriben con Whisper.

Flujo: `webhook → (audio) descarga media + STT → texto → persistLead → acuse por WhatsApp`.

Alta:
1. En Meta, configurar el webhook apuntando a `.../webhooks/whatsapp` con
   `WHATSAPP_VERIFY_TOKEN` (verificación GET) y suscribir `messages`.
2. Secrets: `WHATSAPP_APP_SECRET` (firma X-Hub-Signature-256), `WHATSAPP_TOKEN` +
   `WHATSAPP_PHONE_ID` (descarga de audio + envío), `OPENAI_API_KEY` (STT; opcional
   `OPENAI_STT_MODEL`, default `whisper-1`).
3. Sin STT configurado, la nota de voz se registra como `[nota de voz recibida]` y el lead
   igual se crea. Dedupe por `id` de mensaje (evita duplicados en reintentos de Meta).

> Recordatorio: para usar el número en la **API** de WhatsApp hay que sacarlo de la **app**
> de WhatsApp (o usar un BSP con onboarding app+API). Ver `docs/AGENTE_VOZ_VAPI.md` §9.

## 5. Salientes — Fase 4

`POST /voice/outbound` dispara una llamada saliente vía VAPI. Auth: `x-outbound-key`
(`OUTBOUND_KEY`, o `VOICE_WEBHOOK_KEY`). Body: `{ phone (E.164), name?, force? }`.

- Respeta **horario hábil** (`estado_horario`); fuera de horario responde 409 salvo
  `force: true` (consentimiento/DND).
- Gateado: requiere `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VAPI_ASSISTANT_ID` (opcional
  `VAPI_OUTBOUND_ASSISTANT_ID`). Sin ellos → 501.
- Pensado para gatillarse desde el dashboard / Make (p. ej. el `FOLLOWUP_AGENT`).
  Respetar límite de intentos y no llamar a números que pidieron no ser contactados.
</content>
