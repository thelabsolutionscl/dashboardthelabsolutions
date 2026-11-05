(function(){
  'use strict';
  // One unified Libro Diario table. Google Sheets entries are a live, read-through
  // projection and never get persisted to the local/shared FINANZAS_V2 journal.
  const SHEET_ID='12OYYXY8ExcAvhwB_A4PTPkghowA5Cm_8BSgJ_gZAuqo';
  const SHEET_NAME='NOVIEMBRE 2026';
  const RANGE_PREFIX="'"+SHEET_NAME.replace(/'/g,"''")+"'!";
  const API='https://sheets.googleapis.com/v4/spreadsheets/'+SHEET_ID+'/values/';
  const URL_SHEET='https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/edit';
  const POLL_MS=30000;
  const DAY_MATCH=/^2026-11-(0[1-9]|[12][0-9]|30)$/;
  const cached=new Map();
  let entries=[],connected=false,busy=false,editingId='',lastFetched=0;
  let toolbar=null,sourceSelect=null,sourceHint=null,cancelButton=null;

  function amount(v){
    if(v==null||v==='')return null;
    if(typeof v==='number')return Number.isFinite(v)?v:null;
    const raw=String(v).replace(/[\s$]/g,'').trim();
    const cleaned=/^-?\d{1,3}(\.\d{3})+$/.test(raw)?raw.replace(/\./g,''):raw.replace(',','.');
    const n=Number(cleaned);return cleaned&&Number.isFinite(n)?n:null;
  }
  function cells(row){return[amount(row?.[0]),amount(row?.[1]),String(row?.[2]??'')];}
  const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const range=r=>RANGE_PREFIX+r;
  function dayFromDate(date){
    if(!DAY_MATCH.test(date))return null;
    return Number(date.slice(-2));
  }
  function fromId(id){
    const match=/^tls-sheet-2026-11-(0[1-9]|[12]\d|30)-(ingreso|gasto)$/.exec(id||'');
    return match?{day:Number(match[1]),tipo:match[2]}:null;
  }
  function hasAmount(v){return typeof v==='number'&&Number.isFinite(v)&&v>0;}
  function projection(){
    const list=[];
    for(let day=1;day<=30;day++){
      const row=cached.get(day);
      if(!row)continue;
      for(const [index,tipo]of [[0,'ingreso'],[1,'gasto']]){
        if(!hasAmount(row[index]))continue;
        const dd=String(day).padStart(2,'0');
        list.push({
          id:'tls-sheet-2026-11-'+dd+'-'+tipo,
          fecha:'2026-11-'+dd,tipo,categoria:'Caja · Google Sheets',
          descripcion:row[2]||'Movimiento de caja',monto:row[index],
          metodo:'Google Sheets',referencia:'NOVIEMBRE 2026',contraparte:'',
          _sheetSource:true
        });
      }
    }
    entries=list;
  }
  function status(message,error=false){
    if(!toolbar)return;
    const e=toolbar.querySelector('[data-sheet-status]');
    e.textContent=message;
    e.style.color=error?'#ff9e9e':'#a5c9ca';
  }
  function flash(message,error=false){
    status(message,error);
    if(error&&typeof toast==='function')toast(message,'error');
  }
  function repaint(){
    if(sourceSelect){
      const opt=sourceSelect.querySelector('option[value="sheet"]');
      if(opt)opt.disabled=!connected;
      if(!connected&&sourceSelect.value==='sheet'&&!editingId)sourceSelect.value='journal';
    }
    if(sourceHint){
      const sheetChosen=sourceSelect?.value==='sheet';
      sourceHint.textContent=editingId?'Editando fila existente de la planilla; fecha y tipo son fijos.':
        sheetChosen?'Google Sheets guarda solo fecha, monto y detalle; los demás campos del formulario no se transfieren. Una fila por día/tipo.':
        'El Libro Diario mantiene sus campos completos. Selecciona Google Sheets para guardar un movimiento en la planilla.';
    }
    if(cancelButton)cancelButton.hidden=!editingId;
  }
  function reloadLedger(){if(typeof ldFiltrar==='function')ldFiltrar();}
  function liveToken(){
    try{return typeof _driveAccessToken!=='undefined'&&!!_driveAccessToken&&
      typeof _driveTokenExpiry!=='undefined'&&Date.now()+60000<_driveTokenExpiry;}
    catch(_){return false;}
  }
  function visible(){
    return document.visibilityState==='visible'&&
      typeof finCurrentTab!=='undefined'&&finCurrentTab==='diario'&&
      !!document.getElementById('fin-panel-diario')?.getClientRects().length;
  }
  async function read(where){
    if(typeof _driveApiFetch!=='function')throw new Error('Google Drive no está disponible en el dashboard.');
    return _driveApiFetch(API+encodeURIComponent(range(where))+'?valueRenderOption=UNFORMATTED_VALUE');
  }
  async function write(day,next){
    const row=day+3,where=range('D'+row+':F'+row);
    return _driveApiFetch(API+encodeURIComponent(where)+'?valueInputOption=RAW',{
      method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({range:where,majorDimension:'ROWS',values:[[next[0]??'',next[1]??'',next[2]]]})
    });
  }
  function dropConnection(message){
    connected=false;editingId='';
    cached.clear();entries=[];repaint();reloadLedger();status(message,true);
  }
  async function refresh(interactive=false){
    if(busy)return false;
    // Never refresh an active form draft silently and then overwrite newer data.
    if(editingId){
      if(!interactive)return false;
      if(!confirm('Hay una edición de Google Sheets en curso. ¿Descartarla y actualizar?'))return false;
      if(typeof ldLimpiar==='function')ldLimpiar();
    }
    if(!interactive&&!liveToken()){
      dropConnection('La sesión de Drive venció. Conecta Google Sheets para continuar.');
      return false;
    }
    busy=true;
    const button=toolbar?.querySelector('[data-sheet-connect]');
    if(button)button.disabled=true;
    status('Leyendo Google Sheets…');
    try{
      // Request OAuth only once: parallel initial calls could replace the same GIS callback.
      const grid=await read('C3:F33');
      const opening=await read('I3');
      const rows=grid.values||[];
      if(!String(rows[0]?.[0]||'').trim().toUpperCase().includes('FECHA'))
        throw new Error('La cabecera de la planilla cambió. No se modificará ningún dato.');
      for(let day=1;day<=30;day++)
        if(Number(rows[day]?.[0])!==day)
          throw new Error('La fila '+(day+3)+' de la planilla ya no corresponde al día '+day+'.');
      // Only accept a fully validated snapshot.
      const next=new Map();
      for(let day=1;day<=30;day++)next.set(day,cells(rows[day].slice(1)));
      cached.clear();next.forEach((v,k)=>cached.set(k,v));
      projection();connected=true;lastFetched=Date.now();
      const initial=amount(opening.values?.[0]?.[0])||0;
      repaint();reloadLedger();
      const money=typeof fmtMoney==='function'?fmtMoney(initial):'$'+initial.toLocaleString('es-CL');
      status('Google Sheets conectado · saldo inicial '+money+' · actualizado '+new Date(lastFetched).toLocaleTimeString('es-CL')+'.');
      return true;
    }catch(e){
      const msg=(e?.message||'No se pudo leer Google Sheets')+'. Revisa el acceso a la planilla.';
      if(!connected)dropConnection(msg);else status(msg,true);
      return false;
    }finally{busy=false;if(button)button.disabled=false;}
  }
  async function guardedUpdate(day,transform){
    if(busy||!connected)throw new Error('Conecta Google Sheets antes de guardar.');
    const before=cached.get(day);
    if(!before)throw new Error('La fecha no existe en la planilla.');
    busy=true;
    const button=toolbar?.querySelector('[data-sheet-connect]');
    if(button)button.disabled=true;
    try{
      const original=await read('C'+(day+3)+':F'+(day+3));
      const row=original.values?.[0]||[];
      if(Number(row[0])!==day)throw new Error('La fecha de la fila cambió en la planilla.');
      if(!eq(cells(row.slice(1)),before))
        throw new Error('Google Sheets cambió esta fila. Pulsa Actualizar antes de guardar nuevamente.');
      const next=transform([...before]);
      if(!Array.isArray(next)||next.length!==3||next.some((v,i)=>i<2&&v!==null&&(!Number.isFinite(v)||v<0||v>1e11)))
        throw new Error('Movimiento inválido.');
      await write(day,next);
      const confirmation=await read('C'+(day+3)+':F'+(day+3));
      const latest=confirmation.values?.[0]||[];
      if(Number(latest[0])!==day||!eq(cells(latest.slice(1)),next))
        throw new Error('La escritura no pudo verificarse. Revisa la planilla antes de volver a guardar.');
      cached.set(day,next);projection();reloadLedger();
      status('Fila del '+day+' de noviembre guardada y verificada en Google Sheets.');
      return true;
    }finally{busy=false;if(button)button.disabled=false;}
  }
  function cleanError(e){
    flash(e?.message||'No se pudo modificar Google Sheets.',true);
    return false;
  }
  async function saveFromForm(entry){
    try{
      const day=dayFromDate(entry.fecha);
      if(day===null)throw new Error('La planilla vinculada corresponde solo a noviembre de 2026.');
      if(!['ingreso','gasto'].includes(entry.tipo))throw new Error('Tipo de movimiento inválido.');
      if(!Number.isSafeInteger(entry.monto)||entry.monto<=0||entry.monto>1e11)
        throw new Error('Usa un monto entero positivo en CLP.');
      if(!entry.descripcion||entry.descripcion.length>500)
        throw new Error('El detalle debe tener entre 1 y 500 caracteres.');
      const tipoIdx=entry.tipo==='ingreso'?0:1;
      if(editingId){
        const existing=fromId(editingId);
        if(!existing||existing.day!==day||existing.tipo!==entry.tipo)
          throw new Error('No se permite cambiar la fecha o el tipo de un registro de Google Sheets.');
      }
      const okay=await guardedUpdate(day,before=>{
        if(!editingId&&hasAmount(before[tipoIdx]))
          throw new Error('Ya existe un movimiento de ese tipo y día en Google Sheets. Usa Editar.');
        const otherIdx=tipoIdx===0?1:0;
        if(hasAmount(before[otherIdx])&&before[2]!==entry.descripcion)
          throw new Error('El detalle se comparte entre ingreso y egreso del mismo día; conserva el detalle original.');
        before[tipoIdx]=entry.monto;
        before[2]=entry.descripcion;
        return before;
      });
      return okay;
    }catch(e){return cleanError(e);}
  }
  async function remove(id){
    const parsed=fromId(id);
    if(!parsed)return cleanError(new Error('Registro de Google Sheets inválido.'));
    try{
      await guardedUpdate(parsed.day,before=>{
        const index=parsed.tipo==='ingreso'?0:1;
        if(!hasAmount(before[index]))throw new Error('El movimiento ya no existe. Actualiza la tabla.');
        before[index]=null;
        if(!hasAmount(before[1-index]))before[2]='';
        return before;
      });
      if(editingId===id&&typeof ldLimpiar==='function')ldLimpiar();
      return true;
    }catch(e){return cleanError(e);}
  }
  function clearEdit(){
    editingId='';
    const d=document.getElementById('ld-fecha'),t=document.getElementById('ld-tipo');
    if(d)d.disabled=false;
    if(t)t.disabled=false;
    if(sourceSelect){sourceSelect.disabled=false;sourceSelect.value='journal';}
    repaint();
  }
  function edit(id){
    const p=fromId(id);
    const item=entries.find(e=>e.id===id);
    if(!p||!item)return flash('El registro ya no está cargado. Conecta Google Sheets.',true);
    const d=document.getElementById('ld-fecha'),t=document.getElementById('ld-tipo');
    const desc=document.getElementById('ld-descripcion'),money=document.getElementById('ld-monto');
    if(!d||!t||!desc||!money)return flash('No se encontró el formulario del Libro Diario.',true);
    editingId=id;
    d.value=item.fecha;t.value=item.tipo;
    if(typeof ldSwitchTipo==='function')ldSwitchTipo();
    desc.value=item.descripcion==='Movimiento de caja'?'':item.descripcion;
    money.value=String(item.monto);
    if(sourceSelect){sourceSelect.value='sheet';sourceSelect.disabled=true;}
    d.disabled=true;t.disabled=true;
    repaint();
    d.closest('form')?.scrollIntoView({behavior:'smooth',block:'start'});
    if(!d.closest('form'))desc.scrollIntoView({behavior:'smooth',block:'center'});
    desc.focus();
    status('Editando movimiento del '+p.day+' de noviembre. Al guardar se actualizará Google Sheets.');
  }
  function createUI(){
    if(document.getElementById('tls-sheet-ledger-toolbar'))return;
    const tbody=document.getElementById('ld-tbody');
    const table=tbody?.closest('table');
    const amountEl=document.getElementById('ld-monto');
    if(!table||!amountEl)return;
    toolbar=document.createElement('div');
    toolbar.id='tls-sheet-ledger-toolbar';
    toolbar.innerHTML=
      '<button type="button" data-sheet-connect>Conectar / actualizar Google Sheets</button>'+
      '<a href="'+URL_SHEET+'" target="_blank" rel="noopener noreferrer">Abrir planilla</a>'+
      '<span data-sheet-status role="status" aria-live="polite">Google Sheets desconectado. Los movimientos de Drive aparecerán en esta misma tabla.</span>';
    // Placement: adjacent to the existing table, not an extra dashboard panel.
    table.parentNode.insertBefore(toolbar,table);
    const styles=document.createElement('style');
    styles.textContent=
      '#tls-sheet-ledger-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:12px 14px;margin:12px 0;border:1px solid #265457;border-radius:10px;background:#102326;color:#ebf8f8;font-size:12px}'+
      '#tls-sheet-ledger-toolbar button{border:1px solid #00bbb6;border-radius:7px;background:#00c7c0;color:#052525;padding:7px 12px;cursor:pointer;font-weight:700}'+
      '#tls-sheet-ledger-toolbar button:disabled{opacity:.6;cursor:progress}'+
      '#tls-sheet-ledger-toolbar a{color:#74e4df;text-decoration:underline}'+
      '#tls-sheet-ledger-toolbar [data-sheet-status]{color:#a5c9ca;flex:1;min-width:230px}'+
      '#tls-sheet-destination{padding:9px 11px;margin:8px 0;background:#13282b;border:1px solid #285359;border-radius:9px;color:#e4f5f5;max-width:550px}'+
      '#tls-sheet-destination select{display:block;width:100%;max-width:360px;margin:5px 0;padding:6px;background:#0a1719;color:#e4f5f5;border:1px solid #3b7276;border-radius:6px}'+
      '#tls-sheet-destination small{display:block;color:#a9c9c9;line-height:1.5}'+
      '#tls-sheet-destination button{border:1px solid #6baead;background:#172a30;color:#e4f5f5;border-radius:6px;margin-top:7px;padding:5px 10px}'+
      '#tls-sheet-ledger-toolbar button:focus-visible,#tls-sheet-destination select:focus-visible,#tls-sheet-destination button:focus-visible{outline:2px solid #89f6ed;outline-offset:2px}';
    document.head.append(styles);
    toolbar.querySelector('[data-sheet-connect]').addEventListener('click',()=>refresh(true));
    const selector=document.createElement('div');selector.id='tls-sheet-destination';
    selector.innerHTML=
      '<label for="tls-sheet-source">Guardar movimiento en:</label>'+
      '<select id="tls-sheet-source"><option value="journal">Libro Diario · registro completo</option>'+
      '<option value="sheet" disabled>Google Sheets · caja noviembre 2026</option></select>'+
      '<small data-sheet-hint></small>'+
      '<button type="button" data-sheet-cancel hidden>Cancelar edición de Google Sheets</button>';
    // Insert among the original Libro Diario form controls, not after its table.
    amountEl.parentElement.insertAdjacentElement('afterend',selector);
    sourceSelect=selector.querySelector('#tls-sheet-source');
    sourceHint=selector.querySelector('[data-sheet-hint]');
    cancelButton=selector.querySelector('[data-sheet-cancel]');
    sourceSelect.addEventListener('change',repaint);
    cancelButton.addEventListener('click',()=>{if(typeof ldLimpiar==='function')ldLimpiar();});
    repaint();
    document.getElementById('fin-nav-diario')?.addEventListener('click',()=>{
      if(connected&&liveToken()&&!busy)refresh(false);
    });
    document.addEventListener('visibilitychange',()=>{
      if(visible()&&connected&&Date.now()-lastFetched>POLL_MS)refresh(false);
    });
    window.setInterval(()=>{if(visible()&&connected&&!busy)refresh(false);},POLL_MS);
  }
  window.TLSFinanceSheets={
    getEntries:()=>entries.map(e=>({...e})),isSelected:()=>sourceSelect?.value==='sheet',
    saveFromForm,remove,edit,clearEdit,refresh,isConnected:()=>connected
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',createUI,{once:true});
  else createUI();
})();