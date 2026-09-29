#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const code=fs.readFileSync(path.join(root,'airtable-proxy/src/worker.js'),'utf8')
  .replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const wk =');
let identity=null;
const origFetch=global.fetch;
global.accessAuthorize=async(req,env,path)=>{
  if(!identity)return {legacy:true};
  if(path.startsWith('/portal-admin/')&&
     !(identity.role==='admin'||(path==='/portal-admin/link'&&['operator','finance'].includes(identity.role))))
    return {response:Response.json({error:'Insufficient role'},{status:403})};
  return {identity};
};
const worker=new Function(code+'\nreturn wk;')();
const env={APP_KEY:'public-compat-key',PORTAL_ADMIN_KEY:'private-backend-master-123456789',
  LEAD_WORKER_URL:'https://thelab-leads-worker.wast3dspa.workers.dev/'};
const id='recCL0000000000A1';
const req=(route,body={clienteId:id})=>new Request('https://proxy.example.com'+route,{
  method:'POST',headers:{Origin:'https://dashboard.thelab.solutions',
    'X-App-Key':env.APP_KEY,'Content-Type':'application/json'},
  body:JSON.stringify(body)
});
const calls=[];
function spy(upstream=Response.json({ok:true,url:'https://portal.thelab.solutions/portal?t=test'})){
  calls.length=0;
  global.fetch=async(url,options)=>{calls.push({url:String(url),options});return upstream;};
}
test.after(()=>{global.fetch=origFetch;});
test('legacy APP_KEY alone cannot mint or revoke portal links',async()=>{
  identity=null;spy();
  for(const p of ['/portal-admin/link','/portal-admin/revocar']){
    const r=await worker.fetch(req(p),env);
    assert.equal(r.status,503);
  }
  assert.equal(calls.length,0);
});
test('operator links are forwarded only to official lead Worker with server-held secret',async()=>{
  identity={email:'sales@example.com',role:'operator'};spy();
  const r=await worker.fetch(req('/portal-admin/link',{clienteId:id,dias:30}),env);
  assert.equal(r.status,200);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,env.LEAD_WORKER_URL+'portal/link');
  assert.equal(calls[0].options.headers['X-Portal-Admin-Key'],env.PORTAL_ADMIN_KEY);
  assert.equal(calls[0].options.redirect,'manual');
  assert.deepEqual(JSON.parse(calls[0].options.body),{clienteId:id,dias:30});
  const output=await r.text();
  assert.equal(output.includes(env.PORTAL_ADMIN_KEY),false);
  assert.equal(r.headers.get('Cache-Control'),'no-store');
});
test('only admin can revoke and missing role never reaches backend',async()=>{
  spy();identity={email:'sales@example.com',role:'operator'};
  assert.equal((await worker.fetch(req('/portal-admin/revocar'),env)).status,403);
  assert.equal(calls.length,0);
  identity={email:'owner@example.com',role:'admin'};
  const r=await worker.fetch(req('/portal-admin/revocar'),env);
  assert.equal(r.status,200);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,env.LEAD_WORKER_URL+'portal/revocar');
});
test('bad route, method, arbitrary query and untrusted hosts are denied',async()=>{
  spy();identity={email:'owner@example.com',role:'admin'};
  for(const p of ['/portal-admin/else','/portal-admin/link?next=https://evil.example']){
    assert.equal((await worker.fetch(req(p),env)).status,404);
  }
  for(const host of ['https://evil.example/','https://thelab-leads-worker.evil.example/',
     'http://thelab-leads-worker.wast3dspa.workers.dev/',
     'https://thelab-leads-worker.wast3dspa.workers.dev/portal/']){
    const r=await worker.fetch(req('/portal-admin/link'),{...env,LEAD_WORKER_URL:host});
    assert.equal(r.status,503,host);
  }
  assert.equal(calls.length,0);
});
test('bad records, expiry, extra properties, oversize JSON and missing secret fail closed',async()=>{
  identity={email:'owner@example.com',role:'admin'};spy();
  for(const body of [{clienteId:'recBad',dias:30},{clienteId:id,dias:999},
    {clienteId:id,dias:'30'},{clienteId:id,backend_url:'https://evil.example'}]){
    assert.equal((await worker.fetch(req('/portal-admin/link',body),env)).status,400);
  }
  assert.equal((await worker.fetch(req('/portal-admin/link'),{...env,PORTAL_ADMIN_KEY:''})).status,503);
  assert.equal(calls.length,0);
});
test('portal redirect and lost response are never retried with master credential',async()=>{
  identity={email:'owner@example.com',role:'admin'};
  spy(new Response(null,{status:302,headers:{Location:'https://evil.example/'}}));
  let r=await worker.fetch(req('/portal-admin/link'),env);
  assert.equal(r.status,502);
  assert.equal(calls.length,1);
  calls.length=0;
  global.fetch=async()=>{calls.push({});throw Error('network lost after write');};
  r=await worker.fetch(req('/portal-admin/revocar'),env);
  assert.equal(r.status,502);
  assert.equal(calls.length,1);
});
test('signed portal client flow cannot fall back to legacy Worker key',async()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const from=html.indexOf('function _portalAccessMode()');
  const to=html.indexOf('async function compartirPortalCliente(',from);
  assert.ok(from>0&&to>from);
  const src=html.slice(from,to).replace("'%%PORTAL_ACCESS_MODE%%'","'true'");
  const browserCalls=[],fallback='DO-NOT-SEND-BROWSER-MASTER';
  const mocks={
    _proxyCfg:()=>({url:'https://proxy.thelab.solutions',key:'public-compat-key'}),
    PORTAL_DIAS:30,
    _DEFAULTS:{LEAD_WORKER_URL:env.LEAD_WORKER_URL,PORTAL_ADMIN_KEY:fallback},
    fetch:async(url,options)=>{browserCalls.push({url,options});return Response.json({ok:true,url:'safe',expira:'tomorrow'});},
    URL,confirm:()=>true,toast:()=>{}
  };
  const api=new Function(...Object.keys(mocks),src+
    '\nreturn {portalLinkCliente,revocarPortalCliente,_portalSecureRequest};')(...Object.values(mocks));
  assert.equal((await api.portalLinkCliente(id)).url,'safe');
  await api.revocarPortalCliente(id,'Test');
  assert.equal(browserCalls.length,2);
  for(const c of browserCalls){
    assert.ok(c.url.startsWith('https://proxy.thelab.solutions/portal-admin/'));
    assert.equal(c.options.credentials,'include');
    assert.equal(c.options.redirect,'error');
    assert.equal(c.options.headers['X-Portal-Admin-Key'],undefined);
    assert.equal(JSON.stringify(c).includes(fallback),false);
  }
  const disabled=src.replace("return 'true'==='true'","return 'false'==='true'");
  assert.ok(disabled.includes("X-Portal-Admin-Key"),'legacy is preserved until opt-in');
});
test('Pages only omits public portal master key after explicit verified opt-in',()=>{
  const deploy=fs.readFileSync(path.join(root,'.github/workflows/deploy.yml'),'utf8');
  assert.match(deploy,/vars\.PORTAL_ACCESS_MODE/);
  assert.match(deploy,/vars\.PORTAL_CUTOVER_VERIFIED/);
  assert.match(deploy,/s\|%%PORTAL_ADMIN_KEY%%\|\|g/);
  assert.match(deploy,/s\|%%PORTAL_ACCESS_MODE%%\|true\|g/);
  assert.match(deploy,/s\|%%PORTAL_ACCESS_MODE%%\|false\|g/);
});
