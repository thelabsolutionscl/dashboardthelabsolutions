import { parsePFX } from './sii-crypto.js';
import { getSIIToken, uploadDTE } from './sii-auth.js';
import { generateSignedDTE, buildEnvioDTE } from './dte-xml.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
    // Este worker EMITE documentos tributarios y administra folios (CAF): no
    // debe quedar abierto. Se exige la clave en cuanto exista el secret
    // WORKER_KEY; sin él, se sigue aceptando todo para no cortar la facturación
    // en caliente (ver README: hay que configurarlo). /health queda libre para
    // los monitores de uptime.
    if (env.WORKER_KEY && url.pathname !== '/health') {
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
      if (request.method === 'POST') {
        return await handleEmitDTE(request, env);
      }

      return err('Ruta no encontrada', 404);

    } catch (e) {
      console.error('[SII Worker]', e.message);
      return err(e.message, 500);
    }
  },
};

// ── Emitir DTE ───────────────────────────────────────────────────────────────

async function handleEmitDTE(request, env) {
  validateEnvSecrets(env);

  const data = await request.json().catch(() => { throw new Error('Body inválido — se espera JSON'); });
  validatePayload(data);

  // Cargar y parsear certificado
  const { privateKey, certificate } = parsePFX(env.CERT_PFX_BASE64, env.CERT_PFX_PASSWORD || '');

  // Obtener CAF del KV
  const cafKey = `caf_${data.tipo_documento}`;
  const cafXml = await env.FOLIOS_KV.get(cafKey);
  if (!cafXml) {
    throw new Error(
      `CAF no encontrado para tipo ${data.tipo_documento}. ` +
      `Súbelo con PUT /caf {"tipo_documento":"${data.tipo_documento}","caf_xml":"..."}`
    );
  }

  // Obtener y reservar el siguiente folio
  const folio = await nextFolio(data.tipo_documento, cafXml, env);

  // Autenticar con SII
  const token = await getSIIToken(privateKey, certificate, env);

  // Generar y firmar DTE
  const signedDte = generateSignedDTE(data, folio, cafXml, privateKey, certificate, env);

  // Construir EnvioDTE y firmarlo
  const envioDte = buildEnvioDTE(signedDte, data, folio, env, privateKey, certificate);

  // Subir al SII
  const siiResult = await uploadDTE(envioDte, token, env.RUT_EMISOR, env);

  // El folio se marca consumido SIEMPRE que la llamada haya llegado hasta aquí.
  // La condición anterior (estado !== '-11' && estado !== '-1') era código
  // muerto: uploadDTE LANZA en esos dos casos y nunca alcanzaba esta línea.
  // La regla real es la que importa: repetir un folio que sí entró al SII
  // produce dos documentos tributarios con el mismo número, y eso es mucho peor
  // que perder un folio del CAF. Ante la duda, se consume.
  await env.FOLIOS_KV.put(`folio_${data.tipo_documento}`, String(folio));

  // Sin TrackID no hay constancia de que el SII haya recibido nada. Antes esto
  // se devolvía igual que un envío exitoso y el dashboard lo daba por emitido.
  const recibido = !!siiResult.trackid;

  return ok({
    dte_numero: folio,
    tipo_documento: data.tipo_documento,
    trackid: siiResult.trackid,
    estado_sii: siiResult.estado,
    glosa_sii: siiResult.glosa || '',
    recibido,
    aviso: recibido ? null
      : 'El SII no devolvió TrackID: no hay constancia de que haya recibido el envío. '
      + `El folio ${folio} queda consumido para no arriesgar un número repetido. `
      + 'Revisa en el portal del SII antes de volver a emitir.',
    pdf_url: null,  // Generación de PDF requiere paso adicional con tu proveedor
  });
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

  // Volver a subir el MISMO CAF no puede rebobinar el contador: los folios ya
  // emitidos se reemitirían con el mismo número. Solo se parte del inicio del
  // rango cuando el contador actual queda FUERA de él, que es lo que ocurre con
  // un CAF nuevo de verdad.
  const actual = parseInt(await env.FOLIOS_KV.get(`folio_${tipo_documento}`) || '0', 10);
  const dentro = Number.isInteger(actual) && actual >= range.desde - 1 && actual <= range.hasta;
  const inicio = dentro ? actual : range.desde - 1;

  await env.FOLIOS_KV.put(`caf_${tipo_documento}`, caf_xml);
  await env.FOLIOS_KV.put(`folio_${tipo_documento}`, String(inicio));

  return ok({
    ok: true,
    tipo_documento,
    rango: range,
    siguiente_folio: inicio + 1,
    // Solo es "conservado" si de verdad se evitó un rebobinado: un contador que
    // cae justo en desde-1 (CAF nuevo que sigue al anterior) no conservó nada.
    contador_conservado: dentro && actual > range.desde - 1,
  });
}

async function handleFolioStatus(tipo, env) {
  const cafXml = await env.FOLIOS_KV.get(`caf_${tipo}`);
  if (!cafXml) return err(`Sin CAF configurado para tipo ${tipo}`, 404);

  const range = parseCafRange(cafXml);
  const actual = parseInt(await env.FOLIOS_KV.get(`folio_${tipo}`) || String(range.desde - 1));
  const disponibles = range.hasta - actual;

  return ok({
    tipo_documento: tipo,
    folio_actual: actual,
    siguiente_folio: actual + 1,
    rango_caf: range,
    folios_disponibles: disponibles,
    advertencia: disponibles <= 10 ? '⚠ Quedan pocos folios — solicita nuevo CAF al SII' : null,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function nextFolio(tipoDTE, cafXml, env) {
  const range = parseCafRange(cafXml);
  const key = `folio_${tipoDTE}`;
  const current = parseInt(await env.FOLIOS_KV.get(key) || String(range.desde - 1));
  const next = current + 1;

  if (next > range.hasta) {
    throw new Error(
      `Folios agotados para tipo ${tipoDTE} ` +
      `(rango CAF: ${range.desde}-${range.hasta}). Solicita nuevo CAF al SII.`
    );
  }
  // No persistimos aún — lo hacemos después del upload exitoso
  return next;
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

function err(msg, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
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
