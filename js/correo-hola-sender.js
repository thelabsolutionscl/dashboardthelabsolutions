/* js/correo-hola-sender.js — identidad predeterminada de la casilla comercial compartida. */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root) api.install(root);
})(typeof window!=='undefined'?window:null,function(){
'use strict';

const HOLA_EMAIL='hola@thelab.solutions';
const HOLA_NAME='Andrea Garrido - The Lab Solutions';
const LEGACY_DEFAULT='The Lab Solutions';

function normEmail(v){return String(v||'').trim().toLowerCase();}
function senderNameFor(email,storedName){
  const name=String(storedName||'').trim();
  if(normEmail(email)!==HOLA_EMAIL) return name;
  // Migra únicamente el nombre vacío o el valor histórico que traía hola@ por defecto.
  // Si alguien definió expresamente otro nombre, se conserva como override manual.
  if(!name||name.toLowerCase()===LEGACY_DEFAULT.toLowerCase()) return HOLA_NAME;
  return name;
}
function normalizeAccounts(list){
  if(!Array.isArray(list)) return [];
  return list.map(a=>{
    if(!a||typeof a!=='object') return a;
    if(normEmail(a.email)!==HOLA_EMAIL) return a;
    return {...a,name:senderNameFor(a.email,a.name)};
  });
}
function install(root){
  if(!root||root.__TLS_HOLA_SENDER_INSTALLED__) return false;
  const mail=root.MAIL;
  if(!mail){
    if(typeof root.setTimeout==='function') root.setTimeout(()=>install(root),50);
    return false;
  }
  root.__TLS_HOLA_SENDER_INSTALLED__=true;

  const originalAccounts=mail.accounts.bind(mail);
  mail.accounts=function(){return normalizeAccounts(originalAccounts());};

  const originalOpenCompose=mail.openCompose.bind(mail);
  mail.openCompose=function(opts={}){
    let next=opts||{};
    if(normEmail(next._fromEmail)===HOLA_EMAIL&&!String(next._fromName||'').trim()){
      next={...next,_fromName:HOLA_NAME};
    }
    return originalOpenCompose(next);
  };

  const originalPostAs=mail.postAs.bind(mail);
  mail.postAs=function(fromEmail,params){
    let next=params||{};
    if(normEmail(fromEmail)===HOLA_EMAIL&&next.action==='send'&&!String(next.from_name||'').trim()){
      next={...next,from_name:HOLA_NAME};
    }
    return originalPostAs(fromEmail,next);
  };

  try{mail.renderAccounts();}catch(_){}
  return true;
}

return{
  install,
  HOLA_EMAIL,
  HOLA_NAME,
  _test:{normEmail,senderNameFor,normalizeAccounts}
};
});
