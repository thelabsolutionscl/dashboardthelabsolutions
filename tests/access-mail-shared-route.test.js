#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const authSource=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/access-auth.js'),'utf8')
  .replace('export async function accessAuthorize','async function accessAuthorize');
const {accessAllows}=new Function(authSource+'\nreturn {accessAllows};')();
const workerSource=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/worker.js'),'utf8')
  .replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const worker=');
const {
  CrmMutationGuard,worker,sharedMailSignatureAllowed,sharedMailAddressesAllowed,
  sharedMailTemplatesAllowed,sharedMailMailboxAllowed
}=new Function(workerSource+'\nreturn {CrmMutationGuard,worker,sharedMailSignatureAllowed,sharedMailAddressesAllowed,sharedMailTemplatesAllowed,sharedMailMailboxAllowed};')();
const priorFetch=global.fetch;
test.after(()=>{global.fetch=priorFetch;});
const APP='app1YtD74AqiPWQhy',TABLE='Monitor%20Sistema',BASE='/v0/'+APP+'/';
const IDS={
  MAIL_SIGNATURES:'recAAAAAAAAAAAAAA',
  MAIL_SENT_ADDRESSES:'recBBBBBBBBBBBBBB',
  MAIL_TEMPLATES:'recCCCCCCCCCCCCCC'
};
const signatures=()=>({
  'seller@thelab.solutions':'<p>Seller</p>',
  'other@thelab.solutions':'<p>Other</p>',
  'hola@thelab.solutions':'<p>Hola</p>'
});
const addresses=()=>({
  'seller@thelab.solutions':['a@cliente.cl'],
  'other@thelab.solutions':['b@cliente.cl'],
  'hola@thelab.solutions':['hola@cliente.cl'],
  'pagos@thelab.solutions':['facturas@cliente.cl']
});
const templates=()=>({version:1,updatedAt:1710000000000,templates:[
  {name:'Base',subject:'Hola',body:'<p>Base</p>'}
]});
function sha256(text){
  const {createHash}=require('node:crypto');
  return createHash('sha256').update(text).digest('hex');
}
function harness({withTemplates=false}={}){
  const current={
    MAIL_SIGNATURES:JSON.stringify(signatures()),
    MAIL_SENT_ADDRESSES:JSON.stringify(addresses()),
    MAIL_TEMPLATES:withTemplates?JSON.stringify(templates()):null
  };
  let patches=0,creates=0;
  const env={APP_KEY:'public-test',AIRTABLE_TOKEN:'pat-private'};
  const guard=new CrmMutationGuard({storage:{async get(){},async put(){},async delete(){}}},env);
  env.CRM_MUTATION_GUARD={
    idFromName(name){assert.equal(name,'tls-shared-mail');return name;},
    get(){return{fetch:(url,init)=>guard.fetch(new Request(url,init))}}
  };
  global.fetch=async(uri,opts={})=>{
    const u=new URL(String(uri));
    assert.equal(u.hostname,'api.airtable.com');
    const authorization=opts.headers instanceof Headers
      ?opts.headers.get('Authorization'):opts.headers?.Authorization;
    assert.equal(authorization,'Bearer '+env.AIRTABLE_TOKEN);
    const method=opts.method||'GET';
    if(method==='GET'){
      assert.equal(u.pathname,BASE+TABLE);
      const formula=u.searchParams.get('filterByFormula')||'';
      const m=/\{Name\}='([^']+)'/.exec(formula);
      assert.ok(m,'missing exact Name filter');
      const name=m[1],raw=current[name];
      return Response.json({records:raw==null?[]:[{id:IDS[name],fields:{Name:name,Notes:raw}}]});
    }
    if(method==='PATCH'){
      patches++;
      const id=u.pathname.split('/').pop();
      const body=JSON.parse(opts.body),name=body.fields.Name;
      assert.equal(id,IDS[name]);
      current[name]=body.fields.Notes;
      return Response.json({id,fields:{Name:name,Notes:current[name]}});
    }
    if(method==='POST'){
      creates++;
      assert.equal(u.pathname,BASE+TABLE);
      const body=JSON.parse(opts.body),name=body.fields.Name;
      current[name]=body.fields.Notes;
      return Response.json({id:IDS[name],fields:{Name:name,Notes:current[name]}});
    }
    throw Error('unexpected '+method);
  };
  const run=(method,{resource='signature',account='seller@thelab.solutions',body,
    identity={role:'sales',email:'seller@thelab.solutions'},legacy=false}={})=>{
    global.accessAuthorize=async(_req,_env,p)=>{
      if(legacy)return{legacy:true};
      if(!accessAllows(identity,method,p))
        return{response:Response.json({error:'denied'},{status:403})};
      return{identity};
    };
    const q=new URLSearchParams({resource});
    if(resource!=='templates')q.set('account',account);
    return worker.fetch(new Request('https://proxy.example.com/shared/mail?'+q.toString(),{
      method,headers:{Origin:'https://dashboard.thelab.solutions',
        'X-App-Key':env.APP_KEY,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    }),env,{waitUntil:()=>{}});
  };
  return{env,guard,run,current,get patches(){return patches},get creates(){return creates}};
}
test('role matrix: every signed role reads mail; viewer cannot write shared mail',()=>{
  for(const role of ['viewer','sales','operator','finance','admin'])
    assert.equal(accessAllows({role},'GET','/shared/mail'),true,role);
  assert.equal(accessAllows({role:'viewer'},'PUT','/shared/mail'),false);
  for(const role of ['sales','operator','finance','admin'])
    assert.equal(accessAllows({role},'PUT','/shared/mail'),true,role);
  for(const role of ['viewer','sales','operator','finance','admin'])
    for(const method of ['POST','PATCH','DELETE'])
      assert.equal(accessAllows({role},method,'/shared/mail'),false,role+' '+method);
});
test('mail validators accept live-shaped data and reject malformed or oversized content',()=>{
  assert.equal(sharedMailSignatureAllowed('<table><tr><td>Firma</td></tr></table>'),true);
  assert.equal(sharedMailSignatureAllowed('x\u0001y'),false);
  assert.equal(sharedMailAddressesAllowed(['a@cliente.cl','b@cliente.cl']),true);
  assert.equal(sharedMailAddressesAllowed(['a@cliente.cl','a@cliente.cl']),false);
  assert.equal(sharedMailTemplatesAllowed(templates()),true);
  assert.equal(sharedMailTemplatesAllowed({...templates(),secret:'x'}),false);
});
test('mailbox policy is self + hola; finance adds pagos; admin can use any TLS mailbox',()=>{
  assert.equal(sharedMailMailboxAllowed({role:'sales',email:'seller@thelab.solutions'},'seller@thelab.solutions',false),true);
  assert.equal(sharedMailMailboxAllowed({role:'sales',email:'seller@thelab.solutions'},'hola@thelab.solutions',false),true);
  assert.equal(sharedMailMailboxAllowed({role:'sales',email:'seller@thelab.solutions'},'other@thelab.solutions',false),false);
  assert.equal(sharedMailMailboxAllowed({role:'operator',email:'ops@thelab.solutions'},'pagos@thelab.solutions',false),false);
  assert.equal(sharedMailMailboxAllowed({role:'finance',email:'finanzas@thelab.solutions'},'pagos@thelab.solutions',false),true);
  assert.equal(sharedMailMailboxAllowed({role:'admin',email:'admin@thelab.solutions'},'nicanor@thelab.solutions',false),true);
  assert.equal(sharedMailMailboxAllowed({role:'admin',email:'admin@thelab.solutions'},'outside@example.com',false),false);
});
test('sales GET returns one signature only and cannot request another personal mailbox',async()=>{
  const h=harness();
  let res=await h.run('GET');
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.account,'seller@thelab.solutions');
  assert.equal(body.data,'<p>Seller</p>');
  assert.equal(body.revision,sha256(JSON.stringify('<p>Seller</p>')));
  assert.doesNotMatch(JSON.stringify(body),/other@thelab\.solutions|<p>Other<\/p>/);
  res=await h.run('GET',{account:'other@thelab.solutions'});
  assert.equal(res.status,403);
});
test('shared hola mailbox is readable while pagos is restricted to finance/admin',async()=>{
  const h=harness();
  let res=await h.run('GET',{resource:'sent-addresses',account:'hola@thelab.solutions'});
  assert.equal(res.status,200);
  assert.deepEqual((await res.json()).data,['hola@cliente.cl']);
  res=await h.run('GET',{resource:'sent-addresses',account:'pagos@thelab.solutions',
    identity:{role:'operator',email:'ops@thelab.solutions'}});
  assert.equal(res.status,403);
  res=await h.run('GET',{resource:'sent-addresses',account:'pagos@thelab.solutions',
    identity:{role:'finance',email:'finanzas@thelab.solutions'}});
  assert.equal(res.status,200);
  assert.deepEqual((await res.json()).data,['facturas@cliente.cl']);
});
test('same mailbox concurrent writes use CAS and only one overwrites',async()=>{
  const h=harness(),rev=sha256(JSON.stringify('<p>Seller</p>'));
  const [a,b]=await Promise.all([
    h.run('PUT',{body:{resource:'signature',account:'seller@thelab.solutions',
      data:'<p>A</p>',expectedRevision:rev}}),
    h.run('PUT',{body:{resource:'signature',account:'seller@thelab.solutions',
      data:'<p>B</p>',expectedRevision:rev}})
  ]);
  assert.deepEqual([a.status,b.status],[200,409]);
  const conflict=await b.json();
  assert.equal(conflict.code,'MAIL_REVISION_CONFLICT');
  assert.equal(conflict.data,'<p>A</p>');
  assert.equal(h.patches,1);
});
test('different mailboxes in the same Airtable record can update without false conflicts',async()=>{
  const h=harness(),start=addresses();
  const seller=['new@cliente.cl'],other=['other-new@cliente.cl'];
  const [a,b]=await Promise.all([
    h.run('PUT',{resource:'sent-addresses',account:'seller@thelab.solutions',
      body:{resource:'sent-addresses',account:'seller@thelab.solutions',data:seller,
        expectedRevision:sha256(JSON.stringify(start['seller@thelab.solutions']))}}),
    h.run('PUT',{resource:'sent-addresses',account:'other@thelab.solutions',
      identity:{role:'sales',email:'other@thelab.solutions'},
      body:{resource:'sent-addresses',account:'other@thelab.solutions',data:other,
        expectedRevision:sha256(JSON.stringify(start['other@thelab.solutions']))}})
  ]);
  assert.deepEqual([a.status,b.status],[200,200]);
  const final=JSON.parse(h.current.MAIL_SENT_ADDRESSES);
  assert.deepEqual(final['seller@thelab.solutions'],seller);
  assert.deepEqual(final['other@thelab.solutions'],other);
  assert.deepEqual(final['hola@thelab.solutions'],start['hola@thelab.solutions']);
  assert.equal(h.patches,2);
});
test('templates are global, redacted from Airtable metadata, and created once when absent',async()=>{
  const h=harness();
  let res=await h.run('GET',{resource:'templates',account:'',identity:{role:'viewer',email:'viewer@thelab.solutions'}});
  assert.equal(res.status,200);
  let body=await res.json();
  assert.equal(body.exists,false);
  assert.deepEqual(body.data,{version:1,updatedAt:0,templates:[]});
  assert.equal(body.recordId,undefined);
  const data=templates();
  res=await h.run('PUT',{resource:'templates',account:'',
    identity:{role:'operator',email:'ops@thelab.solutions'},
    body:{resource:'templates',data,expectedRevision:body.revision}});
  assert.equal(res.status,200,await res.clone().text());
  assert.equal(h.creates,1);
  body=await res.json();assert.deepEqual(body.data,data);
});
test('viewer PUT is denied before mutation and direct DO revalidates mailbox scope',async()=>{
  const h=harness(),rev=sha256(JSON.stringify('<p>Seller</p>'));
  let res=await h.run('PUT',{identity:{role:'viewer',email:'seller@thelab.solutions'},
    body:{resource:'signature',account:'seller@thelab.solutions',data:'<p>X</p>',expectedRevision:rev}});
  assert.equal(res.status,403);assert.equal(h.patches,0);
  res=await h.guard.fetch(new Request('https://crm-write.internal/shared-mail',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({actor:{role:'sales',email:'seller@thelab.solutions'},
      resource:'signature',account:'other@thelab.solutions',data:'<p>X</p>',
      expectedRevision:sha256(JSON.stringify('<p>Other</p>'))})
  }));
  assert.equal(res.status,403);assert.equal(h.patches,0);
});
