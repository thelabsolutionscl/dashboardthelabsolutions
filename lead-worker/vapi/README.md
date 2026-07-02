# Agente de Voz IA (VAPI) — Fase 1

Configuración del asistente de voz que atiende llamadas, toma la bajada del pedido y
deriva a un socio. Se enchufa al Worker existente por la ruta `POST /webhooks/voice`
(ver `../src/index.js`). Contexto y decisiones: `web-thelab-solutions/docs/AGENTE_VOZ_VAPI.md`.

## Qué hace

```
Llamada +56  ─►  VAPI (voz + Claude + Deepgram)
                   │  tool crear_lead        ─►  POST /webhooks/voice  ─►  Cliente + Agent_Queue + speed-to-lead
                   │  transferCall            ─►  Gustavo / Nicanor (según tipo de cuenta)
                   └─ end-of-call-report      ─►  POST /webhooks/voice  ─►  transcripción + grabación (+ respaldo)
```

- **`crear_lead`** (durante la llamada): crea/deduplica el Cliente y encola al `LEAD_AGENT`
  (reutiliza el mismo pipeline que web/Google Ads/LinkedIn). Origen lead = `Teléfono (IA)`.
- **`estimar_cotizacion`** (Fase 2): devuelve un rango de precio **referencial** desde la
  tabla `Precios_Referencia` (ver [`precios-referencia.md`](./precios-referencia.md)).
  Inactiva hasta que la tabla tenga filas: con la tabla vacía no da montos.
- **`estado_horario`**: el Worker calcula el horario hábil en Chile (America/Santiago) y el
  agente decide con eso si transfiere (no depende del reloj del modelo). Config:
  `BUSINESS_START`/`BUSINESS_END` (default 9–18).
- **`derivar_socio`**: avisa al socio por email (Resend) con la ficha del pedido —queda
  briefeado aunque la telefonía no soporte warm-transfer. Estratégica → Gustavo; compleja →
  Nicanor; urgencia → ambos.
- **`transferCall`**: transferencia **blind** (compatible con Telnyx/SIP) al socio, solo en
  horario hábil, después de `derivar_socio`.
- **`end-of-call-report`**: al colgar guarda transcripción y grabación en el Cliente; si
  el asistente no alcanzó a llamar `crear_lead`, lo crea como respaldo desde
  `analysis.structuredData`.

## Prerrequisitos

1. **Número de voz +56 dedicado** (recomendado: Telnyx, integrado a VAPI por SIP). El
   número comercial de WhatsApp (+56 9 2878 5039) **no** sirve como línea de voz PSTN —
   ver §2 del documento de contexto.
2. Cuenta en **VAPI** con proveedores de voz (ElevenLabs/Azure `es-CL`) y transcripción
   (Deepgram `es`) configurados.

## Alta paso a paso

1. **Secreto del webhook** en el Worker:
   ```bash
   npx wrangler secret put VOICE_WEBHOOK_KEY   # repo dashboard, carpeta lead-worker
   npx wrangler deploy
   ```
2. **Crear el asistente** en VAPI a partir de [`assistant.json`](./assistant.json), reemplazando:
   - `voice.voiceId` → una voz en español (validar acento chileno con una demo).
   - `model.tools[].server.url` y `server.url` → la URL pública del Worker
     (`https://<tu-worker>/webhooks/voice`).
   - En **Custom Credentials** de VAPI, crear una credencial que envíe el header
     `x-vapi-secret` (o `Authorization: Bearer`) con el valor de `VOICE_WEBHOOK_KEY`, y
     referenciarla en `server`. (El campo `server.secret` inline —legado— también sirve y
     llega como header `x-vapi-secret`.)
3. **Asignar el número +56** (Telnyx/SIP) al asistente como entrante.
4. **Airtable** — agregar en la tabla `Clientes`:
   - opción **`Teléfono (IA)`** en el campo `Origen lead`;
   - campos **`Transcripción`** (long text), **`Grabación llamada`** (url) y
     **`Clasificación IA`** (estrategica · compleja · estandar).
   (El Worker es tolerante: si faltan, los descarta sin romper.)

## Probar en local

```bash
cd lead-worker && npx wrangler dev            # :8787
# desde otra terminal (o usar scripts/test-pipeline.sh con VOICE_KEY):
curl -sS -X POST http://localhost:8787/webhooks/voice \
  -H "Content-Type: application/json" -H "x-vapi-secret: $VOICE_WEBHOOK_KEY" \
  -d '{"message":{"type":"tool-calls","toolCallList":[{"id":"call_1","function":{"name":"crear_lead","arguments":"{\"company\":\"Retail X\",\"name\":\"Ana\",\"email\":\"ana@retailx.cl\",\"phone\":\"+56911112222\",\"service\":\"Merchandising\",\"quantity\":\"500\",\"accountType\":\"estrategica\"}"}}]}}'
# → {"results":[{"name":"crear_lead","toolCallId":"call_1","result":"Pedido registrado. ..."}]}
```

## Notas

- **Transferencia:** el warm-transfer con resumen hablado solo existe en telefonía Twilio;
  como el número es Telnyx/SIP, `assistant.json` usa **`blind-transfer`**. El resumen le
  llega al socio **out-of-band** vía `derivar_socio` (email Resend; si no hay Resend, usa
  `ALERT_WEBHOOK_URL`). Cuando exista WhatsApp API, se puede sumar aviso por WhatsApp.
- **Endurecimiento:** el webhook valida `x-vapi-secret`/Bearer y aplica rate-limit
  (30/min/IP con KV `RL`). Para firma fuerte, usar una credencial **HMAC** de VAPI en vez
  del secreto compartido. Verifica que el `model.model` de `assistant.json` sea un id que
  la integración Anthropic de VAPI acepte.
- **Legal (Chile):** el aviso "asistente con IA + llamada grabada" ya va en `firstMessage`
  (exigible hoy por SERNAC; grabación obligatoria en venta telefónica, Ley 21.398).
  Textos alternativos y notas de cumplimiento en el documento de contexto (§7).
- **Precios (Fase 2):** la tool `estimar_cotizacion` ya está implementada y queda
  **inactiva** hasta que exista la tabla `Precios_Referencia`
  ([`precios-referencia.md`](./precios-referencia.md)). Con la tabla vacía el agente no da
  montos (comportamiento Fase 1); al cargarla, empieza a leer rangos referenciales **sin
  tocar código**.
</content>
