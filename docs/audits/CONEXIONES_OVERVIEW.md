# Centro de conexiones de OVERVIEW

## Montaje

El archivo js/operativo-visual.js carga js/operativo-conexiones.js con el hash del build. El nuevo módulo agrega su propio CSS versionado. El resumen se presenta en OVERVIEW y el diálogo contiene 16 integraciones, filtros por categoría, diagnóstico, dependencia afectada, último OK y reparación guiada.

## Semáforo

- Verde: prueba de lectura autorizada exitosa en los últimos 15 minutos.
- Amarillo: advertencia, prueba caducada o problema de red, CORS o autorización cuya causa exacta no está confirmada.
- Rojo: error HTTP 5xx confirmado por el servidor del servicio comprobado.
- Gris: aún no probado, no configurado o integración sin endpoint seguro de solo lectura.

Las revisiones automáticas se ejecutan cada cinco minutos con sesión autenticada, pestaña visible y fuera del modo demo. Solo hay consultas GET y lecturas específicas del CRM; IMAP se prueba a solicitud del usuario. El historial guarda únicamente servicio, estado y hora, localmente, aislado por cuenta y con 80 entradas como máximo.

## Verificaciones reales

| Integración | Alcance |
|---|---|
| Proxy CRM Cloudflare | GET /health |
| Airtable | Una lectura autenticada del CRM en una tabla permitida por el rol |
| Google Calendar | Una lectura con el token vigente; no demuestra sincronización |
| Google Drive | Una lectura de archivos con el token vigente; no sube documentos |
| IMAP | Bajo demanda, consulta de carpetas; no abre ni marca correos |
| Resend | No tiene prueba segura en frontend; gris y guía de revisión |
| Impresoras | GET /healthz; no demuestra que cada cámara funcione |
| Worker SII | GET /health y banderas de certificado/autenticación; no consume folios |
| Worker de leads | GET /health; no envía formularios |
| GitHub Pages | Última ejecución de deploy y versión del build si está disponible |
| Claude y OpenAI | Solo presencia de configuración en el proxy; no consume tokens |
| Make, Google Ads, Meta y WordPress | Guías sin comprobación activa hasta contar con endpoints seguros |

## Reparación y seguridad

Calendar y Drive permiten reconectar mediante el flujo OAuth existente tras un clic explícito. Los demás servicios disponen de diagnóstico de solo lectura, guía de reparación y acceso a la sección correspondiente. No se introducen ni guardan claves en el monitor. Tampoco se ejecutan webhooks, peticiones de IA pagadas, emisiones tributarias, envíos de correo, reinicios del bridge ni mutaciones del CRM.

## Pendientes al validar en producción

1. Comprobar OAuth de Google en navegador y en Tauri/macOS, permisos Cloudflare Access y CORS.
2. Para Resend, Make, Ads, Meta y WordPress, crear endpoints backend autenticados de solo lectura antes de habilitar verificaciones y semáforos verdes.
3. Conectar las URLs de Workers SII y leads cuando falten en la configuración del despliegue.
4. Los flujos completos (evento sincronizado, correo entregado, lead procesado, cámara operativa) requieren telemetría y recibos adicionales; una respuesta HTTP no basta.
5. La vigilancia del navegador no reemplaza un monitor externo 24/7.

Pruebas: node --test tests/operativo-conexiones.test.js y suite global.
