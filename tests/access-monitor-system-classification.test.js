#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/access-auth.js'),'utf8')
  .replace('export async function accessAuthorize','async function accessAuthorize');
const {accessAllows,ACCESS_ADMIN_ONLY_TABLES,ACCESS_ALLOWED_TABLES}=
  new Function(source+'\nreturn {accessAllows,ACCESS_ADMIN_ONLY_TABLES,ACCESS_ALLOWED_TABLES};')();
const base='/v0/app1YtD74AqiPWQhy/';
test('mixed Monitor Sistema records are inaccessible for all signed nonadmin roles',()=>{
  const table='Monitor%20Sistema',list=base+table,record=list+'/recABCDEFGHIJKLMN';
  assert.ok(ACCESS_ALLOWED_TABLES.has('Monitor Sistema'));
  assert.ok(ACCESS_ADMIN_ONLY_TABLES.has('Monitor Sistema'));
  for(const role of ['viewer','operator','finance','sales']){
    for(const method of ['GET','POST','PATCH','DELETE']){
      assert.equal(accessAllows({role},method,list),false,role+' '+method+' list');
      assert.equal(accessAllows({role},method,record),false,role+' '+method+' record');
    }
  }
  for(const method of ['GET','POST','PATCH','DELETE']){
    assert.equal(accessAllows({role:'admin'},method,list),true,method+' admin list');
    assert.equal(accessAllows({role:'admin'},method,record),true,method+' admin record');
  }
});
test('unreviewed alternate Monitor Sistema paths do not bypass the admin table catalog',()=>{
  const invalid=[
    base+'Monitor Sistema',base+'%4Donitor%20Sistema',
    base+'Monitor%20Sistema/recABCDEFGHIJKLMN/Notes',
    base+'tbl0f3S4rfoGjrhU8',base+'monitor%20sistema'
  ];
  for(const path of invalid)
    for(const role of ['viewer','operator','finance','sales','admin'])
      assert.equal(accessAllows({role},'GET',path),false,role+' '+path);
  assert.equal(accessAllows({role:'admin'},'GET',
    '/v0/meta/bases/app1YtD74AqiPWQhy/tables'),true);
  assert.equal(accessAllows({role:'operator'},'GET',
    '/v0/meta/bases/app1YtD74AqiPWQhy/tables'),false);
});
