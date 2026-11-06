#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('js/fondos-expediente.js','utf8');
const host=fs.readFileSync('js/calendario-fondos.js','utf8');
const css=fs.readFileSync('fondos-tls.css','utf8');
const checks=['bases','empresa','proyecto','finanzas','documentos','formulario','plazos'];
function setup(store=new Map()){
  const listeners={};
  const root={addEventListener:(name,callback)=>{listeners[name]=callback;}};
  const document={
    readyState:'complete',
    getElementById:id=>id==='tab-calendario'?root:null,
    querySelector:()=>null,
    addEventListener(){}
  };
  const window={TLSFondos:{getFund:()=>null,currentWorkspaceId:()=>'',getTracked:()=>null}};
  const ctx={window,document,localStorage:{
    getItem:k=>store.get(k)||null,
    setItem:(k,v)=>store.set(k,v)
  },NOTIFY:{persona:()=>'gustavo'},navigator:{clipboard:{writeText:async()=>{}}}};
  vm.runInNewContext(code,ctx,{filename:'js/fondos-expediente.js'});
  return{api:window.TLSFondosExpediente,ctx,store,listeners,window};
}
test('módulo compila y sólo añade un expediente a fondos relevantes',()=>{
  assert.doesNotThrow(()=>new Function(code));
  const {api}=setup();
  assert.ok(api.profile('corfo-crea-y-valida-proxima-vigilar'));
  assert.ok(api.profile('startupchile-big-proximo-vigilar'));
  assert.ok(api.profile('corfo-pati-futuras'));
  assert.equal(api.profile('sercotec-crece-urbano-rm-2026'),null);
  assert.equal(api.html({id:'sercotec-crece-urbano-rm-2026',name:'Otro'},null,checks),'');
});
test('cada plan mapea las siete casillas autorizadas por FONDOS_TLS',()=>{
  const {api}=setup();
  for(const id of ['corfo-crea-y-valida-proxima-vigilar','startupchile-big-proximo-vigilar','corfo-pati-futuras']){
    const profile=api.profile(id);
    assert.deepEqual(Object.keys(profile.details).sort(),checks.slice().sort(),id);
    assert.ok(profile.warning.length>=25,id);
    assert.match(profile.source,/^https:\/\/(?:www\.)?(?:corfo\.gob\.cl|startupchile\.org)/);
    assert.ok(profile.idea.length>30);
  }
});
test('ficha guarda borradores por usuario y fondo y permite retomar el proyecto',()=>{
  const store=new Map(),a=setup(store).api;
  const id='corfo-crea-y-valida-proxima-vigilar';
  assert.match(a.ideaFor(id),/Proyecto preliminar/);
  assert.equal(a.save(id,'responsable','Equipo TLS'),true);
  assert.equal(a.save(id,'idea','Proyecto validado por definir'),true);
  assert.equal(a.save(id,'prototipo','Existe un prototipo de prueba.'),true);
  assert.equal(a.read(id).responsable,'Equipo TLS');
  const b=setup(store).api;
  assert.equal(b.ideaFor(id),'Proyecto validado por definir');
  assert.equal(b.read(id).prototipo,'Existe un prototipo de prueba.');
  assert.equal(b.read('startupchile-big-proximo-vigilar').responsable,undefined);
  assert.equal(b.save(id,'clavePrivada','1234'),false);
  assert.equal(b.save(id,'idea','x'.repeat(3001)),false);
  assert.ok([...store.keys()].every(k=>k.includes('tls-fondos-dossier-v1')));
});
test('vista deja claro si convocatoria es oficial y no convierte planes en postulaciones',()=>{
  const {api}=setup();
  const id='corfo-crea-y-valida-proxima-vigilar';
  const card=api.html({id,name:'Crea y Valida <script>alert(1)</script>'},{checks:['bases','empresa']},checks.map(k=>[k,k]));
  assert.match(card,/EXPEDIENTE DE POSTULACIÓN/);
  assert.match(card,/data-fondos-dossier-input="presupuesto"/);
  assert.match(card,/data-fondos-dossier-copy=/);
  assert.match(card,/29%/);
  assert.match(card,/NO hay una nueva convocatoria confirmada/);
  assert.doesNotMatch(card,/<script>/);
  assert.match(card,/solo en este navegador/);
});
test('dossier exportado distingue hechos pendientes y casillas revisadas',()=>{
  const {api}=setup();
  const id='startupchile-big-proximo-vigilar';
  const content=api.textFor({id,name:'BIG 13',organizer:'Start-Up Chile'},['bases','empresa']);
  assert.match(content,/BIG 13/);
  assert.match(content,/AVISO:/);
  assert.match(content,/\[X\] Descargar términos BIG 13/);
  assert.match(content,/\[ \] Demostrar producto/);
  assert.match(content,/NO constituye|no acredita/i);
});
test('integración conserva mesa y almacenamiento compartido existentes',()=>{
  assert.match(host,/window\.TLSFondosExpediente\?\.html\?\.\(f,record,FLOW_CHECKS\)/);
  assert.match(host,/window\.TLSFondosExpediente\?\.hint\?\.\(f\.id,key\)/);
  assert.match(host,/js\/fondos-expediente\.js\?v=20261105/);
  assert.match(host,/data-fondos-work-check/);
  assert.match(host,/persistFundRecord/);
  assert.match(css,/\.fondos-dossier-editor/);
  assert.doesNotMatch(code,/\/shared\/funds|AIRTABLE_TOKEN|_finSharedMutate|fetch\(/);
});