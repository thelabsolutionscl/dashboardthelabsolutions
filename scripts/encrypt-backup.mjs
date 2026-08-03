#!/usr/bin/env node
import { createCipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FORMAT = 'thelab-backup-v1';
const MIN_KEY_LENGTH = 24;

function deriveKey(passphrase, salt) {
  return scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
}

export async function encryptBackup(inputPath, passphrase, outputPath = `${inputPath}.enc`) {
  if (!passphrase || passphrase.length < MIN_KEY_LENGTH) {
    throw new Error(`BACKUP_ENCRYPTION_KEY debe tener al menos ${MIN_KEY_LENGTH} caracteres`);
  }

  const plaintext = await readFile(inputPath);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const sha256 = createHash('sha256').update(plaintext).digest('hex');

  const envelope = {
    format: FORMAT,
    cipher: 'aes-256-gcm',
    kdf: 'scrypt-N32768-r8-p1',
    createdAt: new Date().toISOString(),
    sourceName: basename(inputPath),
    plaintextBytes: plaintext.length,
    plaintextSha256: sha256,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    payload: encrypted.toString('base64'),
  };

  const tempPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(tempPath, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
  await rename(tempPath, outputPath);
  return { outputPath, sha256, bytes: plaintext.length, format: FORMAT };
}

async function newestBackup(directory) {
  const files = (await readdir(directory))
    .filter((name) => /^backup-crm-.*\.json$/.test(name))
    .sort()
    .reverse();
  if (!files.length) throw new Error(`No se encontró backup-crm-*.json en ${directory}`);
  return join(directory, files[0]);
}

async function main() {
  const key = process.env.BACKUP_ENCRYPTION_KEY || '';
  const inputPath = process.argv[2] || await newestBackup('backup');
  const result = await encryptBackup(inputPath, key);

  const manifest = {
    encryptedAt: new Date().toISOString(),
    file: basename(result.outputPath),
    source: basename(inputPath),
    format: result.format,
    plaintextBytes: result.bytes,
    plaintextSha256: result.sha256,
    restore: 'BACKUP_ENCRYPTION_KEY=... node scripts/decrypt-backup.mjs backup/<archivo>.enc',
  };
  await writeFile(join(dirname(result.outputPath), 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rm(inputPath, { force: true });
  console.log(`✓ Backup cifrado: ${result.outputPath} (${result.bytes} bytes protegidos)`);
}

if (import.meta.url === pathToFileURL(fileURLToPath(import.meta.url)).href && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  });
}
