#!/usr/bin/env node
/*
 * Oficina Virtual: el semáforo, el vigilante y el panel de bloqueos.
 *
 * El semáforo se alimenta del campo Estado de la tabla Automations, que escribe
 * el propio proceso al latir. Un proceso caído no escribe nada, así que "Activo"
 * sin latido reciente no es un estado: es una foto vieja. Verificado contra la
 * base real — Mail API llevaba desde junio en verde sin un solo latido.
 *
 * Correr:  node --test tests/oficina.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const OF = fs.readFileSync(path.join(__dirname, '..', 'js', 'oficina.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function cuerpo(nombre, src) {
  const s = src || OF;
  const i = s.indexOf(nombre);
  assert.ok(i > 0, `debe existir ${nombre}`);
  let d = 0;
  for (let x = s.indexOf('{', i); x < s.length; x++) {
    if (s[x] === '{') d++;
    if (s[x] === '}') { d--; if (!d) return s.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${nombre}`);
}

// Se monta la función REAL del módulo, no una copia. Una versión anterior de
// estas pruebas replicaba el bloque, y por eso una mutación al módulo no rompía
// nada: pasaban en verde sobre código roto. Se detectó mutando.
const { _ofEstadoAutomatizacion, _ofHorarioHabil } = (() => {
  const piezas = ['function _ofAgo(', 'function _ofStatus(', 'function _ofEstadoCls(',
                  'function _ofHorarioHabil(', 'function _ofEstadoAutomatizacion('].map((n) => cuerpo(n)).join('\n');
  return new Function(`const _OF_SIN_SENAL_MS=24*60*60*1000;\n${piezas}\nreturn {_ofEstadoAutomatizacion,_ofHorarioHabil};`)();
})();

const ahora = () => new Date().toISOString();
const hace = (d) => new Date(Date.now() - d * 864e5).toISOString();

test('"Activo" sin un solo latido no puede pintarse en verde', () => {
  const r = _ofEstadoAutomatizacion({}, { Estado: 'Activo' });
  assert.equal(r.cls, 'of-off');
  assert.equal(r.lbl, 'Sin telemetría');
});

test('"Activo" con el latido viejo tampoco', () => {
  const r = _ofEstadoAutomatizacion({}, { Estado: 'Activo', UltimaEjecucion: hace(3) });
  assert.equal(r.cls, 'of-off');
  assert.match(r.lbl, /Sin señal hace 3d/, 'y se dice desde cuándo');
});

test('lo que sí está vivo sigue en verde', () => {
  for (const cfg of [{}, { expectMins: 90 }]) {
    const r = _ofEstadoAutomatizacion(cfg, { Estado: 'Activo', UltimaEjecucion: ahora() });
    assert.ok(r.cls === 'of-active' || r.cls === 'of-work');
    assert.equal(r.lbl, 'Activo');
  }
});

test('el que tiene cadencia esperada se marca atrasado mucho antes', () => {
  const r = _ofEstadoAutomatizacion({ expectMins: 90 }, { Estado: 'Activo', UltimaEjecucion: hace(3 / 24) });
  assert.equal(r.cls, 'of-off');
  assert.equal(r.lbl, 'Atrasado');
});

test('sin telemetría no se reclama cadencia (no hay nada que atrasar)', () => {
  const r = _ofEstadoAutomatizacion({ expectMins: 90 }, { Estado: 'Activo' });
  assert.equal(r.lbl, 'Sin telemetría', 'primero falta la evidencia, no el reloj');
});

test('un error manda sobre todo lo demás', () => {
  assert.equal(_ofEstadoAutomatizacion({}, { Estado: 'Error de conexión', UltimaEjecucion: ahora() }).cls, 'of-error');
  // Ni la cadencia ni la falta de señal deben tapar un error explícito.
  assert.equal(_ofEstadoAutomatizacion({ expectMins: 5 }, { Estado: 'Error', UltimaEjecucion: hace(9) }).cls, 'of-error');
});

test('"En reposo" se respeta tal cual', () => {
  const r = _ofEstadoAutomatizacion({}, { Estado: 'En reposo' });
  assert.equal(r.cls, 'of-off');
  assert.equal(r.lbl, 'En reposo');
});

test('al proxy solo se le exige cadencia en horario de trabajo', () => {
  // Late a golpe de uso del dashboard, no por reloj: exigirle un domingo a las
  // 3 AM sería gritar por nada, y una alarma que grita sin motivo se ignora.
  const cfg = { expectMins: 45, soloHabil: true };
  const mudo = { Estado: 'Activo', UltimaEjecucion: new Date(Date.now() - 2 * 3600e3).toISOString() };
  const r = _ofEstadoAutomatizacion(cfg, mudo);
  if (_ofHorarioHabil()) assert.equal(r.lbl, 'Atrasado', 'en hábil sí se le exige');
  else assert.equal(r.lbl, 'Activo', 'fuera de hábil no se le exige nada');
  // Un domingo a las 4 de la mañana nunca es horario hábil.
  assert.equal(_ofHorarioHabil(new Date('2026-08-09T08:00:00Z')), false, 'domingo de madrugada');
  // Un martes a mediodía sí.
  assert.equal(_ofHorarioHabil(new Date('2026-08-11T16:00:00Z')), true, 'martes al mediodía');
  assert.match(OF, /expectMins:45, soloHabil:true/, 'el proxy debe declararlo');
});

test('el degradado ocurre antes de contar quién trabaja', () => {
  // Si no, el resumen seguiría inflado aunque la tarjeta se vea gris.
  const i = OF.indexOf('const st=_ofEstadoAutomatizacion(a,f);');
  const j = OF.indexOf("if(cls==='of-work') working++;", i);
  assert.ok(i > 0 && j > i);
});

test('el vigilante avisa solo en los cambios', () => {
  // Verificado además en navegador: 0 avisos en la primera lectura, 0 sin
  // cambios, 1 al caerse y 1 al recuperarse.
  const fn = cuerpo('function _ofVigilar(');
  assert.match(fn, /if\(antes===undefined\) continue;/, 'la primera lectura no avisa de nada');
  assert.match(fn, /if\(antes===m\.cls\) continue;/, 'sin cambios, silencio');
  assert.match(fn, /_ofSano\(antes\)&&!_ofSano\(m\.cls\)/, 'avisa al caerse');
  assert.match(fn, /!_ofSano\(antes\)&&_ofSano\(m\.cls\)/, 'y al recuperarse');
  assert.match(fn, /localStorage\.setItem\(_OF_VIG_KEY/, 'el estado previo sobrevive a la recarga');
});

test('el vigilante corre en segundo plano sin gastar de más', () => {
  const remoto = cuerpo('async function _ofVigilarRemoto(');
  assert.match(remoto, /if\(document\.hidden\|\|!navigator\.onLine\) return;/, 'no consulta con la ventana oculta');
  assert.match(remoto, /airtableFetch\('Automations',\s*50\)/, 'solo lee la tabla que necesita');
  const start = cuerpo('function startOficinaWatch(');
  assert.match(start, /clearInterval\(_ofVigTimer\)/, 'no apila temporizadores');
  assert.match(start, /10\*60\*1000/, 'cada 10 minutos');
  // Y tiene que arrancar con el dashboard, no solo al abrir la Oficina: el
  // sentido es enterarse estando en otra sección.
  assert.match(HTML, /startOficinaWatch\(\)/, 'debe arrancarse en el init');
});

test('el modo taller se puede dejar fijo en una pantalla', () => {
  const auto = cuerpo('function _ofAutoTaller(');
  const re = /\(\^\|\[#&\?\]\)taller\(=1\)\?\\b/;
  assert.match(auto, re, 'debe reconocer #taller y ?taller=1');
  // Comprobado en navegador que #tallerx y #detalle NO lo activan.
  const modo = cuerpo('function ofModoTaller(');
  assert.match(modo, /switchTab\('oficina'\)/);
  assert.match(modo, /ofSetView\('iso'\)/, 'entra en la vista isométrica');
  assert.match(modo, /ofFullscreen\(\)/);
  assert.match(modo, /_ofMantenerPantalla\(true\)/, 'y evita que el monitor se duerma');
  const wake = cuerpo('async function _ofMantenerPantalla(');
  assert.match(wake, /navigator\.wakeLock/);
  assert.match(wake, /catch\(e\)\{ _ofWakeLock=null; \}/, 'sin soporte, el modo taller igual funciona');
});

test('el panel de bloqueos mira lo que NO avanza', () => {
  const fn = cuerpo('function _ofBloqueos(');
  // Las cinco cosas que frenan el trabajo, todas de datos ya cargados.
  assert.match(fn, /Fecha entrega'\]\+'T00:00:00'\)<hoy/, 'pedidos pasados de fecha');
  assert.match(fn, /==='Listo para despacho'/, 'listos sin despachar');
  assert.match(fn, /!f\['Fecha entrega'\]/, 'activos sin fecha');
  assert.match(fn, /dias\(d\)>=7/, 'cotizaciones frías');
  assert.match(fn, /Punto de reorden/, 'material bajo mínimo');
  assert.match(fn, /sort\(\(a,b\)=>b\.sev-a\.sev\)/, 'lo más urgente primero');
  // Respeta el alcance del vendedor, como el resto del dashboard.
  assert.match(fn, /isVendorMode/, 'y el alcance del vendedor');
  assert.match(fn, /vendorOwnsRecord/);
});

test('los atajos del panel no llevan a secciones vetadas', () => {
  const fn = cuerpo('function _ofRenderBloqueos(');
  assert.match(fn, /RBAC\.tabs\[u\.role\]/, 'debe consultarse el rol');
  assert.match(fn, /const puede=!permitidas\|\|permitidas\.includes\(b\.tab\)/);
  assert.match(fn, /Nada frenado/, 'y decir cuando no hay nada que frene');
});

test('el sondeo no se apila ni corre con la pestaña oculta', () => {
  const start = cuerpo('function startOficinaPolling(');
  assert.match(start, /clearInterval\(_oficinaInterval\);\s*_oficinaInterval=setInterval/);
  assert.match(start, /if\(!document\.hidden\)/);
  const stop = cuerpo('function stopOficinaPolling(');
  assert.match(stop, /clearInterval\(_oficinaInterval\)/);
  assert.match(stop, /_oficinaInterval=null/);
});

test('si Airtable falla, la oficina lo dice en vez de fingir', () => {
  assert.match(OF, /_ofErr=true/);
  assert.match(OF, /errEl\.textContent='⚠ Sin conexión con Airtable[^']*'/, 'el banner debe decirlo');
  assert.match(OF, /errEl\.style\.display=''/, 'y hacerse visible');
  assert.match(OF, /Datos en caché/);
});
