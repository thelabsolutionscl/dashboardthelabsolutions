# Apariencia del dashboard

Desde **Mi cuenta → Apariencia** cada navegador puede personalizar el dashboard sin alterar datos del CRM.

## Opciones

- **Tema:** Oscuro / Claro.
- **Fondos:** Blueprint Grid, Holographic y Glass Panels.
- **Fuentes:** DM Sans, Inter y Space Grotesk.

Los tres fondos son generativos en CSS. Esto evita descargar imágenes pesadas, escala bien en pantallas TV/4K y permite que el mismo fondo cambie correctamente entre tema claro y oscuro.

## Persistencia

Las opciones se guardan únicamente como preferencias visuales en `localStorage`:

- `tls_ui_theme`
- `tls_ui_wallpaper`
- `tls_ui_font`

No contienen datos comerciales ni credenciales. Las preferencias se leen en el `<head>` antes de cargar la hoja principal para evitar el destello del tema predeterminado durante una recarga.
