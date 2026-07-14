#!/usr/bin/env node
/*
 * Tests de humo del dashboard — el cableado que el syntax-check no ve.
 *
 * 1. WIRING UI: todo identificador llamado en atributos on*="..." (HTML estático
 *    y template strings) debe tener una definición real en los <script>. Un
 *    rename o typo deja botones muertos sin error de sintaxis: esto lo caza.
 * 2. SIN DUPLICADOS: las funciones críticas deben definirse EXACTAMENTE una vez
 *    (una redefinición accidental pisa la primera en silencio).
 * 3. IDs CRÍTICOS: los contenedores que el JS busca por id existen en el HTML.
 *
 * Correr:  node tests/smoke.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

// SRC = index.html + módulos externos js/*.js (extraídos del monolito):
// los tests siguen viendo TODO el código como una sola fuente.
const _jsDir = path.join(__dirname, '..', 'js');
const _jsExtra = fs.existsSync(_jsDir) ? fs.readdirSync(_jsDir).filter(f => f.endsWith('.js')).sort().map(f => fs.readFileSync(path.join(_jsDir, f), 'utf8')).join('\n') : '';
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8') + '\n<script>\n' + _jsExtra + '\n</scr' + 'ipt>';

// Solo el JS inline (sin src=) para buscar definiciones
const scripts = [...SRC.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .filter(m => !/\bsrc\s*=/.test(m[1] || ''))
  .map(m => m[2])
  .join('\n');

let fails = 0;
const fail = msg => { fails++; console.error('  ✗ ' + msg); };
const ok = msg => console.log('  ✓ ' + msg);

// ── 1. WIRING: on*="..." → función definida ──────────────────────────────
{
  // Identificadores llamados dentro de atributos de evento (comilla doble)
  const attrRe = /\son(?:click|change|input|submit|keydown|keyup|mouseenter|mouseleave|mouseover|mouseout|dragstart|dragend|dragover|dragleave|drop|load|error|focus|blur)\s*=\s*"([^"]*)"/gi;
  const BUILTINS = new Set(['event', 'this', 'window', 'document', 'confirm', 'prompt', 'alert',
    'String', 'Number', 'Boolean', 'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent',
    'JSON', 'Math', 'Date', 'Array', 'Object', 'RegExp', 'localStorage', 'sessionStorage', 'navigator',
    'open', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requireNonNull', 'void',
    'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'new', 'typeof']);
  const called = new Set();
  let am;
  while ((am = attrRe.exec(SRC))) {
    // Ignora interpolaciones ${...} y strings de comilla simple (el atributo usa
    // comillas dobles, así que todo string interno va con simples: CSS, textos…)
    const body = am[1].replace(/\$\{[^}]*\}/g, '').replace(/'[^']*'/g, "''");
    const idRe = /([A-Za-z_$][\w$]*)\s*\(/g;
    let im;
    while ((im = idRe.exec(body))) {
      const name = im[1];
      const prev = body[im.index - 1];
      if (prev === '.' || prev === ']') continue;      // método de objeto (MAIL.x, arr[i].y)
      if (BUILTINS.has(name)) continue;
      called.add(name);
    }
  }
  const missing = [...called].filter(n => {
    const def = new RegExp(
      '(?:function\\s+' + n + '\\s*\\(' +
      '|(?:window\\.)?' + n + '\\s*=\\s*(?:async\\b|function\\b|\\()' +
      '|(?:const|let|var)\\s+' + n + '\\s*=' +
      '|' + n + '\\s*:\\s*(?:async\\b|function\\b|\\()' + ')'
    );
    return !def.test(scripts);
  });
  if (missing.length) fail('Handlers on*= sin función definida: ' + missing.sort().join(', '));
  else ok('Wiring UI: ' + called.size + ' funciones llamadas desde on*= — todas definidas');
}

// ── 2. FUNCIONES CRÍTICAS: existen y sin duplicados ───────────────────────
{
  const CRITICAL = [
    // núcleo
    'renderOverview', 'renderClientes', 'renderCotizaciones', 'renderPedidos', 'switchTab',
    'airtableFetch', 'airtableWrite', 'callClaude', 'toast', 'escapeHtml', 'formatCLP',
    // agentes
    'runAgent', 'runAgentInline', 'formatAgentReport', 'buildAgentContext',
    'showAgentWorking', 'hideAgentWorking', 'agentCtaButtonsHtml', 'agentMemoriaCliente',
    // bandejas y flujos construidos en esta serie
    'buildFollowupTray', 'fuMarkDone', 'runFollowupAgent',
    'buildPostEntregaTray', 'pdMarkDone', 'buildWinbackTray', 'wbReactivar',
    'renderCsatSummary', 'ensureNpsFields', '_npsStats', '_npsLink',
    'renderMejorPrecio', 'addPrecioProv', 'delPrecioProv', '_mejorPrecioPorItem',
    'finRenderCobranzaActions', 'cobRegistrar', 'renderClienteTimeline',
    'finRenderFlujoCaja', 'addPagoProgramado', 'delPagoProgramado',
    'renderMorningBrief', 'renderMaqOcupacion', 'renderPedidosKanban', 'advancePedido',
    'tvStart', 'tvStop', 'openAgendaModal', 'agendaSave',
    'renderInventario', 'addMaterial', 'editMaterial', 'openConsumoModal', 'aplicarConsumo',
    'backupAirtable', 'checkBackupReminder', '_pruneLocalLogs',
    // oficina
    'renderOficina', '_ofIsoStation', '_ofSprite',
  ];
  const probs = [];
  CRITICAL.forEach(n => {
    const count = (scripts.match(new RegExp('function\\s+' + n + '\\s*\\(', 'g')) || []).length;
    if (count === 0) probs.push(n + ' (NO existe)');
    else if (count > 1) probs.push(n + ' (definida ' + count + ' veces)');
  });
  if (probs.length) fail('Funciones críticas: ' + probs.join(', '));
  else ok('Funciones críticas: ' + CRITICAL.length + ' presentes y únicas');
}

// ── 3. IDs CRÍTICOS del DOM ────────────────────────────────────────────────
{
  const IDS = ['tab-overview', 'tab-clientes', 'tab-cotizaciones', 'tab-pedidos', 'tab-agentes',
    'tab-oficina', 'tab-inventario', 'inventarioTableBody', 'agentesGrid', 'fuTrayCard', 'pdTrayCard', 'wbTrayCard', 'finCobranzaActions',
    'morningBrief', 'maqOcupacion', 'pedidosKanban', 'agentWorkingModal', 'agentInlineModal',
    'cdTimeline', 'mailList', 'umBackupInfo', 'agendaModal', 'finFlujoCaja', 'pdCsatBar'];
  const missing = IDS.filter(id => !SRC.includes('id="' + id + '"'));
  if (missing.length) fail('IDs del DOM ausentes: ' + missing.join(', '));
  else ok('IDs críticos del DOM: ' + IDS.length + ' presentes');
}

// ── 4. HOJA DE ESTILOS EXTERNA ─────────────────────────────────────────────
{
  const cssPath = path.join(__dirname, '..', 'styles.css');
  const linkOk = /<link rel="stylesheet" href="styles\.css\?v=%%BUILD%%">/.test(SRC);
  const cssOk = fs.existsSync(cssPath) && fs.readFileSync(cssPath, 'utf8').includes(':root{');
  if (!linkOk) fail('index.html no referencia styles.css?v=%%BUILD%% (el deploy estampa la versión)');
  else if (!cssOk) fail('styles.css ausente o sin las variables :root del tema');
  else ok('styles.css presente y enlazada con cache-busting');
}

// ── 5. WORKFLOWS DE GITHUB: YAML válido ────────────────────────────────────
// Un ':' suelto en un nombre de step invalida el YAML y el deploy falla en
// silencio hasta que miras Actions. Esto lo caza antes del push.
{
  const wfDir = path.join(__dirname, '..', '.github', 'workflows');
  const files = fs.existsSync(wfDir) ? fs.readdirSync(wfDir).filter(f => /\.ya?ml$/.test(f)) : [];
  const { spawnSync } = require('child_process');
  const probe = spawnSync('python3', ['-c', 'import yaml'], { stdio: 'pipe' });
  if (probe.status !== 0) {
    console.log('  – Workflows YAML: python3/yaml no disponible — check omitido (CI de GitHub lo valida igual)');
  } else {
    const bad = [];
    files.forEach(f => {
      const r = spawnSync('python3', ['-c', 'import yaml,sys; yaml.safe_load(open(sys.argv[1]))', path.join(wfDir, f)], { stdio: 'pipe' });
      if (r.status !== 0) bad.push(f + ' → ' + String(r.stderr).split('\n').filter(Boolean).pop());
    });
    if (bad.length) fail('Workflows con YAML inválido: ' + bad.join(' | '));
    else ok('Workflows YAML válidos: ' + files.join(', '));
  }
}

console.log(fails ? ('\n✗ Smoke: ' + fails + ' problema(s)') : '\n✓ Smoke: todo OK');
process.exit(fails ? 1 : 0);
