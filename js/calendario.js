/* js/calendario.js — CALENDARIO de equipo: eventos de Nicanor, Gustavo y Florencia
   con alarmas/notificaciones y sincronización al Google Calendar personal de cada uno.

   · Almacén local compartido (thelab_calendario_v1) + respaldo/sincronización vía
     Airtable (Monitor Sistema » CALENDARIO), con el mismo patrón de fusión por mts
     y lápidas (del) que la agenda de equipo — casi en vivo entre navegadores.
   · Google: OAuth GIS (mismo Client ID que Drive) con scope calendar.events.
     Cada evento se escribe en el calendario personal de cada persona asignada
     (mapa persona→email). Si la cuenta conectada no puede escribir directo en ese
     calendario, cae a modo invitación (evento en "primary" con la persona como
     invitada — llega igual a su Google Calendar).
   · Alarmas: recordatorios de Google (popup/email) + aviso en la app (campana y
     notificación del navegador) minutos antes del evento.                        */

// ── Estado / almacén ──────────────────────────────────────────────────────────
const _CAL_KEY='thelab_calendario_v1';
const _CAL_GMAP_KEY='thelab_cal_gmap_v1';
const _CAL_FIRED_KEY='thelab_cal_fired_v1';
const CAL_PERSONA_IDS=['nicanor','gustavo','florencia'];
let _calMes=(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1);})();
let _calFiltro='todos';
let _calPollTimer=null,_calAlarmTimer=null;

function _calPersonas(){try{return (typeof PERSONAS!=='undefined'?PERSONAS:[]).filter(p=>CAL_PERSONA_IDS.includes(p.id));}catch(e){return[];}}
function _calPersona(id){return _calPersonas().find(p=>p.id===id)||null;}
function _calAll(){try{const a=JSON.parse(localStorage.getItem(_CAL_KEY)||'[]');return Array.isArray(a)?a:[];}catch(e){return[];}}
function _calSaveLocal(arr){try{localStorage.setItem(_CAL_KEY,JSON.stringify(arr));}catch(e){}}
function _calSave(arr){_calSaveLocal(arr);_calBackup();}

// Mapa persona → email de Google Calendar (compartido vía respaldo remoto)
function _calGmap(){try{const g=JSON.parse(localStorage.getItem(_CAL_GMAP_KEY)||'{}');return{map:(g&&g.map)||{},mts:(g&&g.mts)||0};}catch(e){return{map:{},mts:0};}}
function _calGmapSave(map){try{localStorage.setItem(_CAL_GMAP_KEY,JSON.stringify({map,mts:Date.now()}));}catch(e){}}

// ── Fusión tolerante a ediciones concurrentes (mismo modelo que la agenda) ────
// Por id gana la marca más reciente (mts); "del" es adhesivo; los enlaces a
// Google (gcal) se unen de ambas copias para que el estado de sync no se pierda.
function _calMerge(a,b){
  const by={};
  const put=it=>{ if(!it||!it.id) return; const p=by[it.id];
    if(!p){ by[it.id]={...it}; return; }
    const tp=+(p.mts||p.ts||0), ti=+(it.mts||it.ts||0);
    const base=ti>=tp?{...it}:{...p};
    base.del=!!(p.del||it.del);
    base.gcal={...((ti>=tp?p:it).gcal||{}),...((ti>=tp?it:p).gcal||{})};
    base.gsyncMts=Math.max(+(p.gsyncMts||0),+(it.gsyncMts||0));
    base.mts=Math.max(tp,ti)||base.mts||base.ts||0;
    by[it.id]=base;
  };
  (Array.isArray(a)?a:[]).forEach(put);
  (Array.isArray(b)?b:[]).forEach(put);
  return Object.values(by);
}
function _calPrune(arr){
  const cut=Date.now()-60*864e5;                     // lápidas: 60 días
  const cutOld=Date.now()-400*864e5;                 // eventos pasados: ~13 meses
  return (Array.isArray(arr)?arr:[]).filter(it=>{
    if(!it||!it.id) return false;
    if(it.del) return (+(it.mts||it.ts||0))>=cut||Object.keys(it.gcal||{}).length>0;
    const t=Date.parse((it.fecha||'1970-01-01')+'T00:00:00');
    return !(t&&t<cutOld);
  });
}
// El respaldo cabe en el campo Notes (~95k): si se pasa, suelta lo más viejo ya pasado.
function _calFitBudget(events){
  let out=events.slice();
  const hoy=new Date().toISOString().slice(0,10);
  while(JSON.stringify(out).length>88000&&out.length>10){
    const past=out.filter(e=>!e.del&&e.fecha<hoy).sort((x,y)=>String(x.fecha).localeCompare(String(y.fecha)));
    if(!past.length) break;
    out=out.filter(e=>e.id!==past[0].id);
  }
  return out;
}
// Reconcilia el blob remoto {events,gmap,gmapMts} con lo local. true si cambió algo.
function _calReconcile(all){
  try{
    if(!all||typeof all!=='object') return false;
    let changed=false;
    // gmap: gana el más reciente
    const gmLocal=_calGmap();
    if(+(all.gmapMts||0)>gmLocal.mts&&all.gmap&&typeof all.gmap==='object'){
      try{localStorage.setItem(_CAL_GMAP_KEY,JSON.stringify({map:all.gmap,mts:+all.gmapMts}));}catch(e){}
      changed=true;
    }
    const remoteArr=Array.isArray(all.events)?all.events:[];
    const before=JSON.stringify(_calAll());
    const merged=_calPrune(_calMerge(_calAll(),remoteArr));
    if(JSON.stringify(merged)!==before){_calSaveLocal(merged);changed=true;}
    if(changed){
      try{const p=document.getElementById('tab-calendario');if(p&&p.classList.contains('active'))renderCalendario();}catch(e){}
      _calAutoSync();   // si este navegador tiene Google conectado, empuja pendientes (incl. borrados de otros)
    }
    return changed;
  }catch(e){return false;}
}
async function _calBackup(){
  try{
    const u=(typeof AUTH!=='undefined'&&AUTH.getUser&&AUTH.getUser())||{};if(!u.username)return;
    let prev={};try{prev=JSON.parse(state._calRemote||'{}');}catch(e){}
    const gm=_calGmap();
    const events=_calFitBudget(_calPrune(_calMerge(_calAll(),Array.isArray(prev.events)?prev.events:[])));
    _calSaveLocal(events);
    const gmapMts=Math.max(gm.mts,+(prev.gmapMts||0));
    const gmap=gm.mts>=+(prev.gmapMts||0)?gm.map:(prev.gmap||gm.map);
    const notes=JSON.stringify({events,gmap,gmapMts}).slice(0,95000);
    if(state.calRecordId) await airtableWrite('Monitor Sistema','PATCH',state.calRecordId,{'Notes':notes});
    else{const r=await airtableWrite('Monitor Sistema','POST',null,{'Name':'CALENDARIO','Notes':notes});if(r?.id)state.calRecordId=r.id;}
    state._calRemote=notes;
  }catch(e){}
}
// Poll liviano: relee SÓLO el registro CALENDARIO cada 20s con la pestaña visible.
async function _calPoll(){
  try{
    if(document.visibilityState!=='visible'||!navigator.onLine) return;
    if(typeof hasAirtableAccess==='function'&&!hasAirtableAccess()) return;
    if(!state.calRecordId||!(AUTH.getUser&&AUTH.getUser())) return;
    const r=await _atFetch(`/${BASE_ID}/${encodeURIComponent('Monitor Sistema')}/${state.calRecordId}`,{headers:{}});
    if(!r||!r.ok) return;
    const rec=await r.json();
    const notes=(rec&&rec.fields&&rec.fields['Notes'])||'{}';
    state._calRemote=notes;
    _calReconcile(JSON.parse(notes));
  }catch(e){}
}
function startCalSync(){ if(_calPollTimer) clearInterval(_calPollTimer); _calPollTimer=setInterval(_calPoll,20000); }

// ── Google Calendar (OAuth GIS, mismo Client ID que Drive) ────────────────────
let _calTokenClient=null,_calAccessToken=null,_calTokenExp=0;
function _calClientId(){
  try{if(typeof _driveGetClientId==='function')return _driveGetClientId();}catch(e){}
  try{return localStorage.getItem('google_drive_client_id')||'';}catch(e){return'';}
}
function _calTokenVigente(){return !!(_calAccessToken&&Date.now()<_calTokenExp-60000);}
function _calGetToken(){
  return new Promise((resolve,reject)=>{
    if(_calTokenVigente()){resolve(_calAccessToken);return;}
    const cid=_calClientId();
    if(!cid||String(cid).startsWith('%%')){reject(new Error('Configura el Google Client ID en ⚙️ Mi cuenta (el mismo de Drive)'));return;}
    if(typeof google==='undefined'||!google.accounts){reject(new Error('SDK de Google aún no carga — reintenta en unos segundos'));return;}
    if(!_calTokenClient){
      _calTokenClient=google.accounts.oauth2.initTokenClient({
        client_id:cid,
        scope:'https://www.googleapis.com/auth/calendar.events',
        callback:(resp)=>{
          if(resp.error){reject(new Error('OAuth: '+resp.error));return;}
          _calAccessToken=resp.access_token;
          _calTokenExp=Date.now()+(resp.expires_in||3600)*1000;
          try{_calRenderSyncStatus();}catch(e){}
          resolve(_calAccessToken);
        }
      });
    }
    _calTokenClient.requestAccessToken({prompt:_calAccessToken?'':'select_account'});
  });
}
async function _calApi(path,method,body){
  const token=await _calGetToken();
  const r=await fetch('https://www.googleapis.com/calendar/v3'+path,{
    method:method||'GET',
    headers:{'Authorization':'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined
  });
  if(r.status===204) return {};
  const j=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error('HTTP '+r.status+': '+((j.error&&j.error.message)||r.statusText));
  return j;
}
function _calGcalBody(ev,mode,target){
  const TZ='America/Santiago';
  const body={summary:ev.titulo||'(sin título)',description:ev.desc||'',location:ev.lugar||''};
  if(ev.allDay){
    const fin=new Date(ev.fecha+'T00:00:00');fin.setDate(fin.getDate()+1);
    body.start={date:ev.fecha};
    body.end={date:fin.toISOString().slice(0,10)};
  }else{
    body.start={dateTime:ev.fecha+'T'+(ev.hIni||'09:00')+':00',timeZone:TZ};
    body.end={dateTime:ev.fecha+'T'+(ev.hFin||ev.hIni||'10:00')+':00',timeZone:TZ};
  }
  const ovr=[];
  if(ev.alarmMin!=null&&ev.alarmMin>=0)ovr.push({method:'popup',minutes:+ev.alarmMin});
  if(ev.emailMin!=null&&ev.emailMin>=0)ovr.push({method:'email',minutes:+ev.emailMin});
  body.reminders=ovr.length?{useDefault:false,overrides:ovr}:{useDefault:true};
  if(mode==='invite'&&target)body.attendees=[{email:target}];
  return body;
}
// Empuja UN evento a Google: escribe/actualiza/borra en el calendario de cada persona.
async function _calSyncEvento(ev){
  const gm=_calGmap().map;ev.gcal=ev.gcal||{};const errs=[];
  // 1) borrar copias de personas quitadas o de eventos eliminados
  for(const pid of Object.keys(ev.gcal)){
    if(ev.del||!(ev.personas||[]).includes(pid)){
      const g=ev.gcal[pid];
      try{await _calApi('/calendars/'+encodeURIComponent(g.cal)+'/events/'+encodeURIComponent(g.ev)+'?sendUpdates=all','DELETE');delete ev.gcal[pid];}
      catch(e){ if(/HTTP (404|410)/.test(e.message)){delete ev.gcal[pid];} else errs.push(pid+': '+e.message); }
    }
  }
  // 2) crear/actualizar para las personas asignadas
  if(!ev.del){
    for(const pid of (ev.personas||[])){
      const target=String(gm[pid]||'').trim();if(!target)continue;
      const g=ev.gcal[pid];
      try{
        if(g){await _calApi('/calendars/'+encodeURIComponent(g.cal)+'/events/'+encodeURIComponent(g.ev)+'?sendUpdates=all','PATCH',_calGcalBody(ev,g.mode,target));}
        else{
          let created=null,mode='direct',cal=target;
          try{created=await _calApi('/calendars/'+encodeURIComponent(target)+'/events?sendUpdates=all','POST',_calGcalBody(ev,'direct',target));}
          catch(e){
            if(/HTTP (403|404)/.test(e.message)){mode='invite';cal='primary';created=await _calApi('/calendars/primary/events?sendUpdates=all','POST',_calGcalBody(ev,'invite',target));}
            else throw e;
          }
          ev.gcal[pid]={cal,ev:created.id,mode};
        }
      }catch(e){errs.push(pid+': '+e.message);}
    }
  }
  if(!errs.length)ev.gsyncMts=ev.mts||Date.now();
  return errs;
}
function _calNeedsSync(ev){
  const gm=_calGmap().map;
  if(ev.del)return Object.keys(ev.gcal||{}).length>0;
  const falta=(ev.personas||[]).some(pid=>String(gm[pid]||'').trim()&&!(ev.gcal||{})[pid]);
  const sobra=Object.keys(ev.gcal||{}).some(pid=>!(ev.personas||[]).includes(pid));
  const editado=(+(ev.gsyncMts||0))<(+(ev.mts||0))&&Object.keys(ev.gcal||{}).length>0;
  return falta||sobra||editado;
}
async function calSyncAll(){
  const btn=document.getElementById('calSyncBtn');if(btn){btn.disabled=true;btn.textContent='Sincronizando…';}
  try{
    await _calGetToken();   // interactivo si hace falta
    const arr=_calAll();const pend=arr.filter(_calNeedsSync);
    if(!pend.length){toast('✓ Todo sincronizado con Google','success');}
    else{
      let ok=0;const errs=[];
      for(const ev of pend){const e=await _calSyncEvento(ev);if(e.length)errs.push(...e);else ok++;}
      _calSave(arr);
      if(errs.length)toast(`Sincronizados ${ok}/${pend.length} · errores: ${errs[0]}`,'error');
      else toast(`✓ ${ok} evento${ok!==1?'s':''} sincronizado${ok!==1?'s':''} con Google`,'success');
    }
  }catch(e){toast('Google: '+e.message,'error');}
  if(btn){btn.disabled=false;btn.textContent='⇅ Sincronizar';}
  renderCalendario();
}
// Silencioso: sólo si ya hay token vigente en memoria (nunca abre popup).
async function _calAutoSync(){
  try{
    if(!_calTokenVigente())return;
    const arr=_calAll();const pend=arr.filter(_calNeedsSync);
    if(!pend.length)return;
    let changed=false;
    for(const ev of pend){const e=await _calSyncEvento(ev);if(!e.length)changed=true;}
    if(changed){_calSave(arr);try{renderCalendario();}catch(e){}}
  }catch(e){}
}
async function calGoogleConnect(){
  try{await _calGetToken();toast('✓ Google Calendar conectado','success');_calRenderSyncStatus();_calAutoSync();}
  catch(e){toast(e.message,'error');}
}

// ── Alarmas / notificaciones en la app ────────────────────────────────────────
function _calFired(){try{return JSON.parse(localStorage.getItem(_CAL_FIRED_KEY)||'{}');}catch(e){return{};}}
function _calFiredSave(m){
  const cut=Date.now()-7*864e5;
  Object.keys(m).forEach(k=>{if(m[k]<cut)delete m[k];});
  try{localStorage.setItem(_CAL_FIRED_KEY,JSON.stringify(m));}catch(e){}
}
function _calAlarmTick(){
  try{
    const now=Date.now();
    const desde=new Date(now-2*864e5).toISOString().slice(0,10);
    const hasta=new Date(now+2*864e5).toISOString().slice(0,10);
    const fired=_calFired();let dirty=false;
    _calAll().forEach(ev=>{
      if(ev.del||ev.alarmMin==null||ev.avisoApp===false)return;
      if(!ev.fecha||ev.fecha<desde||ev.fecha>hasta)return;
      const ini=new Date(ev.fecha+'T'+(ev.allDay?'09:00':(ev.hIni||'09:00'))+':00').getTime();
      const fire=ini-(+ev.alarmMin)*60000;
      if(now>=fire&&now<ini+5*60000){
        const k=ev.id+'@'+ev.fecha;
        if(fired[k])return;
        fired[k]=now;dirty=true;
        const quien=(ev.personas||[]).map(p=>{const per=_calPersona(p);return per?per.nombre.split(' ')[0]:p;}).join(', ');
        const sub=(ev.allDay?'Todo el día':((ev.hIni||'')+(ev.hFin?'–'+ev.hFin:'')))+(quien?' · '+quien:'');
        try{NOTIFY.add('warning','📅 '+(ev.titulo||'Evento'),sub,"switchTab('calendario')");}catch(e){try{toast('📅 '+(ev.titulo||'Evento')+' · '+sub,'info');}catch(_){}}
        try{if(typeof Notification!=='undefined'&&Notification.permission==='granted')new Notification('📅 '+(ev.titulo||'Evento'),{body:sub});}catch(e){}
      }
    });
    if(dirty)_calFiredSave(fired);
  }catch(e){}
}
function startCalAlarmas(){ if(_calAlarmTimer) clearInterval(_calAlarmTimer); _calAlarmTimer=setInterval(_calAlarmTick,30000); setTimeout(_calAlarmTick,3000); }
function calPedirPermisoAvisos(){
  try{
    if(typeof Notification==='undefined'){toast('Este navegador no soporta notificaciones','error');return;}
    if(Notification.permission==='granted'){toast('✓ Avisos del navegador ya permitidos','success');return;}
    Notification.requestPermission().then(p=>{toast(p==='granted'?'✓ Avisos del navegador activados':'Avisos no permitidos — igual verás la campana 🔔 de la app',p==='granted'?'success':'info');_calRenderSyncStatus();});
  }catch(e){}
}

// ── UI: render ────────────────────────────────────────────────────────────────
function _calFmtFecha(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function _calEventosDia(f){
  return _calAll().filter(ev=>!ev.del&&ev.fecha===f&&(_calFiltro==='todos'||(ev.personas||[]).includes(_calFiltro)))
    .sort((a,b)=>(a.allDay?'00:00':(a.hIni||'09:00')).localeCompare(b.allDay?'00:00':(b.hIni||'09:00')));
}
function _calColor(ev){const p=_calPersona((ev.personas||[])[0]);return (p&&p.color)||'var(--accent)';}
function calNavMes(d){_calMes=new Date(_calMes.getFullYear(),_calMes.getMonth()+d,1);renderCalendario();}
function calHoy(){const d=new Date();_calMes=new Date(d.getFullYear(),d.getMonth(),1);renderCalendario();}
function calSetFiltro(pid){_calFiltro=pid;renderCalendario();}
function renderCalendario(){
  const grid=document.getElementById('calGrid');if(!grid)return;
  const lbl=document.getElementById('calMesLabel');
  if(lbl)lbl.textContent=_calMes.toLocaleDateString('es-CL',{month:'long',year:'numeric'}).replace(/^./,c=>c.toUpperCase());
  // chips de filtro
  const chips=document.getElementById('calFiltroChips');
  if(chips)chips.innerHTML=[`<button class="cal-chip ${_calFiltro==='todos'?'on':''}" onclick="calSetFiltro('todos')">Todos</button>`]
    .concat(_calPersonas().map(p=>`<button class="cal-chip ${_calFiltro===p.id?'on':''}" style="--chip:${p.color}" onclick="calSetFiltro('${p.id}')"><span class="cal-dot" style="background:${p.color}"></span>${p.nombre.split(' ')[0]}</button>`)).join('');
  // grilla del mes (semana parte lunes)
  const y=_calMes.getFullYear(),m=_calMes.getMonth();
  const first=new Date(y,m,1);
  const start=new Date(first);start.setDate(first.getDate()-((first.getDay()+6)%7));
  const hoy=_calFmtFecha(new Date());
  const dows=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  let h='<div class="cal-head">'+dows.map(d=>`<div class="cal-dow">${d}</div>`).join('')+'</div><div class="cal-body">';
  const cur=new Date(start);
  for(let w=0;w<6;w++){
    for(let i=0;i<7;i++){
      const f=_calFmtFecha(cur);
      const other=cur.getMonth()!==m;
      const evs=_calEventosDia(f);
      const chipsEv=evs.slice(0,3).map(ev=>{
        const hora=ev.allDay?'●':(ev.hIni||'');
        const pend=_calNeedsSync(ev)?' cal-pend':'';
        return `<div class="cal-ev${pend}" style="border-left-color:${_calColor(ev)}" onclick="event.stopPropagation();openCalEventoModal(null,'${ev.id}')" title="${escapeHtml(ev.titulo||'')}${_calNeedsSync(ev)?' · pendiente de sincronizar con Google':''}"><span class="cal-ev-h">${escapeHtml(hora)}</span> ${escapeHtml(ev.titulo||'')}</div>`;
      }).join('')+(evs.length>3?`<div class="cal-mas" onclick="event.stopPropagation();openCalDiaModal('${f}')">+${evs.length-3} más</div>`:'');
      h+=`<div class="cal-cell${other?' other':''}${f===hoy?' today':''}" onclick="openCalEventoModal('${f}')"><div class="cal-num">${cur.getDate()}</div>${chipsEv}</div>`;
      cur.setDate(cur.getDate()+1);
    }
  }
  h+='</div>';
  grid.innerHTML=h;
  renderCalProximos();
  _calRenderSyncStatus();
}
function renderCalProximos(){
  const el=document.getElementById('calProximos');if(!el)return;
  const hoy=new Date();hoy.setHours(0,0,0,0);
  const out=[];
  for(let i=0;i<7;i++){
    const d=new Date(hoy);d.setDate(hoy.getDate()+i);
    const f=_calFmtFecha(d);
    const evs=_calEventosDia(f);
    if(!evs.length)continue;
    const dia=i===0?'Hoy':i===1?'Mañana':d.toLocaleDateString('es-CL',{weekday:'long',day:'numeric'});
    out.push(`<div class="cal-px-dia">${escapeHtml(dia.replace(/^./,c=>c.toUpperCase()))}</div>`+evs.map(ev=>{
      const quien=(ev.personas||[]).map(p=>{const per=_calPersona(p);return per?`<span class="cal-dot" style="background:${per.color}" title="${escapeHtml(per.nombre)}"></span>`:'';}).join('');
      const alarma=ev.alarmMin!=null?` <span title="Alarma ${ev.alarmMin} min antes">🔔</span>`:'';
      return `<div class="cal-px-ev" onclick="openCalEventoModal(null,'${ev.id}')"><span class="cal-px-h">${ev.allDay?'Todo el día':escapeHtml(ev.hIni||'')}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(ev.titulo||'')}${alarma}</span>${quien}</div>`;
    }).join(''));
  }
  el.innerHTML=out.length?out.join(''):'<div style="font-size:12px;color:var(--text3);padding:10px 4px">Sin eventos en los próximos 7 días — crea uno con “+ Evento”.</div>';
}
function _calRenderSyncStatus(){
  const el=document.getElementById('calSyncStatus');if(!el)return;
  const gm=_calGmap().map;
  const conf=CAL_PERSONA_IDS.filter(p=>String(gm[p]||'').trim()).length;
  const pend=_calAll().filter(_calNeedsSync).length;
  const gOK=_calTokenVigente();
  const notif=(typeof Notification!=='undefined'&&Notification.permission==='granted');
  el.innerHTML=`<span style="color:${gOK?'var(--accent3)':'var(--text3)'}">${gOK?'🟢 Google conectado':'⚪ Google sin conectar'}</span>
    · <span style="color:${conf===3?'var(--accent3)':'var(--warn)'}">${conf}/3 calendarios configurados</span>
    ${pend?` · <span style="color:var(--warn)">${pend} pendiente${pend!==1?'s':''} de sincronizar</span>`:' · <span style="color:var(--accent3)">✓ al día</span>'}
    ${notif?'':' · <span style="color:var(--text3)">avisos del navegador desactivados</span>'}`;
}

// ── Modal evento ──────────────────────────────────────────────────────────────
let _calEditId=null,_calModalPersonas=new Set();
function openCalEventoModal(fecha,id){
  const m=document.getElementById('calEventoModal');if(!m)return;
  _calEditId=id||null;_calModalPersonas=new Set();
  const ev=id?_calAll().find(x=>x.id===id):null;
  document.getElementById('calMdlTitle').textContent=ev?'Editar evento':'Nuevo evento';
  document.getElementById('calEvTitulo').value=ev?(ev.titulo||''):'';
  document.getElementById('calEvFecha').value=ev?ev.fecha:(fecha||_calFmtFecha(new Date()));
  document.getElementById('calEvAllDay').checked=!!(ev&&ev.allDay);
  document.getElementById('calEvHIni').value=ev?(ev.hIni||'10:00'):'10:00';
  document.getElementById('calEvHFin').value=ev?(ev.hFin||'11:00'):'11:00';
  document.getElementById('calEvLugar').value=ev?(ev.lugar||''):'';
  document.getElementById('calEvDesc').value=ev?(ev.desc||''):'';
  document.getElementById('calEvAlarma').value=ev?(ev.alarmMin==null?'':String(ev.alarmMin)):'30';
  document.getElementById('calEvEmail').value=ev?(ev.emailMin==null?'':String(ev.emailMin)):'';
  document.getElementById('calEvAvisoApp').checked=ev?ev.avisoApp!==false:true;
  (ev?(ev.personas||[]):[]).forEach(p=>_calModalPersonas.add(p));
  if(!ev){const u=AUTH.getUser&&AUTH.getUser();const mio=u?String(u.username||'').split('@')[0]:'';if(CAL_PERSONA_IDS.includes(mio))_calModalPersonas.add(mio);}
  _calRenderModalPersonas();
  calToggleAllDay();
  const del=document.getElementById('calEvDelBtn');if(del)del.style.display=ev?'':'none';
  const syncInfo=document.getElementById('calEvSyncInfo');
  if(syncInfo){
    if(ev&&Object.keys(ev.gcal||{}).length){
      syncInfo.innerHTML='En Google: '+Object.entries(ev.gcal).map(([pid,g])=>{const per=_calPersona(pid);return `<span class="badge badge-green" style="font-size:9px">${per?per.nombre.split(' ')[0]:pid}${g.mode==='invite'?' (invitación)':''}</span>`;}).join(' ');
      syncInfo.style.display='';
    }else syncInfo.style.display='none';
  }
  m.style.display='flex';
  setTimeout(()=>{try{document.getElementById('calEvTitulo').focus();}catch(e){}},60);
}
function closeCalEventoModal(){const m=document.getElementById('calEventoModal');if(m)m.style.display='none';_calEditId=null;}
function _calRenderModalPersonas(){
  const box=document.getElementById('calEvPersonas');if(!box)return;
  box.innerHTML=_calPersonas().map(p=>`<button type="button" class="cal-pchip ${_calModalPersonas.has(p.id)?'on':''}" style="--chip:${p.color}" onclick="calTogglePersona('${p.id}')"><span class="cal-dot" style="background:${p.color}"></span>${p.nombre.split(' ')[0]}</button>`).join('');
}
function calTogglePersona(pid){
  if(_calModalPersonas.has(pid))_calModalPersonas.delete(pid);else _calModalPersonas.add(pid);
  _calRenderModalPersonas();
}
function calToggleAllDay(){
  const all=document.getElementById('calEvAllDay').checked;
  const horas=document.getElementById('calEvHoras');if(horas)horas.style.display=all?'none':'';
}
function calSaveEvento(){
  const titulo=(document.getElementById('calEvTitulo').value||'').trim();
  const fecha=document.getElementById('calEvFecha').value;
  if(!titulo){toast('Ponle un título al evento','error');return;}
  if(!fecha){toast('Elige la fecha','error');return;}
  if(!_calModalPersonas.size){toast('Elige al menos una persona (Nicanor, Gustavo o Florencia)','error');return;}
  const allDay=document.getElementById('calEvAllDay').checked;
  let hIni=document.getElementById('calEvHIni').value,hFin=document.getElementById('calEvHFin').value;
  if(!allDay){
    if(!hIni){toast('Falta la hora de inicio','error');return;}
    if(!hFin||hFin<=hIni){const[hh,mm]=hIni.split(':').map(Number);hFin=String(Math.min(23,hh+1)).padStart(2,'0')+':'+String(mm).padStart(2,'0');}
  }
  const alarmRaw=document.getElementById('calEvAlarma').value;
  const emailRaw=document.getElementById('calEvEmail').value;
  const arr=_calAll();
  const u=(AUTH.getUser&&AUTH.getUser())||{};
  let ev=_calEditId?arr.find(x=>x.id===_calEditId):null;
  if(!ev){ev={id:'ev'+Date.now()+Math.floor(Math.random()*1000),ts:Date.now(),creadoPor:u.username||'',gcal:{}};arr.push(ev);}
  ev.titulo=titulo;ev.fecha=fecha;ev.allDay=allDay;
  ev.hIni=allDay?null:hIni;ev.hFin=allDay?null:hFin;
  ev.personas=[..._calModalPersonas];
  ev.lugar=(document.getElementById('calEvLugar').value||'').trim();
  ev.desc=(document.getElementById('calEvDesc').value||'').trim();
  ev.alarmMin=alarmRaw===''?null:+alarmRaw;
  ev.emailMin=emailRaw===''?null:+emailRaw;
  ev.avisoApp=document.getElementById('calEvAvisoApp').checked;
  ev.mts=Date.now();
  _calSave(arr);
  closeCalEventoModal();
  toast('✓ Evento guardado','success');
  renderCalendario();
  _calAutoSync();
}
function calDelEvento(){
  if(!_calEditId)return;
  const arr=_calAll();const ev=arr.find(x=>x.id===_calEditId);
  if(ev){ev.del=true;ev.mts=Date.now();}
  _calSave(arr);
  closeCalEventoModal();
  toast('Evento eliminado','info');
  renderCalendario();
  _calAutoSync();
}
// Día con muchos eventos → abre el modal de nuevo evento de ese día (lista completa visible en Próximos)
function openCalDiaModal(f){openCalEventoModal(f);}

// ── Config: mapa persona → Google Calendar (email) ────────────────────────────
function calToggleConfig(){
  const box=document.getElementById('calCfgBox');if(!box)return;
  const show=box.style.display==='none';
  if(show){
    const gm=_calGmap().map;
    CAL_PERSONA_IDS.forEach(p=>{const i=document.getElementById('calCfg_'+p);if(i)i.value=gm[p]||'';});
  }
  box.style.display=show?'':'none';
}
function calSaveConfig(){
  const map={};
  let bad=null;
  CAL_PERSONA_IDS.forEach(p=>{
    const v=String((document.getElementById('calCfg_'+p)||{}).value||'').trim();
    if(v&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))bad=p;
    map[p]=v;
  });
  if(bad){toast('El correo de '+bad+' no parece válido','error');return;}
  _calGmapSave(map);
  _calBackup();
  toast('✓ Calendarios guardados','success');
  _calRenderSyncStatus();
}
