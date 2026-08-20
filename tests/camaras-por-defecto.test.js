#!/usr/bin/env node
'use strict';
// Cada máquina deriva su cámara de su IP viva según el modelo, para verlas todas
// sin clavar URLs fijas (las IP son DHCP). Pedido 2026-08-19: "ver todas las
// cámaras en el dashboard".

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const SRC=fs.readFileSync(path.join(__dirname,'..','js','maquinas.js'),'utf8');
function fn(name){
  const s=SRC.indexOf('function '+name+'(');
  assert.notEqual(s,-1,`falta ${name}`);
  const b=SRC.indexOf('{',s);let d=0;
  for(let i=b;i<SRC.length;i++){if(SRC[i]==='{')d++;else if(SRC[i]==='}'&&--d===0)return SRC.slice(s,i+1);}
}

function api(store={},maquinas=[],local=false){
  const ls={_d:{...store},getItem(k){return k in this._d?this._d[k]:null;}};
  const ctx={
    RegExp,String,
    localStorage:ls,
    MAQUINAS:maquinas,
    getPrinterIp:m=>m&&m.ip,
    _isLocalMode:()=>local,
    getPrinterTunnel:()=>'https://printers.thelab.solutions',
    _appendBridgeToken:u=>u+(u.includes('?')?'&':'?')+'bt=TK',
  };
  vm.createContext(ctx);
  vm.runInContext([fn('_defaultCamUrl'),fn('_printerCamRaw'),fn('_camIsSnapshot'),fn('printerCamUrl'),
    'this.api={def:_defaultCamUrl,raw:_printerCamRaw,snap:_camIsSnapshot,url:printerCamUrl};'].join('\n'),ctx);
  return ctx.api;
}

const K1={id:'k1-3',modelo:'K1',ip:'192.168.100.7'};
const ENDER={id:'e5-1',modelo:'Ender-5 Max',ip:'192.168.100.67'};
const K2={id:'k2-1',modelo:'K2',ip:'192.168.100.70'};
const K2P={id:'k2p-1',modelo:'K2 Plus',ip:'192.168.100.75'};
const SINIP={id:'x',modelo:'K1',ip:null};

test('K1 y Ender derivan MJPEG en :8080',()=>{
  const a=api({},[K1,ENDER]);
  assert.equal(a.def(K1),'http://192.168.100.7:8080/?action=stream');
  assert.equal(a.def(ENDER),'http://192.168.100.67:8080/?action=stream');
  assert.equal(a.snap(a.def(K1)),false,'MJPEG no es snapshot');
});

test('K2 y K2 Plus derivan snapshot go2rtc en :1984',()=>{
  const a=api({},[K2,K2P]);
  assert.equal(a.def(K2),'http://192.168.100.70:1984/api/frame.jpeg?src=k2plus');
  assert.equal(a.def(K2P),'http://192.168.100.75:1984/api/frame.jpeg?src=k2plus');
  assert.equal(a.snap(a.def(K2)),true,'go2rtc frame.jpeg SÍ es snapshot');
});

test('sin IP no hay cámara (no inventa URL rota)',()=>{
  const a=api({},[SINIP]);
  assert.equal(a.def(SINIP),'');
  assert.equal(a.raw('x'),'');
});

test('lo que el usuario fija a mano gana al default',()=>{
  const a=api({'printer_cam_k1-3':'http://10.0.0.9:8080/?action=stream'},[K1]);
  assert.equal(a.raw('k1-3'),'http://10.0.0.9:8080/?action=stream');
});

test('m.cam (Airtable) gana al default pero no a localStorage',()=>{
  const conCam={...K1,cam:'http://172.16.0.5:8080/?action=stream'};
  assert.equal(api({},[conCam]).raw('k1-3'),'http://172.16.0.5:8080/?action=stream');
  assert.equal(api({'printer_cam_k1-3':'http://10.0.0.9/x'},[conCam]).raw('k1-3'),'http://10.0.0.9/x');
});

test('sin config, el default alimenta la URL final por el túnel del bridge',()=>{
  const a=api({},[ENDER]);
  const u=a.url('e5-1');
  assert.match(u,/printers\.thelab\.solutions\/192\.168\.100\.67:8080\//,'debe pasar por el túnel con IP:puerto');
  assert.match(u,/bt=TK/,'debe llevar el token');
});
