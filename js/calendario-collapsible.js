/* Paneles contraíbles para la sección Calendario. */
(function () {
  'use strict';

  if (window.CalendarCollapsible) return;

  const STORAGE_KEY = 'thelab_calendar_collapsed_panels_v1';

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
      #calOpsRoot .cal-collapsible-card { padding: 0; overflow: hidden; }
      #calOpsRoot .cal-collapsible-header {
        width: 100%; display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding: 12px; border: 0; background: transparent;
        color: inherit; text-align: left; cursor: pointer;
      }
      #calOpsRoot .cal-collapsible-header:hover { background: var(--surface2); }
      #calOpsRoot .cal-collapsible-header h3 { margin: 0; font-size: inherit; }
      #calOpsRoot .cal-collapsible-chevron {
        display: inline-flex; align-items: center; justify-content: center;
        width: 28px; height: 28px; border-radius: 8px; flex: 0 0 auto;
        color: var(--text3); transition: transform .18s ease, background .18s ease;
      }
      #calOpsRoot .cal-collapsible-header:hover .cal-collapsible-chevron { background: var(--surface); }
      #calOpsRoot .cal-collapsible-content { padding: 0 12px 12px; }
      #calOpsRoot .cal-collapsible-card.is-collapsed .cal-collapsible-content { display: none; }
      #calOpsRoot .cal-collapsible-card.is-collapsed .cal-collapsible-chevron { transform: rotate(-90deg); }
      #calOpsRoot .cal-collapsible-card.is-collapsed .cal-collapsible-header { padding-bottom: 12px; }
    `;
    document.head.appendChild(style);
  }

  function panelId(title, index) {
    return String(title || `panel-${index}`)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function enhance() {
    ensureStyles();
    const root = document.getElementById('calOpsRoot');
    if (!root) return;

    const state = readState();
    root.querySelectorAll('.cal-ops-card').forEach((card, index) => {
      if (card.dataset.collapsibleReady === '1') return;
      const heading = card.querySelector(':scope > h3');
      if (!heading) return;

      const id = panelId(heading.textContent, index);
      const content = document.createElement('div');
      content.className = 'cal-collapsible-content';

      Array.from(card.childNodes)
        .filter(node => node !== heading)
        .forEach(node => content.appendChild(node));

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cal-collapsible-header';
      button.setAttribute('aria-expanded', state[id] === true ? 'false' : 'true');
      button.setAttribute('aria-controls', `cal-panel-${id}`);
      button.innerHTML = `<h3>${heading.innerHTML}</h3><span class="cal-collapsible-chevron" aria-hidden="true">⌄</span>`;

      content.id = `cal-panel-${id}`;
      card.innerHTML = '';
      card.classList.add('cal-collapsible-card');
      card.dataset.collapsibleReady = '1';
      card.dataset.panelId = id;
      card.append(button, content);

      if (state[id] === true) card.classList.add('is-collapsed');

      button.addEventListener('click', () => {
        const collapsed = card.classList.toggle('is-collapsed');
        button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        const next = readState();
        next[id] = collapsed;
        writeState(next);
      });
    });
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

  window.CalendarCollapsible = { enhance };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
