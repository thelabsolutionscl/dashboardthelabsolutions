'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const deploy = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
const weekly = fs.readFileSync('.github/workflows/weekly.yml', 'utf8');
const inject = fs.readFileSync('scripts/inject-public-config.mjs', 'utf8');

test('deploy depende del quality gate antes de publicar', () => {
  assert.match(deploy, /quality:\s*\n[\s\S]*?Run all tests/);
  assert.match(deploy, /deploy:\s*\n[\s\S]*?needs:\s*quality/);
  assert.match(deploy, /path:\s*dist/);
});

test('deploy no inyecta secretos de proveedores al navegador', () => {
  for (const forbidden of [
    'secrets.OPENAI',
    'secrets.CLAUDE',
    'secrets.AIRTABLE',
    'secrets.ELEVENLABS',
    'secrets.PROXY_KEY',
    'secrets.PRINTER_TUNNEL_TOKEN',
    'secrets.PORTAL_ADMIN_KEY',
  ]) {
    assert.ok(!deploy.includes(forbidden), `deploy todavía contiene ${forbidden}`);
  }
  assert.match(deploy, /Inyectar solo configuración pública/);
  assert.match(deploy, /posible credencial privada/);
});

test('configurador neutraliza todos los placeholders privados conocidos', () => {
  for (const name of [
    'AIRTABLE_TOKEN', 'ANTHROPIC_KEY', 'OPENAI_KEY', 'ELEVENLABS',
    'PROXY_KEY', 'PRINTER_TUNNEL_TOKEN', 'PORTAL_ADMIN_KEY',
  ]) {
    assert.ok(inject.includes(`'${name}'`), `falta neutralizar ${name}`);
  }
  assert.match(inject, /PROXY_URL es obligatorio/);
});

test('workflow semanal solo publica el respaldo cifrado', () => {
  assert.match(weekly, /BACKUP_ENCRYPTION_KEY/);
  assert.match(weekly, /backup\/backup-crm-\*\.json\.enc/);
  assert.match(weekly, /retention-days:\s*30/);
  assert.doesNotMatch(weekly, /path:\s*backup\/\s*(?:\n|$)/);
  assert.match(weekly, /Quedó un backup CRM sin cifrar/);
});
