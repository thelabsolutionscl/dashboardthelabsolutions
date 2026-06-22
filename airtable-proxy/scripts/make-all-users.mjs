#!/usr/bin/env node
/*
 * Genera el array completo de AUTH_USERS para el airtable-proxy en un solo paso.
 * Pregunta la contraseña de cada usuario de forma OCULTA (no queda en el historial
 * del shell ni en archivos) y emite el JSON listo para `wrangler secret put`.
 *
 * Uso recomendado (la contraseña se pide por pantalla, el JSON sale por stdout):
 *   node scripts/make-all-users.mjs > users.json
 *   wrangler secret put AUTH_USERS < users.json
 *   rm users.json
 *
 * Los mensajes/prompts van a stderr; SOLO el JSON va a stdout, por eso el redirect
 * a users.json queda limpio.
 */
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import readline from 'node:readline';

// Usuarios reflejados desde el dashboard (nombre + rol). Edita esta lista si cambian.
const USERS = [
  { u: 'nicanor@thelab.solutions',   name: 'Nicanor Marambio', role: 'admin' },
  { u: 'gustavo@thelab.solutions',   name: 'Gustavo Kaiser',   role: 'admin' },
  { u: 'florencia@thelab.solutions', name: 'Florencia',        role: 'comercial' },
  { u: 'tecnico@thelab.solutions',   name: 'Técnico Máquinas', role: 'produccion' },
  { u: 'finanzas@thelab.solutions',  name: 'Finanzas',         role: 'finanzas' },
  { u: 'marketing@thelab.solutions', name: 'Marketing',        role: 'marketing' },
  { u: 'demo@thelab.solutions',      name: 'Demo',             role: 'demo' },
];
const ITER = 100000;

// Una sola interfaz readline + cola de líneas: así no se pierden líneas que lleguen
// en lote (pipe) ni se agota stdin al reabrir. Con TTY ocultamos la contraseña
// repintando el prompt en cada tecla; sin TTY (pruebas con pipe) se lee normal.
const isTTY = !!process.stdin.isTTY;
const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: isTTY });
const lineQueue = [];
const waiters = [];
rl.on('line', (l) => { if (waiters.length) waiters.shift()(l); else lineQueue.push(l); });
function nextLine() { return new Promise((res) => { if (lineQueue.length) res(lineQueue.shift()); else waiters.push(res); }); }

async function askHidden(prompt) {
  let muted = true;
  const onData = () => { if (muted) process.stderr.write('\x1b[2K\r' + prompt); };
  if (isTTY) process.stdin.on('data', onData);
  process.stderr.write(prompt);
  const answer = await nextLine();
  muted = false;
  if (isTTY) process.stdin.removeListener('data', onData);
  process.stderr.write('\n');
  return answer;
}

const out = [];
for (const user of USERS) {
  let pw = '';
  while (!pw) {
    pw = await askHidden(`Contraseña para ${user.u} (${user.role}): `);
    if (!pw) process.stderr.write('  ↳ vacía, intenta de nuevo.\n');
  }
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(pw, Buffer.from(salt, 'hex'), ITER, 32, 'sha256').toString('hex');
  out.push({ u: user.u, name: user.name, role: user.role, salt, iter: ITER, hash });
}
rl.close();

process.stderr.write(`\n✓ ${out.length} usuarios generados.\n`);
process.stdout.write(JSON.stringify(out)); // SOLO el JSON a stdout
