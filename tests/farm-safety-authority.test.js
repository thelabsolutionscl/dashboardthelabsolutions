'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const os=require('os'),fs=require('fs'),path=require('path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'farm-safety-authority-'));
process.env.FARM_DATA_DIR=dir;process.env.FARM_SAFETY_AGENT_FILE=path.join(dir,'safety-agent.json');
const mod=require('../printer-bridge/farm-safety-authority-preload.js');
const job={machineId:'k1-1',secs:5*3600};
const browser={updatedAt:Date.now(),config:{strict:true,cameraRequired:true,ventilationRequired:true,smokeRequired:true,staleMinutes:10},reading:{at:new Date().toISOString(),online:true,ventilation:true,smoke:false,temperature:24,voc:100},cameras:{'k1-1':true}};

test('sin agente fresco la cámara declarada por navegador no autoriza desatendido',()=>{
  const eff=mod.effectiveSnapshot(browser,Date.now());assert.deepEqual(eff.cameras,{});assert.equal(eff.agent.fresh,false);
  const d=mod.evaluateAuthoritative(browser,job,Date.now(),12);assert.equal(d.ok,false);assert.ok(d.blockers.some(x=>/cámara/i.test(x)));
});
test('probe local fresco manda sobre el navegador',()=>{
  const now=Date.now();fs.writeFileSync(process.env.FARM_SAFETY_AGENT_FILE,JSON.stringify({updatedAt:now,reading:browser.reading,cameras:{'k1-1':false},cameraHealth:{'k1-1':{ok:false,error:'timeout'}},agent:{updatedAt:now,source:'farm-controller'}}));
  let eff=mod.effectiveSnapshot(browser,now);assert.equal(eff.cameras['k1-1'],false);assert.equal(eff.agent.fresh,true);
  assert.equal(mod.evaluateAuthoritative(browser,job,now,12).ok,false);
  fs.writeFileSync(process.env.FARM_SAFETY_AGENT_FILE,JSON.stringify({updatedAt:now,reading:browser.reading,cameras:{'k1-1':true},cameraHealth:{'k1-1':{ok:true}},agent:{updatedAt:now,source:'farm-controller'}}));
  eff=mod.effectiveSnapshot(browser,now);assert.equal(eff.cameras['k1-1'],true);assert.equal(mod.evaluateAuthoritative(browser,job,now,12).ok,true);
});
test('agente vencido vuelve a fail-closed',()=>{
  const now=Date.now(),old=now-mod.MAX_AGE_MS-1000;fs.writeFileSync(process.env.FARM_SAFETY_AGENT_FILE,JSON.stringify({updatedAt:old,reading:browser.reading,cameras:{'k1-1':true},agent:{updatedAt:old}}));
  const eff=mod.effectiveSnapshot(browser,now);assert.equal(eff.agent.fresh,false);assert.deepEqual(eff.cameras,{});assert.equal(mod.evaluateAuthoritative(browser,job,now,12).ok,false);
});
