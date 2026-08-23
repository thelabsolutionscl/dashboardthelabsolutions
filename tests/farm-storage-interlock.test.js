#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const http=require('http');

const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'tls-storage-interlock-'));
process.env.FARM_DATA_DIR=TMP;
process.env.LEGACY_BRIDGE_PORT='8348';
function writeValid(){
  fs.writeFileSync(path.join(TMP,'queue.json'),JSON.stringify({version:1,jobs:[]}));
  fs.writeFileSync(path.join(TMP,'registry.json'),JSON.stringify({version:1,machines:[]}));
  fs.writeFileSync(path.join(TMP,'safety.json'),JSON.stringify({version:1,updatedAt:Date.now()}));
}
writeValid();
const guard=require('../printer-bridge/farm-storage-interlock-preload.js');

test.after(()=>{try{fs.rmSync(TMP,{recursive:true,force:true});}catch(_){}});

test('storage válido habilita y una corrupción bloquea fail-closed',()=>{
  writeValid();
  assert.equal(guard.storageStatus({dataDir:TMP}).ok,true);
  fs.writeFileSync(path.join(TMP,'registry.json'),'{roto');
  const bad=guard.storageStatus({dataDir:TMP});
  assert.equal(bad.ok,false);
  assert.match(bad.reason,/registry\.json corrupto/);
});

test('cada store crítico participa en el interlock',()=>{
  for(const [name,valid] of [
    ['queue.json',{version:1,jobs:[]}],
    ['registry.json',{version:1,machines:[]}],
    ['safety.json',{version:1,updatedAt:Date.now()}],
  ]){
    writeValid();fs.writeFileSync(path.join(TMP,name),'[]');
    const s=guard.storageStatus({dataDir:TMP,skipProbe:true});
    assert.equal(s.ok,false,name);
    assert.match(s.reason,new RegExp(name.replace('.','\\.')));
    fs.writeFileSync(path.join(TMP,name),JSON.stringify(valid));
    assert.equal(guard.storageStatus({dataDir:TMP,skipProbe:true}).ok,true,`${name} se recupera al repararlo`);
  }
});

test('la prueba de escritura exige write + fsync y falla cerrada',()=>{
  writeValid();
  const original=fs.fsyncSync;
  fs.fsyncSync=()=>{const e=new Error('simulado');e.code='EIO';throw e;};
  try{const s=guard.storageStatus({dataDir:TMP});assert.equal(s.ok,false);assert.match(s.reason,/no escribible\/sin fsync/);}
  finally{fs.fsyncSync=original;}
  assert.equal(guard.storageStatus({dataDir:TMP}).ok,true);
});

test('upload/start hacia el bridge interno se bloquean con store corrupto y se rehabilitan al reparar',async()=>{
  writeValid();fs.writeFileSync(path.join(TMP,'queue.json'),'{corrupto');
  const err=await new Promise(resolve=>{
    const r=http.request({host:'127.0.0.1',port:8348,path:'/192.168.100.20/server/files/upload',method:'POST'});
    r.on('error',resolve);r.end();
  });
  assert.equal(err.code,'FARM_STORAGE_BLOCKED');
  assert.match(err.message,/queue\.json corrupto/);
  writeValid();
  assert.equal(guard.storageStatus({dataDir:TMP}).ok,true);
  assert.equal(guard.isLegacyMutation({host:'127.0.0.1',port:8348,path:'/x/printer/print/start?filename=a.gcode',method:'POST'}),true);
  assert.equal(guard.isLegacyMutation({host:'127.0.0.1',port:8348,path:'/x/printer/info',method:'GET'}),false);
});

test('POST /farm/queue/:id/run devuelve 507 antes del listener cuando storage está degradado',async()=>{
  writeValid();fs.writeFileSync(path.join(TMP,'safety.json'),'{mal');
  let reached=false;
  const server=http.createServer((req,res)=>{reached=true;res.end('listener');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const response=await new Promise((resolve,reject)=>{
    const r=http.request({host:'127.0.0.1',port,path:'/farm/queue/job-1/run',method:'POST'},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString('utf8')}));});
    r.on('error',reject);r.end();
  });
  await new Promise(resolve=>server.close(resolve));
  assert.equal(response.status,507);
  assert.equal(reached,false);
  assert.match(response.body,/storage interlock/);
});

test('un archivo crítico corrupto no puede ser pisado por atomic rename',()=>{
  writeValid();const dst=path.join(TMP,'registry.json'),src=dst+'.tmp-test';
  fs.writeFileSync(dst,'{corrupto');fs.writeFileSync(src,JSON.stringify({version:1,machines:[]}));
  assert.throws(()=>fs.renameSync(src,dst),e=>e&&e.code==='FARM_STORE_CORRUPT');
  assert.equal(fs.readFileSync(dst,'utf8'),'{corrupto');
});
