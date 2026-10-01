# YOURPETS:SOLUTIONS — Sitio web

Sitio web institucional y de servicios de **YOURPETS:SOLUTIONS**, laboratorio
veterinario de diagnóstico **molecular (qPCR), genético y clínico** para mascotas
en Chile. Marca de **The Lab Solutions**.

> Sitio **estático** (HTML + CSS + JS vanilla, sin build ni dependencias).
> Se sirve abriendo `index.html` o desde cualquier hosting estático (GitHub Pages,
> Netlify, Cloudflare Pages, etc.).

## Estructura

```
yourpets-solutions/
├── index.html            # Home / landing
├── genetica.html         # Estudios genéticos (producto estrella)
├── diagnostico.html      # Biología molecular qPCR + clínicos
├── catalogo.html         # Catálogo de exámenes (buscable)
├── veterinarios.html     # B2B: clínicas y veterinarios
├── nosotros.html         # Quiénes somos + I+D+i
├── recursos.html         # Guías de toma y envío de muestras
├── contacto.html         # Contacto + formulario (demo)
├── 404.html
├── robots.txt · sitemap.xml
├── STYLEGUIDE.md         # Guía de marca y patrones (fuente de verdad)
└── assets/
    ├── css/styles.css        # Design system (tokens + componentes)
    ├── js/main.js            # Nav, scroll-reveal, accordion, form demo
    ├── js/catalogo.js        # Render + filtros del catálogo
    ├── js/catalogo-data.js   # Datos del catálogo (window.YPS_CATALOG)
    ├── data/catalogo.json    # Mismos datos en JSON (portátil)
    └── img/                  # favicon.svg, og-image.svg
```

## Desarrollo

No requiere instalación. Para previsualizar con un servidor local (recomendado,
para que `fetch`/rutas funcionen igual que en producción):

```bash
cd yourpets-solutions
python3 -m http.server 8080
# abre http://localhost:8080
```

## Despliegue en Vercel

Este sitio vive en el subdirectorio `yourpets-solutions/` de un repo más grande
(el dashboard de The Lab Solutions se despliega aparte en GitHub Pages). Para
publicar **solo este sitio** en Vercel:

1. En [vercel.com](https://vercel.com) → **Add New… → Project** → importa el repo
   `thelabsolutionscl/dashboardthelabsolutions`.
2. En **Root Directory**, elige **`yourpets-solutions`** (botón *Edit*).
3. **Framework Preset:** *Other* — no hay build (sitio estático).
   - Build Command: *(vacío)* · Output Directory: *(vacío)* · Install: *(vacío)*
4. (Opcional) En **Production Branch** elige la rama que quieras desplegar.
5. **Deploy**. La configuración (`vercel.json`) ya define cache de assets y
   cabeceras de seguridad.

> No requiere variables de entorno: el sitio es 100% estático.

## Personalización

- **Diseño:** todos los tokens (colores, tipografía, radios, sombras) están en
  `assets/css/styles.css` (`:root`). Las páginas solo componen clases existentes.
- **Patrones y markup compartido** (head/header/footer): ver `STYLEGUIDE.md`.
- **Catálogo:** edita `assets/js/catalogo-data.js` (cada item: `code, cat, name, sample, tat`).

## ⚠️ Pendientes antes de publicar

Los datos de contacto son **placeholders** (no son de terceros). Actualiza:

- Teléfono / WhatsApp `+56 9 XXXX XXXX` → número real (en footers, `contacto.html`, `veterinarios.html`).
- Dirección y horarios reales si aplica.
- Redes sociales (enlaces `#` en el footer).
- Dominio canónico en `sitemap.xml` / `robots.txt` (hoy `https://yourpets.thelab.solutions/`).
- Conectar el formulario de `contacto.html` a un endpoint real o a WhatsApp
  (hoy es una demo manejada en `assets/js/main.js`).

## Notas de contenido

El contenido de servicios (paneles, exámenes, genética, logística) está basado en
materiales de referencia del rubro. No se usan marcas, datos bancarios ni de
contacto de terceros: la identidad es exclusivamente YOURPETS:SOLUTIONS.

---
© YOURPETS:SOLUTIONS · The Lab Solutions
