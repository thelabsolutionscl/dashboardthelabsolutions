/* js/machineops-storage-adapter.js
 * Persistencia normalizada de MachineOps mediante /shared/machineops.
 *
 * El navegador ya no lee ni escribe la tabla completa "Monitor Sistema".
 * El proxy entrega únicamente registros MachineOps allowlisted y conserva
 * MACHINE_OPS_V2 como fallback de migración; las escrituras V3 son por dominio.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root){root.MachineOpsStorage=api;api.installWhenReady(root);}
})(typeof window!=='undefined'?window:null,function(){
'use strict';

const LEGACY_NAME='MACHINE_OPS_V2';
const PREFIX='MACHINE_OPS_V3:';
const SCHEMA=3;
const DOMAINS=[
  'jobs','spools','qa','workflows','profiles','safetyReadings','incidents','audit',
  'alertAcks','ignoredPrints','bedClearAcks','automation','costConfig','safetyConfig','maintenanceProfiles'
];
const META_DOMAIN='meta';
const hashes=new Map();
const committedSnapshots=new Map();
const CONFIG_DOMAINS=new Set(['automation','costConfig','safetyConfig','maintenanceProfiles']);
let installed=false,lastReadAt=0,lastWriteAt=0,lastMode='legacy',runtimeTarget=null;
const remoteRevisions=new Map();

function stable(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return'['+value.map(stable).join(',')+']';
  return'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
}
function hashText(value){
  let h=2166136261;for(const c of String(value||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');
}
function domainHash(value){return hashText(stable(value));}
function recordName(domain){return PREFIX+domain;}
function parseNotes(rec){
  try{return JSON.parse(rec?.fields?.Notes||'{}');}catch(_){return null;}
}
function parseLegacy(records){
  const rec=(records||[]).find(r=>r?.fields?.Name===LEGACY_NAME);
  if(!rec)return{};
  try{return JSON.parse(rec.fields?.Notes||'{}')||{};}catch(_){return{};}
}
function bestMetaRecord(records){
  return (records||[]).filter(r=>r?.fields?.Name===recordName(META_DOMAIN))
    .map(rec=>({rec,payload:parseNotes(rec)}))
    .filter(x=>x.payload&&x.payload.schema===SCHEMA)
    .sort((a,b)=>Number(b.payload?.writtenAt||0)-Number(a.payload?.writtenAt||0))[0]||null;
}
function bestDomainSnapshot(records,domain,maxWrittenAt=Infinity){
  const candidates=[];
  for(const rec of (records||[]).filter(r=>r?.fields?.Name===recordName(domain))){
    const payload=parseNotes(rec);if(!payload||payload.schema!==SCHEMA)continue;
    const currentAt=Number(payload.writtenAt||0);
    if(currentAt<=maxWrittenAt)candidates.push({writtenAt:currentAt,data:payload.data});
    const prev=payload.previous;
    const prevAt=Number(prev?.writtenAt||0);
    if(prev&&prevAt<=maxWrittenAt)candidates.push({writtenAt:prevAt,data:prev.data});
  }
  return candidates.sort((a,b)=>b.writtenAt-a.writtenAt)[0]||null;
}
function recoverableDomainSnapshot(records,domain,commitAt){
  const candidates=[];
  for(const rec of (records||[]).filter(r=>r?.fields?.Name===recordName(domain))){
    const payload=parseNotes(rec);if(!payload||payload.schema!==SCHEMA)continue;
    const currentAt=Number(payload.writtenAt||0),prevAt=Number(payload.previous?.writtenAt||0);
    // Si el fragmento actual quedó escrito DESPUÉS del último meta, pero lleva
    // como previous una versión que sí estaba confirmada por ese meta, estamos
    // ante una escritura huérfana: el dominio llegó a Airtable y falló solo el
    // commit final. Mantenerlo oculto para siempre deja dos computadores con
    // estados distintos. Los dominios son independientes, por lo que es seguro
    // recuperar esa versión actual y dejar que el siguiente push repare meta.
    if(currentAt>commitAt&&prevAt>0&&prevAt<=commitAt){
      candidates.push({writtenAt:currentAt,data:payload.data,recovered:true,previousWrittenAt:prevAt});
    }
  }
  return candidates.sort((a,b)=>b.writtenAt-a.writtenAt)[0]||null;
}
function composePayload(records){
  const base={...parseLegacy(records)};
  const meta=bestMetaRecord(records);
  if(!meta){
    lastMode='legacy';lastReadAt=Date.now();
    return{data:base,normalized:0,recoveredDomains:[]};
  }
  const commitAt=Number(meta.payload.writtenAt||0);
  let normalized=1,newestAt=commitAt;
  const recoveredDomains=[];
  for(const domain of DOMAINS){
    const committed=bestDomainSnapshot(records,domain,commitAt);
    const recovered=recoverableDomainSnapshot(records,domain,commitAt);
    const hit=recovered||committed;if(!hit)continue;
    base[domain]=hit.data;
    hashes.set(domain,domainHash(hit.data));
    committedSnapshots.set(domain,{writtenAt:hit.writtenAt,data:hit.data});
    newestAt=Math.max(newestAt,Number(hit.writtenAt||0));
    if(hit.recovered)recoveredDomains.push(domain);
    normalized++;
  }
  base.version=Number(meta.payload.version||base.version||4);
  // Si recuperamos un fragmento huérfano, su writtenAt es evidencia de una
  // actualización remota más nueva que el meta. Esto permite que MachineOps
  // la trate como estado compartido real y, en el siguiente push, sanee meta.
  base.updatedAt=Math.max(Number(base.updatedAt||0),Number(meta.payload.updatedAt||0),newestAt);
  hashes.set(META_DOMAIN,domainHash({version:base.version,updatedAt:Number(meta.payload.updatedAt||0)}));
  lastMode=recoveredDomains.length?'recovered':'normalized';lastReadAt=Date.now();
  return{data:base,normalized,recoveredDomains};
}
const NOTES_SAFE_LIMIT=90000;
function splitPayload(raw){
  const data=raw&&typeof raw==='object'?raw:{};
  const writtenAt=Date.now();
  const fragments=DOMAINS.map(domain=>{
    const value=Object.prototype.hasOwnProperty.call(data,domain)?data[domain]:null;
    const previous=committedSnapshots.get(domain)||null;
    const envelope={schema:SCHEMA,domain,writtenAt,data:value};
    let notes=JSON.stringify(envelope);
    // Airtable acepta texto largo, pero un snapshot actual + previous puede
    // superar el límite práctico del campo Notes. En ese caso priorizamos el
    // snapshot actual para que la sincronización completa no quede bloqueada.
    // previous es una ayuda de recuperación, no el dato autoritativo.
    if(previous){
      const withPrevious={...envelope,previous:{writtenAt:previous.writtenAt,data:previous.data}};
      const candidate=JSON.stringify(withPrevious);
      if(candidate.length<=NOTES_SAFE_LIMIT)notes=candidate;
    }
    if(notes.length>NOTES_SAFE_LIMIT){
      throw new Error(`MachineOps domain "${domain}" excede el límite seguro de Notes (${notes.length} caracteres)`);
    }
    return{domain,name:recordName(domain),hash:domainHash(value),writtenAt,data:value,notes};
  });
  const meta={
    domain:META_DOMAIN,name:recordName(META_DOMAIN),writtenAt,
    hash:domainHash({version:data.version||4,updatedAt:data.updatedAt||0}),
    notes:JSON.stringify({schema:SCHEMA,domain:META_DOMAIN,writtenAt,version:data.version||4,updatedAt:Number(data.updatedAt||0),domains:DOMAINS})
  };
  return{fragments,meta};
}
function syntheticRecord(records,payload){
  const legacy=(records||[]).find(r=>r?.fields?.Name===LEGACY_NAME);
  return{
    id:legacy?.id||'machineops-v3-synthetic',
    fields:{...(legacy?.fields||{}),Name:LEGACY_NAME,Notes:JSON.stringify(payload)}
  };
}
function proxyConfig(){
  const target=runtimeTarget;
  if(!target)return null;
  try{
    let px=null;
    try{if(typeof target._proxyCfg==='function')px=target._proxyCfg();}catch(_){}
    if(!px?.url||!px?.key)return null;
    const url=new URL(px.url);
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||
       url.search||url.hash)return null;
    if(url.protocol==='http:'&&!['localhost','127.0.0.1'].includes(url.hostname))return null;
    return{base:url.origin+url.pathname.replace(/\/$/,''),key:px.key};
  }catch(_){return null;}
}
async function sharedRequest(method,record='',body=null){
  const cfg=proxyConfig();if(!cfg)throw new Error('Proxy compartido no configurado');
  const query=record?'?record='+encodeURIComponent(record):'';
  const response=await runtimeTarget.fetch(cfg.base+'/shared/machineops'+query,{
    method,credentials:'include',redirect:'error',
    headers:{'X-App-Key':cfg.key,...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  return response;
}
function acceptRevisions(doc){
  if(!doc||doc.ok!==true||!doc.revisions||typeof doc.revisions!=='object')return false;
  for(const [name,revision] of Object.entries(doc.revisions)){
    if(typeof name==='string'&&typeof revision==='string'&&/^[a-f0-9]{64}$/.test(revision))
      remoteRevisions.set(name,revision);
  }
  return true;
}
function remoteRecords(doc){
  if(!acceptRevisions(doc)||!Array.isArray(doc.records))throw new Error('Respuesta MachineOps inválida');
  return doc.records.map(row=>{
    if(!row||typeof row.name!=='string'||typeof row.notes!=='string'||
       typeof row.revision!=='string'||!/^[a-f0-9]{64}$/.test(row.revision))
      throw new Error('Registro MachineOps inválido');
    remoteRevisions.set(row.name,row.revision);
    return{fields:{Name:row.name,Notes:row.notes}};
  });
}
async function readSnapshot(){
  if(!runtimeTarget||runtimeTarget._DEMO_MODE)return null;
  const response=await sharedRequest('GET');
  if(!response.ok)throw new Error('No se pudo leer MachineOps compartido');
  const doc=await response.json(),records=remoteRecords(doc);
  const composed=composePayload(records);
  lastReadAt=Date.now();
  return composed.data;
}
async function writeSnapshot(raw){
  if(!runtimeTarget||runtimeTarget._DEMO_MODE)return true;
  if(!remoteRevisions.size)await readSnapshot();
  const {fragments,meta}=splitPayload(raw);
  const role=runtimeTarget.AUTH?.getUser?.()?.role||'';
  const canConfig=runtimeTarget.RBAC?.canConfigRole?.(role)===true;
  const changed=fragments.filter(f=>hashes.get(f.domain)!==f.hash);
  const writes=[];
  for(const f of changed){
    if(CONFIG_DOMAINS.has(f.domain)&&!canConfig)continue;
    const expectedRevision=remoteRevisions.get(f.name);
    if(typeof expectedRevision!=='string')throw new Error('Falta revisión remota de '+f.domain);
    writes.push({domain:f.domain,data:f.data,expectedRevision});
  }
  if(!writes.length)return true;
  const response=await sharedRequest('PUT','',{
    writes,meta:{version:Number(raw?.version||4),updatedAt:Number(raw?.updatedAt||0)}
  });
  let doc={};try{doc=await response.json();}catch(_){}
  if(response.status===409&&doc?.code==='MACHINEOPS_REVISION_CONFLICT'){
    acceptRevisions(doc);
    const err=new Error('MachineOps cambió en otro equipo; se releerá antes de reintentar');
    err.code='MACHINEOPS_REVISION_CONFLICT';throw err;
  }
  if(!response.ok)throw new Error(doc?.error||'No se pudo guardar MachineOps compartido');
  remoteRecords(doc);
  const byName=new Map((doc.records||[]).map(row=>[row.name,row]));
  for(const f of changed){
    if(!writes.some(w=>w.domain===f.domain))continue;
    hashes.set(f.domain,f.hash);
    const row=byName.get(f.name);
    let writtenAt=Date.now();
    try{writtenAt=Number(JSON.parse(row?.notes||'{}').writtenAt)||writtenAt;}catch(_){}
    committedSnapshots.set(f.domain,{writtenAt,data:f.data});
  }
  hashes.set(META_DOMAIN,meta.hash);
  lastWriteAt=Date.now();lastMode='normalized';
  return true;
}
async function readRecord(name){
  if(name!=='BED_LEVEL_HISTORY_V2')throw new Error('Registro compartido no permitido');
  if(!runtimeTarget||runtimeTarget._DEMO_MODE)return{data:[],revision:'',exists:false};
  const response=await sharedRequest('GET',name);
  if(!response.ok)throw new Error('No se pudo leer '+name);
  const doc=await response.json(),records=remoteRecords(doc),row=records[0]||null;
  let data=[];if(row){try{data=JSON.parse(row.fields.Notes||'[]');}catch(_){}}
  lastReadAt=Date.now();
  return{data:Array.isArray(data)?data:[],revision:remoteRevisions.get(name)||'',exists:!!row};
}
async function writeRecord(name,data){
  if(name!=='BED_LEVEL_HISTORY_V2')throw new Error('Registro compartido no permitido');
  if(!runtimeTarget||runtimeTarget._DEMO_MODE)return true;
  if(!remoteRevisions.has(name))await readRecord(name);
  const expectedRevision=remoteRevisions.get(name);
  if(typeof expectedRevision!=='string')throw new Error('Falta revisión remota de '+name);
  const response=await sharedRequest('PUT',name,{data,expectedRevision});
  let doc={};try{doc=await response.json();}catch(_){}
  if(response.status===409&&doc?.code==='MACHINEOPS_REVISION_CONFLICT'){
    acceptRevisions(doc);
    return false;
  }
  if(!response.ok)throw new Error(doc?.error||'No se pudo guardar '+name);
  remoteRecords(doc);lastWriteAt=Date.now();return true;
}
function install(target){
  if(installed||!target)return false;
  runtimeTarget=target;installed=true;return true;
}
function installWhenReady(target,attempts=40){
  if(install(target)||installed)return true;
  if(attempts<=0)return false;
  setTimeout(()=>installWhenReady(target,attempts-1),250);
  return false;
}
function status(){return{installed,mode:lastMode,schema:SCHEMA,lastReadAt,lastWriteAt,knownDomains:[...hashes.keys()],knownRevisions:remoteRevisions.size};}

return{install,installWhenReady,status,readSnapshot,writeSnapshot,readRecord,writeRecord,
  _test:{stable,hashText,domainHash,recordName,splitPayload,composePayload,bestDomainSnapshot,recoverableDomainSnapshot,LEGACY_NAME,PREFIX,SCHEMA,DOMAINS,CONFIG_DOMAINS,NOTES_SAFE_LIMIT}};
});

// PrinterHistory se puede cargar de forma independiente: si este módulo falla,
// la seguridad desatendida NO debe quedar bloqueada por su loader.
(function _loadPrinterHistory(){
  if(typeof window==='undefined'||typeof document==='undefined'||window.__TLS_PRINTER_HISTORY_LOADER__)return;
  window.__TLS_PRINTER_HISTORY_LOADER__=true;
  const current=document.currentScript,raw=current?.src||'',suffix=raw.includes('?')?'?'+raw.split('?').slice(1).join('?'):'';
  const path='js/printer-history-adapter.js';
  if(Array.from(document.scripts||[]).some(s=>String(s.src||'').includes('/'+path)))return;
  if(typeof document.createElement!=='function'||!document.head)return;
  const s=document.createElement('script');s.src=path+suffix;s.async=false;
  s.onerror=()=>console.warn('[Máquinas] no se pudo cargar historial durable');
  document.head.appendChild(s);
})();

// FarmHealth es independiente de historial y seguridad. Una falla de
// observabilidad no puede impedir que carguen las protecciones operacionales.
(function _loadFarmHealth(){
  if(typeof window==='undefined'||typeof document==='undefined'||window.__TLS_FARM_HEALTH_LOADER__)return;
  window.__TLS_FARM_HEALTH_LOADER__=true;
  const current=document.currentScript,raw=current?.src||'',suffix=raw.includes('?')?'?'+raw.split('?').slice(1).join('?'):'';
  const path='js/farm-health-adapter.js';
  if(Array.from(document.scripts||[]).some(s=>String(s.src||'').includes('/'+path)))return;
  if(typeof document.createElement!=='function'||!document.head)return;
  const s=document.createElement('script');s.src=path+suffix;s.async=false;
  s.onerror=()=>console.warn('[Máquinas] no se pudo cargar observabilidad central');
  document.head.appendChild(s);
})();

// MachineOpsUnattendedSafety necesita ejecutarse después de que este adaptador
// esté disponible, pero puede cargarse antes de maquinas-operaciones.js porque
// espera a window.MachineOps antes de instalar sus wrappers.
(function _loadUnattendedSafety(){
  if(typeof window==='undefined'||typeof document==='undefined'||window.__TLS_UNATTENDED_SAFETY_LOADER__)return;
  window.__TLS_UNATTENDED_SAFETY_LOADER__=true;
  const current=document.currentScript,raw=current?.src||'',suffix=raw.includes('?')?'?'+raw.split('?').slice(1).join('?'):'';
  const path='js/machineops-unattended-safety.js';
  if(Array.from(document.scripts||[]).some(s=>String(s.src||'').includes('/'+path)))return;
  if(typeof document.createElement!=='function'||!document.head)return;
  const s=document.createElement('script');s.src=path+suffix;s.async=false;
  s.onerror=()=>console.warn('[Máquinas] no se pudo cargar seguridad desatendida');
  document.head.appendChild(s);
})();