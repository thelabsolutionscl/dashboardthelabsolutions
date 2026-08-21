/* js/machineops-storage-adapter.js
 * Persistencia normalizada para MachineOps sobre la tabla "Monitor Sistema".
 *
 * MachineOps sigue viendo/produciendo el snapshot legado MACHINE_OPS_V2, pero
 * este adaptador lo divide en registros independientes por dominio. Así un
 * cambio en rollos no reescribe trabajos, QA, incidentes y configuración a la
 * vez. El registro V2 anterior se conserva como respaldo de migración.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root){root.MachineOpsStorage=api;api.install(root);}
})(typeof window!=='undefined'?window:null,function(){
'use strict';

const LEGACY_NAME='MACHINE_OPS_V2';
const PREFIX='MACHINE_OPS_V3:';
const SCHEMA=3;
const TABLE='Monitor Sistema';
const DOMAINS=[
  'jobs','spools','qa','workflows','profiles','safetyReadings','incidents','audit',
  'alertAcks','automation','costConfig','safetyConfig','maintenanceProfiles'
];
const META_DOMAIN='meta';
const hashes=new Map();
const committedSnapshots=new Map();
let installed=false,lastReadAt=0,lastWriteAt=0,lastMode='legacy';

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
function composePayload(records){
  const base={...parseLegacy(records)};
  const meta=bestMetaRecord(records);
  // Sin meta no hay commit V3 completo: aunque existan fragmentos creados por
  // una escritura interrumpida, seguimos sirviendo el snapshot V2 conocido.
  if(!meta){
    lastMode='legacy';lastReadAt=Date.now();
    return{data:base,normalized:0};
  }
  const commitAt=Number(meta.payload.writtenAt||0);
  let normalized=1;
  for(const domain of DOMAINS){
    // Un fragmento posterior a meta pertenece a un commit aún incompleto. Cada
    // registro conserva además su snapshot confirmado anterior, lo que permite
    // volver al commit previo aunque Airtable ya haya actualizado ese registro.
    const hit=bestDomainSnapshot(records,domain,commitAt);if(!hit)continue;
    base[domain]=hit.data;
    hashes.set(domain,domainHash(hit.data));
    committedSnapshots.set(domain,{writtenAt:hit.writtenAt,data:hit.data});
    normalized++;
  }
  base.version=Number(meta.payload.version||base.version||4);
  base.updatedAt=Math.max(Number(base.updatedAt||0),Number(meta.payload.updatedAt||0));
  hashes.set(META_DOMAIN,domainHash({version:base.version,updatedAt:Number(meta.payload.updatedAt||0)}));
  lastMode='normalized';lastReadAt=Date.now();
  return{data:base,normalized};
}
function splitPayload(raw){
  const data=raw&&typeof raw==='object'?raw:{};
  const writtenAt=Date.now();
  const fragments=DOMAINS.map(domain=>{
    const value=Object.prototype.hasOwnProperty.call(data,domain)?data[domain]:null;
    const previous=committedSnapshots.get(domain)||null;
    const envelope={schema:SCHEMA,domain,writtenAt,data:value};
    if(previous)envelope.previous={writtenAt:previous.writtenAt,data:previous.data};
    return{domain,name:recordName(domain),hash:domainHash(value),writtenAt,data:value,notes:JSON.stringify(envelope)};
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
function install(target){
  if(installed||!target)return false;
  const originalFetch=target.airtableFetch;
  const originalUpsert=target._monitorUpsert;
  if(typeof originalFetch!=='function'||typeof originalUpsert!=='function')return false;
  installed=true;

  target.airtableFetch=async function(table){
    const res=await originalFetch.apply(this,arguments);
    if(table!==TABLE||!res||!Array.isArray(res.records))return res;
    const composed=composePayload(res.records);
    if(!composed.normalized)return res;
    const records=res.records.filter(r=>r?.fields?.Name!==LEGACY_NAME);
    records.push(syntheticRecord(res.records,composed.data));
    return{...res,records};
  };

  target._monitorUpsert=async function(name,notes,idKey){
    if(name!==LEGACY_NAME)return originalUpsert.apply(this,arguments);
    let raw;try{raw=JSON.parse(notes||'{}');}catch(_){return originalUpsert.apply(this,arguments);}
    const {fragments,meta}=splitPayload(raw);
    const changed=fragments.filter(f=>hashes.get(f.domain)!==f.hash);
    // La primera migración puede crear muchos registros. Se guardan de forma
    // secuencial para respetar límites de Airtable y meta va siempre al final.
    // Si algo falla antes de meta, composePayload vuelve al snapshot confirmado.
    for(const f of changed){
      await originalUpsert(f.name,f.notes,'machineOpsV3_'+f.domain+'RecordId');
      hashes.set(f.domain,f.hash);
    }
    await originalUpsert(meta.name,meta.notes,'machineOpsV3_metaRecordId');
    hashes.set(META_DOMAIN,meta.hash);
    for(const f of changed)committedSnapshots.set(f.domain,{writtenAt:f.writtenAt,data:f.data});
    lastWriteAt=Date.now();lastMode='normalized';
    return true;
  };
  return true;
}
function status(){return{installed,mode:lastMode,schema:SCHEMA,lastReadAt,lastWriteAt,knownDomains:[...hashes.keys()]};}

return{install,status,_test:{stable,hashText,domainHash,recordName,splitPayload,composePayload,bestDomainSnapshot,LEGACY_NAME,PREFIX,SCHEMA,DOMAINS}};
});

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
  const s=document.createElement('script');s.src=path+suffix;s.async=false;s.onerror=()=>console.warn('[Máquinas] no se pudo cargar seguridad desatendida');document.head.appendChild(s);
})();
