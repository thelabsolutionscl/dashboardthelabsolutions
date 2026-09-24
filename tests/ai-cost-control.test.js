#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const SRC=fs.readFileSync('js/ai-cost-control.js','utf8');
const BOOT=fs.readFileSync('js/farm-health-adapter.js','utf8');
const PROXY=fs.readFileSync('airtable-proxy/src/worker.js','utf8');
const PROXY_CONF=fs.readFileSync('airtable-proxy/wrangler.toml','utf8');
const LEAD_CONF=fs.readFileSync('lead-worker/wrangler.toml','utf8');

test('AGENTES muestra control de gasto sin ejecutar modelos',()=>{
  assert.match(SRC,/Presupuesto y tokens de agentes/);
  assert.match(SRC,/anthropic\/usage/);
  assert.match(SRC,/claude_usage_v1/);
  assert.doesNotMatch(SRC,/\/anthropic\/v1\/messages/,'el panel nunca debe generar una llamada pagada');
  assert.match(BOOT,/load\('js\/ai-cost-control\.js','control de consumo IA'\)/);
});

test('proxy aplica presupuesto diario y por solicitud en KV',()=>{
  assert.match(PROXY,/ANTHROPIC_DAILY_BUDGET_USD_DEFAULT = 1\.00/);
  assert.match(PROXY,/ANTHROPIC_REQUEST_BUDGET_USD_DEFAULT = 0\.20/);
  assert.match(PROXY,/reserveAiBudget\(env, payload, source\)/);
  assert.match(PROXY,/code: 'AI_BUDGET_LIMIT'/);
  assert.match(PROXY,/\/anthropic\/usage/);
  assert.match(PROXY_CONF,/ANTHROPIC_DAILY_BUDGET_USD = "1\.00"/);
  assert.match(PROXY_CONF,/binding = "AI_BUDGET"/);
});

test('auto-proceso de leads queda apagado y acotado si se reactiva',()=>{
  assert.match(LEAD_CONF,/AUTO_PROCESS_LEADS = "false"/);
  assert.match(LEAD_CONF,/AUTO_PROCESS_DAILY_CAP = "25"/);
  assert.match(LEAD_CONF,/AI_DAILY_BUDGET_USD = "0\.50"/);
});
