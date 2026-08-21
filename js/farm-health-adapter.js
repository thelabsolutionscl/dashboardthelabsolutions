/* js/farm-health-adapter.js
 * Cliente de observabilidad central del Farm Controller.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root){root.FarmHealth=api;api.install(root);}
})(typeof window!=='undefined'?window:null,function(){
'use strict';

let target=null,installed=false,controllerOk=null,lastSync=0,lastError='',snapshot=null,syncing=null;
function base(){try{return typeof target?.getPrinterTunnel==='function'?String(target.getPrinterTunnel()||'').replace(/\/$/,''):'';}catch(_){return'';}}
function token(){try{return typeof target?.getPrinterTunnelToken==='function'?String(target.getPrinterTunnelToken()||''):'';}catch(_){return'';}}
function url(path){const b=base(),t=token();return b+path+(t?(path.includes('?')?'&':'?')+'bt='+encodeURIComponent(t):'');}
async function readJson(r){let d=null;try{d=await r.json();}catch(_){}if(!r.ok)throw new Error((d&&d.error)||('HTTP '+r.status));return d||{};}
function emit(){
  try{
    if(typeof target?.dispatchEvent==='function'&&typeof target?.CustomEvent==='function')target.dispatchEvent(new target.CustomEvent('farm-health-updated',{detail:status()}));
  }catch(_){}
}
async function request(path,options={}){
  const b=base(),t=token();if(!b||!t)throw new Error('controller/token no disponible');
  const opts={cache:'no-store',signal:AbortSignal.timeout(options.timeout||8000),...options};delete opts.timeout;
  const r=await fetch(url(path),opts);return readJson(r);
}
async function refresh(force=false){
  if(!target||target._DEMO_MODE)return null;
  if(syncing)return syncing;
  if(!force&&Date.now()-lastSync<15000)return snapshot;
  syncing=(async()=>{
    try{
      const d=await request('/farm/health');snapshot=d.health||null;controllerOk=true;lastSync=Date.now();lastError='';emit();return snapshot;
    }catch(e){controllerOk=false;lastError=e.message;emit();return null;}
    finally{syncing=null;}
  })();
  return syncing;
}
async function probe(){
  try{
    const d=await request('/farm/health/probe',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',timeout:15000});
    snapshot=d.health||null;controllerOk=true;lastSync=Date.now();lastError='';emit();return snapshot;
  }catch(e){controllerOk=false;lastError=e.message;emit();return null;}
}
async function ack(alertId){
  if(!alertId)return false;
  try{
    const d=await request('/farm/health/ack',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({alertId})});
    snapshot=d.health||snapshot;controllerOk=true;lastSync=Date.now();lastError='';emit();return true;
  }catch(e){controllerOk=false;lastError=e.message;emit();return false;}
}
function status(){
  return{
    installed,controllerOk,mode:controllerOk===true?'central':controllerOk===false?'unavailable':'checking',
    lastSync,lastError,summary:snapshot?.summary||null,machines:snapshot?.machines||[],
    alerts:snapshot?.alerts||[],sources:snapshot?.sources||{},events:snapshot?.events||[],generatedAt:snapshot?.generatedAt||0,
  };
}
function install(root){
  if(installed||!root)return false;target=root;installed=true;
  setTimeout(()=>refresh(true),1200);
  if(typeof root.setInterval==='function')root.setInterval(()=>{if(!root.document?.hidden)refresh(false);},30000);
  if(typeof root.addEventListener==='function')root.addEventListener('focus',()=>refresh(true));
  return true;
}
return{install,refresh,probe,ack,status,_test:{}};
});
