#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
test('Wrangler preserves manually configured Access variables on automatic redeploy',()=>{
 for(const worker of ['airtable-proxy','lead-worker']){
  const toml=fs.readFileSync(path.join(root,worker,'wrangler.toml'),'utf8');
  const top=toml.split('[vars]')[0];
  assert.match(top,/^keep_vars\s*=\s*true$/m,worker+' must retain Access settings');
  assert.doesNotMatch(toml,/(CF_ACCESS_CLIENT_SECRET|SII_WORKER_KEY)\s*=/,
    'Credentials are configured as Cloudflare encrypted secrets only');
 }
});
test('lead-worker uses a dedicated opt-in identity and supports existing work until activation',()=>{
 const s=fs.readFileSync(path.join(root,'lead-worker/src/index.js'),'utf8');
 assert.match(s,/AI_ACCESS_MODE==="true"/);
 assert.match(s,/leadAiProxyConfigured\(env\)/);
 assert.match(s,/CF-Access-Client-Id/);
 assert.match(s,/CF-Access-Client-Secret/);
 assert.match(s,/service\/lead\/anthropic\/v1\/messages/);
});
