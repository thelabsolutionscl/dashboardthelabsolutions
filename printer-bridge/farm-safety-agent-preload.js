#!/usr/bin/env node
'use strict';

/** Seguridad autónoma del host de granja.
 *
 * El navegador puede seguir actualizando configuración/preflight en safety.json,
 * pero NO puede declarar una cámara sana. Este agente escribe una fuente
 * separada (`safety-agent.json`) con probes reales LAN. El Farm Controller la
 * combina de forma autoritativa justo antes de lanzar trabajo desatendido.
 */
const fs=require('fs'),path=require('path');
const DATA_DIR=process.env.FARM_DATA_DIR||path.join(__dirname,'data');
const SAFETY_FILE=process.env.FARM_SAFETY_FILE||path.join(DATA_DIR,'safety.json');
const AGENT_FILE=process.env.FARM_SAFETY_AGENT_FILE||path.join(DATA_DIR,'safety-agent.json');
const REGISTRY_FILE=process.env.FARM_REGISTRY_FILE||path.join(DATA_DIR,'registry.json');
const INTERVAL=Math.max(15000,Number(process.env.FARM_SAFETY_AGENT_MS||60000));
const TIMEOUT=Math.max(1000,Number(process.env.FARM_SAFETY_PROBE_TIMEOUT_MS||5000));
let timer=null,running=false,lastRun=0,lastError='';

function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'))||fallback;}catch(_){return fallback;}}
function atomicWrite(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=file+'.tmp-'+process.pid+'-'+Date.now();
  fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  const fd=fs.openSync(tmp,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(tmp,file);
  try{const dfd=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}}catch(_){}
}
function cameraCandidates(m){
  const ip=String(m?.ip||'').trim(),custom=String(m?.cam||'').trim(),model=String(m?.model||m?.modelo||'');const out=[];
  if(custom)out.push(custom);if(!ip)return[...new Set(out)];
  if(/K2/i.test(model)){out.push(`http://${ip}:1984/api/frame.jpeg?src=k2plus`,`http://${ip}:1984/api/frame.jpeg?src=k2`);}
  out.push(`http://${ip}:8080/?action=snapshot`,`http://${ip}:8080/?action=stream`);
  return[...new Set(out)];
}
async function cameraProbe(m){
  const started=Date.now();let error='sin URL de cámara';
  for(const url of cameraCandidates(m)){
    const ctrl=new AbortController(),tid=setTimeout(()=>ctrl.abort(),TIMEOUT);
    try{
      const r=await fetch(url,{cache:'no-store',signal:ctrl.signal,redirect:'follow'}),ct=String(r.headers.get('content-type')||'');
      if(r.ok&&(ct.startsWith('image/')||/multipart\/x-mixed-replace/i.test(ct))){
        let bytes=0;try{const reader=r.body?.getReader?.();if(reader){const first=await reader.read();bytes=first?.value?.byteLength||0;reader.cancel().catch(()=>{});}}catch(_){}
        if(bytes>0||ct.startsWith('image/'))return{ok:true,url,latencyMs:Date.now()-started,checkedAt:Date.now(),contentType:ct,bytes};
        error='respuesta de cámara sin datos';
      }else error=`HTTP ${r.status}${ct?' · '+ct:''}`;
    }catch(e){error=e?.name==='AbortError'?'timeout':(e?.message||String(e));}finally{clearTimeout(tid);}
  }
  return{ok:false,error,latencyMs:Date.now()-started,checkedAt:Date.now()};
}
async function sensorReading(snapshot){
  const url=String(snapshot?.config?.sensorUrl||process.env.FARM_SENSOR_URL||'').trim();
  if(!url){const prior=snapshot?.reading||null;return prior?{...prior,source:prior.source||'browser-fallback'}:null;}
  const token=String(process.env.FARM_SENSOR_TOKEN||'').trim(),ctrl=new AbortController(),tid=setTimeout(()=>ctrl.abort(),TIMEOUT);
  try{const r=await fetch(url,{cache:'no-store',headers:token?{Authorization:'Bearer '+token}:{},signal:ctrl.signal});if(!r.ok)throw new Error('HTTP '+r.status);const d=await r.json();return{...d,at:new Date().toISOString(),online:true,source:'farm-controller'};}
  catch(e){return{...(snapshot?.reading||{}),at:new Date().toISOString(),online:false,source:'farm-controller',error:e?.message||String(e)};}finally{clearTimeout(tid);}
}
async function refreshOnce(){
  if(running)return null;running=true;
  try{
    const configured=readJson(SAFETY_FILE,{version:1,config:{},reading:null,cameras:{}}),registry=readJson(REGISTRY_FILE,{machines:[]}),machines=Array.isArray(registry.machines)?registry.machines:[];
    const reading=await sensorReading(configured),pairs=await Promise.all(machines.filter(m=>m?.id).map(async m=>[m.id,await cameraProbe(m)]));
    const cameraHealth=Object.fromEntries(pairs),cameras={};for(const[id,row]of pairs)cameras[id]=row.ok===true;
    const snapshot={version:2,updatedAt:Date.now(),reading,cameras,cameraHealth,agent:{updatedAt:Date.now(),host:process.env.HOSTNAME||'',source:'farm-controller',intervalMs:INTERVAL}};
    atomicWrite(AGENT_FILE,snapshot);lastRun=Date.now();lastError='';return snapshot;
  }catch(e){lastRun=Date.now();lastError=e?.message||String(e);return null;}finally{running=false;}
}
setTimeout(()=>refreshOnce(),5000);timer=setInterval(()=>refreshOnce(),INTERVAL);timer.unref?.();
module.exports={cameraCandidates,cameraProbe,sensorReading,atomicWrite,refreshOnce,AGENT_FILE,status:()=>({lastRun,lastError,running})};
