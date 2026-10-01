const fs=require('node:fs');
const test=require('node:test');
const assert=require('node:assert/strict');
const src=fs.readFileSync('js/calendario-operaciones.js','utf8');

test('capa operacional incluye módulos críticos',()=>{
  for(const token of ['Iniciar jornada','Simular nuevo pedido','Replanificación inteligente','Tareas recurrentes','Modo TV','Falta material','Postproducción','Historial']){
    assert.ok(src.includes(token),`falta ${token}`);
  }
});

test('expone API CalOps y respeta integración con calendario',()=>{
  assert.match(src,/window\.CalOps=api/);
  assert.match(src,/renderCalendario/);
  assert.match(src,/calUpdateCrmDate/);
  assert.match(src,/MachineOps/);
});
