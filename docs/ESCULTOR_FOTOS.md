# Escultor de fotos — imagen → STL

Herramienta del **Taller** (Máquinas → Taller → *Escultor de fotos*) que
convierte una foto en una pieza imprimible y la descarga como STL binario.

- Código: `js/foto3d.js` (núcleo geométrico + visor WebGL + interfaz) y
  `js/foto3d-worker.js` (IA de profundidad en un Web Worker).
- Vista: `data-maq-view="escultor"` en `index.html`, agrupada en la pantalla
  `taller` de `js/maquinas-operaciones.js`.
- Tests: `tests/foto3d.test.js` (mallas cerradas, tamaños, cableado).

## Decisiones (2026-11-10)

| Decisión | Por qué |
|---|---|
| **IA de profundidad local** (Depth Anything V2 **Small**, transformers.js 3.8.1) | Sin servidor, sin costo por uso, la foto no sale del navegador. El modelo (~27 MB en CPU, ~50 MB en GPU) se descarga una vez desde Hugging Face y queda en la caché del navegador. |
| **No** a "foto → objeto 360°" | Los modelos que reconstruyen el objeto completo pesan GB y necesitan GPU de servidor. La IA local da un **frente esculpido** (2,5D) que se ve bien de frente y en ¾; el reverso es plano o un espejo suavizado del frente. Si algún día hace falta 360°, va como un Worker de Cloudflare aparte con API externa (costo por modelo). |
| Sólo el modelo **Small** | Small es Apache-2.0 (uso comercial OK). Base y Large de Depth Anything V2 son **CC-BY-NC**: no usarlos. Un test lo vigila. |
| Respaldo sin IA | Si el CDN o Hugging Face no responden, el relieve sale del **brillo** de la imagen (claro = alto) y la herramienta sigue funcionando. |
| GPU → CPU | Se intenta WebGPU con fp16 si la tarjeta soporta `shader-f16`; si falla al cargar o al ejecutar, se reintenta en WASM con el modelo q8. |
| **IA en un Web Worker** (2026-11-10, revisión) | transformers.js viene de jsDelivr: en la página tendría acceso a `localStorage`, donde el dashboard guarda claves (`proxy_key`, `printer_device_token`…). En el worker no ve `localStorage` ni el DOM y la inferencia no congela la interfaz. Sigue pudiendo hacer `fetch` con cookies, así que el aislamiento es parcial. |
| Worker nuevo tras un error | Un `import()` fallido queda en caché en ese contexto: sin descartar el worker, "Recalcular IA" nunca volvía a pedir el módulo. |
| Una inferencia a la vez | ONNX Runtime no admite dos `run` simultáneos en la misma sesión. El worker atiende en cola y descarta lo que quedó pendiente de fotos anteriores. |
| Salida sólo **descarga STL** | Elección del usuario. Enviar al Agente 3D o cotizar quedan como mejoras posibles. |

## Cómo funciona

1. **Imagen de trabajo** ≤ 768 px (la IA trabaja a 518 px).
2. **Profundidad** (`predicted_depth`, mayor = más cerca) normalizada p1–p99.
3. **Recorte** automático, en este orden:
   - PNG con transparencia → se usa el canal alfa;
   - borde de color parejo (estudio, dibujos) → distancia de color al fondo;
   - si no → umbral de Otsu sobre la profundidad.
   Luego apertura/cierre, componente mayor, relleno de agujeros chicos y
   corrección de celdas unidas sólo por la esquina (evita aristas no-manifold).
4. **Grilla** sobre el encuadre del sujeto: `Resolución` celdas en el lado
   mayor; cada celda promedia los píxeles que cubre (tabla de áreas sumadas).
5. **Relieve** dentro del sujeto: suavizado normalizado (el fondo no contamina
   el borde), *detalle fino* = paso alto del brillo, curva γ, invertir.
6. **Alturas por forma** (mm):
   - *Figura con base*: frente `T/2 + R·d`, reverso `−(T/2 + R·vol·d)`,
     bordes redondeados por transformada de distancia; el borde inferior se
     corta plano y se hunde ~1,5 mm en una base ovalada o rectangular. Se
     exporta de pie, con el frente hacia −Y.
   - *Medallón*: placa (rectangular, redondeada, ovalada o circular) de grosor
     `T`, marco opcional y agujero para colgar; el relieve se apaga antes del marco.
   - *Llavero*: silueta con reverso plano y argolla (agujero pasante) sobre
     el punto más alto del sujeto.
   - *Solo el objeto*: como la figura, sin base, reverso plano o redondeado.
7. **Malla**: dos campos de altura (arriba/abajo) sobre la máscara + paredes
   en el contorno. Las alturas viven en las esquinas compartidas, así que la
   malla sale **cerrada y orientada** (cada arista con exactamente dos caras).
   La figura lleva dos cuerpos que se superponen (figura + base); los
   laminadores los unen al laminar.

## Bugs corregidos en la revisión del 2026-11-10

- Llavero con dos orejas: la argolla quedaba suelta (se ubicaba entre ambas).
  Ahora va sobre el punto más alto y baja hasta apoyarse en ≥ 6 mm² de pieza.
- Figura con patas de distinto largo: una quedaba flotando sobre la base. Las
  patas que terminan hasta un 5 % (mín. 2 mm) más arriba se alargan hasta el piso.
- "Imagen completa" sumaba un margen de 3 celdas fuera de la foto (106 mm en
  vez de 100) y dejaba el llavero sin agujero.
- Si la IA fallaba rápido, la reconstrucción de la malla borraba el aviso.
- Cambiar a "Brillo" mientras la IA calculaba terminaba aplicando la IA igual.
- "Invertir relieve" no invertía el detalle fino.
- Medallón sin sujeto detectado salía plano sin avisar.
- El visor no se recuperaba si el sistema reclamaba la GPU (contexto WebGL perdido).

## Auditoría del mallador (2026-11-10, tras la primera prueba real)

Disparada por una moto de motocross impresa: ruedas como copas, paredes
plisadas y manchas. Se midió con un banco que compara el STL con la foto.

| Hallazgo | Causa | Corrección |
|---|---|---|
| Ruedas hundidas como copas | Los huecos entre rayos se rellenaban con la profundidad del fondo, y la IA (518 px) mezcla con el fondo todo lo que está a < 4 px de él | Fiabilidad medida en píxeles de la foto: lo cercano al fondo y lo rellenado toma la profundidad del interior del sujeto (`depthReliability` + `inpaint`) |
| Silueta ~4 % más gorda | Se umbralizaba el *promedio* del campo por celda: una celda con 20 % de sujeto entraba | Cobertura a resolución de la foto: la celda entra con ≥ 50 % (`maskBinary`) |
| Huecos reales rellenos y detalles borrados | Limpieza en celdas y en % del área: a 200 mm borraba detalles de 2 mm y rellenaba huecos de cientos de mm² | Limpieza en mm (`cleanMaskMM`): lo < 0,8 mm se **engrosa** a 0,8 mm (imprimible) en vez de borrarse; sólo se rellenan huecos < 0,8 mm² |
| Bordes plisados / escalonados | Contorno en escalera de la grilla + perfil smoothstep (pie plano y luego acantilado) | Vértices del borde corridos al nivel 0 de una distancia con signo suavizada (`snapContour`), alturas por vértice y perfil de cuarto de círculo (`roundProfile`) |
| Manchas oscuras en el relieve | "Detalle fino" al 15 % por defecto convertía sombras en hundimientos | Por defecto 0 % |
| Cara de apoyo podía quedar fuera de z = 0 | El grosor mínimo bajaba la cara inferior | El grosor mínimo sube la superior |
| 300 ms por reconstrucción | Desenfoques de radio grande O(n·r) | Tres pasadas de caja para σ > 3: 155 ms |

Resultado (objeto 80 mm, res. 260, profundidad sintética tipo IA):

- Malla cerrada, manifold, sin degenerados en 60 combinaciones de forma, resolución y parámetros.
- Silueta: IoU 0,946 (antes 0,913); área a > 0,4 mm fuera de la foto 0,5 % (rayos engrosados); faltante 0 %.
- Sin corrimiento: la mejor alineación es con desplazamiento (0, 0) px.
- Tamaño pedido: error ≤ 0,7 %.
- Relieve: correlación 0,995 con la profundidad de entrada.
- Caras de apoyo exactamente en z = 0; STL binario idéntico a la malla del visor.

Tests de regresión en `tests/foto3d.test.js` (sección «Fidelidad a la foto»),
con una rueda sintética: cubierta, maza y 12 rayos.

## Límites conocidos

- Es un **relieve**, no un escaneo: lo que no se ve en la foto se inventa
  (reverso espejado o plano).
- Estructuras más finas que 0,8 mm se engrosan a 0,8 mm para poder imprimirse:
  a tamaños chicos los rayos o antenas salen más gruesos que en la foto.
- El relieve es la profundidad *relativa* de la IA estirada a la "Profundidad
  del relieve" pedida: las proporciones de profundidad no son métricas.
- Fondos complejos con el sujeto a la misma distancia que el fondo dan un
  recorte pobre: usar *Ajuste del recorte*, *Fondo uniforme* o una foto con
  fondo quitado (PNG transparente).
- El STL pesa ~6–15 MB con la resolución por defecto (260). Subirla a 400
  multiplica por ~2,4 el tamaño.

## Probar

```bash
node --test tests/foto3d.test.js
```

Los tests del worker lo ejecutan en `vm` con un transformers.js falso
(cancelación en cola, GPU → CPU, errores de carga).

La inferencia de IA sólo se prueba en un navegador con acceso a
`cdn.jsdelivr.net` y `huggingface.co`.
