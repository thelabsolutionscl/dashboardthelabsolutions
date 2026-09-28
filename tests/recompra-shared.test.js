#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const AG=fs.readFileSync(path.join(ROOT,'js','agentes.js'),'utf8');
const MAIL=fs.readFileSync(path.join(ROOT,'js','correo.js'),'utf8');
const start=AG.indexOf("const _RECOMPRA_LOG_KEY=");
const end=AG.indexOf("function _clientePedidos(",start);
assert.ok(start>=0&&end>start,'helpers de recompra compartida');
const HELPERS=AG.slice(start,end);

function world({local={},remote=[]}={}){
  const mem=new Map([['thelab_recompra_log_v1',JSON.stringify(local)]]);
  const writes=[];
  const localStorage={
    getItem:k=>mem.has(k)?mem.get(k):null,
    setItem:(k,v)=>mem.set(k,String(v))
  };
  const state={};
  const airtableFetch=async table=>{
    assert.equal(table,'Monitor Sistema');
    return{records:remote};
  };
  const _monitorUpsert=async(name,notes,idKey)=>{
    writes.push({name,notes:JSON.parse(notes),idKey});
    return 'recMonitor';
  };
  const window={_DEMO_MODE:false};
  const api=new Function('localStorage','airtableFetch','_monitorUpsert','state','window','console',
    HELPERS+'\nreturn {_recompraNormalize,_recompraMerge,_recompraLog,_recompraStore,_recompraQueueRemote,_recompraHydrateRemote};'
  )(localStorage,airtableFetch,_monitorUpsert,state,window,{warn(){}});
  return{...api,mem,writes,state};
}
const rec=(id,ts,via='correo',recordId='recMonitor000001')=>({
  id:recordId,fields:{Name:'CRM_RECOMPRA:'+id,Notes:JSON.stringify({version:1,cliente_id:id,ts,via})}
});

test('la gestión más nueva de otro computador actualiza la caché local',async()=>{
  const now=Date.now(),id='recCliente000001';
  const w=world({local:{[id]:{ts:now-5000,via:'manual'}},remote:[rec(id,now-1000,'correo')]});
  assert.equal(await w._recompraHydrateRemote(true),true);
  assert.equal(w._recompraLog()[id].via,'correo');
  assert.equal(w._recompraLog()[id].ts,now-1000);
  assert.equal(w.writes.length,0,'no debe pisar una gestión remota más reciente');
});

test('una gestión local más nueva se publica sin pisar otros clientes',async()=>{
  const now=Date.now(),a='recCliente000001',b='recCliente000002';
  const w=world({
    local:{[a]:{ts:now-1000,via:'WhatsApp'}},
    remote:[rec(b,now-2000,'correo','recMonitor000002')]
  });
  assert.equal(await w._recompraHydrateRemote(true),true);
  const log=w._recompraLog();
  assert.equal(log[a].via,'WhatsApp');
  assert.equal(log[b].via,'correo');
  // La publicación es encadenada con Promise; dejar correr microtasks.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(w.writes.length,1);
  assert.equal(w.writes[0].name,'CRM_RECOMPRA:'+a);
  assert.equal(w.writes[0].notes.cliente_id,a);
});

test('duplicados remotos del mismo cliente se concilian por timestamp',async()=>{
  const now=Date.now(),id='recCliente000001';
  const w=world({remote:[
    rec(id,now-9000,'manual','recMonitorOld0001'),
    rec(id,now-1000,'correo','recMonitorNew0001')
  ]});
  await w._recompraHydrateRemote(true);
  assert.equal(w._recompraLog()[id].via,'correo');
  assert.equal(w._recompraLog()[id].ts,now-1000);
});

test('datos corruptos, futuros y vencidos no pueden ocultar oportunidades',()=>{
  const now=Date.now();
  const clean=world()._recompraNormalize({
    recCliente000001:{ts:now+2*864e5,via:'future'},
    recCliente000002:{ts:now-50*864e5,via:'old'},
    recCliente000003:{ts:now-1000,via:'ok'},
    basura:{ts:now,via:'bad id'},
  },now);
  assert.deepEqual(Object.keys(clean),['recCliente000003']);
});

test('WhatsApp web no marca gestión sin confirmación; WATI sí lo hace tras await',()=>{
  const start=AG.indexOf('async function recompraWhatsApp(');
  const end=AG.indexOf('function recompraEmail(',start);
  const fn=AG.slice(start,end);
  const wati=fn.indexOf("await sendWatiMessage(phone,msg)");
  const mark=fn.indexOf("_recompraMark(cliId,'WhatsApp')");
  const fallback=fn.indexOf("window.open('https://wa.me/'");
  assert.ok(wati>=0&&mark>wati,'WATI debe confirmar antes de marcar');
  assert.ok(fallback>mark,'fallback abre WhatsApp sin marcar');
  assert.equal((fn.slice(fallback).match(/_recompraMark/g)||[]).length,0);
});

test('abrir borrador de recompra no la elimina; correo la marca solo después de envío exitoso',()=>{
  const a=AG.slice(AG.indexOf('function recompraEmail('),AG.indexOf('function recompraSnooze('));
  assert.match(a,/_recompraCli:cliId/);
  assert.doesNotMatch(a,/_recompraMark/,'abrir/revisar borrador no cuenta como gestión');
  const marker=MAIL.indexOf("_recompraMark(this._cmpRecompraCli,'correo')");
  assert.ok(marker>0,'send exitoso debe marcar recompra');
  const before=MAIL.slice(Math.max(0,marker-4200),marker);
  const errorCheck=before.lastIndexOf('if(data.error)');
  const successElse=before.lastIndexOf('else{');
  assert.ok(errorCheck>=0&&successElse>errorCheck,'el marcado queda dentro del caso posterior a respuesta sin error');
});

test('el estado remoto usa un registro separado por cliente, no un blob compartido destructivo',()=>{
  assert.match(HELPERS,/_RECOMPRA_REMOTE_PREFIX='CRM_RECOMPRA:'/);
  assert.match(HELPERS,/_monitorUpsert\(\s*_RECOMPRA_REMOTE_PREFIX\+cliId/);
  assert.doesNotMatch(HELPERS,/JSON\.stringify\(log\).*_monitorUpsert/s);
});
