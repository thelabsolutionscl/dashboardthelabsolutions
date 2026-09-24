/* js/correo-spellcheck.js
 * Refuerza la corrección ortográfica nativa en el redactor de CORREO.
 * No envía el contenido a servicios externos: usa el motor del navegador/WebKit.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root){root.CorreoSpellcheck=api;api.install(root);}
})(typeof window!=='undefined'?window:null,function(){
'use strict';

const IDS=['mailCmpSubject','mailCmpBody','mailSigEditor'];
let target=null,installed=false,observer=null,wired=0;

function apply(el){
  if(!el)return false;
  el.setAttribute('lang','es-CL');
  el.setAttribute('spellcheck','true');
  el.setAttribute('autocorrect','on');
  el.setAttribute('autocapitalize','sentences');
  el.setAttribute('writingsuggestions','true');
  // Algunos WebKit recalculan el corrector al alternar spellcheck. Se hace una
  // sola vez por elemento para no mover el cursor mientras el usuario escribe.
  if(el.dataset&&el.dataset.tlsSpellReady!=='1'){
    el.dataset.tlsSpellReady='1';
    try{
      const current=el.spellcheck;
      el.spellcheck=false;
      void el.offsetWidth;
      el.spellcheck=current!==false;
    }catch(_){}
    wired++;
  }
  return true;
}

function applyAll(){
  const d=target?.document;if(!d)return 0;
  let n=0;
  IDS.forEach(id=>{if(apply(d.getElementById(id)))n++;});
  return n;
}

function ensureStyle(){
  const d=target?.document;if(!d||d.getElementById('tlsCorreoSpellStyle'))return;
  const s=d.createElement('style');s.id='tlsCorreoSpellStyle';
  s.textContent=`
    #mailCmpBody::spelling-error,
    #mailCmpSubject::spelling-error,
    #mailSigEditor::spelling-error{
      text-decoration-line:underline!important;
      text-decoration-style:wavy!important;
      text-decoration-color:#ff4d5e!important;
      text-decoration-thickness:1.5px!important;
      text-underline-offset:2px!important;
      background:rgba(255,77,94,.035)!important;
    }
    #mailCmpBody::-webkit-spelling-error,
    #mailCmpSubject::-webkit-spelling-error,
    #mailSigEditor::-webkit-spelling-error{
      text-decoration:underline wavy #ff4d5e!important;
      text-underline-offset:2px!important;
    }
  `;
  (d.head||d.documentElement).appendChild(s);
}

function install(root){
  if(installed||!root?.document)return false;
  target=root;installed=true;
  const start=()=>{
    ensureStyle();applyAll();
    root.document.addEventListener('focusin',e=>{
      const el=e.target;
      if(el&&IDS.includes(el.id))apply(el);
    });
    if(typeof root.MutationObserver==='function'&&root.document.body){
      observer=new root.MutationObserver(()=>applyAll());
      observer.observe(root.document.body,{childList:true,subtree:true});
    }
  };
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
  return true;
}

function status(){return{installed,wired,observing:!!observer};}
return{install,status,_test:{IDS}};
});
