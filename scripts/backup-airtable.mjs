#!/usr/bin/env node
/*
 * Respaldo semanal de TODAS las tablas existentes en Airtable.
 * La metadata determina el alcance: una lista fija deja fuera las tablas nuevas.
 *
 * IMPORTANTE: este repositorio es público. Solo se guarda el JSON CIFRADO
 * (AES-256-GCM + scrypt con sal/IV aleatorios por respaldo). Nunca subir JSON
 * de clientes en texto plano a los artifacts de GitHub Actions.
 *
 * Secrets del workflow: AIRTABLE + BACKUP_ENCRYPTION_KEY (clave separada).
 * Salida: backup/backup-crm-YYYY-MM-DD.enc.json + backup/resumen.txt (correo,
 * este último NO se incluye en los artifacts públicos).
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';

const TOKEN = process.env.AIRTABLE_TOKEN;
const ENCRYPTION_KEY = (process.env.BACKUP_ENCRYPTION_KEY || '').trim();
const BASE_ID = 'app1YtD74AqiPWQhy';
const API = process.env.AIRTABLE_API || 'https://api.airtable.com';
const MAX_REINTENTOS = Number(process.env.BACKUP_REINTENTOS || 4);
const dormir = (ms) => new Promise((res) => setTimeout(res, ms));
const REQUIRED_TABLES = ['Clientes','Cotizaciones','Pedidos','Facturas'];
// Solo se usa si falla la consulta de metadata y SIEMPRE marca el resultado
// INCOMPLETO: no se puede garantizar que esta lista cubra toda la base.
const FALLBACK_TABLES = [
  'Clientes','Cotizaciones','Pedidos','Facturas','Proveedores','Reportes',
  'Maquinas','Automations','Social_Posts','Social_Interactions','Agent_Log',
  'Monitor Sistema','Maquinas_Eventos','Maquinas_Mant','Equipo_Eventos','Inventario',
];

await mkdir('backup', { recursive: true });
if (!TOKEN) {
  await writeFile('backup/resumen.txt', '⚠ RESPALDO BLOQUEADO: falta el secreto AIRTABLE.\n');
  console.error('Falta AIRTABLE_TOKEN');
  process.exit(1);
}
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
  await writeFile('backup/resumen.txt',
    '⚠ RESPALDO BLOQUEADO: falta BACKUP_ENCRYPTION_KEY (mínimo 32 caracteres). No se subieron datos de clientes.\n');
  console.error('BACKUP_ENCRYPTION_KEY ausente o demasiado corta — prohibido subir CRM sin cifrar a un repositorio público.');
  process.exit(1);
}

// GET de página, con backoff acotado solo ante red/429/5xx.
async function getPagina(url, tabla) {
  for (let intento = 0; ; intento++) {
    let r, err;
    try { r = await fetch(url, { headers: { Authorization: 'Bearer ' + TOKEN } }); }
    catch (e) { err = e; }
    if (r && r.ok) return r.json();
    const transitorio = err || r.status === 429 || r.status >= 500;
    if (!transitorio) throw new Error('HTTP ' + r.status + ' en ' + tabla + ': ' + (await r.text()).slice(0, 200));
    if (intento >= MAX_REINTENTOS) throw err || new Error('HTTP ' + r.status + ' en ' + tabla + ' tras ' + MAX_REINTENTOS + ' reintentos');
    await dormir(Math.min(30000, 1000 * 2 ** intento));
  }
}

async function descubrirTablas() {
  const out = [], nombres = new Set(), offsets = new Set();
  let offset = '';
  do {
    const url = API + '/v0/meta/bases/' + BASE_ID + '/tables' +
      (offset ? '?offset=' + encodeURIComponent(offset) : '');
    const j = await getPagina(url, 'metadata Airtable');
    if (!j || !Array.isArray(j.tables)) throw new Error('Metadata inválida: no incluye tables[]');
    for (const t of j.tables) {
      if (!t || typeof t.name !== 'string' || !t.name.trim() ||
          typeof t.id !== 'string' || !/^tbl[A-Za-z0-9]{14}$/.test(t.id) ||
          nombres.has(t.name)) throw new Error('Metadata de tablas inválida o duplicada');
      nombres.add(t.name);
      out.push(t.name);
    }
    const next = j.offset || '';
    if (next && (typeof next !== 'string' || offsets.has(next))) throw new Error('Paginación de metadata inválida');
    if (next) offsets.add(next);
    offset = next;
  } while (offset);
  if (!out.length) throw new Error('Metadata sin tablas: no se puede certificar respaldo completo');
  return out;
}

async function fetchTable(tabla) {
  const records = [], offsets = new Set();
  let offset = '';
  do {
    const url = API + '/v0/' + BASE_ID + '/' + encodeURIComponent(tabla) +
      '?pageSize=100' + (offset ? '&offset=' + encodeURIComponent(offset) : '');
    const j = await getPagina(url, tabla);
    if (!j || !Array.isArray(j.records) ||
        j.records.some(r => !r || typeof r.id !== 'string' || !r.fields || typeof r.fields !== 'object'))
      throw new Error('Respuesta malformada de ' + tabla + ': no es seguro respaldar esta tabla');
    records.push(...j.records);
    const next = j.offset || '';
    if (next && (typeof next !== 'string' || offsets.has(next))) throw new Error('Paginación de ' + tabla + ' inválida');
    if (next) offsets.add(next);
    offset = next;
  } while (offset);
  return records;
}

function cifrarRespaldo(data, passphrase) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    format: 'thelab-airtable-backup',
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

const fecha = new Date().toISOString().slice(0, 10);
const data = { fecha: new Date().toISOString(), origen: 'github-actions-weekly', tablas: {}, completo: false, fallos: [] };
const fallos = [];
let tablas, metaOk = false, total = 0;
try {
  tablas = await descubrirTablas();
  metaOk = true;
} catch (e) {
  console.error('⚠ No se pudo descubrir el esquema: ' + e.message);
  tablas = FALLBACK_TABLES;
  fallos.push('Metadata: ' + e.message);
}
for (const required of REQUIRED_TABLES) {
  if (!tablas.includes(required)) fallos.push('Falta tabla crítica en el esquema: ' + required);
}
for (const t of tablas) {
  try {
    const recs = await fetchTable(t);
    data.tablas[t] = recs;
    total += recs.length;
    console.log('  ✓ ' + t + ': ' + recs.length + ' registros');
  } catch (e) {
    fallos.push(t + ': ' + e.message);
    console.error('  ✗ ' + t + ': ' + e.message);
  }
}
data.fallos = fallos;
data.completo = metaOk && !fallos.length && total > 0;
const L = [
  data.completo ? '✓ RESPALDO COMPLETO — ' + fecha : '⚠ RESPALDO INCOMPLETO — ' + fecha,
  '',
  'Registros leídos: ' + total.toLocaleString('es-CL') + ' en ' + Object.keys(data.tablas).length + ' tablas.',
];
for (const [t, recs] of Object.entries(data.tablas)) L.push('  • ' + t + ': ' + recs.length);
if (fallos.length) L.push('', '⚠ No respaldado / sin verificar:', ...fallos.map(x => '  • ' + x));
try {
  const reps = (data.tablas.Reportes || []).slice()
    .sort((a, b) => String(b.fields['Fecha generación'] || '').localeCompare(String(a.fields['Fecha generación'] || '')));
  const f = reps[0]?.fields;
  if (f) {
    L.push('', 'Último reporte semanal (' + (f['Semana'] || f['Fecha generación'] || '—') + '):');
    if (f['Revenue semana (CLP)']) L.push('  • Revenue: $' + Math.round(f['Revenue semana (CLP)']).toLocaleString('es-CL'));
    if (f['Tasa conversión (%)'] != null) {
      const c = f['Tasa conversión (%)'];
      L.push('  • Conversión: ' + (c <= 1 ? c * 100 : c).toFixed(0) + '%');
    }
    if (f['Pedidos despachados'] != null) L.push('  • Pedidos despachados: ' + f['Pedidos despachados']);
  }
} catch (_) { /* resumen no afecta integridad de los datos */ }
L.push('', 'Los datos se guardan solo como artifact CIFRADO (AES-256-GCM; secret BACKUP_ENCRYPTION_KEY).',
  'Dashboard: https://dashboard.thelab.solutions');
await writeFile('backup/resumen.txt', L.join('\n'));

// Nunca escribir la versión plaintext en disco. Incluso si falla una tabla,
// guardar el rescate cifrado, pero el job debe quedar rojo para impedir que
// se confunda un rescate parcial con un backup íntegro.
if (total > 0) {
  const encrypted = cifrarRespaldo(data, ENCRYPTION_KEY);
  await writeFile('backup/backup-crm-' + fecha + '.enc.json', JSON.stringify(encrypted));
}
if (!data.completo) {
  console.error('RESPALDO INCOMPLETO: ' + (fallos.join('; ') || '0 registros') + '. El job debe fallar.');
  process.exitCode = 1;
} else {
  console.log('✓ Respaldo completo cifrado: ' + total.toLocaleString('es-CL') + ' registros');
}
