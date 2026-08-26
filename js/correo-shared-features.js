/* js/correo-shared-features.js
 * Extensiones de Correos:
 * - CC/CCO con autocompletado multi-destinatario por token.
 * - Plantillas compartidas entre todos los usuarios vía Monitor Sistema.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root){root.CorreoSharedFeatures=api;api.install(root);}
})(typeof window!=='undefined'?window:null,function(){
'use strict';

const SHARED_TEMPLATE_KEY='thelab_mail_tpl_shared_v1';
const REMOTE_TEMPLATE_NAME='MAIL_TEMPLATES';
const REMOTE_TEMPLATE_ID_KEY='mailTemplatesRecordId';
const RECIPIENT_FIELDS=['mailCmpCc','mailCmpBcc'];
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let target=null,installed=false,mailPatched=false,recipientUiInstalled=false;
let templatesHydrated=false,remoteRecordFound=false,lastRemoteRead=0;
let pendingBeforeHydration=null,writeTimer=null,writeChain=Promise.resolve(),hydratePromise=null;

function cleanText(v){return String(v??'').trim();}
function dedupeStrings(values){
  const seen=new Set(),out=[];
  for(const value of values||[]){
    const v=cleanText(value);if(!v)continue;
    const key=v.toLowerCase();if(seen.has(key))continue;
    seen.add(key);out.push(v);
  }
  return out;
}
function splitRecipients(value){
  return dedupeStrings(String(value||'').split(/[,;\n\r]+/).map(v=>v.trim()).filter(Boolean));
}
function normalizeRecipientValue(value){return splitRecipients(value).join(', ');}
function validRecipients(value){return splitRecipients(value).filter(v=>EMAIL_RE.test(v));}
function mergeRecipient(value,email){
  const raw=String(value||'').replace(/[;\n\r]+/g,',');
  const cut=raw.lastIndexOf(',');
  const complete=cut>=0?splitRecipients(raw.slice(0,cut)):[];
  const selected=cleanText(email);
  return dedupeStrings([...complete,selected]).join(', ')+(selected?', ':'');
}
function activeRecipientToken(value){
  const raw=String(value||'').replace(/[;\n\r]+/g,',');
  const cut=raw.lastIndexOf(',');
  return cleanText(cut>=0?raw.slice(cut+1):raw);
}

function normalizeTemplate(t,index=0){
  if(!t||typeof t!=='object')return null;
  const subject=String(t.subject||'');
  const body=String(t.body||'');
  const name=cleanText(t.name||t.title||subject||`Plantilla ${index+1}`);
  if(!name&&!subject&&!body)return null;
  return{name:name||`Plantilla ${index+1}`,subject,body};
}
function normalizeTemplates(list){
  const out=[],fingerprints=new Set();
  (Array.isArray(list)?list:[]).forEach((item,index)=>{
    const t=normalizeTemplate(item,index);if(!t)return;
    const fp=[t.name,t.subject,t.body].join('\u0000').toLowerCase();
    if(fingerprints.has(fp))return;
    fingerprints.add(fp);out.push(t);
  });
  return out;
}
function mergeTemplates(primary,secondary){return normalizeTemplates([...(primary||[]),...(secondary||[])]);}
function templatePayload(list){return{version:1,updatedAt:Date.now(),templates:normalizeTemplates(list)};}
function parseTemplatePayload(raw){
  try{
    const value=typeof raw==='string'?JSON.parse(raw||'null'):raw;
    if(Array.isArray(value))return normalizeTemplates(value);
    return normalizeTemplates(value?.templates);
  }catch(_){return[];}
}
function templatesEqual(a,b){return JSON.stringify(normalizeTemplates(a))===JSON.stringify(normalizeTemplates(b));}
function readSharedCache(){
  try{return normalizeTemplates(JSON.parse(target?.localStorage?.getItem(SHARED_TEMPLATE_KEY)||'[]'));}catch(_){return[];}
}
function writeSharedCache(list){
  const clean=normalizeTemplates(list);
  try{target?.localStorage?.setItem(SHARED_TEMPLATE_KEY,JSON.stringify(clean));}catch(_){}
  return clean;
}
function readLegacyCache(key){
  try{return key?normalizeTemplates(JSON.parse(target?.localStorage?.getItem(key)||'[]')):[];}catch(_){return[];}
}
function getAirtableFetch(){
  try{if(typeof airtableFetch==='function')return airtableFetch;}catch(_){}
  return typeof target?.airtableFetch==='function'?target.airtableFetch:null;
}
function getMonitorUpsert(){
  try{if(typeof _monitorUpsert==='function')return _monitorUpsert;}catch(_){}
  return typeof target?._monitorUpsert==='function'?target._monitorUpsert:null;
}
function setRemoteRecordId(recordId){
  if(!recordId)return;
  try{if(typeof state!=='undefined'&&state&&typeof state==='object')state[REMOTE_TEMPLATE_ID_KEY]=recordId;}catch(_){}
  try{if(target?.state&&typeof target.state==='object')target.state[REMOTE_TEMPLATE_ID_KEY]=recordId;}catch(_){}
}
async function writeRemoteTemplates(list){
  const upsert=getMonitorUpsert();
  if(!target||target._DEMO_MODE||typeof upsert!=='function')return false;
  const clean=normalizeTemplates(list);
  await upsert(REMOTE_TEMPLATE_NAME,JSON.stringify(templatePayload(clean)),REMOTE_TEMPLATE_ID_KEY);
  return true;
}
function queueRemoteWrite(list){
  const snapshot=normalizeTemplates(list);
  clearTimeout(writeTimer);
  writeTimer=setTimeout(()=>{
    writeChain=writeChain.then(()=>writeRemoteTemplates(snapshot)).catch(e=>console.warn('[Correo] respaldo de plantillas compartidas pendiente',e));
  },350);
}
function applyRemoteTemplates(list){
  const clean=writeSharedCache(list);
  const menu=target?.document?.getElementById('mailTplMenu');
  if(menu&&menu.style.display!=='none')menu.style.display='none';
  return clean;
}
async function fetchRemoteTemplateRecord(){
  const fetcher=getAirtableFetch();
  if(!target||target._DEMO_MODE||typeof fetcher!=='function')return{record:null,templates:[]};
  const res=await fetcher('Monitor Sistema',200);
  const record=(res?.records||[]).find(r=>r?.fields?.Name===REMOTE_TEMPLATE_NAME)||null;
  if(record)setRemoteRecordId(record.id);
  return{record,templates:record?parseTemplatePayload(record.fields?.Notes||''):[]};
}
async function hydrateSharedTemplates(){
  if(hydratePromise)return hydratePromise;
  hydratePromise=(async()=>{
    const sharedCache=readSharedCache();
    let record=null,remote=[];
    try{
      const fetched=await fetchRemoteTemplateRecord();record=fetched.record;remote=fetched.templates;
    }catch(e){console.warn('[Correo] no se pudieron cargar plantillas compartidas',e);}
    remoteRecordFound=!!record;lastRemoteRead=Date.now();

    let next=record?remote:sharedCache;
    if(pendingBeforeHydration){
      next=pendingBeforeHydration.authoritative
        ?pendingBeforeHydration.list
        :mergeTemplates(next,pendingBeforeHydration.list);
    }
    next=applyRemoteTemplates(next);
    templatesHydrated=true;

    if(pendingBeforeHydration){
      try{await writeRemoteTemplates(next);remoteRecordFound=true;}catch(e){console.warn('[Correo] no se pudieron publicar plantillas compartidas',e);}
    }else if(!record&&sharedCache.length){
      try{await writeRemoteTemplates(next);remoteRecordFound=true;}catch(e){console.warn('[Correo] no se pudieron publicar plantillas compartidas',e);}
    }
    pendingBeforeHydration=null;
    return next;
  })().finally(()=>{hydratePromise=null;});
  return hydratePromise;
}
async function refreshSharedTemplates(force=false){
  if(!templatesHydrated)return hydrateSharedTemplates();
  if(!force&&Date.now()-lastRemoteRead<15000)return readSharedCache();
  try{
    const fetched=await fetchRemoteTemplateRecord();lastRemoteRead=Date.now();
    if(!fetched.record)return readSharedCache();
    remoteRecordFound=true;
    return applyRemoteTemplates(fetched.templates);
  }catch(e){console.warn('[Correo] no se pudieron refrescar plantillas compartidas',e);return readSharedCache();}
}
function startLegacyMigration(originalTplKey){
  let attempts=0;
  const run=async()=>{
    attempts++;
    let legacyKey=null;
    try{legacyKey=originalTplKey?originalTplKey():null;}catch(_){}
    if(!legacyKey){if(attempts<120)target.setTimeout?.(run,500);return;}
    const migrationKey=`thelab_mail_tpl_shared_migrated_v1:${legacyKey}`;
    try{if(target.localStorage?.getItem(migrationKey)==='1')return;}catch(_){}
    await hydrateSharedTemplates();
    const legacy=readLegacyCache(legacyKey);
    // Solo la primera instalación sin registro global importa las plantillas
    // locales existentes. Si ya hay un registro compartido, no reintroducimos
    // copias antiguas que otro usuario pudo haber borrado globalmente.
    if(!remoteRecordFound&&legacy.length){
      const merged=mergeTemplates(readSharedCache(),legacy);applyRemoteTemplates(merged);
      try{
        if(await writeRemoteTemplates(merged)){remoteRecordFound=true;target.localStorage?.setItem(migrationKey,'1');}
      }catch(e){console.warn('[Correo] migración de plantillas locales pendiente',e);}
      return;
    }
    try{target.localStorage?.setItem(migrationKey,'1');}catch(_){}
  };
  target.setTimeout?.(run,250);
}

function patchMail(mail){
  if(mailPatched||!mail)return false;
  mailPatched=true;

  const originalValid=typeof mail._validEmails==='function'?mail._validEmails.bind(mail):null;
  mail._validEmails=function(value){
    const normalized=String(value||'').replace(/[;\n\r]+/g,',');
    if(originalValid)return originalValid(normalized);
    const all=splitRecipients(normalized);return all.length>0&&all.every(v=>EMAIL_RE.test(v));
  };

  const originalSend=typeof mail.sendCompose==='function'?mail.sendCompose.bind(mail):null;
  if(originalSend){
    mail.sendCompose=async function(){
      ['mailCmpTo','mailCmpCc','mailCmpBcc'].forEach(id=>{
        const el=target?.document?.getElementById(id);if(el)el.value=normalizeRecipientValue(el.value);
      });
      return originalSend();
    };
  }

  const originalTplKey=typeof mail._tplKey==='function'?mail._tplKey.bind(mail):null;
  mail._tplKey=()=>SHARED_TEMPLATE_KEY;
  mail.getTpls=()=>readSharedCache();
  mail.setTpls=function(list){
    const previous=readSharedCache();
    const clean=writeSharedCache(list);
    if(!templatesHydrated){
      const removed=previous.some(old=>!clean.some(t=>templatesEqual([old],[t])));
      pendingBeforeHydration={list:clean,authoritative:removed||clean.length===0};
      hydrateSharedTemplates();
    }else queueRemoteWrite(clean);
  };

  hydrateSharedTemplates();
  startLegacyMigration(originalTplKey);
  target.addEventListener?.('focus',()=>refreshSharedTemplates(true));
  return true;
}

function contactOptions(){
  if(!target?.document)return[];
  const list=target.document.getElementById('mailContactsList');
  if(!list)return[];
  const out=[];
  for(const option of Array.from(list.querySelectorAll('option'))){
    const email=cleanText(option.value);if(!EMAIL_RE.test(email))continue;
    out.push({email,label:cleanText(option.label||option.textContent||'')});
  }
  const seen=new Set();
  return out.filter(item=>{const k=item.email.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;});
}
function addRecipientStyles(){
  if(!target?.document||target.document.getElementById('mailMultiRecipientStyles'))return;
  const style=target.document.createElement('style');style.id='mailMultiRecipientStyles';
  style.textContent=`
.mail-multi-suggestions{position:fixed;z-index:10050;max-height:240px;overflow:auto;background:#fff;border:1px solid rgba(15,23,42,.15);border-radius:10px;box-shadow:0 12px 32px rgba(15,23,42,.18);padding:5px;min-width:260px}
.mail-multi-suggestions[hidden]{display:none!important}
.mail-multi-option{display:block;width:100%;border:0;background:transparent;text-align:left;padding:8px 10px;border-radius:7px;cursor:pointer;color:#0f172a;font:inherit}
.mail-multi-option:hover,.mail-multi-option.is-active{background:#f1f5f9}
.mail-multi-option strong{display:block;font-size:13px;font-weight:600}
.mail-multi-option span{display:block;font-size:11px;color:#64748b;margin-top:2px}
`;
  target.document.head?.appendChild(style);
}
function positionPopup(input,popup){
  const r=input.getBoundingClientRect();
  popup.style.left=`${Math.max(8,r.left)}px`;
  popup.style.top=`${Math.min((target.innerHeight||800)-80,r.bottom+4)}px`;
  popup.style.width=`${Math.max(260,r.width)}px`;
}
function setupRecipientField(input){
  if(!input||input.dataset.multiRecipientReady==='1')return;
  input.dataset.multiRecipientReady='1';
  input.dataset.originalList=input.getAttribute('list')||'mailContactsList';
  input.removeAttribute('list');
  input.setAttribute('autocomplete','off');
  input.title='Puedes agregar varios destinatarios. Selecciona un contacto y continúa escribiendo.';

  const popup=target.document.createElement('div');
  popup.className='mail-multi-suggestions';popup.hidden=true;popup.setAttribute('role','listbox');
  target.document.body.appendChild(popup);
  let matches=[],active=-1,blurTimer=null;

  const hide=()=>{popup.hidden=true;popup.replaceChildren();matches=[];active=-1;};
  const choose=index=>{
    const item=matches[index];if(!item)return;
    input.value=mergeRecipient(input.value,item.email);
    input.dispatchEvent(new target.Event('input',{bubbles:true}));
    input.focus();render();
  };
  const render=()=>{
    const token=activeRecipientToken(input.value).toLowerCase();
    const used=new Set(splitRecipients(String(input.value||'').replace(/[^,;\n\r]*$/,'')).map(v=>v.toLowerCase()));
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
}
function installRecipientUi(){
  if(recipientUiInstalled||!target?.document)return false;
  const fields=RECIPIENT_FIELDS.map(id=>target.document.getElementById(id)).filter(Boolean);
  if(fields.length!==RECIPIENT_FIELDS.length)return false;
  recipientUiInstalled=true;addRecipientStyles();fields.forEach(setupRecipientField);return true;
}
function tryInstallFeatures(){
  if(!target)return false;
  const mail=target.MAIL;
  if(mail&&!mailPatched)patchMail(mail);
  if(target.document&&!recipientUiInstalled)installRecipientUi();
  return mailPatched&&recipientUiInstalled;
}
function install(root){
  if(installed||!root)return false;target=root;installed=true;
  const run=()=>tryInstallFeatures();run();
  let attempts=0;
  const timer=root.setInterval?.(()=>{attempts++;if(run()||attempts>150)root.clearInterval?.(timer);},100);
  root.document?.addEventListener?.('DOMContentLoaded',run,{once:true});
  return true;
}
function status(){return{installed,mailPatched,recipientUiInstalled,templatesHydrated,remoteRecordFound,remoteName:REMOTE_TEMPLATE_NAME,lastRemoteRead};}

return{install,status,_test:{splitRecipients,normalizeRecipientValue,validRecipients,mergeRecipient,activeRecipientToken,normalizeTemplates,mergeTemplates,parseTemplatePayload,templatesEqual,SHARED_TEMPLATE_KEY,REMOTE_TEMPLATE_NAME}};
});
