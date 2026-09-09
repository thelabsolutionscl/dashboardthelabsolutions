'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const html=read('index.html');

test('consumo conserva categorías reales, sin guardar contenido ni secretos',()=>{
  const values=new Map();
  const sandbox={sessionStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},console:{info(){}},AGENT_MODEL:'test'};
  vm.createContext(sandbox);
  vm.runInContext(html.slice(html.indexOf('function _recordClaudeUsage'),html.indexOf('function _claudeText')),sandbox);
  sandbox._recordClaudeUsage({id:'msg_1',model:'haiku',content:'privado',usage:{input_tokens:10,output_tokens:20,cache_creation_input_tokens:30,cache_read_input_tokens:40}},'simulacion');
  const rows=JSON.parse(values.get('claude_usage_v1'));
  assert.equal(rows[0].input_tokens,10);
  assert.equal(rows[0].cache_read_input_tokens,40);
  assert.equal(rows[0].source,'simulacion');
  assert.equal(rows[0].content,undefined);
  for(let i=0;i<501;i++)sandbox._recordClaudeUsage({usage:{input_tokens:1}});
  assert.equal(JSON.parse(values.get('claude_usage_v1')).length,500);
  sandbox.sessionStorage.setItem=()=>{throw Error('storage blocked');};
  assert.doesNotThrow(()=>sandbox._recordClaudeUsage({usage:{input_tokens:1}}));
});

test('ambos análisis Ads dejan que runAgentInline agregue contexto una sola vez',()=>{
  const agentes=read('js/agentes.js');
  const fn=agentes.slice(agentes.indexOf('function runAdsAgent()'),agentes.indexOf('function runAdsAgent()')+1400);
  assert.doesNotMatch(fn,/buildAgentContext/);
  const seo=read('js/seo-ads.js');
  const line=seo.split('\n').find(l=>l.includes('ANALIZA EN PROFUNDIDAD SÓLO ESTA CAMPAÑA'));
  assert.ok(line);
  assert.doesNotMatch(line,/buildAgentContext/);
});

test('deploy no lee ni interpola la clave Anthropic',()=>{
  const deploy=read('.github/workflows/deploy.yml');
  assert.doesNotMatch(deploy,/secrets\.CLAUDE|\$\{ANTHROPIC_KEY\}/);
  assert.ok(deploy.includes("sed -i 's|%%ANTHROPIC_KEY%%||g' index.html"));
});

test('red caída no reintenta una generación de resultado desconocido',async()=>{
  let attempts=0;
  const sandbox={AbortController,setTimeout,clearTimeout,fetch:async()=>{attempts++;throw new TypeError('network');}};
  vm.createContext(sandbox);
  vm.runInContext(html.slice(html.indexOf('async function _claudeHttp'),html.indexOf('async function _callClaudeViaProxy')),sandbox);
  await assert.rejects(sandbox._claudeHttp('https://example.test',{}, {reintentos:2}),/network/);
  assert.equal(attempts,1);
});

test('la política central reserva Sonnet para razonamiento y acota cada salida',()=>{
  const start=html.indexOf('const CLAUDE_MODELS=');
  const end=html.indexOf('// Diagnóstico local',start);
  const sandbox={};vm.createContext(sandbox);
  vm.runInContext(html.slice(start,end)+'\nObject.assign(globalThis,{CLAUDE_MODELS,AGENT_AI_POLICY,agentAiPolicy,_CLAUDE_BODY});',sandbox);
  assert.equal(sandbox.agentAiPolicy('FOLLOWUP').model,'claude-haiku-4-5');
  assert.equal(sandbox.agentAiPolicy('FINANCE').model,'claude-sonnet-4-6');
  assert.equal(sandbox.agentAiPolicy('ADS').model,'claude-sonnet-4-6');
  assert.equal(sandbox.agentAiPolicy('COMMUNITY_AGENT').maxTokens,400);
  const body=JSON.parse(sandbox._CLAUDE_BODY('s','u',{model:'claude-sonnet-4-6',maxTokens:99999}));
  assert.equal(body.max_tokens,2000,'el navegador no puede pedir una salida ilimitada');
});

test('el lead worker solo acepta Haiku/Sonnet y limita el autopilot de Ads',()=>{
  const worker=read('lead-worker/src/index.js');
  assert.match(worker,/const CLAUDE_ALLOWED_MODELS = new Set/);
  assert.doesNotMatch(worker,/CLAUDE_ALLOWED_MODELS[\s\S]{0,180}["']claude-opus/);
  assert.match(worker,/ADS_AUTOPILOT_MODEL \|\| "claude-sonnet-4-6"/);
  assert.match(worker,/maxTokens: 1600/);
});
