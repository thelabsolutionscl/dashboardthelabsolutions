#!/usr/bin/env node
'use strict';

/** Seguridad autónoma del host de granja.
 * Actualiza el sensor ambiental y prueba que cada cámara realmente entregue un
 * frame/respuesta, no sólo que tenga una URL configurada.
 */
const fs=require('fs'),path=require('path');
const DATA_DIR=process.env.FARM_DATA_DIR||path.join(__dirname,'data');
const SAFETY_FILE=process.env.FARM_SAFETY_FILE||path.join(DATA_DIR,'safety.json');
const REGISTRY_FILE=process.env.FARM_REGISTRY_FILE||path.join(DATA_DIR,'registry.json');
const INTERVAL=Math.max(15000,Number(process.env.FARM_SAFETY_AGENT_MS||60000));
const TIMEOUT=Math.max(1000,Number(process.env.FARM_SAFETY_PROBE_TIMEOUT_MS||5000));
const PORT=Number(process.env.BRIDGE_PORT||8347);
let timer=null,running=false,lastRun=0,lastError='';

function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'))||fallback;}catch(_){return fallback;}}
function masterToken(){const e=String(process.env.BRIDGE_ADMIN_TOKEN||process.env.BRIDGE_TOKEN||'').trim();if(e)return e;try{return fs.readFileSync(path.join(__dirname,'.bridge-token'),'utf8').trim();}catch(_){return'';}}
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
      const r=await fetch(url,{cache:'no-store',signal:ctrl.signal,redirect:'follow'});const ct=String(r.headers.get('content-type')||'');
      if(r.ok&&(ct.startsWith('image/')||/multipart\/x-mixed-replace/i.test(ct))){try{const reader=r.body?.getReader?.();if(reader){await reader.read();reader.cancel().catch(()=>{});}}catch(_){}return{ok:true,url,latencyMs:Date.now()-started,checkedAt:Date.now(),contentType:ct};}
      error=`HTTP ${r.status}${ct?' · '+ct:''}`;
    }catch(e){error=e?.name==='AbortError'?'timeout':(e?.message||String(e));}finally{clearTimeout(tid);}
  }
  return{ok:false,error,latencyMs:Date.now()-started,checkedAt:Date.now()};
}
async function sensorReading(snapshot){
  const url=String(snapshot?.config?.sensorUrl||process.env.FARM_SENSOR_URL||'').trim();if(!url)return snapshot?.reading||null;
  const token=String(process.env.FARM_SENSOR_TOKEN||'').trim(),ctrl=new AbortController(),tid=setTimeout(()=>ctrl.abort(),TIMEOUT);
  try{const r=await fetch(url,{cache:'no-store',headers:token?{Authorization:'Bearer '+token}:{},signal:ctrl.signal});if(!r.ok)throw new Error('HTTP '+r.status);const d=await r.json();return{...d,at:new Date().toISOString(),online:true,source:'farm-controller'};}
  catch(e){return{...(snapshot?.reading||{}),at:new Date().toISOString(),online:false,source:'farm-controller',error:e?.message||String(e)};}finally{clearTimeout(tid);}
}
async function pushSnapshot(snapshot){const t=masterToken();if(!t)return false;try{const r=await fetch(`http://127.0.0.1:${PORT}/farm/safety`,{method:'PUT',headers:{'Content-Type':'application/json','X-Bridge-Token':t},body:JSON.stringify(snapshot),signal:AbortSignal.timeout(4000)});return r.ok;}catch(_){return false;}}
async function refreshOnce(){
  if(running)return null;running=true;
  try{
    const current=readJson(SAFETY_FILE,{version:1,config:{},reading:null,cameras:{}}),registry=readJson(REGISTRY_FILE,{machines:[]}),machines=Array.isArray(registry.machines)?registry.machines:[];
    const reading=await sensorReading(current),pairs=await Promise.all(machines.filter(m=>m?.id).map(async m=>[m.id,await cameraProbe(m)]));
    const cameraHealth=Object.fromEntries(pairs),cameras={};for(const[id,row]of pairs)cameras[id]=row.ok===true;
    const snapshot={...current,version:2,updatedAt:Date.now(),reading,cameras,cameraHealth,agent:{updatedAt:Date.now(),host:process.env.HOSTNAME||'',source:'farm-controller'}};
    await pushSnapshot(snapshot);lastRun=Date.now();lastError='';return snapshot;
  }catch(e){lastRun=Date.now();lastError=e?.message||String(e);return null;}finally{running=false;}
}
setTimeout(()=>refreshOnce(),5000);timer=setInterval(()=>refreshOnce(),INTERVAL);timer.unref?.();
module.exports={cameraCandidates,cameraProbe,sensorReading,refreshOnce,status:()=>({lastRun,lastError,running})};
