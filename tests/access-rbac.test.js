#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {generateKeyPairSync,sign,webcrypto}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/access-auth.js'),'utf8')
  .replace('export async function accessAuthorize','async function accessAuthorize');
const {accessConfig,accessVerify,accessVerifyLeadService,accessAllows,accessAuthorize,accessTable}=
  new Function('crypto',source+'\nreturn {accessConfig,accessVerify,accessVerifyLeadService,accessAllows,accessAuthorize,accessTable};')(webcrypto);
const cfg={
  ACCESS_ENFORCE:'true',ACCESS_TEAM_DOMAIN:'https://tls-test.cloudflareaccess.com',
  ACCESS_AUD:'a'.repeat(32),
  ACCESS_ROLE_MAP:JSON.stringify({'finanzas@example.com':'finance','operador@example.com':'operator','visita@example.com':'viewer','administrador@example.com':'admin'})
};
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk=publicKey.export({format:'jwk'});
jwk.kid='test-kid';jwk.alg='RS256';jwk.use='sig';
function b64(json){return Buffer.from(JSON.stringify(json)).toString('base64url');}
function jwt(overrides={},header={}){
  const now=Math.floor(Date.now()/1000);
  const h=b64({alg:'RS256',kid:'test-kid',typ:'JWT',...header});
  const p=b64({iss:cfg.ACCESS_TEAM_DOMAIN,aud:[cfg.ACCESS_AUD],
    exp:now+300,iat:now-2,email:'finanzas@example.com',...overrides});
  const msg=h+'.'+p;
  return msg+'.'+sign('RSA-SHA256',Buffer.from(msg),privateKey).toString('base64url');
}
const originalFetch=global.fetch;
global.fetch=async url=>{
  if(url!==cfg.ACCESS_TEAM_DOMAIN+'/cdn-cgi/access/certs')throw Error('Unexpected key URL');
  return Response.json({keys:[jwk]});
};
test.after(()=>{global.fetch=originalFetch;});
function req(token,method='GET',path='/v0/app1YtD74AqiPWQhy/Facturas'){
  const headers=new Headers();
  if(token)headers.set('Cf-Access-Jwt-Assertion',token);
  return {request:new Request('https://proxy.example.com'+path,{method,headers}),path};
}
test('legacy mode unchanged until explicit Access configuration',async()=>{
  const {request,path}=req(null);
  assert.equal((await accessAuthorize(request,{},path)).legacy,true);
});
test('partial or invalid config never falls back to public APP_KEY',async()=>{
  const {request,path}=req(null);
  assert.equal((await accessAuthorize(request,{ACCESS_ENFORCE:'true'},path)).response.status,503);
  assert.equal((await accessAuthorize(request,{ACCESS_TEAM_DOMAIN:cfg.ACCESS_TEAM_DOMAIN},path)).response.status,503);
});
test('missing JWT or unmapped signed identity fails closed',async()=>{
  const absent=req(null);
  assert.equal((await accessAuthorize(absent.request,cfg,absent.path)).response.status,401);
  const unknown=req(jwt({email:'unknown@example.com'}));
  assert.equal((await accessAuthorize(unknown.request,cfg,unknown.path)).response.status,401);
});
test('valid RS256 JWT grants only mapped explicit role',async()=>{
  const {request,path}=req(jwt());
  const result=await accessAuthorize(request,cfg,path);
  assert.deepEqual(result.identity,{email:'finanzas@example.com',role:'finance'});
});
test('tampering, wrong issuer, audience, algorithm and expiration are rejected',async()=>{
  for(const value of [
    jwt({iss:'https://other.cloudflareaccess.com'}),
    jwt({aud:['some-other-aud']}),
    jwt({exp:1}),
    jwt({email:'operador@example.com'},{alg:'none'}),
    (()=>{const parts=jwt().split('.');parts[1]=b64({iss:cfg.ACCESS_TEAM_DOMAIN,aud:[cfg.ACCESS_AUD],exp:9999999999,email:'finanzas@example.com'});return parts.join('.');})()
  ]){
    await assert.rejects(()=>accessVerify(value,accessConfig(cfg)));
  }
});
test('signed Access service token is restricted to lead-worker route',async()=>{
  const path='/service/lead/anthropic/v1/messages';
  const serviceId='lead-machine-123.access';
  const env={...cfg,ACCESS_LEAD_SERVICE_CLIENT_ID:serviceId};
  const claims={type:'app',sub:'',common_name:serviceId,email:undefined};
  const machine=req(jwt(claims),'POST',path);
  const result=await accessAuthorize(machine.request,env,path);
  assert.equal(result.serviceIdentity.role,'lead-service');
  assert.equal(result.serviceIdentity.client_id,serviceId);
  const interactive=req(jwt(claims),'POST','/v0/app1YtD74AqiPWQhy/Facturas');
  assert.equal((await accessAuthorize(interactive.request,env,interactive.path)).response.status,401);
  const human=req(jwt({type:'app',sub:'human-uuid'}),'POST',path);
  assert.equal((await accessAuthorize(human.request,env,path)).response.status,401);
  const other=req(jwt({...claims,common_name:'someone-else.access'}),'POST',path);
  assert.equal((await accessAuthorize(other.request,env,path)).response.status,401);
  const expired=req(jwt({...claims,exp:1}),'POST',path);
  assert.equal((await accessAuthorize(expired.request,env,path)).response.status,401);
  const incorrectMethod=req(jwt(claims),'GET',path);
  assert.equal((await accessAuthorize(incorrectMethod.request,env,path)).response.status,405);
});
test('service route never falls back to shared APP_KEY on partial Access config',async()=>{
  const path='/service/lead/anthropic/v1/messages';
  const naked=req(null,'POST',path);
  assert.equal((await accessAuthorize(naked.request,{},path)).response.status,503);
  assert.equal((await accessAuthorize(naked.request,cfg,path)).response.status,401);
  const machine=req(jwt({type:'app',sub:'',common_name:'lead-machine-123.access',email:undefined}),'POST',path);
  assert.equal((await accessAuthorize(machine.request,cfg,path)).response.status,401);
});
test('finance can write Facturas, operator and viewer cannot',async()=>{
  const path='/v0/app1YtD74AqiPWQhy/Facturas';
  assert.equal(accessAllows({role:'finance'},'POST',path),true);
  assert.equal(accessAllows({role:'operator'},'POST',path),false);
  assert.equal(accessAllows({role:'viewer'},'GET',path),false);
  assert.equal(accessAllows({role:'viewer'},'POST','/v0/app1YtD74AqiPWQhy/Clientes'),false);
  assert.equal(accessAllows({role:'operator'},'PATCH','/v0/app1YtD74AqiPWQhy/Pedidos/recABCDEFGHIJKLMN'),true);
  assert.equal(accessAllows({role:'operator'},'PATCH',path),false);
});
test('privileged SII bridge only permits finance emission/status and admin CAF',()=>{
  assert.equal(accessAllows({role:'finance'},'POST','/sii/emit'),true);
  assert.equal(accessAllows({role:'finance'},'GET','/sii/folio/33'),true);
  assert.equal(accessAllows({role:'finance'},'PUT','/sii/caf'),false);
  assert.equal(accessAllows({role:'operator'},'POST','/sii/emit'),false);
  assert.equal(accessAllows({role:'viewer'},'GET','/sii/folio/33'),false);
  assert.equal(accessAllows({role:'admin'},'PUT','/sii/caf'),true);
  assert.equal(accessAllows({role:'finance'},'GET','/sii/folio/999'),false);
});
test('printer tickets require a signed human role but cannot proxy arbitrary machine routes',()=>{
  for(const role of ['viewer','operator','finance','admin']){
    assert.equal(accessAllows({role},'POST','/printer/session'),true,role);
  }
  for(const role of ['viewer','operator','finance']){
    assert.equal(accessAllows({role},'GET','/printer/session'),false);
    assert.equal(accessAllows({role},'POST','/printer/restart'),false);
  }
});
test('portal administration requires explicit signed roles',()=>{
  assert.equal(accessAllows({role:'operator'},'POST','/portal-admin/link'),true);
  assert.equal(accessAllows({role:'finance'},'POST','/portal-admin/link'),true);
  assert.equal(accessAllows({role:'admin'},'POST','/portal-admin/link'),true);
  assert.equal(accessAllows({role:'operator'},'POST','/portal-admin/revocar'),false);
  assert.equal(accessAllows({role:'finance'},'POST','/portal-admin/revocar'),false);
  assert.equal(accessAllows({role:'viewer'},'POST','/portal-admin/link'),false);
  assert.equal(accessAllows({role:'admin'},'POST','/portal-admin/revocar'),true);
  assert.equal(accessAllows({role:'admin'},'GET','/portal-admin/revocar'),false);
  assert.equal(accessAllows({role:'finance'},'POST','/portal-admin/other'),false);
});
test('operational supplier/monitoring tables work with Access, reports remain financial',()=>{
  const base='/v0/app1YtD74AqiPWQhy/';
  assert.equal(accessAllows({role:'operator'},'GET',base+'Monitor%20Sistema'),true);
  assert.equal(accessAllows({role:'operator'},'PATCH',base+'Proveedores/recABCDEFGHIJKLMN'),true);
  assert.equal(accessAllows({role:'operator'},'GET',base+'Reportes'),false);
  assert.equal(accessAllows({role:'finance'},'GET',base+'Reportes'),true);
  assert.equal(accessAllows({role:'finance'},'POST',base+'Reportes'),true);
  assert.equal(accessAllows({role:'viewer'},'GET',base+'Reportes'),false);
  assert.equal(accessAllows({role:'viewer'},'PATCH',base+'Monitor%20Sistema/recABCDEFGHIJKLMN'),false);
});
test('unknown tables, metadata and path aliases fail closed for non-admin',()=>{
  assert.equal(accessTable('/v0/app1YtD74AqiPWQhy/%46acturas'),'');
  assert.equal(accessTable('/v0/app1YtD74AqiPWQhy/tblABCDEFGHIJKLMN'),'');
  assert.equal(accessAllows({role:'finance'},'GET','/v0/meta/bases/app1YtD74AqiPWQhy/tables'),false);
  assert.equal(accessAllows({role:'operator'},'DELETE','/v0/app1YtD74AqiPWQhy/Unknown'),false);
  assert.equal(accessAllows({role:'admin'},'DELETE','/v0/app1YtD74AqiPWQhy/Unknown'),false);
  assert.equal(accessTable('/v0/app1YtD74AqiPWQhy/Pr%C3%A9stamos'),'Préstamos');
});
test('admin has no blanket bypass for undocumented routes or HTTP methods',()=>{
  const admin={role:'admin'},base='/v0/app1YtD74AqiPWQhy/';
  const yes=[
    ['GET',base+'Clientes'],['GET',base+'Facturas'],['POST',base+'Pedidos'],
    ['PATCH',base+'Pedidos/recABCDEFGHIJKLMN'],
    ['DELETE',base+'Clientes/recABCDEFGHIJKLMN'],
    ['GET','/access/me'],['GET','/marketing/spend/history'],
    ['PUT','/marketing/spend'],['POST','/printer/session'],
    ['POST','/portal-admin/link'],['POST','/portal-admin/revocar'],
    ['POST','/sii/emit'],['GET','/sii/folio/33'],['PUT','/sii/caf'],
    ['GET','/anthropic/usage'],['POST','/anthropic/v1/messages'],
    ['GET','/openai/usage'],['POST','/openai/v1/images/edits'],
    ['GET','/seo-fetch'],
    ['GET','/v0/meta/bases/app1YtD74AqiPWQhy/tables'],
    ['POST','/v0/meta/bases/app1YtD74AqiPWQhy/tables'],
    ['POST','/v0/meta/bases/app1YtD74AqiPWQhy/tables/tblABCDEFGHIJKLMN/fields']
  ];
  for(const [method,path] of yes)
    assert.equal(accessAllows(admin,method,path),true,method+' '+path);
  const no=[
    ['GET','/unknown'],['POST','/unknown'],
    ['DELETE',base+'Unknown'],['GET',base+'tblABCDEFGHIJKLMN'],
    ['GET',base+'%46acturas'],['GET',base+'Facturas/recABCDEFGHIJKLMN/attachments'],
    ['GET',base+'Facturas/recshort'],['GET',base+'Facturas/'],['GET',base+'Facturas//'],
    ['GET',base+'Facturas%2f../Clientes'],['GET','/v0/meta/bases/other/tables'],
    ['DELETE','/v0/meta/bases/app1YtD74AqiPWQhy/tables'],
    ['POST','/v0/meta/bases/app1YtD74AqiPWQhy/tables/tblABCDEFGHIJKLMN/delete'],
    ['GET','/printer/restart'],['POST','/printer/restart'],
    ['GET','/portal-admin/revocar'],['POST','/portal-admin/anything'],
    ['POST','/sii/folio/33'],['GET','/sii/folio/999'],['DELETE','/sii/caf'],
    ['PUT','/marketing/spend/history'],['DELETE','/marketing/spend'],
    ['POST','/seo-fetch'],['POST','/anthropic/usage'],
    ['POST','/anthropic/models'],['POST','/openai/v1/models'],
    ['PUT',base+'Clientes'],['HEAD',base+'Pedidos']
  ];
  for(const [method,path] of no)
    assert.equal(accessAllows(admin,method,path),false,method+' '+path);
  assert.equal(accessAllows({role:'superadmin'},'GET',base+'Clientes'),false);
  assert.equal(accessAllows(null,'GET',base+'Clientes'),false);
  assert.equal(accessAllows({role:'viewer'},'GET',base+'Clientes'),true);
  assert.equal(accessAllows({role:'operator'},'PATCH',base+'Pedidos/recABCDEFGHIJKLMN'),true);
  assert.equal(accessAllows({role:'finance'},'POST',base+'Reportes'),true);
});
test('signed admin JWT cannot request an unknown table or unrelated privileged endpoint',async()=>{
  const token=jwt({email:'administrador@example.com'}),base='/v0/app1YtD74AqiPWQhy/';
  for(const [method,path] of [
    ['GET',base+'SecretTable'],['DELETE',base+'tblABCDEFGHIJKLMN'],
    ['DELETE','/marketing/spend'],['GET','/portal-admin/revocar'],
    ['POST','/printer/restart'],['POST','/sii/random'],
    ['GET','/v0/meta/bases/other/tables']
  ]){
    const r=req(token,method,path);
    assert.equal((await accessAuthorize(r.request,cfg,r.path)).response.status,403,method+' '+path);
  }
  const legal=req(token,'POST',base+'Facturas');
  assert.deepEqual((await accessAuthorize(legal.request,cfg,legal.path)).identity,
    {role:'admin',email:'administrador@example.com'});
});
test('valid JWT but insufficient role is explicitly forbidden',async()=>{
  const x=req(jwt({email:'visita@example.com'}),'POST');
  assert.equal((await accessAuthorize(x.request,cfg,x.path)).response.status,403);
});
test('proxy wires Access after shared compatibility key, before any private route',()=>{
  const proxy=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/worker.js'),'utf8');
  const key=proxy.indexOf("const appKey = request.headers.get('X-App-Key')");
  const access=proxy.indexOf('await accessAuthorize(request,env',key);
  const ai=proxy.indexOf("if (url.pathname === '/anthropic/usage')");
  assert.ok(key>0&&access>key&&ai>access);
});
