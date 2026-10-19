/* Módulo Catálogos — PDF compartidos, vista integrada y permisos firmados. */
(function(root){
  'use strict';
  const $=id=>document.getElementById(id);
  const CATS=['General','Merchandising','Impresión 3D','POP y exhibidores','Señalética','Premiación','Papelería','Otros'];
  const state={items:[],cursor:null,role:'',loading:false,uploading:false,file:null,previewUrl:null,lastFetch:0};
  function text(node,value){if(node)node.textContent=String(value??'');}
  function showMessage(message,error=false){
    const n=$('catalogosStatus');if(!n)return;
    n.textContent=message||'';n.className='cat-status'+(error?' cat-error':'');
    n.hidden=!message;
  }
  function currentUser(){
    try{return typeof AUTH!=='undefined'&&AUTH.getUser?AUTH.getUser():null;}catch(_){return null;}
  }
  function proxy(){
    const px=typeof _proxyCfg==='function'?_proxyCfg():null;
    if(!px?.url||!px.access)throw Error('Catálogos requiere Cloudflare Access activo en el Proxy Worker.');
    return px;
  }
  async function request(method,path='',opts={}){
    const px=proxy();
    const url=px.url+path;
    const response=await fetch(url,{
      method,credentials:'include',cache:'no-store',...opts,
      headers:{...(opts.headers||{})}
    });
    if(!response.ok){
      const body=await response.json().catch(()=>null);
      const err=Error(body?.error||'Error de conexión ('+response.status+')');
      err.status=response.status;throw err;
    }
    return response;
  }
  function canUpload(){return ['admin','operator','finance','sales'].includes(state.role);}
  function canDelete(){return state.role==='admin';}
  function fmtSize(n){return n>=1048576?(n/1048576).toLocaleString('es-CL',{maximumFractionDigits:1})+' MB':Math.max(1,Math.round(n/1024))+' KB';}
  function fmtDate(raw){
    const d=new Date(raw);return Number.isFinite(d.getTime())?d.toLocaleDateString('es-CL',{day:'2-digit',month:'short',year:'numeric'}):'Sin fecha';
  }
  function clearPreview(){
    if(state.previewUrl){URL.revokeObjectURL(state.previewUrl);state.previewUrl=null;}
    const frame=$('catPreviewFrame');if(frame)frame.removeAttribute('src');
    const open=$('catOpenPreview');if(open)open.disabled=true;
  }
  function closePreview(){
    const d=$('catalogosPreview');if(d?.open)d.close();clearPreview();
  }
  async function openPreview(id){
    const item=state.items.find(x=>x.id===id);if(!item)return;
    clearPreview();
    const modal=$('catalogosPreview');
    text($('catPreviewTitle'),item.name);
    text($('catPreviewMeta'),item.category+' · '+fmtSize(item.size));
    const frame=$('catPreviewFrame');
    if(modal&&!modal.open)modal.showModal();
    text($('catPreviewLoading'),'Cargando PDF protegido…');
    try{
      const res=await request('GET','/catalogos/'+encodeURIComponent(id));
      const blob=await res.blob();
      if(!modal?.open)return;
      if(blob.type!=='application/pdf'||!blob.size)throw Error('El documento recibido no es un PDF.');
      state.previewUrl=URL.createObjectURL(blob);
      frame.src=state.previewUrl;
      $('catOpenPreview').disabled=false;
      text($('catPreviewLoading'),'');
    }catch(e){text($('catPreviewLoading'),e.message||'No se pudo abrir el documento.');}
  }
  function downloadPreview(){
    if(!state.previewUrl)return;
    const a=document.createElement('a');a.href=state.previewUrl;
    a.download=String($('catPreviewTitle')?.textContent||'catalogo.pdf');
    document.body.appendChild(a);a.click();a.remove();
  }
  function setBusy(stateBusy){
    state.loading=!!stateBusy;
    const b=$('catReload');if(b)b.disabled=state.loading;
    const more=$('catMore');if(more)more.disabled=state.loading;
  }
  function filtered(){
    const q=String($('catSearch')?.value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
    const cat=$('catFilter')?.value||'all';
    return state.items.filter(x=>(cat==='all'||x.category===cat)&&
      (!q||(x.name+' '+x.category+' '+x.uploadedBy).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(q)))
      .sort((a,b)=>String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
  }
  function render(){
    const target=$('catGrid');if(!target)return;
    target.replaceChildren();
    const visible=filtered();
    text($('catTotal'),state.items.length+' '+(state.items.length===1?'catálogo':'catálogos'));
    text($('catShown'),visible.length+' mostrados');
    $('catMore').hidden=!state.cursor;
    if(!visible.length){
      const empty=document.createElement('div');empty.className='cat-empty';
      empty.innerHTML='<div class="cat-empty-icon">▤</div><h3>Sin catálogos</h3><p>Prueba otro filtro o sube el primer documento PDF.</p>';
      target.appendChild(empty);return;
    }
    for(const item of visible){
      const card=document.createElement('article');card.className='cat-tile';
      const top=document.createElement('div');top.className='cat-tile-top';
      const graphic=document.createElement('span');graphic.className='cat-pdf-icon';graphic.textContent='PDF';
      const tag=document.createElement('span');tag.className='cat-kind';text(tag,item.category);
      top.append(graphic,tag);
      const title=document.createElement('h3');title.className='cat-name';text(title,item.name);
      const details=document.createElement('p');details.className='cat-detail';
      text(details,fmtSize(item.size)+' · '+fmtDate(item.uploadedAt));
      const actions=document.createElement('div');actions.className='cat-tile-actions';
      const view=document.createElement('button');view.type='button';view.className='btn btn-primary btn-sm';
      view.textContent='Ver catálogo';view.addEventListener('click',()=>openPreview(item.id));
      actions.append(view);
      if(canDelete()){
        const del=document.createElement('button');del.type='button';del.className='btn btn-ghost btn-sm cat-danger';
        del.textContent='Eliminar';del.addEventListener('click',()=>remove(item));actions.append(del);
      }
      card.append(top,title,details,actions);target.appendChild(card);
    }
  }
  async function load(reset=true){
    if(state.loading)return;
    if(reset){state.items=[];state.cursor=null;}
    setBusy(true);showMessage('Consultando catálogos…');
    try{
      const cursor=!reset&&state.cursor?'?cursor='+encodeURIComponent(state.cursor):'';
      const res=await request('GET','/catalogos'+cursor),data=await res.json();
      const ids=new Set(state.items.map(x=>x.id));
      for(const item of data.items||[])if(!ids.has(item.id)){ids.add(item.id);state.items.push(item);}
      state.cursor=data.cursor||null;state.lastFetch=Date.now();
      showMessage('');
    }catch(e){showMessage(e.message||'No se pudo cargar el listado.',true);}
    finally{setBusy(false);render();}
  }
  function setFile(file){
    if(!file)return;
    if(!file.name.toLowerCase().endsWith('.pdf')||file.size>25*1024*1024||!file.size){
      showMessage('Selecciona un PDF de hasta 25 MB.',true);return;
    }
    state.file=file;
    $('catName').value=file.name.replace(/\.pdf$/i,'').slice(0,140);
    text($('catFileLabel'),file.name+' · '+fmtSize(file.size));
    showMessage('');
  }
  async function upload(event){
    event?.preventDefault?.();
    if(state.uploading||!canUpload())return;
    if(!state.file){showMessage('Selecciona un PDF antes de subirlo.',true);return;}
    const title=$('catName').value.trim();
    if(!title){showMessage('Indica un nombre para el catálogo.',true);return;}
    const form=new FormData();form.append('file',state.file,state.file.name);
    form.append('name',title);form.append('category',$('catCategory').value);
    state.uploading=true;$('catUploadBtn').disabled=true;
    text($('catUploadBtn'),'Subiendo PDF…');showMessage('Guardando en el repositorio compartido…');
    try{
      await request('POST','/catalogos',{body:form});
      $('catFile').value='';$('catName').value='';state.file=null;
      text($('catFileLabel'),'Arrastra aquí tu PDF o selecciónalo desde el equipo');
      showMessage('Catálogo guardado correctamente.');
      await load(true);
    }catch(e){showMessage(e.message||'Falló la carga.',true);}
    finally{state.uploading=false;$('catUploadBtn').disabled=false;text($('catUploadBtn'),'Subir catálogo');}
  }
  async function remove(item){
    if(!canDelete())return;
    if(!confirm('¿Eliminar permanentemente "'+item.name+'"? Esta acción no se puede deshacer.'))return;
    showMessage('Eliminando catálogo…');
    try{
      await request('DELETE','/catalogos/'+encodeURIComponent(item.id));
      if(state.previewUrl)closePreview();
      state.items=state.items.filter(x=>x.id!==item.id);
      showMessage('Catálogo eliminado.');render();
    }catch(e){showMessage(e.message||'No se pudo eliminar.',true);}
  }
  async function activate(){
    if(!currentUser()||root._DEMO_MODE){showMessage('Inicia sesión con una cuenta real para consultar catálogos.',true);return;}
    try{
      const response=await request('GET','/access/me'),me=await response.json();
      if(!me.enabled||!me.authenticated)throw Error('Se requiere Cloudflare Access para acceder a catálogos.');
      state.role=me.role||'';
      $('catUploadArea').hidden=!canUpload();
      if(!state.lastFetch||Date.now()-state.lastFetch>90000)await load(true);
      else render();
    }catch(e){showMessage(e.message||'No fue posible verificar los permisos.',true);}
  }
  function boot(){
    if(!$('tab-catalogos'))return;
    const select=$('catCategory');
    CATS.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;select.appendChild(o);});
    $('catFilter').add(new Option('Todas las categorías','all'));
    CATS.forEach(c=>$('catFilter').add(new Option(c,c)));
    $('catSearch').addEventListener('input',render);$('catFilter').addEventListener('change',render);
    $('catReload').addEventListener('click',()=>load(true));
    $('catMore').addEventListener('click',()=>load(false));
    $('catFile').addEventListener('change',e=>setFile(e.target.files?.[0]));
    $('catUploadForm').addEventListener('submit',upload);
    const drop=$('catDropzone');
    ['dragenter','dragover'].forEach(evt=>drop.addEventListener(evt,e=>{e.preventDefault();drop.classList.add('cat-drag');}));
    ['dragleave','drop'].forEach(evt=>drop.addEventListener(evt,e=>{e.preventDefault();drop.classList.remove('cat-drag');}));
    drop.addEventListener('drop',e=>setFile(e.dataTransfer.files?.[0]));
    $('catPreviewClose').addEventListener('click',closePreview);
    $('catalogosPreview').addEventListener('close',clearPreview);
    $('catalogosPreview').addEventListener('click',e=>{if(e.target===e.currentTarget)closePreview();});
    $('catOpenPreview').addEventListener('click',downloadPreview);
    root.addEventListener('beforeunload',clearPreview);
    // SwitchTab maneja RBAC y paneles. Este módulo solo recarga al abrir su vista.
  }
  root.TLSCatalogos={activate,load,_test:{fmtSize,fmtDate}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})(window);
