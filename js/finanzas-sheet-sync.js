(function(){
  'use strict';
  // MOVIMIENTOS is the shared transaction ledger. November daily cells are
  // summaries, not a write target. Never persist Google entries in FINANZAS_V2.
  const FILE_ID='12OYYXY8ExcAvhwB_A4PTPkghowA5Cm_8BSgJ_gZAuqo';
  const TAB='MOVIMIENTOS';
  const HEADER=['ID','FECHA','TIPO','CATEGORÍA','DESCRIPCIÓN','MONTO','MÉTODO','REFERENCIA','PROVEEDOR/CLIENTE','ESTADO','ACTUALIZADO'];
  const ENDPOINT='https://sheets.googleapis.com/v4/spreadsheets/'+FILE_ID+'/values/';
  const SOURCE_URL='https://docs.google.com/spreadsheets/d/'+FILE_ID+'/edit';
  const REFRESH_MS=30000;
  const rawById=new Map();
  let entries=[],connected=false,busy=false,editingId='',lastRead=0;
  let toolbar,sourceSelect,sourceHint,cancelButton;
  const safeId=id=>/^[A-Za-z0-9_-]{6,100}$/.test(id);
  const validDate=s=>/^(20\d{2}|21\d{2})-(0[1-9]|1[0-2])-([012]\d|3[01])$/.test(s)&&
    !Number.isNaN(Date.parse(s+'T12:00:00'))&&new Date(s+'T12:00:00').toISOString().slice(0,10)===s;
  const rowEqual=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function amount(v){
    if(v==null||v==='')return null;
    if(typeof v==='number')return Number.isFinite(v)?v:null;
    const str=String(v).trim().replace(/[$\s]/g,'');
    const num=Number(/^\d{1,3}(\.\d{3})+$/.test(str)?str.replace(/\./g,''):str.replace(',','.'));
    return str&&Number.isFinite(num)?num:null;
  }
  const clean=v=>String(v??'').trim();
  const sheetRange=range=>"'"+TAB+"'!"+range;
  async function api(method,range,body,params=''){
    if(typeof _driveApiFetch!=='function')throw new Error('Google Drive no está disponible en el dashboard.');
    const uri=ENDPOINT+encodeURIComponent(sheetRange(range))+(method==='POST'?':append':'')+params;
    return _driveApiFetch(uri,method==='GET'?{}:{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  }
  const read=range=>api('GET',range,null,'?valueRenderOption=UNFORMATTED_VALUE');
  function notice(message,error=false){
    const node=toolbar?.querySelector('[data-sheet-status]');
    if(node){node.textContent=message;node.style.color=error?'#ff9f9f':'#a5c9ca';}
    if(error&&typeof toast==='function')toast(message,'error');
  }
  function connectedToken(){
    try{return typeof _driveAccessToken!=='undefined'&&!!_driveAccessToken&&
      typeof _driveTokenExpiry!=='undefined'&&Date.now()+60000<_driveTokenExpiry;}
    catch(_){return false;}
  }
  function inView(){
    return document.visibilityState==='visible'&&typeof finCurrentTab!=='undefined'&&finCurrentTab==='diario'&&
      !!document.getElementById('fin-panel-diario')?.getClientRects().length;
  }
  function redraw(){if(typeof ldFiltrar==='function')ldFiltrar();}
  function ui(){
    const selected=sourceSelect?.value==='sheet';
    const sheetOption=sourceSelect?.querySelector('option[value="sheet"]');
    if(sheetOption)sheetOption.disabled=!connected;
    if(!connected&&selected&&!editingId)sourceSelect.value='journal';
    if(sourceHint)sourceHint.textContent=editingId?
      'Editando un movimiento individual de Google Sheets. Guardar actualiza solo este registro.':
      sourceSelect?.value==='sheet'?
      'Cada registro se guarda por separado en MOVIMIENTOS, incluso si hay varios ingresos o egresos el mismo día.':
      'El Libro Diario conserva sus registros internos. Selecciona Google Sheets para sincronizar un movimiento individual.';
    if(cancelButton)cancelButton.hidden=!editingId;
  }
  function normalizedEntry(values,row){
    const v=Array.from({length:11},(_,i)=>values[i]??'');
    const [id,fecha,tipo,categoria,descripcion,rawAmount,metodo,referencia,contraparte,estado]=v;
    if(!id&&!fecha&&!tipo&&!descripcion)return null;
    if(!safeId(String(id))||!validDate(String(fecha))||!['ingreso','gasto'].includes(tipo)||
       !['Activo','Eliminado'].includes(estado)||!clean(descripcion)||!(amount(rawAmount)>0))
      throw new Error('La fila '+row+' de MOVIMIENTOS tiene datos inválidos. Corrígela en Drive antes de sincronizar.');
    return {row,values:v,id:String(id),fecha:String(fecha),tipo,categoria:clean(categoria),
      descripcion:clean(descripcion),monto:amount(rawAmount),metodo:clean(metodo),
      referencia:clean(referencia),contraparte:clean(contraparte),estado};
  }
  function accept(values){
    if(!rowEqual(values?.[0]?.slice(0,11),HEADER))throw new Error('Los encabezados de MOVIMIENTOS no coinciden con la integración.');
    const next=new Map();
    const visible=[];
    for(let i=1;i<values.length;i++){
      const record=normalizedEntry(values[i]||[],i+1);
      if(!record)continue;
      if(next.has(record.id))throw new Error('ID duplicado en MOVIMIENTOS: '+record.id);
      next.set(record.id,record);
      if(record.estado==='Activo')visible.push({
        id:record.id,fecha:record.fecha,tipo:record.tipo,categoria:record.categoria,
        descripcion:record.descripcion,monto:record.monto,metodo:record.metodo,
        referencia:record.referencia,contraparte:record.contraparte,_sheetSource:true
      });
    }
    return {next,visible};
  }
  async function refresh(manual=false){
    if(busy)return false;
    if(editingId){
      if(!manual)return false;
      if(!confirm('Hay una edición de Google Sheets abierta. ¿Descartarla y actualizar?'))return false;
      if(typeof ldLimpiar==='function')ldLimpiar();
    }
    if(!manual&&!connectedToken()){
      connected=false;entries=[];rawById.clear();ui();redraw();
      notice('La sesión Google expiró. Pulsa «Conectar / actualizar».',true);
      return false;
    }
    busy=true;
    if(toolbar)toolbar.querySelector('button[data-sheet-connect]').disabled=true;
    notice('Sincronizando movimientos individuales de Google Sheets…');
    try{
      const res=await read('A1:K');
      const {next,visible}=accept(res.values||[]);
      rawById.clear();next.forEach((v,k)=>rawById.set(k,v));
      entries=visible;connected=true;lastRead=Date.now();
      ui();redraw();
      notice('Google Sheets conectado · '+visible.length+' movimientos individuales · actualizado '+new Date(lastRead).toLocaleTimeString('es-CL')+'.');
      return true;
    }catch(e){
      if(!connected){entries=[];rawById.clear();ui();redraw();}
      notice(e?.message||'Error de sincronización con Google Sheets',true);
      return false;
    }finally{
      busy=false;
      if(toolbar)toolbar.querySelector('button[data-sheet-connect]').disabled=false;
    }
  }
  function parseForm(entry){
    const result={fecha:clean(entry.fecha),tipo:entry.tipo,
      categoria:clean(entry.categoria),descripcion:clean(entry.descripcion),
      monto:Number(entry.monto),metodo:clean(entry.metodo),referencia:clean(entry.referencia),
      contraparte:clean(entry.contraparte)};
    if(!validDate(result.fecha)||!['ingreso','gasto'].includes(result.tipo)||
       !(result.monto>0)||!Number.isSafeInteger(result.monto)||result.monto>1e11)
      throw new Error('Fecha, tipo o monto inválido (usa pesos enteros positivos).');
    for(const [field,max] of [['descripcion',500],['categoria',100],['metodo',100],['referencia',200],['contraparte',200]]){
      if((field==='descripcion'&&!result[field])||result[field].length>max)
        throw new Error('El campo '+field+' es obligatorio o supera '+max+' caracteres.');
      // Keep user strings inert in Google Sheets and CSV exports.
      if(/^[=+\-@\t\r]/.test(result[field]))throw new Error('El campo '+field+' comienza con un carácter reservado para fórmulas.');
    }
    return result;
  }
  function asCells(id,entry,state='Activo'){
    return [id,entry.fecha,entry.tipo,entry.categoria,entry.descripcion,entry.monto,
      entry.metodo,entry.referencia,entry.contraparte,state,new Date().toISOString()];
  }
  function fail(e){
    notice(e?.message||'No fue posible guardar el movimiento.',true);
    return false;
  }
  async function verifyRow(id){
    const found=await read('A1:K');
    const {next,visible}=accept(found.values||[]);
    rawById.clear();next.forEach((v,k)=>rawById.set(k,v));
    entries=visible;redraw();
    return next.get(id)||null;
  }
  async function saveFromForm(entry){
    if(!connected||busy)return fail(new Error('Conecta Google Sheets antes de guardar.'));
    let parsed;try{parsed=parseForm(entry)}catch(e){return fail(e)}
    busy=true;
    if(toolbar)toolbar.querySelector('button[data-sheet-connect]').disabled=true;
    let writing=false;
    try{
      const id=editingId;
      if(id){
        const base=rawById.get(id);
        if(!base||base.estado!=='Activo')throw new Error('El movimiento seleccionado ya no está disponible.');
        const remote=await read('A'+base.row+':K'+base.row);
        const actual=normalizedEntry(remote.values?.[0]||[],base.row);
        if(!actual||!rowEqual(actual.values,base.values))
          throw new Error('Este registro cambió en Google Sheets. Actualiza para evitar sobrescribirlo.');
        const updated=asCells(id,parsed);
        writing=true;
        await api('PUT','A'+base.row+':K'+base.row,
          {range:sheetRange('A'+base.row+':K'+base.row),majorDimension:'ROWS',values:[updated]},'?valueInputOption=RAW');
        const confirmed=await verifyRow(id);
        if(!confirmed||!rowEqual(confirmed.values,updated))
          throw new Error('No se pudo verificar la edición en Drive. Revisa la fila antes de reintentar.');
        notice('Movimiento actualizado en Google Sheets.');
      }else{
        const idNew='tls-mov-'+crypto.randomUUID();
        if(rawById.has(idNew))throw new Error('ID de movimiento repetido. Recarga la planilla antes de guardar.');
        const values=asCells(idNew,parsed);
        // Append into A:K; never overwrite existing rows or reuse daily slots.
        writing=true;
        await api('POST','A1:K',
          {majorDimension:'ROWS',values:[values]},'?valueInputOption=RAW&insertDataOption=INSERT_ROWS');
        const confirmed=await verifyRow(idNew);
        if(!confirmed||!rowEqual(confirmed.values,values))
          throw new Error('No se pudo confirmar el nuevo movimiento en Drive. Comprueba la planilla antes de reintentar.');
        notice('Nuevo movimiento individual guardado y verificado en Google Sheets.');
      }
      return true;
    }catch(e){
      if(writing)notice('La operación podría haberse aplicado. Revisa la pestaña MOVIMIENTOS antes de repetirla.',true);
      return fail(e);
    }finally{busy=false;if(toolbar)toolbar.querySelector('button[data-sheet-connect]').disabled=false;}
  }
  async function remove(id){
    if(!safeId(String(id))||!connected||busy)return fail(new Error('No hay conexión activa o el ID es inválido.'));
    const base=rawById.get(id);
    if(!base||base.estado!=='Activo')return fail(new Error('El movimiento ya no está disponible.'));
    busy=true;let writing=false;
    try{
      const remote=await read('A'+base.row+':K'+base.row);
      const actual=normalizedEntry(remote.values?.[0]||[],base.row);
      if(!actual||!rowEqual(actual.values,base.values))
        throw new Error('El movimiento cambió en Drive. Actualiza antes de eliminar.');
      const mark=['Eliminado',new Date().toISOString()];
      writing=true;
      await api('PUT','J'+base.row+':K'+base.row,
        {range:sheetRange('J'+base.row+':K'+base.row),majorDimension:'ROWS',values:[mark]},'?valueInputOption=RAW');
      const after=await verifyRow(id);
      if(!after||after.estado!=='Eliminado')throw new Error('No fue posible confirmar la eliminación.');
      if(editingId===id&&typeof ldLimpiar==='function')ldLimpiar();
      notice('Movimiento archivado en Google Sheets sin borrar su historial.');
      return true;
    }catch(e){
      if(writing)notice('Verifica el estado del movimiento en Drive antes de repetir la operación.',true);
      return fail(e);
    }finally{busy=false;}
  }
  function clearEdit(){
    editingId='';
    const date=document.getElementById('ld-fecha'),tipo=document.getElementById('ld-tipo');
    if(date)date.disabled=false;if(tipo)tipo.disabled=false;
    if(sourceSelect){sourceSelect.disabled=false;sourceSelect.value='journal';}
    ui();
  }
  function edit(id){
    const item=entries.find(e=>e.id===id);
    if(!item)return fail(new Error('No se encontró el movimiento de Google Sheets.'));
    const fields={
      'ld-fecha':item.fecha,'ld-tipo':item.tipo,'ld-descripcion':item.descripcion,
      'ld-monto':String(item.monto),'ld-metodo':item.metodo||'Transferencia',
      'ld-referencia':item.referencia,'ld-contraparte':item.contraparte
    };
    for(const [key,value] of Object.entries(fields)){
      const el=document.getElementById(key);if(el)el.value=value;
    }
    if(typeof ldSwitchTipo==='function')ldSwitchTipo();
    const category=document.getElementById('ld-categoria');
    if(category){
      if(item.categoria&&!Array.from(category.options).some(o=>o.value===item.categoria)){
        category.add(new Option(item.categoria,item.categoria));
      }
      category.value=item.categoria;
    }
    editingId=id;
    if(sourceSelect){sourceSelect.value='sheet';sourceSelect.disabled=true;}
    ui();
    document.getElementById('ld-descripcion')?.scrollIntoView({behavior:'smooth',block:'center'});
    document.getElementById('ld-descripcion')?.focus();
    notice('Editando un movimiento individual; los cambios se guardarán en MOVIMIENTOS.');
  }
  function setup(){
    if(document.getElementById('tls-sheet-ledger-toolbar'))return;
    const table=document.getElementById('ld-tbody')?.closest('table');
    const money=document.getElementById('ld-monto');
    if(!table||!money)return;
    toolbar=document.createElement('div');toolbar.id='tls-sheet-ledger-toolbar';
    toolbar.innerHTML='<button type="button" data-sheet-connect>Conectar / actualizar Google Sheets</button>'+
      '<a target="_blank" rel="noopener noreferrer" href="'+SOURCE_URL+'">Abrir planilla</a>'+
      '<span data-sheet-status role="status" aria-live="polite">Conecta Google Sheets para visualizar todos los ingresos y egresos individuales.</span>';
    table.parentNode.insertBefore(toolbar,table);
    const block=document.createElement('div');block.id='tls-sheet-destination';
    block.innerHTML='<label for="tls-sheet-source">Guardar movimiento en:</label>'+
      '<select id="tls-sheet-source"><option value="journal">Libro Diario · registro interno</option>'+
      '<option value="sheet" disabled>Google Sheets · movimientos individuales</option></select>'+
      '<small data-sheet-hint></small>'+
      '<button type="button" data-sheet-cancel hidden>Cancelar edición de Google Sheets</button>';
    money.parentElement.insertAdjacentElement('afterend',block);
    sourceSelect=block.querySelector('#tls-sheet-source');
    sourceHint=block.querySelector('[data-sheet-hint]');
    cancelButton=block.querySelector('[data-sheet-cancel]');
    toolbar.querySelector('[data-sheet-connect]').addEventListener('click',()=>refresh(true));
    sourceSelect.addEventListener('change',ui);
    cancelButton.addEventListener('click',()=>{if(typeof ldLimpiar==='function')ldLimpiar();});
    const style=document.createElement('style');
    style.textContent=
      '#tls-sheet-ledger-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 14px;margin:12px 0;background:#102326;border:1px solid #265457;border-radius:10px;color:#ebf8f8;font-size:12px}'+
      '#tls-sheet-ledger-toolbar button{border:1px solid #00bbb6;border-radius:7px;background:#00c7c0;color:#052525;padding:7px 12px;cursor:pointer;font-weight:700}'+
      '#tls-sheet-ledger-toolbar button:disabled{opacity:.6;cursor:progress}'+
      '#tls-sheet-ledger-toolbar a{color:#74e4df;text-decoration:underline}'+
      '#tls-sheet-ledger-toolbar [data-sheet-status]{color:#a5c9ca;flex:1;min-width:230px}'+
      '#tls-sheet-destination{padding:9px 11px;margin:8px 0;background:#13282b;border:1px solid #285359;border-radius:9px;color:#e4f5f5;max-width:550px}'+
      '#tls-sheet-destination select{display:block;width:100%;max-width:360px;margin:5px 0;padding:6px;background:#0a1719;color:#e4f5f5;border:1px solid #3b7276;border-radius:6px}'+
      '#tls-sheet-destination small{display:block;color:#a9c9c9;line-height:1.5}'+
      '#tls-sheet-destination button{border:1px solid #6baead;background:#172a30;color:#e4f5f5;border-radius:6px;margin-top:7px;padding:5px 10px}'+
      '#tls-sheet-ledger-toolbar button:focus-visible,#tls-sheet-destination select:focus-visible,#tls-sheet-destination button:focus-visible{outline:2px solid #89f6ed;outline-offset:2px}';
    document.head.appendChild(style);
    ui();
    document.getElementById('fin-nav-diario')?.addEventListener('click',()=>{if(connected&&connectedToken()&&!busy)refresh(false);});
    window.setInterval(()=>{if(inView()&&connected&&!busy)refresh(false);},REFRESH_MS);
    document.addEventListener('visibilitychange',()=>{if(inView()&&connected&&Date.now()-lastRead>REFRESH_MS)refresh(false);});
  }
  window.TLSFinanceSheets={
    getEntries:()=>entries.map(e=>({...e})),isSelected:()=>sourceSelect?.value==='sheet',
    saveFromForm,remove,edit,clearEdit,refresh,isConnected:()=>connected
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});
  else setup();
})();