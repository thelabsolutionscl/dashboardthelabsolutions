# Consumo Anthropic: política de ahorro y guardrails

## Objetivo

Ningún componente de The Lab Solutions debe poder gastar Anthropic fuera del
`airtable-proxy`. La API key real vive únicamente como el secret
`ANTHROPIC_TOKEN` de ese Worker.

Claude Code debe usar otro workspace/credencial y nunca la key del dashboard.

## Política del dashboard

- Haiku 4.5 por defecto para redacción, clasificación, seguimiento, contenido,
  newsletter, prospección, SEO y agentes sociales.
- Sonnet 4.6 sólo para `CEO`, `FINANCE`, `ADS`, `PRODUCTION` y
  `MANTENCION3D`.
- Opus, Fable y modelos no revisados están bloqueados server-side.
- Cada agente tiene `maxTokens`; el helper general limita la salida.
- System prompts estáticos usan `cache_control: ephemeral`.
- El contexto dinámico se recorta a 9.000 caracteres.
- Llamadas idénticas en curso se coalescen.
- Sólo un 429 puede reintentarse; los 5xx no disparan otra generación.
- El navegador no acepta ni almacena una API key Anthropic. Incluso localhost
  necesita el Proxy Worker.

## KAI

- Haiku es el modelo normal.
- Sonnet se usa sólo cuando la consulta requiere razonamiento complejo.
- Máximo 2 rondas pagadas por turno.
- Máximo 1 delegación por turno.
- Sólo conserva los últimos mensajes relevantes.
- KAI también pasa exclusivamente por `airtable-proxy`.

## Simulación y slicer

- No existe fallback directo a `api.anthropic.com`.
- Simulación usa Haiku y limita la salida a 4.000 tokens.
- Slicer y simulación fallan cerrado si el proxy no está configurado.

## Hard cap del Proxy Anthropic

`airtable-proxy` decide el gasto antes de contactar a Anthropic.

```toml
ANTHROPIC_DAILY_BUDGET_USD = "0.50"
ANTHROPIC_REQUEST_BUDGET_USD = "0.10"
```

Además:

- El ledger vive en un Durable Object (`AI_BUDGET_GUARD`) y serializa las
  reservas; no existe carrera read-modify-write entre llamadas simultáneas.
- Máximo **1 solicitud Anthropic simultánea**.
- La reserva previa usa una estimación conservadora.
- La respuesta se reconcilia con el usage real de Anthropic de forma idempotente.
- Si el guard no está disponible, la petición falla cerrada.
- `/anthropic/usage` entrega gasto, saldo, solicitudes y atribución por fuente
  sin ejecutar modelos.
- Sólo están permitidos Haiku 4.5 y Sonnet 4.6.

## Lead worker

El `lead-worker` ya no posee `ANTHROPIC_API_KEY` ni llama directamente a
Anthropic. Cualquier scoring de leads o piloto de Ads usa
`AI_PROXY_URL + AI_PROXY_KEY` y entra por `airtable-proxy`, por lo que comparte
el mismo hard cap diario.

`AUTO_PROCESS_LEADS=false` y `ADS_AUTOPILOT=false` siguen siendo los valores
por defecto. El tope de cantidad de leads automáticos permanece como defensa
adicional.

GitHub Actions sincroniza `AI_PROXY_KEY` al lead-worker desde el secret
`PROXY_KEY`; no copia `ANTHROPIC_TOKEN`.

## Alertas visibles

El dashboard consulta `/anthropic/usage` sin costo de tokens y muestra una
alerta global, visible desde cualquier sección, al superar:

- 50%: aviso.
- 75%: alerta.
- 90%: crítico.

El hard cap sigue siendo US$0,50; la alerta no reemplaza el bloqueo server-side.

## Separación de credenciales

La arquitectura esperada es:

```text
Dashboard / KAI / agentes / simulación / slicer
                    │
                    ▼
             airtable-proxy
      (US$0,50/día · US$0,10/request · 1 concurrente)
                    │
                    ▼
         Workspace TLS Dashboard
              ANTHROPIC_TOKEN

Claude Code
    │
    └── Workspace/credencial separados
```

Nunca reutilizar `ANTHROPIC_TOKEN` del dashboard en Claude Code, variables de
entorno del Mac, `.env`, OpenClaw u otros servicios.

## Si el gasto vuelve a subir

1. Revisar `CONTROL DE CONSUMO IA` en Agentes y las fuentes por costo.
2. Comparar el mismo día con Usage/Cost del workspace `TLS Dashboard`.
3. Si Anthropic muestra Opus/Fable, esa llamada no provino del proxy actual.
4. Si Anthropic muestra más de US$0,50 atribuible a la key exclusiva del
   dashboard, investigar inmediatamente el workspace/key: el proxy no debería
   poder autorizar ese gasto.
5. Confirmar que Claude Code sigue en un workspace y una credencial separados.

Usage/Cost de Anthropic es la fuente definitiva para facturación; el dashboard
mantiene telemetría operativa para detectar desvíos rápido.
