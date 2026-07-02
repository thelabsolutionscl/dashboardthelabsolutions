# Tabla `Precios_Referencia` (Airtable) — Fase 2

Alimenta el rango referencial que el agente de voz puede leer en la llamada (tool
`estimar_cotizacion`). **Mientras esta tabla no exista o esté vacía, el agente no da
montos** (cae al mensaje "cotización en menos de 24 h" — comportamiento Fase 1). No hay
que tocar código para encenderla: basta crear la tabla y cargar filas.

## Esquema

Crear en la misma base de Airtable (`AIRTABLE_BASE_ID`) una tabla llamada
**`Precios_Referencia`** con estos campos:

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `Línea` | Single line text | **Sí** | Debe calzar con una de las 9 líneas (ej. `Merchandising`). Se compara sin distinguir mayúsculas. |
| `Cantidad mínima` | Number | No | Piso del tramo de cantidad. Vacío = sin piso. |
| `Cantidad máxima` | Number | No | Techo del tramo. Vacío = sin techo. |
| `Precio desde` | Number (CLP) | No* | Valor unitario mínimo del rango. |
| `Precio hasta` | Number (CLP) | No* | Valor unitario máximo del rango. |
| `Nota` | Single line text | No | Matiz que se lee entre paréntesis (ej. "según complejidad"). |

\* Si una fila no tiene ni `Precio desde` ni `Precio hasta`, el agente no da monto para
esa fila (cae al fallback). Con solo uno de los dos, dice "desde $X por unidad".

## Cómo elige la fila el agente

1. Filtra las filas cuya `Línea` calza con el servicio pedido.
2. Entre esas, toma la primera cuyo tramo `[Cantidad mínima, Cantidad máxima]` contenga la
   cantidad mencionada por el cliente (mínima/máxima vacías = tramo abierto por ese lado).
3. Si no se conoce la cantidad o ninguna calza, usa la primera fila de la línea.
4. Formatea: `Como referencia, el valor unitario va en torno a $X a $Y por unidad (Nota).
   Es un rango referencial y sujeto a confirmación; la cotización final la afinamos hoy.`

## Ejemplo de filas (valores de ejemplo, reemplazar por los reales)

| Línea | Cantidad mínima | Cantidad máxima | Precio desde | Precio hasta | Nota |
|---|---|---|---|---|---|
| Merchandising | 100 | 500 | 2500 | 4500 | según complejidad |
| Merchandising | 501 | 2000 | 1800 | 3200 | por volumen |
| Premiaciones | 1 | 50 | 12000 | 30000 | galvano estándar |
| Impresión 3D | 1 | 10 | 15000 | 60000 | según tamaño y material |

> Los montos son **referenciales** y se comunican siempre como "sujeto a confirmación".
> No reemplazan la cotización formal del `QUOTE_AGENT` / equipo.
</content>
