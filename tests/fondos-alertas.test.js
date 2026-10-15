#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const main=fs.readFileSync(path.join(root,'lead-worker/src/index.js'),'utf8');
const conf=fs.readFileSync(path.join(root,'lead-worker/wrangler.toml'),'utf8');
const cal=fs.readFileSync(path.join(root,'js/calendario-fondos.js'),'utf8');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/fondos-concursables.json'),'utf8'));
const at=new Date('2026-10-15T12:20:00.000Z'); // 09:20 en Santiago (horario verano 2026)
const fake={
 schema:1,
 funds:[{
  id:'convocatoria-test-2026',name:'Prueba de inversión para TLS',
  organizer:'Organismo oficial',source:'https://www.sercotec.cl/convocatoria/',
  info:'https://www.sercotec.cl/convocatoria/',requirements:'Primera categoría; cofinanciamiento',
  open:'2026-10-15T12:00',close:'2026-10-15T15:00'
 },{
  id:'sin-fecha',name:'Concurso que aún no abre',
  source:'https://www.corfo.gob.cl/sites/cpp/programasyconvocatorias/',open:null,close:null
 },{
  id:'otra-region',name:'Fuente no oficial',
  source:'https://malicioso.example/fondo',open:'2026-10-15T12:00',close:null
 }]
};
const kit=catalog.funds.find(f=>f.id==='sercotec-kit-digital-2026');

async function module(){
 return import('../lead-worker/src/fondos-notify.js');
}
function harness({
 provided=fake,
 initial=[],
 fail=[],
 now=at,
 missing='',
}={}){
 const kv=new Map(initial.map(x=>[x,'old-email-id']));
 let apiCalls=[],catalogCalls=0;
 const env={
  RESEND_API_KEY:'key-not-a-real-secret',
  RESEND_FROM:'The Lab Solutions <hola@thelab.solutions>',
  FONDOS_NOTIFY_ENABLED:'true',
  RL:{
   async get(k){return kv.get(k)||null},
   async put(k,v){if(fail.includes('kv'))throw Error('KV write failed');kv.set(k,v)}
  }
 };
 if(missing==='resend')delete env.RESEND_API_KEY;
 if(missing==='kv')delete env.RL;
 const fetcher=async (url,options)=>{
   if(url==='https://dashboard.thelab.solutions/data/fondos-concursables.json'){
     catalogCalls++;return {ok:true,json:async()=>provided};
   }
   assert.equal(url,'https://api.resend.com/emails');
   apiCalls.push({url,options});
   if(fail.includes('resend'))return {ok:false,status:503};
   return {ok:true,json:async()=>({id:'email-'+apiCalls.length})};
 };
 return {env,kv,fetcher,calls:()=>apiCalls,catalogCalls:()=>catalogCalls,now};
}

test('todo fondo con fecha oficial puede generar apertura y cierre sin fechas falsas',async()=>{
 const m=await module();
 const notices=m.dueNotifications(fake,at);
 assert.equal(notices.length,2);
 assert.deepEqual(notices.map(x=>x.phase).sort(),['apertura','cierre']);
 assert.ok(notices.every(x=>x.date==='2026-10-15'));
 assert.equal(m.dueNotifications(catalog,at).length,0,'no notificar fondos históricos');
 assert.equal(m.dueNotifications({schema:1,funds:[{...fake.funds[0],open:'2026-10-19T12:00',close:'2026-11-20T15:00'}]},at).length,0);
 assert.equal(kit.open,'2026-06-16T12:00');
 assert.equal(kit.close,'2026-06-26T12:00');
 assert.match(cal,/corfo\\\.gob\\\.cl/);
});
test('a los dos destinatarios corporativos: una alerta por fase, con dedup KV + Resend',async()=>{
 const m=await module(),h=harness();
 const one=await m.deliverFundAlerts(h.env,h.now,h.fetcher);
 assert.equal(one.events,2);
 assert.equal(one.sent,4);
 assert.equal(one.errors.length,0);
 const sent=h.calls().map(x=>JSON.parse(x.options.body));
 assert.deepEqual(sent.map(x=>x.to[0]).sort(),[
  'gustavo@thelab.solutions','gustavo@thelab.solutions',
  'nicanor@thelab.solutions','nicanor@thelab.solutions'
 ]);
 assert.ok(h.calls().every(x=>x.options.headers['Idempotency-Key']&&x.options.headers['Authorization'].startsWith('Bearer ')));
 assert.ok(sent.every(x=>x.html.includes('Requisitos por verificar')));
 assert.equal(new Set(h.calls().map(x=>x.options.headers['Idempotency-Key'])).size,4);
 const again=await m.deliverFundAlerts(h.env,h.now,h.fetcher);
 assert.equal(again.sent,0);
 assert.equal(again.alreadySent,4);
 assert.equal(h.calls().length,4);
});
test('reintenta fallos reales, bloquea si faltan KV/Resend y evita envíos fuera del horario',async()=>{
 const m=await module(),h=harness({fail:['resend']});
 const one=await m.deliverFundAlerts(h.env,h.now,h.fetcher);
 assert.equal(one.sent,0);
 assert.equal(one.errors.length,4);
 assert.equal(h.kv.size,0);
 const h2=harness({missing:'kv'});
 assert.equal((await m.deliverFundAlerts(h2.env,at,h2.fetcher)).skipped,'falta-resend-o-kv');
 assert.equal(h2.calls().length,0);
 const h3=harness({missing:'resend'});
 assert.equal((await m.deliverFundAlerts(h3.env,at,h3.fetcher)).skipped,'falta-resend-o-kv');
 const early=new Date('2026-10-15T10:00:00Z'); // 07:00 Chile
 const h4=harness();
 assert.equal((await m.deliverFundAlerts(h4.env,early,h4.fetcher)).skipped,'fuera-horario');
 assert.equal(h4.catalogCalls(),0);
});
test('no acepta claves personales, URLs no oficiales ni correos externos como destino',async()=>{
 const m=await module(),h=harness();
 h.env.FONDOS_NOTIFY_TO_NICANOR='victima@example.com';
 const r=await m.deliverFundAlerts(h.env,h.now,h.fetcher);
 assert.equal(r.sent,2);
 assert.equal(r.errors.length,2);
 assert.ok(h.calls().every(x=>JSON.parse(x.options.body).to[0]==='gustavo@thelab.solutions'));
 assert.equal(m.dueNotifications({schema:2,funds:fake.funds},at).length,0);
});
test('si el dashboard exige Access, carga desde el catálogo público de respaldo sin avisos falsos',async()=>{
 const m=await module(),h=harness();
 let tried=[];
 const fallback=async(url,opts)=>{
  tried.push(url);
  if(url===m.FONDOS_CATALOGO_URL)return {ok:true,json:async()=>{throw Error('Access devolvió HTML')}};
  if(url===m.FONDOS_CATALOGO_RESPALDO)return {ok:true,json:async()=>fake};
  return h.fetcher(url,opts);
 };
 const output=await m.deliverFundAlerts(h.env,h.now,fallback);
 assert.equal(output.sent,4);
 assert.deepEqual(tried.slice(0,2),[m.FONDOS_CATALOGO_URL,m.FONDOS_CATALOGO_RESPALDO_URL||m.FONDOS_CATALOGO_RESPALDO]);
 assert.equal(h.calls().length,4);
});

test('ProChile: ambos avisos usan solo fuentes oficiales y no fechas futuras inventadas',async()=>{
 const m=await module();
 const f=catalog.funds.find(x=>x.id==='prochile-servicios-industrias-creativas-sectorial-2027');
 const next=catalog.funds.find(x=>x.id==='prochile-servicios-industrias-creativas-proximo');
 assert.ok(f&&next);
 assert.equal(f.open,'2026-07-23T12:00');
 assert.equal(f.close,'2026-08-20T17:00');
 assert.equal(next.open,null);
 assert.equal(next.close,null);
 const starts=m.dueNotifications({schema:1,funds:[f,next]},new Date('2026-07-23T13:20:00Z'));
 const ends=m.dueNotifications({schema:1,funds:[f,next]},new Date('2026-08-20T13:20:00Z'));
 assert.equal(starts.length,1);
 assert.equal(starts[0].phase,'apertura');
 assert.equal(ends.length,1);
 assert.equal(ends[0].phase,'cierre');
 assert.equal(m.dueNotifications({schema:1,funds:[next]},new Date('2027-08-20T13:20:00Z')).length,0);
 assert.ok(starts[0].url.startsWith('https://www.prochile.gob.cl/'));
});

test('avisos dentro del dashboard solo para ambos usuarios y una vez por fecha',()=>{
 assert.match(cal,/notifyToday\(\)/);
 assert.match(cal,/personas:\['gustavo','nicanor'\]/);
 assert.match(cal,/setInterval\(notifyToday/);
 assert.match(main,/deliverFundAlerts\(env,new Date\(event.scheduledTime \|\| Date.now\(\)\)\)/);
 assert.match(conf,/FONDOS_NOTIFY_ENABLED = "true"/);
 assert.match(conf,/FONDOS_NOTIFY_TO_GUSTAVO = "gustavo@thelab.solutions"/);
 assert.match(conf,/FONDOS_NOTIFY_TO_NICANOR = "nicanor@thelab.solutions"/);
});
test('amplió búsqueda y conservó historial rastreable Corfo/Sercotec con límites explícitos',()=>{
 assert.ok(catalog.funds.length>=14);
 assert.ok(catalog.funds.filter(f=>f.open&&f.close).length>=8);
 assert.ok(catalog.funds.some(f=>/Inversión Productiva/i.test(f.name)));
 assert.ok(catalog.funds.some(f=>/Crea y Valida/i.test(f.name)));
 assert.ok(catalog.funds.some(f=>/Negocios Digitales/i.test(f.name)));
 assert.ok(catalog.funds.every(f=>/^https:\/\//.test(f.source)));
 assert.ok(catalog.funds.some(f=>f.open==null&&f.close==null));
});


test('auditoría de cobertura: nuevos programas sin fechas falsas ni notificaciones automáticas',async()=>{
 const m=await module();
 const expected=[
  'sercotec-promocion-canales-rm-vigilar',
  'corfo-red-asociativa-rm-vigilar',
  'sercotec-sello-impacta-sustentable-vigilar'
 ];
 for(const id of expected){
  const entry=catalog.funds.find(f=>f.id===id);
  assert.ok(entry,id+' no está en el seguimiento');
  assert.equal(entry.open,null);
  assert.equal(entry.close,null);
  assert.ok(/^https:\/\//.test(entry.source));
  assert.match(entry.category,/no necesariamente subsidio|no subsidio|Cooperación/);
 }
 assert.equal(m.dueNotifications(catalog,new Date('2026-11-15T12:20:00.000Z')).length,0);
 assert.equal(new Set(catalog.funds.map(f=>f.id)).size,catalog.funds.length,'evitar duplicados');
 assert.ok(catalog.funds.length>=19);
});

test('hito obligatorio Corfo tiene fecha oficial, calendario y correo de vencimiento',async()=>{
 const m=await module();
 const f=catalog.funds.find(x=>x.id==='corfo-crea-y-valida-2026');
 assert.ok(f&&Array.isArray(f.milestones));
 assert.equal(f.milestones[0].date,'2026-06-09T17:00');
 const date=new Date('2026-06-09T13:20:00.000Z');
 const hitos=m.dueNotifications({schema:1,funds:[f]},date);
 assert.equal(hitos.length,1);
 assert.equal(hitos[0].phase,'hito-perfil-obligatorio');
 assert.match(hitos[0].milestone,/perfil/i);
 const h=harness({provided:{schema:1,funds:[f]},now:date});
 const delivered=await m.deliverFundAlerts(h.env,date,h.fetcher);
 assert.equal(delivered.sent,2);
 assert.equal(delivered.errors.length,0);
 assert.ok(h.calls().every(x=>JSON.parse(x.options.body).subject.includes('HITO OBLIGATORIO')));
 const repeat=await m.deliverFundAlerts(h.env,date,h.fetcher);
 assert.equal(repeat.sent,0);
});
test('alertas anticipadas 7, 3 y 1 días son independientes de la alerta de cierre',async()=>{
 const m=await module();
 const f={...fake.funds[0],open:'2026-10-01T12:00',close:'2026-10-22T15:00'};
 const now=new Date('2026-10-15T12:20:00Z');
 assert.equal(m.dueNotifications({schema:1,funds:[f]},now,7).length,1);
 assert.equal(m.dueNotifications({schema:1,funds:[f]},now,3).length,0);
 assert.equal(m.dueNotifications({schema:1,funds:[f]},now,1).length,0);
 const h=harness({provided:{schema:1,funds:[f]},now});
 const first=await m.deliverFundAlerts(h.env,now,h.fetcher);
 assert.equal(first.events,1);
 assert.equal(first.sent,2);
 const emails=h.calls().map(x=>JSON.parse(x.options.body));
 assert.ok(emails.every(x=>/EN 7 DÍAS/.test(x.subject)));
 assert.equal(new Set(h.calls().map(x=>x.options.headers['Idempotency-Key'])).size,2);
 assert.equal((await m.deliverFundAlerts(h.env,now,h.fetcher)).alreadySent,2);
});
test('hito sin URL verificable no genera notificaciones',async()=>{
 const m=await module();
 const f={...fake.funds[0],open:null,close:null,milestones:[{
   id:'perfil-obligatorio',name:'Perfil obligatorio',kind:'mandatory',
   date:'2026-10-15T15:00',source:'https://evil.example/collect'
 }]};
 assert.equal(m.dueNotifications({schema:1,funds:[f]},at).length,0);
});
