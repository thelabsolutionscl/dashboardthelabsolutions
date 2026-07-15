/* js/correo.js — módulo extraído de index.html (carga en el mismo punto). */
const MAIL={
  API:'https://mail-api.thelab.solutions/mail-api.php',
  folder:'INBOX',
  page:1,
  pages:1,
  total:0,
  msgs:[],
  selUid:null,
  composeMode:null,
  _searchTimer:null,
  _init:false,
  _currentMsg:null,
  _readSeq:0,
  _sending:false,

  // ── Cuentas de correo (multi-cuenta) ──────────────────────────────
  // El buzón activo ya no es forzosamente el usuario del dashboard: se puede
  // agregar hola@ u otras casillas y alternar entre ellas. La clave se guarda
  // por-casilla, así cada cuenta recuerda la suya. Por defecto la cuenta activa
  // es la del usuario logueado, de modo que las claves ya guardadas siguen igual.
  _acctsKey(){const u=AUTH.getUser();return u?'thelab_mail_accts_'+u.username:null;},
  _activeKey(){const u=AUTH.getUser();return u?'thelab_mail_active_'+u.username:null;},
  accounts(){
    const u=AUTH.getUser(); if(!u) return [];
    let list=[]; try{list=JSON.parse(localStorage.getItem(this._acctsKey())||'[]');}catch(e){list=[];}
    if(!Array.isArray(list)) list=[];
    if(!list.some(a=>a&&a.email===u.username)) list.unshift({email:u.username,name:u.name||''});
    // hola@ es la casilla comercial compartida: siempre disponible en el selector
    // (al elegirla por primera vez pide su clave, que queda guardada por-casilla).
    if(!list.some(a=>a&&a.email==='hola@thelab.solutions')) list.push({email:'hola@thelab.solutions',name:'The Lab Solutions'});
    return list.filter(a=>a&&a.email);
  },
  setAccounts(list){const k=this._acctsKey();if(k) localStorage.setItem(k,JSON.stringify(list));},
  activeAccount(){
    const u=AUTH.getUser(); if(!u) return null;
    const k=this._activeKey(); let a=k?localStorage.getItem(k):null;
    const list=this.accounts();
    if(!a || !list.some(x=>x.email===a)) a=u.username;
    return a;
  },
  activeAccountObj(){
    const a=this.activeAccount();
    return this.accounts().find(x=>x.email===a)||{email:a,name:(AUTH.getUser()?.name||'')};
  },

  _mailPassKey(){const a=this.activeAccount();return a?'thelab_mail_pass_'+a:null;},
  getMailPass(){const k=this._mailPassKey();return k?localStorage.getItem(k)||'':null;},
  setMailPass(p){const k=this._mailPassKey();if(k) localStorage.setItem(k,p);},
  clearMailPass(){const k=this._mailPassKey();if(k) localStorage.removeItem(k);},

  auth(){
    const o=this.activeAccountObj();
    return {
      user:o.email||'',
      pass:this.getMailPass()||'',
      from_name:o.name||''
    };
  },

  // ── FRENO DE ENVÍOS ────────────────────────────────────────────
  // Ahora el envío sale por Resend, así que ya NO hay riesgo de que el hosting
  // suspenda la casilla. El freno queda solo como red de seguridad contra
  // envíos masivos accidentales (p. ej. un bucle) y para no rozar los límites
  // de tu plan de Resend. Ventana móvil de 60 min compartida por TODOS los
  // flujos (manual, agentes IA, cobranza, reportes) y todas las casillas.
  // Tope por defecto 200/hora, ajustable con el botón 🛡.
  _SEND_LIMIT_KEY:'thelab_mail_hourly_limit',
  _SEND_LOG_KEY:'thelab_mail_send_ts',
  hourlyLimit(){const v=parseInt(localStorage.getItem(this._SEND_LIMIT_KEY));return v>0?v:200;},
  setHourlyLimit(){
    const v=prompt('Freno de envíos: máximo de correos por hora (red de seguridad contra envíos masivos accidentales).\nAhora envías por Resend, así que puedes dejarlo alto; ajústalo según el límite de tu plan de Resend.',String(this.hourlyLimit()));
    if(v===null) return;
    const n=parseInt(v);
    if(!(n>0)){toast('Debe ser un número mayor a 0','error');return;}
    localStorage.setItem(this._SEND_LIMIT_KEY,String(n));
    toast('🛡 Freno: máximo '+n+' correos/hora','success');
  },
  _sendGate(){
    try{
      const now=Date.now();
      const ts=(JSON.parse(localStorage.getItem(this._SEND_LOG_KEY)||'[]')).filter(t=>now-t<3600e3);
      const lim=this.hourlyLimit();
      if(ts.length>=lim){
        const min=Math.ceil((3600e3-(now-ts[0]))/60000);
        return {error:`🛡 Freno de envíos: ya van ${ts.length} correos en la última hora (límite ${lim}). Reintenta en ~${min} min o ajusta el límite con el botón 🛡 en Correos.`};
      }
      ts.push(now);
      localStorage.setItem(this._SEND_LOG_KEY,JSON.stringify(ts));
      return null;
    }catch(e){return null;} // el freno jamás debe romper un envío legítimo
  },

  // Traduce errores conocidos del servidor de correo a un aviso claro y accionable.
  // OJO: la suspensión de la casilla es del HOSTING, no del dashboard; esto solo
  // explica mejor el error, no reactiva el envío.
  _friendlyErr(o){
    if(o&&typeof o.error==='string'){
      const e=o.error;
      if(/suspend/i.test(e)){
        const m=e.match(/from\s*"?([^"\s]+@[^"\s]+)"?/i);
        const box=(m&&m[1])||this.activeAccount()||'esa casilla';
        o.error='📵 El hosting suspendió el ENVÍO SALIENTE de '+box+' (suele pasar al superar el tope de correos/hora del plan). No es un problema del dashboard. Qué hacer: espera un rato y reintenta, baja el tope con el botón 🛡 Freno, envía desde otra casilla, o pídele al hosting que reactive el correo saliente de esa cuenta.';
      } else if(/authenticat|535|user:|pass:/i.test(e)){
        o.error='🔑 El servidor rechazó la clave de '+(this.activeAccount()||'la casilla')+'. Revísala con el botón "Cambiar clave".';
      }
    }
    return o;
  },

  async post(params){
    if(params&&params.action==='send'){const g=this._sendGate();if(g) return g;}
    const fd=new FormData();
    const a=this.auth();
    fd.append('user',a.user); fd.append('pass',a.pass);
    for(const[k,v] of Object.entries(params)) fd.append(k,v);
    const ctrl=new AbortController();
    const timeout=setTimeout(()=>ctrl.abort(),30000);
    try{
      const r=await fetch(this.API,{method:'POST',body:fd,signal:ctrl.signal});
      const text=await r.text();
      try{return this._friendlyErr(JSON.parse(text));}
      catch(e){return{error:'Respuesta inválida del servidor ('+r.status+')'};}
    }catch(e){
      return{error:e.name==='AbortError'?'Tiempo de espera agotado':'Sin conexión con el servidor'};
    }finally{clearTimeout(timeout);}
  },

  // Envía autenticando como OTRA casilla (p.ej. hola@) usando su clave guardada
  // por-cuenta. Si esa clave no está, cae a la cuenta activa conservando el
  // from_name pedido, y avisa desde qué casilla salió realmente.
  async postAs(fromEmail,params){
    const pass=localStorage.getItem('thelab_mail_pass_'+fromEmail)||'';
    if(!pass){
      const a=this.activeAccount();
      try{toast('Enviado desde '+a+' — guarda la clave de '+fromEmail+' en Correos para enviar desde esa casilla','info');}catch(e){}
      return this.post(params);
    }
    if(params&&params.action==='send'){const g=this._sendGate();if(g) return g;}
    const fd=new FormData();
    fd.append('user',fromEmail); fd.append('pass',pass);
    for(const[k,v] of Object.entries(params)) fd.append(k,v);
    const ctrl=new AbortController();
    const timeout=setTimeout(()=>ctrl.abort(),30000);
    try{
      const r=await fetch(this.API,{method:'POST',body:fd,signal:ctrl.signal});
      const text=await r.text();
      try{return this._friendlyErr(JSON.parse(text));}
      catch(e){return{error:'Respuesta inválida del servidor ('+r.status+')'};}
    }catch(e){
      return{error:e.name==='AbortError'?'Tiempo de espera agotado':'Sin conexión con el servidor'};
    }finally{clearTimeout(timeout);}
  },

  async init(){
    this.renderAccounts();
    if(this._init) return;
    if(!this.getMailPass()){this.showPassModal();return;}
    this._init=true;
    document.getElementById('mailConnStatus').textContent='Conectando...';
    try{
      await this.loadFolders();
      await this.loadMessages();
      document.getElementById('mailConnStatus').textContent='';
      _mailPollErrors=0;
      startMailPolling();
    }catch(e){
      this._init=false;
      document.getElementById('mailConnStatus').textContent='Error de conexión';
      document.getElementById('mailList').innerHTML='<div style="padding:20px;text-align:center;color:var(--danger);font-size:13px">No se pudo conectar al servidor de correo.<br><span style="font-size:11px;color:var(--text3)">Verifica que mail-api.php esté instalado en mail-api.thelab.solutions</span></div>';
    }
  },

  showPassModal(msg){
    document.getElementById('mailPassEmail').textContent=this.activeAccount()||'';
    document.getElementById('mailPassInput').value='';
    document.getElementById('mailPassError').textContent=msg||'';
    document.getElementById('mailPassModal').style.display='flex';
    setTimeout(()=>document.getElementById('mailPassInput').focus(),100);
  },

  async confirmMailPass(){
    const p=document.getElementById('mailPassInput').value;
    if(!p) return;
    document.getElementById('mailPassModal').style.display='none';
    this.setMailPass(p);
    this._init=false;
    await this.init();
  },

  async loadFolders(){
    const data=await this.post({action:'folders'});
    if(data.error){
      if(data.error.toLowerCase().includes('auth')||data.error.toLowerCase().includes('login')){
        this.clearMailPass();this._init=false;
        this.showPassModal('Contraseña incorrecta. Inténtalo de nuevo.');
        return;
      }
      document.getElementById('mailFolderList').innerHTML=`<div style="padding:8px;font-size:11px;color:var(--danger)">${this.esc(data.error)}</div>`;return;
    }
    const folderMeta={
      inbox:     {label:'Bandeja de entrada', icon:'icon-correo'},
      sent:      {label:'Enviados',           icon:'icon-send'},
      drafts:    {label:'Borradores',         icon:'icon-file'},
      draft:     {label:'Borradores',         icon:'icon-file'},
      junk:      {label:'Spam',               icon:'icon-ban'},
      spam:      {label:'Spam',               icon:'icon-ban'},
      trash:     {label:'Papelera',           icon:'icon-trash'},
      deleted:   {label:'Eliminados',         icon:'icon-trash'},
      archive:   {label:'Archivo',            icon:'icon-folder'},
    };
    const svgIcon=id=>`<svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#${id}"/></svg>`;
    const labelFor=name=>{
      const raw=name.replace(/^INBOX\./i,'');
      const key=raw.toLowerCase();
      const match=Object.entries(folderMeta).find(([k])=>key===k||key.includes(k));
      return match?match[1]:{label:raw,icon:'icon-folder'};
    };
    const html=data.folders.map(f=>{
      const isActive=f.name===this.folder;
      const meta=labelFor(f.name);
      return `<button class="mail-folder-item${isActive?' active':''}" data-folder="${this.esc(f.name)}" onclick="MAIL.selectFolder(this.dataset.folder)">
        <span class="mail-folder-name">${svgIcon(meta.icon)} ${meta.label}</span>
        ${f.unseen>0?`<span class="mail-unseen-badge">${f.unseen}</span>`:''}
      </button>`;
    }).join('');
    document.getElementById('mailFolderList').innerHTML=html||'<div style="padding:8px;font-size:11px;color:var(--text3)">Sin carpetas</div>';
  },

  async loadMessages(folder,page){
    if(folder) this.folder=folder;
    if(page)   this.page=page;
    this._sel=new Set(); // la lista cambia → reinicia la selección múltiple
    const list=document.getElementById('mailList');
    list.innerHTML='<div class="loading-state" style="padding:30px"><div class="spinner"></div></div>';
    document.getElementById('mailFolderTitle').textContent=this.folder.replace(/^INBOX\./i,'').replace(/^INBOX$/i,'Bandeja de entrada');
    document.getElementById('mailListFooter').style.display='none';
    const data=await this.post({action:'list',folder:this.folder,page:this.page});
    if(data.error){list.innerHTML=`<div style="padding:16px;color:var(--danger);font-size:13px">${this.esc(data.error)}</div>`;return;}
    this.msgs=data.messages;
    this.pages=data.pages;
    this.total=data.total;
    this.renderMsgList(data.messages);
    // Pagination
    const footer=document.getElementById('mailListFooter');
    if(data.pages>1){
      footer.style.display='flex';
      document.getElementById('mailPageInfo').textContent=`Pág ${this.page}/${this.pages} · ${this.total} mensajes`;
      document.getElementById('mailPrevBtn').disabled=this.page<=1;
      document.getElementById('mailNextBtn').disabled=this.page>=this.pages;
    }
  },

  // ── Vínculo correo ↔ CRM: matching del remitente contra la cartera ──
  _fromEmail(s){const m=String(s||'').match(/<([^>]+)>/);const e=(m?m[1]:String(s||'')).trim();return /@/.test(e)?e.toLowerCase():'';},
  _cliEmailMap(){
    const map={};
    (state.clientes||[]).forEach(c=>{const e=(c.fields['Email']||'').trim().toLowerCase();if(e&&!map[e])map[e]=c;});
    return map;
  },
  crearLeadDesdeCorreo(){
    const d=this._currentMsg; if(!d){toast('Abre un correo primero','error');return;}
    switchTab('nuevo-lead');
    setTimeout(()=>{
      const set=(id,v)=>{const el=document.getElementById(id);if(el&&v)el.value=v;};
      const dom=(this._fromEmail(d.from_email)||'').split('@')[1]||'';
      const empresa=(d.from_name||'').trim()||(dom?dom.split('.')[0].replace(/^./,ch=>ch.toUpperCase()):'');
      set('nl-email',d.from_email||'');
      set('nl-contacto',d.from_name||'');
      set('nl-empresa',empresa);
      set('nl-origen','Contacto directo');
      set('nl-notas','Contacto por correo — asunto: "'+(d.subject||'')+'"');
      toast('Formulario prellenado desde el correo ✓','success');
    },150);
  },

  renderMsgList(msgs){
    const list=document.getElementById('mailList');
    if(!msgs.length){list.innerHTML='<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">Sin mensajes</div>';this._updateSelBar();return;}
    this._sel=this._sel||new Set();
    const cmap=this._cliEmailMap();
    list.innerHTML=msgs.map(m=>{
      const from=this.parseFrom(m.from);
      const date=this.fmtDate(m.date);
      const unread=!m.seen?'unread':'';
      const sel=m.uid===this.selUid?'selected':'';
      const checked=this._sel.has(m.uid);
      const cli=cmap[this._fromEmail(m.from)];
      const cliChip=cli?`<span title="Cliente en CRM: ${this.esc(cli.fields['Empresa']||cli.fields['Contacto']||'')} — clic para abrir la ficha" onclick="event.stopPropagation();openClienteDetalle('${cli.id}')" style="flex-shrink:0;font-size:11px;cursor:pointer;line-height:1">👤</span> `:'';
      return `<div class="mail-item ${unread} ${sel} ${checked?'sel-checked':''}" data-uid="${m.uid}" onclick="MAIL.readMsg(${m.uid})">
        <input type="checkbox" class="mail-item-chk" ${checked?'checked':''} onclick="event.stopPropagation();MAIL.toggleSelect(${m.uid},this.checked)" title="Seleccionar">
        <div class="mail-item-main">
          <div class="mail-item-row1">
            <span class="mail-item-from">${m.flagged?'<span class="mail-item-star">★</span> ':''}${cliChip}${this.esc(from)}</span>
            <span class="mail-item-date">${date}</span>
          </div>
          <div class="mail-item-subject">${this.esc(m.subject)}</div>
          ${m.snippet?`<div class="mail-item-snippet">${this.esc(m.snippet)}</div>`:''}
        </div>
      </div>`;
    }).join('');
    this._updateSelBar();
    this.loadSnippets(msgs);
  },

  // Carga los previews (snippets) en segundo plano, por lotes pequeños y aislados.
  // La lista ya está en pantalla; esto solo rellena el textito bajo el asunto.
  // Va aparte del listado a propósito: si un correo corrupto hace fallar un lote,
  // se ignora y la bandeja no se ve afectada (nunca vuelve a caerse por el preview).
  async loadSnippets(msgs){
    const pend=(msgs||[]).filter(m=>m&&!m.snippet).map(m=>m.uid);
    if(!pend.length) return;
    const seq=(this._snipSeq=(this._snipSeq||0)+1);
    const folder=this.folder, chunk=12;
    for(let i=0;i<pend.length;i+=chunk){
      if(seq!==this._snipSeq||folder!==this.folder) return; // la lista cambió → aborta
      const uids=pend.slice(i,i+chunk);
      let data; try{ data=await this.post({action:'snippets',folder,uids:uids.join(',')}); }catch(e){ continue; }
      if(seq!==this._snipSeq||folder!==this.folder) return;
      const snips=(data&&data.snippets)||{};
      for(const uid of uids){
        const s=snips[uid]||snips[String(uid)]||'';
        if(!s) continue;
        const m=(this.msgs||[]).find(x=>x&&String(x.uid)===String(uid));
        if(m) m.snippet=s; // cachea para re-renders (no se vuelve a pedir)
        const main=document.querySelector(`.mail-item[data-uid="${uid}"] .mail-item-main`);
        if(main){
          let el=main.querySelector('.mail-item-snippet');
          if(!el){ el=document.createElement('div'); el.className='mail-item-snippet'; main.appendChild(el); }
          el.textContent=s;
        }
      }
    }
  },

  async readMsg(uid){
    this.selUid=uid;
    const seq=++this._readSeq;
    this.mobGo('reader');
    document.querySelectorAll('.mail-item').forEach(el=>{el.classList.remove('selected');});
    document.querySelector(`.mail-item[data-uid="${uid}"]`)?.classList.add('selected');
    document.getElementById('mailReaderEmpty').style.display='none';
    const rc=document.getElementById('mailReaderContent');
    rc.style.display='flex';
    document.getElementById('mailRdrBody').innerHTML='<div class="loading-state" style="padding:30px"><div class="spinner"></div></div>';
    document.getElementById('mailRdrSubject').textContent='Cargando...';
    document.getElementById('mailRdrMeta').textContent='';
    const data=await this.post({action:'read',folder:this.folder,uid});
    if(seq!==this._readSeq) return; // llegó tarde: el usuario ya abrió otro mensaje
    if(data.error){this._currentMsg=null;document.getElementById('mailRdrBody').innerHTML=`<div style="color:var(--danger)">${this.esc(data.error)}</div>`;return;}
    this._currentMsg=data;
    document.getElementById('mailRdrSubject').textContent=data.subject;
    // Vínculo con el CRM: ¿el remitente es un cliente conocido?
    const _cli=this._cliEmailMap()[this._fromEmail(data.from_email)];
    const _propio=/@thelab\.solutions$/i.test(this._fromEmail(data.from_email));
    const _crmLine=_cli
      ?`<div style="margin-top:7px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="badge-cliente">👤 Cliente: ${this.esc(_cli.fields['Empresa']||_cli.fields['Contacto']||'—')}</span><button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 10px" onclick="openClienteDetalle('${_cli.id}')">Ver ficha CRM →</button></div>`
      :(!_propio&&this._fromEmail(data.from_email)?`<div style="margin-top:7px"><button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 10px" onclick="MAIL.crearLeadDesdeCorreo()" title="Crea un lead en el CRM con los datos de este correo">➕ Crear lead desde este correo</button></div>`:'');
    document.getElementById('mailRdrMeta').innerHTML=
      `<strong>${this.esc(data.from_name||data.from_email)}</strong> &lt;${this.esc(data.from_email)}&gt;<br>`+
      `Para: ${data.to.map(t=>this.esc(t)).join(', ')}<br>`+
      `${data.date}`+_crmLine;
    // Render body (respeta el modo claro/oscuro compartido con el editor)
    this._renderMsgBody(data);
    // Adjuntos del mensaje
    const attsDiv=document.getElementById('mailRdrAtts');
    if(data.attachments&&data.attachments.length){
      attsDiv.style.display='flex';
      attsDiv.innerHTML=data.attachments.map(a=>
        `<span class="mail-att-chip" onclick="MAIL.downloadAtt('${this.esc(a.part)}','${this.esc(a.name).replace(/'/g,"\\'")}')">📎 <span class="att-name">${this.esc(a.name)}</span></span>`
      ).join('');
    }else{attsDiv.style.display='none';attsDiv.innerHTML='';}
    // Estado del botón destacar
    const listItem=this.msgs.find(x=>x.uid===uid);
    this._updateFlagBtn(listItem?!!listItem.flagged:false);
    // Mark read in list
    const item=document.querySelector(`.mail-item[data-uid="${uid}"]`);
    if(item) item.classList.remove('unread');
  },

  // Pinta el cuerpo del mensaje en el preview usando la misma preferencia
  // claro/oscuro del editor (mail_editor_light). Muchos correos comerciales
  // están diseñados para fondo blanco: en claro se ven como los pensaron.
  _renderMsgBody(data){
    const bodyDiv=document.getElementById('mailRdrBody');
    if(!bodyDiv||!data) return;
    const light=localStorage.getItem('mail_editor_light')==='1';
    bodyDiv.innerHTML='';
    bodyDiv.style.background=light?'#ffffff':'';
    if(data.has_html){
      const ifr=document.createElement('iframe');
      ifr.setAttribute('sandbox','allow-same-origin allow-popups');
      ifr.style.cssText='width:100%;border:none;display:block;'+(light?'background:#fff;':'');
      const css=light
        ?'*{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;background:#fff;margin:0;padding:16px;line-height:1.6}a{color:#0068c9}img{max-width:100%;height:auto}'
        :'*{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:14px;color:#ccc;background:#111;margin:0;padding:16px;line-height:1.6}a{color:#00f3ff}img{max-width:100%;height:auto}';
      ifr.srcdoc=`<!DOCTYPE html><html><head><meta charset="UTF-8"><base target="_blank"><style>${css}</style></head><body>${data.body_html}</body></html>`;
      bodyDiv.appendChild(ifr);
      ifr.onload=()=>{
        try{const h=ifr.contentDocument.body.scrollHeight;ifr.style.height=(h+32)+'px';}catch(e){}
      };
    } else {
      bodyDiv.innerHTML=`<pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;color:${light?'#1a1a1a':'var(--text2)'};line-height:1.65;margin:0;padding:${light?'16px':'0'}">${this.esc(data.body_text||'(Sin contenido)')}</pre>`;
    }
  },

  _updateFlagBtn(flagged){
    const b=document.getElementById('mailFlagBtn');
    if(!b) return;
    b.textContent=flagged?'★ Destacado':'☆ Destacar';
    b.style.color=flagged?'#facc15':'';
    b.style.borderColor=flagged?'rgba(250,204,21,.4)':'';
  },

  async toggleFlag(){
    if(!this.selUid) return;
    const m=this.msgs.find(x=>x.uid===this.selUid);
    const newVal=m?(m.flagged?0:1):1;
    const data=await this.post({action:'mark',folder:this.folder,uid:this.selUid,flagged:newVal});
    if(data.error){toast(data.error,'error');return;}
    if(m) m.flagged=newVal;
    this._updateFlagBtn(!!newVal);
    this.renderMsgList(this.msgs);
    toast(newVal?'Mensaje destacado':'Destacado removido','success');
  },

  async markUnread(){
    if(!this.selUid) return;
    const data=await this.post({action:'mark',folder:this.folder,uid:this.selUid,seen:0});
    if(data.error){toast(data.error,'error');return;}
    const m=this.msgs.find(x=>x.uid===this.selUid);
    if(m) m.seen=0;
    this.selUid=null;
    document.getElementById('mailReaderEmpty').style.display='flex';
    document.getElementById('mailReaderContent').style.display='none';
    this.renderMsgList(this.msgs);
    this.mobGo('list');
    toast('Marcado como no leído','success');
  },

  async downloadAtt(part,name){
    toast('Descargando '+name+'...','info');
    const data=await this.post({action:'attachment',folder:this.folder,uid:this.selUid,part});
    if(data.error){toast(data.error,'error');return;}
    try{
      const bin=atob(data.data);
      const bytes=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
      const blob=new Blob([bytes],{type:data.mime||'application/octet-stream'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url;a.download=data.name||name;
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),5000);
    }catch(e){toast('Error al decodificar adjunto','error');}
  },

  async selectFolder(name){
    this.folder=name;
    this.page=1;
    this.selUid=null;
    document.getElementById('mailReaderEmpty').style.display='flex';
    document.getElementById('mailReaderContent').style.display='none';
    document.querySelectorAll('.mail-folder-item').forEach(b=>{
      b.classList.toggle('active',b.dataset.folder===name);
    });
    document.getElementById('mailSearchInput').value='';
    await this.loadMessages();
    this.mobGo('list');
  },

  mobGo(view){
    const mc=document.getElementById('mailClient');
    if(!mc) return;
    mc.classList.remove('mob-folders','mob-list','mob-reader');
    mc.classList.add('mob-'+view);
    ['folders','list','reader'].forEach(v=>{
      const btn=document.getElementById('mobNav'+v.charAt(0).toUpperCase()+v.slice(1));
      if(btn) btn.style.background=v===view?'rgba(0,243,255,0.1)':'';
      if(btn) btn.style.color=v===view?'var(--accent)':'';
    });
  },

  async prevPage(){if(this.page>1){this.page--;await this.loadMessages();}},
  async nextPage(){if(this.page<this.pages){this.page++;await this.loadMessages();}},

  async refresh(){
    this._init=false;
    this.selUid=null;
    document.getElementById('mailReaderEmpty').style.display='flex';
    document.getElementById('mailReaderContent').style.display='none';
    await this.init();
  },

  // ── Selector de cuentas ──────────────────────────────────────────
  renderAccounts(){
    const sel=document.getElementById('mailAcctSel'); if(!sel) return;
    const list=this.accounts(), active=this.activeAccount();
    // Se muestra "Nombre · correo" para que el remitente activo quede a la vista.
    let html=list.map(a=>{
      const label=a.name?`${this.esc(a.name)} · ${this.esc(a.email)}`:this.esc(a.email);
      return `<option value="${this.esc(a.email)}"${a.email===active?' selected':''}>${label}</option>`;
    }).join('');
    html+=`<option value="__editname__">✎ Editar nombre del remitente…</option>`;
    html+=`<option value="__add__">＋ Agregar cuenta…</option>`;
    if(list.length>1) html+=`<option value="__remove__">✕ Quitar cuenta actual…</option>`;
    sel.innerHTML=html;
  },
  onAcctChange(v){
    if(v==='__add__'){ this.renderAccounts(); this.addAccount(); return; }
    if(v==='__editname__'){ this.renderAccounts(); this.editAccountName(); return; }
    if(v==='__remove__'){ this.renderAccounts(); this.removeAccount(); return; }
    if(v && v!==this.activeAccount()) this.switchAccount(v);
  },
  addAccount(){
    let email=prompt('Correo de la cuenta a agregar:','@thelab.solutions');
    if(email===null) return;
    email=email.trim().toLowerCase();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ toast('Correo inválido','error'); return; }
    const list=this.accounts();
    const existing=list.find(a=>a.email===email);
    // Casillas como hola@ vienen precargadas: si ya está, igual dejamos ajustar
    // su nombre de remitente en vez de bloquear con "ya agregada".
    if(existing){
      let name=prompt('Esa casilla ya está agregada.\nNombre del remitente (así aparece tu nombre al enviar):',existing.name||'');
      if(name!==null){
        existing.name=name.trim();
        this.setAccounts(list);
        this.renderAccounts();
        toast('✓ Nombre del remitente actualizado','success');
      }
      this.switchAccount(email);
      return;
    }
    let name=prompt('Nombre para mostrar al enviar (remitente):','The Lab Solutions');
    if(name===null) return;
    list.push({email,name:name.trim()});
    this.setAccounts(list);
    this.switchAccount(email); // pedirá la contraseña de esa casilla
  },
  // Cambia el nombre del remitente (from_name) de la cuenta ACTIVA sin tocar la
  // casilla ni su clave. Así hola@ puede salir como "Andrea Garrido - The Lab
  // Solutions" en vez del nombre fijo por defecto.
  editAccountName(){
    const active=this.activeAccount(); if(!active) return;
    const cur=this.activeAccountObj();
    let name=prompt('Nombre del remitente para '+active+'\n(así aparece tu nombre al enviar correos desde esta casilla):',(cur&&cur.name)||'');
    if(name===null) return;
    name=name.trim();
    const list=this.accounts();
    const idx=list.findIndex(a=>a.email===active);
    if(idx>=0) list[idx]={...list[idx],name};
    else list.push({email:active,name});
    this.setAccounts(list);
    this.renderAccounts();
    toast('✓ Nombre del remitente actualizado','success');
  },
  removeAccount(){
    const active=this.activeAccount(), u=AUTH.getUser();
    let list=this.accounts();
    if(list.length<=1){ toast('Debe quedar al menos una cuenta','info'); return; }
    if(!confirm('¿Quitar '+active+' de la lista? (no borra el buzón, solo lo saca de aquí)')){ this.renderAccounts(); return; }
    this.clearMailPass(); // borra la clave guardada de esa casilla
    list=list.filter(a=>a.email!==active);
    this.setAccounts(list);
    const next=(list.find(a=>a.email===u?.username)||list[0]).email;
    this.switchAccount(next);
  },
  switchAccount(email){
    const k=this._activeKey(); if(k) localStorage.setItem(k,email);
    this._init=false; this.folder='INBOX'; this.page=1; this.msgs=[]; this.selUid=null; this._currentMsg=null;
    document.getElementById('mailReaderEmpty').style.display='flex';
    document.getElementById('mailReaderContent').style.display='none';
    document.getElementById('mailList').innerHTML='<div class="loading-state" style="padding:30px"><div class="spinner"></div></div>';
    document.getElementById('mailConnStatus').textContent='';
    this.renderAccounts();
    if(!this.getMailPass()){ this.showPassModal(); return; }
    this.init();
  },

  // ── Pantalla completa ────────────────────────────────────────────
  toggleFullscreen(){
    if(!this._fsWired){
      this._fsWired=true;
      document.addEventListener('keydown',e=>{
        if(e.key==='Escape'){ const c=document.getElementById('mailClient'); if(c&&c.classList.contains('fullscreen')) MAIL.toggleFullscreen(); }
      });
    }
    const c=document.getElementById('mailClient'); if(!c) return;
    const on=c.classList.toggle('fullscreen');
    document.body.classList.toggle('mail-fs-on',on);
    const ex=document.getElementById('mailFsExit'); if(ex) ex.style.display=on?'inline-flex':'none';
    const b=document.getElementById('mailFsBtn'); if(b) b.innerHTML=on?'⛶ Salir':'⛶ Pantalla completa';
  },

  onSearchInput(val){
    clearTimeout(this._searchTimer);
    if(!val.trim()){this.loadMessages();return;}
    this._searchTimer=setTimeout(()=>this.search(val),400);
  },

  async search(q){
    const list=document.getElementById('mailList');
    list.innerHTML='<div class="loading-state" style="padding:30px"><div class="spinner"></div></div>';
    document.getElementById('mailListFooter').style.display='none';
    const data=await this.post({action:'search',folder:this.folder,query:q});
    if(data.error){list.innerHTML=`<div style="padding:16px;color:var(--danger);font-size:13px">${this.esc(data.error)}</div>`;return;}
    this.renderMsgList(data.messages);
  },

  _cmpAtts:[],

  addFiles(files){
    const MAX=15*1024*1024;
    for(const f of files){
      const cur=this._cmpAtts.reduce((s,a)=>s+a.size,0);
      if(cur+f.size>MAX){toast('Límite 15 MB de adjuntos','error');break;}
      const reader=new FileReader();
      reader.onload=()=>{
        this._cmpAtts.push({name:f.name,type:f.type||'application/octet-stream',size:f.size,data:reader.result.split(',')[1]});
        this.renderCmpAtts();
      };
      reader.readAsDataURL(f);
    }
  },

  removeAtt(i){this._cmpAtts.splice(i,1);this.renderCmpAtts();},

  renderCmpAtts(){
    const div=document.getElementById('mailCmpAtts');
    if(!div) return;
    div.innerHTML=this._cmpAtts.map((a,i)=>
      `<span class="mail-att-chip"><span class="att-name" onclick="MAIL.previewAtt(${i})" style="cursor:pointer" title="Clic para previsualizar">👁 ${this.esc(a.name)}</span> <span style="color:var(--text3);font-size:10px">${(a.size/1024).toFixed(0)} KB</span> <span class="att-x" onclick="MAIL.removeAtt(${i})">✕</span></span>`
    ).join('');
  },

  // Previsualiza un adjunto del correo en redacción (p.ej. el PDF de la cotización)
  // ANTES de enviar, para revisar su contenido. Renderiza en un iframe (PDF) o
  // <img> (imágenes); otros tipos se abren en pestaña.
  _attPrevUrl:null,
  previewAtt(i){
    const a=this._cmpAtts[i]; if(!a||!a.data){toast('Adjunto no disponible','error');return;}
    try{
      if(this._attPrevUrl){URL.revokeObjectURL(this._attPrevUrl);this._attPrevUrl=null;}
      const bin=atob(a.data);const bytes=new Uint8Array(bin.length);
      for(let j=0;j<bin.length;j++) bytes[j]=bin.charCodeAt(j);
      const blob=new Blob([bytes],{type:a.type||'application/octet-stream'});
      const url=URL.createObjectURL(blob);this._attPrevUrl=url;
      const modal=document.getElementById('mailAttPreviewModal');
      const frame=document.getElementById('mailAttPreviewFrame');
      const img=document.getElementById('mailAttPreviewImg');
      const title=document.getElementById('mailAttPreviewTitle');
      const openBtn=document.getElementById('mailAttPreviewOpen');
      if(title) title.textContent=a.name||'Adjunto';
      const isImg=/^image\//.test(a.type||'');
      const isPdf=/pdf/i.test(a.type||'')||/\.pdf$/i.test(a.name||'');
      if(openBtn) openBtn.onclick=()=>window.open(url,'_blank');
      if(isImg){img.src=url;img.style.display='block';frame.style.display='none';frame.src='';}
      else if(isPdf){frame.src=url;frame.style.display='block';img.style.display='none';img.src='';}
      else{ // tipos no previsualizables: abrir en pestaña
        window.open(url,'_blank');
        return;
      }
      if(modal) modal.style.display='flex';
    }catch(e){toast('No se pudo previsualizar el adjunto','error');}
  },
  closeAttPreview(){
    const modal=document.getElementById('mailAttPreviewModal');if(modal) modal.style.display='none';
    const frame=document.getElementById('mailAttPreviewFrame');if(frame) frame.src='';
    const img=document.getElementById('mailAttPreviewImg');if(img) img.src='';
    if(this._attPrevUrl){const u=this._attPrevUrl;this._attPrevUrl=null;setTimeout(()=>URL.revokeObjectURL(u),400);}
  },

  fillContactsDatalist(){
    const dl=document.getElementById('mailContactsList');
    if(!dl||typeof state==='undefined'||!state.clientes) return;
    const opts=state.clientes
      .filter(c=>c.fields['Email'])
      .map(c=>`<option value="${this.esc(c.fields['Email'])}">${this.esc(c.fields['Empresa']||c.fields['Contacto']||'')}</option>`);
    dl.innerHTML=opts.join('');
  },

  // ── Plantillas ──
  _tplKey(){const u=AUTH.getUser();return u?'thelab_mail_tpl_'+u.username:null;},
  getTpls(){try{const k=this._tplKey();return k?JSON.parse(localStorage.getItem(k)||'[]'):[];}catch(e){return[];}},
  setTpls(t){const k=this._tplKey();if(k) localStorage.setItem(k,JSON.stringify(t));},

  toggleTplMenu(e){
    e.stopPropagation();
    const menu=document.getElementById('mailTplMenu');
    if(menu.style.display!=='none'){menu.style.display='none';return;}
    const tpls=this.getTpls();
    let html=tpls.map((t,i)=>
      `<div class="mail-tpl-item"><span style="flex:1" onclick="MAIL.useTpl(${i})">${this.esc(t.name)}</span><span class="att-x" onclick="event.stopPropagation();MAIL.delTpl(${i})">✕</span></div>`
    ).join('');
    html+=`<div class="mail-tpl-item" style="border-top:1px solid var(--border);color:var(--accent)" onclick="MAIL.saveAsTpl()">+ Guardar borrador actual como plantilla</div>`;
    menu.innerHTML=html;
    menu.style.display='block';
    const close=ev=>{if(!menu.contains(ev.target)){menu.style.display='none';document.removeEventListener('click',close);}};
    setTimeout(()=>document.addEventListener('click',close),50);
  },

  useTpl(i){
    const t=this.getTpls()[i];
    if(!t) return;
    if(t.subject&&!document.getElementById('mailCmpSubject').value) document.getElementById('mailCmpSubject').value=t.subject;
    document.getElementById('mailCmpBody').focus();
    document.execCommand('insertHTML',false,t.body);
    document.getElementById('mailTplMenu').style.display='none';
  },

  delTpl(i){
    const tpls=this.getTpls();
    if(!confirm(`¿Eliminar plantilla "${tpls[i]?.name}"?`)) return;
    tpls.splice(i,1);this.setTpls(tpls);
    document.getElementById('mailTplMenu').style.display='none';
    toast('Plantilla eliminada','success');
  },

  saveAsTpl(){
    const name=prompt('Nombre de la plantilla:');
    if(!name) return;
    const tpls=this.getTpls();
    tpls.push({name,subject:document.getElementById('mailCmpSubject').value,body:document.getElementById('mailCmpBody').innerHTML});
    this.setTpls(tpls);
    document.getElementById('mailTplMenu').style.display='none';
    toast('Plantilla guardada','success');
  },

  // ── Enviar cotización por correo ──
  // Registro al enviar una cotización por correo: estado → Enviada (si estaba
  // Solicitada), fecha de cotización si faltaba, y nota con destinatario.
  async _registrarCotEnviada(cotId,to){
    const c=state.cotizacionesById[cotId]; if(!c) return;
    const f=c.fields;
    const patch={};
    if((f['Estado cotización']||'')==='Solicitada') patch['Estado cotización']='Enviada';
    if(!f['Fecha cotización']) patch['Fecha cotización']=new Date().toISOString().slice(0,10);
    if(Object.keys(patch).length){
      try{await airtableWriteTolerant('Cotizaciones','PATCH',cotId,patch);Object.assign(f,patch);}catch(e){}
    }
    try{const arr=_getNotas('cot',cotId);arr.push({id:'n'+Date.now(),ts:Date.now(),text:'📧 Cotización enviada por correo a '+to+' (PDF adjunto)'});_saveNotas('cot',cotId,arr);}catch(e){}
    try{renderCotizaciones();}catch(e){}
    toast('✓ Cotización '+(f['N° Cotización']||'')+' registrada como enviada','success');
  },

  async sendCotizacion(cotId){
    const c=state.cotizacionesById[cotId];
    if(!c){toast('Cotización no encontrada','error');return;}
    const f=c.fields;
    const numCot=f['N° Cotización']||'—';
    // Email del cliente
    let email='',empresa='';
    const cid=Array.isArray(f['Cliente'])?f['Cliente'][0]:null;
    if(cid){
      const cli=state.clientesByIdRec[cid];
      if(cli){email=cli.fields['Email']||'';empresa=cli.fields['Empresa']||'';}
    }
    // Generar PDF de la cotización como adjunto
    this._cmpAtts=[];
    try{
      const res=buildCotizacionDoc(cotId);
      if(res&&res.html){
        toast('Generando PDF…','info');
        const pdfBlob=await _fichaHTMLtoPdfBlob(res.html);
        const b64=await new Promise((resolve,reject)=>{
          const reader=new FileReader();
          reader.onload=()=>resolve(reader.result.split(',')[1]);
          reader.onerror=reject;
          reader.readAsDataURL(pdfBlob);
        });
        const fname=`Cotizacion_${numCot.replace(/[^\w-]/g,'_')}.pdf`;
        this._cmpAtts.push({name:fname,type:'application/pdf',size:pdfBlob.size,data:b64});
      }
    }catch(e){toast('Error generando PDF','error');}
    switchTab('correo');
    setTimeout(()=>{
      this.init();
      this.openCompose({
        _keepAtts:true,
        _cotId:cotId,
        title:'Enviar cotización',
        to:email,
        subject:`Cotización ${numCot} — The Lab Solutions`,
        body:`<p>Estimado${empresa?' equipo de '+this.esc(empresa):''},</p><p>Adjuntamos la cotización <strong>${this.esc(numCot)}</strong> solicitada. Quedamos atentos a sus comentarios.</p><p>Saludos cordiales,</p>`
      });
      this.renderCmpAtts();
    },300);
  },

  openCompose(opts={}){
    if(!opts._keepAtts){this._cmpAtts=[];this.renderCmpAtts();}
    this._cmpCotId=opts._cotId||null;   // vínculo con la cotización (registro al enviar)
    this._cmpReactivarCli=opts._reactivarCli||null;   // marcar cliente "Reactivado" al enviar
    this._cmpFuCotId=opts._fuCotId||null;   // registrar seguimiento de cotización al enviar
    this._cmpPdPedido=opts._pdPedidoId||null;   // marcar pedido post-entrega gestionado al enviar
    this.fillContactsDatalist();
    document.getElementById('mailCmpTo').value=opts.to||'';
    document.getElementById('mailCmpCc').value=opts.cc||'';
    const bccEl=document.getElementById('mailCmpBcc'); if(bccEl) bccEl.value=opts.bcc||'';
    // Muestra las filas CC/CCO solo si traen valor (el botón las abre a mano)
    const ccRow=document.getElementById('mailCcRow'); if(ccRow) ccRow.style.display=opts.cc?'flex':'none';
    const bccRow=document.getElementById('mailBccRow'); if(bccRow) bccRow.style.display=opts.bcc?'flex':'none';
    document.getElementById('mailCmpSubject').value=opts.subject||'';
    const sig=this.sigHtml();
    document.getElementById('mailCmpBody').innerHTML=(opts.body||'')+sig;
    document.getElementById('mailComposeTitle').textContent=opts.title||'Nuevo mensaje';
    document.getElementById('mailSendStatus').textContent='';
    document.getElementById('mailComposePanel').style.display='flex';
    document.getElementById('mailComposePanel').classList.remove('collapsed');
    this._applyEditorBg();
    if(!opts.to) document.getElementById('mailCmpTo').focus();
    else document.getElementById('mailCmpBody').focus();
  },
  closeCompose(){document.getElementById('mailComposePanel').style.display='none';},

  // Firma independiente por cuenta: se guarda con la casilla activa, no con el
  // usuario del dashboard. Como la cuenta por defecto es la del usuario logueado,
  // la firma ya existente se conserva para esa casilla (misma clave).
  _sigKey(){const a=this.activeAccount();return a?'thelab_mail_sig_'+a:null;},
  getSig(){const k=this._sigKey();return k?localStorage.getItem(k)||'':null;},
  setSig(html){
    const k=this._sigKey();if(k) localStorage.setItem(k,html);
    // Respaldo permanente: la firma queda también en Airtable (sobrevive a
    // limpiar el caché y aparece igual en otros dispositivos).
    this._saveSigsAirtable();
  },
  async _saveSigsAirtable(){
    try{
      // Junta las firmas locales de todas las cuentas y las mezcla sobre lo ya
      // respaldado (así no se pisan firmas guardadas desde otro computador).
      let prev={};try{prev=JSON.parse(state._mailSigsRemote||'{}');}catch(e){}
      const all={...prev};
      this.accounts().forEach(a=>{const v=localStorage.getItem('thelab_mail_sig_'+a.email);if(v) all[a.email]=v;});
      const notes=JSON.stringify(all).slice(0,95000);
      if(state.mailSigsRecordId){
        await airtableWrite('Monitor Sistema','PATCH',state.mailSigsRecordId,{'Notes':notes});
      }else{
        const r=await airtableWrite('Monitor Sistema','POST',null,{'Name':'MAIL_SIGNATURES','Notes':notes});
        if(r?.id) state.mailSigsRecordId=r.id;
      }
      state._mailSigsRemote=notes;
    }catch(e){console.warn('[Firmas] no se pudo respaldar en Airtable (queda local):',e.message);}
  },

  sigHtml(){
    const s=this.getSig();
    if(!s) return '';
    // Sin línea separadora: las firmas con diseño propio (tarjeta) traen su
    // borde, y en las de texto el espacio en blanco basta como separación.
    return `<br><br><div style="margin-top:12px">${s}</div>`;
  },

  insertSignature(){
    const s=this.sigHtml();
    if(!s){toast('No tienes firma configurada. Usa el botón "Firma" en la cabecera.','info');return;}
    const body=document.getElementById('mailCmpBody');
    body.focus();
    document.execCommand('insertHTML',false,s);
  },

  openSigModal(){
    const ed=document.getElementById('mailSigEditor'),code=document.getElementById('mailSigCode');
    const acct=document.getElementById('mailSigAcct'); if(acct) acct.textContent='· '+(this.activeAccount()||'');
    ed.innerHTML=this.getSig()||'';
    if(code){code.style.display='none';code.value='';}
    ed.style.display='block';
    const b=document.getElementById('mailSigCodeBtn');if(b)b.classList.remove('active');
    document.getElementById('mailSigModal').style.display='flex';
    this._applyEditorBg();
    setTimeout(()=>ed.focus(),100);
  },
  closeSigModal(){document.getElementById('mailSigModal').style.display='none';},
  saveSig(){
    const code=document.getElementById('mailSigCode'),ed=document.getElementById('mailSigEditor');
    const html=(code&&code.style.display!=='none')?code.value:ed.innerHTML;
    this.setSig(html);
    this.closeSigModal();
    toast('Firma guardada','success');
  },
  // Alterna entre el editor visual y pegar/editar el HTML crudo (firmas tipo tabla).
  toggleSigCode(){
    const ed=document.getElementById('mailSigEditor'),code=document.getElementById('mailSigCode'),b=document.getElementById('mailSigCodeBtn');
    if(!ed||!code) return;
    if(code.style.display==='none'){
      code.value=ed.innerHTML; code.style.display='block'; ed.style.display='none';
      if(b)b.classList.add('active'); this._applyEditorBg(); code.focus();
    }else{
      ed.innerHTML=code.value; code.style.display='none'; ed.style.display='block';
      if(b)b.classList.remove('active'); ed.focus();
    }
  },
  // Fondo claro/oscuro de los editores de correo (mejor contraste al escribir).
  toggleEditorBg(){
    const light=localStorage.getItem('mail_editor_light')!=='1';
    localStorage.setItem('mail_editor_light',light?'1':'0');
    this._applyEditorBg();
    // El preview comparte la preferencia: re-pinta el mensaje abierto al instante
    if(this._currentMsg) this._renderMsgBody(this._currentMsg);
  },
  _applyEditorBg(){
    const light=localStorage.getItem('mail_editor_light')==='1';
    ['mailCmpBody','mailSigEditor','mailSigCode'].forEach(id=>{
      const el=document.getElementById(id);
      if(el){ el.style.background=light?'#ffffff':''; el.style.color=light?'#111111':''; }
    });
  },

  sigInsertImage(){
    const url=prompt('URL de la imagen:');
    if(!url) return;
    document.getElementById('mailSigEditor').focus();
    document.execCommand('insertHTML',false,`<img loading="lazy" decoding="async" src="${url}" style="max-height:100px;max-width:100%">`);
  },

  insertImagePrompt(){
    const url=prompt('URL de la imagen:');
    if(!url) return;
    document.getElementById('mailCmpBody').focus();
    document.execCommand('insertHTML',false,`<img loading="lazy" decoding="async" src="${url}" style="max-width:100%">`);
  },
  toggleCompose(){document.getElementById('mailComposePanel').classList.toggle('collapsed');},
  toggleCc(){const r=document.getElementById('mailCcRow');r.style.display=r.style.display==='none'?'flex':'none';},
  toggleBcc(){const r=document.getElementById('mailBccRow');r.style.display=r.style.display==='none'?'flex':'none';},

  reply(){
    if(!this._currentMsg) return;
    const m=this._currentMsg;
    this.openCompose({
      title:'Responder',
      to:m.from_email,
      subject:'Re: '+m.subject.replace(/^Re:\s*/i,''),
      body:`<br><br><hr style="border:none;border-top:1px solid #333;margin:16px 0"><p style="color:#888;font-size:12px">De: ${this.esc(m.from_name||m.from_email)} &lt;${m.from_email}&gt;<br>Fecha: ${m.date}<br>Asunto: ${this.esc(m.subject)}</p>${m.body_html||this.esc(m.body_text||'')}`
    });
  },

  forward(){
    if(!this._currentMsg) return;
    const m=this._currentMsg;
    this.openCompose({
      title:'Reenviar',
      subject:'Fwd: '+m.subject.replace(/^Fwd:\s*/i,''),
      body:`<br><br><hr style="border:none;border-top:1px solid #333;margin:16px 0"><p style="color:#888;font-size:12px">Reenviado de: ${this.esc(m.from_name||m.from_email)} &lt;${m.from_email}&gt;<br>Fecha: ${m.date}<br>Asunto: ${this.esc(m.subject)}</p>${m.body_html||this.esc(m.body_text||'')}`
    });
  },

  _validEmails(str){
    return str.split(',').map(s=>s.trim()).filter(Boolean)
      .every(e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.match(/<(.+)>/)?.[1]||e));
  },

  async sendCompose(){
    if(this._sending) return;
    const to=document.getElementById('mailCmpTo').value.trim();
    const cc=document.getElementById('mailCmpCc').value.trim();
    const bcc=(document.getElementById('mailCmpBcc')?.value||'').trim();
    const subject=document.getElementById('mailCmpSubject').value.trim();
    const body=document.getElementById('mailCmpBody').innerHTML;
    const status=document.getElementById('mailSendStatus');
    const err=m=>{status.textContent=m;status.style.color='var(--danger)';};
    if(!to) return err('Falta el destinatario');
    if(!this._validEmails(to)) return err('Email de destinatario inválido');
    if(cc&&!this._validEmails(cc)) return err('Email en CC inválido');
    if(bcc&&!this._validEmails(bcc)) return err('Email en CCO inválido');
    if(!subject) return err('Falta el asunto');
    this._sending=true;
    const btn=document.getElementById('mailSendBtn');
    if(btn) btn.disabled=true;
    status.textContent='Enviando...';status.style.color='var(--text3)';
    try{
      const a=this.auth();
      const params={action:'send',to,cc,bcc,subject,body,from_name:a.from_name};
      if(this._cmpAtts.length) params.atts=JSON.stringify(this._cmpAtts.map(x=>({name:x.name,type:x.type,data:x.data})));
      const data=await this.post(params);
      if(data.error) err(data.error);
      else{
        status.textContent='✓ Enviado';status.style.color='var(--success)';
        NOTIFY.add('sent','Correo enviado',to,'correo');
        // Cierre del ciclo cotización→PDF→correo: marca Enviada y deja registro
        if(this._cmpCotId){try{await this._registrarCotEnviada(this._cmpCotId,to);}catch(e){}this._cmpCotId=null;}
        // Reactivación: si el borrador vino de un agente, marca al cliente Reactivado
        if(this._cmpReactivarCli){try{if(typeof marcarReactivado==='function') marcarReactivado(this._cmpReactivarCli,'correo');}catch(e){}this._cmpReactivarCli=null;}
        if(this._cmpFuCotId){try{if(typeof fuMarkDone==='function') fuMarkDone(this._cmpFuCotId,'correo');}catch(e){}this._cmpFuCotId=null;}
        // Post-entrega: si el borrador vino de la bandeja POST-ENTREGA, márcalo gestionado
        if(this._cmpPdPedido){try{if(typeof pdMarkDone==='function') pdMarkDone(this._cmpPdPedido,'correo',true);}catch(e){}this._cmpPdPedido=null;}
        this._cmpAtts=[];this.renderCmpAtts();
        setTimeout(()=>this.closeCompose(),1500);
      }
    }finally{
      this._sending=false;
      if(btn) btn.disabled=false;
    }
  },

  async trashCurrent(){
    if(!this.selUid) return;
    if(!confirm('¿Mover este mensaje a la papelera?')) return;
    const data=await this.post({action:'trash',folder:this.folder,uid:this.selUid});
    if(data.error){toast(data.error,'error');return;}
    toast('Mensaje eliminado','success');
    this.selUid=null;
    document.getElementById('mailReaderEmpty').style.display='flex';
    document.getElementById('mailReaderContent').style.display='none';
    await this.loadMessages();
    await this.loadFolders();
  },

  // ── Selección múltiple de la bandeja ──────────────────────────
  toggleSelect(uid,on){
    this._sel=this._sel||new Set();
    if(on) this._sel.add(uid); else this._sel.delete(uid);
    const item=document.querySelector(`.mail-item[data-uid="${uid}"]`);
    if(item) item.classList.toggle('sel-checked',on);
    this._updateSelBar();
  },
  toggleSelectAll(on){
    this._sel=this._sel||new Set();
    (this.msgs||[]).forEach(m=>{ if(on) this._sel.add(m.uid); else this._sel.delete(m.uid); });
    document.querySelectorAll('#mailList .mail-item').forEach(el=>{
      const chk=el.querySelector('.mail-item-chk');
      if(chk) chk.checked=on;
      el.classList.toggle('sel-checked',on);
    });
    this._updateSelBar();
  },
  clearSelection(){
    this._sel=new Set();
    document.querySelectorAll('#mailList .mail-item').forEach(el=>{
      const c=el.querySelector('.mail-item-chk'); if(c) c.checked=false;
      el.classList.remove('sel-checked');
    });
    this._updateSelBar();
  },
  _updateSelBar(){
    const n=this._sel?this._sel.size:0;
    const bar=document.getElementById('mailSelBar'); if(bar) bar.style.display=n>0?'flex':'none';
    const cnt=document.getElementById('mailSelCount'); if(cnt) cnt.textContent=`${n} seleccionado${n!==1?'s':''}`;
    const a=document.getElementById('mailSelAllChk');
    if(a){ const total=(this.msgs||[]).length; a.checked=total>0&&n>=total; a.indeterminate=n>0&&n<total; }
  },
  async trashSelected(){
    this._sel=this._sel||new Set();
    const uids=[...this._sel];
    if(!uids.length) return;
    if(!confirm(`¿Mover ${uids.length} mensaje${uids.length>1?'s':''} a la papelera?`)) return;
    const bar=document.getElementById('mailSelBar');
    const btns=bar?bar.querySelectorAll('button'):[];
    btns.forEach(b=>b.disabled=true);
    let ok=0,fail=0;
    for(const uid of uids){
      const data=await this.post({action:'trash',folder:this.folder,uid});
      if(data&&!data.error) ok++; else fail++;
    }
    btns.forEach(b=>b.disabled=false);
    // Si el mensaje abierto se eliminó, cierra el lector
    if(this.selUid&&uids.includes(this.selUid)){
      this.selUid=null;
      document.getElementById('mailReaderEmpty').style.display='flex';
      document.getElementById('mailReaderContent').style.display='none';
    }
    this._sel=new Set();
    toast(fail?`${ok} eliminado${ok!==1?'s':''} · ${fail} con error`:`✓ ${ok} mensaje${ok!==1?'s':''} eliminado${ok!==1?'s':''}`, fail?'info':'success');
    await this.loadMessages();
    await this.loadFolders();
  },

  parseFrom(from){
    const m=from.match(/^"?([^"<]+)"?\s*</);
    if(m) return m[1].trim();
    const e=from.match(/<(.+)>/);
    if(e) return e[1];
    return from;
  },

  fmtDate(dateStr){
    if(!dateStr) return '';
    try{
      const d=new Date(dateStr);
      const now=new Date();
      const diff=(now-d)/1000;
      if(diff<86400 && d.getDate()===now.getDate()) return d.toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'});
      if(diff<604800) return ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][d.getDay()];
      return _DTF_DM.format(d);
    }catch(e){return dateStr.substring(0,10);}
  },

  esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
};
