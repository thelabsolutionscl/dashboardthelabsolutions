const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup(role='admin'){
  const nodes=new Map(),listeners={},writes=[];
  function node(id){
    if(nodes.has(id))return nodes.get(id);
    const classes=new Set();
    const n={id,innerHTML:'',dataset:{},style:{},open:false,parentElement:null,previousElementSibling:null,
      classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,v){if(v)classes.add(x);else classes.delete(x);}},
      querySelector:()=>null,querySelectorAll:()=>[],setAttribute(k,v){this[k]=v;},
      matches:s=>s==='details'&&n.tagName==='DETAILS',scrollIntoView(){n.scrolled=true;},
      focus(){n.focused=true;},insertAdjacentHTML(){n.inserted=true;},
      closest(){return node('tab-clientes');}};
    nodes.set(id,n);return n;
  }
  const ctx={window:{},document:{getElementById:node,activeElement:node('trigger'),addEventListener(k,f){(listeners[k]||=[]).push(f);}},
    localStorage:{getItem:()=>null,setItem:(k,v)=>writes.push([k,v])},
    AUTH:{getUser:()=>({role})},RBAC:{tabs:{admin:['clientes','reporte','pedidos','finanzas'],comercial:['clientes']}},
    isVendorMode:()=>role==='comercial',vendorOwnsRecord:r=>r.fields.Vendedor==='propio',
    escapeHtml:v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    formatCLP:v=>'$'+v,formatCeoReport:v=>'<p>'+String(v).replace(/</g,'&lt;')+'</p>',
    state:{clientes:[],cotizaciones:[],pedidos:[],reportes:[]},
    _cliSilencioDias:()=>null,_cliUltInteraccion:()=>null,
    renderPedidosKanban:()=>{},renderPedidosCalendario:()=>{},renderPedidosPlanificacion:()=>{},
    requestAnimationFrame:f=>f(),console};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('js/operativo-visual.js','utf8'),ctx);
  ctx.OP=ctx.window.OP;
  vm.runInContext(fs.readFileSync('js/operativo-secciones.js','utf8'),ctx);
  const html=fs.readFileSync('index.html','utf8');
  const layout=html.slice(html.indexOf('function setPedidosView(mode'),html.indexOf('// ── PLANIFICACIÓN DE PRODUCCIÓN'));
  vm.runInContext(layout,ctx);
  return {ctx,node,writes,op:ctx.OP,sections:ctx.window.OPSections,
    click(op,arg){for(const f of listeners.click||[])f({target:{closest:s=>s==='[data-op]'?{dataset:{op,arg}}:null}});}};
}
const rec=(id,fields)=>({id,fields});
test('una selección vacía de clientes no vuelve a mostrar toda la cartera',()=>{
  const {ctx,sections,node}=setup();
  ctx.state.clientes=[rec('a',{Empresa:'Cliente visible'})];
  sections.clients();assert.match(node('opClients').innerHTML,/Cliente visible/);
  sections.clients([]);sections.clients();
  assert.doesNotMatch(node('opClients').innerHTML,/Cliente visible/);
  assert.match(node('opClients').innerHTML,/No hay clientes en esta selección/);
});
test('el resumen de cliente incluye última actividad y sólo operaciones de su vendedor',()=>{
  const {ctx,sections,node}=setup('comercial');
  const client=rec('a',{Empresa:'<Cliente>',Vendedor:'propio'});
  ctx._cliUltInteraccion=()=>({ts:Date.parse('2026-09-01T12:00:00Z'),dias:13,src:'actividad'});
  ctx.state.cotizaciones=[rec('q1',{Cliente:['a'],'Estado cotización':'Negociación',Vendedor:'propio'}),rec('q2',{Cliente:['a'],'Estado cotización':'Enviada',Vendedor:'otro'})];
  ctx.state.pedidos=[rec('p1',{Cliente:['a'],'Estado pedido':'Despachado',Vendedor:'propio'}),rec('p2',{Cliente:['a'],'Estado pedido':'Cancelado',Vendedor:'propio'}),rec('p3',{Cliente:['a'],'Estado pedido':'Completado',Vendedor:'otro'})];
  sections.clients([client,rec('b',{Empresa:'Otro cliente',Vendedor:'otro'})]);
  const html=node('opClients').innerHTML;
  assert.match(html,/&lt;Cliente&gt;/);assert.match(html,/Hace 13 días/);
  assert.match(html,/1 cotizaciones abiertas/);assert.match(html,/1 pedidos despachados o completados/);
  assert.doesNotMatch(html,/Otro cliente/);
});
test('la fecha de ingreso no se presenta como actividad comercial',()=>{
  const {ctx,sections,node}=setup();
  ctx._cliUltInteraccion=()=>({ts:Date.parse('2026-09-14T12:00:00Z'),dias:0,src:'ingreso'});
  sections.clients([rec('a',{Empresa:'Nuevo'})]);
  assert.match(node('opClients').innerHTML,/Ingreso al CRM/);
  assert.doesNotMatch(node('opClients').innerHTML,/Última cotización o pedido/);
});
test('reportes compara registros reales, normaliza margen y limita acciones',()=>{
  const {ctx,sections,node}=setup();
  ctx._kaiSimpleActions=()=>['Primera','Segunda','Tercera','Cuarta'];
  ctx.state.reportes=[
    {...rec('old',{'Revenue semana (CLP)':100,'Pedidos despachados':2,'Margen promedio semana (%)':0.3}),createdTime:'2026-09-01'},
    {...rec('new',{'Revenue semana (CLP)':150,'Pedidos despachados':3,'Margen promedio semana (%)':35,'Resumen ejecutivo':'Resumen'}),createdTime:'2026-09-08'}
  ];
  sections.reports();const html=node('opReports').innerHTML;
  assert.match(html,/\+\$50 vs\. reporte anterior/);
  assert.match(html,/\+5 puntos porcentuales/);
  assert.match(html,/Tercera/);assert.doesNotMatch(html,/Cuarta/);
  ctx.state.reportes=[rec('unknown',{'Margen promedio semana (%)':'inválido'})];
  sections.reports();assert.doesNotMatch(node('opReports').innerHTML,/NaN|puntos porcentuales/);
  assert.match(node('opReports').innerHTML,/Sin comparación disponible/);
});
test('todos los formatos de pedidos conservan el nivel de detalle',()=>{
  const {ctx,op,node,writes}=setup();
  for(const view of ['simple','expert']){
    op.mode('pedidos',view);
    for(const layout of ['tarjetas','tabla','kanban','calendario','planificacion']){
      ctx.setPedidosView(layout);
      assert.equal(node('tab-pedidos').dataset.opView,view);
      assert.equal(node('tab-pedidos').dataset.opLayout,layout);
      assert.equal(node('pedidosTableWrap').style.display,layout==='tabla'?'':'none');
      op.mode('pedidos',view==='simple'?'expert':'simple');
      assert.equal(node('tab-pedidos').dataset.opLayout,layout);
      op.mode('pedidos',view);
    }
  }
  const count=writes.length;ctx.setPedidosView('tabla',{persist:false});
  assert.equal(writes.length,count);
});
test('abrir un detalle despliega sus ancestros y cerrar restaura el foco sin guardar modo',()=>{
  const {op,node,click,writes}=setup();
  const panel=node('tab-clientes'),outer=node('outer'),inner=node('inner'),target=node('target');
  outer.tagName=inner.tagName='DETAILS';inner.open=true;
  outer.parentElement=panel;inner.parentElement=outer;target.parentElement=inner;
  outer.querySelectorAll=()=>[target];
  op.reveal('target');
  assert.equal(outer.open,true);assert.equal(inner.open,true);assert.equal(target.scrolled,true);
  assert.equal(writes.length,0);
  click('close-detail','outer');
  assert.equal(outer.open,false);assert.equal(inner.open,true);
  assert.equal(target.classList.contains('op-revealed'),false);
  assert.equal(node('trigger').focused,true);assert.equal(writes.length,0);
});
test('cambiar de modo cierra revelados temporales sin cambiar formato',()=>{
  const {op,node}=setup();
  const panel=node('tab-clientes'),target=node('target');
  target.parentElement=panel;op.reveal('target');
  panel.querySelectorAll=selector=>selector==='.op-revealed'?[target]:[];
  op.mode('clientes','expert');assert.equal(target.classList.contains('op-revealed'),false);
});
test('Ads sigue mostrando la proyección si el almacenamiento no está disponible',()=>{
  const {ctx,op,node}=setup();ctx.localStorage.getItem=()=>{throw Error('Storage blocked');};
  op.ads({gasto:10000},7);assert.match(node('opAds').innerHTML,/Cierre mensual estimado/);
});
