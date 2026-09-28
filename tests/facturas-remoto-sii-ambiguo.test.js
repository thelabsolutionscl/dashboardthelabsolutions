#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sii=fs.readFileSync(path.join(root,'sii-worker','src','index.js'),'utf8');

const start=html.indexOf('function _facturaClave(fields){');
const end=html.indexOf('async function deleteFactura(',start);
assert.ok(start>0&&end>start,'helpers reales de guardado Facturas');
const source=html.slice(start,end);
function facturaHarness({remote=[],getError=null,saveResult=null,fetchOverride=null}={}){
  const state={facturas:[],clientesById:{}};
  const values={
    facGuardarBtn:{disabled:false,textContent:'💾 Guardar'},facFolio:'00017',
    facTipo:'33',facId:'',facClienteId:'recCliente',facClienteNombre:'Nuevo cliente',
    facFecha:'2026-09-28',facNeto:'100000',facIva:'19000',facExento:'0',
    facTotal:'119000',facTrackId:'',facEstado:'Enviado',facEstadoPago:'Pendiente',
    facFechaVenc:'2026-10-28',facNotas:''
  };
  const doc={getElementById:id=>{
    const v=values[id];
    return typeof v==='object'?v:{value:v??''};
  }};
  const calls={get:0,post:0,patch:0,toasts:[],closed:0};
  const deps={
    state,document:doc,
    toast:(msg,type)=>calls.toasts.push({msg,type}),
    ensureFacturasTable:async()=>{},
    airtableFetch:async()=>{
      calls.get++;
      if(fetchOverride)return fetchOverride(calls.get);
      if(getError)throw getError;
      return {records:remote};
    },
    airtableWrite:async(tab,method,id,fields)=>{
      if(method==='POST')calls.post++;else calls.patch++;
      return saveResult??{id:id||'recNueva',fields};
    },
    closeFacturaModal:()=>calls.closed++,
    renderClienteFacturas:()=>{},
    finRenderFacturas:()=>{}
  };
  const api=new Function(...Object.keys(deps),source+'\nreturn {_facturaClave,saveFactura};')(...Object.values(deps));
  return {api,calls,state,values};
}
const invoice=(folio='17',type='33',cliente='Otro cliente',id='recOtra')=>({
  id,fields:{'Folio':Number(folio),'Tipo DTE':type,'Cliente':cliente,'Cliente ID':id}
});

test('revalida Facturas remotas y rechaza un DTE con mismo tipo/folio de otro cliente',async()=>{
  const h=facturaHarness({remote:[invoice('17','33','Empresa B')]});
  await h.api.saveFactura();
  assert.equal(h.calls.get,1);
  assert.equal(h.calls.post,0);
  assert.ok(h.calls.toasts.some(x=>/Ya existe/.test(x.msg)));
  assert.equal(h.values.facGuardarBtn.disabled,false);
});

test('si Airtable no responde no vuelve a emitir un alta manual a ciegas',async()=>{
  const h=facturaHarness({getError:new Error('Airtable 503')});
  await h.api.saveFactura();
  assert.equal(h.calls.post,0);
  assert.ok(h.calls.toasts.some(x=>/503/.test(x.msg)));
});

test('se permite otro tipo tributario con igual folio',async()=>{
  const h=facturaHarness({remote:[invoice('17','61')]});
  await h.api.saveFactura();
  assert.equal(h.calls.post,1);
  assert.equal(h.state.facturas.length,2);
});

test('editar el mismo registro no crea otro y detecta modificaciones externas',async()=>{
  const h=facturaHarness({remote:[invoice('17','33','Empresa A','recOriginal')]});
  h.values.facId='recOriginal';
  await h.api.saveFactura();
  assert.equal(h.calls.patch,1);
  assert.equal(h.calls.post,0);
  assert.equal(h.state.facturas[0].id,'recOriginal');
});

test('una edición no pisa otro registro que haya tomado el mismo folio',async()=>{
  const h=facturaHarness({remote:[invoice('17','33','Empresa A','recAjeno')]});
  h.values.facId='recOriginal';
  await h.api.saveFactura();
  assert.equal(h.calls.patch,0);
  assert.ok(h.calls.toasts.some(x=>/Ya existe/.test(x.msg)));
});

test('doble clic simultáneo en una pestaña no crea dos Facturas',async()=>{
  let resolve;
  const wait=new Promise(r=>{resolve=r;});
  const h=facturaHarness({fetchOverride:()=>wait});
  const first=h.api.saveFactura();
  await h.api.saveFactura();
  assert.equal(h.calls.get,1);
  resolve({records:[]});
  await first;
  assert.equal(h.calls.post,1);
});

test('un 2xx sin ID de Airtable se informa sin crear registros locales corruptos',async()=>{
  const h=facturaHarness({saveResult:{fields:{'Folio':17}}});
  await h.api.saveFactura();
  assert.equal(h.calls.post,1);
  assert.equal(h.state.facturas.length,0);
  assert.ok(h.calls.toasts.some(x=>/no confirmó el ID/.test(x.msg)));
});

test('normaliza tipo textual y ceros iniciales en la identidad de Facturas',()=>{
  const h=facturaHarness();
  assert.equal(h.api._facturaClave({'Folio':'00017','Tipo DTE':'Factura Electrónica'}),'33|17');
  assert.equal(h.api._facturaClave({'Folio':17,'Tipo DTE':'33'}),'33|17');
  assert.notEqual(h.api._facturaClave({'Folio':17,'Tipo DTE':'61'}),'33|17');
});

const begin=sii.indexOf('async function handleEmitDTE(request, env) {');
const finish=sii.indexOf('// ── CAF',begin);
assert.ok(begin>0&&finish>begin,'handler real SII');
const handler=sii.slice(begin,finish);
function emisión({authFails=false,uploadFails=false}={}){
  const calls={auth:0,reserved:0,upload:0};
  const deps={
    validateEnvSecrets:()=>{},
    validatePayload:()=>{},
    parsePFX:()=>({privateKey:'key',certificate:'cert'}),
    getSIIToken:async()=>{
      calls.auth++;if(authFails)throw new Error('Fallo login SII');return 'token';
    },
    nextFolio:async()=>{
      calls.reserved++;return {folio:321,caf_xml:'CAF_TEST'};
    },
    buildSignedEnvioDTE:()=>'<xml/>',
    uploadDTE:async()=>{
      calls.upload++;
      if(uploadFails)throw new Error('Timeout sin respuesta');
      return {trackid:'123',estado:'RECIBIDO'};
    },
    ok:x=>x
  };
  const fn=new Function(...Object.keys(deps),handler+'\nreturn handleEmitDTE;')(...Object.values(deps));
  const request={json:async()=>({
    tipo_documento:'33',receptor:{rut:'123',razon_social:'Cliente'},
    detalle:[{nombre:'Servicio',cantidad:1,precio_unitario:100000}],
    totales:{neto:100000,iva:19000,total:119000}
  })};
  return {go:()=>fn(request,{RUT_EMISOR:'TEST'}),calls};
}

test('el fallo autenticando con SII no gasta folio',async()=>{
  const x=emisión({authFails:true});
  await assert.rejects(x.go(),/Fallo login/);
  assert.equal(x.calls.reserved,0);
});

test('timeout DESPUÉS de la reserva devuelve el folio y exige conciliación manual',async()=>{
  const x=emisión({uploadFails:true});
  const r=await x.go();
  assert.equal(x.calls.reserved,1);
  assert.equal(x.calls.upload,1);
  assert.equal(r.dte_numero,321);
  assert.equal(r.recibido,false);
  assert.equal(r.trackid,null);
  assert.match(r.aviso,/NO reintentes automáticamente/);
  assert.match(r.aviso,/321/);
});

test('envío con TrackID conserva la respuesta confirmada',async()=>{
  const x=emisión();
  const r=await x.go();
  assert.equal(r.dte_numero,321);
  assert.equal(r.recibido,true);
  assert.equal(r.trackid,'123');
});
