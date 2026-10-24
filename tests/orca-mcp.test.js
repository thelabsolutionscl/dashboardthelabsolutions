'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const adapter=require('../printer-bridge/orca-mcp.js');

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
    modelBase64:Buffer.from('solid pieza\nendsolid pieza').toString('base64')
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
  assert.match(front,/\/farm\/orca\/slice/);
  assert.doesNotMatch(front.slice(front.indexOf('// ── OrcaSlicer por MCP:')),/_queueStartNext|print\/start/);
});
