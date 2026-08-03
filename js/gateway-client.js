/* Cliente único del gateway protegido por Cloudflare Access. */
(function () {
  'use strict';
  if (window.DashboardGateway) return;

  const DEFAULT_TIMEOUT_MS = 30000;
  const originalFetch = window.fetch.bind(window);
  let configuredBase = '';
  let patched = false;

  function lexicalConfig() {
    try { if (typeof PROXY_URL !== 'undefined') return PROXY_URL; } catch (_) {}
    return '';
  }

  function cleanBase(value) {
    const raw = String(value || '').trim();
    if (!raw || /^%%.+%%$/.test(raw)) return '';
    try {
      const url = new URL(raw, location.href);
      if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return '';
      url.pathname = url.pathname.replace(/\/$/, '');
      url.search = '';
      url.hash = '';
      return url.href.replace(/\/$/, '');
    } catch (_) {
      return '';
    }
  }

  function discoverBase() {
    const candidates = [
      configuredBase,
      lexicalConfig(),
      window.PROXY_URL,
      window.CONFIG?.PROXY_URL,
      window.APP_CONFIG?.PROXY_URL,
      window.THELAB_CONFIG?.PROXY_URL,
      document.querySelector('meta[name="thelab-gateway"]')?.content,
      localStorage.getItem('thelab_gateway_url'),
    ];
    for (const candidate of candidates) {
      const base = cleanBase(candidate);
      if (base) return base;
    }
    return '';
  }

  function configure(value) {
    const base = cleanBase(value);
    if (!base) throw new Error('URL del gateway inválida');
    configuredBase = base;
    try { localStorage.setItem('thelab_gateway_url', base); } catch (_) {}
    return base;
  }

  function toUrl(path) {
    const base = discoverBase();
    if (!base) throw new Error('Gateway no configurado');
    const suffix = String(path || '');
    if (/^https?:\/\//i.test(suffix)) {
      const absolute = new URL(suffix);
      const expected = new URL(base);
      if (absolute.origin !== expected.origin || !absolute.pathname.startsWith(expected.pathname || '/')) {
        throw new Error('La URL no pertenece al gateway configurado');
      }
      return absolute.href;
    }
    return `${base}/${suffix.replace(/^\//, '')}`;
  }

  function belongsToGateway(input) {
    const base = discoverBase();
    if (!base) return false;
    try {
      const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      const root = new URL(base);
      const rootPath = root.pathname.replace(/\/$/, '');
      return target.origin === root.origin && (!rootPath || rootPath === '/' || target.pathname === rootPath || target.pathname.startsWith(`${rootPath}/`));
    } catch (_) {
      return false;
    }
  }

  function mergeSignal(signal, timeoutMs) {
    if (!timeoutMs || typeof AbortSignal?.timeout !== 'function') return signal;
    const timeout = AbortSignal.timeout(timeoutMs);
    if (!signal) return timeout;
    if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
    return signal;
  }

  function headersObject(headers) {
    return new Headers(headers || {});
  }

  async function securedFetch(input, init = {}) {
    if (!belongsToGateway(input)) return originalFetch(input, init);
    const headers = headersObject(init.headers || (input instanceof Request ? input.headers : undefined));
    // La antigua X-App-Key puede seguir apareciendo durante la transición, pero
    // una cadena vacía no debe provocar un preflight innecesario.
    if (!String(headers.get('X-App-Key') || '').trim()) headers.delete('X-App-Key');
    const requestInit = {
      ...init,
      headers,
      credentials: 'include',
      redirect: 'follow',
      cache: init.cache || 'no-store',
      signal: mergeSignal(init.signal, init.timeoutMs || DEFAULT_TIMEOUT_MS),
    };
    delete requestInit.timeoutMs;

    let response;
    try {
      response = await originalFetch(input, requestInit);
    } catch (error) {
      window.dispatchEvent(new CustomEvent('thelab:gateway-error', { detail: { error, url: String(input) } }));
      throw error;
    }

    if (response.status === 401 || response.status === 403) {
      window.dispatchEvent(new CustomEvent('thelab:gateway-auth-required', {
        detail: { status: response.status, gateway: discoverBase(), url: response.url },
      }));
    } else if (response.ok) {
      window.__airtableLastSuccessAt = Date.now();
      window.dispatchEvent(new CustomEvent('thelab:gateway-online', { detail: { at: Date.now(), url: response.url } }));
    }
    return response;
  }

  function installFetchBridge() {
    if (patched) return;
    patched = true;
    window.fetch = function dashboardSecureFetch(input, init) {
      return securedFetch(input, init);
    };
  }

  async function request(path, options = {}) {
    const response = await securedFetch(toUrl(path), options);
    const type = response.headers.get('Content-Type') || '';
    let body = null;
    if (response.status !== 204) {
      if (type.includes('application/json')) {
        try { body = await response.json(); } catch (_) { body = null; }
      } else {
        body = await response.text();
      }
    }
    if (!response.ok) {
      const message = body?.error || body?.message || `Gateway HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.body = body;
      error.requestId = response.headers.get('X-Request-Id') || body?.requestId || '';
      throw error;
    }
    return { response, data: body };
  }

  function openLogin() {
    const base = discoverBase();
    if (!base) throw new Error('Gateway no configurado');
    const popup = window.open(`${base}/health`, 'thelab-gateway-login', 'popup,width=640,height=720');
    if (!popup) location.href = `${base}/health`;
    return popup;
  }

  const state = {
    async get(key) {
      const { response, data } = await request(`/state/${encodeURIComponent(key)}`, { method: 'GET' });
      return { ...data, etag: response.headers.get('ETag') || `"${Number(data?.version || 0)}"` };
    },
    async put(key, data, etag = '') {
      const headers = new Headers({ 'Content-Type': 'application/json' });
      if (etag) headers.set('If-Match', etag);
      const result = await request(`/state/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ data }),
      });
      return { ...result.data, etag: result.response.headers.get('ETag') || `"${Number(result.data?.version || 0)}"` };
    },
  };

  installFetchBridge();

  window.DashboardGateway = Object.freeze({
    configure,
    getBase: discoverBase,
    toUrl,
    request,
    fetch: securedFetch,
    openLogin,
    installFetchBridge,
    state: Object.freeze(state),
  });
})();
