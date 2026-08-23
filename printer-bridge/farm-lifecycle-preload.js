#!/usr/bin/env node
'use strict';

/** Supervisor de lifecycle para trabajos arrancados por FarmQueue. */
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const DATA_DIR=process.env.FARM_DATA_DIR||path.join(__dirname,'data');
const QUEUE_FILE=process.env.FARM_QUEUE_FILE||path.join(DATA_DIR,'queue.json');
const REGISTRY_FILE=process.env.FARM_REGISTRY_FILE||path.join(DATA_DIR,'registry.json');
const STATE_FILE=process.env.FARM_LIFECYCLE_FILE||path.join(DATA_DIR,'lifecycle.json');
const PORT=Number(process.env.BRIDGE_PORT||8347),INTERVAL=Math.max(10000,Number(process.env.FARM_LIFECYCLE_MS||20000));
let running=false,lastRun=0,lastError='';
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'))||fallback;}catch(_){return fallback;}}
function atomicWrite(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.tmp-'+process.pid+'-'+Date.now();fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});const fd=fs.openSync(tmp,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);try{const dfd=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}}catch(_){} }
function masterToken(){const e=String(process.env.BRIDGE_ADMIN_TOKEN||process.env.BRIDGE_TOKEN||'').trim();if(e)return e;try{return fs.readFileSync(path.join(__dirname,'.bridge-token'),'utf8').trim();}catch(_){return'';}}
function basename(v){return String(v||'').split('/').pop().toLowerCase();}
function terminalDecision(job,live,previous={}){const state=String(live?.state||'').toLowerCase(),file=basename(live?.filename),expected=basename(job?.filename),matches=!file||!expected||file===expected,active=['printing','paused'].includes(state);if(active&&matches)return{terminal:false,seenActive:true};if(!matches)return{terminal:false,seenActive:!!previous.seenActive};if(state==='complete')return{terminal:true,result:'Completado',seenActive:true};if(state==='cancelled'||state==='canceled')return{terminal:true,result:'Cancelado',seenActive:true};if(['error','shutdown'].includes(state))return{terminal:true,result:'Fallido',seenActive:true};return{terminal:false,seenActive:!!previous.seenActive};}
async function moonraker(ip){const r=await fetch(`http://${ip}:7125/printer/objects/query?print_stats&webhooks`,{cache:'no-store',signal:AbortSignal.timeout(6000)});if(!r.ok)throw new Error('Moonraker '+r.status);const d=await r.json(),s=d?.result?.status||{},p=s.print_stats||{},w=s.webhooks||{};return{state:String(p.state||w.state||'').toLowerCase(),filename:p.filename||'',message:p.message||w.state_message||''};}
function machineOpsId(job){const explicit=String(job?.machineOpsJobId||'');if(explicit)return explicit;const id=String(job?.id||'');return id.startsWith('mops-')?id.slice(5):'';}
function eventFor(job,result,end=Date.now()){const start=Date.parse(job?.startedAt||0)||Math.max(0,end-Number(job?.secs||0)*1000),dur=Math.max(0,(end-start)/60000);return{eventId:'farm-'+crypto.createHash('sha256').update(String(job.id)).digest('hex').slice(0,32),machineId:job.machineId,id:job.machineId,nombre:job.machineName||'',file:job.filename||'',start,end,dur,result,filamentMm:0,ts:end,queueJobId:job.id,machineOpsJobId:machineOpsId(job),pedidoId:String(job?.pedidoId||'')};}
async function postProduction(event){const t=masterToken();if(!t)throw new Error('token admin local ausente');const r=await fetch(`http://127.0.0.1:${PORT}/farm/production/events`,{method:'POST',headers:{'Content-Type':'application/json','X-Bridge-Token':t},body:JSON.stringify(event),signal:AbortSignal.timeout(6000)});if(!r.ok)throw new Error('production HTTP '+r.status);return r.json().catch(()=>({}));}
async function scanOnce(){
  if(running)return;running=true;
  try{
    const queue=readJson(QUEUE_FILE,{jobs:[]}),registry=readJson(REGISTRY_FILE,{machines:[]}),saved=readJson(STATE_FILE,{version:1,jobs:{}});saved.jobs=saved.jobs||{};const byId=new Map((registry.machines||[]).map(m=>[m.id,m]));let dirty=false;
    for(const job of(queue.jobs||[]).filter(j=>j?.state==='started'&&j.id&&!saved.jobs[j.id]?.recordedAt)){
      const ip=byId.get(job.machineId)?.ip||job.ip;if(!ip)continue;const prev=saved.jobs[job.id]||{};
      try{const live=await moonraker(ip),decision=terminalDecision(job,live,prev);saved.jobs[job.id]={...prev,lastState:live.state,lastSeenAt:Date.now(),seenActive:decision.seenActive};dirty=true;if(decision.terminal){const event=eventFor(job,decision.result);await postProduction(event);saved.jobs[job.id]={...saved.jobs[job.id],recordedAt:Date.now(),result:decision.result,eventId:event.eventId};}}
      catch(e){saved.jobs[job.id]={...prev,lastError:e?.message||String(e),lastSeenAt:Date.now()};dirty=true;}
    }
    const cutoff=Date.now()-365*86400000;for(const[id,row]of Object.entries(saved.jobs))if(row.recordedAt&&row.recordedAt<cutoff){delete saved.jobs[id];dirty=true;}
    if(dirty){saved.updatedAt=Date.now();atomicWrite(STATE_FILE,saved);}lastRun=Date.now();lastError='';
  }catch(e){lastRun=Date.now();lastError=e?.message||String(e);}finally{running=false;}
}
setTimeout(()=>scanOnce(),8000);const timer=setInterval(()=>scanOnce(),INTERVAL);timer.unref?.();
module.exports={terminalDecision,eventFor,machineOpsId,atomicWrite,scanOnce,status:()=>({running,lastRun,lastError})};
