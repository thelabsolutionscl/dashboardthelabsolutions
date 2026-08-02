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
const _CAL_CRM_SYNC_KEY='thelab_cal_crm_sync_v1';
const _CAL_SYNC_PREF_KEY='thelab_cal_sync_pref_v1';
const CAL_PERSONA_IDS=['nicanor','gustavo','florencia'];
let _calMes=(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1);})();
let _calFiltro='todos';
let _calTipoFiltro='todos';
let _calVista='mes';
let _calPollTimer=null,_calAlarmTimer=null;
let _calEnsureRequested=false,_calDragId='';

function _calPersonas(){try{return (typeof PERSONAS!=='undefined'?PERSONAS:[]).filter(p=>CAL_PERSONA_IDS.includes(p.id));}catch(e){return[];}}
function _calPersona(id){return _calPersonas().find(p=>p.id===id)||null;}
function _calAll(){try{const a=JSON.parse(localStorage.getItem(_CAL_KEY)||'[]');return Array.isArray(a)?a:[];}catch(e){return[];}}
function _calSaveLocal(arr){try{localStorage.setItem(_CAL_KEY,JSON.stringify(arr));}catch(e){}}
function _calSave(arr){_calSaveLocal(arr);_calBackup();}

// ── Vencimientos derivados desde el CRM ─────────────────────────────────────
// Las fechas de Cotizaciones/Pedidos siguen teniendo a Airtable como fuente de
// verdad. El calendario sólo genera eventos virtuales con ids estables: así una
// edición se refleja inmediatamente y Google actualiza el mismo evento.
function _calToday(){const d=new Date();d.setHours(0,0,0,0);return d;}
function _calDate(value){const d=value?new Date(String(value).slice(0,10)+'T00:00:00'):null;return d&&!isNaN(d)?d:null;}
function _calDays(value){const d=_calDate(value);return d?Math.round((d-_calToday())/864e5):null;}
function _calMoney(v){try{return new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(+v||0);}catch(e){return '$'+Math.round(+v||0).toLocaleString('es-CL');}}
function _calClient(fields){try{return resolveClienteName(fields?.Cliente)||'Sin cliente';}catch(e){return'Sin cliente';}}
function _calNorm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
function _calPersonIds(value){
  const vals=(Array.isArray(value)?value:[value]).flatMap(v=>typeof v==='string'?v.split(/[,;|]/):[v]),out=[];
  vals.filter(Boolean).forEach(v=>{const raw=typeof v==='object'?(v.id||v.name||v.email||''):v,n=_calNorm(raw);const p=_calPersonas().find(x=>n===_calNorm(x.id)||n===_calNorm(x.nombre)||_calNorm(x.nombre).includes(n)||n.includes(_calNorm(x.id))||n.includes(_calNorm(x.nombre.split(' ')[0])));if(p&&!out.includes(p.id))out.push(p.id);});
  return out;
}
function _calCrmMeta(){try{const x=JSON.parse(localStorage.getItem(_CAL_CRM_SYNC_KEY)||'{}');return x&&typeof x==='object'?x:{};}catch(e){return{};}}
function _calCrmMetaSave(map){try{localStorage.setItem(_CAL_CRM_SYNC_KEY,JSON.stringify(map||{}));}catch(e){}}
function _calCrmMetaMerge(a,b){
  const out={};for(const id of new Set([...Object.keys(a||{}),...Object.keys(b||{})])){const x=(a||{})[id],y=(b||{})[id];if(!x){out[id]=y;continue;}if(!y){out[id]=x;continue;}const tx=+(x.gsyncMts||0),ty=+(y.gsyncMts||0),newest=ty>=tx?y:x,older=newest===y?x:y;if(newest.del){out[id]={...newest,gcal:{}};continue;}const gcal={},removed={},pids=new Set([...Object.keys(x.gcal||{}),...Object.keys(y.gcal||{}),...Object.keys(x.removed||{}),...Object.keys(y.removed||{})]);for(const pid of pids){const gx=x.gcal?.[pid],gy=y.gcal?.[pid],gxt=gx?+(gx.mts||tx):0,gyt=gy?+(gy.mts||ty):0,rm=Math.max(+(x.removed?.[pid]||0),+(y.removed?.[pid]||0)),best=gyt>=gxt?gy:gx,bestT=Math.max(gxt,gyt);if(best&&bestT>rm)gcal[pid]=best;else if(rm)removed[pid]=rm;}out[id]={...older,...newest,gcal,removed};delete out[id].del;}
  const cut=Date.now()-60*864e5;Object.keys(out).forEach(id=>{if(out[id]?.del&&+(out[id].gsyncMts||0)<cut)delete out[id];});return out;
}
function _calSyncPrefs(){
  const base={manual:true,cot_due:true,cot_expiry:false,ped_internal:false,ped_delivery:true,onlyMine:false};
  try{return{...base,...JSON.parse(localStorage.getItem(_CAL_SYNC_PREF_KEY)||'{}')};}catch(e){return base;}
}
function _calUserId(){try{const u=AUTH.getUser&&AUTH.getUser(),raw=_calNorm(`${u?.username||''} ${u?.name||''}`);return CAL_PERSONA_IDS.find(id=>raw===id||raw.startsWith(id+' ')||raw.includes(id))||'';}catch(e){return'';}}
function _calRisk(fecha,urgent){
  const days=_calDays(fecha);if(days===null)return'none';
  if(days<0)return'overdue';if(days===0)return'today';if(days<=2||urgent)return'high';if(days<=7)return'medium';return'normal';
}
function _calColorByType(type,risk){
  if(risk==='overdue'||risk==='today')return'var(--danger)';
  if(risk==='high')return'var(--warn)';
  return type.startsWith('cot_')?'#a78bfa':type.startsWith('ped_')?'#ff6b35':'var(--accent)';
}
function _calReminderList(type){return type.startsWith('cot_')?[4320,1440,180,0]:type.startsWith('ped_')?[10080,4320,1440,0]:[30];}
function _calCrmEvent({id,type,recordId,recordKind,fecha,titulo,client,status,amount,personas,urgent=false,desc='',field}){
  const meta=_calCrmMeta()[id]||{},risk=_calRisk(fecha,urgent);
  const signature=JSON.stringify({fecha,titulo,status,amount,personas,desc});
  return{id,source:'crm',syncKey:type,type,recordId,recordKind,field,fecha,allDay:true,hIni:null,hFin:null,personas,client,status,amount:+amount||0,urgent,desc,
    titulo,alarmMin:type.startsWith('cot_')?180:1440,emailMin:null,avisoApp:true,reminders:_calReminderList(type),risk,color:_calColorByType(type,risk),
    gcal:meta.gcal||{},gcalRemoved:meta.removed||{},gsyncMts:+meta.gsyncMts||0,mts:meta.signature===signature?(+meta.gsyncMts||1):Date.now(),_signature:signature};
}
function _calCrmEvents(){
  const out=[],st=(typeof state!=='undefined'?state:{}),closedCot=new Set(['Aprobada','Rechazada','Vencida']),closedPed=new Set(['Completado','Cancelado']);
  (st.cotizaciones||[]).forEach(c=>{const f=c.fields||{},status=f['Estado cotización']||'',num=f['N° Cotización']||'Cotización',client=_calClient(f),personas=_calPersonIds(f.Vendedor),amount=f['Total final (CLP)']||0;
    if(f['Fecha límite cotización']&&!closedCot.has(status)&&status!=='Enviada')out.push(_calCrmEvent({id:'crm-cot-due-'+c.id,type:'cot_due',recordId:c.id,recordKind:'cotizacion',field:'Fecha límite cotización',fecha:f['Fecha límite cotización'],titulo:`✍ ${num} · entregar cotización`,client,status,amount,personas,urgent:!!f['Urgencia (+25%)'],desc:`${client} · ${status||'Solicitada'} · ${_calMoney(amount)}`}));
    if(f['Fecha vencimiento']&&status==='Enviada')out.push(_calCrmEvent({id:'crm-cot-exp-'+c.id,type:'cot_expiry',recordId:c.id,recordKind:'cotizacion',field:'Fecha vencimiento',fecha:f['Fecha vencimiento'],titulo:`⌛ ${num} · vence propuesta`,client,status,amount,personas,urgent:!!f['Urgencia (+25%)'],desc:`${client} · seguimiento antes del vencimiento · ${_calMoney(amount)}`}));
  });
  (st.pedidos||[]).forEach(p=>{const f=p.fields||{},status=f['Estado pedido']||'',num=f['N° Pedido']||'Pedido',client=_calClient(f),personas=_calPersonIds(f['Equipo asignado']||f['Equipo responsable']||f.Vendedor),amount=f['Monto total (CLP)']||0;if(closedPed.has(status))return;
    if(f['Fecha objetivo interna'])out.push(_calCrmEvent({id:'crm-ped-int-'+p.id,type:'ped_internal',recordId:p.id,recordKind:'pedido',field:'Fecha objetivo interna',fecha:f['Fecha objetivo interna'],titulo:`🛠 ${num} · meta interna`,client,status,amount,personas,desc:`${client} · ${status||'Confirmado'} · producción, QA y embalaje listos`}));
    if(f['Fecha entrega'])out.push(_calCrmEvent({id:'crm-ped-del-'+p.id,type:'ped_delivery',recordId:p.id,recordKind:'pedido',field:'Fecha entrega',fecha:f['Fecha entrega'],titulo:`📦 ${num} · entrega cliente`,client,status,amount,personas,urgent:status==='Listo para despacho',desc:`${client} · ${status||'Confirmado'} · ${_calMoney(amount)}`}));
  });
  return out;
}
function _calDisplayEvents(){return _calAll().filter(e=>!e.del).map(e=>({...e,source:e.source||'manual',type:e.type||'manual',color:_calColor(e)})).concat(_calCrmEvents());}
function _calEventById(id){return _calDisplayEvents().find(e=>e.id===id)||null;}
function _calAllowedSync(ev){const p=_calSyncPrefs();if(ev.source!=='crm')return p.manual!==false;const mine=_calUserId();return p[ev.syncKey]!==false&&(!p.onlyMine||(!!mine&&(ev.personas||[]).includes(mine)));}
function _calSyncCandidates(){
  const current=_calDisplayEvents(),meta=_calCrmMeta(),ids=new Set(current.map(e=>e.id)),out=[];
  current.forEach(ev=>{const allowed=_calAllowedSync(ev);if(allowed)out.push(ev);else if(Object.keys(ev.gcal||{}).length)out.push({...ev,del:true,_syncDisabled:true});});
  Object.entries(meta).forEach(([id,m])=>{if(!ids.has(id)&&Object.keys(m.gcal||{}).length)out.push({id,source:'crm',type:m.type||'crm',syncKey:m.syncKey||'ped_delivery',personas:[],gcal:m.gcal,del:true,mts:Date.now(),gsyncMts:+m.gsyncMts||0});});
  return out;
}
function _calPersistCrmSync(ev){
  if(ev.source!=='crm')return;const map=_calCrmMeta();
  if(ev.del)map[ev.id]={gcal:{},gsyncMts:Date.now(),signature:ev._signature||'',type:ev.type,syncKey:ev.syncKey,del:true};else if(Object.keys(ev.gcal||{}).length||Object.keys(ev.gcalRemoved||{}).length){const removed={...((map[ev.id]||{}).removed||{}),...(ev.gcalRemoved||{})};Object.entries(ev.gcal||{}).forEach(([pid,g])=>{if(+(g.mts||0)>=+(removed[pid]||0))delete removed[pid];});map[ev.id]={gcal:ev.gcal,removed,gsyncMts:ev.gsyncMts||Date.now(),signature:ev._signature||'',type:ev.type,syncKey:ev.syncKey};}
  _calCrmMetaSave(map);
}

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
function _calFitBudget(events,extraBytes=0){
  let out=events.slice();
  const hoy=new Date().toISOString().slice(0,10);
  const limit=Math.max(5000,88000-Math.max(0,+extraBytes||0));
  while(JSON.stringify(out).length>limit&&out.length>10){
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
    const crmBefore=JSON.stringify(_calCrmMeta()),crmMerged=_calCrmMetaMerge(_calCrmMeta(),all.crmSync||{});
    if(JSON.stringify(crmMerged)!==crmBefore){_calCrmMetaSave(crmMerged);changed=true;}
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
    const gmapMts=Math.max(gm.mts,+(prev.gmapMts||0));
    const gmap=gm.mts>=+(prev.gmapMts||0)?gm.map:(prev.gmap||gm.map);
    const crmSync=_calCrmMetaMerge(_calCrmMeta(),prev.crmSync||{});
    _calCrmMetaSave(crmSync);
    const extraBytes=JSON.stringify({gmap,gmapMts,crmSync}).length+2000;
    const events=_calFitBudget(_calPrune(_calMerge(_calAll(),Array.isArray(prev.events)?prev.events:[])),extraBytes);
    _calSaveLocal(events);
    const notes=JSON.stringify({events,gmap,gmapMts,crmSync});
    if(notes.length>95000)return;
    await _monitorUpsert('CALENDARIO',notes,'calRecordId');
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
  const popupMins=Array.isArray(ev.reminders)?ev.reminders:(ev.alarmMin!=null?[+ev.alarmMin]:[]);
  [...new Set(popupMins)].filter(x=>x>=0).slice(0,5).forEach(minutes=>ovr.push({method:'popup',minutes:+minutes}));
  if(ev.emailMin!=null&&ev.emailMin>=0)ovr.push({method:'email',minutes:+ev.emailMin});
  body.reminders=ovr.length?{useDefault:false,overrides:ovr}:{useDefault:true};
  if(mode==='invite'&&target)body.attendees=[{email:target}];
  return body;
}
// Empuja UN evento a Google: escribe/actualiza/borra en el calendario de cada persona.
async function _calSyncEvento(ev){
  const gm=_calGmap().map;ev.gcal=ev.gcal||{};ev.gcalRemoved=ev.gcalRemoved||{};const errs=[];
  // 1) borrar copias de personas quitadas o de eventos eliminados
  for(const pid of Object.keys(ev.gcal)){
    if(ev.del||!(ev.personas||[]).includes(pid)){
      const g=ev.gcal[pid];
      try{await _calApi('/calendars/'+encodeURIComponent(g.cal)+'/events/'+encodeURIComponent(g.ev)+'?sendUpdates=all','DELETE');delete ev.gcal[pid];ev.gcalRemoved[pid]=Date.now();}
      catch(e){ if(/HTTP (404|410)/.test(e.message)){delete ev.gcal[pid];ev.gcalRemoved[pid]=Date.now();} else errs.push(pid+': '+e.message); }
    }
  }
  // 2) crear/actualizar para las personas asignadas
  if(!ev.del){
    for(const pid of (ev.personas||[])){
      const target=String(gm[pid]||'').trim();if(!target)continue;
      const g=ev.gcal[pid];
      try{
        if(g){await _calApi('/calendars/'+encodeURIComponent(g.cal)+'/events/'+encodeURIComponent(g.ev)+'?sendUpdates=all','PATCH',_calGcalBody(ev,g.mode,target));g.mts=Date.now();delete ev.gcalRemoved[pid];}
        else{
          let created=null,mode='direct',cal=target;
          try{created=await _calApi('/calendars/'+encodeURIComponent(target)+'/events?sendUpdates=all','POST',_calGcalBody(ev,'direct',target));}
          catch(e){
            if(/HTTP (403|404)/.test(e.message)){mode='invite';cal='primary';created=await _calApi('/calendars/primary/events?sendUpdates=all','POST',_calGcalBody(ev,'invite',target));}
            else throw e;
          }
          ev.gcal[pid]={cal,ev:created.id,mode,mts:Date.now()};delete ev.gcalRemoved[pid];
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
    const arr=_calAll();const pend=_calSyncCandidates().filter(_calNeedsSync);
    if(!pend.length){toast('✓ Todo sincronizado con Google','success');}
    else{
      let ok=0;const errs=[];
      for(const ev of pend){const e=await _calSyncEvento(ev);if(e.length)errs.push(...e);else{ok++;_calPersistCrmSync(ev);}}
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
    const arr=_calAll();const pend=_calSyncCandidates().filter(_calNeedsSync);
    if(!pend.length)return;
    let changed=false;
    for(const ev of pend){const e=await _calSyncEvento(ev);if(!e.length){changed=true;_calPersistCrmSync(ev);}}
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
    const now=Date.now(),desde=new Date(now-14*864e5).toISOString().slice(0,10),hasta=new Date(now+10*864e5).toISOString().slice(0,10);
    const fired=_calFired();let dirty=false;
    _calDisplayEvents().forEach(ev=>{
      if(ev.del||ev.avisoApp===false||!ev.fecha||ev.fecha<desde||ev.fecha>hasta)return;
      const ini=new Date(ev.fecha+'T'+(ev.allDay?'09:00':(ev.hIni||'09:00'))+':00').getTime();
      const mins=Array.isArray(ev.reminders)?ev.reminders:(ev.alarmMin==null?[]:[+ev.alarmMin]);
      const ready=mins.slice().sort((a,b)=>a-b).find(min=>now>=ini-(+min)*60000&&!fired[ev.id+'@'+ev.fecha+'@'+min]);
      const overdue=ev.source==='crm'&&now>=ini+5*60000;
      const keyMin=overdue?'overdue-'+new Date().toISOString().slice(0,10):ready;
      if(keyMin===undefined||(!overdue&&now>=ini+5*60000))return;
      const k=ev.id+'@'+ev.fecha+'@'+keyMin;if(fired[k])return;fired[k]=now;dirty=true;
      const quien=(ev.personas||[]).map(p=>{const per=_calPersona(p);return per?per.nombre.split(' ')[0]:p;}).join(', ');
      const days=_calDays(ev.fecha),when=days<0?`${Math.abs(days)} día${Math.abs(days)!==1?'s':''} atrasado`:days===0?'vence hoy':days===1?'vence mañana':`faltan ${days} días`;
      const sub=(ev.source==='crm'?when:(ev.allDay?'Todo el día':((ev.hIni||'')+(ev.hFin?'–'+ev.hFin:''))))+(quien?' · '+quien:'');
      try{NOTIFY.add(overdue?'error':'warning','📅 '+(ev.titulo||'Evento'),sub,"switchTab('calendario')");}catch(e){try{toast('📅 '+(ev.titulo||'Evento')+' · '+sub,overdue?'error':'info');}catch(_){}}
      try{if(typeof Notification!=='undefined'&&Notification.permission==='granted')new Notification('📅 '+(ev.titulo||'Evento'),{body:sub});}catch(e){}
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
function _calPassFilter(ev){
  if(_calFiltro!=='todos'&&!(ev.personas||[]).includes(_calFiltro))return false;
  if(_calTipoFiltro==='todos')return true;
  if(_calTipoFiltro==='cotizaciones')return String(ev.type||'').startsWith('cot_');
  if(_calTipoFiltro==='pedidos')return String(ev.type||'').startsWith('ped_');
  if(_calTipoFiltro==='equipo')return ev.source!=='crm';
  if(_calTipoFiltro==='atrasados')return ev.risk==='overdue'||ev.risk==='today';
  if(_calTipoFiltro==='hoy')return _calDays(ev.fecha)===0;
  if(_calTipoFiltro==='semana'){const days=_calDays(ev.fecha);return days>=0&&days<=7;}
  if(_calTipoFiltro==='capacidad')return ev.type==='ped_delivery'&&typeof MachineOps!=='undefined'&&MachineOps.deadlineCapacityRisk&&MachineOps.deadlineCapacityRisk(ev.recordId,ev.fecha).status==='risk';
  if(_calTipoFiltro==='mios'){const me=_calUserId();return!!me&&(ev.personas||[]).includes(me);}
  if(_calTipoFiltro==='sin-responsable')return!(ev.personas||[]).length;
  return true;
}
function _calEventosDia(f){
  return _calDisplayEvents().filter(ev=>ev.fecha===f&&_calPassFilter(ev))
    .sort((a,b)=>(a.risk==='overdue'?-2:a.risk==='today'?-1:0)-(b.risk==='overdue'?-2:b.risk==='today'?-1:0)||(a.allDay?'00:00':(a.hIni||'09:00')).localeCompare(b.allDay?'00:00':(b.hIni||'09:00')));
}
function _calColor(ev){if(ev?.color)return ev.color;const p=_calPersona((ev?.personas||[])[0]);return (p&&p.color)||'var(--accent)';}
function _calWhen(ev){const d=_calDays(ev.fecha);return d===null?'sin fecha':d<0?`${Math.abs(d)}d atraso`:d===0?'hoy':d===1?'mañana':`en ${d}d`;}
function _calEventHtml(ev,compact=false){
  const pend=_calAllowedSync(ev)&&_calNeedsSync(ev)?' cal-pend':'',risk=ev.risk?` risk-${ev.risk}`:'',hora=ev.allDay?(ev.source==='crm'?_calWhen(ev):'●'):(ev.hIni||'');
  const cap=ev.type==='ped_delivery'&&typeof MachineOps!=='undefined'&&MachineOps.deadlineCapacityRisk?MachineOps.deadlineCapacityRisk(ev.recordId,ev.fecha):null;
  const capBadge=cap&&cap.status==='risk'?'<span class="cal-cap-risk" title="La planificación de Máquinas no alcanza esta fecha">CAP.</span>':'';
  return `<div class="cal-ev${pend}${risk}" draggable="true" ondragstart="calDragStart(event,'${ev.id}')" style="border-left-color:${_calColor(ev)}" onclick="event.stopPropagation();calOpenEvent('${ev.id}')" title="${escapeHtml(ev.titulo||'')}${ev.client?' · '+escapeHtml(ev.client):''}${_calNeedsSync(ev)?' · pendiente de sincronizar con Google':''}"><span class="cal-ev-h">${escapeHtml(hora)}</span> ${escapeHtml(ev.titulo||'')}${capBadge}${compact?'':ev.urgent?' ⚡':''}</div>`;
}
function calNavMes(d){if(_calVista==='mes')_calMes=new Date(_calMes.getFullYear(),_calMes.getMonth()+d,1);else{const x=new Date(_calMes);x.setDate(x.getDate()+d*(_calVista==='semana'?7:30));_calMes=x;}renderCalendario();}
function calHoy(){_calMes=new Date();renderCalendario();}
function calSetFiltro(pid){_calFiltro=pid;renderCalendario();}
function calSetTipo(tipo){_calTipoFiltro=tipo;renderCalendario();}
function calSetVista(vista){_calVista=vista;try{localStorage.setItem('thelab_cal_vista',vista);}catch(e){}renderCalendario();}
function calDragStart(e,id){_calDragId=id;try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',id);}catch(_){} }
function calDropDate(e,fecha){e.preventDefault();const id=(e.dataTransfer&&e.dataTransfer.getData('text/plain'))||_calDragId;if(id)calRescheduleEvent(id,fecha);_calDragId='';}
function _calRenderFilters(){
  const chips=document.getElementById('calFiltroChips');if(chips)chips.innerHTML=[`<button class="cal-chip ${_calFiltro==='todos'?'on':''}" onclick="calSetFiltro('todos')">Todos</button>`]
    .concat(_calPersonas().map(p=>`<button class="cal-chip ${_calFiltro===p.id?'on':''}" style="--chip:${p.color}" onclick="calSetFiltro('${p.id}')"><span class="cal-dot" style="background:${p.color}"></span>${p.nombre.split(' ')[0]}</button>`)).join('');
  const types=document.getElementById('calTipoChips');if(types){const rows=[['todos','Todos'],['hoy','Hoy'],['semana','7 días'],['cotizaciones','🟣 Cotizaciones'],['pedidos','🟠 Pedidos'],['equipo','🔵 Equipo'],['atrasados','🔴 Atrasados'],['capacidad','⚠ Capacidad'],['mios','👤 Míos'],['sin-responsable','⚪ Sin responsable']];types.innerHTML=rows.map(([k,l])=>`<button class="cal-chip ${_calTipoFiltro===k?'on':''}" onclick="calSetTipo('${k}')">${l}</button>`).join('');}
  document.querySelectorAll('[data-cal-view]').forEach(b=>b.classList.toggle('active-filter',b.dataset.calView===_calVista));
}
function _calRenderMonth(grid){
  const y=_calMes.getFullYear(),m=_calMes.getMonth(),first=new Date(y,m,1),start=new Date(first);start.setDate(first.getDate()-((first.getDay()+6)%7));
  const hoy=_calFmtFecha(new Date()),dows=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];let h='<div class="cal-head">'+dows.map(d=>`<div class="cal-dow">${d}</div>`).join('')+'</div><div class="cal-body">';
  const cur=new Date(start);for(let w=0;w<6;w++)for(let i=0;i<7;i++){const f=_calFmtFecha(cur),other=cur.getMonth()!==m,evs=_calEventosDia(f),chipsEv=evs.slice(0,3).map(ev=>_calEventHtml(ev,true)).join('')+(evs.length>3?`<div class="cal-mas" onclick="event.stopPropagation();openCalDiaModal('${f}')">+${evs.length-3} más</div>`:'');h+=`<div class="cal-cell${other?' other':''}${f===hoy?' today':''}" ondragover="event.preventDefault()" ondrop="calDropDate(event,'${f}')" onclick="openCalEventoModal('${f}')"><div class="cal-num">${cur.getDate()}</div>${chipsEv}</div>`;cur.setDate(cur.getDate()+1);}grid.innerHTML=h+'</div>';
}
function _calWeekStart(base){const d=new Date(base);d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return d;}
function _calRenderWeek(grid){
  const start=_calWeekStart(_calMes),days=[];for(let i=0;i<7;i++){const d=new Date(start);d.setDate(start.getDate()+i);days.push(d);}const today=_calFmtFecha(new Date());
  grid.innerHTML=`<div class="cal-week">${days.map(d=>{const f=_calFmtFecha(d),evs=_calEventosDia(f);return`<section class="cal-week-day${f===today?' today':''}" ondragover="event.preventDefault()" ondrop="calDropDate(event,'${f}')"><button onclick="openCalEventoModal('${f}')"><b>${d.toLocaleDateString('es-CL',{weekday:'short'}).replace('.','')}</b><span>${d.getDate()}</span></button><div>${evs.length?evs.map(ev=>_calEventHtml(ev)).join(''):'<small>Sin compromisos</small>'}</div></section>`;}).join('')}</div>`;
}
function _calRenderAgenda(grid){
  const start=new Date(_calMes),rows=[];start.setHours(0,0,0,0);for(let i=0;i<30;i++){const d=new Date(start);d.setDate(start.getDate()+i);const f=_calFmtFecha(d),evs=_calEventosDia(f);if(!evs.length)continue;rows.push(`<section class="cal-ag-day"><div><b>${d.toLocaleDateString('es-CL',{weekday:'long'})}</b><span>${d.toLocaleDateString('es-CL',{day:'numeric',month:'short'})}</span></div><div>${evs.map(ev=>_calEventHtml(ev)).join('')}</div></section>`);}grid.innerHTML=rows.length?`<div class="cal-agenda">${rows.join('')}</div>`:'<div class="empty-state">Sin compromisos en los próximos 30 días con los filtros actuales.</div>';
}
function _calMissingItems(){
  const out=[],closedCot=new Set(['Aprobada','Rechazada','Vencida']),closedPed=new Set(['Completado','Cancelado']),today=_calFmtFecha(new Date());
  (state.cotizaciones||[]).forEach(c=>{const f=c.fields||{},s=f['Estado cotización']||'',base=(f['Fecha cotización']||'')>today?f['Fecha cotización']:today;if(closedCot.has(s))return;
    if(s==='Enviada'){if(!f['Fecha vencimiento'])out.push({kind:'cotizacion',id:c.id,field:'Fecha vencimiento',label:f['N° Cotización']||'Cotización',client:_calClient(f),what:'vigencia de propuesta',suggested:calBusinessDate(base,10),rule:'10 días hábiles desde el envío'});return;}
    if(!f['Fecha límite cotización'])out.push({kind:'cotizacion',id:c.id,field:'Fecha límite cotización',label:f['N° Cotización']||'Cotización',client:_calClient(f),what:'fecha límite',suggested:calBusinessDate(base,2),rule:'2 días hábiles para responder'});
  });
  (state.pedidos||[]).forEach(p=>{const f=p.fields||{},s=f['Estado pedido']||'';if(closedPed.has(s))return;
    if(!f['Fecha entrega'])out.push({kind:'pedido',id:p.id,field:'Fecha entrega',label:f['N° Pedido']||'Pedido',client:_calClient(f),what:'entrega cliente',suggested:'',rule:'requiere compromiso con el cliente'});
    if(!f['Fecha objetivo interna'])out.push({kind:'pedido',id:p.id,field:'Fecha objetivo interna',label:f['N° Pedido']||'Pedido',client:_calClient(f),what:'meta interna',suggested:f['Fecha entrega']?calInternalDate(f['Fecha entrega'],2):'',rule:f['Fecha entrega']?'2 días hábiles antes de entregar':'primero define la entrega'});
  });
  return out;
}
function _calRenderKpis(){
  const el=document.getElementById('calKpis');if(!el)return;const crm=_calCrmEvents(),today=crm.filter(e=>_calDays(e.fecha)===0).length,week=crm.filter(e=>{const d=_calDays(e.fecha);return d>=0&&d<=7;}).length,late=crm.filter(e=>_calDays(e.fecha)<0).length,missing=_calMissingItems().length;
  const capRisk=crm.filter(e=>e.type==='ped_delivery'&&typeof MachineOps!=='undefined'&&MachineOps.deadlineCapacityRisk&&MachineOps.deadlineCapacityRisk(e.recordId,e.fecha).status==='risk').length;
  el.innerHTML=[[today,'Vencen hoy','var(--warn)',"calSetTipo('hoy')"],[week,'Próximos 7 días','var(--accent)',"calSetTipo('semana')"],[late,'Atrasados','var(--danger)',"calSetTipo('atrasados')"],[missing,'Sin fecha','var(--accent4)',"document.getElementById('calSinFechaCard')?.scrollIntoView({behavior:'smooth'})"],[capRisk,'Riesgo capacidad','var(--danger)',"calSetTipo('capacidad')"]].map(([v,l,c,action])=>`<button onclick="${action}" class="cal-kpi" style="--cal-kpi:${c}"><b>${v}</b><span>${l}</span></button>`).join('');
}
function _calFocusItems(){
  return _calCrmEvents().filter(ev=>{const d=_calDays(ev.fecha);return d!==null&&d<=2;}).sort((a,b)=>{const da=_calDays(a.fecha),db=_calDays(b.fecha),wa=da===0?0:da<0?1:2,wb=db===0?0:db<0?1:2;return wa-wb||(wa===1?db-da:da-db)||String(a.titulo).localeCompare(String(b.titulo));}).slice(0,10);
}
function renderCalFocus(){
  const el=document.getElementById('calFocus');if(!el)return;const rows=_calFocusItems();
  if(!rows.length){el.innerHTML='<div class="cal-focus-clear">✓ Sin compromisos urgentes ni atrasados. La operación inmediata está al día.</div>';return;}
  const action={cot_due:'Preparar cotización',cot_expiry:'Hacer seguimiento',ped_internal:'Revisar producción',ped_delivery:'Coordinar entrega'};
  el.innerHTML=rows.map(ev=>{const people=(ev.personas||[]).map(id=>_calPersona(id)?.nombre?.split(' ')[0]||id).join(', ')||'Sin responsable',days=_calDays(ev.fecha),when=days<0?`${Math.abs(days)}d atrasado`:days===0?'Hoy':days===1?'Mañana':`En ${days} días`,cap=ev.type==='ped_delivery'&&typeof MachineOps!=='undefined'&&MachineOps.deadlineCapacityRisk?MachineOps.deadlineCapacityRisk(ev.recordId,ev.fecha):null;return `<article class="cal-focus-row risk-${ev.risk}"><span class="cal-focus-when">${escapeHtml(when)}</span><div><b>${escapeHtml(ev.titulo)}</b><small>${escapeHtml(ev.client||'Sin cliente')} · ${escapeHtml(people)}${ev.amount?' · '+escapeHtml(_calMoney(ev.amount)):''}${cap?.status==='risk'?' · capacidad insuficiente':''}</small></div><button class="btn btn-ghost btn-sm" onclick="calOpenEvent('${ev.id}')">${escapeHtml(action[ev.type]||'Revisar')}</button></article>`;}).join('');
}
async function calApplySuggestedDate(kind,id,field,date){
  if(!date)return;try{await calUpdateCrmDate(kind,id,field,date,'Fecha sugerida automáticamente según SLA operativo',true);toast('✓ Fecha sugerida aplicada','success');renderCalendario();}catch(e){toast('Error: '+e.message,'error');}
}
async function calApplySuggestedDates(){
  const rows=_calMissingItems().filter(x=>x.suggested);if(!rows.length){toast('No hay fechas que se puedan calcular de forma segura','info');return;}
  if(!confirm(`Se aplicarán ${rows.length} fecha${rows.length!==1?'s':''} sugerida${rows.length!==1?'s':''}: cotizaciones +2 días hábiles, vigencias +10 días hábiles y metas internas 2 días antes de entregar. ¿Continuar?`))return;
  let ok=0;for(const x of rows){try{if(await calUpdateCrmDate(x.kind,x.id,x.field,x.suggested,'Fecha sugerida automáticamente según SLA operativo',true))ok++;}catch(e){console.warn('[Calendario] sugerencia',x,e);}}
  toast(`✓ ${ok} fecha${ok!==1?'s':''} aplicada${ok!==1?'s':''}`,'success');renderCalendario();
}
function renderCalMissing(){
  const el=document.getElementById('calSinFecha');if(!el)return;const rows=_calMissingItems();
  const summary=document.getElementById('calMissingSummary'),auto=rows.filter(x=>x.suggested).length;if(summary)summary.textContent=rows.length?`${rows.length} pendiente${rows.length!==1?'s':''} · ${auto} calculable${auto!==1?'s':''}`:'Todo al día';
  const autoBtn=document.getElementById('calApplySuggestedBtn');if(autoBtn){autoBtn.style.display=auto?'':'none';autoBtn.textContent=`⚡ Aplicar ${auto} sugerida${auto!==1?'s':''}`;}
  el.innerHTML=rows.length?rows.slice(0,18).map(x=>`<div class="cal-missing"><span>${x.kind==='pedido'?'📦':'✍'}</span><div><b>${escapeHtml(x.label)} · ${escapeHtml(x.client)}</b><small>Falta ${escapeHtml(x.what)} · ${escapeHtml(x.rule||'')}</small>${x.suggested?`<em>Sugerencia: ${escapeHtml(x.suggested)}</em>`:''}</div><div class="cal-missing-actions">${x.suggested?`<button class="btn btn-ghost btn-sm" onclick="calApplySuggestedDate('${x.kind}','${x.id}','${x.field}','${x.suggested}')">Aplicar</button>`:''}<button class="btn btn-ghost btn-sm" onclick="calQuickSchedule('${x.kind}','${x.id}','${x.field}')">Definir</button></div></div>`).join(''):'<div class="cal-good">✓ Todos los compromisos activos tienen fecha.</div>';
}
function renderCalHistory(){
  const el=document.getElementById('calHistory');if(!el)return;const rows=[];['cotizaciones','pedidos'].forEach(kind=>(state[kind]||[]).forEach(r=>{let h=[];try{h=JSON.parse(r.fields?.['Historial fechas calendario']||'[]');}catch(e){}h.forEach(x=>rows.push({...x,kind,id:r.id,label:r.fields[kind==='pedidos'?'N° Pedido':'N° Cotización']||'—'}));}));rows.sort((a,b)=>Date.parse(b.at||0)-Date.parse(a.at||0));
  el.innerHTML=rows.length?rows.slice(0,12).map(x=>`<div class="cal-history-row"><b>${escapeHtml(x.label)}</b><span>${escapeHtml(x.field||'Fecha')}: ${escapeHtml(x.from||'sin fecha')} → ${escapeHtml(x.to||'sin fecha')}</span><small>${escapeHtml(x.actor||'—')} · ${new Date(x.at).toLocaleString('es-CL')} ${x.reason?'· '+escapeHtml(x.reason):''}</small></div>`).join(''):'<div class="empty-state">Aún no hay reprogramaciones registradas.</div>';
}
function renderCalendario(){
  const grid=document.getElementById('calGrid');if(!grid)return;
  if(!_calEnsureRequested){_calEnsureRequested=true;setTimeout(()=>ensureCalendarioCrmFields(),50);}
  try{_calVista=localStorage.getItem('thelab_cal_vista')||_calVista;}catch(e){}
  const lbl=document.getElementById('calMesLabel');
  if(lbl){const start=_calVista==='semana'?_calWeekStart(_calMes):_calMes;lbl.textContent=_calVista==='semana'?`Semana del ${start.toLocaleDateString('es-CL',{day:'numeric',month:'long'})}`:_calVista==='agenda'?`Agenda desde ${_calMes.toLocaleDateString('es-CL',{day:'numeric',month:'long'})}`:_calMes.toLocaleDateString('es-CL',{month:'long',year:'numeric'}).replace(/^./,c=>c.toUpperCase());}
  _calRenderFilters();_calRenderKpis();renderCalFocus();if(_calVista==='semana')_calRenderWeek(grid);else if(_calVista==='agenda')_calRenderAgenda(grid);else _calRenderMonth(grid);
  renderCalProximos();
  renderCalMissing();renderCalHistory();
  _calRenderSyncStatus();
}
function renderCalProximos(){
  const el=document.getElementById('calProximos');if(!el)return;
  const hoy=new Date();hoy.setHours(0,0,0,0);
  const out=[];
  for(let i=0;i<14;i++){
    const d=new Date(hoy);d.setDate(hoy.getDate()+i);
    const f=_calFmtFecha(d);
    const evs=_calEventosDia(f);
    if(!evs.length)continue;
    const dia=i===0?'Hoy':i===1?'Mañana':d.toLocaleDateString('es-CL',{weekday:'long',day:'numeric'});
    out.push(`<div class="cal-px-dia">${escapeHtml(dia.replace(/^./,c=>c.toUpperCase()))}</div>`+evs.map(ev=>{
      const quien=(ev.personas||[]).map(p=>{const per=_calPersona(p);return per?`<span class="cal-dot" style="background:${per.color}" title="${escapeHtml(per.nombre)}"></span>`:'';}).join('');
      const alarma=ev.alarmMin!=null?` <span title="Tiene recordatorios">🔔</span>`:'';
      return `<div class="cal-px-ev risk-${ev.risk||'normal'}" onclick="calOpenEvent('${ev.id}')"><span class="cal-px-h">${ev.source==='crm'?escapeHtml(_calWhen(ev)):ev.allDay?'Todo el día':escapeHtml(ev.hIni||'')}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(ev.titulo||'')}${alarma}<small>${ev.client?' · '+escapeHtml(ev.client):''}</small></span>${quien}</div>`;
    }).join(''));
  }
  el.innerHTML=out.length?out.join(''):'<div style="font-size:12px;color:var(--text3);padding:10px 4px">Sin eventos en los próximos 14 días.</div>';
}
function _calRenderSyncStatus(){
  const el=document.getElementById('calSyncStatus');if(!el)return;
  const gm=_calGmap().map;
  const conf=CAL_PERSONA_IDS.filter(p=>String(gm[p]||'').trim()).length;
  const pend=_calSyncCandidates().filter(_calNeedsSync).length;
  const gOK=_calTokenVigente();
  const notif=(typeof Notification!=='undefined'&&Notification.permission==='granted');
  el.innerHTML=`<span style="color:${gOK?'var(--accent3)':'var(--text3)'}">${gOK?'🟢 Google conectado':'⚪ Google sin conectar'}</span>
    · <span style="color:${conf===3?'var(--accent3)':'var(--warn)'}">${conf}/3 calendarios configurados</span>
    ${pend?` · <span style="color:var(--warn)">${pend} pendiente${pend!==1?'s':''} de sincronizar</span>`:' · <span style="color:var(--accent3)">✓ al día</span>'}
    ${notif?'':' · <span style="color:var(--text3)">avisos del navegador desactivados</span>'}`;
}

// ── Acciones sobre compromisos CRM ──────────────────────────────────────────
function _calRecord(kind,id){return kind==='pedido'?(state.pedidosById||{})[id]:(state.cotizacionesById||{})[id];}
function _calHistory(rec,field,to,reason){
  let rows=[];try{rows=JSON.parse(rec?.fields?.['Historial fechas calendario']||'[]');if(!Array.isArray(rows))rows=[];}catch(e){rows=[];}
  const u=(AUTH.getUser&&AUTH.getUser())||{};rows.push({at:new Date().toISOString(),actor:u.name||u.username||'usuario',field,from:rec?.fields?.[field]||'',to:to||'',reason:reason||''});return JSON.stringify(rows.slice(-40));
}
function calHistoryForChanges(rec,changes,reason){
  let rows=[];try{rows=JSON.parse(rec?.fields?.['Historial fechas calendario']||'[]');if(!Array.isArray(rows))rows=[];}catch(e){rows=[];}const u=(AUTH.getUser&&AUTH.getUser())||{},at=new Date().toISOString();
  (changes||[]).forEach(({field,to})=>{const from=rec?.fields?.[field]||'';if(from!==(to||''))rows.push({at,actor:u.name||u.username||'usuario',field,from,to:to||'',reason:reason||''});});return JSON.stringify(rows.slice(-40));
}
async function ensureCalendarioCrmFields(){
  const t=typeof getToken==='function'&&getToken();if(!t&&!(typeof _proxyCfg==='function'&&_proxyCfg()))return false;
  try{
    const r=await _atFetch(`/meta/bases/${BASE_ID}/tables`,{headers:{}});if(!r.ok)return false;const d=await r.json();
    const defs={Cotizaciones:[{name:'Fecha límite cotización',type:'date',options:{dateFormat:{name:'iso'}}},{name:'Historial fechas calendario',type:'multilineText'}],Pedidos:[{name:'Fecha objetivo interna',type:'date',options:{dateFormat:{name:'iso'}}},{name:'Historial fechas calendario',type:'multilineText'}]};
    for(const [name,fields] of Object.entries(defs)){const table=d.tables?.find(x=>x.name===name);if(!table)continue;const have=new Set((table.fields||[]).map(x=>x.name));for(const field of fields){if(have.has(field.name))continue;try{await _atFetch(`/meta/bases/${BASE_ID}/tables/${table.id}/fields`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(field)});}catch(e){}}}
    return true;
  }catch(e){return false;}
}
async function calUpdateCrmDate(kind,id,field,to,reason='',silent=false){
  const rec=_calRecord(kind,id);if(!rec)throw new Error('Registro no encontrado');const old=rec.fields?.[field]||'';if(old===(to||''))return false;
  if(old&&!reason&&!silent){reason=(prompt(`Motivo del cambio de ${field}:`,'Reprogramación operacional')||'').trim();if(!reason)return false;}
  await ensureCalendarioCrmFields();const table=kind==='pedido'?'Pedidos':'Cotizaciones',fields={[field]:to||null,'Historial fechas calendario':_calHistory(rec,field,to,reason)};
  try{await airtableWrite(table,'PATCH',id,fields);}catch(e){if(!/field|unknown|422|INVALID/i.test(e.message||''))throw e;await ensureCalendarioCrmFields();await airtableWrite(table,'PATCH',id,fields);}
  Object.assign(rec.fields,fields);if(!silent){toast(`✓ ${field} actualizada`,'success');renderCalendario();try{if(kind==='pedido')renderPedidos();else renderCotizaciones();renderOverview();}catch(e){}}return true;
}
function _calEaster(year){
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;
  return new Date(year,month-1,day);
}
function _calChileSolstice(year){
  const y=(year-2000)/1000,jde=2451716.56767+365241.62603*y+0.00325*y*y+0.00888*y*y*y-0.00030*y*y*y*y,date=new Date((jde-2440587.5)*864e5),parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date),get=t=>parts.find(p=>p.type===t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function _calMondayHoliday(year,month,day){
  const d=new Date(year,month-1,day),dow=d.getDay();if(dow>=2&&dow<=4)d.setDate(d.getDate()-(dow-1));else if(dow===5)d.setDate(d.getDate()+3);return _calFmtFecha(d);
}
function _calEvangelicalHoliday(year){
  const d=new Date(year,9,31),dow=d.getDay();if(dow===2)d.setDate(d.getDate()-4);else if(dow===3)d.setDate(d.getDate()+2);return _calFmtFecha(d);
}
function _calChileHolidays(year){
  const fixed=['01-01','05-01','05-21','07-16','08-15','09-18','09-19','11-01','12-08','12-25'],out=new Set(fixed.map(x=>year+'-'+x)),easter=_calEaster(year);
  [-2,-1].forEach(delta=>{const d=new Date(easter);d.setDate(d.getDate()+delta);out.add(_calFmtFecha(d));});
  out.add(_calChileSolstice(year));out.add(_calMondayHoliday(year,6,29));out.add(_calMondayHoliday(year,10,12));out.add(_calEvangelicalHoliday(year));
  return out;
}
function _calBusinessDay(d){return d.getDay()!==0&&d.getDay()!==6&&!_calChileHolidays(d.getFullYear()).has(_calFmtFecha(d));}
function calBusinessDate(from,offset=0){
  const d=_calDate(from);if(!d)return'';let left=Math.abs(Math.trunc(+offset||0)),dir=offset<0?-1:1;while(left>0){d.setDate(d.getDate()+dir);if(_calBusinessDay(d))left--;}return _calFmtFecha(d);
}
function calInternalDate(delivery,buffer=2){return calBusinessDate(delivery,-Math.max(0,+buffer||0));}
function calOpenEvent(id){const ev=_calEventById(id);if(!ev)return;if(ev.source==='crm')openCalCrmModal(ev.recordKind,ev.recordId,ev.field);else openCalEventoModal(null,id);}
function calGoRecord(kind,id){closeCalCrmModal();const tab=kind==='pedido'?'pedidos':'cotizaciones';switchTab(tab);setTimeout(()=>{try{goToAlert(tab,id);}catch(e){}},180);}
function openCalCrmModal(kind,id,focusField=''){
  const rec=_calRecord(kind,id),modal=document.getElementById('calCrmModal');if(!rec||!modal)return;const f=rec.fields||{};
  document.getElementById('calCrmKind').value=kind;document.getElementById('calCrmId').value=id;
  document.getElementById('calCrmTitle').textContent=(kind==='pedido'?'📦 ':'✍ ')+(f[kind==='pedido'?'N° Pedido':'N° Cotización']||'Compromiso');
  document.getElementById('calCrmSub').textContent=`${_calClient(f)} · ${f[kind==='pedido'?'Estado pedido':'Estado cotización']||'—'} · ${_calMoney(f[kind==='pedido'?'Monto total (CLP)':'Total final (CLP)']||0)}`;
  const q=document.getElementById('calCrmQuoteDates'),p=document.getElementById('calCrmOrderDates');q.style.display=kind==='cotizacion'?'grid':'none';p.style.display=kind==='pedido'?'grid':'none';
  document.getElementById('calCrmCotDue').value=f['Fecha límite cotización']||'';document.getElementById('calCrmCotExpiry').value=f['Fecha vencimiento']||'';
  document.getElementById('calCrmPedInternal').value=f['Fecha objetivo interna']||'';document.getElementById('calCrmPedDelivery').value=f['Fecha entrega']||'';
  const hist=document.getElementById('calCrmHistory');let rows=[];try{rows=JSON.parse(f['Historial fechas calendario']||'[]');}catch(e){}hist.innerHTML=rows.length?rows.slice(-5).reverse().map(x=>`<div><b>${escapeHtml(x.field||'Fecha')}</b> ${escapeHtml(x.from||'sin fecha')} → ${escapeHtml(x.to||'sin fecha')}<small>${escapeHtml(x.actor||'—')} · ${new Date(x.at).toLocaleString('es-CL')}${x.reason?' · '+escapeHtml(x.reason):''}</small></div>`).join(''):'<span>Sin reprogramaciones.</span>';
  const cap=document.getElementById('calCrmCapacity');if(kind==='pedido'&&typeof MachineOps!=='undefined'&&MachineOps.deadlineCapacityRisk){const x=MachineOps.deadlineCapacityRisk(id,f['Fecha entrega']);cap.style.display='';cap.className='cal-crm-cap '+x.status;cap.textContent=x.message;}else cap.style.display='none';
  const action=document.getElementById('calCrmPrimaryAction');if(kind==='cotizacion'){action.textContent='✓ Marcar enviada';action.style.display=f['Estado cotización']==='Solicitada'?'':'none';}else{action.textContent='▶ Iniciar producción';action.style.display=['Confirmado',''].includes(f['Estado pedido']||'')?'':'none';}
  document.getElementById('calCrmReason').value='';modal.style.display='flex';setTimeout(()=>{const map={'Fecha límite cotización':'calCrmCotDue','Fecha vencimiento':'calCrmCotExpiry','Fecha objetivo interna':'calCrmPedInternal','Fecha entrega':'calCrmPedDelivery'};document.getElementById(map[focusField]||'calCrmReason')?.focus();},50);
}
function closeCalCrmModal(){const m=document.getElementById('calCrmModal');if(m)m.style.display='none';}
function _calValidateCrmDates(kind,dates){
  const x=dates||{};
  if(kind==='pedido'&&x.internal&&x.delivery&&x.internal>x.delivery)return'La meta interna debe ser anterior o igual a la entrega al cliente.';
  if(kind==='cotizacion'&&x.due&&x.expiry&&x.due>x.expiry)return'La fecha límite para enviar no puede quedar después del vencimiento de la propuesta.';
  return'';
}
async function calSaveCrmDates(){
  const kind=document.getElementById('calCrmKind').value,id=document.getElementById('calCrmId').value,rec=_calRecord(kind,id);if(!rec)return;const reason=(document.getElementById('calCrmReason').value||'').trim();
  const dates={due:document.getElementById('calCrmCotDue').value,expiry:document.getElementById('calCrmCotExpiry').value,internal:document.getElementById('calCrmPedInternal').value,delivery:document.getElementById('calCrmPedDelivery').value},invalid=_calValidateCrmDates(kind,dates);if(invalid){toast(invalid,'error');return;}
  const changes=kind==='cotizacion'?[['Fecha límite cotización',dates.due],['Fecha vencimiento',dates.expiry]]:[['Fecha objetivo interna',dates.internal],['Fecha entrega',dates.delivery]];
  const dirty=changes.filter(([field,to])=>(rec.fields[field]||'')!==(to||''));if(!dirty.length){closeCalCrmModal();return;}if(dirty.some(([field])=>rec.fields[field])&&!reason){toast('Escribe el motivo de la reprogramación','error');return;}
  try{for(const [field,to] of dirty)await calUpdateCrmDate(kind,id,field,to,reason,true);toast('✓ Fechas guardadas','success');closeCalCrmModal();renderCalendario();}catch(e){toast('Error: '+e.message,'error');}
}
async function calCrmPrimaryAction(){
  const kind=document.getElementById('calCrmKind').value,id=document.getElementById('calCrmId').value,rec=_calRecord(kind,id);if(!rec)return;
  try{if(kind==='cotizacion'){const fields={'Estado cotización':'Enviada'};if(!rec.fields['Fecha vencimiento'])fields['Fecha vencimiento']=calBusinessDate(_calFmtFecha(new Date()),10);await airtableWrite('Cotizaciones','PATCH',id,fields);Object.assign(rec.fields,fields);toast('✓ Cotización marcada como enviada; vigencia iniciada','success');}else if(typeof advancePedido==='function'){closeCalCrmModal();await advancePedido(id,'En producción');renderCalendario();return;}closeCalCrmModal();renderCalendario();try{renderCotizaciones();}catch(e){}}catch(e){toast('Error: '+e.message,'error');}
}
function _calCustomerRecord(fields){const raw=Array.isArray(fields?.Cliente)?fields.Cliente[0]:fields?.Cliente;return (state.clientes||[]).find(c=>c.id===raw)||null;}
function calShareReminder(){
  const kind=document.getElementById('calCrmKind').value,id=document.getElementById('calCrmId').value,rec=_calRecord(kind,id);if(!rec)return;const f=rec.fields||{},client=_calCustomerRecord(f),contact=client?.fields?.Contacto||client?.fields?.Empresa||_calClient(f),num=f[kind==='pedido'?'N° Pedido':'N° Cotización']||'',date=kind==='pedido'?f['Fecha entrega']:(f['Estado cotización']==='Enviada'?f['Fecha vencimiento']:f['Fecha límite cotización']);
  if(!date){toast('Primero define una fecha para compartir','error');return;}const pretty=_calDate(date).toLocaleDateString('es-CL',{day:'numeric',month:'long',year:'numeric'}),text=kind==='pedido'?`Hola ${contact}, confirmamos que la entrega del pedido ${num} está programada para el ${pretty}. Te avisaremos si existe alguna novedad.`:f['Estado cotización']==='Enviada'?`Hola ${contact}, la cotización ${num} está disponible y su vigencia es hasta el ${pretty}. Quedamos atentos a tus comentarios.`:`Hola ${contact}, estamos preparando la cotización ${num} y nos comprometemos a enviarla a más tardar el ${pretty}.`;
  const phone=String(client?.fields?.['Teléfono']||client?.fields?.WhatsApp||'').replace(/\D/g,''),wa=phone?(phone.length<=9?'56'+phone:phone):'';
  if(wa){window.open(`https://wa.me/${wa}?text=${encodeURIComponent(text)}`,'_blank');return;}
  if(navigator.share){navigator.share({text}).catch(()=>{});return;}
  navigator.clipboard?.writeText(text).then(()=>toast('✓ Aviso copiado para compartir','success')).catch(()=>toast(text,'info'));
}
function calQuickSchedule(kind,id,field){openCalCrmModal(kind,id,field);}
async function calRescheduleEvent(id,fecha){
  const ev=_calEventById(id);if(!ev||ev.fecha===fecha)return;
  if(ev.source==='crm'){const reason=(prompt(`Mover “${ev.titulo}” de ${ev.fecha} a ${fecha}.\nMotivo:`,`Reprogramación desde calendario`)||'').trim();if(!reason)return;try{await calUpdateCrmDate(ev.recordKind,ev.recordId,ev.field,fecha,reason);}catch(e){toast('Error: '+e.message,'error');}return;}
  if(!confirm(`¿Mover “${ev.titulo||'evento'}” al ${fecha}?`))return;const arr=_calAll(),item=arr.find(x=>x.id===id);if(item){item.fecha=fecha;item.mts=Date.now();_calSave(arr);renderCalendario();_calAutoSync();}
}
function calLoadSyncPrefs(){const p=_calSyncPrefs();['manual','cot_due','cot_expiry','ped_internal','ped_delivery','onlyMine'].forEach(k=>{const el=document.getElementById('calSync_'+k);if(el)el.checked=p[k]!==false;});}
function calSaveSyncPrefs(){const p={};['manual','cot_due','cot_expiry','ped_internal','ped_delivery','onlyMine'].forEach(k=>{const el=document.getElementById('calSync_'+k);p[k]=!!el?.checked;});try{localStorage.setItem(_CAL_SYNC_PREF_KEY,JSON.stringify(p));}catch(e){}toast('✓ Preferencias de Google guardadas','success');renderCalendario();_calAutoSync();}

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
    calLoadSyncPrefs();
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
