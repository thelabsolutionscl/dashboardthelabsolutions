#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'airtable-proxy/src/worker.js'),'utf8')
  .replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const wk =');
let identity=null;
global.accessAuthorize=async()=>identity?{identity}:{legacy:true};
const worker=new Function(source+'\nreturn wk;')();
const origFetch=global.fetch;
const env={APP_KEY:'published-compat-key',PRINTER_VIEWER_TOKEN:'viewer-master-never-public-000',
  PRINTER_OPERATOR_TOKEN:'operator-master-never-public-000',
  PRINTER_ADMIN_TOKEN:'admin-master-never-public-000'};
const req=(route='/printer/session',method='POST',key=env.APP_KEY)=>new Request('https://proxy.example.com'+route,{
  method,headers:{Origin:'https://dashboard.thelab.solutions','X-App-Key':key}
});
const calls=[];
const ticket=role=>Response.json({ok:true,token:'temporary_ticket_abcdefghijklmnopqrstuvwxyz',
  role,expiresAt:Date.now()+600000},{status:201});
let upstream=ticket('viewer');
global.fetch=async(url,options)=>{calls.push({url:String(url),options});return upstream;};
test.after(()=>{global.fetch=origFetch;});
test('legacy APP_KEY alone cannot obtain a farm ticket',async()=>{
  identity=null;calls.length=0;
  assert.equal((await worker.fetch(req(),env)).status,503);
  assert.equal(calls.length,0);
});
test('all roles get only their corresponding temporary credential; no master returned',async()=>{
  for(const [userRole,expectedRole] of [['viewer','viewer'],['finance','viewer'],['operator','operator'],['admin','admin']]){
    identity={email:userRole+'@example.com',role:userRole};
    upstream=ticket(expectedRole);calls.length=0;
    const response=await worker.fetch(req(),env);
    assert.equal(response.status,200,userRole);
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,'https://printers.thelab.solutions/farm/session');
    assert.equal(calls[0].options.redirect,'manual');
    const envKey='PRINTER_'+expectedRole.toUpperCase()+'_TOKEN';
    assert.equal(calls[0].options.headers['X-Bridge-Token'],env[envKey]);
    const result=await response.json();
    assert.equal(result.role,expectedRole);
    assert.equal(result.token,'temporary_ticket_abcdefghijklmnopqrstuvwxyz');
    assert.equal(JSON.stringify(result).includes(env[envKey]),false);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
});
test('missing role-specific secret, wrong method, unexpected route fail closed',async()=>{
  identity={email:'sales@example.com',role:'operator'};calls.length=0;
  assert.equal((await worker.fetch(req(),{...env,PRINTER_OPERATOR_TOKEN:''})).status,503);
  assert.equal((await worker.fetch(req('/printer/session','GET'),env)).status,404);
  assert.equal((await worker.fetch(req('/printer/restart'),env)).status,404);
  assert.equal((await worker.fetch(req('/printer/session?redirect=https://evil.example'),env)).status,404);
  assert.equal(calls.length,0);
});
test('upstream session cannot elevate identity or supply bad expiry/token',async()=>{
  identity={email:'reader@example.com',role:'viewer'};calls.length=0;
  for(const doc of [
    {ok:true,role:'admin',token:'abcdefghijklmnopqrstuvwxyz123456',expiresAt:Date.now()+600000},
    {ok:true,role:'viewer',token:'abcdefghijklmnopqrstuvwxyz123456',expiresAt:Date.now()+3600000},
    {ok:true,role:'viewer',token:'weak',expiresAt:Date.now()+600000}
  ]){
    upstream=Response.json(doc,{status:201});
    assert.equal((await worker.fetch(req(),env)).status,502);
  }
});
test('unexpected redirect, bad content-type and network failure never retry master secret',async()=>{
  identity={email:'admin@example.com',role:'admin'};calls.length=0;
  upstream=new Response(null,{status:302,headers:{Location:'https://evil.example'}});
  assert.equal((await worker.fetch(req(),env)).status,502);
  assert.equal(calls.length,1);
  calls.length=0;
  upstream=new Response('invalid',{status:201,headers:{'Content-Type':'text/html'}});
  assert.equal((await worker.fetch(req(),env)).status,502);
  assert.equal(calls.length,1);
  calls.length=0;
  global.fetch=async()=>{calls.push({});throw Error('network lost');};
  assert.equal((await worker.fetch(req(),env)).status,502);
  assert.equal(calls.length,1);
});
test('frontend secure mode always blocks fallback to public master key',()=>{
  const m=fs.readFileSync(path.join(root,'js/maquinas.js'),'utf8');
  const workflow=fs.readFileSync(path.join(root,'.github/workflows/deploy.yml'),'utf8');
  assert.match(m,/function _printerAccessMode\(\)\{return '%%PRINTER_ACCESS_MODE%%'==='true';\}/);
  assert.match(m,/function _getPrinterTunnelLongToken\(\)\{[\s\S]*?if\(_printerAccessMode\(\)\)return '';/);
  assert.match(m,/function getPrinterTunnelToken\(\)[\s\S]*?return _printerAccessMode\(\)\?'':_getPrinterTunnelLongToken\(\)/);
  assert.match(m,/async function _refreshPrinterAccessTicket\(force=false\)/);
  assert.match(m,/credentials:'include',redirect:'error'/);
  assert.match(m,/localStorage\.removeItem\('printer_tunnel_token'\)/);
  assert.match(m,/sessionStorage\.removeItem\('printer_tunnel_token'\)/);
  assert.match(workflow,/vars\.PRINTER_ACCESS_MODE/);
  assert.match(workflow,/vars\.PRINTER_CUTOVER_VERIFIED/);
  assert.match(workflow,/s\|%%PRINTER_TUNNEL_TOKEN%%\|\|g/);
});


test('legacy printer mode prefers an explicit session override and settings invalidates stale tickets',()=>{
  const m=fs.readFileSync(path.join(root,'js/maquinas.js'),'utf8');
  const settings=fs.readFileSync(path.join(root,'js/finanzas.js'),'utf8');
  const start=m.indexOf('function _getPrinterTunnelLongToken()');
  const end=m.indexOf('function getPrinterTunnelToken()',start);
  const getLong=m.slice(start,end);
  assert.match(getLong,/return local\|\|paired\|\|d;/,'el token introducido por el usuario debe ganar al pairing persistente y al secret horneado');
  assert.match(m,/function setPrinterTunnelTokenOverride\(value\)/);
  assert.match(m,/sessionStorage\.setItem\('printer_tunnel_token',token\)/);
  assert.match(m,/_printerTunnelSessionToken='';_printerTunnelSessionExpires=0/,'cambiar token invalida tickets efímeros previos');
  assert.match(settings,/setPrinterTunnelTokenOverride\(tk\)/,'Guardar debe aplicar el token a la fuente que realmente lee Máquinas');
  assert.match(settings,/refreshPrinterTunnelSession\(changedToken\)/,'Guardar debe renovar sesión inmediatamente');
  assert.match(m,/r\.status===401\|\|r\.status===403/,'el diagnóstico debe reconocer 403 del Farm Controller como fallo de token');
});
