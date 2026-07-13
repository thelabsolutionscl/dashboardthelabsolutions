/* js/notify.js — módulo extraído de index.html (carga en el mismo punto). */
// ── NOTIFICACIONES ────────────────────────────────────────────
const NOTIFY={
  _key:'thelab_notifications_v1',
  _histKey:'thelab_notifications_hist_v1',
  _alertKeysKey:'thelab_alert_keys_v1',
  items:[],
  _hist:[],
  _seq:0,
  _filter:'todas',

  // ── PERSISTENCE ──────────────────────────────────────────────
  load(){
    try{this.items=JSON.parse(localStorage.getItem(this._key)||'[]');}catch(e){this.items=[];}
    try{
      const h=JSON.parse(localStorage.getItem(this._histKey)||'[]');
      this._hist=h.length?h:this.items.slice();
    }catch(e){this._hist=this.items.slice();}
    this.loadPrefs();
    this.updateBadge();
    window.addEventListener('storage',ev=>{
      if(ev.key===this._key){
        try{this.items=JSON.parse(ev.newValue||'[]');}catch(e){return;}
        this.render();this.updateBadge();
      }
    });
    setTimeout(()=>this.checkDailySummary(),10000);
  },
  save(){
    try{localStorage.setItem(this._key,JSON.stringify(this.items.slice(0,60)));}catch(e){}
    try{localStorage.setItem(this._histKey,JSON.stringify(this._hist.slice(0,200)));}catch(e){}
  },

  // ── PREFERENCES ──────────────────────────────────────────────
  _prefs:{mail:true,sent:true,warning:true,info:true,dailySummaryEnabled:false,dailySummaryHour:9,dailySummaryCEO:false,waWebhook:'',waPhone:''},
  _prefsKey(){const u=typeof AUTH!=='undefined'&&AUTH.getUser?AUTH.getUser():null;return u?'thelab_notif_prefs_'+u.username:'thelab_notif_prefs_guest';},
  loadPrefs(){
    try{const p=JSON.parse(localStorage.getItem(this._prefsKey())||'{}');this._prefs=Object.assign({mail:true,sent:true,warning:true,info:true,dailySummaryEnabled:false,dailySummaryHour:9,waWebhook:'',waPhone:''},p);}
    catch(e){}
  },
  savePrefs(){try{localStorage.setItem(this._prefsKey(),JSON.stringify(this._prefs));}catch(e){}},
  _shouldNotify(type){
    if(type==='mail') return this._prefs.mail!==false;
    if(type==='sent') return this._prefs.sent!==false;
    if(type==='warning') return this._prefs.warning!==false;
    return this._prefs.info!==false;
  },

  // ── HELPERS ──────────────────────────────────────────────────
  esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');},

  // ── CORE ADD ─────────────────────────────────────────────────
  add(type,title,sub,action,opts={}){
    const item={id:Date.now()*100+(++this._seq%100),type,title,sub:sub||'',action:action||null,time:new Date().toISOString(),read:false,key:opts.key||null};
    this.items.unshift(item);
    this._hist.unshift(item);
    if(this.items.length>60) this.items=this.items.slice(0,60);
    if(this._hist.length>200) this._hist=this._hist.slice(0,200);
    this.save();
    this.render();
    this.updateBadge();
    if(!opts.silent&&this._shouldNotify(type)){
      const toastType=type==='mail'?'info':type==='sent'?'success':type==='warning'?'error':'success';
      const msg=sub?`${title}: ${sub}`:title;
      toast(msg,toastType);
    }
  },

  // ── SYNC ALERTAS ─────────────────────────────────────────────
  syncAlertas(alertas){
    let known;
    try{known=new Set(JSON.parse(localStorage.getItem(this._alertKeysKey)||'[]'));}catch(e){known=new Set();}
    const current=new Set();
    const tabMap={'pedido-atrasado':'pedidos','pago-pendiente':'pedidos','pedido-urgente':'pedidos','cot-vencida':'cotizaciones','cot-por-vencer':'cotizaciones','cot-sin-enviar':'cotizaciones','cliente-bloqueado':'cotizaciones','factura-vencida':'clientes','cliente-inactivo':'clientes','proveedor-bloqueado':'proveedores','proveedor-sin-cobertura':'proveedores'};
    let nuevasCriticas=0;
    alertas.forEach(a=>{
      const key=a.type+':'+a.id;
      current.add(key);
      if(known.has(key)) return;
      const plain=String(a.msg||'').replace(/<[^>]*>/g,'');
      const shortMsg=plain.length>70?plain.slice(0,70)+'…':plain;
      this.add('warning',shortMsg,
        a.sev===3?'Crítico':a.sev===2?'Advertencia':'Info',
        tabMap[a.type]||a.tab||'overview',{silent:true,key});
      if(a.sev===3){
        nuevasCriticas++;
        this._sendWhatsApp(shortMsg);
      }
    });
    try{localStorage.setItem(this._alertKeysKey,JSON.stringify([...current]));}catch(e){}
    if(nuevasCriticas>0) toast(`⚠ ${nuevasCriticas} alerta${nuevasCriticas>1?'s':''} crítica${nuevasCriticas>1?'s':''} nueva${nuevasCriticas>1?'s':''}`,'error');
  },

  // ── MARK / CLEAR ─────────────────────────────────────────────
  markAllRead(){
    this.items.forEach(i=>i.read=true);
    this._hist.forEach(i=>i.read=true);
    this.save();this.render();this.updateBadge();
  },
  clear(){
    this.items=[];this._hist=[];
    this.save();this.render();this.updateBadge();
  },
  unread(){return this.items.filter(i=>!i.read).length;},
  updateBadge(){
    const n=this.unread();
    const b=document.getElementById('notifBadge');
    if(!b) return;
    b.textContent=n>99?'99+':n;
    b.style.display=n>0?'flex':'none';
    const c=document.getElementById('notifCount');
    if(c) c.textContent=this.items.length?`${this.items.length} notificación${this.items.length!==1?'es':''}`:'';
  },

  // ── PANEL TOGGLE ─────────────────────────────────────────────
  toggle(e){
    if(e) e.stopPropagation();
    const p=document.getElementById('notifPanel');
    if(!p) return;
    const open=p.style.display!=='none';
    p.style.display=open?'none':'flex';
    if(!open){
      this.render();
      try{requestWebNotifPermission();}catch(e){}
    }
  },
  close(){const p=document.getElementById('notifPanel');if(p) p.style.display='none';},

  // ── FILTER ───────────────────────────────────────────────────
  setFilter(f){
    this._filter=f;
    document.querySelectorAll('.notif-filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.nf===f));
    this.render();
  },
  _filtered(){
    if(this._filter==='correo') return this.items.filter(i=>i.type==='mail'||i.type==='sent');
    if(this._filter==='alertas') return this.items.filter(i=>i.type==='warning');
    return this.items;
  },

  // ── RENDER PANEL ─────────────────────────────────────────────
  render(){
    const list=document.getElementById('notifList');
    if(!list) return;
    const items=this._filtered();
    if(!items.length){list.innerHTML='<div class="notif-empty">Sin notificaciones</div>';return;}
    const iconMap={mail:'#icon-correo',sent:'#icon-send',success:'#icon-check-circle',warning:'#icon-warning',info:'#icon-bell'};
    const colorMap={mail:'rgba(0,243,255,.12)',sent:'rgba(0,212,170,.12)',success:'rgba(0,212,170,.12)',warning:'rgba(250,204,21,.12)',info:'rgba(0,243,255,.08)'};
    list.innerHTML=items.map(item=>`
      <div class="notif-item${item.read?'':' unread'}" onclick="NOTIFY._click(${item.id})">
        <div class="notif-icon" style="background:${colorMap[item.type]||colorMap.info}">
          <svg class="dashboard-icon" width="13" height="13" stroke-width="1.5"><use href="${iconMap[item.type]||iconMap.info}"/></svg>
        </div>
        <div class="notif-body">
          <div class="notif-title">${this.esc(item.title)}</div>
          ${item.sub?`<div class="notif-sub">${this.esc(item.sub)}</div>`:''}
        </div>
        <div class="notif-time">${this._fmt(item.time)}</div>
      </div>`).join('');
  },
  _click(id){
    const item=this.items.find(i=>i.id===id);
    if(!item) return;
    item.read=true;this.save();this.updateBadge();this.close();
    if(!item.action) return;
    if(item.action.startsWith('@')){const fn=window[item.action.slice(1)];if(typeof fn==='function') fn();return;}
    switchTab(item.action);
  },
  _fmt(iso){
    try{
      const d=new Date(iso),diff=(Date.now()-d)/1000;
      if(diff<60) return 'ahora';
      if(diff<3600) return Math.floor(diff/60)+'m';
      if(diff<86400) return Math.floor(diff/3600)+'h';
      return _DTF_DM.format(d);
    }catch(e){return '';}
  },
  _fmtFull(iso){
    try{return new Date(iso).toLocaleString('es-CL',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});}catch(e){return '';}
  },

  // ── HISTORIAL COMPLETO ───────────────────────────────────────
  _histPage:1,
  _histPerPage:25,
  openHistory(){
    this._histPage=1;
    const m=document.getElementById('notifHistoryModal');
    if(!m) return;
    m.style.display='flex';
    const si=document.getElementById('nhSearchInput');if(si) si.value='';
    const df=document.getElementById('nhDateFilter');if(df) df.value='all';
    const tf=document.getElementById('nhTypeFilter');if(tf) tf.value='all';
    this._renderHistory();
  },
  closeHistory(){const m=document.getElementById('notifHistoryModal');if(m) m.style.display='none';},
  _renderHistory(){
    const q=(document.getElementById('nhSearchInput')?.value||'').toLowerCase().trim();
    const df=document.getElementById('nhDateFilter')?.value||'all';
    const tf=document.getElementById('nhTypeFilter')?.value||'all';
    const dayMs=86400000;
    const dn=new Date();
    let items=this._hist.filter(i=>{
      if(tf==='correo'&&i.type!=='mail'&&i.type!=='sent') return false;
      if(tf==='alertas'&&i.type!=='warning') return false;
      if(q){const t=(i.title||'').toLowerCase(),s=(i.sub||'').toLowerCase();if(!t.includes(q)&&!s.includes(q)) return false;}
      if(df!=='all'){
        const age=dn-new Date(i.time);
        if(df==='hoy'&&age>dayMs) return false;
        if(df==='ayer'&&(age<dayMs||age>2*dayMs)) return false;
        if(df==='semana'&&age>7*dayMs) return false;
        if(df==='mes'&&age>30*dayMs) return false;
      }
      return true;
    });
    const total=items.length;
    const pages=Math.max(1,Math.ceil(total/this._histPerPage));
    if(this._histPage>pages) this._histPage=pages;
    const start=(this._histPage-1)*this._histPerPage;
    const slice=items.slice(start,start+this._histPerPage);
    const iconMap={mail:'#icon-correo',sent:'#icon-send',success:'#icon-check-circle',warning:'#icon-warning',info:'#icon-bell'};
    const colorMap={mail:'rgba(0,243,255,.12)',sent:'rgba(0,212,170,.12)',success:'rgba(0,212,170,.12)',warning:'rgba(250,204,21,.12)',info:'rgba(0,243,255,.08)'};
    const list=document.getElementById('nhList');
    if(!list) return;
    list.innerHTML=slice.length
      ?slice.map(item=>`
        <div class="notif-item${item.read?'':' unread'}" onclick="NOTIFY._histClick(${item.id})">
          <div class="notif-icon" style="background:${colorMap[item.type]||colorMap.info}">
            <svg class="dashboard-icon" width="13" height="13" stroke-width="1.5"><use href="${iconMap[item.type]||iconMap.info}"/></svg>
          </div>
          <div class="notif-body">
            <div class="notif-title">${this.esc(item.title)}</div>
            ${item.sub?`<div class="notif-sub">${this.esc(item.sub)}</div>`:''}
          </div>
          <div class="notif-time" style="white-space:nowrap;min-width:64px;text-align:right;font-size:10px">${this._fmtFull(item.time)}</div>
        </div>`).join('')
      :'<div class="notif-empty">Sin resultados</div>';
    const pg=document.getElementById('nhPager');
    if(pg) pg.innerHTML=total
      ?`<span style="color:var(--text3);font-size:11px">${start+1}–${Math.min(start+this._histPerPage,total)} de ${total}</span>
        <div style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="NOTIFY._histPrev()" ${this._histPage<=1?'disabled':''} style="padding:2px 8px">‹</button>
          <button class="btn btn-ghost btn-sm" onclick="NOTIFY._histNext()" ${this._histPage>=pages?'disabled':''} style="padding:2px 8px">›</button>
        </div>`
      :'';
  },
  _histPrev(){if(this._histPage>1){this._histPage--;this._renderHistory();}},
  _histNext(){this._histPage++;this._renderHistory();},
  _histClick(id){
    const item=this._hist.find(i=>i.id===id);
    if(!item) return;
    item.read=true;
    const p=this.items.find(i=>i.id===id);if(p) p.read=true;
    this.save();this.updateBadge();this.closeHistory();
    if(!item.action) return;
    if(item.action.startsWith('@')){const fn=window[item.action.slice(1)];if(typeof fn==='function') fn();return;}
    switchTab(item.action);
  },

  // ── PREFERENCIAS ─────────────────────────────────────────────
  openPrefs(e){
    if(e) e.stopPropagation();
    this.loadPrefs();
    const m=document.getElementById('notifPrefsModal');
    if(!m) return;
    m.style.display='flex';
    document.getElementById('npMail').checked=this._prefs.mail!==false;
    document.getElementById('npSent').checked=this._prefs.sent!==false;
    document.getElementById('npWarning').checked=this._prefs.warning!==false;
    document.getElementById('npInfo').checked=this._prefs.info!==false;
    document.getElementById('npDailySummary').checked=!!this._prefs.dailySummaryEnabled;
    document.getElementById('npDailySummaryHour').value=this._prefs.dailySummaryHour||9;
    const ceoChk=document.getElementById('npDailyCEO');if(ceoChk) ceoChk.checked=!!this._prefs.dailySummaryCEO;
    document.getElementById('npWaWebhook').value=this._prefs.waWebhook||'';
    document.getElementById('npWaPhone').value=this._prefs.waPhone||'';
    this._toggleDailySummaryHour();
  },
  _toggleDailySummaryHour(){
    const el=document.getElementById('npDailySummaryHourRow');
    if(el) el.style.display=document.getElementById('npDailySummary')?.checked?'flex':'none';
  },
  closePrefs(){const m=document.getElementById('notifPrefsModal');if(m) m.style.display='none';},
  applyPrefs(){
    this._prefs.mail=document.getElementById('npMail').checked;
    this._prefs.sent=document.getElementById('npSent').checked;
    this._prefs.warning=document.getElementById('npWarning').checked;
    this._prefs.info=document.getElementById('npInfo').checked;
    this._prefs.dailySummaryEnabled=document.getElementById('npDailySummary').checked;
    this._prefs.dailySummaryHour=parseInt(document.getElementById('npDailySummaryHour').value)||9;
    const ceoChk=document.getElementById('npDailyCEO');if(ceoChk) this._prefs.dailySummaryCEO=ceoChk.checked;
    this._prefs.waWebhook=document.getElementById('npWaWebhook').value.trim();
    this._prefs.waPhone=document.getElementById('npWaPhone').value.trim();
    this.savePrefs();
    this.closePrefs();
    toast('Preferencias guardadas','success');
  },

  // ── RESUMEN DIARIO ───────────────────────────────────────────
  _summaryKey:'thelab_notif_daily_v1',
  checkDailySummary(){
    if(!this._prefs.dailySummaryEnabled) return;
    const now=new Date();
    const todayStr=now.toISOString().slice(0,10);
    if(localStorage.getItem(this._summaryKey)===todayStr) return;
    if(now.getHours()<(this._prefs.dailySummaryHour||9)) return;
    this.sendDailySummary(false);
  },
  async sendDailySummary(force=false){
    if(typeof MAIL==='undefined'||!MAIL.getMailPass||!MAIL.getMailPass()){
      toast('Configura tu clave de correo primero','error');return;
    }
    const todayStr=new Date().toISOString().slice(0,10);
    if(!force&&localStorage.getItem(this._summaryKey)===todayStr) return;
    const u=typeof AUTH!=='undefined'&&AUTH.getUser?AUTH.getUser():null;
    if(!u){toast('Inicia sesión para enviar el resumen','error');return;}
    const admins=(typeof AUTH!=='undefined'?AUTH.USERS:[]).filter(x=>x.role==='admin'||x.role==='gerencia').map(x=>x.username);
    if(!admins.includes(u.username)){toast('Solo los admin pueden enviar el resumen diario','error');return;}
    const criticas=this._hist.filter(i=>i.type==='warning'&&i.sub==='Crítico').slice(0,30);
    const rows=criticas.map(i=>`<tr><td style="padding:5px 10px;border-bottom:1px solid #2a2a2a;font-size:12px;white-space:nowrap">${this._fmtFull(i.time)}</td><td style="padding:5px 10px;border-bottom:1px solid #2a2a2a;font-size:12px">${this.esc(i.title)}</td></tr>`).join('');
    let ceoHtml='';
    if(this._prefs.dailySummaryCEO){
      try{
        if(typeof hasClaudeAccess==='function'&&hasClaudeAccess()&&typeof AGENTES_CFG!=='undefined'){
          const ceoCfg=AGENTES_CFG.find(a=>a.id==='CEO');
          if(ceoCfg){
            const ctx=state.loaded?buildAgentContext('CEO'):'';
            const analysis=await callClaude(ceoCfg.sys,ctx+'\n\nCONSULTA: Genera el reporte ejecutivo del día.');
            try{AGENT_LOG.add(ceoCfg.label,'Resumen diario automático',analysis);}catch(e){}
            ceoHtml=`<div style="margin-top:20px;background:#1a1a1a;border-radius:8px;padding:16px">
<h3 style="color:#00f3ff;margin:0 0 10px;font-size:14px">📊 Análisis CEO_AGENT</h3>
<pre style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:12px;color:#ccc;margin:0;line-height:1.6">${this.esc(analysis)}</pre></div>`.replace(/<pre[^>]*>[\s\S]*?<\/pre>/,_emailRich(analysis));
          }
        }
      }catch(e){/* el resumen se envía igual sin análisis CEO */}
    }
    // Snapshot de KPIs para la cabecera del resumen
    let kpiTable='';
    try{
      const _t=new Date();_t.setHours(0,0,0,0);const _ws=new Date(_t);_ws.setDate(_t.getDate()-_t.getDay());_ws.setHours(0,0,0,0);
      const _ped=state.pedidos||[],_cot=state.cotizaciones||[];
      const revSem=_ped.reduce((s,p)=>{const f=p.fields;if((f['Estado pedido']||'')==='Cancelado')return s;const d=p.createdTime?new Date(p.createdTime):null;return d&&d>=_ws?s+Math.round((f['Monto total (CLP)']||0)/1.19):s;},0);
      const pedAct=_ped.filter(p=>!['Despachado','Cancelado'].includes(p.fields['Estado pedido']||'')).length;
      const atras=_ped.filter(p=>{const f=p.fields;if(['Despachado','Cancelado'].includes(f['Estado pedido']||''))return false;return f['Fecha entrega']&&new Date(f['Fecha entrega'])<_t;}).length;
      const cotPend=_cot.filter(c=>['Enviada','Solicitada'].includes(c.fields['Estado cotización']||'')).length;
      const cell=(lb,val,col)=>`<td style="padding:12px;text-align:center;border:1px solid #222;background:#1a1a1a"><div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.5px">${lb}</div><div style="font-size:19px;font-weight:700;color:${col};margin-top:3px">${val}</div></td>`;
      kpiTable=`<table style="width:100%;border-collapse:collapse;margin-bottom:20px"><tr>${cell('Revenue sem.',formatCLP(revSem),'#00f3ff')}${cell('Pedidos activos',pedAct,'#fff')}${cell('Cot. pendientes',cotPend,'#ffaa00')}${cell('Atrasados',atras,atras>0?'#ff4444':'#4caf50')}</tr></table>`;
    }catch(e){}
    const body=`<div style="font-family:Arial,sans-serif;background:#0d0d0d;color:#fff;padding:24px;max-width:600px;margin:0 auto">
<div style="border-left:4px solid #00f3ff;padding-left:16px;margin-bottom:20px">
<h2 style="color:#00f3ff;margin:0 0 4px;font-size:18px">⚠️ Resumen de Alertas Críticas</h2>
<p style="color:#888;margin:0;font-size:13px">${new Date().toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p>
</div>
${kpiTable}
${criticas.length
  ?`<table style="width:100%;border-collapse:collapse;background:#1a1a1a;border-radius:8px;overflow:hidden">
<thead><tr style="background:#1f1f1f"><th style="text-align:left;padding:8px 10px;font-size:11px;color:#00f3ff;font-weight:600;letter-spacing:.5px;text-transform:uppercase">Hora</th><th style="text-align:left;padding:8px 10px;font-size:11px;color:#00f3ff;font-weight:600;letter-spacing:.5px;text-transform:uppercase">Alerta</th></tr></thead>
<tbody>${rows}</tbody></table>`
  :'<div style="background:#1a2a1a;border:1px solid #1a3a1a;border-radius:8px;padding:16px;text-align:center;color:#4caf50;font-size:14px">✔ Sin alertas críticas hoy</div>'}
${ceoHtml}
<p style="margin-top:24px;font-size:11px;color:#444;text-align:center">Dashboard The Lab Solutions — resumen automático</p></div>`;
    try{
      const r=await MAIL.post({action:'send',to:u.username,subject:`⚠ Resumen diario alertas — ${todayStr}`,body});
      if(r.ok){
        localStorage.setItem(this._summaryKey,todayStr);
        toast('Resumen diario enviado ✓','success');
        this.add('sent','Resumen diario enviado',`${criticas.length} alertas críticas reportadas`,'correo');
      }else{toast('Error al enviar resumen: '+(r.error||'desconocido'),'error');}
    }catch(e){toast('Error al enviar resumen','error');}
  },

  // ── WHATSAPP ─────────────────────────────────────────────────
  async _sendWhatsApp(msg){
    const url=this._prefs.waWebhook;
    const phone=this._prefs.waPhone;
    if(!url) return;
    try{
      await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({phone:phone||'',message:'⚠ Alerta crítica The Lab:\n'+msg,source:'thelab-dashboard',timestamp:new Date().toISOString()})
      });
    }catch(e){}
  }
}

// ── POLLING DE CORREO ──────────────────────────────────────────
let _mailPollTimer = null;
let _mailLastUnseen = -1;
let _notifPermission = false;
const _POLL_INTERVAL = 30000; // 30 segundos
const _BASE_TITLE = document.title;

// Solicita permiso para notificaciones del sistema operativo
async function requestWebNotifPermission(){
  if(!('Notification' in window)) return;
  if(Notification.permission==='granted'){ _notifPermission=true; return; }
  if(Notification.permission==='denied') return;
  const p=await Notification.requestPermission();
  _notifPermission=(p==='granted');
}

// Muestra notificación nativa del SO (visible aunque el navegador esté minimizado)
function showOsNotif(title, body, onClick){
  if(!_notifPermission || Notification.permission!=='granted') return;
  try{
    const n=new Notification(title,{
      body,
      icon:'https://dashboard.thelab.solutions/logo-thelab.png',
      tag:'thelab-mail',
      renotify:true,
    });
    n.onclick=()=>{ window.focus(); if(onClick) onClick(); n.close(); };
    setTimeout(()=>n.close(), 8000);
  }catch(e){}
}

// Actualiza el título de la pestaña con el contador de no leídos
function updateTabTitle(unseen){
  document.title = unseen>0 ? `(${unseen}) ${_BASE_TITLE}` : _BASE_TITLE;
  try{
    const b=document.getElementById('mailBadge');
    if(b){ b.textContent = unseen>99?'99+':unseen; b.style.display = unseen>0?'flex':'none'; }
  }catch(e){}
}

// Tono sutil de dos notas con Web Audio (sin archivos externos)
function playMailSound(){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const play=(freq,start,dur)=>{
      const o=ctx.createOscillator(),g=ctx.createGain();
      o.connect(g);g.connect(ctx.destination);
      o.frequency.value=freq;o.type='sine';
      g.gain.setValueAtTime(0.001,ctx.currentTime+start);
      g.gain.exponentialRampToValueAtTime(0.12,ctx.currentTime+start+0.02);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+start+dur);
      o.start(ctx.currentTime+start);o.stop(ctx.currentTime+start+dur+0.05);
    };
    play(880,0,0.18);play(1174.66,0.15,0.22);
    setTimeout(()=>ctx.close(),800);
  }catch(e){}
}

let _mailPollErrors = 0;
async function _mailCheck(){
  if(document.hidden) return;          // no consultar el servidor de correo con la pestaña oculta
  if(!MAIL.getMailPass || !MAIL.getMailPass()) return;
  try{
    const data = await MAIL.post({action:'check'});
    if(data.error){
      // Backoff: tras 10 errores consecutivos (clave inválida, server caído)
      // se detiene el polling para no martillar el servidor
      if(++_mailPollErrors>=10){
        clearInterval(_mailPollTimer);_mailPollTimer=null;
        console.warn('Polling de correo detenido tras errores repetidos:',data.error);
      }
      return;
    }
    _mailPollErrors=0;
    const unseen = data.unseen ?? 0;
    updateTabTitle(unseen);
    if(_mailLastUnseen >= 0 && unseen > _mailLastUnseen){
      const n = unseen - _mailLastUnseen;
      const title = `${n} correo${n>1?'s':''} nuevo${n>1?'s':''}`;
      NOTIFY.add('mail', title, 'Bandeja de entrada', 'correo');
      playMailSound();
      showOsNotif(`✉️ ${title}`, 'Haz clic para abrir el correo', ()=>switchTab('correo'));
      const active = sessionStorage.getItem('thelab_active_tab');
      if(active==='correo'){ MAIL.loadMessages(); MAIL.loadFolders(); }
    }
    _mailLastUnseen = unseen;
  }catch(e){}
}

function startMailPolling(){
  if(_mailPollTimer) return;
  // Establece el baseline inmediatamente (sin notificar), luego empieza el polling
  setTimeout(async()=>{
    if(!MAIL.getMailPass || !MAIL.getMailPass()) return;
    try{
      const data = await MAIL.post({action:'check'});
      if(!data.error) _mailLastUnseen = data.unseen ?? 0;
      updateTabTitle(_mailLastUnseen);
    }catch(e){}
    // Ahora sí arranca el intervalo de detección
    _mailPollTimer = setInterval(_mailCheck, _POLL_INTERVAL);
  }, 4000); // espera 4s a que cargue la bandeja inicial
  // Solicita permiso para notificaciones del SO
  requestWebNotifPermission();
}

// ── CORREO ────────────────────────────────────────────────────