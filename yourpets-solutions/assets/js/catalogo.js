/* ============================================================================
   YOURPETS:SOLUTIONS — catalogo.js
   Renders + filters the test catalog. Data source: window.YPS_CATALOG
   (loaded from assets/js/catalogo-data.js so it works under file:// too).

   Expected markup on catalogo.html:
     <div class="search-box"><svg.../><input id="catalog-search" type="search"></div>
     <div class="filter-chips" id="catalog-chips"></div>
     <p class="catalog-meta" id="catalog-meta"></p>
     <div id="catalog-results"></div>

   Each catalog item: { code, cat, name, sample, tat }
   ========================================================================== */
(function () {
  'use strict';

  var data = Array.isArray(window.YPS_CATALOG) ? window.YPS_CATALOG : [];
  var results = document.getElementById('catalog-results');
  var chipsEl = document.getElementById('catalog-chips');
  var searchEl = document.getElementById('catalog-search');
  var metaEl = document.getElementById('catalog-meta');
  if (!results) return;

  var activeCat = 'Todos';
  var query = '';

  // Ordered unique categories (preserves data order)
  var cats = [];
  data.forEach(function (it) { if (cats.indexOf(it.cat) === -1) cats.push(it.cat); });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function matches(it) {
    if (activeCat !== 'Todos' && it.cat !== activeCat) return false;
    if (!query) return true;
    var q = norm(query);
    return norm(it.code).indexOf(q) !== -1 ||
           norm(it.name).indexOf(q) !== -1 ||
           norm(it.sample).indexOf(q) !== -1 ||
           norm(it.cat).indexOf(q) !== -1;
  }

  function buildChips() {
    if (!chipsEl) return;
    var all = ['Todos'].concat(cats);
    chipsEl.innerHTML = all.map(function (c) {
      return '<button class="chip' + (c === activeCat ? ' active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('');
    chipsEl.querySelectorAll('.chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeCat = btn.getAttribute('data-cat');
        chipsEl.querySelectorAll('.chip').forEach(function (b) { b.classList.toggle('active', b === btn); });
        render();
      });
    });
  }

  function rowHTML(it) {
    return '<tr>' +
      '<td class="c-code" data-th="Código">' + esc(it.code) + '</td>' +
      '<td class="c-name" data-th="Examen">' + esc(it.name) + '</td>' +
      '<td class="c-sample" data-th="Muestra sugerida">' + esc(it.sample) + '</td>' +
      '<td class="c-tat" data-th="Entrega">' + esc(it.tat) + '</td>' +
    '</tr>';
  }

  function tableHTML(cat, items) {
    return '<div class="cat-group-title"><h3>' + esc(cat) + '</h3>' +
           '<span class="badge brand">' + items.length + '</span></div>' +
           '<div class="catalog-table-wrap"><table class="catalog">' +
           '<thead><tr><th>Código</th><th>Examen</th><th>Muestra sugerida</th><th>Entrega</th></tr></thead>' +
           '<tbody>' + items.map(rowHTML).join('') + '</tbody></table></div>';
  }

  function render() {
    var shown = data.filter(matches);
    if (metaEl) {
      metaEl.textContent = shown.length + ' de ' + data.length + ' análisis' +
        (activeCat !== 'Todos' ? ' · ' + activeCat : '') +
        (query ? ' · “' + query + '”' : '');
    }
    if (!shown.length) {
      results.innerHTML = '<div class="cat-empty"><p>No encontramos análisis para tu búsqueda.</p>' +
        '<p style="margin-top:8px">¿Necesitas un examen que no está en el listado? ' +
        '<a class="text-brand" href="contacto.html"><strong>Escríbenos</strong></a> y lo desarrollamos.</p></div>';
      return;
    }
    var html = '';
    cats.forEach(function (cat) {
      if (activeCat !== 'Todos' && cat !== activeCat) return;
      var items = shown.filter(function (it) { return it.cat === cat; });
      if (items.length) html += tableHTML(cat, items);
    });
    results.innerHTML = html;
  }

  if (searchEl) {
    searchEl.addEventListener('input', function () { query = searchEl.value.trim(); render(); });
  }

  if (!data.length) {
    results.innerHTML = '<div class="cat-empty"><p>No se pudo cargar el catálogo. Verifica que <code>assets/js/catalogo-data.js</code> esté incluido.</p></div>';
    return;
  }

  buildChips();
  render();
})();
