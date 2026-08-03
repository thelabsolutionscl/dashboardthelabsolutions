/* Centro de mando universal para todas las páginas del Modo TV. */
(function () {
  'use strict';

  if (window.TVControlCenter) return;

  const ID = 'tvcc-root';
  const STYLE_ID = 'tvcc-style';
  const PAGE_ORDER = ['resumen', 'produccion', 'libres', 'entregas', 'capacidad', 'equipo', 'alertas', 'resultados'];
  const ROTATE_MS = {
    resumen: 15000,
    produccion: 25000,
    libres: 15000,
    entregas: 20000,
    capacidad: 18000,
    equipo: 15000,
    alertas: 12000,
    resultados: 18000,
  };
  const STALE_AFTER_MS = 90 * 1000;

  let page = 'resumen';
  let rotationTimer = null;
  let refreshTimer = null;
  let clockTimer = null;
  let contextTimer = null;
  let unsubscribeTelemetry = null;
  let manualOpen = false;
  let lastCriticalSignature = '';

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);

  function localToday() {
    if (window.TheLabTime?.localISODate) return window.TheLabTime.localISODate();
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());
    } catch (_) {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }
  }

  function daysUntil(value) {
    if (!value) return null;
    if (window.TheLabTime?.daysBetween) return window.TheLabTime.daysBetween(localToday(), String(value).slice(0, 10));
    const start = new Date(`${localToday()}T12:00:00`);
    const end = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(end.getTime())) return null;
    return Math.round((end.getTime() - start.getTime()) / 86400000);
  }

  function isTvContext() {
    return Boolean(
      document.fullscreenElement
      || document.body.classList.contains('kiosk')
      || document.querySelector('.cal-tv,.tv-mode,.of-tv,.oficina-tv,[data-tv-mode="true"],[data-tv-mode="active"]')
    );
  }

  function machines() {
    try { return typeof MAQUINAS !== 'undefined' && Array.isArray(MAQUINAS) ? MAQUINAS : []; } catch (_) { return []; }
  }

  function rawStatus(machine) {
    const apiStatus = window.PrinterTelemetry?.get?.(machine.id);
    if (apiStatus) return apiStatus;
    try {
      if (typeof _printerStatus !== 'undefined' && _printerStatus?.[machine.id]) return { ..._printerStatus[machine.id] };
    } catch (_) {}
    let configured = false;
    try { configured = typeof getPrinterIp === 'function' && Boolean(getPrinterIp(machine)); } catch (_) {}
    return { state: configured ? 'connecting' : 'noip' };
  }

  function normalizedStatus(machine) {
    const status = rawStatus(machine) || {};
    const seenAt = Number(status.lastSeenAt || status.checkedAt || 0);
    const stale = seenAt > 0 && Date.now() - seenAt > STALE_AFTER_MS;
    return { ...status, state: status.state || 'offline', seenAt, stale };
  }

  function orders() {
    try { return Array.isArray(state?.pedidos) ? state.pedidos : []; } catch (_) { return []; }
  }

  function quotes() {
    try { return Array.isArray(state?.cotizaciones) ? state.cotizaciones : []; } catch (_) { return []; }
  }

  function logoSrc() {
    const shared = window.TVLogoFix?.getLogoSrc?.();
    if (shared) return shared;
    const image = document.querySelector('.topbar-logo img,.brand img,.sidebar-logo img,header img[alt*="Lab" i],img.logo');
    return image?.currentSrc || image?.src || '';
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#${ID}{position:fixed;inset:0;z-index:100200;background:#07090b;color:#f5f7fa;font-family:Inter,Arial,sans-serif;display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;overflow:hidden}
#${ID} *{box-sizing:border-box}
.tvcc-head{display:flex;align-items:center;gap:20px;padding:18px 28px 12px;border-bottom:1px solid #20262c;min-width:0}
.tvcc-logo{height:40px;max-width:300px;width:auto;object-fit:contain}
.tvcc-brand-fallback{font:700 26px/1 'Bebas Neue',Inter,sans-serif;letter-spacing:1.5px}
.tvcc-title{font:700 28px/1 'Bebas Neue',Inter,sans-serif;letter-spacing:1.5px;color:#a4abb2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tvcc-clock{margin-left:auto;text-align:right;flex:0 0 auto}.tvcc-clock b{font:700 38px/1 'Bebas Neue',Inter,sans-serif;color:#20d9dc}.tvcc-clock small{display:block;color:#9ba3aa;font-size:12px;margin-top:3px}
.tvcc-strip{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;padding:10px 28px;background:#0b0f12;border-bottom:1px solid #1c2329}
.tvcc-kpi{padding:8px 12px;border-left:3px solid #2dd4bf;background:#12171b;border-radius:7px;min-width:0}.tvcc-kpi b{font-size:20px}.tvcc-kpi span{display:block;color:#aeb5bc;font-size:12px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tvcc-main{padding:18px 28px;overflow:auto;min-height:0}.tvcc-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.tvcc-card{background:#15191d;border:1px solid #2a3036;border-left:5px solid var(--c,#38bdf8);border-radius:12px;padding:15px;min-height:110px;overflow:hidden}.tvcc-card h3{margin:0 0 8px;font-size:19px}.tvcc-card p{margin:5px 0;color:#c2c8ce;font-size:14px;overflow-wrap:anywhere}.tvcc-card strong{color:#fff}
.tvcc-row{display:grid;grid-template-columns:100px 1.2fr 1fr 1fr 120px;gap:12px;align-items:center;padding:12px 14px;border-bottom:1px solid #252b31;font-size:15px}.tvcc-row.head{color:#a0a8b0;font-size:12px;text-transform:uppercase;font-weight:700}
.tvcc-progress{height:9px;border-radius:999px;background:#2a3036;overflow:hidden}.tvcc-progress i{display:block;height:100%;width:var(--w);background:var(--c,#2dd4bf)}
.tvcc-alert{border:1px solid #7f1d1d;background:#2a1010;padding:14px;border-radius:10px;margin-bottom:10px}.tvcc-alert h3{margin:0 0 5px;color:#ff7b7b}.tvcc-alert p{margin:0;color:#f0caca}
.tvcc-foot{display:flex;align-items:center;gap:14px;padding:9px 28px;border-top:1px solid #20262c;color:#9ba3aa;font-size:12px}.tvcc-dots{margin-left:auto;display:flex;gap:7px}.tvcc-dot{width:9px;height:9px;border:0;border-radius:50%;background:#30363c;padding:0;cursor:pointer}.tvcc-dot.on{background:#20d9dc}.tvcc-night{color:#fbbf24;font-weight:700}.tvcc-conn{display:flex;gap:10px;flex-wrap:wrap}.tvcc-pill{padding:4px 8px;border-radius:999px;background:#151b20;border:1px solid #2c3339}.tvcc-pill.ok{border-color:#166534;color:#86efac}.tvcc-pill.warn{border-color:#854d0e;color:#fde68a}.tvcc-pill.bad{border-color:#7f1d1d;color:#fca5a5}
.tvcc-stale{display:inline-block;margin-left:6px;padding:2px 6px;border-radius:999px;background:#3f2d12;color:#fde68a;font-size:11px}.tvcc-critical{animation:tvccPulse 1.2s infinite}@keyframes tvccPulse{50%{box-shadow:0 0 0 4px rgba(239,68,68,.18)}}
@media(max-width:1200px){.tvcc-grid{grid-template-columns:repeat(3,1fr)}.tvcc-strip{grid-template-columns:repeat(3,1fr)}}
@media(max-width:760px){.tvcc-head{padding:12px 14px}.tvcc-logo{height:30px}.tvcc-title{font-size:22px}.tvcc-clock b{font-size:28px}.tvcc-strip{padding:8px 14px;grid-template-columns:repeat(2,1fr)}.tvcc-main{padding:12px 14px}.tvcc-grid{grid-template-columns:1fr}.tvcc-row{grid-template-columns:90px 1fr}.tvcc-row>*:nth-child(n+3){display:none}.tvcc-foot{padding:8px 14px}.tvcc-foot>span{display:none}}
@media(prefers-reduced-motion:reduce){.tvcc-critical{animation:none}}
`;
    document.head.appendChild(style);
  }

  function alerts(activeOrders, statuses) {
    const result = [];
    for (const { machine, status } of statuses) {
      const label = `${machine.nombre || 'Impresora'} #${machine.numG || machine.num || ''}`.trim();
      if (['error', 'shutdown'].includes(status.state)) {
        result.push({ severity: 3, title: `${label} detenida`, detail: status.klMsg || status.connectionError || 'La impresora requiere revisión inmediata.' });
      } else if (status.state === 'offline') {
        result.push({ severity: 2, title: `${label} sin conexión`, detail: status.connectionError || 'No hay telemetría disponible.' });
      } else if (status.stale) {
        result.push({ severity: 1, title: `${label} con datos atrasados`, detail: 'La última telemetría tiene más de 90 segundos.' });
      }
    }

    for (const order of activeOrders) {
      const fields = order.fields || {};
      const remaining = daysUntil(fields['Fecha entrega']);
      const orderState = fields['Estado pedido'] || '';
      const number = fields['N° Pedido'] || 'Pedido';
      if (remaining !== null && remaining < 0) {
        result.push({ severity: 3, title: `${number} atrasado`, detail: `${orderState || 'Sin estado'} · entrega ${fields['Fecha entrega'] || 'sin fecha'}` });
      } else if (remaining === 0 && !['Listo', 'Listo para despacho', 'Despachado', 'Completado'].includes(orderState)) {
        result.push({ severity: 3, title: `${number} vence hoy`, detail: `Estado actual: ${orderState || 'sin estado'}` });
      }
    }
    return result.sort((a, b) => b.severity - a.severity);
  }

  function collectData() {
    const fleet = machines();
    const statuses = fleet.map((machine) => ({ machine, status: normalizedStatus(machine) }));
    const activeOrders = orders().filter((order) => !['Despachado', 'Completado', 'Cancelado'].includes(order.fields?.['Estado pedido'] || ''));
    const deliveries = activeOrders.filter((order) => order.fields?.['Fecha entrega']);
    const dueToday = deliveries.filter((order) => String(order.fields['Fecha entrega']).slice(0, 10) === localToday());
    const printing = statuses.filter(({ status }) => status.state === 'printing' && !status.stale).length;
    const free = statuses.filter(({ status }) => ['standby', 'idle', 'complete'].includes(status.state) && !status.stale).length;
    const errors = statuses.filter(({ status }) => ['error', 'shutdown', 'offline'].includes(status.state)).length;
    const critical = alerts(activeOrders, statuses);
    const lastTelemetryAt = Math.max(window.PrinterTelemetry?.lastUpdateAt?.() || 0, ...statuses.map(({ status }) => status.seenAt || 0), 0);
    return { fleet, statuses, activeOrders, deliveries, dueToday, printing, free, errors, critical, lastTelemetryAt };
  }

  function serviceHealth(data) {
    const age = data.lastTelemetryAt ? Date.now() - data.lastTelemetryAt : Infinity;
    const bridge = age <= STALE_AFTER_MS ? { label: 'Bridge en vivo', css: 'ok' }
      : data.fleet.length ? { label: 'Bridge sin señal', css: 'bad' }
        : { label: 'Sin impresoras', css: 'warn' };
    const airtableAt = Number(window.__airtableLastSuccessAt || window.AIRTABLE_LAST_SUCCESS_AT || 0);
    const airtable = airtableAt && Date.now() - airtableAt < 5 * 60 * 1000
      ? { label: 'Airtable reciente', css: 'ok' }
      : { label: 'Airtable sin verificar', css: 'warn' };
    const internet = navigator.onLine
      ? { label: 'Internet disponible', css: 'ok' }
      : { label: 'Sin internet', css: 'bad' };
    return { bridge, airtable, internet };
  }

  function kpis(data) {
    return [
      { value: data.activeOrders.length, label: 'Pedidos activos' },
      { value: data.dueToday.length, label: 'Entregas hoy' },
      { value: `${data.printing}/${data.fleet.length}`, label: 'Imprimiendo en vivo' },
      { value: data.free, label: 'Disponibles' },
      { value: data.errors, label: 'Máquinas con problema' },
      { value: data.critical.length, label: 'Alertas' },
    ];
  }

  function header(title) {
    const src = logoSrc();
    const brand = src
      ? `<img class="tvcc-logo" src="${esc(src)}" alt="The Lab Solutions">`
      : '<strong class="tvcc-brand-fallback">THE LAB SOLUTIONS</strong>';
    return `<header class="tvcc-head">${brand}<span class="tvcc-title">${esc(title)}</span><div class="tvcc-clock"><b id="tvccClock"></b><small id="tvccDate"></small></div></header>`;
  }

  function strip(data) {
    return `<div class="tvcc-strip">${kpis(data).map((item) => `<div class="tvcc-kpi"><b>${esc(item.value)}</b><span>${esc(item.label)}</span></div>`).join('')}</div>`;
  }

  function progress(value, color) {
    const percent = Math.max(0, Math.min(100, Number(value) || 0));
    return `<div class="tvcc-progress" style="--w:${percent}%;--c:${esc(color)}"><i></i></div>`;
  }

  function machineCard({ machine, status }) {
    const stateName = status.state || 'offline';
    const colors = { printing: '#22c55e', paused: '#f59e0b', error: '#ef4444', shutdown: '#ef4444', offline: '#6b7280', noip: '#6b7280', connecting: '#38bdf8', standby: '#2dd4bf', idle: '#2dd4bf', complete: '#a78bfa' };
    const color = colors[stateName] || '#38bdf8';
    const percent = Math.round(Number(status.progress) || 0);
    const eta = status.eta ? new Date(Date.now() + Number(status.eta) * 1000).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' }) : '—';
    let detail = stateName;
    if (stateName === 'printing') detail = `${percent}% · termina ${eta}`;
    else if (stateName === 'connecting') detail = 'Consultando telemetría…';
    else if (stateName === 'offline') detail = status.connectionError || 'Sin respuesta';
    else if (stateName === 'noip') detail = 'IP no configurada';

    return `<article class="tvcc-card ${['error', 'shutdown'].includes(stateName) ? 'tvcc-critical' : ''}" style="--c:${color}">
      <h3>${esc(machine.nombre || 'Impresora')} #${esc(machine.numG || machine.num || '')}${status.stale ? '<span class="tvcc-stale">DATOS ATRASADOS</span>' : ''}</h3>
      <p><strong>${esc(String(status.filename || stateName).replace(/_/g, ' '))}</strong></p>
      <p>${esc(detail)}</p>
      ${stateName === 'printing' ? progress(percent, color) : ''}
      <p>Hotend ${esc(status.hotend?.actual ?? '—')}° · cama ${esc(status.bed?.actual ?? '—')}°</p>
    </article>`;
  }

  function summaryPage(data) {
    const next = data.deliveries.slice().sort((a, b) => String(a.fields['Fecha entrega']).localeCompare(String(b.fields['Fecha entrega'])))[0];
    const openQuotes = quotes().filter((quote) => ['Borrador', 'Pendiente', 'Enviada'].includes(quote.fields?.Estado || quote.fields?.['Estado cotización'] || '')).length;
    return `<div class="tvcc-grid">
      <article class="tvcc-card" style="--c:#20d9dc"><h3>Estado general</h3><p><strong>${data.printing}</strong> máquinas imprimiendo y <strong>${data.free}</strong> disponibles con telemetría reciente.</p><p>${data.errors ? `${data.errors} requieren atención.` : 'Sin fallas críticas informadas.'}</p></article>
      <article class="tvcc-card" style="--c:#a78bfa"><h3>Próxima entrega</h3><p><strong>${esc(next?.fields?.['N° Pedido'] || 'Sin entrega próxima')}</strong></p><p>${esc(next?.fields?.['Fecha entrega'] || '—')} · ${esc(next?.fields?.['Estado pedido'] || '—')}</p></article>
      <article class="tvcc-card" style="--c:#f59e0b"><h3>Cotizaciones</h3><p><strong>${openQuotes}</strong> abiertas o pendientes.</p></article>
      <article class="tvcc-card" style="--c:${data.critical.length ? '#ef4444' : '#22c55e'}"><h3>Prioridad actual</h3><p><strong>${esc(data.critical[0]?.title || 'Operación estable')}</strong></p><p>${esc(data.critical[0]?.detail || 'No hay alertas urgentes.')}</p></article>
    </div>`;
  }

  function productionPage(data) {
    return `<div class="tvcc-grid">${data.statuses.map(machineCard).join('') || '<article class="tvcc-card"><h3>Sin máquinas configuradas</h3></article>'}</div>`;
  }

  function availablePage(data) {
    const rows = data.statuses
      .filter(({ status }) => status.state === 'printing' && Number(status.eta) > 0 && !status.stale)
      .sort((a, b) => Number(a.status.eta) - Number(b.status.eta));
    const body = rows.map(({ machine, status }, index) => `<div class="tvcc-row"><b>#${index + 1}</b><strong>${esc(machine.nombre || 'Impresora')} #${esc(machine.numG || machine.num || '')}</strong><span>${esc(status.filename || '—')}</span><span>${new Date(Date.now() + Number(status.eta) * 1000).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' })}</span><span>${Math.round(Number(status.progress) || 0)}%</span></div>`).join('');
    return `<div class="tvcc-row head"><span>Orden</span><span>Máquina</span><span>Trabajo</span><span>Disponible</span><span>Avance</span></div>${body || '<div class="tvcc-card"><h3>No hay ETA confiable</h3><p>Las máquinas no están imprimiendo o su telemetría está atrasada.</p></div>'}`;
  }

  function deliveriesPage(data) {
    const list = data.deliveries.slice().sort((a, b) => String(a.fields['Fecha entrega']).localeCompare(String(b.fields['Fecha entrega']))).slice(0, 12);
    const rows = list.map((order) => {
      const fields = order.fields || {};
      const remaining = daysUntil(fields['Fecha entrega']);
      const orderState = fields['Estado pedido'] || '';
      const risk = remaining !== null && remaining < 0 ? 'ATRASADO'
        : remaining === 0 && !['Listo', 'Listo para despacho', 'Despachado', 'Completado'].includes(orderState) ? 'CRÍTICO'
          : remaining !== null && remaining <= 2 ? 'PRÓXIMO' : 'OK';
      let client = 'Cliente';
      try { if (typeof resolveClienteName === 'function') client = resolveClienteName(fields.Cliente) || client; } catch (_) {}
      const color = risk === 'OK' ? '#22c55e' : risk === 'PRÓXIMO' ? '#f59e0b' : '#ef4444';
      return `<div class="tvcc-row"><span>${esc(fields['Fecha entrega'] || '—')}</span><strong>${esc(fields['N° Pedido'] || '—')}</strong><span>${esc(client)}</span><span>${esc(orderState || '—')}</span><b style="color:${color}">${risk}</b></div>`;
    }).join('');
    return `<div class="tvcc-row head"><span>Fecha</span><span>Pedido</span><span>Cliente</span><span>Estado</span><span>Riesgo</span></div>${rows || '<div class="tvcc-card"><h3>Sin entregas programadas</h3></div>'}`;
  }

  function capacityPage(data) {
    const buckets = {};
    for (const order of data.deliveries) {
      const fields = order.fields || {};
      const date = fields['Fecha entrega'];
      if (!date) continue;
      const hours = Number(fields['Horas estimadas'] || fields['Tiempo estimado'] || 0);
      if (!Number.isFinite(hours) || hours <= 0) continue;
      buckets[date] = (buckets[date] || 0) + hours;
    }
    const capacity = Math.max(8, data.fleet.length * 24);
    const cards = Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b)).slice(0, 8).map(([date, hours]) => {
      const percent = Math.round((hours / capacity) * 100);
      const color = percent > 100 ? '#ef4444' : percent > 80 ? '#f59e0b' : '#22c55e';
      return `<article class="tvcc-card" style="--c:${color}"><h3>${esc(date)}</h3><p><strong>${esc(hours)}h</strong> declaradas · ${percent}% de capacidad teórica</p>${progress(percent, color)}<p>${percent > 100 ? 'Mover trabajos o ajustar una entrega.' : percent > 80 ? 'Día con poca holgura.' : 'Capacidad declarada disponible.'}</p></article>`;
    }).join('');
    return `<div class="tvcc-grid">${cards || '<article class="tvcc-card"><h3>Sin horas estimadas</h3><p>Agrega horas a los pedidos para proyectar capacidad.</p></article>'}</div>`;
  }

  function teamPage(data) {
    const people = {};
    for (const order of data.activeOrders) {
      const fields = order.fields || {};
      const raw = fields['Equipo asignado'] || fields.Responsable || 'Sin responsable';
      for (let name of String(raw).split(',')) {
        name = name.trim() || 'Sin responsable';
        people[name] = (people[name] || 0) + 1;
      }
    }
    const cards = Object.entries(people).sort((a, b) => b[1] - a[1]).map(([name, count]) => `<article class="tvcc-card" style="--c:${count > 5 ? '#f59e0b' : '#20d9dc'}"><h3>${esc(name)}</h3><p><strong>${count}</strong> pedidos activos</p><p>${count > 5 ? 'Carga alta: revisar prioridades.' : 'Carga dentro del umbral visual.'}</p></article>`).join('');
    return `<div class="tvcc-grid">${cards || '<article class="tvcc-card"><h3>Sin responsables asignados</h3></article>'}</div>`;
  }

  function alertsPage(data) {
    return data.critical.map((alert) => `<article class="tvcc-alert ${alert.severity === 3 ? 'tvcc-critical' : ''}"><h3>${esc(alert.title)}</h3><p>${esc(alert.detail)}</p></article>`).join('') || '<article class="tvcc-card" style="--c:#22c55e"><h3>Sin alertas críticas</h3><p>La operación no presenta bloqueos urgentes con los datos disponibles.</p></article>';
  }

  function resultsPage(data) {
    const completed = orders().filter((order) => ['Despachado', 'Completado'].includes(order.fields?.['Estado pedido'] || '')).length;
    const readyToday = data.dueToday.filter((order) => ['Listo', 'Listo para despacho', 'Despachado', 'Completado'].includes(order.fields?.['Estado pedido'] || '')).length;
    const utilization = data.fleet.length ? Math.round((data.printing / data.fleet.length) * 100) : 0;
    return `<div class="tvcc-grid"><article class="tvcc-card" style="--c:#22c55e"><h3>Pedidos finalizados</h3><p><strong>${completed}</strong> en los datos cargados.</p></article><article class="tvcc-card" style="--c:#20d9dc"><h3>Utilización en vivo</h3><p><strong>${utilization}%</strong> de la flota con impresión y telemetría reciente.</p></article><article class="tvcc-card" style="--c:#a78bfa"><h3>Cumplimiento de hoy</h3><p><strong>${readyToday}/${data.dueToday.length}</strong> entregas de hoy listas.</p></article></div>`;
  }

  const PAGES = {
    resumen: ['RESUMEN GENERAL', summaryPage],
    produccion: ['PRODUCCIÓN EN VIVO', productionPage],
    libres: ['PRÓXIMAS MÁQUINAS LIBRES', availablePage],
    entregas: ['ENTREGAS Y COMPROMISOS', deliveriesPage],
    capacidad: ['CAPACIDAD DECLARADA', capacityPage],
    equipo: ['EQUIPO Y RESPONSABLES', teamPage],
    alertas: ['ALERTAS OPERACIONALES', alertsPage],
    resultados: ['RESULTADOS OPERACIONALES', resultsPage],
  };

  function footer(data) {
    const health = serviceHealth(data);
    const night = (() => {
      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', hour12: false }).format(new Date()));
      return hour < 8 || hour >= 20;
    })();
    return `<footer class="tvcc-foot"><div class="tvcc-conn"><span class="tvcc-pill ${health.airtable.css}">${esc(health.airtable.label)}</span><span class="tvcc-pill ${health.bridge.css}">${esc(health.bridge.label)}</span><span class="tvcc-pill ${health.internet.css}">${esc(health.internet.label)}</span></div>${night ? '<span class="tvcc-night">☾ MODO NOCTURNO</span>' : ''}<span>Rota automáticamente · Escape o doble clic para salir</span><div class="tvcc-dots">${PAGE_ORDER.map((key) => `<button type="button" class="tvcc-dot ${key === page ? 'on' : ''}" data-tvcc-page="${key}" aria-label="Ir a ${esc(PAGES[key][0])}"></button>`).join('')}</div></footer>`;
  }

  function tickClock() {
    const clock = document.getElementById('tvccClock');
    const date = document.getElementById('tvccDate');
    const now = new Date();
    if (clock) clock.textContent = now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Santiago' });
    if (date) date.textContent = now.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).toUpperCase();
  }

  function render({ allowInterrupt = true } = {}) {
    const root = document.getElementById(ID);
    if (!root) return;
    const data = collectData();
    const critical = data.critical.find((alert) => alert.severity === 3);
    const signature = critical ? `${critical.title}|${critical.detail}` : '';
    if (allowInterrupt && critical && signature !== lastCriticalSignature && page !== 'alertas') {
      lastCriticalSignature = signature;
      setPage('alertas');
      return;
    }
    if (!critical) lastCriticalSignature = '';

    const [title, renderer] = PAGES[page] || PAGES.resumen;
    root.innerHTML = `${header(title)}${strip(data)}<main class="tvcc-main">${renderer(data)}</main>${footer(data)}`;
    root.querySelectorAll('[data-tvcc-page]').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.tvccPage)));
    tickClock();
  }

  function clearTimers() {
    clearTimeout(rotationTimer);
    clearInterval(refreshTimer);
    clearInterval(clockTimer);
    rotationTimer = null;
    refreshTimer = null;
    clockTimer = null;
  }

  function scheduleRotation() {
    clearTimeout(rotationTimer);
    rotationTimer = setTimeout(() => next(), ROTATE_MS[page] || 16000);
  }

  function setPage(nextPage) {
    if (!PAGES[nextPage]) return;
    page = nextPage;
    render({ allowInterrupt: false });
    scheduleRotation();
  }

  function next() {
    const index = PAGE_ORDER.indexOf(page);
    setPage(PAGE_ORDER[(index + 1) % PAGE_ORDER.length]);
  }

  function previous() {
    const index = PAGE_ORDER.indexOf(page);
    setPage(PAGE_ORDER[(index - 1 + PAGE_ORDER.length) % PAGE_ORDER.length]);
  }

  function open(options = {}) {
    manualOpen = options.manual !== false;
    ensureStyle();
    let root = document.getElementById(ID);
    if (!root) {
      root = document.createElement('section');
      root.id = ID;
      root.setAttribute('role', 'application');
      root.setAttribute('aria-label', 'Centro de mando operacional');
      root.addEventListener('dblclick', () => close({ exitFullscreen: true }));
      document.body.appendChild(root);
    }
    clearTimers();
    render();
    scheduleRotation();
    refreshTimer = setInterval(() => render(), 30000);
    clockTimer = setInterval(tickClock, 1000);
    if (!unsubscribeTelemetry && window.PrinterTelemetry?.subscribe) {
      unsubscribeTelemetry = window.PrinterTelemetry.subscribe(() => {
        if (document.getElementById(ID)) render();
      });
    }
    return root;
  }

  function close({ exitFullscreen = false } = {}) {
    manualOpen = false;
    clearTimers();
    document.getElementById(ID)?.remove();
    if (exitFullscreen && document.fullscreenElement) document.exitFullscreen?.().catch?.(() => {});
  }

  function syncContext() {
    const active = isTvContext();
    const exists = Boolean(document.getElementById(ID));
    if (active && !exists) open({ manual: false });
    else if (!active && exists && !manualOpen) close();
  }

  document.addEventListener('fullscreenchange', syncContext);
  document.addEventListener('keydown', (event) => {
    if (!document.getElementById(ID)) return;
    if (event.key === 'Escape') close({ exitFullscreen: true });
    else if (event.key === 'ArrowRight') next();
    else if (event.key === 'ArrowLeft') previous();
  });
  window.addEventListener('online', () => render());
  window.addEventListener('offline', () => render());

  function start() {
    syncContext();
    contextTimer = setInterval(syncContext, 2000);
  }

  window.TVControlCenter = Object.freeze({ open, close, next, previous, go: setPage, refresh: render, isOpen: () => Boolean(document.getElementById(ID)) });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
