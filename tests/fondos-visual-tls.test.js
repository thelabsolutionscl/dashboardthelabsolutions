#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const script=fs.readFileSync(path.join(root,'js/calendario-fondos.js'),'utf8');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/fondos-concursables.json'),'utf8'));
const css=fs.readFileSync(path.join(root,'fondos-tls.css'),'utf8');
function view(){
  const hooks={}, cards=[], links=[];
  const list={innerHTML:'',addEventListener:(event,fn)=>{hooks['list:'+event]=fn;},
    querySelectorAll:()=>cards,
    querySelector:sel=>sel==='[data-fondos-count]'?counter:sel==='[data-fondos-no-match]'?empty:null
  };
  const counter={textContent:''},empty={hidden:false};
  const rootEl={addEventListener:(event,fn)=>{hooks['root:'+event]=fn;}};
  const filter={value:'',addEventListener:(event,fn)=>{hooks['filter:'+event]=fn;}};
  const modal={style:{display:'none'},addEventListener(){}},detail={innerHTML:''},prepare={dataset:{}};
  const nodes={'tab-calendario':rootEl,'fondosList':list,'fondosFiltro':filter,
    'fondosStatus':{textContent:''},'fondosShowOnCalendar':{checked:true,addEventListener(){}},
    'fondosDetalleModal':modal,'fondosDetalleBody':detail,'fondosDetallePreparar':prepare};
  const state=new Map();
  const doc={readyState:'complete',baseURI:'https://dashboard.thelab.solutions/',
    head:{appendChild:x=>links.push(x)},createElement:tag=>({tagName:tag}),
    getElementById:id=>nodes[id]||null,
    addEventListener:(event,fn)=>{hooks['doc:'+event]=fn;}
  };
  const ctx={window:{renderCalendario(){}},document:doc,URL,Date,Intl,Number,JSON,Promise,console,
    setInterval:()=>0,setTimeout:(fn)=>{fn();return 0;},localStorage:{
      getItem:k=>state.get(k)||null,
      setItem:(k,v)=>state.set(k,v)
    },fetch:async()=>({ok:true,json:async()=>catalog})};
  vm.runInNewContext(script,ctx);
  return {api:ctx.window.TLSFondos,ctx,nodes,list,modal,detail,links,hooks,cards,counter,empty,state};
}
test('radar TLS carga un CSS externo con marca propia y sin romper Calendario',async()=>{
  const v=view();
  await v.api.load();
  assert.equal(v.links.length,1);
  assert.equal(v.links[0].rel,'stylesheet');
  assert.match(v.links[0].href,/\/fondos-tls\.css\?v=/);
  assert.match(v.list.innerHTML,/THE LAB SOLUTIONS · OPPORTUNITY RADAR/);
  assert.match(v.list.innerHTML,/fondos-kpis/);
  assert.match(v.list.innerHTML,/fondos-filter-pills/);
  assert.match(v.list.innerHTML,/fondosBuscar/);
  assert.match(v.list.innerHTML,/fondos-grid/);
  assert.match(v.list.innerHTML,/Revisar para TLS/);
  assert.match(v.list.innerHTML,/fondosMesa/);
  assert.match(v.list.innerHTML,/Catálogo/);
  assert.match(v.list.innerHTML,/Encaje estimado/);
  assert.match(css,/#tab-calendario/);
  assert.match(css,/@media\(max-width:650px\)/);
  assert.match(css,/focus-visible/);
});
test('programas prioritarios de noviembre aparecen arriba sin inventar fechas',async()=>{
  const v=view();
  await v.api.load();
  const html=v.list.innerHTML;
  assert.ok(html.indexOf('Corfo — Semilla Inicia')>0);
  assert.ok(html.indexOf('Corfo — Semilla Inicia')<html.indexOf('Corfo — Crea y Valida 2026'));
  assert.match(html,/Fechas por confirmar en fuente oficial/);
  assert.match(html,/data-fondos-view="sin-fechas"/);
  const n=(html.match(/data-fondos-card=/g)||[]).length;
  assert.equal(n,catalog.funds.length);
  assert.doesNotMatch(html,/data-fondos-calendar="corfo-semilla-inicia-nueva-vigilar"/);
});
test('filtros visuales y búsqueda actualizan tarjetas sin alterar fechas ni catálogo',async()=>{
  const v=view();
  await v.api.load();
  v.hooks['root:click']({target:{closest:selector=>selector==='[data-fondos-view]'?
    {dataset:{fondosView:'sin-fechas'}}:null}});
  assert.match(v.list.innerHTML,/aria-pressed="true">Sin fecha oficial/);
  assert.ok(v.list.innerHTML.includes('data-fondos-card="startupchile-big-proximo-vigilar"'));
  assert.ok(!v.list.innerHTML.includes('data-fondos-card="corfo-crea-y-valida-2026"'));
  const c={dataset:{fondosCard:'corfo-semilla-inicia-nueva-vigilar'},hidden:false};
  v.cards.push(c);
  v.hooks['list:input']({target:{id:'fondosBuscar',value:'TEXTO inexistente-XYZ'}});
  assert.equal(c.hidden,true);
  assert.equal(v.counter.textContent,'0 oportunidades visibles');
  assert.equal(v.empty.hidden,false);
  v.hooks['list:input']({target:{id:'fondosBuscar',value:'Semilla inicia'}});
  assert.equal(c.hidden,false);
});
test('detalle TLS muestra requisitos, fechas y vínculo oficial válido, sin alterar acciones',async()=>{
  const v=view();await v.api.load();
  v.api.open('corfo-semilla-inicia-nueva-vigilar');
  assert.equal(v.modal.style.display,'flex');
  assert.match(v.detail.innerHTML,/fondos-detail-grid/);
  assert.match(v.detail.innerHTML,/Lo que debes verificar antes de postular/);
  assert.match(v.detail.innerHTML,/Por confirmar/);
  assert.match(v.detail.innerHTML,/https:\/\/www\.corfo\.gob\.cl/);
  assert.equal(v.nodes.fondosDetallePreparar.dataset.fondosDraft,'corfo-semilla-inicia-nueva-vigilar');
  assert.equal(v.api.eventList().length,catalog.funds.filter(f=>f.open&&f.close).length*2);
});

test('botón DEMO cambia solo la presentación, nunca los eventos oficiales o calendario compartido',async()=>{
  const v=view();await v.api.load();
  const originalEvents=JSON.stringify(v.api.eventList());
  const originalDates=JSON.stringify(v.api.allDates());
  assert.equal(v.api.isDemo(),false);
  assert.match(v.list.innerHTML,/DEMO · Ver funcionamiento/);
  v.api.toggleDemo();
  assert.equal(v.api.isDemo(),true);
  assert.match(v.list.innerHTML,/fondos-tls is-demo/);
  assert.match(v.list.innerHTML,/MODO DEMO · SIMULACIÓN/);
  assert.match(v.list.innerHTML,/data-fondos-demo-toggle/);
  assert.match(v.list.innerHTML,/data-fondos-demo-step="fechas"/);
  assert.match(v.list.innerHTML,/no se manda correo/i);
  assert.equal(JSON.stringify(v.api.eventList()),originalEvents);
  assert.equal(JSON.stringify(v.api.allDates()),originalDates);
  assert.ok([...v.state.keys()].every(k=>!k.toLowerCase().includes('demo')),'no persistir el demo en storage');
  v.api.toggleDemo();
  assert.equal(v.api.isDemo(),false);
  assert.match(v.list.innerHTML,/data-fondos-card="corfo-semilla-inicia-nueva-vigilar"/);
  assert.doesNotMatch(v.list.innerHTML,/fondos-tls is-demo/);
  assert.equal(JSON.stringify(v.api.eventList()),originalEvents);
});
test('recorrido DEMO permite ver fechas, aviso y agente cargando, sin avisos reales',async()=>{
  const v=view();await v.api.load();
  v.hooks['root:click']({target:{closest:sel=>sel==='[data-fondos-demo-toggle]'?{}:null}});
  assert.equal(v.api.isDemo(),true);
  for(const [scene,marker] of [
    ['requisitos','Evaluación de compatibilidad'],
    ['fechas','Apertura simulada'],
    ['alerta','Correo simulado'],
    ['borrador','AGENTE DE POSTULACIONES']]){
    v.hooks['root:click']({target:{closest:sel=>sel==='[data-fondos-demo-step]'?{dataset:{fondosDemoStep:scene}}:null}});
    assert.match(v.list.innerHTML,new RegExp(marker));
    assert.match(v.list.innerHTML,new RegExp('data-fondos-demo-step="'+scene+'" aria-pressed="true"'));
  }
  assert.match(v.list.innerHTML,/El agente TLS está procesando|Análisis finalizado/i);
  assert.match(v.list.innerHTML,/no se envían postulaciones/i);
  assert.match(css,/fondos-tls\.is-demo/);
  assert.match(css,/fondos-demo-stage/);
  v.hooks['root:click']({target:{closest:sel=>sel==='[data-fondos-demo-toggle]'?{}:null}});
  assert.equal(v.api.isDemo(),false);
});
test('recarga nueva arranca siempre en modo real, no reutiliza estado DEMO',async()=>{
  const v=view();await v.api.load();v.api.toggleDemo();
  const another=view();await another.api.load();
  assert.equal(another.api.isDemo(),false);
  assert.match(another.list.innerHTML,/DEMO · Ver funcionamiento/);
  assert.equal(another.api.eventList().length,catalog.funds.filter(f=>f.open&&f.close).length*2);
});

test('DEMO ejecuta IA de verdad, muestra spinner mientras responde y después el resultado',async()=>{
  const v=view();await v.api.load();
  const eventsBefore=JSON.stringify(v.api.eventList()),datesBefore=JSON.stringify(v.api.allDates());
  let finish,parameters=[];
  v.ctx.window.callAgentClaude=(...args)=>{parameters=args;return new Promise(resolve=>{finish=resolve;});};
  v.api.toggleDemo();
  assert.equal(v.api.isDemo(),true);
  assert.equal(v.api.demoAgentState().status,'working');
  assert.match(v.list.innerHTML,/fondos-agent-working/);
  assert.match(v.list.innerHTML,/role="status" aria-live="polite" aria-busy="true"/);
  assert.match(v.list.innerHTML,/Agente TLS está procesando/i);
  assert.ok(parameters.length>=3);
  assert.equal(parameters[0],'CEO');
  assert.match(parameters[2],/ANÁLISIS DE PRUEBA/);
  finish('Informe IA único: validar costos y antecedentes antes de postular.');
  await new Promise(setImmediate);
  assert.equal(v.api.demoAgentState().status,'done');
  assert.equal(v.api.demoAgentState().source,'ia');
  assert.match(v.list.innerHTML,/Informe IA único/);
  assert.doesNotMatch(v.list.innerHTML,/fondos-agent-working/);
  assert.equal(JSON.stringify(v.api.eventList()),eventsBefore);
  assert.equal(JSON.stringify(v.api.allDates()),datesBefore);
  assert.match(css,/fondos-agent-orbit/);
  assert.match(css,/@keyframes fondosAgentOrbit/);
});
test('fallo de IA no se oculta: muestra error y permite procesar versión local',async()=>{
  const v=view();await v.api.load();
  v.ctx.window.callAgentClaude=async()=>{throw Error('Proxy no disponible');};
  v.api.toggleDemo();
  await new Promise(setImmediate);
  assert.equal(v.api.demoAgentState().status,'error');
  assert.match(v.list.innerHTML,/Proxy no disponible/);
  assert.match(v.list.innerHTML,/data-fondos-demo-run-local/);
  const local=v.api.runDemoAgent(true);
  assert.equal(v.api.demoAgentState().status,'working');
  await local;
  assert.equal(v.api.demoAgentState().status,'done');
  assert.equal(v.api.demoAgentState().source,'local');
  assert.match(v.list.innerHTML,/SIMULACIÓN LOCAL \(NO IA\)/);
});
test('DEMO sin conexión IA responde con simulación local, editable y señalada',async()=>{
  const v=view();await v.api.load();
  v.api.toggleDemo();
  await new Promise(setImmediate);
  assert.equal(v.api.demoAgentState().status,'done');
  assert.equal(v.api.demoAgentState().source,'local');
  v.nodes.fondosDemoPregunta={value:'Quiero mejorar la señalética y merchandising para una activación, preparando un fondo de innovación hipotético.'};
  v.hooks['list:input']({target:{id:'fondosDemoPregunta',value:v.nodes.fondosDemoPregunta.value}});
  await v.api.runDemoAgent(true);
  assert.match(v.api.demoAgentState().result,/señalética, merchandising/i);
  assert.match(v.list.innerHTML,/no IA/i);
});
test('al salir de DEMO se descartan respuestas pendientes del agente',async()=>{
  const v=view();await v.api.load();
  let finish;
  v.ctx.window.callAgentClaude=()=>new Promise(resolve=>{finish=resolve;});
  v.api.toggleDemo();
  assert.equal(v.api.demoAgentState().status,'working');
  v.api.toggleDemo();
  assert.equal(v.api.isDemo(),false);
  finish('Resultado que llegó después de cerrar');
  await new Promise(setImmediate);
  assert.equal(v.api.isDemo(),false);
  assert.doesNotMatch(v.list.innerHTML,/Resultado que llegó después/);
  assert.equal(v.api.demoAgentState().status,'idle');
});

test('mesa TLS abre una ficha real con requisitos, fuente, checklist y CTA al agente',async()=>{
  const v=view();await v.api.load();
  assert.match(v.list.innerHTML,/Un fondo a la vez. Un plan claro./);
  const selected='corfo-crea-y-valida-proxima-vigilar';
  assert.equal(v.api.openWorkspace(selected),true);
  assert.match(v.list.innerHTML,/MI MESA DE TRABAJO · 3 PASOS/);
  assert.match(v.list.innerHTML,/¿Conviene postular?/);
  assert.match(v.list.innerHTML,/¿Qué falta reunir?/);
  assert.match(v.list.innerHTML,/Preparar con el agente/);
  assert.match(v.list.innerHTML,/Bases y fuente oficial/);
  assert.match(v.list.innerHTML,/Sin fecha oficial/);
  assert.match(v.list.innerHTML,/data-fondos-work-form/);
  assert.match(v.list.innerHTML,/data-fondos-work-check="bases"/);
  assert.equal(v.api.fundWindow(catalog.funds.find(f=>f.id===selected)).tone,'watch');
  assert.equal(v.api.openWorkspace('<script>'),false);
  assert.match(css,/fondos-workspace-steps/);
});
test('seguimiento local y checklist manual se guardan sin datos financieros ni formularios',async()=>{
  const v=view();await v.api.load();
  const id='corfo-crea-y-valida-proxima-vigilar';
  v.api.openWorkspace(id);
  assert.equal(v.api.stageFund(id,'preparando'),true);
  assert.equal(v.api.toggleFlowCheck(id,'bases',true),true);
  assert.equal(v.api.toggleFlowCheck(id,'documentos',true),true);
  assert.equal(v.api.stageFund(id,'publicado'),false);
  assert.match(v.list.innerHTML,/2 de 7/);
  assert.match(v.list.innerHTML,/value="preparando" selected/);
  assert.match(v.list.innerHTML,/data-fondos-work-check="bases" checked/);
  const records=[...v.state.entries()].filter(([k])=>k.startsWith('thelab_fondos_mesa_v1'));
  assert.equal(records.length,1);
  assert.match(records[0][1],/"stage":"preparando"/);
  assert.doesNotMatch(records[0][1],/presupuesto|RUT|formulario|respuesta/i);
  assert.equal(v.api.trackFund(id),false);
  assert.match(v.list.innerHTML,/Un fondo a la vez/);
});
test('el agente de la mesa muestra procesamiento, entrega texto y no crea eventos',async()=>{
  const v=view();await v.api.load();
  const id='corfo-crea-y-valida-proxima-vigilar';
  const original=JSON.stringify(v.api.eventList());
  let complete,callArgs;
  v.ctx.window.callAgentClaude=(...args)=>{callArgs=args;return new Promise(resolve=>{complete=resolve;});};
  v.api.openWorkspace(id);
  v.hooks['list:input']({target:{id:'fondosMesaIdea',value:'Validación técnica de un proceso mejorado de prototipado 3D para nuevos productos TLS.'}});
  const inFlight=v.api.workspaceAnalyze();
  assert.equal(v.api.workspaceState().status,'working');
  assert.match(v.list.innerHTML,/Agente TLS procesando tu proyecto/);
  assert.match(v.list.innerHTML,/aria-busy="true"/);
  assert.equal(callArgs[0],'CEO');
  assert.match(callArgs[1],/sin inventar bases/);
  complete('Plan contextualizado: validar antigüedad, cofinanciamiento y métricas.');
  assert.equal(await inFlight,true);
  assert.equal(v.api.workspaceState().status,'done');
  assert.match(v.list.innerHTML,/Plan contextualizado/);
  assert.doesNotMatch(v.list.innerHTML,/data-fondos-work-analyze disabled/);
  assert.equal(JSON.stringify(v.api.eventList()),original);
});
test('sin IA ofrece una guía local explícita; error remoto no se disfraza de éxito',async()=>{
  const v=view();await v.api.load();v.api.openWorkspace('sercotec-crece-proximas');
  v.hooks['list:input']({target:{id:'fondosMesaIdea',value:'Comprar impresoras para ampliar la capacidad productiva de TLS y evaluar un fondo de inversión.'}});
  const result=await v.api.workspaceAnalyze();
  assert.equal(result,true);
  assert.equal(v.api.workspaceState().source,'local');
  assert.match(v.list.innerHTML,/NO IA/);
  v.ctx.window.callAgentClaude=async()=>{throw Error('Conexión no disponible');};
  const failed=await v.api.workspaceAnalyze();
  assert.equal(failed,false);
  assert.equal(v.api.workspaceState().status,'error');
  assert.match(v.list.innerHTML,/Conexión no disponible/);
  assert.match(v.list.innerHTML,/Crear guía local sin IA/);
});
test('buscar conserva foco de input y paginación de ocho; histórico nunca se anuncia como abierto',async()=>{
  const v=view();await v.api.load();
  assert.match(v.list.innerHTML,/data-fondos-more/);
  assert.match(v.list.innerHTML,/No hay un fondo con apertura vigente o futura registrada/);
  assert.match(v.list.innerHTML,/Sin fecha oficial/);
  const c={dataset:{fondosCard:'corfo-semilla-inicia-nueva-vigilar'},hidden:false};
  v.cards.push(c);
  v.hooks['list:input']({target:{id:'fondosBuscar',value:'semilla inicia'}});
  assert.equal(c.hidden,false);
  v.hooks['list:input']({target:{id:'fondosBuscar',value:'xyz_inexistente'}});
  assert.equal(c.hidden,true);
});

test('cambiar de fondo no deja el agente bloqueado ni mezcla resultados tardíos',async()=>{
  const v=view();await v.api.load();
  const one='sercotec-crece-proximas',two='corfo-crea-y-valida-proxima-vigilar';
  let finish;
  v.ctx.window.callAgentClaude=()=>new Promise(resolve=>{finish=resolve;});
  v.api.openWorkspace(one);
  v.hooks['list:input']({target:{id:'fondosMesaIdea',value:'Ampliar capacidad de impresión 3D con equipos para TLS, sujeto a elegibilidad y bases.'}});
  const run=v.api.workspaceAnalyze();
  assert.equal(v.api.workspaceState().status,'working');
  v.api.openWorkspace(two);
  assert.equal(v.api.workspaceState().status,'idle');
  v.hooks['list:input']({target:{id:'fondosMesaIdea',value:'Nuevo desarrollo de materiales 3D para pruebas verificables y evaluación de I+D de TLS.'}});
  const result=await v.api.workspaceAnalyze(true);
  assert.equal(result,true,'la ficha nueva debe ejecutar su propio plan');
  const visible=v.api.workspaceState().text;
  finish('Respuesta tardía del fondo anterior');
  await run;
  assert.equal(v.api.workspaceState().text,visible);
  assert.doesNotMatch(v.list.innerHTML,/Respuesta tardía del fondo anterior/);
});

test('auditoría: fechas incompletas nunca aparecen como convocatorias abiertas o próximas',async()=>{
  const v=view();await v.api.load();
  const base=catalog.funds.find(f=>f.id==='corfo-crea-y-valida-2026');
  assert.equal(v.api.fundWindow({...base,open:'2026-01-01T12:00',close:''}).tone,'watch');
  assert.match(v.api.fundWindow({...base,open:'2026-01-01T12:00',close:''}).label,/incompletas/);
  assert.equal(v.api.fundWindow({...base,open:'',close:'2027-11-30T12:00'}).tone,'watch');
  assert.equal(v.api.fundWindow({...base,open:'2026-05-01T12:00',close:'2026-05-20T12:00'}).tone,'closed');
  const future=v.api.fundWindow({...base,open:'2027-06-01T12:00',close:'2027-07-20T12:00'});
  assert.equal(future.tone,'future');
});
test('auditoría: formulario no recibe preguntas ficticias al abrir mesa de trabajo',async()=>{
  const v=view();await v.api.load();
  const questions={value:'',placeholder:''},antecedentes={value:''};
  const selected={value:'',innerHTML:''};
  v.nodes.fondosPreguntas=questions;v.nodes.fondosAntecedentes=antecedentes;
  v.nodes.fondosConvocatoria=selected;
  v.api.openWorkspace('corfo-crea-y-valida-proxima-vigilar');
  v.hooks['root:click']({target:{closest:selector=>selector==='[data-fondos-work-form]'?{}:null}});
  assert.equal(questions.value,'','nunca completar preguntas que la institución no entregó');
  assert.match(questions.placeholder,/preguntas TEXTUALES/);
  assert.equal(selected.value,'corfo-crea-y-valida-proxima-vigilar');
  assert.doesNotMatch(v.list.innerHTML,/PREGUNTAS COPIADAS POR EL USUARIO/);
});
test('auditoría: ranking deja fondos no elegibles detrás de seguimiento razonable',async()=>{
  const v=view();await v.api.load();
  const html=v.list.innerHTML;
  const viable=html.indexOf('data-fondos-card="corfo-crea-y-valida-proxima-vigilar"');
  const ineligible=html.indexOf('data-fondos-card="corfo-semilla-inicia-nueva-vigilar"');
  assert.ok(viable>=0&&ineligible>viable,'un fondo no elegible no encabeza la lista');
  assert.match(html,/No hay un fondo con apertura vigente o futura registrada/);
});
