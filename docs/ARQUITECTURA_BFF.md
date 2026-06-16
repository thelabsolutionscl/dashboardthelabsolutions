# Arquitectura objetivo — Backend-for-Frontend (BFF)

> Plan para eliminar de raíz la exposición de secretos en el cliente y centralizar
> la seguridad, el rate-limit y la cola de agentes. Reemplaza el patrón actual de
> "secretos inyectados con `sed` en un `index.html` público".

## Problema que resuelve

Hoy el dashboard es HTML estático en GitHub Pages con `AIRTABLE_TOKEN`, `OPENAI_KEY`,
`ANTHROPIC_KEY` y `PROXY_KEY` inyectados en el cliente (`deploy.yml` → `_DEFAULTS`).
Cualquiera con la URL puede extraerlos. El `airtable-proxy` existe pero su `PROXY_KEY`
también viaja en el HTML, anulándolo. Además la cola de agentes solo corre con el
dashboard abierto y sufre condiciones de carrera.

## Principio

**El navegador no debe tener NINGÚN secreto de proveedor.** Solo guarda un token de
sesión de usuario (JWT corto). Todo lo demás vive en un único Worker (el BFF), que
es la única puerta a Airtable, Anthropic, OpenAI, SII y el printer-bridge.

```
Navegador (dashboard)
  │  Authorization: Bearer <JWT de sesión>     (nada de tokens de proveedor)
  ▼
BFF Worker  (Cloudflare)
  ├─ /auth/login         → valida usuario, emite JWT (HttpOnly cookie o token)
  ├─ /airtable/*         → firma con AIRTABLE_TOKEN (whitelist tablas/métodos)
  ├─ /ai/anthropic       → firma con ANTHROPIC_KEY (server-side)
  ├─ /ai/openai          → firma con OPENAI_KEY (server-side)
  ├─ /sii/*              → firma con SII_API_KEY hacia sii-worker
  └─ /queue/process      → procesa Agent_Queue con lock (Durable Object/KV)
        secretos en  ►  Cloudflare Worker Secrets (wrangler secret put)
```

## Fases de implementación

### Fase 2a — Cerrar el proxy actual (ya en curso, bajo riesgo)
- `airtable-proxy`: CORS por allowlist (`ALLOWED_ORIGINS`), comparación de clave en
  tiempo constante, whitelist de métodos/rutas (bloquea `DELETE` y `/v0/meta` salvo
  `ALLOW_UNSAFE=true`). **Hecho en esta rama.**
- Añadir ruta `/openai/*` al proxy (hoy el dashboard llama a `api.openai.com` directo).
  Mientras no exista, `OPENAI_KEY` no puede salir del cliente sin romper la generación
  de imágenes. **Pendiente.**

### Fase 2b — Autenticación de usuario
- Tabla `Usuarios` en Airtable (ya existe RBAC en el cliente: `AUTH`, `RBAC`).
- Endpoint `/auth/login` en el BFF: valida credenciales contra `Usuarios`
  (hash con `PBKDF2`/`bcrypt`, nunca texto plano), emite JWT firmado con `JWT_SECRET`
  (exp. 8 h) que incluye `{ sub, role }`.
- El dashboard guarda el JWT (preferible cookie `HttpOnly`+`Secure`+`SameSite=Strict`).
- Cada request del dashboard al BFF lleva el JWT; el BFF valida firma y `role` (RBAC
  server-side, no confiar en el cliente).

### Fase 2c — Migrar llamadas del dashboard
- Reemplazar en `index.html`:
  - `https://api.airtable.com/v0/...`  → `BFF/airtable/...`
  - `_callClaudeRaw` / fetch directo a Anthropic → `BFF/ai/anthropic`
  - fetch directo a OpenAI → `BFF/ai/openai`
- Eliminar de `_DEFAULTS` y de `deploy.yml` la inyección de `AIRTABLE_TOKEN`,
  `OPENAI_KEY`, `ANTHROPIC_KEY`, `PROXY_KEY`. El cliente solo conoce la URL del BFF.

### Fase 2d — Cola de agentes server-side
- Mover `processAgentQueueItem` al BFF, disparado por:
  - Cron de Cloudflare (cada N minutos) **o**
  - el `lead-worker` tras crear la tarea (`AUTO_PROCESS_LEADS`).
- Lock real con **Durable Object** o KV con CAS: una tarea solo la toma un worker.
  Elimina el doble procesamiento (hoy mitigado en cliente con relectura TOCTOU).
- El dashboard pasa a ser solo lectura/supervisión de resultados.

## Checklist de migración de secretos

| Secreto | Hoy | Objetivo |
|---|---|---|
| `AIRTABLE_TOKEN` | inyectado en HTML | `wrangler secret` en BFF |
| `ANTHROPIC_KEY` | inyectado + localStorage | `wrangler secret` en BFF |
| `OPENAI_KEY` | inyectado + localStorage | `wrangler secret` en BFF |
| `PROXY_KEY` | inyectado en HTML | reemplazado por JWT de sesión |
| `SII_API_KEY` | (no existía) | `wrangler secret` en BFF y en sii-worker |

## Acciones inmediatas del equipo (no son código)
1. **Rotar YA** `AIRTABLE_TOKEN`, `OPENAI_KEY`, `ANTHROPIC_KEY`, `PROXY_KEY`:
   deben considerarse comprometidos si el sitio se desplegó alguna vez.
2. Acotar el PAT de Airtable al mínimo scope (solo tablas usadas, sin `schema.bases:write`).
3. Definir `JWT_SECRET`, `SII_API_KEY`, `ALLOWED_ORIGINS` como secrets del Worker.
