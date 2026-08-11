#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const SOURCE=fs.readFileSync(path.join(__dirname,'..','js','maquinas.js'),'utf8');

function functionSource(name){
  const marker=`function ${name}(`;
  const start=SOURCE.indexOf(marker);
  assert.notEqual(start,-1,`falta ${name}`);
  const body=SOURCE.indexOf('{',start);
  let depth=0;
  for(let i=body;i<SOURCE.length;i++){
    if(SOURCE[i]==='{')depth++;
    else if(SOURCE[i]==='}'&&--depth===0)return SOURCE.slice(start,i+1);
  }
  throw new Error(`no se pudo aislar ${name}`);
}

function telemetryApi(){
  const context={Date,Math,Number,String,Object,Array,JSON,_printerLightApplyStatus:()=>null};
  vm.createContext(context);
  vm.runInContext([
    functionSource('_crealityColor'),
    functionSource('_extractFilamentTelemetry'),
    functionSource('_deriveStatus'),
    'this.api={extract:_extractFilamentTelemetry,derive:_deriveStatus};',
  ].join('\n'),context);
  return context.api;
}

function statusApi(initial={}){
  const context={
    Date,Math,
    _OFFLINE_AFTER_FAILS:3,
    _failCount:{},_nextPollAt:{},_printerStatus:{...initial},_tempHistory:{},
    getPrinterIp:()=> '192.168.100.71',
    _emitPrinterStatus:()=>{},checkTransitions:()=>{},
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('_printerInitialStatus'),
    functionSource('_applyStatus'),
    'this.apply=_applyStatus;',
  ].join('\n'),context);
  return context;
}

test('K2 interpreta sensor físico, portarrollos y temperatura de cámara',()=>{
  const {extract}=telemetryApi();
  const result=extract({
    'filament_switch_sensor filament_sensor':{filament_detected:true},
    filament_rack:{remain_material_color:'FF12ABEF',remain_material_type:'PLA'},
    box:{state:'disconnected',enable:0},
    'temperature_sensor chamber_temp':{temperature:34.74},
  });
  assert.equal(result.detected,true);
  assert.equal(result.source,'rack');
  assert.equal(result.cfsConnected,false);
  assert.equal(result.chamber,34.7);
  assert.equal(result.color,'#12ABEF');
  assert.equal(result.materialCode,'PLA');
});

test('K2 interpreta CFS conectado y omite slots sin material',()=>{
  const {extract}=telemetryApi();
  const result=extract({
    'filament_switch_sensor filament_sensor':{filament_detected:true},
    box:{
      state:'ready',enable:1,auto_refill:1,
      T1:{remain_len:[850,-1],color_value:['FF112233','FFFFFFFF'],material_type:['PETG','PLA']},
    },
  });
  assert.equal(result.source,'cfs');
  assert.equal(result.cfsConnected,true);
  assert.equal(result.cfsAutoRefill,true);
  assert.equal(result.cfsSlots.length,1);
  assert.deepEqual({...result.cfsSlots[0]},{slot:'T1A',remain:850,color:'#112233',material:'PETG'});
});

test('estado Moonraker conserva impresión, progreso y sensores K2',()=>{
  const {derive}=telemetryApi();
  const result=derive({id:'k2-2'}, {
    print_stats:{state:'printing',filename:'pieza.gcode',print_duration:930,filament_used:1234},
    virtual_sdcard:{progress:.93},
    webhooks:{state:'ready'},
    extruder:{temperature:221.4,target:220},heater_bed:{temperature:59.8,target:60},
    'filament_switch_sensor filament_sensor':{filament_detected:true},
  },'192.168.100.71');
  assert.equal(result.state,'printing');
  assert.equal(result.progress,93);
  assert.equal(result.progressRaw,93);
  assert.equal(result.filename,'pieza');
  assert.equal(result.hotend.actual,221);
  assert.equal(result.bed.actual,60);
  assert.equal(result.filament.detected,true);
  assert.ok(result.lastSeenAt>0);
});

test('dos fallos iniciales siguen conectando y el tercero declara desconexión',()=>{
  const context=statusApi(),machine={id:'k2-2'};
  const failure={state:'offline',_fetchFail:true,connectionError:'timeout',checkedAt:Date.now()};
  context.apply(machine,failure);
  assert.equal(context._printerStatus[machine.id].state,'connecting');
  assert.equal(context._printerStatus[machine.id].attempt,1);
  context.apply(machine,failure);
  assert.equal(context._printerStatus[machine.id].state,'connecting');
  assert.equal(context._printerStatus[machine.id].attempt,2);
  context.apply(machine,failure);
  assert.equal(context._printerStatus[machine.id].state,'offline');
});

// Una impresora encendida e imprimiendo con Moonraker caído NO puede verse
// igual que una desenchufada: son la misma respuesta de red y acciones opuestas.
function failureApi(probePorts){
  const context={
    Date,Math,Object,Promise,AbortSignal:{timeout:()=>null},
    _isLocalMode:()=>true,
    _appendBridgeToken:u=>u,
    getPrinterTunnel:()=>'https://tunel',
    fetch:async url=>{
      const port=Number(String(url).split(':')[2]?.split('/')[0]);
      if(probePorts.includes(port))return{status:200};
      throw new Error('conexión rechazada');
    },
  };
  vm.createContext(context);
  vm.runInContext([
    SOURCE.slice(SOURCE.indexOf('const _ALIVE_PROBE_PORTS'),SOURCE.indexOf('async function fetchPrinterStatus')),
    'this.fail=_printerFetchFailure;this.cache=_aliveProbe;',
  ].join('\n'),context);
  return context;
}

test('una impresora que responde en su UI web queda como telemetría caída, no offline',async()=>{
  const ctx=failureApi([4408]);
  const st=await ctx.fail('k1-4','192.168.100.68','No se pudo alcanzar Moonraker');
  assert.equal(st.state,'apidown');
  assert.equal(st.alivePort,4408);
  assert.equal(st.connectionError,'No se pudo alcanzar Moonraker');
});

test('una impresora que no responde en ningún puerto sigue siendo offline',async()=>{
  const ctx=failureApi([]);
  const st=await ctx.fail('k1-1','192.168.100.51','Tiempo de espera agotado al consultar Moonraker');
  assert.equal(st.state,'offline');
  assert.equal(st.alivePort,undefined);
});

test('el sondeo se cachea por máquina para no repetirse en cada ciclo',async()=>{
  const ctx=failureApi([80]);
  await ctx.fail('k1-3','192.168.100.7','sin respuesta');
  const primera=ctx.cache['k1-3'].at;
  await ctx.fail('k1-3','192.168.100.7','sin respuesta');
  assert.equal(ctx.cache['k1-3'].at,primera,'no debe re-sondear dentro de la ventana de caché');
  assert.equal(ctx.cache['k1-3'].port,80);
});

test('un fallo transitorio conserva la última impresión conocida',()=>{
  const context=statusApi({'k2-2':{state:'printing',progress:61,lastSeenAt:12345}}),machine={id:'k2-2'};
  context.apply(machine,{state:'offline',_fetchFail:true,connectionError:'timeout',checkedAt:Date.now()});
  assert.equal(context._printerStatus[machine.id].state,'printing');
  assert.equal(context._printerStatus[machine.id].progress,61);
  assert.equal(context._printerStatus[machine.id].stale,true);
  assert.equal(context._printerStatus[machine.id].lastSeenAt,12345);
});
