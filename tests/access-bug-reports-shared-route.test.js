#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const authSource=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/access-auth.js'),'utf8')
  .replace('export async function accessAuthorize','async function accessAuthorize');
const {accessAllows}=new Function(authSource+'\nreturn {accessAllows};')();
const workerSource=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/worker.js'),'utf8')
  .replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const worker=');
const {worker,bugReportContextAllowed,bugReportScreenshotAllowed,bugReportMetaAllowed}=
  new Function(workerSource+'\nreturn {worker,bugReportContextAllowed,bugReportScreenshotAllowed,bugReportMetaAllowed};')();
const priorFetch=global.fetch;
test.after(()=>{global.fetch=priorFetch;});
const APP='app1YtD74AqiPWQhy',TABLE='/v0/'+APP+'/Monitor%20Sistema';
function harness(){
  const records=[];let seq=0;
  const env={APP_KEY:'test-key',AIRTABLE_TOKEN:'pat-test'};
  global.fetch=async(uri,opts={})=>{
    const u=new URL(String(uri)),method=opts.method||'GET';
    assert.equal(u.hostname,'api.airtable.com');
    assert.equal(u.pathname.startsWith(TABLE),true);
    if(method==='GET'){
      const formula=u.searchParams.get('filterByFormula')||'';
      let found=records;
      const exact=/\{Name\}="([^"]+)"/.exec(formula);
      if(exact)found=records.filter(r=>r.fields.Name===exact[1]);
      else if(formula.includes('LEFT({Name},16)'))found=records.filter(r=>r.fields.Name.startsWith('BUG_REPORT_META:'));
      return Response.json({records:found});
    }
    if(method==='POST'){
      const body=JSON.parse(opts.body),rows=Array.isArray(body.records)?body.records:[body];
      const made=rows.map(row=>{const rec={id:'rec'+String(++seq).padStart(14,'A'),fields:row.fields};records.push(rec);return rec;});
      return Response.json(Array.isArray(body.records)?{records:made}:made[0]);
    }
    if(method==='PATCH'){
      const id=u.pathname.split('/').pop(),row=records.find(r=>r.id===id),body=JSON.parse(opts.body);
      assert.ok(row);Object.assign(row.fields,body.fields);return Response.json(row);
    }
    throw Error('unexpected '+method);
  };
  const run=(method,{identity={role:'operator',email:'ops@example.com'},body,id}={})=>{
    global.accessAuthorize=async(_r,_e,p)=>{
      if(!accessAllows(identity,method,p))return{response:Response.json({error:'denied'},{status:403})};
      return{identity};
    };
    return worker.fetch(new Request('https://proxy.example.com/shared/bug-reports'+(id?'?id='+encodeURIComponent(id):''),{
      method,headers:{Origin:'https://dashboard.thelab.solutions','X-App-Key':env.APP_KEY,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    }),env,{waitUntil(){}});
  };
  return{run,records};
}
const context=()=>({section:'correo',path:'/#correo',build:'abc1234',viewport:{width:1200,height:800,dpr:1},userAgent:'test',reporterName:'Operador'});

test('roles firmados pueden reportar; solo admin puede ejecutar acciones',()=>{
  for(const role of ['viewer','sales','operator','finance','admin']){
    assert.equal(accessAllows({role},'GET','/shared/bug-reports'),true,role);
    assert.equal(accessAllows({role},'POST','/shared/bug-reports'),true,role);
  }
  for(const role of ['viewer','sales','operator','finance'])
    assert.equal(accessAllows({role},'PATCH','/shared/bug-reports'),false,role);
  assert.equal(accessAllows({role:'admin'},'PATCH','/shared/bug-reports'),true);
  assert.equal(accessAllows({role:'admin'},'DELETE','/shared/bug-reports'),false);
});
test('validadores rechazan payloads arbitrarios y formatos de imagen activos',()=>{
  assert.equal(bugReportContextAllowed(context()),true);
  assert.equal(bugReportContextAllowed({...context(),secret:'x'}),false);
  assert.equal(bugReportScreenshotAllowed({dataUrl:'data:image/jpeg;base64,AA==',mime:'image/jpeg',width:100,height:80,bytes:1}),true);
  assert.equal(bugReportScreenshotAllowed({dataUrl:'data:image/svg+xml;base64,PHN2Zz4=',mime:'image/svg+xml',width:100,height:80,bytes:10}),false);
});
test('POST guarda metadata e imagen; historial de usuario no filtra datos de otro usuario',async()=>{
  const h=harness();
  let res=await h.run('POST',{identity:{role:'operator',email:'uno@example.com'},body:{
    message:'Tratando de enviar un correo apareció un error inesperado',
    context:context(),screenshot:{dataUrl:'data:image/jpeg;base64,AA==',mime:'image/jpeg',width:100,height:80,bytes:1}
  }});
  assert.equal(res.status,201,await res.clone().text());
  const first=await res.json();assert.match(first.id,/^br_/);
  res=await h.run('POST',{identity:{role:'operator',email:'dos@example.com'},body:{
    message:'Otro problema suficientemente descriptivo para el historial',context:{...context(),reporterName:'Dos'},screenshot:null
  }});
  assert.equal(res.status,201);
  res=await h.run('GET',{identity:{role:'operator',email:'uno@example.com'}});
  const mine=await res.json();assert.equal(mine.reports.length,1);assert.equal(mine.reports[0].id,first.id);
  res=await h.run('GET',{identity:{role:'admin',email:'admin@example.com'}});
  const all=await res.json();assert.equal(all.reports.length,2);
  res=await h.run('GET',{identity:{role:'operator',email:'dos@example.com'},id:first.id});
  assert.equal(res.status,404);
  res=await h.run('GET',{identity:{role:'admin',email:'admin@example.com'},id:first.id});
  const detail=await res.json();assert.equal(detail.report.id,first.id);assert.match(detail.screenshot,/^data:image\/jpeg/);
});
test('metadata guard no permite estados o claves desconocidas',()=>{
  const meta={version:1,id:'br_abcdefghijklmn',createdAt:new Date().toISOString(),reporter:'x@example.com',reporterName:'X',
    role:'operator',message:'Descripción válida del problema',section:'correo',path:'/#correo',build:'abc',
    viewport:{width:100,height:100,dpr:1},userAgent:'test',status:'nuevo',screenshot:null,repair:{attempts:0,updatedAt:new Date().toISOString()}};
  assert.equal(bugReportMetaAllowed(meta),true);
  assert.equal(bugReportMetaAllowed({...meta,status:'hackeado'}),false);
  assert.equal(bugReportMetaAllowed({...meta,secret:'x'}),false);
});
