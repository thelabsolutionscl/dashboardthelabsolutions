/* Orden y paneles contraíbles para la sección Calendario. */
(function () {
  'use strict';

  if (window.CalendarCollapsible) return;

  const STORAGE_KEY = 'thelab_calendar_collapsed_panels_v2';
  const TARGETS = [
    { key: 'foco-operativo', contentId: 'calFocus' },
    { key: 'proximos-14-dias', contentId: 'calProximos' },
    { key: 'compromisos-sin-fecha', cardId: 'calSinFechaCard' },
  ];

  function readState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch (_) { return {}; }
  }

  function writeState(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (_) {}
  }

  function ensureStyles() {
    if (document.getElementById('calendarCollapsibleStyles')) return;
    const style = document.createElement('style');
    style.id = 'calendarCollapsibleStyles';
    style.textContent = `
      #tab-calendario .cal-section-collapsible > .card-header {
        cursor: pointer;
        user-select: none;
        transition: background .16s ease;
      }
      #tab-calendario .cal-section-collapsible > .card-header:hover {
        background: var(--surface2);
      }
      #tab-calendario .cal-section-collapse-chevron {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        margin-left: 6px;
        border-radius: 7px;
        flex: 0 0 auto;
        color: var(--text3);
        font-size: 15px;
        line-height: 1;
        transition: transform .16s ease, background .16s ease;
      }
      #tab-calendario .cal-section-collapsible > .card-header:hover .cal-section-collapse-chevron {
        background: var(--surface);
      }
      #tab-calendario .cal-section-collapsible.is-collapsed > .cal-section-collapse-chevron {
        transform: rotate(-90deg);
      }
      #tab-calendario .cal-section-collapsible.is-collapsed > :not(.card-header) {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  function resolveCard(target) {
    if (target.cardId) return document.getElementById(target.cardId);
    const content = document.getElementById(target.contentId);
    return content ? content.closest('.card') : null;
  }

  function isInteractive(node) {
    return !!(node && node.closest && node.closest('button,a,input,select,textarea,label,[role="button"]'));
  }

  function paint(card, key, state) {
    const collapsed = state[key] === true;
    card.classList.toggle('is-collapsed', collapsed);
    const header = card.querySelector(':scope > .card-header');
    if (!header) return;
    header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    header.title = collapsed ? 'Mostrar sección' : 'Ocultar sección';
    const chevron = header.querySelector('.cal-section-collapse-chevron');
    if (chevron) chevron.textContent = collapsed ? '▸' : '▾';
  }

  function enhanceCard(card, key) {
    if (!card) return;
    const header = card.querySelector(':scope > .card-header');
    if (!header) return;

    card.classList.add('cal-section-collapsible');
    let chevron = header.querySelector('.cal-section-collapse-chevron');
    if (!chevron) {
      chevron = document.createElement('span');
      chevron.className = 'cal-section-collapse-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      header.appendChild(chevron);
    }

    if (card.dataset.calendarCollapsibleReady !== '1') {
      card.dataset.calendarCollapsibleReady = '1';
      header.setAttribute('role', 'button');
      header.setAttribute('tabindex', '0');

      header.addEventListener('click', event => {
        if (isInteractive(event.target)) return;
        const state = readState();
        state[key] = !(state[key] === true);
        writeState(state);
        paint(card, key, state);
      });

      header.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (isInteractive(event.target) && event.target !== header) return;
        event.preventDefault();
        const state = readState();
        state[key] = !(state[key] === true);
        writeState(state);
        paint(card, key, state);
      });
    }

    paint(card, key, readState());
  }

  // El calendario principal es la herramienta central de la sección. Se mueve
  // antes de KPIs, Foco operativo y paneles secundarios, sin recrear el nodo.
  function moveCalendarFirst() {
    const tab = document.getElementById('tab-calendario');
    const kpis = document.getElementById('calKpis');
    const calendarCard = document.getElementById('calGrid')?.closest('.card');
    if (!tab || !kpis || !calendarCard) return;
    if (calendarCard.parentElement !== tab || kpis.parentElement !== tab) return;
    if (calendarCard.nextElementSibling === kpis) return;
    tab.insertBefore(calendarCard, kpis);
  }

  function enhance() {
    ensureStyles();
    moveCalendarFirst();
    TARGETS.forEach(target => enhanceCard(resolveCard(target), target.key));
  }

  let frame = 0;
  const observer = new MutationObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(enhance);
  });

  function init() {
    enhance();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.CalendarCollapsible = { enhance, moveCalendarFirst };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
