import express from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { parsePFX } from './src/sii-crypto.js';
import { getSIIToken, uploadDTE } from './src/sii-auth.js';
import { generateSignedDTE, buildEnvioDTE } from './src/dte-xml.js';

const require = createRequire(import.meta.url);
try { require('dotenv').config(); } catch {}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR);

// ── KV file-based (reemplaza Cloudflare KV) ──────────────────────────────────
const kv = {
  get: (key) => {
    const f = join(DATA_DIR, `${key}.txt`);
    return existsSync(f) ? readFileSync(f, 'utf8') : null;
  },
  put: (key, value) => writeFileSync(join(DATA_DIR, `${key}.txt`), String(value), 'utf8'),
};

// ── env object (mismo contrato que el Worker) ─────────────────────────────────
const env = {
  SII_ENV:           process.env.SII_ENV           || 'certificacion',
  RUT_EMISOR:        process.env.RUT_EMISOR,
  RAZON_SOCIAL:      process.env.RAZON_SOCIAL,
  GIRO_EMISOR:       process.env.GIRO_EMISOR,
  ACTECO:            process.env.ACTECO,
  DIR_EMISOR:        process.env.DIR_EMISOR,
  CMNA_EMISOR:       process.env.CMNA_EMISOR,
  CIUDAD_EMISOR:     process.env.CIUDAD_EMISOR,
  RESOLUCION_FECHA:  process.env.RESOLUCION_FECHA,
  RESOLUCION_NUMERO: process.env.RESOLUCION_NUMERO,
  CERT_PFX_BASE64:   process.env.CERT_PFX_BASE64,
  CERT_PFX_PASSWORD: process.env.CERT_PFX_PASSWORD || '',
  FOLIOS_KV:         kv,
};

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send();
  next();
});

// GET /health
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    sii_env: env.SII_ENV,
    rut_emisor: env.RUT_EMISOR || 'no configurado',
    cert_loaded: !!env.CERT_PFX_BASE64,
  });
});

// GET /debug — diagnóstico: IP de salida + prueba endpoints SII
app.get('/debug', async (req, res) => {
  const results = {};
  const hdrs = { 'User-Agent': 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.0)', 'Accept': 'text/xml' };

  try {
    results.outbound_ip = (await (await fetch('https://api.ipify.org?format=json')).json()).ip;
  } catch (e) { results.outbound_ip = 'ERROR: ' + e.message; }

  const check = async (url, opts = {}) => {
    try {
      const r = await fetch(url, { headers: hdrs, ...opts });
      const txt = await r.text();
      if (txt.includes('<SEMILLA>')) return 'OK — SEMILLA: ' + (txt.match(/<SEMILLA>(\d+)<\/SEMILLA>/)||[])[1];
      return `HTTP ${r.status} — ` + txt.replace(/[\r\n\t]/g,' ').substring(0, 300);
    } catch (e) { return 'ERROR: ' + e.message; }
  };

  const soapNs = (ns, body) =>
    `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:impl="${ns}"><soapenv:Header/><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;

  // SOAP CrSeed — mostrar respuesta completa
  try {
    const r = await fetch('https://maullin.sii.cl/DTEWS/CrSeed.jws', {
      method: 'POST',
      headers: { ...hdrs, 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '""' },
      body: soapNs('http://DefaultNamespace', '<impl:getSeed/>'),
    });
    const txt = await r.text();
    const semilla = (txt.match(/<SEMILLA>(\d+)<\/SEMILLA>/) || [])[1];
    const returnEl = (txt.match(/<[^:>\s]+:getSeedReturn[^>]*>([\s\S]*?)<\/[^:>\s]+:getSeedReturn>/) || [])[1];
    results.CrSeed_SOAP_full = {
      http_status: r.status,
      semilla_directa: semilla || null,
      getSeedReturn_raw: returnEl ? returnEl.substring(0, 400) : null,
      raw_response: txt.substring(0, 600),
    };
  } catch (e) { results.CrSeed_SOAP_full = 'ERROR: ' + e.message; }

  // GET con parámetro ?method=getSeed (Axis1 HTTP GET invocation)
  results.CrSeed_GET_method = await check('https://maullin.sii.cl/DTEWS/CrSeed.jws?method=getSeed');

  // WSDL completo de CrSeed para ver la operación exacta
  try {
    const r = await fetch('https://maullin.sii.cl/DTEWS/CrSeed.jws?wsdl', { headers: hdrs });
    const txt = await r.text();
    const ops = [...txt.matchAll(/name="([^"]+)"/g)].map(m => m[1]).filter(n => n.length < 40);
    results.CrSeed_WSDL_ops = ops;
    results.CrSeed_WSDL_targetNS = (txt.match(/targetNamespace="([^"]+)"/) || [])[1];
  } catch (e) { results.CrSeed_WSDL_ops = 'ERROR: ' + e.message; }

  // WSDL de GetTokenFromSeed para ver nombre exacto del parámetro
  try {
    const r = await fetch('https://maullin.sii.cl/DTEWS/GetTokenFromSeed.jws?wsdl', { headers: hdrs });
    const txt = await r.text();
    const ops = [...txt.matchAll(/name="([^"]+)"/g)].map(m => m[1]).filter(n => n.length < 60);
    const parts = [...txt.matchAll(/<part[^>]+name="([^"]+)"[^>]*type="([^"]+)"/g)].map(m => ({ name: m[1], type: m[2] }));
    results.GetTokenFromSeed_WSDL_ops = ops;
    results.GetTokenFromSeed_WSDL_parts = parts;
    results.GetTokenFromSeed_WSDL_raw = txt.substring(0, 1500);
  } catch (e) { results.GetTokenFromSeed_WSDL_ops = 'ERROR: ' + e.message; }

  res.json(results);
});

// PUT /caf
app.put('/caf', (req, res) => {
  try {
    const { tipo_documento, caf_xml } = req.body;
    if (!tipo_documento || !caf_xml)
      return res.status(400).json({ error: 'tipo_documento y caf_xml son requeridos' });
    if (!['33','39','61','56','52'].includes(String(tipo_documento)))
      return res.status(400).json({ error: 'tipo_documento no soportado' });
    const range = parseCafRange(caf_xml);
    kv.put(`caf_${tipo_documento}`, caf_xml);
    kv.put(`folio_${tipo_documento}`, String(range.desde - 1));
    res.json({ ok: true, tipo_documento, rango: range, siguiente_folio: range.desde });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /folio/:tipo
app.get('/folio/:tipo', (req, res) => {
  try {
    const tipo = req.params.tipo;
    const cafXml = kv.get(`caf_${tipo}`);
    if (!cafXml) return res.status(404).json({ error: `Sin CAF para tipo ${tipo}` });
    const range = parseCafRange(cafXml);
    const actual = parseInt(kv.get(`folio_${tipo}`) || String(range.desde - 1));
    res.json({
      tipo_documento: tipo,
      folio_actual: actual,
      siguiente_folio: actual + 1,
      rango_caf: range,
      folios_disponibles: range.hasta - actual,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /test-raw — envía XML mínimo para diagnosticar transporte SOAP
app.get('/test-raw', async (req, res) => {
  try {
    const { certificate } = parsePFX(env.CERT_PFX_BASE64, env.CERT_PFX_PASSWORD);
    const { certDerb64 } = await import('./src/sii-crypto.js');
    const realCertB64 = certDerb64(certificate);

    const hdrs = { 'User-Agent': 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.0)', 'Accept': 'text/xml' };
    const host = env.SII_ENV === 'produccion' ? 'https://palena.sii.cl' : 'https://maullin.sii.cl';

    // Obtener semilla
    const seedSoap =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:impl="http://DefaultNamespace">' +
      '<soapenv:Header/><soapenv:Body><impl:getSeed/></soapenv:Body></soapenv:Envelope>';
    const seedRes = await fetch(`${host}/DTEWS/CrSeed.jws`, {
      method: 'POST', headers: { ...hdrs, 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '""' }, body: seedSoap,
    });
    const seedXml = await seedRes.text();
    const m = seedXml.match(/<[^:>\s]+:getSeedReturn[^>]*>([\s\S]*?)<\/[^:>\s]+:getSeedReturn>/);
    const innerSeed = m ? m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&') : seedXml;
    const semilla = (innerSeed.match(/<SEMILLA>(\d+)<\/SEMILLA>/) || [])[1] || (seedXml.match(/<SEMILLA>(\d+)<\/SEMILLA>/) || [])[1];

    const sendTest = async (label, xml) => {
      const escaped = xml.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      const soap =
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        `<soapenv:Header/><soapenv:Body><getToken xmlns="http://DefaultNamespace">` +
        `<pszXml xsi:type="xsd:string">${escaped}</pszXml>` +
        `</getToken></soapenv:Body></soapenv:Envelope>`;
      const r = await fetch(`${host}/DTEWS/GetTokenFromSeed.jws`, {
        method: 'POST', headers: { ...hdrs, 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '""' }, body: soap,
      });
      const raw = await r.text();
      const ir = raw.match(/<[^:>\s]+:getTokenReturn[^>]*>([\s\S]*?)<\/[^:>\s]+:getTokenReturn>/);
      const dec = ir ? ir[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"') : raw.substring(0,300);
      const estado = (dec.match(/<ESTADO>([^<]+)<\/ESTADO>/) || [])[1];
      const glosa  = (dec.match(/<GLOSA>([^<]+)<\/GLOSA>/)  || [])[1];
      return { label, xmlLen: xml.length, estado, glosa };
    };

    const results = await Promise.all([
      sendTest('A_dummy_cert',    `<item><Semilla>${semilla}</Semilla><Certificate>DUMMYCERT</Certificate></item>`),
      sendTest('B_real_cert_only',`<item><Semilla>${semilla}</Semilla><Certificate>${realCertB64}</Certificate></item>`),
      // C: ¿el namespace xmldsig en Signature rompe el parsing?
      sendTest('C_cert_fake_sig_ns',
        `<item><Semilla>${semilla}</Semilla><Certificate>${realCertB64}</Certificate>` +
        `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><Dummy>X</Dummy></Signature></item>`),
      // D: ¿el problema está en el contenido real de Signature (SHA1, RSA, X509)?
      sendTest('D_cert_fake_sig_noNS',
        `<item><Semilla>${semilla}</Semilla><Certificate>${realCertB64}</Certificate>` +
        `<Signature><SignedInfo/><SignatureValue>${realCertB64.substring(0,100)}</SignatureValue></Signature></item>`),
    ]);

    res.json({ semilla, certB64Len: realCertB64.length, certB64HasNewline: realCertB64.includes('\n'), results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /test-token — prueba el flujo semilla→token sin emitir DTE
app.get('/test-token', async (req, res) => {
  try {
    validateEnvSecrets(env);
    const { privateKey, certificate } = parsePFX(env.CERT_PFX_BASE64, env.CERT_PFX_PASSWORD);
    const token = await getSIIToken(privateKey, certificate, env);
    res.json({ ok: true, token: token.substring(0, 20) + '...' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST / — emitir DTE
app.post('/', async (req, res) => {
  try {
    validateEnvSecrets(env);
    const data = req.body;
    validatePayload(data);

    const { privateKey, certificate } = parsePFX(env.CERT_PFX_BASE64, env.CERT_PFX_PASSWORD);
    const cafXml = kv.get(`caf_${data.tipo_documento}`);
    if (!cafXml) throw new Error(`CAF no encontrado para tipo ${data.tipo_documento}`);

    const folio = nextFolio(data.tipo_documento, cafXml);
    const token = await getSIIToken(privateKey, certificate, env);
    const signedDte = generateSignedDTE(data, folio, cafXml, privateKey, certificate, env);
    const envioDte = buildEnvioDTE(signedDte, data, folio, env, privateKey, certificate);
    const siiResult = await uploadDTE(envioDte, token, env.RUT_EMISOR, env);

    if (siiResult.estado !== '-11' && siiResult.estado !== '-1') {
      kv.put(`folio_${data.tipo_documento}`, String(folio));
    }

    res.json({
      dte_numero: folio,
      tipo_documento: data.tipo_documento,
      trackid: siiResult.trackid,
      estado_sii: siiResult.estado,
      glosa_sii: siiResult.glosa || '',
    });
  } catch (e) {
    console.error('[SII Server]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseCafRange(cafXml) {
  const desde = parseInt((cafXml.match(/<D>(\d+)<\/D>/) || [])[1] || '1');
  const hasta  = parseInt((cafXml.match(/<H>(\d+)<\/H>/) || [])[1] || '100');
  return { desde, hasta };
}

function nextFolio(tipoDTE, cafXml) {
  const range = parseCafRange(cafXml);
  const current = parseInt(kv.get(`folio_${tipoDTE}`) || String(range.desde - 1));
  const next = current + 1;
  if (next > range.hasta) throw new Error(`Folios agotados para tipo ${tipoDTE}`);
  return next;
}

function validateEnvSecrets(env) {
  ['CERT_PFX_BASE64','RUT_EMISOR','RAZON_SOCIAL','GIRO_EMISOR','ACTECO','RESOLUCION_FECHA'].forEach(k => {
    if (!env[k]) throw new Error(`${k} no configurado`);
  });
}

function validatePayload(data) {
  if (!['33','39','61','56','52'].includes(String(data.tipo_documento)))
    throw new Error('tipo_documento inválido');
  if (!data.receptor?.rut)          throw new Error('receptor.rut requerido');
  if (!data.receptor?.razon_social) throw new Error('receptor.razon_social requerido');
  if (!data.detalle?.length)        throw new Error('detalle[] requerido');
  if (!data.totales?.neto || data.totales.neto <= 0) throw new Error('totales.neto debe ser > 0');
  if (!data.totales?.total)         throw new Error('totales.total requerido');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`SII DTE Server en http://0.0.0.0:${PORT}`));
