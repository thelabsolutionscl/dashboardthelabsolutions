#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const script=pathToFileURL(path.join(__dirname,'../scripts/access-readiness.mjs'));
const cfg={proxyUrl:'https://proxy.thelab.solutions',proxyKey:'compat-test',
  serviceClientId:'test-machine.access',serviceClientSecret:'test-only',stage:'before'};
const cors={'Access-Control-Allow-Origin':'https://dashboard.thelab.solutions',
  'Access-Control-Allow-Credentials':'true',
  'Access-Control-Allow-Headers':'Content-Type,X-App-Key,X-AI-Agent',
  'Access-Control-Allow-Methods':'GET,POST,PATCH,PUT,DELETE,OPTIONS'};
function mock({badCors=false,legacy=false,leak=false,marketingUnavailable=false,
  stalePages=false,unsafeOrigin=false,edgeRedirect=false}={}){
 const calls=[];
 const fetcher=async(url,init={})=>{
  calls.push({url,init});
  const u=new URL(url);
  if(init.method==='OPTIONS')return new Response(null,{status:badCors?403:204,
    headers:badCors?{}:unsafeOrigin&&init.headers?.Origin==='https://untrusted.example'
      ?{...cors,'Access-Control-Allow-Origin':'https://untrusted.example'}:cors});
  if(edgeRedirect&&['/access/me','/marketing/spend','/marketing/spend/history'].includes(u.pathname))
    return new Response(null,{status:302,headers:{Location:'https://example.cloudflareaccess.com/login'}});
  if(u.pathname==='/access/me')return Response.json({enabled:!legacy},
    {status:legacy?200:401});
  if(u.pathname.startsWith('/marketing/spend'))return Response.json({error:'unauthorized'},
    {status:marketingUnavailable?503:401});
  if(u.pathname==='/sii/folio/33')return Response.json({error:'unauthorized'},{status:401});
  if(u.pathname==='/service/lead/anthropic/v1/messages')
    return Response.json({error:'Invalid Anthropic JSON body'},{status:400});
  if(url==='https://dashboard.thelab.solutions/')
    return new Response(leak?'test-secret-exposed-123456':stalePages?'Old bundle':
      '<div id="crmAcquisitionAuditCard">Contradicciones</div><input id="nl-primer-contacto">',
      {status:200});
  throw new Error('Unexpected network target: '+url);
 };
 return {fetcher,calls};
}
test('read-only probes verify CORS, unsigned rejection and signed machine validation',async()=>{
 const {checkAccessReadiness}=await import(script.href);
 const h=mock(),r=await checkAccessReadiness(cfg,h.fetcher);
 assert.equal(r.errors.length,0);
 assert.equal(r.ready,true);
 assert.ok(h.calls.some(c=>c.init.method==='OPTIONS'));
 assert.ok(h.calls.some(c=>c.url.endsWith('/service/lead/anthropic/v1/messages')));
 assert.ok(h.calls.every(c=>c.url.startsWith(cfg.proxyUrl)));
 assert.equal(h.calls.find(c=>c.url.includes('/sii/')).init.method,undefined);
});
test('unsafe CORS, disabled Access or missing machine proof block readiness',async()=>{
 const {checkAccessReadiness}=await import(script.href);
 assert.ok((await checkAccessReadiness(cfg,mock({badCors:true}).fetcher)).errors.length);
 assert.ok((await checkAccessReadiness(cfg,mock({legacy:true}).fetcher)).errors.length);
 assert.ok((await checkAccessReadiness({...cfg,serviceClientId:'',serviceClientSecret:''},mock().fetcher)).errors.length);
});
test('Reportes readiness checks marketing authorization and PUT CORS without any spending writes',async()=>{
 const {checkAccessReadiness}=await import(script.href);
 const h=mock(),r=await checkAccessReadiness({...cfg,stage:'reportes',
   serviceClientId:'',serviceClientSecret:''},h.fetcher);
 assert.equal(r.errors.length,0);
 assert.equal(r.ready,true);
 assert.ok(r.passed.some(x=>x.includes('Marketing spend CORS')));
 assert.equal(h.calls.filter(c=>c.url.includes('/marketing/spend')&&c.init.method==='GET').length,2);
 assert.ok(h.calls.some(c=>c.url.includes('/marketing/spend')&&c.init.method==='OPTIONS'));
 assert.ok(h.calls.some(c=>c.url==='https://dashboard.thelab.solutions/'&&c.init.method==='GET'));
 assert.ok(r.passed.some(x=>x.includes('Published Pages bundle')));
 assert.ok(r.passed.some(x=>x.includes('untrusted origin')));
 assert.ok(h.calls.every(c=>!['PUT','POST','PATCH','DELETE'].includes(c.init.method)));
 assert.ok(h.calls.every(c=>!c.url.includes('/sii/')&&!c.url.includes('/service/lead/')));
});
test('Reportes readiness refuses legacy marketing mode and cross-site Worker hostname',async()=>{
 const {checkAccessReadiness}=await import(script.href);
 const denied=await checkAccessReadiness({...cfg,stage:'reportes'},mock({marketingUnavailable:true}).fetcher);
 assert.match(denied.errors.join(' '),/Unsigned marketing request was not denied/);
 const h=mock();
 const wrong=await checkAccessReadiness({...cfg,stage:'reportes',
   proxyUrl:'https://airtable-proxy.wast3dspa.workers.dev'},h.fetcher);
 assert.match(wrong.errors.join(' '),/same-site/);
 assert.equal(h.calls.length,0);
});
test('Reportes readiness rejects stale Pages bundles and credentialed hostile-origin CORS',async()=>{
 const {checkAccessReadiness}=await import(script.href);
 const old=await checkAccessReadiness({...cfg,stage:'reportes'},mock({stalePages:true}).fetcher);
 assert.match(old.errors.join(' '),/Published dashboard/);
 const hostile=await checkAccessReadiness({...cfg,stage:'reportes'},mock({unsafeOrigin:true}).fetcher);
 assert.match(hostile.errors.join(' '),/Untrusted origin/);
});
test('Cloudflare edge redirects remain inconclusive until Worker-origin auth is proved',async()=>{
 const {checkAccessReadiness}=await import(script.href);
 const r=await checkAccessReadiness({...cfg,stage:'reportes'},mock({edgeRedirect:true}).fetcher);
 assert.equal(r.errors.length,0);
 assert.equal(r.ready,false);
 assert.ok(r.manual.length>1);
 const src=fs.readFileSync(path.join(__dirname,'../scripts/access-readiness.mjs'),'utf8');
 assert.match(src,/process\.env\.STAGE==='reportes'&&result\.manual\.length>1/);
});
test('unapproved proxy URLs do not receive service credentials',async()=>{
 const {checkAccessReadiness}=await import(script.href);
 const h=mock();
 const r=await checkAccessReadiness({...cfg,proxyUrl:'https://evil.example'},h.fetcher);
 assert.ok(r.errors.length);
 assert.equal(h.calls.length,0);
});
test('post-cutover requires both SII cutover gates before exposure checks can pass',async()=>{
 const {checkAccessReadiness}=await import(script.href);
 const base={...cfg,stage:'post',siiAccessMode:'true',
   siiWorkerKey:'sii-master-test-123456',portalAdminKey:'portal-master-test-123456',
   printerTunnelToken:'printer-master-test-123456'};
 const missing=await checkAccessReadiness(base,mock().fetcher);
 assert.match(missing.errors.join(' '),/SII_CUTOVER_VERIFIED/);
 const verified=await checkAccessReadiness({...base,siiCutoverVerified:'true'},mock().fetcher);
 assert.equal(verified.errors.length,0);
});
test('post-cutover catches any leaked browser master secret in published HTML',async()=>{
 const {checkAccessReadiness}=await import(script.href);
 const base={...cfg,stage:'post',siiAccessMode:'true',siiCutoverVerified:'true',
   proxyKey:'proxy-master-test-123456',
   siiWorkerKey:'test-secret-exposed-123456',
   portalAdminKey:'portal-master-test-123456',
   printerTunnelToken:'printer-master-test-123456'};
 const sii=await checkAccessReadiness(base,mock({leak:true}).fetcher);
 assert.match(sii.errors.join(' '),/still contains SII_WORKER_KEY/);

 const proxySecret='proxy-master-test-123456';
 const h=mock();
 const fetcher=async(url,init={})=>{
   if(url==='https://dashboard.thelab.solutions/')
     return new Response('<html>'+proxySecret+'</html>',{status:200});
   return h.fetcher(url,init);
 };
 const proxy=await checkAccessReadiness({...base,proxyKey:proxySecret},fetcher);
 assert.match(proxy.errors.join(' '),/still contains PROXY_KEY/);
});
test('post-cutover exposure scan fails closed when an original master is unavailable',async()=>{
 const {checkAccessReadiness}=await import(script.href);
 const r=await checkAccessReadiness({...cfg,stage:'post',siiAccessMode:'true',
   siiWorkerKey:'sii-master-test-123456',
   portalAdminKey:'portal-master-test-123456',
   printerTunnelToken:''},mock().fetcher);
 assert.match(r.errors.join(' '),/Original master secrets required/);
 assert.match(r.errors.join(' '),/PRINTER_TUNNEL_TOKEN/);
});
test('manual GitHub workflow performs no writes to Airtable or SII',()=>{
 const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/access-readiness.yml'),'utf8');
 assert.match(workflow,/workflow_dispatch/);
 assert.doesNotMatch(workflow,/schedule:|push:|wrangler deploy|wrangler secret put/);
 assert.match(workflow,/node scripts\/access-readiness\.mjs/);
});
