#!/usr/bin/env node
'use strict';

/**
 * POST /farm/queue/import
 * Importa un G-code que YA existe en Moonraker directamente por LAN y luego lo
 * entrega a /farm/queue. El navegador sólo manda metadatos pequeños.
 *
 * - operator mínimo
 * - machineId resuelve IP desde registry canónico
 * - `id` obligatorio e idempotente
 * - reserva IDs concurrentes para no duplicar un trabajo por doble clic/retry
 */
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const DATA_DIR=process.env.FARM_DATA_DIR||path.join(__dirname,'data');
const REGISTRY_FILE=process.env.FARM_REGISTRY_FILE||path.join(DATA_DIR,'registry.json');
const QUEUE_FILE=process.env.FARM_QUEUE_FILE||path.join(DATA_DIR,'queue.json');
const PORT=Number(process.env.BRIDGE_PORT||8347);
const MAX_GCODE=Math.max(1024*1024,Number(process.env.FARM_IMPORT_MAX_GCODE_BYTES||32*1024*1024));
const ROLE_RANK={viewer:1,operator:2,admin:3},reservations=new Set();

function safeEq(a,b){const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);}
function roleForToken(token){const admin=String(process.env.BRIDGE_ADMIN_TOKEN||process.env.BRIDGE_TOKEN||'').trim()||(()=>{try{return fs.readFileSync(path.join(__dirname,'.bridge-token'),'utf8').trim();}catch(_){return'';}})();const op=String(process.env.BRIDGE_OPERATOR_TOKEN||'').trim(),view=String(process.env.BRIDGE_VIEWER_TOKEN||'').trim();if(admin&&safeEq(token,admin))return'admin';if(op&&safeEq(token,op))return'operator';if(view&&safeEq(token,view))return'viewer';return'';}
function reqToken(req){return String(req.headers['x-bridge-token']||'');}
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'))||fallback;}catch(_){return fallback;}}
function publicJob(j){if(!j)return null;const{gcodeBase64,...rest}=j;return{...rest,hasPayload:!!gcodeBase64};}
function existingJob(id){return(readJson(QUEUE_FILE,{jobs:[]}).jobs||[]).find(j=>j?.id===id)||null;}
function registryMachine(id){return(readJson(REGISTRY_FILE,{machines:[]}).machines||[]).find(m=>m?.id===id)||null;}
function isPrivateIp(ip){const m=String(ip||'').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);if(!m)return false;const o=m.slice(1).map(Number);return!o.some(x=>x<0||x>255)&&(o[0]===10||o[0]===127||(o[0]===172&&o[1]>=16&&o[1]<=31)||(o[0]===192&&o[1]===168));}
function cleanSource(value){const parts=String(value||'').replace(/\\/g,'/').replace(/^\/+/, '').split('/').filter(Boolean);if(!parts.length||parts.some(p=>p==='.'||p==='..'))throw new Error('ruta G-code inválida');return parts.join('/');}
function encodedPath(value){return cleanSource(value).split('/').map(encodeURIComponent).join('/');}
function safeRemoteName(id,source){const base=path.posix.basename(cleanSource(source)).replace(/[^a-zA-Z0-9._-]+/g,'_').slice(-120)||'job.gcode';const prefix=String(id).replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,60);return`${prefix}--${base}`.slice(0,190);}
function readBody(req,limit=128*1024){return new Promise((resolve,reject)=>{const chunks=[];let n=0;req.on('data',c=>{n+=c.length;if(n>limit){reject(new Error('payload demasiado grande'));req.destroy();}else chunks.push(c);});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject);});}
function json(res,status,body){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body));}
async function fetchGcode(ip,source){const r=await fetch(`http://${ip}:7125/server/files/gcodes/${encodedPath(source)}`,{cache:'no-store',signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`Moonraker ${r.status}`);const len=Number(r.headers.get('content-length')||0);if(len>MAX_GCODE)throw new Error('G-code supera límite de importación');const ab=await r.arrayBuffer();if(!ab.byteLength)throw new Error('G-code vacío');if(ab.byteLength>MAX_GCODE)throw new Error('G-code supera límite de importación');return Buffer.from(ab);}
async function localEnqueue(token,payload){const body=Buffer.from(JSON.stringify(payload));const r=await fetch(`http://127.0.0.1:${PORT}/farm/queue`,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':String(body.length),'X-Bridge-Token':token},body,signal:AbortSignal.timeout(45000)});const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(d.error||`queue HTTP ${r.status}`),{status:r.status});return d;}

async function handle(req,res){
  const role=roleForToken(reqToken(req));if(!role||ROLE_RANK[role]<ROLE_RANK.operator)return json(res,403,{ok:false,error:'forbidden',requiredRole:'operator'});
  let body;try{body=JSON.parse((await readBody(req)).toString('utf8')||'{}');}catch(e){return json(res,400,{ok:false,error:e.message});}
  const id=String(body.id||'').trim(),machineId=String(body.machineId||'').trim(),source=String(body.sourceFile||'').trim();if(!id||!machineId||!source)return json(res,400,{ok:false,error:'id, machineId y sourceFile son requeridos'});
  const prior=existingJob(id);if(prior)return json(res,200,{ok:true,idempotent:true,job:publicJob(prior)});
  if(reservations.has(id))return json(res,409,{ok:false,error:'trabajo ya se está importando'});
  reservations.add(id);
  try{
    const m=registryMachine(machineId),ip=String(m?.ip||'');if(!isPrivateIp(ip))throw new Error('máquina sin IP privada canónica');
    const gcode=await fetchGcode(ip,source),remoteFilename=String(body.remoteFilename||safeRemoteName(id,source));
    const payload={id,machineId,ip,filename:remoteFilename,secs:Number(body.secs||0),grams:Number(body.grams||0),priority:Number(body.priority||50),source:String(body.source||'machineops'),gcodeBase64:gcode.toString('base64')};
    const d=await localEnqueue(reqToken(req),payload);return json(res,d.idempotent?200:201,{...d,importedFrom:source,bytes:gcode.length});
  }catch(e){return json(res,Number(e.status)||400,{ok:false,error:e.message});}
  finally{reservations.delete(id);}
}

const original=http.createServer;
http.createServer=function(options,listener){const hasOptions=typeof options!=='function',fn=hasOptions?listener:options;if(typeof fn!=='function')return original.apply(this,arguments);const wrapped=function(req,res){let p='';try{p=new URL(req.url,'http://farm.local').pathname;}catch(_){}if(p==='/farm/queue/import'&&req.method==='POST'){handle(req,res).catch(e=>json(res,500,{ok:false,error:e.message}));return;}return fn(req,res);};return hasOptions?original.call(this,options,wrapped):original.call(this,wrapped);};
module.exports={cleanSource,encodedPath,safeRemoteName,existingJob,fetchGcode,roleForToken,MAX_GCODE};
