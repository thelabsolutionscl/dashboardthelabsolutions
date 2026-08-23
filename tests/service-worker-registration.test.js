'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

test('service worker se registra con build versionado',()=>{
  assert.match(html,/serviceWorker\.register\('sw\.js\?v=%%BUILD%%'/);
});

test('deploy estampa el mismo build en index y service worker',()=>{
  const workflow=fs.readFileSync(path.join(__dirname,'..','.github','workflows','deploy.yml'),'utf8');
  assert.match(workflow,/s\|%%BUILD%%\|\$\{GITHUB_SHA::8\}\|g" index\.html sw\.js/);
});
