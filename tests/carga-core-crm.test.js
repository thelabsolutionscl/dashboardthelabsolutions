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
  assert.match(HTML,/const _CRITICAL_CORE_INDEXES=\[0,1,2\]/);
  const retry=fn('_retryCriticalCore');
  assert.match(retry,/if\(out\[i\]\?\.status==='fulfilled'\) continue/);
  assert.match(retry,/airtableFetch\(table,max\)/);
});

test('una carga manual incompleta no se marca en vivo ni contamina la caché',()=>{
  const body=fn('loadAllData');
  const retry=body.indexOf('await _retryCriticalCore(res)');
  const gate=body.indexOf('_criticalCoreError(res)');
  const assign=body.indexOf('_assignCoreState(res,true)');
  const live=body.indexOf("setStatus('en vivo',true)");
  const save=body.indexOf('_saveDataCache()');
  assert.ok(retry>=0&&gate>retry&&assign>gate,'reintenta y valida antes de reemplazar el state');
  assert.ok(live>assign&&save>live,'solo después de una carga crítica válida se marca en vivo y se cachea');
});

test('el refresco automático tampoco avanza el reloj si Pedidos falla',()=>{
  const body=fn('loadAllDataSilent');
  assert.match(body,/res=await _retryCriticalCore\(res\)/,'el full automático reintenta el núcleo');
  assert.match(body,/airtableFetchSince\(table,sinceIso\)/,'el delta también reintenta la tabla crítica fallida');
  const gate=body.lastIndexOf('_criticalCoreError(res)');
  const clock=body.indexOf('state.lastUpdateTs=Date.now()');
  assert.ok(gate>=0&&clock>gate,'no debe avanzar lastUpdateTs antes de validar el delta crítico');
});
