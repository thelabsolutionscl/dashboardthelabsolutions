# Consumo Anthropic: política de ahorro y guardrails

## Estado actual

El dashboard aplica una política **Haiku-first**. Sonnet queda reservado para análisis que realmente necesitan razonamiento más pesado.

### Dashboard

- Haiku por defecto para redacción, clasificación, seguimiento, contenido, newsletter, prospección, SEO y agentes sociales.
- Sonnet reservado a `CEO`, `FINANCE`, `ADS`, `PRODUCTION` y `MANTENCION3D`.
- Cada agente tiene un `maxTokens` específico y el helper general impide pedir más de 1.400 tokens de salida.
- Los `system prompts` se envían como bloques con `cache_control: ephemeral`.
- `buildAgentContext()` recorta el contexto dinámico a 9.000 caracteres.
- Dos llamadas idénticas al mismo agente mientras la primera sigue en curso se coalescen en una sola generación.
- Un 5xx no reintenta automáticamente una generación. Solo 429 puede reintentar.
- Se registran input, output, cache write y cache read en `sessionStorage.claude_usage_v1`.

### KAI

- Haiku es el modelo normal.
- Sonnet se selecciona solo para consultas que piden explícitamente análisis, estrategia, diagnóstico, proyección, rentabilidad, finanzas, Ads u otro razonamiento comparable.
- Máximo **2 rondas** pagadas por turno.
- Máximo **1 delegación** a otro agente por turno.
- Se envían solo los últimos 6 mensajes relevantes.
- Las reglas estáticas usan prompt caching.
- KAI etiqueta sus llamadas como `kai` para atribución de gasto.

### Proxy Anthropic

`airtable-proxy` aplica el control principal de costo antes de llegar a Anthropic.

- Presupuesto diario por defecto: **US$1,00**.
- Reserva máxima estimada por solicitud: **US$0,20**.
- El presupuesto se decide en un **Durable Object** (`AI_BUDGET_GUARD`) que serializa reserva, conciliación y liberación; así dos llamadas simultáneas no pueden leer el mismo saldo y sobrepasar el tope.
- KV (`AI_BUDGET`) se conserva solo para migrar de forma conservadora el saldo del día desde el guard anterior.
- Además hay un máximo de **2 solicitudes Anthropic simultáneas** en el proxy.
- La estimación previa usa 3 caracteres/token para reservar de forma conservadora.
- Cuando Anthropic devuelve usage verificable, la reserva se reconcilia con el costo real de forma idempotente.
- Si el guard de costo/KV no está disponible, Anthropic falla cerrado.
- `/anthropic/usage` permite al dashboard leer gasto, saldo y atribución por agente sin ejecutar modelos.
- Modelos fuera del allowlist siguen bloqueados.

Los valores se cambian en `airtable-proxy/wrangler.toml`:

```toml
ANTHROPIC_DAILY_BUDGET_USD = "1.00"
ANTHROPIC_REQUEST_BUDGET_USD = "0.20"
```

### Captación automática de leads

El procesamiento automático queda **desactivado por defecto**:

```toml
AUTO_PROCESS_LEADS = "false"
AUTO_PROCESS_DAILY_CAP = "25"
AI_DAILY_BUDGET_USD = "0.50"
```

Si se reactiva, necesita KV; sin KV falla cerrado. El scoring de un lead usa Haiku y una salida acotada. El piloto de Ads continúa desactivado por defecto.

## Panel de control

En **Agentes** aparece `CONTROL DE CONSUMO IA` con gasto usado hoy, presupuesto diario, saldo disponible, solicitudes del día, tokens de la sesión actual y atribución por fuente/agente.

El panel consulta `/anthropic/usage`; no hace ninguna llamada pagada.

## Qué revisar si vuelve a subir el gasto

1. Revisar el panel de Agentes y ordenar las fuentes por costo.
2. Comparar con Usage/Cost de Anthropic para el mismo día.
3. Revisar si alguien reactivó `AUTO_PROCESS_LEADS`.
4. Revisar KAI: una consulta normal debería usar Haiku y no más de dos rondas.
5. Confirmar que `cache_read_input_tokens` aparece en agentes repetitivos.
6. Si hace falta, bajar `ANTHROPIC_DAILY_BUDGET_USD` en el proxy.

## Nota

El presupuesto del proxy cubre las llamadas que pasan por `airtable-proxy`. El `lead-worker` tiene su propio presupuesto diario porque llama a Anthropic server-to-server. Usage/Cost de Anthropic sigue siendo la fuente definitiva para conciliar facturación real.
