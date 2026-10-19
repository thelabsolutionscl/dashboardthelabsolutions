// Validación funcional de Catálogos sin Cloudflare ni archivos externos.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {File}=require('node:buffer');
globalThis.File ||= File;

let library;
async function moduleUnderTest(){
  if(!library){
    const worker=fs.readFileSync('airtable-proxy/src/worker.js','utf8');
    const source=worker.split('// BEGIN_CATALOGOS_MODULE')[1]
      .split('// END_CATALOGOS_MODULE')[0].trim().replace('function catalogosRoute','function catalogosRoute')
      +'\nexport {catalogosRoute,handleCatalogos};';
    library=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  }
  return library;
}
function fakeBucket(){
  const map=new Map();
  return {
    async list(){return {objects:[...map.entries()].map(([key,o])=>({key,size:o.size,customMetadata:o.customMetadata,uploaded:new Date()})),truncated:false};},
    async put(key,body,opts){
      const bytes=await new Response(body).arrayBuffer();
      map.set(key,{body:bytes,size:bytes.byteLength,customMetadata:opts.customMetadata});
    },
    async get(key){const o=map.get(key);return o?{size:o.size,body:new Blob([o.body]).stream()}:null;},
    async head(key){return map.get(key)||null;},
    async delete(key){map.delete(key);},
    map
  };
}
function formRequest(filename,bytes,fields={}){
  const form=new FormData();
  form.append('name',fields.name||'Catálogo TLS');
  form.append('category',fields.category||'General');
  form.append('file',new File([bytes],filename,{type:'application/pdf'}));
  return new Request('https://proxy.example/catalogos',{method:'POST',body:form});
}
async function invoke(method,path,identity,env,req){
  const {handleCatalogos}=await moduleUnderTest();
  const request=req||new Request('https://proxy.example'+path,{method});
  return handleCatalogos(request,new URL(request.url),env,identity,{'Access-Control-Allow-Origin':'https://dashboard.thelab.solutions'});
}

test('Catálogos exige identidad firmada y R2 configurado',async()=>{
  const env={CATALOGOS_BUCKET:fakeBucket()};
  const anon=await invoke('GET','/catalogos',null,env);
  assert.equal(anon.status,401);
  const unavailable=await invoke('GET','/catalogos',{role:'admin',email:'admin@example.com'}, {});
  assert.equal(unavailable.status,503);
});
test('Catálogos autoriza lectura, comprueba PDF, y reserva borrado para administración',async()=>{
  const env={CATALOGOS_BUCKET:fakeBucket()};
  const viewer={role:'viewer',email:'viewer@example.com'};
  const admin={role:'admin',email:'admin@example.com'};
  const denied=await invoke('POST','/catalogos',viewer,env,formRequest('test.pdf','%PDF-1.7\n'));
  assert.equal(denied.status,403);
  const invalid=await invoke('POST','/catalogos',admin,env,formRequest('test.pdf','NOT_A_PDF'));
  assert.equal(invalid.status,415);
  const uploaded=await invoke('POST','/catalogos',admin,env,formRequest('catalogo.pdf','%PDF-1.7\n1 0 obj\n'));
  assert.equal(uploaded.status,201);
  const {item}=await uploaded.json();
  assert.equal(item.name,'Catálogo TLS.pdf');
  assert.match(item.id,/^[0-9a-f-]{36}$/);
  assert.equal(env.CATALOGOS_BUCKET.map.size,1);
  const listing=await invoke('GET','/catalogos',viewer,env);
  assert.equal(listing.status,200);
  const list=await listing.json();
  assert.equal(list.items.length,1);
  assert.equal(list.items[0].name,item.name);
  const document=await invoke('GET','/catalogos/'+item.id,viewer,env);
  assert.equal(document.status,200);
  assert.equal(document.headers.get('content-type'),'application/pdf');
  assert.equal((await document.text()).startsWith('%PDF-'),true);
  assert.match(document.headers.get('cache-control')||'',/no-store/);
  const sales={role:'sales',email:'sales@example.com'};
  const unauthorized=await invoke('DELETE','/catalogos/'+item.id,sales,env);
  assert.equal(unauthorized.status,403);
  const removed=await invoke('DELETE','/catalogos/'+item.id,admin,env);
  assert.equal(removed.status,200);
  assert.equal((await invoke('GET','/catalogos/'+item.id,viewer,env)).status,404);
});
test('Rutas inválidas y consultas no pasan a R2',async()=>{
  const env={CATALOGOS_BUCKET:fakeBucket()},admin={role:'admin',email:'admin@example.com'};
  assert.equal((await invoke('GET','/catalogos/../otra',admin,env)).status,404);
  assert.equal((await invoke('GET','/catalogos?admin=true',admin,env)).status,400);
  assert.equal((await invoke('PUT','/catalogos',admin,env)).status,405);
});
