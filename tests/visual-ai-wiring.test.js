#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const VISUAL=fs.readFileSync(path.join(ROOT,'js','operativo-visual.js'),'utf8');
const DRIVE=fs.readFileSync(path.join(ROOT,'js','drive.js'),'utf8');
const SOURCE=INDEX+'\n'+VISUAL+'\n'+DRIVE;
const OPENGEN='https://thelabsolutionscl.github.io/Open-Generative-AI/';

function count(re,text=SOURCE){return(text.match(re)||[]).length;}
function iframeTag(){
  const m=INDEX.match(/<iframe\b[^>]*\bid=["']vaiFrame["'][^>]*>/i);
  assert.ok(m,'falta iframe #vaiFrame');
  return m[0];
}
function functionBlock(name){
  const re=new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\(');
  const start=re.exec(VISUAL);assert.ok(start,'falta '+name);
  const tail=VISUAL.slice(start.index+start[0].length);
  const next=/\n\s*(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(tail);
  return VISUAL.slice(start.index,next?start.index+start[0].length+next.index:VISUAL.length);
}

test('VISUAL AI conserva sección y navegación escritorio/móvil',()=>{
  assert.equal(count(/id=["']tab-visual["']/g,INDEX),1);
  assert.match(INDEX,/switchTab\(\s*['"]visual['"]\s*\)/);
  assert.match(INDEX,/switchTabMobile\(\s*['"]visual['"]\s*\)/);
  for(const id of ['vaiFrame','vaiFallback','vaiStatus','vaiDot','vaiStatusTxt']){
    const n=(INDEX.match(new RegExp('id=(?:"|\\x27)'+id+'(?:"|\\x27)','g'))||[]).length;
    assert.equal(n,1,id);
  }
});

test('iframe parte descargado y apunta a un único origen fijo HTTPS',()=>{
  const tag=iframeTag();
  assert.match(tag,/src=["']about:blank["']/i);
  assert.ok(tag.includes('data-src="'+OPENGEN+'"')||tag.includes("data-src='"+OPENGEN+"'"));
  assert.equal(count(/data-src=["']https:\/\/thelabsolutionscl\.github\.io\/Open-Generative-AI\/["']/g,INDEX),1);
  const activate=functionBlock('vaiActivate');
  assert.match(activate,/thelabsolutionscl\\\.github\\\.io\\\/Open-Generative-AI/);
  assert.match(activate,/frame\.src=target/);
});

test('iframe se endurece antes de cargar contenido remoto',()=>{
  const cfg=functionBlock('vaiConfigureFrame');
  assert.match(cfg,/removeAttribute\(['"]onload['"]\)/);
  assert.match(cfg,/setAttribute\(['"]sandbox['"],['"]allow-scripts allow-same-origin allow-downloads['"]\)/);
  assert.match(cfg,/setAttribute\(['"]referrerpolicy['"],['"]no-referrer['"]\)/);
  assert.match(cfg,/setAttribute\(['"]allow['"],['"]clipboard-write['"]\)/);
  assert.doesNotMatch(cfg,/camera|microphone|fullscreen/);
  assert.match(cfg,/noopener noreferrer/);
});

test('onload ya no equivale a readiness: exige handshake exacto y versionado',()=>{
  const onMessage=functionBlock('vaiOnMessage');
  assert.match(VISUAL,/VAI_ORIGIN=['"]https:\/\/thelabsolutionscl\.github\.io['"]/);
  assert.match(VISUAL,/VAI_PROTOCOL_VERSION=1/);
  assert.match(onMessage,/event\.origin!==VAI_ORIGIN/);
  assert.match(onMessage,/event\.source!==frame\.contentWindow/);
  assert.match(onMessage,/msg\.source!==['"]opengen['"]/);
  assert.match(onMessage,/msg\.version!==VAI_PROTOCOL_VERSION/);
  assert.match(onMessage,/msg\.type===['"]ready['"]/);
  assert.match(onMessage,/type:['"]host-ready['"]/);
  assert.doesNotMatch(functionBlock('vaiConfigureFrame'),/OpenGen Studio\s*[—-]\s*Live/);
});

test('carga maneja timeout/reintento y descarga iframe al salir',()=>{
  const timeout=functionBlock('vaiArmTimeout');
  const retry=functionBlock('vaiRetry');
  const stop=functionBlock('vaiDeactivate');
  assert.match(timeout,/12000/);
  assert.match(timeout,/sin respuesta/);
  assert.match(retry,/about:blank/);
  assert.match(stop,/type:['"]pause['"]/);
  assert.match(stop,/frame\.src=['"]about:blank['"]/);
  assert.match(VISUAL,/MutationObserver/);
});

test('OpenGen usa RPC al proxy TLS y nunca recibe secreto MuAPI',()=>{
  const rpc=functionBlock('vaiRpcToServer');
  const handle=functionBlock('vaiHandleRpc');
  assert.match(rpc,/\/visual-ai\/rpc/);
  assert.match(rpc,/credentials:['"]include['"]/);
  assert.match(rpc,/X-App-Key/);
  assert.match(rpc,/AbortController/);
  assert.match(handle,/['"]quota['"].*['"]upload['"].*['"]generate['"].*['"]poll['"]/s);
  assert.doesNotMatch(VISUAL,/MUAPI_KEY|api\.muapi\.ai|corsproxy\.io/i);
  assert.doesNotMatch(INDEX,/\bmu_[A-Za-z0-9_-]{12,}\b|\bhf_[A-Za-z0-9_-]{12,}\b/);
});

test('contrato de eventos cubre ciclo completo y selección de resultado',()=>{
  const msg=functionBlock('vaiOnMessage');
  for(const ev of ['job-start','job-progress','job-complete','job-error','asset-selected'])
    assert.match(msg,new RegExp(ev));
  assert.match(msg,/vaiAssetLinkPrompt/);
});

test('resultado puede vincularse a CRM, referencia editorial, Drive o borrador de Redes',()=>{
  const link=functionBlock('vaiAssetLinkPrompt');
  assert.match(link,/cliente.*cotizacion.*pedido.*referencia.*drive.*redes/s);
  assert.match(link,/state\.clientes/);
  assert.match(link,/state\.cotizaciones/);
  assert.match(link,/state\.pedidos/);
  assert.match(link,/Notas internas/);
  assert.match(link,/Notas cotización/);
  assert.match(link,/Notas pedido/);
  assert.match(link,/airtableWriteTolerant\(['"]Contenido['"],['"]POST['"]/);
  assert.match(link,/['"]Estado publicación['"]\s*:\s*['"]Idea['"]/);
  assert.match(link,/['"]Sugerencia visual['"]\s*:\s*asset\.url/);
  assert.match(link,/Social_Posts/);
  assert.match(link,/Estado:['"]Borrador['"]/);
  assert.doesNotMatch(link,/Estado:['"]Publicado['"]/);
  assert.match(link,/_driveGetOrCreateFolder\(['"]Visual AI['"]\)/);
  assert.match(link,/_driveUploadRemoteAsset/);
  assert.match(VISUAL,/visual-reference/);
  assert.match(VISUAL,/drive-save/);
  assert.match(VISUAL,/social-draft/);
});

test('Drive descarga y valida el asset real antes de subirlo',()=>{
  assert.match(DRIVE,/async function _driveUploadRemoteAsset\(/);
  const start=DRIVE.indexOf('async function _driveUploadRemoteAsset(');
  const end=DRIVE.indexOf('\nasync function ',start+10);
  const body=DRIVE.slice(start,end>start?end:DRIVE.length);
  assert.match(body,/protocol!==['"]https:['"]/);
  assert.match(body,/credentials:['"]omit['"]/);
  assert.match(body,/redirect:['"]error['"]/);
  assert.match(body,/25\*1024\*1024/);
  assert.match(body,/image\/jpeg/);
  assert.match(body,/video\/mp4/);
  assert.match(body,/audio\/mpeg/);
  assert.match(body,/googleapis\.com\/upload\/drive/);
});

test('panel conserva fallback y enlaces externos se protegen',()=>{
  assert.match(INDEX,/id=["']vaiFallback["']/);
  assert.match(INDEX,/Cargando OpenGen Studio/i);
  assert.ok(count(/href=["']https:\/\/thelabsolutionscl\.github\.io\/Open-Generative-AI\/["']/g,INDEX)>=1);
  assert.match(VISUAL,/querySelectorAll\(['"]#tab-visual a\[target="_blank"\]['"]\)/);
  assert.match(VISUAL,/noopener noreferrer/);
});
