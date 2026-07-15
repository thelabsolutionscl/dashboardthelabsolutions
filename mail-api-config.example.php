<?php
/**
 * mail-api-config.example.php — plantilla de configuración server-side de mail-api.php
 *
 * CÓMO USARLO:
 *   1. Copia este archivo como  mail-api-config.php  (sin ".example")
 *      en el MISMO directorio que mail-api.php, en el hosting (cPanel).
 *   2. Pega tu API key de Resend abajo.
 *   3. NO lo subas al repositorio: mail-api-config.php está en .gitignore.
 *
 * La key vive solo en el servidor y nunca se expone en el front-end.
 * Alternativas equivalentes: variable de entorno RESEND_API_KEY, o un archivo
 * "resend.key" con solo la clave adentro.
 */

define('RESEND_API_KEY', 're_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
