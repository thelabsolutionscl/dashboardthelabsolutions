#!/usr/bin/env node
/*
 * El dashboard en un teléfono.
 *
 * Todo lo de aquí se midió antes en navegador real a 375×667 (iPhone SE) y
 * 393×851 (Android), con sesión iniciada: 15 secciones, 75 modales, tamaños de
 * letra, zonas de toque y desbordes. El layout móvil resultó estar bien hecho
 * —las barras anchas se desplazan en vez de cortarse, y ningún modal se sale—
 * salvo dos cosas, que son las que arregla este cambio.
 *
 * Correr:  node --test tests/movil.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

// Devuelve el contenido de los bloques @media de pantalla chica.
const MOVIL = (() => {
  const out = [];
  const re = /@media\s*\(max-width:\s*(\d+)px\)\s*\{/g;
  let m;
  while ((m = re.exec(CSS))) {
    if (parseInt(m[1], 10) > 900) continue;
    let d = 1, i = m.index + m[0].length;
    for (; i < CSS.length && d > 0; i++) {
      if (CSS[i] === '{') d++;
      else if (CSS[i] === '}') d--;
    }
    out.push(CSS.slice(m.index + m[0].length, i - 1));
  }
  return out.join('\n');
})();

test('en el teléfono, escribir en un campo no dispara el zoom de iOS', () => {
  // Safari amplía la página al enfocar un campo con letra menor a 16px y la
  // deja descuadrada. Los campos del cotizador estaban en 12px, así que pasaba
  // en cada ítem de una cotización — donde más se escribe.
  assert.match(MOVIL, /input:not\(\[type=checkbox\]\)[\s\S]{0,200}?font-size:16px!important/,
    'los campos de texto deben subir a 16px en pantalla chica');
  // El !important es necesario: el 12px viene en el atributo style de cada input.
  assert.match(MOVIL, /font-size:16px!important/);
  // Casillas y radios quedan fuera: no provocan zoom y ahí el tamaño es la caja.
  const regla = /input:not\(\[type=checkbox\]\)[^{]*\{[^}]*\}/.exec(MOVIL)[0];
  for (const t of ['checkbox', 'radio', 'range', 'color']) {
    assert.ok(regla.includes(`:not([type=${t}])`), `${t} debe quedar excluido`);
  }
});

test('la regla del zoom no toca el escritorio', () => {
  // Fuera del @media, subir todos los campos a 16px descuadraría las tablas
  // densas del escritorio, que es donde se trabaja la mayor parte del tiempo.
  const fuera = CSS.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
  assert.doesNotMatch(fuera, /input:not\(\[type=checkbox\]\)[\s\S]{0,200}?font-size:16px!important/,
    'la regla solo puede vivir dentro de un @media de pantalla chica');
});

test('los accesos principales se pueden tocar con el pulgar', () => {
  // Correo, notificaciones y el menú medían 32px de alto: por debajo de lo que
  // se acierta sin apuntar. En móvil son la navegación principal.
  assert.match(MOVIL, /\.notif-btn\{[^}]*min-width:40px[^}]*min-height:40px/,
    'correo y notificaciones necesitan 40px');
  assert.match(MOVIL, /\.mobile-menu-btn:not\(#mobilePlusBtn\)\{[^}]*min-height:40px/,
    'el menú hamburguesa también');
});

test('las barras de navegación anchas se desplazan en vez de cortarse', () => {
  // Medido: Pedidos tiene 17 botones (1400px de ancho) en una pantalla de 375.
  // Si la barra no se desplazara, diez de esos filtros serían inalcanzables.
  for (const barra of ['#pedidosFilterBar', '#fin-subnav']) {
    const i = MOVIL.indexOf(barra + '{');
    assert.ok(i > 0, `${barra} debe tener reglas propias en móvil`);
    const regla = MOVIL.slice(i, MOVIL.indexOf('}', i));
    assert.match(regla, /overflow-x:\s*auto/, `${barra} debe poder desplazarse`);
    assert.match(regla, /flex-wrap:\s*nowrap/, `${barra} no debe envolver`);
  }
  // Y sus botones no pueden encogerse hasta ser ilegibles.
  assert.match(MOVIL, /#fin-subnav \.btn\{[^}]*flex-shrink:0/);
});

test('el dock inferior está oculto a propósito, no por accidente', () => {
  // La navegación móvil vive en el cajón lateral. Sin el motivo escrito, la
  // próxima auditoría lo reporta como un dock roto — casi me pasa.
  assert.match(MOVIL, /\.mobile-bottom-dock\{display:none!important;\}/);
  assert.match(CSS, /navegación vive en el drawer lateral/i,
    'el motivo debe quedar junto a la regla');
});
