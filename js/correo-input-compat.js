/* js/correo-input-compat.js
 * Protege los campos de redacción de CORREO frente a atajos globales que pueden
 * interceptar teclas muertas/Option/AltGr. No cancela el evento: solo evita que
 * suba a handlers globales, dejando al navegador componer á/é/í/ó/ú/ñ/ü.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root){root.CorreoInputCompat=api;api.install(root);}
})(typeof window!=='undefined'?window:null,function(){
'use strict';

const IDS=['mailCmpTo','mailCmpCc','mailCmpBcc','mailCmpSubject','mailCmpBody','mailSigEditor','mailSigCode'];
let target=null,installed=false,observer=null,wired=0;

function isAltGraph(e){
  try{return !!e?.getModifierState?.('AltGraph');}catch(_){return false;}
}
function shouldShieldEvent(e){
  if(!e)return false;
  const key=String(e.key||'');
  if(e.isComposing||e.keyCode===229||key==='Dead'||key==='Process')return true;
  if(isAltGraph(e))return true;
  // En macOS Option genera las teclas muertas usadas para tildes; en layouts
  // internacionales Alt también participa en la composición. Nunca preventDefault.
  if(e.altKey&&!e.metaKey)return true;
  return false;
}
function shield(e){if(shouldShieldEvent(e))e.stopPropagation();}
function wire(el){
  if(!el||el.dataset?.correoImeWired==='1')return false;
  if(el.dataset)el.dataset.correoImeWired='1';
  ['keydown','keyup','keypress'].forEach(type=>el.addEventListener(type,shield));
  ['compositionstart','compositionupdate','compositionend'].forEach(type=>el.addEventListener(type,e=>e.stopPropagation()));
  // Algunos navegadores expresan la composición por beforeinput sin marcar
  // keydown como composing. Dejarlo nativo y aislarlo de listeners globales.
  el.addEventListener('beforeinput',e=>{
    const t=String(e.inputType||'');
    if(e.isComposing||t==='insertCompositionText'||t==='insertFromComposition')e.stopPropagation();
  });
  wired++;return true;
}
function wireAll(){
  const d=target?.document;if(!d)return 0;
  let n=0;IDS.forEach(id=>{if(wire(d.getElementById(id)))n++;});return n;
}
function install(root){
  if(installed||!root?.document)return false;
  target=root;installed=true;
  const start=()=>{
    wireAll();
    if(typeof root.MutationObserver==='function'&&root.document.body){
      observer=new root.MutationObserver(()=>wireAll());
      observer.observe(root.document.body,{childList:true,subtree:true});
    }
  };
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  return true;
}
function status(){return{installed,wired,observing:!!observer};}
return{install,status,_test:{shouldShieldEvent,isAltGraph,IDS}};
});
