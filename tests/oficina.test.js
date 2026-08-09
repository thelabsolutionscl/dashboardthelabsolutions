#!/usr/bin/env node
/*
 * Oficina Virtual: que el color diga la verdad.
 *
 * La oficina existe para ver de un vistazo qué está vivo. Su semáforo se
 * alimenta del campo Estado de la tabla Automations — pero ese campo lo escribe
 * el propio proceso al latir, y un proceso caído no escribe nada. Así que
 * "Activo" sin latido reciente no es un estado: es una foto vieja.
 *
 * Verificado contra la base real: Mail API llevaba desde junio marcado Activo
 * sin un solo latido registrado. La oficina afirmaba que el correo estaba
 * operativo sin ninguna evidencia.
 *
 * Correr:  node --test tests/oficina.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const OF = fs.readFileSync(path.join(__dirname, '..', 'js', 'oficina.js'), 'utf8');

function cuerpo(nombre) {
  const i = OF.indexOf(nombre);
  assert.ok(i > 0, `debe existir ${nombre}`);
  let d = 0;
  for (let x = OF.indexOf('{', i); x < OF.length; x++) {
    if (OF[x] === '{') d++;
    if (OF[x] === '}') { d--; if (!d) return OF.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${nombre}`);
}

// Réplica del bloque que decide el estado de una automatización, montada con
// las funciones reales del módulo.
const estado = (() => {
  const piezas = ['function _ofAgo(', 'function _ofStatus(', 'function _ofEstadoCls('].map(cuerpo).join('\n');
  const bloque = `
    function estado(a,f){
      let cls='of-off',lbl='Sin telemetría';
      if(f){
        const lastT=Date.parse(f['UltimaEjecucion']||'')||0;
        cls=_ofEstadoCls(f['Estado'])||_ofStatus(lastT).cls;
        lbl=f['Estado']||_ofStatus(lastT).lbl;
        if(a.expectMins&&lastT&&(Date.now()-lastT)>a.expectMins*60000&&cls!=='of-error'){cls='of-off';lbl='Atrasado';}
        if(cls==='of-work'||cls==='of-active'){
          if(!lastT){cls='of-off';lbl='Sin telemetría';}
          else if(Date.now()-lastT>_OF_SIN_SENAL_MS){cls='of-off';lbl='Sin señal '+_ofAgo(lastT);}
        }
      }
      return {cls,lbl};
    }`;
  return new Function(`${piezas}\nconst _OF_SIN_SENAL_MS=24*60*60*1000;${bloque}\nreturn estado;`)();
})();

const ahora = () => new Date().toISOString();
const hace = (d) => new Date(Date.now() - d * 864e5).toISOString();

test('"Activo" sin un solo latido no puede pintarse en verde', () => {
  // El caso literal de la base: fila creada con Estado=Activo y nunca actualizada.
  const r = estado({}, { Estado: 'Activo' });
  assert.equal(r.cls, 'of-off', 'sin telemetría no hay verde');
  assert.equal(r.lbl, 'Sin telemetría');
});

test('"Activo" con el latido viejo tampoco', () => {
  const r = estado({}, { Estado: 'Activo', UltimaEjecucion: hace(3) });
  assert.equal(r.cls, 'of-off');
  assert.match(r.lbl, /Sin señal hace 3d/, 'y se dice desde cuándo');
});

test('lo que sí está vivo sigue en verde', () => {
  for (const cfg of [{}, { expectMins: 90 }]) {
    const r = estado(cfg, { Estado: 'Activo', UltimaEjecucion: ahora() });
    assert.ok(r.cls === 'of-active' || r.cls === 'of-work', 'un latido reciente debe verse activo');
    assert.equal(r.lbl, 'Activo');
  }
});

test('el que tiene cadencia esperada se marca atrasado mucho antes', () => {
  // lead-worker late cada hora por cron: a las 3 horas ya es un problema, no
  // hay que esperar las 24 del corte general.
  const r = estado({ expectMins: 90 }, { Estado: 'Activo', UltimaEjecucion: hace(3 / 24) });
  assert.equal(r.cls, 'of-off');
  assert.equal(r.lbl, 'Atrasado');
});

test('un error sigue mandando sobre todo lo demás', () => {
  const r = estado({}, { Estado: 'Error de conexión', UltimaEjecucion: ahora() });
  assert.equal(r.cls, 'of-error');
});

test('"En reposo" se respeta tal cual', () => {
  const r = estado({}, { Estado: 'En reposo' });
  assert.equal(r.cls, 'of-off');
  assert.equal(r.lbl, 'En reposo');
});

test('la lógica probada arriba es la que está en el módulo', () => {
  // Las pruebas de comportamiento montan una réplica del bloque, porque el
  // original vive dentro de una función enorme y no se puede aislar. Eso solo
  // vale si la réplica y el original coinciden: si alguien toca el módulo y
  // aquí no se refleja, estas comprobaciones dejan de decir nada.
  assert.match(OF, /if\(cls==='of-work'\|\|cls==='of-active'\)\{/, 'el degradado se aplica solo a los estados que afirman vida');
  assert.match(OF, /if\(!lastT\)\{ cls='of-off'; lbl='Sin telemetría'; \}/, 'sin latido, gris');
  assert.match(OF, /else if\(Date\.now\(\)-lastT>_OF_SIN_SENAL_MS\)\{ cls='of-off'; lbl='Sin señal '\+_ofAgo\(lastT\); \}/, 'con latido viejo, gris');
  assert.match(OF, /if\(a\.expectMins && lastT && \(Date\.now\(\)-lastT\)>a\.expectMins\*60000 && cls!=='of-error'\)/, 'y la cadencia esperada se sigue respetando');
});

test('el corte por falta de señal está declarado y es razonable', () => {
  assert.match(OF, /const _OF_SIN_SENAL_MS=24\*60\*60\*1000;/, 'debe existir el umbral');
  // El degradado tiene que ocurrir ANTES de contar "trabajando", o el resumen
  // seguiría inflado aunque la tarjeta se vea gris.
  const i = OF.indexOf("if(!lastT){ cls='of-off'; lbl='Sin telemetría'; }");
  const j = OF.indexOf("if(cls==='of-work') working++;", i);
  assert.ok(i > 0 && j > i, 'el conteo de trabajando va después del degradado');
});

test('el sondeo no se apila ni corre con la pestaña oculta', () => {
  const start = cuerpo('function startOficinaPolling(');
  assert.match(start, /clearInterval\(_oficinaInterval\);\s*_oficinaInterval=setInterval/, 'debe limpiarse antes de armar');
  assert.match(start, /if\(!document\.hidden\)/, 'no debe refrescar con la pestaña oculta');
  const stop = cuerpo('function stopOficinaPolling(');
  assert.match(stop, /clearInterval\(_oficinaInterval\)/);
  assert.match(stop, /_oficinaInterval=null/);
});

test('si Airtable falla, la oficina lo dice en vez de fingir', () => {
  // Es lo contrario de lo que hacía Inventario: aquí sí estaba bien resuelto.
  assert.match(OF, /_ofErr=true/, 'debe registrarse el fallo de lectura');
  // El aviso tiene que ESCRIBIRSE en el banner, no solo existir como texto en
  // algún tooltip: la primera versión de esta prueba pasaba con el banner vacío.
  assert.match(OF, /errEl\.textContent='⚠ Sin conexión con Airtable[^']*'/, 'el banner debe decirlo');
  assert.match(OF, /errEl\.style\.display=''/, 'y hacerse visible');
  assert.match(OF, /Datos en caché/, 'con un distintivo visible');
});
