import test from'node:test';
import assert from'node:assert/strict';
import{createRequire}from'module';
import{mintSessionToken,roleForEmail,audMatches,b64urlText,b64urlBytes}from'../printer-access-worker/src/session.mjs';
import{verifyAccessJwt,accessKeys,safeReturn}from'../printer-access-worker/src/index.js';
const require=createRequire(import.meta.url);process.env.FARM_SESSION_SECRET='shared-test-secret-123456';process.env.FARM_DATA_DIR='/tmp/tls-farm-auth-worker-test';
const auth=require('../printer-bridge/farm-auth-preload.js');

test('Worker y controller comparten formato HMAC',async()=>{const m=await mintSessionToken({secret:'shared-test-secret-123456',role:'admin',sub:'admin@example.com',now:100,ttlSec:60});const v=auth.verifySession(m.token,{secret:'shared-test-secret-123456',now:120});assert.equal(v.ok,true);assert.equal(v.role,'admin');assert.equal(v.sub,'admin@example.com');});
test('roles y audience se resuelven explícitamente',()=>{assert.equal(roleForEmail('A@EXAMPLE.COM',{admins:'a@example.com',operators:''}),'admin');assert.equal(roleForEmail('x@example.com',{admins:'',operators:'op@example.com'}),'viewer');assert.equal(audMatches(['uno','dos'],'dos'),true);});
test('return de /login sólo acepta el origen del dashboard',()=>{const allowed='https://dashboard.thelab.solutions';assert.equal(safeReturn(allowed+'/index.html#maquinas',allowed),allowed+'/index.html#maquinas');assert.equal(safeReturn('https://evil.example/steal',allowed),allowed);assert.equal(safeReturn('javascript:alert(1)',allowed),allowed);});
test('kid nuevo fuerza refresco inmediato de certificados Access',async()=>{
  const oldPair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const newPair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const oldJwk=await crypto.subtle.exportKey('jwk',oldPair.publicKey),newJwk=await crypto.subtle.exportKey('jwk',newPair.publicKey);oldJwk.kid='old';newJwk.kid='new';
  const originalFetch=globalThis.fetch;let phase='old',calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({keys:[phase==='old'?oldJwk:newJwk]}),{status:200,headers:{'Content-Type':'application/json'}});};
  try{
    await accessKeys('team.example.cloudflareaccess.com',true);phase='new';
    const now=Math.floor(Date.now()/1000),header=b64urlText(JSON.stringify({alg:'RS256',kid:'new'})),payload=b64urlText(JSON.stringify({aud:['aud-1'],iss:'https://team.example.cloudflareaccess.com',email:'u@example.com',iat:now-1,nbf:now-1,exp:now+60})),input=header+'.'+payload;
    const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',newPair.privateKey,new TextEncoder().encode(input)),token=input+'.'+b64urlBytes(new Uint8Array(sig));
    const out=await verifyAccessJwt(token,{CLOUDFLARE_TEAM_DOMAIN:'team.example.cloudflareaccess.com',CLOUDFLARE_ACCESS_AUD:'aud-1'},now);assert.equal(out.ok,true);assert.equal(out.email,'u@example.com');assert.ok(calls>=2,'debió refrescar certs al encontrar kid desconocido');
  }finally{globalThis.fetch=originalFetch;}
});
