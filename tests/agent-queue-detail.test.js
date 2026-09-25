#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('index.html','utf8');
const begin=html.indexOf('const _AQ_STALE_MS=');
const end=html.indexOf('async function refreshAgentQueue()',begin);
assert.ok(begin>=0&&end>begin);
const source=html.slice(begin,end);

test('cada tarea muestra sus datos y resultado sin procesarse al abrirla',()=>{
  const list={innerHTML:''},count={textContent:''};
  const cell={innerHTML:''};
  const row={hidden:true,querySelector:()=>cell},button={textContent:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;}};
  const record={id:'recA1',createdTime:'2026-09-24T10:00:00Z',fields:{
    Evento:'lead.created',Entidad:'Cliente','ID entidad':'recCliente',Agente:'LEAD_AGENT',Estado:'Completado',
    Prioridad:'Alta',Source:'google_ads',Campaign:'campaña',
    'Input JSON':'{"mensaje":"Necesito letrero"}',Output:'<script>untrusted()</script>\nOferta sugerida',
    'Lead Score':8,'Accion sugerida':'Llamar mañana','Fecha ejecución':'2026-09-24T10:02:00Z'
  }};
  let processed=0;
  const context=vm.createContext({
    _agentQueue:[record],state:{clientes:[{id:'recCliente',fields:{Empresa:'Cliente real'}}]},
    document:{getElementById:id=>id==='agentQueueList'?list:id==='agentQueueCount'?count:row,querySelector:()=>button},
    escapeHtml:value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    processAgentQueueItem:()=>{processed++;}
  });
  vm.runInContext(source,context);
  vm.runInContext('renderAgentQueue()',context);
  assert.match(list.innerHTML,/Cliente real/);
  assert.doesNotMatch(list.innerHTML,/Necesito letrero/, 'los resultados extensos se cargan solo al abrir la fila');
  assert.match(list.innerHTML,/aq-detail-recA1" hidden/);
  vm.runInContext("toggleAgentQueueDetail('recA1')",context);
  assert.equal(row.hidden,false);
  assert.match(cell.innerHTML,/Necesito letrero/);
  assert.match(cell.innerHTML,/Oferta sugerida/);
  assert.match(cell.innerHTML,/Llamar mañana/);
  assert.doesNotMatch(cell.innerHTML,/<script>untrusted/);
  assert.equal(button.attrs['aria-expanded'],'true');
  assert.equal(processed,0);
  vm.runInContext('renderAgentQueue()',context);
  assert.match(list.innerHTML,/aq-detail-recA1" >/);
  vm.runInContext("toggleAgentQueueDetail('recA1')",context);
  assert.equal(row.hidden,true);
  assert.equal(cell.innerHTML,'');
});
