/* js/correo-to-multi-recipient-fix.js
 * Habilita el mismo flujo multi-destinatario del compositor en el campo Para.
 * El backend y MAIL.sendCompose ya aceptan listas separadas por coma; este
 * adaptador corrige la UI/autocompletado para que seleccionar otro contacto no
 * reemplace al anterior.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root){root.CorreoToMultiFix=api;api.install(root);}
})(typeof window!=='undefined'?window:null,function(){
'use strict';

const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let target=null,installed=false,ready=false;

function clean(v){return String(v??'').trim();}
function dedupe(values){
  const seen=new Set(),out=[];
  for(const value of values||[]){
    const v=clean(value);if(!v)continue;
    const key=v.toLowerCase();if(seen.has(key))continue;
    seen.add(key);out.push(v);
  }
  return out;
}
function splitRecipients(value){
  return dedupe(String(value||'').split(/[,;\n\r]+/).map(v=>v.trim()).filter(Boolean));
}
function normalizeRecipientValue(value){return splitRecipients(value).join(', ');}
function activeRecipientToken(value){
  const raw=String(value||'').replace(/[;\n\r]+/g,',');
  const cut=raw.lastIndexOf(',');
  return clean(cut>=0?raw.slice(cut+1):raw);
}
function mergeRecipient(value,email){
  const raw=String(value||'').replace(/[;\n\r]+/g,',');
  const cut=raw.lastIndexOf(',');
  const complete=cut>=0?splitRecipients(raw.slice(0,cut)):[];
  const selected=clean(email);
  return dedupe([...complete,selected]).join(', ')+(selected?', ':'');
}
function contactOptions(){
  const list=target?.document?.getElementById('mailContactsList');
  if(!list)return[];
  const seen=new Set(),out=[];
  for(const option of Array.from(list.querySelectorAll('option'))){
    const email=clean(option.value);if(!EMAIL_RE.test(email))continue;
    const key=email.toLowerCase();if(seen.has(key))continue;seen.add(key);
    out.push({email,label:clean(option.label||option.textContent||'')});
  }
  return out;
}
function ensureStyles(){
  if(!target?.document||target.document.getElementById('mailMultiRecipientStyles'))return;
  const style=target.document.createElement('style');style.id='mailMultiRecipientStyles';
  style.textContent=`
.mail-multi-suggestions{position:fixed;z-index:10050;max-height:240px;overflow:auto;background:#fff;border:1px solid rgba(15,23,42,.15);border-radius:10px;box-shadow:0 12px 32px rgba(15,23,42,.18);padding:5px;min-width:260px}
.mail-multi-suggestions[hidden]{display:none!important}
.mail-multi-option{display:block;width:100%;border:0;background:transparent;text-align:left;padding:8px 10px;border-radius:7px;cursor:pointer;color:#0f172a;font:inherit}
.mail-multi-option:hover,.mail-multi-option.is-active{background:#f1f5f9}
.mail-multi-option strong{display:block;font-size:13px;font-weight:600}
.mail-multi-option span{display:block;font-size:11px;color:#64748b;margin-top:2px}`;
  target.document.head?.appendChild(style);
}
function positionPopup(input,popup){
  const r=input.getBoundingClientRect();
  popup.style.left=`${Math.max(8,r.left)}px`;
  popup.style.top=`${Math.min((target.innerHeight||800)-80,r.bottom+4)}px`;
  popup.style.width=`${Math.max(260,r.width)}px`;
}
function setup(input){
  if(!input||input.dataset.multiRecipientReady==='1')return false;
  ensureStyles();
  input.dataset.multiRecipientReady='1';
  input.dataset.originalList=input.getAttribute('list')||'mailContactsList';
  input.removeAttribute('list');
  input.setAttribute('autocomplete','off');
  input.setAttribute('aria-autocomplete','list');
  input.title='Puedes agregar varios destinatarios. Selecciona un contacto y continúa escribiendo.';

  const popup=target.document.createElement('div');
  popup.className='mail-multi-suggestions';popup.hidden=true;popup.setAttribute('role','listbox');
  target.document.body.appendChild(popup);
  let matches=[],active=-1,blurTimer=null;

  const hide=()=>{popup.hidden=true;popup.replaceChildren();matches=[];active=-1;};
  const render=()=>{
    const token=activeRecipientToken(input.value).toLowerCase();
    const raw=String(input.value||'').replace(/[;\n\r]+/g,',');
    const cut=raw.lastIndexOf(',');
    const used=new Set(splitRecipients(cut>=0?raw.slice(0,cut):'').map(v=>v.toLowerCase()));
    matches=contactOptions().filter(item=>{
      if(used.has(item.email.toLowerCase()))return false;
      if(!token)return true;
      return item.email.toLowerCase().includes(token)||item.label.toLowerCase().includes(token);
    }).slice(0,10);
    popup.replaceChildren();active=-1;
    if(!matches.length){hide();return;}
    matches.forEach((item,index)=>{
      const btn=target.document.createElement('button');btn.type='button';btn.className='mail-multi-option';btn.setAttribute('role','option');
      const strong=target.document.createElement('strong');strong.textContent=item.email;btn.appendChild(strong);
      if(item.label){const span=target.document.createElement('span');span.textContent=item.label;btn.appendChild(span);}
      btn.addEventListener('mousedown',e=>e.preventDefault());
      btn.addEventListener('click',()=>choose(index));popup.appendChild(btn);
    });
    positionPopup(input,popup);popup.hidden=false;
  };
  const choose=index=>{
    const item=matches[index];if(!item)return;
    input.value=mergeRecipient(input.value,item.email);
    input.dispatchEvent(new target.Event('input',{bubbles:true}));
    input.focus();render();
  };
  const setActive=index=>{
    if(!matches.length)return;
    active=(index+matches.length)%matches.length;
    Array.from(popup.children).forEach((el,i)=>el.classList.toggle('is-active',i===active));
    popup.children[active]?.scrollIntoView?.({block:'nearest'});
  };

  input.addEventListener('focus',()=>{clearTimeout(blurTimer);render();});
  input.addEventListener('input',render);
  input.addEventListener('blur',()=>{
    blurTimer=setTimeout(()=>{input.value=normalizeRecipientValue(input.value);hide();},120);
  });
  input.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'&&!popup.hidden){e.preventDefault();setActive(active+1);}
    else if(e.key==='ArrowUp'&&!popup.hidden){e.preventDefault();setActive(active-1);}
    else if(e.key==='Enter'&&!popup.hidden&&active>=0){e.preventDefault();choose(active);}
    else if(e.key==='Escape'){hide();}
  });
  target.addEventListener?.('resize',()=>{if(!popup.hidden)positionPopup(input,popup);});
  target.addEventListener?.('scroll',()=>{if(!popup.hidden)positionPopup(input,popup);},true);
  ready=true;return true;
}
function trySetup(){
  if(!target?.document)return false;
  const input=target.document.getElementById('mailCmpTo');
  return input?setup(input):false;
}
function install(root){
  if(installed||!root)return false;target=root;installed=true;
  const run=()=>{if(ready)return true;return trySetup();};
  run();let attempts=0;
  const timer=root.setInterval?.(()=>{attempts++;if(run()||attempts>150)root.clearInterval?.(timer);},100);
  root.document?.addEventListener?.('DOMContentLoaded',run,{once:true});
  return true;
}
function status(){return{installed,ready};}

return{install,status,_test:{splitRecipients,normalizeRecipientValue,activeRecipientToken,mergeRecipient}};
});
