#!/usr/bin/env node
// Uso LOCAL: BACKUP_ENCRYPTION_KEY='...' node scripts/decrypt-backup.mjs
//    backup-crm-AAAA-MM-DD.enc.json  /ruta/privada/backup-restaurado.json
// No ejecutar sobre una ruta dentro del repositorio público.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createDecipheriv, scryptSync } from 'node:crypto';

const secret = (process.env.BACKUP_ENCRYPTION_KEY || '').trim();
const [input, output] = process.argv.slice(2);
if (!secret || secret.length < 32 || !input || !output) {
  console.error('Se necesita BACKUP_ENCRYPTION_KEY y los paths del archivo cifrado y el destino privado.');
  process.exit(1);
}
const source = resolve(input), dest = resolve(output);
if (source === dest) throw new Error('El destino debe ser distinto del archivo cifrado');
const envelope = JSON.parse(await readFile(source, 'utf8'));
if (envelope.format !== 'thelab-airtable-backup' || envelope.version !== 1 ||
    envelope.algorithm !== 'AES-256-GCM' || envelope.kdf !== 'scrypt') {
  throw new Error('Formato de backup no compatible');
}
const salt = Buffer.from(envelope.salt, 'base64'), iv = Buffer.from(envelope.iv, 'base64');
const tag = Buffer.from(envelope.tag, 'base64'), ciphertext = Buffer.from(envelope.ciphertext, 'base64');
if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || !ciphertext.length)
  throw new Error('Envelope de backup corrupto');
const key = scryptSync(secret, salt, 32);
const decipher = createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(tag);
const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
const data = JSON.parse(plaintext.toString('utf8'));
if (!data.tablas || typeof data.tablas !== 'object' || !Array.isArray(data.fallos))
  throw new Error('Datos de backup inválidos');
await mkdir(dirname(dest), { recursive: true });
await writeFile(dest, plaintext, { flag: 'wx', mode: 0o600 });
console.log(data.completo ? '✓ Backup completo verificado por AES-GCM.' : '⚠ BACKUP PARCIAL: revisar fallos en el JSON antes de restaurar.');
console.log('Archivo privado escrito en: ' + dest);
