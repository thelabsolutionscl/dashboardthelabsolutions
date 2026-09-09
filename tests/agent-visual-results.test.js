'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const HTML=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'styles.css'),'utf8');
const AG=fs.readFileSync(path.join(ROOT,'js','agentes.js'),'utf8');
const KAI=fs.readFileSync(path.join(ROOT,'js','kai.js'),'utf8');
const REDES=fs.readFileSync(path.join(ROOT,'js','redes.js'),'utf8');
const vm=require('node:vm');

function demoResponses(){
  const start=HTML.indexOf('const DEMO_AGENT_RESPONSES=');
  const end=HTML.indexOf('\n\nfunction _demoClaudeResponse',start);
  assert.ok(start>=0&&end>start,'falta el catálogo de respuestas DEMO');
  const source=HTML.slice(start,end).replace('const DEMO_AGENT_RESPONSES=','result=');
  const context={result:null,Object};
  vm.runInNewContext(source,context);
  return context.result;
}

test('cada oficio tiene una presentación visual explícita',()=>{
  const block=HTML.slice(HTML.indexOf('const AGENT_RESULT_PROFILES='),HTML.indexOf('function _agentVisualId'));
  for(const id of ['SALES','QUOTE','PRODUCTION','MANTENCION3D','QA','FOLLOWUP','CEO','LEADGEN','ONBOARDING','FINANCE','REPCLIENTE','CONTENT','ADS','LINKEDIN','SOCIAL_STRATEGIST','CAPTION_AGENT','COMMUNITY_AGENT','SOCIAL_ADS_AGENT','TREND_AGENT','REPORT_SOCIAL_AGENT','NEWSLETTER_AGENT','SUPPLIER','KAI']){
    assert.match(block,new RegExp('\\b'+id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+':'),id+' debe tener perfil visual');
  }
});

test('el renderer conserva la salida completa y no vuelve a llamar a la IA',()=>{
  const block=HTML.slice(HTML.indexOf('function renderAgentResult'),HTML.indexOf('function renderKaiResult'));
  assert.match(block,/formatAgentReport\(raw\)/);
  assert.match(block,/Ver análisis completo/);
  assert.doesNotMatch(block,/callClaude|callAgentClaude|fetch\(/);
});

test('las ejecuciones principales usan el renderer y guardan consumo',()=>{
  assert.match(AG,/renderAgentResult\(agentId,result,meta\)/);
  assert.match(AG,/AGENT_LOG\.add\(cfg\.label,contextText,result,meta\)/);
  assert.match(HTML,/renderAgentResult\(id,_r,meta\)/);
  assert.match(REDES,/renderAgentResult\(agentId,out,meta\)/);
  assert.match(KAI,/renderKaiResult\(clean\|\|'Listo\.',\{usage:turnUsage/);
});

test('DEMO informa cero consumo y Ads respeta el tope neto solicitado',()=>{
  assert.match(HTML,/DEMO · 0 tokens · US\$0,00/);
  const extra=HTML.slice(HTML.indexOf('function _agentExtraVisual'),HTML.indexOf('function renderAgentResult'));
  assert.match(extra,/ads_monthly_cap_net/);
  assert.match(extra,/250000/);
  assert.match(extra,/TOPE MENSUAL NETO/);
});

test('DEMO entrega una respuesta completa y especializada para cada agente',()=>{
  const responses=demoResponses();
  const ids=['sales','quote','production','mantencion3d','qa','followup','ceo','leadgen','onboarding','finance','repcliente','content','ads','linkedin','social_strategist','caption_agent','community_agent','social_ads_agent','trend_agent','report_social_agent','newsletter_agent','supplier'];
  for(const id of ids){
    assert.equal(typeof responses[id],'string',id+' debe tener respuesta DEMO');
    assert.ok(responses[id].length>=300,id+' debe entregar información completa');
    assert.doesNotMatch(responses[id],/la información cargada es consistente/i,id+' no debe usar el fallback genérico');
  }
  assert.match(HTML,/if\(DEMO_AGENT_RESPONSES\[src\]\)return DEMO_AGENT_RESPONSES\[src\]/);
});

test('DEMO conserva los formatos técnicos que alimentan las vistas y acciones',()=>{
  const responses=demoResponses();
  const items=JSON.parse(responses.quote.match(/\[ITEMS\]\s*([\s\S]*?)\s*\[\/ITEMS\]/)[1]);
  const actions=JSON.parse(responses.ads.match(/\[ACTIONS\]\s*([\s\S]*?)\s*\[\/ACTIONS\]/)[1]);
  assert.ok(items.length>=2);
  assert.ok(actions.length>=4&&actions.length<=6);
  assert.ok((responses.qa.match(/^[-*]\s*\[[ xX]\]/gm)||[]).length>=8);
  assert.match(responses.qa,/✅ APROBADO/);
  assert.equal((responses.supplier.match(/---PROVEEDOR_START---/g)||[]).length,4);
  assert.match(responses.supplier,/RECOMENDACIÓN:/);
  for(const marker of ['RESPUESTA_PUBLICA:','ES_LEAD:','INTENCION:','SIGUIENTE_PASO:'])assert.match(responses.community_agent,new RegExp(marker));
  for(const marker of ['SCORE_B2B:','SERVICIO_RECOMENDADO:','DECISOR:','MENSAJE_LINKEDIN:','MENSAJE_EMAIL:','PROXIMA_ACCION:'])assert.match(responses.linkedin,new RegExp(marker));
  for(const marker of ['ASUNTO:','PREHEADER:','CUERPO:'])assert.match(responses.newsletter_agent,new RegExp(marker));
});

test('KAI también responde con panorama y acciones completas sin tokens en DEMO',()=>{
  const ask=KAI.slice(KAI.indexOf('async function ask'),KAI.indexOf('// Si la llamada no llega',KAI.indexOf('async function ask')));
  assert.match(ask,/## Respuesta ejecutiva/);
  assert.match(ask,/## Estado del negocio/);
  assert.match(ask,/## Próximos pasos/);
  assert.match(ask,/DEMO · 0 tok · US\$0,00/);
});

test('el costo usa input, output y ambas categorías de caché',()=>{
  const block=HTML.slice(HTML.indexOf('function _estimateClaudeCost'),HTML.indexOf('// Diagnóstico local'));
  for(const field of ['input_tokens','output_tokens','cache_creation_input_tokens','cache_read_input_tokens'])assert.match(block,new RegExp(field));
  assert.match(HTML,/claude-haiku-4-5':\{input:1,output:5,cacheWrite:1\.25,cacheRead:\.10\}/);
  assert.match(HTML,/claude-sonnet-4-6':\{input:3,output:15,cacheWrite:3\.75,cacheRead:\.30\}/);
});

test('las acciones de QA piden confirmación y la vista responde en móvil',()=>{
  const qa=AG.slice(AG.indexOf('async function saveQAFromAgent'),AG.indexOf('// ── CADENA DE AGENTES'));
  assert.match(qa,/confirm\(/);
  assert.match(CSS,/@media\(max-width:720px\)/);
  assert.match(CSS,/\.avr-kpis\{grid-template-columns:repeat\(2/);
});

test('la vista de agentes permite alternar entre Simplificado y Experto sin regenerar',()=>{
  assert.match(HTML,/data-agent-view-mode="simple"[^>]*>Simplificado</);
  assert.match(HTML,/data-agent-view-mode="expert"[^>]*>Experto</);
  const setter=HTML.slice(HTML.indexOf('function setAgentViewMode'),HTML.indexOf('// Nombre a mostrar',HTML.indexOf('function setAgentViewMode')));
  assert.match(setter,/localStorage\.setItem\(AGENT_VIEW_MODE_KEY/);
  assert.match(setter,/applyAgentViewMode\(\)/);
  assert.doesNotMatch(setter,/callClaude|callAgentClaude|fetch\(/);
  assert.match(CSS,/\.agent-view-simple .*\.avr-special\{display:none/);
  assert.match(CSS,/\.agent-view-expert .*avr-details/);
});

test('los resultados de la parrilla no se cortan ni usan scroll vertical interno',()=>{
  assert.match(CSS,/#tab-agentes #agentesGrid\{grid-template-columns:repeat\(2/);
  assert.match(CSS,/#tab-agentes #agentesGrid \.ai-response\{max-height:none;overflow:visible/);
  assert.match(CSS,/@media\(max-width:900px\)[\s\S]*#tab-agentes #agentesGrid\{grid-template-columns:1fr!important/);
  assert.match(HTML,/out\.scrollTop=0;applyAgentViewMode\(\)/);
});

test('las métricas visuales descartan horas y frases operativas falsas',()=>{
  const metrics=HTML.slice(HTML.indexOf('function _agentResultMetrics'),HTML.indexOf('function _agentModelLabel'));
  assert.match(metrics,/rank===99&&!\/\(score\|probabilidad/);
  assert.match(HTML,/avr-layout-\$\{escapeHtml\(layout\)\}/);
});
