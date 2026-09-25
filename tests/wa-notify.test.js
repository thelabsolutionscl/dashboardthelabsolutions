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
const {detectPrintEvent,nextPrinterState,machineName}=require(path.join(ROOT,'printer-bridge','print-notify.js'));

const ENV={WA_PHONE_NUMBER_ID:'999',WA_ACCESS_TOKEN:'tok',WA_PHONE_NICANOR:'56971806142',WA_PHONE_GUSTAVO:'+56 9 8828 5822'};
function kv(){const m=new Map();return{m,get:async k=>m.get(k)??null,put:async(k,v)=>{m.set(k,v);},delete:async k=>{m.delete(k);}};}
function fakeFetch(respuestas){
  const calls=[];
  global.fetch=async(url,opts)=>{
    calls.push({url:String(url),body:opts?.body?JSON.parse(opts.body):null,headers:opts?.headers});
    const r=respuestas.shift()||{status:200,body:{messages:[{id:'wamid.1'}]}};
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

test('sin credenciales de Meta no intenta enviar nada',async()=>{
  const {waNotify}=await wa();
  const calls=fakeFetch([]);
  const res=await waNotify({WA_PHONE_NICANOR:'569'},'cotizacion_envio',{titulo:'x'});
  assert.equal(calls.length,0);
  assert.equal(res[0].skipped,'whatsapp-no-configurado');
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
  assert.equal(calls[0].url,'https://graph.facebook.com/v25.0/999/messages');
  assert.equal(calls[0].body.to,'56971806142');
  assert.equal(calls[1].body.to,'56988285822');
  assert.equal(calls[0].headers.Authorization,'Bearer tok');
  assert.equal(calls[0].body.messaging_product,'whatsapp');
  assert.match(calls[0].body.text.body,/Nuevo lead[\s\S]*Juan — Acme[\s\S]*Google Ads/);
  const again=await waNotify(env,'lead',msg,{dedupKey:'recX'});
  assert.equal(calls.length,2,'el segundo aviso del mismo cliente es duplicado');
  assert.ok(again.every(r=>r.skipped==='duplicado'));
});

test('ventana de 24 h: texto si la persona escribió hace poco, plantilla si no',async()=>{
  const {waSend,waWebhookEvento}=await wa();
  const env={...ENV,RL:kv(),WA_TEMPLATE_NAME:'aviso_equipo'};
  const calls=fakeFetch([]);
  const msg={titulo:'Pedidos por vencer',lineas:['• P-1','• P-2']};
  assert.deepEqual(await waSend(env,'569',msg),{ok:true,via:'plantilla',id:'wamid.1'});
  const t=calls[0].body.template;
  assert.equal(t.name,'aviso_equipo');
  assert.equal(t.language.code,'es');
  const [titulo,detalle]=t.components[0].parameters.map(p=>p.text);
  assert.equal(titulo,'Pedidos por vencer');
  assert.doesNotMatch(detalle,/\n/,'Meta rechaza saltos de línea en parámetros');
  await waWebhookEvento(env,{entry:[{changes:[{value:{messages:[{from:'569',type:'text'}]}}]}]});
  assert.deepEqual(await waSend(env,'569',msg),{ok:true,via:'texto',id:'wamid.1'});
  assert.equal(calls[1].body.type,'text');
});

test('sin plantilla todavía, intenta el texto igual',async()=>{
  const {waSend}=await wa();
  const calls=fakeFetch([]);
  assert.deepEqual(await waSend({...ENV,RL:kv()},'569',{titulo:'x'}),{ok:true,via:'texto-sin-ventana',id:'wamid.1'});
  assert.equal(calls[0].body.type,'text');
});

test('webhook: verificación de Meta y firma X-Hub-Signature-256 obligatoria',async()=>{
  const {waWebhookVerify,waWebhookFirmaValida}=await wa();
  const env={WA_VERIFY_TOKEN:'v3r1',WA_APP_SECRET:'s3cr3t'};
  const ok=waWebhookVerify(env,new URL('https://w/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=v3r1&hub.challenge=42'));
  assert.equal(ok.status,200);assert.equal(await ok.text(),'42');
  assert.equal(waWebhookVerify(env,new URL('https://w/x?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=42')).status,403);
  const raw='{"entry":[]}';
  const firma='sha256='+require('node:crypto').createHmac('sha256','s3cr3t').update(raw).digest('hex');
  assert.equal(await waWebhookFirmaValida(env,raw,firma),true);
  assert.equal(await waWebhookFirmaValida(env,raw+' ',firma),false);
  assert.equal(await waWebhookFirmaValida({},raw,firma),false,'sin WA_APP_SECRET no se acepta nada');
});

test('Graph API: versión vigente por defecto (v21 ya fue retirada) y configurable',async()=>{
  const {waSend}=await wa();
  const calls=fakeFetch([]);
  await waSend({...ENV,RL:kv()},'569',{titulo:'x'});
  await waSend({...ENV,RL:kv(),WA_GRAPH_VERSION:'v26.0'},'569',{titulo:'x'});
  await waSend({...ENV,RL:kv(),WA_GRAPH_VERSION:'basura/../'},'569',{titulo:'x'});
  assert.deepEqual(calls.map(c=>c.url.split('/')[3]),['v25.0','v26.0','v25.0']);
});

test('plantilla: parámetros acotados para no pasar el límite de 1024 de Meta',async()=>{
  const {waSend}=await wa();
  const calls=fakeFetch([]);
  const lineas=Array.from({length:40},(_,i)=>`• P-${i} (Cliente con nombre bastante largo ${i}) — entrega mañana · En producción`);
  await waSend({...ENV,RL:kv(),WA_TEMPLATE_NAME:'aviso_equipo'},'569',{titulo:'T'.repeat(500),lineas});
  const [t,d]=calls[0].body.template.components[0].parameters.map(p=>p.text);
  assert.ok(t.length<=120&&d.length<=700,`título ${t.length}, detalle ${d.length}`);
  assert.ok(d.endsWith('…'));
});

test('nada se pierde: si el envío falla queda pendiente, se marca y llega cuando la persona escribe',async()=>{
  const {waNotify,waWebhookEvento}=await wa();
  const env={...ENV,RL:kv()};
  const calls=fakeFetch([{status:400,body:{error:{message:'número no válido'}}}]);
  const orig=console.error;console.error=()=>{};
  let res;
  try{res=await waNotify(env,'impresora',{titulo:'Impresión con ERROR — K1 #3',lineas:['key 2016']},{dedupKey:'e1'});}finally{console.error=orig;}
  assert.equal(res[0].ok,false);assert.equal(res[0].pendiente,true);
  assert.ok(env.RL.m.has('wa:impresora:e1:gustavo'),'un reintento no debe duplicarlo');
  const out=await waWebhookEvento(env,{entry:[{changes:[{value:{messages:[{from:'56988285822'}]}}]}]});
  assert.equal(out.pendientesEntregados,1);
  const entrega=calls[1];
  assert.equal(entrega.body.to,'56988285822');
  assert.match(entrega.body.text.body,/Avisos que no te llegaron \(1\)[\s\S]*K1 #3[\s\S]*key 2016/);
  assert.equal(env.RL.m.has('wa:pend:56988285822'),false,'se vacía tras entregar');
});

test('si Meta avisa por webhook que un aviso fuera de ventana falló, pasa a pendientes',async()=>{
  const {waSend,waWebhookEvento}=await wa();
  const env={...ENV,RL:kv()};
  const orig=console.error;console.error=()=>{};
  fakeFetch([{status:200,body:{messages:[{id:'wamid.X'}]}}]);
  try{
    const r=await waSend(env,'569',{titulo:'Pedidos por vencer',lineas:['• P-1']});
    assert.equal(r.via,'texto-sin-ventana');
    await waWebhookEvento(env,{entry:[{changes:[{value:{statuses:[{id:'wamid.X',status:'failed',recipient_id:'569',errors:[{code:131047,title:'Re-engagement message'}]}]}}]}]});
  }finally{console.error=orig;}
  assert.match(JSON.parse(env.RL.m.get('wa:pend:569'))[0].texto,/Pedidos por vencer/);
  assert.equal(env.RL.m.has('wa:msg:wamid.X'),false);
});

test('duración de impresión sin "60m"',async()=>{
  const {mensajeImpresora}=await wa();
  const dur=s=>mensajeImpresora({state:'complete',durationSec:s}).lineas.find(l=>l&&l.startsWith('Duración'));
  assert.equal(dur(3599),'Duración: 1h 0m');
  assert.equal(dur(5400),'Duración: 1h 30m');
  assert.equal(dur(600),'Duración: 10m');
  assert.equal(dur(0),undefined);
});

test('origen de leads de redes con nombre legible',async()=>{
  const {mensajeLead}=await wa();
  assert.ok(mensajeLead({name:'ana'},'ig').lineas.includes('Origen: Instagram'));
  assert.ok(mensajeLead({name:'ana'},'redes').lineas.includes('Origen: Redes sociales'));
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

function airtableFake(tablas,calls){
  global.fetch=async(url,opts)=>{
    const u=String(url);calls.push(u);
    if(u.includes('api.airtable.com')){
      const t=Object.keys(tablas).find(k=>u.includes('/'+k+'?'));
      const v=t?tablas[t]:{records:[]};
      if(v instanceof Error) return{ok:false,status:500,json:async()=>({})};
      return{ok:true,status:200,json:async()=>v};
    }
    return{ok:true,status:200,json:async()=>({messages:[{id:'wamid.1'}]})};
  };
}
const PEDIDOS={records:[{id:'1',fields:{'N° Pedido':'P-1','Fecha entrega':'2026-09-24','Estado pedido':'Confirmado'}}]};

test('el resumen diario sale desde la hora de Chile configurada y una vez por día',async()=>{
  const {waDailyReminders,horaChile}=await wa();
  const env={...ENV,RL:kv(),AIRTABLE_TOKEN:'pat',AIRTABLE_BASE_ID:'app',WA_DIGEST_HOUR:'9'};
  const nueve=new Date('2026-09-24T12:17:00Z');
  assert.equal(horaChile(nueve),9);
  const calls=[];airtableFake({Pedidos:PEDIDOS},calls);
  const envios=()=>calls.filter(u=>u.includes('graph.facebook.com')).length;
  assert.equal((await waDailyReminders(env,new Date('2026-09-24T11:17:00Z'))).skipped,'fuera-de-hora');
  await waDailyReminders(env,nueve);
  assert.equal(envios(),1,'solo Gustavo recibe el de pedidos; sin cotizaciones no se avisa a Nicanor');
  await waDailyReminders(env,new Date('2026-09-24T13:17:00Z'));
  assert.equal(envios(),1,'la pasada siguiente del mismo día no repite');
  const airtablePedidos=calls.filter(u=>u.includes('/Pedidos?')).length;
  assert.equal(airtablePedidos,1,'si ya salió hoy, ni siquiera vuelve a consultar Airtable');
});

test('resumen diario: si el cron de las 9 no corrió, sale en la pasada de las 10 u 11; no después',async()=>{
  const {waDailyReminders}=await wa();
  const env={...ENV,RL:kv(),AIRTABLE_TOKEN:'pat',AIRTABLE_BASE_ID:'app'};
  const calls=[];airtableFake({Pedidos:PEDIDOS},calls);
  assert.equal((await waDailyReminders(env,new Date('2026-09-24T15:17:00Z'))).skipped,'fuera-de-hora','12:17 ya es tarde');
  await waDailyReminders(env,new Date('2026-09-24T14:17:00Z'));
  assert.equal(calls.filter(u=>u.includes('graph.facebook.com')).length,1,'11:17 aún recupera');
});

test('resumen diario: WA_DIGEST_HOUR vacío o inválido usa las 9, no la medianoche',async()=>{
  const {horaResumen}=await wa();
  assert.equal(horaResumen({}),9);
  assert.equal(horaResumen({WA_DIGEST_HOUR:''}),9);
  assert.equal(horaResumen({WA_DIGEST_HOUR:'25'}),9);
  assert.equal(horaResumen({WA_DIGEST_HOUR:'8'}),8);
  assert.equal(horaResumen({WA_DIGEST_HOUR:'0'}),0);
});

test('resumen diario: si Cotizaciones falla en Airtable, el de pedidos sale igual',async()=>{
  const {waDailyReminders}=await wa();
  const env={...ENV,RL:kv(),AIRTABLE_TOKEN:'pat',AIRTABLE_BASE_ID:'app'};
  const calls=[];airtableFake({Cotizaciones:new Error('500'),Pedidos:PEDIDOS},calls);
  const orig=console.error;console.error=()=>{};
  let res;try{res=await waDailyReminders(env,new Date('2026-09-24T12:17:00Z'));}finally{console.error=orig;}
  assert.match(res.cotizaciones.error,/Airtable Cotizaciones 500/);
  assert.equal(res.pedidos[0].ok,true);
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

test('impresora: firmware que resetea al terminar cuenta como finalizada; a medias es interrupción',()=>{
  assert.equal(detectPrintEvent({state:'printing',progress:0.995},{state:'standby'}).state,'complete');
  const corte=detectPrintEvent({state:'printing',progress:0.4},{state:'standby'});
  assert.equal(corte.state,'error');
  assert.match(corte.message,/interrumpió/);
});

test('impresora: sin respuesta 10 min mientras imprime avisa una sola vez',()=>{
  const t0=1_000_000;
  let st={state:'printing',filename:'a.gcode',totalSec:100};
  let r=nextPrinterState(st,null,t0);
  assert.equal(r.ev,null);st=r.next;
  r=nextPrinterState(st,null,t0+9*60_000);
  assert.equal(r.ev,null,'9 min aún no');st=r.next;
  r=nextPrinterState(st,null,t0+10*60_000);
  assert.equal(r.ev.state,'offline');st=r.next;
  assert.equal(nextPrinterState(st,null,t0+30*60_000).ev,null,'no repite');
  assert.equal(nextPrinterState({state:'standby'},null,t0+99*60_000).ev,null,'apagada sin imprimir no avisa');
});

test('impresora: nombre como en el dashboard (modelo + número)',()=>{
  assert.equal(machineName({name:'K1 Max',num:'3',hostname:'K1-7C3E'}),'K1 Max #3');
  assert.equal(machineName({name:'Ender-5 Max #2',num:'2'}),'Ender-5 Max #2');
  assert.equal(machineName({hostname:'K1-7C3E'}),'K1-7C3E');
});

test('cableado: el Worker avisa leads, corre el resumen y protege /notify con WA_NOTIFY_KEY',()=>{
  assert.match(WORKER,/import \{[^}]*waNotify[^}]*\} from "\.\/wa-notify\.js"/);
  assert.match(WORKER,/waNotify\(env, "lead", mensajeLead\(norm, source, \{ recurrente \}\)/);
  assert.match(WORKER,/waDailyReminders\(env, new Date\(event\.scheduledTime/);
  assert.match(WORKER,/!env\.WA_NOTIFY_KEY \|\| !timingSafeEqual\(key, env\.WA_NOTIFY_KEY\)/);
  assert.match(WORKER,/perdido \? 502 : 200/,'si el aviso se perdería, el farm-controller debe reintentar');
  assert.match(WORKER,/startsWith\("Agent_Queue"\)/,'recuperar solo la tarea no re-avisa el lead');
  assert.match(TOML,/WA_PHONE_NICANOR = "56971806142"/);
  assert.match(TOML,/WA_PHONE_GUSTAVO = "56988285822"/);
  assert.doesNotMatch(TOML,/^WA_ACCESS_TOKEN\s*=/m,'el token va como secreto, nunca en el toml');
  assert.doesNotMatch(TOML,/^WA_APP_SECRET\s*=/m);
  assert.match(WORKER,/waWebhookFirmaValida\(env, raw, request\.headers\.get\("X-Hub-Signature-256"\)/);
  assert.match(CONTROLLER,/require\('\.\/print-notify'\)\.start\(\)/);
});

test('rutas del Worker de punta a punta: /notify/printer, /notify/test y /whatsapp/webhook',async()=>{
  const worker=(await import(path.join(ROOT,'lead-worker','src','index.js'))).default;
  const env={...ENV,RL:kv(),WA_NOTIFY_KEY:'k3y',WA_APP_SECRET:'s3cr3t',WA_VERIFY_TOKEN:'v3r1',ALLOWED_ORIGINS:'https://dashboard.thelab.solutions'};
  const calls=fakeFetch([]);
  const ctx={waitUntil:()=>{}};
  const post=(p,body,h={})=>worker.fetch(new Request('https://w'+p,{method:'POST',headers:{'Content-Type':'application/json',...h},body:typeof body==='string'?body:JSON.stringify(body)}),env,ctx);
  const ev={machine:'K1 Max #3',state:'error',filename:'pieza.gcode',message:'key 2016',eventId:'m1|pieza|error|10'};

  assert.equal((await post('/notify/printer',ev)).status,401,'sin clave');
  assert.equal((await post('/notify/printer',ev,{'X-Notify-Key':'otra'})).status,401);
  assert.equal((await post('/notify/printer',{...ev,state:'raro'},{'X-Notify-Key':'k3y'})).status,400);
  const r1=await post('/notify/printer',ev,{'X-Notify-Key':'k3y'});
  assert.equal(r1.status,200);
  assert.equal(calls.length,1);
  assert.equal(calls[0].body.to,'56988285822');
  assert.match(calls[0].body.text.body,/Impresión con ERROR — K1 Max #3[\s\S]*key 2016/);
  await post('/notify/printer',ev,{'X-Notify-Key':'k3y'});
  assert.equal(calls.length,1,'el reintento del farm-controller no duplica');

  const t=await post('/notify/test',{persona:'nicanor'},{'X-Notify-Key':'k3y'});
  const tj=await t.json();
  assert.equal(t.status,200);assert.equal(tj.via,'texto-sin-ventana');assert.match(tj.aviso,/escriba "hola"/);
  assert.equal((await post('/notify/test',{persona:'cualquiera'},{'X-Notify-Key':'k3y'})).status,400,'solo al equipo');

  const g=await worker.fetch(new Request('https://w/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=v3r1&hub.challenge=777'),env,ctx);
  assert.equal(await g.text(),'777');
  const raw=JSON.stringify({entry:[{changes:[{value:{messages:[{from:'56971806142',type:'text',text:{body:'hola'}}]}}]}]});
  assert.equal((await post('/whatsapp/webhook',raw,{'X-Hub-Signature-256':'sha256=00'})).status,401,'firma falsa');
  const firma='sha256='+require('node:crypto').createHmac('sha256','s3cr3t').update(raw).digest('hex');
  assert.equal((await post('/whatsapp/webhook',raw,{'X-Hub-Signature-256':firma})).status,200);
  assert.ok(env.RL.m.has('wa:inbound:56971806142'),'abre la ventana de 24 h de Nicanor');
});

test('un aviso que no se pudo entregar ni guardar responde 502 para que el farm-controller reintente',async()=>{
  const worker=(await import(path.join(ROOT,'lead-worker','src','index.js'))).default;
  const env={...ENV,WA_NOTIFY_KEY:'k3y',ALLOWED_ORIGINS:'https://x'}; // sin KV: no hay dónde dejarlo pendiente
  fakeFetch([{status:500,body:{error:{message:'Meta caído'}}}]);
  const orig=console.error;console.error=()=>{};
  let r;
  try{r=await worker.fetch(new Request('https://w/notify/printer',{method:'POST',headers:{'X-Notify-Key':'k3y'},body:JSON.stringify({state:'complete',machine:'K2'})}),env,{waitUntil:()=>{}});}
  finally{console.error=orig;}
  assert.equal(r.status,502);
});
