#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {existsSync,readFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');
const {createServer}=require('node:http');
const {spawn}=require('node:child_process');

const ROOT=resolve(__dirname,'..');
const SCRIPT=join(ROOT,'scripts','backup-airtable.mjs');
const RESTORE=join(ROOT,'scripts','decrypt-backup.mjs');
const WORKFLOW=readFileSync(join(ROOT,'.github','workflows','weekly.yml'),'utf8');
const KEY='local-test-secret-only-never-use-in-production-123456';
const BASE='app1YtD74AqiPWQhy';
const TABLES=['Clientes','Cotizaciones','Pedidos','Facturas','Inventario','Maquinas_Eventos'];
const json=(res,status,body)=>{
  res.writeHead(status,{'Content-Type':'application/json'});
  res.end(JSON.stringify(body));
};
function processRun(script,args,cwd,env){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[script,...args],{cwd,env:{...process.env,...env}});
    let stdout='',stderr='';
    child.stdout.on('data',buf=>stdout+=buf.toString());
    child.stderr.on('data',buf=>stderr+=buf.toString());
    child.on('error',reject);
    child.on('close',code=>resolve({code,stdout,stderr}));
  });
}
async function scenario({badTable='',malformed='',metaDown=false,key=KEY}={}){
  const calls=[];
  const server=createServer((req,res)=>{
    const u=new URL(req.url,'http://localhost');
    calls.push(u.pathname);
    if(u.pathname==='/v0/meta/bases/'+BASE+'/tables'){
      if(metaDown){json(res,403,{error:'no schema scope'});return;}
      json(res,200,{tables:TABLES.map((name,i)=>({name,id:'tbl'+String(i).padStart(14,'0')}))});
      return;
    }
    const pathPrefix='/v0/'+BASE+'/';
    if(!u.pathname.startsWith(pathPrefix)){json(res,404,{error:'unknown path'});return;}
    const name=decodeURIComponent(u.pathname.slice(pathPrefix.length));
    if(!TABLES.includes(name)){json(res,404,{error:'unknown table'});return;}
    if(name===badTable){json(res,503,{error:'transient upstream failure'});return;}
    if(name===malformed){json(res,200,{invalid:true});return;}
    json(res,200,{records:[{id:'rec'+name.replace(/[^A-Za-z]/g,''),fields:{Name:name}}]});
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const port=server.address().port;
  const cwd=await fs.mkdtemp(join(tmpdir(),'tls-backup-test-'));
  try {
    const env={AIRTABLE_TOKEN:'fake-only-for-local-http',AIRTABLE_API:'http://127.0.0.1:'+port,BACKUP_REINTENTOS:'0',BACKUP_ENCRYPTION_KEY:key||''};
    const result=await processRun(SCRIPT,[],cwd,env);
    const files=await fs.readdir(join(cwd,'backup'));
    const enc=files.find(x=>x.endsWith('.enc.json'));
    const envelope=enc?JSON.parse(await fs.readFile(join(cwd,'backup',enc),'utf8')):null;
    const summary=await fs.readFile(join(cwd,'backup','resumen.txt'),'utf8');
    let decrypted=null,restoreStatus=null;
    if(enc){
      const dest=join(cwd,'backups-restaurados','restore.json');
      restoreStatus=await processRun(RESTORE,[join(cwd,'backup',enc),dest],cwd,{BACKUP_ENCRYPTION_KEY:KEY});
      if(restoreStatus.code===0)decrypted=JSON.parse(await fs.readFile(dest,'utf8'));
    }
    return {result,files,enc,envelope,summary,decrypted,restoreStatus,calls};
  } finally{
    await new Promise(done=>server.close(done));
    await fs.rm(cwd,{recursive:true,force:true});
  }
}

test('descubre y cifra todas las tablas, también las agregadas fuera de la lista fija',async()=>{
  const a=await scenario();
  assert.equal(a.result.code,0,a.result.stderr);
  assert.equal(a.decrypted.completo,true);
  assert.deepEqual(Object.keys(a.decrypted.tablas).sort(),TABLES.slice().sort());
  assert.equal(a.envelope.algorithm,'AES-256-GCM');
  assert.equal(a.envelope.kdf,'scrypt');
  assert.equal('tablas' in a.envelope,false,'el JSON del CRM no aparece en texto plano');
  assert.equal(a.restoreStatus.code,0,a.restoreStatus.stderr);
  assert.match(a.summary,/RESPALDO COMPLETO/);
  assert.deepEqual(a.files.filter(x=>x.includes('backup-crm')),[a.enc]);
});

test('una tabla con error 503 deja el backup parcial y obliga a fallar el job',async()=>{
  const a=await scenario({badTable:'Facturas'});
  assert.equal(a.result.code,1);
  assert.equal(a.decrypted.completo,false);
  assert.ok(a.decrypted.fallos.some(x=>x.includes('Facturas')));
  assert.equal('Facturas' in a.decrypted.tablas,false);
  assert.match(a.summary,/RESPALDO INCOMPLETO/);
  assert.ok(a.enc.endsWith('.enc.json'));
});

test('HTTP 200 malformado no se confunde con tabla vacía legítima',async()=>{
  const a=await scenario({malformed:'Pedidos'});
  assert.equal(a.result.code,1);
  assert.equal(a.decrypted.completo,false);
  assert.ok(a.decrypted.fallos.some(x=>x.includes('Pedidos')));
});

test('sin metadata, hace rescate histórico pero no lo llama completo',async()=>{
  const a=await scenario({metaDown:true});
  assert.equal(a.result.code,1);
  assert.equal(a.decrypted.completo,false);
  assert.ok(a.decrypted.fallos.some(x=>x.includes('Metadata')));
});

test('sin clave de cifrado no consulta Airtable ni genera artefactos',async()=>{
  const a=await scenario({key:''});
  assert.equal(a.result.code,1);
  assert.equal(a.enc,undefined);
  assert.equal(a.calls.length,0);
  assert.match(a.summary,/RESPALDO BLOQUEADO/);
});

test('el workflow solo sube archivos cifrados y alerta ante fallos',()=>{
  assert.match(WORKFLOW,/BACKUP_ENCRYPTION_KEY: \$\{\{ secrets\.BACKUP_ENCRYPTION_KEY \}\}/);
  assert.match(WORKFLOW,/path: backup\/\*\.enc\.json/);
  assert.doesNotMatch(WORKFLOW,/path: backup\/\s*$/m);
  assert.match(WORKFLOW,/if: \$\{\{ always\(\) && hashFiles\('backup\/resumen\.txt'\) != '' \}\}/);
});

test('clave incorrecta falla sin escribir texto plano y la restauración nunca sobrescribe',async()=>{
  const a=await scenario();
  assert.equal(a.restoreStatus.code,0);
  const d=await fs.mkdtemp(join(tmpdir(),'tls-restore-test-'));
  try{
    const envelopePath=join(d,'encrypted.json'),outputPath=join(d,'private','restored.json');
    await fs.writeFile(envelopePath,JSON.stringify(a.envelope));
    const wrong=await processRun(RESTORE,[envelopePath,outputPath],d,{BACKUP_ENCRYPTION_KEY:'wrong-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'});
    assert.notEqual(wrong.code,0);
    assert.equal(existsSync(outputPath),false,'clave incorrecta no deja texto plano');
    const good=await processRun(RESTORE,[envelopePath,outputPath],d,{BACKUP_ENCRYPTION_KEY:KEY});
    assert.equal(good.code,0,good.stderr);
    const again=await processRun(RESTORE,[envelopePath,outputPath],d,{BACKUP_ENCRYPTION_KEY:KEY});
    assert.notEqual(again.code,0,'no debe sobrescribir una restauración existente');
  } finally{await fs.rm(d,{recursive:true,force:true});}
});
