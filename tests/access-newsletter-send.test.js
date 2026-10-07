#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/worker.js'),'utf8')
  .replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const worker=');
const {CrmMutationGuard}=new Function(source+'\nreturn {CrmMutationGuard};')();
const originalFetch=global.fetch;test.after(()=>{global.fetch=originalFetch;});

const CAMPAIGN='recCCCCCCCCCCCCCC';
const CLIENT='recAAAAAAAAAAAAAA';
const ENVIO='recEEEEEEEEEEEEEE';
const BASE='https://api.airtable.com/v0/app1YtD74AqiPWQhy/';

function storage(){const m=new Map();return{get:async k=>m.get(k),put:async(k,v)=>m.set(k,v),delete:async k=>m.delete(k),m};}
function fixture({future=false,optIn=true}={}){
  const store=storage(),envios=[];
  const local=future?'2099-12-31T23:59':'2020-01-01T00:00';
  const campaign={id:CAMPAIGN,fields:{
    Asunto:'Prueba segura',
    'Cuerpo HTML':'<html><body><p>Hola</p><a href="mailto:hola@thelab.solutions?subject=BAJA%20newsletter">Darme de baja</a></body></html>',
    Notas:'[AUDIENCIA NEWSLETTER] '+JSON.stringify({version:1,approved:[{id:CLIENT,email:'cliente@example.com'}]})+
      '\n[PROGRAMACION NEWSLETTER] '+JSON.stringify({local,zone:'America/Santiago'}),
    Estado:'Programada'
  }};
  const client={id:CLIENT,fields:{Email:'cliente@example.com','Suscrito newsletter':optIn,'Baja newsletter':!optIn,'Email válido':true,'Industria / Rubro':'Agencia'}};
  let resendCalls=0;
  global.fetch=async(url,opts={})=>{
    const u=String(url),method=opts.method||'GET';
    if(u===BASE+encodeURIComponent('Newsletter_Campañas')+'/'+CAMPAIGN&&method==='GET')return Response.json(campaign);
    if(u.startsWith(BASE+encodeURIComponent('Newsletter_Envios')+'?')&&method==='GET')return Response.json({records:envios});
    if(u.startsWith(BASE+encodeURIComponent('Clientes')+'/'+CLIENT+'?')&&method==='GET')return Response.json(client);
    if(u===BASE+encodeURIComponent('Newsletter_Envios')&&method==='POST'){
      const fields=JSON.parse(opts.body).fields,row={id:ENVIO,fields};envios.push(row);return Response.json(row,{status:201});
    }
    if(u===BASE+encodeURIComponent('Newsletter_Envios')+'/'+ENVIO&&method==='PATCH'){
      Object.assign(envios[0].fields,JSON.parse(opts.body).fields);return Response.json(envios[0]);
    }
    if(u===BASE+encodeURIComponent('Newsletter_Campañas')+'/'+CAMPAIGN&&method==='PATCH'){
      Object.assign(campaign.fields,JSON.parse(opts.body).fields);return Response.json(campaign);
    }
    if(u==='https://api.resend.com/emails'&&method==='POST'){
      resendCalls++;
      const body=JSON.parse(opts.body);
      assert.equal(opts.headers['Idempotency-Key'],'newsletter/'+ENVIO);
      assert.match(body.headers['List-Unsubscribe'],/newsletter\/unsubscribe\?e=/);
      assert.equal(body.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
      assert.equal(body.tags.find(t=>t.name==='envio_id').value,ENVIO);
      return Response.json({id:'resend_123'});
    }
    throw new Error('unexpected '+method+' '+u);
  };
  const env={AIRTABLE_TOKEN:'pat-test',RESEND_API_KEY:'re-test',
    NEWSLETTER_SECRET:'c2VjcmV0LWtleS1mb3ItdGVzdHM=',
    NEWSLETTER_UNSUBSCRIBE_BASE:'https://lead.example.com',
    RESEND_FROM:'The Lab <hola@thelab.solutions>'};
  const guard=new CrmMutationGuard({storage:store},env);
  const run=()=>guard.fetch(new Request('https://crm-write.internal/newsletter-send',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({campaignId:CAMPAIGN,actor:{role:'admin',email:'admin@thelab.solutions'}})
  }));
  return{run,envios,campaign,client,get resendCalls(){return resendCalls;}};
}

test('dos disparos concurrentes de la misma campaña producen un solo envío Resend',async()=>{
  const f=fixture();
  const [a,b]=await Promise.all([f.run(),f.run()]);
  assert.ok([200,207].includes(a.status),await a.clone().text());
  assert.ok([200,207].includes(b.status),await b.clone().text());
  assert.equal(f.resendCalls,1);
  assert.equal(f.envios.length,1);
  assert.equal(f.envios[0].fields.Estado,'Enviado');
  const bodies=[await a.json(),await b.json()];
  assert.equal(bodies.reduce((n,x)=>n+(x.sent||0),0),1);
  assert.equal(bodies.reduce((n,x)=>n+(x.skipped||0),0),1);
});

test('programación futura bloquea el transporte antes de reservar o enviar',async()=>{
  const f=fixture({future:true});
  const r=await f.run();assert.equal(r.status,409);
  const b=await r.json();assert.equal(b.code,'NEWSLETTER_NOT_DUE');
  assert.equal(f.resendCalls,0);assert.equal(f.envios.length,0);
});

test('opt-out actual suprime aunque la audiencia aprobada estuviera congelada',async()=>{
  const f=fixture({optIn:false});
  const r=await f.run();assert.equal(r.status,207);
  const b=await r.json();assert.equal(b.suppressed,1);
  assert.equal(f.resendCalls,0);assert.equal(f.envios.length,0);
});
