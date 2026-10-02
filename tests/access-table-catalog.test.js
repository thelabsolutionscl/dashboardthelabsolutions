#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'airtable-proxy/src/access-auth.js'),'utf8')
  .replace('export async function accessAuthorize','async function accessAuthorize');
const {accessAllows,accessTable,ACCESS_ALLOWED_TABLES,ACCESS_ADMIN_ONLY_TABLES}=
  new Function(source+'\nreturn {accessAllows,accessTable,ACCESS_ALLOWED_TABLES,ACCESS_ADMIN_ONLY_TABLES};')();
const sourceFiles=[
  'js/redes.js','js/linkedin.js','js/oficina.js','js/seo-ads.js','js/agentes.js','js/proveedores.js',
  'js/finanzas.js','js/calendario-base.js','js/maquinas-operaciones.js','js/correo.js'
];
test('all actual literal Airtable tables in major dashboard modules are in the signed-access catalog',()=>{
  const used=new Map();
  const pattern=/(?:airtableFetch|airtableWrite|airtableWriteTolerant|_redesWrite|_redesFetch)\s*\(\s*(['"])([^'"\n]+)\1/g;
  for(const file of sourceFiles){
    const text=fs.readFileSync(path.join(root,file),'utf8');
    for(const match of text.matchAll(pattern)){
      if(!used.has(match[2]))used.set(match[2],[]);
      used.get(match[2]).push(file);
    }
  }
  assert.ok(used.size>=12,'source table inventory unexpectedly sparse');
  for(const [table,files] of used){
    assert.ok(ACCESS_ALLOWED_TABLES.has(table),
      table+' is used by '+files.join(', ')+' but missing from Access allowlist');
  }
  assert.ok(used.has('Agent_Queue'));
  assert.ok(used.has('Automations'));
  assert.ok(used.has('Newsletter_Campañas'));
  assert.ok(used.has('Google_Ads_KPIs'));
});
test('campaign and agent tables remain admin-only pending explicit per-role record scoping',()=>{
  const names=['Automations','Agent_Queue','Agent_Log','Social_Posts',
    'Social_Interactions','Social_Metrics','LinkedIn_Prospects','Newsletter_Campañas','Newsletter_Envios','Google_Ads_KPIs'];
  const prefix='/v0/app1YtD74AqiPWQhy/';
  for(const name of names){
    assert.ok(ACCESS_ADMIN_ONLY_TABLES.has(name),name);
    const path=prefix+encodeURIComponent(name);
    assert.equal(accessTable(path),name);
    assert.equal(accessAllows({role:'admin'},'GET',path),true,name);
    assert.equal(accessAllows({role:'admin'},'POST',path),true,name);
    for(const role of ['viewer','operator','finance']){
      for(const method of ['GET','POST','PATCH','DELETE'])
        assert.equal(accessAllows({role},method,path),false,
          role+' should not have unreviewed access to '+name+' '+method);
    }
    assert.equal(accessAllows({role:'admin'},'GET',path+'/unexpected'),false,name);
    assert.equal(accessAllows({role:'admin'},'GET',prefix+'%'+name),false,name);
  }
});
test('the expanded catalog does not weaken existing CRM/financial authorizations',()=>{
  const prefix='/v0/app1YtD74AqiPWQhy/';
  assert.equal(accessAllows({role:'operator'},'PATCH',prefix+'Pedidos/recABCDEFGHIJKLMN'),true);
  assert.equal(accessAllows({role:'finance'},'POST',prefix+'Facturas'),true);
  assert.equal(accessAllows({role:'viewer'},'GET',prefix+'Reportes'),false);
  assert.equal(accessAllows({role:'admin'},'DELETE',prefix+'TotallyUnknown'),false);
  assert.equal(accessAllows({role:'admin'},'GET',prefix+'tblABCDEFGHIJKLMN'),false);
});
