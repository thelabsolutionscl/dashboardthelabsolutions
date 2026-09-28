#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const GUARD=fs.readFileSync(path.join(root,'sii-worker','src','folio-guard.js'),'utf8');
const WORKER=fs.readFileSync(path.join(root,'sii-worker','src','index.js'),'utf8');
const WRANGLER=fs.readFileSync(path.join(root,'sii-worker','wrangler.toml'),'utf8');
const SiiFolioGuard=new Function(GUARD.replace('export class SiiFolioGuard','class SiiFolioGuard')+'\nreturn SiiFolioGuard;')();

const CAF=(tipo,start,end)=>'<CAF><DA><TD>'+tipo+'</TD><RNG><D>'+start+'</D><H>'+end+'</H></RNG></DA></CAF>';
function world({kvStart=0,caf=null,mirrorFail=false,readDelay=0}={}){
  const remote=new Map();
  if(kvStart)remote.set('folio_33',String(kvStart));
  if(caf)remote.set('caf_33',caf);
  const state=new Map();
  let attempted=0;
  const kv={
    get:async k=>{
      if(readDelay)await new Promise(r=>setTimeout(r,readDelay));
      return remote.get(k)||null;
    },
    put:async(k,v)=>{
      attempted++;
      if(mirrorFail&&k.startsWith('folio_'))throw new Error('KV espejo no disponible');
      remote.set(k,String(v));
    },
    remote
  };
  const storage={
    get:async k=>state.get(k),
    put:async(k,v)=>{state.set(k,v);}
  };
  const create=()=>new SiiFolioGuard({storage},{FOLIOS_KV:kv});
  const send=async(guard,op,tipo='33',payload={})=>{
    const res=await guard.fetch(new Request('https://internal.folio/',{
      method:'POST',body:JSON.stringify({op,tipo,...payload})
    }));
    return {status:res.status,...await res.json()};
  };
  return {create,send,kv,state,attempts:()=>attempted};
}

test('veinte emisiones simultáneas jamás reservan el mismo folio',async()=>{
  const w=world({readDelay:1}),g=w.create();
  const up=await w.send(g,'upload','33',{caf_xml:CAF('33',101,300)});
  assert.equal(up.status,200);
  const calls=await Promise.all(Array.from({length:20},()=>w.send(g,'reserve')));
  assert.ok(calls.every(x=>x.status===200),JSON.stringify(calls));
  assert.deepEqual(calls.map(x=>x.folio),Array.from({length:20},(_,i)=>101+i));
  assert.equal(w.state.get('last'),120);
  assert.equal(w.kv.remote.get('folio_33'),'120');
  assert.ok(calls.every(x=>x.caf_xml.includes('<TD>33</TD>')));
});

test('el folio queda reservado antes de enviar: el reinicio del isolate no lo repite',async()=>{
  const w=world(),g=w.create();
  await w.send(g,'upload','33',{caf_xml:CAF('33',400,450)});
  assert.equal((await w.send(g,'reserve')).folio,400);
  const afterRestart=w.create();
  assert.equal((await w.send(afterRestart,'reserve')).folio,401);
  assert.equal((await w.send(afterRestart,'status')).folio_actual,401);
});

test('si falla la escritura del espejo KV, el número persiste en DO.storage',async()=>{
  const w=world({mirrorFail:true,caf:CAF('33',100,120),kvStart:99}),g=w.create();
  assert.equal((await w.send(g,'reserve')).folio,100);
  assert.equal(w.state.get('last'),100);
  assert.equal((await w.send(w.create(),'reserve')).folio,101,'nunca volver al contador KV obsoleto');
});

test('volver a subir el mismo CAF preserva el número reservado',async()=>{
  const w=world(),g=w.create(),xml=CAF('33',1,20);
  await w.send(g,'upload','33',{caf_xml:xml});
  await w.send(g,'reserve');
  const second=await w.send(g,'upload','33',{caf_xml:xml});
  assert.equal(second.status,200);
  assert.equal(second.contador_conservado,true);
  assert.equal(second.siguiente_folio,2);
});

test('nuevo CAF permite avanzar, pero uno anterior no rebobina el contador',async()=>{
  const w=world({kvStart:200,caf:CAF('33',101,200)}),g=w.create();
  const next=await w.send(g,'upload','33',{caf_xml:CAF('33',201,300)});
  assert.equal(next.status,200);
  assert.equal((await w.send(g,'reserve')).folio,201);
  const old=await w.send(g,'upload','33',{caf_xml:CAF('33',101,200)});
  assert.equal(old.status,409);
  assert.equal((await w.send(g,'reserve')).folio,202);
});

test('CAF de un tipo diferente no puede autorizar otro DTE',async()=>{
  const w=world(),g=w.create();
  const bad=await w.send(g,'upload','39',{caf_xml:CAF('33',101,200)});
  assert.equal(bad.status,400);
  assert.equal(w.state.size,0);
  assert.equal(w.kv.remote.size,0);
});

test('si la reserva llega al final del rango, el siguiente intento falla cerrado',async()=>{
  const w=world(),g=w.create();
  await w.send(g,'upload','33',{caf_xml:CAF('33',500,501)});
  assert.equal((await w.send(g,'reserve')).folio,500);
  assert.equal((await w.send(g,'reserve')).folio,501);
  const exhausted=await w.send(g,'reserve');
  assert.equal(exhausted.status,409);
  assert.match(exhausted.error,/agotados/i);
  assert.equal((await w.send(g,'status')).folios_disponibles,0);
});

test('sin KV o storage no se reserva ni se inventa un folio',async()=>{
  const g=new SiiFolioGuard({storage:{get:async()=>undefined,put:async()=>{}}},{});
  const res=await g.fetch(new Request('https://internal/',{
    method:'POST',body:JSON.stringify({op:'reserve',tipo:'33'})
  }));
  assert.equal(res.status,503);
});

test('SII exige DO en el worker y migración automática en Wrangler',()=>{
  assert.match(WRANGLER,/name = "FOLIO_GUARD"/);
  assert.match(WRANGLER,/class_name = "SiiFolioGuard"/);
  assert.match(WRANGLER,/new_sqlite_classes = \["SiiFolioGuard"\]/);
  assert.match(WORKER,/if \(!env\.FOLIO_GUARD \|\| !env\.FOLIOS_KV\)/);
  const emission=WORKER.slice(WORKER.indexOf('async function handleEmitDTE('),WORKER.indexOf('// ── CAF'));
  assert.ok(emission.indexOf('await nextFolio(')<emission.indexOf('await uploadDTE('));
  assert.doesNotMatch(emission,/env\.FOLIOS_KV\.put/,'el contador no se guarda después del envío');
});

test('POST por una ruta desconocida no puede emitir accidentalmente',()=>{
  assert.match(WORKER,/request\.method === 'POST' && \(url\.pathname === '\/' \|\| url\.pathname === '\/emit'\)/);
});
