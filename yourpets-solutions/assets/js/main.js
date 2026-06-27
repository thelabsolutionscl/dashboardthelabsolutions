/* ============================================================================
   YOURPETS:SOLUTIONS — main.js
   Shared interactions: mobile nav, scroll reveal, accordion, smooth-scroll,
   contact form (demo), dynamic year. Vanilla JS, no dependencies.
   ========================================================================== */
(function () {
  'use strict';

  /* ---- Mobile nav toggle ---- */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = document.body.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // Close menu when a link is tapped (mobile)
    nav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        document.body.classList.remove('nav-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
    // Close on escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.body.classList.remove('nav-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---- Scroll reveal ---- */
  var revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
      revealEls.forEach(function (el) { io.observe(el); });
    } else {
      revealEls.forEach(function (el) { el.classList.add('in'); });
    }
  }

  /* ---- Accordion (FAQ) ---- */
  document.querySelectorAll('.accordion').forEach(function (acc) {
    acc.querySelectorAll('.acc-head').forEach(function (head) {
      head.addEventListener('click', function () {
        var item = head.closest('.acc-item');
        var panel = item.querySelector('.acc-panel');
        var isOpen = item.classList.contains('open');
        // close siblings
        acc.querySelectorAll('.acc-item.open').forEach(function (other) {
          if (other !== item) {
            other.classList.remove('open');
            other.querySelector('.acc-panel').style.maxHeight = null;
            other.querySelector('.acc-head').setAttribute('aria-expanded', 'false');
          }
        });
        if (isOpen) {
          item.classList.remove('open');
          panel.style.maxHeight = null;
          head.setAttribute('aria-expanded', 'false');
        } else {
          item.classList.add('open');
          panel.style.maxHeight = panel.scrollHeight + 'px';
          head.setAttribute('aria-expanded', 'true');
        }
      });
    });
  });

  /* ---- Active nav link by current path ---- */
  var path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a').forEach(function (a) {
    var href = a.getAttribute('href');
    if (!href) return;
    if (href === path || (path === 'index.html' && (href === './' || href === 'index.html'))) {
      a.classList.add('active');
    }
  });

  /* ---- Contact form (front-end demo handler) ---- */
  var form = document.querySelector('form[data-demo-form]');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = form.querySelector('.form-status');
      var data = new FormData(form);
      var name = (data.get('nombre') || '').toString().trim() || 'colega';
      if (status) {
        status.textContent = '¡Gracias, ' + name + '! Recibimos tu mensaje. Te contactaremos a la brevedad. ' +
          '(Demo: este formulario aún no envía datos a un servidor — conecta tu endpoint o WhatsApp.)';
        status.classList.add('show', 'ok');
      }
      form.reset();
    });
  }

  /* ---- Dynamic year ---- */
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });
})();
