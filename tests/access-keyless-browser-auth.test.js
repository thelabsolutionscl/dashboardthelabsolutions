#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/worker.js'),'utf8')
  .replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const worker=');

let mode='signed';
global.accessAuthorize=async()=>mode==='signed'
  ?{identity:{email:'admin@example.com',role:'admin'}}
  :{legacy:true};
const worker=new Function(source+'\nreturn worker;')();
const env={APP_KEY:'legacy-browser-secret'};
const origin='https://dashboard.thelab.solutions';
const req=(key)=>new Request('https://proxy.example.com/access/me',{
  method:'GET',headers:{Origin:origin,...(key?{'X-App-Key':key}:{})}
});

test('signed Cloudflare Access browser does not need the shared APP_KEY',async()=>{
  mode='signed';
  const r=await worker.fetch(req(),env,{waitUntil(){}});
  assert.equal(r.status,200,await r.clone().text());
  const body=await r.json();
  assert.equal(body.authenticated,true);
  assert.equal(body.role,'admin');
});

test('legacy browser still requires the exact APP_KEY',async()=>{
  mode='legacy';
  let r=await worker.fetch(req(),env,{waitUntil(){}});
  assert.equal(r.status,403);
  r=await worker.fetch(req('wrong'),env,{waitUntil(){}});
  assert.equal(r.status,403);
  r=await worker.fetch(req(env.APP_KEY),env,{waitUntil(){}});
  assert.equal(r.status,200,await r.clone().text());
  const body=await r.json();
  assert.equal(body.enabled,false);
  assert.equal(body.authenticated,false);
});

test('APP_KEY check is structurally gated by authorized.legacy',()=>{
  assert.match(source,/authorized\.legacy[^\n]*!leadServiceRoute[^\n]*!visualServiceRoute/);
  assert.doesNotMatch(source,/if \(!leadServiceRoute && !visualServiceRoute && \(!appKey \|\| appKey !== env\.APP_KEY\)\)/);
});
