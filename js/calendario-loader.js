/* Compatibilidad: todas las vistas antiguas delegan en el cargador único. */
(function () {
  'use strict';

  if (window.__thelabCalendarLoadPromise) return;

  const target = new URL('js/calendario.js', document.baseURI).href;
  const existing = Array.from(document.scripts).find(script => script.src === target);
  if (existing) return;

  const script = document.createElement('script');
  script.src = 'js/calendario.js';
  script.async = false;
  script.onerror = () => console.error('[Calendario] no se pudo cargar js/calendario.js');
  document.head.appendChild(script);
})();
