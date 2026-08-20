#!/usr/bin/env node
'use strict';
// El widget "Ocupación de máquinas" agrupa por tipo y no desborda la etiqueta
// negra sobre el nombre en móvil (bug reportado desde el teléfono 2026-08-19).

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const SRC=fs.readFileSync(path.join(__dirname,'..','js','maquinas.js'),'utf8');

function functionSource(name){
  const marker=`function ${name}(`;
  const start=SRC.indexOf(marker);
  assert.notEqual(start,-1,`falta ${name}`);
  const body=SRC.indexOf('{',start);
  let depth=0;
  for(let i=body;i<SRC.length;i++){
    if(SRC[i]==='{')depth++;
    else if(SRC[i]==='}'&&--depth===0)return SRC.slice(start,i+1);
  }
  throw new Error(`no se pudo aislar ${name}`);
}

function render(maquinas,estados,filtro='all'){
  const el={style:{},innerHTML:''};
  const ctx={
    Date,Math,Object,
    document:{getElementById:id=>id==='maqOcupacion'?el:null},
    _monitorFilter:filtro,
    MAQUINAS:maquinas,
    _printerStatus:estados,
    _printerInitialStatus:m=>({state:'offline'}),
    escapeHtml:s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),
  };
  vm.createContext(ctx);
  vm.runInContext(functionSource('renderMaqOcupacion')+'\nthis.render=renderMaqOcupacion;',ctx);
  ctx.render();
  return el.innerHTML;
}

const MAQ=[
  {id:'k1-1',nombre:'Creality K1',num:1,numG:1,modelo:'K1',color:'#00d4cc'},
  {id:'e5-1',nombre:'Creality Ender-5 Max',num:1,numG:6,modelo:'Ender-5 Max',color:'#ffaa00'},
  {id:'k2-1',nombre:'Creality K2',num:1,numG:12,modelo:'K2',color:'#a78bfa'},
  {id:'k1-2',nombre:'Creality K1',num:2,numG:2,modelo:'K1',color:'#00d4cc'},
  {id:'e5-2',nombre:'Creality Ender-5 Max',num:2,numG:7,modelo:'Ender-5 Max',color:'#ffaa00'},
];
const EST={
  'k1-1':{state:'printing',eta:3600,progress:0.4},
  'e5-1':{state:'standby'},
  'k2-1':{state:'printing',eta:1800,progress:0.9},
  'k1-2':{state:'offline'},
  'e5-2':{state:'printing',eta:600,progress:0.19},
};

test('las máquinas del mismo tipo quedan contiguas (agrupadas)',()=>{
  const html=render(MAQ,EST);
  // Orden de aparición de cada modelo por su primer nombre en el HTML.
  const idx=m=>html.indexOf('>'+m+'<')>=0?html.indexOf('>'+m+'<'):html.indexOf(m);
  const posK1=[...html.matchAll(/Creality K1</g)].map(x=>x.index);
  const posEnder=[...html.matchAll(/Creality Ender-5 Max</g)].map(x=>x.index);
  const posK2=[...html.matchAll(/Creality K2</g)].map(x=>x.index);
  // Las dos K1 tienen que estar antes de las dos Ender, y las Ender antes que K2,
  // sin intercalarse (agrupación real, no orden por hora).
  assert.ok(Math.max(...posK1)<Math.min(...posEnder),'las K1 no están todas juntas antes de las Ender');
  assert.ok(Math.max(...posEnder)<Math.min(...posK2),'las Ender no están todas juntas antes de la K2');
});

test('cada tipo trae su encabezado con el conteo',()=>{
  const html=render(MAQ,EST);
  // El encabezado del grupo lleva el modelo y cuántas hay.
  assert.match(html,/K1<\/span>\s*<span[^>]*>2</,'falta encabezado K1 con 2');
  assert.match(html,/Ender-5 Max<\/span>\s*<span[^>]*>2</,'falta encabezado Ender con 2');
});

test('filtrado a un solo tipo: sin encabezados de grupo',()=>{
  const html=render(MAQ,EST,'K1');
  // Con un único modelo no tiene sentido el encabezado repetido.
  assert.ok(!/letter-spacing:\.02em/.test(html),'no debería haber encabezado de grupo con un solo tipo');
});

test('la etiqueta de la barra no se ancla con flex-end (ya no se desborda)',()=>{
  const html=render(MAQ,EST);
  // El bug era justify-content:flex-end + texto más ancho que la barra. Ahora la
  // etiqueta es una pastilla absoluta y la pista recorta lo que sobre.
  assert.ok(!/justify-content:flex-end/.test(html),'la barra de ETA no debe usar flex-end');
  assert.match(html,/position:absolute;right:5px/,'la etiqueta debe ir fija al borde derecho');
  assert.ok((html.match(/overflow:hidden/g)||[]).length>0,'la pista debe recortar el desborde');
});

test('el eje de horas se alinea al ancho responsivo del nombre',()=>{
  const html=render(MAQ,EST);
  assert.match(html,/margin:0 0 4px calc\(clamp\([^)]*\) \+ 23px\)/,'el eje no sigue al ancho del nombre');
});
