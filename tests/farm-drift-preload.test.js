'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
process.env.FARM_DRIFT_PRELOAD_DISABLE='1';
process.env.BRIDGE_TOKEN='drift-admin-test';
const drift=require('../printer-bridge/farm-drift-preload.js');

test('sólo archivos de configuración entran al fingerprint',()=>{assert.equal(drift.configFileWanted('printer.cfg'),true);assert.equal(drift.configFileWanted('macros/calibracion.cfg'),true);assert.equal(drift.configFileWanted('moonraker.conf'),true);assert.equal(drift.configFileWanted('klippy.log'),false);assert.equal(drift.configFileWanted('database.db'),false);});
test('límite de archivos distingue escaneo completo de truncado',()=>{const exact=drift.limitConfigPaths(['a.cfg','b.conf','nota.txt'],2);assert.equal(exact.truncated,false);assert.deepEqual(exact.files,['a.cfg','b.conf']);const extra=drift.limitConfigPaths(['a.cfg','b.conf','c.cfg'],2);assert.equal(extra.truncated,true);assert.equal(extra.discovered,3);assert.deepEqual(extra.files,['a.cfg','b.conf']);});
test('comparación de archivos informa agregados, removidos y modificados',()=>{const c=drift.compareFiles({'printer.cfg':'aaa','macros/a.cfg':'bbb','viejo.cfg':'ccc'},{'printer.cfg':'ddd','macros/a.cfg':'bbb','nuevo.cfg':'eee'});assert.deepEqual(c.changed,['printer.cfg']);assert.deepEqual(c.added,['nuevo.cfg']);assert.deepEqual(c.removed,['viejo.cfg']);});
test('sin baseline no genera falso drift',()=>{const cmp=drift.compareSnapshot({status:'ok',configHash:'x',files:{},klipperVersion:'1',moonrakerVersion:'2'},null);assert.equal(cmp.state,'unbaselined');});
test('mismo baseline queda clean',()=>{const base={configHash:'abc',files:{'printer.cfg':'x'},klipperVersion:'v1',moonrakerVersion:'m1'},cmp=drift.compareSnapshot({status:'ok',...base},base);assert.equal(cmp.state,'clean');assert.deepEqual(cmp.reasons,[]);});
test('cambio de config o versión queda drift con razón explícita',()=>{const base={configHash:'abc',files:{'printer.cfg':'x'},klipperVersion:'v1',moonrakerVersion:'m1'},cur={status:'ok',configHash:'def',files:{'printer.cfg':'y'},klipperVersion:'v2',moonrakerVersion:'m1'},cmp=drift.compareSnapshot(cur,base);assert.equal(cmp.state,'drift');assert.equal(cmp.reasons.includes('configuración cambió'),true);assert.equal(cmp.reasons.includes('versión Klipper cambió'),true);assert.deepEqual(cmp.changes.changed,['printer.cfg']);});
test('lectura parcial o truncada queda unknown, no clean',()=>{const cmp=drift.compareSnapshot({status:'partial',error:'escaneo incompleto: más de 128 archivos .cfg/.conf'},{});assert.equal(cmp.state,'unknown');assert.match(cmp.reasons[0],/escaneo incompleto/);});
test('drift.json corrupto se detecta y se clasifica como storage 507',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'drift-corrupt-')),file=path.join(dir,'drift.json');fs.writeFileSync(file,'{mal');const d=drift._test.readJsonDetailed(file);assert.equal(d.exists,true);assert.equal(d.ok,false);assert.equal(drift._test.storageStatus(new Error('drift.json inválido')),507);});
test('token maestro conserva rol admin',()=>{assert.equal(drift.roleForToken('drift-admin-test'),'admin');assert.equal(drift.roleForToken('incorrecto'),'');});
test('fingerprint SHA-256 es determinista y no expone contenido',()=>{const h=drift.sha256(Buffer.from('contenido secreto'));assert.match(h,/^[a-f0-9]{64}$/);assert.equal(h.includes('contenido'),false);});
