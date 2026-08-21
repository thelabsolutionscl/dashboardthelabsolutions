#!/usr/bin/env node
'use strict';

/**
 * The Lab Solutions — métricas históricas de confiabilidad (Node preload).
 *
 * Fuente: production.json + health.json + registry.json.
 * No genera una segunda telemetría: deriva uptime/MTBF/MTTR/utilización de los
 * eventos centrales que ya persisten los otros módulos del Farm Controller.
 */
const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

const ROOT=__dirname;
const DATA_DIR=process.env.FARM_DATA_DIR||path.join(ROOT,'data');
const PRODUCTION_FILE=process.env.FARM_PRODUCTION_FILE||path.join(DATA_DIR,'production.json');
const HEALTH_FILE=process.env.FARM_HEALTH_FILE||path.join(DATA_DIR,'health.json');
const REGISTRY_FILE=process.env.FARM_REGISTRY_FILE||path.join(DATA_DIR,'registry.json');
const DASHBOARD_ORIGIN=process.env.BRIDGE_ALLOW_ORIGIN||'https://dashboard.thelab.solutions';
const DEFAULT_DAYS=Math.max(1,Math.min(365,Number(process.env.FARM_RELIABILITY_DEFAULT_DAYS||30)));
const CACHE_MS=Math.max(5000,Math.min(5*60_000,Number(process.env.FARM_RELIABILITY_CACHE_MS||30_000)));

function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function clamp(v,min,max){return Math.min(max,Math.max(min,v));}
function pct(v){return Number.isFinite(v)?Math.round(v*10)/10:null;}
function hours(ms){return Number.isFinite(ms)?Math.round(ms/360000)/10:null;}
function safeEq(a,b){const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);}
function readJsonDetailed(file){
  try{const stat=fs.statSync(file);return{exists:true,ok:true,value:JSON.parse(fs.readFileSync(file,'utf8')),mtimeMs:stat.mtimeMs,error:''};}
  catch(e){if(e&&e.code==='ENOENT')return{exists:false,ok:true,value:null,mtimeMs:0,error:''};return{exists:true,ok:false,value:null,mtimeMs:0,error:String(e.message||e)};}
}
function loadOrCreateMasterToken(){
  if(process.env.BRIDGE_TOKEN)return process.env.BRIDGE_TOKEN.trim();
  const file=path.join(ROOT,'.bridge-token');
  try{const t=fs.readFileSync(file,'utf8').trim();if(t)return t;}catch(_){}
  const t=crypto.randomBytes(24).toString('base64url');fs.writeFileSync(file,t+'\n',{mode:0o600});return t;
}
const MASTER_TOKEN=loadOrCreateMasterToken();
const TOKENS={admin:(process.env.BRIDGE_ADMIN_TOKEN||MASTER_TOKEN).trim(),operator:(process.env.BRIDGE_OPERATOR_TOKEN||'').trim(),viewer:(process.env.BRIDGE_VIEWER_TOKEN||'').trim()};
const ROLE_RANK={viewer:1,operator:2,admin:3};
function tokenFromReq(req){const u=new URL(req.url,'http://farm.local');return String(req.headers['x-bridge-token']||u.searchParams.get('bt')||'');}
function roleForToken(token){if(TOKENS.admin&&safeEq(token,TOKENS.admin))return'admin';if(TOKENS.operator&&safeEq(token,TOKENS.operator))return'operator';if(TOKENS.viewer&&safeEq(token,TOKENS.viewer))return'viewer';return'';}
function setCors(req,res){const origin=String(req.headers.origin||'');if(!origin||DASHBOARD_ORIGIN==='*'||origin===DASHBOARD_ORIGIN){res.setHeader('Access-Control-Allow-Origin',origin||DASHBOARD_ORIGIN);res.setHeader('Vary','Origin');}res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Bridge-Token,Authorization');res.setHeader('Access-Control-Expose-Headers','X-Farm-Role');res.setHeader('Cache-Control','no-store');}
function json(res,status,body,headers={}){if(!res.headersSent)res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(body));}
function requireRole(req,res,min){const role=roleForToken(tokenFromReq(req));if(!role||ROLE_RANK[role]<ROLE_RANK[min]){json(res,403,{ok:false,error:'forbidden',requiredRole:min});return'';}return role;}

function parseIncidentAlertId(alertId){
  const m=String(alertId||'').match(/^machine:(.+?):(offline|klipper-(?:shutdown|error))$/);
  return m?{machineId:m[1],type:m[2]}:null;
}
function normalizeHealthEvent(raw){
  const meta=parseIncidentAlertId(raw?.alertId);const at=finite(raw?.at);
  if(!meta||!at||!['opened','resolved'].includes(String(raw?.state||'')))return null;
  return{alertId:String(raw.alertId),machineId:meta.machineId,type:meta.type,state:String(raw.state),at};
}
function incidentIntervals(events,now=Date.now()){
  const sorted=(Array.isArray(events)?events:[]).map(normalizeHealthEvent).filter(Boolean).sort((a,b)=>a.at-b.at);
  const active=new Map(),out=[];
  for(const e of sorted){
    if(e.state==='opened'){
      // Un restart antiguo podía volver a registrar "opened". Si ya está activo,
      // se ignora: no crea un segundo incidente ni altera MTBF/MTTR.
      if(!active.has(e.alertId))active.set(e.alertId,{machineId:e.machineId,type:e.type,alertId:e.alertId,start:e.at});
      continue;
    }
    const open=active.get(e.alertId);if(!open)continue;
    if(e.at>=open.start)out.push({...open,end:e.at,open:false});
    active.delete(e.alertId);
  }
  for(const open of active.values())out.push({...open,end:now,open:true});
  return out.filter(x=>x.end>x.start);
}
function mergeIntervals(intervals,start,end){
  const clipped=(Array.isArray(intervals)?intervals:[]).map(x=>({
    machineId:x.machineId,start:Math.max(start,x.start),end:Math.min(end,x.end),rawStart:x.start,rawEnd:x.end,open:!!x.open,types:new Set([x.type].filter(Boolean))
  })).filter(x=>x.end>x.start).sort((a,b)=>a.machineId.localeCompare(b.machineId)||a.start-b.start||a.end-b.end);
  const by={};
  for(const x of clipped){
    const arr=by[x.machineId]||(by[x.machineId]=[]),prev=arr[arr.length-1];
    if(prev&&x.start<=prev.end){prev.end=Math.max(prev.end,x.end);prev.rawStart=Math.min(prev.rawStart,x.rawStart);prev.rawEnd=Math.max(prev.rawEnd,x.rawEnd);prev.open=prev.open||x.open;for(const t of x.types)prev.types.add(t);}
    else arr.push(x);
  }
  return by;
}
function productionInterval(raw){
  if(!raw||typeof raw!=='object')return null;
  const machineId=String(raw.machineId||raw.id||'').trim();if(!machineId)return null;
  const durMs=Math.max(0,finite(raw.dur)*60000);
  let start=finite(raw.start),end=finite(raw.end)||finite(raw.ts);
  if(!start&&end&&durMs)start=end-durMs;
  if(!end&&start&&durMs)end=start+durMs;
  if(!start||!end||end<=start)return null;
  const result=String(raw.result||'').trim();
  return{machineId,start,end,result,completed:['completado','completed','done','success'].includes(result.toLowerCase())};
}
function productionByMachine(history,start,end){
  const rows=(Array.isArray(history)?history:[]).map(productionInterval).filter(Boolean).filter(x=>x.end>start&&x.start<end);
  const by={};
  for(const r of rows){
    const item=by[r.machineId]||(by[r.machineId]={events:[],intervals:[],completed:0,notCompleted:0});
    item.events.push(r);item.intervals.push({machineId:r.machineId,start:r.start,end:r.end});
    if(r.completed)item.completed++;else item.notCompleted++;
  }
  for(const item of Object.values(by))item.merged=(mergeIntervals(item.intervals,start,end)[item.intervals[0]?.machineId]||[]);
  return by;
}
function sumDuration(intervals){return(Array.isArray(intervals)?intervals:[]).reduce((n,x)=>n+Math.max(0,x.end-x.start),0);}
function healthCoverageStart(health,detail,now){
  const stored=finite(health?.startedAt);if(stored)return Math.min(stored,now);
  const events=Array.isArray(health?.events)?health.events:[];
  const oldest=events.reduce((m,e)=>{const at=finite(e?.at);return at&&(!m||at<m)?at:m;},0);
  if(oldest)return oldest;
  // Archivo existente pero sin startedAt/eventos: sólo sabemos que existía a su mtime.
  if(detail?.exists&&detail?.mtimeMs)return Math.min(detail.mtimeMs,now);
  return 0;
}
function machineMetrics({machine,incidents=[],production=null,windowStart,windowEnd,coverageStart,healthKnown}){
  const observedStart=Math.max(windowStart,coverageStart||windowStart);
  const observedMs=Math.max(0,windowEnd-observedStart);
  const incidentRows=(incidents||[]).filter(x=>x.end>observedStart&&x.start<windowEnd);
  const downtimeMs=healthKnown?sumDuration(incidentRows):null;
  const availableMs=healthKnown?Math.max(0,observedMs-downtimeMs):null;
  const failures=healthKnown?incidentRows.filter(x=>x.rawStart>=observedStart&&x.rawStart<=windowEnd).length:null;
  const resolved=healthKnown?incidentRows.filter(x=>!x.open&&x.end<=windowEnd):[];
  const resolvedDowntime=healthKnown?sumDuration(resolved):null;
  const openIncidents=healthKnown?incidentRows.filter(x=>x.open).length:null;
  const printMs=production?sumDuration(production.merged):0;
  const attempts=(production?.completed||0)+(production?.notCompleted||0);
  const completionRate=attempts?production.completed/attempts*100:null;
  const availability=healthKnown&&observedMs?availableMs/observedMs*100:null;
  const utilization=healthKnown&&availableMs?clamp(printMs/availableMs*100,0,100):(observedMs?clamp(printMs/observedMs*100,0,100):null);
  const mtbf=healthKnown&&failures>0?availableMs/failures:null;
  const mttr=healthKnown&&resolved.length?resolvedDowntime/resolved.length:null;
  return{
    machineId:String(machine.id||''),name:String(machine.nombre||machine.name||machine.hostname||machine.id||''),model:String(machine.modelo||machine.model||''),
    observedFrom:observedStart,observedHours:hours(observedMs),availabilityPct:pct(availability),downtimeHours:downtimeMs==null?null:hours(downtimeMs),
    incidents:failures,resolvedIncidents:healthKnown?resolved.length:null,openIncidents,mtbfHours:mtbf==null?null:hours(mtbf),mttrHours:mttr==null?null:hours(mttr),
    printHours:hours(printMs),utilizationPct:pct(utilization),completed:production?.completed||0,notCompleted:production?.notCompleted||0,completionRatePct:pct(completionRate),
    lastFailureAt:incidentRows.reduce((m,x)=>Math.max(m,x.rawStart||0),0),
  };
}
function aggregateFleet(machines){
  const known=machines.filter(m=>m.observedHours!=null&&m.availabilityPct!=null),productionKnown=machines.filter(m=>m.printHours!=null);
  const totalObserved=known.reduce((n,m)=>n+(m.observedHours||0),0);
  const totalDowntime=known.reduce((n,m)=>n+(m.downtimeHours||0),0);
  const totalAvailable=Math.max(0,totalObserved-totalDowntime);
  const totalPrint=productionKnown.reduce((n,m)=>n+(m.printHours||0),0);
  const completed=machines.reduce((n,m)=>n+(m.completed||0),0),notCompleted=machines.reduce((n,m)=>n+(m.notCompleted||0),0),attempts=completed+notCompleted;
  const incidents=known.reduce((n,m)=>n+(m.incidents||0),0),resolvedIncidents=known.reduce((n,m)=>n+(m.resolvedIncidents||0),0),openIncidents=known.reduce((n,m)=>n+(m.openIncidents||0),0);
  const weightedMttrNumerator=known.reduce((n,m)=>n+((m.mttrHours||0)*(m.resolvedIncidents||0)),0);
  return{
    machines:machines.length,healthKnown:known.length,
    availabilityPct:totalObserved?pct((totalObserved-totalDowntime)/totalObserved*100):null,
    downtimeHours:known.length?Math.round(totalDowntime*10)/10:null,
    utilizationPct:totalAvailable?pct(totalPrint/totalAvailable*100):null,
    printHours:Math.round(totalPrint*10)/10,
    completed,notCompleted,completionRatePct:attempts?pct(completed/attempts*100):null,
    incidents,resolvedIncidents,openIncidents,mtbfHours:incidents?Math.round(totalAvailable/incidents*10)/10:null,
    mttrHours:resolvedIncidents?Math.round(weightedMttrNumerator/resolvedIncidents*10)/10:null,
  };
}
function buildReliability({registry,production,health,healthDetail,days=DEFAULT_DAYS,now=Date.now()}){
  const requestedDays=clamp(Math.floor(finite(days,DEFAULT_DAYS)),1,365),windowStart=now-requestedDays*86400000;
  const machines=Array.isArray(registry?.machines)?registry.machines.filter(m=>m&&m.id):[];
  const healthKnown=!!healthDetail?.exists&&!!healthDetail?.ok;
  const coverageStart=healthCoverageStart(health,healthDetail,now);
  const rawIncidents=incidentIntervals(health?.events,now),mergedIncidents=mergeIntervals(rawIncidents,windowStart,now);
  const prod=productionByMachine(production?.history,windowStart,now);
  const rows=machines.map(machine=>machineMetrics({machine,incidents:mergedIncidents[machine.id]||[],production:prod[machine.id]||null,windowStart,windowEnd:now,coverageStart,healthKnown}));
  return{
    generatedAt:now,days:requestedDays,windowStart,windowEnd:now,
    coverage:{healthKnown,healthStartedAt:coverageStart||0,productionEvents:Array.isArray(production?.history)?production.history.length:0,healthEvents:Array.isArray(health?.events)?health.events.length:0},
    summary:aggregateFleet(rows),machines:rows,
    definitions:{availability:'tiempo observado sin incidentes offline/Klipper crítico',utilization:'horas imprimiendo / horas disponibles',completionRate:'trabajos completados / trabajos terminados registrados',mtbf:'horas disponibles / incidentes iniciados',mttr:'duración media de incidentes resueltos'},
  };
}

let cache={key:'',at:0,value:null};
function currentSnapshot(days){
  const d=clamp(Math.floor(finite(days,DEFAULT_DAYS)),1,365),now=Date.now();
  const details={registry:readJsonDetailed(REGISTRY_FILE),production:readJsonDetailed(PRODUCTION_FILE),health:readJsonDetailed(HEALTH_FILE)};
  const key=[d,details.registry.mtimeMs,details.production.mtimeMs,details.health.mtimeMs].join(':');
  if(cache.value&&cache.key===key&&now-cache.at<CACHE_MS)return cache.value;
  const value=buildReliability({registry:details.registry.ok?details.registry.value:null,production:details.production.ok?details.production.value:null,health:details.health.ok?details.health.value:null,healthDetail:details.health,days:d,now});
  value.sources={registry:{exists:details.registry.exists,valid:details.registry.ok,error:details.registry.error},production:{exists:details.production.exists,valid:details.production.ok,error:details.production.error},health:{exists:details.health.exists,valid:details.health.ok,error:details.health.error}};
  cache={key,at:now,value};return value;
}
async function handleReliability(req,res){
  setCors(req,res);if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  const u=new URL(req.url,'http://farm.local');
  if(u.pathname==='/farm/reliability'&&req.method==='GET'){
    const role=requireRole(req,res,'viewer');if(!role)return;
    return json(res,200,{ok:true,reliability:currentSnapshot(u.searchParams.get('days'))},{'X-Farm-Role':role});
  }
  res.setHeader('Allow','GET,OPTIONS');return json(res,405,{ok:false,error:'method not allowed'});
}
function installPreload(){
  if(http.__TLS_FARM_RELIABILITY_PRELOAD__)return false;http.__TLS_FARM_RELIABILITY_PRELOAD__=true;
  const originalCreateServer=http.createServer;
  http.createServer=function patchedCreateServer(options,requestListener){
    const hasOptions=typeof options!=='function',listener=hasOptions?requestListener:options;if(typeof listener!=='function')return originalCreateServer.apply(this,arguments);
    const wrapped=function(req,res){let pathname='';try{pathname=new URL(req.url,'http://farm.local').pathname;}catch(_){}if(pathname==='/farm/reliability'){handleReliability(req,res).catch(e=>{if(!res.headersSent)json(res,500,{ok:false,error:e.message});else try{res.end();}catch(_){}});return;}return listener(req,res);};
    return hasOptions?originalCreateServer.call(this,options,wrapped):originalCreateServer.call(this,wrapped);
  };
  return true;
}
if(process.env.FARM_RELIABILITY_PRELOAD_DISABLE!=='1')installPreload();
module.exports={parseIncidentAlertId,normalizeHealthEvent,incidentIntervals,mergeIntervals,productionInterval,productionByMachine,healthCoverageStart,machineMetrics,aggregateFleet,buildReliability,roleForToken,installPreload};