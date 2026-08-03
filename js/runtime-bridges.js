/* APIs de lectura compartidas entre módulos sin publicar objetos mutables globales. */
(function () {
  'use strict';

  function clone(value) {
    if (value == null) return value;
    try {
      if (typeof structuredClone === 'function') return structuredClone(value);
    } catch (_) {}
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
  }

  function rawPrinterStatus() {
    try {
      return typeof _printerStatus !== 'undefined' && _printerStatus && typeof _printerStatus === 'object'
        ? _printerStatus
        : {};
    } catch (_) {
      return {};
    }
  }

  function localISODate(date = new Date(), timeZone = 'America/Santiago') {
    const value = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(value.getTime())) return '';
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(value);
    } catch (_) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  function dateAtNoon(value, timeZone = 'America/Santiago') {
    const iso = typeof value === 'string' ? value.slice(0, 10) : localISODate(value, timeZone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const date = new Date(`${iso}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function daysBetween(from, to, timeZone = 'America/Santiago') {
    const start = dateAtNoon(typeof from === 'undefined' ? localISODate(new Date(), timeZone) : from, timeZone);
    const end = dateAtNoon(to, timeZone);
    if (!start || !end) return null;
    return Math.round((end.getTime() - start.getTime()) / 86400000);
  }

  const telemetrySubscribers = new Set();
  let lastEventAt = 0;

  function notifySubscribers(event) {
    lastEventAt = Date.now();
    for (const subscriber of telemetrySubscribers) {
      try { subscriber(event); } catch (error) { console.warn('[PrinterTelemetry] subscriber', error); }
    }
  }

  document.addEventListener('printerstatus', notifySubscribers);
  document.addEventListener('printer-status', notifySubscribers);

  const existingTelemetry = window.PrinterTelemetry || {};
  window.PrinterTelemetry = Object.freeze({
    ...existingTelemetry,
    get(id) {
      return clone(rawPrinterStatus()[id] || null);
    },
    getAll() {
      return clone(rawPrinterStatus()) || {};
    },
    lastUpdateAt() {
      const states = Object.values(rawPrinterStatus());
      return Math.max(lastEventAt, ...states.map((state) => Number(state?.lastSeenAt || state?.checkedAt || 0)), 0);
    },
    subscribe(callback) {
      if (typeof callback !== 'function') return () => {};
      telemetrySubscribers.add(callback);
      return () => telemetrySubscribers.delete(callback);
    },
  });

  window.TheLabTime = Object.freeze({
    localISODate,
    daysBetween,
    dateAtNoon,
    timeZone: 'America/Santiago',
  });
})();
