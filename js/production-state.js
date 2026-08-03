/* Persistencia local + multiusuario de cola de impresión y odómetros. */
(function () {
  'use strict';
  if (window.ProductionState) return;

  const QUEUE_LOCAL_KEY = 'printer_queue_v2';
  const ODO_LOCAL_KEY = 'printer_odometer_v1';
  const QUEUE_REMOTE_KEY = 'print-queue';
  const ODO_REMOTE_KEY = 'printer-odometer';
  const CHANNEL_NAME = 'thelab-production-state-v1';
  const DEVICE_ID_KEY = 'thelab_device_id';
  const SYNC_DELAY_MS = 1200;
  const WATCH_MS = 1500;

  let queueEtag = '';
  let odometerEtag = '';
  let queueTimer = null;
  let odometerTimer = null;
  let lastQueueHash = '';
  let lastOdometerHash = '';
  let syncing = false;
  let lastRemoteError = '';
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null;

  function deviceId() {
    let id = '';
    try { id = localStorage.getItem(DEVICE_ID_KEY) || ''; } catch (_) {}
    if (!id) {
      id = crypto.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      try { localStorage.setItem(DEVICE_ID_KEY, id); } catch (_) {}
    }
    return id;
  }

  function clone(value) {
    try { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
    catch (_) { return null; }
  }

  function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function hash(value) {
    const source = stable(value);
    let result = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      result ^= source.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16);
  }

  function rawQueue() {
    try { return typeof _printQueue !== 'undefined' && _printQueue && typeof _printQueue === 'object' ? _printQueue : null; }
    catch (_) { return null; }
  }

  function rawOdometer() {
    try {
      if (typeof getOdometer === 'function') return getOdometer();
      if (typeof _odo !== 'undefined' && _odo && typeof _odo === 'object') return _odo;
    } catch (_) {}
    try { return JSON.parse(localStorage.getItem(ODO_LOCAL_KEY) || '{}'); } catch (_) { return {}; }
  }

  function jobId(printerId, job, index) {
    if (job.id) return String(job.id);
    const seed = `${printerId}|${job.gcode || ''}|${job.filename || ''}|${job.added || ''}|${index}`;
    return `job-${hash(seed)}`;
  }

  function normalizeQueue(queue, sourceDevice = deviceId()) {
    const result = {};
    if (!queue || typeof queue !== 'object') return result;
    for (const [printerId, jobs] of Object.entries(queue)) {
      if (!Array.isArray(jobs)) continue;
      result[printerId] = jobs.map((job, index) => ({
        ...job,
        id: jobId(printerId, job || {}, index),
        status: job?.status || 'pending',
        added: Number(job?.added || Date.now()),
        updatedAt: Number(job?.updatedAt || job?.added || Date.now()),
        sourceDevice: job?.sourceDevice || sourceDevice,
      })).filter((job) => job.gcode || job.filename);
    }
    return result;
  }

  function normalizeOdometer(value) {
    const result = {};
    if (!value || typeof value !== 'object') return result;
    for (const [printerId, entry] of Object.entries(value)) {
      result[printerId] = {
        hours: Math.max(0, Number(entry?.hours || 0)),
        filamentMm: Math.max(0, Number(entry?.filamentMm || 0)),
        prints: Math.max(0, Number(entry?.prints || 0)),
        updatedAt: Number(entry?.updatedAt || Date.now()),
      };
    }
    return result;
  }

  function queueSnapshot() {
    const queue = rawQueue();
    if (queue) return normalizeQueue(queue);
    try { return normalizeQueue(JSON.parse(localStorage.getItem(QUEUE_LOCAL_KEY) || '{}')); } catch (_) { return {}; }
  }

  function odometerSnapshot() {
    return normalizeOdometer(rawOdometer());
  }

  function replaceObject(target, value) {
    if (!target || typeof target !== 'object') return;
    for (const key of Object.keys(target)) delete target[key];
    for (const [key, entry] of Object.entries(value || {})) target[key] = clone(entry);
  }

  function applyQueue(queue, { broadcast = true } = {}) {
    const normalized = normalizeQueue(queue);
    const target = rawQueue();
    if (target) replaceObject(target, normalized);
    try { localStorage.setItem(QUEUE_LOCAL_KEY, JSON.stringify(normalized)); } catch (_) {}
    lastQueueHash = hash(normalized);
    if (broadcast) channel?.postMessage({ type: 'queue', value: normalized, at: Date.now() });
    try { if (typeof renderMonitorGrid === 'function') renderMonitorGrid(); } catch (_) {}
    window.dispatchEvent(new CustomEvent('thelab:print-queue', { detail: clone(normalized) }));
  }

  function applyOdometer(odometer, { broadcast = true } = {}) {
    const normalized = normalizeOdometer(odometer);
    try {
      if (typeof _odo !== 'undefined') _odo = clone(normalized);
    } catch (_) {}
    try { localStorage.setItem(ODO_LOCAL_KEY, JSON.stringify(normalized)); } catch (_) {}
    lastOdometerHash = hash(normalized);
    if (broadcast) channel?.postMessage({ type: 'odometer', value: normalized, at: Date.now() });
    window.dispatchEvent(new CustomEvent('thelab:printer-odometer', { detail: clone(normalized) }));
  }

  function mergeQueues(local, remote) {
    const merged = {};
    const printers = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
    for (const printerId of printers) {
      const jobs = new Map();
      for (const job of [...(remote?.[printerId] || []), ...(local?.[printerId] || [])]) {
        const normalized = normalizeQueue({ [printerId]: [job] })[printerId]?.[0];
        if (!normalized) continue;
        const previous = jobs.get(normalized.id);
        if (!previous || normalized.updatedAt >= previous.updatedAt) jobs.set(normalized.id, normalized);
      }
      merged[printerId] = [...jobs.values()]
        .filter((job) => !['completed', 'cancelled'].includes(job.status) || Date.now() - job.updatedAt < 7 * 86400000)
        .sort((a, b) => a.added - b.added);
    }
    return merged;
  }

  function mergeOdometers(local, remote) {
    const merged = {};
    for (const printerId of new Set([...Object.keys(local || {}), ...Object.keys(remote || {})])) {
      const a = local?.[printerId] || {};
      const b = remote?.[printerId] || {};
      // Los contadores son acumulativos. Se conserva el máximo para evitar sumar
      // dos veces el mismo trabajo reportado por distintos navegadores.
      merged[printerId] = {
        hours: Math.max(Number(a.hours || 0), Number(b.hours || 0)),
        filamentMm: Math.max(Number(a.filamentMm || 0), Number(b.filamentMm || 0)),
        prints: Math.max(Number(a.prints || 0), Number(b.prints || 0)),
        updatedAt: Math.max(Number(a.updatedAt || 0), Number(b.updatedAt || 0), Date.now()),
      };
    }
    return merged;
  }

  async function pullRemote() {
    const gateway = window.DashboardGateway;
    if (!gateway?.state || !gateway.getBase?.()) return { remote: false };
    syncing = true;
    try {
      const [queueResult, odometerResult] = await Promise.allSettled([
        gateway.state.get(QUEUE_REMOTE_KEY),
        gateway.state.get(ODO_REMOTE_KEY),
      ]);
      if (queueResult.status === 'fulfilled') {
        queueEtag = queueResult.value.etag || '';
        const merged = mergeQueues(queueSnapshot(), queueResult.value.data || {});
        applyQueue(merged);
      }
      if (odometerResult.status === 'fulfilled') {
        odometerEtag = odometerResult.value.etag || '';
        const merged = mergeOdometers(odometerSnapshot(), odometerResult.value.data || {});
        applyOdometer(merged);
      }
      lastRemoteError = '';
      return { remote: true };
    } catch (error) {
      lastRemoteError = error.message;
      return { remote: false, error };
    } finally {
      syncing = false;
    }
  }

  async function pushQueue() {
    clearTimeout(queueTimer);
    const gateway = window.DashboardGateway;
    if (!gateway?.state || !gateway.getBase?.()) return;
    const snapshot = queueSnapshot();
    try {
      const result = await gateway.state.put(QUEUE_REMOTE_KEY, snapshot, queueEtag || '*');
      queueEtag = result.etag || queueEtag;
      lastRemoteError = '';
    } catch (error) {
      if (error.status === 409) {
        await pullRemote();
        const retry = await gateway.state.put(QUEUE_REMOTE_KEY, queueSnapshot(), queueEtag || '*');
        queueEtag = retry.etag || queueEtag;
      } else {
        lastRemoteError = error.message;
      }
    }
  }

  async function pushOdometer() {
    clearTimeout(odometerTimer);
    const gateway = window.DashboardGateway;
    if (!gateway?.state || !gateway.getBase?.()) return;
    const snapshot = odometerSnapshot();
    try {
      const result = await gateway.state.put(ODO_REMOTE_KEY, snapshot, odometerEtag || '*');
      odometerEtag = result.etag || odometerEtag;
      lastRemoteError = '';
    } catch (error) {
      if (error.status === 409) {
        await pullRemote();
        const retry = await gateway.state.put(ODO_REMOTE_KEY, odometerSnapshot(), odometerEtag || '*');
        odometerEtag = retry.etag || odometerEtag;
      } else {
        lastRemoteError = error.message;
      }
    }
  }

  function scheduleQueuePush() {
    clearTimeout(queueTimer);
    queueTimer = setTimeout(pushQueue, SYNC_DELAY_MS);
  }

  function scheduleOdometerPush() {
    clearTimeout(odometerTimer);
    odometerTimer = setTimeout(pushOdometer, SYNC_DELAY_MS);
  }

  function watchChanges() {
    if (syncing) return;
    const queue = queueSnapshot();
    const queueHash = hash(queue);
    if (queueHash !== lastQueueHash) {
      applyQueue(queue);
      scheduleQueuePush();
    }
    const odometer = odometerSnapshot();
    const odometerHash = hash(odometer);
    if (odometerHash !== lastOdometerHash) {
      applyOdometer(odometer);
      scheduleOdometerPush();
    }
  }

  channel?.addEventListener('message', (event) => {
    if (event.data?.type === 'queue') applyQueue(mergeQueues(queueSnapshot(), event.data.value), { broadcast: false });
    else if (event.data?.type === 'odometer') applyOdometer(mergeOdometers(odometerSnapshot(), event.data.value), { broadcast: false });
  });

  function start() {
    let localQueue = {};
    try { localQueue = JSON.parse(localStorage.getItem(QUEUE_LOCAL_KEY) || '{}'); } catch (_) {}
    if (Object.keys(localQueue).length) applyQueue(mergeQueues(queueSnapshot(), localQueue), { broadcast: false });
    else applyQueue(queueSnapshot(), { broadcast: false });
    applyOdometer(odometerSnapshot(), { broadcast: false });
    pullRemote();
    setInterval(watchChanges, WATCH_MS);
    setInterval(pullRemote, 60 * 1000);
  }

  window.ProductionState = Object.freeze({
    start,
    syncNow: async () => { watchChanges(); await Promise.allSettled([pushQueue(), pushOdometer(), pullRemote()]); },
    pullRemote,
    getQueue: () => clone(queueSnapshot()),
    getOdometer: () => clone(odometerSnapshot()),
    status: () => ({ queueEtag, odometerEtag, syncing, lastRemoteError }),
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
