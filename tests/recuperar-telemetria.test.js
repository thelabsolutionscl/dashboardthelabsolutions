#!/usr/bin/env node
'use strict';
// Recuperación de telemetría: una impresora viva con Moonraker caído se
// levanta desde el dashboard (botón) → bridge del taller (SSH) → impresora.

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const BRIDGE=fs.readFileSync(path.join(__dirname,'..','printer-bridge','server.js'),'utf8');
const MAQ=fs.readFileSync(path.join(__dirname,'..','js','maquinas.js'),'utf8');

function functionSource(source,name){
  const marker=`function ${name}(`;
  const start=source.indexOf(marker);
  assert.notEqual(start,-1,`falta ${name}`);
  const body=source.indexOf('{',start);
  let depth=0;
  for(let i=body;i<source.length;i++){
    if(source[i]==='{')depth++;
    else if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error(`no se pudo aislar ${name}`);
}

// El bridge se importa entero levantaría un servidor: se aíslan sus funciones puras.
function bridgeApi(env={}){
  const context={
    process:{env:{...env}},
    SSH_USER:env.PRINTER_SSH_USER||'root',
    SSH_PASS:env.PRINTER_SSH_PASS||'',
    SSH_KEY:env.PRINTER_SSH_KEY||'',
    Object,String,Array,
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource(BRIDGE,'moonrakerRecoverScript'),
    functionSource(BRIDGE,'recoverSshCommand'),
    functionSource(BRIDGE,'isPrivateIp'),
    'this.api={script:moonrakerRecoverScript,ssh:recoverSshCommand,priv:isPrivateIp};',
  ].join('\n'),context);
  return context.api;
}

test('el guion repone moonraker.conf y reinicia el servicio de cualquier modelo',()=>{
  const {script}=bridgeApi();
  const s=script();
  assert.match(s,/\.moonraker\.conf\.bkp/,'debe reponer la config desde el respaldo (causa real de los incidentes)');
  assert.match(s,/\/etc\/init\.d\/S56moonraker_service/,'K1');
  assert.match(s,/\/etc\/init\.d\/moonraker\b/,'Ender-5 Max');
  assert.match(s,/systemctl restart moonraker/,'Klipper genérica');
  assert.match(s,/\/usr\/data\/printer_data\/config/,'Buildroot (K1 / Ender-5 Max)');
  assert.match(s,/\/mnt\/UDISK\/printer_data\/config/,'Tina/OpenWrt (K2)');
  assert.doesNotMatch(s,/FIRMWARE_RESTART|systemctl restart klipper/,'jamás debe tocar Klipper: puede haber una impresión en curso');
});

test('la IP viaja como argumento, nunca concatenada a una shell',()=>{
  const {ssh}=bridgeApi();
  const {cmd,args}=ssh('192.168.100.7');
  assert.equal(cmd,'ssh');
  assert.ok(args.includes('root@192.168.100.7'),'destino como argumento propio');
  assert.ok(args.includes('BatchMode=yes'),'sin llave no debe quedarse esperando una contraseña');
  // El guion va como UN argumento: ssh no lo re-parte y no hay shell local.
  assert.equal(args[args.length-1],ssh('192.168.100.7').args[args.length-1]);
  assert.ok(args.filter(a=>a.includes('\n')).length===1,'el guion es un solo argumento');
});

test('con contraseña la clave va por entorno, no en la línea de comandos',()=>{
  const {ssh}=bridgeApi({PRINTER_SSH_PASS:'creality'});
  const {cmd,args,env}=ssh('192.168.100.68');
  assert.equal(cmd,'sshpass');
  assert.ok(args.includes('-e'),'sshpass -e lee SSHPASS del entorno');
  assert.equal(env.SSHPASS,'creality');
  assert.ok(!args.includes('creality'),'la contraseña no puede aparecer en argv (visible en ps)');
  assert.ok(!args.includes('BatchMode=yes'),'BatchMode impediría la autenticación por contraseña');
});

test('una llave explícita se usa y excluye a las demás',()=>{
  const {ssh}=bridgeApi({PRINTER_SSH_KEY:'/Users/lab/.ssh/printers'});
  const {args}=ssh('192.168.100.95');
  assert.ok(args.includes('-i')&&args.includes('/Users/lab/.ssh/printers'));
  assert.ok(args.includes('IdentitiesOnly=yes'));
});

test('la ruta /recover exige POST, token, IP privada y no se solapa',()=>{
  assert.match(BRIDGE,/\/\^\\\/recover\\\/\(\\d\{1,3\}\\\.\\d\{1,3\}\\\.\\d\{1,3\}\\\.\\d\{1,3\}\)\$\//,'la ruta valida el formato de la IP');
  const ruta=BRIDGE.slice(BRIDGE.indexOf('const mRec ='),BRIDGE.indexOf('// Mantención: estado de config'));
  assert.match(ruta,/req\.method !== 'POST'/,'GET no debe reiniciar nada');
  assert.match(ruta,/isPrivateIp\(ip\)/,'nunca hacia internet');
  assert.match(ruta,/_recovering\.has\(ip\)/,'dos clics no pueden reiniciar Moonraker en pleno arranque');
  // El token se valida antes, para todas las rutas salvo /healthz
  const auth=BRIDGE.indexOf("if (given !== TOKEN)");
  assert.ok(auth!==-1&&auth<BRIDGE.indexOf('const mRec ='),'la ruta va después del control de token');
  const {priv}=bridgeApi();
  assert.equal(priv('192.168.100.7'),true);
  assert.equal(priv('8.8.8.8'),false);
});

test('la tarjeta de telemetría caída ofrece el botón de recuperación',()=>{
  const tarjeta=MAQ.slice(MAQ.indexOf("} else if(s.state==='apidown')"),MAQ.indexOf("} else if(s.state==='offline')"));
  assert.match(tarjeta,/recoverPrinterTelemetry\('\$\{m\.id\}'\)/,'el botón llama a la recuperación');
  assert.match(tarjeta,/id="recov_\$\{m\.id\}"/,'con id propio para mostrar el progreso');
  assert.match(tarjeta,/No interrumpe la impresión en curso/,'hay que decirlo: la máquina puede estar imprimiendo');
  assert.match(tarjeta,/\$\{escapeHtml\(svc\)\}/,'se mantiene el comando SSH como alternativa manual');
});

test('el dashboard pide la recuperación al bridge, con token y sin bloquear para siempre',()=>{
  const fn=functionSource(MAQ,'recoverPrinterTelemetry');
  assert.match(fn,/\$\{getPrinterTunnel\(\)\}\/recover\/\$\{ip\}/,'va al bridge del taller, no a Moonraker (que está caído)');
  assert.match(fn,/method:'POST'/);
  assert.match(fn,/'X-Bridge-Token':tk/,'autenticado con el token del bridge');
  assert.match(fn,/AbortSignal\.timeout\(_RECOVER_TIMEOUT_MS\)/,'no puede quedarse colgado');
  assert.match(fn,/r\.status===404/,'un bridge sin actualizar debe explicarse, no fallar en silencio');
  assert.match(fn,/delete _aliveProbe\[id\]/,'el sondeo cacheado queda obsoleto tras recuperar');
  assert.match(fn,/pollPrinters\(\)/,'refresca el estado al terminar');
  assert.match(MAQ,/const _RECOVER_TIMEOUT_MS=(\d+)/);
  const ms=Number(MAQ.match(/const _RECOVER_TIMEOUT_MS=(\d+)/)[1]);
  const sshMs=Number(BRIDGE.match(/const RECOVER_SSH_TIMEOUT_MS = (\d+)/)[1]);
  const waitMs=Number(BRIDGE.match(/const RECOVER_WAIT_MS = (\d+)/)[1]);
  assert.ok(ms>sshMs+waitMs,`el dashboard (${ms}ms) debe esperar más que el peor caso del bridge (${sshMs+waitMs}ms)`);
});
