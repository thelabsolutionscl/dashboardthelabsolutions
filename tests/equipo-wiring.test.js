#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const JS_DIR=path.join(ROOT,'js');
const MODULES=fs.existsSync(JS_DIR)
  ?fs.readdirSync(JS_DIR).filter(name=>name.endsWith('.js')).sort().map(name=>fs.readFileSync(path.join(JS_DIR,name),'utf8')).join('\n')
  :'';
const SOURCE=`${INDEX}\n${MODULES}`;

function count(pattern,text=SOURCE){return(text.match(pattern)||[]).length;}
function escapeRegExp(value){return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function hasFunction(source,name){return new RegExp(`(?:async\\s+)?function\\s+${escapeRegExp(name)}\\s*\\(`).test(source);}
function functionBlock(source,name){
  const start=new RegExp(`(?:async\\s+)?function\\s+${escapeRegExp(name)}\\s*\\(`).exec(source);
  assert.ok(start,`falta ${name}`);
  const tail=source.slice(start.index+start[0].length);
  const next=/\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(tail);
  return source.slice(start.index,next?start.index+start[0].length+next.index:source.length);
}

const EQUIPO=functionBlock(MODULES,'initEquipo')+MODULES.slice(MODULES.indexOf('function toggleGcalEquipoConfig'));

test('Equipo tiene una sola sección y navegación en escritorio y móvil',()=>{
  assert.equal(count(/id=["']tab-equipo["']/g,INDEX),1,'#tab-equipo debe ser único');
  assert.match(SOURCE,/switchTab\(\s*['"]equipo['"]\s*\)/,'debe existir navegación a Equipo');
  assert.match(SOURCE,/switchTabMobile\(\s*['"]equipo['"]\s*\)/,'debe existir navegación móvil a Equipo');
  for(const id of ['equipoSemanaLabel','equipoHeader','equipoBody','equipoResumenHoy','equipoDetalleSemana','equipoSubtitle','equipoEventModal','comisionesRanking']){
    assert.equal(count(new RegExp(`id=["']${id}["']`,'g'),1),`${id} debe existir exactamente una vez`);
  }
});

test('las funciones críticas de Equipo existen una sola vez',()=>{
  const names=[
    'initEquipo','renderEquipoCalendar','renderEquipoResumenHoy','renderEquipoDetalleSemana',
    'openEquipoModal','saveEquipoEvento','deleteEquipoEvento','quickToggleEquipo',
    'saveGcalEquipoConfig','syncGcalEquipo','renderComisiones','_ventasVendedor',
    'setComisionCfg','setMetaVendedores','loadEquipoEventosAirtable','saveEquipoEventosAirtable'
  ];
  for(const name of names){
    assert.ok(hasFunction(SOURCE,name),`falta ${name}`);
    assert.equal(count(new RegExp(`function\\s+${escapeRegExp(name)}\\s*\\(`,'g')),1,`${name} debe definirse una vez`);
  }
});

test('initEquipo carga primero la disponibilidad y después renderiza calendario y comisiones',()=>{
  const body=functionBlock(MODULES,'initEquipo');
  const load=body.search(/await\s+loadEquipoEventosAirtable\s*\(/);
  const calendar=body.search(/renderEquipoCalendar\s*\(/);
  const commissions=body.search(/renderComisiones\s*\(/);
  assert.ok(load>=0,'debe cargar los eventos compartidos');
  assert.ok(calendar>load,'debe renderizar después de cargar');
  assert.ok(commissions>load,'las comisiones deben renderizarse después de inicializar la sección');
  assert.match(body,/PERSONAS\.map/,'la configuración debe nacer del padrón oficial de personas');
});

test('el calendario semanal parte el lunes y representa siete días',()=>{
  const week=functionBlock(MODULES,'getEquipoSemanaLunes');
  const render=functionBlock(MODULES,'renderEquipoCalendar');
  assert.match(week,/day===0\?6:day-1/,'domingo debe retroceder seis días hasta el lunes');
  assert.match(render,/for\s*\(let\s+i=0;i<7;i\+\+\)/,'debe construir exactamente siete días');
  assert.match(render,/equipoState\.eventos/,'la disponibilidad debe salir del estado compartido');
  assert.match(render,/PERSONAS\.map/,'debe renderizar todas las personas configuradas');
  assert.match(render,/renderEquipoResumenHoy\(/);
  assert.match(render,/renderEquipoDetalleSemana\(/);
});

test('Equipo cruza disponibilidad con pedidos activos y fechas de entrega',()=>{
  for(const name of ['renderEquipoResumenHoy','renderEquipoDetalleSemana']){
    const body=functionBlock(MODULES,name);
    assert.match(body,/state\.pedidos/,'debe leer pedidos reales');
    assert.match(body,/Equipo asignado/,'debe respetar el equipo asignado del pedido');
    assert.match(body,/Fecha entrega/,'debe cruzar la disponibilidad con la entrega');
    for(const terminal of ['Despachado','Completado','Cancelado'])assert.match(body,new RegExp(terminal),`debe excluir ${terminal}`);
    assert.match(body,/ausente/);
    assert.match(body,/vacaciones/);
    assert.match(body,/conflict/i,'debe señalar conflictos de cobertura');
  }
});

test('altas, bajas y cambios rápidos intentan persistir en el respaldo compartido',()=>{
  const save=functionBlock(MODULES,'saveEquipoEvento');
  const del=functionBlock(MODULES,'deleteEquipoEvento');
  const quick=functionBlock(MODULES,'quickToggleEquipo');
  assert.match(save,/if\(!fi\|\|!ff\)/,'debe exigir ambas fechas');
  assert.match(save,/for\s*\(let\s+d=new Date\(start\);d<=end;/,'el rango válido debe incluir inicio y término');
  assert.match(save,/await\s+saveEquipoEventosAirtable\s*\(/,'la creación debe persistirse');
  assert.match(del,/await\s+saveEquipoEventosAirtable\s*\(/,'la eliminación debe persistirse');
  assert.match(quick,/await\s+saveEquipoEventosAirtable\s*\(/,'el cambio rápido debe persistirse');
});

test('la configuración de Google Calendar mantiene claves fuera de localStorage',()=>{
  const save=functionBlock(MODULES,'saveGcalEquipoConfig');
  const init=functionBlock(MODULES,'initEquipo');
  assert.match(save,/sessionStorage\.setItem\(\s*['"]gcal_persona_/,'los calendarios deben durar solo la sesión');
  assert.match(save,/sessionStorage\.setItem\(\s*['"]gcal_api_key['"]/,'la API key debe durar solo la sesión');
  assert.doesNotMatch(save,/localStorage\.setItem/,'no debe persistir credenciales de Google en localStorage');
  assert.match(init,/sessionStorage\.getItem/,'la inicialización debe restaurar solo datos de sesión');
});

test('la importación de Google Calendar respeta personas, semana y tipos operativos',()=>{
  const body=functionBlock(MODULES,'syncGcalEquipo');
  assert.match(body,/for\s*\(const\s+p\s+of\s+PERSONAS\)/,'debe importar por persona');
  assert.match(body,/timeMin=/);
  assert.match(body,/timeMax=/);
  assert.match(body,/googleapis\.com\/calendar\/v3\/calendars/,'debe consultar Google Calendar');
  for(const type of ['vacaciones','ausente','remoto','reunion','ocupado'])assert.match(body,new RegExp(type),`falta mapear ${type}`);
  assert.match(body,/equipoState\.eventos/,'los eventos importados deben llegar al calendario del equipo');
  assert.match(body,/await\s+saveEquipoEventosAirtable\s*\(/,'la importación debe respaldarse');
});

test('comisiones usa pedidos, cotización vinculada, vendedor, venta neta y utilidad',()=>{
  const sales=functionBlock(MODULES,'_ventasVendedor');
  const render=functionBlock(MODULES,'renderComisiones');
  assert.match(sales,/state\.pedidos/);
  assert.match(sales,/Estado pedido/);
  assert.match(sales,/Cancelado/,'los pedidos cancelados no deben comisionar');
  assert.match(sales,/Monto total \(CLP\)/);
  assert.match(sales,/\/1\.19/,'la comisión debe partir de la venta neta');
  assert.match(sales,/Vendedor/);
  assert.match(sales,/state\.cotizacionesById/,'debe recuperar vendedor o margen desde la cotización vinculada');
  assert.match(sales,/_costoRealPedido|utilidad/i,'debe considerar la utilidad real cuando esté disponible');
  assert.match(render,/_comisionCfg\(/);
  assert.match(render,/_ventasVendedor\(/);
  assert.match(render,/meta/i,'debe mostrar avance de meta');
});

test.todo('saveEquipoEvento debe rechazar una fecha final anterior a la inicial');
test.todo('las mutaciones de disponibilidad deben restaurarse si falla Airtable');
test.todo('syncGcalEquipo debe tratar end.date como límite exclusivo y restaurar el botón en finally');
