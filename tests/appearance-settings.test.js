'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const HTML=fs.readFileSync('index.html','utf8');
const CSS=fs.readFileSync('styles.css','utf8');

test('Apariencia vive en el menú de usuario y abre su selector',()=>{
  assert.match(HTML,/openAppearanceSettings\(\)[\s\S]{0,180}Apariencia/);
  assert.match(HTML,/function openAppearanceSettings\(\)/);
  assert.match(HTML,/Apariencia del dashboard/);
});

test('tema, wallpaper y fuente se persisten y se aplican antes de pintar',()=>{
  assert.match(HTML,/tls_ui_theme/);
  assert.match(HTML,/tls_ui_wallpaper/);
  assert.match(HTML,/tls_ui_font/);
  assert.match(HTML,/root\.dataset\.theme/);
  assert.match(HTML,/root\.dataset\.wallpaper/);
  assert.match(HTML,/root\.dataset\.font/);
  assert.ok(HTML.indexOf("root.dataset.theme=pick('tls_ui_theme'")<HTML.indexOf('<link rel="stylesheet" href="styles.css'), 'la preferencia debe aplicarse antes del CSS principal');
});

test('hay exactamente dos temas y tres fondos seleccionables',()=>{
  assert.match(HTML,/_APPEARANCE_ALLOWED=\{theme:\['dark','light'\],wallpaper:\['blueprint','holographic','glass'\],font:\['dm','inter','space'\]\}/);
  assert.match(HTML,/_appearanceChoice\('theme','dark'/);
  assert.match(HTML,/_appearanceChoice\('theme','light'/);
  assert.match(HTML,/_appearanceChoice\('wallpaper','blueprint'/);
  assert.match(HTML,/_appearanceChoice\('wallpaper','holographic'/);
  assert.match(HTML,/_appearanceChoice\('wallpaper','glass'/);
});

test('los tres fondos son CSS responsivo y funcionan en claro/oscuro',()=>{
  assert.match(CSS,/data-wallpaper="blueprint"/);
  assert.match(CSS,/data-wallpaper="holographic"/);
  assert.match(CSS,/data-wallpaper="glass"/);
  assert.match(CSS,/data-theme="light"\]\[data-wallpaper="blueprint"/);
  assert.match(CSS,/data-theme="light"\]\[data-wallpaper="holographic"/);
  assert.match(CSS,/data-theme="light"\]\[data-wallpaper="glass"/);
});

test('tema claro redefine superficies, textos y navegación',()=>{
  assert.match(CSS,/html\[data-theme="light"\]\{/);
  assert.match(CSS,/--surface:rgba\(255,255,255/);
  assert.match(CSS,/--text:#122126/);
  assert.match(CSS,/html\[data-theme="light"\] \.topbar/);
  assert.match(CSS,/html\[data-theme="light"\] \.icon-dock/);
});

test('selector de fuente ofrece DM Sans, Inter y Space Grotesk',()=>{
  assert.match(HTML,/family=Inter/);
  assert.match(HTML,/family=Space\+Grotesk/);
  assert.match(CSS,/data-font="dm"/);
  assert.match(CSS,/data-font="inter"/);
  assert.match(CSS,/data-font="space"/);
  assert.match(CSS,/--font-ui:'Inter'/);
  assert.match(CSS,/--font-ui:'Space Grotesk'/);
});

test('cambiar tema actualiza theme-color y dispara evento global',()=>{
  assert.match(HTML,/meta\[name="theme-color"\]/);
  assert.match(HTML,/tls:appearance-changed/);
  assert.match(HTML,/values\.theme==='light'\?'#f3f7f8':'#0a0a0a'/);
});
