#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const deploy=fs.readFileSync(path.join(root,'.github/workflows/deploy.yml'),'utf8');
const worker=fs.readFileSync(path.join(root,'airtable-proxy/src/worker.js'),'utf8');

function fn(source,name){
  const start=source.search(new RegExp('function\\s+'+name+'\\s*\\('));
  assert.ok(start>=0,'missing '+name);
  const open=source.indexOf('{',start);let depth=0;
  for(let i=open;i<source.length;i++){
    if(source[i]==='{')depth++;
    if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error('unterminated '+name);
}

test('browser Access mode has an explicit build flag and no real compatibility key requirement',()=>{
  assert.match(html,/ACCESS_BROWSER_MODE:'%%ACCESS_BROWSER_MODE%%'/);
  const p=fn(html,'_proxyCfg');
  assert.match(p,/ACCESS_BROWSER_MODE/);
  assert.match(p,/key:'access-session',access:true/);
  assert.match(p,/localStorage\.removeItem\('proxy_key'\)/);
  assert.match(p,/sessionStorage\.removeItem\('proxy_key'\)/);
  const at=fn(html,'_airtableConfig');
  assert.match(at,/const px=_proxyCfg\(\)/);
  assert.match(at,/if\(px\?\.url\)/);
});

test('deploy cannot enable keyless browser mode without explicit verified cutover',()=>{
  assert.match(deploy,/ACCESS_BROWSER_MODE: \$\{\{ vars\.ACCESS_BROWSER_MODE \}\}/);
  assert.match(deploy,/ACCESS_CUTOVER_VERIFIED: \$\{\{ vars\.ACCESS_CUTOVER_VERIFIED \}\}/);
  assert.match(deploy,/ACCESS_BROWSER_MODE.*= "true"[\s\S]*ACCESS_CUTOVER_VERIFIED.*!= "true"/);
  assert.match(deploy,/Browser Access requiere proxy HTTPS same-site/);
  assert.match(deploy,/s\|%%PROXY_KEY%%\|\|g/);
  assert.match(deploy,/s\|%%ACCESS_BROWSER_MODE%%\|true\|g/);
  assert.match(deploy,/PROXY_KEY es obligatorio mientras el navegador siga en modo legacy/);
});

test('signed Access is evaluated before APP_KEY and only legacy mode enforces the shared key',()=>{
  const auth=worker.slice(worker.indexOf('// Cloudflare Access is the browser identity after cutover'),
    worker.indexOf("if(url.pathname==='/access/me')"));
  assert.ok(auth.length>500);
  assert.ok(auth.indexOf('accessAuthorize(request,env,authPath)')<auth.indexOf("request.headers.get('X-App-Key')"));
  assert.match(auth,/authorized\.legacy/);
  assert.match(auth,/appKey!==env\.APP_KEY/);
});

test('user menu does not persist a proxy master key after browser Access cutover',()=>{
  const save=fn(html,'saveUserMenuProxy');
  assert.match(save,/ACCESS_BROWSER_MODE/);
  assert.match(save,/localStorage\.removeItem\('proxy_key'\)/);
  assert.match(save,/sessionStorage\.removeItem\('proxy_key'\)/);
  assert.match(save,/Cloudflare Access/);
});
