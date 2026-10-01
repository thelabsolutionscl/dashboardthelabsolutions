'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const DRIVE=fs.readFileSync('js/drive.js','utf8');
const CONNECTIONS=fs.readFileSync('js/operativo-conexiones.js','utf8');

test('OAuth de Drive sincroniza inmediatamente los botones globales',()=>{
  assert.match(DRIVE,/function _driveSyncConnectionUi\(\)/);
  assert.match(DRIVE,/typeof _refreshDriveBtns==='function'/);
  assert.match(DRIVE,/tls:drive-connection-changed/);
  assert.match(DRIVE,/_driveTokenExpiry=Date\.now\(\)\+\(resp\.expires_in\|\|3600\)\*1000;[\s\S]{0,120}_driveSyncConnectionUi\(\)/);
});

test('reutilizar un token vigente también corrige una interfaz que quedó desactualizada',()=>{
  assert.match(DRIVE,/if\(_driveAccessToken&&Date\.now\(\)<_driveTokenExpiry-60000\)\{_driveSyncConnectionUi\(\);resolve\(_driveAccessToken\);return;\}/);
});

test('Centro de Conexiones refresca el estado visual de Drive tras verificarlo',()=>{
  const start=CONNECTIONS.indexOf("if(id==='drive')");
  const end=CONNECTIONS.indexOf("if(id==='imap')",start);
  assert.ok(start>=0&&end>start);
  const block=CONNECTIONS.slice(start,end);
  assert.match(block,/if\(r\.status==='green'\)[\s\S]*?_refreshDriveBtns\(\)/);
  assert.match(block,/Google Drive autoriza consultas de archivos/);
});
