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

// GET /debug — diagnóstico: IP de salida + acceso al SII
app.get('/debug', async (req, res) => {
  try {
    const ipRes = await fetch('https://api.ipify.org?format=json');
    const { ip } = await ipRes.json();

    let siiStatus = 'desconocido';
    try {
      const siiRes = await fetch('https://maullin.sii.cl/DTEWS/CrSeed.jws', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/xml, application/xml, */*',
          'Accept-Language': 'es-CL,es;q=0.9',
        },
      });
      const txt = await siiRes.text();
      siiStatus = txt.includes('<SEMILLA>') ? 'OK — semilla recibida' : 'BLOQUEADO: ' + txt.substring(0, 200);
    } catch (e) {
      siiStatus = 'ERROR: ' + e.message;
    }

    res.json({ outbound_ip: ip, sii_seed_test: siiStatus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
