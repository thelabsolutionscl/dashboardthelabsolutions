'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const os=require('node:os');
const path=require('node:path');
const Auto=require('../printer-bridge/orca-auto-profiles.js');
const MCP=require('../printer-bridge/orca-mcp.js');

test('PLA vs PLA+ and TPU vs TPU-95A do not cross-match',()=>{
  assert.equal(Auto.sameMaterial('Generic PLA Silk','PLA'),true);
  assert.equal(Auto.sameMaterial('Generic PLA+','PLA'),false);
  assert.equal(Auto.sameMaterial('Generic PLA','PLA+'),false);
  assert.equal(Auto.sameMaterial('Generic TPU-95A','TPU'),false);
  assert.equal(Auto.sameMaterial('Generic TPU','TPU-95A'),false);
  assert.equal(Auto.sameMaterial('Generic PETG','PETG'),true);
});
const snapshot={presets:{printer:'Creality K1 (0.4 nozzle)',filament:'Generic PLA',print:'0.20 Standard'},modified:{printer:[],filament:[],print:[]}};
const printers={printer:[{name:'Creality K2 0.2 nozzle'},{name:'Creality K2 0.4 nozzle'},{name:'Creality K2 Plus 0.4 nozzle'}]};
test('does not silently guess a nozzle when printer has several presets',()=>{
  assert.throws(()=>Auto.choosePrinter(snapshot,'K2',printers),/Hay 2 perfiles/);
  assert.deepEqual(Auto.choosePrinter(snapshot,'K2',printers,'Creality K2 0.4 nozzle'),
    {chosen:'Creality K2 0.4 nozzle',change:true});
  assert.throws(()=>Auto.choosePrinter(snapshot,'K2',printers,'Creality K2 Plus 0.4 nozzle'),/no corresponde/);
  assert.deepEqual(Auto.choosePrinter({...snapshot,presets:{...snapshot.presets,printer:'Creality K2 0.4 nozzle'}},'K2',printers),
    {chosen:'Creality K2 0.4 nozzle',change:false});
});
test('filament ambiguity is blocked until operator has identified the spool',()=>{
  const incompatible={...snapshot,presets:{...snapshot.presets,filament:'Generic PETG'}};
  assert.throws(()=>Auto.chooseFilament(incompatible,'PLA',{filament:[{name:'Generic PLA'},{name:'Generic PLA Silk'}]}),/Hay 2 perfiles/);
  assert.deepEqual(Auto.chooseFilament(incompatible,'PLA',{filament:[{name:'Generic PLA'}]}),
    {chosen:'Generic PLA',change:true});
});
const fixture=path.join(__dirname,'fixtures','orca-auto-mcp.js');
function cfg(dirty=false){
  return{ORCA_MCP_COMMAND:process.execPath,ORCA_MCP_ARGS_JSON:JSON.stringify([fixture,...(dirty?['dirty']:[])]),
    ORCA_MCP_CONFIG_FILE:path.join(os.tmpdir(),'nonexistent-auto-orca-'+process.pid+'.json')};
}
const input={filename:'demo.stl',model:'K2',material:'PLA',profile:'',
  autoSelect:true,modelBase64:Buffer.from('solid test\nendsolid test').toString('base64')};
test('automatically switches printer and filament in same MCP session, slices validated K2',async()=>{
  const r=await MCP.slice({...input,printerPresetName:'Creality K2 0.4 nozzle'},cfg());
  assert.equal(r.ok,true);
  assert.equal(r.gcodeCheck.confirmed,true);
  assert.equal(r.activePresets.printer,'Creality K2 0.4 nozzle');
  assert.equal(r.activePresets.filament,'Generic PLA');
  assert.deepEqual(r.profileChanges.map(c=>c.type),['printer','filament']);
  assert.match(Buffer.from(r.gcodeBase64,'base64').toString(),/printer_settings_id = Creality K2 0.4 nozzle/);
});
test('ambiguous nozzle blocks safely before any G-code is created',async()=>{
  await assert.rejects(MCP.slice(input,cfg()),/Hay 2 perfiles/);
});
test('dirty Orca session is preserved and app refuses to switch',async()=>{
  await assert.rejects(MCP.slice({...input,printerPresetName:'Creality K2 0.4 nozzle'},cfg(true)),/modificaciones sin guardar/);
});
