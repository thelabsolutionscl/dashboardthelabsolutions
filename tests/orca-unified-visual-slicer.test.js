'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const visual=fs.readFileSync(path.join(__dirname,'../js/slicer3d.js'),'utf8');
const machines=fs.readFileSync(path.join(__dirname,'../js/maquinas.js'),'utf8');
const advisor=require('../printer-bridge/orca-preslice-advisor.js');
test('unified Orca panel reuses existing native visual slicer instead of building duplicate renderer',()=>{
 assert.match(machines,/visualEngine\(\)/);
 assert.match(machines,/engine\.reviewOrca\(file,gcode/);
 assert.match(machines,/engine\.inspectOrcaModel\(file/);
 assert.match(machines,/Abrir visor de capas al terminar/);
 assert.match(machines,/await inspectOrcaLayers\(\)/);
 assert.match(visual,/function reviewOrca\(/);
 assert.match(visual,/G-code REAL de OrcaSlicer/);
 assert.match(visual,/S\.gcode='';S\.params=null;S\.est=null/);
});
test('visual preview does not automatically upload or start print jobs',()=>{
 const b=machines.slice(machines.indexOf('// ── OrcaSlicer por MCP:'));
 assert.doesNotMatch(b,/startUploadedSlicerJob|enviarATodas\(|_sendGcode\(/);
 assert.match(b,/data\.gcodeCheck\?\.confirmed/);
 assert.match(b,/No se ha iniciado ninguna impresion/);
});
test('quality prioritizes wall finish rather than max tolerated volumetric flow',()=>{
 const out=advisor.suggest({
  layer_height:'0.2',nozzle_diameter:'0.4',line_width:'0.45',
  filament_type:'PLA',nozzle_temperature:'220',filament_max_volumetric_speed:'18',
  outer_wall_speed:'180',inner_wall_speed:'300',sparse_infill_speed:'270',
  internal_solid_infill_speed:'250',top_surface_speed:'180',initial_layer_speed:'80',gap_infill_speed:'250'
 },'calidad');
 assert.equal(out.ok,true);
 assert.equal(out.changes.outer_wall_speed,'60');
 assert.equal(out.changes.inner_wall_speed,'110');
 assert.equal(out.changes.sparse_infill_speed,'140');
 assert.equal(out.changes.internal_solid_infill_speed,'100');
 assert.equal(out.changes.top_surface_speed,'45');
 assert.equal(out.changes.initial_layer_speed,'30');
 assert.equal(out.changes.gap_infill_speed,'65');
 assert.equal(out.changes.layer_height,'0.16');
});
