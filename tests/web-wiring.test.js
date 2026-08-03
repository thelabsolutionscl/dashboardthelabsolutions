#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const JS_DIR=path.join(ROOT,'js');
const MODULES=fs.existsSync(JS_DIR)
  ?fs.readdirSync(JS_DIR).filter(name=>name.endsWith('.js')).sort().map(name=>fs.readFileSync(path.join(JS_DIR,name),'utf8')).join('\n')
  :'';
const SOURCE=`${INDEX}\n${MODULES}`;
const SEO_ADS=fs.readFileSync(path.join(ROOT,'js','seo-ads.js'),'utf8');

function count(pattern,text=SOURCE){return(text.match(pattern)||[]).length;}
function esc(value){return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function functionBlock(source,name){
  const re=new RegExp(`(?:async\\s+)?function\\s+${esc(name)}\\s*\\(`);
  const start=re.exec(source);
  assert.ok(start,`falta ${name}`);
  const tail=source.slice(start.index+start[0].length);
  const next=/\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(tail);
  return source.slice(start.index,next?start.index+start[0].length+next.index:source.length);
}
function assertUniqueFunction(name){
  assert.equal(count(new RegExp(`(?:async\\s+)?function\\s+${esc(name)}\\s*\\(`,'g')),1,`${name} debe existir exactamente una vez`);
}

test('WEB tiene una sola sección, navegación y módulo SEO/Ads cargado',()=>{
  assert.equal(count(/id=["']tab-web["']/g,INDEX),1,'#tab-web debe ser único');
  assert.match(SOURCE,/switchTab\(\s*['"]web['"]\s*\)/,'debe existir navegación escritorio');
  assert.match(SOURCE,/switchTabMobile\(\s*['"]web['"]\s*\)/,'debe existir navegación móvil');
  assert.equal(count(/js\/seo-ads\.js(?:\?[^"']*)?/g,INDEX),1,'seo-ads.js debe cargarse una sola vez');
  for(const id of ['webTrafficPanel','webTrafficBody','webTrafficDemo','seoAuditBody','seoAuditScore','seoPagesList','adsCampaignsArea','adsPendingPanel','adsCapacidadBox','adsSuggestBox','adsAutopilotPanel','adsCampaignModal','adsDeleteModal','adsOfflineModal']){
    assert.equal(count(new RegExp(`id=["']${id}["']`,'g'),INDEX),1,`${id} debe existir una vez`);
  }
});

test('las funciones críticas de WEB existen sin redefiniciones',()=>{
  [
    'getWPConfig','saveWPConfig','loadWPPages','renderSEOList','runSeoAudit','_seoAnalyze','seoOptimizeIA','saveYoastFields','runSEODiag',
    'getAdsConfig','saveAdsConfig','loadAdsData','renderAdsKPIs','renderAdsCampaigns','renderAdsAgent','getAdsDemoData',
    'syncAdsToAirtable','loadAdsSnapshotsFromAirtable','_adsQueueMutation','sendAdsMutation','syncMutationStatuses','renderPendingMutations','retryMutation','retryAllErrors',
    'getCapacidadLineas','renderAdsCapacidad','renderAdsSugerencias','renderAdsAutopilot','adsAutopilotDecide',
    'loadWebStats','renderWebStats','getWebDemoData','adsExportOfflineConversions'
  ].forEach(assertUniqueFunction);
});

test('el panel de tráfico del sitio aparece antes de Google Ads',()=>{
  const traffic=INDEX.indexOf('id="webTrafficPanel"');
  const ads=INDEX.indexOf('id="ads-kpi-gasto"');
  assert.ok(traffic>=0&&ads>=0&&traffic<ads,'GA4 debe aparecer antes que los KPIs de Ads');
});

test('el auditor SEO usa proxy restringido, sitemap y análisis on-page',()=>{
  const fetchBody=functionBlock(SOURCE,'_seoFetch');
  const audit=functionBlock(SOURCE,'runSeoAudit');
  const analyze=functionBlock(SOURCE,'_seoAnalyze');
  assert.match(fetchBody,/\/seo-fetch\?url=/);
  assert.match(fetchBody,/X-App-Key/,'debe autenticar el proxy');
  assert.match(audit,/_seoSitemap\s*\(/,'debe descubrir páginas desde sitemap');
  assert.match(audit,/\.slice\(\s*0\s*,\s*25\s*\)/,'debe acotar la auditoría');
  assert.match(audit,/_seoAnalyze\s*\(/);
  for(const signal of ['title','description','h1','canonical','robots','og:title','viewport','lang','img'])assert.match(analyze,new RegExp(esc(signal),'i'),`falta señal SEO ${signal}`);
  assert.match(analyze,/score/);
});

test('la optimización SEO con IA parte desde hallazgos reales y solo propone textos',()=>{
  const body=functionBlock(SOURCE,'seoOptimizeIA');
  assert.match(body,/window\._seoLastRows/);
  assert.match(body,/runSeoAudit\s*\(/);
  assert.match(body,/callClaude\s*\(/);
  assert.match(body,/JSON\.parse/);
  assert.match(body,/renderSeoIAProps\s*\(/);
  assert.doesNotMatch(body,/airtableWrite|fetch\([^)]*wp-json\/wp\/v2/,'la IA general no debe publicar directamente');
});

test('el guardado SEO verifica la respuesta de WordPress antes de confirmar',()=>{
  const body=functionBlock(SOURCE,'saveYoastFields');
  assert.match(body,/wpAuthHeader\s*\(/);
  assert.match(body,/method\s*:\s*['"]POST['"]/);
  assert.match(body,/_yoast_wpseo_title/);
  assert.match(body,/_yoast_wpseo_metadesc/);
  assert.match(body,/\?_fields=meta/,'debe releer los campos');
  assert.match(body,/savedOk/,'debe validar la persistencia');
});

test('loadAdsData respeta el orden lógico completo del panel',()=>{
  const body=functionBlock(SOURCE,'loadAdsData');
  const fetchPos=body.search(/await\s+fetch\s*\(/);
  const validate=body.search(/if\(!data\.ok\)/);
  const statePos=body.search(/window\._adsLastData\s*=\s*data/);
  const kpis=body.search(/renderAdsKPIs\(data/);
  const campaigns=body.search(/renderAdsCampaigns\(data/);
  const agent=body.search(/renderAdsAgent\(data/);
  const capacity=body.search(/renderAdsCapacidad\(data/);
  const suggestions=body.search(/renderAdsSugerencias\(data/);
  const web=body.search(/loadWebStats\s*\(/);
  const pending=body.search(/renderPendingMutations\s*\(/);
  const reconcile=body.search(/syncMutationStatuses\s*\(/);
  const autopilot=body.search(/renderAdsAutopilot\s*\(/);
  const airtable=body.search(/syncAdsToAirtable\(data/);
  assert.ok(fetchPos>=0&&validate>fetchPos&&statePos>validate,'primero debe obtener y validar datos reales');
  assert.ok(kpis>statePos&&campaigns>statePos&&agent>statePos&&capacity>statePos&&suggestions>statePos,'los renders deben usar la misma respuesta validada');
  assert.ok(web>statePos,'GA4 debe cargarse dentro del mismo ciclo');
  assert.ok(pending>statePos&&reconcile>pending,'primero muestra la cola y luego concilia con Script 2');
  assert.ok(autopilot>reconcile,'las propuestas deben aparecer después de conciliar cambios previos');
  assert.ok(airtable>statePos,'el snapshot debe salir de datos reales ya validados');
});

test('las campañas validan presupuesto, URL, anuncios y límites de Google Ads',()=>{
  const body=functionBlock(SOURCE,'saveCampaignMutation');
  assert.match(body,/presupuesto\s*<\s*1000/);
  assert.match(body,/^\s*if\(!nombre\)/m);
  assert.match(body,/https\?:\\\/\\\//,'la URL final debe ser HTTP(S)');
  assert.match(body,/titulos\.length\s*<\s*3/);
  assert.match(body,/descripciones\.length\s*<\s*2/);
  assert.match(body,/t\.length\s*>\s*30/);
  assert.match(body,/d\.length\s*>\s*90/);
  assert.match(body,/path1\.length\s*>\s*15/);
  assert.match(body,/_adsCleanKw/);
});

test('la cola deduplica, persiste, envía y activa conciliación',()=>{
  const queue=functionBlock(SOURCE,'_adsQueueMutation');
  const send=functionBlock(SOURCE,'sendAdsMutation');
  assert.match(queue,/keyOf/,'debe construir una clave estable');
  assert.match(queue,/\.filter\s*\(/,'debe reemplazar equivalentes pendientes');
  const save=queue.search(/savePendingToStorage\s*\(/);
  const dispatch=queue.search(/sendAdsMutation\s*\(/);
  const render=queue.search(/renderPendingMutations\s*\(/);
  const poll=queue.search(/_startAdsMutationPoll\s*\(/);
  assert.ok(save>=0&&dispatch>save&&render>dispatch&&poll>render,'debe persistir antes de enviar y después mostrar/conciliar');
  assert.match(send,/Content-Type['"]?\s*:\s*['"]text\/plain['"]/,'debe evitar preflight de Apps Script');
  assert.match(send,/secret\s*:\s*cfg\.secret/);
  assert.match(send,/status\s*=\s*['"]enviado['"]/);
  assert.match(send,/status\s*=\s*['"]error['"]/);
});

test('la conciliación remota elimina aplicadas y conserva errores visibles',()=>{
  const body=functionBlock(SOURCE,'syncMutationStatuses');
  assert.match(body,/action=mutations/);
  assert.match(body,/timestamp\s*===\s*m\.timestamp/,'debe reconciliar por identificador estable');
  assert.match(body,/status\s*!==\s*['"]aplicado['"]/,'las aplicadas deben salir de la cola local');
  assert.match(body,/renderPendingMutations\s*\(/);
  assert.match(body,/errores/);
});

test('capacidad enlaza máquinas, mantenimiento y pedidos activos con campañas',()=>{
  const body=functionBlock(SOURCE,'getCapacidadLineas');
  assert.match(body,/MAQUINAS/);
  assert.match(body,/maquinaState\.eventos/);
  assert.match(body,/getMaquinaEstadoGlobal/);
  for(const terminal of ['Despachado','Completado','Cancelado'])assert.match(body,new RegExp(terminal));
  assert.match(body,/impresion-3d/);
  assert.match(body,/carteleria/);
  assert.match(body,/premiaciones/);
});

test('el piloto automático revalida Airtable y exige aprobación humana',()=>{
  const body=functionBlock(SOURCE,'adsAutopilotDecide');
  assert.match(body,/Agent_Queue/);
  assert.match(body,/Estado/);
  assert.match(body,/Pendiente/);
  assert.match(body,/confirm\s*\(/,'debe pedir confirmación antes de aplicar');
  assert.match(body,/_adsQueueMutation\s*\(/);
  assert.match(body,/airtableWriteTolerant\(\s*['"]Agent_Queue['"]\s*,\s*['"]PATCH['"]/);
});

test('conversiones offline conectan CRM, GCLID, ventas netas y horario Chile',()=>{
  const body=functionBlock(SOURCE,'adsExportOfflineConversions');
  assert.match(body,/state\.clientes/);
  assert.match(body,/state\.pedidos/);
  assert.match(body,/_adsGetGclid/);
  assert.match(body,/Monto total \(CLP\)/);
  assert.match(body,/\/\s*1\.19/);
  assert.match(body,/CLP/);
  assert.match(SOURCE,/America\/Santiago/);
});

test('los snapshots de Ads se escriben en Airtable con lotes acotados',()=>{
  const body=functionBlock(SOURCE,'syncAdsToAirtable');
  assert.match(body,/Google_Ads_KPIs/);
  assert.match(body,/Google_Ads_Campanas/);
  assert.match(body,/typecast\s*:\s*true/);
  assert.match(body,/i\s*\+=\s*10/,'las campañas deben enviarse en lotes de 10');
  assert.match(body,/adsHealthScore/);
});

test.todo('runSEODiag debe restaurar el título SEO original después de probar escritura');
test.todo('credenciales WordPress y secreto de Ads no deben persistirse en localStorage');
test.todo('el webhook y la clave de Make no deben estar expuestos en el bundle público');
test.todo('la creación debe confirmar primero la cola y después solicitar el cascarón a Make');
test.todo('el modo demo debe bloquear todas las acciones que puedan crear o modificar campañas reales');
test.todo('syncAdsToAirtable debe hacer upsert por fecha/campaña y no duplicar snapshots al refrescar');
test.todo('ROAS real debe usar ingresos atribuibles a Google Ads, no todo el revenue del CRM');
test.todo('la carga de líneas manuales y láser debe usar pedidos de su propia línea, no el total global');
test.todo('el piloto debe reservar o cerrar la propuesta antes de encolar para evitar una segunda aprobación si falla Airtable');
test.todo('saveYoastFields debe comparar los valores leídos con los valores enviados antes de mostrar éxito');
