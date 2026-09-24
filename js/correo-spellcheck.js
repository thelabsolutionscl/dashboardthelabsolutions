/* js/correo-spellcheck.js
 * Corrección ortográfica visible para el redactor de CORREO.
 * 1) Mantiene el spellcheck nativo del navegador/WebKit.
 * 2) Añade un fallback local para errores frecuentes en español que WebKit
 *    suele dejar pasar (especialmente tildes: ademas → además, tambien → también).
 * El contenido NO se envía a ningún servicio externo.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root){root.CorreoSpellcheck=api;api.install(root);}
})(typeof window!=='undefined'?window:null,function(){
'use strict';

const IDS=['mailCmpSubject','mailCmpBody','mailSigEditor'];
const ERROR_CLASS='mail-local-spell-error';
const SUGGESTIONS=new Map(Object.entries({
  ademas:'además',tambien:'también',informacion:'información',cotizacion:'cotización',
  cotizaciones:'cotizaciones',produccion:'producción',direccion:'dirección',telefono:'teléfono',
  numero:'número',numeros:'números',pagina:'página',paginas:'páginas',proxima:'próxima',
  proximo:'próximo',proximos:'próximos',proximas:'próximas',rapido:'rápido',rapida:'rápida',
  dias:'días',dia:'día',envio:'envío',envios:'envíos',confirmacion:'confirmación',
  instalacion:'instalación',fabricacion:'fabricación',terminacion:'terminación',
  presentacion:'presentación',reunion:'reunión',reuniones:'reuniones',ubicacion:'ubicación',
  operacion:'operación',revision:'revisión',validacion:'validación',aprobacion:'aprobación',
  atencion:'atención',solucion:'solución',soluciones:'soluciones',comunicacion:'comunicación',
  coordinacion:'coordinación',acreditacion:'acreditación',administracion:'administración',
  gestion:'gestión',version:'versión',sesion:'sesión',conexion:'conexión',configuracion:'configuración',
  opcion:'opción',opciones:'opciones',seccion:'sección',secciones:'secciones',
  menu:'menú',util:'útil',facil:'fácil',dificil:'difícil',aqui:'aquí',ahi:'ahí',
  porfavor:'por favor',gracias:'gracias',
  nesecito:'necesito',nececita:'necesita',necesito:'necesito',resivir:'recibir',
  recivir:'recibir',aver:'a ver',haber:'haber',haci:'así',
  ola:'hola',grasias:'gracias',kiero:'quiero',quiero:'quiero',qe:'que',
  q:'que',xq:'porque',porqe:'porque',porq:'porque'
}));

let target=null,installed=false,observer=null,wired=0,timer=null,mutating=false,mailPatched=false;

function normalizeWord(w){return String(w||'').normalize('NFC').toLocaleLowerCase('es-CL');}
function suggestionFor(word){
  const key=normalizeWord(word);
  const s=SUGGESTIONS.get(key);
  if(!s||s===key)return '';
  if(word&&word[0]===word[0]?.toUpperCase())return s.charAt(0).toUpperCase()+s.slice(1);
  return s;
}

function apply(el){
  if(!el)return false;
  el.setAttribute('lang','es-CL');
  el.setAttribute('spellcheck','true');
  el.setAttribute('autocorrect','on');
  el.setAttribute('autocapitalize','sentences');
  el.setAttribute('writingsuggestions','true');
  if(el.dataset&&el.dataset.tlsSpellReady!=='1'){
    el.dataset.tlsSpellReady='1';
    // No hacemos toggle false→true: en WKWebView puede desactivar el corrector
    // para ese editor durante toda la sesión. Simplemente forzamos true.
    try{el.spellcheck=true;}catch(_){}
    wired++;
  }
  return true;
}

function applyAll(){
  const d=target?.document;if(!d)return 0;
  let n=0;IDS.forEach(id=>{if(apply(d.getElementById(id)))n++;});return n;
}

function ensureStyle(){
  const d=target?.document;if(!d||d.getElementById('tlsCorreoSpellStyle'))return;
  const s=d.createElement('style');s.id='tlsCorreoSpellStyle';
  s.textContent=`
    #mailCmpBody::spelling-error,#mailCmpSubject::spelling-error,#mailSigEditor::spelling-error{
      text-decoration-line:underline!important;text-decoration-style:wavy!important;
      text-decoration-color:#ff4d5e!important;text-decoration-thickness:1.5px!important;
      text-underline-offset:2px!important;background:rgba(255,77,94,.035)!important;
    }
    #mailCmpBody::-webkit-spelling-error,#mailCmpSubject::-webkit-spelling-error,#mailSigEditor::-webkit-spelling-error{
      text-decoration:underline wavy #ff4d5e!important;text-underline-offset:2px!important;
    }
    .${ERROR_CLASS}{
      text-decoration-line:underline!important;text-decoration-style:wavy!important;
      text-decoration-color:#ff4d5e!important;text-decoration-thickness:1.5px!important;
      text-underline-offset:2px!important;background:rgba(255,77,94,.04)!important;
      cursor:pointer;border-radius:2px;
    }
    .${ERROR_CLASS}:hover{background:rgba(255,77,94,.12)!important}
    #mailCmpSubject.mail-local-spell-subject-error{border-bottom-color:#ff4d5e!important;
      box-shadow:inset 0 -1px 0 #ff4d5e!important}
  `;
  (d.head||d.documentElement).appendChild(s);
}

function textOffset(root,node,offset){
  try{const r=target.document.createRange();r.setStart(root,0);r.setEnd(node,offset);return r.toString().length;}catch(_){return null;}
}
function pointAt(root,pos){
  const w=target.document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let n,seen=0;
  while((n=w.nextNode())){
    const len=n.nodeValue.length;
    if(seen+len>=pos)return{node:n,offset:Math.max(0,Math.min(len,pos-seen))};
    seen+=len;
  }
  return{node:root,offset:root.childNodes.length};
}
function saveSelection(root){
  const s=target.getSelection?.();if(!s||!s.rangeCount)return null;
  const r=s.getRangeAt(0);if(!root.contains(r.startContainer)||!root.contains(r.endContainer))return null;
  return{start:textOffset(root,r.startContainer,r.startOffset),end:textOffset(root,r.endContainer,r.endOffset)};
}
function restoreSelection(root,saved){
  if(!saved||saved.start==null||saved.end==null)return;
  try{
    const a=pointAt(root,saved.start),b=pointAt(root,saved.end),r=target.document.createRange();
    r.setStart(a.node,a.offset);r.setEnd(b.node,b.offset);
    const s=target.getSelection();s.removeAllRanges();s.addRange(r);
  }catch(_){}
}

function unwrapErrors(root){
  root?.querySelectorAll?.('.'+ERROR_CLASS).forEach(span=>{
    span.replaceWith(target.document.createTextNode(span.textContent||''));
  });
  try{root?.normalize?.();}catch(_){}
}
function shouldSkip(node,root){
  const p=node.parentElement;if(!p||!root.contains(p))return true;
  return !!p.closest('.mail-signature-block,a,code,pre,script,style,[contenteditable="false"]');
}

function lintBody(){
  const root=target?.document?.getElementById('mailCmpBody');if(!root||mutating)return 0;
  mutating=true;
  const saved=saveSelection(root);
  try{
    unwrapErrors(root);
    const walker=target.document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes=[];let n;while((n=walker.nextNode()))if(!shouldSkip(n,root))nodes.push(n);
    let count=0;
    const re=/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g;
    nodes.forEach(node=>{
      const text=node.nodeValue||'';let last=0,m,changed=false;
      const frag=target.document.createDocumentFragment();
      while((m=re.exec(text))){
        const sug=suggestionFor(m[0]);if(!sug)continue;
        changed=true;
        if(m.index>last)frag.appendChild(target.document.createTextNode(text.slice(last,m.index)));
        const span=target.document.createElement('span');
        span.className=ERROR_CLASS;span.dataset.suggestion=sug;span.title='Sugerencia: '+sug+' · clic para corregir';
        span.textContent=m[0];frag.appendChild(span);last=m.index+m[0].length;count++;
      }
      if(changed){
        if(last<text.length)frag.appendChild(target.document.createTextNode(text.slice(last)));
        node.replaceWith(frag);
      }
    });
  }finally{
    restoreSelection(root,saved);mutating=false;
  }
  return root.querySelectorAll('.'+ERROR_CLASS).length;
}

function lintSubject(){
  const el=target?.document?.getElementById('mailCmpSubject');if(!el)return 0;
  const words=(el.value||'').match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g)||[];
  const bad=words.map(w=>({word:w,suggestion:suggestionFor(w)})).filter(x=>x.suggestion);
  el.classList.toggle('mail-local-spell-subject-error',bad.length>0);
  el.title=bad.length?bad.map(x=>x.word+' → '+x.suggestion).join(' · '):'';
  return bad.length;
}
function lintNow(){return lintBody()+lintSubject();}
function scheduleLint(){
  clearTimeout(timer);timer=target.setTimeout?.(()=>lintNow(),280);
}

function cleanHtml(root){
  if(!root)return'';
  const clone=root.cloneNode(true);
  clone.querySelectorAll?.('.'+ERROR_CLASS).forEach(span=>span.replaceWith(target.document.createTextNode(span.textContent||'')));
  return clone.innerHTML;
}

function patchMail(){
  const mail=target?.MAIL;if(!mail||mailPatched)return !!mail;
  mailPatched=true;
  const original=typeof mail.sendCompose==='function'?mail.sendCompose.bind(mail):null;
  if(original){
    mail.sendCompose=async function(){
      const body=target.document.getElementById('mailCmpBody');
      if(body){
        const clean=cleanHtml(body);
        unwrapErrors(body);
        body.innerHTML=clean;
      }
      return original();
    };
  }
  return true;
}

function onClick(e){
  const span=e.target?.closest?.('.'+ERROR_CLASS);if(!span)return;
  const sug=span.dataset.suggestion||'';if(!sug)return;
  e.preventDefault();e.stopPropagation();
  const text=target.document.createTextNode(sug);span.replaceWith(text);
  try{
    const r=target.document.createRange();r.setStart(text,text.nodeValue.length);r.collapse(true);
    const s=target.getSelection();s.removeAllRanges();s.addRange(r);
  }catch(_){}
  scheduleLint();
}

function install(root){
  if(installed||!root?.document)return false;
  target=root;installed=true;
  const start=()=>{
    ensureStyle();applyAll();patchMail();
    root.document.addEventListener('focusin',e=>{
      const el=e.target;if(el&&IDS.includes(el.id))apply(el);
    });
    root.document.addEventListener('input',e=>{
      if(e.target?.id==='mailCmpBody'||e.target?.id==='mailCmpSubject')scheduleLint();
    });
    root.document.addEventListener('click',onClick);
    root.document.addEventListener('paste',e=>{
      if(e.target?.id==='mailCmpBody'||e.target?.id==='mailCmpSubject')target.setTimeout?.(scheduleLint,0);
    });
    if(typeof root.MutationObserver==='function'&&root.document.body){
      observer=new root.MutationObserver(()=>{applyAll();patchMail();});
      observer.observe(root.document.body,{childList:true,subtree:true});
    }
    target.setTimeout?.(()=>{patchMail();lintNow();},300);
  };
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  return true;
}

function status(){
  const body=target?.document?.getElementById('mailCmpBody');
  return{installed,wired,observing:!!observer,errors:body?.querySelectorAll?.('.'+ERROR_CLASS)?.length||0};
}
return{install,status,_test:{IDS,SUGGESTIONS,suggestionFor,normalizeWord}};
});
