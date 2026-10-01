# Migración de respaldos CRM anteriores al cifrado obligatorio

Auditoría: 2026-09-28 · Prioridad P0 · Solo acción manual.

## Situación detectada

La automatización semanal antigua guardaba `backup/backup-crm-AAAA-MM-DD.json`
**en texto plano** como GitHub Actions artifacts de un repositorio público.
Se localizaron 11 artifacts todavía vigentes, generados entre julio y
septiembre de 2026. Cambiar el workflow semanal para cifrar las copias nuevas
**no cifra ni elimina los artifacts anteriores**.

La workflow `Migrar respaldos antiguos cifrados` prepara una copia cifrada
de todos los artifacts legados disponibles, comprueba que el nuevo artifact
subido contiene exactamente cada archivo cifrado (SHA-256 y formato), y
solo entonces usa la API de GitHub para eliminar los originales.

## Pasos pendientes que hará el administrador cuando configure los secretos

1. Crear `BACKUP_ENCRYPTION_KEY` en **Settings → Secrets and variables → Actions**,
   con una clave aleatoria y estable de 32 bytes o más (`openssl rand -base64 32`).
   Guardarla en el gestor corporativo de contraseñas, nunca en el repositorio.
   Es el mismo secret utilizado en el backup semanal y la herramienta
   `scripts/decrypt-backup.mjs`. Conservarlo para recuperar respaldos antiguos.
2. Verificar la ejecución de **Automatización semanal** y revisar que se
   genera un backup **COMPLETO** cifrado. El PAT `AIRTABLE` debe poder leer
   tanto los registros como la metadata de las tablas.
3. Desde **Actions → Migrar respaldos antiguos cifrados → Run workflow**,
   introducir exactamente `MIGRAR` en el campo de confirmación y ejecutar
   sobre `main`. El job necesita `GITHUB_TOKEN` con `actions: write`,
   declarado en el workflow; no requiere un PAT adicional.
4. Comprobar que el job confirma que todos los artifacts legados disponibles
   fueron cifrados, subidos y verificados **antes** de borrar cada original.
   Verificar la desaparición de los artifacts anteriores de Actions. Si falla,
   los originales no se eliminan cuando falta una copia verificada; revisar
   logs antes de repetir.
5. Descargar una copia de prueba del nuevo artifact cifrado en un equipo
   confiable y usar `scripts/decrypt-backup.mjs` para ensayar la recuperación
   hacia una carpeta privada, **fuera del repositorio**.

## Garantías y límites

- No se publican en logs ni se suben el JSON original, el secreto o el
  manifest de migración que contiene las huellas SHA-256.
- El código falla antes de descargar si falta el secreto de cifrado y rechaza
  borrados cuando el artifact nuevo no coincide con **todas** las copias
  esperadas. El proceso no se ejecuta automáticamente al merge.
- Los históricos se etiquetan como **incompletos/no certificados**; cifrar
  una copia vieja no certifica que contenga todas las tablas de Airtable.
- Si una eliminación falla parcialmente, conservar el nuevo artifact ya
  verificado y revisar cuáles originales siguen vigentes antes de reejecutar.
- Los artifacts cifrados de GitHub siguen sujetos a caducidad (90 días):
  planificar exportaciones periódicas a un almacenamiento privado separado
  del repositorio. La pérdida del secret hace irrecuperables esas copias.
- La eliminación de artifacts no revoca copias históricas que otras personas
  pudieran haber descargado antes. Revisar rotación de datos/credenciales
  si el análisis de exposición así lo requiere.
