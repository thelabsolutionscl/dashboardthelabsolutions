#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Engine=require('../js/remuneraciones-engine.js');

test('la regla de comisión es versionada y tiene vigencia explícita',()=>{
  const rule=Engine.resolveRule({seller:'Florencia',sellerEmail:'florencia@thelab.solutions',date:'2026-10-06'},{
    rules:[
      {...Engine.DEFAULT_RULE,id:'old',version:1,rate:.02,validFrom:'2026-01-01',validTo:'2026-06-30'},
      {...Engine.DEFAULT_RULE,id:'new',version:2,rate:.04,validFrom:'2026-07-01',validTo:null}
    ]
  });
  assert.equal(rule.id,'new');assert.equal(rule.version,2);assert.equal(rule.rate,.04);
});

test('la base tributaria usa neto/IVA explícito y nunca infiere dividiendo por 1.19',()=>{
  assert.deepEqual(Engine.taxNet({'Monto total (CLP)':119000}),{
    amount:0,source:'sin base tributaria',verified:false
  });
  assert.deepEqual(Engine.taxNet({'Monto total (CLP)':119000,'IVA (CLP)':19000}),{
    amount:100000,source:'Monto total (CLP) - IVA (CLP)',verified:true
  });
  assert.equal(Engine.taxNet({'Monto neto (CLP)':84500,'Monto total (CLP)':100555}).amount,84500);
});

test('una comisión distingue estimada, devengada, pagada y revertida',()=>{
  const base={id:'recA',fields:{'N° Pedido':'PED-1','Fecha entrega':'2026-10-06','Monto neto (CLP)':100000,'Monto total (CLP)':119000}};
  assert.equal(Engine.deriveOrder(base,{rules:[Engine.DEFAULT_RULE],events:[]}).status,'estimated');
  assert.equal(Engine.deriveOrder({id:'recB',fields:{...base.fields,'DTE N°':'33-10'}},{rules:[Engine.DEFAULT_RULE],events:[]}).status,'accrued');
  assert.equal(Engine.deriveOrder({id:'recC',fields:{...base.fields,'DTE N°':'33-11','Estado pago':'Pagado'}},{rules:[Engine.DEFAULT_RULE],events:[]}).status,'paid');
  assert.equal(Engine.deriveOrder({id:'recD',fields:{...base.fields,'Estado pedido':'Cancelado'}},{rules:[Engine.DEFAULT_RULE],events:[]}).status,'reversed');
});

test('un evento compartido aprobado congela el resultado del pedido vivo',()=>{
  const order={id:'recFreeze',fields:{'N° Pedido':'PED-X','Fecha entrega':'2026-10-06','Monto neto (CLP)':999999}};
  const frozen={id:'ev-1',sourceId:'recFreeze',order:'PED-X',sellerEmail:'v@thelab.solutions',seller:'V',
    period:'2026-10',date:'2026-10-06',eligibleNet:100000,commission:3500,status:'approved',
    ruleId:'commission-standard',ruleVersion:1,ruleRate:.035,basis:'Monto neto (CLP)',verifiedBase:true,
    paymentRatio:0,eventAt:'2026-10-06T12:00:00Z',updatedAt:'2026-10-06T12:00:00Z',reversalOf:'',reason:'',invoice:'',payment:''};
  const e=Engine.deriveOrder(order,{rules:[Engine.DEFAULT_RULE],events:[frozen]});
  assert.equal(e.authoritative,true);assert.equal(e.commission,3500);assert.equal(e.status,'approved');
});

test('pipeline vencido vale cero y el vigente se pondera por etapa',()=>{
  assert.equal(Engine.quoteWeight({'Estado cotización':'Enviada','Fecha vencimiento':'2026-10-05'},'2026-10-06'),0);
  assert.equal(Engine.quoteWeight({'Estado cotización':'Solicitada','Fecha vencimiento':'2026-10-20'},'2026-10-06'),.35);
  assert.equal(Engine.quoteWeight({'Estado cotización':'Enviada','Fecha vencimiento':'2026-10-20'},'2026-10-06'),.65);
  assert.equal(Engine.quoteWeight({'Estado cotización':'Aprobada','Fecha vencimiento':'2026-10-20'},'2026-10-06'),.9);
});

test('la semana empresarial comienza el lunes en America/Santiago',()=>{
  assert.equal(Engine.TZ,'America/Santiago');
  assert.equal(Engine.mondayKey(new Date('2026-10-06T15:00:00Z')),'2026-10-05');
  const b=Engine.bounds('semana',new Date('2026-10-06T15:00:00Z'));
  assert.equal(b.start,'2026-10-05');assert.equal(b.end,'2026-10-12');
});

test('CSV usa BOM, RFC4180 y neutraliza fórmulas',()=>{
  const csv=Engine.csvExport([{period:'2026-10',seller:'=cmd',order:'PED,1',date:'2026-10-06',
    status:'approved',eligibleNet:100000,commission:3500,ruleId:'r"1',ruleVersion:2,ruleRate:.035,basis:'neto'}],
    {generatedAt:'2026-10-06 12:00:00'});
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv,/"'=cmd"/);assert.match(csv,/"PED,1"/);assert.match(csv,/"r""1"/);
  assert.match(csv,/\r\n/);
});

test('sumario conserva separados todos los estados financieros',()=>{
  const s=Engine.summary([
    {status:'estimated',commission:1},{status:'accrued',commission:2},{status:'approved',commission:3},
    {status:'paid',commission:4},{status:'reversed',commission:-1}
  ]);
  assert.deepEqual(s,{estimated:1,accrued:2,approved:3,paid:4,reversed:-1,net:9});
});
