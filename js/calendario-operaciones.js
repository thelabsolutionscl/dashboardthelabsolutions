/* js/calendario-operaciones.js — planificación operacional compartida y resiliente. */
(function () {
  'use strict';
  if (window.CalOps) return;

  const LOCAL_KEY = 'thelab_cal_ops_v3';
  const LEGACY_KEY = 'thelab_cal_ops_v2';
  const REMOTE_KEY = 'cal-ops';
  const CHANNEL_NAME = 'thelab-cal-ops-v3';
  const SCHEMA_VERSION = 3;
  const SYNC_DELAY_MS = 900;
  const POLL_MS = 60 * 1000;
  const DEFAULTS = {
    buffers: { impresion3d: 15, urgente: 25, nuevo: 30, instalacion: 1, externo: 2 },
    dailyHours: 24,
    workdayHours: 8,
    planningHorizonDays: 60,
  };
  const STAGES = ['Diseño', 'Aprobación', 'Materiales', 'Impresión', 'Postproducción', 'QA', 'Embalaje', 'Despacho'];
  const BLOCKERS = ['Falta aprobación', 'Falta material', 'Archivo incorrecto', 'Máquina en mantenimiento', 'Cliente no responde', 'Falta información', 'Problema con proveedor'];
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null;

  let store = null;
  let remoteEtag = '';
  let syncTimer = null;
  let syncInFlight = false;
  let lastSyncAt = 0;
  let lastSyncError = '';
  let renderTimer = null;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);

  function clone(value) {
    try { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
    catch (_) { return null; }
  }

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

  function validISODate(value) {
    const text = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
    const date = new Date(`${text}T12:00:00`);
    return Number.isNaN(date.getTime()) ? '' : text;
  }

  function days(value) {
    const date = validISODate(value);
    if (!date) return null;
    if (window.TheLabTime?.daysBetween) return window.TheLabTime.daysBetween(localToday(), date);
    try {
      if (typeof _calDays === 'function') return _calDays(date);
    } catch (_) {}
    return Math.round((new Date(`${date}T12:00:00`) - new Date(`${localToday()}T12:00:00`)) / 86400000);
  }

  function dateAdd(value, amount) {
    const base = validISODate(value) || localToday();
    const date = new Date(`${base}T12:00:00`);
    date.setDate(date.getDate() + Number(amount || 0));
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function maxDate(a, b) {
    const left = validISODate(a) || localToday();
    const right = validISODate(b) || localToday();
    return left >= right ? left : right;
  }

  function emptyStore() {
    return {
      schemaVersion: SCHEMA_VERSION,
      records: {},
      history: [],
      settings: clone(DEFAULTS),
      settingsUpdatedAt: 0,
      recurrences: {},
      updatedAt: Date.now(),
    };
  }

  function normalizeRecord(record) {
    const value = record && typeof record === 'object' ? record : {};
    return {
      ...value,
      estimatedHours: Math.max(0, Number(value.estimatedHours || 0)),
      stage: STAGES.includes(value.stage) ? value.stage : (value.stage || 'Diseño'),
      doneStages: Array.isArray(value.doneStages) ? [...new Set(value.doneStages.filter((stage) => STAGES.includes(stage)))] : [],
      blocker: value.blocker || '',
      confirmed: Boolean(value.confirmed),
      updatedAt: Number(value.updatedAt || 0),
    };
  }

  function normalizeRecurrence(rule, id) {
    const value = rule && typeof rule === 'object' ? rule : {};
    const frequency = ['daily', 'weekly', 'monthly'].includes(value.frequency) ? value.frequency : 'weekly';
    return {
      id: value.id || id,
      title: String(value.title || 'Tarea recurrente').slice(0, 180),
      startDate: validISODate(value.startDate) || localToday(),
      until: validISODate(value.until) || dateAdd(localToday(), 90),
      frequency,
      interval: Math.max(1, Math.min(30, Number(value.interval || 1))),
      weekdays: Array.isArray(value.weekdays) ? value.weekdays.map(Number).filter((day) => day >= 0 && day <= 6) : [],
      person: String(value.person || '').slice(0, 120),
      estimatedHours: Math.max(0, Number(value.estimatedHours || 0)),
      active: value.active !== false,
      updatedAt: Number(value.updatedAt || Date.now()),
      createdAt: Number(value.createdAt || Date.now()),
    };
  }

  function normalizeStore(value) {
    const base = emptyStore();
    const raw = value && typeof value === 'object' ? value : {};
    base.records = Object.fromEntries(Object.entries(raw.records || {}).map(([id, record]) => [id, normalizeRecord(record)]));
    base.history = Array.isArray(raw.history) ? raw.history.filter(Boolean).slice(0, 1000) : [];
    base.settings = { ...DEFAULTS, ...(raw.settings || {}), buffers: { ...DEFAULTS.buffers, ...(raw.settings?.buffers || {}) } };
    base.settingsUpdatedAt = Number(raw.settingsUpdatedAt || 0);
    base.recurrences = Object.fromEntries(Object.entries(raw.recurrences || {}).map(([id, rule]) => [id, normalizeRecurrence(rule, id)]));
    base.updatedAt = Number(raw.updatedAt || Date.now());
    return base;
  }

  function loadLocal() {
    if (store) return store;
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
      if (!raw) raw = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
    } catch (_) {}
    store = normalizeStore(raw);
    persistLocal({ broadcast: false });
    return store;
  }

  function persistLocal({ broadcast = true } = {}) {
    if (!store) return;
    store.schemaVersion = SCHEMA_VERSION;
    store.updatedAt = Date.now();
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(store)); } catch (error) { console.warn('[CalOps] localStorage', error); }
    if (broadcast) channel?.postMessage({ type: 'store', value: clone(store), at: Date.now() });
  }

  function mergeStores(localValue, remoteValue) {
    const local = normalizeStore(localValue);
    const remote = normalizeStore(remoteValue);
    const merged = emptyStore();
    for (const id of new Set([...Object.keys(remote.records), ...Object.keys(local.records)])) {
      const a = remote.records[id];
      const b = local.records[id];
      merged.records[id] = !a ? b : !b ? a : Number(b.updatedAt || 0) >= Number(a.updatedAt || 0) ? b : a;
    }
    for (const id of new Set([...Object.keys(remote.recurrences), ...Object.keys(local.recurrences)])) {
      const a = remote.recurrences[id];
      const b = local.recurrences[id];
      merged.recurrences[id] = !a ? b : !b ? a : Number(b.updatedAt || 0) >= Number(a.updatedAt || 0) ? b : a;
    }
    const historyMap = new Map();
    for (const item of [...remote.history, ...local.history]) {
      const key = item.eventId || `${item.id || ''}|${item.at || ''}|${item.reason || ''}|${item.by || ''}`;
      if (!historyMap.has(key)) historyMap.set(key, item);
    }
    merged.history = [...historyMap.values()].sort((a, b) => Number(b.at || 0) - Number(a.at || 0)).slice(0, 1000);
    if (local.settingsUpdatedAt >= remote.settingsUpdatedAt) {
      merged.settings = clone(local.settings);
      merged.settingsUpdatedAt = local.settingsUpdatedAt;
    } else {
      merged.settings = clone(remote.settings);
      merged.settingsUpdatedAt = remote.settingsUpdatedAt;
    }
    merged.updatedAt = Math.max(local.updatedAt, remote.updatedAt, Date.now());
    return normalizeStore(merged);
  }

  function syncStatus() {
    return { syncing: syncInFlight, lastSyncAt, lastSyncError, etag: remoteEtag, remote: Boolean(window.DashboardGateway?.getBase?.()) };
  }

  async function pullRemote() {
    const gateway = window.DashboardGateway;
    if (!gateway?.state || !gateway.getBase?.()) return false;
    syncInFlight = true;
    refresh();
    try {
      const result = await gateway.state.get(REMOTE_KEY);
      remoteEtag = result.etag || remoteEtag;
      if (result.data) {
        store = mergeStores(loadLocal(), result.data);
        persistLocal();
      }
      lastSyncAt = Date.now();
      lastSyncError = '';
      refresh();
      return true;
    } catch (error) {
      lastSyncError = error.message || 'No se pudo sincronizar';
      refresh();
      return false;
    } finally {
      syncInFlight = false;
    }
  }

  async function pushRemote() {
    clearTimeout(syncTimer);
    const gateway = window.DashboardGateway;
    if (!gateway?.state || !gateway.getBase?.()) return false;
    syncInFlight = true;
    refresh();
    try {
      const result = await gateway.state.put(REMOTE_KEY, loadLocal(), remoteEtag || '*');
      remoteEtag = result.etag || remoteEtag;
      lastSyncAt = Date.now();
      lastSyncError = '';
      refresh();
      return true;
    } catch (error) {
      if (error.status === 409) {
        await pullRemote();
        try {
          const retry = await gateway.state.put(REMOTE_KEY, loadLocal(), remoteEtag || '*');
          remoteEtag = retry.etag || remoteEtag;
          lastSyncAt = Date.now();
          lastSyncError = '';
          return true;
        } catch (retryError) {
          lastSyncError = retryError.message;
        }
      } else {
        lastSyncError = error.message || 'No se pudo guardar en el servidor';
      }
      refresh();
      return false;
    } finally {
      syncInFlight = false;
    }
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushRemote, SYNC_DELAY_MS);
  }

  function currentUser() {
    try { return AUTH.getUser?.().name || AUTH.getUser?.().username || 'Usuario'; } catch (_) { return 'Usuario'; }
  }

  function historyEntry(id, before, after, reason) {
    return {
      eventId: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      id,
      at: Date.now(),
      by: currentUser(),
      reason: reason || 'Actualización operacional',
      before: clone(before),
      after: clone(after),
    };
  }

  function setRecord(id, patch, reason) {
    const state = loadLocal();
    const before = normalizeRecord(state.records[id]);
    const after = normalizeRecord({ ...before, ...patch, updatedAt: Date.now() });
    state.records[id] = after;
    state.history.unshift(historyEntry(id, before, after, reason));
    state.history = state.history.slice(0, 1000);
    persistLocal();
    scheduleSync();
    refresh();
    return after;
  }

  function crmEvents() {
    try { return typeof _calCrmEvents === 'function' ? (_calCrmEvents() || []) : []; } catch (_) { return []; }
  }

  function recurrenceMatches(rule, date) {
    const start = new Date(`${rule.startDate}T12:00:00`);
    const current = new Date(`${date}T12:00:00`);
    const elapsedDays = Math.round((current - start) / 86400000);
    if (elapsedDays < 0 || date > rule.until) return false;
    if (rule.frequency === 'daily') return elapsedDays % rule.interval === 0;
    if (rule.frequency === 'weekly') {
      const weeks = Math.floor(elapsedDays / 7);
      const allowedDays = rule.weekdays.length ? rule.weekdays : [start.getDay()];
      return weeks % rule.interval === 0 && allowedDays.includes(current.getDay());
    }
    const months = (current.getFullYear() - start.getFullYear()) * 12 + current.getMonth() - start.getMonth();
    return months >= 0 && months % rule.interval === 0 && current.getDate() === start.getDate();
  }

  function recurrenceEvents() {
    const horizon = Math.max(7, Number(loadLocal().settings.planningHorizonDays || 60));
    const result = [];
    for (const rule of Object.values(loadLocal().recurrences)) {
      if (!rule.active) continue;
      for (let offset = Math.max(0, days(rule.startDate) || 0); offset <= horizon; offset += 1) {
        const date = dateAdd(localToday(), offset);
        if (date > rule.until) break;
        if (!recurrenceMatches(rule, date)) continue;
        result.push({
          id: `recurrence:${rule.id}:${date}`,
          recordId: `recurrence:${rule.id}`,
          type: 'recurring_task',
          fecha: date,
          titulo: rule.title,
          client: 'Tarea recurrente',
          personas: rule.person ? [rule.person] : [],
          recurrenceId: rule.id,
          estimatedHours: rule.estimatedHours,
        });
      }
    }
    return result;
  }

  function events() {
    return [...crmEvents(), ...recurrenceEvents()];
  }

  function byId(id) {
    return events().find((event) => event.id === id);
  }

  function rec(event) {
    if (event?.recurrenceId) {
      const rule = loadLocal().recurrences[event.recurrenceId];
      return normalizeRecord({ stage: 'Diseño', estimatedHours: rule?.estimatedHours || 0, confirmed: true, updatedAt: rule?.updatedAt || 0 });
    }
    return normalizeRecord(loadLocal().records[event?.recordId]);
  }

  function hoursFor(event) {
    const record = rec(event);
    const fromFields = Number(event?.fields?.['Horas estimadas'] || event?.fields?.['Tiempo estimado'] || 0);
    return Math.max(0, Number(record.estimatedHours || event?.estimatedHours || fromFields || 0));
  }

  function deliveryEvents() {
    return events().filter((event) => event.type === 'ped_delivery' || event.type === 'recurring_task');
  }

  function dailyBooked(excludeRecordId = '') {
    const map = {};
    for (const event of deliveryEvents()) {
      if (excludeRecordId && event.recordId === excludeRecordId) continue;
      const date = validISODate(event.fecha);
      if (!date) continue;
      map[date] = (map[date] || 0) + hoursFor(event);
    }
    return map;
  }

  function availableHoursUntil(targetDate, excludeRecordId = '') {
    const endOffset = Math.max(0, days(targetDate) || 0);
    const limit = Math.max(1, Number(loadLocal().settings.dailyHours || 24));
    const booked = dailyBooked(excludeRecordId);
    let available = 0;
    for (let offset = 0; offset <= endOffset; offset += 1) {
      const date = dateAdd(localToday(), offset);
      available += Math.max(0, limit - Number(booked[date] || 0));
    }
    return available;
  }

  function capacity(event) {
    try {
      if (window.MachineOps?.deadlineCapacityRisk && event.type === 'ped_delivery') {
        const external = window.MachineOps.deadlineCapacityRisk(event.recordId, event.fecha);
        if (external && typeof external === 'object') return external;
      }
    } catch (_) {}
    const requiredHours = hoursFor(event);
    const availableHours = availableHoursUntil(event.fecha, event.recordId);
    const ratio = availableHours > 0 ? requiredHours / availableHours : requiredHours > 0 ? Infinity : 0;
    return {
      status: ratio > 1 ? 'risk' : ratio > 0.75 ? 'warning' : 'ok',
      requiredHours,
      availableHours,
      ratio,
    };
  }

  function health(event) {
    const record = rec(event);
    const remaining = days(event.fecha);
    const cap = capacity(event);
    const stageIndex = STAGES.indexOf(record.stage || 'Diseño');
    if (record.blocker || (remaining !== null && remaining < 0) || cap.status === 'risk') return 'red';
    if (remaining === 0 || cap.status === 'warning' || (remaining !== null && remaining <= 2 && stageIndex < 5)) return 'yellow';
    if (!event.personas?.length || !record.confirmed) return 'unknown';
    return 'green';
  }

  function groupedFocus(limitPerGroup = 6) {
    const all = events().filter((event) => days(event.fecha) !== null);
    const groups = {
      overdue: all.filter((event) => days(event.fecha) < 0).sort((a, b) => days(a.fecha) - days(b.fecha)),
      today: all.filter((event) => days(event.fecha) === 0),
      upcoming: all.filter((event) => days(event.fecha) > 0 && days(event.fecha) <= 7).sort((a, b) => days(a.fecha) - days(b.fecha)),
    };
    return Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.slice(0, limitPerGroup)]));
  }

  function metrics() {
    const all = events();
    const state = loadLocal();
    return [
      { value: all.length, label: 'Compromisos activos' },
      { value: all.filter((event) => health(event) === 'red').length, label: 'Riesgo crítico' },
      { value: all.filter((event) => rec(event).blocker).length, label: 'Bloqueados' },
      { value: all.filter((event) => days(event.fecha) < 0).length, label: 'Atrasados' },
      { value: all.filter((event) => rec(event).confirmed).length, label: 'Confirmados' },
      { value: state.history.filter((item) => String(item.reason || '').toLowerCase().includes('reprogram')).length, label: 'Reprogramaciones' },
    ];
  }

  function ensureStyle() {
    if (document.getElementById('calOpsStyle')) return;
    const style = document.createElement('style');
    style.id = 'calOpsStyle';
    style.textContent = `
.cal-ops{display:grid;gap:12px;margin:12px 0}.cal-ops-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.cal-ops-sync{margin-left:auto;font-size:12px;color:var(--text3)}.cal-ops-sync.ok{color:var(--accent3)}.cal-ops-sync.bad{color:var(--danger)}
.cal-ops-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px}.cal-ops-card{border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:12px}.cal-health{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}.cal-health.green{background:#22c55e}.cal-health.yellow{background:#f59e0b}.cal-health.red{background:#ef4444}.cal-health.unknown{background:#64748b}
.cal-load{height:8px;background:var(--surface2);border-radius:999px;overflow:hidden}.cal-load>i{display:block;height:100%;background:var(--accent);width:var(--w)}.cal-load.over>i{background:var(--danger)}.cal-ops-list{display:grid;gap:7px}.cal-ops-row{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;padding:8px;border:1px solid var(--border);border-radius:9px}.cal-ops-row small{display:block;color:var(--text3)}
.cal-modal-ops{position:fixed;inset:0;background:#0009;z-index:100300;display:flex;align-items:center;justify-content:center;padding:16px}.cal-modal-ops>div{background:var(--surface);width:min(720px,100%);max-height:90vh;overflow:auto;border-radius:14px;padding:18px}.cal-stage{display:flex;flex-wrap:wrap;gap:5px}.cal-stage button.on{background:var(--accent);color:#001018}.cal-resource-table{width:100%;border-collapse:collapse;font-size:12px}.cal-resource-table td,.cal-resource-table th{padding:7px;border-bottom:1px solid var(--border);text-align:left}.cal-focus-title{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin:10px 0 5px}
@media(max-width:700px){.cal-ops-row{grid-template-columns:auto 1fr}.cal-ops-row>button{grid-column:2}.cal-ops-sync{width:100%;margin-left:0}}
`;
    document.head.appendChild(style);
  }

  function capacityHtml() {
    const booked = dailyBooked();
    const dates = Object.keys(booked).filter((date) => days(date) >= 0).sort().slice(0, 14);
    const limit = Math.max(1, Number(loadLocal().settings.dailyHours || 24));
    if (!dates.length) return '<p class="muted">Agrega horas estimadas a los pedidos para calcular carga.</p>';
    return dates.map((date) => {
      const value = booked[date];
      const percent = Math.round((value / limit) * 100);
      return `<div style="margin:7px 0"><div style="display:flex;justify-content:space-between"><small>${esc(date)}</small><b>${value}h · ${percent}%</b></div><div class="cal-load ${percent > 100 ? 'over' : ''}" style="--w:${Math.min(100, percent)}%"><i></i></div></div>`;
    }).join('');
  }

  function focusRow(event) {
    const record = rec(event);
    return `<div class="cal-ops-row"><i class="cal-health ${health(event)}"></i><div><b>${esc(event.titulo)}</b><small>${esc(event.client || '')} · ${esc(event.fecha)} · ${esc(record.stage || 'Sin etapa')} ${record.blocker ? `· ⛔ ${esc(record.blocker)}` : ''}</small></div><button class="btn btn-ghost btn-sm" onclick="CalOps.open('${esc(event.id)}')">Gestionar</button></div>`;
  }

  function focusHtml() {
    const groups = groupedFocus();
    const sections = [['overdue', 'Atrasadas'], ['today', 'Hoy'], ['upcoming', 'Próximos 7 días']];
    return sections.map(([key, title]) => groups[key].length ? `<div class="cal-focus-title">${title}</div>${groups[key].map(focusRow).join('')}` : '').join('') || '<p class="muted">Sin compromisos próximos.</p>';
  }

  function syncLabel() {
    const status = syncStatus();
    if (!status.remote) return '<span class="cal-ops-sync">Solo este equipo · configura el gateway para sincronizar</span>';
    if (status.syncing) return '<span class="cal-ops-sync">Sincronizando…</span>';
    if (status.lastSyncError) return `<button class="btn btn-ghost btn-sm cal-ops-sync bad" onclick="CalOps.syncNow()">⚠ ${esc(status.lastSyncError)} · reintentar</button>`;
    if (status.lastSyncAt) return `<span class="cal-ops-sync ok">✓ Sincronizado ${new Date(status.lastSyncAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' })}</span>`;
    return '<button class="btn btn-ghost btn-sm cal-ops-sync" onclick="CalOps.syncNow()">Sincronizar ahora</button>';
  }

  function render() {
    ensureStyle();
    const tab = document.getElementById('tab-calendario');
    if (!tab) return;
    let root = document.getElementById('calOpsRoot');
    if (!root) {
      root = document.createElement('section');
      root.id = 'calOpsRoot';
      root.className = 'cal-ops';
      const anchor = document.getElementById('calKpis') || tab.firstElementChild;
      anchor?.parentNode?.insertBefore(root, anchor?.nextSibling || null);
    }
    root.innerHTML = `<div class="cal-ops-toolbar"><button class="btn btn-primary btn-sm" onclick="CalOps.startDay()">▶ Iniciar jornada</button><button class="btn btn-ghost btn-sm" onclick="CalOps.resources()">▦ Recursos</button><button class="btn btn-ghost btn-sm" onclick="CalOps.simulate()">⚗ Simular pedido</button><button class="btn btn-ghost btn-sm" onclick="CalOps.replan()">↻ Replanificar</button><button class="btn btn-ghost btn-sm" onclick="CalOps.recurring()">⟳ Tareas recurrentes</button><button class="btn btn-ghost btn-sm" onclick="CalOps.history()">◷ Historial</button><button class="btn btn-ghost btn-sm" onclick="CalOps.tv()">▣ Modo TV</button>${syncLabel()}</div><div class="cal-ops-grid">${metrics().map((metric) => `<div class="cal-ops-card"><b style="font-size:24px">${metric.value}</b><small style="display:block;color:var(--text3)">${metric.label}</small></div>`).join('')}</div><div class="cal-ops-grid"><article class="cal-ops-card"><h3>Carga diaria de producción</h3>${capacityHtml()}</article><article class="cal-ops-card"><h3>Semáforo operacional</h3><div class="cal-ops-list">${focusHtml()}</div></article></div>`;
  }

  function refresh() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { try { render(); } catch (error) { console.warn('[CalOps] render', error); } }, 30);
  }

  function modal(html) {
    const element = document.createElement('div');
    element.className = 'cal-modal-ops';
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-modal', 'true');
    element.innerHTML = `<div>${html}<div style="margin-top:14px;text-align:right"><button class="btn btn-ghost" data-close-cal-ops>Cerrar</button></div></div>`;
    element.querySelector('[data-close-cal-ops]')?.addEventListener('click', () => element.remove());
    element.addEventListener('click', (event) => { if (event.target === element) element.remove(); });
    document.body.appendChild(element);
    element.querySelector('button,input,select,textarea')?.focus();
    return element;
  }

  function open(id) {
    const event = byId(id);
    if (!event) return;
    if (event.recurrenceId) { editRecurrence(event.recurrenceId); return; }
    const record = rec(event);
    const cap = capacity(event);
    modal(`<h2><i class="cal-health ${health(event)}"></i>${esc(event.titulo)}</h2><p>${esc(event.client || '')} · entrega ${esc(event.fecha)}</p><label>Horas estimadas<input id="coHours" type="number" min="0" step=".5" value="${record.estimatedHours || ''}" class="form-control"></label><label>Bloqueador<select id="coBlock" class="form-control"><option value="">Sin bloqueo</option>${BLOCKERS.map((blocker) => `<option value="${esc(blocker)}" ${record.blocker === blocker ? 'selected' : ''}>${esc(blocker)}</option>`).join('')}</select></label><label><input id="coConfirm" type="checkbox" ${record.confirmed ? 'checked' : ''}> Responsable confirmó el compromiso</label><h3>Etapa y dependencias</h3><div class="cal-stage">${STAGES.map((stageName) => `<button class="btn btn-ghost btn-sm ${record.stage === stageName ? 'on' : ''}" onclick="CalOps.stage('${esc(event.recordId)}','${esc(stageName)}')">${esc(stageName)}</button>`).join('')}</div><p>Capacidad: <b>${esc(cap.status)}</b> · ${cap.requiredHours || 0}h requeridas / ${Math.round(cap.availableHours || 0)}h disponibles</p><button class="btn btn-primary" onclick="CalOps.saveOpen('${esc(event.recordId)}')">Guardar control operacional</button> <button class="btn btn-ghost" onclick="CalOps.clientMessage('${esc(event.id)}')">Preparar aviso al cliente</button>`);
  }

  function saveOpen(id) {
    setRecord(id, { estimatedHours: Number(document.getElementById('coHours')?.value || 0), blocker: document.getElementById('coBlock')?.value || '', confirmed: Boolean(document.getElementById('coConfirm')?.checked) }, 'Control operacional actualizado');
    document.querySelector('.cal-modal-ops')?.remove();
  }

  function stage(id, stageName) {
    const record = normalizeRecord(loadLocal().records[id]);
    const index = STAGES.indexOf(stageName);
    if (index < 0) return;
    const missing = STAGES.slice(0, index).filter((stageItem) => !record.doneStages.includes(stageItem));
    if (missing.length && !confirm(`Faltan etapas previas: ${missing.join(', ')}. ¿Avanzar igualmente?`)) return;
    setRecord(id, { stage: stageName, doneStages: [...new Set([...record.doneStages, stageName])] }, 'Cambio de etapa');
    document.querySelector('.cal-modal-ops')?.remove();
  }

  function startDay() {
    const groups = groupedFocus(20);
    const rows = [...groups.overdue, ...groups.today, ...groups.upcoming.filter((event) => days(event.fecha) <= 2)];
    modal(`<h2>Agenda operacional de hoy</h2><p>${groups.overdue.length} atrasadas · ${groups.today.length} para hoy · ${rows.filter((event) => days(event.fecha) > 0).length} próximas</p><div class="cal-ops-list">${rows.map(focusRow).join('') || '<p>Sin tareas críticas.</p>'}</div>`);
  }

  function resources() {
    const people = {};
    for (const event of events().filter((item) => item.type?.startsWith('ped_') || item.type === 'recurring_task')) {
      const assigned = event.personas?.length ? event.personas : ['Sin responsable'];
      for (const person of assigned) (people[person] || (people[person] = [])).push(event);
    }
    modal(`<h2>Vista por recursos</h2><table class="cal-resource-table"><thead><tr><th>Recurso</th><th>Trabajos</th><th>Horas</th><th>Riesgos</th></tr></thead><tbody>${Object.entries(people).map(([person, assigned]) => `<tr><td>${esc(person)}</td><td>${assigned.length}</td><td>${assigned.reduce((sum, event) => sum + hoursFor(event), 0)}h</td><td>${assigned.filter((event) => health(event) === 'red').length}</td></tr>`).join('')}</tbody></table><h3>Máquinas</h3><p>${window.MachineOps ? 'Datos de capacidad vinculados con MachineOps.' : 'Capacidad calculada con horas reservadas; conecta MachineOps para restricciones por máquina.'}</p>`);
  }

  function simulate() {
    modal(`<h2>Simular nuevo pedido</h2><label>Horas de producción<input id="simHours" type="number" min="0" step=".5" value="48" class="form-control"></label><label>Fecha propuesta<input id="simDate" type="date" value="${dateAdd(localToday(), 7)}" class="form-control"></label><label><input id="simUrg" type="checkbox"> Urgente</label><button class="btn btn-primary" onclick="CalOps.runSimulation()">Calcular fecha segura</button><div id="simResult"></div>`);
  }

  function safeDateForHours(hours, startDate = localToday()) {
    const required = Math.max(0, Number(hours || 0));
    const dailyLimit = Math.max(1, Number(loadLocal().settings.dailyHours || 24));
    const booked = dailyBooked();
    let remaining = required;
    let date = maxDate(startDate, localToday());
    const maxDays = Math.max(30, Number(loadLocal().settings.planningHorizonDays || 60) * 3);
    for (let step = 0; step < maxDays; step += 1) {
      const free = Math.max(0, dailyLimit - Number(booked[date] || 0));
      remaining -= free;
      if (remaining <= 0) return date;
      date = dateAdd(date, 1);
    }
    return date;
  }

  function runSimulation() {
    const hours = Math.max(0, Number(document.getElementById('simHours')?.value || 0));
    const proposed = validISODate(document.getElementById('simDate')?.value) || localToday();
    const urgent = Boolean(document.getElementById('simUrg')?.checked);
    const buffer = 1 + Number(loadLocal().settings.buffers[urgent ? 'urgente' : 'impresion3d'] || (urgent ? 25 : 15)) / 100;
    const required = Math.ceil(hours * buffer * 10) / 10;
    const safe = safeDateForHours(required, localToday());
    const viable = safe <= proposed;
    const available = availableHoursUntil(proposed);
    const result = document.getElementById('simResult');
    if (result) result.innerHTML = `<div class="cal-ops-card" style="margin-top:10px"><b>${viable ? 'Fecha viable' : 'Fecha riesgosa'}</b><p>Se requieren ${required}h con buffer y hay ${Math.round(available)}h libres hasta la fecha propuesta. Fecha segura sugerida: <b>${safe}</b>.</p></div>`;
    return { hours, required, proposed, safe, viable, available };
  }

  function nextSafeReplan(event) {
    const record = rec(event);
    const required = Math.max(1, Number(record.estimatedHours || hoursFor(event) || 1));
    const start = maxDate(event.fecha, localToday());
    return safeDateForHours(required, start);
  }

  function replan() {
    const risky = events().filter((event) => health(event) === 'red' && event.type !== 'recurring_task');
    modal(`<h2>Replanificación inteligente</h2>${risky.map((event) => { const suggestion = nextSafeReplan(event); return `<div class="cal-ops-row"><i class="cal-health red"></i><div><b>${esc(event.titulo)}</b><small>Actual: ${esc(event.fecha)} · fecha segura: ${esc(suggestion)}</small></div><button class="btn btn-primary btn-sm" onclick="CalOps.applyReplan('${esc(event.id)}','${esc(suggestion)}')">Aplicar</button></div>`; }).join('') || '<p>No hay compromisos críticos para reprogramar.</p>'}`);
  }

  async function applyReplan(id, date) {
    const event = byId(id);
    const safeDate = maxDate(date, localToday());
    if (!event || !validISODate(safeDate)) return;
    try {
      if (typeof calUpdateCrmDate === 'function') await calUpdateCrmDate(event, safeDate);
      else if (typeof window.calUpdateCrmDate === 'function') await window.calUpdateCrmDate(event, safeDate);
      else throw new Error('La integración CRM del calendario no está disponible');
      setRecord(event.recordId, { replannedTo: safeDate }, `Reprogramado de ${event.fecha} a ${safeDate}`);
      document.querySelector('.cal-modal-ops')?.remove();
      try { if (typeof renderCalendario === 'function') renderCalendario(); } catch (_) {}
    } catch (error) {
      if (typeof toast === 'function') toast(error.message || 'No se pudo reprogramar', 'error');
      else alert(error.message || 'No se pudo reprogramar');
    }
  }

  function recurrenceForm(rule = {}) {
    const value = normalizeRecurrence(rule, rule.id || 'new');
    const checkedDays = new Set(value.weekdays);
    return `<input type="hidden" id="recId" value="${esc(rule.id || '')}"><label>Tarea<input id="recTitle" class="form-control" value="${esc(rule.title || '')}" placeholder="Ej. Mantención semanal"></label><label>Responsable<input id="recPerson" class="form-control" value="${esc(rule.person || '')}"></label><div class="cal-ops-grid"><label>Inicio<input id="recStart" type="date" class="form-control" value="${esc(value.startDate)}"></label><label>Hasta<input id="recUntil" type="date" class="form-control" value="${esc(value.until)}"></label><label>Frecuencia<select id="recFrequency" class="form-control"><option value="daily" ${value.frequency === 'daily' ? 'selected' : ''}>Diaria</option><option value="weekly" ${value.frequency === 'weekly' ? 'selected' : ''}>Semanal</option><option value="monthly" ${value.frequency === 'monthly' ? 'selected' : ''}>Mensual</option></select></label><label>Intervalo<input id="recInterval" type="number" min="1" max="30" class="form-control" value="${value.interval}"></label><label>Horas<input id="recHours" type="number" min="0" step=".5" class="form-control" value="${value.estimatedHours || ''}"></label></div><fieldset><legend>Días semanales</legend>${['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map((label, index) => `<label style="margin-right:8px"><input type="checkbox" name="recWeekday" value="${index}" ${checkedDays.has(index) ? 'checked' : ''}> ${label}</label>`).join('')}</fieldset><label><input id="recActive" type="checkbox" ${value.active ? 'checked' : ''}> Activa</label><button class="btn btn-primary" onclick="CalOps.saveRecurring()">Guardar recurrencia</button>${rule.id ? ' <button class="btn btn-danger" onclick="CalOps.deleteRecurrence()">Eliminar</button>' : ''}`;
  }

  function recurring() {
    const rules = Object.values(loadLocal().recurrences).sort((a, b) => a.title.localeCompare(b.title));
    modal(`<h2>Tareas recurrentes</h2><div class="cal-ops-list">${rules.map((rule) => `<div class="cal-ops-row"><i class="cal-health ${rule.active ? 'green' : 'unknown'}"></i><div><b>${esc(rule.title)}</b><small>${esc(rule.frequency)} cada ${rule.interval} · ${esc(rule.startDate)} → ${esc(rule.until)} · ${esc(rule.person || 'Sin responsable')}</small></div><button class="btn btn-ghost btn-sm" onclick="CalOps.editRecurrence('${esc(rule.id)}')">Editar</button></div>`).join('') || '<p>No hay tareas recurrentes.</p>'}</div><hr><h3>Nueva recurrencia</h3>${recurrenceForm()}`);
  }

  function editRecurrence(id) {
    const rule = loadLocal().recurrences[id];
    if (!rule) return;
    modal(`<h2>Editar tarea recurrente</h2>${recurrenceForm(rule)}`);
  }

  function saveRecurring() {
    const id = document.getElementById('recId')?.value || crypto.randomUUID?.() || `rec-${Date.now()}`;
    const before = loadLocal().recurrences[id] || null;
    const rule = normalizeRecurrence({ ...before, id, title: document.getElementById('recTitle')?.value || 'Tarea recurrente', person: document.getElementById('recPerson')?.value || '', startDate: document.getElementById('recStart')?.value, until: document.getElementById('recUntil')?.value, frequency: document.getElementById('recFrequency')?.value, interval: document.getElementById('recInterval')?.value, estimatedHours: document.getElementById('recHours')?.value, weekdays: [...document.querySelectorAll('input[name="recWeekday"]:checked')].map((input) => Number(input.value)), active: Boolean(document.getElementById('recActive')?.checked), updatedAt: Date.now(), createdAt: before?.createdAt || Date.now() }, id);
    loadLocal().recurrences[id] = rule;
    loadLocal().history.unshift(historyEntry(`recurrence:${id}`, before, rule, before ? 'Recurrencia actualizada' : 'Recurrencia creada'));
    persistLocal(); scheduleSync(); document.querySelector('.cal-modal-ops')?.remove(); refresh();
  }

  function deleteRecurrence() {
    const id = document.getElementById('recId')?.value;
    const before = loadLocal().recurrences[id];
    if (!id || !before || !confirm(`¿Eliminar la tarea recurrente “${before.title}”?`)) return;
    delete loadLocal().recurrences[id];
    loadLocal().history.unshift(historyEntry(`recurrence:${id}`, before, null, 'Recurrencia eliminada'));
    persistLocal(); scheduleSync(); document.querySelector('.cal-modal-ops')?.remove(); refresh();
  }

  function tv() { if (window.TVControlCenter?.open) window.TVControlCenter.open({ manual: true }); else if (typeof toast === 'function') toast('Modo TV todavía está cargando', 'warn'); }
  function closeTv() { window.TVControlCenter?.close?.({ exitFullscreen: true }); }

  function clientMessage(id) {
    const event = byId(id); if (!event) return;
    const record = rec(event);
    const message = record.blocker ? `Hola, te contamos que ${event.titulo} presenta el siguiente bloqueo: ${record.blocker}. Estamos trabajando para resolverlo y confirmar una nueva fecha.` : `Hola, confirmamos que ${event.titulo} mantiene entrega para el ${event.fecha}. Estado actual: ${record.stage || 'en revisión'}.`;
    modal(`<h2>Aviso al cliente</h2><textarea id="calClientMessage" class="form-control" rows="7">${esc(message)}</textarea><button class="btn btn-primary" onclick="navigator.clipboard.writeText(document.getElementById('calClientMessage').value); if(window.toast) toast('Mensaje copiado','success')">Copiar mensaje</button>`);
  }

  function history() {
    const rows = loadLocal().history.slice(0, 100);
    modal(`<h2>Historial operacional</h2><div class="cal-ops-list">${rows.map((item) => `<div class="cal-ops-card"><b>${esc(item.reason || 'Actualización')}</b><small style="display:block;color:var(--text3)">${new Date(Number(item.at || 0)).toLocaleString('es-CL', { timeZone: 'America/Santiago' })} · ${esc(item.by || 'Usuario')} · ${esc(item.id || '')}</small></div>`).join('') || '<p>Sin movimientos registrados.</p>'}</div>`);
  }

  function coherenceIssues() {
    const issues = [];
    for (const event of events()) {
      const record = rec(event); const remaining = days(event.fecha);
      if (!event.personas?.length) issues.push({ event, type: 'responsable', message: 'Sin responsable asignado' });
      if (!record.estimatedHours && event.type === 'ped_delivery') issues.push({ event, type: 'horas', message: 'Sin horas estimadas' });
      if (remaining !== null && remaining <= 2 && STAGES.indexOf(record.stage) < 4) issues.push({ event, type: 'etapa', message: 'Fecha próxima y todavía no está en impresión' });
      if (record.blocker && record.confirmed) issues.push({ event, type: 'bloqueo', message: 'Marcado confirmado aunque tiene un bloqueo activo' });
    }
    return issues;
  }

  function suggestions() {
    return events().filter((event) => health(event) === 'red').map((event) => ({ eventId: event.id, currentDate: event.fecha, suggestedDate: nextSafeReplan(event), reason: rec(event).blocker || (days(event.fecha) < 0 ? 'Atrasado' : 'Capacidad insuficiente') }));
  }

  async function syncNow() { await pullRemote(); await pushRemote(); refresh(); return syncStatus(); }

  channel?.addEventListener('message', (event) => {
    if (event.data?.type !== 'store' || !event.data.value) return;
    store = mergeStores(loadLocal(), event.data.value); persistLocal({ broadcast: false }); refresh();
  });

  function start() { loadLocal(); pullRemote(); setInterval(pullRemote, POLL_MS); refresh(); }

  const api = { render, open, saveOpen, stage, startDay, resources, simulate, runSimulation, safeDateForHours, replan, applyReplan, recurring, editRecurrence, saveRecurring, deleteRecurrence, tv, closeTv, clientMessage, history, setRecord, health, capacity, events, groupedFocus, coherenceIssues, suggestions, syncNow, syncStatus, _mergeStores: mergeStores, _dateAdd: dateAdd, _days: days };

  window.CalOps = api;
  const originalRender = window.renderCalendario;
  if (typeof originalRender === 'function' && !originalRender.__calOpsWrapped) {
    const wrapped = function wrappedRenderCalendario(...args) { const result = originalRender.apply(this, args); refresh(); return result; };
    wrapped.__calOpsWrapped = true; window.renderCalendario = wrapped;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
