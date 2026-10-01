'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.join(__dirname,'..');
const HTML=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'styles.css'),'utf8');

function visualHelpers(){
  const start=HTML.indexOf('let _agentVisualSeq=0;');
  const end=HTML.indexOf('function renderAgentResult',start);
  assert.ok(start>0&&end>start,'bloque de helpers visuales presente');
  const context={
    _agentCleanResult:value=>String(value||'').trim(),
    _agentVisualId:value=>String(value||''),
    AGENT_RESULT_LAYOUTS:{CEO:['priorities','Dirección']},
    escapeHtml:value=>String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    formatRichText:value=>String(value||''),
    window:{},
  };
  vm.createContext(context);
  vm.runInContext(HTML.slice(start,end),context);
  return context;
}

test('cada agente declara un layout especializado y un responsable',()=>{
  const block=HTML.slice(HTML.indexOf('const AGENT_RESULT_LAYOUTS='),HTML.indexOf('function _agentVisualId'));
  for(const id of ['SALES','QUOTE','PRODUCTION','MANTENCION3D','QA','FOLLOWUP','CEO','LEADGEN','ONBOARDING','FINANCE','REPCLIENTE','CONTENT','ADS','LINKEDIN','SOCIAL_STRATEGIST','CAPTION_AGENT','COMMUNITY_AGENT','SOCIAL_ADS_AGENT','TREND_AGENT','REPORT_SOCIAL_AGENT','NEWSLETTER_AGENT','SUPPLIER','KAI']){
    assert.match(block,new RegExp('\\b'+id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+':\\[[^\\]]+,[^\\]]+\\]'),id+' debe declarar layout y responsable');
  }
});

test('las respuestas multicanal se convierten en pestañas accesibles',()=>{
  const h=visualHelpers();
  const out=h._agentChannelVisual('1. WhatsApp\nHola, ¿cómo estás?\n\n2. Email\nASUNTO: Seguimiento\nCuerpo del correo');
  assert.match(out,/role="tablist"/);
  assert.match(out,/role="tabpanel"/);
  assert.match(out,/WhatsApp/i);
  assert.match(out,/Email/i);
});

test('QA muestra avance y cada verificación sin perder el texto',()=>{
  const h=visualHelpers();
  const out=h._agentChecklistVisual('- [x] Color correcto\n- [ ] Medida dentro de tolerancia');
  assert.match(out,/1\/2 verificados/);
  assert.match(out,/50%/);
  assert.match(out,/Medida dentro de tolerancia/);
});

test('tablas, cronologías y planes de acción tienen vistas ejecutivas',()=>{
  const h=visualHelpers();
  assert.match(h._agentTableVisual('| Cliente | Mora |\n|---|---|\n| ACME | $20.000 |'),/<table class="avr-table">/);
  assert.match(h._agentStepVisual('1. Recibir archivos\n2. Aprobar diseño\n3. Iniciar producción','CRONOLOGÍA'),/avr-timeline/);
  assert.match(h._agentActionVisual('## TOP 3 PRIORIDADES\n- Cobrar factura vencida hoy\n- Revisar margen del pedido','CEO'),/Responsable · Dirección/);
});

test('la ejecución muestra contexto, fecha y desglose de tokens',()=>{
  const block=HTML.slice(HTML.indexOf('function _agentUsageHtml'),HTML.indexOf('function _agentExtraVisual'));
  assert.match(block,/Entrada \/ salida/);
  assert.match(block,/input_tokens/);
  assert.match(block,/output_tokens/);
  assert.match(block,/meta\?\.timestamp/);
  const render=HTML.slice(HTML.indexOf('function renderAgentResult'),HTML.indexOf('function renderKaiResult'));
  assert.match(render,/m\.subject/);
  assert.match(render,/_agentSpecialVisual/);
  assert.match(CSS,/\.avr-tabs/);
  assert.match(CSS,/\.avr-timeline/);
  assert.match(CSS,/\.avr-action-row/);
});
