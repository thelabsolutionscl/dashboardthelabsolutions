#!/usr/bin/env node
/*
 * Migración asistida de los antiguos artifacts CRM en texto plano.
 * Acciones separadas:
 *   prepare: descargar + validar + cifrar TODAS las copias legadas accesibles.
 *   finalize: descargar el NUEVO artifact cifrado, validar byte a byte que
 *             contiene cada copia migrada y SOLO ENTONCES borrar las antiguas.
 *
 * Ejecutar exclusivamente mediante workflow_dispatch con GITHUB_TOKEN de
 * Actions (permissions: actions: write) y BACKUP_ENCRYPTION_KEY guardado en
 * Secrets. Nunca loguea ni sube el JSON original o el manifest privado.
 */
import { randomBytes, scryptSync, createCipheriv, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEGACY_NAME = /^backup-crm-[0-9]{8,}$/;
export function isLegacyArtifact(a) {
  return a && a.expired === false && Number.isSafeInteger(a.id) && LEGACY_NAME.test(String(a.name));
}
export function encryptLegacy(original, passphrase, artifact) {
  if (!passphrase || passphrase.length < 24) throw new Error('BACKUP_ENCRYPTION_KEY inválida');
  const payload = JSON.parse(Buffer.isBuffer(original) ? original.toString('utf8') : String(original));
  if (!payload || !payload.tablas || typeof payload.tablas !== 'object' ||
      Array.isArray(payload.tablas) || !Object.keys(payload.tablas).length ||
      !Object.values(payload.tablas).every(Array.isArray)) throw new Error('CRM backup legado inválido');
  // Los respaldos antiguos podían omitir tablas y nunca certificaban integridad;
  // cifrarlos NO los convierte retroactivamente en copias completas.
  payload.completo = false;
  payload.fallos = ['Respaldo histórico: integridad y cobertura no certificadas antes de la migración'];
  payload.migracion = { fecha: new Date().toISOString(), artifact_id: artifact.id, origen: artifact.name };
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return JSON.stringify({
    format:'thelab-airtable-backup',version:1,algorithm:'AES-256-GCM',
    kdf:'scrypt',salt:salt.toString('base64'),iv:iv.toString('base64'),
    tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64'),
  });
}
export function verifyEnvelope(raw) {
  const data=JSON.parse(Buffer.isBuffer(raw)?raw.toString('utf8'):String(raw));
  return data && data.format==='thelab-airtable-backup' && data.version===1 &&
    data.algorithm==='AES-256-GCM' && data.kdf==='scrypt' &&
    typeof data.ciphertext==='string' && data.ciphertext.length>20 &&
    !('tablas' in data);
}
export function sha256(x) { return createHash('sha256').update(x).digest('hex'); }

const API=process.env.GITHUB_API_URL || 'https://api.github.com';
const repository=process.env.GITHUB_REPOSITORY || '';
const token=process.env.GITHUB_TOKEN || '';
const secret=(process.env.BACKUP_ENCRYPTION_KEY || '').trim();
const output='backup-migrated';
function validateEnvironment() {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY inválido');
  if (!token) throw new Error('Falta GITHUB_TOKEN');
  if (!secret || secret.trim().length<24) throw new Error('Falta BACKUP_ENCRYPTION_KEY válida');
  // Nunca aceptar un API endpoint alternativo en producción para descargar
  // datos privados o enviar el token GitHub a terceros.
  if (API!=='https://api.github.com') throw new Error('GitHub API no oficial');
}
function apiUrl(suffix) { return API+'/repos/'+repository+'/actions/'+suffix; }
async function call(url,options={}) {
  if (!url.startsWith(apiUrl(''))) throw new Error('Destino GitHub no autorizado');
  const r=await fetch(url,{
    ...options,
    headers:{
      'Authorization':'Bearer '+token,
      'Accept':'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28',
      'User-Agent':'tls-legacy-backup-migration',
      ...(options.headers||{}),
    },
  });
  if (!r.ok) throw new Error('GitHub API '+r.status+' en '+new URL(url).pathname);
  return r;
}
async function listLegacy() {
  const found=[];
  for(let page=1;page<=20;page++){
    const r=await call(apiUrl('artifacts?per_page=100&page='+page));
    const j=await r.json();
    if (!j || !Array.isArray(j.artifacts)) throw new Error('GitHub artifact listing inválido');
    found.push(...j.artifacts.filter(isLegacyArtifact));
    if (j.artifacts.length<100) break;
    if (page===20) throw new Error('Demasiados artifacts: revisar listado manualmente');
  }
  return found;
}
async function downloadZip(id,tempDir) {
  const response=await call(apiUrl('artifacts/'+id+'/zip'));
  const buf=Buffer.from(await response.arrayBuffer());
  if (!buf.length || buf.length>50*1024*1024) throw new Error('Artifact ZIP vacío o >50 MiB');
  const zipPath=join(tempDir,'artifact-'+id+'.zip');
  await writeFile(zipPath,buf,{mode:0o600});
  return zipPath;
}
function listZip(zipPath) {
  return execFileSync('unzip',['-Z','-1',zipPath],{maxBuffer:2*1024*1024}).toString('utf8')
    .trim().split(/\r?\n/).filter(Boolean);
}
function extractZip(zipPath,entry) {
  return execFileSync('unzip',['-p',zipPath,entry],{maxBuffer:50*1024*1024});
}
function legacyEntry(zipPath) {
  const entries=listZip(zipPath).filter(x=>/^(?:backup\/)?backup-crm-\d{4}-\d{2}-\d{2}\.json$/.test(x));
  if(entries.length!==1) throw new Error('El artifact legado no contiene un único JSON CRM reconocible');
  return extractZip(zipPath,entries[0]);
}
export function verifyMigrationContents(encryptedFiles,manifest) {
  if (!manifest || !Array.isArray(manifest.entries) || encryptedFiles.size!==manifest.entries.length)
    throw new Error('Faltan archivos cifrados en el artifact de recuperación');
  for (const entry of manifest.entries) {
    const content=encryptedFiles.get(entry.filename);
    if (!content || sha256(content)!==entry.sha256 || !verifyEnvelope(content))
      throw new Error('Artifact cifrado no coincide con manifest privado: '+entry.id);
  }
  return true;
}
async function prepare() {
  validateEnvironment();
  await mkdir(output,{recursive:true,mode:0o700});
  const temp=await mkdtemp(join(tmpdir(),'tls-migrate-backup-'));
  const manifest={format:'thelab-legacy-migration',version:1,created:new Date().toISOString(),entries:[]};
  try{
    const legacy=await listLegacy();
    console.log('Backups históricos sin cifrar encontrados: '+legacy.length+'.');
    for(const artifact of legacy){
      const zipPath=await downloadZip(artifact.id,temp);
      const original=legacyEntry(zipPath);
      const encrypted=Buffer.from(encryptLegacy(original,secret,artifact),'utf8');
      const filename='legacy-'+artifact.id+'.enc.json';
      await writeFile(join(output,filename),encrypted,{flag:'wx',mode:0o600});
      manifest.entries.push({
        id:artifact.id,name:artifact.name,filename,
        sha256:sha256(encrypted),original_sha256:sha256(original),
      });
      console.log('Cifrado y verificado artifact #'+artifact.id);
    }
    await writeFile(join(output,'migration-manifest.private.json'),JSON.stringify(manifest),{flag:'wx',mode:0o600});
    console.log('Preparadas '+manifest.entries.length+' copias cifradas. Aún NO se borró ningún artifact antiguo.');
  }finally{await rm(temp,{recursive:true,force:true});}
}
async function finalize() {
  validateEnvironment();
  const manifest=JSON.parse(await readFile(join(output,'migration-manifest.private.json'),'utf8'));
  if (!manifest.entries.length) {console.log('No había artifacts legados que migrar.');return;}
  const newId=Number(process.env.NEW_ARTIFACT_ID||0);
  if(!Number.isSafeInteger(newId)||newId<=0) throw new Error('Falta NEW_ARTIFACT_ID');
  const metadata=await (await call(apiUrl('artifacts/'+newId))).json();
  const expectedName='backup-crm-legacy-cifrados-'+process.env.GITHUB_RUN_ID;
  if(metadata.name!==expectedName||metadata.expired||metadata.size_in_bytes<=100)
    throw new Error('El artifact cifrado publicado no fue confirmado');
  const temp=await mkdtemp(join(tmpdir(),'tls-verify-migrated-'));
  try{
    const zipPath=await downloadZip(newId,temp);
    const files=new Map();
    for(const entry of listZip(zipPath)){
      if(!/^legacy-[0-9]+\.enc\.json$/.test(entry)) throw new Error('Archivo inesperado en artifact cifrado');
      files.set(entry,extractZip(zipPath,entry));
    }
    verifyMigrationContents(files,manifest);
    console.log('Nuevo artifact cifrado verificado por SHA-256, cantidad y formato.');
  }finally{await rm(temp,{recursive:true,force:true});}
  // Solo se borran IDs identificados en el manifest y cifrados verificados.
  for(const entry of manifest.entries){
    await call(apiUrl('artifacts/'+entry.id),{method:'DELETE'});
    console.log('Eliminado artifact legado #'+entry.id);
  }
  console.log('Migración terminada: '+manifest.entries.length+' artifacts antiguos sustituidos.');
}
const main=process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(main){
  const command=process.argv[2];
  const task=command==='prepare'?prepare:command==='finalize'?finalize:null;
  if(!task){console.error('Uso: node scripts/migrate-legacy-backups.mjs prepare|finalize');process.exitCode=2;}
  else task().catch(e=>{console.error('Migración detenida: '+e.message);process.exitCode=1;});
}
