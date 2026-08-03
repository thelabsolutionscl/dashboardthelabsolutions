/* Adaptador de Cloudflare Access para el túnel de impresoras. */
(function () {
  'use strict';
  if (window.PrinterAccess) return;

  const nativeFetch = window.fetch.bind(window);
  const NativeWebSocket = window.WebSocket;
  let configuredTunnel = '';
  let fetchPatched = false;
  let websocketPatched = false;

  function lexicalTunnel() {
    try { if (typeof PRINTER_TUNNEL !== 'undefined') return PRINTER_TUNNEL; } catch (_) {}
    return '';
  }

  function cleanBase(value) {
    const raw = String(value || '').trim();
    if (!raw || /^%%.+%%$/.test(raw)) return '';
    try {
      const url = new URL(raw, location.href);
      if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) return '';
      url.pathname = url.pathname.replace(/\/$/, '');
      url.search = '';
      url.hash = '';
      return url.href.replace(/\/$/, '');
    } catch (_) { return ''; }
  }

  function getBase() {
    const candidates = [
      configuredTunnel,
      (() => { try { return typeof getPrinterTunnel === 'function' ? getPrinterTunnel() : ''; } catch (_) { return ''; } })(),
      lexicalTunnel(),
      window.PRINTER_TUNNEL,
      window.CONFIG?.PRINTER_TUNNEL,
      localStorage.getItem('printer_tunnel_url'),
      'https://printers.thelab.solutions',
    ];
    for (const candidate of candidates) {
      const base = cleanBase(candidate);
      if (base) return base;
    }
    return '';
  }

  function configure(value) {
    const base = cleanBase(value);
    if (!base) throw new Error('URL del túnel de impresoras inválida');
    configuredTunnel = base;
    try { localStorage.setItem('printer_tunnel_url', base); } catch (_) {}
    return base;
  }

  function sanitize(value) {
    try {
      const url = new URL(String(value || ''), location.href);
      url.searchParams.delete('bt');
      return url.href;
    } catch (_) { return String(value || ''); }
  }

  function belongs(input) {
    const base = getBase();
    if (!base) return false;
    try {
      const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      const root = new URL(base);
      return target.origin === root.origin && (root.pathname === '/' || target.pathname === root.pathname || target.pathname.startsWith(`${root.pathname.replace(/\/$/, '')}/`));
    } catch (_) { return false; }
  }

  function secureInit(input, init = {}) {
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    // Los tokens antiguos dejan de viajar al bridge. Cloudflare Access autentica
    // mediante una cookie HttpOnly y el gateway asigna permisos por email.
    headers.delete('X-Bridge-Token');
    headers.delete('X-Bridge-Read-Token');
    headers.delete('X-Bridge-Admin-Token');
    return { ...init, headers, credentials: 'include', cache: init.cache || 'no-store', redirect: 'follow' };
  }

  function patchFetch() {
    if (fetchPatched) return;
    const previous = window.fetch.bind(window);
    window.fetch = function printerAccessFetch(input, init = {}) {
      if (!belongs(input)) return previous(input, init);
      const clean = sanitize(typeof input === 'string' || input instanceof URL ? input : input.url);
      return previous(clean, secureInit(input, init)).then((response) => {
        if ([401, 403].includes(response.status)) {
          window.dispatchEvent(new CustomEvent('thelab:printer-auth-required', { detail: { status: response.status, tunnel: getBase() } }));
        } else if (response.ok) {
          window.__printerBridgeLastSuccessAt = Date.now();
        }
        return response;
      });
    };
    fetchPatched = true;
  }

  function patchWebSocket() {
    if (websocketPatched || typeof NativeWebSocket !== 'function') return;
    function AccessWebSocket(url, protocols) {
      const clean = belongs(url) ? sanitize(url) : url;
      return protocols === undefined ? new NativeWebSocket(clean) : new NativeWebSocket(clean, protocols);
    }
    AccessWebSocket.prototype = NativeWebSocket.prototype;
    for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) AccessWebSocket[key] = NativeWebSocket[key];
    window.WebSocket = AccessWebSocket;
    websocketPatched = true;
  }

  function patchLegacyHelpers() {
    // Las funciones declaradas en scripts clásicos son propiedades configurables
    // de window. Se conservan las firmas, pero ya no agregan secretos a la URL.
    try {
      if (typeof window._appendBridgeToken === 'function') {
        window._appendBridgeToken = (url) => sanitize(url);
      }
    } catch (_) {}
    try {
      if (typeof window.printerMediaUrl === 'function') {
        const originalMedia = window.printerMediaUrl;
        window.printerMediaUrl = (...args) => sanitize(originalMedia(...args));
      }
    } catch (_) {}
    try {
      if (typeof window.printerCamUrl === 'function') {
        const originalCam = window.printerCamUrl;
        window.printerCamUrl = (...args) => sanitize(originalCam(...args));
      }
    } catch (_) {}
  }

  function openLogin() {
    const base = getBase();
    if (!base) throw new Error('Túnel no configurado');
    const popup = window.open(`${base}/healthz`, 'thelab-printer-access', 'popup,width=640,height=720');
    if (!popup) location.href = `${base}/healthz`;
    return popup;
  }

  patchFetch();
  patchWebSocket();
  patchLegacyHelpers();
  document.addEventListener('DOMContentLoaded', patchLegacyHelpers, { once: true });
  setTimeout(patchLegacyHelpers, 1000);

  window.PrinterAccess = Object.freeze({
    configure,
    getBase,
    sanitize,
    belongs,
    openLogin,
    patchLegacyHelpers,
    status: () => ({ lastSuccessAt: Number(window.__printerBridgeLastSuccessAt || 0), accessMode: true }),
  });
})();
