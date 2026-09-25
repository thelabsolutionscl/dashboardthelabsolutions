#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

function cargarGuard(){
  const src=fs.readFileSync(path.join(__dirname,'..','airtable-proxy','src','worker.js'),'utf8')
    .replace('export class AiBudgetGuard','class AiBudgetGuard')
    .replace('export default','const __worker =');
  return new Function(src+'\nreturn AiBudgetGuard;')();
}
const AiBudgetGuard=cargarGuard();

function storage(){
  const m=new Map();
  return {
    map:m,
    api:{
      async get(k){const v=m.get(k);return v===undefined?undefined:structuredClone(v);},
      async put(k,v){m.set(k,structuredClone(v));},
    },
  };
}
function request(pathname,payload){
  return new Request('https://ai-budget.internal'+pathname,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload),
  });
}
async function json(response){return response.json();}

test('dos reservas concurrentes no pueden gastar el mismo saldo',async()=>{
  const st=storage();
  const guard=new AiBudgetGuard({storage:st.api},{});
  const base={
    date:'2026-09-25',
    budget_usd:.05,
    request_budget_usd:.05,
    max_concurrent:4,
    estimated_request_usd:.03,
    source:'test',
    model:'claude-haiku-4-5',
  };
  const [a,b]=await Promise.all([
    guard.fetch(request('/reserve',base)).then(json),
    guard.fetch(request('/reserve',base)).then(json),
  ]);
  const accepted=[a,b].filter(x=>x.ok);
  const rejected=[a,b].filter(x=>!x.ok);
  assert.equal(accepted.length,1,'solo una reserva cabe en US$0,05');
  assert.equal(rejected.length,1,'la segunda debe ver el saldo ya reservado');
  assert.match(rejected[0].error,/Daily AI budget reached/);
});

test('el guard limita ráfagas aunque quede presupuesto',async()=>{
  const st=storage();
  const guard=new AiBudgetGuard({storage:st.api},{});
  const base={
    date:'2026-09-25',
    budget_usd:1,
    request_budget_usd:.20,
    max_concurrent:2,
    estimated_request_usd:.01,
    source:'test',
    model:'claude-haiku-4-5',
  };
  const out=await Promise.all([
    guard.fetch(request('/reserve',base)).then(json),
    guard.fetch(request('/reserve',base)).then(json),
    guard.fetch(request('/reserve',base)).then(json),
  ]);
  assert.equal(out.filter(x=>x.ok).length,2);
  const denied=out.find(x=>!x.ok);
  assert.ok(denied);
  assert.match(denied.error,/Too many concurrent AI requests/);
});

test('la conciliación es idempotente y no duplica gasto',async()=>{
  const st=storage();
  const guard=new AiBudgetGuard({storage:st.api},{});
  const base={
    date:'2026-09-25',
    budget_usd:1,
    request_budget_usd:.20,
    max_concurrent:2,
    estimated_request_usd:.08,
    source:'finance',
    model:'claude-sonnet-4-6',
  };
  const reservation=await guard.fetch(request('/reserve',base)).then(json);
  assert.equal(reservation.ok,true);
  const recon={
    date:base.date,
    reservation_id:reservation.reservation_id,
    actual_usd:.037,
    source:'finance',
  };
  await guard.fetch(request('/reconcile',recon));
  await guard.fetch(request('/reconcile',recon));
  const usage=await guard.fetch(request('/usage',{
    date:base.date,budget_usd:1,request_budget_usd:.20,
  })).then(json);
  assert.equal(usage.spent_usd,.037);
  assert.equal(usage.reserved_usd,0);
  assert.equal(usage.by_source.finance.spent_usd,.037);
});

test('al migrar desde KV trata reservas antiguas como gasto para no regalar saldo',async()=>{
  const st=storage();
  const date='2026-09-25';
  const key='anthropic-budget:'+date;
  const legacy={
    spent_usd:.90,reserved_usd:.05,requests:9,
    by_source:{ceo:{requests:9,spent_usd:.90,reserved_usd:.05}},
  };
  const env={AI_BUDGET:{async get(k){return k===key?JSON.stringify(legacy):null;}}};
  const guard=new AiBudgetGuard({storage:st.api},env);
  const usage=await guard.fetch(request('/usage',{
    date,budget_usd:1,request_budget_usd:.20,
  })).then(json);
  assert.ok(Math.abs(usage.spent_usd-.95)<1e-9);
  assert.ok(Math.abs(usage.remaining_usd-.05)<1e-9);
});
