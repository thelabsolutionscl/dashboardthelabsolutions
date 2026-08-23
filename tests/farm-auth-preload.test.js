'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const os=require('os'),fs=require('fs'),path=require('path');
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
