#!/usr/bin/env node
'use strict';

/**
 * The Lab Solutions — baseline/config drift de impresoras.
 *
 * Vigila hashes SHA-256 de archivos .cfg/.conf y versiones de Klipper/Moonraker.
 * No persiste el contenido de los archivos de configuración, sólo hashes y
 * metadatos. Se instala como preload antes de farm-controller.js.
 */
const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

const ROOT=__dirname;
const DATA_DIR=process.env.FARM_DATA_DIR||path.join(ROOT,'data');
const DRIFT_FILE=process.env.FARM_DRIFT_FILE||path.join(DATA_DIR,'drift.json');
const REGISTRY_FILE=process.env.FARM_REGISTRY_FILE||path.join(DATA_DIR,'registry.json');
const ORIGIN=process.env.BRIDGE_ALLOW_ORIGIN||'https://dashboard.thelab.solutions';
const INTERVAL_MS=Math.max(60_000,Math.min(6*3600_000,Number(process.env.FARM_DRIFT_INTERVAL_MS||10*60_000)));
const TIMEOUT_MS=Math.max(1000,Math.min(15_000,Number(process.env.FARM_DRIFT_TIMEOUT_MS||4000)));
const MAX_FILES=Math.max(8,Math.min(512,Number(process.env.FARM_DRIFT_MAX_FILES||128)));
const MAX_FILE_BYTES=Math.max(64*1024,Math.min(8*1024*1024,Number(process.env.FARM_DRIFT_MAX_FILE_BYTES||2*1024*1024)));
const MAX_BODY=128*1024;

fs.mkdirSync(DATA_DIR,{recursive:true,mode:0o700});

function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function safeEq(a,b){const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);}
function sha256(v){return crypto.createHash('sha256').update(v).digest('hex');}
function isPrivateIp(ip){
  const m=String(ip||'').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);if(!m)return false;
  const o=m.slice(1).map(Number);if(o.some(x=>x<0||x>255))return false;
  return o[0]===10||o[0]===127||(o[0]===172&&o[1]>=16&&o[1]<=31)||(o[0]===192&&o[1]===168);
}
function atomicWrite(file,value){const tmp=file+'.tmp-'+process.pid+'-'+Date.now();fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,file);}
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){return fallback;}}
function normalizeStore(raw){
  const v=raw&&typeof raw==='object'?raw:{};
  return{version:1,updatedAt:Math.max(0,finite(v.updatedAt)),baselines:v.baselines&&typeof v.baselines==='object'?v.baselines:{},current:v.current&&typeof v.current==='object'?v.current:{}};
}
let store=normalizeStore(readJson(DRIFT_FILE,{}));
let persistChain=Promise.resolve();
function persist(){store.updatedAt=Date.now();persistChain=persistChain.then(()=>atomicWrite(DRIFT_FILE,store)).catch(e=>console.error('[drift] persist',e));return persistChain;}

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
function cors(req,res){const origin=String(req.headers.origin||'');if(!origin||ORIGIN==='*'||origin===ORIGIN){res.setHeader('Access-Control-Allow-Origin',origin||ORIGIN);res.setHeader('Vary','Origin');}res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Bridge-Token,Authorization');res.setHeader('Cache-Control','no-store');}
function json(res,status,body){if(!res.headersSent)res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));}
function requireRole(req,res,min){const role=roleForToken(tokenFromReq(req));if(!role||ROLE_RANK[role]<ROLE_RANK[min]){json(res,403,{ok:false,error:'forbidden',requiredRole:min});return'';}return role;}
function readBody(req){return new Promise((resolve,reject)=>{const chunks=[];let size=0;req.on('data',c=>{size+=c.length;if(size>MAX_BODY){reject(new Error('payload demasiado grande'));req.destroy();}else chunks.push(c);});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject);});}

function requestBuffer(host,targetPath,limit=MAX_FILE_BYTES){
  return new Promise(resolve=>{
    const chunks=[];let size=0,done=false;
    const finish=v=>{if(done)return;done=true;resolve(v);};
    const req=http.get({host,port:7125,path:targetPath,timeout:TIMEOUT_MS},res=>{
      if((res.statusCode||0)<200||(res.statusCode||0)>=300){res.resume();return finish({ok:false,status:res.statusCode||0,error:'HTTP '+(res.statusCode||0),body:Buffer.alloc(0)});}
      res.on('data',c=>{size+=c.length;if(size>limit){req.destroy(new Error('archivo demasiado grande'));return;}chunks.push(c);});
      res.on('end',()=>finish({ok:true,status:res.statusCode||0,error:'',body:Buffer.concat(chunks)}));
    });
    req.on('timeout',()=>req.destroy(new Error('timeout')));
    req.on('error',e=>finish({ok:false,status:0,error:String(e.message||e),body:Buffer.alloc(0)}));
  });
}
async function requestJson(host,targetPath){
  const r=await requestBuffer(host,targetPath,1024*1024);if(!r.ok)return{...r,data:null};
  try{return{...r,data:JSON.parse(r.body.toString('utf8'))};}catch(e){return{ok:false,status:r.status,error:'JSON inválido: '+e.message,body:r.body,data:null};}
}
function encodeRel(rel){return String(rel||'').split('/').filter(Boolean).map(encodeURIComponent).join('/');}
function configFileWanted(name){const s=String(name||'').toLowerCase();return s.endsWith('.cfg')||s.endsWith('.conf');}
function normalizeDirectoryResult(data){
  const result=data?.result||data||{};
  return{files:Array.isArray(result.files)?result.files:[],dirs:Array.isArray(result.dirs)?result.dirs:[]};
}
function fileName(item){return String(item?.filename||item?.name||'').replace(/^\/+|\/+$/g,'');}
function dirName(item){return String(item?.dirname||item?.name||'').replace(/^\/+|\/+$/g,'');}
async function listConfigFiles(ip){
  const out=[];const queue=[''];const seen=new Set();
  while(queue.length&&out.length<MAX_FILES){
    const rel=queue.shift();if(seen.has(rel))continue;seen.add(rel);
    const full=rel?'config/'+rel:'config';
    const r=await requestJson(ip,'/server/files/directory?path='+encodeURIComponent(full)+'&extended=true');
    if(!r.ok)throw new Error('No se pudo listar '+full+': '+r.error);
    const d=normalizeDirectoryResult(r.data);
    for(const f of d.files){const n=fileName(f);if(!n)continue;const p=rel?rel+'/'+n:n;if(configFileWanted(p))out.push(p);if(out.length>=MAX_FILES)break;}
    for(const sub of d.dirs){const n=dirName(sub);if(!n||n==='.'||n==='..')continue;queue.push(rel?rel+'/'+n:n);}
  }
  return[...new Set(out)].sort();
}
async function hashConfigBundle(ip){
  const files=await listConfigFiles(ip);const hashes={};
  for(const rel of files){
    const r=await requestBuffer(ip,'/server/files/config/'+encodeRel(rel));
    if(!r.ok)throw new Error('No se pudo leer '+rel+': '+r.error);
    hashes[rel]=sha256(r.body);
  }
  const canonical=Object.keys(hashes).sort().map(k=>k+'\0'+hashes[k]).join('\n');
  return{files:hashes,fileCount:Object.keys(hashes).length,configHash:sha256(canonical)};
}
function versionFromPrinterInfo(data){const r=data?.result||data||{};return String(r.software_version||r.klipper_version||'');}
function versionFromServerInfo(data){const r=data?.result||data||{};return String(r.moonraker_version||r.software_version||'');}
function machineName(m){return String(m?.nombre||m?.name||m?.hostname||m?.id||'');}
async function scanMachine(machine,now=Date.now()){
  const base={machineId:String(machine?.id||''),name:machineName(machine),ip:String(machine?.ip||''),scannedAt:now,status:'unreachable',klipperVersion:'',moonrakerVersion:'',configHash:'',fileCount:0,files:{},error:''};
  if(!base.machineId)return{...base,error:'machineId ausente'};
  if(!isPrivateIp(base.ip))return{...base,status:'invalid',error:'IP privada inválida/no configurada'};
  const [printer,server]=await Promise.all([requestJson(base.ip,'/printer/info'),requestJson(base.ip,'/server/info')]);
  if(!printer.ok||!server.ok)return{...base,error:printer.ok?server.error:printer.error};
  try{
    const bundle=await hashConfigBundle(base.ip);
    return{...base,status:'ok',klipperVersion:versionFromPrinterInfo(printer.data),moonrakerVersion:versionFromServerInfo(server.data),configHash:bundle.configHash,fileCount:bundle.fileCount,files:bundle.files,error:''};
  }catch(e){
    return{...base,status:'partial',klipperVersion:versionFromPrinterInfo(printer.data),moonrakerVersion:versionFromServerInfo(server.data),error:String(e.message||e)};
  }
}
function compareFiles(baseFiles,currentFiles){
  const b=baseFiles&&typeof baseFiles==='object'?baseFiles:{},c=currentFiles&&typeof currentFiles==='object'?currentFiles:{};
  const added=[],removed=[],changed=[];
  for(const k of Object.keys(c)){if(!Object.prototype.hasOwnProperty.call(b,k))added.push(k);else if(b[k]!==c[k])changed.push(k);}
  for(const k of Object.keys(b))if(!Object.prototype.hasOwnProperty.call(c,k))removed.push(k);
  return{added:added.sort(),removed:removed.sort(),changed:changed.sort()};
}
function compareSnapshot(current,baseline){
  if(!current)return{state:'unknown',reasons:['sin escaneo actual'],changes:{added:[],removed:[],changed:[]}};
  if(current.status!=='ok')return{state:'unknown',reasons:[current.error||current.status],changes:{added:[],removed:[],changed:[]}};
  if(!baseline)return{state:'unbaselined',reasons:['sin baseline aprobado'],changes:{added:[],removed:[],changed:[]}};
  const changes=compareFiles(baseline.files,current.files),reasons=[];
  if(current.configHash!==baseline.configHash)reasons.push('configuración cambió');
  if(String(current.klipperVersion||'')!==String(baseline.klipperVersion||''))reasons.push('versión Klipper cambió');
  if(String(current.moonrakerVersion||'')!==String(baseline.moonrakerVersion||''))reasons.push('versión Moonraker cambió');
  return{state:reasons.length?'drift':'clean',reasons,changes};
}
function publicMachine(id){
  const current=store.current[id]||null,baseline=store.baselines[id]||null,cmp=compareSnapshot(current,baseline);
  return{machineId:id,name:current?.name||baseline?.name||id,ip:current?.ip||baseline?.ip||'',state:cmp.state,reasons:cmp.reasons,changes:cmp.changes,current:current?{scannedAt:current.scannedAt,status:current.status,klipperVersion:current.klipperVersion,moonrakerVersion:current.moonrakerVersion,configHash:current.configHash,fileCount:current.fileCount,error:current.error}:null,baseline:baseline?{approvedAt:baseline.approvedAt,klipperVersion:baseline.klipperVersion,moonrakerVersion:baseline.moonrakerVersion,configHash:baseline.configHash,fileCount:baseline.fileCount}:null};
}
function snapshot(){
  const ids=new Set([...Object.keys(store.current),...Object.keys(store.baselines)]),machines=[...ids].map(publicMachine).sort((a,b)=>a.name.localeCompare(b.name));
  const counts={clean:0,drift:0,unbaselined:0,unknown:0};machines.forEach(m=>{counts[m.state]=(counts[m.state]||0)+1;});
  return{updatedAt:store.updatedAt,summary:{...counts,total:machines.length},machines};
}
function registryMachines(){const r=readJson(REGISTRY_FILE,{machines:[]});return Array.isArray(r?.machines)?r.machines.filter(m=>m&&m.id):[];}
async function mapLimit(items,limit,fn){const out=new Array(items.length);let next=0;async function worker(){while(true){const i=next++;if(i>=items.length)return;out[i]=await fn(items[i],i);}}await Promise.all(Array.from({length:Math.min(limit,Math.max(1,items.length))},worker));return out;}
let scanPromise=null;
async function scanAll(machineId=''){
  if(scanPromise&&!machineId)return scanPromise;
  const work=(async()=>{
    const machines=registryMachines().filter(m=>!machineId||String(m.id)===String(machineId));
    if(machineId&&!machines.length)throw new Error('máquina no encontrada en registry');
    const results=await mapLimit(machines,3,m=>scanMachine(m));
    results.forEach(s=>{store.current[s.machineId]=s;});await persist();return snapshot();
  })();
  if(machineId)return work;
  scanPromise=work.finally(()=>{scanPromise=null;});return scanPromise;
}
async function approveBaseline(machineId,role='admin'){
  const id=String(machineId||'');if(!id)throw new Error('machineId requerido');
  let current=store.current[id];if(!current||current.status!=='ok'){await scanAll(id);current=store.current[id];}
  if(!current||current.status!=='ok')throw new Error('no hay un escaneo válido para aprobar');
  store.baselines[id]={machineId:id,name:current.name,ip:current.ip,approvedAt:Date.now(),approvedBy:role,klipperVersion:current.klipperVersion,moonrakerVersion:current.moonrakerVersion,configHash:current.configHash,fileCount:current.fileCount,files:{...current.files}};
  await persist();return publicMachine(id);
}
async function clearBaseline(machineId){const id=String(machineId||'');if(!id||!store.baselines[id])return false;delete store.baselines[id];await persist();return true;}

async function handle(req,res){
  cors(req,res);if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  const u=new URL(req.url,'http://farm.local'),p=u.pathname;
  if(p==='/farm/drift'&&req.method==='GET'){
    const role=requireRole(req,res,'viewer');if(!role)return;if(!store.updatedAt)await scanAll().catch(()=>{});return json(res,200,{ok:true,drift:snapshot()});
  }
  if(p==='/farm/drift/probe'&&req.method==='POST'){
    const role=requireRole(req,res,'operator');if(!role)return;
    try{const body=JSON.parse((await readBody(req)).toString('utf8')||'{}');const drift=await scanAll(body.machineId||'');return json(res,200,{ok:true,drift});}catch(e){return json(res,400,{ok:false,error:e.message});}
  }
  if(p==='/farm/drift/baseline'&&req.method==='POST'){
    const role=requireRole(req,res,'admin');if(!role)return;
    try{const body=JSON.parse((await readBody(req)).toString('utf8')||'{}');const machine=await approveBaseline(body.machineId,role);return json(res,200,{ok:true,machine,drift:snapshot()});}catch(e){return json(res,400,{ok:false,error:e.message});}
  }
  const m=p.match(/^\/farm\/drift\/baseline\/([^/]+)$/);
  if(m&&req.method==='DELETE'){
    const role=requireRole(req,res,'admin');if(!role)return;const ok=await clearBaseline(decodeURIComponent(m[1]));return json(res,ok?200:404,{ok,drift:snapshot()});
  }
  res.setHeader('Allow','GET,POST,DELETE,OPTIONS');return json(res,405,{ok:false,error:'method not allowed'});
}
function installPreload(){
  if(http.__TLS_FARM_DRIFT_PRELOAD__)return false;http.__TLS_FARM_DRIFT_PRELOAD__=true;
  const original=http.createServer;
  http.createServer=function patched(options,listener){
    const hasOptions=typeof options!=='function',fn=hasOptions?listener:options;if(typeof fn!=='function')return original.apply(this,arguments);
    const wrapped=function(req,res){let p='';try{p=new URL(req.url,'http://farm.local').pathname;}catch(_){}if(p==='/farm/drift'||p.startsWith('/farm/drift/')){handle(req,res).catch(e=>{if(!res.headersSent)json(res,500,{ok:false,error:e.message});else try{res.end();}catch(_){}});return;}return fn(req,res);};
    return hasOptions?original.call(this,options,wrapped):original.call(this,wrapped);
  };
  setTimeout(()=>scanAll().catch(e=>console.warn('[drift] startup scan',e.message)),10_000).unref();
  const t=setInterval(()=>scanAll().catch(e=>console.warn('[drift] scan',e.message)),INTERVAL_MS);t.unref();return true;
}
if(process.env.FARM_DRIFT_PRELOAD_DISABLE!=='1')installPreload();
module.exports={sha256,isPrivateIp,configFileWanted,normalizeDirectoryResult,compareFiles,compareSnapshot,normalizeStore,roleForToken,scanMachine,approveBaseline,snapshot,installPreload,_test:{MAX_FILES,MAX_FILE_BYTES,INTERVAL_MS,encodeRel,versionFromPrinterInfo,versionFromServerInfo}};
