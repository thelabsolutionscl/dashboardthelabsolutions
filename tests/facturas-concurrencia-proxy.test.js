#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const proxy=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/worker.js'),'utf8');
const begin=proxy.indexOf('export class CrmMutationGuard {');
const end=proxy.indexOf('\nexport default',begin);
assert.ok(begin>=0&&end>begin);
const CrmMutationGuard=new Function('AIRTABLE_BASE',proxy.slice(begin,end).replace('export class CrmMutationGuard','class CrmMutationGuard')+'\nreturn CrmMutationGuard;')('https://api.airtable.com');

function harness({failPost=false,readFails=false}={}){
  const records=[],storage=new Map();
  const stats={reads:0,posts:0};
  const storageApi={
    get:async k=>structuredClone(storage.get(k)),
    put:async(k,v)=>storage.set(k,structuredClone(v)),
    delete:async k=>storage.delete(k)
  };
  const fetchFake=async(url,options={})=>{
    if(options.method==='POST'){
      stats.posts++;
      if(failPost)throw new Error('Network timeout after Airtable POST');
      const fields=JSON.parse(options.body).fields;
      const rec={id:'recFactura'+stats.posts,fields};
      records.push(rec);
      return Response.json(rec,{status:200});
    }
    stats.reads++;
    if(readFails)throw Error('Airtable not responding');
    return Response.json({records});
  };
  const original=global.fetch;
  global.fetch=fetchFake;
  const guard=new CrmMutationGuard({storage:storageApi},{AIRTABLE_TOKEN:'test'});
  const fields={'Tipo DTE':'33',Folio:101,Fecha:'2026-09-28','Cliente':'Empresa A',Neto:1000,IVA:190,Total:1190};
  const send=async(f=fields,table='Facturas')=>{
    const r=await guard.fetch(new Request('https://guard.internal/create',{
      method:'POST',body:JSON.stringify({table,body:{fields:f}})
    }));
    return {status:r.status,...await r.json()};
  };
  return {send,records,storage,stats,restore:()=>global.fetch=original,fields};
}

test('dos equipos creando mismo tipo/folio/año reciben una única factura',async()=>{
  const h=harness();
  try{
    const [a,b]=await Promise.all([h.send(),h.send()]);
    assert.equal(a.id,b.id);
    assert.equal(h.stats.posts,1);
    assert.equal(h.records.length,1);
  }finally{h.restore();}
});
test('una respuesta Airtable perdida bloquea reintentos aunque no aparezca en la lectura',async()=>{
  const h=harness({failPost:true});
  try{
    const first=await h.send();
    assert.equal(first.status,503);
    assert.equal(first.code,'FACTURA_PENDING_RECONCILIATION');
    const second=await h.send();
    assert.equal(second.status,503);
    assert.equal(h.stats.posts,1);
  }finally{h.restore();}
});
test('si Airtable no permite comprobar unicidad no se crea factura',async()=>{
  const h=harness({readFails:true});
  try{
    assert.equal((await h.send()).status,503);
    assert.equal(h.stats.posts,0);
  }finally{h.restore();}
});
test('otro tipo o año no reutiliza identidad de una factura distinta',async()=>{
  const h=harness();
  try{
    const a=await h.send();
    const b=await h.send({...h.fields,'Tipo DTE':'61'});
    const c=await h.send({...h.fields,Fecha:'2027-09-28'});
    assert.notEqual(a.id,b.id);
    assert.notEqual(a.id,c.id);
    assert.equal(h.stats.posts,3);
  }finally{h.restore();}
});
test('rutas Facturas no pueden omitir el guard mediante nombres alternativos',()=>{
  assert.match(proxy,/critical === 'facturas'/);
  assert.match(proxy,/path === dataPrefix \+ 'Facturas'/);
  assert.match(proxy,/CRM_MUTATION_GUARD\.get\(id\)/);
});
