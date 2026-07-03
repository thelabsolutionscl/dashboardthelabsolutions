# Google Ads — Estrategia, operación y setup

Cómo está armado el sistema de Google Ads de The Lab Solutions, qué estrategia
seguir para las mejores campañas posibles, cómo operarlo **desde el dashboard**
(sección **Web → Google Ads**) y qué hay que configurar **una sola vez**.

> Relacionado: [`PIPELINE.md`](./PIPELINE.md) (captación de leads),
> [`AGENTS_QUEUE.md`](./AGENTS_QUEUE.md) (cola de agentes IA).

---

## 1. Arquitectura en una imagen

```
Web (form + WhatsApp)  ──POST──►  lead-worker (Cloudflare)  ──►  Airtable: Clientes
   │  captura gclid/UTMs                │  guarda gclid en columna GCLID        │
   │  GA4 + conversión Ads              │  prioriza source=google_ads (Alta)    │
   ▼                                    ▼                                       ▼
Google Ads  ◄──Script 2 (bulk upload / mutaciones)──  Dashboard (index.html)
   ▲   │  Script 2 sube métricas ──────────────────►  · ADS_AGENT (optimiza por ROAS-real)
   │   │                                              · Crear campaña (manual / plantilla / IA)
   │   └──────────  CSV conversiones offline  ◄───────· ⬇ Conversiones offline (CRM → Ads)
   └── el CRM realimenta la puja con leads calificados y ventas reales
```

**Idea central:** la web capta, el worker normaliza y guarda el `gclid`, el
dashboard razona (ADS_AGENT) y opera Google Ads (crea/edita campañas y sube
conversiones offline). La verdad es el **ROAS-real del CRM**, no el ROAS que
reporta Google.

| Repo / pieza | Rol |
|---|---|
| `web-thelab-solutions` | Web pública. Convierte visita en cotización (form/WhatsApp). Tracking GA4 + conversión Ads + Consent Mode v2. Captura `gclid`/UTMs. |
| `dashboardthelabsolutions/lead-worker` | Normaliza y persiste el lead; guarda `gclid` en la columna **GCLID** de Clientes; prioriza `google_ads`. |
| `dashboardthelabsolutions/index.html` | Sección **Web → Google Ads**: ADS_AGENT, creación/edición de campañas, generador con IA, export de conversiones offline, sync vía 2 scripts. |

---

## 2. Estrategia (buenas prácticas 2026)

**Principio rector:** optimizar por **ganancia real** (ROAS-real = ingresos del
CRM / gasto), no por clics ni por el ROAS que reporta Google.

1. **Solo Search para partir.** Nada de Performance Max sin historial de
   conversiones ni loop offline (optimiza a "volumen barato"). PMax/AI Max
   después, con guardrails.
2. **3–4 campañas temáticas + 1 de marca**, no 9. Con presupuesto modesto, 9
   campañas mueren de falta de datos (Smart Bidding necesita ~15–30 conv/mes).
   Agrupar las 9 líneas por intención/margen. *Ad groups* temáticos (5–15
   keywords), **nada de SKAGs**.
3. **Cada ad group → su landing** `/servicios/<slug>` (o `/?servicio=<slug>#cotizar`
   para preseleccionar el formulario). Nunca a la home.
4. **Escalera de puja por volumen de datos:** Maximizar clics (semanas 1–4) →
   Maximizar conversiones (≥15 conv/mes) → CPA objetivo anclado al CPA real
   (≥30 conv/mes) → Maximizar valor / ROAS objetivo (con valor estable).
5. **Geo:** Región Metropolitana en modo **Presencia** (no "Presencia o
   interés"). Capas sobre comunas corporativas (Las Condes, Providencia,
   Vitacura, Santiago Centro, Huechuraba) e industriales (Quilicura, Pudahuel,
   San Bernardo). Campaña nacional aparte si se despacha a regiones.
6. **Concordancia FRASE por defecto** (AMPLIA solo con puja inteligente + datos
   + negativos). Lista de negativas robusta: empleo/trabajo/cv, gratis/barato,
   pdf/plantilla, "cómo hacer"/diy/tutorial, curso/capacitación, mayorista (si
   no se sirve), y para 3D: steam/juego/render/blender/roblox/minecraft/lentes
   3d. Minería semanal del informe de términos de búsqueda.
7. **RSA de calidad:** 12–15 títulos ÚNICOS (≤30 car.), 4 descripciones
   (≤90 car.), pin mínimo, Ad Strength Bueno/Excelente. Assets: sitelinks a cada
   `/servicios`, callouts ("Cotización 24h", "Despacho RM/todo Chile"), snippets,
   y **asset de mensaje / click-to-WhatsApp**.
8. **Estacionalidad chilena:** Oct–Dic premiaciones/regalos fin de año;
   Ago–1ª quincena Sep Fiestas Patrias (merchandising); Feb–Mar back-to-office
   (cartelería/papelería/NFC). CyberDay (jun) y CyberMonday/Black Friday
   (oct–nov) encarecen las subastas → proteger presupuesto B2B.

**El loop offline es la palanca #1** (ver §3.5 y §4.4): sin devolverle a Google
los leads calificados y las ventas reales del CRM, Smart Bidding optimiza hacia
el proxy equivocado (envíos de formulario / clics de WhatsApp).

### KPI objetivo (los que usa el ADS_AGENT)

| Métrica | Objetivo |
|---|---|
| CTR búsqueda | > 3% |
| CPC búsqueda | < $1.200 CLP |
| ROAS-real (CRM) | > 3x sano · < 1.5x = pérdida (pausar/arreglar) |
| CPA | < $8.000 CLP |
| Concentración | ninguna campaña > 50% del presupuesto total |
| Muestra | < 8 conversiones = no tomar decisiones agresivas |

Benchmarks CLP orientativos (Chile): CPC genérico ~300–500, competitivo
800–3.000; CPL B2B calificado ~8.000–25.000. **Fijar metas por el margen del
CRM, no por benchmarks externos.**

---

## 3. Operación en el dashboard (runbook)

Todo vive en la pestaña **Web → sección Google Ads**.

### 3.0 — Llaves (una vez)
Modal de ajustes ⚙ → **Token de Airtable** (habilita CRM/ROAS-real) y **Key de
Anthropic** `sk-ant-...` (habilita el botón ⚡ Análisis IA y ✨ Crear con IA).

### 3.1 — Conectar Google Ads (una vez) → §4.2
Botón **⚙ Configurar → Ver Apps Script** → crear **Script 1** (Apps Script web
app), pegar su URL en el endpoint, crear **Script 2** (Google Ads → Herramientas
→ Scripts), ejecutarlo una vez y programarlo cada hora → **💾 Guardar** →
**↺ Actualizar**. El puntito junto a "Google Ads" pasa a verde.

### 3.2 — Crear campañas
Tres caminos, todos abren el mismo modal con **todas las opciones configurables**
(concordancia, CPC, estrategia de puja + objetivo, ubicación + modo, redes,
keywords, negativas):

- **✨ Crear con IA** — describe la línea + objetivo; el agente arma la campaña
  completa (keywords, RSA, negativas, geo, puja, presupuesto, **URL al slug
  correcto**) y muestra las métricas objetivo + checklist. Revisas y guardas.
- **Campañas Sugeridas** / **+ Crear** — parte de las 9 plantillas por línea
  (ver §5.1); ya apuntan a `/servicios/<slug>`.
- **+ Nueva Campaña** — desde cero, control total.

Al guardar, la campaña se encola en **Cambios pendientes** y el **Script 2** la
crea (como borrador si `PREVIEW_NUEVAS_CAMPANAS=true`, recomendado al inicio).
Luego **↻ Verificar** confirma que se aplicó.

> Valores por defecto seguros del modal: concordancia **FRASE**, CPC **800 CLP**,
> puja **Maximizar clics**, geo **RM / Presencia**, redes **off**.

### 3.3 — Terminar en Google Ads
El borrador se revisa en **Acciones masivas → Cargas** y se publica. Lo que el
Script no aplica de forma confiable (modo de ubicación **Presencia**, socios de
búsqueda) se confirma a mano; la IA lo deja en el checklist con los valores
listos.

### 3.4 — Rutina semanal con el ADS_AGENT
**↺ Actualizar** → revisar KPIs y **ROAS Real** (panel *Ads vs Ventas CRM*) →
**⚡ Análisis IA**: diagnóstico + acciones **aplicables con 1 clic** (pausar,
subir/bajar presupuesto, negativo, pausar keyword). Marca **auto-semanal** para
recibir el análisis por email. Revisa **Palabras clave + Quality Score** y agrega
negativos a lo que gasta sin convertir.

### 3.5 — Subir conversiones offline (semanal)
Botón **⬇ Conversiones offline** → genera el CSV desde el CRM (leads
calificados + ventas) y súbelo en Google Ads. Es lo que cierra el loop. Detalle
del formato en §5.3 y del setup en §4.4.

---

## 4. Setup (una vez)

### 4.1 — Etiqueta de conversión en la web  ⚠️ pendiente
En Cloudflare, completar `NEXT_PUBLIC_GADS_CONVERSION = AW-11534474770/<ETIQUETA>`
(hoy falta la etiqueta después del `/`). **Sin esto no se registra ninguna
conversión.** Google Ads → Objetivos → Conversiones → tu acción → "Etiqueta de
conversión". Opcional: `NEXT_PUBLIC_GADS_WHATSAPP_CONVERSION` para separar el
clic de WhatsApp. Verificar con *Google Tag Assistant* que disparan `page_view`,
`lead_submitted`, `whatsapp_click` y la conversión.

### 4.2 — Los 2 scripts de sincronización
- **Script 1 — Apps Script** (`script.google.com`): pegar el código, Desplegar →
  App Web → Ejecutar como: Yo → Acceso: Cualquier persona → copiar la URL al
  endpoint del dashboard.
- **Script 2 — Google Ads Script** (`ads.google.com → Herramientas → Scripts`):
  pegar el código, actualizar `ENDPOINT` (URL del Script 1) y `CUSTOMER_ID`,
  ejecutar una vez y programar cada hora.

> **Importante:** cada vez que cambie la lógica de creación (concordancia, CPC,
> puja, negativas), hay que **re-copiar el Script 2** al panel de Google Ads.

### 4.3 — Columna GCLID en Airtable  ✅ hecho
Tabla **Clientes** (base *The Lab Solutions - Operaciones*): campos **GCLID** y
**Campaña Ads** (texto). El worker ya los rellena en cada lead de Google Ads
(además de dejar el tracking en "Notas internas" como respaldo).

### 4.4 — Las 2 acciones de conversión en Google Ads  ⚠️ pendiente
Requiere acceso a la cuenta de Google Ads (hazlo tú).

1. **Etiquetado automático: activado** (Administración → Configuración de la
   cuenta) para que exista el `gclid`.
2. **Objetivos → Conversiones → + Acción de conversión → Importar → "Otros
   orígenes de datos o CRM" → "Monitorizar conversiones a partir de clics"**.
   Crear dos, con el **nombre EXACTO** que usa el CSV:

   | Nombre exacto | Categoría | Valor | Conteo | Marcar como |
   |---|---|---|---|---|
   | `Lead calificado CRM` | Cliente potencial | sin valor (o fijo) | Una | Secundaria al inicio |
   | `Venta CRM` | Compra | usar valores del CSV | Una | **Primaria** |

3. Subir el CSV en **Conversiones → Cargas → + → Subir archivo**. Repetir
   semanalmente (dentro de los **90 días** del clic).

---

## 5. Referencia

### 5.1 — Las 9 líneas (plantillas `ADS_LINEAS`)

Cada plantilla usa `id = slug` y apunta a `https://thelab.solutions/servicios/<slug>`.

| Slug | Línea | Ppto/día sugerido |
|---|---|---|
| `activaciones` | Activaciones | $6.000 |
| `premiaciones` | Premiaciones (galvanos/trofeos/medallas) | $6.000 |
| `merchandising` | Merchandising (regalos corporativos) | $6.000 |
| `cajas-personalizadas` | Cajas Personalizadas (packaging) | $4.000 |
| `impresion-3d` | Impresión 3D | $8.000 |
| `volumetricos` | Volumétricos (letras corpóreas, neón/LED) | $5.000 |
| `carteleria` | Cartelería (señalética, acrílico) | $6.000 |
| `papeleria` | Papelería (imprenta corporativa) | $3.000 |
| `chip-the-lab` | Chip The Lab (tarjetas NFC) | $3.000 |

### 5.2 — Opciones del modal de campaña

`concordancia` (FRASE/EXACTA/AMPLIA) · `maxCpc` (CLP) · `pujaEstrategia`
(MAXIMIZE_CLICKS / MANUAL_CPC / MAXIMIZE_CONVERSIONS / TARGET_CPA / TARGET_ROAS)
· `pujaObjetivo` (CPA o ROAS) · `ubicaciones` + `ubicModo` (PRESENCE) · `redSocios`
· `redDisplay` · `palabrasClave` · `negativas` · anuncio RSA (finalUrl, paths,
títulos, descripciones).

**Qué aplica el Script 2 automáticamente:** concordancia, CPC máximo, estrategia
de puja (+ objetivo CPA/ROAS), keywords, RSA, presupuesto, estado y **negativas**
(best-effort). **Qué se confirma a mano en Google Ads:** modo de ubicación
(Presencia) y socios de búsqueda.

### 5.3 — Formato del CSV de conversiones offline

```
Parameters:TimeZone=America/Santiago
Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency
Cj0abc...,Venta CRM,2026-06-28 09:00:00,1000000,CLP
```

- **Leads calificados** → `Lead Score IA ≥ umbral` (default 6) o etapa avanzada
  (Propuesta enviada / Negociación / Cliente activo). Valor opcional.
- **Ventas** → pedidos no cancelados, valor neto (monto ÷ 1,19).
- El `gclid` sale de la columna **GCLID**; si falta (leads históricos), se extrae
  de "Notas internas". Fechas en zona `America/Santiago`.

### 5.4 — Límites conocidos

- El **ROAS-real por campaña** es una estimación (reparte el ingreso del CRM por
  participación en conversiones), no atribución exacta. Se vuelve confiable
  cuando el loop offline está activo.
- La acción **"Eliminar" campaña solo la PAUSA** en Google Ads.
- Las acciones del agente `keyword_exacta` y `generar_copy` **no se aplican
  solas** (requieren un paso manual).
- El modo geo **Presencia** y los **socios de búsqueda** no se setean vía Ads
  Script → confirmar a mano (o desde la propia UI de la campaña).
- El `gclid` caduca a los **90 días**: subir el CSV con esa frecuencia.

---

## 6. Checklist rápido de puesta en marcha

- [ ] `NEXT_PUBLIC_GADS_CONVERSION` con la etiqueta real (§4.1)
- [ ] Script 1 desplegado + endpoint guardado en el dashboard (§4.2)
- [ ] Script 2 pegado en Google Ads, ejecutado y programado (§4.2)
- [x] Columna **GCLID** en Airtable (§4.3)
- [ ] Acciones `Lead calificado CRM` y `Venta CRM` creadas en Google Ads (§4.4)
- [ ] Etiquetado automático activado en Google Ads (§4.4)
- [ ] Primeras 3–4 campañas Search creadas (§3.2) y terminadas en Google Ads (§3.3)
- [ ] Rutina semanal: ⚡ Análisis IA + ⬇ Conversiones offline (§3.4–3.5)
