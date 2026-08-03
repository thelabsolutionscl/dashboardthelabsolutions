'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

async function api() {
  const encrypt = await import(pathToFileURL(join(process.cwd(), 'scripts', 'encrypt-backup.mjs')).href);
  const decrypt = await import(pathToFileURL(join(process.cwd(), 'scripts', 'decrypt-backup.mjs')).href);
  return { encryptBackup: encrypt.encryptBackup, decryptBackup: decrypt.decryptBackup };
}

const KEY = 'clave-de-respaldo-de-prueba-2026-muy-larga';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'thelab-backup-'));
  const input = join(directory, 'backup-crm-2026-08-03.json');
  const payload = JSON.stringify({ fecha: '2026-08-03', tablas: { Clientes: [{ id: 'rec123', fields: { Nombre: 'Cliente prueba' } }] } });
  await writeFile(input, payload);
  return { directory, input, payload };
}

test('backup CRM se cifra y recupera sin pérdida', async () => {
  const { encryptBackup, decryptBackup } = await api();
  const { directory, input, payload } = await fixture();
  const encrypted = join(directory, 'backup.enc');
  const restored = join(directory, 'restaurado.json');

  const enc = await encryptBackup(input, KEY, encrypted);
  assert.equal(enc.outputPath, encrypted);
  const envelope = JSON.parse(await readFile(encrypted, 'utf8'));
  assert.equal(envelope.format, 'thelab-backup-v1');
  assert.equal(envelope.cipher, 'aes-256-gcm');
  assert.ok(envelope.payload.length > 20);
  assert.ok(!JSON.stringify(envelope).includes('Cliente prueba'), 'el artifact no debe contener el CRM en texto plano');

  const dec = await decryptBackup(encrypted, KEY, restored);
  assert.equal(dec.outputPath, restored);
  assert.equal(await readFile(restored, 'utf8'), payload);
  assert.equal(dec.sha256, enc.sha256);
});

test('clave incorrecta no puede descifrar el respaldo', async () => {
  const { encryptBackup, decryptBackup } = await api();
  const { directory, input } = await fixture();
  const encrypted = join(directory, 'backup.enc');
  await encryptBackup(input, KEY, encrypted);
  await assert.rejects(
    decryptBackup(encrypted, 'otra-clave-de-respaldo-igual-de-larga-000', join(directory, 'bad.json')),
    /clave incorrecta|alterado/i,
  );
});

test('alterar el payload hace fallar autenticación GCM', async () => {
  const { encryptBackup, decryptBackup } = await api();
  const { directory, input } = await fixture();
  const encrypted = join(directory, 'backup.enc');
  await encryptBackup(input, KEY, encrypted);
  const envelope = JSON.parse(await readFile(encrypted, 'utf8'));
  const bytes = Buffer.from(envelope.payload, 'base64');
  bytes[0] ^= 0xff;
  envelope.payload = bytes.toString('base64');
  await writeFile(encrypted, JSON.stringify(envelope));
  await assert.rejects(
    decryptBackup(encrypted, KEY, join(directory, 'tampered.json')),
    /alterado|descifrar/i,
  );
});

test('rechaza claves de cifrado demasiado cortas', async () => {
  const { encryptBackup } = await api();
  const { directory, input } = await fixture();
  await assert.rejects(encryptBackup(input, 'corta', join(directory, 'bad.enc')), /24 caracteres/);
});
