#!/usr/bin/env node
'use strict';

/** Reconciliación terminal de FarmQueue desde lifecycle + production. */
const http=require('http'),fs=require('fs'),path=require('path');
const DATA_DIR=process.env.FARM_DATA_DIR||path.join(__dirname,'data');
const QUEUE_FILE=process.env.FARM_QUEUE_FILE||path.join(DATA_DIR,'queue.json');
const LIFECYCLE_FILE=process.env.FARM_LIFECYCLE_FILE||path.join(DATA_DIR,'lifecycle.json');
const PRODUCTION_FILE=process.env.FARM_PRODUCTION_FILE||path.join(DATA_DIR,'production.json');
const RETENTION_MS=Math.max(86400000,Number(process.env.FARM_QUEUE_TERMINAL_RETENTION_MS||30*86400000));
const originalWriteFileSync=fs.writeFileSync.bind(fs),originalRenameSync=fs.renameSync.bind(fs);
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'))||fallback;}catch(_){return fallback;}}
function terminalState(result){const r=String(result||'').toLowerCase();if(r==='completado')return'completed';if(r==='cancelado')return'cancelled';return'failed';}
function markerMap(saved=null){
  const lifecycle=saved||readJson(LIFECYCLE_FILE,{jobs:{}}),out={...((lifecycle?.jobs&&typeof lifecycle.jobs==='object')?lifecycle.jobs:{})},production=readJson(PRODUCTION_FILE,{history:[]});
  for(const e of Array.isArray(production?.history)?production.history:[]){const id=String(e?.queueJobId||'');if(!id||!e?.result)continue;const at=Number(e.end||e.ts||0);if(!at)continue;const prev=out[id];if(!prev?.recordedAt||Number(prev.recordedAt)<at)out[id]={...(prev||{}),recordedAt:at,result:e.result,eventId:e.eventId||prev?.eventId||'',source:'production'};}
  return out;
}
function applyMarkers(queue,saved=null,now=Date.now()){
  const q=queue&&typeof queue==='object'?{...queue}:{version:1,jobs:[]},markers=markerMap(saved),rows=Array.isArray(q.jobs)?q.jobs:[],cutoff=now-RETENTION_MS;
  q.jobs=rows.map(raw=>{const j=raw&&typeof raw==='object'?{...raw}:raw;if(!j?.id)return j;const m=markers[j.id];if(!m?.recordedAt)return j;const state=terminalState(m.result);return{...j,state,result:m.result||j.result||'',endedAt:j.endedAt||new Date(Number(m.recordedAt)).toISOString(),gcodeBase64:'',lastError:state==='failed'?(j.lastError||m.lastError||'impresión fallida'):j.lastError||''};}).filter(j=>{if(!j?.id)return true;const m=markers[j.id];return!(m?.recordedAt&&Number(m.recordedAt)<cutoff);});
  return q;
}
function durableWrite(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.repair-'+process.pid+'-'+Date.now();originalWriteFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});const fd=fs.openSync(tmp,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}originalRenameSync(tmp,file);try{const dfd=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}}catch(_){} }
function repairQueueDisk(){try{const raw=JSON.parse(fs.readFileSync(QUEUE_FILE,'utf8')),next=applyMarkers(raw);if(JSON.stringify(next)!==JSON.stringify(raw))durableWrite(QUEUE_FILE,next);return{ok:true,jobs:next.jobs?.length||0};}catch(e){if(e?.code==='ENOENT')return{ok:true,missing:true};return{ok:false,error:e?.message||String(e)};}}
function isQueueTemp(file){return String(file||'').startsWith(QUEUE_FILE+'.tmp-');}
function rewriteQueuePayload(file,data){if(!isQueueTemp(file))return data;try{const text=Buffer.isBuffer(data)?data.toString('utf8'):String(data),doc=JSON.parse(text),next=JSON.stringify(applyMarkers(doc),null,2)+'\n';return Buffer.isBuffer(data)?Buffer.from(next):next;}catch(_){return data;}}
fs.writeFileSync=function(file,data,options){return originalWriteFileSync(file,rewriteQueuePayload(file,data),options);};
repairQueueDisk();
const originalCreateServer=http.createServer;
http.createServer=function(options,requestListener){const hasOptions=typeof options!=='function',listener=hasOptions?requestListener:options;if(typeof listener!=='function')return originalCreateServer.apply(this,arguments);const wrapped=function(req,res){let pathname='';try{pathname=new URL(req.url,'http://farm.local').pathname;}catch(_){}if(req.method==='GET'&&pathname==='/farm/queue'){const originalEnd=res.end.bind(res);res.end=function(chunk,encoding,cb){if(chunk&&Number(res.statusCode||200)<300){try{const text=Buffer.isBuffer(chunk)?chunk.toString('utf8'):String(chunk),doc=JSON.parse(text);if(Array.isArray(doc.jobs)){doc.jobs=applyMarkers({jobs:doc.jobs}).jobs;chunk=JSON.stringify(doc);}}catch(_){}}return originalEnd(chunk,encoding,cb);};}return listener(req,res);};return hasOptions?originalCreateServer.call(this,options,wrapped):originalCreateServer.call(this,wrapped);};
module.exports={terminalState,markerMap,applyMarkers,repairQueueDisk,rewriteQueuePayload,isQueueTemp,RETENTION_MS};
