# OrcaSlicer MCP dentro de MÁQUINAS

La integración permite laminar STL o 3MF usando un servidor MCP (stdio) en el equipo del Farm Controller y descargar el G-code desde el dashboard. No sustituye al laminador nativo ni cambia el camino seguro de impresión existente.

## Arquitectura

- Navegador / MÁQUINAS → Cloudflare Tunnel → Farm Controller (puerto 8347).
- GET /farm/orca/status: requiere viewer; inicializa el MCP y consulta tools/list.
- POST /farm/orca/slice: requiere operator; recibe modelo, material, perfil opcional y STL/3MF base64, con máximo de 12 MB.
- Farm Controller lanza el MCP local mediante stdio/JSON-RPC. El MCP recibe rutas de entrada/salida en un directorio temporal privado y devuelve G-code (máximo 32 MB) y estadísticas, si están disponibles.
- El panel NO llama Moonraker ni print/start. Para imprimir hay que importar el G-code en la gestión existente de trabajos planificados.

## Configurar en el Mac del taller

Importante: haber registrado tls-farm en Codex desde un MacBook Air solo registra el servidor en Codex en ese equipo. NO lo instala en el iMac que ejecuta Farm Controller. Esta integración exige un MCP que tenga una herramienta de laminado, no únicamente control de impresoras.

Instalar en el host del Farm Controller un servidor MCP que pueda utilizar OrcaSlicer y opere en modo stdio, con initialize, tools/list y tools/call. El servidor necesita acceso a OrcaSlicer y sus perfiles en ese equipo.

Crear el archivo privado de configuración fuera de Git, en la cuenta del usuario que ejecuta Farm Controller:

    mkdir -p "$HOME/Library/Application Support/TheLabFarm"
    nano "$HOME/Library/Application Support/TheLabFarm/orca-mcp.json"

Ejemplo de contenido; sustituir las rutas por las reales y el nombre de herramienta por el que exponga el MCP instalado:

    {
      "command": "/opt/homebrew/bin/python3",
      "args": ["/Users/USUARIO/orcaslicer-mcp/server.py"],
      "sliceTool": "slice_model"
    }

Restringir permisos:

    chmod 600 "$HOME/Library/Application Support/TheLabFarm/orca-mcp.json"

Si Farm Controller utiliza otra ruta FARM_DATA_DIR, guardar allí orca-mcp.json, o proporcionar ORCA_MCP_CONFIG_FILE con la ruta absoluta. También se admiten las variables ORCA_MCP_COMMAND, ORCA_MCP_ARGS_JSON (array JSON) y ORCA_MCP_SLICE_TOOL, que tienen prioridad sobre el archivo.

Se reconocen automáticamente los nombres de herramienta: slice, slice_model, slice_stl, slice_file, orca_slice, orcaslicer_slice, laminar, laminar_modelo. Para otro nombre, especificar sliceTool.

Contrato esperado del servidor MCP: debe aceptar alguno de los parámetros de entrada model_path, input_path, file_path, stl_path, input_file, filename, path o file, y una ruta de salida output_path, output_file, gcode_path o destination. Adicionalmente se pasan printer/printer_model/machine_model, material/filament y profile cuando estén declarados en inputSchema. La herramienta debe crear el archivo G-code en la ruta temporal de salida. También se acepta structuredContent.gcode_base64 o structuredContent.gcode. Si el MCP real expone una interfaz distinta, es necesario adaptar el mapeo antes de activarlo.

## Comprobar en el dashboard

1. Abrir MÁQUINAS → OrcaSlicer MCP — Laminado real.
2. Pulsar Comprobar MCP. Debe aparecer el nombre de herramienta de laminado detectada.
3. Elegir una impresora, material, perfil compatible (opcional) y STL de prueba.
4. Pulsar Laminar con OrcaSlicer y confirmar. El dashboard descargará el G-code.
5. Revisar G-code, dimensiones, tiempo, perfiles y compatibilidad antes de cargarlo en Trabajos planificados.

Si MCP responde pero no hay herramienta de laminado, se debe añadir una herramienta de slice al MCP o usar un servidor MCP específico de OrcaSlicer. El túnel por sí solo no resuelve esa limitación.

## Seguridad y límites

- Solo viewer lee estado; operator/admin pueden laminar.
- El navegador no expone herramientas MCP arbitrarias ni comandos de terminal.
- Se admiten modelos de hasta 12 MB, G-code de hasta 32 MB y 180 segundos por sesión.
- Se borran los archivos temporales al finalizar.
- La configuración es local del host y puede ejecutar procesos: mantener orca-mcp.json privado.
- No se implementan asignaciones CFS multimaterial ni verificación independiente del G-code físico.
- La impresión nunca arranca por llamar /farm/orca/slice.

## Pruebas

    node --test tests/orca-mcp.test.js

El test utiliza un servidor MCP stdio simulado para verificar descubrimiento de herramientas, laminado, validaciones y permisos.
