/* js/drive.js — módulo extraído de index.html (carga en el mismo punto). */
// ── Google Drive Integration ────────────────────────────────
let _driveTokenClient=null;
let _driveAccessToken=null;
let _driveTokenExpiry=0;

function _driveGetClientId(){return localStorage.getItem('google_drive_client_id')||_DEFAULTS.GOOGLE_CLIENT_ID;}

function _driveGetToken(){
  return new Promise((resolve,reject)=>{
    if(_driveAccessToken&&Date.now()<_driveTokenExpiry-60000){resolve(_driveAccessToken);return;}
    const clientId=_driveGetClientId();
    if(!clientId){reject(new Error('Configura el Google Drive Client ID en ⚙️ Mi cuenta'));return;}
    if(typeof google==='undefined'||!google.accounts){reject(new Error('SDK de Google no cargado aún, intenta en unos segundos'));return;}
    if(!_driveTokenClient){
      _driveTokenClient=google.accounts.oauth2.initTokenClient({
        client_id:clientId,
        scope:'https://www.googleapis.com/auth/drive',
        callback:(resp)=>{
          if(resp.error){reject(new Error('OAuth: '+resp.error));return;}
          _driveAccessToken=resp.access_token;
          _driveTokenExpiry=Date.now()+(resp.expires_in||3600)*1000;
          resolve(_driveAccessToken);
        }
      });
    }
    _driveTokenClient.requestAccessToken({prompt:_driveAccessToken?'':'select_account'});
  });
}

async function _driveApiFetch(url,opts={}){
  const token=await _driveGetToken();
  const hdrs={'Authorization':'Bearer '+token,...(opts.headers||{})};
  const r=await fetch(url,{...opts,headers:hdrs});
  if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error((e.error?.message)||r.statusText);}
  return r.json();
}

async function _driveGetOrCreateFolder(name,parentId){
  const safe=name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,100);
  const q=`name='${safe.replace(/'/g,"\\'")}' and mimeType='application/vnd.google-apps.folder'${parentId?" and '"+parentId+"' in parents":""} and trashed=false`;
  const search=await _driveApiFetch('https://www.googleapis.com/drive/v3/files?q='+encodeURIComponent(q)+'&fields=files(id)&orderBy=createdTime&pageSize=1');
  if(search.files?.length) return search.files[0].id;
  const meta={name:safe,mimeType:'application/vnd.google-apps.folder'};
  if(parentId) meta.parents=[parentId];
  const created=await _driveApiFetch('https://www.googleapis.com/drive/v3/files?fields=id',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(meta)
  });
  return created.id;
}

async function _driveUploadDataUrl(filename,dataUrl,folderId){
  const token=await _driveGetToken();
  const res=await fetch(dataUrl);const blob=await res.blob();
  const meta={name:filename};if(folderId) meta.parents=[folderId];
  const form=new FormData();
  form.append('metadata',new Blob([JSON.stringify(meta)],{type:'application/json'}));
  form.append('file',blob,filename);
  const r=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',{
    method:'POST',headers:{'Authorization':'Bearer '+token},body:form
  });
  if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error((e.error?.message)||r.statusText);}
  return r.json();
}

async function _driveUploadText(filename,content,mimeType,folderId){
  const token=await _driveGetToken();
  const meta={name:filename};if(folderId) meta.parents=[folderId];
  const form=new FormData();
  form.append('metadata',new Blob([JSON.stringify(meta)],{type:'application/json'}));
  form.append('file',new Blob([content],{type:mimeType}),filename);
  const r=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',{
    method:'POST',headers:{'Authorization':'Bearer '+token},body:form
  });
  if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error((e.error?.message)||r.statusText);}
  return r.json();
}

async function _fichaHTMLtoPdfBlob(htmlDoc){
  return new Promise(async(resolve,reject)=>{
    const iframe=document.createElement('iframe');
    iframe.style.cssText='position:fixed;top:-99999px;left:-99999px;width:794px;height:1123px;border:none;visibility:hidden;';
    document.body.appendChild(iframe);
    try{
      iframe.contentDocument.open();
      iframe.contentDocument.write(htmlDoc);
      iframe.contentDocument.close();
      // wait for images inside the iframe
      await new Promise(r=>{
        const imgs=[...iframe.contentDocument.querySelectorAll('img')];
        if(!imgs.length){r();return;}
        let done=0;const check=()=>{if(++done>=imgs.length) r();};
        imgs.forEach(img=>{if(img.complete) check();else{img.onload=check;img.onerror=check;}});
        setTimeout(r,4000);
      });
      const blob=await html2pdf().set({
        margin:0,
        image:{type:'jpeg',quality:0.93},
        html2canvas:{scale:2,useCORS:true,allowTaint:true,logging:false,backgroundColor:'#ffffff'},
        jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}
      }).from(iframe.contentDocument.body).outputPdf('blob');
      resolve(blob);
    }catch(e){reject(e);}finally{document.body.removeChild(iframe);}
  });
}

async function subirFactura(pedidoId){
  const p=state.pedidosById[pedidoId];if(!p) return;
  const f=p.fields;
  const nPedido=f['N° Pedido']||pedidoId;
  const btn=document.querySelector(`[onclick="subirFactura('${pedidoId}')"]`);
  if(btn){btn.disabled=true;btn.textContent='⏳ Autorizando...';}
  let token;
  try{
    token=await _driveGetToken();
  }catch(e){
    if(btn){btn.disabled=false;btn.textContent='🧾 Subir';}
    toast('Error autorizando Drive: '+e.message,'error');
    return;
  }
  // Token OK — ahora abrir selector de archivo
  const input=document.createElement('input');
  input.type='file';input.accept='application/pdf,image/*';
  input.style.display='none';
  document.body.appendChild(input);
  input.onchange=async()=>{
    const file=input.files[0];
    document.body.removeChild(input);
    if(!file){if(btn){btn.disabled=false;btn.textContent='🧾 Subir';}return;}
    if(btn) btn.textContent='⏳ Subiendo...';
    try{
      const rootId=await _driveGetOrCreateFolder('Facturas');
      const folderId=await _driveGetOrCreateFolder(nPedido,rootId);
      const meta={name:file.name,parents:[folderId]};
      const form=new FormData();
      form.append('metadata',new Blob([JSON.stringify(meta)],{type:'application/json'}));
      form.append('file',file,file.name);
      const r=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',{
        method:'POST',headers:{'Authorization':'Bearer '+token},body:form
      });
      if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error?.message||r.statusText);}
      const result=await r.json();
      const link=result.webViewLink;
      localStorage.setItem('factura_drive_'+pedidoId,link);
      try{await airtableWrite('Pedidos','PATCH',pedidoId,{'Factura URL':link});}catch(e){}
      if(p) p.fields['Factura URL']=link;
      renderPedidos();
      toast('✅ Factura subida — <a href="'+escapeHtml(link)+'" target="_blank" style="color:var(--accent)">Ver en Drive</a>','success');
    }catch(e){
      if(btn){btn.disabled=false;btn.textContent='🧾 Subir';}
      toast('Error subiendo factura: '+e.message,'error');
    }
  };
  input.oncancel=()=>{document.body.removeChild(input);if(btn){btn.disabled=false;btn.textContent='🧾 Subir';}};
  input.click();
}

async function guardarFichaEnDrive(cotId){
  const cot=state.cotizacionesById[cotId];if(!cot) return;
  const f=cot.fields;
  const numCot=f['N° Cotización']||cotId;
  const clienteNombre=(resolveClienteName(f['Cliente'])||'Sin_Contacto').replace(/[<>:"/\\|?*]/g,'_');
  const btn=document.getElementById('fpDriveBtn');
  const setDriveStatus=msg=>{if(btn){btn.textContent=msg;btn.disabled=true;}};

  try{
    setDriveStatus('🔐 Autenticando...');
    await _driveGetToken();

    setDriveStatus('📁 Creando carpetas...');
    const rootId=await _driveGetOrCreateFolder('The Lab Solutions',null);
    const contactoId=await _driveGetOrCreateFolder(clienteNombre,rootId);
    const cotFolderId=await _driveGetOrCreateFolder('COT-'+numCot,contactoId);

    let uploadedCount=0;
    // Fotos del producto (raw)
    for(let i=0;i<_fpItems.length;i++){
      if(_fpRawImages[i]?.dataUrl){
        setDriveStatus('⬆️ Foto producto '+(i+1)+'...');
        await _driveUploadDataUrl('foto_producto_'+(i+1)+'.jpg',_fpRawImages[i].dataUrl,cotFolderId);
        uploadedCount++;
      }
    }
    // Vistas generadas
    const vistaMap={imgFrontal:'frontal',imgIsometrica:'isometrica',imgAerea:'lateral'};
    for(let i=0;i<_fpItems.length;i++){
      for(const[campo,nombre]of Object.entries(vistaMap)){
        if(_fpItems[i][campo]){
          setDriveStatus('⬆️ Vista '+nombre+' muestra '+(i+1)+'...');
          await _driveUploadDataUrl('muestra_'+(i+1)+'_'+nombre+'.png',_fpItems[i][campo],cotFolderId);
          uploadedCount++;
        }
      }
    }
    // Ficha propuesta → PDF
    const docResult=buildFichaPropuestaDoc(cotId);
    if(docResult?.html){
      setDriveStatus('📄 Generando PDF de ficha...');
      try{
        const pdfBlob=await _fichaHTMLtoPdfBlob(docResult.html);
        setDriveStatus('⬆️ Subiendo ficha PDF...');
        const token=await _driveGetToken();
        const meta={name:'ficha_propuesta_'+numCot+'.pdf'};if(cotFolderId) meta.parents=[cotFolderId];
        const form=new FormData();
        form.append('metadata',new Blob([JSON.stringify(meta)],{type:'application/json'}));
        form.append('file',pdfBlob,'ficha_propuesta_'+numCot+'.pdf');
        const r=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{
          method:'POST',headers:{'Authorization':'Bearer '+token},body:form
        });
        if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error?.message||r.statusText);}
        uploadedCount++;
      }catch(pdfErr){
        console.warn('[Drive PDF]',pdfErr);
        setDriveStatus('⬆️ Subiendo ficha (HTML fallback)...');
        await _driveUploadText('ficha_propuesta_'+numCot+'.html',docResult.html,'text/html',cotFolderId);
        uploadedCount++;
      }
    }
    // Guardar link de carpeta
    const folderLink='https://drive.google.com/drive/folders/'+cotFolderId;
    localStorage.setItem('fp_drive_folder_'+cotId,folderLink);

    toast('✅ '+uploadedCount+' archivos guardados en Drive','success');
    setDriveStatus('✅ Guardado en Drive');
    if(btn){
      btn.disabled=false;
      btn.onclick=()=>window.open(folderLink,'_blank');
      btn.textContent='📂 Ver en Drive';
    }
  }catch(err){
    console.error('[Drive]',err);
    toast('Error Drive: '+err.message,'error');
    if(btn){btn.disabled=false;btn.textContent='📁 Guardar en Drive';}
  }
}
// ────────────────────────────────────────────────────────────
// Carpetas Drive (no interactivas) + visor de adjuntos en el panel
// ────────────────────────────────────────────────────────────
function _driveFolderIdFromLink(link){const m=(link||'').match(/\/folders\/([A-Za-z0-9_-]+)/);return m?m[1]:'';}

// Crea/actualiza Cliente → COT-xxx en Drive y guarda el link. No abre ventana.
async function ensureCotFolder(cotId,numCot,clienteNombre){
  const rootId=await _driveGetOrCreateFolder('The Lab Solutions',null);
  const cliId=await _driveGetOrCreateFolder(clienteNombre||'Cliente',rootId);
  const foldId=await _driveGetOrCreateFolder('COT-'+(numCot||(cotId||'').slice(-6)),cliId);
  localStorage.setItem('fp_drive_folder_'+cotId,'https://drive.google.com/drive/folders/'+foldId);
  return foldId;
}
// Resuelve (creando si hace falta) la carpeta de un pedido y devuelve su folderId.
async function ensurePedidoFolder(pedidoId){
  const p=state.pedidosById[pedidoId];if(!p) return null;
  const f=p.fields;const cotIds=f['Cotizaciones'];
  if(cotIds&&cotIds.length){
    const cot=state.cotizacionesById[cotIds[0]];
    const numCot=cot?.fields['N° Cotización']||'';
    const cliente=resolveClienteName(cot?.fields['Cliente']||f['Cliente']);
    return await ensureCotFolder(cotIds[0],numCot,cliente);
  }
  const rootId=await _driveGetOrCreateFolder('The Lab Solutions',null);
  const cliId=await _driveGetOrCreateFolder(resolveClienteName(f['Cliente'])||'Cliente',rootId);
  const foldId=await _driveGetOrCreateFolder(f['N° Pedido']||pedidoId.slice(-6),cliId);
  localStorage.setItem('fp_drive_folder_ped_'+pedidoId,'https://drive.google.com/drive/folders/'+foldId);
  return foldId;
}
// Lista los archivos de una carpeta (excluye subcarpetas en el render).
async function _driveListFiles(folderId){
  const q=`'${folderId}' in parents and trashed=false`;
  const res=await _driveApiFetch('https://www.googleapis.com/drive/v3/files?q='+encodeURIComponent(q)+'&orderBy=folder,modifiedTime desc&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=200');
  return res.files||[];
}
// Descarga el contenido binario (sirve para archivos subidos por la app).
async function _driveFetchBlob(fileId){
  const token=await _driveGetToken();
  const r=await fetch('https://www.googleapis.com/drive/v3/files/'+fileId+'?alt=media',{headers:{'Authorization':'Bearer '+token}});
  if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error((e.error?.message)||('HTTP '+r.status));}
  return await r.blob();
}
// Sube un File/Blob a una carpeta (multipart).
async function _driveUploadFile(fileOrBlob,folderId,name){
  const token=await _driveGetToken();
  const filename=name||fileOrBlob.name||'archivo';
  const meta={name:filename};if(folderId) meta.parents=[folderId];
  const form=new FormData();
  form.append('metadata',new Blob([JSON.stringify(meta)],{type:'application/json'}));
  form.append('file',fileOrBlob,filename);
  const r=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Authorization':'Bearer '+token},body:form});
  if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error((e.error?.message)||r.statusText);}
  return r.json();
}
// Elimina un archivo de Drive.
async function _driveDeleteFile(fileId){
  const token=await _driveGetToken();
  const r=await fetch('https://www.googleapis.com/drive/v3/files/'+fileId,{method:'DELETE',headers:{'Authorization':'Bearer '+token}});
  if(!r.ok&&r.status!==204){const e=await r.json().catch(()=>({}));throw new Error((e.error?.message)||r.statusText);}
}
// Crea o reemplaza (por nombre, en la carpeta) un archivo. Evita duplicados.
async function _driveUpsertFile(folderId,filename,blob,mimeType){
  const token=await _driveGetToken();
  const q=`name='${filename.replace(/'/g,"\\'")}' and '${folderId}' in parents and trashed=false`;
  const search=await _driveApiFetch('https://www.googleapis.com/drive/v3/files?q='+encodeURIComponent(q)+'&fields=files(id)&pageSize=1');
  if(search.files&&search.files.length){
    const id=search.files[0].id;
    const r=await fetch('https://www.googleapis.com/upload/drive/v3/files/'+id+'?uploadType=media&fields=id',{method:'PATCH',headers:{'Authorization':'Bearer '+token,'Content-Type':mimeType},body:blob});
    if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error((e.error?.message)||r.statusText);}
    return r.json();
  }
  return _driveUploadFile(blob,folderId,filename);
}
// Genera/actualiza el PDF (o HTML) de la cotización en su carpeta de Drive.
// Solo si ya hay sesión de Drive activa (evita popups bloqueados al guardar).
async function syncCotizacionADrive(cotId){
  if(!_driveConnected()) return;
  try{
    const res=buildCotizacionDoc(cotId);if(!res) return;
    const f=res.c.fields;
    const numCot=f['N° Cotización']||cotId.slice(-6);
    const cliente=resolveClienteName(f['Cliente']);
    const folderId=await ensureCotFolder(cotId,numCot,cliente);
    let filename='Cotización '+numCot+'.pdf',blob,mime='application/pdf';
    try{blob=await _fichaHTMLtoPdfBlob(res.html);}
    catch(e){blob=new Blob([res.html],{type:'text/html;charset=utf-8'});mime='text/html';filename='Cotización '+numCot+'.html';}
    await _driveUpsertFile(folderId,filename,blob,mime);
    toast('📂 Cotización guardada en Drive','success');
  }catch(e){console.warn('Drive cotización:',e);}
}

// ── Modal "Ver adjuntos" ──────────────────────────────────────
let _adjFiles=[],_adjUrl=null,_adjFolderId=null;
function _adjIcon(m){if(/^image\//.test(m))return'🖼️';if(m==='application/pdf')return'📄';if(/^video\//.test(m))return'🎬';if(/sheet|excel|csv/.test(m))return'📊';if(/word|document/.test(m))return'📝';if(/zip|compressed|rar/.test(m))return'🗜️';if(m==='application/vnd.google-apps.folder')return'📁';return'📎';}
function _fmtBytes(n){if(!n)return'';const u=['B','KB','MB','GB'];let i=0;n=+n;while(n>=1024&&i<u.length-1){n/=1024;i++;}return n.toFixed(i?1:0)+' '+u[i];}
async function openAdjuntosModal(kind,id){
  const modal=document.getElementById('adjuntosModal');
  const body=document.getElementById('adjuntosBody');
  const titleEl=document.getElementById('adjuntosTitle');
  let label='Adjuntos';
  if(kind==='ped'){const p=state.pedidosById[id];label='Adjuntos — '+(p?.fields['N° Pedido']||'Pedido');}
  titleEl.textContent=label;
  modal.style.display='flex';
  if(_adjUrl){URL.revokeObjectURL(_adjUrl);_adjUrl=null;}
  body.innerHTML='<div style="padding:34px;text-align:center;color:var(--text3);font-size:13px">Conectando con Google Drive…</div>';
  if(!_driveGetClientId()){body.innerHTML='<div style="padding:26px;text-align:center;color:var(--text3);font-size:13px">Configura el <b>Google Drive Client ID</b> en ⚙️ Mi cuenta para ver los adjuntos.</div>';return;}
  try{
    const folderId=kind==='ped'?await ensurePedidoFolder(id):null;
    _adjFolderId=folderId;
    const files=(await _driveListFiles(folderId)).filter(f=>f.mimeType!=='application/vnd.google-apps.folder');
    _adjFiles=files;
    _renderAdjuntosBody(files);
    _refreshDriveBtns();
  }catch(e){
    const msg=escapeHtml(e.message||'error');
    body.innerHTML='<div style="padding:24px;text-align:center;color:var(--danger);font-size:13px">No se pudieron cargar los adjuntos.<br><span style="font-size:11px;color:var(--text3)">'+msg+'</span></div>';
  }
}
function _renderAdjuntosBody(files){
  const body=document.getElementById('adjuntosBody');
  const rows=files.length?files.map(f=>{
    const canPrev=/^image\//.test(f.mimeType)||f.mimeType==='application/pdf'||/^text\//.test(f.mimeType);
    const sub=[_fmtBytes(f.size),f.modifiedTime?_DTF_DMY.format(new Date(f.modifiedTime)):''].filter(Boolean).join(' · ');
    return`<div style="display:flex;align-items:center;gap:8px;padding:9px 11px;background:var(--surface2);border:1px solid var(--border2);border-radius:9px">
      <span style="font-size:18px;flex-shrink:0">${_adjIcon(f.mimeType)}</span>
      <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.name)}</div><div style="font-size:10px;color:var(--text3)">${sub}</div></div>
      ${canPrev?`<button class="btn btn-ghost btn-sm" style="flex-shrink:0" onclick="previewAdjunto('${f.id}')">👁 Ver</button>`:''}
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0" onclick="downloadAdjunto('${f.id}')" title="Descargar">⬇</button>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0;color:var(--danger)" onclick="deleteAdjunto('${f.id}')" title="Eliminar">🗑</button>
    </div>`;
  }).join(''):'<div style="padding:26px;text-align:center;color:var(--text3);font-size:13px">📭 Esta carpeta de Drive está vacía.<br><span style="font-size:11px">Sube un archivo con el botón de arriba.</span></div>';
  const uploader=`<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><input type="file" id="adjFileInput" style="display:none" onchange="subirAdjunto(this)"><button class="btn btn-primary btn-sm" onclick="document.getElementById('adjFileInput').click()">⬆ Subir archivo</button></div>`;
  body.innerHTML=uploader+`<div style="display:flex;flex-direction:column;gap:6px">${rows}</div><div id="adjuntosPreview" style="display:none;margin-top:14px;border-top:1px solid var(--border2);padding-top:12px"></div>`;
}
async function _adjReload(){
  if(!_adjFolderId) return;
  const files=(await _driveListFiles(_adjFolderId)).filter(f=>f.mimeType!=='application/vnd.google-apps.folder');
  _adjFiles=files;_renderAdjuntosBody(files);
}
async function subirAdjunto(input){
  const file=input.files&&input.files[0];if(!file) return;input.value='';
  if(!_adjFolderId){toast('La carpeta aún no está lista','error');return;}
  try{
    toast('Subiendo '+file.name+'…','info');
    await _driveUploadFile(file,_adjFolderId);
    toast('✓ Archivo subido','success');
    await _adjReload();
  }catch(e){toast('Error al subir: '+(e.message||''),'error');}
}
async function deleteAdjunto(fileId){
  const f=_adjFiles.find(x=>x.id===fileId);if(!f) return;
  if(!confirm('¿Eliminar "'+f.name+'" de Drive? Esta acción no se puede deshacer.')) return;
  try{
    toast('Eliminando…','info');
    await _driveDeleteFile(fileId);
    toast('✓ Archivo eliminado','success');
    closeAdjPreview();
    await _adjReload();
  }catch(e){toast('Error al eliminar: '+(e.message||''),'error');}
}
async function previewAdjunto(fileId){
  const f=_adjFiles.find(x=>x.id===fileId);if(!f) return;
  const pv=document.getElementById('adjuntosPreview');if(!pv) return;
  pv.style.display='block';pv.scrollIntoView({behavior:'smooth',block:'nearest'});
  pv.innerHTML='<div style="padding:18px;color:var(--text3);font-size:12px">Cargando vista previa…</div>';
  try{
    const blob=await _driveFetchBlob(fileId);
    if(_adjUrl) URL.revokeObjectURL(_adjUrl);
    _adjUrl=URL.createObjectURL(blob);
    let inner;
    if(/^image\//.test(f.mimeType)) inner=`<img loading="lazy" decoding="async" src="${_adjUrl}" style="max-width:100%;max-height:68vh;display:block;margin:0 auto;border-radius:8px">`;
    else if(f.mimeType==='application/pdf') inner=`<iframe src="${_adjUrl}" style="width:100%;height:68vh;border:none;border-radius:8px;background:#fff"></iframe>`;
    else if(/^text\//.test(f.mimeType)){const txt=await blob.text();inner=`<pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.5;max-height:60vh;overflow:auto;background:var(--surface2);padding:12px;border-radius:8px">${escapeHtml(txt)}</pre>`;}
    else inner='<div style="padding:18px;color:var(--text3);font-size:12px">No se puede previsualizar este tipo de archivo. Usa Descargar.</div>';
    pv.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px"><span style="font-size:12px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.name)}</span><button class="btn btn-ghost btn-sm" style="flex-shrink:0" onclick="closeAdjPreview()">✕ Cerrar vista</button></div>${inner}`;
  }catch(e){pv.innerHTML='<div style="padding:18px;color:var(--danger);font-size:12px">Error al previsualizar: '+escapeHtml(e.message||'')+'</div>';}
}
function closeAdjPreview(){const pv=document.getElementById('adjuntosPreview');if(pv){pv.style.display='none';pv.innerHTML='';}if(_adjUrl){URL.revokeObjectURL(_adjUrl);_adjUrl=null;}}
async function downloadAdjunto(fileId){
  const f=_adjFiles.find(x=>x.id===fileId);if(!f) return;
  try{
    toast('Descargando '+f.name+'…','info');
    const blob=await _driveFetchBlob(fileId);
    const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=f.name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(u),5000);
  }catch(e){toast('Error al descargar: '+(e.message||''),'error');}
}
function closeAdjuntosModal(){const m=document.getElementById('adjuntosModal');if(m) m.style.display='none';if(_adjUrl){URL.revokeObjectURL(_adjUrl);_adjUrl=null;}_adjFiles=[];}
// ────────────────────────────────────────────────────────────
async function openDriveFolder(cotId,numCot,clienteNombre){
  const existing=localStorage.getItem('fp_drive_folder_'+cotId);
  if(existing){window.open(existing,'_blank');return;}
  if(!confirm('No hay carpeta Drive para esta cotización.\n¿Crear ahora?')) return;
  try{
    toast('Creando carpeta en Drive...','info');
    const rootId=await _driveGetOrCreateFolder('The Lab Solutions',null);
    const cliId=await _driveGetOrCreateFolder(clienteNombre||'Cliente',rootId);
    const foldId=await _driveGetOrCreateFolder('COT-'+numCot,cliId);
    const link='https://drive.google.com/drive/folders/'+foldId;
    localStorage.setItem('fp_drive_folder_'+cotId,link);
    window.open(link,'_blank');
    toast('📂 Carpeta creada en Drive ✓','success');
    renderCotizaciones();renderPedidos();
  }catch(e){toast('Error Drive: '+e.message,'error');}
}
async function openPedidoDrive(pedidoId){
  const p=state.pedidosById[pedidoId];if(!p) return;
  const f=p.fields;
  const cotIds=f['Cotizaciones'];
  if(cotIds&&cotIds.length){
    const cot=state.cotizacionesById[cotIds[0]];
    const numCot=cot?.fields['N° Cotización']||'';
    const cliente=resolveClienteName(cot?.fields['Cliente']||f['Cliente']);
    await openDriveFolder(cotIds[0],numCot,cliente);
  }else{
    const key='fp_drive_folder_ped_'+pedidoId;
    const existing=localStorage.getItem(key);
    if(existing){window.open(existing,'_blank');return;}
    if(!confirm('No hay carpeta Drive para este pedido.\n¿Crear ahora?')) return;
    try{
      toast('Creando carpeta en Drive...','info');
      const rootId=await _driveGetOrCreateFolder('The Lab Solutions',null);
      const cliId=await _driveGetOrCreateFolder(resolveClienteName(f['Cliente'])||'Cliente',rootId);
      const foldId=await _driveGetOrCreateFolder(f['N° Pedido']||pedidoId.slice(-6),cliId);
      const link='https://drive.google.com/drive/folders/'+foldId;
      localStorage.setItem(key,link);
      window.open(link,'_blank');
      toast('📂 Carpeta creada ✓','success');
      renderPedidos();
    }catch(e){toast('Error Drive: '+e.message,'error');}
  }
}