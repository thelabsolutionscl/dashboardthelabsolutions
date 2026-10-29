#!/usr/bin/env node
'use strict';
// "Subir imagen" en Redes: el proxy (Access) guarda un JPEG acotado en el KV
// compartido y thelab-leads-worker lo sirve sin sesión para que Instagram lo
// descargue. Se prueba el comportamiento real de cada pieza, no solo su texto.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const PROXY=fs.readFileSync(path.join(ROOT,'airtable-proxy/src/worker.js'),'utf8');
const ACCESS=fs.readFileSync(path.join(ROOT,'airtable-proxy/src/access-auth.js'),'utf8');
const WORKER=fs.readFileSync(path.join(ROOT,'lead-worker/src/index.js'),'utf8');
const REDES=fs.readFileSync(path.join(ROOT,'js/redes.js'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const PROXY_TOML=fs.readFileSync(path.join(ROOT,'airtable-proxy/wrangler.toml'),'utf8');
const WORKER_TOML=fs.readFileSync(path.join(ROOT,'lead-worker/wrangler.toml'),'utf8');

function block(src,start,end){
  const i=src.indexOf(start);assert.ok(i>=0,'missing '+start);
  const j=src.indexOf(end,i+start.length);assert.ok(j>i,'missing end '+end);
  return src.slice(i,j);
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const upload=new Function('json',`${block(PROXY,'const SOCIAL_MEDIA_MAX_BYTES','// ── Heartbeat hacia la tabla Automations')}\nreturn socialMediaUpload;`)(
  (data,status,headers)=>({status,data,headers}));
function req(bytes,{type='image/jpeg',length}={}){
  const h=new Map([['content-type',type],['content-length',String(length??bytes.length)]]);
  return {method:'POST',headers:{get:k=>h.get(k.toLowerCase())??null},arrayBuffer:async()=>bytes.buffer};
}
function jpeg(n=4096){const b=new Uint8Array(n);b[0]=0xFF;b[1]=0xD8;b[2]=0xFF;b[3]=0xE0;return b;}
function kv(){const puts=[];return {puts,put:async(k,v,o)=>{puts.push({k,v,o});}};}
const URL0=new URL('https://proxy.thelab.solutions/social/media');
const MARKETING={role:'viewer',email:'marketing@thelab.solutions'};

test('el proxy guarda solo un JPEG acotado de una identidad con permiso social',async()=>{
  const store=kv(),env={AI_BUDGET:store,SOCIAL_MEDIA_PUBLIC_BASE:'https://thelab-leads-worker.wast3dspa.workers.dev/'};
  const ok=await upload(req(jpeg()),env,URL0,MARKETING,{});
  assert.equal(ok.status,200);
  const m=ok.data.url.match(/^https:\/\/thelab-leads-worker\.wast3dspa\.workers\.dev\/media\/(.+)\.jpg$/);
  assert.ok(m&&UUID.test(m[1]),ok.data.url);
  assert.equal(store.puts.length,1);
  assert.equal(store.puts[0].k,'social-media:'+m[1]+'.jpg');
  assert.equal(store.puts[0].o.expirationTtl,180*24*60*60);
  assert.equal(store.puts[0].o.metadata.by,'marketing@thelab.solutions');
  assert.equal((await upload(req(jpeg()),env,URL0,{role:'admin',email:'gustavo@thelab.solutions'},{})).status,200);

  // Sin sesión Access o con un rol sin permiso social no se escribe nada.
  for(const who of [null,{role:'viewer',email:'otro@thelab.solutions'},{role:'sales',email:'v@thelab.solutions'}])
    assert.equal((await upload(req(jpeg()),env,URL0,who,{})).status,403);
  // Solo JPEG real: ni otro Content-Type ni bytes que no empiezan con FF D8 FF.
  assert.equal((await upload(req(jpeg(),{type:'image/png'}),env,URL0,MARKETING,{})).status,415);
  const html=new TextEncoder().encode('<html><script>alert(1)</script>'.padEnd(400,' '));
  assert.equal((await upload(req(html),env,URL0,MARKETING,{})).status,422);
  assert.equal((await upload(req(jpeg(64)),env,URL0,MARKETING,{})).status,422);
  // Tope de 8 MB, tanto declarado como real.
  assert.equal((await upload(req(jpeg(),{length:9*1024*1024}),env,URL0,MARKETING,{})).status,413);
  assert.equal((await upload(req(jpeg(8*1024*1024+1)),env,URL0,MARKETING,{})).status,413);
  // Método y query fijos; sin KV no finge éxito.
  assert.equal((await upload({...req(jpeg()),method:'GET'},env,URL0,MARKETING,{})).status,405);
  assert.equal((await upload(req(jpeg()),env,new URL(URL0+'?x=1'),MARKETING,{})).status,405);
  assert.equal((await upload(req(jpeg()),{},URL0,MARKETING,{})).status,503);
  assert.equal(store.puts.length,2,'los rechazos no escriben en el KV');
});

test('la ruta exige Access con el mismo permiso que /social/lead',()=>{
  assert.match(ACCESS,/if\(path==='\/social\/media'\)return method==='POST'&&\(admin\|\|identity\.email==='marketing@thelab\.solutions'\);/);
  assert.match(PROXY,/url\.pathname==='\/social\/lead'\|\|url\.pathname==='\/social\/media'\|\|/,'debe resolverse con su propia ruta Access');
  assert.match(PROXY,/if\(url\.pathname==='\/social\/media'\)\s*return await socialMediaUpload\(request,env,url,authorized\.identity,/);
  // Proxy y Worker comparten el namespace: lo que uno escribe el otro lo lee.
  const ns=t=>t.match(/binding = "(AI_BUDGET|RL)"\s*\nid = "([0-9a-f]{32})"/)[2];
  assert.equal(ns(PROXY_TOML),ns(WORKER_TOML));
  assert.match(PROXY_TOML,/SOCIAL_MEDIA_PUBLIC_BASE = "https:\/\/thelab-leads-worker\.wast3dspa\.workers\.dev"/);
});

const serve=new Function(`${block(WORKER,'async function handleSocialMediaGet(','/* Cola de publicación para el conector')}\nreturn handleSocialMediaGet;`)();
test('el Worker sirve solo IDs válidos, como image/jpeg y sin interpretar contenido',async()=>{
  const id='3f2a1c4e-9b7d-4e21-8a6f-0c1d2e3f4a5b',data=jpeg(2048).buffer,asked=[];
  const env={RL:{get:async(k,o)=>{asked.push([k,o?.type]);return k==='social-media:'+id+'.jpg'?data:null;}}};
  const get=(p,method='GET')=>serve({method},env,new URL('https://thelab-leads-worker.wast3dspa.workers.dev'+p));

  const ok=await get('/media/'+id+'.jpg');
  assert.equal(ok.status,200);
  assert.equal(ok.headers.get('Content-Type'),'image/jpeg');
  assert.equal(ok.headers.get('X-Content-Type-Options'),'nosniff');
  assert.match(ok.headers.get('Cache-Control'),/public/);
  assert.equal((await ok.arrayBuffer()).byteLength,2048);
  assert.deepEqual(asked[0],['social-media:'+id+'.jpg','arrayBuffer']);
  const head=await get('/media/'+id+'.jpg','HEAD');
  assert.equal(head.status,200);assert.equal(head.body,null);

  // Nada fuera del patrón llega al KV (ni otras claves como supplier-application:).
  asked.length=0;
  for(const p of ['/media/'+id.toUpperCase()+'.jpg','/media/'+id+'.png','/media/'+id,'/media/../health',
    '/media/supplier-application:x.jpg','/media/'+id+'.jpg?x=1','/media/'])
    assert.equal((await get(p)).status,404,p);
  assert.equal(asked.length,0);
  assert.equal((await get('/media/00000000-0000-4000-8000-000000000000.jpg')).status,404);
  assert.equal((await serve({method:'GET'},{},new URL('https://w.dev/media/'+id+'.jpg'))).status,503);
  assert.match(WORKER,/url\.pathname\.startsWith\("\/media\/"\)\) \{\s*return await handleSocialMediaGet\(request, env, url\);/);
});

test('el navegador ajusta la imagen al formato de Instagram sin recortar',()=>{
  const fit=new Function(`${block(REDES,'const _REDES_IG_RATIO_MIN','function _redesLoadImg(')}\nreturn _redesFitIg;`)();
  for(const [w,h] of [[1080,1080],[1080,1350],[1080,1920],[1920,1080],[3000,1000],[4000,5000],[500,2000],[1024,1536],[200,200],[1440,10]]){
    const f=fit(w,h),r=f.cw/f.ch;
    assert.ok(r>=0.8&&r<=1.91,`${w}x${h} → ${f.cw}x${f.ch}`);
    assert.ok(f.cw<=1441,`${w}x${h} ancho ${f.cw}`);
    assert.ok(f.dw<=f.cw&&f.dh<=f.ch&&f.dx>=0&&f.dy>=0,'la imagen completa cabe en el lienzo');
    assert.ok(Math.abs(f.dw/f.dh-w/h)<0.02,'no se deforma');
    assert.equal(f.padded,f.dw!==f.cw||f.dh!==f.ch);
  }
  assert.deepEqual(fit(1080,1350),{cw:1080,ch:1350,dw:1080,dh:1350,dx:0,dy:0,padded:false});
});

test('el editor sube con la sesión Access y deja el enlace en Media URL',()=>{
  assert.match(INDEX,/id="redesUploadBtn" onclick="redesUploadMediaPick\(\)"/);
  assert.match(INDEX,/<input type="file" id="redesUploadFile" accept="image\/\*"[^>]*onchange="redesUploadMedia\(this\)"/);
  const up=block(REDES,'async function redesUploadMedia(','\n}\n');
  assert.match(up,/\/social\/media'/);
  assert.match(up,/credentials:'include',redirect:'error'/);
  assert.match(up,/'Content-Type':'image\/jpeg'/);
  assert.match(up,/getElementById\('redesEditMedia'\); if\(inp\) inp\.value=d\.url/);
  assert.match(up,/textContent=/);
  assert.doesNotMatch(up,/innerHTML/);
  assert.match(block(REDES,'function redesUploadMediaPick(','\n}\n'),/_redesDemo/);
});
