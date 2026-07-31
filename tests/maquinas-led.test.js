#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.join(__dirname,'..');
const LED=fs.readFileSync(path.join(ROOT,'js','maquinas-led.js'),'utf8');
const MAQ=fs.readFileSync(path.join(ROOT,'js','maquinas.js'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');

function loadLights(){
  const context={console,Date,Math,JSON,String,Number,Array,Object,Set,Promise,encodeURIComponent};
  context.window=context;
  vm.createContext(context);
  vm.runInContext(LED,context,{filename:'maquinas-led.js'});
  return context.PrinterLights._test;
}

function memoryStorage(){
  const values=new Map();
  return{getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
}

test('autodetección prioriza la luz de cámara y descarta LEDs de estado',()=>{
  const lights=loadLights();
  const cap=lights.chooseCapability([
    'output_pin status_led',
    'neopixel toolhead_led',
    'output_pin caselight',
  ],[]);
  assert.equal(cap.kind,'pin');
  assert.equal(cap.object,'output_pin caselight');
  assert.equal(cap.name,'caselight');
});

test('autodetección admite macros ON/OFF y M355 como respaldo',()=>{
  const lights=loadLights();
  const pair=lights.chooseCapability([],['G28','CASE_LIGHT_ON','CASE_LIGHT_OFF']);
  assert.equal(pair.onScript,'CASE_LIGHT_ON');
  assert.equal(pair.offScript,'CASE_LIGHT_OFF');
  const m355=lights.chooseCapability([],['M355']);
  assert.equal(lights.buildCommand(m355,true),'M355 S1');
  assert.equal(lights.buildCommand(m355,false),'M355 S0');
  const vendorPair=lights.chooseCapability([],['LED_NOZZLE_ON','LED_NOZZLE_OFF']);
  assert.equal(vendorPair.onScript,'LED_NOZZLE_ON');
  assert.equal(vendorPair.offScript,'LED_NOZZLE_OFF');
});

test('configuración manual valida nombres y bloquea inyección de G-code',()=>{
  const lights=loadLights();
  assert.equal(lights.parseOverride('output_pin case_light').object,'output_pin case_light');
  assert.equal(lights.parseOverride('LIGHT_ON/LIGHT_OFF').kind,'macro');
  assert.ok(lights.parseOverride('LIGHT_ON/M105\nFIRMWARE_RESTART').error);
  assert.ok(lights.parseOverride('output_pin case light').error);
});

test('genera SET_PIN y SET_LED deterministas para encender y apagar',()=>{
  const lights=loadLights();
  assert.equal(lights.buildCommand({available:true,kind:'pin',name:'caselight'},true),'SET_PIN PIN=caselight VALUE=1');
  assert.equal(lights.buildCommand({available:true,kind:'pin',name:'caselight'},false),'SET_PIN PIN=caselight VALUE=0');
  const rgbw={available:true,kind:'led',name:'chamber_led',lastColor:[0.2,0.3,0.4,0.5]};
  assert.equal(lights.buildCommand(rgbw,true),'SET_LED LED=chamber_led RED=0.2 GREEN=0.3 BLUE=0.4 WHITE=0.5 SYNC=0');
  assert.equal(lights.buildCommand(rgbw,false),'SET_LED LED=chamber_led RED=0 GREEN=0 BLUE=0 WHITE=0 SYNC=0');
});

test('lee el estado real de output_pin y LEDs RGB',()=>{
  const lights=loadLights();
  assert.deepEqual({...lights.readStatus({kind:'pin',object:'output_pin caselight'},{'output_pin caselight':{value:1}})},{on:true});
  const led=lights.readStatus({kind:'led',object:'neopixel chamber'},{'neopixel chamber':{color_data:[[0,0.5,0]]}});
  assert.equal(led.on,true);
  assert.deepEqual(Array.from(led.colors),[0,0.5,0]);
});

test('la UI consulta, suscribe y expone el control LED por impresora',()=>{
  assert.ok(INDEX.includes('js/maquinas-led.js?v=%%BUILD%%'));
  assert.ok(INDEX.includes('id="printerConnLight"'));
  assert.match(MAQ,/_printerLightQuerySuffix\(m\.id\)/);
  assert.match(MAQ,/_printerLightWsObjects\(m\.id\)/);
  assert.match(MAQ,/_renderPrinterLightButton\(m\.id\)/);
  assert.match(LED,/_sendGcode\(id,script,[\s\S]*\{allowBusy:true\}\)/);
});

test('el botón detecta y enciende la luz aun durante una impresión',async()=>{
  const sent=[];
  const context={
    console,Date,Math,JSON,String,Number,Array,Object,Set,Promise,encodeURIComponent,
    localStorage:memoryStorage(),MAQUINAS:[{id:'k1-1',nombre:'K1',numG:1}],
    _printerStatus:{'k1-1':{state:'printing'}},_wsConn:{},
    getPrinterIp:()=> '192.168.1.20',renderMonitorGrid:()=>{},toast:()=>{},
    document:{getElementById:()=>null},
    _moonrakerGet:async(_id,path)=>path==='/printer/objects/list'
      ?{result:{objects:['output_pin LED']}}
      :path==='/printer/gcode/help'?{result:{G28:'Home'}}:{result:{status:{'output_pin LED':{value:0}}}},
    _sendGcode:async(_id,script,_label,opts)=>{sent.push({script,opts});return true;},
  };
  context.window=context;
  vm.createContext(context);
  vm.runInContext(LED,context,{filename:'maquinas-led.js'});
  await context.togglePrinterLight('k1-1');
  assert.equal(sent.length,1);
  assert.equal(sent[0].script,'SET_PIN PIN=LED VALUE=1');
  assert.equal(sent[0].opts.allowBusy,true);
});
