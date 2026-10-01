#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');

const UI=fs.readFileSync(path.join(__dirname,'../js/problem-reports.js'),'utf8');
const LOADER=fs.readFileSync(path.join(__dirname,'../js/farm-health-adapter.js'),'utf8');
const AUTH=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/access-auth.js'),'utf8')
  .replace('export async function accessAuthorize','async function accessAuthorize');
const WORKER=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/worker.js'),'utf8')
  .replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const worker=');
const {accessAllows}=new Function(AUTH+'\nreturn {accessAllows};')();
const {problemReportPayloadAllowed,problemRepairPayloadAllowed,problemProjectRecord}=
  new Function(WORKER+'\nreturn {problemReportPayloadAllowed,problemRepairPayloadAllowed,problemProjectRecord};')();

test('menu de usuario carga Reportar problema y abre una pantalla propia',()=>{
  assert.match(LOADER,/load\('js\/problem-reports\.js','reporte e historial de problemas'\)/);
  assert.match(UI,/REPORTAR PROBLEMA/);
  assert.match(UI,/id='problemReportMenuItem'|id="problemReportMenuItem"|item\.id='problemReportMenuItem'/);
  assert.match(UI,/role','dialog|setAttribute\('role','dialog'\)/);
  assert.match(UI,/Nuevo reporte/);
  assert.match(UI,/Historial/);
});

test('formulario admite mensaje, screenshot y auto reparación',()=>{
  assert.match(UI,/problemMessage/);
  assert.match(UI,/image\/png,image\/jpeg,image\/webp/);
  assert.match(UI,/fileToShot/);
  assert.match(UI,/toDataURL\('image\/webp'/);
  assert.match(UI,/problemAutoRepair/);
  assert.match(UI,/Reparar automáticamente con IA/);
  assert.match(UI,/section:\s*section\(\)/);
  assert.match(UI,/navigator\.userAgent/);
});

test('ruta compartida permite reportar y leer sin abrir Airtable genérico',()=>{
  for(const role of ['viewer','sales','operator','finance','admin']){
    assert.equal(accessAllows({role},'GET','/shared/problems'),true,role+' GET');
    assert.equal(accessAllows({role},'POST','/shared/problems'),true,role+' POST');
    for(const method of ['PUT','PATCH','DELETE'])
      assert.equal(accessAllows({role},method,'/shared/problems'),false,role+' '+method);
  }
  assert.match(WORKER,/url\.pathname==='\/shared\/problems'/);
  assert.match(WORKER,/PROBLEM_REPORTS_TABLE='tbl2kU5lGg1JYcrPi'/);
  assert.match(WORKER,/content\.airtable\.com\/v0\/app1YtD74AqiPWQhy/);
  assert.match(WORKER,/PROBLEM_SCREENSHOT_FIELD='fldV1AHUN24F2lkdW'/);
});

test('payload rechaza secretos gigantes, URLs externas y archivos no imagen',()=>{
  const good={message:'Traté de enviar un correo y apareció un error',section:'correo',
    url:'https://dashboard.thelab.solutions/',build:'abc123',navigator:'Chrome',
    autoRepair:true,reporter:'user@example.com',
    screenshot:{filename:'captura.webp',contentType:'image/webp',base64:'A'.repeat(40)}};
  assert.equal(problemReportPayloadAllowed(good),true);
  assert.equal(problemReportPayloadAllowed({...good,message:'x'}),false);
  assert.equal(problemReportPayloadAllowed({...good,url:'https://evil.example/'}),false);
  assert.equal(problemReportPayloadAllowed({...good,screenshot:{...good.screenshot,contentType:'image/svg+xml'}}),false);
  assert.equal(problemReportPayloadAllowed({...good,extra:'secret'}),false);
});

test('historial permite enviar un reporte a reparación con un botón',()=>{
  assert.match(UI,/data-pr-repair/);
  assert.match(UI,/⚡ Reparar/);
  assert.match(UI,/↻ Reintentar reparación/);
  assert.match(UI,/✓ En cola/);
  assert.match(UI,/action:'repair'/);
  assert.match(UI,/Reporte enviado a reparación/);
});

test('acción repair solo acepta un recordId canónico y campos mínimos',()=>{
  assert.equal(problemRepairPayloadAllowed({action:'repair',recordId:'recAAAAAAAAAAAAAA',reporter:'user@example.com'}),true);
  assert.equal(problemRepairPayloadAllowed({action:'repair',recordId:'bad',reporter:'user@example.com'}),false);
  assert.equal(problemRepairPayloadAllowed({action:'repair',recordId:'recAAAAAAAAAAAAAA',extra:'x'}),false);
  assert.equal(problemRepairPayloadAllowed({action:'delete',recordId:'recAAAAAAAAAAAAAA'}),false);
  assert.match(WORKER,/Solicitud manual de reparación recibida\. En cola para el próximo ciclo del agente\./);
  assert.match(WORKER,/Estado:'Nuevo','Auto reparar':true/);
});

test('historial proyecta solo campos de producto y una captura',()=>{
  const out=problemProjectRecord({id:'recAAAAAAAAAAAAAA',createdTime:'2026-10-01T10:00:00Z',fields:{
    'Reporte ID':'BUG-1',Estado:'Nuevo',Mensaje:'fallo','Usuario':'user@example.com','Sección':'correo',
    URL:'https://dashboard.thelab.solutions/',Build:'abc',Navegador:'Chrome','Auto reparar':true,
    Fecha:'2026-10-01T10:00:00Z',Screenshot:[{id:'att1',filename:'a.webp',url:'https://dl.airtable.com/a',type:'image/webp',
      thumbnails:{large:{url:'https://dl.airtable.com/thumb'}}}]
  }});
  assert.equal(out.reportId,'BUG-1');assert.equal(out.estado,'Nuevo');assert.equal(out.autoReparar,true);
  assert.equal(out.screenshot.filename,'a.webp');assert.equal(out.screenshot.thumb,'https://dl.airtable.com/thumb');
  assert.equal(out.fields,undefined);
});
