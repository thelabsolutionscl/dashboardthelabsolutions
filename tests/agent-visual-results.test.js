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
