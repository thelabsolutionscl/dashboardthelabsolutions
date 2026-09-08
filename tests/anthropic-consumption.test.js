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
