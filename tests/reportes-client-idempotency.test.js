#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const INDEX=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=INDEX.indexOf('function _reporteSemanaDeRegistro(');
const end=INDEX.indexOf('// ── Reporte CEO surtido',start);
assert.ok(start>=0&&end>start,'report creation section missing');
const SRC=INDEX.slice(start,end);
function harness(options={}){
  const calls={ai:0,writes:0,prefetch:0,health:0,prompts:0,render:0,toasts:[]};
  const btn={disabled:false,textContent:'',innerHTML:''};
  const out={classList:{remove:()=>{}},style:{},textContent:'',innerHTML:''};
  const input={ 'rep-semana':'2026-W40','rep-revenue':'100000',
    'rep-cot-env':'3','rep-cot-apr':'1','rep-ped-act':'2','rep-ped-des':'1','rep-notas':''
  };
  const document={getElementById:id=>id==='createReporteBtn'?btn:
    id==='reporteOutput'?out:{get value(){return input[id];},set value(v){input[id]=v;}}};
  const existing=options.existing?{
    id:'recEarlier',createdTime:'2026-09-29T10:00:00Z',
    fields:{Semana:'2026-W40','Resumen ejecutivo':'Informe del otro equipo',
      'Fecha generación':'2026-09-29'}
  }:null;
  const state={loaded:true,pedidos:[],reportes:[],cotizaciones:[]};
  const fetch=async()=>{
    calls.health++;
    return new Response(JSON.stringify({reportes_iso_upsert:options.proxyReady!==false}),
      {status:200,headers:{'Content-Type':'application/json'}});
  };
  const airtableFetch=async()=>{calls.prefetch++;return {records:existing?[existing]:[]};};
  const airtableWrite=async(table,method,id,fields,opts)=>{
    calls.writes++;
    assert.equal(table,'Reportes');assert.equal(method,'POST');
    assert.equal(fields.Semana,'2026-W40');
    assert.deepEqual(opts,{reportReplace:!!existing});
    return options.race
      ?{id:'recRace',_reportWriteStatus:200,fields:{
        ...fields,'Resumen ejecutivo':'Ganó el otro equipo'}}
      :{id:existing?.id||'recNew',_reportWriteStatus:existing?200:201,fields};
  };
  const callAgentClaude=async()=>{calls.ai++;return 'Informe generado por IA';};
  const confirm=()=>{calls.prompts++;return options.confirm!==false;};
  const code=new Function(
    'document','window','state','_isoWeekKey','_proxyCfg','fetch','airtableFetch',
    'airtableWrite','callAgentClaude','confirm','escapeHtml','formatAgentReport',
    'renderAgentResult','formatCLP','hoyCL','toast','renderReportes',
    'ovRenderUltimoReporteCEO','showAgentWorking','hideAgentWorking','AGENTES_CFG',
    'AGENT_TONE','beginAgentResultRun','agentResultMeta','AGENT_LOG','prefillReporte',
    SRC+'\nreturn {crearReporte,crearReporteAuto,_reporteSemanaDeRegistro};'
  )(document,{_DEMO_MODE:false},state,()=> '2026-W40',()=>({url:'https://proxy.test'}),
    fetch,airtableFetch,airtableWrite,callAgentClaude,confirm,s=>s,
    s=>'render:'+s,s=>'result:'+s,v=>String(v),()=> '2026-09-29',
    m=>calls.toasts.push(m),()=>calls.render++,()=>{},()=>{},()=>{},[],
    '',()=>Date.now(),()=>({}),{add:()=>{}},()=>{});
  return {code,calls,btn,out,state,input};
}
test('el automático reutiliza un informe existente sin tokens ni segundo correo',async()=>{
  const h=harness({existing:true});
  const result=await h.code.crearReporte({automatic:true});
  assert.equal(result.ok,true);assert.equal(result.reused,true);
  assert.equal(h.calls.ai,0);assert.equal(h.calls.writes,0);
  assert.equal(h.calls.prompts,0);assert.equal(h.btn.disabled,false);
  assert.equal(h.state.reportes[0].id,'recEarlier');
});
test('reemplazo manual requiere confirmación antes de consumir tokens',async()=>{
  const no=harness({existing:true,confirm:false});
  const result=await no.code.crearReporte();
  assert.equal(result.cancelled,true);assert.equal(no.calls.ai,0);
  assert.equal(no.calls.writes,0);assert.equal(no.calls.prompts,1);
  const yes=harness({existing:true,confirm:true});
  const saved=await yes.code.crearReporte();
  assert.equal(saved.ok,true);assert.equal(saved.reused,false);
  assert.equal(yes.calls.ai,1);assert.equal(yes.calls.writes,1);
  assert.equal(yes.state.reportes[0].id,'recEarlier');
});
test('sin guard desplegado no se consumen tokens ni se guarda a ciegas',async()=>{
  const h=harness({proxyReady:false});
  const result=await h.code.crearReporte();
  assert.equal(result.ok,false);assert.match(result.error,/Actualiza airtable-proxy/);
  assert.equal(h.calls.ai,0);assert.equal(h.calls.writes,0);
  assert.equal(h.calls.prefetch,0);assert.equal(h.btn.disabled,false);
});
test('una semana nueva se crea una vez y se incorpora inmediatamente al historial',async()=>{
  const h=harness();
  const result=await h.code.crearReporte();
  assert.equal(result.ok,true);assert.equal(result.reused,false);
  assert.equal(h.calls.ai,1);assert.equal(h.calls.writes,1);
  assert.equal(h.state.reportes[0].id,'recNew');
  assert.equal(h.calls.render,1);
});
test('si otro equipo gana mientras Claude responde, se adopta y no se afirma segundo envío',async()=>{
  const h=harness({race:true});
  const result=await h.code.crearReporte();
  assert.equal(result.ok,true);assert.equal(result.reused,true);
  assert.equal(h.state.reportes[0].fields['Resumen ejecutivo'],'Ganó el otro equipo');
  assert.match(h.out._rawText,/Ganó el otro equipo/);
});
test('la semana se valida en formato ISO antes de consultar servidor o llamar a IA',async()=>{
  const h=harness();h.input['rep-semana']='Semana 40 — octubre';
  const result=await h.code.crearReporte();
  assert.equal(result.ok,false);assert.match(result.error,/Semana inválida/);
  assert.equal(h.calls.health,0);assert.equal(h.calls.ai,0);
});
const isoStart=INDEX.indexOf('function _isoWeekKey('),isoEnd=INDEX.indexOf('function ovToggleCeoAuto(',isoStart);
const iso=new Function(INDEX.slice(isoStart,isoEnd)+'return _isoWeekKey;')();
test('una semana ISO cruza correctamente el cambio de año',()=>{
  assert.equal(iso(new Date(2026,11,31)),'2026-W53');
  assert.equal(iso(new Date(2027,0,1)),'2026-W53');
});
