/* js/printer-history-adapter.js
 * Historial/odómetro durable para la granja 3D.
 *
 * maquinas.js conserva localStorage como caché y fallback. Este adaptador
 * sincroniza el estado con /farm/production y envía cada cierre de impresión
 * como evento idempotente, evitando perder horas al cambiar de navegador.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root){root.PrinterHistory=api;api.install(root);}
})(typeof window!=='undefined'?window:null,function(){
'use strict';

const HIST_KEY='printer_history_v1';
const ODO_KEY='printer_odometer_v1';
const SEEDED_KEY='printer_odometer_seeded';
const MIGRATED_KEY='printer_history_farm_migrated_v1';
const DIRTY_KEY='printer_history_farm_dirty_v1';
const LOCAL_HISTORY_LIMIT=4000;

function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function nonNegative(v){return Math.max(0,finite(v));}
function hashText(value){
  let h=2166136261;
  for(const c of String(value||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}
  return(h>>>0).toString(16).padStart(8,'0');
}
function eventKey(raw){
  const machineId=String(raw?.machineId||raw?.id||'').trim();
  const file=String(raw?.file||'').trim().toLowerCase();
  const start=finite(raw?.start),end=finite(raw?.end);
  const result=String(raw?.result||'').trim().toLowerCase();
  return hashText([machineId,file,start,end,result].join('\0'))+
    hashText([result,end,start,file,machineId].join('\0'));
}
function normalizeEvent(raw){
  if(!raw||typeof raw!=='object')return null;
  const machineId=String(raw.machineId||raw.id||'').trim();if(!machineId)return null;
  const start=finite(raw.start),end=finite(raw.end);
  const dur=Math.max(0,finite(raw.dur,start&&end&&end>=start?(end-start)/60000:0));
  return{
    eventId:String(raw.eventId||eventKey({...raw,machineId})).slice(0,80),
    machineId,id:machineId,nombre:String(raw.nombre||'').slice(0,120),
    numG:raw.numG==null?'':String(raw.numG).slice(0,32),
    file:String(raw.file||'').slice(0,240),start,end,dur,
    result:(String(raw.result||'').trim()||'Desconocido').slice(0,40),
    filamentMm:nonNegative(raw.filamentMm),ts:finite(raw.ts,end||Date.now()),
  };
}
function mergeHistory(a,b,limit=LOCAL_HISTORY_LIMIT){
  const map=new Map();
  [...(Array.isArray(a)?a:[]),...(Array.isArray(b)?b:[])].forEach(raw=>{
    const e=normalizeEvent(raw);if(!e)return;
    const prev=map.get(e.eventId);if(!prev||e.ts>=prev.ts)map.set(e.eventId,e);
  });
  return[...map.values()].sort((x,y)=>(y.ts||y.end||0)-(x.ts||x.end||0)).slice(0,limit);
}
function deriveOdometer(history){
  const out={};
  (Array.isArray(history)?history:[]).forEach(raw=>{
    const e=normalizeEvent(raw);if(!e)return;
    const row=out[e.machineId]||(out[e.machineId]={hours:0,filamentMm:0,prints:0,failures:0});
    if(e.result.toLowerCase()==='completado'){row.hours+=e.dur/60;row.prints++;}
    else row.failures++;
    row.filamentMm+=e.filamentMm;
  });
  return out;
}
function mergeOdometers(a,b){
  const out={},ids=new Set([...Object.keys(a||{}),...Object.keys(b||{})]);
  ids.forEach(id=>{
    const x=a?.[id]||{},y=b?.[id]||{};
    out[id]={
      hours:Math.max(nonNegative(x.hours),nonNegative(y.hours)),
      filamentMm:Math.max(nonNegative(x.filamentMm),nonNegative(y.filamentMm)),
      prints:Math.max(0,Math.floor(Math.max(nonNegative(x.prints),nonNegative(y.prints)))),
      failures:Math.max(0,Math.floor(Math.max(nonNegative(x.failures),nonNegative(y.failures)))),
    };
  });
  return out;
}
function emptyProduction(p){
  return !p||(!(Array.isArray(p.history)&&p.history.length)&&
    (!p.odometer||!Object.keys(p.odometer).length));
}

let installed=false,controllerOk=null,lastSync=0,lastWrite=0,lastError='',serverHistoryCount=0;
let syncing=null,writeChain=Promise.resolve();
let dirty=true,target=null,originalSave=null;

function safeParse(raw,fallback){try{return JSON.parse(raw)||fallback;}catch(_){return fallback;}}
function readLocalHistory(){
  if(!target?.localStorage)return[];
  return mergeHistory([],safeParse(target.localStorage.getItem(HIST_KEY)||'[]',[]));
}
function readLocalOdometer(){
  let stored={};
  try{
    if(typeof target?.getOdometer==='function')stored=JSON.parse(JSON.stringify(target.getOdometer()||{}));
    else stored=safeParse(target?.localStorage?.getItem(ODO_KEY)||'{}',{});
  }catch(_){stored={};}
  return mergeOdometers(stored,deriveOdometer(readLocalHistory()));
}
function base(){
  try{return typeof target?.getPrinterTunnel==='function'?String(target.getPrinterTunnel()||'').replace(/\/$/,''):'';}catch(_){return'';}
}
function token(){
  try{return typeof target?.getPrinterTunnelToken==='function'?String(target.getPrinterTunnelToken()||''):'';}catch(_){return'';}
}
function url(path){
  const b=base(),t=token();return b+path+(t?(path.includes('?')?'&':'?')+'bt='+encodeURIComponent(t):'');
}
async function readJson(r){
  let d=null;try{d=await r.json();}catch(_){}
  if(!r.ok)throw new Error((d&&d.error)||('HTTP '+r.status));
  return d||{};
}
function markDirty(value){
  dirty=!!value;
  try{
    if(dirty)target?.localStorage?.setItem(DIRTY_KEY,'1');
    else target?.localStorage?.removeItem(DIRTY_KEY);
  }catch(_){}
}
function applyProduction(p){
  if(!p||typeof p!=='object')return;
  const history=mergeHistory([],p.history);
  const odo=mergeOdometers({},p.odometer||{});
  try{
    target.localStorage.setItem(HIST_KEY,JSON.stringify(history));
    target.localStorage.setItem(ODO_KEY,JSON.stringify(odo));
    target.localStorage.setItem(SEEDED_KEY,'1');
  }catch(_){}
  try{
    if(typeof target.getOdometer==='function'){
      const live=target.getOdometer();
      Object.keys(live||{}).forEach(k=>delete live[k]);
      Object.assign(live,JSON.parse(JSON.stringify(odo)));
    }
  }catch(_){}
  serverHistoryCount=history.length;
  try{if(typeof target.renderMaintenanceTable==='function')target.renderMaintenanceTable();}catch(_){}
  try{if(typeof target.renderProductionAnalytics==='function')target.renderProductionAnalytics();}catch(_){}
}
async function migrateLocal(){
  const b=base(),t=token();if(!b||!t)throw new Error('controller/token no disponible');
  const payload={history:readLocalHistory(),odometer:readLocalOdometer()};
  const r=await fetch(url('/farm/production/migrate'),{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),
    signal:AbortSignal.timeout(12000),
  });
  const d=await readJson(r);applyProduction(d.production);
  try{target.localStorage.setItem(MIGRATED_KEY,'1');}catch(_){}
  markDirty(false);controllerOk=true;lastSync=Date.now();lastError='';
  return d.production;
}
async function fetchRemote(){
  const b=base(),t=token();if(!b||!t)throw new Error('controller/token no disponible');
  const r=await fetch(url('/farm/production'),{cache:'no-store',signal:AbortSignal.timeout(7000)});
  const d=await readJson(r);return d.production||{};
}
async function sync(force=false){
  if(!target||target._DEMO_MODE)return null;
  if(syncing)return syncing;
  if(!force&&Date.now()-lastSync<30000)return null;
  syncing=(async()=>{
    try{
      const needsMigration=dirty||target.localStorage.getItem(MIGRATED_KEY)!=='1'||
        target.localStorage.getItem(DIRTY_KEY)==='1';
      if(needsMigration)return await migrateLocal();
      const p=await fetchRemote();
      if(emptyProduction(p)&&(readLocalHistory().length||Object.keys(readLocalOdometer()).length)){
        markDirty(true);return await migrateLocal();
      }
      applyProduction(p);controllerOk=true;lastSync=Date.now();lastError='';return p;
    }catch(e){
      controllerOk=false;lastError=e.message;return null;
    }finally{syncing=null;}
  })();
  return syncing;
}
async function postEvent(entry){
  const b=base(),t=token();if(!b||!t)throw new Error('controller/token no disponible');
  const r=await fetch(url('/farm/production/events'),{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(entry),
    signal:AbortSignal.timeout(8000),
  });
  const d=await readJson(r);applyProduction(d.production);
  controllerOk=true;lastSync=Date.now();lastWrite=Date.now();lastError='';markDirty(false);
  return d;
}
function record(raw){
  const entry=normalizeEvent(raw);if(!entry||!target||target._DEMO_MODE)return Promise.resolve(null);
  writeChain=writeChain.then(async()=>{
    try{
      if(dirty||target.localStorage.getItem(MIGRATED_KEY)!=='1'||target.localStorage.getItem(DIRTY_KEY)==='1'){
        await migrateLocal();
      }
      return await postEvent(entry);
    }catch(e){
      controllerOk=false;lastError=e.message;markDirty(true);return null;
    }
  });
  return writeChain;
}
function install(root){
  if(installed||!root)return false;
  target=root;
  if(typeof root.saveHistoryEntry!=='function'||!root.localStorage)return false;
  installed=true;originalSave=root.saveHistoryEntry;
  dirty=root.localStorage.getItem(MIGRATED_KEY)!=='1'||root.localStorage.getItem(DIRTY_KEY)==='1';
  root.saveHistoryEntry=function(m,file,start,end,dur,result,filamentMm=0){
    const out=originalSave.apply(this,arguments);
    const entry=normalizeEvent({
      machineId:m?.id,id:m?.id,nombre:m?.nombre,numG:m?.numG,file,start,end,dur,result,filamentMm,ts:Date.now(),
    });
    if(entry)record(entry);
    return out;
  };
  setTimeout(()=>sync(true),800);
  if(typeof root.setInterval==='function')root.setInterval(()=>{if(!root.document?.hidden)sync(false);},60000);
  if(typeof root.addEventListener==='function')root.addEventListener('focus',()=>sync(true));
  return true;
}
function status(){
  return{
    installed,controllerOk,mode:controllerOk===true?'durable':controllerOk===false?'local-fallback':'checking',
    dirty,lastSync,lastWrite,lastError,serverHistoryCount,
    localHistoryCount:target?readLocalHistory().length:0,
    odometer:target?readLocalOdometer():{},
  };
}

return{
  install,sync,record,status,
  _test:{eventKey,normalizeEvent,mergeHistory,deriveOdometer,mergeOdometers,emptyProduction,HIST_KEY,ODO_KEY},
};
});
