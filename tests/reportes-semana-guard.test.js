#!/usr/bin/env node
'use strict';
global.accessAuthorize=async()=>({legacy:true});
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const SOURCE=fs.readFileSync(path.join(__dirname,'..','airtable-proxy','src','worker.js'),'utf8')
  .replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const worker =');
const {CrmMutationGuard,worker}=new Function(SOURCE+'\nreturn {CrmMutationGuard,worker};')();
const ORIGIN='https://dashboard.thelab.solutions';
const BASE='/v0/app1YtD74AqiPWQhy/';
const ENV={AIRTABLE_TOKEN:'test-pat',APP_KEY:'test-app'};
function report(week,more={}){
  return {fields:{Semana:week,'Resumen ejecutivo':'Análisis CEO',
    'Fecha generación':'2026-09-29','Revenue semana (CLP)':100000,...more}};
}
function storage(){
  const memory=new Map();
  return {memory,api:{
    async get(key){return memory.get(key);},
    async put(key,value){memory.set(key,structuredClone(value));},
    async delete(key){memory.delete(key);}
  }};
}
function harness(options={}){
  const store=storage(),records={Reportes:(options.records||[]).map(r=>structuredClone(r))};
  const calls=[];
  let seq=1,posts=0,patches=0;
  const originalFetch=global.fetch;
  global.fetch=async(url,optionsFetch={})=>{
    const u=new URL(String(url)),method=optionsFetch.method||'GET';
    calls.push({method,url:u.pathname});
    assert.ok(u.pathname.startsWith(BASE+'Reportes'),'unexpected Airtable path: '+u.pathname);
    if(method==='GET'){
      if(options.badRead)return new Response(JSON.stringify({records:null}),{status:200});
      return new Response(JSON.stringify({records:records.Reportes}),{status:200});
    }
    if(method==='PATCH'){
      patches++;
      const id=u.pathname.slice((BASE+'Reportes/').length),idx=records.Reportes.findIndex(r=>r.id===id);
      assert.ok(idx>=0);
      records.Reportes[idx].fields={...records.Reportes[idx].fields,...JSON.parse(optionsFetch.body).fields};
      return new Response(JSON.stringify(records.Reportes[idx]),{status:200});
    }
    assert.equal(method,'POST');
    posts++;
    if(options.holdFirst&&posts===1)await options.holdFirst;
    if(options.rejectFirst&&posts===1)return new Response(JSON.stringify({error:'invalid schema'}),{status:422});
    const fields=JSON.parse(optionsFetch.body).fields;
    const created={id:'recNew'+seq++,fields};
    if(!options.noCommit)records.Reportes.push(created);
    if(options.throwFirst&&posts===1)throw Error('network response lost');
    return new Response(JSON.stringify(created),{status:201});
  };
  const guard=new CrmMutationGuard({storage:store.api},ENV);
  const invoke=(payload)=>guard.fetch(new Request('https://internal/create',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({table:'Reportes',body:payload})
  }));
  return {invoke,guard,records:records.Reportes,calls,storage:store.memory,
    counts:()=>({posts,patches}),restore:()=>{global.fetch=originalFetch;}};
}
test('dos computadores generan la misma semana: solo uno hace POST',async()=>{
  const h=harness();
  try{
    const [a,b]=await Promise.all([h.invoke(report('2026-W40')),h.invoke(report('2026-W40'))]);
    assert.deepEqual([a.status,b.status],[201,200]);
    assert.equal((await a.json()).id,(await b.json()).id);
    assert.equal(h.counts().posts,1);
    assert.equal(h.records.length,1);
  }finally{h.restore();}
});
test('reemplazo manual confirmado actualiza por PATCH; ejecución normal no pisa otro análisis',async()=>{
  const h=harness();
  try{
    const first=await h.invoke(report('2026-W40'));assert.equal(first.status,201);
    const noReplace=await h.invoke(report('2026-W40',{'Resumen ejecutivo':'Otro informe'}));
    assert.equal(noReplace.status,200);
    assert.equal(h.records[0].fields['Resumen ejecutivo'],'Análisis CEO');
    const replaced=await h.invoke({...report('2026-W40',{'Resumen ejecutivo':'Actualizado'}),reportReplace:true});
    assert.equal(replaced.status,200);
    assert.equal(h.records[0].fields['Resumen ejecutivo'],'Actualizado');
    assert.deepEqual(h.counts(),{posts:1,patches:1});
  }finally{h.restore();}
});
test('si la respuesta se pierde tras escribir, se adopta el registro remoto sin duplicarlo',async()=>{
  const h=harness({throwFirst:true});
  try{
    const first=await h.invoke(report('2026-W40'));
    assert.equal(first.status,503);
    assert.equal((await first.json()).code,'REPORTES_PENDING_RECONCILIATION');
    const retried=await h.invoke(report('2026-W40'));
    assert.equal(retried.status,200);
    assert.equal((await retried.json()).id,h.records[0].id);
    assert.equal(h.counts().posts,1);
  }finally{h.restore();}
});
test('una respuesta ambigua sin registro remoto visible bloquea reintentos ciegos',async()=>{
  const h=harness({throwFirst:true,noCommit:true});
  try{
    assert.equal((await h.invoke(report('2026-W40'))).status,503);
    const retry=await h.invoke(report('2026-W40'));
    assert.equal(retry.status,503);
    assert.equal((await retry.json()).code,'REPORTES_PENDING_RECONCILIATION');
    assert.equal(h.counts().posts,1);
    assert.ok(h.storage.has('pending:report:2026-W40'));
  }finally{h.restore();}
});
test('rechazo definitivo 422 libera la reserva y permite corregir el informe',async()=>{
  const h=harness({rejectFirst:true});
  try{
    assert.equal((await h.invoke(report('2026-W40'))).status,422);
    assert.equal(h.storage.has('pending:report:2026-W40'),false);
    assert.equal((await h.invoke(report('2026-W40'))).status,201);
    assert.equal(h.counts().posts,2);
  }finally{h.restore();}
});
test('un reporte legado fechado de esa semana se adopta sin crear una segunda fila',async()=>{
  const h=harness({records:[{id:'recLegacy',fields:{
    Semana:'Semana 40 — octubre 2026','Fecha generación':'2026-09-29',
    'Resumen ejecutivo':'Histórico'
  }}]});
  try{
    const first=await h.invoke(report('2026-W40'));
    assert.equal(first.status,200);
    assert.equal((await first.json()).id,'recLegacy');
    assert.equal(h.counts().posts,0);
    const second=await h.invoke({...report('2026-W40'),reportReplace:true});
    assert.equal(second.status,200);
    assert.equal(h.records[0].fields.Semana,'2026-W40');
    assert.deepEqual(h.counts(),{posts:0,patches:1});
  }finally{h.restore();}
});
test('dos filas históricas de la misma semana requieren conciliación, no borrado automático',async()=>{
  const h=harness({records:[
    {id:'recOldA',fields:{Semana:'Semana 40', 'Fecha generación':'2026-09-29'}},
    {id:'recOldB',fields:{Semana:'Semana 40', 'Fecha generación':'2026-09-30'}}
  ]});
  try{
    const resp=await h.invoke(report('2026-W40'));
    assert.equal(resp.status,409);
    assert.equal((await resp.json()).code,'REPORTES_LEGACY_DUPLICATES');
    assert.equal(h.counts().posts,0);
  }finally{h.restore();}
});
test('semana ISO inválida, año de 52 semanas con W53 y lectura incompleta: falla cerrado',async()=>{
  const h=harness();
  try{
    assert.equal((await h.invoke(report('Semana 40 — octubre 2026'))).status,422);
    assert.equal((await h.invoke(report('2025-W53'))).status,422);
    assert.equal(h.counts().posts,0);
  }finally{h.restore();}
  const bad=harness({badRead:true});
  try{
    assert.equal((await bad.invoke(report('2026-W40'))).status,503);
    assert.equal(bad.counts().posts,0);
  }finally{bad.restore();}
});
test('proxy rechaza alta de Reportes si falta DO y bloquea PATCH directo',async()=>{
  const h=harness();
  try{
    const req=(method,path,body)=>new Request('https://proxy.test'+BASE+path,{
      method,headers:{Origin:ORIGIN,'X-App-Key':ENV.APP_KEY,'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    const denied=await worker.fetch(req('POST','Reportes',report('2026-W40')),ENV,{});
    assert.equal(denied.status,503);
    assert.equal(h.counts().posts,0);
    const forbidden=await worker.fetch(req('PATCH','Reportes/rec00001',report('2026-W40')),ENV,{});
    assert.equal(forbidden.status,403);
    const bypass=await worker.fetch(req('POST','%52eportes',report('2026-W40')),ENV,{});
    assert.equal(bypass.status,403);
  }finally{h.restore();}
});
