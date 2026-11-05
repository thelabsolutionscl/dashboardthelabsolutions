(function(){
  'use strict';
  // Ledger source of truth: the existing Google Sheet. No Airtable or localStorage mirror.
  const SHEET_ID='12OYYXY8ExcAvhwB_A4PTPkghowA5Cm_8BSgJ_gZAuqo';
  const SHEET_NAME='NOVIEMBRE 2026';
  const SHEET_PREFIX="'"+SHEET_NAME.replace(/'/g,"''")+"'!";
  const API='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(SHEET_ID)+'/values/';
  const DAYS=30; // November 2026. Template: header row 3; days 1..30 on rows 4..33.
  const REFRESH_MS=30000;
  const sourceUrl='https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/edit';
  let root=null, connected=false, fetching=false, saving=false, lastFetched=0;
  const bases=new Map();

  const money=n=>Number.isFinite(n)?new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(n):'—';
  function asAmount(value){
    if(value==null||value==='')return null;
    if(typeof value==='number')return Number.isFinite(value)?value:null;
    const s=String(value).replace(/[\s$]/g,'').trim();
    if(!s)return null;
    const normalized=/^-?\d{1,3}(\.\d{3})+$/.test(s)?s.replace(/\./g,''):s.replace(',','.');
    const n=Number(normalized);
    return Number.isFinite(n)?n:null;
  }
  const rowValue=(values)=>[asAmount(values?.[0]),asAmount(values?.[1]),String(values?.[2]??'')];
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const sheetRange=(r)=>SHEET_PREFIX+r;
  async function read(range){
    if(typeof _driveApiFetch!=='function')throw new Error('El módulo de Google Drive no está cargado');
    return _driveApiFetch(API+encodeURIComponent(sheetRange(range))+'?valueRenderOption=UNFORMATTED_VALUE');
  }
  async function write(row,values){
    const range=sheetRange('D'+row+':F'+row);
    return _driveApiFetch(API+encodeURIComponent(range)+'?valueInputOption=RAW',{
      method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({range,majorDimension:'ROWS',values:[[values[0]??'',values[1]??'',values[2]]]})
    });
  }
  function status(message,isError=false){
    if(!root)return;
    const el=root.querySelector('[data-tls-status]');
    if(el){el.textContent=message;el.classList.toggle('tls-sheet-error',isError);}
  }
  function isDirty(){
    return !!root?.querySelector('tr[data-dirty="true"]');
  }
  function isVisible(){
    return !!(root&&root.getClientRects().length&&document.visibilityState==='visible');
  }
  function tokenLive(){
    try{return typeof _driveAccessToken!=='undefined'&&!!_driveAccessToken&&
      typeof _driveTokenExpiry!=='undefined'&&Date.now()+60000<_driveTokenExpiry;}
    catch(_){return false;}
  }
  function setBusy(b){
    const all=root.querySelectorAll('[data-tls-refresh],[data-tls-save]');
    all.forEach(bn=>{bn.disabled=b;});
  }
  function createField(type,val,label,day){
    const input=document.createElement('input');
    input.type=type;
    input.setAttribute('aria-label',label+' del '+day+' de noviembre de 2026');
    input.className='tls-sheet-field';
    input.dataset.col=label;
    if(type==='number'){input.min='0';input.step='1';input.inputMode='numeric';input.value=val==null?'':String(val);}
    else{input.maxLength=500;input.value=String(val??'');}
    input.addEventListener('input',()=>markDirty(input.closest('tr')));
    return input;
  }
  function edited(tr){
    const inputs=tr.querySelectorAll('input[data-col]');
    return [asAmount(inputs[0].value),asAmount(inputs[1].value),inputs[2].value];
  }
  function markDirty(tr){
    const row=Number(tr.dataset.sheetRow);
    const dirty=!equal(bases.get(row),edited(tr));
    tr.dataset.dirty=String(dirty);
    const btn=tr.querySelector('[data-tls-save]');
    btn.hidden=!dirty;
    btn.disabled=saving;
    status(dirty?'Cambios sin guardar. Guarda la fila para actualizar Google Sheets.':isDirty()?'Hay cambios sin guardar.':'Sincronizado con Google Sheets.');
  }
  function repaintTotals(){
    let income=0,expense=0;
    for(const tr of root.querySelectorAll('tbody tr')){
      const [a,b]=edited(tr);
      income+=a||0;expense+=b||0;
    }
    root.querySelector('[data-tls-income]').textContent=money(income);
    root.querySelector('[data-tls-expense]').textContent=money(expense);
    root.querySelector('[data-tls-net]').textContent=money(income-expense);
    const opening=asAmount(root.dataset.opening)||0;
    root.querySelector('[data-tls-balance]').textContent=money(opening+income-expense);
  }
  function paintRows(values,opening){
    bases.clear();
    root.dataset.opening=String(opening??0);
    root.querySelector('[data-tls-opening]').textContent=money(opening||0);
    const tbody=root.querySelector('tbody');
    tbody.replaceChildren();
    for(let day=1;day<=DAYS;day++){
      const r=day+3;
      const sheetRow=values[day]||[]; // values[0] is the row-3 header
      const actualDay=Number(sheetRow[0]);
      const valid=actualDay===day;
      const base=rowValue(sheetRow.slice(1));
      if(valid)bases.set(r,base);
      const tr=document.createElement('tr');
      tr.dataset.sheetRow=String(r);
      tr.dataset.day=String(day);
      tr.dataset.dirty='false';
      const date=document.createElement('th');
      date.scope='row'; date.textContent=day+' nov';
      tr.append(date);
      for(let c=0;c<3;c++){
        const td=document.createElement('td');
        const label=['Ingreso','Egreso','Detalle'][c];
        const input=createField(c===2?'text':'number',base[c],label,day);
        input.disabled=!valid;
        td.append(input);tr.append(td);
      }
      const actions=document.createElement('td');
      const save=document.createElement('button');
      save.type='button';save.className='tls-sheet-save';save.textContent='Guardar';
      save.dataset.tlsSave='';save.hidden=true;save.disabled=!valid;
      save.addEventListener('click',()=>saveRow(tr));
      actions.append(save);
      if(!valid){
        const warn=document.createElement('small');
        warn.textContent='Fila '+r+' no coincide con el día '+day;
        actions.append(warn);
      }
      tr.append(actions);tbody.append(tr);
    }
    root.querySelector('[data-tls-grid]').hidden=false;
    repaintTotals();
  }
  function parseInput(tr){
    const inputs=tr.querySelectorAll('input');
    for(let i=0;i<2;i++){
      const v=inputs[i].value.trim();
      if(v!==''&&(!/^\d+(?:\.\d{1,2})?$/.test(v)||!Number.isFinite(Number(v))||Number(v)>1e11))
        throw new Error('Los montos deben ser valores positivos en CLP (máximo 2 decimales).');
    }
    return edited(tr);
  }
  async function saveRow(tr){
    if(saving||fetching||!connected)return;
    const day=Number(tr.dataset.day),row=Number(tr.dataset.sheetRow);
    let values;
    try{values=parseInput(tr);}catch(e){status(e.message,true);return;}
    if(equal(values,bases.get(row)))return;
    saving=true;setBusy(true);status('Verificando si la planilla cambió antes de guardar…');
    try{
      // Optimistic guard: refuse to overwrite a row edited remotely after our last read.
      const remote=await read('C'+row+':F'+row);
      const cells=remote.values?.[0]||[];
      if(Number(cells[0])!==day)throw new Error('La fecha de esa fila cambió en Google Sheets. Actualiza antes de guardar.');
      if(!equal(rowValue(cells.slice(1)),bases.get(row)))
        throw new Error('Esta fila cambió en Google Sheets. No se sobrescribió; revisa y actualiza la planilla.');
      await write(row,values);
      const verified=await read('C'+row+':F'+row);
      const actual=verified.values?.[0]||[];
      if(Number(actual[0])!==day||!equal(rowValue(actual.slice(1)),values))
        throw new Error('Google recibió la solicitud, pero no fue posible verificar el guardado. Comprueba la planilla antes de reintentar.');
      bases.set(row,values);
      tr.dataset.dirty='false';tr.querySelector('[data-tls-save]').hidden=true;
      repaintTotals();
      status('Día '+day+' guardado y verificado en Google Sheets. Última edición: '+new Date().toLocaleTimeString('es-CL')+'.');
      // Keep any other unsaved rows intact.
    }catch(e){status(e.message||'Error al guardar en Google Sheets',true);}
    finally{saving=false;setBusy(false);tr.querySelectorAll('input').forEach(i=>i.disabled=false);}
  }
  async function refresh({interactive=false,force=false,quiet=false}={}){
    if(fetching||saving||!root)return;
    if(isDirty()&&!force){
      if(interactive){if(!confirm('Hay cambios sin guardar. ¿Descartarlos para cargar Google Sheets?'))return;}
      else return;
    }
    if(!interactive&&!tokenLive()){connected=false;status('La sesión de Google Drive venció. Pulsa «Conectar / actualizar».');return;}
    fetching=true;setBusy(true);
    if(!quiet)status('Leyendo la planilla en Google Drive…');
    try{
      // A manual click may obtain OAuth consent; periodic polling never opens a login prompt.
      const content=await read('C3:F34');
      const opening=await read('I3');
      const dayRows=content.values||[];
      if(dayRows.length<31||Number(dayRows[1]?.[0])!==1||Number(dayRows[30]?.[0])!==30)
        throw new Error('El diseño de las fechas en la pestaña NOVIEMBRE 2026 cambió; no se editará ninguna fila.');
      const initial=asAmount(opening.values?.[0]?.[0])||0;
      paintRows(dayRows,initial);
      connected=true;lastFetched=Date.now();
      status('Sincronizado. Última lectura: '+new Date(lastFetched).toLocaleTimeString('es-CL')+'. Se actualiza cada 30 segundos mientras Finanzas está abierto.');
    }catch(e){
      if(!connected)root.querySelector('[data-tls-grid]').hidden=true;
      status((e?.message||'No se pudo conectar con Google Sheets')+'. Usa la cuenta de Drive que tenga acceso a esta planilla.',true);
    }finally{fetching=false;setBusy(false);}
  }
  function init(){
    if(document.getElementById('tls-sheet-caja'))return;
    const container=document.getElementById('fin-panel-diario');
    if(!container)return;
    root=document.createElement('section');
    root.id='tls-sheet-caja';
    root.className='tls-sheet-caja';
    root.innerHTML=`
      <style>
        #tls-sheet-caja{margin:26px 0;padding:18px;border:1px solid var(--border,#d9dce2);border-radius:14px;background:var(--card,#fff);color:var(--text,#232833)}
        #tls-sheet-caja h3{margin:0 0 6px;font-size:18px}
        #tls-sheet-caja .tls-sheet-intro{font-size:12px;opacity:.78;max-width:800px}
        #tls-sheet-caja .tls-sheet-toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:14px 0}
        #tls-sheet-caja button{border:1px solid #8b9cb4;padding:8px 12px;border-radius:8px;cursor:pointer;background:transparent;color:inherit}
        #tls-sheet-caja button:disabled{opacity:.48;cursor:wait}
        #tls-sheet-caja a{color:inherit;text-decoration:underline}
        #tls-sheet-caja [data-tls-status]{font-size:12px;opacity:.9}
        #tls-sheet-caja .tls-sheet-error{color:#bf3030}
        #tls-sheet-caja .tls-sheet-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:10px 0}
        #tls-sheet-caja .tls-sheet-metrics>div{padding:10px;border:1px solid var(--border,#d9dce2);border-radius:8px}
        #tls-sheet-caja .tls-sheet-metrics span{display:block;font-size:11px;opacity:.7}
        #tls-sheet-caja .tls-sheet-metrics strong{display:block;margin-top:3px;font-size:16px}
        #tls-sheet-caja .tls-sheet-scroll{max-height:420px;overflow:auto}
        #tls-sheet-caja table{width:100%;border-collapse:collapse;min-width:670px}
        #tls-sheet-caja th,#tls-sheet-caja td{padding:6px;border-bottom:1px solid var(--border,#dde0e6);text-align:left}
        #tls-sheet-caja thead th{position:sticky;top:0;background:var(--card,#fff);z-index:1}
        #tls-sheet-caja .tls-sheet-field{width:100%;min-width:90px;box-sizing:border-box;padding:7px;border:1px solid #aab1bd;border-radius:6px;background:transparent;color:inherit}
        #tls-sheet-caja td:nth-child(4) input{min-width:210px}
        #tls-sheet-caja tr[data-dirty="true"]{outline:1px solid #d5ac43;outline-offset:-1px}
        #tls-sheet-caja .tls-sheet-save{background:#2563eb;color:#fff;border-color:#2563eb}
        #tls-sheet-caja [hidden]{display:none!important}
      </style>
      <h3>Ingresos y Egresos · Google Sheets</h3>
      <p class="tls-sheet-intro">Planilla original: NOVIEMBRE 2026. Edita un total de ingresos, egresos y detalle por día; guarda la fila para escribir directamente en Drive. Es una vista separada del Libro Diario y no altera las facturas, presupuestos ni IVA. Los totales de la planilla no se sobrescriben.</p>
      <div class="tls-sheet-toolbar"><button type="button" data-tls-refresh>Conectar / actualizar</button>
        <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">Abrir planilla original</a>
        <span data-tls-status role="status" aria-live="polite">Conecta Google Drive para cargar los movimientos.</span>
      </div>
      <div data-tls-grid hidden>
        <div class="tls-sheet-metrics">
          <div><span>Saldo inicial</span><strong data-tls-opening>—</strong></div>
          <div><span>Ingresos</span><strong data-tls-income>—</strong></div>
          <div><span>Egresos</span><strong data-tls-expense>—</strong></div>
          <div><span>Resultado del mes</span><strong data-tls-net>—</strong></div>
          <div><span>Saldo estimado</span><strong data-tls-balance>—</strong></div>
        </div>
        <div class="tls-sheet-scroll"><table>
          <thead><tr><th>Fecha</th><th>Ingresos (CLP)</th><th>Egresos (CLP)</th><th>Detalle</th><th>Acción</th></tr></thead>
          <tbody></tbody>
        </table></div>
      </div>`;
    container.append(root);
    root.querySelector('[data-tls-refresh]').addEventListener('click',()=>refresh({interactive:true}));
    document.getElementById('fin-nav-diario')?.addEventListener('click',()=>{
      if(connected&&tokenLive()&&!isDirty()&&!fetching&&!saving)refresh({quiet:true});
    });
    window.setInterval(()=>{
      if(connected&&isVisible()&&!isDirty()&&!fetching&&!saving)refresh({quiet:true});
    },REFRESH_MS);
    document.addEventListener('visibilitychange',()=>{
      if(isVisible()&&connected&&Date.now()-lastFetched>REFRESH_MS&&!isDirty())refresh({quiet:true});
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();