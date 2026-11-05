'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const bridge=fs.readFileSync('js/finanzas-sheet-sync.js','utf8');
const finance=fs.readFileSync('js/finanzas.js','utf8');

const ID='12OYYXY8ExcAvhwB_A4PTPkghowA5Cm_8BSgJ_gZAuqo';
function fixture(){
  const data=new Map();
  for(let day=1;day<=30;day++)data.set(day,[null,null,'']);
  data.set(5,[1000,null,'Pago inicial']);
  data.set(8,[500,200,'Mixto']);
  const writes=[];
  let refreshCount=0;
  const window={};
  const document={readyState:'loading',addEventListener:(e,fn)=>{},visibilityState:'visible'};
  const ctx={
    window,document,
    console,Date,Number,Map,Array,JSON,String,Error,Intl,Set,
    confirm:()=>true,toast:()=>{},
    ldFiltrar:()=>{refreshCount++},
    _driveApiFetch:async (url,opts={})=>{
      const from=url.split('/values/')[1]?.split('?')[0];
      const path=decodeURIComponent(from||'');
      if(path==="'NOVIEMBRE 2026'!I3")return{values:[[45140]]};
      if(path==="'NOVIEMBRE 2026'!C3:F33"){
        return{values:[['FECHA','INGRESOS','EGRESOS','DETALLE'],
          ...Array.from({length:30},(_,i)=>[i+1,...data.get(i+1)])]};
      }
      const readMatch=/^'NOVIEMBRE 2026'!C(\d+):F(\d+)$/.exec(path);
      if(readMatch){
        const row=Number(readMatch[1]);assert.equal(row,Number(readMatch[2]));
        const day=row-3;return{values:[[day,...data.get(day)]]};
      }
      const writeMatch=/^'NOVIEMBRE 2026'!D(\d+):F(\d+)$/.exec(path);
      if(writeMatch){
        assert.equal(opts.method,'PUT');
        assert.equal(Number(writeMatch[1]),Number(writeMatch[2]));
        const day=Number(writeMatch[1])-3;
        const payload=JSON.parse(opts.body);
        const next=payload.values[0];
        assert.equal(payload.range,path);
        writes.push({day,next});
        data.set(day,[next[0]===''?null:next[0],next[1]===''?null:next[1],next[2]]);
        return{updatedRange:path};
      }
      throw Error('Unexpected sheet range: '+path);
    }
  };
  vm.runInNewContext(bridge,ctx,{filename:'finanzas-sheet-sync.js'});
  return{api:window.TLSFinanceSheets,data,writes,refreshCount:()=>refreshCount};
}
test('new Sheets adapter compiles without a standalone card',()=>{
  assert.doesNotThrow(()=>new Function(bridge));
  assert.doesNotMatch(bridge,/id=['"]tls-sheet-caja|className=['"]tls-sheet-caja/);
  assert.match(bridge,/ld-tbody/);
  assert.match(bridge,/ld-monto/);
});
test('ledger display integrates sheets alongside native entries but never persists them',()=>{
  assert.match(finance,/function ldGetDisplayAll\(/);
  assert.match(finance,/ldFiltradas=ldGetDisplayAll\(\)\.filter/);
  assert.match(finance,/const all=ldGetDisplayAll\(\)/);
  assert.match(finance,/if\(window\.TLSFinanceSheets\?\.isSelected\?\.\(\)\)/);
  assert.match(finance,/window\.TLSFinanceSheets\?\.remove\?\.\(id\)/);
  assert.match(finance,/window\.TLSFinanceSheets\.edit/);
  assert.match(finance,/js\/finanzas-sheet-sync\.js\?v=20261105-unified/);
  assert.match(bridge,/getEntries:\(\)=>entries\.map/);
  assert.doesNotMatch(bridge,/_finSharedMutate|\/shared\/finance|airtableWrite|localStorage/);
});
test('live sheet row projection preserves dates, types, totals and source markers',async()=>{
  const f=fixture();assert.equal(await f.api.refresh(true),true);
  const rows=f.api.getEntries();
  assert.equal(rows.length,3);
  assert.deepEqual(Array.from(rows,e=>[e.fecha,e.tipo,e.monto]),[
    ['2026-11-05','ingreso',1000],
    ['2026-11-08','ingreso',500],
    ['2026-11-08','gasto',200]
  ]);
  assert.ok(rows.every(e=>e._sheetSource===true&&e.metodo==='Google Sheets'));
  assert.equal(f.refreshCount(),1);
});
test('new ledger movement writes exactly D:F of the chosen day and verifies',async()=>{
  const f=fixture();await f.api.refresh(true);
  assert.equal(await f.api.saveFromForm({fecha:'2026-11-06',tipo:'gasto',monto:350,descripcion:'Insumos'}),true);
  assert.deepEqual(f.data.get(6),[null,350,'Insumos']);
  assert.equal(f.writes.length,1);
  assert.equal(f.writes[0].day,6);
  assert.ok(f.api.getEntries().some(e=>e.fecha==='2026-11-06'&&e.tipo==='gasto'&&e.monto===350));
});
test('duplicate daily type, unsupported month or fractional CLP are refused',async()=>{
  const f=fixture();await f.api.refresh(true);
  assert.equal(await f.api.saveFromForm({fecha:'2026-11-05',tipo:'ingreso',monto:100,descripcion:'Otro'}),false);
  assert.equal(await f.api.saveFromForm({fecha:'2026-12-05',tipo:'gasto',monto:100,descripcion:'Otro'}),false);
  assert.equal(await f.api.saveFromForm({fecha:'2026-11-06',tipo:'gasto',monto:100.5,descripcion:'Otro'}),false);
  assert.equal(f.writes.length,0);
});
test('editing one side cannot overwrite the shared description of the other side',async()=>{
  const f=fixture();await f.api.refresh(true);
  assert.equal(await f.api.saveFromForm({fecha:'2026-11-08',tipo:'gasto',monto:300,descripcion:'Otro detalle'}),false);
  assert.equal(f.writes.length,0);
});
test('remote concurrent edit causes optimistic update conflict and no write',async()=>{
  const f=fixture();await f.api.refresh(true);
  f.data.set(6,[null,900,'Alguien editó en Drive']);
  assert.equal(await f.api.saveFromForm({fecha:'2026-11-06',tipo:'gasto',monto:350,descripcion:'Insumos'}),false);
  assert.equal(f.writes.length,0);
});
test('delete only clears one amount and preserves shared detail while other side exists',async()=>{
  const f=fixture();await f.api.refresh(true);
  assert.equal(await f.api.remove('tls-sheet-2026-11-08-gasto'),true);
  assert.deepEqual(f.data.get(8),[500,null,'Mixto']);
  assert.equal(f.api.getEntries().filter(e=>e.fecha==='2026-11-08').length,1);
});
test('no hidden permanent sync or unrelated API key is included',()=>{
  assert.match(bridge,/const POLL_MS=30000/);
  assert.match(bridge,/_driveApiFetch/);
  assert.doesNotMatch(bridge,/sk-ant-|AIza[A-Za-z0-9_-]+|client_secret|private_key/);
  assert.match(bridge,/const grid=await read\('C3:F33'\)/);
  assert.match(bridge,/const opening=await read\('I3'\)/);
});