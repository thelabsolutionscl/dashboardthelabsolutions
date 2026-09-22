const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup(role='admin'){
  const elements=new Map(),listeners={};
  const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',dataset:{},style:{},querySelector:()=>null,querySelectorAll:()=>[],scrollIntoView(){}});return elements.get(id);};
  const context={window:{},document:{getElementById:element,addEventListener:(name,fn)=>listeners[name]=fn},
    localStorage:{getItem:()=>null,setItem:()=>{}},AUTH:{getUser:()=>({role})},RBAC:{tabs:{admin:['overview','pedidos','cotizaciones','finanzas','clientes'],produccion:['overview','pedidos'],comercial:['overview','pedidos','cotizaciones','clientes']}},
    isVendorMode:()=>role==='comercial',vendorOwnsRecord:r=>r.fields.Vendedor==='propio',
    escapeHtml:x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'),
    formatCLP:x=>'$'+x,resolveClienteName:x=>Array.isArray(x)?x.join(','):x||'Sin cliente',
    hoyCL:()=> '2026-09-12',pedFormaPago:f=>f['Forma de pago']||'',getMargenCot:()=>40,
    pedidoAtrasado:p=>p['Estado pedido']==='En producción'&&p['Fecha entrega']<'2026-09-12',
    state:{pedidos:[],cotizaciones:[],clientes:[],cotizacionesById:{}},
    finGetAllFacturas:()=>[],finVenc:r=>new Date(r.venc+'T00:00:00'),
    renderCotizaciones:()=>{},renderPedidos:()=>{},_pagosProg:()=>[],ldGetAll:()=>[],
    console,Date,Number,Math};
  vm.createContext(context);vm.runInContext(fs.readFileSync('js/operativo-visual.js','utf8'),context);context.OP=context.window.OP;
  return {context,op:context.OP,element,click:(action,arg='')=>listeners.click({target:{closest:()=>({dataset:{op:action,arg}})}})};
}
const record=(id,fields)=>({id,fields});
test('saldo parcial usa el abono registrado y distingue la estimación del 50%',()=>{
  const {op}=setup();
  let p=op.payment(record('p',{'Monto total (CLP)':100000,'Anticipo pagado (50%)':true,'Monto abono (CLP)':70000,'Forma de pago':'70% ABONO Y 30% CONTRA ENTREGA'}));
  assert.equal(p.remaining,30000);assert.equal(p.estimated,false);
  p=op.payment(record('p',{'Monto total (CLP)':100000,'Anticipo pagado (50%)':true}));
  assert.equal(p.remaining,50000);assert.equal(p.estimated,true);
  p=op.payment(record('p',{'Monto total (CLP)':100000,'Anticipo pagado (50%)':true,'Saldo pagado (50%)':true}));assert.equal(p.remaining,0);
  assert.equal(op.payment(record('p',{})).remaining,null);
  assert.equal(op.payment(record('p',{'Monto total (CLP)':''})).remaining,null);
});
test('fechas inválidas no se transforman en atrasos y hoy no cuenta como vencido',()=>{
  const {op}=setup();assert.equal(op.day('2026-02-31'),null);assert.equal(op.until(''),null);assert.equal(op.until('2026-09-12'),0);
  for(const days of [-3,0,1,30,31,60,61]){
    const matches=['current','1-30','31-60','61+'].filter(k=>op.agingMatch({days},k));assert.equal(matches.length,1);
  }
  assert.equal(op.agingMatch({days:null},'current'),false);
});
test('el filtro por vencer excluye aprobadas y expiradas; el buscador se combina',()=>{
  const {context,op,click,element}=setup();
  const rows=[record('a',{'Estado cotización':'Enviada','Fecha vencimiento':'2026-09-14','Cliente':'ABC'}),record('b',{'Estado cotización':'Enviada','Fecha vencimiento':'2026-09-11'}),record('c',{'Estado cotización':'Aprobada','Fecha vencimiento':'2026-09-14'})];
  context.state.cotizaciones=rows;click('cot-filter','expiring');assert.deepEqual(Array.from(op.filterQuotes(rows),r=>r.id),['a']);op.quotes(op.filterQuotes(rows));assert.match(element('opQuotes').innerHTML,/ABC/);
  click('cot-filter','awaiting');assert.equal(op.filterQuotes(rows).length,2);
});
test('una aprobada sin pedido muestra la acción de recuperación correcta',()=>{
  const missing=setup();missing.context._pedidoDeCot=()=>null;
  const cot=record('c',{'Estado cotización':'Aprobada','Cliente':'ABC','Total final (CLP)':119000});
  assert.equal(missing.op.quoteInfo(cot).next,'Crear pedido pendiente');
  missing.op.quotes([cot]);assert.match(missing.element('opQuotes').innerHTML,/Crear pedido/);

  const linked=setup();linked.context._pedidoDeCot=()=>record('p',{'N° Pedido':'PED-1'});
  assert.equal(linked.op.quoteInfo(cot).next,'Revisar pedido vinculado');
  linked.op.quotes([cot]);assert.match(linked.element('opQuotes').innerHTML,/Ver propuesta/);
});
test('inicio respeta los módulos del rol y excluye la cartera de otros vendedores',()=>{
  const prod=setup('produccion');prod.op.overview();assert.doesNotMatch(prod.element('opToday').innerHTML,/Gestiones comerciales|Facturas vencidas/);
  const sales=setup('comercial');sales.context.state.cotizaciones=[record('a',{'Estado cotización':'Solicitada',Vendedor:'propio'}),record('b',{'Estado cotización':'Solicitada',Vendedor:'otro'})];
  sales.op.overview();assert.match(sales.element('opToday').innerHTML,/<strong>1<\/strong>/);assert.doesNotMatch(sales.element('opToday').innerHTML,/Facturas vencidas/);
  sales.op.finance();assert.equal(sales.element('opFinance').innerHTML,'');
});
test('texto de clientes se escapa y pago a 30 días no inventa una fecha de vencimiento',()=>{
  const {op,element}=setup();op.orders([record('p',{'Cliente':'<img src=x onerror=alert(1)>','Estado pedido':'Despachado','Forma de pago':'30 DÍAS DESDE OC','Monto total (CLP)':100000})],[]);
  const html=element('opOrders').innerHTML;assert.doesNotMatch(html,/<img src=x/);assert.match(html,/&lt;img/);assert.match(html,/revisar fecha de OC \/ factura/);assert.doesNotMatch(html,/Entrega atrasada/);
});
test('presupuesto usa días del período y no confunde disponible proyectado con saldo real',()=>{
  const {op,element}=setup();op.ads({gasto:70000,periodo:'7 días'},7);
  assert.match(element('opAds').innerHTML,/Cierre mensual estimado/);assert.match(element('opAds').innerHTML,/Exceso proyectado/);
  op.ads({},7);assert.match(element('opAds').innerHTML,/Sin datos suficientes/);
});
test('cobranza vacía y con filtro sin coincidencias se limpia al volver a calcular',()=>{
  const {context,op,element,click}=setup();context.finGetAllFacturas=()=>[{porCobrar:1000,venc:'2026-09-10',nombre:'Cliente <A>',fact:'10'},{porCobrar:2000,venc:'2026-09-20',nombre:'Cliente B'}];
  op.collections();assert.match(element('opCollections').innerHTML,/Cliente &lt;A&gt;/);
  click('aging','current');assert.doesNotMatch(element('opCollections').innerHTML,/Cliente &lt;A&gt;/);assert.match(element('opCollections').innerHTML,/Cliente B/);
  context.finGetAllFacturas=()=>[];op.collections();assert.match(element('opCollections').innerHTML,/No hay facturas en este tramo/);assert.doesNotMatch(element('opCollections').innerHTML,/Cliente B/);
});


test('el detalle de pedido permite avanzar por el ciclo operativo',()=>{
  const {op,element}=setup();
  assert.equal(op.nextOrderStage(record('p',{'Estado pedido':'Confirmado'})),'En producción');
  assert.equal(op.nextOrderStage(record('p',{'Estado pedido':' Confirmado '})),'En producción');
  assert.equal(op.nextOrderStage(record('p',{'Estado pedido':'En producción'})),'Listo para despacho');
  assert.equal(op.nextOrderStage(record('p',{'Estado pedido':'Despachado'})),'Completado');
  assert.equal(op.nextOrderStage(record('p',{'Estado pedido':'Completado'})),null);
  op.orders([record('p',{'N° Pedido':'PED-1','Estado pedido':'Confirmado','Cliente':'ABC'})],[]);
  const src=fs.readFileSync('js/operativo-visual.js','utf8');
  assert.match(src,/Pasar a producción/,'el detalle debe mostrar una acción visible para iniciar producción');
  assert.match(src,/['"]order-advance['"]/,'el drawer debe exponer la acción para avanzar');
  assert.match(src,/await\s+advancePedido\(arg,next\)/,'la acción debe usar el flujo persistente advancePedido');
});


test('el detalle de pedido expone controles rápidos de pago',()=>{
  const {op}=setup();
  const pending=record('p',{'Forma de pago':'AL CONTADO','Monto total (CLP)':119000});
  let html=op.paymentControls(pending);
  assert.match(html,/Abono/);assert.match(html,/Saldo/);assert.match(html,/Total/);assert.match(html,/Pago a 30 días/);
  assert.match(html,/order-pay-abono/);assert.match(html,/order-pay-saldo/);assert.match(html,/order-pay-total/);assert.match(html,/order-pay-30/);
  const paid=record('p',{'Forma de pago':'30 DÍAS DESDE OC','Monto total (CLP)':119000,'Anticipo pagado (50%)':true,'Saldo pagado (50%)':true,'Monto abono (CLP)':50000});
  html=op.paymentControls(paid);
  assert.match(html,/✓ Abono/);assert.match(html,/✓ Saldo/);assert.match(html,/✓ Total/);assert.match(html,/✓ Pago a 30 días/);
});


test('margen de cotización usa gradiente azul a rojo',()=>{
  const {op}=setup();
  const low=op.marginColor(0),mid=op.marginColor(50),high=op.marginColor(100);
  assert.equal(low,'hsl(210 85% 65%)');
  assert.equal(mid,'hsl(105 85% 65%)');
  assert.equal(high,'hsl(0 85% 65%)');
  assert.equal(op.marginColor(-20),low);
  assert.equal(op.marginColor(150),high);
});


test('el detalle de cotización expone acciones de estado equivalentes a la vista experta',()=>{
  const {op}=setup();
  let html=op.quoteStateActions(record('c',{'Estado cotización':'Enviada'}));
  assert.match(html,/Aprobar cotización/);assert.match(html,/Rechazar cotización/);assert.match(html,/Pasar a negociación/);
  assert.match(html,/quote-status/);
  html=op.quoteStateActions(record('c',{'Estado cotización':'Solicitada'}));assert.match(html,/Marcar enviada/);
  html=op.quoteStateActions(record('c',{'Estado cotización':'Rechazada'}));assert.match(html,/Reactivar como enviada/);
  const linked=setup();linked.context._pedidoDeCot=()=>record('p',{'N° Pedido':'PED-1'});
  html=linked.op.quoteStateActions(record('c',{'Estado cotización':'Aprobada'}));assert.match(html,/Ver pedido vinculado/);assert.match(html,/quote-linked-order/);
  const src=fs.readFileSync('js/operativo-visual.js','utf8');assert.match(src,/updateCotizacionEstado\(id,estado\)/,'las acciones deben reutilizar el flujo persistente existente');
});


test('el margen dinámico no puede ser sobrescrito por el color semántico púrpura',()=>{
  const css=fs.readFileSync('operativo-visual.css','utf8');
  const semantic=fs.readFileSync('js/semantic-colors.js','utf8');
  assert.match(css,/\.op-margin-fact\{[^}]*box-shadow:inset 4px 0 0 var\(--op-margin-color[^}]*!important/);
  assert.match(css,/\.op-margin-fact b\{color:var\(--op-margin-color[^}]*!important/);
  assert.match(semantic,/matches\?\.\('\.op-margin-fact'\)/,'el decorador semántico debe omitir el margen dinámico');
});
