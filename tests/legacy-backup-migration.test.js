#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {scryptSync,createDecipheriv}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const script=path.join(ROOT,'scripts','migrate-legacy-backups.mjs');
const workflow=fs.readFileSync(path.join(ROOT,'.github','workflows','migrate-legacy-backups.yml'),'utf8');

async function module(){return import('file://'+script);}
const passphrase='clave-de-prueba-local-no-poner-en-github-de-verdad';
const original=JSON.stringify({
  fecha:'2026-09-21T17:44:35Z', origen:'github-actions-weekly',
  tablas:{Clientes:[{id:'recCliente1',fields:{Empresa:'Empresa Ficticia'}}],
    Pedidos:[{id:'recPed1',fields:{'N° Pedido':'PED-2026-012'}}]},
});
function decrypt(envelope,pass){
  const key=scryptSync(pass,Buffer.from(envelope.salt,'base64'),32);
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext,'base64')),
    decipher.final(),
  ]).toString('utf8'));
}
test('selecciona solo artifacts legados activos, no los nuevos cifrados',async()=>{
  const {isLegacyArtifact}=await module();
  assert.equal(isLegacyArtifact({id:10655257618,name:'backup-crm-35633910270',expired:false}),true);
  assert.equal(isLegacyArtifact({id:10655257618,name:'backup-crm-35633910270',expired:true}),false);
  assert.equal(isLegacyArtifact({id:10655257618,name:'backup-crm-cifrado-12345',expired:false}),false);
  assert.equal(isLegacyArtifact({id:10655257618,name:'backup-crm-legacy-cifrados-12345',expired:false}),false);
  assert.equal(isLegacyArtifact({id:10655257618,name:'other-artifact',expired:false}),false);
});

test('cifra cada backup con AES-256-GCM y restaura todos los datos sin certificar cobertura histórica',async()=>{
  const {encryptLegacy,verifyEnvelope}=await module();
  const encrypted=encryptLegacy(Buffer.from(original),passphrase,{id:356,name:'backup-crm-12345678'});
  const wrapper=JSON.parse(encrypted);
  assert.equal(verifyEnvelope(encrypted),true);
  assert.equal(wrapper.algorithm,'AES-256-GCM');
  assert.equal(wrapper.kdf,'scrypt');
  assert.doesNotMatch(encrypted,/Empresa Ficticia|recCliente1|PED-2026-012/,'no publica PII en claro');
  const restored=decrypt(wrapper,passphrase);
  assert.equal(restored.tablas.Clientes[0].fields.Empresa,'Empresa Ficticia');
  assert.equal(restored.tablas.Pedidos[0].fields['N° Pedido'],'PED-2026-012');
  assert.equal(restored.completo,false,'no inventar garantía histórica');
  assert.ok(restored.fallos.some(x=>x.includes('histórico')));
  assert.equal(restored.migracion.artifact_id,356);
});

test('mismo backup produce dos ciphertext distintos y la clave errónea no puede descifrar',async()=>{
  const {encryptLegacy}=await module();
  const a=JSON.parse(encryptLegacy(original,passphrase,{id:123,name:'backup-crm-12345678'}));
  const b=JSON.parse(encryptLegacy(original,passphrase,{id:123,name:'backup-crm-12345678'}));
  assert.notEqual(a.salt,b.salt);
  assert.notEqual(a.iv,b.iv);
  assert.notEqual(a.ciphertext,b.ciphertext);
  assert.throws(()=>decrypt(a,'otra-clave-de-prueba-local-muy-distinta-de-la-original'));
  assert.throws(()=>decrypt({...a,tag:Buffer.alloc(16).toString('base64')},passphrase));
});

test('solo borra originales si el nuevo artifact contiene EXACTAMENTE todas las copias cifradas verificadas',async()=>{
  const {encryptLegacy,verifyMigrationContents,sha256}=await module();
  const e1=Buffer.from(encryptLegacy(original,passphrase,{id:111,name:'backup-crm-11111111'}));
  const e2=Buffer.from(encryptLegacy(original,passphrase,{id:222,name:'backup-crm-22222222'}));
  const manifest={entries:[
    {id:111,filename:'legacy-111.enc.json',sha256:sha256(e1)},
    {id:222,filename:'legacy-222.enc.json',sha256:sha256(e2)},
  ]};
  assert.equal(verifyMigrationContents(new Map([['legacy-111.enc.json',e1],['legacy-222.enc.json',e2]]),manifest),true);
  assert.throws(()=>verifyMigrationContents(new Map([['legacy-111.enc.json',e1]]),manifest),/Faltan/);
  assert.throws(()=>verifyMigrationContents(new Map([['legacy-111.enc.json',e1],['legacy-222.enc.json',Buffer.from('plain')]]),manifest),/no coincide/);
  assert.throws(()=>verifyMigrationContents(new Map([['legacy-111.enc.json',e2],['legacy-222.enc.json',e1]]),manifest),/no coincide/);
});

test('sin secreto no entra en red, no cifra y no crea archivos',()=>{
  const cwd=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'tls-migration-failclosed-'));
  try{
    const r=spawnSync(process.execPath,[script,'prepare'],{
      cwd,encoding:'utf8',env:{
        ...process.env,GITHUB_REPOSITORY:'thelabsolutionscl/dashboardthelabsolutions',
        GITHUB_TOKEN:'fake-test',BACKUP_ENCRYPTION_KEY:'',GITHUB_API_URL:'https://api.github.com',
      },
    });
    assert.equal(r.status,1);
    assert.match(r.stderr,/Falta BACKUP_ENCRYPTION_KEY/);
    assert.equal(fs.existsSync(path.join(cwd,'backup-migrated')),false);
  }finally{fs.rmSync(cwd,{recursive:true,force:true});}
});

test('la workflow solo corre manualmente con permiso actions:write y confirma antes de borrar',()=>{
  assert.match(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/\bpull_request:/);
  assert.doesNotMatch(workflow,/\bschedule:/);
  assert.match(workflow,/actions: write/);
  assert.match(workflow,/BACKUP_ENCRYPTION_KEY: \$\{\{ secrets\.BACKUP_ENCRYPTION_KEY \}\}/);
  assert.match(workflow,/run: node scripts\/migrate-legacy-backups\.mjs prepare/);
  assert.match(workflow,/path: backup-migrated\/\*\.enc\.json/);
  assert.doesNotMatch(workflow,/path: backup-migrated\/\s*$/m,'manifest privado nunca se adjunta');
  const upload=workflow.indexOf('id: upload');
  const finalize=workflow.indexOf('scripts/migrate-legacy-backups.mjs finalize');
  assert.ok(upload>=0&&finalize>upload);
  assert.match(workflow,/NEW_ARTIFACT_ID: \$\{\{ steps\.upload\.outputs\['artifact-id'\] \}\}/);
});
