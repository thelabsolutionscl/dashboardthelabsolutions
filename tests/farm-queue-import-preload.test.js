'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs'),os=require('os'),path=require('path'),http=require('http');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'farm-import-')),PORT=18347;
process.env.FARM_DATA_DIR=dir;process.env.FARM_REGISTRY_FILE=path.join(dir,'registry.json');process.env.FARM_QUEUE_FILE=path.join(dir,'queue.json');process.env.BRIDGE_PORT=String(PORT);process.env.BRIDGE_ADMIN_TOKEN='adm';process.env.BRIDGE_OPERATOR_TOKEN='op';process.env.FARM_IMPORT_MAX_GCODE_BYTES=String(1024*1024);
fs.writeFileSync(process.env.FARM_REGISTRY_FILE,JSON.stringify({version:1,machines:[{id:'m1',ip:'127.0.0.1'}]}));fs.writeFileSync(process.env.FARM_QUEUE_FILE,JSON.stringify({version:1,jobs:[]}));
const imp=require('../printer-bridge/farm-queue-import-preload.js');
let moon,farm;

test.before(async()=>{
  moon=http.createServer((req,res)=>{if(req.url==='/server/files/gcodes/jobs/pieza.gcode'){res.writeHead(200,{'Content-Type':'text/plain','Content-Length':'12'});return res.end('G28\nG1 X10\n');}res.writeHead(404);res.end();});
  await new Promise((resolve,reject)=>moon.listen(7125,'127.0.0.1',resolve).once('error',reject));
  farm=http.createServer((req,res)=>{
    if(req.method==='POST'&&req.url==='/farm/queue'){const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{const body=JSON.parse(Buffer.concat(chunks));const q=JSON.parse(fs.readFileSync(process.env.FARM_QUEUE_FILE,'utf8'));const prior=q.jobs.find(j=>j.id===body.id);if(prior){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,idempotent:true,job:prior}));}const job={...body,state:'queued',createdAt:new Date().toISOString()};q.jobs.push(job);fs.writeFileSync(process.env.FARM_QUEUE_FILE,JSON.stringify(q));res.writeHead(201,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,job}));});return;}res.writeHead(404);res.end();});
  await new Promise((resolve,reject)=>farm.listen(PORT,'127.0.0.1',resolve).once('error',reject));
});
test.after(async()=>{await Promise.all([new Promise(r=>moon.close(r)),new Promise(r=>farm.close(r))]);});

test('helpers rechazan traversal y generan nombre remoto único',()=>{assert.equal(imp.cleanSource('/jobs/pieza.gcode'),'jobs/pieza.gcode');assert.throws(()=>imp.cleanSource('../secret'),/inválida/);assert.equal(imp.safeRemoteName('mops-1','jobs/pieza.gcode'),'mops-1--pieza.gcode');assert.notEqual(imp.safeRemoteName('mops-1','pieza.gcode'),imp.safeRemoteName('mops-2','pieza.gcode'));});
test('operator importa G-code directamente desde Moonraker y repetir ID es idempotente',async()=>{
  const payload={id:'mops-job-1',machineId:'m1',sourceFile:'jobs/pieza.gcode',secs:120,grams:20,priority:50};
  let r=await fetch(`http://127.0.0.1:${PORT}/farm/queue/import`,{method:'POST',headers:{'Content-Type':'application/json','X-Bridge-Token':'op'},body:JSON.stringify(payload)}),d=await r.json();assert.equal(r.status,201);assert.equal(d.ok,true);assert.equal(d.job.id,'mops-job-1');assert.equal(d.job.filename,'mops-job-1--pieza.gcode');assert.equal(d.bytes,12);
  r=await fetch(`http://127.0.0.1:${PORT}/farm/queue/import`,{method:'POST',headers:{'Content-Type':'application/json','X-Bridge-Token':'op'},body:JSON.stringify(payload)});d=await r.json();assert.equal(r.status,200);assert.equal(d.idempotent,true);assert.equal(JSON.parse(fs.readFileSync(process.env.FARM_QUEUE_FILE,'utf8')).jobs.length,1);
});
test('viewer no puede importar G-code',async()=>{process.env.BRIDGE_VIEWER_TOKEN='view';const r=await fetch(`http://127.0.0.1:${PORT}/farm/queue/import`,{method:'POST',headers:{'Content-Type':'application/json','X-Bridge-Token':'view'},body:JSON.stringify({id:'x',machineId:'m1',sourceFile:'jobs/pieza.gcode'})});assert.equal(r.status,403);});
