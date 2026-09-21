#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const MAQ=fs.readFileSync(path.join(ROOT,'js','maquinas.js'),'utf8');
const FIN=fs.readFileSync(path.join(ROOT,'js','finanzas.js'),'utf8');
const LOGO=fs.readFileSync(path.join(ROOT,'js','tv-logo-fix.js'),'utf8');

function fn(source,name){
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,'falta '+name);
  let open=source.indexOf('{',start),depth=0,quote='',esc=false,line=false,block=false;
  for(let i=open;i<source.length;i++){
    const c=source[i],n=source[i+1];
    if(line){if(c==='\n')line=false;continue;}
    if(block){if(c==='*'&&n==='/'){block=false;i++;}continue;}
    if(quote){if(esc){esc=false;continue;}if(c==='\\'){esc=true;continue;}if(c===quote)quote='';continue;}
    if(c==='/'&&n==='/'){line=true;i++;continue;}
    if(c==='/'&&n==='*'){block=true;i++;continue;}
    if(c==='"'||c==="'"||c==='\`'){quote=c;continue;}
    if(c==='{')depth++;
    if(c==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error('no se pudo aislar '+name);
}

test('Máquinas y Overview exponen modos TV distintos',()=>{
  assert.match(INDEX,/onclick="tvStartTaller\(\)"[^>]*>📺 Modo Taller \(TV\)<\/button>/);
  assert.match(INDEX,/onclick="tvStartResumen\(\)"[^>]*>📺 Modo Resumen \(TV\)<\/button>/);
  assert.match(FIN,/tab:'maquinas'[^\n]+title:'Modo Taller \(TV\)'[^\n]+tvStartTaller/);
  assert.match(FIN,/tab:'overview'[^\n]+title:'Modo Resumen \(TV\)'[^\n]+tvStartResumen/);
});

test('el TV usa una sola capa y fullscreen sobre el overlay, no sobre documentElement',()=>{
  const start=fn(INDEX,'tvStart');
  const enter=fn(INDEX,'_tvEnterFullscreen');
  assert.match(start,/ov\.id='tvOverlay'/);
  assert.match(start,/ov\.dataset\.tvMode=mode/);
  assert.match(start,/_tvEnterFullscreen\(ov\)/);
  assert.match(enter,/ov\.requestFullscreen\(\)/);
  assert.doesNotMatch(start,/document\.documentElement\.requestFullscreen/);
  assert.doesNotMatch(enter,/document\.documentElement\.requestFullscreen/);
  assert.equal((INDEX.match(/\.id='tvOverlay'/g)||[]).length,1,'solo debe crearse un overlay TV');
});

test('Modo Resumen rota solo información de Overview y no impresoras',()=>{
  assert.match(INDEX,/const _TV_SUMMARY_VIEWS=\[\['PEDIDOS POR ETAPA',_tvViewPedidos\],\['ENTREGAS',_tvViewHoy\]\]/);
  const start=INDEX.indexOf('const _TV_SUMMARY_VIEWS=');
  const end=INDEX.indexOf(';',start);
  assert.doesNotMatch(INDEX.slice(start,end+1),/_tvViewTaller|_tvViewMaquinas/);
});

test('Modo Taller muestra impresoras con cámaras reales y sin pedidos',()=>{
  const taller=fn(INDEX,'_tvViewTaller');
  const camera=fn(INDEX,'_tvCameraInfo');
  assert.match(taller,/tvWorkshopGrid/);
  assert.match(taller,/tvCam_/);
  assert.doesNotMatch(taller,/state\.pedidos|_tvViewPedidos|_tvViewHoy/);
  assert.match(camera,/_printerCamRaw/);
  assert.match(camera,/printerCamUrl/);
  assert.match(camera,/_camIsSnapshot/);
  const suspend=fn(INDEX,'_tvSuspendMonitorCameras');
  assert.match(suspend,/tvOwnSuspend/,'Taller TV debe suspender la cámara duplicada del monitor');
});

test('Kiosko legado de Máquinas converge al Taller TV',()=>{
  const kiosk=fn(MAQ,'toggleKiosk');
  assert.match(kiosk,/tvStartTaller/);
  assert.doesNotMatch(kiosk,/document\.documentElement\.requestFullscreen/);
  assert.doesNotMatch(kiosk,/classList\.add\('kiosk'\)/);
});

test('TVLogoFix prioriza el overlay único y no duplica títulos',()=>{
  const roots=fn(LOGO,'visibleTvRoots');
  const header=fn(LOGO,'ensureHeader');
  assert.match(roots,/getElementById\('tvOverlay'\)/);
  assert.match(roots,/return\[primary\]/);
  assert.match(header,/existingTitle/);
  assert.match(header,/data-tv-header-title/);
});
