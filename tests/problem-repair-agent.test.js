#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const WORKFLOW=fs.readFileSync(path.join(__dirname,'../.github/workflows/problem-repair-agent.yml'),'utf8');
const QUEUE=fs.readFileSync(path.join(__dirname,'../scripts/problem-repair-queue.mjs'),'utf8');

test('cola toma solo un reporte Nuevo con Auto reparar activado',()=>{
  assert.match(QUEUE,/maxRecords','1'/);
  assert.match(QUEUE,/AND\(\{Auto reparar\}=1,\{Estado\}="Nuevo"\)/);
  assert.match(QUEUE,/Estado:'En análisis'/);
  assert.match(WORKFLOW,/concurrency:\s*[\s\S]*group: problem-repair-agent/);
});

test('agente queda acotado por modelo, turnos y suite completa',()=>{
  assert.match(WORKFLOW,/--model claude-sonnet-4-6/);
  assert.match(WORKFLOW,/--max-turns 8/);
  assert.match(WORKFLOW,/node --test tests\/\*\.test\.js/);
  assert.match(WORKFLOW,/git diff --check/);
});

test('reparaciones se hacen en rama y PR antes del merge',()=>{
  assert.match(WORKFLOW,/autofix\//);
  assert.match(WORKFLOW,/gh pr create --base main --head/);
  assert.doesNotMatch(WORKFLOW,/gh pr merge "\$PR_URL" --squash --delete-branch/);
  assert.match(WORKFLOW,/Mantener PR automático pendiente de verificaciones obligatorias/);
  assert.doesNotMatch(WORKFLOW,/git push\s+origin\s+main/);
});

test('cambios sensibles nunca se auto fusionan',()=>{
  for(const scope of ['.github/*','airtable-proxy/*','lead-worker/*','sii-worker/*','printer-bridge/*','mail-api.php','SECURITY.md']){
    assert.ok(WORKFLOW.includes(scope),scope);
  }
  assert.match(WORKFLOW,/risky=true/);
  assert.match(WORKFLOW,/steps\.risk\.outputs\.safe == 'true'/);
});

test('el historial recibe diagnóstico plan PR y estados finales',()=>{
  assert.match(QUEUE,/Diagnóstico IA/);
  assert.match(QUEUE,/Plan reparación/);
  assert.match(QUEUE,/PR URL/);
  for(const state of ['En análisis','PR abierto','Reparado','Error'])assert.ok(QUEUE.includes(state),state);
  assert.match(WORKFLOW,/problem-report-record:/);
});

test('screenshot remoto se limita a hosts de Airtable y HTTPS',()=>{
  assert.match(QUEUE,/url\.protocol!=='https:'/);
  assert.match(QUEUE,/airtableusercontent\.com/);
  assert.match(QUEUE,/dl\.airtable\.com/);
  assert.match(WORKFLOW,/--proto '=https'/);
});


test('no usa cadenas vacías en ternarios simulados de GitHub Actions',()=>{
  assert.doesNotMatch(WORKFLOW,/&&\s*''\s*\|\|/,'una cadena vacía es falsy y activaría el fallback incorrectamente');
  assert.match(WORKFLOW,/Cerrar reporte fusionado/);
  assert.match(WORKFLOW,/github\.event\.pull_request\.merged == true/);
  assert.match(WORKFLOW,/Cerrar reporte sin fusionar/);
  assert.match(WORKFLOW,/github\.event\.pull_request\.merged != true/);
});

test('un PR con tests aprobados no escribe un Error falso',()=>{
  assert.match(WORKFLOW,/Vincular PR aprobado al reporte[\s\S]*?steps\.tests\.outcome == 'success'[\s\S]*?PROBLEM_STATE: PR abierto/);
  assert.match(WORKFLOW,/Vincular PR con pruebas fallidas[\s\S]*?steps\.tests\.outcome != 'success'[\s\S]*?PROBLEM_STATE: Error/);
});


test('revisa la cola cada cinco minutos sin aumentar concurrencia',()=>{
  assert.match(WORKFLOW,/cron: '\*\/5 \* \* \* \*'/);
  assert.match(WORKFLOW,/group: problem-repair-agent/);
  assert.match(WORKFLOW,/cancel-in-progress: false/);
});
