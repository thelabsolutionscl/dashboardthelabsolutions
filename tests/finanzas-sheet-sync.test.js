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
  let sequence=0;
  const dom={};
  for(const id of ['ld-fecha','ld-tipo','ld-descripcion','ld-monto','ld-metodo','ld-referencia','ld-contraparte'])
    dom[id]={value:'',scrollIntoView(){},focus(){}};
  dom['ld-categoria']={value:'',options:[],add(opt){this.options.push(opt)}};
  let updates=0;
  const win={};
  const context={window:win,document:{readyState:'loading',addEventListener(){},getElementById:id=>dom[id]||null},
    Date,Number,String,JSON,Map,Array,Error,Intl,Set,Option:function(text,value){return {text,value}},
    crypto:{randomUUID:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-'+String(++sequence).padStart(12,'0')},
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
  assert.equal(await m.api.saveFromForm(entry('Pintura',500)),true);
  assert.equal(m.api.getEntries().length,4);
  assert.equal(m.writes.length,2);
  assert.equal(m.writes[0].kind,'append');
  assert.equal(m.writes[1].kind,'append');
  assert.equal(m.data[3][4],'Filamento');
  assert.equal(m.data[4][4],'Pintura');
  assert.equal(m.data[3][5]+m.data[4][5],2500);
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
test('la conexión usa el lenguaje visual común y aparece al entrar a Libro Diario',()=>{
  assert.match(script,/panel\.prepend\(toolbar\)/);
  assert.match(script,/getElementById\('fin-panel-diario'\)/);
  assert.match(script,/class="btn btn-primary btn-sm" data-sheet-connect/);
  assert.match(script,/class="btn btn-ghost btn-sm" target="_blank"/);
  assert.match(script,/data-sheet-indicator data-state="disconnected"/);
  assert.match(script,/data-sheet-status role="status" aria-live="polite"/);
  assert.match(script,/data-sheet-auto/);
  assert.match(script,/#tls-sheet-ledger-toolbar\{[^']*var\(--surface/);
  assert.match(script,/@media\(max-width:760px\)/);
});

test('el selector de fuente está integrado en el formulario y permite conectar sin desplazarse',()=>{
  assert.match(script,/money\.parentElement\.insertAdjacentElement\('afterend',block\)/);
  assert.match(script,/data-sheet-quick-connect/);
  assert.match(script,/block\.querySelector\('\[data-sheet-quick-connect\]'\)\.addEventListener\('click',\(\)=>refresh\(true\)\)/);
  assert.match(script,/select id="tls-sheet-source"/);
  assert.match(script,/sourceSelect\.value='journal'/);
  assert.match(script,/Cada ingreso o egreso tendrá su propia fila/);
});

test('el estado conectado se muestra solo después de lectura y conserva errores visibles',()=>{
  assert.match(script,/const state=busy\?'loading':lastError\?'error':connected\?'connected':'disconnected'/);
  assert.match(script,/const \{next,visible\}=accept\(res\.values\|\|\[\]\)/);
  assert.match(script,/entries=visible;connected=true;lastRead=Date\.now\(\)/);
  assert.match(script,/lastError=Boolean\(error\)/);
  assert.match(script,/renderConnection\(\)/);
});
