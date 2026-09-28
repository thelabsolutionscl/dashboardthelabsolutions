#!/usr/bin/env node
/*
 * Integridad de la carga principal del CRM.
 *
 * Una lectura parcial no puede presentarse como "en vivo": si Pedidos falla
 * mientras el navegador conserva una caché vieja/recortada, esa caché no debe
 * volver a guardarse como si fuese la verdad actual.
 */
'use strict';
const test=require('node:test');
const assert=require('node:assert');
const fs=require('fs');
const path=require('path');
const HTML=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

function fn(name){
  const re=new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\([^)]*\\)\\s*\\{');
  const m=re.exec(HTML);assert.ok(m,'debe existir '+name);
  const start=m.index,open=HTML.indexOf('{',start);
  let d=0,q='',esc=false,lc=false,bc=false;
  for(let i=open;i<HTML.length;i++){
    const c=HTML[i],n=HTML[i+1];
    if(lc){if(c==='\n')lc=false;continue;}
    if(bc){if(c==='*'&&n==='/'){bc=false;i++;}continue;}
    if(q){if(esc){esc=false;continue;}if(c==='\\'){esc=true;continue;}if(c===q)q='';continue;}
    if(c==='/'&&n==='/'){lc=true;i++;continue;}
    if(c==='/'&&n==='*'){bc=true;i++;continue;}
    if(c==='"'||c==="'"||c==='\`'){q=c;continue;}
    if(c==='{')d++;
    if(c==='}'&&--d===0)return HTML.slice(start,i+1);
  }
  assert.fail('no se pudo cerrar '+name);
}

test('Pedidos es una tabla crítica y la carga fallida se reintenta',()=>{
  assert.match(HTML,/const _CORE_TABLES=\[[\s\S]*?\['Clientes',1000\][\s\S]*?\['Cotizaciones',1000\][\s\S]*?\['Pedidos',1000\]/);
  assert.match(HTML,/const _CRITICAL_CORE_INDEXES=\[0,1,2,6\]/);
  const retry=fn('_retryCriticalCore');
  assert.match(retry,/if\(out\[i\]\?\.status==='fulfilled'\) continue/);
  assert.match(retry,/airtableFetch\(table,max\)/);
});

test('una carga manual incompleta no se marca en vivo ni contamina la caché',()=>{
  const body=fn('loadAllData');
  const retry=body.indexOf('await _retryCriticalCore(res)');
  const gate=body.indexOf('_criticalCoreError(res)');
  const assign=body.indexOf('_assignCoreState(res,true)');
  const gateFull=body.indexOf('_coreSnapshotComplete(res)');
  const save=body.indexOf('if(_complete)_saveDataCache()');
  assert.ok(retry>=0&&gate>retry&&assign>gate,'reintenta y valida antes de reemplazar el state');
  assert.ok(gateFull>assign&&save>gateFull,'solo una carga de TODAS las tablas escribe la caché');
  assert.match(body,/setStatus\(_complete\?'en vivo':'datos parciales',_complete\)/);
});

test('el refresco automático tampoco avanza el reloj si Pedidos falla',()=>{
  const body=fn('loadAllDataSilent');
  assert.match(body,/res=await _retryCriticalCore\(res\)/,'el full automático reintenta el núcleo');
  assert.match(body,/airtableFetchSince\(table,sinceIso\)/,'el delta también reintenta la tabla crítica fallida');
  const gate=body.lastIndexOf('_criticalCoreError(res)');
  const clock=body.indexOf('state.lastUpdateTs=Date.now()');
  assert.ok(gate>=0&&clock>gate,'no debe avanzar lastUpdateTs antes de validar el delta crítico');
});

test('Facturas es crítica y cualquier secundaria ausente impide un snapshot full',()=>{
  const first=HTML.indexOf('const _CORE_TABLES=');
  const last=HTML.indexOf('// Trae sólo los registros',first);
  const core=new Function(HTML.slice(first,last)+'\nreturn {_criticalCoreError,_missingCoreTables,_coreSnapshotComplete};')();
  const full=Array.from({length:7},()=>({status:'fulfilled',value:{records:[]}}));
  assert.equal(core._criticalCoreError(full),null);
  assert.equal(core._coreSnapshotComplete(full),true);
  const fac=full.slice();fac[6]={status:'rejected',reason:new Error('503')};
  assert.match(core._criticalCoreError(fac).message,/Facturas/);
  assert.equal(core._coreSnapshotComplete(fac),false);
  const sec=full.slice();sec[3]={status:'rejected',reason:new Error('503')};
  assert.equal(core._criticalCoreError(sec),null,'reportes no bloquea la UI principal');
  assert.deepEqual(core._missingCoreTables(sec),['Reportes']);
  assert.equal(core._coreSnapshotComplete(sec),false,'reporte ausente tampoco se cachea como completo');
});

test('un delta parcial conserva el cursor incremental para reintentar las tablas ausentes',()=>{
  const body=fn('loadAllDataSilent');
  assert.match(body,/if\(_complete\)\s*\{[\s\S]*?state\.lastUpdateTs=Date\.now\(\)/);
  assert.match(body,/if\(doFull\) state\.lastUpdateTs=0/,'un full parcial fuerza otro full');
  assert.match(body,/setStatus\('datos parciales',false\)/);
});

test('las cachés no aceptan datos financieros vacíos por formato corrupto',()=>{
  const body=fn('_hydrateFromCache');
  assert.match(body,/!Array\.isArray\(o\.d\[key\]\)/);
  assert.match(body,/facturas/);
  assert.match(HTML,/const _DATA_CACHE_VERSION=5/);
});
