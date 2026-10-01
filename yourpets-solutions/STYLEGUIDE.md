# YOURPETS:SOLUTIONS — Guía de marca y patrones (STYLEGUIDE)

Fuente única de verdad para construir páginas consistentes. **Copia textualmente**
el `<head>`, el header y el footer en cada página. No inventes clases nuevas: usa
las del design system (`assets/css/styles.css`).

---

## 1. Marca

- **Nombre:** YOURPETS:SOLUTIONS (marca de *The Lab Solutions*).
- **Qué es:** laboratorio veterinario de **diagnóstico molecular (qPCR), genético y clínico** para mascotas, en Chile. Audiencia: clínicas/médicos veterinarios (B2B) y tutores (B2C).
- **Propuesta de valor:** ciencia de vanguardia, resultados rápidos (qPCR el mismo día), genética integral (chequeo de 256 marcadores), logística de retiro y soporte clínico.
- **Marcas/nombres:** usa SOLO "YOURPETS:SOLUTIONS" y nombres de producto descriptivos propios (p. ej. "Chequeo Genético Canino", "Determinación de Raza", "Perfil de Identidad Genética ISAG 2020", "Test MDR1"). **No** uses marcas de la competencia (ZooGEN, ZooCheck, ZooBreed, MOLECVET) ni sus datos de contacto/bancarios.
- **Tono:** profesional, cálido, claro. Español de Chile. Tutea con cercanía pero con rigor científico. Evita tecnicismos sin explicar.
- **Idioma:** Español (`lang="es"`).

### Paleta
- Teal de marca `--brand #0ea5a4` (confianza, salud, ciencia).
- Coral de acento `--accent #ff6b4a` (calidez, energía, mascotas).
- Violeta genética `--gene #7c5cfc` (ADN / línea genética).
- Tinta `--ink-900 #0a1626`, fondos claros `#fff` / `--bg-soft #f5f8fc`.

### Tipografía (ya incluida en el `<head>`)
- Display: **Sora** (títulos). Cuerpo: **Inter**. Mono: **JetBrains Mono** (códigos/IDs).

### Datos de contacto (PLACEHOLDERS — actualizar antes de publicar)
> Estos NO son datos de la competencia. Son marcadores de posición de la marca.
- Email: `hola@thelab.solutions`
- Web matriz: `thelab.solutions`
- WhatsApp/Tel: `+56 9 XXXX XXXX`
- Dirección: `Santiago, Chile`
- Horario: Lun–Vie 09:00–18:30 · Sáb 10:00–14:00
- Redes: `@yourpets.solutions` (placeholder)

---

## 2. `<head>` canónico

Reemplaza `__TITLE__`, `__DESC__` y `__CANONICAL__` por página. `__BASE__` es la
ruta relativa a assets (`.` si la página está en la raíz del sitio).

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>__TITLE__ · YOURPETS:SOLUTIONS</title>
<meta name="description" content="__DESC__">
<meta name="theme-color" content="#0ea5a4">
<link rel="icon" type="image/svg+xml" href="assets/img/favicon.svg">
<meta property="og:type" content="website">
<meta property="og:title" content="__TITLE__ · YOURPETS:SOLUTIONS">
<meta property="og:description" content="__DESC__">
<meta property="og:image" content="assets/img/og-image.svg">
<meta property="og:locale" content="es_CL">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/css/styles.css">
</head>
<body>
<a href="#main" class="skip-link">Saltar al contenido</a>
```

The home page (`index.html`) should also include this JSON-LD before `</head>`:

```html
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"MedicalBusiness","name":"YOURPETS:SOLUTIONS","description":"Laboratorio veterinario de diagnóstico molecular, genético y clínico para mascotas.","areaServed":"CL","email":"hola@thelab.solutions","url":"https://thelab.solutions","parentOrganization":{"@type":"Organization","name":"The Lab Solutions"},"medicalSpecialty":"Pathology"}
</script>
```

---

## 3. Header canónico (cópialo idéntico en cada página)

Marca como `active` el enlace de la página actual (también lo hace `main.js`).

```html
<header class="site-header">
  <div class="container">
    <a href="index.html" class="brand" aria-label="YOURPETS:SOLUTIONS — inicio">
      <svg class="logo-mark" viewBox="0 0 64 64" aria-hidden="true">
        <defs><linearGradient id="lm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#27c4b6"/><stop offset=".55" stop-color="#0ea5a4"/><stop offset="1" stop-color="#0f6e72"/>
        </linearGradient></defs>
        <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#lm)"/>
        <g fill="#fff">
          <ellipse cx="22" cy="24" rx="5.4" ry="6.6"/><ellipse cx="42" cy="24" rx="5.4" ry="6.6"/>
          <ellipse cx="13.5" cy="34" rx="4.6" ry="5.6"/><ellipse cx="50.5" cy="34" rx="4.6" ry="5.6"/>
          <path d="M32 33c7.2 0 13 5 13 11.4 0 4.6-3.6 7.3-8 7.3-2.2 0-3.6-1-5-1s-2.8 1-5 1c-4.4 0-8-2.7-8-7.3C19 38 24.8 33 32 33Z"/>
        </g>
        <circle cx="32" cy="44.5" r="2.1" fill="#ff6b4a"/>
      </svg>
      <span class="brand-name">YOURPETS<span class="b-sep">:</span><span class="b-soft">SOLUTIONS</span></span>
    </a>
    <button class="nav-toggle" aria-label="Abrir menú" aria-expanded="false" aria-controls="nav"><span></span></button>
    <nav class="nav" id="nav" aria-label="Principal">
      <a href="index.html">Inicio</a>
      <a href="genetica.html">Genética</a>
      <a href="diagnostico.html">Diagnóstico</a>
      <a href="catalogo.html">Catálogo</a>
      <a href="veterinarios.html">Veterinarios</a>
      <a href="nosotros.html">Nosotros</a>
      <a href="recursos.html">Recursos</a>
      <span class="nav-cta"><a href="contacto.html" class="btn btn-primary btn-sm">Contáctanos</a></span>
    </nav>
  </div>
</header>
<main id="main">
```

---

## 4. Footer canónico (cópialo idéntico en cada página)

```html
</main>
<footer class="site-footer">
  <div class="container">
    <div class="footer-grid">
      <div>
        <span class="brand-name">YOURPETS<span class="b-sep">:</span><span class="b-soft">SOLUTIONS</span></span>
        <p class="footer-about">Laboratorio veterinario de diagnóstico molecular, genético y clínico. Ciencia de vanguardia al servicio de la salud de tus mascotas.</p>
        <div class="footer-social">
          <a href="#" aria-label="Instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg></a>
          <a href="#" aria-label="WhatsApp"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.4A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.4-1.1-2.7s.7-1.9.9-2.1c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.4 0 .6l-.4.5c-.2.2-.3.4-.1.7.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.2.1.4.1.6-.1l.7-.9c.2-.2.4-.2.6-.1l1.8.9c.2.1.4.2.4.3.1.2.1.7-.1 1.3Z"/></svg></a>
          <a href="#" aria-label="LinkedIn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5A2.5 2.5 0 1 1 0 3.5a2.5 2.5 0 0 1 4.98 0ZM.5 8h4V24h-4Zm7 0h3.8v2.2h.05c.53-1 1.83-2.2 3.77-2.2 4 0 4.8 2.65 4.8 6.1V24h-4v-7.1c0-1.7 0-3.9-2.4-3.9s-2.7 1.85-2.7 3.77V24h-4Z"/></svg></a>
        </div>
      </div>
      <div>
        <h4>Servicios</h4>
        <a href="genetica.html">Chequeo genético</a>
        <a href="genetica.html">Determinación de raza</a>
        <a href="diagnostico.html">Paneles qPCR</a>
        <a href="diagnostico.html">Química clínica</a>
        <a href="catalogo.html">Catálogo completo</a>
      </div>
      <div>
        <h4>Compañía</h4>
        <a href="nosotros.html">Nosotros</a>
        <a href="nosotros.html">I+D+i</a>
        <a href="veterinarios.html">Para veterinarios</a>
        <a href="recursos.html">Recursos</a>
        <a href="contacto.html">Contacto</a>
      </div>
      <div>
        <h4>Contacto</h4>
        <a href="mailto:hola@thelab.solutions">hola@thelab.solutions</a>
        <a href="#">+56 9 XXXX XXXX</a>
        <a href="#">Santiago, Chile</a>
        <a href="#">Lun–Vie 09:00–18:30</a>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© <span data-year>2026</span> YOURPETS:SOLUTIONS · The Lab Solutions. Todos los derechos reservados.</span>
      <span>Hecho con ciencia 🧬 en Chile</span>
    </div>
  </div>
</footer>
<script src="assets/js/main.js"></script>
</body>
</html>
```

> En `catalogo.html` añade además, antes de `</body>`: `<script src="assets/js/catalogo.js"></script>`.

---

## 5. Patrones de sección reutilizables

- **Page hero interior:** `<section class="page-hero"><div class="container">…breadcrumb + h1 + p…</div></section>`
- **Sección estándar:** `<section class="section"><div class="container">…</div></section>` (alterna `section-tint`).
- **Encabezado de sección:** `<div class="section-head reveal"><span class="eyebrow">…</span><h2>…</h2><p>…</p></div>`
- **Grilla de tarjetas:** `<div class="grid cols-3">` con `<article class="card card-hover reveal">…</article>`.
- **Iconos:** SVG inline 24×24, `stroke="currentColor"` dentro de `.card-icon` (variantes `.coral`, `.gene`, `.deep`).
- **CTA final:** `<section class="section"><div class="container"><div class="cta-band reveal">…</div></div></section>`.
- **Stats:** `.stats` con `.stat > .num (+coral/gene) + .label`.
- **Pasos:** `.steps` con `.step > .step-num + h4 + p`.
- **FAQ:** `.accordion > .acc-item > (.acc-head[aria-expanded] + .acc-panel > .acc-panel-inner)`; icono `<span class="acc-icon">+</span>`.
- **Reveal:** añade `reveal` (y `d1`–`d4` para escalonar) a bloques que aparecen al hacer scroll.

Iconos sugeridos (Feather-style, stroke 2): genética=ADN/hélice, qPCR=actividad/onda,
química=gota/probeta, micro=placa, retiro=camión, resultados=archivo-check, reloj=tiempo,
escudo=calidad, mascota=huella/corazón.

## 6. Páginas del sitio
`index.html` · `genetica.html` · `diagnostico.html` · `catalogo.html` · `veterinarios.html` · `nosotros.html` · `recursos.html` · `contacto.html`
