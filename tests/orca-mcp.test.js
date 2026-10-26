'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const adapter=require('../printer-bridge/orca-mcp.js');
function validSTLBase64(){
  const vertices=[[0,0,0],[10,0,0],[0,10,0],[0,0,10]];
  const faces=[[0,2,1],[0,1,3],[0,3,2],[1,2,3]];
  return Buffer.from('solid test\n'+faces.map(face=>
    'facet normal 0 0 0\n outer loop\n'+face.map(i=>' vertex '+vertices[i].join(' ')).join('\n')+
    '\n endloop\nendfacet\n').join('')+'endsolid test\n').toString('base64');
}


const fixture=path.join(os.tmpdir(),'tls-test-orca-mcp-'+process.pid+'.js');
const fake=[
  "'use strict';",
  "const fs=require('node:fs');",
  "let buf='';",
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\\n'))!==-1){const line=buf.slice(0,i);buf=buf.slice(i+1);if(!line)continue;",
  "let req;try{req=JSON.parse(line);}catch(e){continue;}if(!req.id)continue;",
  "let value={};",
  "if(req.method==='initialize')value={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}};",
  "if(req.method==='tools/list')value={tools:[{name:'slice_model',description:'Fake',inputSchema:{type:'object',properties:{file_path:{type:'string'},output_path:{type:'string'},printer:{type:'string'},material:{type:'string'}},required:['file_path','output_path','printer','material']}}]};",
  "if(req.method==='tools/call'){const a=req.params.arguments;if(!fs.existsSync(a.file_path))throw new Error('missing input');fs.writeFileSync(a.output_path,'; example\\nG1 X1 Y1 F1200\\n');value={structuredContent:{seconds:360,grams:12.5}};}",
  "process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result:value})+'\\n');}});"
].join('\n');
test.before(()=>fs.writeFileSync(fixture,fake));
test.after(()=>{try{fs.unlinkSync(fixture);}catch(_){}});

function config(){
  return{ORCA_MCP_COMMAND:process.execPath,ORCA_MCP_ARGS_JSON:JSON.stringify([fixture]),
    ORCA_MCP_CONFIG_FILE:path.join(os.tmpdir(),'does-not-exist-mcp-'+process.pid+'.json')};
}
test('sin MCP se anuncia como no disponible, sin crear procesos',async()=>{
  const data=await adapter.status({ORCA_MCP_CONFIG_FILE:path.join(os.tmpdir(),'none-'+process.pid+'.json')});
  assert.equal(data.available,false);
  assert.match(data.reason,/Configura/);
});
test('descubre herramienta de laminado mediante protocolo MCP',async()=>{
  const data=await adapter.status(config());
  assert.equal(data.ok,true);
  assert.equal(data.available,true);
  assert.equal(data.tool,'slice_model');
});
test('lamina STL en temporal y entrega G-code sin tocar impresoras',async()=>{
  const data=await adapter.slice({
    filename:'pieza.stl',model:'K2',material:'PETG',profile:'',
    modelBase64:validSTLBase64()
  },config());
  assert.equal(data.ok,true);
  assert.equal(data.tool,'slice_model');
  assert.equal(data.filename,'pieza.gcode');
  assert.match(Buffer.from(data.gcodeBase64,'base64').toString(),/G1 X1/);
  assert.equal(data.seconds,360);
  assert.equal(data.grams,12.5);
});
test('no admite modelos ni nombres de impresora arbitrarios',async()=>{
  const c=config();
  await assert.rejects(adapter.slice({filename:'a.txt',model:'K2',material:'PLA',modelBase64:'YQ=='},c),/STL o 3MF/);
  await assert.rejects(adapter.slice({filename:'a.stl',model:'No existe',material:'PLA',modelBase64:'YQ=='},c),/impresora/);
  await assert.rejects(adapter.slice({filename:'a.stl',model:'K2',material:'PLA',modelBase64:''},c),/vacio/);
});
test('las rutas MCP requieren roles y nunca invocan print/start',()=>{
  const farm=fs.readFileSync(path.join(__dirname,'../printer-bridge/farm-controller.js'),'utf8');
  const routes=farm.slice(farm.indexOf("if(p==='/farm/orca/status')"),farm.indexOf('const auditScan=p.match('));
  assert.match(routes,/requireRole\(req,res,'viewer'\)/);
  assert.match(routes,/requireRole\(req,res,'operator'\)/);
  assert.doesNotMatch(routes,/print\/start|enqueue\(/);
  const front=fs.readFileSync(path.join(__dirname,'../js/maquinas.js'),'utf8');
  assert.match(front,/OrcaSlicer MCP — Laminado real/);
  assert.match(front,/\/farm\/orca\/jobs/);
  assert.match(farm,/\/farm\/orca\/jobs/);
  assert.doesNotMatch(front.slice(front.indexOf('// ── OrcaSlicer por MCP:')),/_queueStartNext|print\/start/);
});



const liveFixture=path.join(os.tmpdir(),'tls-test-real-orca-'+process.pid+'.js');
const liveMock=[
  "'use strict';",
  "const fs=require('node:fs');const path=require('node:path');",
  "let text='';",
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data',chunk=>{text+=chunk;let i;while((i=text.indexOf('\\n'))!==-1){const line=text.slice(0,i);text=text.slice(i+1);",
  "let req;try{req=JSON.parse(line);}catch(_){continue;}if(!req.id)continue;",
  "let value={};",
  "if(req.method==='initialize')value={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'orca',version:'0.1'}};",
  "if(req.method==='tools/list')value={tools:['get_status','list_objects','load_model','slice_and_wait','save_gcode'].map(name=>({name,inputSchema:{type:'object',properties:{}}}))};",
  "if(req.method==='tools/call'){const name=req.params.name;",
  "let payload={};",
  "if(name==='get_status')payload={presets:{printer:'Creality K1 (0.4 nozzle) - Copiar',filament:'Creality Generic TPU TEKNIPAK',print:'TecniPak'},modified:{print:['wall_loops']}};",
  "if(name==='list_objects')payload={objects:[]};",
  "if(name==='load_model'){if(!fs.existsSync(req.params.arguments.path))payload={error:'missing model'};else payload={loaded:true};}",
  "if(name==='slice_and_wait')payload={state:'done',stats:{estimated_time_seconds:450,filament_used_g:17.25},warnings:[]};",
  "if(name==='save_gcode'){const dest=path.join(process.env.PRINT_OUTCOMES_DIR,'gcode');fs.mkdirSync(dest,{recursive:true});const file=path.join(dest,'laminado.gcode');fs.writeFileSync(file,'; OrcaSlicer G-code\\nG1 X10 Y20 F1000\\n; printer_settings_id = Creality K1 (0.4 nozzle) - Copiar\\n');payload={path:file};}",
  "value={structuredContent:payload};}",
  "process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result:value})+'\\n');}});"
].join('\n');
test.before(()=>fs.writeFileSync(liveFixture,liveMock));
test.after(()=>{try{fs.unlinkSync(liveFixture);}catch(_){}});
function liveConfig(){
  return{ORCA_MCP_COMMAND:process.execPath,ORCA_MCP_ARGS_JSON:JSON.stringify([liveFixture]),
    ORCA_MCP_CONFIG_FILE:path.join(os.tmpdir(),'missing-real-orca-'+process.pid+'.json')};
}
test('MCP real se detecta y valida get_status',async()=>{
  const result=await adapter.status(liveConfig());
  assert.equal(result.available,true);
  assert.equal(result.mode,'live');
});
test('MCP real carga el STL, lamina usando perfiles activos y guarda G-code temporal',async()=>{
  const result=await adapter.slice({
    filename:'prueba.stl',model:'K1',material:'TPU',profile:'',
    modelBase64:validSTLBase64()
  },liveConfig());
  assert.equal(result.ok,true);
  assert.equal(result.seconds,450);
  assert.equal(result.grams,17.25);
  assert.match(Buffer.from(result.gcodeBase64,'base64').toString(),/G1 X10/);
  assert.equal(result.activePresets.printer,'Creality K1 (0.4 nozzle) - Copiar');
});
test('rechaza material o máquina distintos sin cambiar presets',async()=>{
  const base={filename:'pieza.stl',model:'K1',material:'PLA',
    modelBase64:validSTLBase64()};
  await assert.rejects(adapter.slice(base,liveConfig()),/Filamento activo/);
  await assert.rejects(adapter.slice({...base,model:'K2',material:'TPU'},liveConfig()),/Perfil de impresora activo/);
});
test('configuracion local del token pasa al proceso sin mostrar secretos',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tls-orca-secret-'));
  try{
    const file=path.join(dir,'orca-mcp.json');
    fs.writeFileSync(file,JSON.stringify({command:'orca',args:[],env:{ORCA_API_TOKEN:'hidden-secret'}}));
    const cfg=adapter.settings({ORCA_MCP_CONFIG_FILE:file});
    assert.equal(cfg.childEnv.ORCA_API_TOKEN,'hidden-secret');
    assert.equal(JSON.stringify({...cfg,childEnv:null}).includes('hidden-secret'),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('rechaza G-code cuyo perfil real no coincide con la impresora elegida',()=>{
  const guard=require('../printer-bridge/orca-profile-guard.js');
  assert.equal(guard.family('Creality K1 (0.4 nozzle)'),'K1');
  assert.equal(guard.family('Creality K2'),'K2');
  assert.equal(guard.family('Creality K2 Plus'),'K2 Plus');
  const bad='; printer_settings_id = Creality K2 0.4\nG1 X5 Y5\n';
  assert.throws(()=>guard.verifyGcode(bad,'K1','Creality K1 0.4'),/G-code NO seguro/);
  const good='; printer_settings_id = Creality K1 (0.4 nozzle)\nG1 X5 Y5\n';
  assert.equal(guard.verifyGcode(good,'K1','Creality K1 0.4').confirmed,true);
  assert.equal(guard.verifyGcode('G1 X5 Y5','K1','Creality K1 0.4').confirmed,false);
});
test('cambiar perfil exige cambios sin guardar ausentes',()=>{
  const guard=require('../printer-bridge/orca-profile-guard.js');
  assert.equal(guard.hasDirtyChanges({modified:{print:['wall_loops']}}),true);
  assert.equal(guard.hasDirtyChanges({modified:{print:[],filament:[],printer:[]}}),false);
  assert.equal(guard.hasDirtyChanges({}),true);
});
test('analisis IA opt-in nunca envia STL, G-code ni tokens como hechos',()=>{
  const ai=require('../printer-bridge/orca-ai.js');
  const subset=ai.minimalFacts({
    machineModel:'K1',material:'PLA',seconds:100,grams:3,
    modelBase64:'SENSITIVE_STL',gcodeBase64:'SENSITIVE_GCODE',token:'SENSITIVE_TOKEN',
    activePresets:{printer:'Creality K1'},gcodeCheck:{confirmed:true,expected:'K1'},
    technicalAnalysis:{physics:{verdict:'ok'}}
  });
  const dump=JSON.stringify(subset);
  assert.equal(dump.includes('SENSITIVE_STL'),false);
  assert.equal(dump.includes('SENSITIVE_GCODE'),false);
  assert.equal(dump.includes('SENSITIVE_TOKEN'),false);
  assert.equal(subset.machineModel,'K1');
});
