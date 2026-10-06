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
const CSS=fs.readFileSync(path.join(ROOT,'styles.css'),'utf8');

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
  // Auditor SEO on-page: Next.js y sitemap real; no usa un CMS externo.
  for(const id of ['webTrafficPanel','webTrafficBody','webTrafficDemo','seoAuditBody','seoAuditScore','adsCampaignsArea','adsPendingPanel','adsCapacidadBox','adsSuggestBox','adsAutopilotPanel','adsCampaignModal','adsDeleteModal','adsOfflineModal']){
    assert.equal(count(new RegExp(`id=["']${id}["']`,'g'),INDEX),1,`${id} debe existir una vez`);
  }
});

test('las funciones críticas de WEB existen sin redefiniciones',()=>{
  [
    'runSeoAudit','_seoAnalyze','seoOptimizeIA',
    'getAdsConfig','saveAdsConfig','loadAdsData','renderAdsKPIs','renderAdsCampaigns','renderAdsAgent','getAdsDemoData',
    'syncAdsToAirtable','loadAdsSnapshotsFromAirtable','_adsQueueMutation','sendAdsMutation','syncMutationStatuses','renderPendingMutations','retryMutation','retryAllErrors',
    'getCapacidadLineas','renderAdsCapacidad','renderAdsSugerencias','renderAdsAutopilot','adsAutopilotDecide',
    'loadWebStats','renderWebStats','getWebDemoData','adsExportOfflineConversions'
  ].forEach(assertUniqueFunction);
});

test('WEB tiene jerarquía didáctica y lectura progresiva',()=>{
  assert.match(SOURCE,/function\s+webVisualMount\s*\(/,'falta montaje visual de WEB');
  assert.match(SOURCE,/WEB EN 3 PREGUNTAS/,'debe explicar la sección antes de mostrar métricas');
  assert.match(SOURCE,/¿La web está atrayendo, convirtiendo y creciendo\?/);
  assert.match(SOURCE,/webVisualChapter\(webVisualContainer\(traffic\),'01','Tráfico del sitio'/,'Tráfico debe ser el primer capítulo');
  assert.match(SOURCE,/webVisualChapter\(ads,'02','Publicidad y conversiones'/,'Ads debe ser el segundo capítulo');
  assert.match(SOURCE,/webVisualChapter\(webVisualContainer\(seo\),'03','SEO y visibilidad orgánica'/,'SEO debe cerrar el recorrido');
  assert.match(SOURCE,/ads\.after\(seoContainer\)/,'SEO debe quedar visualmente después de Ads');
  assert.match(SOURCE,/classList\.add\('op-expert-only'\)/,'los controles técnicos deben salir del modo Simple');
  assert.match(SOURCE,/webVisualExplainMetric\('ads-kpi-roas'/,'los KPI deben explicar qué significan');
  assert.match(SOURCE,/MutationObserver/,'el resumen superior debe seguir los datos reales al actualizarse');
  assert.match(SOURCE,/webVisualSetText/,'el espejo de KPI no debe repintar en bucle');
  assert.match(CSS,/#tab-web \.web-guide/);
  assert.match(CSS,/#tab-web \.web-guide-grid/);
  assert.match(CSS,/#tab-web \.web-chapter-head/);
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
  assert.match(body,/callAgentClaude\(\s*['"]SEO['"]/);
  assert.match(body,/JSON\.parse/);
  assert.match(body,/renderSeoIAProps\s*\(/);
  assert.doesNotMatch(body,/airtableWrite|fetch\([^)]*wp-json\/wp\/v2/,'la IA general no debe publicar directamente');
});

test('la auditoría SEO actual no mantiene rutas de publicación WP/Yoast',()=>{
 const live=fs.readFileSync(path.join(JS_DIR,'seo-ads.js'),'utf8');
 assert.doesNotMatch(live,/\/wp-json\/|_yoast_wpseo_|getWPConfig|saveYoastFields|loadWPPages|runSEODiag/);
 assert.match(live,/function runSeoAudit\s*\(/);
});

test('loadAdsData respeta el orden lógico completo del panel',()=>{
  const body=functionBlock(SOURCE,'loadAdsData');
  const fetchPos=body.search(/await\s+fetch\s*\(/);
  const validate=body.search(/if\(!data\.ok\)/);
  const statePos=body.search(/window\._adsLastData\s*=\s*data/);
  assert.ok(fetchPos>=0&&validate>fetchPos&&statePos>validate,'primero debe obtener y validar datos reales');
  const live=body.slice(statePos);
  const kpis=live.search(/renderAdsKPIs\(data/);
  const campaigns=live.search(/renderAdsCampaigns\(data/);
  const agent=live.search(/renderAdsAgent\(data/);
  const capacity=live.search(/renderAdsCapacidad\(data/);
  const suggestions=live.search(/renderAdsSugerencias\(data/);
  const web=live.search(/loadWebStats\s*\(/);
  const pending=live.search(/renderPendingMutations\s*\(/);
  const reconcile=live.search(/syncMutationStatuses\s*\(/);
  const autopilot=live.search(/renderAdsAutopilot\s*\(/);
  const airtable=live.search(/syncAdsToAirtable\(data/);
  assert.ok(kpis>=0&&campaigns>=0&&agent>=0&&capacity>=0&&suggestions>=0,'los renders deben usar la misma respuesta validada');
  assert.ok(web>=0,'GA4 debe cargarse dentro del mismo ciclo');
  assert.ok(pending>=0&&reconcile>pending,'primero muestra la cola y luego concilia con Script 2');
  assert.ok(autopilot>reconcile,'las propuestas deben aparecer después de conciliar cambios previos');
  assert.ok(airtable>=0,'el snapshot debe salir de datos reales ya validados');
});

test('las campañas validan presupuesto, URL, anuncios y límites de Google Ads',()=>{
  const body=functionBlock(SOURCE,'saveCampaignMutation');
  // El piso de $1.000 ya no se comprueba suelto aquí: lo aplica el freno
  // compartido con el botón del agente, que además pone techo. El detalle está
  // en tests/ads-presupuesto.test.js.
  assert.match(body,/adsPresupuestoValido\(/);
  assert.match(SOURCE,/if\(n<1000\)\{toast\('El presupuesto diario debe ser al menos \$1\.000 CLP\.'/);
  assert.match(body,/^\s*if\(!nombre\)/m);
  assert.match(body,/La URL final del anuncio debe empezar con http:\/\/ o https:\/\//);
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

test('el webhook y la clave de Make no están expuestos en el bundle público',()=>{
  const live=fs.readFileSync(path.join(JS_DIR,'seo-ads.js'),'utf8');
  assert.doesNotMatch(live,/hook\.[a-z0-9-]+\.make\.com/i);
  assert.doesNotMatch(live,/ADS_MAKE_SHELL|tl-cascaron/i);
  const bridge=functionBlock(SOURCE,'_adsCreateShellServer');
  assert.match(bridge,/\/ads\/campaign-shell/);
  assert.match(bridge,/X-App-Key/);
});
test('la creación persiste primero la cola y después solicita el cascarón servidor',()=>{
  const save=functionBlock(SOURCE,'saveCampaignMutation');
  const queue=save.indexOf('_adsQueueMutation(mutation)');
  const shell=save.indexOf('_adsCreateShellServer(mutation)');
  assert.ok(queue>=0&&shell>queue,'la orden local debe persistirse antes del cascarón');
  assert.doesNotMatch(save,/hook\.|Make\.com|clave=/i);
});
test('el modo demo usa métricas ficticias y nunca envía mutaciones a Google Ads o Make',()=>{
  const load=functionBlock(SOURCE,'loadAdsData');
  const send=functionBlock(SOURCE,'sendAdsMutation');
  const save=functionBlock(SOURCE,'saveCampaignMutation');
  assert.match(load,/window\._DEMO_MODE\|\|!cfg\.endpoint/);
  assert.match(send,/if\(_adsIsReadOnly\(\)\)/,'explicit demo and fixture fallback must both be blocked');
  assert.match(send,/status=['"]demo['"]/);
  assert.match(save,/if\(!_adsQueueMutation\(mutation\)\)return/);
  assert.match(SOURCE,/ads_demo_pending_mutations/,'la cola demo debe estar separada de la real');
});
test('syncAdsToAirtable hace upsert por fecha/período y campaña',()=>{
  const body=functionBlock(SOURCE,'syncAdsToAirtable');
  assert.match(body,/filterByFormula/);
  assert.match(body,/Customer ID/);
  assert.match(body,/Campaign ID/);
  assert.match(body,/existingK\[0\]\?\.id/);
  assert.match(body,/byId\.get\(cid\)/);
  assert.match(body,/method:'PATCH'/);
  assert.match(body,/method:'POST'/);
});
test('ROAS CRM usa solo ingresos atribuibles a Google Ads',()=>{
  const snap=functionBlock(SOURCE,'adsSaveSnapshot');
  const attr=functionBlock(SOURCE,'_adsAttributedCrm');
  const clientAttr=functionBlock(SOURCE,'_adsClientIsAttributed');
  assert.match(attr,/_adsClientIsAttributed/);
  assert.match(clientAttr,/GCLID|Campaña Ads|google_ads/);
  assert.match(snap,/ingresoAdsCRM/);
  assert.match(snap,/roasAtribuido/);
  assert.doesNotMatch(snap,/const roasReal=gasto>0\?ingresoCRM\/gasto/);
  assert.match(SOURCE,/ROAS atrib\./);
  assert.match(SOURCE,/No se reparte revenue orgánico entre campañas/);
});
test('la carga manual y láser usa pedidos clasificados por su propia línea',()=>{
  const body=functionBlock(SOURCE,'getCapacidadLineas');
  assert.match(body,/const classify=/);
  assert.match(body,/laserCount=lineCount\('carteleria'\)/);
  assert.match(body,/manualCount=activos\.filter/);
  assert.match(body,/laserPct/);
  assert.match(body,/manualPct/);
  assert.doesNotMatch(body,/const pedPct=Math\.min\(Math\.round\(activos\/20/);
});
test('el piloto reserva antes de encolar y deja estado recuperable ante error',()=>{
  const body=functionBlock(SOURCE,'adsAutopilotDecide');
  const reserve=body.indexOf("Estado:'Procesando'");
  const queue=body.indexOf('_adsQueueMutation');
  const complete=body.indexOf("Estado:'Completado'");
  assert.ok(reserve>=0&&queue>reserve&&complete>queue);
  assert.match(body,/Requiere conciliación/);
  assert.match(body,/no la apruebes de nuevo/);
  assert.doesNotMatch(body,/catch\(e\)\{\}/);
});
