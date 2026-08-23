# Recuperación de cache del dashboard

## Síntoma corregido

En algunos navegadores, especialmente móviles con un service worker antiguo, el dashboard podía cargar sólo el fondo negro y recuperar funcionamiento después de borrar cookies/cache del sitio.

## Causa

El service worker histórico hacía dos cosas sobre las navegaciones:

1. obtenía `index.html`;
2. lo convertía a texto, inyectaba dinámicamente `maquinas-farm-controller.js`, reconstruía la respuesta y guardaba esa navegación en Cache Storage.

Ese mecanismo nació antes de que el bootstrap normal cargara el Farm Controller. Hoy es redundante. Mantenerlo permite que una pestaña controlada por un service worker antiguo combine un shell HTML transformado con assets de otro build, especialmente durante despliegues consecutivos o recuperaciones de red.

## Política nueva

- `index.html` / navegaciones: **network-only** desde el service worker, con `cache:'reload'`.
- El service worker **no modifica HTML**.
- El service worker **no guarda HTML** en Cache Storage.
- JS/CSS persistentes sólo se cachean cuando su URL incluye `?v=<build>`.
- Al activar un nuevo build se eliminan caches `thelab-*` de builds anteriores.
- Si la red no permite cargar una navegación se muestra una página explícita `Sin conexión`, no un shell cacheado potencialmente inconsistente.

## Por qué no se borran cookies ni localStorage

El arreglo no destruye datos de sesión ni preferencias. El problema se resuelve en la capa de Cache Storage/service worker, por lo que no se necesita pedir al usuario que borre datos del sitio como procedimiento normal.

## Regresión

`tests/service-worker-cache-safety.test.js` impide volver a:

- inyectar `maquinas-farm-controller.js` desde `sw.js`;
- modificar `index.html`;
- guardar la navegación en Cache Storage;
- omitir la limpieza de caches de builds anteriores.
