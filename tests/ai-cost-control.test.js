#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const SRC=fs.readFileSync('js/ai-cost-control.js','utf8');
const BOOT=fs.readFileSync('js/farm-health-adapter.js','utf8');
const PROXY=fs.readFileSync('airtable-proxy/src/worker.js','utf8');
const PROXY_CONF=fs.readFileSync('airtable-proxy/wrangler.toml','utf8');
const LEAD=fs.readFileSync('lead-worker/src/index.js','utf8');
const LEAD_CONF=fs.readFileSync('lead-worker/wrangler.toml','utf8');
const DEPLOY_WORKERS=fs.readFileSync('.github/workflows/deploy-worker.yml','utf8');

test('AGENTES muestra control de gasto sin ejecutar modelos',()=>{
  assert.match(SRC,/Presupuesto y tokens de agentes/);
  assert.match(SRC,/anthropic\/usage/);
  assert.match(SRC,/claude_usage_v1/);
  assert.doesNotMatch(SRC,/\/anthropic\/v1\/messages/,'el panel nunca debe generar una llamada pagada');
  assert.match(BOOT,/load\('js\/ai-cost-control\.js','control de consumo IA'\)/);
});

test('alerta de gasto es global y escala en 50, 75 y 90 por ciento',()=>{
  assert.match(SRC,/aiCostGlobalAlert/);
  assert.match(SRC,/pct>=90/);
  assert.match(SRC,/pct>=75/);
  assert.match(SRC,/pct>=50/);
  assert.match(SRC,/position:fixed/,'debe verse fuera de la pestaña Agentes');
  assert.match(SRC,/role','alert|setAttribute\('role','alert'\)/);
});

test('proxy aplica hard cap atómico de US$0.50, US$0.10 por solicitud y una concurrente',()=>{
  assert.match(PROXY,/ANTHROPIC_DAILY_BUDGET_USD_DEFAULT = 0\.50/);
  assert.match(PROXY,/ANTHROPIC_REQUEST_BUDGET_USD_DEFAULT = 0\.10/);
  assert.match(PROXY,/export class AiBudgetGuard/,'el ledger debe vivir en un Durable Object');
  assert.match(PROXY,/this\._queue = Promise\.resolve\(\)/,'las mutaciones del ledger deben serializarse');
  assert.match(PROXY,/env\.AI_BUDGET_GUARD/,'producción debe usar el guard atómico');
  assert.match(PROXY,/max_concurrent: 1/,'producción autoriza una sola llamada simultánea');
  assert.match(PROXY,/code: 'AI_BUDGET_LIMIT'/);
  assert.match(PROXY,/\/anthropic\/usage/);
  assert.match(PROXY_CONF,/ANTHROPIC_DAILY_BUDGET_USD = "0\.50"/);
  assert.match(PROXY_CONF,/ANTHROPIC_REQUEST_BUDGET_USD = "0\.10"/);
  assert.match(PROXY_CONF,/name = "AI_BUDGET_GUARD"/);
  assert.match(PROXY_CONF,/new_sqlite_classes = \["AiBudgetGuard"\]/);
  assert.match(PROXY_CONF,/binding = "AI_BUDGET"/,'KV se conserva solo para migrar el saldo previo del día');
});

test('lead-worker no posee key Anthropic y entra al mismo proxy protegido',()=>{
  assert.match(LEAD_CONF,/AUTO_PROCESS_LEADS = "false"/);
  assert.match(LEAD_CONF,/AUTO_PROCESS_DAILY_CAP = "25"/);
  assert.match(LEAD_CONF,/AI_PROXY_URL = "https:\/\/airtable-proxy\./);
  assert.doesNotMatch(LEAD_CONF,/ANTHROPIC_API_KEY|AI_DAILY_BUDGET_USD/);
  assert.match(LEAD,/env\.AI_PROXY_URL/);
  assert.match(LEAD,/env\.AI_PROXY_KEY/);
  assert.match(LEAD,/X-App-Key/);
  assert.match(LEAD,/\/anthropic\/v1\/messages/);
  assert.doesNotMatch(LEAD,/https:\/\/api\.anthropic\.com/);
  assert.doesNotMatch(LEAD,/ANTHROPIC_API_KEY/);
  assert.match(DEPLOY_WORKERS,/AI_PROXY_KEY:\s*\$\{\{ secrets\.PROXY_KEY \}\}/);
});
