#!/usr/bin/env node
'use strict';
// Canario del formulario web: una vez al día comprueba desde fuera que las
// fichas siguen entrando al CRM. Nace del incidente del 2026-08-18, cuando los
// formularios entregaron los leads SOLO por email durante casi un mes sin que
// nada fallara a la vista.

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const WORKER=fs.readFileSync(path.join(__dirname,'..','lead-worker','src','index.js'),'utf8');

function functionSource(name){
  const marker=`async function ${name}(`;
  const start=WORKER.indexOf(marker);
  assert.notEqual(start,-1,`falta ${name}`);
  const body=WORKER.indexOf('{',start);
  let depth=0;
  for(let i=body;i<WORKER.length;i++){
    if(WORKER[i]==='{')depth++;
    else if(WORKER[i]==='}'&&--depth===0)return WORKER.slice(start,i+1);
  }
  throw new Error(`no se pudo aislar ${name}`);
}

// Aísla el canario con fetch simulado: registra qué avisó, sin red ni correos.
function canarioApi(respuesta){
  const avisos=[];
  const context={
    Date,JSON,String,Number,console:{error:()=>{}},
    AbortSignal:{timeout:()=>null},
    LEAD_FORM_HEALTH_URL:'https://thelab.solutions/api/lead/health',
    urlsConsultadas:[],
    fetch:async url=>{
      context.urlsConsultadas.push(String(url));
      if(respuesta instanceof Error)throw respuesta;
      return{status:respuesta.status??200,json:async()=>{
        if(respuesta.cuerpo===undefined)throw new Error('no es JSON');
        return respuesta.cuerpo;
      }};
    },
    sendLeadFormBrokenAlert:async(env,motivo,detalle)=>{avisos.push({motivo,detalle});},
  };
  vm.createContext(context);
  vm.runInContext(functionSource('checkLeadFormHealth')+'\nthis.check=checkLeadFormHealth;',context);
  return{run:env=>context.check(env||{}),avisos,ctx:context};
}

test('si el formulario entrega, el canario se calla',async()=>{
  const c=canarioApi({cuerpo:{ok:true,endpointConfigured:true,keyConfigured:true}});
  await c.run();
  assert.equal(c.avisos.length,0,'un canario que canta todos los días deja de escucharse');
  assert.equal(c.ctx.urlsConsultadas.length,1);
});

test('si el sitio dice que NO entrega, avisa con el detalle',async()=>{
  const c=canarioApi({cuerpo:{ok:false,endpointConfigured:false,keyConfigured:true}});
  await c.run();
  assert.equal(c.avisos.length,1);
  assert.match(c.avisos[0].motivo,/NO entregan al CRM/);
  assert.match(c.avisos[0].detalle,/"endpointConfigured":false/,'el aviso lleva qué falta, no solo que algo falla');
});

test('un sitio que no responde también es una alerta, no un silencio',async()=>{
  const c=canarioApi(new Error('network timeout'));
  await c.run();
  assert.equal(c.avisos.length,1,'no poder comprobarlo NO es estar sano');
  assert.match(c.avisos[0].detalle,/network timeout/);
});

test('una respuesta ilegible no se confunde con estar sano',async()=>{
  const c=canarioApi({status:404});
  await c.run();
  assert.equal(c.avisos.length,1);
  assert.match(c.avisos[0].motivo,/no se pudo leer \(HTTP 404\)/);
});

test('el canario corre una vez al día, no en cada cron',()=>{
  const sched=WORKER.slice(WORKER.indexOf('async scheduled('),WORKER.indexOf('/* ═',WORKER.indexOf('async scheduled(')));
  assert.match(sched,/getUTCHours\(\) === 7/,'va en el bloque diario');
  assert.match(sched,/ctx\.waitUntil\(checkLeadFormHealth\(env\)\)/);
  const diario=sched.slice(sched.indexOf('getUTCHours'));
  assert.ok(diario.includes('checkLeadFormHealth'),'dentro del if diario, no suelto en cada tick');
});

test('el aviso explica dónde mirar y no inventa un endpoint distinto',()=>{
  const alerta=functionSource('sendLeadFormBrokenAlert');
  assert.match(alerta,/LEAD_ENDPOINT/,'dice qué variable revisar');
  assert.match(alerta,/api\/lead\/health/,'y cómo comprobarlo a mano');
  assert.match(alerta,/RESEND_API_KEY/,'sin clave de correo no intenta enviar');
  assert.match(WORKER,/const LEAD_FORM_HEALTH_URL = "https:\/\/thelab\.solutions\/api\/lead\/health"/);
});
