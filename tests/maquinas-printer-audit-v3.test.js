#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'tls-printer-audit-v3-'));
process.env.FARM_DATA_DIR=TMP;
process.env.BRIDGE_TOKEN='audit-v3-admin-token-123456789';
process.env.BRIDGE_OPERATOR_TOKEN='audit-v3-operator-token-123456';
process.env.BRIDGE_VIEWER_TOKEN='audit-v3-viewer-token-12345678';
process.env.BRIDGE_PORT='0';
process.env.LEGACY_BRIDGE_PORT='0';

const farm=require('../printer-bridge/farm-controller.js');
const bridge=require('../printer-bridge/server.js');
const WORKER=fs.readFileSync(path.join(__dirname,'..','airtable-proxy','src','worker.js'),'utf8');
const OPS=fs.readFileSync(path.join(__dirname,'..','js','maquinas-operaciones.js'),'utf8');

test.after(()=>{try{fs.rmSync(TMP,{recursive:true,force:true});}catch(_){}});

function auditResult(score=80,two=false){
  const findings=[
    {severity:'medium',area:'Red',finding:'Latencia irregular',evidence:['m1'],action:'Revisar LAN'},
  ];
  if(two)findings.push({severity:'low',area:'Cama',finding:'Malla antigua',evidence:['m2'],action:'Recalibrar'});
  return{overall:'attention',score,confidence:85,summary:'Auditoría V3',findings,recommended_actions:[],limitations:[]};
}
function issue(machine,extra={}){
  return farm.issueAuditScan(machine,{
    sources:{moonraker:{available:true},ssh:{available:true,logsCaptured:true},camera:{available:false}},
    stability:{network:{total:4,successes:4},thermal:{hotend:{span:1},bed:{span:1}}},
    deterministic:{state:'standby'},...extra
  },'operator');
}
function bodyFor(machine,requestId,opts={}){
  const scan=issue(machine,opts.scan||{});
  return{
    requestId,scanId:scan.scanId,actor:'browser@example.test',model:'claude-haiku-4-5',durationMs:1500,
    sourceMatrix:{moonraker:false,camera:true,injected:true},
    cost:{estimatedUsd:.123,provenance:'proxy-budget-reservation',textModel:'claude-haiku-4-5'},
    result:auditResult(opts.score||80,opts.two===true),
    evidence:{dashboard:{live:{state:'standby'},maintenance:[],incidents:[]},vision:{available:false},bed:{code:'ok'}}
  };
}

test('las rutas de auditoría son hash-safe, no aceptan dot traversal y no colisionan por sanitización',()=>{
  assert.equal(farm.auditLegacyReportPath('..','audit-12345678'),'');
  const root=path.resolve(TMP,'printer-audits')+path.sep;
  const a=farm.auditReportPath('../x','audit/a');
  const b=farm.auditReportPath('.._x','audit?a');
  assert.equal(path.resolve(a).startsWith(root),true);
  assert.equal(path.resolve(b).startsWith(root),true);
  assert.notEqual(a,b);
});

test('el sello HMAC cubre metadatos y matriz de fuentes, no sólo result/evidence',()=>{
  const body=bodyFor('seal-machine','auditreq-seal-123456');
  const report=farm.sanitizeAuditReport('seal-machine',body,'operator');
  assert.equal(report.sealVersion,2);
  assert.equal(farm.verifyAuditReport(report),true);
  for(const mutate of [
    r=>{r.clientActor='otro';},
    r=>{r.durationMs+=1;},
    r=>{r.sourceMatrix.moonraker=false;},
    r=>{r.requestId='auditreq-altered-123';}
  ]){
    const copy=structuredClone(report);mutate(copy);
    assert.equal(farm.verifyAuditReport(copy),false);
  }
});

test('sourceMatrix se deriva en servidor y no acepta claves/booleanos inventados por el navegador',()=>{
  const body=bodyFor('source-machine','auditreq-source-123456');
  const report=farm.sanitizeAuditReport('source-machine',body,'operator');
  assert.equal(report.sourceMatrix.moonraker,true);
  assert.equal(report.sourceMatrix.camera,false);
  assert.equal(Object.hasOwn(report.sourceMatrix,'injected'),false);
});

test('el mismo requestId es idempotente aunque el primer guardado haya terminado',async()=>{
  const machine='idem-machine',requestId='auditreq-idempotent-123456';
  const body=bodyFor(machine,requestId);
  const first=await farm.saveAuditRequest(machine,body,'operator');
  const second=await farm.saveAuditRequest(machine,body,'operator');
  assert.equal(first.idempotent,false);
  assert.equal(second.idempotent,true);
  assert.equal(second.report.id,first.report.id);
  const index=JSON.parse(fs.readFileSync(path.join(TMP,'printer-audits','index.json'),'utf8'));
  assert.equal(index.reports.filter(r=>r.machineId===machine&&r.requestId===requestId).length,1);
});

test('dos cambios concurrentes de hallazgos del mismo informe no se pisan',async()=>{
  const machine='concurrent-findings',body=bodyFor(machine,'auditreq-findings-123456',{two:true});
  const saved=await farm.saveAuditRequest(machine,body,'operator');
  const [a,b]=saved.report.result.findings;
  await Promise.all([
    farm.updateAuditFinding(machine,saved.report.id,a.findingId,{status:'resolved',note:'red ok'},'operator'),
    farm.updateAuditFinding(machine,saved.report.id,b.findingId,{status:'ignored',note:'aceptado'},'operator')
  ]);
  const detail=await farm.readAuditReport(machine,saved.report.id);
  const states=Object.fromEntries(detail.result.findings.map(f=>[f.findingId,f.status]));
  assert.equal(states[a.findingId],'resolved');
  assert.equal(states[b.findingId],'ignored');
  assert.equal(farm.verifyAuditReport(detail),true);
});

test('viewer recibe un resumen mínimo y no ve actor, costo, hashes, scanId ni requestId',()=>{
  const report=farm.sanitizeAuditReport('viewer-machine',bodyFor('viewer-machine','auditreq-viewer-123456'),'operator');
  const row=farm.auditSummaryForRole(farm.auditSummaryFromReport(report),'viewer');
  for(const key of ['clientActor','actorRole','cost','evidenceHash','reportHash','scanId','requestId','sourceMatrix'])
    assert.equal(Object.hasOwn(row,key),false,key+' no debe exponerse a viewer');
  assert.equal(row.result.score,80);
});

test('un informe alterado no puede cambiar estados de hallazgos por API interna',async()=>{
  const machine='tamper-machine',saved=await farm.saveAuditRequest(machine,bodyFor(machine,'auditreq-tamper-123456'),'operator');
  const file=farm.auditReportPath(machine,saved.report.id);
  const altered=JSON.parse(fs.readFileSync(file,'utf8'));altered.result.score=100;
  fs.writeFileSync(file,JSON.stringify(altered,null,2));
  await assert.rejects(
    farm.updateAuditFinding(machine,saved.report.id,saved.report.result.findings[0].findingId,{status:'resolved'},'operator'),
    /integridad/
  );
});

test('redacción estructurada cubre authToken, bridgeToken, sessionToken, clientSecret y privateKey',()=>{
  const clean=bridge.redactDiagnosticValue({
    authToken:'AAA',bridge_token:'BBB',sessionToken:'CCC',clientSecret:'DDD',privateKey:'EEE',
    nested:{temperature:210}
  });
  for(const key of ['authToken','bridge_token','sessionToken','clientSecret','privateKey'])assert.equal(clean[key],'[REDACTED]');
  assert.equal(clean.nested.temperature,210);
});

test('el proxy es la fuente de la estimación de costo y el frontend no duplica tarifas Anthropic',()=>{
  assert.match(WORKER,/X-AI-Estimated-Cost-USD/);
  assert.match(WORKER,/X-AI-Cost-Provenance/);
  assert.match(WORKER,/Access-Control-Expose-Headers/);
  assert.match(OPS,/X-AI-Estimated-Cost-USD/);
  assert.doesNotMatch(OPS,/directInput\/1000000\*1\+cacheWrite/);
  assert.doesNotMatch(OPS,/_cost:\{estimatedUsd:0\.01/);
});

test('la UI no permite acciones desde un detalle cuyo sello sea inválido y reintenta guardados idempotentes',()=>{
  assert.match(OPS,/saved\.integrityValid!==false/);
  assert.match(OPS,/el informe no supera verificación de integridad/);
  assert.match(OPS,/function _printerAuditRequestId/);
  assert.match(OPS,/async function savePrinterAuditReport/);
  assert.match(OPS,/for\(let attempt=0;attempt<2;attempt\+\+\)/);
});
