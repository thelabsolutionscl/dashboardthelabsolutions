#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const start=html.indexOf('let _crmEditOriginal=null;');
const end=html.indexOf('async function deleteCliente(',start);
const dateStart=html.indexOf('function _crmAuditDate('),dateEnd=html.indexOf('function _crmAcquisitionAudit(',dateStart);
assert.ok(start>=0&&end>start&&dateStart>=0&&dateEnd>dateStart,'provenance editor and date validator exist');
const code=html.slice(dateStart,dateEnd)+html.slice(start,end);
const CLIENT='recTEST0000000001';
const clone=v=>structuredClone(v);
function fixture(fields={},options={}){
  const base={Empresa:'Prueba TLS',Contacto:'Persona Test','Notas internas':'Nota anterior',...fields};
  const current={id:CLIENT,fields:clone(base)};
  const remote={id:CLIENT,fields:clone(base)};
  const quotes=options.quotes||[];
  const state={clientesByIdRec:{[CLIENT]:current},clientesById:{},cotizaciones:quotes};
  const input={};const names=['ecId','ecEmpresa','ecContacto','ecCargo','ecTelefono','ecEmail','ecCiudad',
    'ecRut','ecWeb','ecIndustria','ecOrigen','ecEtapa','ecEstado','ecValoracion','ecFactVenc',
    'ecNotas','ec-vendedor','ecGuardarBtn','ecPrimerContacto','ecEvidenciaCAC','editClienteModal'];
  for(const n of names)input[n]={value:'',style:{},textContent:'',disabled:false};
  const document={getElementById:id=>input[id]||null};
  const writes=[],toasts=[],counts={fetch:0,renders:0,closed:0};
  const airtableFetch=async(name,max)=>{
    counts.fetch++;assert.equal(name,'Clientes');assert.ok(max>=1000);
    if(options.readFails)throw Error('No se pudo consultar el CRM');
    return {records:[clone(remote)]};
  };
  const airtableWrite=async(name,method,id,patch)=>{
    assert.equal(name,'Clientes');assert.equal(method,'PATCH');assert.equal(id,CLIENT);
    writes.push(clone(patch));Object.assign(remote.fields,clone(patch));
  };
  const api=new Function('document','state','hoyCL','toast','validEmail','validPhone','validRUT',
      'formatRUT','airtableFetch','airtableWrite','_clienteSchemaRetryable','renderClientes',
      'renderOverview','renderCrmAcquisitionAudit',code+
      '\nreturn {openEditCliente,saveEditCliente,closeEditCliente};')(
    document,state,()=> '2026-09-29',(msg)=>toasts.push(msg),
    ()=>true,()=>true,()=>true,x=>x,airtableFetch,airtableWrite,()=>false,
    ()=>counts.renders++,()=>counts.renders++,()=>counts.renders++
  );
  api.openEditCliente(CLIENT);
  return {api,document,state,current,remote,input,writes,toasts,counts};
}
test('missing acquisition stays empty, not Referido, when unrelated client data are edited',async()=>{
  const h=fixture();
  assert.equal(h.input.ecOrigen.value,'');
  assert.equal(h.input.ecPrimerContacto.value,'');
  h.input.ecEmpresa.value='Nombre actualizado';
  await h.api.saveEditCliente();
  assert.equal(h.writes.length,1);
  assert.equal(Object.hasOwn(h.writes[0],'Origen lead'),false);
  assert.equal(Object.hasOwn(h.writes[0],'Fecha primer contacto'),false);
  assert.equal(h.counts.fetch,0);
  assert.equal(h.remote.fields['Origen lead'],undefined);
});
test('changes to origin require verifiable reference and never write without it',async()=>{
  const h=fixture();
  h.input.ecOrigen.value='google_ads';
  await h.api.saveEditCliente();
  assert.equal(h.writes.length,0);
  assert.equal(h.counts.fetch,0);
  assert.match(h.toasts.join(' '),/referencia verificable/);
  assert.equal(h.input.ecGuardarBtn.disabled,false);
});
test('cannot set a contact date after the earliest original quote date',async()=>{
  const h=fixture({}, {quotes:[{id:'recQuote',fields:{Cliente:[CLIENT],
    'Fecha cotización':'2026-08-25'}}]});
  h.input.ecPrimerContacto.value='2026-08-30';
  h.input.ecEvidenciaCAC.value='Primer correo original del cliente, 2026-08-30';
  await h.api.saveEditCliente();
  assert.equal(h.writes.length,0);
  assert.match(h.toasts.join(' '),/posterior a una cotización/);
});
test('valid manual correction writes only attested provenance, with old values and evidence retained',async()=>{
  const h=fixture();
  h.input.ecOrigen.value='google_ads';
  h.input.ecPrimerContacto.value='2025-06-10';
  h.input.ecEvidenciaCAC.value='Email original recibido el 10-06-2025';
  await h.api.saveEditCliente();
  assert.equal(h.counts.fetch,1);
  assert.equal(h.writes.length,1);
  assert.equal(h.writes[0]['Origen lead'],'google_ads');
  assert.equal(h.writes[0]['Fecha primer contacto'],'2025-06-10');
  assert.match(h.writes[0]['Notas internas'],/Nota anterior/);
  assert.match(h.writes[0]['Notas internas'],/Origen: sin atribuir → google_ads/);
  assert.match(h.writes[0]['Notas internas'],/primer contacto: sin fecha → 2025-06-10/);
  assert.match(h.writes[0]['Notas internas'],/Email original recibido/);
  assert.equal(h.remote.fields['Fecha primer contacto'],'2025-06-10');
});
test('stale editor cannot overwrite another reviewer’s newer provenance or notes',async()=>{
  const h=fixture();
  h.input.ecOrigen.value='Instagram';
  h.input.ecEvidenciaCAC.value='Formulario web original guardado';
  h.remote.fields['Origen lead']='LinkedIn';
  await h.api.saveEditCliente();
  assert.equal(h.writes.length,0);
  assert.match(h.toasts.join(' '),/Otro equipo modificó/);
  assert.equal(h.current.fields['Origen lead'],undefined);
});
test('removal of a mistaken source is a logged, explicit action',async()=>{
  const h=fixture({'Origen lead':'Referido'});
  h.input.ecOrigen.value='';
  h.input.ecEvidenciaCAC.value='Revisión de lead inicial sin indicio de referido';
  await h.api.saveEditCliente();
  assert.equal(h.writes.length,1);
  assert.equal(h.writes[0]['Origen lead'],null);
  assert.match(h.writes[0]['Notas internas'],/Referido → sin atribuir/);
});
test('invalid or future dates and unavailable preflight never persist fabricated data',async()=>{
  const future=fixture();
  future.input.ecPrimerContacto.value='2027-01-03';
  future.input.ecEvidenciaCAC.value='Correo revisado del 03-01-2027';
  await future.api.saveEditCliente();
  assert.equal(future.writes.length,0);
  const failed=fixture({}, {readFails:true});
  failed.input.ecOrigen.value='Instagram';
  failed.input.ecEvidenciaCAC.value='Correo original adjunto del cliente';
  await failed.api.saveEditCliente();
  assert.equal(failed.writes.length,0);
  assert.match(failed.toasts.join(' '),/No se pudo consultar/);
});
test('modal offers a genuine blank origin, actual Airtable values, and a manual first-contact field',()=>{
  assert.match(html,/<select class="field-select" id="ecOrigen"><option value="">— Sin atribución/);
  assert.match(html,/<option value="google_ads">Google Ads/);
  assert.match(html,/id="ecPrimerContacto" type="date"/);
  assert.match(html,/id="ecEvidenciaCAC"/);
  assert.ok(!code.includes("f['Origen lead']||'Referido'"));
});
