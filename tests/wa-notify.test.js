#!/usr/bin/env node
'use strict';
// Avisos internos por WhatsApp (fase 1): leads, recordatorios diarios e
// impresoras, enviados desde el servidor y no desde el navegador.

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const WORKER=fs.readFileSync(path.join(ROOT,'lead-worker','src','index.js'),'utf8');
const TOML=fs.readFileSync(path.join(ROOT,'lead-worker','wrangler.toml'),'utf8');
const CONTROLLER=fs.readFileSync(path.join(ROOT,'printer-bridge','farm-controller.js'),'utf8');
const wa=()=>import(path.join(ROOT,'lead-worker','src','wa-notify.js'));
const {detectPrintEvent}=require(path.join(ROOT,'printer-bridge','print-notify.js'));

const ENV={WATI_API_URL:'https://wati.test/123',WATI_API_TOKEN:'tok',WA_PHONE_NICANOR:'56971806142',WA_PHONE_GUSTAVO:'+56 9 8828 5822'};
function kv(){const m=new Map();return{m,get:async k=>m.get(k)??null,put:async(k,v)=>{m.set(k,v);}};}
function fakeFetch(respuestas){
  const calls=[];
  global.fetch=async(url,opts)=>{
    calls.push({url:String(url),body:opts?.body?JSON.parse(opts.body):null,headers:opts?.headers});
    const r=respuestas.shift()||{status:200,body:{result:true}};
    return{ok:r.status<300,status:r.status,json:async()=>r.body};
  };
  return calls;
}

test('enrutamiento pedido: leads a ambos; cotizaciones a Nicanor; pedidos e impresoras a Gustavo',async()=>{
  const {WA_RUTAS}=await wa();
  assert.deepEqual(WA_RUTAS.lead,['nicanor','gustavo']);
  assert.deepEqual(WA_RUTAS.cotizacion_envio,['nicanor']);
  assert.deepEqual(WA_RUTAS.pedido_vencimiento,['gustavo']);
  assert.deepEqual(WA_RUTAS.impresora,['gustavo']);
});

test('sin credenciales WATI no intenta enviar nada',async()=>{
  const {waNotify}=await wa();
  const calls=fakeFetch([]);
  const res=await waNotify({WA_PHONE_NICANOR:'569'},'cotizacion_envio',{titulo:'x'});
  assert.equal(calls.length,0);
  assert.equal(res[0].skipped,'wati-no-configurado');
});

test('WA_NOTIFY_ENABLED=false apaga los avisos aunque haya credenciales',async()=>{
  const {waEnabled}=await wa();
  assert.equal(waEnabled(ENV),true);
  assert.equal(waEnabled({...ENV,WA_NOTIFY_ENABLED:'false'}),false);
});

test('lead avisa a Nicanor y Gustavo, con teléfono solo en dígitos, y no repite el mismo cliente',async()=>{
  const {waNotify,mensajeLead}=await wa();
  const env={...ENV,RL:kv()};
  const calls=fakeFetch([]);
  const msg=mensajeLead({name:'Juan',company:'Acme',service:'Trofeos',phone:'+56911112222'},'google_ads');
  await waNotify(env,'lead',msg,{dedupKey:'recX'});
  assert.equal(calls.length,2);
  assert.match(calls[0].url,/sendSessionMessage\/56971806142\?/);
  assert.match(calls[1].url,/sendSessionMessage\/56988285822\?/);
  assert.equal(calls[0].headers.Authorization,'Bearer tok');
  assert.match(calls[0].body.messageText,/Nuevo lead[\s\S]*Juan — Acme[\s\S]*Google Ads/);
  const again=await waNotify(env,'lead',msg,{dedupKey:'recX'});
  assert.equal(calls.length,2,'el segundo aviso del mismo cliente es duplicado');
  assert.ok(again.every(r=>r.skipped==='duplicado'));
});

test('fuera de la ventana de 24 h cae a la plantilla aprobada, con detalle en una sola línea',async()=>{
  const {waSend}=await wa();
  const calls=fakeFetch([{status:200,body:{result:false,info:'ventana expirada'}},{status:200,body:{result:true}}]);
  const r=await waSend({...ENV,WATI_TEMPLATE_NAME:'aviso_equipo'},'569',{titulo:'Pedidos por vencer',lineas:['• P-1','• P-2']});
  assert.deepEqual(r,{ok:true,via:'template'});
  assert.match(calls[1].url,/sendTemplateMessage\?whatsappNumber=569$/);
  assert.equal(calls[1].body.template_name,'aviso_equipo');
  const detalle=calls[1].body.parameters.find(p=>p.name==='detalle').value;
  assert.doesNotMatch(detalle,/\n/,'Meta rechaza saltos de línea en parámetros');
});

test('un envío fallido no se marca como enviado (se reintenta)',async()=>{
  const {waNotify}=await wa();
  const env={...ENV,RL:kv()};
  fakeFetch([{status:500,body:{}}]);
  const orig=console.error;console.error=()=>{};
  try{await waNotify(env,'impresora',{titulo:'x'},{dedupKey:'e1'});}finally{console.error=orig;}
  assert.equal(env.RL.m.size,0);
});

test('recordatorio de cotización: Solicitada +48 h o fecha límite hoy/mañana; ignora las enviadas',async()=>{
  const {cotizacionesPorEnviar}=await wa();
  const now=new Date('2026-09-24T15:00:00Z');
  const recs=[
    {id:'a',createdTime:'2026-09-20T10:00:00Z',fields:{'Estado cotización':'Solicitada','N° Cotización':'C-1'}},
    {id:'b',createdTime:'2026-09-24T10:00:00Z',fields:{'Estado cotización':'Solicitada','N° Cotización':'C-2','Fecha límite cotización':'2026-09-25'}},
    {id:'c',createdTime:'2026-09-24T10:00:00Z',fields:{'Estado cotización':'Solicitada','N° Cotización':'C-3','Fecha límite cotización':'2026-10-10'}},
    {id:'d',createdTime:'2026-09-01T10:00:00Z',fields:{'Estado cotización':'Enviada','N° Cotización':'C-4'}},
  ];
  assert.deepEqual(cotizacionesPorEnviar(recs,now).map(c=>c.num),['C-2','C-1']);
});

test('recordatorio de pedidos: atrasados y entrega en ≤2 días, sin los cerrados',async()=>{
  const {pedidosPorVencer,mensajePedidos}=await wa();
  const now=new Date('2026-09-24T15:00:00Z');
  const recs=[
    {id:'1',fields:{'N° Pedido':'P-1','Fecha entrega':'2026-09-22','Estado pedido':'En producción'}},
    {id:'2',fields:{'N° Pedido':'P-2','Fecha entrega':'2026-09-26','Estado pedido':'Confirmado'}},
    {id:'3',fields:{'N° Pedido':'P-3','Fecha entrega':'2026-09-30','Estado pedido':'Confirmado'}},
    {id:'4',fields:{'N° Pedido':'P-4','Fecha entrega':'2026-09-23','Estado pedido':'Despachado'}},
  ];
  const items=pedidosPorVencer(recs,now);
  assert.deepEqual(items.map(p=>p.num),['P-1','P-2']);
  const txt=mensajePedidos(items).lineas.join('\n');
  assert.match(txt,/P-1 — ATRASADO 2d/);
  assert.match(txt,/P-2 — entrega en 2d/);
});

test('el resumen diario sale solo a la hora configurada de Chile y una vez por día',async()=>{
  const {waDailyReminders,horaChile}=await wa();
  const env={...ENV,RL:kv(),AIRTABLE_TOKEN:'pat',AIRTABLE_BASE_ID:'app',WA_DIGEST_HOUR:'9'};
  const nueve=new Date('2026-09-24T12:17:00Z');
  assert.equal(horaChile(nueve),9);
  const pedidos={records:[{id:'1',fields:{'N° Pedido':'P-1','Fecha entrega':'2026-09-24','Estado pedido':'Confirmado'}}]};
  const calls=[];
  global.fetch=async(url,opts)=>{
    const u=String(url);calls.push(u);
    if(u.includes('api.airtable.com')) return{ok:true,status:200,json:async()=>u.includes('/Pedidos?')?pedidos:{records:[]}};
    return{ok:true,status:200,json:async()=>({result:true})};
  };
  assert.equal((await waDailyReminders(env,new Date('2026-09-24T13:17:00Z'))).skipped,'fuera-de-hora');
  await waDailyReminders(env,nueve);
  const envios=()=>calls.filter(u=>u.includes('wati.test')).length;
  assert.equal(envios(),1,'solo Gustavo recibe el de pedidos; sin cotizaciones no se avisa a Nicanor');
  await waDailyReminders(env,nueve);
  assert.equal(envios(),1,'la segunda corrida del mismo día no repite');
});

test('impresora: avisa terminada y error, solo tras verla imprimiendo',()=>{
  assert.equal(detectPrintEvent(undefined,{state:'complete'}),null,'al arrancar no sabemos si ya se avisó');
  assert.equal(detectPrintEvent({state:'standby'},{state:'complete'}),null);
  assert.deepEqual(detectPrintEvent({state:'printing'},{state:'complete'}),{state:'complete',message:''});
  assert.equal(detectPrintEvent({state:'printing'},{state:'error',message:'key 2016'}).state,'error');
  assert.equal(detectPrintEvent({state:'printing'},{state:'',klipper:'shutdown',klipperMessage:'MCU'}).message,'MCU');
  assert.equal(detectPrintEvent({state:'printing'},{state:'paused',message:''}),null,'pausa manual no avisa');
  assert.equal(detectPrintEvent({state:'printing'},{state:'paused',message:'Filament runout'}).state,'paused');
  assert.equal(detectPrintEvent({state:'complete'},{state:'complete'}),null,'no repite');
});

test('cableado: el Worker avisa leads, corre el resumen y protege /notify con WA_NOTIFY_KEY',()=>{
  assert.match(WORKER,/import \{[^}]*waNotify[^}]*\} from "\.\/wa-notify\.js"/);
  assert.match(WORKER,/waNotify\(env, "lead", mensajeLead\(norm, source, \{ recurrente \}\)/);
  assert.match(WORKER,/waDailyReminders\(env, new Date\(event\.scheduledTime/);
  assert.match(WORKER,/!env\.WA_NOTIFY_KEY \|\| !timingSafeEqual\(key, env\.WA_NOTIFY_KEY\)/);
  assert.match(TOML,/WA_PHONE_NICANOR = "56971806142"/);
  assert.match(TOML,/WA_PHONE_GUSTAVO = "56988285822"/);
  assert.doesNotMatch(TOML,/^WATI_API_TOKEN\s*=/m,'el token va como secreto, nunca en el toml');
  assert.match(CONTROLLER,/require\('\.\/print-notify'\)\.start\(\)/);
});
