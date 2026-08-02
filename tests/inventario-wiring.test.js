#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const OPS_PATH=path.join(ROOT,'js','maquinas-operaciones.js');
const OPS=fs.existsSync(OPS_PATH)?fs.readFileSync(OPS_PATH,'utf8'):'';
const SOURCE=`${INDEX}\n${OPS}`;

function count(pattern,text=SOURCE){return(text.match(pattern)||[]).length;}
function hasFunction(source,name){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp(`(?:async\\s+)?function\\s+${escaped}\\s*\\(`).test(source);
}
function functionBlock(source,name){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const start=new RegExp(`(?:async\\s+)?function\\s+${escaped}\\s*\\(`).exec(source);
  assert.ok(start,`falta ${name}`);
  const tail=source.slice(start.index+start[0].length);
  const next=/\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(tail);
  return source.slice(start.index,next?start.index+start[0].length+next.index:source.length);
}
function hasOneOf(text,patterns,message){
  assert.ok(patterns.some(pattern=>pattern.test(text)),message);
}

test('Inventario tiene una sola entrada, navegación y contenedores únicos',()=>{
  assert.equal(count(/id=["']tab-inventario["']/g,INDEX),1,'#tab-inventario debe ser único');
  assert.match(SOURCE,/switchTab\(\s*['"]inventario['"]\s*\)/,'debe existir navegación a Inventario');
  for(const id of ['invTbody','invTableWrap','invCards','invCardsWrap','invChartCat','invChartMat','invReordenCard','recompraTrayCard']){
    assert.equal(count(new RegExp(`id=["']${id}["']`,'g'),INDEX),1,`${id} debe existir exactamente una vez`);
  }
});

test('las funciones críticas de inventario no están ausentes ni duplicadas',()=>{
  const names=['renderInventario','addMaterial','editMaterial','deleteMaterial','openConsumoModal','aplicarConsumo','renderReordenInventario','_reordenSugerencias','pedirReorden'];
  for(const name of names){
    assert.ok(hasFunction(INDEX,name),`falta ${name}`);
    assert.equal(count(new RegExp(`function\\s+${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*\\(`,'g'),INDEX),1,`${name} debe definirse una vez`);
  }
});

test('Inventario usa un estado central y la tabla Airtable correcta',()=>{
  assert.match(INDEX,/state\.inventario/,'debe existir state.inventario como fuente de la interfaz');
  assert.match(INDEX,/airtable(?:Fetch|Write)(?:Tolerant)?\(\s*['"]Inventario['"]/,'debe leer o escribir la tabla Inventario');
  for(const field of ['Material','Stock actual','Unidad','Punto de reorden'])assert.match(INDEX,new RegExp(field),`falta el campo ${field}`);
});

test('altas, ediciones y eliminaciones persisten antes de confirmar el cambio',()=>{
  const add=functionBlock(INDEX,'addMaterial');
  const edit=functionBlock(INDEX,'editMaterial');
  const del=functionBlock(INDEX,'deleteMaterial');
  assert.match(add,/await\s+airtableWrite(?:Tolerant)?\(\s*['"]Inventario['"]\s*,\s*['"]POST['"]/,'addMaterial debe esperar el POST');
  assert.match(edit,/await\s+airtableWrite(?:Tolerant)?\(\s*['"]Inventario['"]\s*,\s*['"]PATCH['"]/,'editMaterial debe esperar el PATCH');
  assert.match(del,/await\s+airtableWrite(?:Tolerant)?\(\s*['"]Inventario['"]\s*,\s*['"]DELETE['"]/,'deleteMaterial debe esperar el DELETE');
});

test('el consumo por pedido valida cantidad y no permite stock negativo',()=>{
  const body=functionBlock(INDEX,'aplicarConsumo');
  assert.match(body,/qty\s*>\s*0|\.filter\([^)]*qty[^)]*>\s*0/,'solo debe procesar cantidades positivas');
  hasOneOf(body,[
    /qty\s*>\s*(?:s|stock|disponible)/,
    /(?:nuevo|restante)\s*<\s*0/,
    /Math\.max\(\s*0\s*,\s*(?:s|stock|disponible)\s*-\s*[^)]+\)/
  ],'debe bloquear o acotar descuentos superiores al stock disponible');
  assert.match(body,/airtableWrite(?:Tolerant)?\(\s*['"]Inventario['"]\s*,\s*['"]PATCH['"]/,'debe persistir el descuento en Inventario');
});

test('el consumo conserva trazabilidad y evita confirmar un movimiento incompleto',()=>{
  const body=functionBlock(INDEX,'aplicarConsumo');
  const stockWrite=body.search(/await\s+airtableWrite(?:Tolerant)?\(\s*['"]Inventario['"]\s*,\s*['"]PATCH['"]/);
  const historyWrite=body.search(/await\s+airtableWrite(?:Tolerant)?\(\s*['"]Pedidos['"]\s*,\s*['"]PATCH['"]/);
  assert.ok(stockWrite>=0,'debe guardar primero el stock');
  assert.ok(historyWrite>stockWrite,'el historial del pedido debe guardarse después del stock');
  assert.match(body,/Consumo materiales/,'debe conservar el historial en el pedido');
  assert.doesNotMatch(body,/airtableWrite(?:Tolerant)?\([^;]+Inventario[^;]+\)\s*;?\s*}\s*catch\s*\([^)]*\)\s*\{\s*\}/,'el error del PATCH de inventario no puede tragarse');
  hasOneOf(body,[/prev/i,/anterior/i,/restaur/i,/rollback/i],'debe poder revertir el estado local si Airtable falla');
});

test('el reorden nace únicamente de stock bajo o agotado y propone una cantidad positiva',()=>{
  const body=functionBlock(INDEX,'_reordenSugerencias');
  assert.match(body,/state\.inventario/);
  hasOneOf(body,[/_invEstado\(/,/_invStatus\(/,/stockMinimo\(/],'debe reutilizar el estado oficial del material');
  hasOneOf(body,[/sev\s*<\s*2/,/bajo|agotado/i,/stock\s*<=\s*(?:ro|min)/i],'debe excluir materiales con stock sano');
  assert.match(body,/Math\.max\(/,'la cantidad sugerida debe tener un mínimo positivo');
});

test('la reposición conserva material, unidad y proveedor sin alterar el stock antes de recibirlo',()=>{
  const body=functionBlock(INDEX,'pedirReorden');
  assert.match(body,/_reordenSugerencias\(\)/,'debe usar la sugerencia calculada');
  assert.match(body,/proveedor|prov/i,'debe conservar el proveedor sugerido');
  assert.match(body,/material/i,'debe conservar el material solicitado');
  assert.match(body,/unidad/i,'debe conservar la unidad solicitada');
  assert.doesNotMatch(body,/airtableWrite(?:Tolerant)?\(\s*['"]Inventario['"]\s*,\s*['"]PATCH['"]/,'pedir no debe aumentar stock antes de recibir la compra');
});

test('la previsión de recompra está conectada cuando el módulo está disponible',()=>{
  const names=['_recompraSugerencias','renderRecompraTray','confirmarRecompra'];
  const present=names.filter(name=>hasFunction(INDEX,name));
  assert.ok(present.length===0||present.length===names.length,'el módulo de recompra debe estar completo, no parcialmente enlazado');
  if(present.length){
    const body=functionBlock(INDEX,'_recompraSugerencias');
    assert.match(body,/14|catorce/i,'la previsión debe declarar su ventana de 14 días');
    assert.match(body,/state\.inventario/,'debe partir del inventario real');
  }
});

test('MachineOps reserva rollos y evita sobreasignar material',()=>{
  assert.ok(OPS,'debe existir js/maquinas-operaciones.js');
  for(const name of ['reservedForSpool','spoolAvailable','compatibleSpools','consumeJobMaterial'])assert.ok(hasFunction(OPS,name),`falta ${name}`);
  const reserved=functionBlock(OPS,'reservedForSpool');
  const available=functionBlock(OPS,'spoolAvailable');
  const consume=functionBlock(OPS,'consumeJobMaterial');
  assert.match(reserved,/activeJobs\(\)/,'solo trabajos activos deben reservar material');
  assert.match(reserved,/!j\.materialConsumed/,'un trabajo ya consumido no debe reservar de nuevo');
  assert.match(available,/remaining\)\s*-\s*reservedForSpool/,'el disponible debe descontar reservas');
  assert.match(consume,/if\(j\.materialConsumed\)return/,'el consumo operacional debe ser idempotente');
  assert.match(consume,/Math\.max\(0/,'el rollo nunca debe quedar con cantidad negativa');
});

test('Inventario maestro y rollos operacionales no generan doble descuento automático',()=>{
  const consume=functionBlock(OPS,'consumeJobMaterial');
  assert.doesNotMatch(consume,/airtableWrite(?:Tolerant)?\(\s*['"]Inventario['"]/,'MachineOps no debe volver a descontar el inventario maestro además del movimiento oficial del pedido');
  assert.match(INDEX,/openConsumoModal\(/,'el movimiento oficial debe quedar accesible desde Pedidos');
  assert.match(INDEX,/Consumo materiales/,'el pedido debe ser el vínculo de trazabilidad');
});

test('alertas, reorden y producción comparten las mismas señales de disponibilidad',()=>{
  assert.match(INDEX,/Punto de reorden/);
  assert.match(INDEX,/Stock actual/);
  assert.match(INDEX,/renderAlertas\(/,'los cambios de inventario deben poder refrescar alertas');
  assert.match(OPS,/spoolAvailable\(/,'producción debe calcular disponibilidad neta');
  assert.match(OPS,/gramsRequired|grams/,'producción debe considerar gramos requeridos');
});
