#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const start=html.indexOf('function _proxyCredentials(url){');
const end=html.indexOf('function _atHttp(path,opts={}){',start);
assert.ok(start>0&&end>start,'Proxy cookie helper and Airtable fetch wrapper must exist');
const fragment=html.slice(start,end);
function harness(proxyUrl='https://proxy.thelab.solutions'){
  const calls=[],px={url:proxyUrl,key:'test-key'};
  const make=new Function('_proxyCfg','_airtableConfig','window','fetch','location','URL',
    fragment+'\nreturn {_proxyCredentials,_atFetch};');
  const api=make(()=>px,()=>({base:proxyUrl,headers:{'X-App-Key':px.key}}),
    {_DEMO_MODE:false},async(url,options)=>{calls.push({url,options});return new Response('{}')},
    {href:'https://dashboard.thelab.solutions/'},URL);
  return {...api,calls};
}
test('Airtable GET/POST attach Access cookies only when calling proxy',async()=>{
  const h=harness();
  await h._atFetch('/app1YtD74AqiPWQhy/Pedidos');
  await h._atFetch('/app1YtD74AqiPWQhy/Facturas',{method:'POST',body:'{}'});
  assert.equal(h.calls.length,2);
  assert.ok(h.calls.every(x=>x.options.credentials==='include'));
  assert.ok(h.calls.every(x=>x.options.headers['X-App-Key']==='test-key'));
});
test('cookie scope rejects external domains, fake subdomains and similar prefixes',()=>{
  const h=harness('https://proxy.thelab.solutions/api');
  assert.equal(h._proxyCredentials('https://proxy.thelab.solutions/api/v0/app'), 'include');
  for(const target of [
    'https://api.airtable.com/v0/app',
    'https://proxy.thelab.solutions.evil.example/api/v0/app',
    'https://proxy.thelab.solutions/api-bypass/v0/app',
    'https://another.example.com/api/v0/app'
  ])assert.equal(h._proxyCredentials(target),'same-origin',target);
});
test('uncustomized direct Airtable requests do not receive Access credentials',()=>{
  const h=harness();
  assert.equal(h._proxyCredentials('https://api.airtable.com/v0/app'),'same-origin');
});
test('timeout/retry HTTP wrapper and Claude helper include cookie scoping',()=>{
  assert.match(html,/function airtableHttp\([\s\S]*?fetch\(url,\{\.\.\.opts,credentials:opts\.credentials\|\|_proxyCredentials\(url\),signal:ctrl\.signal\}/);
  assert.match(html,/function _claudeHttp\([\s\S]*?fetch\(url,\{\.\.\.opts,credentials:opts\.credentials\|\|_proxyCredentials\(url\),signal:ctrl\.signal\}/);
});
test('KAI, IA usage and OpenAI image requests keep Access session cookies',()=>{
  const kai=fs.readFileSync(path.join(root,'js/kai.js'),'utf8');
  const cost=fs.readFileSync(path.join(root,'js/ai-cost-control.js'),'utf8');
  const pdf=fs.readFileSync(path.join(root,'js/pdf-fichas.js'),'utf8');
  assert.match(kai,/fetch\(px\.url\+'\/anthropic\/v1\/messages',\{ method:'POST', credentials:'include'/);
  assert.match(cost,/fetch\(px\.url\.replace\([\s\S]*?'\/anthropic\/usage',\{\s*method:'GET',credentials:'include'/);
  assert.match(pdf,/fetch\(px\.url\.replace\([\s\S]*?'\/openai'\+path,\{method,credentials:'include'/);
});
