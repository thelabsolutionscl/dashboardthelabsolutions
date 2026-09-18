#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');

process.env.BRIDGE_TOKEN='admin-test-token';
process.env.BRIDGE_OPERATOR_TOKEN='operator-test-token';
process.env.BRIDGE_VIEWER_TOKEN='viewer-test-token';
process.env.FARM_DISCOVERY_ENABLED='0';
const controllerPath=path.join(__dirname,'..','printer-bridge','farm-controller.js');
const api=require(controllerPath);
const source=fs.readFileSync(controllerPath,'utf8');

test('solo acepta IPv4 privadas como destino de impresoras',()=>{
  for(const ip of ['192.168.100.51','10.0.0.2','172.16.1.1','127.0.0.1'])assert.equal(api.isPrivateIp(ip),true);
  for(const ip of ['8.8.8.8','1.1.1.1','192.168.999.1','localhost'])assert.equal(api.isPrivateIp(ip),false);
});

test('tokens se separan en viewer operator admin',()=>{
  assert.equal(api.roleForToken('viewer-test-token'),'viewer');
  assert.equal(api.roleForToken('operator-test-token'),'operator');
  assert.equal(api.roleForToken('admin-test-token'),'admin');
  assert.equal(api.roleForToken('incorrecto'),'');
});

test('rutas destructivas exigen admin y lectura solo viewer',()=>{
  assert.equal(api.routeMinimumRole({method:'GET'},'/192.168.100.51/printer/info'),'viewer');
  assert.equal(api.routeMinimumRole({method:'POST'},'/192.168.100.51/printer/print/start'),'operator');
  assert.equal(api.routeMinimumRole({method:'POST'},'/recover/192.168.100.51'),'admin');
  assert.equal(api.routeMinimumRole({method:'POST'},'/recover-camera/192.168.100.70'),'admin');
  assert.equal(api.routeMinimumRole({method:'POST'},'/update'),'admin');
  assert.equal(api.routeMinimumRole({method:'POST'},'/restart'),'admin');
});

test('restart queda protegido además por POST-only',()=>{
  assert.match(source,/p === '\/restart' && req\.method !== 'POST'/);
  assert.match(source,/res\.setHeader\('Allow', 'POST'\)/);
  assert.match(source,/json\(res, 405/);
});

test('persistencia normaliza documentos dañados o incompletos',()=>{
  assert.deepEqual(api.normalizeQueue(null).jobs,[]);
  assert.deepEqual(api.normalizeRegistry({machines:'bad'}).machines,[]);
  assert.equal(api.normalizeSafetySnapshot(null).config.strict,true);
});

test('reinicio recupera estados intermedios sin perder el G-code',()=>{
  const q=api.normalizeQueue({jobs:[
    {id:'a',state:'checking',gcodeBase64:'QQ=='},
    {id:'b',state:'uploading',gcodeBase64:'Qg=='},
    {id:'c',state:'uploaded',gcodeBase64:'Qw=='},
    {id:'d',state:'started',gcodeBase64:''},
    {id:'e',state:'queued',gcodeBase64:'RQ=='},
  ]});
  assert.equal(api.recoverQueueJobs(q),3);
  assert.deepEqual(q.jobs.map(j=>j.state),['retry','retry','retry','started','queued']);
  assert.equal(q.jobs[0].gcodeBase64,'QQ==');
  assert.match(q.jobs[0].lastError,/reinicio/i);
});

test('reconciliación reconoce el mismo archivo aunque Moonraker entregue una ruta',()=>{
  assert.equal(api.samePrintFilename('/gcodes/Cliente%20A.gcode','Cliente A.gcode'),true);
  assert.equal(api.samePrintFilename('TEST.GCODE','test.gcode'),true);
  assert.equal(api.samePrintFilename('otro.gcode','test.gcode'),false);
});

test('metadata del slicer se conserva sanitizada en la cola durable',()=>{
  const meta=api.cleanJobMetadata({source:'slicer3d',name:'pieza',material:'PETG',nozzle:'0.6',model:'K2',sizeX:120,sizeY:80,sizeZ:40,grams:83,secs:5400,
    params:{layerHeight:.28,infillPct:25,infillType:'gyroid',supports:true,maxVolumetricFlow:10},mesh:{volumeReliable:true,openEdges:0,nonManifoldEdges:0},secret:'no'});
  assert.equal(meta.material,'PETG');
  assert.equal(meta.nozzle,'0.6');
  assert.equal(meta.params.maxVolumetricFlow,10);
  assert.equal(meta.mesh.volumeReliable,true);
  assert.equal(meta.secret,undefined,'campos arbitrarios no se persisten');
});

test('controller evalúa seguridad antes de subir el G-code',()=>{
  const safetyPos=source.indexOf('SafetyPolicy.evaluateSnapshot(safety, j');
  const uploadPos=source.indexOf("requestLegacy('POST', `/${ip}/server/files/upload`");
  assert.ok(safetyPos>0,'debe existir evaluación de seguridad');
  assert.ok(uploadPos>safetyPos,'la evaluación debe ocurrir antes del upload');
  assert.match(source,/state: 'blocked', safetyBlocked: true/);
});

test('controller expone snapshot de seguridad y permite sincronizarlo',()=>{
  assert.match(source,/p === '\/farm\/safety' && req\.method === 'GET'/);
  assert.match(source,/p === '\/farm\/safety' && req\.method === 'PUT'/);
  assert.match(source,/const role = requireRole\(req, res, 'operator'\)/);
});


test('firma de cama terminada es estable para la misma impresión',()=>{
  const a=api.bedSignatureFromPrintStats({filename:'/gcodes/Pieza%20A.gcode',print_duration:123.4,state:'complete'});
  const b=api.bedSignatureFromPrintStats({filename:'Pieza A.gcode',print_duration:123.49,state:'complete'});
  assert.equal(a,b);
  assert.match(a,/piezaa\|123\|complete/);
});

test('cola exige identidad registrada, idempotencia y lifecycle central',()=>{
  assert.match(source,/máquina no registrada o sin IP válida en Farm Registry/);
  assert.match(source,/idempotencyKey/);
  assert.match(source,/queue\.jobs\.find\(j=>j\.idempotencyKey===idempotencyKey\)/);
  assert.match(source,/reconcileStartedJobs/);
  assert.match(source,/state:'completed'/);
  assert.match(source,/recordProductionEvent/);
  assert.match(source,/pruneQueue/);
});

test('trabajo siguiente exige cama liberada y existe endpoint de confirmación',()=>{
  assert.match(source,/retirar pieza y confirmar cama libre/);
  assert.match(source,/bedSignatureFromPrintStats/);
  assert.match(source,/\/farm\/ready\//);
  assert.match(source,/requeueBedBlocked/);
});

test('operator puede subir lectura de seguridad pero no rebajar la política',()=>{
  assert.match(source,/const safeBody=role==='admin'\?body:\{\.\.\.body,config:safety\.config\}/);
});

test('Controller soporta iniciar un G-code ya existente sin saltarse lifecycle',()=>{
  assert.match(source,/p==='\/farm\/queue\/existing'/);
  assert.match(source,/existingFile:true/);
  assert.match(source,/if\(!j\.existingFile\)/);
});
