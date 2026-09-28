import { parsePFX } from './sii-crypto.js';
import { getSIIToken, uploadDTE } from './sii-auth.js';
import { buildSignedEnvioDTE } from './dte-xml.js';
export { SiiFolioGuard } from './folio-guard.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Worker-Key',
  'Access-Control-Max-Age': '86400',
};

// Comparación en tiempo constante: evita filtrar la clave por diferencias de
// tiempo al comparar carácter a carácter.
function timingSafeEqual(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    // ── Autenticación ────────────────────────────────────────────────────
    // Este worker EMITE documentos tributarios y administra folios (CAF).
    // Cualquier ruta privada falla cerrada si WORKER_KEY no está configurada:
    // una mala configuración nunca puede convertir el emisor en un endpoint
    // público. /health queda libre para monitores y solo expone booleanos.
    if (url.pathname !== '/health') {
      if (!env.WORKER_KEY) {
        return new Response(JSON.stringify({ error: 'Worker SII no configurado: falta WORKER_KEY' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', ...CORS },
        });
      }
      const key = request.headers.get('X-Worker-Key') || '';
      if (!timingSafeEqual(key, env.WORKER_KEY)) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...CORS },
        });
      }
    }

    try {
      // Latido para la "Oficina Virtual" del dashboard. Opcional: solo si se
      // configuran los secrets AIRTABLE_TOKEN y AIRTABLE_BASE_ID. Best-effort.
      if (ctx && env.AIRTABLE_TOKEN && env.AIRTABLE_BASE_ID) {
        ctx.waitUntil(ofHeartbeat(env, 'sii-worker').catch(() => {}));
      }

      // GET /health — verifica configuración básica
      if (request.method === 'GET' && url.pathname === '/health') {
        // /health es público (lo consultan los monitores de uptime): informa si
        // está configurado, pero sin exponer el RUT del emisor.
        return ok({
          status: 'ok',
          sii_env: env.SII_ENV || 'certificacion',
          rut_emisor_configurado: !!env.RUT_EMISOR,
          cert_loaded: !!env.CERT_PFX_BASE64,
          auth: env.WORKER_KEY ? 'on' : 'off',
        });
      }

      // PUT /caf — sube un CAF para un tipo de documento
      // Body: { "tipo_documento": "33", "caf_xml": "<?xml..." }
      if (request.method === 'PUT' && url.pathname === '/caf') {
        return await handleCafUpload(request, env);
      }

      // GET /folio/:tipo — consulta el folio actual y rango CAF
      if (request.method === 'GET' && url.pathname.startsWith('/folio/')) {
        const tipo = url.pathname.split('/')[2];
        return await handleFolioStatus(tipo, env);
      }

      // POST / — emite un DTE
      if (request.method === 'POST' && (url.pathname === '/' || url.pathname === '/emit')) {
        return await handleEmitDTE(request, env);
      }

      return err('Ruta no encontrada', 404);

    } catch (e) {
      console.error('[SII Worker]', e.message);
      return err(e.message, Number.isInteger(e.status)?e.status:500,
        e.code?{code:e.code,...(Number.isSafeInteger(e.folio)?{folio:e.folio}:{})}:{});
    }
  },
};

// La firma se calcula en el Worker sobre el contenido real que se enviará,
// nunca se confía en un hash provisto por el navegador. Excluimos pedido_id,
// que representa la identidad de la operación y no forma parte del DTE.
function siiChileDate() {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Santiago',
    year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const pick=type=>parts.find(p=>p.type===type)?.value;
  return pick('year')+'-'+pick('month')+'-'+pick('day');
}

async function siiPayloadFingerprint(data) {
  const {pedido_id, ...documento}=data;
  const bytes=new TextEncoder().encode(JSON.stringify(documento));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}

// ── Emitir DTE ───────────────────────────────────────────────────────────────

async function handleEmitDTE(request, env) {
  validateEnvSecrets(env);

  const data = await request.json().catch(() => { throw new Error('Body inválido — se espera JSON'); });
  validatePayload(data);
  // No permitir /emit sin identidad: la ruta legada de folios no impide
  // que dos equipos emitan documentos distintos para el mismo pedido.
  if(!/^rec[A-Za-z0-9]{5,}$/.test(String(data.pedido_id||'')))
    throw Object.assign(new Error('pedido_id es obligatorio y debe ser un record ID válido de Airtable'),{status:422});

  // Primero autenticar con SII. La reserva irreversible del folio se realiza
  // inmediatamente después y ANTES de firmar/subir el documento: dos requests
  // simultáneos obtienen números distintos a través del Durable Object.
  const { privateKey, certificate } = parsePFX(env.CERT_PFX_BASE64, env.CERT_PFX_PASSWORD || '');
  const token = await getSIIToken(privateKey, certificate, env);
  const pedidoId=String(data.pedido_id);
  const fingerprint=await siiPayloadFingerprint(data);
  const reservation=await folioGuardCall(env,String(data.tipo_documento),'begin',{pedido_id:pedidoId,fingerprint});
  // Si se perdió la respuesta HTTP de una emisión CONFIRMADA, recuperar el
  // mismo TrackID/folio sin firmar ni subir nuevamente al SII.
  if(reservation.replayed){
    return ok({...reservation.receipt,replayed:true});
  }
  const folio = reservation.folio, cafXml = reservation.caf_xml;

  // Generar el DTE, firmarlo y envolverlo en un EnvioDTE listo para el SII
  // (buildSignedEnvioDTE hace el DTE + TED, la carátula y firma cada Documento
  //  y el SetDTE, y devuelve el XML completo que espera uploadDTE).
  let siiResult;
  try {
    const envioDte = buildSignedEnvioDTE(data, folio, cafXml, privateKey, certificate, env);
    // Desde este punto el SII PUEDE haber recibido el XML. Nunca reintentar
    // automáticamente ni consumir otro folio si perdemos la respuesta HTTP.
    siiResult = await uploadDTE(envioDte, token, env.RUT_EMISOR, env);
  } catch (cause) {
    console.error('[SII] Resultado ambiguo para folio reservado', folio, cause&&cause.message);
    throw Object.assign(new Error(
      'El folio '+folio+' permanece reservado: el resultado del envío es incierto. '+
      'Verifica este DTE en el portal SII y concilia antes de otro intento.'),{
        status:503, code:'DTE_PENDING_RECONCILIATION', folio,
      });
  }

  // El folio YA quedó reservado persistentemente en DO.storage antes del envío.
  // Si el SII no responde o falla la red, NO se revierte: el resultado es
  // ambiguo y se concilia en el portal tributario antes de intentar otro DTE.
  // Sin TrackID no hay constancia de que el SII haya recibido nada. Antes esto
  // se devolvía igual que un envío exitoso y el dashboard lo daba por emitido.
  const recibido = !!siiResult.trackid;
  const receipt={
    dte_numero: folio,
    tipo_documento: data.tipo_documento,
    // Fecha de la primera emisión en Chile, no la fecha del replay posterior.
    fecha_emision: siiChileDate(),
    trackid: siiResult.trackid,
    estado_sii: siiResult.estado,
    glosa_sii: siiResult.glosa || '',
    recibido,
    aviso: recibido ? null
      : 'El SII no devolvió TrackID: no hay constancia de que haya recibido el envío. '
      + `El folio ${folio} queda consumido para no arriesgar un número repetido. `
      + 'Revisa en el portal del SII antes de volver a emitir.',
    pdf_url: null,
  };
  if(recibido&&pedidoId){
    try{
      await folioGuardCall(env,String(data.tipo_documento),'complete',{
        pedido_id:pedidoId,fingerprint,folio,receipt,
      });
    }catch(e){
      // El SII ya entregó TrackID, pero la confirmación durable falló.
      // Bloquear el reintento y hacer conciliación manual, no emitir otro folio.
      throw Object.assign(new Error('SII confirmó TrackID, pero falló guardar la confirmación del folio '
        +folio+'. No reemitir: conciliar en el SII.'),{status:503});
    }
  }

  return ok({...receipt,replayed:false});
}
// ── CAF ───────────────────────────────────────────────────────────────────────

async function handleCafUpload(request, env) {
  const body = await request.json().catch(() => { throw new Error('Body inválido'); });
  const { tipo_documento, caf_xml } = body;

  if (!tipo_documento || !caf_xml) {
    return err('tipo_documento y caf_xml son requeridos', 400);
  }
  if (!['33', '39', '61', '56', '52'].includes(String(tipo_documento))) {
    return err('tipo_documento no soportado', 400);
  }

  let range;
  try { range = parseCafRange(caf_xml); }
  catch (e) { return err(e.message, 400); }

  const saved = await folioGuardCall(env, String(tipo_documento), 'upload', { caf_xml });
  return ok(saved);
}

async function handleFolioStatus(tipo, env) {
  return ok(await folioGuardCall(env, String(tipo), 'status'));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function folioGuardCall(env, tipo, op, payload = {}) {
  if (!env.FOLIO_GUARD || !env.FOLIOS_KV) {
    throw Object.assign(new Error('Guard de folios SII no configurado; emisión bloqueada'), { status: 503 });
  }
  const id = env.FOLIO_GUARD.idFromName('sii-tipo-' + tipo);
  const stub = env.FOLIO_GUARD.get(id);
  const result = await stub.fetch('https://folio-guard.internal/', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({op,tipo,...payload})
  });
  const data = await result.json().catch(()=>({}));
  if (!result.ok) throw Object.assign(new Error(data.error || 'Error de guardia de folios'),
    { status: result.status,code:data.code,folio:data.folio });
  return data;
}

async function nextFolio(tipoDTE, env) {
  return folioGuardCall(env, String(tipoDTE), 'reserve');
}

// Antes, un CAF que no calzara con el patrón se convertía en el rango 1–100 sin
// decir una palabra: se habrían emitido documentos tributarios con folios que el
// SII nunca autorizó. Un CAF ilegible tiene que detener todo.
function parseCafRange(cafXml) {
  const desde = parseInt((String(cafXml).match(/<D>(\d+)<\/D>/) || [])[1], 10);
  const hasta = parseInt((String(cafXml).match(/<H>(\d+)<\/H>/) || [])[1], 10);
  if (!Number.isInteger(desde) || !Number.isInteger(hasta) || desde < 1 || hasta < desde) {
    throw new Error('CAF inválido: no se pudo leer el rango de folios (se espera <RNG><D>desde</D><H>hasta</H></RNG>).');
  }
  return { desde, hasta };
}

function validateEnvSecrets(env) {
  if (!env.CERT_PFX_BASE64) throw new Error('Secret CERT_PFX_BASE64 no configurado');
  if (!env.RUT_EMISOR) throw new Error('Secret RUT_EMISOR no configurado');
  if (!env.RAZON_SOCIAL) throw new Error('Secret RAZON_SOCIAL no configurado');
  if (!env.GIRO_EMISOR) throw new Error('Secret GIRO_EMISOR no configurado');
  if (!env.ACTECO) throw new Error('Secret ACTECO no configurado');
  if (!env.RESOLUCION_FECHA) throw new Error('Secret RESOLUCION_FECHA no configurado');
  if (!env.RESOLUCION_NUMERO && env.RESOLUCION_NUMERO !== '0') throw new Error('Secret RESOLUCION_NUMERO no configurado');
}

function validatePayload(data) {
  const tipos = ['33', '39', '61', '56', '52'];
  if (!tipos.includes(String(data.tipo_documento))) {
    throw new Error(`tipo_documento debe ser uno de: ${tipos.join(', ')}`);
  }
  if (!data.receptor?.rut) throw new Error('receptor.rut es requerido');
  if (!data.receptor?.razon_social) throw new Error('receptor.razon_social es requerido');
  if (!data.detalle?.length) throw new Error('detalle[] es requerido y no puede estar vacío');
  if (!data.totales?.neto || data.totales.neto <= 0) throw new Error('totales.neto debe ser mayor a 0');
  if (!data.totales?.total) throw new Error('totales.total es requerido');
  // Un documento cuyos totales no cuadran lo rechaza el SII —o peor, lo acepta
  // y queda una diferencia tributaria—. Vale la pena verlo ANTES de gastar un
  // folio del CAF. Se admite 1 peso de holgura por redondeo del IVA.
  const neto = Number(data.totales.neto) || 0;
  const exento = Number(data.totales.exento) || 0;
  const iva = Number(data.totales.iva) || 0;
  const total = Number(data.totales.total);
  if (!Number.isFinite(total) || Math.abs(neto + exento + iva - total) > 1) {
    throw new Error(
      `totales inconsistentes: neto ${neto} + exento ${exento} + IVA ${iva} = ${neto + exento + iva}, `
      + `pero totales.total dice ${total}.`
    );
  }
}

function ok(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function err(msg, status = 400, extra = {}) {
  return new Response(JSON.stringify({ error: msg,...extra }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── Latido a la tabla Automations (Oficina Virtual) ──────────────────────
// Marca la fila ID=<id> como "Activo" con la hora actual, máx. 1 vez cada
// 5 min. Best-effort; requiere los secrets opcionales AIRTABLE_TOKEN y
// AIRTABLE_BASE_ID. Se invoca con ctx.waitUntil para no añadir latencia.
let _ofLastBeat = 0;
async function ofHeartbeat(env, id) {
  const now = Date.now();
  if (now - _ofLastBeat < 5 * 60 * 1000) return;
  _ofLastBeat = now;
  const api = 'https://api.airtable.com/v0';
  const tbl = `${api}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent('Automations')}`;
  const auth = { Authorization: 'Bearer ' + env.AIRTABLE_TOKEN };
  const q = `${tbl}?maxRecords=1&filterByFormula=${encodeURIComponent(`{ID}='${id}'`)}`;
  const found = await fetch(q, { headers: auth });
  if (!found.ok) return;
  const data = await found.json();
  const rec = data.records && data.records[0];
  if (!rec) return;
  const f = rec.fields || {};
  const sameDay = f.UltimaEjecucion && new Date(f.UltimaEjecucion).toDateString() === new Date().toDateString();
  const ej = (sameDay ? (Number(f.EjecucionesHoy) || 0) : 0) + 1;
  await fetch(`${tbl}/${rec.id}`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: { Estado: 'Activo', UltimaEjecucion: new Date().toISOString(), EjecucionesHoy: ej },
      typecast: true,
    }),
  });
}
