/* Cargador único y resiliente del Calendario y el Modo TV. */
(function () {
  'use strict';

  if (window.__thelabCalendarLoadPromise) return;

  const loaderSource = document.currentScript?.src || '';
  let buildQuery = '';
  try { buildQuery = new URL(loaderSource, document.baseURI).search; } catch (_) {}

  const MODULES = {
    gateway: { src: 'js/gateway-client.js', ready: () => !!window.DashboardGateway },
    base: { src: 'js/calendario-base.js', ready: () => typeof window.renderCalendario === 'function' },
    runtime: { src: 'js/runtime-bridges.js', ready: () => !!window.PrinterTelemetry && !!window.TheLabTime },
    operations: { src: 'js/calendario-operaciones.js', ready: () => !!window.CalOps },
    collapsible: { src: 'js/calendario-collapsible.js', ready: () => !!window.CalendarCollapsible },
    productionState: { src: 'js/production-state.js', ready: () => !!window.ProductionState },
    branding: { src: 'js/tv-logo-fix.js', ready: () => !!window.TVLogoFix },
    tv: { src: 'js/tv-control-center.js', ready: () => !!window.TVControlCenter },
  };

  const status = window.DashboardModules || (window.DashboardModules = {});

  function absolute(src) {
    const url = new URL(src, document.baseURI);
    if (buildQuery && !url.search) url.search = buildQuery;
    return url.href;
  }

  function sameAsset(script, target) {
    try {
      const a = new URL(script.src, document.baseURI);
      const b = new URL(target, document.baseURI);
      return a.origin === b.origin && a.pathname === b.pathname;
    } catch (_) {
      return false;
    }
  }

  function waitUntilReady(name, module, timeoutMs = 10000) {
    if (module.ready()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (module.ready()) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          reject(new Error(`${module.src} cargó, pero no expuso su API`));
        }
      }, 25);
    }).then(() => {
      status[name] = { status: 'loaded', loadedAt: Date.now(), src: module.src };
    });
  }

  function loadModule(name) {
    const module = MODULES[name];
    if (!module) return Promise.reject(new Error(`Módulo desconocido: ${name}`));
    if (module.ready()) {
      status[name] = { status: 'loaded', loadedAt: Date.now(), src: module.src };
      return Promise.resolve();
    }

    const target = absolute(module.src);
    const existing = Array.from(document.scripts).find((script) => sameAsset(script, target));
    status[name] = { status: 'loading', startedAt: Date.now(), src: module.src };

    if (existing) return waitUntilReady(name, module);

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = target;
      script.async = false;
      script.dataset.dashboardModule = name;
      script.onload = () => waitUntilReady(name, module).then(resolve, reject);
      script.onerror = () => reject(new Error(`No se pudo cargar ${module.src}`));
      document.head.appendChild(script);
    }).catch((error) => {
      status[name] = { status: 'error', failedAt: Date.now(), src: module.src, error: error.message };
      console.error(`[DashboardModules] ${name}:`, error);
      throw error;
    });
  }

  async function start() {
    // El bridge de fetch se instala primero para que cualquier llamada posterior
    // al gateway incluya la sesión de Cloudflare Access.
    await Promise.allSettled([loadModule('gateway'), loadModule('runtime')]);

    const base = await Promise.allSettled([loadModule('base')]);
    if (base[0].status === 'fulfilled') {
      await Promise.allSettled([loadModule('operations'), loadModule('collapsible')]);
    }

    await Promise.allSettled([loadModule('productionState'), loadModule('branding')]);
    await Promise.allSettled([loadModule('tv')]);

    window.CalendarModulesReady = base[0].status === 'fulfilled';
    document.dispatchEvent(new CustomEvent('thelab:calendar-ready', {
      detail: { calendarReady: window.CalendarModulesReady, modules: status },
    }));
  }

  window.__thelabCalendarLoadPromise = start().catch((error) => {
    window.CalendarModulesReady = false;
    console.error('[Calendario] Fallo inesperado del cargador:', error);
  });
})();
