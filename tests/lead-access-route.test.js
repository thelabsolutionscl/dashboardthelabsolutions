#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/worker.js'),'utf8');
const servicePath='/service/lead/anthropic/v1/messages';
test('service-only route uses same Anthropic cost guard without generic proxy',()=>{
 assert.ok(src.includes("leadServiceRoute=url.pathname==='"+servicePath+"'"));
 assert.ok(src.includes("if (url.pathname === '/anthropic/v1/messages' || leadServiceRoute)"));
 assert.ok(src.includes("reserveAiBudget(env, payload, source)"));
 assert.ok(src.includes("const source = leadServiceRoute?'lead-worker'"));
});
let pass=true;
const srcEval=src.replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const worker =');
const proxy=new Function('accessAuthorize',srcEval+'\nreturn worker;')(async(req,env,path)=>{
 if(path===servicePath)return pass?{serviceIdentity:{role:'lead-service'}}:
 {response:Response.json({error:'denied'},{status:401})};
 return {legacy:true};
});
const req=(p)=>new Request('https://proxy.example.com'+p,{method:'POST',body:'{}'});
test('machine requests work without Origin and browser APP_KEY when service JWT is valid',async()=>{
 pass=false;
 assert.equal((await proxy.fetch(req(servicePath),{})).status,401);
 pass=true;
 const response=await proxy.fetch(req(servicePath),{});
 assert.equal(response.status,500);
 assert.match((await response.json()).error,/ANTHROPIC_TOKEN/);
});
test('no query-string bypass and browser route still requires Origin',async()=>{
 assert.equal((await proxy.fetch(req(servicePath+'?redirect=1'),{})).status,400);
 assert.equal((await proxy.fetch(req('/anthropic/v1/messages'),{APP_KEY:'test'})).status,403);
});
