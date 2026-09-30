#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const SRC=fs.readFileSync(path.join(__dirname,'../js/agentes.js'),'utf8');
const a=SRC.indexOf('function _npsWorkerUrl()');
const b=SRC.indexOf('// Crea los campos NPS',a);
const c=SRC.indexOf('async function pdWhatsApp(');
const d=SRC.indexOf('async function pdMarkDone(',c);
assert.ok(a>0&&b>a&&c>b&&d>c);
const frag=SRC.slice(a,b),share=SRC.slice(c,d);
const ID='recPE0000000000A1',TOKEN=ID+'.t5f940.'+'a'.repeat(43);
const lead='https://thelab-leads-worker.wast3dspa.workers.dev';
function harness({active=true,fail=false,review='',issuerUrl=null}={}){
 const events=[],calls=[],popups=[];
 const window={open(url,target){events.push('open:'+url);
   const p={location:{replace(x){events.push('navigate:'+x);}},close(){events.push('close');}};
   popups.push(p);return p;
 }};
 const mocks={
   _DEFAULTS:{LEAD_WORKER_URL:lead},
   _proxyCfg:()=>({url:'https://proxy.thelab.solutions',key:'APP_PUBLIC'}),
   _pdReviewUrl:()=>review,
   window,
   fetch:async(url,options)=>{
     events.push('fetch');
     calls.push({url,options});
     if(fail)throw Error('issuer unreachable');
     const purpose=JSON.parse(options.body).purpose;
     return Response.json({ok:true,url:issuerUrl||(lead+'/'+purpose+'?p='+TOKEN),
       purpose,expires_at:Math.floor(Date.now()/1000)+1200});
   },
   toast:(msg,variant)=>events.push('toast:'+variant),
   state:{pedidos:[{id:ID,fields:{'N° Pedido':'PED-042'}}],pedidosById:{}},
   _pdCliRec:()=>({fields:{Contacto:'Cliente Ejemplo',Email:'cliente@example.com'}}),
   _getClienteWAPhone:()=> '56912345678',
   ensurePodFields:async()=>{},
   ensureNpsFields:async()=>{},
   _atFetch:async()=>Response.json({tables:[]}),
   getToken:()=>null,
   BASE_ID:'app1YtD74AqiPWQhy',
   escapeHtml:v=>v,
   validEmail:()=>true,
   switchTab:()=>{},
   MAIL:{openCompose:()=>events.push('compose')},
   AGENT_CTA_FROM:{name:'Andrea',email:'hola@thelab.solutions'},
   setTimeout:cb=>cb(),
   prompt:()=>null,
 };
 const safe=frag.replace("'%%FEEDBACK_ACCESS_MODE%%'",active?"'true'":"'false'");
 const fns=new Function(...Object.keys(mocks),safe+
   '\nreturn {_feedbackAccessMode,_feedbackSecureLink,compartirSeguimiento,pedirPOD,'+
   '_pdMsg,_pdUsesNps,_npsLink,_feedbackPopupFail,_feedbackPopup,_podMsg};')(...Object.values(mocks));
 let marks=0;
 const extra={...mocks,...fns,pdMarkDone:()=>{marks++;}};
 const outbound=new Function(...Object.keys(extra),share+
   '\nreturn {pdWhatsApp,pdEmail};')(...Object.values(extra));
 return {...fns,...outbound,events,calls,popups,mocks,
   get marks(){return marks;}
 };
}
test('Access mode issues authenticated, private, purpose-bound tracking links before sharing',async()=>{
 const h=harness();
 await h.compartirSeguimiento(ID);
 assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].url,'https://proxy.thelab.solutions/feedback/link');
 assert.equal(h.calls[0].options.credentials,'include');
 assert.equal(h.calls[0].options.redirect,'error');
 assert.equal(h.calls[0].options.headers['X-App-Key'],'APP_PUBLIC');
 assert.deepEqual(JSON.parse(h.calls[0].options.body),{
   recordId:ID,purpose:'pedido',days:30
 });
 assert.equal(h.events[0],'open:about:blank','pre-open popup before awaiting signed link');
 assert.equal(h.events[1],'fetch');
 assert.ok(h.events.some(e=>e.includes('navigate:https://wa.me/')&&
   e.includes('PED-042')));
 assert.ok(h.events.some(e=>e.includes('t5f940')));
});
test('invalid issuer, network or role failure never falls back to unsigned record IDs',async()=>{
 const h=harness({fail:true});
 await h.compartirSeguimiento(ID);
 assert.equal(h.calls.length,1);
 assert.deepEqual(h.events.slice(-2),['close','toast:error']);
 assert.equal(h.events.some(e=>e.startsWith('navigate:')),false);
 const invalid=harness({issuerUrl:'https://evil.example/pedido?p='+TOKEN});
 await assert.rejects(()=>invalid._feedbackSecureLink({id:ID},'pedido'),
   /untrusted URL/);
});
test('NPS and POD share distinct signed links and preserve a popup through async issuance',async()=>{
 const h=harness();
 await h.pedirPOD(ID);
 assert.deepEqual(JSON.parse(h.calls[0].options.body),{
   recordId:ID,purpose:'pod',days:30
 });
 assert.ok(h.events.some(e=>e.startsWith('navigate:https://wa.me/')&&
   new URL(e.slice('navigate:'.length)).searchParams.get('text').includes('/pod')));
 const n=harness();
 await n.pdWhatsApp(ID);
 assert.equal(JSON.parse(n.calls[0].options.body).purpose,'nps');
 assert.equal(n.marks,1);
 assert.ok(n.events.some(e=>e.startsWith('navigate:https://wa.me/')&&
   new URL(e.slice('navigate:'.length)).searchParams.get('text').includes('/nps')));
 const fail=harness({fail:true});
 await fail.pdWhatsApp(ID);
 assert.equal(fail.marks,0);
 assert.deepEqual(fail.events.slice(-2),['close','toast:error']);
});
test('legacy mode keeps existing links without requesting privileged issuer',async()=>{
 const h=harness({active:false});
 await h.compartirSeguimiento(ID);
 assert.equal(h.calls.length,0);
 assert.ok(h.events.some(e=>e.startsWith('open:https://wa.me/')&&
   new URL(e.slice('open:'.length)).searchParams.get('text')
     .includes(Buffer.from(ID).toString('base64'))));
 const n=harness({active:false});
 await n.pdWhatsApp(ID);
 assert.equal(n.calls.length,0);
 assert.equal(n.marks,1);
});
test('CI deploy gate requires verified portal Access, same-site proxy and no secret in Pages',()=>{
 const d=fs.readFileSync(path.join(__dirname,'../.github/workflows/deploy.yml'),'utf8');
 assert.match(d,/vars\.FEEDBACK_ACCESS_MODE/);
 assert.match(d,/vars\.FEEDBACK_CUTOVER_VERIFIED/);
 assert.match(d,/\$\{PORTAL_ACCESS_MODE\}" != "true"/);
 assert.match(d,/%%FEEDBACK_ACCESS_MODE%%\|true\|g/);
 assert.match(d,/%%FEEDBACK_ACCESS_MODE%%\|false\|g/);
 assert.doesNotMatch(SRC,/FEEDBACK_LINK_SECRET|PORTAL_ADMIN_KEY/);
});
