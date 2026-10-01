const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.resolve(__dirname,'..');
const SOURCE=fs.readFileSync(path.join(ROOT,'js/comisiones-35-standard.js'),'utf8');
const LOADER=fs.readFileSync(path.join(ROOT,'js/farm-health-adapter.js'),'utf8');

test('la comisión comercial queda fijada en 3,5% sobre venta neta',()=>{
  assert.match(SOURCE,/COM35_RATE\s*=\s*3\.5/);
  assert.match(SOURCE,/cfg\.rate\s*=\s*COM35_RATE/);
  assert.match(SOURCE,/cfg\.base\s*=\s*['"]venta['"]/);
  assert.match(SOURCE,/thelab_comision_cfg_v1/);
});

test('corrige configuraciones locales antiguas antes de renderizar',()=>{
  assert.match(SOURCE,/com35Enforce\(\);/);
  assert.match(SOURCE,/root\.renderComisiones=function/);
  assert.match(SOURCE,/root\.setComisionCfg=function/);
});

test('el dashboard carga la regla de comisión estándar',()=>{
  assert.match(LOADER,/load\(['"]js\/comisiones-35-standard\.js['"],['"]comisión de ventas estándar 3,5%['"]\)/);
});
