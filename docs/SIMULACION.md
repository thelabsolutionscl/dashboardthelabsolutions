# Simulación de demanda (panel sintético)

Sección del dashboard para probar conceptos de producto contra un panel fijo de 44
perfiles chilenos antes de gastar en prototipos.

**Archivos:** `js/simulacion.js` · panel en `index.html` (`#tab-simulacion`) ·
tests en `tests/simulacion.test.js`.

---

## Para qué sirve y para qué no

**Sirve para descartar.** Le das 20 ideas de producto con precio y te dice cuáles
no le hablan a nadie, qué las frena y a qué precio dejarían de objetar. Bajas de 20
ideas a 5 sin fabricar nada.

**No mide estética.** Los perfiles leen una descripción de texto, no ven el
producto. Un diseño precioso con mal concepto sale mal acá, y al revés. Esta
advertencia está también en pantalla porque es el límite real de la herramienta.

**No predice ventas.** No hay número de unidades que salga de acá y sea creíble.
La única prueba que manda son prototipos reales con fotos y botón de compra.

**No conoce tu competencia.** No sabe qué está cobrando el vecino en Chile hoy.

---

## Cómo se usa

1. Abre **Simulación** en el dock.
2. Elige la **línea de producto**. El contexto se rellena solo; edítalo si el
   concepto cambió (por ejemplo, si la marca ya tiene trayectoria).
3. Elige **quién opina**: panel completo, solo consumidor final o solo negocios.
   Poner a un panadero a opinar sobre una lámpara de dormitorio ensucia el
   resultado.
4. Escribe los **conceptos**, uno por línea, con el precio después de `|`:
   ```
   Lámpara de mesa tubo de neón ámbar, base de madera | 49900
   Aplique de pared impreso en 3D, patrón orgánico | 34900
   Lámpara colgante de acrílico translúcido | 79900
   ```
   El precio es opcional pero sin él no se evalúa la objeción de precio, que suele
   ser la más informativa. Máximo 25 conceptos por corrida.
5. Opcional: **Barrido de precio**. Escribe hasta 5 precios separados por coma
   (`34900, 49900, 79900`) y cada concepto se evalúa una vez por precio,
   ignorando el precio propio de su línea. Arriba del ranking aparece una **curva
   de precio** con el porcentaje de intención por escalón: si casi no baja al
   subir, estás dejando plata en la mesa; si se desploma entre dos escalones, ahí
   está tu techo.
   Ojo: multiplica las llamadas (3 conceptos × 3 precios = 9 corridas). El
   estimado lo refleja.
6. Revisa el **costo estimado** que aparece a la derecha y pulsa **Correr panel**.

El resultado sale **ordenado de peor a mejor**, porque la pega es descartar.

---

## Cómo leer el resultado

| Veredicto | Cuándo aparece | Qué hacer |
|---|---|---|
| **DESCARTAR** | menos del 10% compraría, o nota promedio bajo 1,8 | mátalo, no fabriques |
| **DUDOSO** | entre medio | reformula el concepto o el precio y vuelve a correr |
| **PROTOTIPAR** | 25% o más compraría y nota 2,8 o más | candidato a prototipo físico |
| **SIN VEREDICTO** | el panel respondió incompleto | vuelve a correr ese concepto solo |

Los cortes son deliberadamente duros. Un producto nuevo sin marca con menos del
10% de intención declarada no despega.

### Por qué existe SIN VEREDICTO

Si la IA contesta por menos del **90%** del panel (`SIM_COBERTURA_MIN`), no se
emite veredicto y no se muestra porcentaje.

La razón: el porcentaje se calcula sobre las respuestas recibidas. Con 8
compradores sobre 20 respuestas de un panel de 44, el número sería 40% cuando la
intención real es 18% — la diferencia entre "prototipar" y "descartar". Antes eso
se reportaba en silencio. Ahora, cuando la cobertura es baja, el motor **reintenta
una vez** con el doble de techo de tokens y, si sigue incompleto, se planta.

Lo más útil de la pantalla **no es el porcentaje, son los frenos**. Si 12 de 44
perfiles dicen "no sé si aguanta el calor de la ampolleta", eso no es un problema
de producto: es una línea que te falta en la ficha.

---

## Decisiones de diseño

**Los perfiles son fijos, no generados por IA.** Si el panel cambiara en cada
corrida, la corrida del lunes no se podría comparar con la del viernes. Al editar
`SIM_PERFILES` hay que subir `SIM_PANEL_VERSION`: las corridas guardadas registran
con qué panel se hicieron y el comparador solo cruza corridas del mismo panel.

**El prompt está armado contra la complacencia.** Un LLM sin freno le pone 5 a
todo y el panel deja de discriminar. Por eso el sistema:

- le dice que en un panel real menos del 20% llega a 4-5;
- exige que, para poner 4 o 5, el perfil nombre el lugar exacto donde lo usaría;
- limita la nota a 3 si el precio supera el `tope` del perfil sin justificación;
- obliga a declarar siempre una **alternativa** (en qué gastaría esa plata).

Si algún día el panel empieza a aprobar todo, el primer lugar donde mirar es
`SIM_SYSTEM`.

**Reusa el proxy que ya existe.** Las llamadas van por `airtable-proxy`
(`/anthropic/v1/messages`), que ya guarda `ANTHROPIC_TOKEN` como secret. Sin infra
nueva ni secrets nuevos. Sin proxy configurado cae a la API key local, igual que el
resto del dashboard.

**No usa `callClaude()` del index** porque ese está fijo en `max_tokens: 1500` y
una corrida de 44 perfiles no cabe.

---

## Costo

Modelo: Haiku 4.5. Una llamada por concepto (los 44 perfiles van dentro del
prompt, no son 44 llamadas). Del orden de **$8 CLP por concepto**: una corrida de
10 conceptos cuesta unos $80 CLP.

El estimado en pantalla usa `SIM_USD_CLP` como referencia del dólar. Si el dólar se
mueve fuerte, ajusta esa constante en `js/simulacion.js`.

---

## Historial

Las corridas se guardan en `localStorage` (`thelab_simulacion_v1`, tope 30) y se
respaldan en **Monitor Sistema » SIMULACION**, el mismo patrón que usa la agenda.
No requiere tabla nueva en Airtable.

Se guarda solo el agregado por concepto, no los 44 votos crudos: el respaldo remoto
tiene tope de tamaño y el detalle no se usa para comparar corridas. Por eso, al
reabrir una corrida vieja, el detalle "ver los votos del panel" viene vacío.

Cuando corres la misma línea dos veces, cada concepto que se repite muestra el
**delta en puntos** contra la corrida anterior.

---

## Acceso

Visible para `admin`, `gerencia`, `marketing` y `demo`. No para `comercial`,
`produccion` ni `finanzas`: es una herramienta de decisión de producto, no de
operación diaria.
