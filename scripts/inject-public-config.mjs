#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const PRIVATE_PLACEHOLDERS = [
  'AIRTABLE_TOKEN',
  'ANTHROPIC_KEY',
  'OPENAI_KEY',
  'ELEVENLABS',
  'PROXY_KEY',
  'PRINTER_TUNNEL_TOKEN',
  'PORTAL_ADMIN_KEY',
];

const DASHBOARD_PUBLIC = {
  GOOGLE_CLIENT_ID: 'GOOGLE_CLIENT_ID',
  SII_WORKER_URL: 'SII_WORKER_URL',
  SII_RUT_EMISOR: 'SII_RUT_EMISOR',
  SII_RAZON_SOCIAL: 'SII_RAZON_SOCIAL',
  PROXY_URL: 'PROXY_URL',
  PRINTER_TUNNEL: 'PRINTER_TUNNEL',
  ADS_WEBAPP: 'ADS_WEBAPP',
  ADS_CUSTOMER: 'ADS_CUSTOMER',
  LEAD_WORKER_URL: 'LEAD_WORKER_URL',
  PUBLIC_LEAD_KEY: 'PUBLIC_LEAD_KEY',
};

const COTIZA_PUBLIC = {
  LEAD_WORKER_URL: 'LEAD_WORKER_URL',
  PUBLIC_LEAD_KEY: 'PUBLIC_LEAD_KEY',
  TURNSTILE_SITE_KEY: 'TURNSTILE_SITE_KEY',
};

function replaceAll(source, token, value) {
  return source.split(`%%${token}%%`).join(String(value ?? ''));
}

function validatePublicValue(name, value) {
  if (!value) return;
  const dangerous = /(?:^|[^A-Za-z0-9])(?:sk-(?:proj-|ant-)?|pat[A-Za-z0-9]{8,}|re_[A-Za-z0-9]{12,})/i;
  if (dangerous.test(value)) throw new Error(`${name} parece contener una credencial privada`);
  if (/TOKEN|SECRET|PASSWORD|PRIVATE/i.test(name)) throw new Error(`${name} no está permitido en configuración pública`);
}

async function inject(file, mapping, { neutralizePrivate = false } = {}) {
  let html = await readFile(file, 'utf8');
  if (neutralizePrivate) {
    for (const name of PRIVATE_PLACEHOLDERS) html = replaceAll(html, name, '');
  }
  for (const [placeholder, envName] of Object.entries(mapping)) {
    const value = process.env[envName] || '';
    validatePublicValue(envName, value);
    html = replaceAll(html, placeholder, value);
  }
  await writeFile(file, html);
}

async function main() {
  if (!process.env.PROXY_URL) {
    throw new Error('PROXY_URL es obligatorio: el dashboard ya no permite credenciales directas en el navegador');
  }
  await inject('index.html', DASHBOARD_PUBLIC, { neutralizePrivate: true });
  await inject('cotiza.html', COTIZA_PUBLIC);

  const index = await readFile('index.html', 'utf8');
  const leakedPlaceholder = PRIVATE_PLACEHOLDERS.find((name) => index.includes(`%%${name}%%`));
  if (leakedPlaceholder) throw new Error(`No se neutralizó %%${leakedPlaceholder}%%`);

  const secretPatterns = [
    ['Airtable PAT', /pat[A-Za-z0-9._-]{20,}/],
    ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{15,}/],
    ['OpenAI key', /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
    ['Resend key', /re_[A-Za-z0-9_-]{20,}/],
  ];
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(index)) throw new Error(`${label} detectada en index.html generado`);
  }
  console.log('✓ Configuración pública inyectada; credenciales privadas neutralizadas');
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
