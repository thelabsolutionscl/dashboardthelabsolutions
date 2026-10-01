#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const ADS=fs.readFileSync(path.join(ROOT,'js','seo-ads.js'),'utf8');
const WEB=fs.readFileSync(path.join(ROOT,'js','web-analytics.js'),'utf8');
const KAI=fs.readFileSync(path.join(ROOT,'js','kai.js'),'utf8');
const SIM=fs.readFileSync(path.join(ROOT,'js','simulacion.js'),'utf8');
const MAIL=fs.readFileSync(path.join(ROOT,'js','correo.js'),'utf8');
const MACHINES=fs.readFileSync(path.join(ROOT,'js','maquinas.js'),'utf8');
const SLICER=fs.readFileSync(path.join(ROOT,'js','slicer3d.js'),'utf8');

function fn(source,name){
  const start=source.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  assert.ok(start>=0,`falta ${name}()`);
  const paren=source.indexOf('(',start);let parenDepth=0,open=-1,paramQuote='';
  for(let i=paren;i<source.length;i++){
    const c=source[i],p=source[i-1];
    if(paramQuote){if(c===paramQuote&&p!=='\\')paramQuote='';continue;}
    if(c==='"'||c==="'"||c==='`'){paramQuote=c;continue;}
    if(c==='(')parenDepth++;
    else if(c===')'&&--parenDepth===0){open=source.indexOf('{',i+1);break;}
  }
  assert.ok(open>=0,`falta cuerpo de ${name}()`);
  let depth=0,quote='',line=false,block=false;
  for(let i=open;i<source.length;i++){
    const c=source[i],n=source[i+1],p=source[i-1];
    if(line){if(c==='\n')line=false;continue;}
    if(block){if(c==='*'&&n==='/'){block=false;i++;}continue;}
    if(quote){if(c===quote&&p!=='\\')quote='';continue;}
    if(c==='/'&&n==='/'){line=true;i++;continue;}
    if(c==='/'&&n==='*'){block=true;i++;continue;}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
    if(c==='{')depth++;else if(c==='}'&&--depth===0)return source.slice(start,i+1);
  }
  assert.fail(`llaves desbalanceadas en ${name}()`);
}

test('DEMO resuelve Airtable en memoria incluso cuando el deploy tiene proxy',()=>{
  assert.match(fn(INDEX,'_airtableConfig'),/if\(window\._DEMO_MODE\)\s*return\{base:['"]demo:\/\/airtable/);
  assert.match(fn(INDEX,'_atFetch'),/_demoAirtableHttp/);
  assert.match(fn(INDEX,'airtableHttp'),/if\(typeof window!==['"]undefined['"]&&window\._DEMO_MODE\)\s*return _demoAirtableHttp/);
  const mem=fn(INDEX,'_demoAirtableHttp');
  assert.match(mem,/method===['"]GET['"]/);
  assert.match(mem,/method===['"]DELETE['"]/);
  assert.match(mem,/records\\\[\\\]/,'DELETE batch debe funcionar en memoria');
  assert.match(mem,/Array\.isArray\(body\.records\)/,'debe aceptar escrituras batch');
  assert.match(mem,/Object\.assign\(rec\.fields/,'PATCH debe verse durante la sesión');
});

test('DEMO no pisa el token real y bloquea cualquier fetch externo',()=>{
  const enable=fn(INDEX,'enableDemoMode');
  assert.doesNotMatch(enable,/setItem\(['"]airtable_token['"],['"]DEMO_TOKEN['"]\)/);
  assert.match(enable,/_demoStore=_demoClone\(DEMO_DATA\)/);
  assert.match(enable,/target\.origin!==location\.origin/);
  assert.match(enable,/simulated:true/);
  assert.match(INDEX,/localStorage\.getItem\(['"]airtable_token['"]\)===['"]DEMO_TOKEN['"]/,'debe limpiar residuos de versiones anteriores');
});

test('Anthropic, KAI y Simulación funcionan sin consumo en DEMO',()=>{
  const call=fn(INDEX,'callClaude');
  assert.ok(call.indexOf('window._DEMO_MODE')<call.indexOf('_proxyCfg()'),'el guard demo debe ejecutarse antes de leer el proxy');
  assert.match(call,/_demoClaudeResponse/);
  assert.match(fn(KAI,'ask'),/window\._DEMO_MODE/);
  assert.match(fn(SIM,'_simClaude'),/window\._DEMO_MODE/);
  assert.match(MAIL,/_sendGate\(\)\s*\{\s*if\(window\._DEMO_MODE\)return null/);
});

test('las secciones principales tienen datos de muestra útiles',()=>{
  for(const table of ['Clientes','Cotizaciones','Pedidos','Reportes','Proveedores','Facturas','Inventario','Agent_Queue','Newsletter_Campañas','Newsletter_Envios']){
    assert.match(INDEX,new RegExp(`(?:^|\\n)\\s*(?:'${table}'|${table})\\s*:\\{records:\\[`),`falta seed ${table}`);
  }
  assert.match(fn(ADS,'loadAdsData'),/window\._DEMO_MODE\|\|!cfg\.endpoint/);
  assert.match(fn(WEB,'loadWebStats'),/window\._DEMO_MODE.*getWebDemoData/);
});

test('la cuenta DEMO no expone configuración ni credenciales guardadas',()=>{
  const rbac=fn(INDEX,'applyRBAC');
  assert.match(rbac,/role===['"]demo['"]\|\|i>0/);
  assert.match(rbac,/mobileConfigBody/);
  assert.match(INDEX,/canConfig:[^\n]*demo:false/);
});

test('las acciones de impresora también se simulan antes de usar XHR',()=>{
  const upload=fn(INDEX,'handleGcodeUpload');
  assert.ok(upload.indexOf('window._DEMO_MODE')<upload.indexOf('new XMLHttpRequest'));
  assert.ok(fn(MACHINES,'_queueStartNext').indexOf('window._DEMO_MODE')<fn(MACHINES,'_queueStartNext').indexOf('new XMLHttpRequest'));
  assert.ok(fn(SLICER,'enviarCal').indexOf('window._DEMO_MODE')<fn(SLICER,'enviarCal').indexOf('new XMLHttpRequest'));
  assert.ok(fn(SLICER,'enviar').indexOf('window._DEMO_MODE')<fn(SLICER,'enviar').indexOf('new XMLHttpRequest'));
});
