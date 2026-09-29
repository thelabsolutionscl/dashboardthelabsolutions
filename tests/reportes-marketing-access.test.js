#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/access-auth.js'),'utf8')
  .replace('export async function accessAuthorize','async function accessAuthorize');
const {accessAllows}=new Function(code+'\nreturn {accessAllows};')();
test('only signed finance/admin may read and change marketing spend',()=>{
  const paths=['/marketing/spend','/marketing/spend/history'];
  for(const role of ['viewer','operator']){
    const person={role};
    for(const path of paths){
      for(const method of ['GET','PUT','POST','DELETE'])
        assert.equal(accessAllows(person,method,path),false,role+' '+method+' '+path);
    }
  }
  const finance={role:'finance'},admin={role:'admin'};
  for(const actor of [finance,admin]){
    assert.equal(accessAllows(actor,'GET',paths[0]),true);
    assert.equal(accessAllows(actor,'PUT',paths[0]),true);
    assert.equal(accessAllows(actor,'GET',paths[1]),true);
  }
  assert.equal(accessAllows(finance,'PUT',paths[1]),false);
  assert.equal(accessAllows(finance,'POST',paths[0]),false);
  assert.equal(accessAllows(finance,'DELETE',paths[0]),false);
  assert.equal(accessAllows(finance,'GET','/marketing/spend/admin'),false);
});
