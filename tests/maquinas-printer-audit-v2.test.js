#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'tls-printer-audit-v2-'));
process.env.FARM_DATA_DIR=TMP;
process.env.BRIDGE_TOKEN='printer-audit-v2-test-admin-token-123456';
process.env.BRIDGE_OPERATOR_TOKEN='printer-audit-v2-test-operator-123456';
process.env.BRIDGE_VIEWER_TOKEN='printer-audit-v2-test-viewer-123456';
process.env.BRIDGE_PORT='0';
process.env.LEGACY_BRIDGE_PORT='0';

const farm=require('../printer-bridge/farm-controller.js');
const bridge=require('../printer-bridge/server.js');

test.after(()=>{try{fs.rmSync(TMP,{recursive:true,force:true});}catch(_){}});

function result(score=82){
  return {
    overall:'attention',score,confidence:88,summary:'Revisión técnica',
    findings:[{severity:'medium',area:'Red',finding:'Latencia irregular',evidence:['muestra'],action:'Revisar LAN'}],
    recommended_actions:['Revisar LAN'],limitations:[]
  };
}
function issue(machine='k1-1',extra={}){
  return farm.issueAuditScan(machine,{sources:{moonraker:{available:true}},deterministic:{state:'standby'},...extra},'operator');
}
function makeReport(machine='k1-1',score=82){
  const scan=issue(machine);
  return farm.sanitizeAuditReport(machine,{
    id:'client-forged-id',createdAt:'2099-01-01T00:00:00.000Z',scanId:scan.scanId,
    actor:'cliente@example.test',model:'claude-haiku-4-5',durationMs:1234,
    sourceMatrix:{moonraker:true},cost:{estimatedUsd:.0123,textModel:'claude-haiku-4-5'},
    result:result(score),evidence:{scan:{forged:true},dashboard:{machine:{id:machine}}}
  },'operator');
}

test('Printer Bridge redacta secretos comunes antes de sacar logs del taller',()=>{
  const raw=[
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
    'api_key=super-secret-value',
    'password=hunter2',
    'https://user:pass123@example.test/path?token=abcdef',
    'sk-abcdefghijklmnopqrstuvwxyz123456'
  ].join('\n');
  const clean=bridge.redactDiagnosticSecrets(raw);
  assert.doesNotMatch(clean,/hunter2|super-secret-value|pass123|abcdefghijklmnopqrstuvwxyz123456/);
  assert.match(clean,/REDACTED/);
});

test('el servidor fija identidad temporal/rol y sustituye un scan manipulado por el scan emitido',()=>{
  const report=makeReport();
  assert.notEqual(report.id,'client-forged-id');
  assert.notEqual(report.createdAt,'2099-01-01T00:00:00.000Z');
  assert.equal(report.actorRole,'operator');
  assert.equal(report.clientActor,'cliente@example.test');
  assert.equal(report.evidence.scan.deterministic.state,'standby');
  assert.equal(report.evidence.scan.forged,undefined);
  assert.match(report.evidenceHash,/^[a-f0-9]{64}$/);
  assert.match(report.reportHash,/^[a-f0-9]{64}$/);
  assert.equal(farm.verifyAuditReport(report),true);
  const tampered=JSON.parse(JSON.stringify(report));tampered.result.score=100;
  assert.equal(farm.verifyAuditReport(tampered),false);
});

test('el índice es liviano y el informe completo se guarda en un archivo individual',async()=>{
  const report=makeReport('k1-2',77);
  await farm.saveAuditReport(report);
  const index=JSON.parse(fs.readFileSync(path.join(TMP,'printer-audits','index.json'),'utf8'));
  const row=index.reports.find(x=>x.id===report.id);
  assert.ok(row);
  assert.equal(Object.hasOwn(row,'evidence'),false);
  assert.equal(row.result.score,77);
  const detail=JSON.parse(fs.readFileSync(farm.auditReportPath('k1-2',report.id),'utf8'));
  assert.equal(detail.evidence.dashboard.machine.id,'k1-2');
  assert.equal(farm.verifyAuditReport(detail),true);
});

test('80 auditorías por impresora no quedan limitadas por un máximo global de 800',()=>{
  const rows=[];
  for(let m=0;m<14;m++)for(let i=0;i<81;i++)rows.push({id:'a-'+m+'-'+i,machineId:'m-'+m,createdAt:new Date(1700000000000+i*1000).toISOString()});
  const kept=farm.pruneAuditReports(rows);
  assert.equal(kept.length,14*80);
  for(let m=0;m<14;m++)assert.equal(kept.filter(x=>x.machineId==='m-'+m).length,80);
});

test('el scan profundo rechaza evidencia que excede el presupuesto duro',()=>{
  assert.doesNotThrow(()=>farm.issueAuditScan('small',{blob:'x'.repeat(300*1024)},'operator'));
  assert.throws(()=>farm.issueAuditScan('large',{blob:'x'.repeat(390*1024)},'operator'),/demasiado grande/);
});

test('los hallazgos tienen workflow persistente y el hash se renueva al resolverlos',async()=>{
  const report=makeReport('k2-12',64);
  await farm.saveAuditReport(report);
  const originalHash=report.reportHash;
  const fid=report.result.findings[0].findingId;
  const updated=await farm.updateAuditFinding('k2-12',report.id,fid,{status:'resolved',note:'Cable revisado'},'operator');
  assert.equal(updated.report.result.findings[0].status,'resolved');
  assert.equal(updated.report.result.findings[0].statusNote,'Cable revisado');
  assert.notEqual(updated.report.reportHash,originalHash);
  assert.equal(farm.verifyAuditReport(updated.report),true);
  assert.equal(updated.summary.result.findingStates.resolved,1);
});

test('dos guardados concurrentes conservan ambos resúmenes en el índice',async()=>{
  const a=makeReport('k2-13',91),b=makeReport('k2-13',89);
  await Promise.all([farm.saveAuditReport(a),farm.saveAuditReport(b)]);
  const index=JSON.parse(fs.readFileSync(path.join(TMP,'printer-audits','index.json'),'utf8'));
  const ids=new Set(index.reports.filter(x=>x.machineId==='k2-13').map(x=>x.id));
  assert.equal(ids.has(a.id),true);
  assert.equal(ids.has(b.id),true);
});

test('RBAC del código separa resumen viewer de evidencia/operator y mutaciones/operator',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','printer-bridge','farm-controller.js'),'utf8');
  assert.match(src,/auditHistory&&req\.method==='GET'[\s\S]{0,180}requireRole\(req,res,'viewer'\)/);
  assert.match(src,/auditDetail&&req\.method==='GET'[\s\S]{0,180}requireRole\(req,res,'operator'\)/);
  assert.match(src,/auditFinding&&req\.method==='PATCH'[\s\S]{0,180}requireRole\(req,res,'operator'\)/);
});
