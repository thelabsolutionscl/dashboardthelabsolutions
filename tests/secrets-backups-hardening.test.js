#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const DEPLOY=read('.github/workflows/deploy.yml');
const WEEKLY=read('.github/workflows/weekly.yml');
const MIGRATE_WF=read('.github/workflows/migrate-legacy-backups.yml');
const BACKUP=read('scripts/backup-airtable.mjs');
const RESTORE=read('scripts/decrypt-backup.mjs');
const MIGRATE=read('scripts/migrate-legacy-backups.mjs');
const KAI=read('js/kai.js');
const FIN=read('js/finanzas.js');
const PROXY=read('airtable-proxy/src/worker.js');
const ACCESS=read('airtable-proxy/src/access-auth.js');

test('GitHub Pages ya no recibe ni inyecta ElevenLabs',()=>{
  assert.doesNotMatch(DEPLOY,/secrets\.ELEVENLABS/);
  assert.doesNotMatch(DEPLOY,/%%ELEVENLABS%%/);
  assert.doesNotMatch(DEPLOY,/ELEVENLABS:\s*\$\{\{/);
});

test('KAI no guarda ni envía una API key de ElevenLabs desde el navegador',()=>{
  assert.doesNotMatch(KAI,/api\.elevenlabs\.io/);
  assert.doesNotMatch(KAI,/xi-api-key/);
  assert.doesNotMatch(KAI,/localStorage\.getItem\(['"]elevenlabs_key/);
  assert.match(KAI,/localStorage\.removeItem\(['"]elevenlabs_key/);
  assert.match(KAI,/\/tts\/elevenlabs/);
  assert.match(KAI,/credentials:'include'/);
});

test('configuración UI no permite persistir una key de ElevenLabs',()=>{
  assert.doesNotMatch(FIN,/localStorage\.setItem\(['"]elevenlabs_key/);
  assert.match(FIN,/localStorage\.removeItem\(['"]elevenlabs_key/);
  assert.match(FIN,/Administrada en servidor/);
});

test('TTS usa secret server-side y requiere Access por rol',()=>{
  assert.match(PROXY,/env\.ELEVENLABS_API_KEY/);
  assert.match(PROXY,/https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech/);
  assert.match(PROXY,/'xi-api-key':env\.ELEVENLABS_API_KEY/);
  assert.match(PROXY,/url\.pathname==='\/tts\/elevenlabs'/);
  assert.match(ACCESS,/path==='\/tts\/elevenlabs'/);
  assert.match(ACCESS,/\['sales','operator','finance','admin'\]/);
});

test('backup y restauración exigen mínimo 32 caracteres',()=>{
  assert.match(BACKUP,/ENCRYPTION_KEY\.length < 32/);
  assert.match(BACKUP,/mínimo 32 caracteres/);
  assert.match(RESTORE,/secret\.length < 32/);
  assert.match(WEEKLY,/BACKUP_ENCRYPTION_KEY \(mínimo 32 caracteres/);
  assert.match(MIGRATE,/secret\.trim\(\)\.length<32/);
  assert.match(MIGRATE_WF,/\$\{#BACKUP_ENCRYPTION_KEY\}.*-lt 32/);
});

test('backup semanal publica solo cifrado',()=>{
  assert.match(WEEKLY,/path: backup\/\*\.enc\.json/);
  assert.doesNotMatch(WEEKLY,/path:\s*backup\/\*\.json\s*$/m);
  assert.match(BACKUP,/AES-256-GCM/);
  assert.match(BACKUP,/scryptSync/);
  assert.match(BACKUP,/backup-crm-' \+ fecha \+ '\.enc\.json'/);
  assert.doesNotMatch(BACKUP,/backup-crm-' \+ fecha \+ '\.json'/);
});

test('migrador legacy cifra y verifica antes de borrar',()=>{
  assert.match(MIGRATE,/prepare: descargar \+ validar \+ cifrar TODAS/);
  assert.match(MIGRATE,/verifyMigrationContents/);
  assert.match(MIGRATE,/sha256\(content\)!==entry\.sha256/);
  const verify=MIGRATE.indexOf('verifyMigrationContents(files,manifest)');
  const remove=MIGRATE.indexOf("method:'DELETE'");
  assert.ok(verify>=0&&remove>verify,'la eliminación debe ocurrir después de verificar el nuevo artifact');
  assert.match(MIGRATE,/LEGACY_NAME = \/\^backup-crm-/);
});

test('migrador no considera cifrados actuales como artifacts legacy',()=>{
  assert.match(MIGRATE,/LEGACY_NAME = \/\^backup-crm-\[0-9\]\{8,\}\$\//);
  assert.doesNotMatch(MIGRATE,/backup-crm-cifrado/);
});
