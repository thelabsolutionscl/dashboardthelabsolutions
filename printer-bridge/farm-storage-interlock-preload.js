#!/usr/bin/env node
'use strict';

/**
 * Interlock fail-closed del almacenamiento crítico de la granja.
 *
 * Objetivo: un trabajo nunca debe llegar a upload/start de Moonraker si el
 * estado durable que permite recuperarlo después de un corte no es confiable.
 * Se valida en cada intento, por lo que al reparar el storage la cola se
 * habilita sola en el siguiente ciclo; no queda un latch manual escondido.
 *
 * Además, si un archivo crítico ya existe pero está corrupto, se impide que un
 * atomic rename del controller lo pise con un fallback normalizado.
 */
const http=require('http');
const fs=require('fs');
const path=require('path');
const {EventEmitter}=require('events');

const DATA_DIR=process.env.FARM_DATA_DIR||path.join(__dirname,'data');
const QUEUE_FILE=process.env.FARM_QUEUE_FILE||path.join(DATA_DIR,'queue.json');
const REGISTRY_FILE=process.env.FARM_REGISTRY_FILE||path.join(DATA_DIR,'registry.json');
const SAFETY_FILE=process.env.FARM_SAFETY_FILE||path.join(DATA_DIR,'safety.json');
const LEGACY_PORT=Number(process.env.LEGACY_BRIDGE_PORT||8348);
const criticalByPath=new Map([
  [path.resolve(QUEUE_FILE),{label:'queue.json',validate:v=>!!v&&typeof v==='object'&&Array.isArray(v.jobs)}],
  [path.resolve(REGISTRY_FILE),{label:'registry.json',validate:v=>!!v&&typeof v==='object'&&Array.isArray(v.machines)}],
  [path.resolve(SAFETY_FILE),{label:'safety.json',validate:v=>!!v&&typeof v==='object'&&!Array.isArray(v)}],
]);

function checkJsonFile(file,label,validate,{allowMissing=false}={}){
  try{
    const raw=fs.readFileSync(file,'utf8');
    let doc;try{doc=JSON.parse(raw);}catch(_){return{ok:false,label,error:`${label} corrupto: JSON inválido`,corrupt:true};}
    if(!validate(doc))return{ok:false,label,error:`${label} corrupto: estructura inválida`,corrupt:true};
    return{ok:true,label};
  }catch(e){
    if(e?.code==='ENOENT'&&allowMissing)return{ok:true,label,missing:true};
    return{ok:false,label,error:e?.code==='ENOENT'?`${label} ausente`:`${label} no se puede leer`,missing:e?.code==='ENOENT'};
  }
}
function probeWritable(dataDir){
  const probe=path.join(dataDir,`.storage-probe-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  let fd=null,dirFd=null;
  try{
    fd=fs.openSync(probe,'wx',0o600);
    fs.writeSync(fd,Buffer.from('ok\n'));
    fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
    fs.unlinkSync(probe);
    // fsync del directorio hace que creación/borrado/rename tengan una prueba
    // real del mismo filesystem donde viven los stores.
    dirFd=fs.openSync(dataDir,'r');
    fs.fsyncSync(dirFd);fs.closeSync(dirFd);dirFd=null;
    return{ok:true};
  }catch(_){return{ok:false,error:'directorio persistente no escribible/sin fsync'};
  }finally{
    try{if(fd!==null)fs.closeSync(fd);}catch(_){}
    try{if(dirFd!==null)fs.closeSync(dirFd);}catch(_){}
    try{fs.unlinkSync(probe);}catch(_){}
  }
}
function storageStatus(opts={}){
  const dataDir=opts.dataDir||DATA_DIR;
  const queueFile=opts.queueFile||path.join(dataDir,'queue.json');
  const registryFile=opts.registryFile||path.join(dataDir,'registry.json');
  const safetyFile=opts.safetyFile||path.join(dataDir,'safety.json');
  const checks=[
    checkJsonFile(queueFile,'queue.json',v=>!!v&&typeof v==='object'&&Array.isArray(v.jobs)),
    checkJsonFile(registryFile,'registry.json',v=>!!v&&typeof v==='object'&&Array.isArray(v.machines)),
    checkJsonFile(safetyFile,'safety.json',v=>!!v&&typeof v==='object'&&!Array.isArray(v)),
    opts.skipProbe?{ok:true,label:'write-probe'}:{label:'write-probe',...probeWritable(dataDir)},
  ];
  const bad=checks.filter(c=>!c.ok);
  return{ok:bad.length===0,blocked:bad.length>0,reason:bad.map(c=>c.error).filter(Boolean).join('; '),checks,checkedAt:new Date().toISOString()};
}
function publicStatus(s){return{ok:!!s.ok,blocked:!s.ok,reason:s.reason||'',checkedAt:s.checkedAt};}
function isLegacyMutation(options={}){
  const host=String(options.hostname||options.host||'').replace(/^\[|\]$/g,'');
  const port=Number(options.port||80),method=String(options.method||'GET').toUpperCase(),p=String(options.path||'');
  if(!['127.0.0.1','localhost','::1'].includes(host)||port!==LEGACY_PORT||method!=='POST')return false;
  return /\/server\/files\/upload(?:\?|$)/.test(p)||/\/printer\/print\/start(?:\?|$)/.test(p);
}
function blockedRequest(status){
  const req=new EventEmitter();
  req.write=()=>true;req.setTimeout=()=>req;req.destroy=()=>{};req.abort=()=>{};
  req.end=()=>process.nextTick(()=>{const e=new Error('storage interlock: '+(status.reason||'storage no confiable'));e.code='FARM_STORAGE_BLOCKED';req.emit('error',e);});
  return req;
}

let installed=false,last=storageStatus({skipProbe:true});
function refresh(){last=storageStatus();return last;}
function install(){
  if(installed)return false;installed=true;

  // No permitir que un store corrupto existente sea reemplazado por el estado
  // fallback que el controller pudo haber cargado en memoria.
  const renameSync=fs.renameSync.bind(fs);
  fs.renameSync=function(src,dst){
    const meta=criticalByPath.get(path.resolve(String(dst)));
    if(meta&&fs.existsSync(dst)){
      const current=checkJsonFile(dst,meta.label,meta.validate);
      if(!current.ok&&current.corrupt){
        try{fs.unlinkSync(src);}catch(_){}
        const e=new Error(`${meta.label} inválido; no se sobrescribirá`);e.code='FARM_STORE_CORRUPT';throw e;
      }
    }
    return renameSync(src,dst);
  };

  // Esta es la barrera universal: cubre tanto /run manual como el queueWorker
  // automático, porque ambos terminan pasando por requestLegacy antes de
  // upload/start. La comprobación se repite en cada intento.
  const request=http.request.bind(http);
  http.request=function(options,callback){
    if(isLegacyMutation(options)){
      const s=refresh();
      if(!s.ok)return blockedRequest(s);
    }
    return request(options,callback);
  };

  // El endpoint manual falla antes de mutar estados si el mismo interlock está
  // degradado. GET /farm/queue conserva su auth normal y recibe un campo storage.
  const createServer=http.createServer.bind(http);
  http.createServer=function(listener){
    if(typeof listener!=='function')return createServer.apply(http,arguments);
    return createServer(function(req,res){
      const u=new URL(req.url,'http://farm.local');
      if(req.method==='POST'&&/^\/farm\/queue\/[^/]+\/run$/.test(u.pathname)){
        const s=refresh();
        if(!s.ok){res.statusCode=507;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');return res.end(JSON.stringify({ok:false,error:'storage interlock',storage:publicStatus(s)}));}
      }
      if(req.method==='GET'&&u.pathname==='/farm/queue'){
        const end=res.end.bind(res);
        res.end=function(chunk,encoding,cb){
          if(chunk&&(res.statusCode||200)<300){
            try{const body=JSON.parse(Buffer.isBuffer(chunk)?chunk.toString('utf8'):String(chunk));body.storage=publicStatus(refresh());chunk=JSON.stringify(body);}catch(_){}
          }
          return end(chunk,encoding,cb);
        };
      }
      if(u.pathname==='/healthz'){
        const s=refresh();res.setHeader('X-Farm-Storage-Ok',s.ok?'1':'0');
        if(!s.ok)res.setHeader('X-Farm-Storage-Blocked','1');
      }
      return listener.call(this,req,res);
    });
  };
  return true;
}

if(process.env.FARM_STORAGE_INTERLOCK_DISABLE!=='1')install();
module.exports={checkJsonFile,probeWritable,storageStatus,publicStatus,isLegacyMutation,install,refresh,get lastStatus(){return last;}};
