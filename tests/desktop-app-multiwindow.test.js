'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const MAIN=fs.readFileSync('desktop-app/src-tauri/src/main.rs','utf8');
const CONF=JSON.parse(fs.readFileSync('desktop-app/src-tauri/tauri.conf.json','utf8'));
const PKG=JSON.parse(fs.readFileSync('desktop-app/package.json','utf8'));
const CARGO=fs.readFileSync('desktop-app/src-tauri/Cargo.toml','utf8');

test('app macOS 1.2 crea la ventana principal desde Rust para interceptar window.open',()=>{
  assert.equal(CONF.version,'1.2.0');
  assert.equal(PKG.version,'1.2.0');
  assert.match(CARGO,/version = "1\.2\.0"/);
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


test('OAuth de Calendar sale del WKWebView y usa navegador del sistema + loopback PKCE',()=>{
  assert.match(MAIN,/google_calendar_oauth/);
  assert.match(MAIN,/127\.0\.0\.1:0/);
  assert.match(MAIN,/code_challenge_method/);
  assert.match(MAIN,/S256/);
  assert.match(MAIN,/https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
  assert.match(MAIN,/https:\/\/oauth2\.googleapis\.com\/token/);
  assert.match(MAIN,/Command::new\("open"\)/);
  assert.match(MAIN,/calendar\.events/);
  assert.match(MAIN,/invoke_handler\(tauri::generate_handler!\[google_calendar_oauth\]\)/);
  assert.equal(CONF.app.withGlobalTauri,true);
  assert.deepEqual(CONF.app.security.capabilities,['remote-dashboard-google-calendar']);
});

test('capability remota limita el puente OAuth al dashboard oficial',()=>{
  const cap=JSON.parse(fs.readFileSync('desktop-app/src-tauri/capabilities/remote-dashboard-google-calendar.json','utf8'));
  const perm=fs.readFileSync('desktop-app/src-tauri/permissions/google-calendar-oauth.toml','utf8');
  const build=fs.readFileSync('desktop-app/src-tauri/build.rs','utf8');
  assert.deepEqual(cap.remote.urls,['https://dashboard.thelab.solutions/*']);
  assert.deepEqual(cap.platforms,['macOS']);
  assert.ok(cap.permissions.includes('allow-google-calendar-oauth'));
  assert.match(perm,/commands\.allow = \["google_calendar_oauth"\]/);
  assert.match(build,/commands\(&\["google_calendar_oauth"\]\)/);
});
