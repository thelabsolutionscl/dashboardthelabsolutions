#!/usr/bin/env node
'use strict';
/*
 * End-to-end in-process checks for the *real* Access verifier with the
 * isolated, read-only QA worker. All JWTs, secrets and API responses below
 * are synthetic. The tests do not contact Cloudflare or Airtable.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {generateKeyPairSync,sign,webcrypto}=require('node:crypto');

const authSource=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/access-auth.js'),'utf8')
  .replace('export async function accessAuthorize','async function accessAuthorize');
assert.match(authSource,/async function accessAuthorize\(/);
const {accessAuthorize}=new Function('crypto',
  authSource+'\nreturn {accessAuthorize};')(webcrypto);
const workerSource=fs.readFileSync(path.join(__dirname,'../airtable-proxy-qa/src/worker.js'),'utf8')
  .replace(/^import \{ accessAuthorize \} from '[^']+';\s*$/m,'')
  .replace('export default {','const qaWorker = {');
const qaWorker=new Function('accessAuthorize',workerSource+'\nreturn qaWorker;')(accessAuthorize);

const team='https://qa-security-test.cloudflareaccess.com';
const aud='signed-qa-audience-1234567890';
const qaBase='app55FbVNr3yhTlbL';
const productionBase='app1YtD74AqiPWQhy';
const sellers=Object.freeze({
  'gustavo@thelab.solutions':'admin',
  'nicanor@thelab.solutions':'admin',
  'florencia@thelab.solutions':'sales'
});
const env=Object.freeze({
  QA_MODE:'true',QA_BASE_ID:qaBase,
  QA_AIRTABLE_TOKEN:'pat_testing_qa_only_not_real',
  ACCESS_ENFORCE:'true',ACCESS_TEAM_DOMAIN:team,ACCESS_AUD:aud,
  ACCESS_ROLE_MAP:JSON.stringify(sellers),
  ACCESS_SELLER_MAP:JSON.stringify({'florencia@thelab.solutions':'florencia'})
});

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk=publicKey.export({format:'jwk'});
Object.assign(jwk,{kid:'qa-test-key',alg:'RS256',use:'sig'});
function encode(value){return Buffer.from(JSON.stringify(value)).toString('base64url');}
function jwt(email='gustavo@thelab.solutions',claims={},header={}){
  const now=Math.floor(Date.now()/1000);
  const first=encode({alg:'RS256',kid:'qa-test-key',typ:'JWT',...header});
  const second=encode({iss:team,aud:[aud],iat:now-2,exp:now+300,type:'app',email,...claims});
  const signed=first+'.'+second;
  return signed+'.'+sign('RSA-SHA256',Buffer.from(signed),privateKey).toString('base64url');
}
function request(route,token,method='GET',host='qa-proxy.thelab.solutions'){
  const headers={};
  if(token)headers['Cf-Access-Jwt-Assertion']=token;
  return new Request('https://'+host+route,{method,headers});
}
const clients=[
  {id:'recJ4XtW2jbDPCApI',fields:{Empresa:'QA Cliente Florencia',Vendedor:'florencia',
    Email:'qa.florencia@example.invalid','Monto facturado':999999,Cotizaciones:['recFAKE1234567890']}},
  {id:'recCPX9vFGkAjZtBu',fields:{Empresa:'QA Cliente Gustavo',Vendedor:'gustavo',Email:'qa.gustavo@example.invalid'}},
  {id:'recNHweZXaqTi3xH9',fields:{Empresa:'QA Cliente Nicanor',Vendedor:'nicanor',Email:'qa.nicanor@example.invalid'}}
];
const originalFetch=global.fetch;
const upstreamCalls=[];
global.fetch=async(uri,options)=>{
  const url=new URL(uri);
  if(url.origin===team){
    assert.equal(url.pathname,'/cdn-cgi/access/certs');
    return Response.json({keys:[jwk]});
  }
  assert.equal(url.origin,'https://api.airtable.com');
  assert.ok(url.pathname.startsWith('/v0/'+qaBase+'/'), 'only the QA base is reachable');
  assert.ok(!url.pathname.includes(productionBase));
  assert.equal(options.method,'GET');
  assert.equal(options.headers.Authorization,'Bearer '+env.QA_AIRTABLE_TOKEN);
  upstreamCalls.push({url,method:options.method});
  const table=decodeURIComponent(url.pathname.split('/')[3]);
  const rows=clients.map((r,i)=>({
    id:r.id,fields:table==='Clientes'?r.fields:{
      Vendedor:r.fields.Vendedor,
      ...(table==='Cotizaciones'?{'N° Cotización':'QA-COT-'+i,'Costo fabricación':99999}:
        {'N° Pedido':'QA-PED-'+i,'Banco':'NEVER EXPOSE'})
    }
  }));
  const id=url.pathname.split('/')[4];
  if(id){
    const one=rows.find(r=>r.id===id);
    return one?Response.json(one):Response.json({error:'NOT_FOUND'},{status:404});
  }
  // Return all owners even if Airtable ignores its own filter: our Worker must
  // enforce the owner boundary on the response, not trust upstream filtering.
  return Response.json({records:rows});
};
test.after(()=>{global.fetch=originalFetch;});

test('real signed JWT grants both admins full QA data and limits sales by owner',async()=>{
  for(const email of ['gustavo@thelab.solutions','nicanor@thelab.solutions']){
    const me=await qaWorker.fetch(request('/access/me',jwt(email)),env);
    assert.equal(me.status,200);
    assert.deepEqual(await me.json(),{email,role:'admin'});
    const list=await qaWorker.fetch(request('/crm/Clientes',jwt(email)),env);
    assert.equal(list.status,200);
    assert.equal((await list.json()).records.length,3);
  }
  const me=await qaWorker.fetch(request('/access/me',jwt('florencia@thelab.solutions')),env);
  assert.deepEqual(await me.json(),{email:'florencia@thelab.solutions',role:'sales',seller:'florencia'});
  for(const table of ['Clientes','Cotizaciones','Pedidos']){
    const response=await qaWorker.fetch(request('/crm/'+table,jwt('florencia@thelab.solutions')),env);
    assert.equal(response.status,200,table);
    const data=await response.json();
    assert.equal(data.records.length,1);
    assert.equal(data.records[0].fields.Vendedor,'florencia');
    assert.equal(data.records[0].fields['Monto facturado'],undefined);
    assert.equal(data.records[0].fields.Cotizaciones,undefined);
    assert.equal(data.records[0].fields.Banco,undefined);
  }
  const last=upstreamCalls.at(-1).url;
  assert.equal(last.searchParams.get('filterByFormula'),"{Vendedor}='florencia'");
});

test('commercial JWT cannot read another seller record by guessed ID',async()=>{
  const token=jwt('florencia@thelab.solutions');
  const denied=await qaWorker.fetch(request('/crm/Clientes/recCPX9vFGkAjZtBu',token),env);
  assert.equal(denied.status,404);
  const allowed=await qaWorker.fetch(request('/crm/Clientes/recJ4XtW2jbDPCApI',token),env);
  assert.equal(allowed.status,200);
  assert.equal((await allowed.json()).fields.Vendedor,'florencia');
});

test('unsigned, forged, expired, other audience, unmapped and disabled access are rejected',async()=>{
  const token=jwt('gustavo@thelab.solutions');
  const [h,p,s]=token.split('.');
  const tampered=h+'.'+encode({...JSON.parse(Buffer.from(p,'base64url').toString()),email:'florencia@thelab.solutions'})+'.'+s;
  const variants=[
    null,tampered,jwt('externo@example.invalid'),jwt('gustavo@thelab.solutions',{exp:1}),
    jwt('gustavo@thelab.solutions',{aud:['other']}),jwt('gustavo@thelab.solutions',{iss:'https://other.cloudflareaccess.com'}),
    jwt('gustavo@thelab.solutions',{}, {alg:'none'})
  ];
  const start=upstreamCalls.length;
  for(const bad of variants){
    const response=await qaWorker.fetch(request('/crm/Clientes',bad),env);
    assert.equal(response.status,401);
  }
  assert.equal((await qaWorker.fetch(request('/crm/Clientes',token),{...env,ACCESS_AUD:'wrong-audience-1234567890'})).status,401);
  assert.equal((await qaWorker.fetch(request('/crm/Clientes',token),{...env,ACCESS_ROLE_MAP:'bad-json'})).status,503);
  assert.equal((await qaWorker.fetch(request('/crm/Clientes',token),{...env,ACCESS_SELLER_MAP:'{}'})).status,503);
  assert.equal(upstreamCalls.length,start,'no denied request reaches Airtable');
});

test('wrong host/base, an expired authorization and every attempted write fail closed',async()=>{
  const token=jwt('gustavo@thelab.solutions');
  const start=upstreamCalls.length;
  assert.equal((await qaWorker.fetch(request('/crm/Clientes',token,'GET','proxy.thelab.solutions'),env)).status,503);
  assert.equal((await qaWorker.fetch(request('/crm/Clientes',token),{...env,QA_BASE_ID:productionBase})).status,503);
  assert.equal((await qaWorker.fetch(request('/crm/Clientes',token),{...env,QA_AIRTABLE_TOKEN:''})).status,503);
  assert.equal((await qaWorker.fetch(request('/crm/Clientes',token),{...env,QA_MODE:'false'})).status,503);
  assert.equal((await qaWorker.fetch(request('/crm/Clientes',token),{...env,ACCESS_ENFORCE:'false'})).status,503);
  for(const method of ['POST','PATCH','DELETE','PUT']){
    assert.equal((await qaWorker.fetch(request('/crm/Clientes',token,method),env)).status,405);
  }
  assert.equal(upstreamCalls.length,start,'write or bad configuration must not contact Airtable');
});
