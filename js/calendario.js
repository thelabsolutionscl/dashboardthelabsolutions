/* Cargador único del Calendario: dependencias en orden y sin ejecuciones duplicadas. */
(function () {
  'use strict';

  if (window.__thelabCalendarLoadPromise) return;

  const MODULES = [
    { src: 'js/calendario-base.js', ready: () => typeof window.renderCalendario === 'function' },
    { src: 'js/calendario-operaciones.js', ready: () => !!window.CalOps },
    { src: 'js/calendario-collapsible.js', ready: () => !!window.CalendarCollapsible },
    { src: 'js/tv-logo-fix.js' },
    { src: 'js/tv-control-center.js' }
  ];

  function absolute(src) {
    return new URL(src, document.baseURI).href;
  }

  function loadModule(module) {
    if (module.ready && module.ready()) return Promise.resolve();

    const url = absolute(module.src);
    const existing = Array.from(document.scripts).find(script => script.src === url);
    if (existing) {
      if (existing.dataset.calendarLoaded === '1' || (module.ready && module.ready())) return Promise.resolve();
      return new Promise((resolve, reject) => {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(new Error(module.src)), { once: true });
        setTimeout(() => {
          if (!module.ready || module.ready()) resolve();
        }, 0);
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = module.src;
      script.async = false;
      script.dataset.calendarModule = module.src;
      script.onload = () => {
        script.dataset.calendarLoaded = '1';
        resolve();
      };
      script.onerror = () => reject(new Error(module.src));
      document.head.appendChild(script);
    });
  }

  window.__thelabCalendarLoadPromise = MODULES.reduce(
    (chain, module) => chain.then(() => loadModule(module)),
    Promise.resolve()
  ).catch(error => {
    console.error('[Calendario] No se pudo cargar un módulo:', error.message || error);
    throw error;
  });
})();
