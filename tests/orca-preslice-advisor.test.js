'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),os=require('node:os');
const A=require('../printer-bridge/orca-preslice-advisor.js');
const MCP=require('../printer-bridge/orca-mcp.js');

const config={layer_height:'0.20',nozzle_diameter:'0.4',line_width:'0.45',
  inner_wall_speed:'300',outer_wall_speed:'250',sparse_infill_speed:'200',
  filament_type:'PLA',nozzle_temperature:'220',filament_max_volumetric_speed:'18'};
function model(){
 const v=[[0,0,0],[10,0,0],[0,10,0],[0,0,10]],faces=[[0,2,1],[0,1,3],[0,3,2],[1,2,3]];
 return Buffer.from('solid test\n'+faces.map(face=>
   'facet normal 0 0 0\n outer loop\n'+face.map(i=>' vertex '+v[i].join(' ')).join('\n')+
   '\n endloop\nendfacet\n').join('')+'endsolid test\n').toString('base64');
}
const fixture=path.join(__dirname,'fixtures','orca-auto-mcp.js');
function mock(fast=true){
 return{ORCA_MCP_COMMAND:process.execPath,
   ORCA_MCP_ARGS_JSON:JSON.stringify([fixture,...(fast?['fast']:[])]),
   ORCA_MCP_CONFIG_FILE:path.join(os.tmpdir(),'missing-safe-preslice-'+process.pid+'.json')};
}
test('preflight proposes speeds below actual material flow, never raises temperatures or max flow',()=>{
 const result=A.suggest(config,'calidad');
 assert.equal(result.ok,true);
 assert.ok(result.limit<=18);
 assert.ok(result.safetyFlow<18);
 assert.ok(Number(result.changes.inner_wall_speed)<300);
 assert.ok(result.details.find(x=>x.key==='inner_wall_speed').flowAfter<=result.safetyFlow);
 assert.equal(result.changes.nozzle_temperature,undefined);
 assert.equal(result.changes.filament_max_volumetric_speed,undefined);
 assert.ok(Number(result.changes.layer_height)<=.2);
});
test('no safe proposal if nozzle, layer or volumetric ceiling is not known',()=>{
 const result=A.suggest({inner_wall_speed:'300'},'calidad');
 assert.equal(result.ok,false);
 assert.deepEqual(result.changes,{});
});
test('read-only preview returns exact geometry and simulated safe plan before slicing',async()=>{
 const result=await MCP.preflight({
  filename:'10mm.stl',model:'K1',material:'PETG',goal:'calidad',
  modelBase64:model(),stlUnits:'mm'
 },mock(true));
 assert.equal(result.ok,true);
 assert.equal(result.ready,true);
 assert.equal(result.physics.verdict,'blocked');
 assert.equal(result.proposedPhysics.verdict,'ok');
 assert.ok(result.details.some(x=>x.key==='inner_wall_speed'));
 assert.match(result.approvalHash,/^[a-f0-9]{64}$/);
 assert.deepEqual(result.geometry.dimensions,[10,10,10]);
});
test('preview refuses to pretend active K1 settings are K2 settings',async()=>{
 const result=await MCP.preflight({
  filename:'10mm.stl',model:'K2',material:'PETG',goal:'calidad',
  modelBase64:model(),stlUnits:'mm'
 },mock());
 assert.equal(result.ready,false);
 assert.match(result.reason,/activar primero/);
});
test('approved plan changes speed before slice and returns physics verdict ok',async()=>{
 const input={filename:'10mm.stl',model:'K1',material:'PETG',goal:'calidad',
   modelBase64:model(),stlUnits:'mm',autoSelect:true,autoTune:true,
   printerPresetName:'Creality K1 (0.4 nozzle)'};
 const before=await MCP.preflight(input,mock(true));
 const done=await MCP.slice({...input,approvalHash:before.approvalHash},mock(true));
 assert.equal(done.technicalAnalysis.physics.verdict,'ok');
 assert.ok(done.technicalAnalysis.preSlice.applied.length>0);
 assert.equal(done.gcodeCheck.confirmed,true);
});
test('unapproved or stale proposals cannot be silently applied',async()=>{
 const input={filename:'10mm.stl',model:'K1',material:'PETG',goal:'calidad',
   modelBase64:model(),stlUnits:'mm',autoSelect:true,autoTune:true};
 await assert.rejects(MCP.slice({...input,approvalHash:'a'.repeat(64)},mock(true)),/configuracion cambio/);
});
test('unsafe unoptimized profile blocked before slice and no G-code is returned',async()=>{
 const input={filename:'10mm.stl',model:'K1',material:'PETG',goal:'calidad',
   modelBase64:model(),stlUnits:'mm',autoSelect:false,autoTune:false};
 await assert.rejects(MCP.slice(input,mock(true)),/antes|parametros fisicos bloqueados/i);
});


test('mejor acabado aplica topes reales ademas del caudal, para boquilla 0.4 y PLA',()=>{
 const cfg={...config,layer_height:'0.20',outer_wall_speed:'250',
   inner_wall_speed:'300',sparse_infill_speed:'270',
   internal_solid_infill_speed:'250',top_surface_speed:'180',
   gap_infill_speed:'250',initial_layer_speed:'70',bridge_speed:'110'};
 const a=A.suggest(cfg,'calidad');
 assert.equal(a.ok,true);
 assert.equal(a.changes.outer_wall_speed,'60');
 assert.equal(a.changes.inner_wall_speed,'110');
 assert.equal(a.changes.sparse_infill_speed,'140');
 assert.equal(a.changes.internal_solid_infill_speed,'100');
 assert.equal(a.changes.top_surface_speed,'45');
 assert.equal(a.changes.initial_layer_speed,'30');
 assert.equal(a.changes.gap_infill_speed,'65');
 assert.equal(a.changes.bridge_speed,'45');
 assert.equal(a.changes.layer_height,'0.16');
 assert.equal(a.changes.nozzle_temperature,undefined);
 assert.equal(a.changes.filament_max_volumetric_speed,undefined);
});
test('menor tiempo no aplica topes de acabado y sigue protegido por caudal',()=>{
 const fast=A.suggest(config,'rapidez');
 const quality=A.suggest(config,'calidad');
 assert.equal(fast.ok,true);
 assert.ok(Number(quality.changes.inner_wall_speed)<Number(fast.changes.inner_wall_speed));
 assert.equal(fast.qualityCaps,null);
});
test('nunca eleva velocidades originalmente mas lentas ni cambia diametro de boquilla',()=>{
 const slow={...config,outer_wall_speed:'28',inner_wall_speed:'62',
  top_surface_speed:'24',sparse_infill_speed:'100'};
 const a=A.suggest(slow,'calidad');
 assert.equal(a.changes.outer_wall_speed,undefined);
 assert.equal(a.changes.inner_wall_speed,undefined);
 assert.equal(a.changes.top_surface_speed,undefined);
 assert.equal(a.changes.nozzle_diameter,undefined);
});
test('boquillas menores reducen los topes de calidad en vez de aumentarlos',()=>{
 const cap04=A.speedCaps('calidad',.4),cap02=A.speedCaps('calidad',.2);
 assert.ok(cap02.outer_wall_speed<cap04.outer_wall_speed);
 assert.ok(cap02.inner_wall_speed<cap04.inner_wall_speed);
});
