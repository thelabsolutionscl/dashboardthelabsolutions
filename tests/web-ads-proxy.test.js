#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const ADS=fs.readFileSync(path.join(ROOT,'js','seo-ads.js'),'utf8');
const WORKER=fs.readFileSync(path.join(ROOT,'airtable-proxy','src','worker.js'),'utf8');
const AUTH=fs.readFileSync(path.join(ROOT,'airtable-proxy','src','access-auth.js'),'utf8');
const WRANGLER=fs.readFileSync(path.join(ROOT,'airtable-proxy','wrangler.toml'),'utf8');

test('el bundle público no contiene webhook ni clave de Make',()=>{
  assert.doesNotMatch(ADS,/hook\.[a-z0-9-]+\.make\.com/i);
  assert.doesNotMatch(ADS,/ADS_MAKE_SHELL|tl-cascaron/i);
  assert.match(ADS,/\/ads\/campaign-shell/);
});

test('el proxy contiene la única ruta de creación de cascarón y valida host Make',()=>{
  assert.match(WORKER,/url\.pathname==='\/ads\/campaign-shell'/);
  assert.match(WORKER,/idFromName\('tls-ads-shell-global'\)/);
  assert.match(WORKER,/path==='\/ads-shell'/);
  assert.match(WORKER,/ADS_MAKE_SHELL_URL/);
  assert.match(WORKER,/ADS_MAKE_SHELL_KEY/);
  assert.match(WORKER,/\^hook\\\.[a-z0-9-]\+\\\.make\\\.com\$/i);
  assert.match(WORKER,/redirect:'manual'/);
});

test('el cascarón es idempotente por mutationId antes de llamar a Make',()=>{
  const start=WORKER.indexOf('async _handleAdsShell(request)');
  const end=WORKER.indexOf('async _handleSharedCalendar(request)',start);
  assert.ok(start>=0&&end>start);
  const body=WORKER.slice(start,end);
  const get=body.indexOf("this.state.storage.get(key)");
  const fetchPos=body.indexOf("fetch(endpoint.toString()");
  const put=body.indexOf("this.state.storage.put(key");
  assert.ok(get>=0&&fetchPos>get&&put>fetchPos);
  assert.match(body,/if\(prior\?\.ok\)return this\._json\(\{ok:true,reused:true/);
  assert.match(body,/ADS_SHELL_UNCERTAIN/);
});

test('RBAC de Ads es explícito y la tabla de snapshots de campañas está catalogada',()=>{
  assert.match(AUTH,/path==='\/ads\/campaign-shell'\)return method==='POST'&&\(operator\|\|finance\|\|admin\)/);
  assert.ok((AUTH.match(/Google_Ads_Campanas/g)||[]).length>=2);
  assert.match(WRANGLER,/ADS_MAKE_SHELL_URL/);
  assert.match(WRANGLER,/ADS_MAKE_SHELL_KEY/);
});
