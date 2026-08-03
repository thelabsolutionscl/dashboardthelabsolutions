#!/usr/bin/env node
import { createDecipheriv, createHash, scryptSync } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FORMAT = 'thelab-backup-v1';
const MIN_KEY_LENGTH = 24;

function deriveKey(passphrase, salt) {
  return scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
}

export async function decryptBackup(inputPath, passphrase, outputPath) {
  if (!passphrase || passphrase.length < MIN_KEY_LENGTH) {
    throw new Error(`BACKUP_ENCRYPTION_KEY debe tener al menos ${MIN_KEY_LENGTH} caracteres`);
  }

  let envelope;
  try {
    envelope = JSON.parse(await readFile(inputPath, 'utf8'));
  } catch {
    throw new Error('El archivo cifrado no contiene un sobre JSON válido');
  }
  if (envelope.format !== FORMAT || envelope.cipher !== 'aes-256-gcm') {
    throw new Error(`Formato de backup no soportado: ${envelope.format || 'desconocido'}`);
  }

  const salt = Buffer.from(envelope.salt || '', 'base64');
  const iv = Buffer.from(envelope.iv || '', 'base64');
  const tag = Buffer.from(envelope.tag || '', 'base64');
  const payload = Buffer.from(envelope.payload || '', 'base64');
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || !payload.length) {
    throw new Error('El sobre cifrado está incompleto o corrupto');
  }

  const key = deriveKey(passphrase, salt);
  let plaintext;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(payload), decipher.final()]);
  } catch {
    throw new Error('No se pudo descifrar: clave incorrecta o backup alterado');
  }

  const sha256 = createHash('sha256').update(plaintext).digest('hex');
  if (sha256 !== envelope.plaintextSha256) {
    throw new Error('La verificación SHA-256 del backup falló');
  }

  const destination = outputPath || join(dirname(inputPath), envelope.sourceName || basename(inputPath).replace(/\.enc$/, ''));
  const tempPath = `${destination}.tmp-${process.pid}`;
  await writeFile(tempPath, plaintext, { mode: 0o600 });
  await rename(tempPath, destination);
  return { outputPath: destination, sha256, bytes: plaintext.length };
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error('Uso: BACKUP_ENCRYPTION_KEY=... node scripts/decrypt-backup.mjs <archivo.enc> [salida.json]');
  const result = await decryptBackup(inputPath, process.env.BACKUP_ENCRYPTION_KEY || '', process.argv[3]);
  console.log(`✓ Backup restaurado y verificado: ${result.outputPath} (${result.bytes} bytes)`);
}

if (import.meta.url === pathToFileURL(fileURLToPath(import.meta.url)).href && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  });
}
