import { parsePFX } from './sii-crypto.js';
import { getSIIToken, uploadDTE } from './sii-auth.js';
import { generateSignedDTE, buildEnvioDTE } from './dte-xml.js';

const CORS_BASE = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

// Resuelve cabeceras CORS según allowlist en env.ALLOWED_ORIGINS.
// Si no está definida, conserva '*' pero avisa por consola.
function corsHeaders(request, env) {
  const headers = { ...CORS_BASE };
  const allowlist = (env && env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS : '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowlist.length === 0) {
    console.warn('[SII Worker] ALLOWED_ORIGINS no definida — CORS abierto a "*". Configúrala para restringir orígenes.');
    headers['Access-Control-Allow-Origin'] = '*';
    return headers;
  }
  const origin = request.headers.get('Origin') || '';
  headers['Vary'] = 'Origin';
  headers['Access-Control-Allow-Origin'] = origin && allowlist.includes(origin) ? origin : allowlist[0];
  return headers;
}

// Comparación en tiempo constante (bytes UTF-8, longitud fija).
function timingSafeEqualStr(a, b) {
  const enc = new TextEncoder();
  const ba = enc.encode(String(a == null ? '' : a));
  const bb = enc.encode(String(b == null ? '' : b));
  const len = Math.max(ba.length, bb.length);
  let diff = ba.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ba[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

// Exige Authorization: Bearer <env.SII_API_KEY> en rutas que mutan estado.
// Si SII_API_KEY no está definida → console.warn y permite (compatibilidad).
// Devuelve una Response 401 si falla; null si pasa.
function requireBearer(request, env, CORS) {
  if (!env.SII_API_KEY) {
    console.warn('[SII Worker] SII_API_KEY no definida — ruta protegida abierta. Configúrala para exigir Bearer.');
    return null;
  }
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : '';
  if (!token || !timingSafeEqualStr(token, env.SII_API_KEY)) {
    return err('No autorizado', 401, CORS);
  }
  return null;
}

export default {
  async fetch(request, env) {
    const CORS = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    try {
      // GET /health — verifica configuración básica (sin auth)
      if (request.method === 'GET' && url.pathname === '/health') {
        return ok({
          status: 'ok',
          sii_env: env.SII_ENV || 'certificacion',
          rut_emisor: env.RUT_EMISOR || 'no configurado',
          cert_loaded: !!env.CERT_PFX_BASE64,
        }, CORS);
      }

      // PUT /caf — sube un CAF para un tipo de documento (muta estado → bearer)
      // Body: { "tipo_documento": "33", "caf_xml": "<?xml..." }
      if (request.method === 'PUT' && url.pathname === '/caf') {
        const unauth = requireBearer(request, env, CORS);
        if (unauth) return unauth;
        return await handleCafUpload(request, env, CORS);
      }

      // GET /folio/:tipo — consulta el folio actual y rango CAF (solo lectura)
      if (request.method === 'GET' && url.pathname.startsWith('/folio/')) {
        const tipo = url.pathname.split('/')[2];
        return await handleFolioStatus(tipo, env, CORS);
      }

      // POST / — emite un DTE (muta estado / emite DTE → bearer)
      if (request.method === 'POST') {
        const unauth = requireBearer(request, env, CORS);
        if (unauth) return unauth;
        return await handleEmitDTE(request, env, CORS);
      }

      return err('Ruta no encontrada', 404, CORS);

    } catch (e) {
      console.error('[SII Worker]', e.message);
      return err(e.message, 500, CORS);
    }
  },
};

// ── Emitir DTE ───────────────────────────────────────────────────────────────

async function handleEmitDTE(request, env, CORS) {
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

  // Persistir el folio consumido solo si no hubo error grave
  if (siiResult.estado !== '-11' && siiResult.estado !== '-1') {
    await env.FOLIOS_KV.put(`folio_${data.tipo_documento}`, String(folio));
  }

  return ok({
    dte_numero: folio,
    tipo_documento: data.tipo_documento,
    trackid: siiResult.trackid,
    estado_sii: siiResult.estado,
    glosa_sii: siiResult.glosa || '',
    pdf_url: null,  // Generación de PDF requiere paso adicional con tu proveedor
  }, CORS);
}

// ── CAF ───────────────────────────────────────────────────────────────────────

async function handleCafUpload(request, env, CORS) {
  const body = await request.json().catch(() => { throw new Error('Body inválido'); });
  const { tipo_documento, caf_xml } = body;

  if (!tipo_documento || !caf_xml) {
    return err('tipo_documento y caf_xml son requeridos', 400, CORS);
  }
  if (!['33', '39', '61', '56', '52'].includes(String(tipo_documento))) {
    return err('tipo_documento no soportado', 400, CORS);
  }

  const range = parseCafRange(caf_xml);

  await env.FOLIOS_KV.put(`caf_${tipo_documento}`, caf_xml);
  // Resetea el contador al inicio del rango
  await env.FOLIOS_KV.put(`folio_${tipo_documento}`, String(range.desde - 1));

  return ok({ ok: true, tipo_documento, rango: range, siguiente_folio: range.desde }, CORS);
}

async function handleFolioStatus(tipo, env, CORS) {
  const cafXml = await env.FOLIOS_KV.get(`caf_${tipo}`);
  if (!cafXml) return err(`Sin CAF configurado para tipo ${tipo}`, 404, CORS);

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
  }, CORS);
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

function parseCafRange(cafXml) {
  const desde = parseInt((cafXml.match(/<D>(\d+)<\/D>/) || [])[1] || '1');
  const hasta = parseInt((cafXml.match(/<H>(\d+)<\/H>/) || [])[1] || '100');
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
}

function ok(data, cors = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function err(msg, status = 400, cors = {}) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
