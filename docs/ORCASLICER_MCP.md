# OrcaSlicer MCP dentro de MÁQUINAS

La integración permite laminar STL o 3MF usando un servidor MCP (stdio) en el equipo del Farm Controller y descargar el G-code desde el dashboard. No sustituye al laminador nativo ni cambia el camino seguro de impresión existente.

## Arquitectura

- Navegador / MÁQUINAS → Cloudflare Tunnel → Farm Controller (puerto 8347).
- GET /farm/orca/status: requiere viewer; inicializa el MCP y consulta tools/list.
- POST /farm/orca/jobs: requiere operator; recibe modelo, material, perfil opcional y STL/3MF base64 (máximo 12 MB). Responde de inmediato con un identificador, sin esperar el laminado.
- GET /farm/orca/jobs/:id: requiere operator, permite consultar el estado `running` / `done` / `error`.
- GET /farm/orca/jobs/:id/download: requiere operator y entrega directamente el archivo G-code binario; el dashboard nunca necesita recibirlo en JSON base64.
- POST /farm/orca/slice: ruta de compatibilidad anterior. Se recomienda utilizar los trabajos asíncronos.
- Farm Controller lanza el MCP local mediante stdio/JSON-RPC. El MCP recibe rutas de entrada/salida en un directorio temporal privado y devuelve G-code (máximo 32 MB) y estadísticas, si están disponibles.
- El panel NO llama Moonraker ni print/start. Para imprimir hay que importar el G-code en la gestión existente de trabajos planificados.

## Configurar en el Mac del taller

Importante: haber registrado tls-farm en Codex desde un MacBook Air solo registra el servidor en Codex en ese equipo. NO lo instala en el iMac que ejecuta Farm Controller. Esta integración exige un MCP que tenga una herramienta de laminado, no únicamente control de impresoras.

Instalar en el host del Farm Controller un servidor MCP que pueda utilizar OrcaSlicer y opere en modo stdio, con initialize, tools/list y tools/call. El servidor necesita acceso a OrcaSlicer y sus perfiles en ese equipo.

Crear el archivo privado de configuración fuera de Git, en la cuenta del usuario que ejecuta Farm Controller:

    mkdir -p "$HOME/Library/Application Support/TheLabFarm"
    nano "$HOME/Library/Application Support/TheLabFarm/orca-mcp.json"

Ejemplo recomendado para el MCP real MaxEllis/orcaslicer-mcp encontrado en el MacBook Air (instalar también en el host que ejecuta Farm Controller):

    {
      "command": "/Users/USUARIO/.local/bin/orcaslicer-mcp",
      "args": [],
      "env": {
        "ORCA_API_TOKEN": "PEGAR_TOKEN_LOCALMENTE_SIN_SUBIR_A_GIT"
      }
    }

La ruta del comando debe corresponder al equipo del taller. El token lo genera OrcaSlicer en Preferences → Remote API; debe permanecer **solo en el archivo privado del servidor**, nunca en el repositorio ni en capturas. No es necesario compartirlo con ChatGPT.

Este MCP real funciona en tres etapas: load_model(path), slice_and_wait(timeout), save_gcode(filename). El adaptador llama a las tres en orden, utiliza un directorio temporal para la exportación y comprueba los perfiles activos mediante get_status. **No selecciona ni sobrescribe perfiles**: si máquina, material o perfil no coincide, pide corregirlos manualmente en OrcaSlicer para evitar descartar ajustes sin guardar. También rechaza cargar modelos si ya hay otros objetos en la placa.

Restringir permisos:

    chmod 600 "$HOME/Library/Application Support/TheLabFarm/orca-mcp.json"

Si Farm Controller utiliza otra ruta FARM_DATA_DIR, guardar allí orca-mcp.json, o proporcionar ORCA_MCP_CONFIG_FILE con la ruta absoluta. También se admiten las variables ORCA_MCP_COMMAND, ORCA_MCP_ARGS_JSON (array JSON) y ORCA_MCP_SLICE_TOOL, que tienen prioridad sobre el archivo.

Se reconocen automáticamente los nombres de herramienta: slice, slice_model, slice_stl, slice_file, orca_slice, orcaslicer_slice, laminar, laminar_modelo. Para otro nombre, especificar sliceTool.

Para un MCP distinto del MaxEllis/orcaslicer-mcp se conserva la modalidad de una sola herramienta de laminado, cuyo contrato esperado es: debe aceptar alguno de los parámetros de entrada model_path, input_path, file_path, stl_path, input_file, filename, path o file, y una ruta de salida output_path, output_file, gcode_path o destination. Adicionalmente se pasan printer/printer_model/machine_model, material/filament y profile cuando estén declarados en inputSchema. La herramienta debe crear el archivo G-code en la ruta temporal de salida. También se acepta structuredContent.gcode_base64 o structuredContent.gcode. Si el MCP real expone una interfaz distinta, es necesario adaptar el mapeo antes de activarlo.

## Comprobar en el dashboard

1. Abrir MÁQUINAS → OrcaSlicer MCP — Laminado real.
2. Pulsar Comprobar MCP. Debe aparecer el nombre de herramienta de laminado detectada. Si la placa ya tiene modelos, guardarlos y limpiarla manualmente en OrcaSlicer; no se eliminan objetos automáticamente.
3. Elegir una impresora, material, perfil compatible (opcional) y STL de prueba. Los presets seleccionados en OrcaSlicer deben coincidir.
4. Pulsar Laminar con OrcaSlicer y confirmar. El dashboard descargará el G-code.
5. Revisar G-code, dimensiones, tiempo, perfiles y compatibilidad antes de cargarlo en Trabajos planificados.

Si MCP responde pero no hay herramienta de laminado, se debe añadir una herramienta de slice al MCP o usar un servidor MCP específico de OrcaSlicer. El túnel por sí solo no resuelve esa limitación.

## Seguridad y límites

- Solo viewer lee estado; operator/admin pueden laminar.
- El navegador no expone herramientas MCP arbitrarias ni comandos de terminal.
- Se admiten modelos de hasta 12 MB, G-code de hasta 32 MB y 180 segundos por sesión.
- Se borran los archivos temporales al finalizar. Los G-code de trabajos completados permanecen solo en memoria y caducan a los 10 minutos; al crear otro trabajo se descarta la descarga anterior.
- La configuración es local del host y puede ejecutar procesos: mantener orca-mcp.json privado.
- No se implementan asignaciones CFS multimaterial ni verificación independiente del G-code físico.
- La impresión nunca arranca por llamar /farm/orca/slice.

## Pruebas

    node --test tests/orca-mcp.test.js

Los tests utilizan un servidor MCP stdio simulado para verificar descubrimiento de herramientas, laminado, validaciones y permisos. Adicionalmente, `node --test tests/orca-jobs.test.js` verifica el ciclo de vida asíncrono, la caducidad, límites y errores.

## Validación de perfiles K1 frente a K2 y asesoría opcional con IA

- El selector de **Máquinas** se refiere al modelo físico de destino (K1, K2, K2 Plus, etc.). No garantiza por sí solo que OrcaSlicer haya cambiado su preset. La pantalla ahora muestra el perfil **realmente activo** en OrcaSlicer.
- En la pantalla se pueden consultar presets de impresora mediante `GET /farm/orca/presets`. El botón **Activar perfil en OrcaSlicer** llama a `POST /farm/orca/printer` con el nombre exacto elegido y pide confirmación antes de realizar el cambio. Si OrcaSlicer señala modificaciones sin guardar, se rechaza la operación; nunca se descartan silenciosamente. Después del cambio hay que revisar filamento y proceso.
- Al laminar, se verifica el perfil antes de cargar el STL, después de importarlo y después de laminar. El G-code se examina buscando metadatos `printer_settings_id` / `printer_model` / `machine_model`, etc. Se rechaza si indican otra familia de máquina o faltan metadatos verificables. Esto no sustituye comprobar start G-code, boquilla, firmware, CFS, volumen de impresión ni compatibilidad real antes de imprimir.
- La telemetría técnica de un resultado incluye controles físicos (cuando `check_profile_physics` está disponible), geometría (`describe_plate`), tiempos/consumo por función (`get_slice_breakdown`) y una selección de parámetros leídos (`get_config`). Todas estas herramientas son **solo lectura**.
- El **análisis con IA** es un botón opcional, separado del laminado. Necesita una clave **API** de OpenAI con facturación habilitada; una suscripción ChatGPT Plus no incluye automáticamente créditos de API. No instala ni usa Ollama. No se llama al proveedor sin una acción explícita del operador.
- El resumen que sale del iMac contiene **solo métricas numéricas, parámetros técnicos autorizados, modelo genérico de impresora y material**; nunca el STL, el G-code, tokens, nombres del archivo ni direcciones de la red.
- La IA entrega recomendaciones explicadas según el objetivo `calidad`, `resistencia` o `rapidez`. **No cambia configuraciones ni inicia impresiones**, ni promete ajustes perfectos. La validación final sigue correspondiendo al operador y a pruebas de impresión.

La clave se almacena **fuera de Git** en un archivo privado con permisos 600, `~/Library/Application Support/TheLabFarm/orca-ai.json`:

```json
{
  "apiKey": "INTRODUCIR_EN_EL_IMAC_SIN_COMPARTIR_CON_OTRAS_PERSONAS",
  "model": "gpt-5-mini"
}
```

El proceso acepta como alternativa `ORCA_AI_API_KEY` y `ORCA_AI_MODEL` en el entorno local del iMac. El valor nunca debe registrarse en logs, subirse al repositorio, enviarse por chat o incluirse en capturas. Reiniciar/reconsultar `Comprobar MCP` tras guardarlo; el servidor lee este archivo en cada consulta.

## Selección automática de impresora y filamento (26/10/2026)

El botón **Laminar con OrcaSlicer** puede recibir `autoSelect:true` y `printerPresetName` (opcional, exacto). El Farm Controller ejecuta la selección del perfil **dentro de la misma sesión MCP en que carga y lamina el STL**. No depende de un cambio manual separado.

1. Comprueba que OrcaSlicer no esté laminando y que la placa esté realmente vacía. No elimina modelos existentes.
2. Consulta los presets instalados con `list_presets(type='printer', include_system=True)`.
3. Si el perfil activo ya corresponde al modelo y no hay preferencia explícita, lo conserva. Si está mal, selecciona el **único** perfil compatible; si hay varios diámetros de boquilla o variantes de máquina, pide elegir una vez el perfil exacto en el desplegable. El navegador recuerda esa elección **por ID de impresora**, pero el servidor siempre la valida de nuevo.
4. Si el filamento no coincide, busca el único perfil instalado del material seleccionado. Si hay varios perfiles de igual material con diferentes fabricantes, no adivina: hay que elegir el correcto en OrcaSlicer. Nunca equipara PLA/PLA+ ni TPU/TPU-95A.
5. Antes de **cada** `select_preset`, rechaza si hay modificaciones de OrcaSlicer sin guardar (ya que `select_preset` las descarta en todas las categorías). Selecciona primero impresora, luego filamento y, solo si se indicó un nombre exacto, proceso; revalida los tres.
6. Verifica que el G-code declara el modelo esperado. No inicia impresoras ni manda archivos a las máquinas.

Si el proyecto está modificado, el cambio automático no se realiza. Hay que guardar o revisar esos ajustes en OrcaSlicer. No hay promesa de precisión mecánica sin comprobar el diámetro real de boquilla y el filamento físico.

**IA:** se ofrece una casilla opcional `Analizar automáticamente después de laminar`. Por defecto está apagada. Al activarla se solicita consentimiento para enviar solo métricas técnicas anonimizadas a la API configurada, nunca STL/G-code; no aplica automáticamente recomendaciones al slicer ni imprime. Requiere clave privada en el iMac.
