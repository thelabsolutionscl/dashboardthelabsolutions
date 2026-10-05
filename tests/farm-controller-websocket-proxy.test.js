#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const SRC=fs.readFileSync(path.join(ROOT,'printer-bridge','farm-controller.js'),'utf8');

function fn(name){
  const start=SRC.indexOf('function '+name+'(');
  assert.ok(start>=0,'falta '+name);
  const brace=SRC.indexOf('{',start);
  let depth=0;
  for(let i=brace;i<SRC.length;i++){
    if(SRC[i]==='{')depth++;
    else if(SRC[i]==='}'&&--depth===0)return SRC.slice(start,i+1);
  }
  throw new Error('función incompleta '+name);
}

test('Farm Controller reenvía upgrades WebSocket al bridge interno',()=>{
  assert.match(SRC,/server\.on\('upgrade',\(req,clientSocket,head\)=>proxyLegacyUpgrade\(req,clientSocket,head\)\)/);
  const proxy=fn('proxyLegacyUpgrade');
  assert.match(proxy,/roleForToken\(tokenFromReq\(req\)\)/,'autentica el ticket/token externo antes de proxificar');
  assert.match(proxy,/ROLE_RANK\[role\]<ROLE_RANK\.viewer/,'exige al menos viewer');
  assert.match(proxy,/DASHBOARD_ORIGIN/,'valida Origin del dashboard');
  assert.match(proxy,/cleanForwardPath\(req\.url\)/,'elimina bt antes de reenviar');
  assert.match(proxy,/127\.0\.0\.1/,'solo conecta al bridge interno');
  assert.match(proxy,/'x-bridge-token':INTERNAL_TOKEN/,'usa el token interno, no el del navegador');
  assert.match(proxy,/origin:'http:\/\/127\.0\.0\.1'/,'adapta Origin a la allowlist del bridge hijo');
  assert.match(proxy,/upstream\.setTimeout\(0\);upstreamSocket\.setTimeout\(0\)/,'el timeout del handshake no debe cortar un socket ya establecido');
  assert.match(proxy,/upstreamSocket\.pipe\(clientSocket\);clientSocket\.pipe\(upstreamSocket\)/,'mantiene flujo bidireccional');
});

test('el proxy WebSocket sólo admite la ruta Moonraker esperada',()=>{
  const proxy=fn('proxyLegacyUpgrade');
  assert.match(proxy,/websocket/);
  assert.match(proxy,/ruta WebSocket no permitida/);
});

test('authcheck anuncia soporte realtime WebSocket',()=>{
  assert.match(SRC,/realtimeWebSocket:true/);
});


test('proxy HTTP preserva parámetros Moonraker sin valor al retirar bt',()=>{
  const clean=new Function(fn('cleanForwardPath')+'; return cleanForwardPath;')();
  const raw='/192.168.100.7/printer/objects/query?print_stats&extruder&webhooks&bt=secreto&filament_switch_sensor%20filament_sensor';
  const forwarded=clean(raw);
  assert.equal(forwarded,'/192.168.100.7/printer/objects/query?print_stats&extruder&webhooks&filament_switch_sensor%20filament_sensor');
  assert.doesNotMatch(forwarded,/print_stats=|extruder=|webhooks=/,'no debe convertir flags Moonraker en pares clave=valor');
  assert.doesNotMatch(forwarded,/(?:^|[?&])bt(?:=|&|$)/,'la credencial externa no puede llegar al bridge hijo');
});

test('healthz identifica la revisión realmente cargada por el Controller',()=>{
  assert.match(SRC,/const BUILD_REVISION=repoRevision\(\)/);
  assert.match(SRC,/service: 'farm-controller', revision: BUILD_REVISION/);
});
