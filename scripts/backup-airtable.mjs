#!/usr/bin/env node
/*
 * Backup completo del CRM (Airtable → JSON) para el cron semanal de GitHub Actions.
 * Mismo criterio que el botón "💾 Respaldar ahora" del dashboard, pero server-side:
 * no depende de que alguien abra el navegador.
 *
 * Uso:  AIRTABLE_TOKEN=pat… node scripts/backup-airtable.mjs
 * Salida: backup/backup-crm-<fecha>.json  +  backup/resumen.txt (para el correo)
 */
import { writeFile, mkdir } from 'fs/promises';

const TOKEN = process.env.AIRTABLE_TOKEN;
if (!TOKEN) { console.error('Falta AIRTABLE_TOKEN'); process.exit(1); }

const BASE_ID = 'app1YtD74AqiPWQhy';
const API = process.env.AIRTABLE_API || 'https://api.airtable.com'; // sobreescribible para tests
const TABLAS = ['Clientes', 'Cotizaciones', 'Pedidos', 'Proveedores', 'Facturas', 'Reportes', 'Maquinas', 'Automations', 'Social_Posts', 'Social_Interactions', 'Agent_Log'];

async function fetchTable(tabla) {
  const records = [];
  let offset = '';
  do {
    const url = `${API}/v0/${BASE_ID}/${encodeURIComponent(tabla)}?pageSize=100${offset ? '&offset=' + offset : ''}`;
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + TOKEN } });
    if (!r.ok) throw new Error(`HTTP ${r.status} en ${tabla}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    records.push(...(j.records || []));
    offset = j.offset || '';
  } while (offset);
  return records;
}

const fecha = new Date().toISOString().slice(0, 10);
const data = { fecha: new Date().toISOString(), origen: 'github-actions-weekly', tablas: {} };
const fallos = [];
let total = 0;

for (const t of TABLAS) {
  try {
    const recs = await fetchTable(t);
    data.tablas[t] = recs;
    total += recs.length;
    console.log(`  ✓ ${t}: ${recs.length} registros`);
  } catch (e) {
    fallos.push(t);
    console.error(`  ✗ ${t}: ${e.message}`);
  }
}

if (!total) { console.error('No se pudo leer ninguna tabla — backup abortado'); process.exit(1); }

await mkdir('backup', { recursive: true });
const fname = `backup/backup-crm-${fecha}.json`;
await writeFile(fname, JSON.stringify(data));

// Resumen para el correo semanal (texto plano)
const L = [`Backup semanal del CRM — ${fecha}`, ''];
L.push(`Total: ${total.toLocaleString('es-CL')} registros en ${Object.keys(data.tablas).length} tablas.`);
for (const [t, recs] of Object.entries(data.tablas)) L.push(`  • ${t}: ${recs.length}`);
if (fallos.length) L.push('', `⚠ Tablas no disponibles: ${fallos.join(', ')}`);
// Última semana según la tabla Reportes, si existe
try {
  const reps = (data.tablas.Reportes || [])
    .slice()
    .sort((a, b) => String(b.fields['Fecha generación'] || '').localeCompare(String(a.fields['Fecha generación'] || '')));
  const f = reps[0]?.fields;
  if (f) {
    L.push('', `Último reporte semanal (${f['Semana'] || f['Fecha generación'] || '—'}):`);
    if (f['Revenue semana (CLP)']) L.push(`  • Revenue: $${Math.round(f['Revenue semana (CLP)']).toLocaleString('es-CL')}`);
    if (f['Tasa conversión (%)'] != null) { const c = f['Tasa conversión (%)']; L.push(`  • Conversión: ${(c <= 1 ? c * 100 : c).toFixed(0)}%`); }
    if (f['Pedidos despachados'] != null) L.push(`  • Pedidos despachados: ${f['Pedidos despachados']}`);
  }
} catch (e) { /* el resumen es best-effort */ }
L.push('', 'El respaldo completo queda como artifact del workflow (90 días).', 'Dashboard: https://dashboard.thelab.solutions');
await writeFile('backup/resumen.txt', L.join('\n'));

console.log(`\n✓ ${fname} (${total.toLocaleString('es-CL')} registros)${fallos.length ? ' · fallos: ' + fallos.join(', ') : ''}`);
