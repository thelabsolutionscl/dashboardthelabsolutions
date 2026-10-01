#!/usr/bin/env node
import fs from 'node:fs';

const BASE_ID = process.env.PROBLEM_REPORTS_BASE_ID || 'app1YtD74AqiPWQhy';
const TABLE_ID = process.env.PROBLEM_REPORTS_TABLE_ID || 'tbl2kU5lGg1JYcrPi';
const TOKEN = process.env.AIRTABLE_TOKEN || '';
const API = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`;
const STATES = new Set(['Nuevo','En análisis','Reparación preparada','PR abierto','Reparado','Error']);

function fail(message){
  console.error(message);
  process.exitCode = 1;
}
function requireToken(){
  if(!TOKEN) throw new Error('AIRTABLE_TOKEN no configurado');
}
async function airtable(url, options={}){
  requireToken();
  const response = await fetch(url,{
    ...options,
    headers:{
      Authorization:`Bearer ${TOKEN}`,
      Accept:'application/json',
      ...(options.body?{'Content-Type':'application/json'}:{}),
      ...(options.headers||{})
    }
  });
  let body={};
  try{body=await response.json();}catch(_){}
  if(!response.ok) throw new Error(`Airtable HTTP ${response.status}: ${body?.error?.message||body?.error||'respuesta inválida'}`);
  return body;
}
function output(name,value){
  const file=process.env.GITHUB_OUTPUT;
  if(!file)return;
  const text=String(value??'');
  const delimiter=`EOF_${name}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  fs.appendFileSync(file,`${name}<<${delimiter}\n${text}\n${delimiter}\n`);
}
function bounded(value,max=6000){
  return String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').slice(0,max);
}
function screenshotUrl(fields){
  const raw=Array.isArray(fields?.Screenshot)?fields.Screenshot[0]?.url:'';
  if(!raw)return '';
  try{
    const url=new URL(raw);
    if(url.protocol!=='https:')return '';
    const host=url.hostname.toLowerCase();
    if(host==='dl.airtable.com'||host.endsWith('.airtableusercontent.com'))return url.href;
  }catch(_){}
  return '';
}

async function claim(){
  const q=new URLSearchParams();
  q.set('maxRecords','1');
  q.set('pageSize','1');
  q.set('filterByFormula','AND({Auto reparar}=1,{Estado}="Nuevo")');
  q.append('sort[0][field]','Fecha');
  q.append('sort[0][direction]','asc');
  for(const field of ['Reporte ID','Estado','Mensaje','Screenshot','Usuario','Sección','URL','Build','Navegador','Fecha']){
    q.append('fields[]',field);
  }
  const data=await airtable(`${API}?${q}`);
  const rec=Array.isArray(data.records)?data.records[0]:null;
  if(!rec){
    output('found','false');
    return;
  }
  const now=new Date().toISOString();
  await airtable(`${API}/${rec.id}`,{
    method:'PATCH',
    body:JSON.stringify({fields:{
      Estado:'En análisis',
      'Diagnóstico IA':'Reporte tomado por el agente automático. Analizando el repositorio y preparando una reparación aislada.',
      Error:null,
      Actualizado:now
    }})
  });
  const fields=rec.fields||{};
  output('found','true');
  output('record_id',rec.id);
  output('report_id',bounded(fields['Reporte ID'],120));
  output('message',bounded(fields.Mensaje,6000));
  output('section',bounded(fields['Sección'],120));
  output('source_url',bounded(fields.URL,1200));
  output('build',bounded(fields.Build,160));
  output('browser',bounded(fields.Navegador,1200));
  output('reporter',bounded(fields.Usuario,254));
  output('screenshot_url',screenshotUrl(fields));
}

async function update(){
  const recordId=String(process.env.PROBLEM_RECORD_ID||'');
  const state=String(process.env.PROBLEM_STATE||'');
  if(!/^rec[A-Za-z0-9]{14}$/.test(recordId)) throw new Error('PROBLEM_RECORD_ID inválido');
  if(!STATES.has(state)) throw new Error('PROBLEM_STATE inválido');
  const fields={Estado:state,Actualizado:new Date().toISOString()};
  if(process.env.PROBLEM_DIAGNOSIS!==undefined)fields['Diagnóstico IA']=bounded(process.env.PROBLEM_DIAGNOSIS,6000);
  if(process.env.PROBLEM_PLAN!==undefined)fields['Plan reparación']=bounded(process.env.PROBLEM_PLAN,6000);
  if(process.env.PROBLEM_PR_URL!==undefined)fields['PR URL']=bounded(process.env.PROBLEM_PR_URL,1200)||null;
  if(process.env.PROBLEM_ERROR!==undefined)fields.Error=bounded(process.env.PROBLEM_ERROR,6000)||null;
  if(state==='Reparado'&&!Object.hasOwn(fields,'Error'))fields.Error=null;
  await airtable(`${API}/${recordId}`,{method:'PATCH',body:JSON.stringify({fields})});
}

async function result(){
  const file=process.argv[3]||'.problem-repair-result.json';
  let parsed={};
  try{parsed=JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){}
  output('diagnosis',bounded(parsed.diagnosis||parsed.diagnostico||'El agente analizó el reporte y preparó una corrección en el repositorio.',6000));
  output('plan',bounded(parsed.plan||parsed.planReparacion||'Aplicar el cambio mínimo, ejecutar la suite completa y revisar el PR generado.',6000));
}

async function main(){
  const command=process.argv[2];
  if(command==='claim')return claim();
  if(command==='update')return update();
  if(command==='result')return result();
  throw new Error('Uso: problem-repair-queue.mjs <claim|update|result>');
}
main().catch(error=>fail(error?.stack||error?.message||String(error)));
