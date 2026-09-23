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


test('margen de cotización usa degradé azul verde naranjo rojo por rangos',()=>{
  const {op}=setup();
  assert.equal(op.marginColor(0),'hsl(215 88% 68%)');
  assert.equal(op.marginColor(24.9),'hsl(200 88% 56%)');
  assert.equal(op.marginColor(25),'hsl(145 78% 60%)');
  assert.equal(op.marginColor(32.5),'hsl(130 78% 56%)');
  assert.equal(op.marginColor(40),'hsl(38 95% 62%)');
  assert.equal(op.marginColor(50),'hsl(27 95% 57%)');
  assert.equal(op.marginColor(55),'hsl(22 95% 55%)');
  assert.equal(op.marginColor(55.1),'hsl(4 90% 61%)');
  assert.equal(op.marginColor(73),'hsl(2 90% 57%)');
  assert.equal(op.marginColor(100),'hsl(0 90% 50%)');
  assert.equal(op.marginColor(-20),op.marginColor(0));
  assert.equal(op.marginColor(150),op.marginColor(100));
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


test('tarjetas de pedidos muestran equipo seleccionable y estado en desplegable de cabecera',()=>{
  const {context,op,element}=setup();
  context.PERSONAS=[
    {id:'gustavo',nombre:'Gustavo Kaiser'},
    {id:'nicanor',nombre:'Nicanor Marambio'},
    {id:'florencia',nombre:'Florencia Cancino'}
  ];
  const pedido=record('p',{'N° Pedido':'PED-1','Cliente':'ABC','Estado pedido':'En producción','Equipo asignado':'Gustavo Kaiser, Florencia Cancino'});
  const team=op.orderTeamControls(pedido);
  assert.match(team,/Equipo/);
  assert.match(team,/Gustavo/);assert.match(team,/Nicanor/);assert.match(team,/Florencia/);
  assert.equal((team.match(/is-selected/g)||[]).length,2,'debe marcar exactamente a las personas asignadas');
  assert.match(team,/toggleEquipoPedidoCard/,'cada etiqueta de equipo debe ser seleccionable desde la tarjeta');

  const states=op.orderStatusDropdown(pedido);
  assert.match(states,/<select class="op-status-select"/,'el botón de estado debe ser un desplegable');
  for(const label of ['Confirmado','En producción','Listo para despacho','Despachado','Completado'])assert.match(states,new RegExp(label));
  assert.match(states,/advancePedido\('p',this\.value\)/,'cambiar una opción debe reutilizar advancePedido');
  assert.match(states,/data-current="En producción"/);

  op.orders([pedido],[pedido]);
  const html=element('opOrders').innerHTML;
  assert.match(html,/op-status-select/,'la tarjeta debe mostrar el selector en la cabecera');
  assert.doesNotMatch(html,/op-stage-picks/,'no debe duplicar los estados como botones dentro de la tarjeta');
});


test('tarjetas de pedidos muestran pago como desplegable con las mismas acciones de Tabla',()=>{
  const {op,element}=setup();
  const pedido=record('p',{'N° Pedido':'PED-1','Cliente':'ABC','Estado pedido':'En producción','Monto total (CLP)':119000,'Forma de pago':'30 DÍAS DESDE OC','Anticipo pagado (50%)':true,'Saldo pagado (50%)':true,'Monto abono (CLP)':50000});
  const menu=op.orderPaymentDropdown(pedido);
  assert.match(menu,/<details class="op-payment-dropdown"/);
  assert.doesNotMatch(menu,/onclick="event\.stopPropagation\(\)"/,'el dropdown no debe cortar el bubbling porque las acciones data-op se resuelven por delegación en document');
  assert.match(menu,/Pagado/);
  assert.match(menu,/✓ Abono/);assert.match(menu,/✓ Saldo/);assert.match(menu,/✓ Total/);assert.match(menu,/✓ Pago a 30 días/);
  assert.match(menu,/card-pay-abono/);assert.match(menu,/card-pay-saldo/);assert.match(menu,/card-pay-total/);assert.match(menu,/card-pay-30/);
  op.orders([pedido],[pedido]);
  const html=element('opOrders').innerHTML;
  assert.match(html,/op-payment-dropdown/,'Vista Tarjetas debe usar el badge Pagado como desplegable');
  assert.match(html,/card-pay-abono/,'el menú debe exponer las mismas acciones de pago que Tabla');
});


test('menu de pago se cierra al hacer click fuera y selector de estado queda centrado',()=>{
  const src=fs.readFileSync('js/operativo-visual.js','utf8');
  const css=fs.readFileSync('operativo-visual.css','utf8');
  assert.match(src,/op-payment-dropdown\[open\]/,'debe buscar los menús de pago abiertos');
  assert.match(src,/dropdown!==activePaymentDropdown\)dropdown\.open=false/,'debe cerrar el menú al hacer click fuera');
  assert.match(css,/\.op-status-select-wrap::after\{/,'la flecha del selector debe estar controlada por CSS');
  assert.match(css,/appearance:none;-webkit-appearance:none/,'debe neutralizar la flecha nativa para centrar de forma consistente');
  assert.match(css,/text-align:center;text-align-last:center/,'el texto del estado debe quedar centrado en todas las opciones');
});

test('VER PEDIDO muestra detalle y unidades desde la cotización asociada sin exponer costos',()=>{
  const {context,op}=setup();
  context.state.cotizacionesById.q1=record('q1',{
    'N° Cotización':'COT-2026-100',
    'Detalle JSON':JSON.stringify([
      {desc:'Neón TRIBE ELIXIR',und:2,costoUnit:45000,ventaUnit:120000},
      {desc:'Base acrílica negra',und:1,costoUnit:12000,ventaUnit:30000}
    ])
  });
  const pedido=record('p',{'Cotizaciones':['q1']});
  const data=op.orderWorkItems(pedido);
  assert.equal(data.quoteNum,'COT-2026-100');
  assert.deepEqual(Array.from(data.items,it=>[it.desc,it.qty]),[['Neón TRIBE ELIXIR',2],['Base acrílica negra',1]]);
  const html=op.orderWorkDetail(pedido);
  assert.match(html,/DETALLE DEL TRABAJO/);assert.match(html,/Qué se está haciendo/);
  assert.match(html,/2 unidades/);assert.match(html,/1 unidad/);assert.match(html,/COT-2026-100/);
  assert.doesNotMatch(html,/45000|120000|costoUnit|ventaUnit/,'el drawer operativo no debe mostrar costos ni precios de la cotización');

  context.state.cotizacionesById.q2=record('q2',{'Detalle productos':'Tótem acrílico | 3 und. | Costo: $480.000 | Venta: $1.037.451'});
  const legacy=op.orderWorkItems(record('p2',{'Cotizaciones':['q2']}));
  assert.deepEqual(Array.from(legacy.items,it=>[it.desc,it.qty]),[['Tótem acrílico','3']]);
});

test('VER PROPUESTA muestra descripción, cantidades, costos, ventas y resumen de la cotización',()=>{
  const {op}=setup();
  const cot=record('q1',{
    'N° Cotización':'COT-2026-200',
    'Detalle JSON':JSON.stringify([
      {desc:'Letrero neón morado',und:4,costoUnit:35000,ventaUnit:90000},
      {desc:'Fuente 12V',und:1,costoUnit:8000,ventaUnit:18000}
    ]),
    'Total final (CLP)':449820,
    'Descuento (%)':5,
    'Forma de pago':'50% ABONO Y 50% 30 DÍAS',
    'Fecha cotización':'2026-09-20',
    'Fecha vencimiento':'2026-09-30',
    'Tiempo de producción':10,
    'Tiempo de producción máx':15,
    'Tipo días producción':'DÍAS HÁBILES'
  });
  const items=op.quoteWorkItems(cot);
  assert.deepEqual(Array.from(items,it=>[it.desc,it.qty,it.costUnit,it.costTotal,it.saleUnit,it.saleTotal]),[
    ['Letrero neón morado',4,35000,140000,90000,360000],
    ['Fuente 12V',1,8000,8000,18000,18000]
  ]);
  const html=op.quoteWorkDetail(cot);
  const src=fs.readFileSync('js/operativo-visual.js','utf8');
  assert.match(src,/quoteWorkDetail\(r\)/,'VER PROPUESTA debe insertar el detalle de la cotización en el drawer');
  const css=fs.readFileSync('operativo-visual.css','utf8');
  assert.match(html,/op-quote-edit-table/,'el detalle debe usar una tabla compacta similar al editor');
  assert.match(css,/\.op-quote-edit-row\{[^}]*grid-template-columns:/,'el formato debe conservar columnas tipo Editar cotización');
  for(const label of ['DETALLE DE LA COTIZACIÓN','Ítems cotizados','Descripción','Und.','Costo unit.','Costo total','Venta unit.','Venta total','Margen','Venta neta','Neto','IVA 19%','Total con IVA','Forma de pago','Vencimiento','Entrega / plazo'])assert.ok(html.includes(label),`falta ${label}`);
  assert.match(html,/data-label='Und\.'/);assert.match(html,/>4<\/div>/);assert.match(html,/>1<\/div>/);assert.match(html,/COT-2026-200/);
  assert.match(html,/\$35000/);assert.match(html,/\$140000/);assert.match(html,/\$90000/);assert.match(html,/\$360000/);
  assert.match(html,/50% ABONO Y 50% 30 DÍAS/);assert.match(html,/2026-09-30/);assert.match(html,/10–15 días hábiles/);

  const legacy=record('q2',{
    'Detalle productos':'Tótem acrílico | 3 und. | Costo: $480.000 | Venta: $1.037.451'
  });
  const legacyItems=op.quoteWorkItems(legacy);
  assert.deepEqual(Array.from(legacyItems,it=>[it.desc,it.qty,Math.round(it.costUnit),it.costTotal,Math.round(it.saleUnit),it.saleTotal]),[['Tótem acrílico',3,160000,480000,345817,1037451]]);
});


test('OVERVIEW y CALENDARIO quedan fijos en Simple y no renderizan selector Experto',()=>{
  const src=fs.readFileSync('js/operativo-visual.js','utf8');
  assert.match(src,/const simpleOnlyViews=new Set\(\['overview','calendario'\]\)/);
  assert.match(src,/value=simpleOnlyViews\.has\(page\)\?'simple':\(value==='expert'\?'expert':'simple'\)/);
  assert.match(src,/if\(simpleOnlyViews\.has\(page\)\)\{[\s\S]*?mode\(page,'simple'\);[\s\S]*?\}else\{/);
  const branch=/if\(simpleOnlyViews\.has\(page\)\)\{([\s\S]*?)\}else\{/.exec(src);
  assert.ok(branch,'debe existir una rama dedicada para vistas solo Simple');
  assert.doesNotMatch(branch[1],/Experto|page\+':expert'/,'Overview y Calendario no deben crear botón Experto');
});
