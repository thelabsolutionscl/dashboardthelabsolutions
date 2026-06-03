import { parsePFX } from './sii-crypto.js';
import { getSIIToken, uploadDTE } from './sii-auth.js';
import { buildSignedEnvioDTE } from './dte-xml.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    try {
      // GET /health — verifica configuración básica
      if (request.method === 'GET' && url.pathname === '/health') {
        return ok({
          status: 'ok',
          sii_env: env.SII_ENV || 'certificacion',
          rut_emisor: env.RUT_EMISOR || 'no configurado',
          cert_loaded: !!env.CERT_PFX_BASE64,
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

  // Generar EnvioDTE completo y firmado (TED + Documento + SetDTE)
  const envioDte = buildSignedEnvioDTE(data, folio, cafXml, privateKey, certificate, env);

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

  const range = parseCafRange(caf_xml);

  await env.FOLIOS_KV.put(`caf_${tipo_documento}`, caf_xml);
  // Resetea el contador al inicio del rango
  await env.FOLIOS_KV.put(`folio_${tipo_documento}`, String(range.desde - 1));

  return ok({ ok: true, tipo_documento, rango: range, siguiente_folio: range.desde });
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
