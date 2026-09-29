#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../lead-worker/src/index.js'),'utf8');
const begin=source.indexOf('const CLAUDE_ALLOWED_MODELS = new Set([');
const end=source.indexOf('// Firma HTML',begin);
assert.ok(begin>0&&end>begin);
const code=source.slice(begin,end);
function setup(){
 const calls=[];
 const fetch=async(url,options)=>{
   calls.push({url,options});
   return Response.json({id:'msg-test',model:'haiku',usage:{input_tokens:1,output_tokens:1},
     content:[{type:'text',text:'ok'}]});
 };
 const callClaude=new Function('fetch','console',code+'\nreturn callClaude;')(fetch,{info(){}});
 return {callClaude,calls};
}
const proxyUrl='https://airtable-proxy.wast3dspa.workers.dev';
const secure={AI_PROXY_URL:proxyUrl,AI_ACCESS_MODE:'true',
 CF_ACCESS_CLIENT_ID:'lead-machine-123.access',CF_ACCESS_CLIENT_SECRET:'test-secret'};
test('Access service token stays server-side and uses isolated Claude route',async()=>{
 const h=setup();
 assert.equal(await h.callClaude(secure,'rules','text'), 'ok');
 assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].url,proxyUrl+'/service/lead/anthropic/v1/messages');
 const headers=h.calls[0].options.headers;
 assert.equal(headers['CF-Access-Client-Id'],secure.CF_ACCESS_CLIENT_ID);
 assert.equal(headers['CF-Access-Client-Secret'],secure.CF_ACCESS_CLIENT_SECRET);
 assert.equal(headers['X-App-Key'],undefined);
 assert.equal(headers.Origin,undefined);
});
test('legacy lead processing still works before coordinated Access rollout',async()=>{
 const h=setup();
 await h.callClaude({AI_PROXY_URL:proxyUrl,AI_PROXY_KEY:'legacy-test'},'rules','text');
 assert.equal(h.calls[0].url,proxyUrl+'/anthropic/v1/messages');
 assert.equal(h.calls[0].options.headers['X-App-Key'],'legacy-test');
});
test('partial secrets or non-approved host fail closed instead of falling back',async()=>{
 const h=setup();
 await assert.rejects(()=>h.callClaude({...secure,CF_ACCESS_CLIENT_SECRET:''},'s','u'),/no configurado/);
 await assert.rejects(()=>h.callClaude({...secure,AI_PROXY_URL:'https://evil.example'},'s','u'),/no autorizado/);
 assert.equal(h.calls.length,0);
});
