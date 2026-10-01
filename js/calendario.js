/* Cargador único del Calendario: dependencias en orden y sin ejecuciones duplicadas. */
(function () {
  'use strict';

  if (window.__thelabCalendarLoadPromise) return;

  const MODULES = [
    { src: 'js/calendario-base.js', ready: () => typeof window.renderCalendario === 'function' },
    { src: 'js/calendario-operaciones.js', ready: () => !!window.CalOps },
    { src: 'js/calendario-collapsible.js', ready: () => !!window.CalendarCollapsible },
    { src: 'js/tv-logo-fix.js', ready: () => !!window.TVLogoFix },
    { src: 'js/tv-control-center.js', ready: () => !!window.TVControlCenter }
  ];

  function absolute(src) {
    return new URL(src, document.baseURI).href;
  }

  function waitUntilReady(module, timeoutMs = 10000) {
    if (module.ready()) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (module.ready()) {
          clearInterval(timer);
          resolve();
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          reject(new Error(`${module.src} cargó, pero no expuso su API`));
        }
      }, 25);
    });
  }

  function loadModule(module) {
    if (module.ready()) return Promise.resolve();

    const url = absolute(module.src);
    const existing = Array.from(document.scripts).find(script => script.src === url);

    if (existing) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = promise => {
          if (settled) return;
          settled = true;
          promise.then(resolve, reject);
        };

        existing.addEventListener('load', () => finish(waitUntilReady(module)), { once: true });
        existing.addEventListener('error', () => finish(Promise.reject(new Error(module.src))), { once: true });

        // También cubre scripts estáticos cuyo evento load ya ocurrió.
        waitUntilReady(module).then(
          () => finish(Promise.resolve()),
          error => finish(Promise.reject(error))
        );
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = module.src;
      script.async = false;
      script.dataset.calendarModule = module.src;
      script.onload = () => {
        script.dataset.calendarLoaded = '1';
        waitUntilReady(module).then(resolve, reject);
      };
      script.onerror = () => reject(new Error(module.src));
      document.head.appendChild(script);
    });
  }

  window.__thelabCalendarLoadPromise = MODULES.reduce(
    (chain, module) => chain.then(() => loadModule(module)),
    Promise.resolve()
  ).then(() => {
    window.CalendarModulesReady = true;
    document.dispatchEvent(new CustomEvent('thelab:calendar-ready'));
  }).catch(error => {
    delete window.__thelabCalendarLoadPromise;
    window.CalendarModulesReady = false;
    console.error('[Calendario] No se pudo cargar un módulo:', error.message || error);
    throw error;
  });
})();
