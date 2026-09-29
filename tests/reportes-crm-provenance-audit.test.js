#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const from=html.indexOf("let _crmAuditFilter='priority'");
const to=html.indexOf("function renderReportes(){",from);
assert.ok(from>=0&&to>from,'CRM provenance audit section must exist');
const src=html.slice(from,to);
const ids=['recTEST0000000001','recTEST0000000002','recTEST0000000003',
  'recTEST0000000004','recTEST0000000005'];
function client(id,name,origin,date,created,other={}){
  return {id,createdTime:created,fields:{Empresa:name,...(origin?{'Origen lead':origin}:{}),
    ...(date?{'Fecha primer contacto':date}:{}),...other}};
}
function quote(id,clientIds,date,created){
  return {id,createdTime:created,fields:{Cliente:clientIds,
    ...(date?{'Fecha cotización':date}:{})}};
}
const fixtures={
  clients:[
    client(ids[0],'<img src=x onerror=alert(1)>',null,'2026-09-20',
      '2026-09-01T10:00:00Z'),
    client(ids[1],'=HYPERLINK("https://evil.example")',null,null,
      '2026-09-01T10:00:00Z',{GCLID:'test-gclid'}),
    client(ids[2],'Cliente histórico','Referido','2025-01-12',
      '2026-09-01T10:00:00Z'),
    client(ids[3],'Cliente documentado','Instagram','2026-09-01',
      '2026-09-01T10:00:00Z'),
    client(ids[4],'Cliente sin actividad',null,null,'2026-09-01T10:00:00Z')
  ],
  quotes:[
    quote('recQUOTE000000001',[ids[0]],'2026-08-25','2026-09-10T12:00:00Z'),
    quote('recQUOTE000000002',[ids[1]],null,'2026-09-11T12:00:00Z'),
    quote('recQUOTE000000003',[ids[2]],'2025-02-10','2026-09-11T12:00:00Z'),
    quote('recQUOTE000000004',[ids[3]],'2026-09-01','2026-09-11T12:00:00Z'),
    quote('recQUOTE000000005',[],null,'2026-09-11T12:00:00Z')
  ]
};
function setup(extra={}){
  const panel={innerHTML:''};
  const document={
    getElementById:key=>key==='crmAcquisitionAuditCard'?panel:
      key==='tab-clientes'?{classList:{contains:()=>true}}:null,
    body:{appendChild:()=>{}},
    createElement:()=>({click(){},remove(){}})
  };
  const state={loaded:true,clientes:structuredClone(fixtures.clients),
    cotizaciones:structuredClone(fixtures.quotes),clientesByIdRec:{}};
  const URLs={createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}};
  const args={document,state,escapeHtml:s=>String(s).replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'),
    AUTH:{getUser:()=>null},RBAC:{tabs:{},nuevos:{}},
    switchTab:()=>{},openClienteDetalle:()=>{},toast:()=>{},
    URL:URLs,Blob:class{constructor(parts){this.parts=parts;}},hoyCL:()=> '2026-09-29',
    setTimeout:()=>{},...extra};
  const api=new Function(...Object.keys(args),src+
    '\nreturn {_crmAuditDate,_crmAcquisitionAudit,renderCrmAcquisitionAudit,_crmAuditFilterChange,_crmAuditExportCsv,_crmAuditOpenClient};'
  )(...Object.values(args));
  return {api,document,state,panel,urls:URLs};
}
test('CRM audit separates chronological contradictions from incomplete fields without writes',()=>{
  const {api,state}=setup();
  const before=structuredClone(state);
  const {stats,entries,unlinkedQuotes}=api._crmAcquisitionAudit(state.clientes,state.cotizaciones);
  assert.deepEqual({
    total:stats.total,withOrigin:stats.withOrigin,withFirstContact:stats.withFirstContact,
    linked:stats.linked,missingOrigin:stats.missingOrigin,missingContact:stats.missingContact,
    bothMissing:stats.bothMissing,contradictions:stats.contradictions,
    adsEvidenceNoOrigin:stats.adsEvidenceNoOrigin,linkedMissingOrigin:stats.linkedMissingOrigin,
    clientsWithImportPrehistory:stats.clientsWithImportPrehistory,quotesWithoutClient:stats.quotesWithoutClient
  },{total:5,withOrigin:2,withFirstContact:3,linked:4,
    missingOrigin:3,missingContact:2,bothMissing:2,contradictions:1,
    adsEvidenceNoOrigin:1,linkedMissingOrigin:2,
    clientsWithImportPrehistory:1,quotesWithoutClient:1});
  assert.equal(entries[0].id,ids[0],'chronological contradiction is priority one');
  assert.ok(entries[0].flags.includes('Fecha posterior a una cotización'));
  assert.equal(entries[0].earliest,'2026-08-25','explicit quote date beats record import');
  assert.equal(entries[1].id,ids[1],'GCLID evidence without a known origin is next');
  assert.equal(entries.find(e=>e.id===ids[2]).olderThanImport,true);
  assert.equal(unlinkedQuotes.length,1);
  assert.deepEqual(state,before,'review cannot mutate Airtable-derived state');
});
test('a quote import timestamp alone cannot establish a chronology contradiction',()=>{
  const {api}=setup();
  const c=[client(ids[0],'Importado','Referido','2026-09-20','2026-09-01T10:00:00Z')];
  const q=[quote('recImported',[ids[0]],null,'2026-09-11T12:00:00Z')];
  const {stats,entries}=api._crmAcquisitionAudit(c,q);
  assert.equal(stats.contradictions,0);
  assert.equal(entries[0].earliest,'2026-09-11');
  assert.equal(entries[0].earliestOriginal,null);
  assert.equal(entries[0].earliestSource,'record_created');
  assert.equal(entries[0].flags.includes('Fecha posterior a una cotización'),false);
});
test('explicit original quote dates establish contradictions even if import is later',()=>{
  const {api}=setup();
  const c=[client(ids[0],'Importado','Referido','2026-09-20','2026-09-01T10:00:00Z')];
  const q=[quote('recImported',[ids[0]],null,'2026-08-01T12:00:00Z'),quote('recOriginal',[ids[0]],'2026-08-25','2026-09-11T12:00:00Z')];
  const {stats,entries}=api._crmAcquisitionAudit(c,q);
  assert.equal(stats.contradictions,1);
  assert.equal(entries[0].earliest,'2026-08-01');
  assert.equal(entries[0].earliestOriginal,'2026-08-25');
  assert.equal(entries[0].earliestSource,'record_created');
});
test('date validator does not accept impossible dates or silently reinterpret invalid text',()=>{
  const {api}=setup();
  assert.equal(api._crmAuditDate('2026-02-30'),null);
  assert.equal(api._crmAuditDate('not a date'),null);
  assert.equal(api._crmAuditDate('2026-09-29T23:00:00Z'),'2026-09-29');
});
test('review panel escapes customer labels, shows evidence counts and does not offer bulk fixing',()=>{
  const {api,panel}=setup();
  api.renderCrmAcquisitionAudit();
  assert.match(panel.innerHTML,/Conciliación de origen CRM/);
  assert.match(panel.innerHTML,/Alta en Airtable · no confirma fecha original/);
  assert.match(panel.innerHTML,/Fecha original de cotización/);
  assert.match(panel.innerHTML,/Solo lectura/);
  assert.match(panel.innerHTML,/recTEST0000000001/);
  assert.match(panel.innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(panel.innerHTML.includes('<img src=x'),false);
  assert.equal(panel.innerHTML.includes('Airtable no'),false);
  assert.ok(!/reparar todos|actualizar todo/i.test(panel.innerHTML));
  api._crmAuditFilterChange('origin');
  assert.match(panel.innerHTML,/Mostrando 3 de 3 registros/);
});
test('review export is local, contains five customers and protects against CSV formula injection',()=>{
  let csv='',clicked=0;
  const URL={createObjectURL:blob=>{csv=blob.parts.join('');return 'blob:test';},
    revokeObjectURL:()=>{}};
  const document={
    getElementById:()=>null,
    body:{appendChild:()=>{}},
    createElement:()=>({set href(v){},set download(v){},click(){clicked++;},remove(){}})
  };
  const {api}=setup({URL,document});
  api._crmAuditExportCsv();
  assert.equal(clicked,1);
  assert.match(csv,/Revisión sugerida/);
  assert.match(csv,/Tipo evidencia primera cotización/);
  assert.match(csv,/Alta Airtable \(fecha original desconocida\)/);
  assert.match(csv,/"'=HYPERLINK\(/,'formula-like client name must be escaped');
  assert.equal(csv.split('\r\n').length,6);
  assert.ok(!csv.includes('gclid-for-test'),'export only the fields needed to review');
});
test('report screen actually mounts audit card beside attribution chart',()=>{
  assert.match(html,/<div id="crmAcquisitionAuditCard"/);
  assert.match(html,/function renderReportes\(\)\{[\s\S]{0,300}renderCrmAcquisitionAudit\(\)/);
});
