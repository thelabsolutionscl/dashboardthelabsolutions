#!/usr/bin/env node
'use strict';

/** The Lab Solutions — durable production store (Node preload). */
const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

const ROOT=__dirname;
const DATA_DIR=process.env.FARM_DATA_DIR||path.join(ROOT,'data');
const PRODUCTION_FILE=process.env.FARM_PRODUCTION_FILE||path.join(DATA_DIR,'production.json');
const DASHBOARD_ORIGIN=process.env.BRIDGE_ALLOW_ORIGIN||'https://dashboard.thelab.solutions';
const HISTORY_LIMIT=Math.max(500,Math.min(20000,Number(process.env.FARM_PRODUCTION_HISTORY_LIMIT||5000)));
const MAX_BODY=4*1024*1024;
fs.mkdirSync(DATA_DIR,{recursive:true,mode:0o700});

function finite(v,fallback=0){const n=Number(v);return Number.isFinite(n)?n:fallback;}
function nonNegative(v){return Math.max(0,finite(v));}
function safeEq(a,b){const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);}
function atomicWrite(file,value){
  const tmp=file+'.tmp-'+process.pid+'-'+Date.now();
  fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  const fd=fs.openSync(tmp,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(tmp,file);
  try{const dfd=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}}catch(_){}
}
function loadOrCreateMasterToken(){
  if(process.env.BRIDGE_TOKEN)return process.env.BRIDGE_TOKEN.trim();
  const file=path.join(ROOT,'.bridge-token');try{const t=fs.readFileSync(file,'utf8').trim();if(t)return t;}catch(_){}
  const t=crypto.randomBytes(24).toString('base64url');fs.writeFileSync(file,t+'\n',{mode:0o600});return t;
}
const MASTER_TOKEN=loadOrCreateMasterToken();
const TOKENS={admin:(process.env.BRIDGE_ADMIN_TOKEN||MASTER_TOKEN).trim(),operator:(process.env.BRIDGE_OPERATOR_TOKEN||'').trim(),viewer:(process.env.BRIDGE_VIEWER_TOKEN||'').trim()};
const ROLE_RANK={viewer:1,operator:2,admin:3};
function tokenFromReq(req){const u=new URL(req.url,'http://farm.local');return String(req.headers['x-bridge-token']||u.searchParams.get('bt')||'');}
function roleForToken(token){if(TOKENS.admin&&safeEq(token,TOKENS.admin))return'admin';if(TOKENS.operator&&safeEq(token,TOKENS.operator))return'operator';if(TOKENS.viewer&&safeEq(token,TOKENS.viewer))return'viewer';return'';}
function requireRole(req,res,minimum){const role=roleForToken(tokenFromReq(req));if(!role||ROLE_RANK[role]<ROLE_RANK[minimum]){json(res,403,{ok:false,error:'forbidden',requiredRole:minimum});return'';}return role;}
function setCors(req,res){const origin=String(req.headers.origin||'');if(!origin||DASHBOARD_ORIGIN==='*'||origin===DASHBOARD_ORIGIN){res.setHeader('Access-Control-Allow-Origin',origin||DASHBOARD_ORIGIN);res.setHeader('Vary','Origin');}res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Bridge-Token,Authorization');res.setHeader('Access-Control-Expose-Headers','X-Farm-Role');res.setHeader('Access-Control-Max-Age','86400');res.setHeader('Cache-Control','no-store');}
function json(res,status,body,headers={}){if(!res.headersSent)res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(body));}
function readBody(req,limit=MAX_BODY){return new Promise((resolve,reject)=>{const parts=[];let size=0;req.on('data',c=>{size+=c.length;if(size>limit){reject(new Error('payload demasiado grande'));req.destroy();}else parts.push(c);});req.on('end',()=>resolve(Buffer.concat(parts)));req.on('error',reject);});}

function normalizeOdometerEntry(raw){const v=raw&&typeof raw==='object'?raw:{};return{hours:nonNegative(v.hours),filamentMm:nonNegative(v.filamentMm),prints:Math.floor(nonNegative(v.prints)),failures:Math.floor(nonNegative(v.failures))};}
function eventKey(raw){const machineId=String(raw?.machineId||raw?.id||'').trim(),file=String(raw?.file||'').trim().toLowerCase(),start=finite(raw?.start),end=finite(raw?.end),result=String(raw?.result||'').trim().toLowerCase();return crypto.createHash('sha256').update([machineId,file,start,end,result].join('\0')).digest('hex').slice(0,24);}
function normalizeEvent(raw){
  if(!raw||typeof raw!=='object')return null;const machineId=String(raw.machineId||raw.id||'').trim();if(!machineId)return null;
  const start=finite(raw.start),end=finite(raw.end),dur=Math.max(0,finite(raw.dur,start&&end&&end>=start?(end-start)/60000:0)),result=String(raw.result||'').trim()||'Desconocido';
  return{eventId:String(raw.eventId||eventKey({...raw,machineId})).slice(0,80),machineId,id:machineId,nombre:String(raw.nombre||'').slice(0,120),numG:raw.numG==null?'':String(raw.numG).slice(0,32),file:String(raw.file||'').slice(0,240),start,end,dur,result:result.slice(0,40),filamentMm:nonNegative(raw.filamentMm),ts:finite(raw.ts,end||Date.now()),queueJobId:String(raw.queueJobId||'').slice(0,160),machineOpsJobId:String(raw.machineOpsJobId||'').slice(0,160),pedidoId:String(raw.pedidoId||'').slice(0,160)};
}
function mergeHistory(existing,incoming,limit=HISTORY_LIMIT){const map=new Map();for(const raw of[...(Array.isArray(existing)?existing:[]),...(Array.isArray(incoming)?incoming:[])]){const e=normalizeEvent(raw);if(!e)continue;const prev=map.get(e.eventId);if(!prev||e.ts>=prev.ts)map.set(e.eventId,e);}return[...map.values()].sort((a,b)=>(b.ts||b.end||0)-(a.ts||a.end||0)).slice(0,limit);}
function deriveOdometer(history){const out={};for(const raw of Array.isArray(history)?history:[]){const e=normalizeEvent(raw);if(!e)continue;const row=out[e.machineId]||(out[e.machineId]={hours:0,filamentMm:0,prints:0,failures:0}),completed=e.result.toLowerCase()==='completado';if(completed){row.hours+=e.dur/60;row.prints++;}else row.failures++;row.filamentMm+=e.filamentMm;}return out;}
function normalizeProduction(raw){const p=raw&&typeof raw==='object'?raw:{},odometer={};for(const[machineId,value]of Object.entries(p.odometer&&typeof p.odometer==='object'?p.odometer:{})){if(machineId)odometer[machineId]=normalizeOdometerEntry(value);}return{version:1,updatedAt:nonNegative(p.updatedAt),history:mergeHistory([],p.history),odometer};}
function mergeMigration(state,payload,now=Date.now()){
  const target=normalizeProduction(state),incomingHistory=mergeHistory([],payload?.history);target.history=mergeHistory(target.history,incomingHistory);const derived=deriveOdometer(incomingHistory),incomingOdo=payload?.odometer&&typeof payload.odometer==='object'?payload.odometer:{},ids=new Set([...Object.keys(target.odometer),...Object.keys(derived),...Object.keys(incomingOdo)]);
  for(const id of ids){const current=normalizeOdometerEntry(target.odometer[id]),fromHistory=normalizeOdometerEntry(derived[id]),fromBrowser=normalizeOdometerEntry(incomingOdo[id]);target.odometer[id]={hours:Math.max(current.hours,fromHistory.hours,fromBrowser.hours),filamentMm:Math.max(current.filamentMm,fromHistory.filamentMm,fromBrowser.filamentMm),prints:Math.max(current.prints,fromHistory.prints,fromBrowser.prints),failures:Math.max(current.failures,fromHistory.failures,fromBrowser.failures)};}target.updatedAt=now;return target;
}
function recordEvent(state,raw,now=Date.now()){
  const target=normalizeProduction(state),event=normalizeEvent(raw);if(!event)return{state:target,event:null,added:false};if(target.history.some(h=>h.eventId===event.eventId))return{state:target,event,added:false};target.history=mergeHistory([event],target.history);const row=target.odometer[event.machineId]||(target.odometer[event.machineId]=normalizeOdometerEntry(null));if(event.result.toLowerCase()==='completado'){row.hours+=event.dur/60;row.prints++;}else row.failures++;row.filamentMm+=event.filamentMm;target.updatedAt=now;return{state:target,event,added:true};
}

let loadError='';
function loadProduction(){
  try{return normalizeProduction(JSON.parse(fs.readFileSync(PRODUCTION_FILE,'utf8')));}
  catch(e){if(e?.code==='ENOENT')return normalizeProduction(null);loadError='production.json no se pudo leer: '+(e?.message||String(e));console.error('[production]',loadError);return normalizeProduction(null);}
}
let production=loadProduction(),writeChain=Promise.resolve();
function persistProduction(){
  if(loadError){const e=new Error(loadError);e.persistence=true;return Promise.reject(e);}
  production.updatedAt=Date.now();const payload=JSON.parse(JSON.stringify(production));
  const op=writeChain.then(()=>atomicWrite(PRODUCTION_FILE,payload));
  writeChain=op.catch(e=>console.error('[production] persist',e));
  return op.catch(e=>{e.persistence=true;throw e;});
}
function snapshot(){return{version:1,updatedAt:production.updatedAt,history:production.history,odometer:production.odometer,historyCount:production.history.length,historyLimit:HISTORY_LIMIT,storageOk:!loadError,storageError:loadError};}
function mutationError(res,e){return json(res,e?.persistence?507:400,{ok:false,error:e?.message||String(e),storage:e?.persistence?'not-durable':'invalid-request'});}
async function handleProduction(req,res){
  setCors(req,res);if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}const u=new URL(req.url,'http://farm.local'),p=u.pathname;
  if(p==='/farm/production'&&req.method==='GET'){const role=requireRole(req,res,'viewer');if(!role)return;if(loadError)return json(res,503,{ok:false,error:loadError,production:snapshot()},{'X-Farm-Role':role});return json(res,200,{ok:true,production:snapshot()},{'X-Farm-Role':role});}
  if(p==='/farm/production/migrate'&&req.method==='POST'){
    const role=requireRole(req,res,'operator');if(!role)return;let body;try{body=JSON.parse((await readBody(req)).toString('utf8')||'{}');}catch(e){return mutationError(res,e);}const before=production,after=mergeMigration(production,body);production=after;try{await persistProduction();return json(res,200,{ok:true,production:snapshot()},{'X-Farm-Role':role});}catch(e){production=before;return mutationError(res,e);}
  }
  if(p==='/farm/production/events'&&req.method==='POST'){
    const role=requireRole(req,res,'operator');if(!role)return;let body;try{body=JSON.parse((await readBody(req,512*1024)).toString('utf8')||'{}');}catch(e){return mutationError(res,e);}const before=production,out=recordEvent(production,body);production=out.state;try{if(out.added)await persistProduction();return json(res,200,{ok:true,added:out.added,event:out.event,production:snapshot()},{'X-Farm-Role':role});}catch(e){production=before;return mutationError(res,e);}
  }
  res.setHeader('Allow','GET,POST,OPTIONS');return json(res,405,{ok:false,error:'method not allowed'});
}
function installPreload(){
  if(http.__TLS_FARM_PRODUCTION_PRELOAD__)return false;http.__TLS_FARM_PRODUCTION_PRELOAD__=true;const originalCreateServer=http.createServer;
  http.createServer=function patchedCreateServer(options,requestListener){const hasOptions=typeof options!=='function',listener=hasOptions?requestListener:options;if(typeof listener!=='function')return originalCreateServer.apply(this,arguments);const wrapped=function(req,res){let pathname='';try{pathname=new URL(req.url,'http://farm.local').pathname;}catch(_){}if(pathname==='/farm/production'||pathname.startsWith('/farm/production/')){handleProduction(req,res).catch(e=>{if(!res.headersSent)json(res,500,{ok:false,error:e.message});else try{res.end();}catch(_){}});return;}return listener(req,res);};return hasOptions?originalCreateServer.call(this,options,wrapped):originalCreateServer.call(this,wrapped);};return true;
}
if(process.env.FARM_PRODUCTION_PRELOAD_DISABLE!=='1')installPreload();
module.exports={eventKey,normalizeEvent,mergeHistory,deriveOdometer,normalizeProduction,mergeMigration,recordEvent,roleForToken,installPreload,snapshot,atomicWrite,persistProduction};
