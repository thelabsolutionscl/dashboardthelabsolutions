# Consumo Anthropic: correcciones y verificación

## Cambios de esta revisión

- Ads general y por campaña ya no duplican `buildAgentContext`.
- Un timeout o error de transporte no repite automáticamente el POST. Los
  errores HTTP explícitos siguen usando el manejo de reintentos existente.
- El deploy deja de leer `secrets.CLAUDE` y vacía su placeholder; nunca publica
  la clave Anthropic, aun si falta el proxy.
- Agentes, simulaciones y rondas KAI registran los tokens informados por la API,
  separados en entrada, salida, creación y lectura de caché.
- KAI muestra tokens incluyendo caché, sin la antigua estimación monetaria parcial.
- El lead-worker registra metadatos de uso en sus logs, sin texto del lead.

## Pasos operativos

1. Revisar y fusionar el PR. El workflow de Pages publica los cambios del dashboard.
   El workflow del lead-worker publica su instrumentación si tiene credenciales.
2. Comprobar que el deploy usa PROXY_URL y PROXY_KEY y que el Worker tiene su
   ANTHROPIC_TOKEN. Sin proxy, Claude requiere una clave introducida localmente.
3. En Anthropic, consultar Usage/Cost para el período del alza, por modelo y clave.
   Guardar el total de llamadas y tokens de entrada/salida/caché. No compartir claves.
4. Si la clave pudo estar publicada: crear una nueva, actualizar ANTHROPIC_TOKEN
   en airtable-proxy y ANTHROPIC_API_KEY en lead-worker cuando compartan clave,
   comprobar funcionamiento y recién entonces revocar la anterior.
5. Comparar un análisis Ads y una consulta KAI después del despliegue.
   En consola del navegador filtrar `[anthropic-usage]`. La sesión conserva hasta
   500 registros en `sessionStorage.claude_usage_v1`. Se pueden inspeccionar con:

   ```js
   console.table(JSON.parse(sessionStorage.getItem('claude_usage_v1') || '[]'));
   ```

   Son metadatos locales de diagnóstico: no una base de facturación, no se
   sincronizan entre dispositivos y desaparecen al terminar la sesión.
   Los registros son por ruta (`agentes`, `kai`, `simulacion`), no por usuario
   autenticado o agente individual. Los streams interrumpidos pueden no registrarse.
   Consultar también los logs del lead-worker y conciliar con Anthropic.

## Límites y pendientes importantes

- No se cambiaron modelos, límites de salida ni automatización de leads.
- 200/día es un límite de ejecuciones de leads, no una medición del gasto real
  ni un presupuesto global. Su contador KV no es atómico bajo concurrencia.
- No se puede atribuir la factura histórica sólo mirando el repositorio.
- El proxy necesita autenticación server-side real y un presupuesto centralizado:
  la APP_KEY pública + Origin no evitan abuso desde un cliente HTTP.
  Rotar la clave de Anthropic no corrige por sí solo esta autorización.
- Antes de reducir rondas/modelos o contextos adicionales, medir el uso real.
- Caching de Anthropic puede bajar costos, pero no equivale a eliminar tokens;
  requiere observar `cache_read_input_tokens` y `cache_creation_input_tokens`.
  Referencia: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
