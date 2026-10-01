const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const led=fs.readFileSync(path.join(root,'js/maquinas-led.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');

test('maquinas-led carga extensiones del Farm Controller y MachineOps',()=>{
  assert.match(led,/js\/maquinas-farm-controller\.js/);
  assert.match(led,/js\/machineops-storage-adapter\.js/);
  assert.match(led,/document\.write/);
});

test('bootstrap queda entre maquinas.js y maquinas-operaciones.js',()=>{
  const maquinas=index.indexOf('js/maquinas.js');
  const ledPos=index.indexOf('js/maquinas-led.js');
  const ops=index.indexOf('js/maquinas-operaciones.js');
  assert.ok(maquinas>=0,'falta maquinas.js');
  assert.ok(ledPos>maquinas,'maquinas-led.js debe cargar después de maquinas.js');
  assert.ok(ops>ledPos,'maquinas-operaciones.js debe cargar después del bootstrap');
});
