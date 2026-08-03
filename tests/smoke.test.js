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
const ROOT = path.join(__dirname, '..');

// Solo el JS inline (sin src=) para buscar definiciones
const scripts = [...SRC.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .filter(m => !/\bsrc\s*=/.test(m[1] || ''))
  .map(m => m[2])
  .join('\n');

let fails = 0;
const fail = msg => { fails++; console.error('  ✗ ' + msg); };
const ok = msg => console.log('  ✓ ' + msg);

// ── 0. GUARDAS DE SEGURIDAD ─────────────────────────────────────────
{
  const mailApi = fs.readFileSync(path.join(ROOT, 'mail-api.php'), 'utf8');
  const siiAuth = fs.readFileSync(path.join(ROOT, 'sii-worker', 'src', 'sii-auth.js'), 'utf8');
  if (!mailApi.includes("header('Cache-Control: no-store")) fail('mail-api debe impedir caché de correos/credenciales');
  else ok('mail-api marca respuestas sensibles como no-store');
  if (/respuesta cruda SII COMPLETA|innerXml firmado:',\s*innerXml/.test(siiAuth)) fail('SII no debe registrar XML tributario completo');
  else ok('SII no registra XML tributario ni documentos firmados completos');
  if (!SRC.includes('function _safePrinterMediaUrl(')) fail('Falta validación de URLs multimedia de impresoras');
  else ok('URLs configurables de cámaras/miniaturas pasan por allowlist');
  if (!SRC.includes("filterPedidos('Completado'") || !SRC.includes("<option>Completado</option>")) fail('Pedidos debe exponer el estado Completado y su archivo');
  else ok('Pedidos completados tienen estado y acceso al archivo');
  if (!/filter==='all'[^:]*\?basePedidos\.filter\(p=>\(p\.fields\['Estado pedido'\]\|\|''\)!=='Completado'\)/.test(SRC)) fail('La vista principal de Pedidos debe ocultar los completados');
  else ok('La vista principal excluye pedidos completados sin eliminarlos');
  const completionGuards = (SRC.match(/Solo se puede completar un pedido que ya esté despachado/g) || []).length;
  if (completionGuards < 3 || !SRC.includes('Solo se pueden completar pedidos que ya estén despachados')) fail('Completar debe exigir Despachado en acciones individuales, guiadas y masivas');
  else ok('El archivo solo acepta pedidos previamente despachados');
  // El portal del cliente vive en el Worker (lead-worker/src/index.js), no acá:
  // el dashboard solo pide el link firmado. Ver tests/portal-cliente.test.js.
  {
    const worker = fs.readFileSync(path.join(ROOT, 'lead-worker', 'src', 'index.js'), 'utf8');
    if (!worker.includes('const PORTAL_STAGES = ["Confirmado", "En producción", "Listo para despacho", "Despachado", "Completado"];')) fail('El portal del cliente debe representar la etapa Completado');
    else ok('El portal del cliente representa el ciclo completo hasta Completado');
    if (/function checkClientePortal/.test(SRC)) fail('El dashboard no debe volver a servir el portal del cliente (fuga de datos internos)');
    else ok('El dashboard no expone el portal del cliente desde su propio HTML');
    // El guard tiene que ir ANTES de cualquier <link>/<script src> del head: un
    // script inline espera a los stylesheets pendientes y la carga se colaría.
    const head = SRC.slice(0, SRC.indexOf('</head>'));
    const guard = head.indexOf('[?&]portal=');
    const primerRecurso = Math.min(...['<link', '<script src', '<script defer', '<script async'].map((x) => { const i = head.indexOf(x); return i < 0 ? Infinity : i; }));
    if (guard < 0 || !/location\.replace\(/.test(head)) fail('Un link antiguo (?portal=) debe salir del dashboard, no abrirlo');
    else if (guard > primerRecurso) fail('El corte de los links antiguos (?portal=) debe ir antes de los recursos del <head>');
    else ok('Los links antiguos del portal salen del dashboard antes de cargar nada');
    if (!/X-Portal-Admin-Key/.test(SRC)) fail('El dashboard debe pedir el link del portal al Worker con PORTAL_ADMIN_KEY');
    else ok('El link del portal lo emite el Worker, firmado y con vencimiento');
  }
  if (!SRC.includes("querySelectorAll('#pedidosFilterBar>button.active-filter')")) fail('Los filtros de Pedidos no deben desactivar el selector de vista');
  else ok('Los filtros preservan el selector Tabla/Kanban/Calendario');
  if (SRC.includes('thelab2025')) fail('No debe existir el secreto histórico de Google Ads en el código fuente');
  else ok('Google Ads no contiene secretos de mutación hardcodeados');
}

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
    'buildRecompraTray', '_recompraCands', 'recompraWhatsApp', 'recompraSnooze',
    'renderChurn', '_churnRiesgo', 'churnReactivar',
    'renderFechasClave', '_fechasProximas', 'setFechaCliente', 'saludarFecha',
    'renderCsatSummary', 'ensureNpsFields', '_npsStats', '_npsLink',
    'renderMejorPrecio', 'addPrecioProv', 'delPrecioProv', '_mejorPrecioPorItem',
    'generarCierrePDF', 'enviarCierreMes', 'enviarDigestSemanal', '_digestSemanalTexto',
    'finRenderCobranzaActions', 'cobRegistrar', 'renderClienteTimeline',
    'finRenderFlujoCaja', 'addPagoProgramado', 'delPagoProgramado',
    'renderMorningBrief', 'renderMaqOcupacion', 'renderPedidosKanban', 'advancePedido',
    'tvStart', 'tvStop', 'openAgendaModal', 'agendaSave',
    'renderInventario', 'addMaterial', 'editMaterial', 'openConsumoModal', 'aplicarConsumo',
    'renderReordenInventario', '_reordenSugerencias', 'pedirReorden',
    'renderCargaMaquinas', '_maqCarga', 'asignarMaquina', 'sugerirMaquina', '_pedHorasEst',
    'prodStart', 'prodStop', '_cicloPromedio', '_prodState',
    'crearPedidoDesdeCotizacion', 'renderCotToOrderTray', 'convertirCotAPedido', '_pedidoDeCot',
    'rentabilidadLineas', '_prodLinea', 'renderPresupuesto', '_presEjecutadoReal',
    'openCatalogoModal', 'renderCatalogoModal', 'addCatalogoItem', 'insertarCatalogo',
    'margenBadge', '_margenPiso', 'setMargenPiso',
    'renderComisiones', '_ventasVendedor', 'setComisionCfg', 'setMetaVendedores',
    'openReclamoModal', 'guardarReclamo', 'renderReclamos', 'setReclamoEstado',
    'openRetainerModal', 'guardarRetainer', 'generarRetainer', 'retainersAutoCheck', 'renderRetainers',
    'renderArqueo', '_arqueoDia', 'guardarArqueo',
    'generarEstadoCuentaPDF', 'enviarEstadoCuenta', '_estadoCuentaData',
    '_descCliente', 'setDescCliente', '_renderCdDescChip',
    'openOCModal', 'guardarOC', 'generarOCPDF', 'renderOCList', 'crearOCDesdeReorden',
    'renderEstacionalidad', '_estacionalidad', 'renderCacCanal', '_canalStats', 'setGastoCanal',
    'renderOnboarding', '_onboardingSteps', 'toggleOnboarding',
    '_podLink', 'pedirPOD', 'ensurePodFields', '_podConfirmado',
    '_seguimientoLink', 'compartirSeguimiento',
    'renderBreakEven', '_puntoEquilibrio', 'setCostosFijos',
    'renderIvaMensual', '_ivaMes', 'renderPerdidas', '_cotizacionesPerdidas', '_perdidaCat',
    'backupAirtable', 'checkBackupReminder', '_pruneLocalLogs',
    // oficina
    'renderOficina', '_ofIsoStation', '_ofSprite',
    'startOficinaPolling', 'stopOficinaPolling', 'ofLogComm', 'ofCelebrate', 'ofAgentError',
    'ofAgentDetail', 'ofSetView', 'ofSetCardFilter', 'ofSearchInput', 'ofSetChartRange',
    'ofToggleSceneTheme', 'ofToggleDensity', 'ofExport', 'ofUpdateDockBadge', '_ofApplyPrefs',
    'agentIdentity', 'ofToggleMore', 'ofAgentDetailByLabel', 'ofFeedMore', '_ofChatMsg', '_ofTvTour',
    'ofFeedView', '_ofOpenRun', '_ofHeatmap', '_ofStateShapeStyle', '_ofTickTvClock', 'ofFilamentClick', '_ofDayInsight', '_ofStreakRecord', '_ofTickBoard',
    'ofKpiClick', '_ofScrollToEl', '_ofTickTeamLast', 'ofDigest', '_ofDigestFallback', '_ofRenderHealth', 'ofHealthClick', 'ofWakeAgent', 'ofFeedSearch', 'ofFeedCopy', '_ofHasData',
    // redes
    'initRedes', 'redesLoad', 'renderRedesPosts', 'renderRedesKpis', 'renderRedesInbox', 'renderRedesMetrics',
    '_redesHasData', '_redesWrite', 'redesDemoToggle', 'redesDemoExit', 'redesDemoSeed', '_redesDemoBanner', 'redesPreviewInsta', 'redesIgClose',
    '_redesIgOpen', 'redesIgCopy', 'redesPreviewGen', '_redesEngTrend', '_redesMonday', 'redesWeekNav', 'renderRedesWeekGrid', '_redesGaps', '_redesGapsHtml', 'redesPlanDay', 'redesConnectGuide', 'redesGuideClose',
    '_redesAutoStatus', 'renderRedesAutoPanel', '_redesDemoCopy', '_redesFillGapsCore', 'redesFillGaps', 'redesAutopilot', 'redesAutoSchedule',
    // newsletter — top 3
    'initNewsletter', 'nlLoad', 'renderNlCampaigns', 'renderNlKpis', 'nlGenerate', '_nlBaseDest',
    '_nlEngByEmail', '_nlRecentRecipients', '_nlCampRate', '_nlBestSendTime', 'renderNlAnalytics',
    '_nlSubjectScore', '_nlScoreChip', 'nlSubjectSuggest', 'nlApplySubject',
    'nlPopulatePedidos', 'nlGenerateFromPedido', '_nlSmartSegOptions', 'nlDestSetNoResend',
    // calendario de equipo
    'renderCalendario', 'renderCalProximos', 'openCalEventoModal', 'closeCalEventoModal', 'calSaveEvento', 'calDelEvento',
    'calNavMes', 'calHoy', 'calSetFiltro', 'calTogglePersona', 'calToggleAllDay',
    '_calMerge', '_calPrune', '_calReconcile', '_calBackup', '_calPoll', 'startCalSync',
    'calGoogleConnect', 'calSyncAll', '_calAutoSync', '_calSyncEvento', '_calNeedsSync', '_calGcalBody',
    'startCalAlarmas', '_calAlarmTick', 'calPedirPermisoAvisos', 'calToggleConfig', 'calSaveConfig',
    // upsert anti-duplicados en Monitor Sistema
    '_monitorUpsert',
    // buscador de empresa en Nuevo Lead / Cliente
    '_nlEmpNorm', '_nlEmpMatchExacto', '_nlEmpCandidatos', 'nlEmpresaBuscar', '_nlEmpAviso',
    'nlEmpresaCerrar', 'nlEmpresaNueva', 'nlEmpresaForzar', 'nlEmpresaPick', 'nlEmpresaKey',
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
    'cdTimeline', 'mailList', 'umBackupInfo', 'agendaModal', 'finFlujoCaja', 'pdCsatBar', 'cotToOrderTray',
    'recompraTrayCard', 'invReordenCard', 'cargaMaquinas', 'catalogoModal', 'comisionesRanking',
    'reclamoModal', 'reclamosCard', 'retainerModal', 'retainersCard', 'arqueoCard',
    'ocModal', 'ocList', 'cdDescChip', 'cdOnboarding', 'estacionalidadCard', 'breakEvenCard',
    'ivaMensualCard', 'churnCard', 'fechasClaveCard', 'perdidasCard', 'cacCanalCard',
    // oficina: contenedores que js/oficina.js busca por id
    'oficinaKpis', 'oficinaCards', 'oficinaFloor', 'oficinaIso', 'oficinaCharts', 'oficinaFeed',
    'oficinaAlerts', 'oficinaCardFilter', 'oficinaErr', 'badge-oficina', 'ofAgentModal', 'oficinaRangeSel',
    'ofHealth', 'ofTeamLast', 'oficinaFeedSearch',
    'tab-redes', 'redesPostsList', 'redesInboxList', 'redesIgPreviewModal', 'redesIgBody',
    'redesGuideModal', 'redesGuideBody', 'redesBtnSem', 'redesPostsCal', 'redesAutoPanel',
    'nlAnalytics', 'nlGenPedido', 'nlDestNoResend',
    // calendario
    'tab-calendario', 'calGrid', 'calProximos', 'calMesLabel', 'calFiltroChips', 'calSyncStatus',
    'calCfgBox', 'calEventoModal', 'calEvTitulo', 'calEvFecha', 'calEvPersonas', 'calEvAlarma'];
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
