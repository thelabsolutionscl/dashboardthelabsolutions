#!/usr/bin/env node
'use strict';

/**
 * Guardia de la cola durable.
 * - rechaza encolados si se supera cantidad/bytes o falta espacio de disco;
 * - no deja salir el 201 hasta verificar que el job apareció en queue.json.
 */
const http=require('http'),fs=require('fs'),path=require('path');
const DATA_DIR=process.env.FARM_DATA_DIR||path.join(__dirname,'data');
const QUEUE_FILE=process.env.FARM_QUEUE_FILE||path.join(DATA_DIR,'queue.json');
const MAX_PENDING=Math.max(10,Number(process.env.FARM_QUEUE_MAX_PENDING||100));
const MAX_PENDING_BYTES=Math.max(32*1024*1024,Number(process.env.FARM_QUEUE_MAX_BYTES||1024*1024*1024));
const MIN_FREE_BYTES=Math.max(64*1024*1024,Number(process.env.FARM_MIN_FREE_BYTES||2*1024*1024*1024));
const MIN_FREE_RATIO=Math.max(0.01,Math.min(.5,Number(process.env.FARM_MIN_FREE_RATIO||.15)));
const ACTIVE=new Set(['queued','retry','checking','uploading','uploaded']);

function readQueue(){try{return JSON.parse(fs.readFileSync(QUEUE_FILE,'utf8'))||{jobs:[]};}catch(e){return{jobs:[]};}}
function pendingStats(queue=readQueue()){
  const rows=(Array.isArray(queue.jobs)?queue.jobs:[]).filter(j=>ACTIVE.has(j.state));
  const bytes=rows.reduce((n,j)=>n+Math.ceil(String(j.gcodeBase64||'').length*3/4),0);
  return{count:rows.length,bytes};
}
function diskStatus(){
  try{const s=fs.statfsSync(DATA_DIR),free=Number(s.bavail)*Number(s.bsize),total=Number(s.blocks)*Number(s.bsize),ratio=total?free/total:1;return{ok:free>=MIN_FREE_BYTES&&ratio>=MIN_FREE_RATIO,free,total,ratio};}
  catch(_){return{ok:true,free:null,total:null,ratio:null};}
}
function guardDecision({contentLength=0,stats=pendingStats(),disk=diskStatus()}={}){
  if(stats.count>=MAX_PENDING)return{ok:false,status:429,error:`cola llena: ${stats.count}/${MAX_PENDING} pendientes`};
  if(stats.bytes+Math.max(0,contentLength)>MAX_PENDING_BYTES)return{ok:false,status:413,error:'payload pendiente supera la cuota de la cola'};
  if(!disk.ok)return{ok:false,status:507,error:'espacio libre insuficiente para garantizar persistencia'};
  return{ok:true};
}
function waitPersisted(id,timeout=1800){return new Promise(resolve=>{const end=Date.now()+timeout;(function poll(){const hit=readQueue().jobs?.some(j=>j.id===id);if(hit)return resolve(true);if(Date.now()>=end)return resolve(false);setTimeout(poll,40);})();});}
function sendJson(res,status,body){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body));}

const original=http.createServer;
http.createServer=function(listener){
  if(typeof listener!=='function')return original.apply(this,arguments);
  return original.call(this,function(req,res){
    const u=new URL(req.url,'http://farm.local');
    if(req.method!=='POST'||u.pathname!=='/farm/queue')return listener.call(this,req,res);
    const decision=guardDecision({contentLength:Number(req.headers['content-length']||0)});
    if(!decision.ok)return sendJson(res,decision.status,{ok:false,error:decision.error});
    const originalWriteHead=res.writeHead.bind(res),originalEnd=res.end.bind(res);let status=200,headers=null,chunks=[];
    res.writeHead=function(code,h){status=code;headers=h||null;return res;};
    res.end=function(chunk,encoding,cb){if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));const body=Buffer.concat(chunks).toString('utf8');if(status!==201){if(headers)for(const[k,v]of Object.entries(headers))if(v!==undefined)res.setHeader(k,v);res.statusCode=status;return originalEnd(body,cb);}let parsed=null;try{parsed=JSON.parse(body);}catch(_){}const id=parsed?.job?.id;if(!id){res.statusCode=500;return originalEnd(JSON.stringify({ok:false,error:'respuesta de cola sin job id'}),cb);}waitPersisted(id).then(ok=>{if(!ok){res.statusCode=507;res.setHeader('Content-Type','application/json; charset=utf-8');return originalEnd(JSON.stringify({ok:false,error:'no se pudo confirmar queue.json en disco'}),cb);}if(headers)for(const[k,v]of Object.entries(headers))if(v!==undefined)res.setHeader(k,v);originalWriteHead(201);originalEnd(body,cb);});return res;};
    return listener.call(this,req,res);
  });
};
module.exports={pendingStats,diskStatus,guardDecision,waitPersisted,MAX_PENDING,MAX_PENDING_BYTES,MIN_FREE_BYTES,MIN_FREE_RATIO};
