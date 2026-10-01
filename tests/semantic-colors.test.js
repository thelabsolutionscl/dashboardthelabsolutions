const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/semantic-colors.js','utf8'),ctx);
const {status,metric}=ctx.SemanticColors;
test('shared status colors include production, completion, payments and publishing',()=>{
 for(const s of ['Completado','Despachado','Pagado','Cobrada','Publicado','Impresión finalizada'])assert.equal(status(s),'success',s);
 for(const s of ['En producción','Imprimiendo','Procesando','Trabajando'])assert.equal(status(s),'production',s);
 for(const s of ['Vencida','Error','Entrega atrasada','QA rechazado'])assert.equal(status(s),'danger',s);
 assert.equal(status('QA pendiente'),'warning');assert.equal(status('Listo para despacho'),'info');
});
test('newsletter sent is completed but a sent quotation remains open',()=>{
 assert.equal(status('Enviada','newsletter'),'success');assert.equal(status('Enviada','cotizaciones'),'info');
});
test('counts distinguish missing values, zero issues, and actual overdue debt',()=>{
 assert.equal(metric('Facturas vencidas','$0'),'neutral');assert.equal(metric('Facturas vencidas','$40.000'),'danger');
 assert.equal(metric('Pedidos en producción','12'),'production');assert.equal(metric('Pedidos despachados','8'),'success');
 assert.equal(metric('Revenue neto','Sin dato'),'neutral');assert.equal(metric('Gasto del período','$10.000'),'analysis');
});
test('unknown labels and negated statuses never acquire a false success or error',()=>{
 assert.equal(status('No completado'),null);assert.equal(status('Sin errores'),null);
 assert.equal(metric('Sin errores','0'),'neutral');assert.equal(metric('No aprobadas','4'),'neutral');
 for(const name of ['Instagram','LinkedIn','Google','CLP','Empresa Nueva'])assert.equal(status(name),null);
});
test('dates and invoice identifiers are not treated as amounts or verdicts',()=>{
 assert.equal(status('2026-09-14'),null);assert.equal(metric('Folio','12345'),null);
 assert.equal(metric('Saldo pendiente','—'),'neutral');assert.equal(status('⚠ 14 días de mora'),'danger');
});
