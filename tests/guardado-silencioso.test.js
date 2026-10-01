#!/usr/bin/env node
/*
 * Guardados que fallan en silencio.
 *
 * El patrón es siempre el mismo: se escribe en Airtable dentro de un try, el
 * catch está vacío, y justo después el código pinta el dato en pantalla o
 * lanza un aviso verde. El usuario ve que "quedó", y al recargar no está.
 *
 * Esto no prohíbe el catch vacío —hay escrituras que son de verdad best-effort
 * (crear campos que faltan, bitácora de agentes)— sino que exige que las
 * escrituras que sostienen una decisión de negocio digan cuándo fallan.
 *
 * Correr:  node --test tests/guardado-silencioso.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ARCHIVOS = ['index.html', ...fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f)];

// Lo que no puede perderse sin avisar. Cada uno vale plata o deja el pedido en
// un estado que no existe:
//   DTE N°            — el folio ya se consumió en el SII
//   Factura URL       — sin el enlace, desde otro equipo la factura no existe
//   Foto QA URL       — evidencia de calidad
//   Estado Pago       — cobranza
//   Estado pedido     — el ciclo operativo completo
//   Etapa venta       — embudo comercial
//   Estado cotización — de esto depende el seguimiento
//   Reactivado        — si vuelve, el cliente se recontacta solo
const CRITICOS = [
  'DTE N°', 'Factura URL', 'Foto QA URL', 'Estado Pago',
  'Estado pedido', 'Etapa venta', 'Estado cotización', 'Reactivado',
];

// Recorre cada try{…}catch(x){…} y devuelve {archivo, linea, cuerpo, manejo}.
function bloquesTry(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const out = [];
  const re = /\btry\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    let d = 0, q = '', esc = false, lc = false, bc = false, end = -1;
    for (let i = open; i < src.length; i++) {
      const c = src[i], n = src[i + 1];
      if (lc) { if (c === '\n') lc = false; continue; }
      if (bc) { if (c === '*' && n === '/') { bc = false; i++; } continue; }
      if (q) { if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === q) q = ''; continue; }
      if (c === '/' && n === '/') { lc = true; i++; continue; }
      if (c === '/' && n === '*') { bc = true; i++; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '{') d++;
      if (c === '}') { d--; if (d === 0) { end = i; break; } }
    }
    if (end < 0) continue;
    const cm = /^\s*catch\s*\(([^)]*)\)\s*\{([\s\S]{0,120}?)\}/.exec(src.slice(end + 1, end + 260));
    if (!cm) continue;
    out.push({
      rel,
      linea: src.slice(0, m.index).split('\n').length,
      cuerpo: src.slice(open, end + 1),
      manejo: cm[2].replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim(),
    });
  }
  return out;
}

const TODOS = ARCHIVOS.flatMap(bloquesTry);
const esEscritura = (s) => /airtableWrite(?:Tolerant)?\s*\(/.test(s);

test('ningún guardado crítico se pierde sin avisar', () => {
  const mudos = TODOS.filter((b) => !b.manejo && esEscritura(b.cuerpo) && CRITICOS.some((campo) => b.cuerpo.includes(campo)))
    .map((b) => `${b.rel}:${b.linea} → ${CRITICOS.filter((c) => b.cuerpo.includes(c)).join(', ')}`);
  assert.deepEqual(mudos, [], `Escrituras críticas con catch vacío:\n  ${mudos.join('\n  ')}`);
});

test('existe una forma común de avisar que algo no se guardó', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /function\s+avisoNoGuardado\s*\(/, 'debe existir el helper compartido');
  const cuerpo = /function\s+avisoNoGuardado\s*\([\s\S]{0,400}?\n\}/.exec(html)[0];
  assert.match(cuerpo, /toast\(/, 'el usuario tiene que verlo, no solo la consola');
  assert.match(cuerpo, /console\.warn/, 'debe quedar rastro para depurar');
  // Si el helper mismo explota (p. ej. toast aún no existe) se comería el aviso.
  assert.ok((cuerpo.match(/try\s*\{/g) || []).length >= 2, 'el helper no puede lanzar por su cuenta');
});

test('el DTE emitido en el SII nunca se pierde en silencio', () => {
  // Es el peor caso: el folio ya se consumió río arriba y es irrecuperable.
  const fin = fs.readFileSync(path.join(ROOT, 'js', 'finanzas.js'), 'utf8');
  const i = fin.indexOf("'DTE N°':String(dteNum)");
  assert.ok(i > 0, 'debe seguir guardándose el DTE en el pedido');
  const despues = fin.slice(i, i + 300);
  assert.match(despues, /catch\s*\([^)]*\)\s*\{\s*avisoNoGuardado/, 'el fallo debe avisarse');
  assert.match(despues, /SII/, 'el aviso debe decir que el documento ya existe en el SII');
});

test('marcar facturas cobradas en masa reporta las que no salieron', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const i = html.indexOf('async function marcarFiltradasCobradas');
  assert.ok(i > 0);
  const fn = html.slice(i, i + 1600);
  assert.match(fn, /fallidas/, 'debe llevarse la cuenta de las que fallaron');
  assert.match(fn, /if\s*\(\s*fallidas\.length\s*\)[\s\S]{0,220}?'error'/, 'si alguna falla, el aviso no puede ser verde');
});

test('al enviar una cotización no se anuncia un registro que no ocurrió', () => {
  const correo = fs.readFileSync(path.join(ROOT, 'js', 'correo.js'), 'utf8');
  const i = correo.indexOf('_registrarCotEnviada');
  assert.ok(i > 0);
  const fn = correo.slice(i, i + 1400);
  assert.match(fn, /registrada como enviada/, 'sigue existiendo el aviso de éxito');
  assert.match(fn, /else\s+toast\([\s\S]{0,220}?'error'\)/, 'si el estado no cambió, debe decirlo');
});

test('quitar la marca de Reactivado se deshace si Airtable la rechaza', () => {
  const ag = fs.readFileSync(path.join(ROOT, 'js', 'agentes.js'), 'utf8');
  const i = ag.indexOf('async function quitarReactivado');
  assert.ok(i > 0);
  const fn = ag.slice(i, i + 1200);
  // El aviso es optimista (sale antes del guardado), así que el rollback es lo
  // único que evita que la marca "reviva" sola al recargar.
  assert.match(fn, /catch\s*\([^)]*\)\s*\{[\s\S]{0,300}?Reactivado'\]\s*=\s*antes\.r/, 'debe restaurarse el valor previo');
  assert.match(fn, /avisoNoGuardado/, 'y avisarse');
});
