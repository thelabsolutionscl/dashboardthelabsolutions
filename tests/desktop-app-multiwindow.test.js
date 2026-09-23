'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const MAIN=fs.readFileSync('desktop-app/src-tauri/src/main.rs','utf8');
const CONF=JSON.parse(fs.readFileSync('desktop-app/src-tauri/tauri.conf.json','utf8'));
const PKG=JSON.parse(fs.readFileSync('desktop-app/package.json','utf8'));
const CARGO=fs.readFileSync('desktop-app/src-tauri/Cargo.toml','utf8');

test('app macOS 1.1 crea la ventana principal desde Rust para interceptar window.open',()=>{
  assert.equal(CONF.version,'1.1.0');
  assert.equal(PKG.version,'1.1.0');
  assert.match(CARGO,/version = "1\.1\.0"/);
  assert.equal(CONF.app.windows[0].create,false);
  assert.match(CONF.app.windows[0].url,/desktop=macos/);
  assert.equal(CONF.app.windows[0].tabbingIdentifier,'thelab-crm');
  assert.match(MAIN,/WebviewWindowBuilder::from_config/);
  assert.match(MAIN,/\.on_new_window\(/);
});

test('deep-links internos abren otra ventana nativa y externos no se fuerzan dentro de la app',()=>{
  assert.match(MAIN,/host_str\(\) == Some\("dashboard\.thelab\.solutions"\)/);
  assert.match(MAIN,/NewWindowResponse::Create \{ window \}/);
  assert.match(MAIN,/NewWindowResponse::Allow/);
  assert.match(MAIN,/NEXT_WINDOW_ID\.fetch_add/);
  assert.match(MAIN,/window_features\(features\)/);
});
