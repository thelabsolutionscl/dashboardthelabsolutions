#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.join(__dirname,'..');
const MAQ=fs.readFileSync(path.join(ROOT,'js','maquinas.js'),'utf8');
const OPS=fs.readFileSync(path.join(ROOT,'js','maquinas-operaciones.js'),'utf8');

function fn(source,name){
  const marker=new RegExp('(?:async\\s+)?function\\s+'+name.replace(/[.*+?^$()|[\\]\\\\]/g,'\\\\$&')+'\\s*\\(');
  const found=marker.exec(source);assert.ok(found,'falta '+name);
  let paren=0,open=-1;
  for(let i=found.index+found[0].length-1;i<source.length;i++){
    const ch=source[i];if(ch==='(')paren++;else if(ch===')'&&--paren===0){open=source.indexOf('{',i);break;}
  }
  assert.ok(open>=0,'sin cuerpo '+name);
  let depth=0,quote='',escape=false,line=false,block=false;
  for(let i=open;i<source.length;i++){
    const ch=source[i],next=source[i+1];
    if(line){if(ch==='\\n')line=false;continue;}
    if(block){if(ch==='*'&&next==='/'){block=false;i++;}continue;}
    if(quote){if(escape){escape=false;continue;}if(ch==='\\\\'){escape=true;continue;}if(ch===quote)quote='';continue;}
    if(ch==='/'&&next==='/'){line=true;i++;continue;}
    if(ch==='/'&&next==='*'){block=true;i++;continue;}
    if(ch==='"'||ch==="'"||ch.charCodeAt(0)===96){quote=ch;continue;}
    if(ch==='{')depth++;if(ch==='}'&&--depth===0)return source.slice(found.index,i+1);
  }
  throw new Error('no se pudo aislar '+name);
}
function context(extra){
  const map=new Map();
  const ctx=Object.assign({console,Date,Math,JSON,Number,String,Array,Object,Map,Set,
    localStorage:{getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)}},extra||{});
  vm.createContext(ctx);return ctx;
}
function loadBedMath(){
  const ctx=context();
  const names=['_bedLevelFiniteOrNull','_bedLevelPair','_bedLevelStats','_bedLevelSignature','_bedLevelCoords','_bedLevelPlaneFit'];
  vm.runInContext(names.map(n=>fn(MAQ,n)).join('\\n')+'\\nthis.api={finite:_bedLevelFiniteOrNull,stats:_bedLevelStats,sig:_bedLevelSignature,fit:_bedLevelPlaneFit};',ctx);
  return ctx.api;
}

test('temperaturas desconocidas no se convierten en 0 C',()=>{
  const a=loadBedMath().finite;
  assert.equal(a(null),null);assert.equal(a(undefined),null);assert.equal(a(''),null);
  assert.equal(a('60'),60);assert.equal(a(0),0);
});

test('ajuste de plano separa inclinacion de deformacion local',()=>{
  const a=loadBedMath(),matrix=[];
  for(let r=0;r<3;r++){const row=[];for(let c=0;c<3;c++){const x=c*100,y=r*100;row.push(0.001*x+0.002*y);}matrix.push(row);}
  const st=a.stats({probed_matrix:matrix,mesh_min:[0,0],mesh_max:[200,200]});
  const fit=a.fit(st);
  assert.ok(fit);assert.ok(Math.abs(fit.tiltX-0.2)<1e-6);assert.ok(Math.abs(fit.tiltY-0.4)<1e-6);
  assert.ok(fit.residualRange<1e-8);assert.equal(fit.shape,'INCLINACIÓN');
});

test('historial v2 limita por maquina y conserva firmas',()=>{
  const ctx=context();
  const prefix="const _BED_LEVEL_HISTORY_PER_MACHINE=16; const _BED_LEVEL_HISTORY_TOTAL=180; const _BED_LEVEL_HISTORY_MAX_NOTES=85000;\\n";
  vm.runInContext(prefix+[fn(MAQ,'_bedLevelFiniteOrNull'),fn(MAQ,'_bedLevelHistoryNormalize'),fn(MAQ,'_bedLevelHistoryPrune')].join('\\n')+'\\nthis.prune=_bedLevelHistoryPrune;',ctx);
  const rows=[];
  for(let i=0;i<25;i++)rows.push({id:'a'+i,machineId:'a',calibratedAt:1000+i,updatedAt:1000+i,range:.2,signature:'sig-a-'+i});
  for(let i=0;i<5;i++)rows.push({id:'b'+i,machineId:'b',calibratedAt:2000+i,updatedAt:2000+i,range:.1,signature:'sig-b-'+i});
  const out=ctx.prune(rows);
  assert.equal(out.filter(x=>x.machineId==='a').length,16);
  assert.equal(out.filter(x=>x.machineId==='b').length,5);
  assert.ok(out.every(x=>typeof x.signature==='string'));
});

test('assessment exige coincidencia entre malla activa e historial',()=>{
  const ctx=context();
  const sources=[fn(MAQ,'_bedLevelSignature'),fn(MAQ,'_bedLevelFiniteOrNull'),fn(MAQ,'_bedLevelTypicalBedTemp'),fn(MAQ,'_bedLevelAge'),fn(MAQ,'_bedLevelAssessment')].join('\\n');
  vm.runInContext("function _bedLevelVerifiedEntry(){return null;}\\n"+sources+"\\nthis.assess=_bedLevelAssessment;",ctx);
  let r=ctx.assess('k1',{matrix:[[0,.1],[.2,.3]],range:.3},'PLA');
  assert.equal(r.code,'unverified');assert.equal(r.strongConfirm,true);
  vm.runInContext("_bedLevelVerifiedEntry=function(){return{calibratedAt:Date.now(),bedTemp:60,verifiedSource:'shared'};};",ctx);
  r=ctx.assess('k1',{matrix:[[0,.3],[.6,.9]],range:.9},'PLA');assert.equal(r.code,'extreme');assert.equal(r.strongConfirm,true);
  r=ctx.assess('k1',{matrix:[[0,.05],[.10,.15]],range:.15},'PLA');assert.equal(r.code,'ok');assert.equal(r.level,'pass');
});

test('calibracion guarda local primero y sincroniza remoto en background',()=>{
  const append=fn(MAQ,'_bedLevelHistoryAppend');
  assert.doesNotMatch(append,/await\s+_bedLevelHistoryLoadRemote/);
  assert.match(append,/_bedLevelHistorySave/);
  assert.match(append,/_bedLevelHistorySyncRemote\(\)\.catch/);
  const sync=fn(MAQ,'_bedLevelHistorySyncRemote');
  assert.match(sync,/for\(let attempt=0;attempt<2;attempt\+\+\)/);
  assert.match(sync,/_bedLevelHistoryMerge/);
});

test('fallo de calibracion relee Moonraker y no conserva un valor viejo',()=>{
  const auto=fn(MAQ,'printerAutoBedCalibrate'),fail=fn(MAQ,'_bedLevelRefreshAfterFailure');
  assert.match(auto,/_bedLevelRefreshAfterFailure/);
  assert.match(fail,/printerBedLevelRefresh/);
  assert.match(fail,/forceDuringRun:true/);
});

test('heatmap usa escala absoluta y ofrece calibracion termica y ayuda fisica',()=>{
  const map=fn(MAQ,'openBedMesh');
  assert.match(map,/const dev=Math\.max\(-scale/);
  assert.match(map,/Number\(v\)-st\.avg/);
  assert.match(map,/400/);
  assert.match(map,/printerScrewsTiltGuide/);
  assert.match(map,/printerZTiltAdjust/);
  const thermal=fn(MAQ,'_bedLevelWaitTemperature');
  assert.match(thermal,/Math\.abs\(actual-preset\.target\)<=1\.5/);
  assert.match(thermal,/20000/);
  assert.match(MAQ,/PLA 60°/);assert.match(MAQ,/PETG 75°/);assert.match(MAQ,/ABS 100°/);
});

test('MachineOps hace verificacion live y segunda confirmacion para riesgo fuerte',()=>{
  assert.match(OPS,/async function evaluatePreflightLive\(/);
  assert.match(OPS,/window\.getBedLevelPreflightFact/);
  const pf=fn(OPS,'preflightFromFacts');
  assert.match(pf,/strongWarnings/);assert.match(pf,/strongToken/);
  const open=fn(OPS,'openPreflight');assert.match(open,/await evaluatePreflightLive/);
  const start=fn(OPS,'startJob');assert.match(start,/const fresh=await evaluatePreflightLive/);assert.match(start,/fresh\.strongToken!==String\(options\.strongToken/);
});
