/* js/maquinas-identity-fix.js
 * Corrige el mapeo histórico que asociaba 192.168.100.95 a Ender-5 Max #8.
 * La fuente central (Airtable) define ahora .95 como K1 #1. Esta migración
 * elimina únicamente overrides locales conocidos como obsoletos para que el
 * navegador vuelva a respetar la configuración central.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root){root.MaquinasIdentityFix=api;api.install(root);}
})(typeof window!=='undefined'?window:null,function(){
'use strict';

const MARKER='printer_identity_fix_20260826_v1';
const K1_ID='k1-1';
const ENDER8_ID='e5-3';
const CURRENT_K1_IP='192.168.100.95';
const OLD_K1_IP='192.168.100.51';

function read(storage,key){try{return String(storage?.getItem(key)||'').trim();}catch(_){return'';}}
function remove(storage,key){try{storage?.removeItem(key);return true;}catch(_){return false;}}
function set(storage,key,value){try{storage?.setItem(key,value);return true;}catch(_){return false;}}
function hasIp(value,ip){return String(value||'').includes(ip);}

function migrateStorage(storage){
  if(!storage)return{changed:false,removed:[]};
  const removed=[];
  const drop=(key,predicate)=>{
    const value=read(storage,key);
    if(value&&predicate(value)&&remove(storage,key))removed.push(key);
  };

  // .95 ya no pertenece a Ender #8. Cualquier override local con esa IP haría
  // que la tarjeta siguiera apareciendo equivocada aunque Airtable esté bien.
  drop(`printer_ip_${ENDER8_ID}`,v=>v===CURRENT_K1_IP);
  drop(`printer_cam_${ENDER8_ID}`,v=>hasIp(v,CURRENT_K1_IP));

  // K1 #1 antes figuraba en .51. Al limpiar solo ese valor conocido, Airtable
  // (.95) vuelve a ser la fuente efectiva sin destruir overrides arbitrarios.
  drop(`printer_ip_${K1_ID}`,v=>v===OLD_K1_IP);
  drop(`printer_cam_${K1_ID}`,v=>hasIp(v,OLD_K1_IP));

  set(storage,MARKER,'1');
  return{changed:removed.length>0,removed};
}

function install(root){
  if(!root)return false;
  const result=migrateStorage(root.localStorage);
  if(result.changed){
    try{console.info('[Máquinas] identidad K1 #1 actualizada; caché obsoleta eliminada',result.removed); }catch(_){}
    // Si el módulo de máquinas ya está activo, fuerza una lectura fresca. Si no,
    // la carga normal tomará los datos corregidos desde Airtable.
    try{if(typeof root.pollPrinters==='function')root.setTimeout(()=>root.pollPrinters(),0);}catch(_){}
  }
  return true;
}

return{install,_test:{migrateStorage,hasIp,MARKER,K1_ID,ENDER8_ID,CURRENT_K1_IP,OLD_K1_IP}};
});
