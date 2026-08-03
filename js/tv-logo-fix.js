/* Branding compartido para Modo TV, sin modificar encabezados existentes. */
(function () {
  'use strict';
  if (window.TVLogoFix) return;

  const SELECTORS = [
    '.topbar-logo img',
    '.brand img',
    '.sidebar-logo img',
    'header img[alt*="Lab" i]',
    'img[alt*="The Lab" i]',
    'img.logo',
  ];

  function getLogo() {
    for (const selector of SELECTORS) {
      const image = document.querySelector(selector);
      if (image?.currentSrc || image?.src) return image;
    }
    return null;
  }

  function getLogoSrc() {
    const image = getLogo();
    return image?.currentSrc || image?.src || '';
  }

  function createLogo(className = 'tv-shared-dashboard-logo') {
    const src = getLogoSrc();
    if (!src) return null;
    const image = document.createElement('img');
    image.className = className;
    image.src = src;
    image.alt = 'The Lab Solutions';
    image.decoding = 'async';
    return image;
  }

  // patch se conserva como compatibilidad para módulos antiguos; ya no recorre
  // ni modifica el DOM completo, evitando logos duplicados y ciclos de MutationObserver.
  window.TVLogoFix = Object.freeze({
    getLogo,
    getLogoSrc,
    createLogo,
    patch() { return getLogoSrc(); },
  });
})();
