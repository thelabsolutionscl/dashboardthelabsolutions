'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const os=require('os'),fs=require('fs'),path=require('path');
const {spawnSync}=require('child_process');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'farm-auth-'));
process.env.FARM_DATA_DIR=tmp;process.env.FARM_SESSION_SECRET='test-secret-0123456789';process.env.BRIDGE_ADMIN_TOKEN='adm';process.env.BRIDGE_OPERATOR_TOKEN='op';process.env.BRIDGE_VIEWER_TOKEN='view';
const auth=require('../printer-bridge/farm-auth-preload.js');

test('sesión válida conserva rol y caduca',()=>{
  const token=auth.mintSession({role:'operator',sub:'a@b.cl',ttlSec:60,now:1000});
  const ok=auth.verifySession(token,{now:1020,secret:'test-secret-0123456789'});assert.equal(ok.ok,true);assert.equal(ok.role,'operator');
  assert.equal(auth.verifySession(token,{now:1200,secret:'test-secret-0123456789'}).ok,false);
});
test('firma manipulada se rechaza y roles mapean a token local',()=>{
  const token=auth.mintSession({role:'viewer'});const bad=token.slice(0,-1)+(token.endsWith('a')?'b':'a');assert.equal(auth.verifySession(bad).ok,false);
  assert.equal(auth.localTokenForRole('viewer'),'view');assert.equal(auth.localTokenForRole('operator'),'op');assert.equal(auth.localTokenForRole('admin'),'adm');
});
test('bt de sesión corta se elimina antes del controller',()=>{
  const t=auth.mintSession({role:'viewer'});const out=auth.stripSessionQuery('/farm/health?bt='+encodeURIComponent(t)+'&x=1');assert.equal(out,'/farm/health?x=1');
  assert.equal(auth.stripSessionQuery('/farm/health?bt=legacy'),'/farm/health?bt=legacy');
});
test('sin tokens preconfigurados se generan admin/operator/viewer distintos en FARM_DATA_DIR y se propaga BRIDGE_TOKEN',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'farm-auth-rbac-'));
  const script=`const a=require(${JSON.stringify(path.resolve(__dirname,'../printer-bridge/farm-auth-preload.js'))});console.log(JSON.stringify({admin:a.localTokenForRole('admin'),operator:a.localTokenForRole('operator'),viewer:a.localTokenForRole('viewer'),ae:process.env.BRIDGE_ADMIN_TOKEN,be:process.env.BRIDGE_TOKEN,oe:process.env.BRIDGE_OPERATOR_TOKEN,ve:process.env.BRIDGE_VIEWER_TOKEN}))`;
  const env={...process.env,FARM_DATA_DIR:dir,FARM_SESSION_SECRET:'child-test-secret'};
  delete env.BRIDGE_ADMIN_TOKEN;delete env.BRIDGE_OPERATOR_TOKEN;delete env.BRIDGE_VIEWER_TOKEN;delete env.BRIDGE_TOKEN;
  const r=spawnSync(process.execPath,['-e',script],{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  const d=JSON.parse(r.stdout.trim());assert.ok(d.admin);assert.ok(d.operator);assert.ok(d.viewer);assert.notEqual(d.operator,d.admin);assert.notEqual(d.viewer,d.admin);assert.notEqual(d.viewer,d.operator);assert.equal(d.ae,d.admin);assert.equal(d.be,d.admin);assert.equal(d.oe,d.operator);assert.equal(d.ve,d.viewer);
  for(const f of['bridge-admin-token','bridge-operator-token','bridge-viewer-token'])assert.equal(fs.statSync(path.join(dir,f)).mode&0o777,0o600);
});
test('admin preconfigurado también se propaga como BRIDGE_TOKEN a preloads heredados',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'farm-auth-admin-env-'));
  const script=`require(${JSON.stringify(path.resolve(__dirname,'../printer-bridge/farm-auth-preload.js'))});console.log(process.env.BRIDGE_TOKEN||'')`;
  const env={...process.env,FARM_DATA_DIR:dir,FARM_SESSION_SECRET:'child-test-secret',BRIDGE_ADMIN_TOKEN:'admin-only'};delete env.BRIDGE_TOKEN;delete env.BRIDGE_OPERATOR_TOKEN;delete env.BRIDGE_VIEWER_TOKEN;
  const r=spawnSync(process.execPath,['-e',script],{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'admin-only');
});
