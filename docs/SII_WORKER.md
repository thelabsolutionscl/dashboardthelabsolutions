# SII Worker — estado y guía de activación

**Decisión vigente (ago 2026):** la facturación se sigue emitiendo **desde el
portal del SII**. El `sii-worker` queda **construido, probado y en pausa**, listo
para activarse el día que se decida migrar la emisión al dashboard. Este documento
deja escrito qué está hecho y qué falta para prenderlo.

## Qué hace (si se activa)

Emitir DTEs (factura 33, boleta 39, nota de crédito 61, etc.) **directo desde el
dashboard**, con los datos que ya están en el CRM — sin re-tipear en el portal del
SII, y con el número/estado del DTE volviendo al dashboard automáticamente.

Mientras no se active, **no aporta nada sobre el portal** — el portal ya resuelve
folios, formato y cumplimiento sin mantención de nuestra parte.

## Estado actual (probado en esta sesión)

- ✅ **Compila y bootea en Cloudflare Workers.** Estuvo un mes sin poder
  desplegarse por un import inexistente (`generateSignedDTE`/`buildEnvioDTE`); se
  corrigió a `buildSignedEnvioDTE`.
- ✅ **Firma XML-DSig en Workers.** `xml-crypto` faltaba en `package.json` y se
  cargaba con `createRequire(import.meta.url)` (que es `undefined` en Workers).
  Ahora se importa estático, con `compatibility_date = 2024-09-23` (para los
  builtins `crypto`/`util`) y **wrangler 4** (con wrangler 3 el `crypto.createSign`
  del dev local no existía; con el workerd moderno **sí firma** — verificado con un
  smoke-test: devuelve `SignatureValue` y `DigestValue`).
- ✅ Desplegado en `SII_ENV = "certificacion"` → habla solo con **maullin**
  (pruebas). **No puede emitir nada en producción.**
- ✅ Secrets cargados: certificado (firma personal 16.937.401-5), datos del emisor
  (empresa 77.499.554), `WORKER_KEY` (protegido).
- ⏸ **Sin CAF cargado** → no puede emitir. Estado inerte a propósito.
- ⏸ **No conectado al dashboard** — nada lo llama.

Lo único **no** probado de punta a punta: que el SII **acepte** una emisión real.
Eso es parte del proceso de certificación del SII (abajo) y requiere folios de
certificación.

## Cómo activarlo en el futuro (checklist)

1. **Certificación del SII.** Completar el *set de pruebas* del SII en el ambiente
   de certificación (trámite del SII, obligatorio para autorizar producción).
   Requiere pedir **folios de certificación** (CAF de maullin) y emitir el set.
2. **Probar en el worker** (con folios de CERTIFICACIÓN, nunca de producción):
   ```
   # subir CAF de certificación
   KEY="<WORKER_KEY>"
   CAF="/ruta/al-caf-certificacion.xml"
   node -e 'const fs=require("fs");process.stdout.write(JSON.stringify({tipo_documento:"33",caf_xml:fs.readFileSync(process.argv[1],"utf8")}))' "$CAF" \
     | curl -s -X PUT https://sii-dte-worker.wast3dspa.workers.dev/caf \
         -H "Content-Type: application/json" -H "X-Worker-Key: $KEY" -d @-
   # emitir DTE de prueba → esperar trackid + recibido:true
   ```
3. **Pasar a producción:** en `wrangler.toml`, `SII_ENV = "produccion"` +
   `RESOLUCION_NUMERO` real; `npx wrangler deploy` (con **wrangler 4**).
4. **CAF de producción:** cargar el CAF de producción con `PUT /caf`.
   ⚠️ **Sincronizar folios:** el worker lleva su propio contador en KV
   (`folio_{tipo}`). Si se seguía emitiendo por el portal con el mismo CAF, hay que
   dejar el contador del worker en el **último folio ya usado en el portal** — o
   usar un rango de CAF **exclusivo** del worker — para no repetir números.
5. **Conectar el dashboard:** que `emitirDTE` llame al worker enviando el header
   `X-Worker-Key`.

## Notas / advertencias

- **Desplegar siempre con wrangler 4** (`devDependencies` ya lo fija). Con
  wrangler 3, el build local mete un stub de `crypto.createSign` que no firma.
- **`WORKER_KEY` es obligatorio** — el worker emite documentos tributarios; toda
  ruta salvo `/health` exige el header `X-Worker-Key`.
- **Nunca mezclar folios de producción con pruebas.** Los CAF de producción se
  usan solo en `SII_ENV=produccion`.
- **`/health`** (público) informa el estado sin exponer secretos:
  `cert_loaded`, `rut_emisor_configurado`, `sii_env`, `auth`.

## Archivos

- `sii-worker/src/index.js` — rutas (`/health`, `PUT /caf`, `GET /folio/:tipo`,
  `POST /` emitir), auth por `WORKER_KEY`, consumo de folio.
- `sii-worker/src/dte-xml.js` — arma y firma el `<Documento>` + `<SetDTE>` (TED con
  node-forge, firma del sobre con xml-crypto).
- `sii-worker/src/sii-auth.js` — token SII + subida del DTE.
- `sii-worker/src/sii-crypto.js` — parseo del certificado (.pfx) y primitivas RSA.
- `sii-worker/setup-secrets.sh` — carga guiada de los secrets.
