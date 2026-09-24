/* js/correo-spellcheck.js
 * Corrección ortográfica visible para el redactor de CORREO.
 * 1) Mantiene el spellcheck nativo del navegador/WebKit.
 * 2) Carga un diccionario Hunspell completo de español de Chile (es-CL)
 *    y lo ejecuta localmente con Typo.js para marcar palabras desconocidas.
 * 3) Mantiene un fallback pequeño para errores comunes mientras carga el diccionario.
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
  ola:'hola',grasias:'gracias',gracais:'gracias',kiero:'quiero',quiero:'quiero',qe:'que',
  q:'que',xq:'porque',porqe:'porque',porq:'porque',estaz:'estás',estoi:'estoy',
  hols:'hola',buenoz:'buenos',adjnto:'adjunto',adjntamos:'adjuntamos',mensage:'mensaje',
  abiendo:'habiendo',zido:'sido',aser:'hacer',echo:'hecho',ay:'hay',asta:'hasta',
  tubimos:'tuvimos',tube:'tuve',bamos:'vamos',vien:'bien',qeria:'quería',podria:'podría'
}));

let target=null,installed=false,observer=null,wired=0,timer=null,mutating=false,mailPatched=false;
let fullDictionary=null,dictionaryPromise=null,dictionaryState='idle';

const ALLOWED_TERMS=new Set([
  'tls','kai','thelab','airtable','claude','chatgpt','whatsapp','google','drive',
  'creality','orcaslicer','orca','klipper','fluidd','esp32','nfc','rfid','pla','petg','tpu',
  'alucobond','heineken','wom','bci','ccu','resend','github','vercel'
]);

function loadScriptOnce(src){
  if(target?.Typo)return Promise.resolve(target.Typo);
  return new Promise((resolve,reject)=>{
    const d=target?.document;if(!d){reject(new Error('Sin DOM'));return;}
    const prev=d.querySelector('script[data-tls-spell-lib="1"]');
    if(prev){
      prev.addEventListener('load',()=>resolve(target.Typo),{once:true});
      prev.addEventListener('error',()=>reject(new Error('No se pudo cargar Typo.js')),{once:true});
      return;
    }
    const s=d.createElement('script');s.src=src;s.async=true;s.dataset.tlsSpellLib='1';
    s.onload=()=>target.Typo?resolve(target.Typo):reject(new Error('Typo.js no quedó disponible'));
    s.onerror=()=>reject(new Error('No se pudo cargar Typo.js'));
    (d.head||d.documentElement).appendChild(s);
  });
}
function loadFullDictionary(){
  if(fullDictionary)return Promise.resolve(fullDictionary);
  if(dictionaryPromise)return dictionaryPromise;
  if(!target?.fetch){dictionaryState='unavailable';return Promise.resolve(null);}
  dictionaryState='loading';
  dictionaryPromise=(async()=>{
    try{
      await loadScriptOnce('vendor/spellcheck/typo.js');
      const [affRes,dicRes]=await Promise.all([
        target.fetch('vendor/spellcheck/es_CL.aff',{cache:'force-cache'}),
        target.fetch('vendor/spellcheck/es_CL.dic',{cache:'force-cache'})
      ]);
      if(!affRes.ok||!dicRes.ok)throw new Error('No se pudo cargar diccionario es-CL');
      const [aff,dic]=await Promise.all([affRes.text(),dicRes.text()]);
      fullDictionary=new target.Typo('es_CL',aff,dic);
      dictionaryState='ready';
      target.setTimeout?.(()=>lintNow(),0);
      return fullDictionary;
    }catch(e){
      dictionaryState='error';
      console.warn('[Correo spellcheck] diccionario es-CL no disponible:',e?.message||e);
      return null;
    }
  })();
  return dictionaryPromise;
}

// Fallback local para errores evidentes que el motor del navegador puede no
// subrayar si el usuario no tiene español habilitado en Chrome/Safari.
// No intenta ser un corrector gramatical: solo marca palabras muy cercanas
// (1 edición) a vocabulario común de correo/negocio, minimizando falsos positivos.
const COMMON_WORDS=[
  'hola','buenos','buenas','días','tardes','noches','cómo','estás','está','estoy','estamos',
  'gracias','favor','saludos','estimado','estimada','equipo','cliente','clientes','correo','mensaje',
  'adjunto','adjunta','adjuntamos','archivo','archivos','documento','documentos','cotización','cotizaciones',
  'pedido','pedidos','producción','entrega','entregas','fecha','fechas','confirmación','confirmar','información',
  'reunión','reuniones','dirección','teléfono','número','página','envío','instalación','fabricación','terminación',
  'presentación','ubicación','operación','revisión','validación','aprobación','atención','solución','soluciones',
  'comunicación','coordinación','acreditación','administración','gestión','versión','sesión','conexión',
  'configuración','opción','opciones','sección','secciones','menú','útil','fácil','difícil','aquí','ahí',
  'necesito','necesita','recibir','hacer','haces','hecho','habiendo','hay','hasta','sido','ser','somos','son',
  'tenemos','tienes','tiene','tuve','tuvimos','puedes','podemos','vamos','bien','quería','podría','quedo','quedamos',
  'pendiente','pendientes','disponible','disponibles','precio','precios','costo','costos','valor','valores',
  'pago','pagos','factura','facturas','proyecto','proyectos','semana','semanas','mes','meses','mañana','hoy'
];

function normalizeWord(w){return String(w||'').normalize('NFC').toLocaleLowerCase('es-CL');}
function stripMarks(w){return normalizeWord(w).normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function commonPrefix(a,b){
  let i=0;while(i<a.length&&i<b.length&&a[i]===b[i])i++;return i;
}
function oneEditAway(a,b){
  a=stripMarks(a);b=stripMarks(b);
  if(a===b)return false;
  if(Math.abs(a.length-b.length)>1)return false;
  // Sustitución o transposición de dos letras vecinas.
  if(a.length===b.length){
    const dif=[];for(let i=0;i<a.length;i++)if(a[i]!==b[i])dif.push(i);
    if(dif.length===1)return true;
    return dif.length===2&&dif[1]===dif[0]+1&&a[dif[0]]===b[dif[1]]&&a[dif[1]]===b[dif[0]];
  }
  // Inserción/eliminación de una letra.
  const short=a.length<b.length?a:b,long=a.length<b.length?b:a;
  let i=0,j=0,skips=0;
  while(i<short.length&&j<long.length){
    if(short[i]===long[j]){i++;j++;continue;}
    if(++skips>1)return false;j++;
  }
  return true;
}
function fuzzySuggestionFor(word){
  const key=stripMarks(word);
  if(key.length<4)return '';
  for(const candidate of COMMON_WORDS){
    const c=stripMarks(candidate);
    if(key===c)return '';
    if(!oneEditAway(key,c))continue;
    const prefix=commonPrefix(key,c);
    const firstLetterTypo=key.length===c.length&&key.slice(1)===c.slice(1);
    const missingInitialH=c[0]==='h'&&key===c.slice(1);
    const extraInitialH=key[0]==='h'&&c===key.slice(1);
    const phoneticFirst=(key[0]==='z'&&c[0]==='s'&&key.slice(1)===c.slice(1))||
      (key[0]==='s'&&c[0]==='z'&&key.slice(1)===c.slice(1));
    // Normalmente exigimos raíz coincidente para evitar falsos positivos, pero
    // aceptamos errores muy típicos al inicio: h omitida/agregada y s/z.
    if(prefix>=Math.min(3,Math.max(2,key.length-2))||firstLetterTypo||missingInitialH||extraInitialH||phoneticFirst)return candidate;
  }
  return '';
}
function preserveCase(word,s){
  if(!s)return '';
  if(word&&word===word.toUpperCase()&&word.length>1)return s.toUpperCase();
  if(word&&word[0]===word[0]?.toUpperCase())return s.charAt(0).toUpperCase()+s.slice(1);
  return s;
}
function suggestionFor(word){
  const key=normalizeWord(word);
  const direct=SUGGESTIONS.get(key);
  const s=(direct&&direct!==key)?direct:fuzzySuggestionFor(word);
  return preserveCase(word,s);
}

function looksLikeTechnicalToken(word){
  const raw=String(word||'');
  const key=normalizeWord(raw);
  if(!raw||raw.length<2)return true;
  if(ALLOWED_TERMS.has(key))return true;
  if(/^[A-ZÁÉÍÓÚÜÑ]{2,6}$/.test(raw))return true;
  if(/\d/.test(raw))return true;
  return false;
}
function insideAddressOrUrl(text,index){
  const re=/(?:https?:\/\/|www\.)\S+|\b\S+@\S+\b/gi;let m;
  while((m=re.exec(text||''))){
    if(index>=m.index&&index<m.index+m[0].length)return true;
  }
  return false;
}
function wordIssue(word,text,index,engine){
  const direct=suggestionFor(word);
  if(direct)return{bad:true,suggestion:direct,source:'fallback'};
  if(looksLikeTechnicalToken(word)||insideAddressOrUrl(text,index))return{bad:false,suggestion:'',source:'skip'};
  const dict=engine===undefined?fullDictionary:engine;
  if(dict&&typeof dict.check==='function'){
    try{
      if(dict.check(word)||dict.check(normalizeWord(word)))return{bad:false,suggestion:'',source:'dictionary'};
      return{bad:true,suggestion:'',source:'dictionary'};
    }catch(_){}
  }
  return{bad:false,suggestion:'',source:'pending'};
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
  let changed=false;
  root?.querySelectorAll?.('.'+ERROR_CLASS).forEach(span=>{
    changed=true;
    span.replaceWith(target.document.createTextNode(span.textContent||''));
  });
  if(changed)try{root?.normalize?.();}catch(_){}
  return changed;
}
function shouldSkip(node,root){
  const p=node.parentElement;if(!p||!root.contains(p))return true;
  return !!p.closest('.mail-signature-block,a,code,pre,script,style,[contenteditable="false"]');
}

function lintBody(){
  const root=target?.document?.getElementById('mailCmpBody');if(!root||mutating)return 0;
  mutating=true;
  const saved=saveSelection(root);
  let domChanged=false;
  try{
    domChanged=unwrapErrors(root)||domChanged;
    const walker=target.document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes=[];let n;while((n=walker.nextNode()))if(!shouldSkip(n,root))nodes.push(n);
    let count=0;
    const re=/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g;
    nodes.forEach(node=>{
      const text=node.nodeValue||'';let last=0,m,changed=false;
      const frag=target.document.createDocumentFragment();
      while((m=re.exec(text))){
        const issue=wordIssue(m[0],text,m.index);if(!issue.bad)continue;
        changed=true;
        if(m.index>last)frag.appendChild(target.document.createTextNode(text.slice(last,m.index)));
        const span=target.document.createElement('span');
        span.className=ERROR_CLASS;span.dataset.suggestion=issue.suggestion||'';span.dataset.word=m[0];
        span.title=issue.suggestion?'Sugerencia: '+issue.suggestion+' · clic para corregir':'Posible falta ortográfica';
        span.textContent=m[0];frag.appendChild(span);last=m.index+m[0].length;count++;
      }
      if(changed){
        if(last<text.length)frag.appendChild(target.document.createTextNode(text.slice(last)));
        node.replaceWith(frag);
        domChanged=true;
      }
    });
  }finally{
    // No tocar la selección si el DOM quedó idéntico. En un contenteditable,
    // un Enter deja el cursor en un bloque vacío que comparte el mismo offset
    // de texto que el final de la línea anterior; restaurarlo por offset lo
    // devolvía a esa línea y hacía parecer que Enter no funcionaba.
    if(domChanged)restoreSelection(root,saved);
    mutating=false;
  }
  return root.querySelectorAll('.'+ERROR_CLASS).length;
}

function lintSubject(){
  const el=target?.document?.getElementById('mailCmpSubject');if(!el)return 0;
  const text=el.value||'',re=/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g,bad=[];let m;
  while((m=re.exec(text))){
    const issue=wordIssue(m[0],text,m.index);
    if(issue.bad)bad.push({word:m[0],suggestion:issue.suggestion});
  }
  el.classList.toggle('mail-local-spell-subject-error',bad.length>0);
  el.title=bad.length?bad.map(x=>x.suggestion?(x.word+' → '+x.suggestion):x.word).join(' · '):'';
  return bad.length;
}
function lintNow(){return lintBody()+lintSubject();}
function isLineBreakInput(e){
  const t=String(e?.inputType||'');
  return t==='insertParagraph'||t==='insertLineBreak';
}
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
      const el=e.target;if(el&&IDS.includes(el.id)){apply(el);loadFullDictionary();}
    });
    root.document.addEventListener('input',e=>{
      if(e.target?.id==='mailCmpBody'){
        // Enter/Shift+Enter deben quedar 100% nativos. Además cancelamos un
        // lint pendiente de la última tecla: si corre después del salto, el
        // restaurador de selección puede devolver el caret a la línea anterior.
        if(isLineBreakInput(e)){clearTimeout(timer);return;}
        scheduleLint();return;
      }
      if(e.target?.id==='mailCmpSubject')scheduleLint();
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
    const warm=()=>loadFullDictionary();
    if(typeof root.requestIdleCallback==='function')root.requestIdleCallback(warm,{timeout:2500});else target.setTimeout?.(warm,1200);
  };
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  return true;
}

function status(){
  const body=target?.document?.getElementById('mailCmpBody');
  return{installed,wired,observing:!!observer,dictionary:dictionaryState,errors:body?.querySelectorAll?.('.'+ERROR_CLASS)?.length||0};
}
return{install,status,_test:{IDS,SUGGESTIONS,COMMON_WORDS,ALLOWED_TERMS,suggestionFor,normalizeWord,stripMarks,oneEditAway,fuzzySuggestionFor,looksLikeTechnicalToken,insideAddressOrUrl,wordIssue,isLineBreakInput}};
});
