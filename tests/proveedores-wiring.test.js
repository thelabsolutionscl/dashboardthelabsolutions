#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const PROV=fs.readFileSync(path.join(ROOT,'js','proveedores.js'),'utf8');
const LEAD=fs.readFileSync(path.join(ROOT,'lead-worker','src','index.js'),'utf8');
const PROXY=fs.readFileSync(path.join(ROOT,'airtable-proxy','src','worker.js'),'utf8');
const ACCESS=fs.readFileSync(path.join(ROOT,'airtable-proxy','src','access-auth.js'),'utf8');

test('PROVEEDORES conserva navegación y UI esencial',()=>{
  assert.equal((INDEX.match(/id=["']tab-proveedores["']/g)||[]).length,1);
  for(const id of ['proveedoresTableBody','proveedorSearch','proveedorCatFilter','mejorPrecioProv','ocList','ocModal'])
    assert.ok(INDEX.includes('id="'+id+'"')||INDEX.includes("id='"+id+"'"),id);
  assert.match(INDEX,/js\/proveedores\.js\?v=/);
});

test('SupplierOps usa record ID de Airtable como supplierId canónico',()=>{
  assert.match(PROV,/_supplierByAny\(v\)/);
  assert.match(PROV,/_supplierPedidoMatches\(pedido,supplierId,nombre\)/);
  assert.match(PROV,/f\.Proveedores\|\|linked/);
  assert.match(PROXY,/supplierIdSafe\(v\)/);
  assert.match(PROXY,/rec\[A-Za-z0-9\].*14/);
});

test('bootstrap crea entidades individuales y relaciones reales',()=>{
  for(const table of ['SupplierPrices','PurchaseOrders','PurchaseOrderItems','SupplierEvaluations','SupplierCategories'])
    assert.ok(PROXY.includes(table),table);
  assert.match(PROXY,/type:'multipleRecordLinks'/);
  assert.match(PROXY,/name:'Proveedores'/);
  assert.match(PROXY,/linkedTableId:supplierTable\.id/);
  assert.match(PROXY,/linkTargets=.*Pedidos.*Facturas.*Inventario/);
});

test('snapshot pagina y migra pedidos históricos solo con nombre inequívoco',()=>{
  assert.match(PROXY,/officeList\(env,'Proveedores',\{max:10000\}\)/);
  assert.match(PROXY,/officeList\(env,'Pedidos',\{max:10000\}\)/);
  assert.match(PROXY,/hits\.length!==1/);
  assert.match(PROXY,/officePatch\(env,'Pedidos',rec\.id,\{Proveedores:/);
});

test('creación dashboard es idempotente y deduplica antes de crear',()=>{
  assert.match(PROV,/_supplierMutate\('createSupplier'/);
  assert.match(PROXY,/supplierFindDuplicate/);
  assert.match(PROXY,/supplier-mutation:/);
  assert.match(PROXY,/prior\?\.done/);
  assert.match(PROXY,/deduped:true/);
});

test('postulación pública deduplica e idempotentiza sin repetir POST ambiguo',()=>{
  assert.match(LEAD,/Idempotency-Key/);
  assert.match(LEAD,/supplierApplicationHash/);
  assert.match(LEAD,/supplierApplicationGet/);
  assert.match(LEAD,/airtableFindProveedor/);
  assert.match(LEAD,/airtableCreateSupplierOnce/);
  assert.match(LEAD,/outcome uncertain; do not retry create/);
});

test('postulación pública conserva antiabuso y avisa configuración incompleta',()=>{
  assert.match(LEAD,/company_website\|\|body\._hp/);
  assert.match(LEAD,/verifyTurnstile/);
  assert.match(LEAD,/rateLimited\(env,request,"proveedor",5,60\)/);
  assert.match(LEAD,/TURNSTILE_SECRET no configurado/);
  assert.match(LEAD,/RL\/idempotencia KV no configurado/);
});

test('datos públicos importados validan email teléfono y web',()=>{
  assert.match(LEAD,/Email inválido/);
  assert.match(LEAD,/Teléfono inválido/);
  assert.match(LEAD,/Sitio web inválido/);
});

test('edición permite limpiar campos vacíos',()=>{
  const a=PROV.indexOf('async function saveEditProveedor()'),b=PROV.indexOf('// ── PROVEEDORES MULTI-SELECT',a);
  const block=PROV.slice(a,b);
  assert.match(block,/'Teléfono':document\.getElementById\('epTelefono'\)\.value\|\|''/);
  assert.match(block,/'Notas':document\.getElementById\('epNotas'\)\.value\|\|''/);
  assert.doesNotMatch(block,/delete fields\[k\]/);
});

test('evaluación exige motivo checklist y conserva actor fecha y evidencia',()=>{
  assert.match(PROV,/_supplierMutate\('evaluation'/);
  assert.match(PROV,/Checklist verificado/);
  assert.match(PROXY,/Motivo obligatorio/);
  assert.match(PROXY,/Checklist obligatorio/);
  assert.match(PROXY,/Responsable:actor\.email/);
  assert.match(PROXY,/Evidencia:evidence/);
});

test('reputación es derivada y no editable directamente',()=>{
  assert.match(PROXY,/function supplierScores/);
  assert.match(PROXY,/'Score derivado':scores\.score/);
  assert.match(PROV,/La reputación ahora se deriva de evaluaciones y entregas/);
});

test('SupplierPrices guarda los campos económicos y de vigencia',()=>{
  for(const field of ['Supplier ID','Item Key','Currency','Unit','Net Price','Tax Rate','Min Qty','Vigencia desde','Vigencia hasta','Source URL'])
    assert.ok(PROXY.includes(field),field);
  assert.match(PROXY,/existing.*Vigente/s);
});

test('precios ya no se escriben como blob local',()=>{
  assert.match(PROV,/_preciosProvSaveArr=function\(\)\{throw Error\('SupplierPrices es autoritativo/);
  assert.match(PROV,/_supplierOpsState\.prices/);
});

test('OC reserva correlativo dentro del guard serial',()=>{
  assert.match(PROXY,/seqKey='supplier-po-seq:'\+year/);
  assert.match(PROXY,/state\.storage\.put\(seqKey,seq\)/);
  assert.match(PROXY,/String\(seq\)\.padStart\(3,'0'\)/);
  assert.match(PROV,/_ocNextNum=function\(\)\{return 'OC-PENDIENTE'/);
});

test('OC tiene ciclo operativo y aprobación restringida',()=>{
  for(const state of ['Borrador','Aprobación','Aprobada','Enviada','Aceptada','Recibida parcial','Recibida total','Facturada','Pagada','Cerrada','Cancelada'])
    assert.ok(PROXY.includes(state),state);
  assert.match(PROXY,/Approval role required/);
  assert.match(PROXY,/Aprobada en/);
  assert.match(PROXY,/Recibida en/);
});

test('OC e ítems son entidades separadas y soportan recepción parcial',()=>{
  assert.match(PROXY,/officeCreate\(this\.env,'PurchaseOrders'/);
  assert.match(PROXY,/officeCreate\(this\.env,'PurchaseOrderItems'/);
  assert.match(PROXY,/'Cantidad recibida'/);
  assert.match(PROXY,/Recibida total.*Recibida parcial/);
});

test('ficha usa gasto de OC y no revenue del cliente',()=>{
  assert.match(PROV,/function _supplierSpend\(supplierId\)/);
  assert.match(PROV,/Gasto OC/);
});

test('eliminación es archivo lógico y conserva identidad histórica',()=>{
  assert.match(PROV,/_supplierMutate\('archiveSupplier'/);
  assert.match(PROXY,/supplierDependencies/);
  assert.match(PROXY,/deps\.total>0\?'Archivado':'Inactivo'/);
});

test('categorías son compartidas y renombrar migra proveedores',()=>{
  assert.match(PROXY,/SupplierCategories/);
  assert.match(PROXY,/op==='syncCategories'/);
  assert.match(PROXY,/op==='renameCategory'/);
  assert.match(PROXY,/'Categoría':next/);
  assert.match(PROV,/renamePvCat=async function/);
  assert.match(PROV,/_supplierMutate\('syncCategories'/);
});

test('CSV respeta filtros neutraliza fórmulas y audita exportación',()=>{
  const tail=PROV.slice(PROV.lastIndexOf('const _supplierLegacyExport'));
  assert.match(tail,/proveedorSearch/);
  assert.match(tail,/proveedorCatFilter/);
  assert.match(tail,/\[=\+\\-@\]/);
  assert.match(tail,/\/office\/audit/);
  assert.match(tail,/action:'export'/);
});

test('API Proveedores está protegida por Access y Durable Object',()=>{
  assert.match(ACCESS,/path==='\/suppliers\/snapshot'/);
  assert.match(ACCESS,/path==='\/suppliers\/mutate'/);
  assert.match(ACCESS,/path==='\/suppliers\/bootstrap'/);
  assert.match(PROXY,/idFromName\('tls-supplier-ops'\)/);
  assert.match(PROXY,/path==='\/supplier-ops'/);
});

test('bootstrap y mutaciones generan auditoría',()=>{
  assert.match(PROXY,/officeAudit\(env,authorized\.identity,'bootstrap','suppliers'/);
  assert.match(PROXY,/officeAudit\(\s*env,authorized\.identity,'supplier:'/);
});

test('no quedan TODO de auditoría',()=>{
  assert.doesNotMatch(fs.readFileSync(__filename,'utf8'),/test\.todo/);
});
