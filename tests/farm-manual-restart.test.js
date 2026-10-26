'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const ctrl=fs.readFileSync(path.join(root,'printer-bridge/farm-controller.js'),'utf8');
const bridge=fs.readFileSync(path.join(root,'printer-bridge/server.js'),'utf8');
const installer=fs.readFileSync(path.join(root,'printer-bridge/install-farm-controller.sh'),'utf8');
const agent=fs.readFileSync(path.join(root,'printer-bridge/com.thelab.farm-controller.plist'),'utf8');

test('manual Farm Controller does not terminate on /update, including no-op update',()=>{
  assert.match(ctrl,/const RESTART_MANAGED = process\.env\.FARM_RESTART_MANAGED === '1';/);
  assert.match(ctrl,/const restarting=!!result\.ok && result\.changed && RESTART_MANAGED;/);
  assert.match(ctrl,/manualRestartRequired:!!result\.ok && result\.changed && !RESTART_MANAGED/);
  assert.match(ctrl,/if\(restarting\)\{[\s\S]{0,250}setTimeout\(shutdown,500\)/);
  assert.match(ctrl,/finish\(\{ok:true,out,changed:before!==after\}\)/);
});

test('child may request stale parent restart only with persistent supervisor',()=>{
  assert.match(bridge,/if\(process\.env\.FARM_RESTART_MANAGED!=='1'\)return false;/);
});

test('controller shutdown never schedules a new legacy child',()=>{
  assert.match(ctrl,/if \(shuttingDown\) return;/);
  assert.match(ctrl,/if\(shuttingDown\)return;\s*shuttingDown=true/);
  assert.match(ctrl,/clearTimeout\(legacyRestartTimer\)/);
});

test('launchd supervised; manual fallback disables unaudited self restart',()=>{
  assert.match(agent,/<key>FARM_RESTART_MANAGED<\/key><string>1<\/string>/);
  assert.match(installer,/export FARM_RESTART_MANAGED=0/);
  assert.match(installer,/export BRIDGE_UPDATE=0/);
});
