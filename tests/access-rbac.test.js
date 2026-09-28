#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {generateKeyPairSync,sign,webcrypto}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/access-auth.js'),'utf8')
  .replace('export async function accessAuthorize','async function accessAuthorize');
const {accessConfig,accessVerify,accessAllows,accessAuthorize,accessTable}=
  new Function('crypto',source+'\nreturn {accessConfig,accessVerify,accessAllows,accessAuthorize,accessTable};')(webcrypto);
const cfg={
  ACCESS_ENFORCE:'true',ACCESS_TEAM_DOMAIN:'https://tls-test.cloudflareaccess.com',
  ACCESS_AUD:'a'.repeat(32),
  ACCESS_ROLE_MAP:JSON.stringify({'finanzas@example.com':'finance','operador@example.com':'operator','visita@example.com':'viewer'})
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
test('finance can write Facturas, operator and viewer cannot',async()=>{
  const path='/v0/app1YtD74AqiPWQhy/Facturas';
  assert.equal(accessAllows({role:'finance'},'POST',path),true);
  assert.equal(accessAllows({role:'operator'},'POST',path),false);
  assert.equal(accessAllows({role:'viewer'},'GET',path),false);
  assert.equal(accessAllows({role:'viewer'},'POST','/v0/app1YtD74AqiPWQhy/Clientes'),false);
  assert.equal(accessAllows({role:'operator'},'PATCH','/v0/app1YtD74AqiPWQhy/Pedidos/recABC123'),true);
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
test('unknown tables, metadata and path aliases fail closed for non-admin',()=>{
  assert.equal(accessTable('/v0/app1YtD74AqiPWQhy/%46acturas'),'');
  assert.equal(accessTable('/v0/app1YtD74AqiPWQhy/tblABCDEFGHIJKLMN'),'');
  assert.equal(accessAllows({role:'finance'},'GET','/v0/meta/bases/app1YtD74AqiPWQhy/tables'),false);
  assert.equal(accessAllows({role:'operator'},'DELETE','/v0/app1YtD74AqiPWQhy/Unknown'),false);
  assert.equal(accessAllows({role:'admin'},'DELETE','/v0/app1YtD74AqiPWQhy/Unknown'),true);
  assert.equal(accessTable('/v0/app1YtD74AqiPWQhy/Pr%C3%A9stamos'),'Préstamos');
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
