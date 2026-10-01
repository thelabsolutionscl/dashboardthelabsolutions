#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const finance=fs.readFileSync(path.join(__dirname,'../js/finanzas.js'),'utf8');
const from=finance.indexOf('function _siiAccessMode()');
const to=finance.indexOf('async function uploadCAF(',from);
assert.ok(from>0&&to>from,'SII proxy client helpers present');
const helpers=finance.slice(from,to);
const defaults={SII_WORKER_URL:'https://legacy-sii.workers.dev',SII_RUT_EMISOR:'123',SII_RAZON_SOCIAL:'TLS'};
function harness({secure=true,px={url:'https://proxy.thelab.solutions',key:'public-compat-key'},stored={webhookUrl:'https://legacy.workers.dev'}}={}){
  const calls=[];
  const source=helpers.replace("'%%SII_ACCESS_MODE%%'","'"+String(secure)+"'");
  const deps={
    _DEFAULTS:defaults,
    _proxyCfg:()=>px,
    localStorage:{getItem:()=>JSON.stringify(stored)},
    URL,fetch:async(url,options)=>{calls.push({url,options});return Response.json({ok:true});}
  };
  const api=new Function(...Object.keys(deps),source+'\nreturn {_siiAccessMode,_siiProxyConfig,_siiLoginUrl,_siiRequest,getSIICfg};')(...Object.values(deps));
  return{api,calls};
}
test('secure mode ignores an old SII URL saved in browser storage',()=>{
  const x=harness();
  assert.equal(x.api._siiAccessMode(),true);
  assert.equal(x.api.getSIICfg().webhookUrl,'https://proxy.thelab.solutions/sii');
  assert.equal(x.api.getSIICfg().secureProxy,true);
});
test('secure SII requests use proxy route, cookie and no worker master secret',async()=>{
  const x=harness();
  await x.api._siiRequest('/emit',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(x.calls.length,1);
  assert.equal(x.calls[0].url,'https://proxy.thelab.solutions/sii/emit');
  assert.equal(x.calls[0].options.credentials,'include');
  assert.equal(x.calls[0].options.redirect,'error');
  assert.equal(x.calls[0].options.headers['X-App-Key'],'public-compat-key');
  assert.equal(x.calls[0].options.headers['X-Worker-Key'],undefined);
});
test('secure mode never fails over to direct SII on missing proxy',async()=>{
  const x=harness({px:null});
  assert.equal(x.api.getSIICfg().webhookUrl,'');
  await assert.rejects(()=>x.api._siiRequest('/emit',{method:'POST'}),/Proxy seguro no configurado/);
  assert.equal(x.calls.length,0);
});
test('client rejects arbitrary SII paths, query strings and non-TLS transport',async()=>{
  const x=harness();
  await assert.rejects(()=>x.api._siiRequest('/access/session'),/Ruta SII no autorizada/);
  await assert.rejects(()=>x.api._siiRequest('/emit?next=https://evil.example'),/Ruta SII no autorizada/);
  const bad=harness({px:{url:'http://localhost:8787',key:'x'}});
  await assert.rejects(()=>bad.api._siiRequest('/emit'),/URL del proxy seguro es inválida/);
  assert.equal(x.calls.length,0);
});
test('legacy behavior remains unchanged until deliberate deployment flag',()=>{
  const x=harness({secure:false,stored:{webhookUrl:'https://legacy.example.workers.dev'}});
  assert.equal(x.api.getSIICfg().secureProxy,false);
  assert.equal(x.api.getSIICfg().webhookUrl,'https://legacy.example.workers.dev');
});
test('Pages deployment only removes public SII key when secure rollout is enabled',()=>{
  const deploy=fs.readFileSync(path.join(__dirname,'../.github/workflows/deploy.yml'),'utf8');
  assert.match(deploy,/vars\.SII_ACCESS_MODE/);
  assert.match(deploy,/s\|%%SII_WORKER_KEY%%\|\|g/);
  assert.match(deploy,/s\|%%SII_ACCESS_MODE%%\|true\|g/);
  assert.match(deploy,/s\|%%SII_ACCESS_MODE%%\|false\|g/);
  const wired=finance.slice(finance.indexOf('async function emitirDTE()'),finance.indexOf('function openSIIConfigModal()'));
  assert.match(wired,/_siiRequest\('\/emit'/);
  assert.match(wired,/cfg\.secureProxy/);
  assert.match(wired,/siiHeaders/,'legacy path remains until controlled migration');
});
