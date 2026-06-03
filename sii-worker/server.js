import express from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { parsePFX } from './src/sii-crypto.js';
import { getSIIToken, uploadDTE, getUploadStatus } from './src/sii-auth.js';
import { buildSignedEnvioDTE, buildSignedEnvioDTESet } from './src/dte-xml.js';
import { buildSetCases, SET_FOLIOS_NEEDED } from './src/set-pruebas.js';

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

// PUT /caf-file/:tipo — sube el CAF enviando el XML crudo en el body
// (más simple: curl -X PUT .../caf-file/61 -H "Content-Type: text/xml" --data-binary @CAF_61.xml)
app.put('/caf-file/:tipo', express.text({ type: () => true, limit: '5mb' }), (req, res) => {
  try {
    const tipo = String(req.params.tipo);
    const cafXml = typeof req.body === 'string' ? req.body : '';
    if (!cafXml.trim()) return res.status(400).json({ error: 'Body vacío: envía el XML del CAF como cuerpo de la petición' });
    if (!['33','39','61','56','52'].includes(tipo))
      return res.status(400).json({ error: 'tipo_documento no soportado' });
    if (!cafXml.includes('<CAF')) return res.status(400).json({ error: 'El body no parece un CAF (falta <CAF>)' });
    const range = parseCafRange(cafXml);
    kv.put(`caf_${tipo}`, cafXml);
    kv.put(`folio_${tipo}`, String(range.desde - 1));
    res.json({ ok: true, tipo_documento: tipo, rango: range, siguiente_folio: range.desde });
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

    // Obtiene una semilla fresca (SII la invalida después del primer uso)
    const getFreshSemilla = async () => {
      const seedSoap =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:impl="http://DefaultNamespace">' +
        '<soapenv:Header/><soapenv:Body><impl:getSeed/></soapenv:Body></soapenv:Envelope>';
      const r = await fetch(`${host}/DTEWS/CrSeed.jws`, {
        method: 'POST', headers: { ...hdrs, 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '""' }, body: seedSoap,
      });
      const xml = await r.text();
      const m = xml.match(/<[^:>\s]+:getSeedReturn[^>]*>([\s\S]*?)<\/[^:>\s]+:getSeedReturn>/);
      const inner = m ? m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&') : xml;
      return (inner.match(/<SEMILLA>(\d+)<\/SEMILLA>/) || [])[1] || (xml.match(/<SEMILLA>(\d+)<\/SEMILLA>/) || [])[1];
    };

    const sendTest = async (label, xmlFn) => {
      const semilla = await getFreshSemilla();
      const xml = xmlFn(semilla);
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
      const estado = (dec.match(/<ESTADO>([^<]+)<\/ESTADO>/) || [])[1] || '?';
      const glosa  = (dec.match(/<GLOSA>([^<]+)<\/GLOSA>/)  || [])[1] || dec.substring(0,100);
      return { label, semilla, xmlLen: xml.length, estado, glosa };
    };

    // Secuencial: cada test usa su propia semilla fresca
    const sigNs = 'xmlns="http://www.w3.org/2000/09/xmldsig#"';
    const results = [];
    // Estructura antigua: Signature DENTRO de <item>
    results.push(await sendTest('B_item_cert_only',         s => `<item><Semilla>${s}</Semilla><Certificate>${realCertB64}</Certificate></item>`));
    results.push(await sendTest('C_item_cert_fakeSig',      s => `<item><Semilla>${s}</Semilla><Certificate>${realCertB64}</Certificate><Signature ${sigNs}><Dummy>X</Dummy></Signature></item>`));
    // Estructura nueva: Signature como HERMANA bajo <getToken>
    results.push(await sendTest('D_getToken_cert_only',     s => `<getToken><item><Semilla>${s}</Semilla><Certificate>${realCertB64}</Certificate></item></getToken>`));
    results.push(await sendTest('E_getToken_cert_fakeSig',  s => `<getToken><item><Semilla>${s}</Semilla><Certificate>${realCertB64}</Certificate></item><Signature ${sigNs}><Dummy>X</Dummy></Signature></getToken>`));
    // Sin Certificate en item, cert solo en X509Certificate de KeyInfo
    results.push(await sendTest('F_getToken_x509_only',     s => `<getToken><item><Semilla>${s}</Semilla></item><Signature ${sigNs}><KeyInfo><X509Data><X509Certificate>${realCertB64}</X509Certificate></X509Data></KeyInfo></Signature></getToken>`));

    res.json({ certB64Len: realCertB64.length, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /test-cert — inspecciona el .pfx: cuántos certs trae y cuál matchea la clave
app.get('/test-cert', async (req, res) => {
  try {
    const { describePFX } = await import('./src/sii-crypto.js');
    res.json(describePFX(env.CERT_PFX_BASE64, env.CERT_PFX_PASSWORD));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /preview-dte — genera un EnvioDTE de ejemplo y lo devuelve como XML,
// SIN subirlo al SII y SIN consumir folio. Sirve para inspeccionar la firma.
app.get('/preview-dte', async (req, res) => {
  try {
    validateEnvSecrets(env);
    const tipo = '33';
    const cafXml = kv.get(`caf_${tipo}`);
    if (!cafXml) throw new Error(`CAF no encontrado para tipo ${tipo}`);

    const { privateKey, certificate } = parsePFX(env.CERT_PFX_BASE64, env.CERT_PFX_PASSWORD);
    const range = parseCafRange(cafXml);
    const folio = range.desde;  // primer folio del rango (no se persiste)

    const sample = {
      tipo_documento: tipo,
      receptor: {
        rut: '66666666-6',
        razon_social: 'Cliente de Prueba SII',
        giro: 'Servicios de prueba',
        direccion: 'Calle Falsa 123',
        comuna: 'Santiago',
        ciudad: 'Santiago',
      },
      detalle: [
        { nombre: 'Servicio de prueba', cantidad: 1, precio_unitario: 100000, monto_neto: 100000 },
      ],
      totales: { neto: 100000, iva: 19000, total: 119000 },
    };

    const xml = buildSignedEnvioDTE(sample, folio, cafXml, privateKey, certificate, env);
    res.type('application/xml').send(xml);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /test-emit — emite una Factura de prueba REAL al SII (consume 1 folio).
// Usa el mismo flujo que POST / pero con datos de ejemplo, para validar el
// pipeline completo contra SII certificación.
app.get('/test-emit', async (req, res) => {
  try {
    validateEnvSecrets(env);
    const tipo = '33';
    const cafXml = kv.get(`caf_${tipo}`);
    if (!cafXml) throw new Error(`CAF no encontrado para tipo ${tipo}`);

    const { privateKey, certificate } = parsePFX(env.CERT_PFX_BASE64, env.CERT_PFX_PASSWORD);
    const sample = {
      tipo_documento: tipo,
      receptor: {
        rut: '66666666-6',
        razon_social: 'Cliente de Prueba SII',
        giro: 'Servicios de prueba',
        direccion: 'Calle Falsa 123',
        comuna: 'Santiago',
        ciudad: 'Santiago',
      },
      detalle: [
        { nombre: 'Servicio de prueba', cantidad: 1, precio_unitario: 100000, monto_neto: 100000 },
      ],
      totales: { neto: 100000, iva: 19000, total: 119000 },
    };

    const folio = nextFolio(tipo, cafXml);
    const token = await getSIIToken(privateKey, certificate, env);
    const envioDte = buildSignedEnvioDTE(sample, folio, cafXml, privateKey, certificate, env);
    persistEmittedDtes(envioDte);
    const siiResult = await uploadDTE(envioDte, token, env.RUT_EMISOR, env);

    if (siiResult.estado !== '-11' && siiResult.estado !== '-1') {
      kv.put(`folio_${tipo}`, String(folio));
    }

    res.json({
      folio,
      trackid: siiResult.trackid,
      estado_sii: siiResult.estado,
      glosa_sii: siiResult.glosa || '',
      http: siiResult.http,
      raw: siiResult.raw,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Guarda cada <DTE> del EnvioDTE en ./data/dte/{tipo}_{folio}.xml para poder
// generar después su representación impresa (PDF con timbre).
function persistEmittedDtes(envioXml) {
  const dir = join(DATA_DIR, 'dte');
  if (!existsSync(dir)) mkdirSync(dir);
  const blocks = envioXml.match(/<DTE\b[\s\S]*?<\/DTE>/g) || [];
  for (const b of blocks) {
    const tipo = (b.match(/<TipoDTE>(\d+)<\/TipoDTE>/) || [])[1];
    const folio = (b.match(/<Folio>(\d+)<\/Folio>/) || [])[1];
    if (tipo && folio) writeFileSync(join(dir, `${tipo}_${folio}.xml`), b, 'utf8');
  }
}

// Reserva los próximos `count` folios de un tipo SIN persistir todavía.
function peekFolios(tipo, count, cafXml) {
  const range = parseCafRange(cafXml);
  let current = parseInt(kv.get(`folio_${tipo}`) || String(range.desde - 1));
  const folios = [];
  for (let i = 0; i < count; i++) {
    current++;
    if (current > range.hasta) throw new Error(`Folios agotados para tipo ${tipo} (rango ${range.desde}-${range.hasta})`);
    folios.push(current);
  }
  return folios;
}

// Arma el SET BÁSICO de certificación: asigna folios, construye los casos
// y devuelve { folioMap, cafs, documentos, missing, skipped }.
// allowPartial=true genera solo los documentos cuyos CAF ya están disponibles.
function prepareSet({ allowPartial = false } = {}) {
  const cafs = {};
  const folioMap = {};
  const missing = [];
  for (const [tipo, count] of Object.entries(SET_FOLIOS_NEEDED)) {
    const cafXml = kv.get(`caf_${tipo}`);
    if (!cafXml) { missing.push(tipo); folioMap[tipo] = []; continue; }
    cafs[tipo] = cafXml;
    folioMap[tipo] = peekFolios(tipo, count, cafXml);
  }
  if (missing.length && !allowPartial) {
    throw new Error(`Falta CAF para tipo(s) ${missing.join(', ')}. Súbelo con PUT /caf-file/:tipo (necesarios: ${Object.keys(SET_FOLIOS_NEEDED).join(', ')}).`);
  }
  const allCases = buildSetCases(folioMap);
  const documentos = [], skipped = [];
  for (const data of allCases) {
    if (cafs[data.tipo_documento]) documentos.push({ data, folio: data.folio, cafXml: cafs[data.tipo_documento] });
    else skipped.push(data.tipo_documento);
  }
  // Solo persistir/contar los tipos que efectivamente se incluyeron
  const usedFolioMap = {};
  for (const tipo of Object.keys(cafs)) usedFolioMap[tipo] = folioMap[tipo];
  return { folioMap: usedFolioMap, cafs, documentos, missing, skipped };
}

// GET /preview-set — genera el SET BÁSICO (XML) sin subirlo ni consumir folios.
// Genera solo los documentos con CAF disponible (parcial), y antepone un
// comentario con lo incluido/omitido.
app.get('/preview-set', async (req, res) => {
  try {
    validateEnvSecrets(env);
    const { privateKey, certificate } = parsePFX(env.CERT_PFX_BASE64, env.CERT_PFX_PASSWORD);
    const { documentos, missing } = prepareSet({ allowPartial: true });
    if (!documentos.length) throw new Error('No hay ningún CAF disponible para generar el set.');
    const incluidos = documentos.map(d => `${d.data.tipo_documento}#${d.folio}`).join(', ');
    const xml = buildSignedEnvioDTESet(documentos, env, privateKey, certificate);
    const comentario =
      `<!-- PREVIEW SET 4877403 | documentos incluidos: ${incluidos}` +
      (missing.length ? ` | OMITIDOS por falta de CAF tipo(s): ${missing.join(', ')}` : '') +
      ` -->`;
    // El comentario va DESPUÉS de la declaración <?xml?> (debe ir primero el prolog)
    const out = xml.replace(/(<\?xml[^>]*\?>\s*)/, `$1${comentario}\n`);
    res.type('application/xml').send(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /pdf/:tipo/:folio — representación impresa (PDF + timbre PDF417) de un DTE YA emitido.
app.get('/pdf/:tipo/:folio', async (req, res) => {
  try {
    const f = join(DATA_DIR, 'dte', `${req.params.tipo}_${req.params.folio}.xml`);
    if (!existsSync(f)) return res.status(404).json({ error: `No hay DTE emitido para tipo ${req.params.tipo} folio ${req.params.folio}. Emítelo primero.` });
    const { generateDtePdf } = await import('./src/pdf-dte.js');
    res.type('application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="DTE_${req.params.tipo}_${req.params.folio}.pdf"`);
    await generateDtePdf(readFileSync(f, 'utf8'), env, res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /preview-pdf — PDF de prueba del layout sin emitir. ?tipo=&folio= para elegir,
// si no, toma el primer documento del set.
app.get('/preview-pdf', async (req, res) => {
  try {
    validateEnvSecrets(env);
    const { privateKey, certificate } = parsePFX(env.CERT_PFX_BASE64, env.CERT_PFX_PASSWORD);
    const { documentos } = prepareSet({ allowPartial: true });
    if (!documentos.length) throw new Error('No hay CAF disponible para generar el set.');
    const xml = buildSignedEnvioDTESet(documentos, env, privateKey, certificate);
    const blocks = xml.match(/<DTE\b[\s\S]*?<\/DTE>/g) || [];
    let block = blocks[0];
    if (req.query.tipo && req.query.folio) {
      block = blocks.find(b =>
        (b.match(/<TipoDTE>(\d+)<\/TipoDTE>/) || [])[1] === String(req.query.tipo) &&
        (b.match(/<Folio>(\d+)<\/Folio>/) || [])[1] === String(req.query.folio)
      ) || blocks[0];
    }
    const { generateDtePdf } = await import('./src/pdf-dte.js');
    res.type('application/pdf');
    await generateDtePdf(block, env, res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /set-pruebas — emite el SET BÁSICO completo al SII (consume folios).
app.post('/set-pruebas', async (req, res) => {
  try {
    validateEnvSecrets(env);
    const { privateKey, certificate } = parsePFX(env.CERT_PFX_BASE64, env.CERT_PFX_PASSWORD);
    const allowPartial = req.query.partial === 'true' || req.query.partial === '1';
    const { folioMap, documentos, missing } = prepareSet({ allowPartial });
    if (!documentos.length) throw new Error('No hay documentos para emitir (faltan CAF).');

    const token = await getSIIToken(privateKey, certificate, env);
    const envioDte = buildSignedEnvioDTESet(documentos, env, privateKey, certificate);
    persistEmittedDtes(envioDte);
    const siiResult = await uploadDTE(envioDte, token, env.RUT_EMISOR, env);

    // Persistir los folios consumidos solo si la recepción fue OK (STATUS 0)
    if (siiResult.estado === '0') {
      for (const [tipo, folios] of Object.entries(folioMap)) {
        kv.put(`folio_${tipo}`, String(folios[folios.length - 1]));
      }
    }

    res.json({
      folios: folioMap,
      documentos_emitidos: documentos.length,
      omitidos_por_falta_caf: missing,
      trackid: siiResult.trackid,
      estado_sii: siiResult.estado,
      glosa_sii: siiResult.glosa || '',
      http: siiResult.http,
      raw: siiResult.raw,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /estado/:trackid — consulta el estado de procesamiento de un envío
app.get('/estado/:trackid', async (req, res) => {
  try {
    validateEnvSecrets(env);
    const { privateKey, certificate } = parsePFX(env.CERT_PFX_BASE64, env.CERT_PFX_PASSWORD);
    const token = await getSIIToken(privateKey, certificate, env);
    const result = await getUploadStatus(req.params.trackid, token, env.RUT_EMISOR, env);
    res.json(result);
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
    const envioDte = buildSignedEnvioDTE(data, folio, cafXml, privateKey, certificate, env);
    persistEmittedDtes(envioDte);
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
