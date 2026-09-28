#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','airtable-proxy','src','worker.js'),'utf8');
const worker=new Function(src.replace('export class AiBudgetGuard','class AiBudgetGuard')
    .replace('export class CrmWriteGuard','class CrmWriteGuard')
    .replace('export default','const __wk =')+'\nreturn __wk;')();
const ENV={APP_KEY:'test-local-app-key'};
const ORIGIN='https://dashboard.thelab.solutions';

function makeRequest(target){
  return new Request('https://proxy.example/seo-fetch?url='+encodeURIComponent(target),{
    headers:{Origin:ORIGIN,'X-App-Key':ENV.APP_KEY}
  });
}
async function withSpy(responses,fn){
  const calls=[],original=global.fetch;
  global.fetch=async(url,opts)=>{
    calls.push({url:String(url),opts});
    const next=responses[Math.min(calls.length-1,responses.length-1)];
    return typeof next==='function'?next(url,opts):next;
  };
  try{return await fn(calls);}
  finally{global.fetch=original;}
}
const html=(text)=>new Response(text,{status:200,headers:{'Content-Type':'text/html'}});

test('URL inicial fuera del sitio nunca causa una conexión saliente',async()=>{
  await withSpy([html('secret')],async calls=>{
    for(const url of ['https://evil.example/','http://thelab.solutions/','https://thelab.solutions:8443/','https://user:pass@thelab.solutions/']){
      const r=await worker.fetch(makeRequest(url),ENV,undefined);
      assert.equal(r.status,403);
    }
    assert.equal(calls.length,0);
  });
});

test('bloquea un open redirect que intenta consultar una red privada',async()=>{
  const redirect=new Response(null,{status:302,headers:{Location:'http://169.254.169.254/latest/meta-data'}});
  await withSpy([redirect,html('no debería leerse')],async calls=>{
    const r=await worker.fetch(makeRequest('https://thelab.solutions/redir'),ENV,undefined);
    assert.equal(r.status,403);
    assert.equal(calls.length,1,'no hace fetch del destino de la red privada');
    assert.equal(calls[0].opts.redirect,'manual');
  });
});

test('un redirect al dominio de un tercero tampoco se sigue',async()=>{
  const redirect=new Response(null,{status:301,headers:{Location:'https://evil.example/document'}});
  await withSpy([redirect],async calls=>{
    const r=await worker.fetch(makeRequest('https://thelab.solutions/start'),ENV,undefined);
    assert.equal(r.status,403);
    assert.equal(calls.length,1);
  });
});

test('un redirect relativo dentro del mismo dominio conserva el auditor SEO',async()=>{
  const redirect=new Response(null,{status:302,headers:{Location:'/quienes-somos'}});
  await withSpy([redirect,html('<html>OK</html>')],async calls=>{
    const r=await worker.fetch(makeRequest('https://thelab.solutions/'),ENV,undefined);
    assert.equal(r.status,200);
    const payload=await r.json();
    assert.equal(payload.ok,true);
    assert.equal(payload.html,'<html>OK</html>');
    assert.equal(payload.finalUrl,'https://thelab.solutions/quienes-somos');
    assert.equal(calls.length,2);
    assert.ok(calls.every(x=>x.opts.redirect==='manual'));
  });
});

test('una cadena infinita de redirects termina y no agota el Worker',async()=>{
  const redirect=new Response(null,{status:302,headers:{Location:'/' }});
  await withSpy([redirect],async calls=>{
    const r=await worker.fetch(makeRequest('https://thelab.solutions/'),ENV,undefined);
    assert.equal(r.status,502);
    assert.equal(calls.length,4);
    assert.match((await r.json()).error,/redirecciones/i);
  });
});

test('cabecera Content-Length excesiva bloquea la lectura',async()=>{
  const tooLarge=new Response('x',{status:200,headers:{'Content-Length':String(3*1024*1024)}});
  await withSpy([tooLarge],async calls=>{
    const r=await worker.fetch(makeRequest('https://thelab.solutions/'),ENV,undefined);
    assert.equal(r.status,413);
    assert.equal(calls.length,1);
  });
});

test('una respuesta chunked mayor a 2MiB también se corta',async()=>{
  const tooLarge=html('x'.repeat(2*1024*1024+1));
  await withSpy([tooLarge],async calls=>{
    const r=await worker.fetch(makeRequest('https://thelab.solutions/'),ENV,undefined);
    assert.equal(r.status,413);
    assert.equal(calls.length,1);
  });
});
