#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.join(__dirname,'..');
const MOD=fs.readFileSync(path.join(ROOT,'js','maquinas-informe-tecnico.js'),'utf8');
const OPS=fs.readFileSync(path.join(ROOT,'js','maquinas-operaciones.js'),'utf8');
const MAQ=fs.readFileSync(path.join(ROOT,'js','maquinas.js'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const bridge=require('../printer-bridge/server.js');

function loadModule(extra={}){
  const ctx={window:{},location:{href:'https://dashboard.thelab.solutions/'},URL,Blob:function(){},setTimeout,console,...extra};
  vm.createContext(ctx);vm.runInContext(MOD,ctx);
  return ctx.window.MachineReport;
}

test('cada tarjeta de Máquinas expone el botón INFORME y el módulo carga después de MachineOps',()=>{
  assert.equal((MAQ.match(/MachineReport\.open\('\$\{m\.id\}'\)/g)||[]).length,2);
  assert.match(MAQ,/🩺 INFORME/);
  const ops=INDEX.indexOf('js/maquinas-operaciones.js'),rep=INDEX.indexOf('js/maquinas-informe-tecnico.js');
  assert.ok(rep>ops,'el informe técnico debe cargar después de maquinas-operaciones.js');
});

test('el modo informe técnico reutiliza la Auditoría V3 sellada y agrega el bloque report',()=>{
  assert.match(OPS,/technicalReport=opts\.technicalReport===true/);
  assert.match(OPS,/evidence\.controlledTests=/);
  assert.match(OPS,/if\(opts\.technicalReport\)payload\.max_tokens=4000;/);
  assert.match(OPS,/report:_normalizeTechnicalReport\(raw\.report\)/);
  assert.match(OPS,/downloadPrinterAuditPdf/);
});

test('las pruebas físicas siempre apagan calentador y ventiladores al terminar',()=>{
  assert.match(MOD,/finally\{\s*await gcode\(id,'M104 S0'\);/);
  assert.match(MOD,/finally\{\s*\/\/ Estado seguro siempre[\s\S]*?M104 S0[\s\S]*?c\.off/);
  assert.match(MOD,/temp>target\+OVERHEAT_MARGIN/);
  assert.match(MOD,/klState!=='ready'/);
  assert.match(MOD,/confirm\('Pruebas controladas/);
});

test('comandos de ventilador según el tipo de objeto Klipper',()=>{
  const R=loadModule();
  assert.deepEqual({...R._test.fanCommands('fan')},{on:'M106 S255',off:'M107',usage:'Ventilador de pieza'});
  assert.equal(R._test.fanCommands('output_pin fan2').on,'M106 P2 S255');
  assert.equal(R._test.fanCommands('output_pin fan2').off,'M106 P2 S0');
  assert.equal(R._test.fanCommands('fan_generic aux').off,'SET_FAN_SPEED FAN=aux SPEED=0');
  assert.equal(R._test.fanCommands('heater_fan hotend_fan'),null);
  assert.deepEqual({...R._test.fanReading({value:1,rpm:0})},{value:1,rpm:0});
});

test('pruebas bloqueadas si la impresora está imprimiendo o caliente',()=>{
  const status={a:{state:'printing',hotend:{actual:210}},b:{state:'standby',hotend:{actual:150}},c:{state:'standby',hotend:{actual:30}}};
  const R=loadModule({_printerStatus:status,_printerControlFresh:()=>true,_printerPhysicallyBusy:()=>false});
  assert.equal(R._test.testEligibility('a').ok,false);
  assert.equal(R._test.testEligibility('b').ok,false);
  assert.equal(R._test.testEligibility('c').ok,true);
});

test('el PDF usa la identidad de la cotización y escapa el texto de la IA',()=>{
  const R=loadModule({MAQUINAS:[{id:'k1',modelo:'Creality K1',nombre:'K1-DC01',numG:3}]});
  const html=R.buildDoc({id:'audit-1',machineId:'k1',createdAt:'2026-10-05T15:00:00Z',
    result:{overall:'critical',score:40,findings:[],report:{severity:'alta',banner:'<script>x</script>',conclusion:{probableCause:'falla <b>termistor</b>'},repairPlan:['Reconectar']}},
    evidence:{dashboard:{machine:{ip:'192.168.100.51',model:'Creality K1'}},scan:{logForensics:{files:[{file:'klippy.log',matches:2,codes:{key564:2}}]}},
      controlledTests:{fans:[{name:'output_pin fan0',usage:'Pieza',accepted:true,valueOn:1}],heat:{target:220,startTemp:25,errors:[],heatToNear200Sec:44,reachSec:52,overshootMax:222.7,overshoot:2.7,series:[[0,25,220,1],[2,33,220,1],[4,41,220,1],[6,49,220,1]]}}}});
  assert.match(html,/INF-261005-03/);
  assert.match(html,/logo-thelab-black\.png/);
  assert.match(html,/#00d4cc/);
  assert.match(html,/urgente-strip/);
  assert.match(html,/Gravedad alta/);
  assert.doesNotMatch(html,/<script>x<\/script>/);
  assert.match(html,/falla &lt;b&gt;termistor&lt;\/b&gt;/);
  assert.match(html,/<svg/);
  assert.match(html,/counter\(page\)/);
});

test('bridge: forense de logs de solo lectura y parseo por archivo',()=>{
  const script=bridge.diagnosticLogForensicsScript();
  assert.match(script,/klippy\.log\*/);
  assert.doesNotMatch(script,/SAVE_CONFIG|FIRMWARE_RESTART|reboot|systemctl/);
  const out=['@@DIR /usr/data/printer_data/logs','@@LS -rw-r--r-- 1 0 0 52000000 Sep 28 20:34 klippy.log','@@FILE /usr/data/printer_data/logs/klippy.log','@@COUNT 3',
    '@@HIT {"code":"key564","msg":"Heater extruder not heating at expected rate"}','@@HIT MCU \'nozzle_mcu\' shutdown: ADC out of range',
    '@@FILE /usr/data/printer_data/logs/klippy.log.2026-09-23','@@COUNT 0'].join('\n');
  const r=bridge.parseLogForensics(out);
  assert.equal(r.files.length,2);
  assert.equal(r.files[0].file,'klippy.log');
  assert.equal(r.files[0].matches,3);
  assert.equal(r.files[0].codes.key564,1);
  assert.equal(r.files[0].codes['ADC out of range'],1);
  assert.equal(r.files[1].matches,0);
});

test('bridge: configfile reducido a secciones térmicas y temperature_store muestreado',()=>{
  const cfg=bridge.reduceAuditConfigfile({result:{status:{configfile:{save_config_pending:true,save_config_pending_items:{extruder:{pid_kp:'21.371'}},settings:{extruder:{pid_kp:25.013},'gcode_macro START':{gcode:'x'},'output_pin fan0':{pwm:true}}}}}});
  assert.equal(cfg.saveConfigPending,true);
  assert.ok(cfg.settings.extruder);
  assert.ok(cfg.settings['output_pin fan0']);
  assert.equal(cfg.settings['gcode_macro START'],undefined);
  const ts=bridge.summarizeTemperatureStore({result:{extruder:{temperatures:Array.from({length:20},(_,i)=>i),targets:Array(20).fill(220)}}});
  assert.equal(ts.intervalSec,5);
  assert.deepEqual(ts.series.extruder.temperatures,[0,5,10,15]);
});
