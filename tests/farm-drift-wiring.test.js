'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('macOS carga drift antes de health y controller',()=>{
  const plist=read('printer-bridge/com.thelab.farm-controller.plist');
  const prod=plist.indexOf('farm-production-preload.js');
  const drift=plist.indexOf('farm-drift-preload.js');
  const health=plist.indexOf('farm-health-preload.js');
  const controller=plist.indexOf('farm-controller.js');
  assert.ok(prod>=0&&drift>prod&&health>drift&&controller>health);
});

test('systemd carga drift antes de health y controller',()=>{
  const service=read('printer-bridge/farm-controller.service');
  const line=service.split('\n').find(x=>x.startsWith('ExecStart='))||'';
  assert.ok(line.indexOf('farm-production-preload.js')>=0);
  assert.ok(line.indexOf('farm-drift-preload.js')>line.indexOf('farm-production-preload.js'));
  assert.ok(line.indexOf('farm-health-preload.js')>line.indexOf('farm-drift-preload.js'));
  assert.ok(line.lastIndexOf('farm-controller.js')>line.indexOf('farm-health-preload.js'));
  assert.match(service,/BRIDGE_ALLOW_ORIGIN=https:\/\/dashboard\.thelab\.solutions/);
});

test('dashboard carga FarmDrift desde bootstrap de UI',()=>{
  const health=read('js/farm-health-adapter.js');
  assert.match(health,/js\/farm-drift-adapter\.js/);
  assert.match(health,/integridad de configuración de máquinas/);
});

test('badge de Máquinas escucha actualizaciones de drift',()=>{
  const badges=read('js/dashboard-notification-badges.js');
  assert.match(badges,/farm-drift-updated/);
  assert.match(badges,/FarmDrift/);
});

test('drift usa sesiones del controller y no muestra identidades obsoletas',()=>{
  const controller=read('printer-bridge/farm-controller.js');
  const drift=read('printer-bridge/farm-drift-preload.js');
  const health=read('printer-bridge/farm-health-preload.js');
  const production=read('printer-bridge/farm-production-preload.js');
  for(const src of [drift,health,production])assert.match(src,/__TLS_FARM_ROLE_FOR_TOKEN__/);
  assert.match(controller,/globalThis\.__TLS_FARM_ROLE_FOR_TOKEN__\s*=\s*roleForToken/);
  assert.match(drift,/const registered=registryMachines\(\)/);
  assert.match(drift,/registered\.length\?new Set\(registered\.map/);
  assert.match(drift,/displayMachineName/);
});

test('dashboard reintenta drift con token largo contra bridges anteriores',()=>{
  const adapter=read('js/farm-drift-adapter.js');
  const machines=read('js/maquinas.js');
  assert.match(adapter,/function longToken\(\)/);
  assert.match(adapter,/r\.status===403&&lt&&lt!==t/);
  assert.match(adapter,/function scopeSnapshot\(d\)/);
  assert.match(adapter,/const fleet=activeFleet\(\)/);
  assert.match(machines,/function getPrinterTunnelLongToken\(\)/);
  assert.match(machines,/function getPrinterFleetForDrift\(\)/);
});

test('backend no persiste texto de configs, sólo hashes/metadatos',()=>{
  const backend=read('printer-bridge/farm-drift-preload.js');
  assert.match(backend,/sha256\(r\.body\)/);
  assert.doesNotMatch(backend,/content:\s*r\.body/);
  assert.doesNotMatch(backend,/files\[rel\]\s*=\s*r\.body/);
});
