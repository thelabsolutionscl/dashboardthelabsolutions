#!/usr/bin/env node
'use strict';

/** Baseline/config drift durable de impresoras. */
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=__dirname,DATA_DIR=process.env.FARM_DATA_DIR||path.join(ROOT,'data');
const DRIFT_FILE=process.env.FARM_DRIFT_FILE||path.join(DATA_DIR,'drift.json'),REGISTRY_FILE=process.env.FARM_REGISTRY_FILE||path.join(DATA_DIR,'registry.json');
const ORIGIN=process.env.BRIDGE_ALLOW_ORIGIN||'https://dashboard.thelab.solutions';
const INTERVAL_MS=Math.max(60_000,Math.min(6*3600_000,Number(process.env.FARM_DRIFT_INTERVAL_MS||10*60_000)));
const TIMEOUT_MS=Math.max(1000,Math.min(15_000,Number(process.env.FARM_DRIFT_TIMEOUT_MS||4000)));
const MAX_FILES=Math.max(8,Math.min(512,Number(process.env.FARM_DRIFT_MAX_FILES||128)));
const MAX_FILE_BYTES=Math.max(64*1024,Math.min(8*1024*1024,Number(process.env.FARM_DRIFT_MAX_FILE_BYTES||2*1024*1024))),MAX_BODY=128*1024;
fs.mkdirSync(DATA_DIR,{recursive:true,mode:0o700});

function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function safeEq(a,b){const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);}
function sha256(v){return crypto.createHash('sha256').update(v).digest('hex');}
function isPrivateIp(ip){const m=String(ip||'').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);if(!m)return false;const o=m.slice(1).map(Number);if(o.some(x=>x<0||x>255))return false;return o[0]===10||o[0]===127||(o[0]===172&&o[1]>=16&&o[1]<=31)||(o[0]===192&&o[1]===168);}
function atomicWrite(file,value){
  const tmp=file+'.tmp-'+process.pid+'-'+Date.now();
  try{
    fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});
    const fd=fs.openSync(tmp,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.renameSync(tmp,file);
    try{const dfd=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}}catch(_){}
  }catch(e){try{fs.unlinkSync(tmp);}catch(_){}throw e;}
}
function readJsonDetailed(file){try{const stat=fs.statSync(file),value=JSON.parse(fs.readFileSync(file,'utf8'));return{exists:true,ok:true,value,mtimeMs:stat.mtimeMs,error:''};}catch(e){if(e?.code==='ENOENT')return{exists:false,ok:true,value:null,mtimeMs:0,error:''};return{exists:true,ok:false,value:null,mtimeMs:0,error:e?.message||String(e)};}}
function normalizeStore(raw){const v=raw&&typeof raw==='object'?raw:{};return{version:1,updatedAt:Math.max(0,finite(v.updatedAt)),baselines:v.baselines&&typeof v.baselines==='object'&&!Array.isArray(v.baselines)?v.baselines:{},current:v.current&&typeof v.current==='object'&&!Array.isArray(v.current)?v.current:{}};}
function cloneStore(v){return normalizeStore(JSON.parse(JSON.stringify(v||{})));}
const initialStore=readJsonDetailed(DRIFT_FILE);let storeLoadError=initialStore.exists&&!initialStore.ok?initialStore.error:'';let store=normalizeStore(initialStore.value),mutationChain=Promise.resolve();
function transact(mutator){
  const task=mutationChain.then(async()=>{
    if(storeLoadError)throw new Error('drift.json inválido; no se sobrescribirá: '+storeLoadError);
    const before=cloneStore(store),draft=cloneStore(store);
    try{await mutator(draft);draft.updatedAt=Date.now();atomicWrite(DRIFT_FILE,draft);store=draft;return true;}
    catch(e){store=before;throw e;}
  });
  mutationChain=task.catch(()=>{});return task;
}
function storageStatus(e){return/(drift\.json inválido|registry\.json inválido|ENOSPC|EACCES|EROFS|read-only|no space|espacio)/i.test(String(e?.message||e))?507:400;}

function loadOrCreateMasterToken(){if(process.env.BRIDGE_TOKEN)return process.env.BRIDGE_TOKEN.trim();const file=path.join(ROOT,'.bridge-token');try{const t=fs.readFileSync(file,'utf8').trim();if(t)return t;}catch(_){}const t=crypto.randomBytes(24).toString('base64url');fs.writeFileSync(file,t+'\n',{mode:0o600});return t;}
const MASTER_TOKEN=loadOrCreateMasterToken(),TOKENS={admin:(process.env.BRIDGE_ADMIN_TOKEN||MASTER_TOKEN).trim(),operator:(process.env.BRIDGE_OPERATOR_TOKEN||'').trim(),viewer:(process.env.BRIDGE_VIEWER_TOKEN||'').trim()},ROLE_RANK={viewer:1,operator:2,admin:3};
function tokenFromReq(req){const u=new URL(req.url,'http://farm.local');return String(req.headers['x-bridge-token']||u.searchParams.get('bt')||'');}
function roleForToken(token){if(TOKENS.admin&&safeEq(token,TOKENS.admin))return'admin';if(TOKENS.operator&&safeEq(token,TOKENS.operator))return'operator';if(TOKENS.viewer&&safeEq(token,TOKENS.viewer))return'viewer';return'';}
function cors(req,res){const origin=String(req.headers.origin||'');if(!origin||ORIGIN==='*'||origin===ORIGIN){res.setHeader('Access-Control-Allow-Origin',origin||ORIGIN);res.setHeader('Vary','Origin');}res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Bridge-Token,Authorization');res.setHeader('Cache-Control','no-store');}
function json(res,status,body){if(!res.headersSent)res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));}
function requireRole(req,res,min){const role=roleForToken(tokenFromReq(req));if(!role||ROLE_RANK[role]<ROLE_RANK[min]){json(res,403,{ok:false,error:'forbidden',requiredRole:min});return'';}return role;}
function readBody(req){return new Promise((resolve,reject)=>{const chunks=[];let size=0;req.on('data',c=>{size+=c.length;if(size>MAX_BODY){reject(new Error('payload demasiado grande'));req.destroy();}else chunks.push(c);});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject);});}

function requestBuffer(host,targetPath,limit=MAX_FILE_BYTES){return new Promise(resolve=>{const chunks=[];let size=0,done=false,finish=v=>{if(done)return;done=true;resolve(v);};const req=http.get({host,port:7125,path:targetPath,timeout:TIMEOUT_MS},res=>{if((res.statusCode||0)<200||(res.statusCode||0)>=300){res.resume();return finish({ok:false,status:res.statusCode||0,error:'HTTP '+(res.statusCode||0),body:Buffer.alloc(0)});}res.on('data',c=>{size+=c.length;if(size>limit){req.destroy(new Error('archivo demasiado grande'));return;}chunks.push(c);});res.on('end',()=>finish({ok:true,status:res.statusCode||0,error:'',body:Buffer.concat(chunks)}));});req.on('timeout',()=>req.destroy(new Error('timeout')));req.on('error',e=>finish({ok:false,status:0,error:String(e.message||e),body:Buffer.alloc(0)}));});}
async function requestJson(host,targetPath){const r=await requestBuffer(host,targetPath,1024*1024);if(!r.ok)return{...r,data:null};try{return{...r,data:JSON.parse(r.body.toString('utf8'))};}catch(e){return{ok:false,status:r.status,error:'JSON inválido: '+e.message,body:r.body,data:null};}}
function encodeRel(rel){return String(rel||'').split('/').filter(Boolean).map(encodeURIComponent).join('/');}
function configFileWanted(name){const s=String(name||'').toLowerCase();return s.endsWith('.cfg')||s.endsWith('.conf');}
function normalizeDirectoryResult(data){const result=data?.result||data||{};return{files:Array.isArray(result.files)?result.files:[],dirs:Array.isArray(result.dirs)?result.dirs:[]};}
function fileName(item){return String(item?.filename||item?.name||'').replace(/^\/+|\/+$/g,'');}
function dirName(item){return String(item?.dirname||item?.name||'').replace(/^\/+|\/+$/g,'');}
function limitConfigPaths(paths,max=MAX_FILES){const unique=[...new Set((Array.isArray(paths)?paths:[]).filter(configFileWanted))].sort();return{files:unique.slice(0,max),truncated:unique.length>max,discovered:unique.length};}
async function listConfigFiles(ip){
  const out=[],queue=[''],seenDirs=new Set();let truncated=false,discovered=0;
  while(queue.length&&!truncated){const rel=queue.shift();if(seenDirs.has(rel))continue;seenDirs.add(rel);const full=rel?'config/'+rel:'config',r=await requestJson(ip,'/server/files/directory?path='+encodeURIComponent(full)+'&extended=true');if(!r.ok)throw new Error('No se pudo listar '+full+': '+r.error);const d=normalizeDirectoryResult(r.data);for(const f of d.files){const n=fileName(f);if(!n)continue;const p=rel?rel+'/'+n:n;if(!configFileWanted(p))continue;discovered++;if(out.length<MAX_FILES)out.push(p);else{truncated=true;break;}}if(truncated)break;for(const sub of d.dirs){const n=dirName(sub);if(!n||n==='.'||n==='..')continue;queue.push(rel?rel+'/'+n:n);}}
  return{files:[...new Set(out)].sort(),truncated,discovered};
}
async function hashConfigBundle(ip){const listing=await listConfigFiles(ip);if(listing.truncated)throw new Error(`escaneo incompleto: más de ${MAX_FILES} archivos .cfg/.conf; aumenta FARM_DRIFT_MAX_FILES`);const hashes={};for(const rel of listing.files){const r=await requestBuffer(ip,'/server/files/config/'+encodeRel(rel));if(!r.ok)throw new Error('No se pudo leer '+rel+': '+r.error);hashes[rel]=sha256(r.body);}const canonical=Object.keys(hashes).sort().map(k=>k+'\0'+hashes[k]).join('\n');return{files:hashes,fileCount:Object.keys(hashes).length,configHash:sha256(canonical),complete:true};}
function versionFromPrinterInfo(data){const r=data?.result||data||{};return String(r.software_version||r.klipper_version||'');}
function versionFromServerInfo(data){const r=data?.result||data||{};return String(r.moonraker_version||r.software_version||'');}
function machineName(m){return String(m?.nombre||m?.name||m?.hostname||m?.id||'');}
async function scanMachine(machine,now=Date.now()){
  const base={machineId:String(machine?.id||''),name:machineName(machine),ip:String(machine?.ip||''),scannedAt:now,status:'unreachable',klipperVersion:'',moonrakerVersion:'',configHash:'',fileCount:0,files:{},error:''};if(!base.machineId)return{...base,error:'machineId ausente'};if(!isPrivateIp(base.ip))return{...base,status:'invalid',error:'IP privada inválida/no configurada'};
  const [printer,server]=await Promise.all([requestJson(base.ip,'/printer/info'),requestJson(base.ip,'/server/info')]);if(!printer.ok||!server.ok)return{...base,error:printer.ok?server.error:printer.error};
  try{const bundle=await hashConfigBundle(base.ip);return{...base,status:'ok',klipperVersion:versionFromPrinterInfo(printer.data),moonrakerVersion:versionFromServerInfo(server.data),configHash:bundle.configHash,fileCount:bundle.fileCount,files:bundle.files,error:''};}
  catch(e){return{...base,status:'partial',klipperVersion:versionFromPrinterInfo(printer.data),moonrakerVersion:versionFromServerInfo(server.data),error:String(e.message||e)};}
}
function compareFiles(baseFiles,currentFiles){const b=baseFiles&&typeof baseFiles==='object'?baseFiles:{},c=currentFiles&&typeof currentFiles==='object'?currentFiles:{},added=[],removed=[],changed=[];for(const k of Object.keys(c)){if(!Object.prototype.hasOwnProperty.call(b,k))added.push(k);else if(b[k]!==c[k])changed.push(k);}for(const k of Object.keys(b))if(!Object.prototype.hasOwnProperty.call(c,k))removed.push(k);return{added:added.sort(),removed:removed.sort(),changed:changed.sort()};}
function compareSnapshot(current,baseline){if(!current)return{state:'unknown',reasons:['sin escaneo actual'],changes:{added:[],removed:[],changed:[]}};if(current.status!=='ok')return{state:'unknown',reasons:[current.error||current.status],changes:{added:[],removed:[],changed:[]}};if(!baseline)return{state:'unbaselined',reasons:['sin baseline aprobado'],changes:{added:[],removed:[],changed:[]}};const changes=compareFiles(baseline.files,current.files),reasons=[];if(current.configHash!==baseline.configHash)reasons.push('configuración cambió');if(String(current.klipperVersion||'')!==String(baseline.klipperVersion||''))reasons.push('versión Klipper cambió');if(String(current.moonrakerVersion||'')!==String(baseline.moonrakerVersion||''))reasons.push('versión Moonraker cambió');return{state:reasons.length?'drift':'clean',reasons,changes};}
function publicMachine(id){const current=store.current[id]||null,baseline=store.baselines[id]||null,cmp=compareSnapshot(current,baseline);return{machineId:id,name:current?.name||baseline?.name||id,ip:current?.ip||baseline?.ip||'',state:cmp.state,reasons:cmp.reasons,changes:cmp.changes,current:current?{scannedAt:current.scannedAt,status:current.status,klipperVersion:current.klipperVersion,moonrakerVersion:current.moonrakerVersion,configHash:current.configHash,fileCount:current.fileCount,error:current.error}:null,baseline:baseline?{approvedAt:baseline.approvedAt,klipperVersion:baseline.klipperVersion,moonrakerVersion:baseline.moonrakerVersion,configHash:baseline.configHash,fileCount:baseline.fileCount}:null};}
function snapshot(){const ids=new Set([...Object.keys(store.current),...Object.keys(store.baselines)]),machines=[...ids].map(publicMachine).sort((a,b)=>a.name.localeCompare(b.name)),counts={clean:0,drift:0,unbaselined:0,unknown:0};machines.forEach(m=>{counts[m.state]=(counts[m.state]||0)+1;});return{updatedAt:store.updatedAt,storageError:storeLoadError,summary:{...counts,total:machines.length},machines};}
function registryMachines(){const d=readJsonDetailed(REGISTRY_FILE);if(d.exists&&!d.ok)throw new Error('registry.json inválido: '+d.error);return Array.isArray(d.value?.machines)?d.value.machines.filter(m=>m&&m.id):[];}
async function mapLimit(items,limit,fn){const out=new Array(items.length);let next=0;async function worker(){while(true){const i=next++;if(i>=items.length)return;out[i]=await fn(items[i],i);}}await Promise.all(Array.from({length:Math.min(limit,Math.max(1,items.length))},worker));return out;}
let scanPromise=null;
async function scanAll(machineId=''){
  if(storeLoadError)throw new Error('drift.json inválido; no se sobrescribirá: '+storeLoadError);
  if(scanPromise&&!machineId)return scanPromise;
  const work=(async()=>{const machines=registryMachines().filter(m=>!machineId||String(m.id)===String(machineId));if(machineId&&!machines.length)throw new Error('máquina no encontrada en registry');const results=await mapLimit(machines,3,m=>scanMachine(m));await transact(draft=>{for(const s of results)draft.current[s.machineId]=s;});return snapshot();})();
  if(machineId)return work;scanPromise=work.finally(()=>{scanPromise=null;});return scanPromise;
}
async function approveBaseline(machineId,role='admin'){
  const id=String(machineId||'');if(!id)throw new Error('machineId requerido');if(storeLoadError)throw new Error('drift.json inválido; no se sobrescribirá: '+storeLoadError);
  let current=store.current[id];if(!current||current.status!=='ok'){await scanAll(id);current=store.current[id];}if(!current||current.status!=='ok')throw new Error('no hay un escaneo completo y válido para aprobar');
  await transact(draft=>{const c=draft.current[id];if(!c||c.status!=='ok')throw new Error('el escaneo válido cambió antes de aprobar');draft.baselines[id]={machineId:id,name:c.name,ip:c.ip,approvedAt:Date.now(),approvedBy:role,klipperVersion:c.klipperVersion,moonrakerVersion:c.moonrakerVersion,configHash:c.configHash,fileCount:c.fileCount,files:{...c.files}};});return publicMachine(id);
}
async function clearBaseline(machineId){const id=String(machineId||'');if(!id)return false;if(storeLoadError)throw new Error('drift.json inválido; no se sobrescribirá: '+storeLoadError);if(!store.baselines[id])return false;await transact(draft=>{delete draft.baselines[id];});return true;}

async function handle(req,res){
  cors(req,res);if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}const u=new URL(req.url,'http://farm.local'),p=u.pathname;
  if(p==='/farm/drift'&&req.method==='GET'){const role=requireRole(req,res,'viewer');if(!role)return;if(storeLoadError)return json(res,507,{ok:false,error:'drift.json inválido; se requiere reparación manual: '+storeLoadError});if(!store.updatedAt)await scanAll().catch(()=>{});return json(res,200,{ok:true,drift:snapshot()});}
  if(p==='/farm/drift/probe'&&req.method==='POST'){const role=requireRole(req,res,'operator');if(!role)return;try{const body=JSON.parse((await readBody(req)).toString('utf8')||'{}'),drift=await scanAll(body.machineId||'');return json(res,200,{ok:true,drift});}catch(e){return json(res,storageStatus(e),{ok:false,error:e.message});}}
  if(p==='/farm/drift/baseline'&&req.method==='POST'){const role=requireRole(req,res,'admin');if(!role)return;try{const body=JSON.parse((await readBody(req)).toString('utf8')||'{}'),machine=await approveBaseline(body.machineId,String(req.headers['x-farm-session-sub']||role));return json(res,200,{ok:true,machine,drift:snapshot()});}catch(e){return json(res,storageStatus(e),{ok:false,error:e.message});}}
  const m=p.match(/^\/farm\/drift\/baseline\/([^/]+)$/);if(m&&req.method==='DELETE'){const role=requireRole(req,res,'admin');if(!role)return;try{const ok=await clearBaseline(decodeURIComponent(m[1]));return json(res,ok?200:404,{ok,drift:snapshot()});}catch(e){return json(res,storageStatus(e),{ok:false,error:e.message});}}
  res.setHeader('Allow','GET,POST,DELETE,OPTIONS');return json(res,405,{ok:false,error:'method not allowed'});
}
function installPreload(){if(http.__TLS_FARM_DRIFT_PRELOAD__)return false;http.__TLS_FARM_DRIFT_PRELOAD__=true;const original=http.createServer;http.createServer=function patched(options,listener){const hasOptions=typeof options!=='function',fn=hasOptions?listener:options;if(typeof fn!=='function')return original.apply(this,arguments);const wrapped=function(req,res){let p='';try{p=new URL(req.url,'http://farm.local').pathname;}catch(_){}if(p==='/farm/drift'||p.startsWith('/farm/drift/')){handle(req,res).catch(e=>{if(!res.headersSent)json(res,500,{ok:false,error:e.message});else try{res.end();}catch(_){}});return;}return fn(req,res);};return hasOptions?original.call(this,options,wrapped):original.call(this,wrapped);};setTimeout(()=>scanAll().catch(e=>console.warn('[drift] startup scan',e.message)),10_000).unref();const t=setInterval(()=>scanAll().catch(e=>console.warn('[drift] scan',e.message)),INTERVAL_MS);t.unref();return true;}
if(process.env.FARM_DRIFT_PRELOAD_DISABLE!=='1')installPreload();
module.exports={sha256,isPrivateIp,configFileWanted,normalizeDirectoryResult,limitConfigPaths,compareFiles,compareSnapshot,normalizeStore,roleForToken,scanMachine,approveBaseline,snapshot,installPreload,_test:{MAX_FILES,MAX_FILE_BYTES,INTERVAL_MS,encodeRel,versionFromPrinterInfo,versionFromServerInfo,readJsonDetailed,storageStatus}};
