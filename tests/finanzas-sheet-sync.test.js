'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const script=fs.readFileSync('js/finanzas-sheet-sync.js','utf8');
const finance=fs.readFileSync('js/finanzas.js','utf8');
const headers=['ID','FECHA','TIPO','CATEGORÍA','DESCRIPCIÓN','MONTO','MÉTODO','REFERENCIA','PROVEEDOR/CLIENTE','ESTADO','ACTUALIZADO'];
function mock(){
  const data=[
    [...headers],
    ['tls-legacy-2026-11-02-ingreso','2026-11-02','ingreso','Caja · Google Sheets','DEV GUSTAVO',15500,'Google Sheets','NOVIEMBRE 2026','','Activo','2026-11-05T00:00:00Z'],
    ['tls-legacy-2026-11-03-gasto','2026-11-03','gasto','Caja · Google Sheets','COMIDA KAISER',10380,'Google Sheets','NOVIEMBRE 2026','','Activo','2026-11-05T00:00:00Z']
  ];
  const writes=[];
  const dom={};
  for(const id of ['ld-fecha','ld-tipo','ld-descripcion','ld-monto','ld-metodo','ld-referencia','ld-contraparte'])
    dom[id]={value:'',scrollIntoView(){},focus(){}};
  dom['ld-categoria']={value:'',options:[],add(opt){this.options.push(opt)}};
  let updates=0;
  const win={};
  const context={window:win,document:{readyState:'loading',addEventListener(){},getElementById:id=>dom[id]||null},
    Date,Number,String,JSON,Map,Array,Error,Intl,Set,Option:function(text,value){return {text,value}},
    crypto:{randomUUID:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
    toast(){},ldFiltrar(){updates++},ldSwitchTipo(){},confirm(){return true},
    _driveApiFetch:async(url,opts={})=>{
      const range=decodeURIComponent(url.split('/values/')[1].split('?')[0]);
      const key=range.replace(/:append$/,'');
      if(key==="'MOVIMIENTOS'!A1:K"&&(!opts.method||opts.method==='GET'))
        return {values:data.map(r=>r.slice())};
      const full=/^'MOVIMIENTOS'!A(\d+):K\1$/.exec(key);
      const status=/^'MOVIMIENTOS'!J(\d+):K\1$/.exec(key);
      if(opts.method==='POST'){
        assert.match(range,/:append$/);
        const row=JSON.parse(opts.body).values[0];
        data.push(row);writes.push({kind:'append',row});
        return{updates:{updatedRange:"'MOVIMIENTOS'!A"+data.length+":K"+data.length}};
      }
      if(full){
        const index=Number(full[1])-1;
        if(opts.method==='PUT'){
          const row=JSON.parse(opts.body).values[0];
          data[index]=row;writes.push({kind:'edit',row});
          return{};
        }
        return{values:[data[index]?.slice()||[]]};
      }
      if(status&&opts.method==='PUT'){
        const index=Number(status[1])-1;
        const fields=JSON.parse(opts.body).values[0];
        data[index][9]=fields[0];data[index][10]=fields[1];
        writes.push({kind:'delete',fields});return{};
      }
      throw Error('Unexpected URL: '+url+' / '+opts.method);
    }};
  vm.runInNewContext(script,context);
  return{api:win.TLSFinanceSheets,data,writes,dom,updates:()=>updates};
}
test('module parses and operates inside the existing Libro Diario',()=>{
  assert.doesNotThrow(()=>new Function(script));
  assert.match(script,/getElementById\('ld-tbody'\)/);
  assert.doesNotMatch(script,/tls-sheet-caja/);
  assert.match(finance,/window\.TLSFinanceSheets\.saveFromForm\(\{fecha,tipo,categoria,descripcion,monto,metodo,referencia,contraparte\}\)/);
  assert.match(finance,/js\/finanzas-sheet-sync\.js\?v=20261105-transactions/);
});
test('reads independently numbered historical transactions',async()=>{
  const m=mock();assert.equal(await m.api.refresh(true),true);
  const rows=Array.from(m.api.getEntries());
  assert.equal(rows.length,2);
  assert.equal(rows[0].monto,15500);
  assert.equal(rows[1].monto,10380);
  assert.ok(rows.every(x=>x._sheetSource&&x.categoria==='Caja · Google Sheets'));
});
test('appends two expenses on the same day without replacing totals or each other',async()=>{
  const m=mock();await m.api.refresh(true);
  const entry=(text,monto)=>({fecha:'2026-11-05',tipo:'gasto',categoria:'Materiales',descripcion:text,monto,metodo:'Transferencia',referencia:'',contraparte:''});
  assert.equal(await m.api.saveFromForm(entry('Filamento',2000)),true);
  const first=Array.from(m.api.getEntries());assert.equal(first.length,3);
  // use a distinct generated ID for a separate movement in this test
  const secondEntry={fecha:'2026-11-05',tipo:'ingreso',categoria:'Ventas',descripcion:'Venta',monto:15000,metodo:'Efectivo',referencia:'',contraparte:''};
  assert.equal(await m.api.saveFromForm(secondEntry),false,'duplicate UUID response must be refused, not silently merge');
  assert.equal(m.writes[0].kind,'append');
  assert.equal(m.data[3][4],'Filamento');
});
test('edits one record by ID without changing a different record',async()=>{
  const m=mock();await m.api.refresh(true);
  const id='tls-legacy-2026-11-03-gasto';
  m.api.edit(id);
  m.dom['ld-descripcion'].value='COMIDA';
  const result=await m.api.saveFromForm({fecha:'2026-11-03',tipo:'gasto',categoria:'Comida',descripcion:'COMIDA',monto:11000,metodo:'Tarjeta',referencia:'',contraparte:''});
  assert.equal(result,true);assert.equal(m.data[2][5],11000);assert.equal(m.data[1][5],15500);
});
test('deletion is a reversible tombstone; no rows are actually erased',async()=>{
  const m=mock();await m.api.refresh(true);
  assert.equal(await m.api.remove('tls-legacy-2026-11-03-gasto'),true);
  assert.equal(m.data.length,3);
  assert.equal(m.data[2][9],'Eliminado');
  assert.equal(m.api.getEntries().length,1);
});
test('stale remote edits cannot be overwritten',async()=>{
  const m=mock();await m.api.refresh(true);
  m.api.edit('tls-legacy-2026-11-03-gasto');
  m.data[2][5]=99999;
  assert.equal(await m.api.saveFromForm({fecha:'2026-11-03',tipo:'gasto',descripcion:'COMIDA',monto:10,categoria:'Gasto',metodo:'',referencia:'',contraparte:''}),false);
  assert.equal(m.writes.length,0);
});
test('invalid formulas and invalid dates cannot be submitted',async()=>{
  const m=mock();await m.api.refresh(true);
  const base={fecha:'2026-11-05',tipo:'ingreso',categoria:'Ventas',monto:1000,metodo:'Transferencia',referencia:'',contraparte:''};
  assert.equal(await m.api.saveFromForm({...base,descripcion:'=IMPORTXML("bad")'}),false);
  assert.equal(await m.api.saveFromForm({...base,fecha:'2026-11-31',descripcion:'Venta'}),false);
  assert.equal(m.writes.length,0);
});
test('the sheet is authoritative and no duplicate Airtable sync is introduced',()=>{
  assert.match(script,/MOVIMIENTOS/);
  assert.doesNotMatch(script,/_finSharedMutate|\/shared\/finance|localStorage|airtableWrite/);
  assert.match(finance,/function ldGetDisplayAll/);
  assert.match(finance,/ldFiltradas=ldGetDisplayAll\(\)/);
});