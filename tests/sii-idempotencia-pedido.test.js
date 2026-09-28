#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {webcrypto}=require('node:crypto');
const ROOT=path.join(__dirname,'..');
const guardSource=fs.readFileSync(path.join(ROOT,'sii-worker/src/folio-guard.js'),'utf8');
const workerSource=fs.readFileSync(path.join(ROOT,'sii-worker/src/index.js'),'utf8');
const financeSource=fs.readFileSync(path.join(ROOT,'js/finanzas.js'),'utf8');
const SiiFolioGuard=new Function(guardSource.replace('export class SiiFolioGuard','class SiiFolioGuard')+'\nreturn SiiFolioGuard;')();
const CAF='<CAF><DA><TD>33</TD><RNG><D>101</D><H>130</H></RNG></DA></CAF>';
const FINGERPRINT='a'.repeat(64);
function world({noTransaction=false,initialCAF=CAF}={}){
  const entries=new Map(),kvMap=new Map();
  if(initialCAF)kvMap.set('caf_33',initialCAF);
  const storage={
    get:async k=>structuredClone(entries.get(k)),
    put:async(k,v)=>{entries.set(k,structuredClone(v));}
  };
  if(!noTransaction){
    storage.transaction=async fn=>{
      const pending=new Map(entries);
      const tx={get:async k=>structuredClone(pending.get(k)),
        put:async(k,v)=>{pending.set(k,structuredClone(v));}};
      const value=await fn(tx);
      entries.clear();for(const [k,v] of pending)entries.set(k,v);
      return value;
    };
  }
  const kv={get:async k=>kvMap.get(k)||null,put:async(k,v)=>{kvMap.set(k,String(v));}};
  const guard=new SiiFolioGuard({storage},{FOLIOS_KV:kv});
  const send=async(op,payload={})=>{
    const response=await guard.fetch(new Request('https://internal.folio/',{
      method:'POST',body:JSON.stringify({op,tipo:'33',...payload}),
    }));
    return {...await response.json(),status:response.status};
  };
  return {guard,entries,kvMap,send};
}
const subject={pedido_id:'recPedido00000001',fingerprint:FINGERPRINT};
const receipt={dte_numero:101,tipo_documento:'33',trackid:'sii-track-001',estado_sii:'Enviado',recibido:true};
test('reservar una emisión fija folio y pedido en una sola transacción durable',async()=>{
  const w=world();
  const r=await w.send('begin',subject);
  assert.equal(r.status,200);
  assert.equal(r.folio,101);
  assert.equal(r.idempotencia,'reservada');
  assert.equal(w.entries.get('last'),101);
  const mark=w.entries.get('emision:'+subject.pedido_id);
  assert.equal(mark.folio,101);
  assert.equal(mark.estado,'pendiente');
});
test('dos pestañas del mismo pedido consumen un solo folio',async()=>{
  const w=world();
  const [a,b]=await Promise.all([w.send('begin',subject),w.send('begin',subject)]);
  assert.equal(a.status,200);
  assert.equal(b.status,409);
  assert.equal(b.code,'DTE_PENDING_RECONCILIATION');
  assert.equal(b.folio,a.folio);
  assert.equal(w.entries.get('last'),101);
});
test('un pedido existente con documento distinto no puede pedir un segundo folio del mismo tipo',async()=>{
  const w=world();
  await w.send('begin',subject);
  const other=await w.send('begin',{...subject,fingerprint:'b'.repeat(64)});
  assert.equal(other.status,409);
  assert.equal(other.code,'DTE_DOCUMENT_CONFLICT');
  assert.equal(w.entries.get('last'),101);
});
test('el SII confirmado se recupera tras reiniciar el isolate sin otro folio',async()=>{
  const w=world();
  const a=await w.send('begin',subject);
  assert.equal(a.status,200);
  const confirmation=await w.send('complete',{...subject,folio:101,receipt});
  assert.equal(confirmation.status,200);
  assert.equal(w.entries.get('emision:'+subject.pedido_id).estado,'completado');
  const afterRestart=new SiiFolioGuard(w.guard.state,w.guard.env);
  const res=await afterRestart.fetch(new Request('https://internal.folio/',{
    method:'POST',body:JSON.stringify({op:'begin',tipo:'33',...subject})
  }));
  const replay=await res.json();
  assert.equal(res.status,200);
  assert.equal(replay.replayed,true);
  assert.deepEqual(replay.receipt,receipt);
  assert.equal(w.entries.get('last'),101);
});
test('una confirmación sin reserva, con firma errónea o sin TrackID nunca libera el folio',async()=>{
  const w=world();
  let r=await w.send('complete',{...subject,folio:101,receipt});
  assert.equal(r.status,409);
  await w.send('begin',subject);
  r=await w.send('complete',{...subject,fingerprint:'b'.repeat(64),folio:101,receipt});
  assert.equal(r.status,409);
  r=await w.send('complete',{...subject,folio:101,receipt:{...receipt,trackid:''}});
  assert.equal(r.status,422);
  assert.equal(w.entries.get('emision:'+subject.pedido_id).estado,'pendiente');
});
test('sin transacciones no se reserva un folio ni se inventa una garantía de idempotencia',async()=>{
  const w=world({noTransaction:true});
  const r=await w.send('begin',subject);
  assert.equal(r.status,503);
  assert.equal(w.entries.has('last'),false);
});
test('la ruta de reserva legada sigue funcionando para consumidores sin pedido_id',async()=>{
  const w=world();
  const r=await w.send('reserve');
  assert.equal(r.status,200);
  assert.equal(r.folio,101);
});

const start=workerSource.indexOf('async function siiPayloadFingerprint(');
const end=workerSource.indexOf('// ── CAF',start);
assert.ok(start>0&&end>start,'deben existir los helpers de emisión actuales');
const emissionSource=workerSource.slice(start,end);
function bootEmitter({noTrack=false,authError=false}={}){
  const w=world();let uploads=0,tokens=0,signed=0;
  const deps={
    crypto:webcrypto,
    parsePFX:()=>({privateKey:{},certificate:{}}),
    getSIIToken:async()=>{tokens++;if(authError)throw new Error('SII auth down');return 'token';},
    buildSignedEnvioDTE:()=>{signed++;return '<EnvioDTE/>';},
    uploadDTE:async()=>{uploads++;return noTrack?{trackid:null,estado:'sin confirmación'}:{trackid:'sii-track-001',estado:'Enviado'};},
    validateEnvSecrets:()=>{},
    validatePayload:()=>{},
    nextFolio:async()=>{throw Error('no debe usar reserva sin idempotencia');},
    folioGuardCall:async(_env,tipo,op,payload)=>{
      const r=await w.send(op,payload);
      if(r.status!==200)throw Object.assign(new Error(r.error||'guard error'),{status:r.status});
      return r;
    },
    ok:data=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}})
  };
  const emit=new Function(...Object.keys(deps),emissionSource+'\nreturn handleEmitDTE;')(...Object.values(deps));
  const data={
    pedido_id:subject.pedido_id,tipo_documento:'33',referencia:'PED-2026-041',
    receptor:{rut:'12345678-5',razon_social:'Empresa'},
    detalle:[{nombre:'Trofeo',cantidad:1,precio_unitario:1000}],
    totales:{neto:1000,iva:190,total:1190},observaciones:'Pedido PED-2026-041',
  };
  return {emit,w,data,env:{},stats:()=>({uploads,tokens,signed})};
}
test('el Worker recupera el mismo TrackID sin firmar ni subir el documento dos veces',async()=>{
  const x=bootEmitter();
  const first=await x.emit({json:async()=>structuredClone(x.data)},x.env);
  assert.equal(first.status,200);
  const initial=await first.json();
  assert.equal(initial.dte_numero,101);
  assert.equal(initial.trackid,'sii-track-001');
  assert.equal(initial.recibido,true);
  const second=await x.emit({json:async()=>structuredClone(x.data)},x.env);
  const replay=await second.json();
  assert.equal(replay.replayed,true);
  assert.equal(replay.trackid,initial.trackid);
  assert.equal(replay.dte_numero,initial.dte_numero);
  assert.equal(x.stats().uploads,1);
  assert.equal(x.stats().signed,1);
  assert.equal(x.w.entries.get('last'),101);
});
test('sin TrackID deja reserva pendiente y bloquea el siguiente intento',async()=>{
  const x=bootEmitter({noTrack:true});
  const first=await x.emit({json:async()=>structuredClone(x.data)},x.env);
  assert.equal((await first.json()).recibido,false);
  await assert.rejects(()=>x.emit({json:async()=>structuredClone(x.data)},x.env),/Emisión anterior no confirmada/);
  assert.equal(x.stats().uploads,1);
  assert.equal(x.w.entries.get('last'),101);
  assert.equal(x.w.entries.get('emision:'+subject.pedido_id).estado,'pendiente');
});
test('si falla autenticación SII no consume un folio ni crea la reserva',async()=>{
  const x=bootEmitter({authError:true});
  await assert.rejects(()=>x.emit({json:async()=>structuredClone(x.data)},x.env),/SII auth down/);
  assert.equal(x.w.entries.has('last'),false);
  assert.equal(x.stats().uploads,0);
});
test('una modificación de monto del pedido anterior se rechaza antes de subir un nuevo DTE',async()=>{
  const x=bootEmitter();
  await x.emit({json:async()=>structuredClone(x.data)},x.env);
  const edited={...x.data,totales:{neto:2000,iva:380,total:2380}};
  await assert.rejects(()=>x.emit({json:async()=>edited},x.env),/contenido diferente/);
  assert.equal(x.stats().uploads,1);
});
test('Finanzas envía identidad estable y hace preflight remoto antes de crear Factura',()=>{
  const fn=financeSource.slice(financeSource.indexOf('async function emitirDTE(){'),financeSource.indexOf('function openSIIConfigModal()'));
  assert.match(fn,/pedido_id:pedidoId/);
  assert.match(fn,/const facturasRemotas=await airtableFetch\('Facturas',1000\)/);
  assert.match(fn,/else if\(resp\.replayed\)/);
  assert.match(fn,/resp\.fecha_emision\|\|hoyCL\(\)/);
  assert.match(fn,/delete updateFields\['Estado Pago'\]/,'no revertir Facturas pagadas');
  assert.match(fn,/delete updateFields\['Fecha Vencimiento'\]/,'no pisar acuerdos de cobranza');
  assert.match(fn,/DTE_PENDING_RECONCILIATION/,'mostrar advertencia accionable al usuario');
});
test('fecha de emisión en horario Chile no se desplaza por UTC ni en cambio de temporada',()=>{
  const src=workerSource.slice(workerSource.indexOf('function siiChileDate() {'),
    workerSource.indexOf('async function siiPayloadFingerprint('));
  assert.ok(src.startsWith('function siiChileDate()'));
  for(const [utc,expected] of [
    ['2026-09-28T02:00:00.000Z','2026-09-27'],
    ['2026-06-28T02:00:00.000Z','2026-06-27'],
    ['2026-09-28T15:00:00.000Z','2026-09-28']
  ]){
    class FakeDate extends Date { constructor(...args){super(...(args.length?args:[utc]));} }
    const result=new Function('Date',src+'\nreturn siiChileDate;')(FakeDate)();
    assert.equal(result,expected,'fecha local para '+utc);
  }
});
