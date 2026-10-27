'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const native=fs.readFileSync(path.join(__dirname,'..','js','slicer3d.js'),'utf8');
const dashboard=fs.readFileSync(path.join(__dirname,'..','js','maquinas.js'),'utf8');
const advisor=fs.readFileSync(path.join(__dirname,'..','printer-bridge','orca-preslice-advisor.js'),'utf8');
const orca=fs.readFileSync(path.join(__dirname,'..','printer-bridge','orca-mcp.js'),'utf8');
test('Orca 3D viewer reuses native SL3D with same real G-code, without duplicate slicing',()=>{
 const from=native.indexOf('async function reviewOrca(');
 const to=native.indexOf('\n  function previewSlide(',from);
 assert.ok(from>0&&to>from);
 const view=native.slice(from,to);
 assert.match(view,/inspectOrcaModel\(/);
 assert.match(view,/preview\(gcode\)/);
 assert.match(view,/S\.gcode=''/);
 assert.doesNotMatch(view,/generarGcode\(|_nativeSlice\(|\.send\(|print\/start|moonraker/i);
 assert.match(native,/function _parseGcodeLayers\(source=S\.gcode\)/);
 assert.match(native,/outer wall\|external perimeter/);
 assert.match(native,/window\.MachineOps\?\.showView\)window\.MachineOps\.showView\('laminado'\)/);
});
test('Orca panel can inspect model before slicing and real G-code layers only after validated slice',()=>{
 const from=dashboard.indexOf('// ── OrcaSlicer por MCP:');
 const sub=dashboard.slice(from);
 assert.ok(from>0);
 assert.match(sub,/tlsOrcaMcpViewModel/);
 assert.match(sub,/tlsOrcaMcpViewGcode/);
 assert.match(sub,/engine\.reviewOrca\(file,gcode/);
 assert.match(sub,/latest=\{\.\.\.data,jobId:started\.jobId,machineId:String\(machine\.id\),machineModel:machine\.modelo/);
 assert.match(sub,/if\(view\)view\.disabled=!data\.gcodeCheck\?\.confirmed/);
 assert.match(sub,/preview|vista/i);
 const f=sub.slice(sub.indexOf('async function inspectOrcaLayers('),sub.indexOf('function sleepOrca'));
 assert.doesNotMatch(f,/_nativeSlice|generarGcode|print\/start|startUploadedSlicerJob/);
});
test('visual integration keeps native slicer and Orca engine separate',()=>{
 assert.match(native,/return\{loadFile,loadFiles,inspectOrcaModel,reviewOrca/);
 assert.match(dashboard,/Analizar y laminar/);
 assert.match(dashboard,/OrcaSlicer MCP — Laminado real/);
});
test('quality caps are separate from flow ceiling, and Orca read-backs every modified speed',()=>{
 assert.match(advisor,/const QUALITY_BASE=Object.freeze/);
 assert.match(advisor,/top_surface_speed:45/);
 assert.match(advisor,/outer_wall_speed:60/);
 assert.match(advisor,/Math\.min\(speed,qualityCap\)/);
 assert.match(orca,/const verified=await invoke\(client,'get_config'/);
 assert.match(orca,/OrcaSlicer no aplico /);
 assert.match(orca,/fileSha256:crypto\.createHash/);
});
