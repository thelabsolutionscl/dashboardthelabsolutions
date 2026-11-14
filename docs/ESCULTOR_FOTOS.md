# Escultor de fotos — imagen → STL

Herramienta del **Taller** (Máquinas → Taller → *Escultor de fotos*) que convierte
una foto en una pieza imprimible y la descarga como STL binario.

- `js/foto3d.js` — núcleo geométrico (relieve, base, malla cerrada, STL), visor WebGL e interfaz.
- `js/foto3d-hy3d.js` — cliente de Hunyuan3D, **corre como Web Worker**.
- `js/foto3d-glb.js` — lee y limpia la malla GLB, la orienta y rasteriza su vista frontal.
- `scripts/hy3d-smoke.js` — prueba en vivo del servicio, de punta a punta (ver «Verificar»).
- Vista: `data-maq-view="escultor"` en `index.html`, en la pantalla `taller` de `js/maquinas-operaciones.js`.
- Tests: `tests/foto3d.test.js`, `tests/foto3d-glb.test.js`, `tests/foto3d-hy3d.test.js`.

## Decisión de motor (2026-11-14): Hunyuan3D, gratis, reemplaza el motor local

Hasta el 2026-11-10 la herramienta estimaba la profundidad con Depth Anything V2
Small en el navegador (relieve 2,5D con el reverso inventado). Tras tres pruebas
reales con una moto el resultado seguía sin la definición esperada, y se decidió
usar **Hunyuan3D (Tencent)**, que genera el objeto 3D completo, y reemplazar el
motor local. Se eligió lo gratis: los **Spaces públicos de Tencent en Hugging Face**
(ZeroGPU), no una API de pago.

| Decisión | Por qué |
|---|---|
| Hunyuan3D en Spaces de Hugging Face | Es el único camino gratis: el modelo necesita GPU de servidor (no corre en el navegador ni en el entorno de desarrollo). |
| Dos modos: **Rápido** (`Hunyuan3D-2mini-Turbo`, 5 pasos) y **Estándar** (`Hunyuan3D-2`, 30 pasos) | El mini-Turbo gasta pocos segundos de GPU por pieza, así que rinde más cuota gratis; el 2.0 completo da más detalle pero ~30 s por pieza. |
| Se elimina Depth Anything, `foto3d-worker.js` y el respaldo "relieve desde el brillo" | Es lo que pidió el usuario (reemplazar). Está en el historial de git (commit `0329857` y anteriores). |
| La foto se envía a un servidor público | Inevitable con un Space. Se pide confirmación la primera vez y la interfaz lo avisa. |
| Todo lo demás sigue en el navegador | Limpieza de la malla, relieve y STL no salen del equipo. |
| El cliente corre en un Web Worker | La foto sólo sale de la página desde ahí, el código del cliente no toca el DOM ni `localStorage` (donde el dashboard guarda claves) y la espera no congela la interfaz. |
| Salida sólo **descarga STL** | Elección del usuario. |

## Cómo funciona

1. **Foto** ≤ 1024 px. Si es PNG con transparencia se usa tal cual; si no, el Space quita el fondo.
2. **Generar** (botón; nunca automático: gasta cuota y envía la foto). El worker habla con el Space por la API HTTP de Gradio 4.44:
   `GET /config` → `POST /upload` → `POST /call/shape_generation` → `GET /call/shape_generation/{id}` (eventos SSE) → descarga del GLB.
3. **Limpieza** (`cleanGLB`): lee el GLB con sus transformaciones de nodo, **suelda** vértices, quita **islas** sueltas (< 1 % de la mayor), **cierra agujeros** pequeños (≤ 300 aristas, con un fan desde el centroide), endereza la malla si venía invertida y mide aristas abiertas y no-manifold.
4. **Colocación** (`placeMesh`): el GLB es Y arriba y su frente mira a +Z; la pieza usa Z arriba y el frente hacia −Y. Se gira (opción «Girar la pieza»), se escala al lado mayor pedido y se apoya en la cama (z = 0).
5. **Formas**:
   - **Objeto 3D** (`buildSolido3D`): la malla completa, con **base** opcional ovalada o rectangular (el cuerpo se hunde 1,5 mm en ella). Avisa si sin base puede volcarse (el centro de masa cae fuera de los puntos que apoyan).
   - **Medallón** y **Llavero** (`reliefFields` + `buildModel`): relieve sobre la **vista frontal exacta del modelo** (rasterizada con z-buffer). El recorte es la silueta del modelo y la profundidad es exacta: no hay ruido ni ondas. La placa del medallón lleva margen para que el objeto quepa (en la circular, el objeto queda inscrito).
6. **STL**: `writeSTL` calcula la normal de cada faceta; el sombreado suave del visor no afecta al archivo.

## Contrato con el Space

Sale del código público de los Spaces (`gradio_app.py` de `tencent/Hunyuan3D-2` y `tencent/Hunyuan3D-2mini-Turbo`, ambos en línea sobre `zero-a10g` el 2026-11-14).
`shape_generation` recibe 13 entradas, en este orden: `caption, image, mv_front, mv_back, mv_left, mv_right, steps, guidance_scale, seed, octree_resolution, check_box_rembg, num_chunks, randomize_seed`
y devuelve `[archivo GLB, html, estadísticas, semilla]`. Valores usados: guidance 5, `num_chunks` 8000, octree 256 (196 en «Malla liviana»), semilla 1234 (cambia con «Otra variante»), `randomize_seed` apagado.
Si el Space deja de exponer `shape_generation`, el cliente lo detecta **antes** de subir la foto y avisa que la API cambió.

## Cuota gratis, errores y límites

- **ZeroGPU da una cuota diaria de GPU compartida.** Las fuentes de Hugging Face se contradicen (2 / 3,5 / 25 min o 2 / 5 / 40 min al día para sin cuenta / cuenta gratis / PRO); en la práctica son unas pocas piezas al día en modo Estándar y bastantes más en Rápido. Un **token de Hugging Face** opcional («Avanzado») usa la cuota de esa cuenta.
- Errores con mensaje propio: cuota agotada (con el tiempo de espera que informe el servicio), servicio saturado, Space dormido, sin conexión, API cambiada, malla inválida, inactividad (90 s sin respuesta) y cancelación. Tras un error se conserva la pieza anterior.
- Es un servicio **compartido y sin garantías**: puede tener cola de minutos, cambiar o dejar de existir.
- La malla de Hunyuan3D a octree 256 tiene cientos de miles de triángulos: el STL pesa decenas de MB.
- Medallón y llavero usan sólo el **cuerpo más grande** de la silueta (una llave debe ser una sola pieza).

## Licencia y privacidad

- **Licencia:** Hunyuan3D 2.0 se distribuye bajo la *Tencent Hunyuan 3D 2.0 Community License* (`LICENSE` del Space): uso comercial permitido y sin regalías, **excepto** (a) en la **UE, el Reino Unido y Corea del Sur**, donde la licencia no aplica y no se puede usar el modelo ni sus resultados, y (b) sobre **1 millón de usuarios activos al mes**, que exige pedir licencia a Tencent. Tencent no reclama derechos sobre los resultados. Se *recomienda* (no se exige) indicar «Powered by Tencent Hunyuan 3D». **Ojo:** el comentario del encabezado de `gradio_app.py` dice «NON-COMMERCIAL LICENSE», contradiciendo al `LICENSE`; rige el `LICENSE`, pero conviene confirmarlo con Tencent o un abogado antes de venderlo a clientes fuera de Chile.
- **Privacidad:** el Space es público y compartido; guarda temporalmente las entradas y salidas en su servidor. No subir fotos de clientes (rostros, mascotas con dueño identificable) sin su permiso.

## Verificar contra el servicio real

Las pruebas automáticas usan un servidor Gradio simulado que reproduce el contrato leído en el código del Space; **no prueban el servicio en vivo**. Para eso:

```bash
node scripts/hy3d-smoke.js --check     # sólo comprueba la conexión; no usa GPU ni sube fotos
node scripts/hy3d-smoke.js             # genera una pieza (usa cuota) y escribe hy3d-smoke.stl
```

Usa el mismo cliente y la misma limpieza que la herramienta e informa cada paso. En la herramienta, **Avanzado → Probar conexión** hace la misma comprobación sin gastar cuota.

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


## Motor de render (2026-11-14)

Al ampliar las capturas de una prueba real aparecieron dos defectos que no vienen
del modelo de profundidad que se usaba entonces. Se reprodujeron con una profundidad perfectamente lisa: facetas en
bandas y "pliegues de cortina" en las paredes.

| Hallazgo | Causa | Corrección |
|---|---|---|
| Dentado en las pendientes | Todas las celdas se partían por la misma diagonal | Cada celda une sus dos esquinas de altura más parecida (la arista sigue crestas y valles). Con el contorno corrido se usa la diagonal que no voltea caras |
| Facetas, bandas y paredes plisadas en el visor | Sombreado plano: una normal por triángulo | `buildSolid` entrega normales por vértice (relieve, reverso y paredes por separado, para que el canto siga nítido) y el visor sombrea suave, con luz principal, relleno, contraluz y luz de cielo. Botón **Facetas** para ver los triángulos reales, como en un laminador |
| La cuadrícula del plato se veía sobre la pieza | Al mirar desde abajo queda por delante | Sólo se dibuja con la cámara sobre el plato |
| Reconstrucción lenta | Percentiles con `Array.sort` y relleno con desenfoques exactos | Arreglo tipado y gaussiana por cajas: ~205 ms a 300 celdas |

El sombreado suave es sólo de pantalla: `writeSTL` calcula su normal por
faceta y el archivo no cambia por las normales (hay un test). La diagonal
adaptativa sí cambia el STL, para mejor.

## Historial: el motor de profundidad (eliminado el 2026-11-14)

Lo aprendido con Depth Anything V2 por si algún día se vuelve a un motor local:
- Fuera de los 518 px de su entrenamiento y en fp16 sobre GPU, el ViT podía desbordarse y devolver valores basura (picos agudos en la malla) y hasta `NaN`/infinito, que llegaban a los vértices y dejaban el STL corrupto. Se defendía con 518 px por defecto, mediana por píxel entre pasadas, mediana 3×3 antes del filtro guiado y relleno de valores no finitos.
- Deja ondas con el paso de sus parches de 14 px; se cancelaban promediando pasadas con la imagen corrida medio parche y espejada (−81 % en CPU, −84 % en GPU).
- Depth Anything V2 Small es Apache-2.0; Base y Large son CC-BY-NC.
- Nunca se pudo ejecutar el modelo real en el entorno de desarrollo (red y permisos), así que su calidad se ajustó con modelos simulados.

## Cómo probar en local

```bash
node --test tests/foto3d.test.js tests/foto3d-glb.test.js tests/foto3d-hy3d.test.js
```
