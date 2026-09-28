#!/usr/bin/env node
/*
 * airtable-proxy: el allowlist de origen no puede dejar pasar peticiones sin Origin.
 *
 * El proxy guarda los secretos (PAT de Airtable, keys de Claude/OpenAI) y solo
 * exige una APP_KEY que —según el propio diseño— va horneada en el HTML público.
 * Su única defensa contra una clave filtrada es el allowlist de Origin. Pero el
 * chequeo era `if (origin && !ALLOWED_ORIGINS.includes(origin))`: una petición
 * SIN header Origin (curl, un script, server-to-server) se lo saltaba entera y,
 * con la clave pública, podía leer/escribir Airtable o gastar créditos de IA.
 * Todo cliente legítimo es un navegador en el dashboard, que SIEMPRE manda Origin
 * (la petición lleva X-App-Key, header que fuerza CORS). Exigir un Origin válido
 * cierra el agujero sin romper a nadie.
 *
 * Se monta el fetch handler REAL de worker.js sobre un fetch de upstream simulado.
 *
 * Correr:  node --test tests/airtable-proxy.test.js
 */
'use strict';
// This harness deliberately exercises the legacy no-Access configuration.
global.accessAuthorize=async()=>({legacy:true});
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Carga el export por defecto del worker (módulo ES) ejecutando su fuente
// completo: se reemplaza `export default` por una captura y se devuelve al final,
// de modo que TODO el módulo se inicializa igual que en Cloudflare.
function cargarWorker() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'airtable-proxy', 'src', 'worker.js'), 'utf8').replace("import { accessAuthorize } from './access-auth.js';",'');
  const body = src.replace('export class AiBudgetGuard', 'class AiBudgetGuard').replace('export class CrmMutationGuard','class CrmMutationGuard').replace('export default', 'const __wk =') + '\nreturn __wk;';
  return new Function(body)();
}
const worker = cargarWorker();

const _kv = new Map();
const MEM_KV = {
  async get(k){ return _kv.has(k)?_kv.get(k):null; },
  async put(k,v){ _kv.set(k,String(v)); },
  async delete(k){ _kv.delete(k); },
};
const ENV = {
  APP_KEY: 'passphrase-larga-y-secreta-1234',
  AIRTABLE_TOKEN: 'patTEST123',
  ANTHROPIC_TOKEN: 'sk-ant-test',
  OPENAI_TOKEN: 'sk-openai-test',
  AI_BUDGET: MEM_KV,
  ANTHROPIC_DAILY_BUDGET_USD: '1.00',
  ANTHROPIC_REQUEST_BUDGET_USD: '0.20',
  // El fallback KV existe solo para conservar estos tests del ledger legado.
  // Producción exige AI_BUDGET_GUARD y falla cerrado sin él.
  __TEST_ALLOW_KV_BUDGET: true,
};
const OK_ORIGIN = 'https://dashboard.thelab.solutions';
const HAIKU_BODY = JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 800, messages: [{ role: 'user', content: 'hola' }] });

// Request mínimo: el worker solo usa method, url, headers.get() y body.
function req(pathname, { method = 'GET', origin, key, contentType, body, aiAgent } = {}) {
  const h = {};
  if (origin !== undefined) h['origin'] = origin;
  if (key !== undefined) h['x-app-key'] = key;
  if (contentType) h['content-type'] = contentType;
  if (aiAgent) h['x-ai-agent'] = aiAgent;
  return {
    method,
    url: 'https://airtable-proxy.example.workers.dev' + pathname,
    headers: { get: (k) => (k.toLowerCase() in h ? h[k.toLowerCase()] : null) },
    body: body ?? null,
  };
}

// Reemplaza global.fetch por un espía; devuelve {calls, restore}.
function espiarFetch(status = 200, payload = '{"records":[]}') {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (u, opts = {}) => {
    calls.push({ url: String(u), opts });
    return new Response(payload, { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, restore: () => { global.fetch = orig; } };
}

// Alcance real del PAT: nunca permitir que APP_KEY acceda a otra base.
test('una APP_KEY válida no permite consultar otra base Airtable', async () => {
  const spy = espiarFetch();
  try {
    const r = await worker.fetch(req('/appOTRA1111111111/Clientes', {
      origin: OK_ORIGIN, key: ENV.APP_KEY
    }), ENV, undefined);
    assert.equal(r.status, 403);
    assert.equal(spy.calls.length, 0);
  } finally { spy.restore(); }
});

test('una APP_KEY válida no permite administrar metadata de otra base', async () => {
  const spy = espiarFetch();
  try {
    const r = await worker.fetch(req('/meta/bases/appOTRA1111111111/tables', {
      origin: OK_ORIGIN, key: ENV.APP_KEY
    }), ENV, undefined);
    assert.equal(r.status, 403);
    assert.equal(spy.calls.length, 0);
  } finally { spy.restore(); }
});

test('la consulta legítima de metadata de la base TLS sigue disponible', async () => {
  const spy = espiarFetch(200, '{"tables":[]}');
  try {
    const r = await worker.fetch(req('/meta/bases/app1YtD74AqiPWQhy/tables', {
      origin: OK_ORIGIN, key: ENV.APP_KEY
    }), ENV, undefined);
    assert.equal(r.status, 200);
    assert.equal(spy.calls.length, 1);
    assert.equal(spy.calls[0].url, 'https://api.airtable.com/v0/meta/bases/app1YtD74AqiPWQhy/tables');
  } finally { spy.restore(); }
});


// La clave del navegador no debe permitir modificar estructura de producción.
// El bootstrap actual sigue funcionando únicamente para esquemas conocidos.
test('el proxy bloquea DELETE/PATCH de metadata incluso con la clave correcta',async()=>{
  const spy=espiarFetch();
  try{
    for(const method of ['DELETE','PATCH']){
      const r=await worker.fetch(req('/meta/bases/app1YtD74AqiPWQhy/tables/tblvVAc4TtiERA0Tc',{
        origin:OK_ORIGIN,key:ENV.APP_KEY,method
      }),ENV,undefined);
      assert.equal(r.status,403);
    }
    assert.equal(spy.calls.length,0);
  }finally{spy.restore();}
});

test('un cliente no puede crear tablas desconocidas del esquema TLS',async()=>{
  const spy=espiarFetch();
  try{
    const r=await worker.fetch(req('/meta/bases/app1YtD74AqiPWQhy/tables',{
      origin:OK_ORIGIN,key:ENV.APP_KEY,method:'POST',body:JSON.stringify({
        name:'Backdoor',fields:[{name:'Material',type:'singleLineText'}]
      })
    }),ENV,undefined);
    assert.equal(r.status,403);
    assert.equal(spy.calls.length,0);
  }finally{spy.restore();}
});

test('un cliente no puede agregar campos arbitrarios ni editar campos existentes',async()=>{
  const spy=espiarFetch();
  try{
    const r=await worker.fetch(req('/meta/bases/app1YtD74AqiPWQhy/tables/tblvVAc4TtiERA0Tc/fields',{
      origin:OK_ORIGIN,key:ENV.APP_KEY,method:'POST',body:JSON.stringify({name:'Campo desconocido',type:'singleLineText'})
    }),ENV,undefined);
    assert.equal(r.status,403);
    assert.equal(spy.calls.length,0);
  }finally{spy.restore();}
});

test('el bootstrap legítimo de tablas sigue disponible tras verificar el esquema real',async()=>{
  const spy=espiarFetch(200,'{"tables":[]}');
  try{
    const r=await worker.fetch(req('/meta/bases/app1YtD74AqiPWQhy/tables',{
      origin:OK_ORIGIN,key:ENV.APP_KEY,method:'POST',body:JSON.stringify({
        name:'Inventario',fields:[{name:'Material',type:'singleLineText'}]
      })
    }),ENV,undefined);
    assert.equal(r.status,200);
    assert.equal(spy.calls.length,2,'un GET de verificación y un POST de creación');
    assert.equal(spy.calls[0].url,'https://api.airtable.com/v0/meta/bases/app1YtD74AqiPWQhy/tables');
    assert.equal(spy.calls[1].opts.method,'POST');
  }finally{spy.restore();}
});

test('el bootstrap legítimo de campo solo toca tablas conocidas y no duplica campos',async()=>{
  const good={tables:[{id:'tblvVAc4TtiERA0Tc',name:'Cotizaciones',fields:[]}]};
  const spy=espiarFetch(200,JSON.stringify(good));
  try{
    const reqOpts={origin:OK_ORIGIN,key:ENV.APP_KEY,method:'POST',body:JSON.stringify({
      name:'Detalle JSON',type:'multilineText'
    })};
    const path='/meta/bases/app1YtD74AqiPWQhy/tables/tblvVAc4TtiERA0Tc/fields';
    const r=await worker.fetch(req(path,reqOpts),ENV,undefined);
    assert.equal(r.status,200);
    assert.equal(spy.calls.length,2);
    assert.equal(spy.calls[1].opts.method,'POST');
  }finally{spy.restore();}
});

test('un POST de esquema falla cerrado si no puede consultar el esquema autoritativo',async()=>{
  const spy=espiarFetch(500,'{}');
  try{
    const r=await worker.fetch(req('/meta/bases/app1YtD74AqiPWQhy/tables',{
      origin:OK_ORIGIN,key:ENV.APP_KEY,method:'POST',body:JSON.stringify({
        name:'Inventario',fields:[{name:'Material',type:'singleLineText'}]
      })
    }),ENV,undefined);
    assert.equal(r.status,502);
    assert.equal(spy.calls.length,1,'nunca hace el POST después de fallar el GET');
  }finally{spy.restore();}
});

// ── El corazón del arreglo ──────────────────────────────────────────────

test('SIN Origin, aun con clave válida, se rechaza y NO llega al upstream', async () => {
  const spy = espiarFetch();
  try {
    const r = await worker.fetch(req('/app1YtD74AqiPWQhy/Clientes', { key: ENV.APP_KEY }), ENV, undefined);
    assert.equal(r.status, 403, 'una petición sin Origin no debe pasar');
    assert.equal(spy.calls.length, 0, 'no debe tocar Airtable');
    const j = await r.json();
    assert.match(j.error, /origin/i);
  } finally { spy.restore(); }
});

test('SIN Origin no puede llegar al proxy de Anthropic (gastar créditos)', async () => {
  const spy = espiarFetch();
  try {
    const r = await worker.fetch(
      req('/anthropic/v1/messages', { method: 'POST', key: ENV.APP_KEY, contentType: 'application/json', body: '{}' }),
      ENV, undefined
    );
    assert.equal(r.status, 403);
    assert.equal(spy.calls.length, 0, 'no debe llamar a api.anthropic.com');
  } finally { spy.restore(); }
});

// ── El camino legítimo sigue funcionando ────────────────────────────────

test('con Origin permitido y clave válida, la petición Airtable llega al upstream', async () => {
  const spy = espiarFetch();
  try {
    const r = await worker.fetch(req('/app1YtD74AqiPWQhy/Clientes', { origin: OK_ORIGIN, key: ENV.APP_KEY }), ENV, undefined);
    assert.equal(r.status, 200);
    assert.equal(spy.calls.length, 1, 'reenvía al upstream');
    assert.match(spy.calls[0].url, /^https:\/\/api\.airtable\.com\/v0\/app1YtD74AqiPWQhy\/Clientes/);
    assert.equal(spy.calls[0].opts.headers.get('Authorization'), 'Bearer patTEST123');
  } finally { spy.restore(); }
});

test('con Origin permitido, el proxy de Anthropic reenvía con la x-api-key del server', async () => {
  const spy = espiarFetch(200, '{"content":[]}');
  try {
    const r = await worker.fetch(
      req('/anthropic/v1/messages', { method: 'POST', origin: OK_ORIGIN, key: ENV.APP_KEY, contentType: 'application/json', body: HAIKU_BODY }),
      ENV, undefined
    );
    assert.equal(r.status, 200);
    assert.equal(spy.calls.length, 1);
    assert.match(spy.calls[0].url, /^https:\/\/api\.anthropic\.com\/v1\/messages/);
    assert.equal(spy.calls[0].opts.headers.get('x-api-key'), 'sk-ant-test');
  } finally { spy.restore(); }
});

test('el proxy bloquea modelos Anthropic caros aunque origen y clave sean válidos', async () => {
  const spy = espiarFetch();
  try {
    const body = JSON.stringify({ model: 'claude-opus-4-6', max_tokens: 800, messages: [] });
    const r = await worker.fetch(req('/anthropic/v1/messages', { method: 'POST', origin: OK_ORIGIN, key: ENV.APP_KEY, body }), ENV, undefined);
    assert.equal(r.status, 403);
    assert.equal(spy.calls.length, 0, 'un modelo fuera de política no llega a Anthropic');
  } finally { spy.restore(); }
});

test('el proxy limita la salida máxima para evitar respuestas descontroladas', async () => {
  const spy = espiarFetch();
  try {
    const body = JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 5000, messages: [] });
    const r = await worker.fetch(req('/anthropic/v1/messages', { method: 'POST', origin: OK_ORIGIN, key: ENV.APP_KEY, body }), ENV, undefined);
    assert.equal(r.status, 400);
    assert.equal(spy.calls.length, 0);
  } finally { spy.restore(); }
});

test('el proxy no expone otros endpoints de Anthropic', async () => {
  const spy = espiarFetch();
  try {
    const r = await worker.fetch(req('/anthropic/v1/models', { method: 'GET', origin: OK_ORIGIN, key: ENV.APP_KEY }), ENV, undefined);
    assert.equal(r.status, 404);
    assert.equal(spy.calls.length, 0);
  } finally { spy.restore(); }
});

// ── OpenAI: allowlist + presupuesto ─────────────────────────────────────

test('OpenAI no expone endpoints genéricos aunque origen y clave sean válidos', async () => {
  const spy=espiarFetch();
  try{
    const r=await worker.fetch(req('/openai/v1/models',{method:'POST',origin:OK_ORIGIN,key:ENV.APP_KEY}),ENV,undefined);
    assert.equal(r.status,404);
    assert.equal(spy.calls.length,0);
  }finally{spy.restore();}
});

test('OpenAI bloquea modelos de chat fuera de política', async () => {
  const spy=espiarFetch();
  try{
    const body=JSON.stringify({model:'gpt-5.6-sol',max_tokens:100,messages:[]});
    const r=await worker.fetch(req('/openai/v1/chat/completions',{method:'POST',origin:OK_ORIGIN,key:ENV.APP_KEY,body}),ENV,undefined);
    assert.equal(r.status,403);
    assert.equal(spy.calls.length,0);
  }finally{spy.restore();}
});

test('OpenAI bloquea generaciones que suban calidad o cantidad', async () => {
  const spy=espiarFetch();
  try{
    const body=JSON.stringify({model:'gpt-image-1',prompt:'x',n:1,size:'1024x1024',quality:'high'});
    const r=await worker.fetch(req('/openai/v1/images/generations',{method:'POST',origin:OK_ORIGIN,key:ENV.APP_KEY,body}),ENV,undefined);
    assert.equal(r.status,400);
    assert.equal(spy.calls.length,0);
  }finally{spy.restore();}
});

test('OpenAI permitido consume del mismo presupuesto global de IA', async () => {
  _kv.clear();
  const spy=espiarFetch(200,JSON.stringify({data:[{b64_json:'AA=='}]}));
  try{
    const body=JSON.stringify({model:'gpt-image-1',prompt:'x',n:1,size:'1024x1024',quality:'low'});
    const r=await worker.fetch(req('/openai/v1/images/generations',{
      method:'POST',origin:OK_ORIGIN,key:ENV.APP_KEY,contentType:'application/json',body,aiAgent:'ficha'
    }),ENV,undefined);
    assert.equal(r.status,200);
    assert.equal(spy.calls.length,1);
    assert.match(spy.calls[0].url,/api\.openai\.com\/v1\/images\/generations/);
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago'}).format(new Date());
    const row=JSON.parse(await MEM_KV.get('anthropic-budget:'+date));
    assert.equal(row.by_source.ficha.requests,1);
    assert.equal(row.spent_usd,0.03);
    assert.equal(row.reserved_usd,0);
  }finally{spy.restore();_kv.clear();}
});

test('OpenAI usage consulta el ledger sin ejecutar un modelo', async () => {
  const spy=espiarFetch();
  try{
    const r=await worker.fetch(req('/openai/usage',{origin:OK_ORIGIN,key:ENV.APP_KEY}),ENV,undefined);
    assert.equal(r.status,200);
    assert.equal(spy.calls.length,0);
  }finally{spy.restore();}
});

// ── Chequeos que ya existían y deben seguir en pie ──────────────────────

test('Origin de otro sitio se rechaza aunque la clave sea válida', async () => {
  const spy = espiarFetch();
  try {
    const r = await worker.fetch(req('/app1YtD74AqiPWQhy/Clientes', { origin: 'https://evil.example', key: ENV.APP_KEY }), ENV, undefined);
    assert.equal(r.status, 403);
    assert.equal(spy.calls.length, 0);
  } finally { spy.restore(); }
});

test('clave incorrecta se rechaza aun con Origin válido', async () => {
  const spy = espiarFetch();
  try {
    const r = await worker.fetch(req('/app1YtD74AqiPWQhy/Clientes', { origin: OK_ORIGIN, key: 'mala' }), ENV, undefined);
    assert.equal(r.status, 403);
    assert.equal(spy.calls.length, 0);
    const j = await r.json();
    assert.match(j.error, /Unauthorized/);
  } finally { spy.restore(); }
});

test('/health responde sin Origin ni clave (monitores de uptime)', async () => {
  const r = await worker.fetch(req('/health'), ENV, undefined);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  // Solo booleanos de configuración, sin exponer los secretos.
  assert.equal(j.airtable, true);
  assert.equal(j.anthropic, true);
});

test('OPTIONS (preflight) responde 204 sin tocar upstream', async () => {
  const spy = espiarFetch();
  try {
    const r = await worker.fetch(req('/app1YtD74AqiPWQhy/Clientes', { method: 'OPTIONS', origin: OK_ORIGIN }), ENV, undefined);
    assert.equal(r.status, 204);
    assert.equal(spy.calls.length, 0);
  } finally { spy.restore(); }
});

// ── El código lo dice ───────────────────────────────────────────────────

test('el chequeo ya no depende de que el Origin exista', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'airtable-proxy', 'src', 'worker.js'), 'utf8');
  assert.match(src, /if \(!ALLOWED_ORIGINS\.includes\(origin\)\) \{/, 'exige Origin en la lista');
  assert.doesNotMatch(src, /if \(origin && !ALLOWED_ORIGINS\.includes\(origin\)\)/, 'ya no está el guard con agujero');
});


test('el proxy expone el presupuesto diario sin ejecutar ningún modelo', async () => {
  const spy = espiarFetch();
  try {
    const r = await worker.fetch(req('/anthropic/usage', { origin: OK_ORIGIN, key: ENV.APP_KEY }), ENV, undefined);
    assert.equal(r.status, 200);
    assert.equal(spy.calls.length, 0);
    const j = await r.json();
    assert.equal(j.configured, true);
    assert.equal(j.budget_usd, 1);
    assert.ok(j.remaining_usd >= 0);
  } finally { spy.restore(); }
});

test('el proxy reserva costo por agente y bloquea cuando el presupuesto diario ya está consumido', async () => {
  _kv.clear();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
  await MEM_KV.put('anthropic-budget:'+date, JSON.stringify({spent_usd:.999,reserved_usd:0,requests:3,by_source:{}}));
  const spy = espiarFetch(200, JSON.stringify({model:'claude-haiku-4-5',content:[],usage:{input_tokens:1,output_tokens:1}}));
  try {
    const r = await worker.fetch(req('/anthropic/v1/messages', {
      method:'POST', origin:OK_ORIGIN, key:ENV.APP_KEY, body:HAIKU_BODY, aiAgent:'followup'
    }), ENV, undefined);
    assert.equal(r.status,429);
    assert.equal(spy.calls.length,0,'no debe tocar Anthropic si el presupuesto está agotado');
    const j=await r.json();
    assert.equal(j.code,'AI_BUDGET_LIMIT');
  } finally { spy.restore(); _kv.clear(); }
});

test('la fuente del agente se guarda para atribuir gasto', async () => {
  _kv.clear();
  const spy = espiarFetch(200, JSON.stringify({model:'claude-haiku-4-5',content:[],usage:{input_tokens:8,output_tokens:2}}));
  try {
    const ctx={waitUntil(){}};
    const r=await worker.fetch(req('/anthropic/v1/messages', {
      method:'POST',origin:OK_ORIGIN,key:ENV.APP_KEY,body:HAIKU_BODY,aiAgent:'sales'
    }),ENV,ctx);
    assert.equal(r.status,200);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
    const row=JSON.parse(await MEM_KV.get('anthropic-budget:'+date));
    assert.equal(row.by_source.sales.requests,1);
  } finally { spy.restore(); _kv.clear(); }
});


test('un rechazo de Anthropic libera la reserva para poder reintentar después de recargar créditos', async () => {
  _kv.clear();
  const spy = espiarFetch(402, JSON.stringify({type:'error',error:{type:'billing_error',message:'credit balance is too low'}}));
  const waits=[];
  const ctx={waitUntil(p){waits.push(p);}};
  try {
    const r=await worker.fetch(req('/anthropic/v1/messages', {
      method:'POST',origin:OK_ORIGIN,key:ENV.APP_KEY,body:HAIKU_BODY,aiAgent:'ceo'
    }),ENV,ctx);
    assert.equal(r.status,402);
    await Promise.all(waits);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
    const row=JSON.parse(await MEM_KV.get('anthropic-budget:'+date));
    assert.equal(row.reserved_usd,0,'el error de facturación no debe consumir presupuesto reservado');
    assert.equal(row.by_source.ceo.reserved_usd,0);
    assert.match(row.last_release_reason,/upstream_http_402/);
  } finally { spy.restore(); _kv.clear(); }
});

test('el presupuesto se autorrepara si quedó una reserva huérfana de una llamada antigua', async () => {
  _kv.clear();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
  await MEM_KV.put('anthropic-budget:'+date, JSON.stringify({
    spent_usd:.10,reserved_usd:.40,requests:4,
    updated_at:new Date(Date.now()-10*60*1000).toISOString(),
    by_source:{ceo:{requests:2,spent_usd:.10,reserved_usd:.40}}
  }));
  const spy=espiarFetch();
  try {
    const r=await worker.fetch(req('/anthropic/usage',{origin:OK_ORIGIN,key:ENV.APP_KEY}),ENV,undefined);
    assert.equal(r.status,200);
    const j=await r.json();
    assert.equal(j.reserved_usd,0);
    assert.equal(j.used_usd,.10);
    assert.equal(j.by_source.ceo.reserved_usd,0);
    assert.ok(j.remaining_usd>.8);
    assert.equal(spy.calls.length,0);
  } finally { spy.restore(); _kv.clear(); }
});
