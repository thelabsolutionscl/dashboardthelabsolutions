#!/usr/bin/env node
/*
 * Genera una entrada de usuario para env.AUTH_USERS del airtable-proxy.
 * Hash de contraseña con PBKDF2-SHA256 (mismo algoritmo que verifica el Worker).
 *
 * Uso:
 *   node airtable-proxy/scripts/make-user.mjs <correo> <rol> <password> [iteraciones]
 *
 * Ejemplo:
 *   node airtable-proxy/scripts/make-user.mjs nicanor@thelab.solutions admin 'MiClaveSegura' 100000
 *
 * Roles válidos: admin, gerencia, comercial, produccion, finanzas, marketing, demo
 *
 * Copia el objeto impreso dentro del array JSON de AUTH_USERS y súbelo como secret:
 *   wrangler secret put AUTH_USERS         (pega el array completo [ {...}, {...} ])
 *   wrangler secret put SESSION_SECRET     (cadena aleatoria larga: openssl rand -hex 32)
 */
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const [, , u, role, password, iterArg] = process.argv;
if (!u || !role || !password) {
  console.error('Uso: node make-user.mjs <correo> <rol> <password> [iteraciones]');
  process.exit(1);
}
const iter = parseInt(iterArg, 10) || 100000;
const salt = randomBytes(16).toString('hex');
const hash = pbkdf2Sync(password, Buffer.from(salt, 'hex'), iter, 32, 'sha256').toString('hex');

const entry = { u, name: u.split('@')[0], role, salt, iter, hash };
console.log(JSON.stringify(entry, null, 2));
console.log('\n// Pega esta entrada dentro del array de AUTH_USERS (puede tener varias).');
