#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const deploy=fs.readFileSync(path.join(__dirname,'../.github/workflows/deploy.yml'),'utf8');
const start=deploy.indexOf('            if [ "${SII_CUTOVER_VERIFIED}" != "true" ]; then');
const end=deploy.indexOf('            # Nunca publicar la clave fiscal',start);
assert.ok(start>0&&end>start,'SII cutover guard must execute before touching the published HTML');
const guard=deploy.slice(start,end);

function check(vars){
  const r=spawnSync('bash',['-eu','-c',guard],{
    encoding:'utf8',
    env:{PATH:process.env.PATH,SII_CUTOVER_VERIFIED:'true',
      PROXY_URL:'https://proxy.thelab.solutions',...vars}
  });
  return{code:r.status,output:r.stdout+r.stderr};
}
test('SII deployment has an independent, opt-in second verification gate',()=>{
  assert.match(deploy,/SII_CUTOVER_VERIFIED:\s*\$\{\{ vars\.SII_CUTOVER_VERIFIED \}\}/);
  assert.ok(deploy.indexOf('if [ "${SII_CUTOVER_VERIFIED}"')>deploy.indexOf('if [ "${SII_ACCESS_MODE}" = "true" ]'));
  assert.ok(deploy.indexOf('if [ "${SII_CUTOVER_VERIFIED}"')<deploy.indexOf('sed -i "s|%%SII_WORKER_KEY%%||g"'));
});
test('validated proxy on same-site HTTPS subdomain passes',()=>{
  assert.equal(check({}).code,0);
  assert.equal(check({PROXY_URL:'https://api.thelab.solutions/'}).code,0);
});
test('unset or false verification fails closed before manipulating any secrets',()=>{
  for(const v of ['', 'false','TRUE'])assert.notEqual(check({SII_CUTOVER_VERIFIED:v}).code,0);
});
test('cross-site cookies and hostile proxy URLs cannot pass the SII cutover',()=>{
  for(const u of ['http://proxy.thelab.solutions',
    'https://airtable-proxy.account.workers.dev',
    'https://proxy.thelab.solutions.evil.example',
    'https://proxy.thelab.solutions:443',
    'https://proxy.thelab.solutions/path',
    'https://proxy.thelab.solutions/?return=evil',
    'https://user@proxy.thelab.solutions',
    ''])assert.notEqual(check({PROXY_URL:u}).code,0,u);
});
test('verified SII cutover removes fiscal key; legacy path remains until explicit approval',()=>{
  const secure=deploy.indexOf('if [ "${SII_ACCESS_MODE}" = "true" ]; then');
  const scrub=deploy.indexOf('sed -i "s|%%SII_WORKER_KEY%%||g" index.html',secure);
  const fallback=deploy.indexOf('if [ -n "${SII_WORKER_KEY}" ]; then',scrub);
  assert.ok(secure>0&&scrub>secure&&fallback>scrub,'secure mode scrubs the key, legacy path remains separate');
  assert.ok(deploy.indexOf('sed -i "s|%%SII_ACCESS_MODE%%|true|g" js/finanzas.js',scrub)>scrub);
});
