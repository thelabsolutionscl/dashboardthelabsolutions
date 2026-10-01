import { accessAuthorize } from './access-auth.js';
const AIRTABLE_BASE = 'https://api.airtable.com';



/* Strict nonadmin mutation catalog, verified against Airtable field types.
 * Columns not named here (notably Vendedor, banking, payments, margins,
 * real costs, raw DTE data and future fields) cannot be sent by operator.
 */
const OPERATOR_WRITE_FIELDS=Object.freeze({
  Clientes:Object.freeze({
    'Empresa':'text','Contacto':'text','Cargo contacto':'text',
    'Teléfono':'phone','Email':'email','Fecha primer contacto':'date',
    'Dirección':'text','Comuna':'text','Región':'text','Sitio web':'url',
    'Industria / Rubro':'select','Fecha último pedido':'date',
    'Etapa venta':'select','Origen lead':'select',
    'Notas internas':'notes','Notas followup':'notes',
    'Tipo de cliente':'select','Servicio interés':'select',
    'Próxima acción IA':'notes','Validado':'flag','Reactivado':'flag',
    'Fecha reactivación':'date'
  }),
  Cotizaciones:Object.freeze({
    'N° Cotización':'text','Cliente':'links','Pedido':'links',
    'Estado cotización':'select','Fecha cotización':'date',
    'Fecha vencimiento':'date','Fecha aprobación':'date',
    'Solicitud cliente (texto libre)':'notes',
    'Detalle productos':'notes','Subtotal (CLP)':'money',
    'Urgencia (+25%)':'flag','Total final (CLP)':'money',
    'Notas cotización':'notes','Canal solicitud':'select',
    'Cantidad':'number','Forma de pago':'select',
    'Tiempo de producción':'number','Tipo días producción':'text',
    'Alias / Título':'text','Tiempo de producción máx':'number',
    'Fecha de entrega':'date','Fecha límite cotización':'date'
  }),
  Pedidos:Object.freeze({
    'N° Pedido':'text','Cliente':'links','Cotizaciones':'links',
    'Fecha ingreso':'date','Fecha entrega':'date','Urgente':'flag',
    'Fecha despacho':'date','Instrucciones fabricación':'notes',
    'Tiempo estimado (horas)':'number','Monto total (CLP)':'money',
    'Checklist QA':'notes','Observaciones QA':'notes',
    'Dirección despacho':'text','N° seguimiento courier':'text',
    'Resultado QA':'select','Prioridad':'select',
    'Motivo rechazo QA':'notes','Texto a grabar / imprimir':'notes',
    'Texto confirmado por cliente':'flag','Material':'select',
    'Cantidad':'number','Estado pedido':'select',
    'Etapa producción':'select','Equipo asignado':'select',
    'Tipo despacho':'select','Tipo documento':'select',
    'Notas pedido':'notes','Proveedor':'text','Ficha Tecnica':'notes',
    'FT Material':'select','FT Color':'text','FT Acabado':'select',
    'FT Cantidad':'number','FT Impresora':'text','FT Altura capa':'text',
    'FT Relleno (%)':'number','FT Soportes':'select',
    'FT Peso estimado (g)':'number','FT Tiempo impresión':'text',
    'FT Notas producción':'notes','FT Actualizado':'date',
    'Notas QA':'notes','Foto QA URL':'url','Fecha objetivo interna':'date',
    'Historial fechas calendario':'notes'
  }),
  Proveedores:Object.freeze({
    'Nombre':'text','Categoría':'choices','Contacto':'text',
    'Cargo':'text','Teléfono':'phone','Email':'email',
    'Sitio Web':'url','Comuna':'text','Región':'text',
    'Reputación':'number','Estado':'text','Plazo de entrega (días)':'number',
    'Productos':'notes','WhatsApp':'phone','Estado postulación':'select'
  })
});
function operatorFieldValueAllowed(kind,value,key){
  if(value===null)return !['N° Pedido','N° Cotización','Empresa','Nombre'].includes(key);
  if(kind==='flag')return typeof value==='boolean';
  if(kind==='number'||kind==='money')
    return typeof value==='number'&&Number.isFinite(value)&&value>=0&&
      value<=(kind==='money'?1e11:1e7)&&
      (key!=='FT Relleno (%)'||value<=100)&&
      (key!=='Reputación'||value<=10);
  if(kind==='links')return Array.isArray(value)&&value.length<=10&&
    (key!=='Cliente'||value.length<=1)&&
    (key!=='Pedido'||value.length<=1)&&
    value.every(id=>typeof id==='string'&&/^rec[A-Za-z0-9]{14}$/.test(id))&&
    new Set(value).size===value.length;
  if(kind==='choices')return Array.isArray(value)&&value.length<=12&&
    value.every(v=>typeof v==='string'&&v.length>0&&v.length<=120)&&
    new Set(value).size===value.length;
  if(typeof value!=='string'||/[\x00-\x08\x0b\x0e-\x1f]/.test(value))return false;
  if(kind==='notes')return value.length<=20000;
  if(kind==='date'){
    if(!value)return true;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const parsed=new Date(value+'T12:00:00Z');
    return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
  }
  if(kind==='email')return !value||value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if(kind==='phone')return value.length<=80;
  if(kind==='url'){
    if(!value)return true;
    if(value.length>1024)return false;
    try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&
      !u.username&&!u.password;}catch(_){return false;}
  }
  return value.length<=(kind==='select'?160:2048);
}
function operatorWritePayloadAllowed(table,method,payload){
  const catalog=OPERATOR_WRITE_FIELDS[table];
  if(!catalog||!['POST','PATCH'].includes(method)||!payload||
     typeof payload!=='object'||Array.isArray(payload))return false;
  const keys=Object.keys(payload);
  if(keys.some(k=>!['fields','records','typecast'].includes(k))||
     (payload.typecast!==undefined&&payload.typecast!==false))return false;
  const fieldsOK=(fields,creating)=>{
    if(!fields||typeof fields!=='object'||Array.isArray(fields))return false;
    const keys=Object.keys(fields);
    if(!keys.length||keys.length>40||keys.some(k=>!Object.hasOwn(catalog,k)||
       (!creating&&['N° Pedido','N° Cotización'].includes(k))||
       !operatorFieldValueAllowed(catalog[k],fields[k],k)))return false;
    if(creating){
      const required={Clientes:'Empresa',Cotizaciones:'N° Cotización',
        Pedidos:'N° Pedido',Proveedores:'Nombre'}[table];
      if(!required||typeof fields[required]!=='string'||
         !fields[required].trim())return false;
    }
    return true;
  };
  if(method==='POST'||Object.hasOwn(payload,'fields'))
    return !Object.hasOwn(payload,'records')&&
      fieldsOK(payload.fields,method==='POST');
  if(!Array.isArray(payload.records)||!payload.records.length||
     payload.records.length>10)return false;
  const seen=new Set();
  return payload.records.every(row=>row&&typeof row==='object'&&
    !Array.isArray(row)&&Object.keys(row).length===2&&
    Object.hasOwn(row,'id')&&Object.hasOwn(row,'fields')&&
    typeof row.id==='string'&&/^rec[A-Za-z0-9]{14}$/.test(row.id)&&
    !seen.has(row.id)&&seen.add(row.id)&&fieldsOK(row.fields,false));
}
async function operatorSafeMutationResponse(upstream,table,CORS){
  if(!upstream)return json({error:'Operational mutation outcome uncertain'},503,CORS);
  if(!upstream.ok){
    // Do not return internal Airtable errors that can echo denied columns.
    if([400,401,403,404,409,422].includes(upstream.status))
      return json({error:'Operational mutation rejected',code:'OPERATOR_WRITE_REJECTED'},
        upstream.status,CORS);
    return json({error:'Operational mutation outcome uncertain; reread before retrying',
      code:'OPERATOR_WRITE_UNCERTAIN'},503,CORS);
  }
  let body;
  try{body=await upstream.json();}catch(_){
    return json({error:'Operational mutation result uncertain; reread before retrying',
      code:'OPERATOR_WRITE_UNCERTAIN'},503,CORS);
  }
  const single=body&&typeof body==='object'&&!Array.isArray(body)&&
    typeof body.id==='string'&&body.fields&&typeof body.fields==='object'&&
    !Array.isArray(body.fields);
  const batch=body&&Array.isArray(body.records)&&body.records.length>0&&
    body.records.length<=10&&body.records.every(row=>row&&typeof row.id==='string'&&
      /^rec[A-Za-z0-9]{14}$/.test(row.id)&&row.fields&&
      typeof row.fields==='object'&&!Array.isArray(row.fields));
  if(single&&!/^rec[A-Za-z0-9]{14}$/.test(body.id))return json({
    error:'Operational mutation outcome uncertain',code:'OPERATOR_WRITE_UNCERTAIN'
  },503,CORS);
  if(!single&&!batch)return json({
    error:'Operational mutation outcome uncertain; reread before retrying',
    code:'OPERATOR_WRITE_UNCERTAIN'
  },503,CORS);
  const projected=single?viewerProjectRecord(body,table,OPERATOR_READ_FIELDS):
    {records:body.records.map(row=>viewerProjectRecord(row,table,OPERATOR_READ_FIELDS))};
  return json(projected,upstream.status,{...CORS,'Cache-Control':'private, no-store'});
}
async function operatorScopedWrite(request,url,identity,env,CORS){
  if(!['POST','PATCH'].includes(request.method))
    return json({error:'Operator mutation denied'},403,CORS);
  const prefix='/v0/app1YtD74AqiPWQhy/';
  const path=url.pathname.startsWith('/v0/')?url.pathname:'/v0'+url.pathname;
  if(!path.startsWith(prefix)||url.search)
    return json({error:'Operator mutation route denied'},403,CORS);
  const parts=path.slice(prefix.length).split('/');
  let table;
  try{table=decodeURIComponent(parts[0]);}catch(_){}
  if(!Object.hasOwn(OPERATOR_WRITE_FIELDS,table||'')||
     parts[0]!==encodeURIComponent(table)||
     (request.method==='POST'&&parts.length!==1)||
     (request.method==='PATCH'&&(parts.length>2||
       parts.length===2&&!/^rec[A-Za-z0-9]{14}$/.test(parts[1]))))
    return json({error:'Operator mutation route denied'},403,CORS);
  if(!env.AIRTABLE_TOKEN)return json({error:'CRM unavailable'},503,CORS);
  if(!/^application\/json(?:;|$)/i.test(String(request.headers.get('Content-Type')||''))||
     Number(request.headers.get('Content-Length')||0)>131072)
    return json({error:'Operator mutation expects bounded JSON'},415,CORS);
  let raw,body;
  try{raw=await request.text();if(raw.length>131072)throw Error('Large payload');
    body=JSON.parse(raw);}catch(_){
    return json({error:'Invalid operator mutation body'},422,CORS);
  }
  if(!operatorWritePayloadAllowed(table,request.method,body)||
     (request.method==='PATCH'&&
       (parts.length===1)!==Object.hasOwn(body,'records')))
    return json({error:'Unapproved operator fields or mutation shape'},422,CORS);
  const guarded=table==='Cotizaciones'||table==='Pedidos';
  if((guarded||request.method==='PATCH'&&table==='Clientes')&&
     !env.CRM_MUTATION_GUARD)return json({error:'CRM write guard unavailable'},503,CORS);
  const headers={'Content-Type':'application/json'};
  const actor={email:identity.email,role:'operator'};
  try{
    if(guarded&&request.method==='POST'){
      const stub=env.CRM_MUTATION_GUARD.get(env.CRM_MUTATION_GUARD.idFromName('tls-crm-global'));
      const upstream=await stub.fetch('https://crm-write.internal/create',{
        method:'POST',headers,
        body:JSON.stringify({table,body,search:'',actor})
      });
      return operatorSafeMutationResponse(upstream,table,CORS);
    }
    if(request.method==='PATCH'&&table!=='Proveedores'){
      const stub=env.CRM_MUTATION_GUARD.get(env.CRM_MUTATION_GUARD.idFromName('tls-crm-global'));
      const upstream=await stub.fetch('https://crm-write.internal/scoped-patch',{
        method:'POST',headers,
        body:JSON.stringify({table,method:'PATCH',body:raw,path,search:'',actor})
      });
      return operatorSafeMutationResponse(upstream,table,CORS);
    }
    const upstream=await fetch(AIRTABLE_BASE+path,{
      method:request.method,redirect:'manual',
      headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,...headers},body:raw
    });
    if(upstream.status>=300&&upstream.status<400)return json({
      error:'Unexpected CRM redirect; reread before retrying',
      code:'OPERATOR_WRITE_UNCERTAIN'},503,CORS);
    return operatorSafeMutationResponse(upstream,table,CORS);
  }catch(_){return json({error:'Operational mutation outcome uncertain; reread before retrying',
    code:'OPERATOR_WRITE_UNCERTAIN'},503,CORS);}
}


const SHARED_CALENDAR_EMPTY=Object.freeze({events:[],gmap:{},gmapMts:0,crmSync:{}});
const SHARED_CALENDAR_EVENT_KEYS=new Set([
  'id','ts','creadoPor','gcal','titulo','fecha','allDay','hIni','hFin',
  'personas','lugar','desc','alarmMin','emailMin','avisoApp','mts','del','gsyncMts'
]);
const SHARED_CALENDAR_SYNC_KEYS=new Set([
  'gcal','gsyncMts','signature','type','syncKey','del'
]);
function sharedCalendarGcalAllowed(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
     Object.keys(value).length>12)return false;
  return Object.entries(value).every(([key,row])=>
    key.length>0&&key.length<=80&&row&&typeof row==='object'&&!Array.isArray(row)&&
    Object.keys(row).every(k=>['cal','ev','mode'].includes(k))&&
    ['cal','ev','mode'].every(k=>row[k]===undefined||
      typeof row[k]==='string'&&row[k].length<=500));
}
function sharedCalendarPayloadAllowed(data){
  if(!data||typeof data!=='object'||Array.isArray(data)||
     JSON.stringify(data).length>95000)return false;
  const keys=Object.keys(data);
  if(keys.length!==4||!['events','gmap','gmapMts','crmSync'].every(k=>keys.includes(k))||
     !Array.isArray(data.events)||data.events.length>500||
     !data.gmap||typeof data.gmap!=='object'||Array.isArray(data.gmap)||
     Object.keys(data.gmap).length>20||
     !Number.isFinite(data.gmapMts)||data.gmapMts<0||
     !data.crmSync||typeof data.crmSync!=='object'||Array.isArray(data.crmSync)||
     Object.keys(data.crmSync).length>1000)return false;
  const text=(v,max)=>typeof v==='string'&&v.length<=max&&
    !/[\x00-\x08\x0b\x0e-\x1f]/.test(v);
  const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
  if(!Object.entries(data.gmap).every(([k,v])=>text(k,80)&&text(v,500)))return false;
  for(const event of data.events){
    if(!event||typeof event!=='object'||Array.isArray(event)||
       Object.keys(event).some(k=>!SHARED_CALENDAR_EVENT_KEYS.has(k))||
       !text(event.id,180)||!finite(event.ts)||!finite(event.mts)||
       !text(event.creadoPor||'',254)||!text(event.titulo||'',300)||
       !/^\d{4}-\d{2}-\d{2}$/.test(String(event.fecha||''))||
       (event.allDay!==undefined&&typeof event.allDay!=='boolean')||
       !text(event.hIni||'',20)||!text(event.hFin||'',20)||
       !Array.isArray(event.personas)||event.personas.length>12||
       !event.personas.every(v=>text(v,80))||
       !text(event.lugar||'',500)||!text(event.desc||'',4000)||
       (event.alarmMin!==undefined&&(!finite(event.alarmMin)||event.alarmMin>10080))||
       (event.emailMin!==undefined&&(!finite(event.emailMin)||event.emailMin>10080))||
       (event.avisoApp!==undefined&&typeof event.avisoApp!=='boolean')||
       (event.del!==undefined&&typeof event.del!=='boolean')||
       (event.gsyncMts!==undefined&&!finite(event.gsyncMts))||
       (event.gcal!==undefined&&!sharedCalendarGcalAllowed(event.gcal)))return false;
  }
  for(const [key,row] of Object.entries(data.crmSync)){
    if(!text(key,180)||!row||typeof row!=='object'||Array.isArray(row)||
       Object.keys(row).some(k=>!SHARED_CALENDAR_SYNC_KEYS.has(k))||
       (row.gcal!==undefined&&!sharedCalendarGcalAllowed(row.gcal))||
       (row.gsyncMts!==undefined&&!finite(row.gsyncMts))||
       (row.signature!==undefined&&!text(row.signature,1000))||
       (row.type!==undefined&&!text(row.type,80))||
       (row.syncKey!==undefined&&!text(row.syncKey,240))||
       (row.del!==undefined&&typeof row.del!=='boolean'))return false;
  }
  return true;
}
async function sharedCalendarDigest(raw){
  const bytes=new TextEncoder().encode(String(raw||''));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
async function sharedCalendarLoad(env){
  if(!env.AIRTABLE_TOKEN)return {error:'missing-token'};
  const query=new URLSearchParams();
  query.set('maxRecords','2');
  query.set('filterByFormula',"{Name}='CALENDARIO'");
  query.append('fields[]','Name');query.append('fields[]','Notes');
  let response;
  try{
    response=await fetch(AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+
      encodeURIComponent('Monitor Sistema')+'?'+query.toString(),{
        method:'GET',redirect:'manual',
        headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,Accept:'application/json'}
      });
  }catch(_){return {error:'network'};}
  if(!response.ok||response.status>=300&&response.status<400)
    return {error:'upstream'};
  let body;try{body=await response.json();}catch(_){return {error:'invalid-json'};}
  if(!body||!Array.isArray(body.records)||body.records.length>1)
    return {error:body?.records?.length>1?'duplicate':'invalid-shape'};
  if(!body.records.length)return {
    recordId:'',raw:'',revision:'',data:{events:[],gmap:{},gmapMts:0,crmSync:{}}
  };
  const record=body.records[0];
  if(!/^rec[A-Za-z0-9]{14}$/.test(String(record.id||''))||
     record.fields?.Name!=='CALENDARIO'||typeof record.fields?.Notes!=='string')
    return {error:'invalid-record'};
  let data;try{data=JSON.parse(record.fields.Notes);}catch(_){return {error:'invalid-payload'};}
  if(!sharedCalendarPayloadAllowed(data))return {error:'invalid-payload'};
  return {recordId:record.id,raw:record.fields.Notes,
    revision:await sharedCalendarDigest(record.fields.Notes),data};
}


const SHARED_AGENDA_ITEM_KEYS=new Set([
  'id','texto','fecha','cliId','cliNombre','done','del','ts','mts'
]);
function sharedAgendaScopeAllowed(scope){
  return scope==='__equipo__'||(
    typeof scope==='string'&&scope.length<=254&&scope===scope.toLowerCase()&&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(scope)
  );
}
function sharedAgendaItemsAllowed(items){
  if(!Array.isArray(items)||items.length>500||JSON.stringify(items).length>90000)return false;
  const text=(v,max)=>typeof v==='string'&&v.length<=max&&
    !/[\x00-\x08\x0b\x0e-\x1f]/.test(v);
  const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
  return items.every(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||
       Object.keys(item).some(k=>!SHARED_AGENDA_ITEM_KEYS.has(k))||
       !text(item.id,180)||!item.id||
       !text(item.texto,1200)||!item.texto.trim()||
       !/^\d{4}-\d{2}-\d{2}$/.test(String(item.fecha||''))||
       !finite(item.ts)||
       (item.mts!==undefined&&!finite(item.mts))||
       (item.done!==undefined&&typeof item.done!=='boolean')||
       (item.del!==undefined&&typeof item.del!=='boolean')||
       (item.cliId!==undefined&&item.cliId!==null&&
         !(typeof item.cliId==='string'&&/^rec[A-Za-z0-9]{14}$/.test(item.cliId)))||
       (item.cliNombre!==undefined&&item.cliNombre!==null&&!text(item.cliNombre,300)))
      return false;
    return true;
  });
}
function sharedAgendaDocumentAllowed(data){
  if(!data||typeof data!=='object'||Array.isArray(data)||
     Object.keys(data).length>100||JSON.stringify(data).length>95000)return false;
  return Object.entries(data).every(([scope,items])=>
    sharedAgendaScopeAllowed(scope)&&sharedAgendaItemsAllowed(items));
}
function sharedAgendaScopeFor(identity,requestedScope,legacy){
  if(identity){
    if(typeof identity.email!=='string'||!sharedAgendaScopeAllowed(identity.email))
      return '';
    const signedScope=identity.role==='sales'?identity.email:'__equipo__';
    return !requestedScope||requestedScope===signedScope?signedScope:'';
  }
  return legacy&&sharedAgendaScopeAllowed(requestedScope)?requestedScope:'';
}
async function sharedAgendaLoad(env,scope){
  if(!env.AIRTABLE_TOKEN||!sharedAgendaScopeAllowed(scope))return {error:'invalid-config'};
  const query=new URLSearchParams();
  query.set('maxRecords','2');
  query.set('filterByFormula',"{Name}='AGENDA'");
  query.append('fields[]','Name');query.append('fields[]','Notes');
  let response;
  try{
    response=await fetch(AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+
      encodeURIComponent('Monitor Sistema')+'?'+query.toString(),{
        method:'GET',redirect:'manual',
        headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,Accept:'application/json'}
      });
  }catch(_){return {error:'network'};}
  if(!response.ok||response.status>=300&&response.status<400)
    return {error:'upstream'};
  let body;try{body=await response.json();}catch(_){return {error:'invalid-json'};}
  if(!body||!Array.isArray(body.records)||body.records.length>1)
    return {error:body?.records?.length>1?'duplicate':'invalid-shape'};
  if(!body.records.length){
    const data=[];
    return {recordId:'',raw:'',all:{},data,
      revision:await sharedCalendarDigest(JSON.stringify(data))};
  }
  const record=body.records[0];
  if(!/^rec[A-Za-z0-9]{14}$/.test(String(record.id||''))||
     record.fields?.Name!=='AGENDA'||typeof record.fields?.Notes!=='string')
    return {error:'invalid-record'};
  let all;try{all=JSON.parse(record.fields.Notes);}catch(_){return {error:'invalid-payload'};}
  if(!sharedAgendaDocumentAllowed(all))return {error:'invalid-payload'};
  const data=Array.isArray(all[scope])?all[scope]:[];
  return {recordId:record.id,raw:record.fields.Notes,all,data,
    revision:await sharedCalendarDigest(JSON.stringify(data))};
}


const SHARED_MAIL_RECORDS=Object.freeze({
  signature:'MAIL_SIGNATURES',
  'sent-addresses':'MAIL_SENT_ADDRESSES',
  templates:'MAIL_TEMPLATES'
});
function sharedMailEmailAllowed(email){
  return typeof email==='string'&&email.length<=254&&email===email.toLowerCase()&&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function sharedMailMailboxAllowed(identity,account,legacy){
  if(!sharedMailEmailAllowed(account))return false;
  if(legacy)return true;
  if(!identity||typeof identity!=='object'||!sharedMailEmailAllowed(identity.email))return false;
  if(account===identity.email||account==='hola@thelab.solutions')return true;
  if(identity.role==='admin'&&account.endsWith('@thelab.solutions'))return true;
  if(identity.role==='finance'&&account==='pagos@thelab.solutions')return true;
  return false;
}
function sharedMailSignatureAllowed(value){
  return typeof value==='string'&&value.length<=60000&&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
}
function sharedMailAddressesAllowed(value){
  if(!Array.isArray(value)||value.length>300)return false;
  const seen=new Set();
  return value.every(email=>{
    if(!sharedMailEmailAllowed(email)||seen.has(email))return false;
    seen.add(email);return true;
  });
}
const SHARED_MAIL_TEMPLATE_KEYS=new Set(['name','subject','body']);
function sharedMailTemplatesAllowed(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
     Object.keys(value).some(k=>!['version','updatedAt','templates'].includes(k))||
     value.version!==1||typeof value.updatedAt!=='number'||!Number.isFinite(value.updatedAt)||
     value.updatedAt<0||!Array.isArray(value.templates)||value.templates.length>80||
     JSON.stringify(value).length>90000)return false;
  const text=(v,max)=>typeof v==='string'&&v.length<=max&&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
  return value.templates.every(t=>
    t&&typeof t==='object'&&!Array.isArray(t)&&
    !Object.keys(t).some(k=>!SHARED_MAIL_TEMPLATE_KEYS.has(k))&&
    text(t.name,180)&&!!t.name.trim()&&text(t.subject,1000)&&text(t.body,24000)
  );
}
function sharedMailMapAllowed(resource,value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
     Object.keys(value).length>120||JSON.stringify(value).length>95000)return false;
  return Object.entries(value).every(([email,data])=>
    sharedMailEmailAllowed(email)&&
    (resource==='signature'?sharedMailSignatureAllowed(data):sharedMailAddressesAllowed(data))
  );
}
function sharedMailDefault(resource){
  return resource==='signature'?'':resource==='sent-addresses'?[]:
    {version:1,updatedAt:0,templates:[]};
}
function sharedMailDataAllowed(resource,data){
  return resource==='signature'?sharedMailSignatureAllowed(data):
    resource==='sent-addresses'?sharedMailAddressesAllowed(data):
      resource==='templates'?sharedMailTemplatesAllowed(data):false;
}
async function sharedMailLoad(env,resource,account){
  const recordName=SHARED_MAIL_RECORDS[resource];
  if(!env.AIRTABLE_TOKEN||!recordName||
     (resource!=='templates'&&!sharedMailEmailAllowed(account)))
    return {error:'invalid-config'};
  const query=new URLSearchParams();
  query.set('maxRecords','2');
  query.set('filterByFormula',"{Name}='"+recordName+"'");
  query.append('fields[]','Name');query.append('fields[]','Notes');
  let response;
  try{
    response=await fetch(AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+
      encodeURIComponent('Monitor Sistema')+'?'+query.toString(),{
        method:'GET',redirect:'manual',
        headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,Accept:'application/json'}
      });
  }catch(_){return {error:'network'};}
  if(!response.ok||response.status>=300&&response.status<400)
    return {error:'upstream'};
  let body;try{body=await response.json();}catch(_){return {error:'invalid-json'};}
  if(!body||!Array.isArray(body.records)||body.records.length>1)
    return {error:body?.records?.length>1?'duplicate':'invalid-shape'};
  if(!body.records.length){
    const data=sharedMailDefault(resource);
    return {recordId:'',exists:false,raw:'',all:resource==='templates'?null:{},data,
      revision:await sharedCalendarDigest(JSON.stringify(data))};
  }
  const record=body.records[0];
  if(!/^rec[A-Za-z0-9]{14}$/.test(String(record.id||''))||
     record.fields?.Name!==recordName||typeof record.fields?.Notes!=='string')
    return {error:'invalid-record'};
  let parsed;try{parsed=JSON.parse(record.fields.Notes);}catch(_){return {error:'invalid-payload'};}
  let data,all=null;
  if(resource==='templates'){
    if(Array.isArray(parsed))parsed={version:1,updatedAt:0,templates:parsed};
    if(!sharedMailTemplatesAllowed(parsed))return {error:'invalid-payload'};
    data=parsed;
  }else{
    if(!sharedMailMapAllowed(resource,parsed))return {error:'invalid-payload'};
    all=parsed;data=Object.hasOwn(parsed,account)?parsed[account]:sharedMailDefault(resource);
  }
  return {recordId:record.id,exists:true,raw:record.fields.Notes,all,data,
    revision:await sharedCalendarDigest(JSON.stringify(data))};
}


const SHARED_MACHINEOPS_SCHEMA=3;
const SHARED_MACHINEOPS_PREFIX='MACHINE_OPS_V3:';
const SHARED_MACHINEOPS_LEGACY='MACHINE_OPS_V2';
const SHARED_MACHINEOPS_BED_HISTORY='BED_LEVEL_HISTORY_V2';
const SHARED_MACHINEOPS_DOMAINS=[
  'jobs','spools','qa','workflows','profiles','safetyReadings','incidents','audit',
  'alertAcks','ignoredPrints','bedClearAcks','automation','costConfig','safetyConfig','maintenanceProfiles'
];
const SHARED_MACHINEOPS_ARRAY_DOMAINS=new Set([
  'jobs','spools','qa','workflows','profiles','safetyReadings','incidents','audit'
]);
const SHARED_MACHINEOPS_CONFIG_DOMAINS=new Set([
  'automation','costConfig','safetyConfig','maintenanceProfiles'
]);
const SHARED_MACHINEOPS_META='meta';
const SHARED_MACHINEOPS_NAMES=new Set([
  SHARED_MACHINEOPS_LEGACY,SHARED_MACHINEOPS_BED_HISTORY,
  ...SHARED_MACHINEOPS_DOMAINS.map(d=>SHARED_MACHINEOPS_PREFIX+d),
  SHARED_MACHINEOPS_PREFIX+SHARED_MACHINEOPS_META
]);
const SHARED_MACHINEOPS_LIMITS=Object.freeze({
  jobs:1200,spools:500,qa:1200,workflows:400,profiles:500,
  safetyReadings:500,incidents:1200,audit:500
});
function sharedMachineFinite(v,min=0,max=Number.MAX_SAFE_INTEGER){
  return typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
}
function sharedMachinePlainObject(v){
  return !!v&&typeof v==='object'&&!Array.isArray(v);
}
function sharedMachineJsonAllowed(value,depth=0){
  if(depth>8)return false;
  if(value===null||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(typeof value==='string')
    return value.length<=85000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
  if(Array.isArray(value))
    return value.length<=1500&&value.every(v=>sharedMachineJsonAllowed(v,depth+1));
  if(!sharedMachinePlainObject(value)||Object.keys(value).length>2500)return false;
  return Object.entries(value).every(([k,v])=>
    k.length>0&&k.length<=160&&!/[\x00-\x1f]/.test(k)&&sharedMachineJsonAllowed(v,depth+1));
}
function sharedMachineExactKeys(value,keys){
  return sharedMachinePlainObject(value)&&Object.keys(value).length===keys.length&&
    Object.keys(value).every(k=>keys.includes(k));
}
function sharedMachineAutomationAllowed(data){
  const keys=['enabled','stallMinutes','tempTolerance','offlineMinutes','autoLink','autoIncident','bridgeIntervalSeconds'];
  return sharedMachineExactKeys(data,keys)&&
    typeof data.enabled==='boolean'&&typeof data.autoLink==='boolean'&&typeof data.autoIncident==='boolean'&&
    sharedMachineFinite(data.stallMinutes,3,120)&&sharedMachineFinite(data.tempTolerance,5,60)&&
    sharedMachineFinite(data.offlineMinutes,1,30)&&sharedMachineFinite(data.bridgeIntervalSeconds,30,600);
}
function sharedMachineCostAllowed(data){
  const keys=['electricityClpKwh','machineKw','laborClpHour','operatorMinutes','wearClpHour','failureOverheadPct'];
  return sharedMachineExactKeys(data,keys)&&
    sharedMachineFinite(data.electricityClpKwh,0,1000000)&&
    sharedMachineFinite(data.machineKw,0,100)&&
    sharedMachineFinite(data.laborClpHour,0,100000000)&&
    sharedMachineFinite(data.operatorMinutes,0,1440)&&
    sharedMachineFinite(data.wearClpHour,0,100000000)&&
    sharedMachineFinite(data.failureOverheadPct,0,100);
}
function sharedMachineSafetyAllowed(data){
  const keys=['enforce','cameraRequired','ventilationRequired','smokeRequired','maxTemperature',
    'maxHumidity','maxVoc','staleMinutes','sensorUrl','updatedAt'];
  return sharedMachineExactKeys(data,keys)&&
    ['enforce','cameraRequired','ventilationRequired','smokeRequired'].every(k=>typeof data[k]==='boolean')&&
    sharedMachineFinite(data.maxTemperature,0,100)&&sharedMachineFinite(data.maxHumidity,0,100)&&
    sharedMachineFinite(data.maxVoc,0,1000000)&&sharedMachineFinite(data.staleMinutes,1,1440)&&
    typeof data.sensorUrl==='string'&&data.sensorUrl.length<=1000&&
    !/[\x00-\x1f]/.test(data.sensorUrl)&&sharedMachineFinite(data.updatedAt,0);
}
function sharedMachineMaintenanceAllowed(data){
  const models=['K1','K2','K2 Plus','Ender-5 Max','Giga'];
  const keys=['nozzle','lubrication','belt','extruder','bed','sensors','general'];
  if(!sharedMachineExactKeys(data,models))return false;
  return models.every(model=>sharedMachineExactKeys(data[model],keys)&&
    keys.every(k=>sharedMachineFinite(data[model][k],1,100000)));
}
function sharedMachineDomainDataAllowed(domain,data){
  if(!SHARED_MACHINEOPS_DOMAINS.includes(domain))return false;
  let ok=false;
  if(domain==='automation')ok=sharedMachineAutomationAllowed(data);
  else if(domain==='costConfig')ok=sharedMachineCostAllowed(data);
  else if(domain==='safetyConfig')ok=sharedMachineSafetyAllowed(data);
  else if(domain==='maintenanceProfiles')ok=sharedMachineMaintenanceAllowed(data);
  else if(SHARED_MACHINEOPS_ARRAY_DOMAINS.has(domain))
    ok=Array.isArray(data)&&data.length<=SHARED_MACHINEOPS_LIMITS[domain]&&sharedMachineJsonAllowed(data);
  else ok=sharedMachinePlainObject(data)&&Object.keys(data).length<=1200&&sharedMachineJsonAllowed(data);
  if(!ok)return false;
  try{return JSON.stringify(data).length<=85000;}catch(_){return false;}
}
function sharedMachineMetaAllowed(value){
  return sharedMachinePlainObject(value)&&
    Object.keys(value).every(k=>['schema','domain','writtenAt','version','updatedAt','domains'].includes(k))&&
    value.schema===SHARED_MACHINEOPS_SCHEMA&&value.domain===SHARED_MACHINEOPS_META&&
    sharedMachineFinite(value.writtenAt,0)&&sharedMachineFinite(value.version,1,100)&&
    sharedMachineFinite(value.updatedAt,0)&&Array.isArray(value.domains)&&
    value.domains.length===SHARED_MACHINEOPS_DOMAINS.length&&
    value.domains.every((d,i)=>d===SHARED_MACHINEOPS_DOMAINS[i]);
}
function sharedMachineEnvelopeAllowed(name,notes){
  if(typeof notes!=='string'||notes.length>90000)return false;
  let value;try{value=JSON.parse(notes);}catch(_){return false;}
  if(name===SHARED_MACHINEOPS_PREFIX+SHARED_MACHINEOPS_META)return sharedMachineMetaAllowed(value);
  if(!name.startsWith(SHARED_MACHINEOPS_PREFIX))return false;
  const domain=name.slice(SHARED_MACHINEOPS_PREFIX.length);
  if(!SHARED_MACHINEOPS_DOMAINS.includes(domain)||!sharedMachinePlainObject(value)||
     Object.keys(value).some(k=>!['schema','domain','writtenAt','data','previous'].includes(k))||
     value.schema!==SHARED_MACHINEOPS_SCHEMA||value.domain!==domain||
     !sharedMachineFinite(value.writtenAt,0)||!sharedMachineDomainDataAllowed(domain,value.data))
    return false;
  if(value.previous!==undefined){
    if(!sharedMachineExactKeys(value.previous,['writtenAt','data'])||
       !sharedMachineFinite(value.previous.writtenAt,0)||
       !sharedMachineDomainDataAllowed(domain,value.previous.data))return false;
  }
  return true;
}
function sharedMachineLegacyAllowed(notes){
  if(typeof notes!=='string'||notes.length>95000)return false;
  let value;try{value=JSON.parse(notes);}catch(_){return false;}
  if(!sharedMachinePlainObject(value)||!sharedMachineFinite(Number(value.version||4),1,100)||
     !sharedMachineFinite(Number(value.updatedAt||0),0))return false;
  const allowed=new Set(['version','updatedAt',...SHARED_MACHINEOPS_DOMAINS]);
  if(Object.keys(value).some(k=>!allowed.has(k)))return false;
  return SHARED_MACHINEOPS_DOMAINS.every(domain=>
    !Object.hasOwn(value,domain)||sharedMachineDomainDataAllowed(domain,value[domain]));
}
function sharedMachineBedHistoryAllowed(data){
  if(!Array.isArray(data)||data.length>180||!sharedMachineJsonAllowed(data))return false;
  try{return JSON.stringify(data).length<=85000;}catch(_){return false;}
}
function sharedMachineRecordAllowed(name,notes){
  if(name===SHARED_MACHINEOPS_LEGACY)return sharedMachineLegacyAllowed(notes);
  if(name===SHARED_MACHINEOPS_BED_HISTORY){
    if(typeof notes!=='string'||notes.length>85000)return false;
    let data;try{data=JSON.parse(notes);}catch(_){return false;}
    return sharedMachineBedHistoryAllowed(data);
  }
  return sharedMachineEnvelopeAllowed(name,notes);
}
function sharedMachineWriteRoleAllowed(actor,domain,legacy=false){
  if(legacy)return true;
  if(!actor||!['operator','admin'].includes(actor.role))return false;
  if(actor.role==='admin')return true;
  return !SHARED_MACHINEOPS_CONFIG_DOMAINS.has(domain);
}
async function sharedMachineOpsLoad(env,recordName=''){
  if(!env.AIRTABLE_TOKEN)return {error:'invalid-config'};
  const single=recordName!==''; 
  if(single&&recordName!==SHARED_MACHINEOPS_BED_HISTORY)return {error:'invalid-record'};
  const names=single?[recordName]:[
    SHARED_MACHINEOPS_LEGACY,
    ...SHARED_MACHINEOPS_DOMAINS.map(d=>SHARED_MACHINEOPS_PREFIX+d),
    SHARED_MACHINEOPS_PREFIX+SHARED_MACHINEOPS_META
  ];
  const formula=names.length===1
    ?"{Name}='"+names[0]+"'"
    :'OR('+names.map(n=>"{Name}='"+n+"'").join(',')+')';
  const query=new URLSearchParams();
  query.set('maxRecords',String(names.length+2));
  query.set('filterByFormula',formula);
  query.append('fields[]','Name');query.append('fields[]','Notes');
  let response;
  try{
    response=await fetch(AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+
      encodeURIComponent('Monitor Sistema')+'?'+query.toString(),{
        method:'GET',redirect:'manual',
        headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,Accept:'application/json'}
      });
  }catch(_){return {error:'network'};}
  if(!response.ok||response.status>=300&&response.status<400)return {error:'upstream'};
  let body;try{body=await response.json();}catch(_){return {error:'invalid-json'};}
  if(!body||!Array.isArray(body.records)||body.offset!==undefined||
     body.records.length>names.length)return {error:'invalid-shape'};
  const map=new Map();
  for(const record of body.records){
    const name=record?.fields?.Name,notes=record?.fields?.Notes;
    if(!names.includes(name)||map.has(name)||
       !/^rec[A-Za-z0-9]{14}$/.test(String(record?.id||''))||
       typeof notes!=='string'||!sharedMachineRecordAllowed(name,notes))
      return {error:'invalid-record'};
    map.set(name,{recordId:record.id,name,notes});
  }
  let selected;
  if(single)selected=map.has(recordName)?[map.get(recordName)]:[];
  else{
    const metaName=SHARED_MACHINEOPS_PREFIX+SHARED_MACHINEOPS_META;
    selected=map.has(metaName)
      ?[...SHARED_MACHINEOPS_DOMAINS.map(d=>SHARED_MACHINEOPS_PREFIX+d),metaName]
          .filter(n=>map.has(n)).map(n=>map.get(n))
      :(map.has(SHARED_MACHINEOPS_LEGACY)?[map.get(SHARED_MACHINEOPS_LEGACY)]:[]);
  }
  const revisionNames=single?[recordName]:[
    ...SHARED_MACHINEOPS_DOMAINS.map(d=>SHARED_MACHINEOPS_PREFIX+d),
    SHARED_MACHINEOPS_PREFIX+SHARED_MACHINEOPS_META
  ];
  const revisions=Object.create(null);
  for(const name of revisionNames)
    revisions[name]=await sharedCalendarDigest(map.get(name)?.notes||'');
  const records=[];
  for(const rec of selected)records.push({
    name:rec.name,notes:rec.notes,revision:await sharedCalendarDigest(rec.notes)
  });
  return {records,revisions,recordMap:map};
}


const SHARED_SIMULATION_NAME='SIMULACION';
const SHARED_SIMULATION_VERSION=1;
const SHARED_SIMULATION_LINE_KEYS=new Set(['lamparas','trofeos','merch','senaletica','nfc','deco3d','otra']);
const SHARED_SIMULATION_PUBLICS=new Set(['ambos','consumidor','negocio']);
const SHARED_SIMULATION_VERDICTS=new Set(['descartar','dudoso','prototipar','incompleto','error']);
const SHARED_SIMULATION_RUN_KEYS=new Set([
  'id','fecha','ts','linea','lineaKey','publico','panel','nPerfiles','barrido','items'
]);
const SHARED_SIMULATION_ITEM_KEYS=new Set([
  'concepto','base','precio','veredicto','pctCompra','promedio','cobertura',
  'esperados','frenos','comprador','precioSugerido'
]);
function sharedSimulationText(v,max,{empty=true}={}){
  return typeof v==='string'&&v.length<=max&&(empty||v.trim().length>0)&&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
}
function sharedSimulationNum(v,min,max){
  return typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
}
function sharedSimulationItemAllowed(item){
  if(!item||typeof item!=='object'||Array.isArray(item)||
     Object.keys(item).some(k=>!SHARED_SIMULATION_ITEM_KEYS.has(k))||
     !sharedSimulationText(item.concepto,600,{empty:false})||
     (item.base!==undefined&&!sharedSimulationText(item.base,600))||
     !sharedSimulationNum(item.precio,0,100000000)||
     !SHARED_SIMULATION_VERDICTS.has(item.veredicto)||
     !sharedSimulationNum(item.pctCompra,0,100)||
     !sharedSimulationNum(item.promedio,0,5)||
     (item.cobertura!==undefined&&!sharedSimulationNum(item.cobertura,0,100))||
     (item.esperados!==undefined&&!sharedSimulationNum(item.esperados,0,100))||
     !sharedSimulationText(item.frenos||'',2500)||
     !sharedSimulationText(item.comprador||'',1500)||
     !sharedSimulationText(item.precioSugerido||'',1500))
    return false;
  return true;
}
function sharedSimulationRunAllowed(run){
  if(!run||typeof run!=='object'||Array.isArray(run)||
     Object.keys(run).some(k=>!SHARED_SIMULATION_RUN_KEYS.has(k))||
     !sharedSimulationText(run.id,160,{empty:false})||
     !/^\d{4}-\d{2}-\d{2}$/.test(String(run.fecha||''))||
     !sharedSimulationNum(run.ts,0,9999999999999)||
     !sharedSimulationText(run.linea,300,{empty:false})||
     !SHARED_SIMULATION_LINE_KEYS.has(run.lineaKey)||
     !SHARED_SIMULATION_PUBLICS.has(run.publico)||
     !Number.isInteger(run.panel)||!sharedSimulationNum(run.panel,1,100)||
     !Number.isInteger(run.nPerfiles)||!sharedSimulationNum(run.nPerfiles,1,100)||
     (run.barrido!==undefined&&(!Array.isArray(run.barrido)||run.barrido.length>5||
       run.barrido.some(v=>!sharedSimulationNum(v,0,100000000))))||
     !Array.isArray(run.items)||run.items.length>10||
     !run.items.every(sharedSimulationItemAllowed))
    return false;
  return true;
}
function sharedSimulationRunsAllowed(runs){
  if(!Array.isArray(runs)||runs.length>30)return false;
  const ids=new Set();
  for(const run of runs){
    if(!sharedSimulationRunAllowed(run)||ids.has(run.id))return false;
    ids.add(run.id);
  }
  try{return JSON.stringify(runs).length<=90000;}catch(_){return false;}
}
function sharedSimulationDocumentAllowed(doc){
  if(!doc||typeof doc!=='object'||Array.isArray(doc)||
     Object.keys(doc).some(k=>!['version','updatedAt','clearedAt','runs'].includes(k))||
     doc.version!==SHARED_SIMULATION_VERSION||
     !sharedSimulationNum(doc.updatedAt,0,9999999999999)||
     !sharedSimulationNum(doc.clearedAt,0,9999999999999)||
     doc.clearedAt>doc.updatedAt||
     !sharedSimulationRunsAllowed(doc.runs)||
     doc.runs.some(run=>run.ts<=doc.clearedAt))
    return false;
  try{return JSON.stringify(doc).length<=95000;}catch(_){return false;}
}
function sharedSimulationNormalize(value){
  if(Array.isArray(value)){
    if(!sharedSimulationRunsAllowed(value))return null;
    const updatedAt=value.reduce((m,r)=>Math.max(m,Number(r.ts)||0),0);
    return{version:SHARED_SIMULATION_VERSION,updatedAt,clearedAt:0,runs:value};
  }
  return sharedSimulationDocumentAllowed(value)?value:null;
}
async function sharedSimulationLoad(env){
  if(!env.AIRTABLE_TOKEN)return {error:'invalid-config'};
  const query=new URLSearchParams();
  query.set('maxRecords','2');
  query.set('filterByFormula',"{Name}='"+SHARED_SIMULATION_NAME+"'");
  query.append('fields[]','Name');query.append('fields[]','Notes');
  let response;
  try{
    response=await fetch(AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+
      encodeURIComponent('Monitor Sistema')+'?'+query.toString(),{
        method:'GET',redirect:'manual',
        headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,Accept:'application/json'}
      });
  }catch(_){return {error:'network'};}
  if(!response.ok||response.status>=300&&response.status<400)return {error:'upstream'};
  let body;try{body=await response.json();}catch(_){return {error:'invalid-json'};}
  if(!body||!Array.isArray(body.records)||body.records.length>1)
    return {error:body?.records?.length>1?'duplicate':'invalid-shape'};
  if(!body.records.length){
    const data={version:SHARED_SIMULATION_VERSION,updatedAt:0,clearedAt:0,runs:[]};
    return{recordId:'',exists:false,raw:'',data,revision:await sharedCalendarDigest('')};
  }
  const record=body.records[0];
  if(!/^rec[A-Za-z0-9]{14}$/.test(String(record.id||''))||
     record.fields?.Name!==SHARED_SIMULATION_NAME||typeof record.fields?.Notes!=='string')
    return {error:'invalid-record'};
  let parsed;try{parsed=JSON.parse(record.fields.Notes);}catch(_){return {error:'invalid-payload'};}
  const data=sharedSimulationNormalize(parsed);
  if(!data)return {error:'invalid-payload'};
  return{recordId:record.id,exists:true,raw:record.fields.Notes,data,
    revision:await sharedCalendarDigest(record.fields.Notes)};
}
function sharedSimulationActorAllowed(actor){
  return actor?.legacy===true||
    (actor&&typeof actor.email==='string'&&
      (actor.role==='admin'||actor.email==='marketing@thelab.solutions'));
}

const SELLER_SCOPE_TABLES=new Set(['Clientes','Cotizaciones','Pedidos']);

/* Signed, non-financial viewer field scope. These names were checked against
 * the current Airtable base; absent/future columns are hidden by default.
 * No arbitrary formulas, views or sorts: result counts can reveal hidden data.
 * Other signed roles retain their existing table-specific authorization.
 */
const VIEWER_READ_FIELDS=Object.freeze({
  Clientes:new Set([
    'Empresa','Contacto','Cargo contacto','Teléfono','Email','Comuna','Región',
    'Sitio web','Industria / Rubro','Etapa venta','Tipo de cliente','Vendedor',
    'Servicio interés','Fecha primer contacto','Fecha último pedido'
  ]),
  Cotizaciones:new Set([
    'N° Cotización','Estado cotización','Fecha cotización','Fecha vencimiento',
    'Fecha de entrega','Fecha límite cotización','Alias / Título','Cantidad',
    'Tiempo de producción','Tipo días producción','Vendedor','Cliente','Pedido'
  ]),
  Pedidos:new Set([
    'N° Pedido','Fecha ingreso','Fecha entrega','Urgente','Fecha despacho',
    'Estado pedido','Etapa producción','Equipo asignado','Prioridad','Material',
    'Cantidad','Tipo despacho','Fecha objetivo interna','Vendedor',
    'Cliente','Cotizaciones'
  ]),
  Proveedores:new Set([
    'Nombre','Categoría','Contacto','Cargo','Teléfono','Email','Sitio Web',
    'Comuna','Región','Reputación','Estado','Plazo de entrega (días)'
  ]),
  Maquinas:new Set(['id','nombre','num','numG','modelo','color','estado']),
  Maquinas_Eventos:new Set(['maquina_id','fecha','tipo','tiempo']),
  Maquinas_Mant:new Set(['maquina_id','tipo','print_hours','fecha'])
});
// A company-wide operator needs operational CRM data, including business
// quote/order totals, but NOT bank details, margins, private AI finance
// analysis, raw proposal JSON, production costs or newly created fields.
const OPERATOR_READ_FIELDS=Object.freeze({
  Clientes:new Set([...VIEWER_READ_FIELDS.Clientes,
    'Dirección','Notas followup','Notas internas','Valoración cliente',
    'Lead Score IA','Servicio interés','Validado','Estado cuenta',
    'Pedidos','Cotizaciones','Próxima acción IA'
  ]),
  Cotizaciones:new Set([...VIEWER_READ_FIELDS.Cotizaciones,
    'Solicitud cliente (texto libre)','Detalle productos','Subtotal (CLP)',
    'Total final (CLP)','Urgencia (+25%)','Canal solicitud','Forma de pago',
    'Tiempo de producción máx','Descuento (%)','Notas cotización','Estado cotización',
    'Fecha aprobación'
  ]),
  Pedidos:new Set([...VIEWER_READ_FIELDS.Pedidos,
    'Instrucciones fabricación','Tiempo estimado (horas)',
    'Anticipo pagado (50%)','Saldo pagado (50%)',
    'Monto total (CLP)','Checklist QA','Observaciones QA','Resultado QA',
    'Motivo rechazo QA','Texto a grabar / imprimir',
    'Texto confirmado por cliente','Forma de pago','Notas pedido',
    'Ficha Tecnica','FT Material','FT Color','FT Acabado','FT Cantidad',
    'FT Impresora','FT Altura capa','FT Relleno (%)','FT Soportes',
    'FT Peso estimado (g)','FT Tiempo impresión',
    'FT Notas producción','Fecha despacho','Fecha objetivo interna',
    'N° seguimiento courier','Proveedor','Foto QA URL','Notas QA',
    'Historial fechas calendario','FT Actualizado'
  ]),
  Proveedores:new Set([...VIEWER_READ_FIELDS.Proveedores,
    'WhatsApp','Estado postulación','Productos'
  ])
});


function viewerProjectRecord(row,table,fieldsByTable=VIEWER_READ_FIELDS){
  const allowed=fieldsByTable[table];
  const fields=Object.fromEntries(Object.entries(row.fields)
    .filter(([key])=>allowed.has(key)));
  return {id:row.id,fields,
    ...(typeof row.createdTime==='string'?{createdTime:row.createdTime}:{})};
}
async function viewerScopedRead(request,url,env,CORS,fieldsByTable=VIEWER_READ_FIELDS){
  if(request.method!=='GET'||!env.AIRTABLE_TOKEN)
    return json({error:'Viewer access unavailable'},403,CORS);
  const prefix='/v0/app1YtD74AqiPWQhy/';
  const path=url.pathname.startsWith('/v0/')?url.pathname:'/v0'+url.pathname;
  if(!path.startsWith(prefix))return json({error:'Viewer route denied'},403,CORS);
  const parts=path.slice(prefix.length).split('/');
  let table;
  try{table=decodeURIComponent(parts[0]);}catch(_){}
  if(!Object.hasOwn(fieldsByTable,table||'')||
     parts[0]!==encodeURIComponent(table)||parts.length>2||
     (parts.length===2&&!/^rec[A-Za-z0-9]{14}$/.test(parts[1])))
    return json({error:'Viewer route denied'},403,CORS);
  const single=parts.length===2;
  const query=new URLSearchParams(url.search);
  if(single&&url.search)return json({error:'Viewer record queries are not supported'},422,CORS);
  if(!single){
    const keys=[...query.keys()],fields=query.getAll('fields[]');
    if(keys.some(key=>!['pageSize','maxRecords','offset','fields[]'].includes(key))||
       [...new Set(keys.filter(key=>key!=='fields[]'))]
         .some(key=>query.getAll(key).length!==1)||
       fields.length>30||new Set(fields).size!==fields.length||
       fields.some(field=>!fieldsByTable[table].has(field))||
       [...query.values()].some(value=>value.length>600))
      return json({error:'Unsafe viewer query denied'},422,CORS);
    for(const key of ['pageSize','maxRecords']){
      if(query.has(key)&&(!/^[1-9]\d{0,2}$/.test(query.get(key))||
         Number(query.get(key))>(key==='pageSize'?100:500)))
        return json({error:'Invalid viewer page size'},422,CORS);
    }
    query.delete('fields[]');
    for(const field of (fields.length?fields:fieldsByTable[table]))
      query.append('fields[]',field);
  }
  let upstream;
  try{
    upstream=await fetch(AIRTABLE_BASE+path+(single?'':'?'+query.toString()),{
      method:'GET',redirect:'manual',
      headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,Accept:'application/json'}
    });
  }catch(_){return json({error:'Viewer upstream unavailable'},502,CORS);}
  if(upstream.status===404)return json({error:'Record not found'},404,CORS);
  if(!upstream.ok||upstream.status>=300&&upstream.status<400)
    return json({error:'Viewer upstream rejected request'},502,CORS);
  let data;
  try{data=await upstream.json();}catch(_){
    return json({error:'Viewer upstream response invalid'},502,CORS);
  }
  const rows=single?[data]:data?.records;
  if(!Array.isArray(rows)||rows.length>(single?1:100)||
     rows.some(row=>!row||!/^rec[A-Za-z0-9]{14}$/.test(row.id)||
       !row.fields||typeof row.fields!=='object'||Array.isArray(row.fields)))
    return json({error:'Viewer response integrity failure'},502,CORS);
  if(!single&&(data.offset!==undefined&&
       (typeof data.offset!=='string'||data.offset.length>600)))
    return json({error:'Viewer pagination integrity failure'},502,CORS);
  const safe=single?viewerProjectRecord(data,table,fieldsByTable):{
    records:rows.map(row=>viewerProjectRecord(row,table,fieldsByTable)),
    ...(data.offset===undefined?{}:{offset:data.offset})
  };
  return json(safe,200,{...CORS,'Cache-Control':'private, no-store'});
}

const SELLER_SCOPE_NAMES=new Set(['florencia','nicanor','gustavo']);

/* Strict, schema-verified response projection for signed sales sessions.
 * A table-scoped JWT must not expose all fields of an owned CRM record:
 * bank details, internal cost/margin, fiscal links, attachments, agents'
 * unrestricted JSON and future schema fields are not part of sales access.
 * Related-record IDs are intentionally omitted until link-owner verification
 * is implemented; a linked client may belong to a different salesperson.
 */
const SELLER_READ_FIELDS=Object.freeze({
  Clientes:new Set([
    'Empresa','Contacto','Cargo contacto','Teléfono','Email',
    'Fecha primer contacto','Notas internas','Notas followup','RUT',
    'Dirección','Comuna','Región','Sitio web','Industria / Rubro',
    'Fecha último pedido','Etapa venta','Origen lead','Estado cuenta',
    'Vendedor','Lead Score IA','Servicio interés','Próxima acción IA',
    'Resumen IA','Tipo de cliente','Suscrito newsletter','Email válido',
    'Validado','Reactivado','Fecha reactivación'
  ]),
  Cotizaciones:new Set([
    'N° Cotización','Estado cotización','Fecha cotización',
    'Fecha vencimiento','Fecha aprobación','Solicitud cliente (texto libre)',
    'Subtotal (CLP)','Urgencia (+25%)','Total final (CLP)','Notas cotización',
    'Canal solicitud','Cantidad','Motivo rechazo','Forma de pago',
    'Tiempo de producción','Tipo días producción','Vendedor','Descuento (%)',
    'Alias / Título','Tiempo de producción máx','Fecha de entrega',
    'Fecha límite cotización'
  ]),
  Pedidos:new Set([
    'N° Pedido','Fecha ingreso','Fecha entrega','Urgente','Fecha despacho',
    'Followup enviado','Mensaje followup','Monto total (CLP)',
    'Dirección despacho','N° seguimiento courier','Prioridad','Resultado QA',
    'Motivo rechazo QA','Texto a grabar / imprimir','Texto confirmado por cliente',
    'Material','Cantidad','Estado pedido','Etapa producción',
    'Equipo asignado','Tipo despacho','Tipo documento','Notas pedido',
    'Vendedor','Fecha objetivo interna'
  ])
});
function sellerProjectRecord(row,table){
  const allowed=SELLER_READ_FIELDS[table];
  const fields=Object.fromEntries(Object.entries(row.fields)
    .filter(([name])=>allowed.has(name)));
  const result={id:row.id,fields};
  if(typeof row.createdTime==='string')result.createdTime=row.createdTime;
  return result;
}

// Relationship IDs are visible ONLY after independently checking the Vendedor
// of each referenced record. This intentionally runs for an explicit single
// record opt-in, not for 100-row pages with unbounded nested joins.
const SELLER_LINK_TABLES=Object.freeze({
  Clientes:Object.freeze({Pedidos:'Pedidos',Cotizaciones:'Cotizaciones'}),
  Cotizaciones:Object.freeze({Cliente:'Clientes',Pedido:'Pedidos'}),
  Pedidos:Object.freeze({Cliente:'Clientes',Cotizaciones:'Cotizaciones'})
});
async function sellerVerifiedLinks(row,table,seller,env){
  const names=SELLER_LINK_TABLES[table],byTarget=new Map(),source=new Map();
  let total=0;
  for(const [field,target] of Object.entries(names)){
    if(!Object.hasOwn(row.fields,field))continue;
    const ids=row.fields[field];
    if(!Array.isArray(ids)||ids.length>25||
       ids.some(id=>typeof id!=='string'||!/^rec[A-Za-z0-9]{14}$/.test(id)))
      throw Error('Invalid CRM link structure');
    total+=ids.length;
    source.set(field,ids);
    if(!byTarget.has(target))byTarget.set(target,new Set());
    for(const id of ids)byTarget.get(target).add(id);
  }
  if(total>25)throw Error('Too many CRM links to verify');
  const verified=new Map();
  for(const [target,ids] of byTarget){
    const approved=new Set();
    if(ids.size){
      const quoted=[...ids].map(id=>'RECORD_ID()="'+id+'"');
      const predicate=quoted.length===1?quoted[0]:'OR('+quoted.join(',')+')';
      const query=new URLSearchParams({
        filterByFormula:'AND({Vendedor}="'+seller+'",'+predicate+')',
        pageSize:'100'
      });
      query.append('fields[]','Vendedor');
      const url=AIRTABLE_BASE+SCOPED_CRM_PREFIX+encodeURIComponent(target)+'?'+query;
      const res=await fetch(url,{method:'GET',redirect:'manual',headers:{
        Authorization:'Bearer '+env.AIRTABLE_TOKEN,Accept:'application/json'
      }});
      if(!res.ok||res.status>=300&&res.status<400)
        throw Error('Cannot verify related-record owner');
      const body=await res.json();
      if(!body||!Array.isArray(body.records)||body.records.length>ids.size||
         body.offset!==undefined)throw Error('Invalid linked-record verification');
      for(const linked of body.records){
        if(!linked||!ids.has(linked.id)||approved.has(linked.id)||
           sellerFieldName(linked)!==seller)
          throw Error('Invalid linked-record ownership');
        approved.add(linked.id);
      }
    }
    verified.set(target,approved);
  }
  const result={};
  for(const [field,ids] of source){
    const allowed=verified.get(names[field]);
    result[field]=ids.filter(id=>allowed.has(id));
  }
  return result;
}


const SELLER_SAFE_PATCH_FIELDS=Object.freeze({
  // Direct lead-worker updates Cargo contacto for returning leads; exclude it
  // until that writer is serialized through the same guard.
  Clientes:new Set(['Notas internas','Notas followup','Contacto','Teléfono']),
  // The public customer portal writes Notas cotización on rejection. No
  // overlapping sales edits until its writer participates in the same lock.
  Cotizaciones:new Set(),
  // Pedidos' internal production notes are deliberately absent from the
  // sales read projection; permit only the visible customer-facing notes.
  Pedidos:new Set(['Notas pedido'])
});
const SELLER_SAFE_PATCH_MAX_BYTES=12288;
const SCOPED_CRM_PREFIX='/v0/app1YtD74AqiPWQhy/';
function sellerScopedPatchShape(table,body){
  if(!body||typeof body!=='object'||Array.isArray(body)||
     Object.keys(body).length!==2||!Object.hasOwn(body,'fields')||
     !Object.hasOwn(body,'expected_fields'))return false;
  const {fields,expected_fields:expected}=body;
  if(!fields||typeof fields!=='object'||Array.isArray(fields)||
     !expected||typeof expected!=='object'||Array.isArray(expected))return false;
  const keys=Object.keys(fields);
  if(!keys.length||keys.length>5||Object.keys(expected).length!==keys.length)return false;
  const allowed=SELLER_SAFE_PATCH_FIELDS[table];
  return !!allowed&&keys.every(key=>
    allowed.has(key)&&SELLER_READ_FIELDS[table]?.has(key)&&
    Object.hasOwn(expected,key)&&
    typeof fields[key]==='string'&&
    typeof expected[key]==='string'&&
    fields[key].length<=(key.includes('Notas')?4000:256)&&
    expected[key].length<=(key.includes('Notas')?4000:256)&&
    !/[\x00-\x08\x0b\x0e-\x1f]/.test(fields[key]));
}
// Only a narrow PATCH is eligible. It is deliberately opt-in until *all*
// owner-changing integrations, including direct Airtable/Make writers, have
// been inventoried; the DO cannot atomically lock an external Airtable writer.
async function sellerScopedWrite(request,url,identity,env,CORS){
  if(request.method!=='PATCH'||!SELLER_SCOPE_NAMES.has(identity?.seller))
    return json({error:'Scoped sales write denied'},403,CORS);
  if(String(env.ACCESS_SALES_WRITES_ENABLED||'').toLowerCase()!=='true')
    return json({error:'Sales writes are disabled pending single-writer cutover',
      code:'SALES_WRITE_CUTOVER_REQUIRED'},503,CORS);
  if(!env.CRM_MUTATION_GUARD||!env.AIRTABLE_TOKEN)
    return json({error:'Sales write guard unavailable'},503,CORS);
  const path=url.pathname.startsWith('/v0/')?url.pathname:'/v0'+url.pathname;
  const m=/^\/v0\/app1YtD74AqiPWQhy\/([^/]+)\/(rec[A-Za-z0-9]{14})$/.exec(path);
  let table;
  try{table=m&&decodeURIComponent(m[1]);}catch(_){}
  if(!m||!SELLER_SCOPE_TABLES.has(table)||m[1]!==encodeURIComponent(table)||url.search)
    return json({error:'Scoped sales write path denied'},403,CORS);
  if(!/^application\/json(?:;|$)/i.test(String(request.headers.get('Content-Type')||''))||
     Number(request.headers.get('Content-Length')||0)>SELLER_SAFE_PATCH_MAX_BYTES)
    return json({error:'Expected a bounded JSON sales patch'},415,CORS);
  let body;
  try{
    const raw=await request.text();
    if(raw.length>SELLER_SAFE_PATCH_MAX_BYTES)throw Error('Oversized sales patch');
    body=JSON.parse(raw);
  }catch(_){return json({error:'Invalid sales patch body'},422,CORS);}
  if(!sellerScopedPatchShape(table,body))
    return json({error:'Sales patch contains unsupported or missing expected fields'},422,CORS);
  try{
    const id=env.CRM_MUTATION_GUARD.idFromName('tls-crm-global');
    const stub=env.CRM_MUTATION_GUARD.get(id);
    const guarded=await stub.fetch('https://crm-write.internal/scoped-patch',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({table,recordId:m[2],method:'PATCH',body,
        actor:{email:identity.email,role:'sales',seller:identity.seller}})
    });
    const headers=new Headers(guarded.headers);
    Object.entries(CORS).forEach(([k,v])=>headers.set(k,v));
    headers.set('Cache-Control','private, no-store');
    return new Response(guarded.body,{status:guarded.status,headers});
  }catch(_){return json({error:'Sales write guard unavailable'},503,CORS);}
}
// Route every signed admin/operator/finance PATCH of a commercial table to
// the SAME DO queue. This prevents a proxied reassignment from interleaving
// between a sales ownership check and the associated PATCH.
async function privilegedScopedPatch(request,url,identity,env,CORS,table){
  if(!env.CRM_MUTATION_GUARD)
    return json({error:'Scoped CRM write guard unavailable'},503,CORS);
  const path=url.pathname.startsWith('/v0/')?url.pathname:'/v0'+url.pathname;
  if(!path.startsWith(SCOPED_CRM_PREFIX+encodeURIComponent(table))||
     (url.search.length>1000))
    return json({error:'Scoped CRM write path denied'},403,CORS);
  let raw;
  try{
    if(Number(request.headers.get('Content-Length')||0)>262144)
      throw Error('Oversized patch');
    raw=await request.text();
    if(raw.length>262144)throw Error('Oversized patch');
  }catch(_){return json({error:'CRM patch exceeds supported size'},413,CORS);}
  try{
    const id=env.CRM_MUTATION_GUARD.idFromName('tls-crm-global');
    const stub=env.CRM_MUTATION_GUARD.get(id);
    const guarded=await stub.fetch('https://crm-write.internal/scoped-patch',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({table,method:'PATCH',body:raw,path,search:url.search,
        actor:{email:identity.email,role:identity.role}})
    });
    const headers=new Headers(guarded.headers);
    Object.entries(CORS).forEach(([k,v])=>headers.set(k,v));
    headers.set('Cache-Control','private, no-store');
    return new Response(guarded.body,{status:guarded.status,headers});
  }catch(_){return json({error:'Scoped CRM write guard unavailable'},503,CORS);}
}

function sellerFieldName(row){
  const value=row?.fields?.Vendedor;
  return typeof value==='string'?value:
    value&&typeof value==='object'&&typeof value.name==='string'?value.name:'';
}
// This is a separate, signed-identity route. It intentionally never calls
// the generic Airtable proxy, exposes no unscoped fallback and never writes.
async function sellerScopedRead(request,url,identity,env,CORS){
  if(request.method!=='GET'||!SELLER_SCOPE_NAMES.has(identity?.seller)||
     !env.AIRTABLE_TOKEN)
    return json({error:'Scoped sales access unavailable'},403,CORS);
  const path=url.pathname.startsWith('/v0/')?url.pathname:'/v0'+url.pathname;
  const prefix='/v0/app1YtD74AqiPWQhy/';
  if(!path.startsWith(prefix))return json({error:'Scoped sales route denied'},403,CORS);
  const parts=path.slice(prefix.length).split('/');
  let table;
  try{table=decodeURIComponent(parts[0]);}catch(_){
    return json({error:'Invalid sales table path'},403,CORS);
  }
  if(!SELLER_SCOPE_TABLES.has(table)||parts[0]!==encodeURIComponent(table)||
     parts.length>2||(parts.length===2&&!/^rec[A-Za-z0-9]{14}$/.test(parts[1])))
    return json({error:'Scoped sales route denied'},403,CORS);
  const single=parts.length===2;
  // A related-record join is available only for an already owned single
  // record. Never accept caller-supplied target IDs, filters or link tables.
  const includeVerifiedLinks=single&&url.search==='?includeVerifiedLinks=1';
  if(single&&url.search&&!includeVerifiedLinks)
    return json({error:'Unscoped record query forbidden'},422,CORS);
  const query=new URLSearchParams(url.search);
  if(!single){
    // Never pass arbitrary formulas, sorts or views to Airtable. Even if
    // returned rows are redacted, an attacker can infer bank/cost values via
    // boolean filters, result counts or sort order.
    const allowed=/^(?:fields\[\]|pageSize|maxRecords|offset)$/;
    const readFields=SELLER_READ_FIELDS[table];
    if([...query.keys()].some(k=>!allowed.test(k))||
       [...new Set([...query.keys()].filter(k=>k!=='fields[]'))]
         .some(k=>query.getAll(k).length!==1)||
       query.getAll('fields[]').length>30||
       [...query.values()].some(v=>v.length>600)||
       query.getAll('fields[]').some(name=>!readFields.has(name)))
      return json({error:'Unsupported scoped sales query'},422,CORS);
    for(const key of ['pageSize','maxRecords']){
      if(query.has(key)&&(!/^[1-9]\d{0,2}$/.test(query.get(key))||
         Number(query.get(key))>(key==='pageSize'?100:500)))
        return json({error:'Invalid scoped sales page size'},422,CORS);
    }
    // Airtable selects are compared by the verified live Vendedor choice;
    // all unrelated legacy records (missing Vendedor) remain unassigned.
    const owner='{Vendedor}="'+identity.seller+'"';
    query.set('filterByFormula',owner);
    // Fetch only approved fields upstream as well as sanitizing the outgoing
    // response. The owner column is mandatory for every individual row.
    const projection=query.getAll('fields[]');
    const requested=projection.length?projection:[...readFields];
    if(projection.length)query.delete('fields[]');
    if(!requested.includes('Vendedor'))requested.push('Vendedor');
    for(const name of requested)query.append('fields[]',name);
  }
  const target=AIRTABLE_BASE+path+(single?'':'?'+query.toString());
  let upstream;
  try{
    upstream=await fetch(target,{method:'GET',redirect:'manual',
      headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,Accept:'application/json'}});
  }catch(_){return json({error:'Scoped sales upstream unavailable'},502,CORS);}
  if(upstream.status===404)return json({error:'Record not found'},404,CORS);
  if(!upstream.ok||upstream.status>=300&&upstream.status<400)
    return json({error:'Scoped sales upstream rejected the request'},502,CORS);
  let body;
  try{body=await upstream.json();}catch(_){
    return json({error:'Scoped sales response invalid'},502,CORS);
  }
  const rows=single?[body]:body?.records;
  if(!Array.isArray(rows)||rows.length>(single?1:100)||
     rows.some(row=>!row||!/^rec[A-Za-z0-9]{14}$/.test(row.id)||
       !row.fields||typeof row.fields!=='object'||Array.isArray(row.fields)||
       sellerFieldName(row)!==identity.seller)){
    // A stale/noncompliant Airtable filter must NEVER leak even one record.
    return json({error:single?'Record not found':'Scoped sales integrity error'},
      single?404:502,CORS);
  }
  if(!single&&(body.offset!==undefined&&
      (typeof body.offset!=='string'||body.offset.length>600)))
    return json({error:'Scoped sales paging invalid'},502,CORS);
  const safe=single?sellerProjectRecord(body,table):{
    records:rows.map(row=>sellerProjectRecord(row,table)),
    ...(body.offset===undefined?{}:{offset:body.offset})
  };
  if(includeVerifiedLinks){
    try{
      const links=await sellerVerifiedLinks(body,table,identity.seller,env);
      // The source owner and its links might have changed while its related
      // rows were being verified, particularly via Airtable/Make writers that
      // do not enter our Durable Object. Re-fetch the source before releasing
      // either its projected fields or any verified linked IDs.
      const refreshed=await fetch(target,{method:'GET',redirect:'manual',
        headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,Accept:'application/json'}});
      if(!refreshed.ok||refreshed.status>=300&&refreshed.status<400)
        throw Error('CRM source recheck failed');
      const latest=await refreshed.json();
      if(!latest||latest.id!==body.id||!latest.fields||
         typeof latest.fields!=='object'||Array.isArray(latest.fields)||
         sellerFieldName(latest)!==identity.seller)
        throw Error('CRM source owner changed during linked-record verification');
      for(const field of Object.keys(SELLER_LINK_TABLES[table])){
        const before=body.fields[field]??[],after=latest.fields[field]??[];
        if(!Array.isArray(before)||!Array.isArray(after)||
           before.length!==after.length||
           before.some((id,i)=>id!==after[i]))
          throw Error('CRM source relations changed during verification');
      }
      // Release the most recent safe projection, not stale source attributes.
      const latestSafe=sellerProjectRecord(latest,table);
      Object.assign(latestSafe.fields,links);
      return json(latestSafe,200,{...CORS,'Cache-Control':'private, no-store'});
    }catch(_){
      // A partial or unverifiable join must not return its source row as if
      // the requested verification had succeeded.
      return json({error:'Cannot verify related CRM ownership'},502,CORS);
    }
  }
  return json(safe,200,{...CORS,'Cache-Control':'private, no-store'});
}

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const OPENAI_BASE = 'https://api.openai.com';
// Defensa de costo en el servidor: aunque alguien manipule el JavaScript del
// navegador, el proxy nunca permite Opus, Fable ni modelos futuros no revisados.
const ANTHROPIC_ALLOWED_MODELS = new Set([
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
]);
const ANTHROPIC_MAX_OUTPUT_TOKENS = 4000;
const ANTHROPIC_DAILY_BUDGET_USD_DEFAULT = 0.50;
const ANTHROPIC_REQUEST_BUDGET_USD_DEFAULT = 0.10;

// OpenAI comparte el MISMO presupuesto global diario que Anthropic. El objetivo
// no es estimar la factura al centavo sino impedir que una credencial expuesta
// pueda producir gasto ilimitado. Los importes son reservas conservadoras.
const OPENAI_ALLOWED_CHAT_MODELS = new Set(['gpt-4o-mini']);
const OPENAI_ALLOWED_IMAGE_MODELS = new Set(['gpt-image-1']);
const OPENAI_MAX_CHAT_OUTPUT_TOKENS = 300;
const OPENAI_ESTIMATED_COST_USD = {
  chat: 0.01,
  imageGenerationLow: 0.03,
  imageEditLow: 0.08,
};

// Una reserva representa una llamada en curso. El cliente corta las llamadas a los 60 s,
// así que cualquier reserva de más de 2 min es huérfana y no debe bloquear el día.
const AI_RESERVATION_STALE_MS = 2 * 60 * 1000;
const ANTHROPIC_PRICES = {
  haiku: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.10 },
  sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
};

// Solo se aceptan peticiones desde estos orígenes (el dashboard). Esto reduce
// abuso desde otros sitios en un navegador, pero NO es autenticación de usuario:
// APP_KEY puede estar en el cliente y un cliente HTTP puede falsificar Origin.
// Por eso las rutas caras tienen allowlist + presupuesto y Airtable requiere una
// futura capa de autorización server-side por usuario/rol.
const ALLOWED_ORIGINS = [
  'https://dashboard.thelab.solutions',
  'https://thelabsolutionscl.github.io',
];
const CORS_BASE = {
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-App-Key,X-AI-Agent,anthropic-version,x-api-key',
  'Vary': 'Origin',
};
// Solo el bootstrap de esquemas que realmente usa TLS. Una APP_KEY visible
// no debe poder borrar, renombrar ni inventar tablas/campos administrativos.
// Al introducir otro campo legítimo, revisar esta lista en código y sus pruebas.
const SCHEMA_BOOTSTRAP_TABLES = new Set(['Maquinas','Maquinas_Eventos','Maquinas_Mant','Equipo_Eventos','Facturas','Inventario']);
const SCHEMA_BOOTSTRAP_FIELDS = Object.freeze({
  "cam": ["singleLineText"],
  "Cliente": ["singleLineText"],
  "Cliente ID": ["singleLineText"],
  "color": ["singleLineText"],
  "Consumo materiales": ["multilineText"],
  "Costo mano de obra (CLP)": ["currency"],
  "Costo material real (CLP)": ["currency"],
  "Costo real total (CLP)": ["currency"],
  "desc": ["singleLineText"],
  "Detalle JSON": ["multilineText"],
  "estado": ["singleLineText"],
  "Estado Pago": ["singleLineText"],
  "Estado SII": ["singleLineText"],
  "Exento": ["number"],
  "fecha": ["date"],
  "Fecha": ["date"],
  "Fecha de entrega": ["date"],
  "Fecha límite cotización": ["date"],
  "Fecha Vencimiento": ["date"],
  "Ficha Propuesta": ["multilineText"],
  "Ficha Tecnica": ["multilineText"],
  "Folio": ["number"],
  "Forma de pago": ["singleSelect"],
  "Historial fechas calendario": ["multilineText"],
  "hora_fin": ["singleLineText"],
  "hora_inicio": ["singleLineText"],
  "Horas máquina reales": ["number"],
  "id": ["singleLineText"],
  "ip": ["singleLineText"],
  "IVA": ["number"],
  "Máquina asignada": ["singleLineText"],
  "maquina_id": ["singleLineText"],
  "Material": ["singleLineText"],
  "modelo": ["singleLineText"],
  "N° Cotización": ["singleLineText"],
  "N° Pedido": ["singleLineText"],
  "Neto": ["number"],
  "nombre": ["singleLineText"],
  "notas": ["multilineText"],
  "Notas": ["singleLineText"],
  "num": ["number"],
  "numG": ["number"],
  "pedido_id": ["singleLineText"],
  "persona_id": ["singleLineText"],
  "print_hours": ["number"],
  "Punto de reorden": ["number"],
  "repuestos": ["multilineText"],
  "Stock actual": ["number"],
  "SUBTOTAL": ["currency"],
  "tiempo": ["number"],
  "Tiempo de producción": ["number"],
  "Tiempo de producción máx": ["number"],
  "tipo": ["singleLineText"],
  "Tipo días producción": ["singleLineText"],
  "Tipo DTE": ["singleLineText"],
  "Total": ["number"],
  "TOTAL CON IVA": ["currency"],
  "Track ID": ["singleLineText"],
  "ts": ["number"],
  "Unidad": ["singleLineText"],
});
const SCHEMA_FIELD_TYPES = new Set(['singleLineText','multilineText','number','currency','date','singleSelect','multipleSelects','multipleRecordLinks','checkbox','url','email','phoneNumber','attachment','dateTime']);
function schemaFieldAllowed(field) {
  if (!field || typeof field.name !== 'string' || !SCHEMA_FIELD_TYPES.has(field.type)) return false;
  const exact = SCHEMA_BOOTSTRAP_FIELDS[field.name];
  if (exact) return exact.includes(field.type);
  const item = /^(ITEM|UNIDADES|COSTO NETO|VALOR NETO)([1-9]|1[0-9]|20)$/.exec(field.name);
  if (!item) return false;
  return field.type === ({ITEM:'singleLineText', UNIDADES:'number', 'COSTO NETO':'currency', 'VALOR NETO':'currency'})[item[1]];
}
// Headers CORS reflejando el origen permitido (si no, el principal).
function cors(origin) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return { 'Access-Control-Allow-Origin': allow, ...CORS_BASE };
}


// ISO week derived from the report's LOCAL reporting date (YYYY-MM-DD).
// Date-only UTC arithmetic avoids DST and browser timezone discrepancies.
function reportIsoWeekFromDate(value) {
  const date=String(value||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return '';
  const d=new Date(date+'T12:00:00Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date)return '';
  const t=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));
  const dow=t.getUTCDay()||7;
  t.setUTCDate(t.getUTCDate()+4-dow);
  const y=t.getUTCFullYear(),first=new Date(Date.UTC(y,0,1));
  const w=Math.ceil((((t-first)/86400000)+1)/7);
  return y+'-W'+String(w).padStart(2,'0');
}
function reportWeekValid(week) {
  const m=/^(\d{4})-W(\d{2})$/.exec(String(week||''));
  return !!m&&Number(m[2])>=1&&Number(m[2])<=
    Number(reportIsoWeekFromDate(m[1]+'-12-28').slice(-2));
}

/**
 * Contador de costo Anthropic con serialización real.
 *
 * KV se mantiene únicamente para migrar el saldo del día del guard anterior.
 * Todas las decisiones nuevas de presupuesto pasan por UNA instancia de este
 * Durable Object, evitando el read -> modify -> write concurrente de KV.
 */
export class AiBudgetGuard {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this._queue = Promise.resolve();
  }

  fetch(request) {
    // Una sola cola por Durable Object: reserva/reconciliación/lectura nunca
    // observan el mismo saldo en paralelo.
    const run = this._queue.then(() => this._handle(request));
    this._queue = run.catch(() => {});
    return run;
  }

  async _handle(request) {
    if (request.method !== 'POST') return this._json({ error: 'Method not allowed' }, 405);
    let payload = {};
    try { payload = await request.json(); }
    catch (_) { return this._json({ error: 'Invalid budget payload' }, 400); }

    const url = new URL(request.url);
    const date = String(payload.date || aiChileDate()).slice(0, 10);
    const budget = Math.max(0.05, Number(payload.budget_usd) || ANTHROPIC_DAILY_BUDGET_USD_DEFAULT);
    const perRequest = Math.max(0.01, Number(payload.request_budget_usd) || ANTHROPIC_REQUEST_BUDGET_USD_DEFAULT);
    const maxConcurrent = Math.max(1, Math.min(4, Number(payload.max_concurrent) || 1));
    const loaded = await this._load(date);
    const row = loaded.row;

    if (url.pathname === '/usage') {
      return this._json(this._snapshot(date, budget, perRequest, row));
    }

    if (url.pathname === '/reserve') {
      const estimate = Math.max(0, Number(payload.estimated_request_usd) || 0);
      const source = sanitizeAiSource(payload.source || 'dashboard');
      const model = String(payload.model || '');

      if (estimate > perRequest) {
        const snap = this._snapshot(date, budget, perRequest, row);
        return this._json({
          ok: false, status: 429, error: 'AI request exceeds per-request cost limit',
          budget_usd: budget, used_usd: snap.used_usd, estimated_request_usd: estimate,
        });
      }

      const active = Object.keys(row.reservations || {}).length;
      if (active >= maxConcurrent) {
        const snap = this._snapshot(date, budget, perRequest, row);
        return this._json({
          ok: false, status: 429, error: 'Too many concurrent AI requests',
          budget_usd: budget, used_usd: snap.used_usd, estimated_request_usd: estimate,
        });
      }

      const snap = this._snapshot(date, budget, perRequest, row);
      if (snap.used_usd + estimate > budget) {
        return this._json({
          ok: false, status: 429, error: 'Daily AI budget reached',
          budget_usd: budget, used_usd: snap.used_usd, estimated_request_usd: estimate,
        });
      }

      const reservationId = (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
        ? globalThis.crypto.randomUUID()
        : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
      row.reservations = row.reservations || {};
      row.reservations[reservationId] = {
        estimate, source, model, at: new Date().toISOString(),
      };
      row.requests = Math.max(0, Number(row.requests) || 0) + 1;
      row.by_source = row.by_source || {};
      const src = row.by_source[source] || { requests: 0, spent_usd: 0 };
      src.requests = Math.max(0, Number(src.requests) || 0) + 1;
      src.spent_usd = Math.max(0, Number(src.spent_usd) || 0);
      row.by_source[source] = src;
      row.updated_at = new Date().toISOString();
      await this._save(loaded.key, row);

      return this._json({
        ok: true, date, reservation_id: reservationId, source, estimate, model,
        budget_usd: budget, used_usd: snap.used_usd, estimated_request_usd: estimate,
      });
    }

    if (url.pathname === '/release') {
      const reservationId = String(payload.reservation_id || '');
      row.reservations = row.reservations || {};
      row.finalized = row.finalized || {};
      if (!row.finalized[reservationId]) {
        delete row.reservations[reservationId];
        row.finalized[reservationId] = { kind: 'release', at: new Date().toISOString() };
      }
      row.last_release_reason = String(payload.reason || 'no_usage').slice(0, 80);
      row.updated_at = new Date().toISOString();
      await this._save(loaded.key, row);
      return this._json({ ok: true });
    }

    if (url.pathname === '/reconcile') {
      const reservationId = String(payload.reservation_id || '');
      row.reservations = row.reservations || {};
      row.finalized = row.finalized || {};

      // Idempotencia: un waitUntil repetido o una entrega duplicada no cobra dos veces.
      if (row.finalized[reservationId]) return this._json({ ok: true, already_finalized: true });

      const reservation = row.reservations[reservationId] || null;
      const actual = Math.max(0, Number(payload.actual_usd) || 0);
      const source = sanitizeAiSource((reservation && reservation.source) || payload.source || 'dashboard');
      delete row.reservations[reservationId];

      row.spent_usd = Math.max(0, Number(row.spent_usd) || 0) + actual;
      row.by_source = row.by_source || {};
      const src = row.by_source[source] || { requests: 0, spent_usd: 0 };
      src.spent_usd = Math.max(0, Number(src.spent_usd) || 0) + actual;
      src.requests = Math.max(0, Number(src.requests) || 0);
      row.by_source[source] = src;
      row.finalized[reservationId] = { kind: 'reconcile', at: new Date().toISOString() };
      row.updated_at = new Date().toISOString();
      await this._save(loaded.key, row);
      return this._json({ ok: true, actual_usd: actual });
    }

    return this._json({ error: 'Unknown budget operation' }, 404);
  }

  async _load(date) {
    const key = 'anthropic-budget:' + date;
    let row = await this.state.storage.get(key);

    // Primer acceso después del deploy: migra el saldo KV del día de forma
    // conservadora. Las reservas agregadas antiguas se consideran ya gastadas,
    // así el cambio de guard NO regala presupuesto adicional a mitad del día.
    if (!row || typeof row !== 'object') {
      row = { spent_usd: 0, requests: 0, by_source: {}, reservations: {}, finalized: {} };
      try {
        const legacyRaw = this.env && this.env.AI_BUDGET ? await this.env.AI_BUDGET.get(key) : null;
        const legacy = legacyRaw ? JSON.parse(legacyRaw) : null;
        if (legacy && typeof legacy === 'object') {
          row.spent_usd = Math.max(0, Number(legacy.spent_usd) || 0) +
            Math.max(0, Number(legacy.reserved_usd) || 0);
          row.requests = Math.max(0, Number(legacy.requests) || 0);
          row.by_source = {};
          for (const [name, value] of Object.entries(legacy.by_source || {})) {
            row.by_source[sanitizeAiSource(name)] = {
              requests: Math.max(0, Number(value && value.requests) || 0),
              spent_usd: Math.max(0, Number(value && value.spent_usd) || 0) +
                Math.max(0, Number(value && value.reserved_usd) || 0),
            };
          }
          row.migrated_from_kv = true;
          row.migrated_at = new Date().toISOString();
        }
      } catch (_) {}
    }

    row.reservations = row.reservations || {};
    row.finalized = row.finalized || {};
    row.by_source = row.by_source || {};

    const now = Date.now();
    let dirty = false;
    for (const [id, reservation] of Object.entries(row.reservations)) {
      const at = Date.parse(reservation && reservation.at || '');
      if (!Number.isFinite(at) || now - at > AI_RESERVATION_STALE_MS) {
        delete row.reservations[id];
        dirty = true;
      }
    }
    for (const [id, finalized] of Object.entries(row.finalized)) {
      const at = Date.parse(finalized && finalized.at || '');
      if (!Number.isFinite(at) || now - at > 24 * 60 * 60 * 1000) {
        delete row.finalized[id];
        dirty = true;
      }
    }
    if (dirty) {
      row.recovered_stale_reservation_at = new Date().toISOString();
      row.updated_at = row.recovered_stale_reservation_at;
    }
    if (dirty || row.migrated_from_kv) await this._save(key, row);
    return { key, row };
  }

  async _save(key, row) {
    await this.state.storage.put(key, row);
  }

  _snapshot(date, budget, perRequest, row) {
    let reserved = 0;
    const bySource = {};
    for (const [name, src] of Object.entries(row.by_source || {})) {
      bySource[name] = {
        requests: Math.max(0, Number(src && src.requests) || 0),
        spent_usd: Math.max(0, Number(src && src.spent_usd) || 0),
        reserved_usd: 0,
      };
    }
    for (const reservation of Object.values(row.reservations || {})) {
      const estimate = Math.max(0, Number(reservation && reservation.estimate) || 0);
      reserved += estimate;
      const source = sanitizeAiSource(reservation && reservation.source || 'dashboard');
      bySource[source] = bySource[source] || { requests: 0, spent_usd: 0, reserved_usd: 0 };
      bySource[source].reserved_usd += estimate;
    }
    const spent = Math.max(0, Number(row.spent_usd) || 0);
    return {
      configured: true, atomic: true, date, budget_usd: budget, request_budget_usd: perRequest,
      spent_usd: spent, reserved_usd: reserved, used_usd: spent + reserved,
      remaining_usd: Math.max(0, budget - spent - reserved),
      requests: Math.max(0, Number(row.requests) || 0),
      by_source: bySource, updated_at: row.updated_at || null,
    };
  }

  _json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Serializa TODAS las altas de Pedidos/Cotizaciones recibidas por este proxy.
 * El GET y el POST se ejecutan dentro de la misma cola del mismo Durable
 * Object (nombre global): dos equipos nunca pasan la comprobación a la vez.
 * Ante respuesta ambigua no repetimos el POST: dejamos una marca persistente
 * que se resuelve leyendo Airtable o mediante conciliación administrativa.
 *
 * Contiene duplicados por rutas del proxy. No sustituye identidad server-side
 * ni evita escrituras hechas fuera de este Worker con otro PAT.
 */
export class CrmMutationGuard {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this._queue = Promise.resolve();
  }
  fetch(request) {
    const path=new URL(request.url).pathname;
    const run = this._queue.then(() => path==='/marketing/spend'
      ?this._handleSpend(request):path==='/shared-calendar'
        ?this._handleSharedCalendar(request):path==='/shared-agenda'
          ?this._handleSharedAgenda(request):path==='/shared-mail'
            ?this._handleSharedMail(request):path==='/shared-machineops'
              ?this._handleSharedMachineOps(request):path==='/shared-simulation'
                ?this._handleSharedSimulation(request):path==='/scoped-patch'
                  ?this._handleScopedPatch(request):this._handle(request));
    this._queue = run.catch(() => {});
    return run;
  }
  _json(data, status) {
    return new Response(JSON.stringify(data), {
      status, headers: { 'Content-Type': 'application/json' },
    });
  }
  async _handleSharedCalendar(request){
    if(request.method!=='POST'||!this.env.AIRTABLE_TOKEN)
      return this._json({error:'Shared calendar guard unavailable'},503);
    let payload;try{payload=await request.json();}catch(_){
      return this._json({error:'Invalid shared calendar request'},422);
    }
    const actor=payload?.actor;
    const signed=actor&&typeof actor.email==='string'&&
      ['sales','operator','finance','admin'].includes(actor.role);
    const legacy=actor?.legacy===true;
    if(!signed&&!legacy||!sharedCalendarPayloadAllowed(payload?.data)||
       typeof payload.expectedRevision!=='string'||payload.expectedRevision.length>64)
      return this._json({error:'Shared calendar write denied'},403);
    const current=await sharedCalendarLoad(this.env);
    if(current.error)return this._json({error:'Shared calendar unavailable'},503);
    if(current.revision!==payload.expectedRevision)
      return this._json({error:'Calendar changed on another device',
        code:'CALENDAR_REVISION_CONFLICT',revision:current.revision,data:current.data},409);
    const raw=JSON.stringify(payload.data);
    if(raw.length>95000)return this._json({error:'Calendar payload too large'},413);
    const target=AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+
      encodeURIComponent('Monitor Sistema')+
      (current.recordId?'/'+current.recordId:'');
    const body={fields:{Name:'CALENDARIO',Notes:raw}};
    let upstream;
    try{
      upstream=await fetch(target,{method:current.recordId?'PATCH':'POST',
        redirect:'manual',headers:{Authorization:'Bearer '+this.env.AIRTABLE_TOKEN,
          'Content-Type':'application/json'},body:JSON.stringify(body)});
    }catch(_){return this._json({error:'Calendar write outcome uncertain; reread before retrying',
      code:'CALENDAR_WRITE_UNCERTAIN'},503);}
    if([400,401,403,404,422].includes(upstream.status))
      return this._json({error:'Calendar write rejected',code:'CALENDAR_WRITE_REJECTED'},422);
    if(!upstream.ok||upstream.status>=300&&upstream.status<400)
      return this._json({error:'Calendar write outcome uncertain; reread before retrying',
        code:'CALENDAR_WRITE_UNCERTAIN'},503);
    const verified=await sharedCalendarLoad(this.env);
    if(verified.error||verified.raw!==raw)
      return this._json({error:'Calendar write succeeded but verification is uncertain',
        code:'CALENDAR_WRITE_UNCERTAIN'},503);
    return this._json({ok:true,revision:verified.revision,data:verified.data},200);
  }


  async _handleSharedAgenda(request){
    if(request.method!=='POST'||!this.env.AIRTABLE_TOKEN)
      return this._json({error:'Shared agenda guard unavailable'},503);
    let payload;try{payload=await request.json();}catch(_){
      return this._json({error:'Invalid shared agenda request'},422);
    }
    const actor=payload?.actor;
    const signed=actor&&typeof actor.email==='string'&&
      ['sales','operator','finance','admin'].includes(actor.role);
    const legacy=actor?.legacy===true;
    const scope=sharedAgendaScopeFor(signed?actor:null,payload?.scope,legacy);
    if(!scope||!signed&&!legacy||!sharedAgendaItemsAllowed(payload?.data)||
       typeof payload.expectedRevision!=='string'||payload.expectedRevision.length>64)
      return this._json({error:'Shared agenda write denied'},403);
    const current=await sharedAgendaLoad(this.env,scope);
    if(current.error)return this._json({error:'Shared agenda unavailable'},503);
    if(current.revision!==payload.expectedRevision)
      return this._json({error:'Agenda changed on another device',
        code:'AGENDA_REVISION_CONFLICT',scope,revision:current.revision,data:current.data},409);
    const all=Object.assign(Object.create(null),current.all);
    all[scope]=payload.data;
    if(!sharedAgendaDocumentAllowed(all))
      return this._json({error:'Agenda payload too large or invalid'},413);
    const raw=JSON.stringify(all);
    const target=AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+
      encodeURIComponent('Monitor Sistema')+
      (current.recordId?'/'+current.recordId:'');
    const body={fields:{Name:'AGENDA',Notes:raw}};
    let upstream;
    try{
      upstream=await fetch(target,{method:current.recordId?'PATCH':'POST',
        redirect:'manual',headers:{Authorization:'Bearer '+this.env.AIRTABLE_TOKEN,
          'Content-Type':'application/json'},body:JSON.stringify(body)});
    }catch(_){return this._json({error:'Agenda write outcome uncertain; reread before retrying',
      code:'AGENDA_WRITE_UNCERTAIN'},503);}
    if([400,401,403,404,422].includes(upstream.status))
      return this._json({error:'Agenda write rejected',code:'AGENDA_WRITE_REJECTED'},422);
    if(!upstream.ok||upstream.status>=300&&upstream.status<400)
      return this._json({error:'Agenda write outcome uncertain; reread before retrying',
        code:'AGENDA_WRITE_UNCERTAIN'},503);
    const verified=await sharedAgendaLoad(this.env,scope);
    if(verified.error||JSON.stringify(verified.data)!==JSON.stringify(payload.data))
      return this._json({error:'Agenda write succeeded but verification is uncertain',
        code:'AGENDA_WRITE_UNCERTAIN'},503);
    return this._json({ok:true,scope,revision:verified.revision,data:verified.data},200);
  }


  async _handleSharedMail(request){
    if(request.method!=='POST'||!this.env.AIRTABLE_TOKEN)
      return this._json({error:'Shared mail guard unavailable'},503);
    let payload;try{payload=await request.json();}catch(_){
      return this._json({error:'Invalid shared mail request'},422);
    }
    const {resource,account,data,expectedRevision}=payload||{};
    const actor=payload?.actor;
    const signed=actor&&typeof actor.email==='string'&&
      ['sales','operator','finance','admin'].includes(actor.role);
    const legacy=actor?.legacy===true;
    if(!Object.hasOwn(SHARED_MAIL_RECORDS,resource)||
       resource!=='templates'&&!sharedMailMailboxAllowed(signed?actor:null,account,legacy)||
       resource==='templates'&&account!==undefined||
       !sharedMailDataAllowed(resource,data)||
       typeof expectedRevision!=='string'||expectedRevision.length>64||
       !signed&&!legacy)
      return this._json({error:'Shared mail write denied'},403);
    const current=await sharedMailLoad(this.env,resource,account);
    if(current.error)return this._json({error:'Shared mail unavailable'},503);
    if(current.revision!==expectedRevision)
      return this._json({error:'Mail state changed on another device',
        code:'MAIL_REVISION_CONFLICT',resource,
        ...(resource==='templates'?{}:{account}),
        exists:current.exists,revision:current.revision,data:current.data},409);
    let raw;
    if(resource==='templates'){
      raw=JSON.stringify(data);
    }else{
      const all=Object.assign(Object.create(null),current.all||{});
      all[account]=data;
      if(!sharedMailMapAllowed(resource,all))
        return this._json({error:'Shared mail payload too large or invalid'},413);
      raw=JSON.stringify(all);
    }
    if(raw.length>95000)return this._json({error:'Shared mail payload too large'},413);
    const recordName=SHARED_MAIL_RECORDS[resource];
    const target=AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+
      encodeURIComponent('Monitor Sistema')+
      (current.recordId?'/'+current.recordId:'');
    const body={fields:{Name:recordName,Notes:raw}};
    let upstream;
    try{
      upstream=await fetch(target,{method:current.recordId?'PATCH':'POST',
        redirect:'manual',headers:{Authorization:'Bearer '+this.env.AIRTABLE_TOKEN,
          'Content-Type':'application/json'},body:JSON.stringify(body)});
    }catch(_){return this._json({error:'Mail write outcome uncertain; reread before retrying',
      code:'MAIL_WRITE_UNCERTAIN'},503);}
    if([400,401,403,404,422].includes(upstream.status))
      return this._json({error:'Mail write rejected',code:'MAIL_WRITE_REJECTED'},422);
    if(!upstream.ok||upstream.status>=300&&upstream.status<400)
      return this._json({error:'Mail write outcome uncertain; reread before retrying',
        code:'MAIL_WRITE_UNCERTAIN'},503);
    const verified=await sharedMailLoad(this.env,resource,account);
    if(verified.error||JSON.stringify(verified.data)!==JSON.stringify(data))
      return this._json({error:'Mail write succeeded but verification is uncertain',
        code:'MAIL_WRITE_UNCERTAIN'},503);
    return this._json({ok:true,resource,
      ...(resource==='templates'?{}:{account}),exists:true,
      revision:verified.revision,data:verified.data},200);
  }


  async _handleSharedMachineOps(request){
    if(request.method!=='POST'||!this.env.AIRTABLE_TOKEN)
      return this._json({error:'MachineOps guard unavailable'},503);
    let payload;try{payload=await request.json();}catch(_){
      return this._json({error:'Invalid MachineOps request'},422);
    }
    const actor=payload?.actor,legacy=actor?.legacy===true;
    const signed=actor&&typeof actor.email==='string'&&['operator','admin'].includes(actor.role);
    if(!signed&&!legacy)return this._json({error:'MachineOps write denied'},403);

    if(payload?.mode==='record'){
      if(payload.record!==SHARED_MACHINEOPS_BED_HISTORY||
         !sharedMachineBedHistoryAllowed(payload.data)||
         typeof payload.expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(payload.expectedRevision))
        return this._json({error:'Invalid machine history write'},422);
      const current=await sharedMachineOpsLoad(this.env,SHARED_MACHINEOPS_BED_HISTORY);
      if(current.error)return this._json({error:'Machine history unavailable'},503);
      const revision=current.revisions[SHARED_MACHINEOPS_BED_HISTORY];
      if(revision!==payload.expectedRevision)
        return this._json({error:'Machine history changed on another device',
          code:'MACHINEOPS_REVISION_CONFLICT',record:SHARED_MACHINEOPS_BED_HISTORY,
          revision,records:current.records},409);
      const raw=JSON.stringify(payload.data),rec=current.recordMap.get(SHARED_MACHINEOPS_BED_HISTORY);
      const target=AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+encodeURIComponent('Monitor Sistema')+
        (rec?'/'+rec.recordId:'');
      let upstream;
      try{
        upstream=await fetch(target,{method:rec?'PATCH':'POST',redirect:'manual',
          headers:{Authorization:'Bearer '+this.env.AIRTABLE_TOKEN,'Content-Type':'application/json'},
          body:JSON.stringify({fields:{Name:SHARED_MACHINEOPS_BED_HISTORY,Notes:raw}})});
      }catch(_){return this._json({error:'Machine history write uncertain; reread before retrying',
        code:'MACHINEOPS_WRITE_UNCERTAIN'},503);}
      if(!upstream.ok||upstream.status>=300&&upstream.status<400)
        return this._json({error:'Machine history write uncertain; reread before retrying',
          code:'MACHINEOPS_WRITE_UNCERTAIN'},503);
      const verified=await sharedMachineOpsLoad(this.env,SHARED_MACHINEOPS_BED_HISTORY);
      if(verified.error||verified.recordMap.get(SHARED_MACHINEOPS_BED_HISTORY)?.notes!==raw)
        return this._json({error:'Machine history verification uncertain',
          code:'MACHINEOPS_WRITE_UNCERTAIN'},503);
      return this._json({ok:true,record:SHARED_MACHINEOPS_BED_HISTORY,
        revision:verified.revisions[SHARED_MACHINEOPS_BED_HISTORY],records:verified.records},200);
    }

    if(payload?.mode!=='snapshot'||!Array.isArray(payload.writes)||payload.writes.length>SHARED_MACHINEOPS_DOMAINS.length||
       !sharedMachinePlainObject(payload.meta)||
       Object.keys(payload.meta).some(k=>!['version','updatedAt'].includes(k))||
       !sharedMachineFinite(payload.meta.version,1,100)||!sharedMachineFinite(payload.meta.updatedAt,0))
      return this._json({error:'Invalid MachineOps snapshot write'},422);
    const seen=new Set();
    for(const write of payload.writes){
      if(!sharedMachinePlainObject(write)||
         Object.keys(write).some(k=>!['domain','data','expectedRevision'].includes(k))||
         !SHARED_MACHINEOPS_DOMAINS.includes(write.domain)||seen.has(write.domain)||
         !sharedMachineDomainDataAllowed(write.domain,write.data)||
         typeof write.expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(write.expectedRevision)||
         !sharedMachineWriteRoleAllowed(signed?actor:null,write.domain,legacy))
        return this._json({error:'MachineOps domain write denied'},403);
      seen.add(write.domain);
    }
    if(!payload.writes.length)return this._json({ok:true,records:[],revisions:{}},200);

    const current=await sharedMachineOpsLoad(this.env);
    if(current.error)return this._json({error:'MachineOps unavailable'},503);
    for(const write of payload.writes){
      const name=SHARED_MACHINEOPS_PREFIX+write.domain;
      const revision=current.revisions[name];
      if(revision!==write.expectedRevision)
        return this._json({error:'MachineOps changed on another device',
          code:'MACHINEOPS_REVISION_CONFLICT',domain:write.domain,revision,
          records:current.records,revisions:current.revisions},409);
    }

    const metaName=SHARED_MACHINEOPS_PREFIX+SHARED_MACHINEOPS_META;
    let currentMetaAt=0;
    try{currentMetaAt=Number(JSON.parse(current.recordMap.get(metaName)?.notes||'{}').writtenAt)||0;}catch(_){}
    const commitAt=Math.max(Date.now(),currentMetaAt+1);
    const staged=[];
    for(const write of payload.writes){
      const name=SHARED_MACHINEOPS_PREFIX+write.domain,currentRec=current.recordMap.get(name);
      let previous=null;
      try{
        const parsed=JSON.parse(currentRec?.notes||'null');
        if(parsed&&parsed.schema===SHARED_MACHINEOPS_SCHEMA&&parsed.domain===write.domain&&
           sharedMachineFinite(parsed.writtenAt,0)&&sharedMachineDomainDataAllowed(write.domain,parsed.data))
          previous={writtenAt:parsed.writtenAt,data:parsed.data};
      }catch(_){}
      const envelope={schema:SHARED_MACHINEOPS_SCHEMA,domain:write.domain,writtenAt:commitAt,data:write.data};
      let notes=JSON.stringify(envelope);
      if(previous){
        const candidate=JSON.stringify({...envelope,previous});
        if(candidate.length<=90000)notes=candidate;
      }
      if(notes.length>90000||!sharedMachineEnvelopeAllowed(name,notes))
        return this._json({error:'MachineOps domain too large',domain:write.domain},413);
      staged.push({name,notes,recordId:currentRec?.recordId||''});
    }
    const metaNotes=JSON.stringify({schema:SHARED_MACHINEOPS_SCHEMA,domain:SHARED_MACHINEOPS_META,
      writtenAt:commitAt,version:payload.meta.version,
      updatedAt:Math.max(payload.meta.updatedAt,commitAt),domains:SHARED_MACHINEOPS_DOMAINS});
    if(!sharedMachineEnvelopeAllowed(metaName,metaNotes))
      return this._json({error:'Invalid MachineOps commit metadata'},422);
    staged.push({name:metaName,notes:metaNotes,recordId:current.recordMap.get(metaName)?.recordId||''});

    for(const item of staged){
      const target=AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+encodeURIComponent('Monitor Sistema')+
        (item.recordId?'/'+item.recordId:'');
      let upstream;
      try{
        upstream=await fetch(target,{method:item.recordId?'PATCH':'POST',redirect:'manual',
          headers:{Authorization:'Bearer '+this.env.AIRTABLE_TOKEN,'Content-Type':'application/json'},
          body:JSON.stringify({fields:{Name:item.name,Notes:item.notes}})});
      }catch(_){return this._json({error:'MachineOps write uncertain; reread before retrying',
        code:'MACHINEOPS_WRITE_UNCERTAIN'},503);}
      if(!upstream.ok||upstream.status>=300&&upstream.status<400)
        return this._json({error:'MachineOps write uncertain; reread before retrying',
          code:'MACHINEOPS_WRITE_UNCERTAIN'},503);
    }
    const verified=await sharedMachineOpsLoad(this.env);
    if(verified.error)return this._json({error:'MachineOps verification unavailable',
      code:'MACHINEOPS_WRITE_UNCERTAIN'},503);
    for(const write of payload.writes){
      const name=SHARED_MACHINEOPS_PREFIX+write.domain;
      let parsed;try{parsed=JSON.parse(verified.recordMap.get(name)?.notes||'null');}catch(_){}
      if(!parsed||JSON.stringify(parsed.data)!==JSON.stringify(write.data))
        return this._json({error:'MachineOps verification uncertain',
          code:'MACHINEOPS_WRITE_UNCERTAIN'},503);
    }
    const wanted=new Set(staged.map(x=>x.name));
    return this._json({ok:true,
      records:verified.records.filter(r=>wanted.has(r.name)),
      revisions:Object.fromEntries(Object.entries(verified.revisions).filter(([name])=>wanted.has(name)))},200);
  }


  async _handleSharedSimulation(request){
    if(request.method!=='POST'||!this.env.AIRTABLE_TOKEN)
      return this._json({error:'Simulation history guard unavailable'},503);
    let payload;try{payload=await request.json();}catch(_){
      return this._json({error:'Invalid simulation history request'},422);
    }
    if(!payload||!sharedSimulationActorAllowed(payload.actor)||
       !sharedSimulationDocumentAllowed(payload.data)||
       typeof payload.expectedRevision!=='string'||
       !/^[a-f0-9]{64}$/.test(payload.expectedRevision))
      return this._json({error:'Simulation history write denied'},403);
    const current=await sharedSimulationLoad(this.env);
    if(current.error)return this._json({error:'Simulation history unavailable'},503);
    if(current.revision!==payload.expectedRevision)
      return this._json({error:'Simulation history changed on another device',
        code:'SIMULATION_REVISION_CONFLICT',exists:current.exists,
        revision:current.revision,data:current.data},409);
    const raw=JSON.stringify(payload.data);
    if(raw.length>95000)return this._json({error:'Simulation history too large'},413);
    const target=AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+encodeURIComponent('Monitor Sistema')+
      (current.recordId?'/'+current.recordId:'');
    let upstream;
    try{
      upstream=await fetch(target,{method:current.recordId?'PATCH':'POST',redirect:'manual',
        headers:{Authorization:'Bearer '+this.env.AIRTABLE_TOKEN,'Content-Type':'application/json'},
        body:JSON.stringify({fields:{Name:SHARED_SIMULATION_NAME,Notes:raw}})});
    }catch(_){return this._json({error:'Simulation history write uncertain; reread before retrying',
      code:'SIMULATION_WRITE_UNCERTAIN'},503);}
    if([400,401,403,404,422].includes(upstream.status))
      return this._json({error:'Simulation history write rejected',
        code:'SIMULATION_WRITE_REJECTED'},422);
    if(!upstream.ok||upstream.status>=300&&upstream.status<400)
      return this._json({error:'Simulation history write uncertain; reread before retrying',
        code:'SIMULATION_WRITE_UNCERTAIN'},503);
    const verified=await sharedSimulationLoad(this.env);
    if(verified.error||JSON.stringify(verified.data)!==JSON.stringify(payload.data))
      return this._json({error:'Simulation history verification uncertain',
        code:'SIMULATION_WRITE_UNCERTAIN'},503);
    return this._json({ok:true,exists:true,revision:verified.revision,data:verified.data},200);
  }

  // This shares tls-crm-global with guarded Pedidos/Cotizaciones creation.
  // All proxied Access PATCHes of the three commercial tables enter one queue.
  // The sales branch alone requires a verified owner, safe field allowlist,
  // optimistic expected_fields and an immediate post-write owner recheck.
  async _handleScopedPatch(request){
    if(request.method!=='POST'||!this.env.AIRTABLE_TOKEN)
      return this._json({error:'Scoped CRM guard unavailable'},503);
    let data;
    try{data=await request.json();}catch(_){
      return this._json({error:'Invalid scoped patch JSON'},422);
    }
    const {table,recordId,method,body,actor,path,search}=data||{};
    if(method!=='PATCH'||!SELLER_SCOPE_TABLES.has(table)||
       !actor||typeof actor!=='object'||typeof actor.email!=='string'||
       !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actor.email)||
       !['sales','operator','finance','admin'].includes(actor.role))
      return this._json({error:'Unapproved scoped patch'},403);
    const root=SCOPED_CRM_PREFIX+encodeURIComponent(table);
    const headers={Authorization:'Bearer '+this.env.AIRTABLE_TOKEN,
      'Content-Type':'application/json'};
    if(actor.role!=='sales'){
      // The outer proxy has already authorized the signed role and canonical
      // path. Revalidate shape independently: direct DO calls are internal
      // but must not become an unrestricted Airtable base proxy.
      if(typeof path!=='string'||(path!==root&&
           !new RegExp('^'+root+'/rec[A-Za-z0-9]{14}$').test(path))||
         typeof body!=='string'||body.length>262144||
         typeof search!=='string'||search.length>1000||
         !['operator','finance','admin'].includes(actor.role))
        return this._json({error:'Privileged scoped patch malformed'},422);
      let payload;
      try{payload=JSON.parse(body);}catch(_){
        return this._json({error:'Invalid CRM patch body'},422);
      }
      if(!payload||typeof payload!=='object'||Array.isArray(payload)||
         (path===root&&(!Array.isArray(payload.records)||
             payload.records.length<1||payload.records.length>10||
             payload.records.some(r=>!r||!/^rec[A-Za-z0-9]{14}$/.test(r.id))))||
         (path!==root&&(!payload.fields||typeof payload.fields!=='object')))
        return this._json({error:'Unsupported CRM patch shape'},422);
      if(actor.role==='operator'){
        // The outer Worker validates too. Defend independently in the DO,
        // before either an individual or bulk CRM mutation reaches Airtable.
        if(search!==''||!operatorWritePayloadAllowed(table,'PATCH',payload))
          return this._json({error:'Unapproved operator patch fields'},422);
      }
      try{
        const upstream=await fetch(AIRTABLE_BASE+path+search,{
          method:'PATCH',redirect:'manual',headers,body
        });
        if(upstream.status>=300&&upstream.status<400)
          return this._json({error:'Unexpected CRM redirect; reread before retrying',
            code:'CRM_PATCH_UNCERTAIN'},503);
        return upstream;
      }catch(_){return this._json({error:'CRM patch result uncertain; reread the record',
        code:'CRM_PATCH_UNCERTAIN'},503);}
    }

    // Sales is opt-in separately from ACCESS_ENFORCE: Make or direct Airtable
    // writers cannot be locked by this DO. No release of sales writes until
    // those owner-changing writers have been mapped and constrained.
    if(String(this.env.ACCESS_SALES_WRITES_ENABLED||'').toLowerCase()!=='true'||
       !SELLER_SCOPE_NAMES.has(actor.seller)||!/^rec[A-Za-z0-9]{14}$/.test(recordId)||
       !sellerScopedPatchShape(table,body)||path!==undefined||search!==undefined)
      return this._json({error:'Sales scoped patch unavailable'},403);
    const target=AIRTABLE_BASE+root+'/'+recordId;
    let current;
    try{
      const pre=await fetch(target,{method:'GET',redirect:'manual',headers:{
        Authorization:headers.Authorization,Accept:'application/json'
      }});
      if(pre.status===404)return this._json({error:'Record not found'},404);
      if(!pre.ok)return this._json({error:'Cannot verify seller ownership'},503);
      current=await pre.json();
    }catch(_){return this._json({error:'Cannot verify seller ownership'},503);}
    if(!current||current.id!==recordId||!current.fields||
       typeof current.fields!=='object')
      return this._json({error:'Invalid ownership preflight'},503);
    if(sellerFieldName(current)!==actor.seller)
      return this._json({error:'Record not found'},404);
    for(const [key,expected] of Object.entries(body.expected_fields)){
      if(String(current.fields[key]??'')!==expected)
        return this._json({error:'Record was changed on another device',
          code:'SALES_PATCH_CONFLICT'},409);
    }
    let upstream;
    try{
      upstream=await fetch(target,{method:'PATCH',redirect:'manual',headers,
        body:JSON.stringify({fields:body.fields})});
    }catch(_){return this._json({error:'Sales PATCH result uncertain; reread before editing',
      code:'SALES_PATCH_UNCERTAIN'},503);}
    if([400,401,403,404,422].includes(upstream.status)){
      // Never expose another seller's record through upstream error bodies.
      return this._json({error:upstream.status===404?'Record not found':
        'Sales PATCH was definitively rejected'},upstream.status===404?404:422);
    }
    if(!upstream.ok)return this._json({error:'Sales PATCH result uncertain; reread before editing',
      code:'SALES_PATCH_UNCERTAIN'},503);
    // Do not trust the PATCH response to attest owner or linked records:
    // fetch the current authoritative row again without a client projection.
    try{
      const post=await fetch(target,{method:'GET',redirect:'manual',headers:{
        Authorization:headers.Authorization,Accept:'application/json'
      }});
      if(!post.ok)return this._json({error:'Sales PATCH succeeded but verification is uncertain',
        code:'SALES_PATCH_UNCERTAIN'},503);
      const after=await post.json();
      if(!after||after.id!==recordId||!after.fields)
        return this._json({error:'Sales PATCH succeeded but verification is uncertain',
          code:'SALES_PATCH_UNCERTAIN'},503);
      if(sellerFieldName(after)!==actor.seller)
        return this._json({error:'Owner changed during sales PATCH; reconcile before editing',
          code:'SALES_OWNER_CHANGED'},409);
      console.log('[Scoped sales PATCH]',JSON.stringify({actor:actor.email,
        table,record_id:recordId,fields:Object.keys(body.fields)}));
      // A successful PATCH is a READ as well: do not return Airtable's full
      // postflight row to sales. Reuse the GET field allowlist exactly.
      return this._json(sellerProjectRecord(after,table),200);
    }catch(_){return this._json({error:'Sales PATCH succeeded but verification is uncertain',
      code:'SALES_PATCH_UNCERTAIN'},503);}
  }

  // Separate instance (tls-marketing-spend-global): durable, per-month CAS
  // and immutable revision-addressed audit entries. No new Airtable table or
  // client-stored credentials. The edge supplies a VERIFIED Access identity.
  async _handleSpend(request) {
    if(request.method!=='POST')return this._json({error:'Internal method'},405);
    let data;
    try{data=await request.json();}catch(_){return this._json({error:'Malformed request'},400);}
    const {op,month,actor,channel,amount_clp,expected_revision,before_revision}=data||{};
    if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month||'')||
       !actor||!['finance','admin'].includes(actor.role)||
       typeof actor.email!=='string'||actor.email.length>254||
       !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actor.email)||
       !['get','put','history'].includes(op))
      return this._json({error:'Invalid spend request'},422);
    const key='marketing:spend:'+month,auditPrefix='marketing:audit:'+month+':';
    const blank=()=>({month,revision:0,channels:{},updated_at:null});
    if(op==='get') {
      const row=await this.state.storage.get(key);
      return this._json(row||blank(),200);
    }
    if(op==='history') {
      // Audit entries use contiguous revision-addressed keys. Bulk get keeps
      // memory bounded and makes it impossible to silently drop older events
      // when a month exceeds 100 edits. Cursor excludes its revision.
      const current=await this.state.storage.get(key)||blank();
      if(before_revision!==undefined&&
         (!Number.isSafeInteger(before_revision)||before_revision<1||
          before_revision>current.revision+1))
        return this._json({error:'Invalid history cursor'},422);
      const last=before_revision===undefined?current.revision:
        Math.min(current.revision,before_revision-1);
      const first=Math.max(1,last-99);
      const keys=[];
      for(let rev=last;rev>=first;rev--)
        keys.push(auditPrefix+String(rev).padStart(12,'0'));
      const records=keys.length?await this.state.storage.get(keys):new Map();
      // Fail closed if an expected immutable audit record is missing.
      if(keys.some(k=>!records.has(k)))
        return this._json({error:'Marketing audit integrity check failed'},503);
      return this._json({
        month,events:keys.map(k=>records.get(k)),
        latest_revision:current.revision,has_more:first>1&&keys.length>0,
        next_before_revision:first>1&&keys.length>0?first:null
      },200);
    }
    if(typeof channel!=='string'||channel.length<1||channel.length>65||
       channel!==channel.trim()||/[\x00-\x1f<>]/.test(channel)||
       !Number.isSafeInteger(amount_clp)||amount_clp<0||amount_clp>10000000000||
       !Number.isSafeInteger(expected_revision)||expected_revision<0)
      return this._json({error:'Invalid channel, amount or revision'},422);
    let result;
    try {
      result=await this.state.storage.transaction(async tx=>{
        const old=await tx.get(key)||blank();
        if(old.revision!==expected_revision)return {conflict:true,record:old};
        const before=old.channels[channel]||0;
        const next=Object.assign(Object.create(null),old.channels);
        if(amount_clp===0)delete next[channel];else next[channel]=amount_clp;
        if(before===amount_clp)return {record:old,unchanged:true};
        const revision=old.revision+1,at=new Date().toISOString();
        const record={month,revision,channels:next,updated_at:at};
        const event={revision,month,channel,before_clp:before,after_clp:amount_clp,
          actor_email:actor.email,actor_role:actor.role,at};
        await tx.put(key,record);
        await tx.put(auditPrefix+String(revision).padStart(12,'0'),event);
        return {record};
      });
    }catch(_){return this._json({error:'Spend storage unavailable'},503);}
    if(result.conflict)return this._json({
      error:'El gasto fue modificado por otro equipo; actualiza antes de guardar',
      code:'SPEND_REVISION_CONFLICT',current:result.record
    },409);
    return this._json({...result.record,unchanged:!!result.unchanged},200);
  }
  async _readAll(table) {
    const records = [], seen = new Set();
    let offset = '';
    for (let page = 0; page < 100; page++) {
      const url = AIRTABLE_BASE + '/v0/app1YtD74AqiPWQhy/' + encodeURIComponent(table) +
        '?pageSize=100' + (offset ? '&offset=' + encodeURIComponent(offset) : '');
      const res = await fetch(url, { headers: { Authorization: 'Bearer ' + this.env.AIRTABLE_TOKEN } });
      if (!res.ok) throw new Error('Airtable read ' + res.status);
      const j = await res.json();
      if (!j || !Array.isArray(j.records) ||
          j.records.some(r => !r || typeof r.id !== 'string' || !r.fields || typeof r.fields !== 'object'))
        throw new Error('Airtable malformed records');
      records.push(...j.records);
      if (!j.offset) return records;
      if (typeof j.offset !== 'string' || seen.has(j.offset)) throw new Error('Airtable invalid pagination');
      seen.add(j.offset);
      offset = j.offset;
    }
    throw new Error('Airtable pagination limit: refusing partial deduplication');
  }
  async _handle(request) {
    if (request.method !== 'POST') return this._json({ error: 'Method not allowed' }, 405);
    if (!this.env.AIRTABLE_TOKEN) return this._json({ error: 'CRM write guard misconfigured' }, 503);
    let data;
    try { data = await request.json(); }
    catch (_) { return this._json({ error: 'Invalid JSON' }, 400); }
    const table = data && data.table;
    // Signed operator creation is independently checked inside the shared
    // Durable Object, before idempotency reads or an upstream Airtable POST.
    // Legacy requests omit actor; signed admin/finance retain their roles.
    if(data?.actor?.role==='operator'&&
       (data.search!==''||!operatorWritePayloadAllowed(table,'POST',data.body)))
      return this._json({error:'Unapproved operator create fields'},422);
    if (!['Pedidos','Cotizaciones','Facturas','Reportes'].includes(table) || !data.body ||
        typeof data.body !== 'object' || Array.isArray(data.body) ||
        !data.body.fields || typeof data.body.fields !== 'object' ||
        Array.isArray(data.body.fields) || data.body.records) {
      return this._json({ error: 'Only single-record CRM creates are allowed' }, 400);
    }
    // Reportes: no more check-then-POST in two browsers. Canonical ISO week is
    // the natural identity; historical labels are adopted only when their
    // generation date unambiguously identifies the same reporting week.
    // Never retry an ambiguous POST: a persistent DO reservation survives it.
    if (table === 'Reportes') {
      const body=data.body,fields=body.fields,week=fields.Semana;
      if(!reportWeekValid(week)||
         !Object.keys(body).every(k=>['fields','typecast','reportReplace'].includes(k))||
         (body.reportReplace!==undefined&&typeof body.reportReplace!=='boolean')) {
        return this._json({error:'Reportes requires an ISO week and a single-record body'},422);
      }
      const key='pending:report:'+week;
      let remote,marker;
      try {
        remote=await this._readAll('Reportes');
        marker=await this.state.storage.get(key);
      }catch(_){return this._json({error:'No se pudo verificar el historial completo de Reportes'},503);}
      const matches=remote.filter(r=>{
        const f=r.fields||{},label=String(f.Semana||'').trim();
        if(label===week)return true;
        // Historical reports stored "Semana 39 — septiembre 2026" instead of
        // ISO identity. Do not infer acquisition of arbitrary manual labels:
        // adopt only dated legacy rows from that calendar week.
        return !/^\d{4}-W\d{2}$/.test(label)&&(label===''||/^Semana\b/i.test(label))&&
          reportIsoWeekFromDate(f['Fecha generación'])===week;
      });
      if(matches.length>1)return this._json({
        error:'Hay varios reportes históricos de esta semana; requiere conciliación manual',
        code:'REPORTES_LEGACY_DUPLICATES',week,record_ids:matches.map(r=>r.id)
      },409);
      const headers={Authorization:'Bearer '+this.env.AIRTABLE_TOKEN,'Content-Type':'application/json'};
      const target=AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/Reportes';
      const {reportReplace,...airtableBody}=body;
      if(matches.length){
        const existing=matches[0];
        if(!reportReplace)return this._json(existing,200);
        let upstream;
        try {upstream=await fetch(target+'/'+encodeURIComponent(existing.id),{
          method:'PATCH',headers,body:JSON.stringify(airtableBody)
        });}catch(_){return this._json({
          error:'Actualización de reporte con resultado incierto; consultar Airtable',
          code:'REPORTES_UPDATE_UNCERTAIN',week
        },503);}
        if(!upstream.ok)return upstream;
        let updated;try{updated=await upstream.json();}catch(_){}
        if(!updated||typeof updated.id!=='string')
          return this._json({error:'Airtable no confirmó la actualización',code:'REPORTES_UPDATE_UNCERTAIN'},503);
        try{await this.state.storage.put(key,{record_id:updated.id,completed:true,week});}catch(_){}
        return this._json(updated,200);
      }
      // A known completed report may have been deliberately deleted during
      // historical cleanup. Once the complete remote read proves it absent,
      // clear only a COMPLETED marker. An uncertain pending marker stays locked.
      if(marker?.completed&&marker.record_id){
        try{await this.state.storage.delete(key);marker=null;}
        catch(_){return this._json({error:'No se pudo limpiar la reserva completada'},503);}
      }
      if(reportReplace)return this._json({
        error:'El reporte que ibas a reemplazar ya no existe; recarga antes de continuar',
        code:'REPORTES_REPLACE_CONFLICT',week
      },409);
      if(marker)return this._json({
        error:'Un alta anterior de esta semana tiene resultado incierto; conciliar antes de repetir',
        code:'REPORTES_PENDING_RECONCILIATION',week
      },503);
      try{await this.state.storage.put(key,{week,created:new Date().toISOString()});}
      catch(_){return this._json({error:'No se pudo reservar el reporte semanal'},503);}
      let upstream;
      try {upstream=await fetch(target,{method:'POST',headers,body:JSON.stringify(airtableBody)});}
      catch(_){return this._json({
        error:'Alta de reporte con resultado incierto; conciliar antes de repetir',
        code:'REPORTES_PENDING_RECONCILIATION',week
      },503);}
      if([400,401,403,422].includes(upstream.status)){
        try{await this.state.storage.delete(key);}catch(_){}
        return upstream;
      }
      if(!upstream.ok)return this._json({
        error:'Airtable devolvió un resultado incierto al guardar Reportes',
        code:'REPORTES_PENDING_RECONCILIATION',week
      },503);
      let created;try{created=await upstream.json();}catch(_){}
      if(!created||typeof created.id!=='string')return this._json({
        error:'Airtable no confirmó el ID del reporte; conciliar antes de repetir',
        code:'REPORTES_PENDING_RECONCILIATION',week
      },503);
      try{await this.state.storage.put(key,{record_id:created.id,completed:true,week});}catch(_){}
      return this._json(created,201);
    }
    // Facturas: un único Durable Object serializa la lectura remota y el POST
    // para TODOS los navegadores. La reserva permanece ante timeout/5xx.
    if (table === 'Facturas') {
      const fields = data.body.fields;
      const tipo = String(fields['Tipo DTE'] || '').trim();
      const folio = Number(fields.Folio);
      const fecha = String(fields.Fecha || '').slice(0, 10);
      if (!/^(33|39|52|56|61)$/.test(tipo) || !Number.isSafeInteger(folio) ||
          folio < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
          !Number.isFinite(Date.parse(fecha + 'T12:00:00Z'))) {
        return this._json({ error: 'Factura requiere tipo, folio y fecha válidos' }, 422);
      }
      const year = fecha.slice(0, 4);
      const key = 'pending:factura:' + year + ':' + tipo + ':' + folio;
      let remote, marker;
      try {
        remote = await this._readAll('Facturas');
        marker = await this.state.storage.get(key);
      } catch (_) {
        return this._json({ error: 'No fue posible comprobar la unicidad de Facturas' }, 503);
      }
      const same = remote.find(r => {
        const f = r.fields || {};
        return String(f['Tipo DTE'] || '').trim() === tipo &&
          Number(f.Folio) === folio && String(f.Fecha || '').slice(0, 4) === year;
      });
      if (same) {
        // NO sobrescribir datos de pago, vencimiento o cliente de una
        // factura existente: devolverla para conciliación explícita.
        return this._json(same, 200);
      }
      if (marker) return this._json({
        error: 'Un alta anterior de este DTE sigue pendiente de conciliación en Airtable',
        code: 'FACTURA_PENDING_RECONCILIATION', tipo, folio, year,
      }, 503);
      const reservation = { tipo, folio, year, at: new Date().toISOString() };
      try { await this.state.storage.put(key, reservation); }
      catch (_) { return this._json({ error: 'No se pudo reservar el alta de Facturas' }, 503); }
      let upstream;
      try {
        upstream = await fetch(AIRTABLE_BASE + '/v0/app1YtD74AqiPWQhy/Facturas', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + this.env.AIRTABLE_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify(data.body),
        });
      } catch (_) {
        return this._json({
          error: 'Alta de Factura con resultado incierto: conciliar antes de repetir',
          code: 'FACTURA_PENDING_RECONCILIATION', tipo, folio, year,
        }, 503);
      }
      // Solo rechazos definitivos pueden liberar la reserva.
      if ([400, 401, 403, 422].includes(upstream.status)) {
        try { await this.state.storage.delete(key); } catch (_) {}
        return upstream;
      }
      if (!upstream.ok) return this._json({
        error: 'Airtable devolvió un resultado incierto al guardar Facturas',
        code: 'FACTURA_PENDING_RECONCILIATION', tipo, folio, year,
      }, 503);
      let created;
      try { created = await upstream.json(); }
      catch (_) { return this._json({
        error: 'Airtable respondió sin un registro verificable; conciliar',
        code: 'FACTURA_PENDING_RECONCILIATION', tipo, folio, year,
      }, 503); }
      if (!created || typeof created.id !== 'string') return this._json({
        error: 'Airtable no confirmó el identificador de la Factura; conciliar',
        code: 'FACTURA_PENDING_RECONCILIATION', tipo, folio, year,
      }, 503);
      try { await this.state.storage.put(key, { ...reservation, record_id: created.id, completed: true }); }
      catch (_) { /* En un resultado incierto, nunca liberar el bloqueo. */ }
      return this._json(created, 200);
    }
    const numberField = table === 'Pedidos' ? 'N° Pedido' : 'N° Cotización';
    const number = String(data.body.fields[numberField] || '').trim();
    if (!number || number.length > 32 || !/^[A-Za-z0-9-]+$/.test(number))
      return this._json({ error: 'Invalid CRM document number' }, 422);
    const cot = table === 'Pedidos' && Array.isArray(data.body.fields.Cotizaciones) &&
      data.body.fields.Cotizaciones.length === 1 && /^rec[A-Za-z0-9]+$/.test(data.body.fields.Cotizaciones[0])
      ? data.body.fields.Cotizaciones[0] : '';
    // Identidad natural de contratos recurrentes: dos navegadores pueden
    // proponer N° distintos para EL MISMO contrato/mes. No deduplicar por
    // cliente+importe: un cliente puede contratar varios trabajos iguales.
    const recurrence = table === 'Pedidos' ? String(data.body.fields['Notas pedido'] || '').trim() : '';
    const retainer = /^Retainer [A-Za-z0-9_-]{1,100} \d{4}-\d{2}$/.test(recurrence) ? recurrence : '';
    const keyNum = 'pending:' + table + ':' + number;
    const keyCot = cot ? 'pending:cot:' + cot : '';
    const keyRet = retainer ? 'pending:retainer:' + retainer : '';
    let remote, pendingNum, pendingCot, pendingRet;
    try {
      // La lectura incluye TODO el universo actual; si falla, nunca autorizar un POST.
      remote = await this._readAll(table);
      pendingNum = await this.state.storage.get(keyNum);
      if (keyCot) pendingCot = await this.state.storage.get(keyCot);
      if (keyRet) pendingRet = await this.state.storage.get(keyRet);
    } catch (_) { return this._json({ error: 'Cannot verify CRM uniqueness; creation suspended' }, 503); }
    // Si la otra pestaña ya creó el pedido para la misma cotización, adoptar
    // el registro real independientemente de qué número estimó el cliente.
    if (cot) {
      const existing = remote.find(r => Array.isArray(r.fields.Cotizaciones) && r.fields.Cotizaciones.includes(cot));
      if (existing) return this._json(existing, 200);
    }
    if (retainer) {
      const existing = remote.find(r => String(r.fields['Notas pedido'] || '').trim() === retainer);
      if (existing) return this._json(existing, 200);
    }
    if (remote.some(r => String(r.fields[numberField] || '').trim() === number)) {
      return this._json({ error: 'CRM document number already exists', code: 'CRM_NUMBER_CONFLICT' }, 409);
    }
    // Un POST anterior pudo haberse grabado pese al timeout. Bloquear nuevos
    // intentos (incluso con otro número para la misma cotización) hasta reconciliar.
    if (pendingNum || pendingCot || pendingRet) return this._json({
      error: 'Previous CRM creation has an uncertain outcome; reconcile Airtable before retrying',
      code: 'CRM_PENDING_RECONCILIATION',
    }, 503);

    const marker = { created: new Date().toISOString(), table, number, cot, retainer };
    try {
      await this.state.storage.put(keyNum, marker);
      if (keyCot) await this.state.storage.put(keyCot, marker);
      if (keyRet) await this.state.storage.put(keyRet, marker);
    } catch (_) { return this._json({ error: 'Cannot reserve CRM document' }, 503); }

    let upstream;
    try {
      const headers = { Authorization: 'Bearer ' + this.env.AIRTABLE_TOKEN, 'Content-Type': 'application/json' };
      const target = AIRTABLE_BASE + '/v0/app1YtD74AqiPWQhy/' + encodeURIComponent(table) +
        (typeof data.search === 'string' && data.search.length < 500 ? data.search : '');
      upstream = await fetch(target, { method: 'POST', headers, body: JSON.stringify(data.body) });
    } catch (_) {
      return this._json({ error: 'CRM POST outcome unknown: reconcile before retrying', code: 'CRM_PENDING_RECONCILIATION' }, 503);
    }
    // Un 422 es un rechazo confirmado del esquema: liberar la reserva para
    // que el cliente pueda quitar el campo incompatible y volver a intentar.
    if (upstream.status === 400 || upstream.status === 401 ||
        upstream.status === 403 || upstream.status === 422) {
      try {
        await this.state.storage.delete(keyNum);
        if (keyCot) await this.state.storage.delete(keyCot);
        if (keyRet) await this.state.storage.delete(keyRet);
      } catch (_) { /* ante fallo de storage, mantener bloqueado > duplicar */ }
      return upstream;
    }
    if (!upstream.ok) return this._json({
      error: 'CRM POST returned an uncertain status: reconcile before retrying',
      code: 'CRM_PENDING_RECONCILIATION',
    }, 503);
    let created;
    try { created = await upstream.clone().json(); }
    catch (_) {
      return this._json({ error: 'CRM POST succeeded but response was unreadable: reconcile first', code: 'CRM_PENDING_RECONCILIATION' }, 503);
    }
    if (!created || typeof created.id !== 'string') {
      return this._json({ error: 'CRM POST returned no record id: reconcile first', code: 'CRM_PENDING_RECONCILIATION' }, 503);
    }
    // Mantener tombstones en storage para bloquear reintentos sobre un snapshot
    // Airtable retrasado; la lectura remota puede confirmar y adoptar el registro.
    try {
      const done = { ...marker, record_id: created.id, committed: true };
      await this.state.storage.put(keyNum, done);
      if (keyCot) await this.state.storage.put(keyCot, done);
      if (keyRet) await this.state.storage.put(keyRet, done);
    } catch (_) { /* el registro ya se creó; la lectura autoritativa manda */ }
    return this._json(created, upstream.status);
  }
}


const BUG_REPORT_META_PREFIX='BUG_REPORT_META:';
const BUG_REPORT_IMG_PREFIX='BUG_REPORT_IMG:';
const BUG_REPORT_STATUSES=new Set(['nuevo','analizando','reparando','pr_creado','needs_review','resuelto','error','cerrado']);
function bugReportIdAllowed(id){
  return typeof id==='string'&&/^br_[a-z0-9]{12,28}$/.test(id);
}
function bugReportText(value,max,min=0){
  return typeof value==='string'&&value.length>=min&&value.length<=max&&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
}
function bugReportContextAllowed(ctx){
  if(!ctx||typeof ctx!=='object'||Array.isArray(ctx)||
     Object.keys(ctx).some(k=>!['section','path','build','viewport','userAgent','reporterName'].includes(k)))
    return false;
  const vp=ctx.viewport;
  return bugReportText(ctx.section||'',80)&&bugReportText(ctx.path||'',700)&&
    bugReportText(ctx.build||'',64)&&bugReportText(ctx.userAgent||'',500)&&
    bugReportText(ctx.reporterName||'',160)&&
    vp&&typeof vp==='object'&&!Array.isArray(vp)&&
    Object.keys(vp).every(k=>['width','height','dpr'].includes(k))&&
    Number.isFinite(vp.width)&&vp.width>0&&vp.width<=10000&&
    Number.isFinite(vp.height)&&vp.height>0&&vp.height<=10000&&
    Number.isFinite(vp.dpr)&&vp.dpr>0&&vp.dpr<=10;
}
function bugReportScreenshotAllowed(shot){
  if(shot===null||shot===undefined)return true;
  if(!shot||typeof shot!=='object'||Array.isArray(shot)||
     Object.keys(shot).some(k=>!['dataUrl','mime','width','height','bytes'].includes(k))||
     shot.mime!=='image/jpeg'||typeof shot.dataUrl!=='string'||shot.dataUrl.length>74000||
     !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(shot.dataUrl)||
     !Number.isInteger(shot.width)||shot.width<1||shot.width>2000||
     !Number.isInteger(shot.height)||shot.height<1||shot.height>2000||
     !Number.isInteger(shot.bytes)||shot.bytes<1||shot.bytes>60000)return false;
  return true;
}
function bugReportMetaAllowed(meta){
  if(!meta||typeof meta!=='object'||Array.isArray(meta)||
     Object.keys(meta).some(k=>!['version','id','createdAt','reporter','reporterName','role','message','section','path','build','viewport','userAgent','status','screenshot','repair'].includes(k))||
     meta.version!==1||!bugReportIdAllowed(meta.id)||
     !bugReportText(meta.createdAt,40,20)||Number.isNaN(Date.parse(meta.createdAt))||
     !bugReportText(meta.reporter,254)||!bugReportText(meta.reporterName||'',160)||
     !bugReportText(meta.role,30)||!bugReportText(meta.message,5000,10)||
     !bugReportText(meta.section||'',80)||!bugReportText(meta.path||'',700)||
     !bugReportText(meta.build||'',64)||!bugReportText(meta.userAgent||'',500)||
     !BUG_REPORT_STATUSES.has(meta.status))return false;
  const vp=meta.viewport;
  if(!vp||typeof vp!=='object'||Array.isArray(vp)||
     !Number.isFinite(vp.width)||!Number.isFinite(vp.height)||!Number.isFinite(vp.dpr))return false;
  if(meta.screenshot!==null&&meta.screenshot!==undefined){
    const info=meta.screenshot;
    if(!info||typeof info!=='object'||Array.isArray(info)||
       Object.keys(info).some(k=>!['present','mime','width','height','bytes'].includes(k))||
       info.present!==true||info.mime!=='image/jpeg'||
       !Number.isInteger(info.width)||!Number.isInteger(info.height)||!Number.isInteger(info.bytes)||
       info.bytes<1||info.bytes>60000)return false;
  }
  if(meta.repair!==undefined){
    const r=meta.repair;
    if(!r||typeof r!=='object'||Array.isArray(r)||
       Object.keys(r).some(k=>!['analysis','error','prUrl','prNumber','branch','updatedAt','attempts','changedFiles'].includes(k))||
       (r.analysis!==undefined&&!bugReportText(r.analysis,5000))||
       (r.error!==undefined&&!bugReportText(r.error,3000))||
       (r.prUrl!==undefined&&!bugReportText(r.prUrl,1000))||
       (r.prNumber!==undefined&&(!Number.isInteger(r.prNumber)||r.prNumber<1))||
       (r.branch!==undefined&&!bugReportText(r.branch,240))||
       (r.updatedAt!==undefined&&!bugReportText(r.updatedAt,40))||
       (r.attempts!==undefined&&(!Number.isInteger(r.attempts)||r.attempts<0||r.attempts>20))||
       (r.changedFiles!==undefined&&(!Array.isArray(r.changedFiles)||r.changedFiles.length>20||
          !r.changedFiles.every(v=>bugReportText(v,260)))))return false;
  }
  return JSON.stringify(meta).length<=15000;
}
async function bugMonitorRows(env,formula,maxRecords=100){
  if(!env.AIRTABLE_TOKEN)return {error:'missing-token'};
  const q=new URLSearchParams();
  q.set('maxRecords',String(Math.max(1,Math.min(100,maxRecords))));
  q.set('filterByFormula',formula);
  q.append('fields[]','Name');q.append('fields[]','Notes');
  let r;
  try{
    r=await fetch(AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+encodeURIComponent('Monitor Sistema')+'?'+q.toString(),{
      method:'GET',redirect:'manual',headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,Accept:'application/json'}
    });
  }catch(_){return {error:'network'};}
  if(!r.ok||r.status>=300&&r.status<400)return {error:'upstream'};
  let body;try{body=await r.json();}catch(_){return {error:'invalid-json'};}
  if(!body||!Array.isArray(body.records)||body.records.length>100)return {error:'invalid-shape'};
  return {records:body.records};
}
async function sharedBugReportList(env,identity=null){
  const rows=await bugMonitorRows(env,`LEFT({Name},16)="${BUG_REPORT_META_PREFIX}"`,100);
  if(rows.error)return rows;
  const reports=[];
  for(const row of rows.records){
    if(!row||typeof row.fields?.Name!=='string'||!row.fields.Name.startsWith(BUG_REPORT_META_PREFIX)||
       typeof row.fields?.Notes!=='string')continue;
    let meta;try{meta=JSON.parse(row.fields.Notes);}catch(_){continue;}
    if(!bugReportMetaAllowed(meta)||row.fields.Name!==BUG_REPORT_META_PREFIX+meta.id)continue;
    if(identity&&identity.role!=='admin'&&meta.reporter!==identity.email)continue;
    reports.push(meta);
  }
  reports.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
  return {reports:reports.slice(0,100)};
}
async function sharedBugReportLoad(env,id,identity=null){
  if(!bugReportIdAllowed(id))return {error:'invalid-id'};
  const metaRows=await bugMonitorRows(env,`{Name}="${BUG_REPORT_META_PREFIX+id}"`,2);
  if(metaRows.error||metaRows.records?.length!==1)return {error:metaRows.error||'not-found'};
  const row=metaRows.records[0];
  let meta;try{meta=JSON.parse(row.fields?.Notes||'');}catch(_){return {error:'invalid-meta'};}
  if(!bugReportMetaAllowed(meta)||meta.id!==id)return {error:'invalid-meta'};
  if(identity&&identity.role!=='admin'&&meta.reporter!==identity.email)return {error:'not-found'};
  let screenshot='';
  if(meta.screenshot?.present){
    const imgRows=await bugMonitorRows(env,`{Name}="${BUG_REPORT_IMG_PREFIX+id}"`,2);
    if(!imgRows.error&&imgRows.records?.length===1){
      const raw=String(imgRows.records[0].fields?.Notes||'');
      if(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(raw)&&raw.length<=74000)screenshot=raw;
    }
  }
  return {report:meta,screenshot};
}
async function sharedBugReportCreate(env,input,actor){
  if(!env.AIRTABLE_TOKEN)return {error:'missing-token'};
  if(!input||typeof input!=='object'||Array.isArray(input)||
     Object.keys(input).some(k=>!['message','context','screenshot'].includes(k))||
     !bugReportText(input.message,5000,10)||!bugReportContextAllowed(input.context)||
     !bugReportScreenshotAllowed(input.screenshot))return {error:'invalid-report'};
  const id='br_'+Date.now().toString(36)+crypto.randomUUID().replace(/-/g,'').slice(0,10).toLowerCase();
  const now=new Date().toISOString(),ctx=input.context,shot=input.screenshot||null;
  const meta={
    version:1,id,createdAt:now,
    reporter:actor?.email||'legacy-dashboard',
    reporterName:ctx.reporterName||actor?.email||'Usuario',
    role:actor?.role||'legacy',
    message:input.message.trim(),section:ctx.section,path:ctx.path,build:ctx.build,
    viewport:ctx.viewport,userAgent:ctx.userAgent,status:'nuevo',
    screenshot:shot?{present:true,mime:'image/jpeg',width:shot.width,height:shot.height,bytes:shot.bytes}:null,
    repair:{attempts:0,updatedAt:now}
  };
  if(!bugReportMetaAllowed(meta))return {error:'invalid-meta'};
  const records=[{fields:{Name:BUG_REPORT_META_PREFIX+id,Notes:JSON.stringify(meta)}}];
  if(shot)records.push({fields:{Name:BUG_REPORT_IMG_PREFIX+id,Notes:shot.dataUrl}});
  let r;
  try{
    r=await fetch(AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+encodeURIComponent('Monitor Sistema'),{
      method:'POST',redirect:'manual',
      headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify({records})
    });
  }catch(_){return {error:'write-uncertain',uncertain:true};}
  if([400,401,403,404,422].includes(r.status))return {error:'write-rejected'};
  if(!r.ok||r.status>=300&&r.status<400)return {error:'write-uncertain',uncertain:true};
  let body;try{body=await r.json();}catch(_){return {error:'write-uncertain',uncertain:true};}
  if(!Array.isArray(body.records)||body.records.length!==records.length)return {error:'write-uncertain',uncertain:true};
  return {id,report:meta};
}
async function sharedBugReportAction(env,id,action){
  if(!bugReportIdAllowed(id)||!['retry','close'].includes(action))return {error:'invalid-action'};
  const current=await sharedBugReportLoad(env,id);
  if(current.error)return current;
  const meta=current.report;
  if(action==='retry'){
    if(!['error','needs_review','pr_creado'].includes(meta.status))return {error:'retry-not-allowed'};
    meta.status='nuevo';meta.repair={...(meta.repair||{}),error:'',updatedAt:new Date().toISOString()};
  }else{
    meta.status='cerrado';meta.repair={...(meta.repair||{}),updatedAt:new Date().toISOString()};
  }
  if(!bugReportMetaAllowed(meta))return {error:'invalid-meta'};
  const rows=await bugMonitorRows(env,`{Name}="${BUG_REPORT_META_PREFIX+id}"`,2);
  if(rows.error||rows.records?.length!==1)return {error:rows.error||'not-found'};
  const recId=String(rows.records[0].id||'');
  if(!/^rec[A-Za-z0-9]{14}$/.test(recId))return {error:'invalid-record'};
  let r;
  try{
    r=await fetch(AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+encodeURIComponent('Monitor Sistema')+'/'+recId,{
      method:'PATCH',redirect:'manual',
      headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify({fields:{Notes:JSON.stringify(meta)}})
    });
  }catch(_){return {error:'write-uncertain'};}
  if(!r.ok||r.status>=300&&r.status<400)return {error:'write-rejected'};
  return {report:meta};
}


const GITHUB_OIDC_ISSUER='https://token.actions.githubusercontent.com';
const GITHUB_BUGFIX_AUDIENCE='tls-dashboard-bugfix';
const GITHUB_BUGFIX_REPOSITORY='thelabsolutionscl/dashboardthelabsolutions';
const GITHUB_BUGFIX_WORKFLOW=GITHUB_BUGFIX_REPOSITORY+'/.github/workflows/ai-bugfix.yml@refs/heads/main';
let GITHUB_OIDC_KEYS={expires:0,keys:[]};

function bugfixB64UrlJson(segment){
  if(typeof segment!=='string'||!/^[A-Za-z0-9_-]+$/.test(segment)||segment.length>12000)
    throw new Error('Malformed OIDC token');
  const raw=atob(segment.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-segment.length%4)%4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0))));
}
async function githubOidcKeys(force=false){
  if(!force&&GITHUB_OIDC_KEYS.expires>Date.now()&&GITHUB_OIDC_KEYS.keys.length)
    return GITHUB_OIDC_KEYS.keys;
  const r=await fetch(GITHUB_OIDC_ISSUER+'/.well-known/jwks',{redirect:'error'});
  if(!r.ok)throw new Error('GitHub OIDC keys unavailable');
  const body=await r.json();
  const keys=Array.isArray(body?.keys)?body.keys.filter(k=>k?.kty==='RSA'&&k.kid&&k.n&&k.e):[];
  if(!keys.length||keys.length>30)throw new Error('Invalid GitHub OIDC JWKS');
  GITHUB_OIDC_KEYS={keys,expires:Date.now()+5*60*1000};
  return keys;
}
async function verifyGithubBugfixOidc(request){
  const auth=String(request.headers.get('Authorization')||'');
  const m=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(auth);
  if(!m)throw new Error('Missing GitHub OIDC token');
  const parts=m[1].split('.'),header=bugfixB64UrlJson(parts[0]),claims=bugfixB64UrlJson(parts[1]);
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>220)
    throw new Error('Unsupported GitHub OIDC token');
  let keys=await githubOidcKeys(),jwk=keys.find(k=>k.kid===header.kid);
  if(!jwk){keys=await githubOidcKeys(true);jwk=keys.find(k=>k.kid===header.kid);}
  if(!jwk)throw new Error('Unknown GitHub OIDC key');
  const key=await crypto.subtle.importKey('jwk',jwk,
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const sig=Uint8Array.from(atob(parts[2].replace(/-/g,'+').replace(/_/g,'/')+
    '='.repeat((4-parts[2].length%4)%4)),c=>c.charCodeAt(0));
  const ok=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,sig,
    new TextEncoder().encode(parts[0]+'.'+parts[1]));
  if(!ok)throw new Error('Invalid GitHub OIDC signature');
  const now=Math.floor(Date.now()/1000),aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(claims.iss!==GITHUB_OIDC_ISSUER||!aud.includes(GITHUB_BUGFIX_AUDIENCE)||
     claims.repository!==GITHUB_BUGFIX_REPOSITORY||
     claims.ref!=='refs/heads/main'||claims.workflow_ref!==GITHUB_BUGFIX_WORKFLOW||
     !['schedule','workflow_dispatch'].includes(claims.event_name)||
     !Number.isFinite(claims.exp)||claims.exp<=now||
     (claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>now))||
     (claims.iat!==undefined&&(!Number.isFinite(claims.iat)||claims.iat>now+60)))
    throw new Error('GitHub OIDC claims denied');
  return claims;
}
function bugfixReportInputAllowed(report,allowScreenshot){
  if(!report||typeof report!=='object'||Array.isArray(report)||
     Object.keys(report).some(k=>!['id','message','section','path','build','screenshot'].includes(k))||
     !bugReportIdAllowed(report.id)||!bugReportText(report.message,5000,10)||
     !bugReportText(report.section||'',80)||!bugReportText(report.path||'',700)||
     !bugReportText(report.build||'',64))return false;
  if(report.screenshot!==undefined){
    if(!allowScreenshot||typeof report.screenshot!=='string'||report.screenshot.length>44000||
       !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(report.screenshot))return false;
  }
  return true;
}
function bugfixPathAllowed(path){
  return typeof path==='string'&&path.length>0&&path.length<=260&&
    !path.startsWith('/')&&!path.includes('..')&&
    /^[A-Za-z0-9_.\/-]+$/.test(path);
}
function bugfixPlanRequestAllowed(body){
  return body&&typeof body==='object'&&!Array.isArray(body)&&
    Object.keys(body).every(k=>['stage','report','repoMap'].includes(k))&&
    body.stage==='plan'&&bugfixReportInputAllowed(body.report,true)&&
    Array.isArray(body.repoMap)&&body.repoMap.length<=1400&&
    body.repoMap.every(bugfixPathAllowed)&&JSON.stringify(body.repoMap).length<=22000;
}
function bugfixPatchRequestAllowed(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||
     Object.keys(body).some(k=>!['stage','report','plan','files'].includes(k))||
     body.stage!=='patch'||!bugfixReportInputAllowed(body.report,false)||
     !body.plan||typeof body.plan!=='object'||Array.isArray(body.plan)||
     JSON.stringify(body.plan).length>12000||!Array.isArray(body.files)||body.files.length>8)
    return false;
  let total=0;
  for(const file of body.files){
    if(!file||typeof file!=='object'||Array.isArray(file)||
       Object.keys(file).some(k=>!['path','content'].includes(k))||
       !bugfixPathAllowed(file.path)||typeof file.content!=='string'||file.content.length>26000)
      return false;
    total+=file.content.length;
  }
  return total<=50000;
}
function parseBugfixJson(text){
  const src=String(text||'').trim(),start=src.indexOf('{');
  if(start<0)throw new Error('AI response has no JSON');
  let depth=0,inString=false,escaped=false,end=-1;
  for(let i=start;i<src.length;i++){
    const ch=src[i];
    if(inString){
      if(escaped){escaped=false;continue;}
      if(ch==='\\'){escaped=true;continue;}
      if(ch==='"')inString=false;
      continue;
    }
    if(ch==='"'){inString=true;continue;}
    if(ch==='{')depth++;
    else if(ch==='}'&&--depth===0){end=i;break;}
  }
  if(end<0)throw new Error('AI JSON truncated');
  return JSON.parse(src.slice(start,end+1));
}
function bugfixResultAllowed(stage,result){
  if(!result||typeof result!=='object'||Array.isArray(result))return false;
  if(stage==='plan'){
    if(Object.keys(result).some(k=>!['analysis','risk','files','queries'].includes(k))||
       !bugReportText(result.analysis||'',5000,10)||
       !['low','medium','high'].includes(result.risk)||
       !Array.isArray(result.files)||result.files.length>8||
       !result.files.every(bugfixPathAllowed)||
       !Array.isArray(result.queries)||result.queries.length>10||
       !result.queries.every(q=>bugReportText(q,120,1)))return false;
    return true;
  }
  if(Object.keys(result).some(k=>!['summary','risk','edits'].includes(k))||
     !bugReportText(result.summary||'',3000,10)||
     !['low','medium','high'].includes(result.risk)||
     !Array.isArray(result.edits)||result.edits.length<1||result.edits.length>6)return false;
  return result.edits.every(e=>e&&typeof e==='object'&&!Array.isArray(e)&&
    Object.keys(e).every(k=>['path','find','replace'].includes(k))&&
    bugfixPathAllowed(e.path)&&typeof e.find==='string'&&e.find.length>=3&&e.find.length<=16000&&
    typeof e.replace==='string'&&e.replace.length<=20000);
}
async function callBugfixClaude(env,ctx,stage,body){
  const report=body.report;
  const system=stage==='plan'
    ?'Eres un ingeniero de software que diagnostica bugs del Dashboard The Lab Solutions. Devuelve SOLO JSON válido. No propongas cambios de seguridad, autenticación, permisos, facturación, SII, secretos, workflows, infraestructura ni dependencias externas. Si el reporte parece tocar esas áreas, marca risk high. Elige como máximo 8 archivos del repoMap y hasta 10 cadenas de búsqueda breves. Formato exacto: {"analysis":"diagnóstico concreto","risk":"low|medium|high","files":["ruta"],"queries":["texto"]}.'
    :'Eres un ingeniero que prepara un parche mínimo y verificable. Devuelve SOLO JSON válido. Solo puedes editar archivos incluidos en FILES. Cada edición es reemplazo exacto find/replace y find debe ser suficientemente específico. No toques seguridad, autenticación, permisos, facturación, SII, secretos, workflows, infraestructura ni dependencias. No inventes archivos. Formato exacto: {"summary":"qué corrige","risk":"low|medium|high","edits":[{"path":"ruta","find":"texto exacto existente","replace":"texto nuevo"}]}.';
  let content;
  if(stage==='plan'){
    const screenshot=String(report.screenshot||'');
    const text='REPORTE\n'+JSON.stringify({...report,screenshot:undefined})+
      '\n\nARCHIVOS DISPONIBLES\n'+body.repoMap.join('\n');
    content=[{type:'text',text}];
    if(screenshot){
      content.push({type:'image',source:{type:'base64',media_type:'image/jpeg',
        data:screenshot.slice(screenshot.indexOf(',')+1)}});
    }
  }else{
    content='REPORTE\n'+JSON.stringify(report)+'\n\nPLAN\n'+JSON.stringify(body.plan)+
      '\n\nFILES\n'+body.files.map(f=>'===== '+f.path+' =====\n'+f.content).join('\n');
  }
  const payload={
    model:'claude-sonnet-4-6',
    max_tokens:stage==='plan'?700:1800,
    system,
    messages:[{role:'user',content}]
  };
  const reservation=await reserveAiBudget(env,payload,'bugfix-'+stage);
  if(!reservation.ok)throw Object.assign(new Error(reservation.error||'AI budget unavailable'),
    {status:reservation.status||429});
  let upstream;
  try{
    upstream=await fetch(ANTHROPIC_BASE+'/v1/messages',{
      method:'POST',headers:{'x-api-key':env.ANTHROPIC_TOKEN,
        'anthropic-version':'2023-06-01','Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
  }catch(e){
    await releaseAiReservation(env,reservation,'bugfix_network');
    throw e;
  }
  const usageCopy=upstream.clone();
  const accounting=reconcileAiBudget(env,reservation,usageCopy).catch(()=>{});
  if(ctx&&typeof ctx.waitUntil==='function')ctx.waitUntil(accounting);else await accounting;
  if(!upstream.ok)throw Object.assign(new Error('Anthropic rejected bugfix request'),{status:upstream.status});
  const data=await upstream.json();
  const text=(Array.isArray(data?.content)?data.content:[]).filter(x=>x?.type==='text').map(x=>x.text||'').join('\n');
  const result=parseBugfixJson(text);
  if(!bugfixResultAllowed(stage,result))throw new Error('AI bugfix response failed validation');
  return result;
}
async function handleGithubBugfixAi(request,env,ctx){
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  if(!env.ANTHROPIC_TOKEN)return json({error:'AI service unavailable'},503);
  try{await verifyGithubBugfixOidc(request);}
  catch(_){return json({error:'Valid GitHub Actions OIDC token required'},401);}
  if(!/^application\/json(?:;|$)/i.test(String(request.headers.get('Content-Type')||''))||
     Number(request.headers.get('Content-Length')||0)>125000)
    return json({error:'Bugfix service expects bounded JSON'},415);
  let body;try{
    const raw=await request.text();if(raw.length>125000)throw Error('large');
    body=JSON.parse(raw);
  }catch(_){return json({error:'Invalid bugfix service JSON'},422);}
  const stage=body?.stage;
  if(stage==='plan'?!bugfixPlanRequestAllowed(body):
     stage==='patch'?!bugfixPatchRequestAllowed(body):true)
    return json({error:'Invalid bugfix service request'},422);
  try{return json({ok:true,result:await callBugfixClaude(env,ctx,stage,body)},200);}
  catch(e){
    return json({error:String(e?.message||'Bugfix AI failed').slice(0,500)},
      Number.isInteger(e?.status)&&e.status>=400&&e.status<=599?e.status:502);
  }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const CORS = cors(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, proxy: 'thelab-proxy', anthropic: !!env.ANTHROPIC_TOKEN, openai: !!env.OPENAI_TOKEN, airtable: !!env.AIRTABLE_TOKEN, reportes_iso_upsert: !!env.CRM_MUTATION_GUARD, marketing_spend_guard: !!env.CRM_MUTATION_GUARD }, 200, CORS);
    }

    // GitHub Actions obtains a short-lived OIDC token. This service route never
    // accepts the public APP_KEY and never exposes the Anthropic secret.
    if(url.pathname==='/service/github/bugfix-ai'){
      return handleGithubBugfixAi(request,env,ctx);
    }

    // Login is a top-level browser navigation. Cloudflare Access handles the
    // identity provider redirect at the edge; the Worker verifies the signed
    // assertion independently, then returns to the fixed dashboard origin.
    // No APP_KEY, query-string return URLs, or client-controlled redirects.
    if(url.pathname==='/access/session'){
      if(request.method!=='GET'||url.search)
        return json({error:'Access login path not allowed'},405,CORS);
      const signed=await accessAuthorize(request,env,'/access/me');
      if(signed.response||!signed.identity)
        return json({error:'Cloudflare Access must be activated before login'},503,CORS);
      return new Response(null,{status:302,headers:{
        Location:'https://dashboard.thelab.solutions/',
        'Cache-Control':'no-store','Referrer-Policy':'no-referrer'
      }});
    }

    // Allowlist de origen: solo se aceptan peticiones cuyo Origin esté en la lista.
    // Antes el chequeo era `if (origin && ...)`, así que una petición SIN header
    // Origin (curl, un script, server-to-server) se lo saltaba por completo. Exigir
    // un Origin permitido bloquea abuso casual desde navegadores ajenos, pero no
    // convierte APP_KEY en identidad: clientes HTTP pueden enviar ese header.
    // /health queda libre más arriba para los monitores.
    const leadServiceRoute=url.pathname==='/service/lead/anthropic/v1/messages';
    if (leadServiceRoute && url.search)
      return json({error:'Lead service query parameters not allowed'},400,CORS);
    if (!leadServiceRoute && !ALLOWED_ORIGINS.includes(origin)) {
      return json({ error: 'Forbidden origin' }, 403, CORS);
    }

    // Auth — la passphrase nunca sale al cliente como un token de servicio real
    const appKey = request.headers.get('X-App-Key');
    if (!leadServiceRoute && (!appKey || appKey !== env.APP_KEY)) {
      return json({ error: 'Unauthorized' }, 403, CORS);
    }
    // After configuration, the shared app key is only a compatibility check.
    // Cloudflare Access signs each user's identity, and role decisions happen
    // on the server; a forged Origin or copied APP_KEY cannot grant rights.
    const authorized=await accessAuthorize(request,env,
      leadServiceRoute?'/service/lead/anthropic/v1/messages':
      url.pathname.startsWith('/v0/')||url.pathname.startsWith('/anthropic/')||
      url.pathname.startsWith('/openai/')||url.pathname.startsWith('/seo-')||url.pathname.startsWith('/sii/')||url.pathname.startsWith('/portal-admin/')||url.pathname==='/feedback/link'||url.pathname.startsWith('/printer/')||url.pathname.startsWith('/marketing/')||url.pathname==='/integrations/check'||url.pathname==='/shared/calendar'||url.pathname==='/shared/agenda'||url.pathname==='/shared/mail'||url.pathname==='/shared/machineops'||url.pathname==='/shared/simulation'||url.pathname==='/shared/bug-reports'||url.pathname==='/access/me'
        ?url.pathname:'/v0'+url.pathname);
    if(authorized.response){
      const headers=new Headers(authorized.response.headers);
      Object.entries(CORS).forEach(([k,v])=>headers.set(k,v));
      return new Response(authorized.response.body,{status:authorized.response.status,headers});
    }
    if(url.pathname==='/access/me'){
      if(request.method!=='GET'||url.search)return json({error:'Method not allowed'},405,CORS);
      return json(authorized.identity
        ?{enabled:true,authenticated:true,role:authorized.identity.role,email:authorized.identity.email}
        :{enabled:false,authenticated:false},200,{...CORS,'Cache-Control':'no-store'});
    }
    // Diagnóstico bajo demanda: GET exclusivamente, lista fija de proveedores
    // y solicitudes de identidad/metadatos. No ejecuta modelos ni envía eventos.
    // Requiere APP_KEY y origen autorizados antes de este bloque; Access, si
    // está activado, exige además una sesión administrativa firmada.
    if(url.pathname==='/integrations/check'){
      const headers={...CORS,'Cache-Control':'no-store'};
      if(request.method!=='GET'||url.searchParams.size!==1||
         url.searchParams.getAll('service').length!==1)
        return json({error:'Consulta de diagnóstico no permitida'},405,headers);
      if(authorized.identity&&authorized.identity.role!=='admin')
        return json({error:'Diagnóstico reservado a administración'},403,headers);
      const service=url.searchParams.get('service');
      const specs={
        anthropic:{secret:env.ANTHROPIC_TOKEN,url:'https://api.anthropic.com/v1/models?limit=1',
          headers:()=>({'x-api-key':env.ANTHROPIC_TOKEN,'anthropic-version':'2023-06-01'})},
        openai:{secret:env.OPENAI_TOKEN,url:'https://api.openai.com/v1/models',
          headers:()=>({Authorization:'Bearer '+env.OPENAI_TOKEN})},
        make:{secret:env.MAKE_API_TOKEN,
          url:'https://'+(env.MAKE_API_ZONE||'eu1')+'.make.com/api/v2/organizations',
          headers:()=>({Authorization:'Token '+env.MAKE_API_TOKEN})},
        meta:{secret:env.META_ACCESS_TOKEN,url:'https://graph.facebook.com/v23.0/me?fields=id',
          headers:()=>({Authorization:'Bearer '+env.META_ACCESS_TOKEN})}
      };
      if(!Object.hasOwn(specs,service))
        return json({error:'Servicio no admitido'},404,headers);
      const cfg=specs[service];
      if(service==='make'&&!['eu1','eu2','us1','us2','ca1','au1'].includes(env.MAKE_API_ZONE||'eu1'))
        return json({status:'gray',verified:false,message:'Zona API de Make no configurada correctamente'},200,headers);
      if(!cfg.secret)
        return json({status:'gray',verified:false,message:'Falta la credencial del servicio en Cloudflare'},200,headers);
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),6000);
      try{
        const upstream=await fetch(cfg.url,{method:'GET',headers:cfg.headers(),
          redirect:'manual',signal:controller.signal});
        // No se reenvían ni guardan cuerpos o cabeceras del proveedor.
        // Los 401/403 confirman credenciales/permisos inválidos; 429 y
        // respuestas 5xx son transitorias y no confirman caída definitiva.
        const status=upstream.ok?'green':
          (upstream.status===401||upstream.status===403)?'red':'yellow';
        try{await upstream.body?.cancel?.();}catch(_){}
        return json({status,verified:upstream.ok,
          message:upstream.ok?'Autenticación de solo lectura verificada':
            upstream.status===401?'Clave rechazada por el proveedor':
            upstream.status===403?'El proveedor rechazó los permisos':
            upstream.status===429?'Límite de solicitudes del proveedor':
            'No se pudo verificar; respuesta del proveedor'},200,headers);
      }catch(_){
        return json({status:'yellow',verified:false,message:'Proveedor no verificable en este momento'},200,headers);
      }finally{clearTimeout(timeout);}
    }

    if(authorized.identity&&request.method!=='GET'){
      console.log('[Access audit]',JSON.stringify({
        email:authorized.identity.email,role:authorized.identity.role,
        method:request.method,path:url.pathname.slice(0,180),
      }));
    }

    // Internal bug reports get a narrow endpoint. Screenshots are stored
    // separately from metadata so history reads stay small.
    if(url.pathname==='/shared/bug-reports'){
      const scopedHeaders={...CORS,'Cache-Control':'private, no-store'};
      const keys=[...url.searchParams.keys()];
      if(keys.some(k=>k!=='id')||url.searchParams.getAll('id').length>1)
        return json({error:'Bug report query invalid'},422,scopedHeaders);

      if(request.method==='GET'){
        const id=url.searchParams.get('id')||'';
        const identity=authorized.identity||null;
        const result=id?await sharedBugReportLoad(env,id,identity):await sharedBugReportList(env,identity);
        if(result.error){
          const status=result.error==='not-found'?404:
            result.error==='invalid-id'?422:503;
          return json({error:result.error},status,scopedHeaders);
        }
        return id
          ?json({ok:true,report:result.report,screenshot:result.screenshot||''},200,scopedHeaders)
          :json({ok:true,reports:result.reports||[]},200,scopedHeaders);
      }

      if(url.search)return json({error:'Bug report write query not allowed'},422,scopedHeaders);

      if(request.method==='POST'){
        if(!/^application\/json(?:;|$)/i.test(String(request.headers.get('Content-Type')||''))||
           Number(request.headers.get('Content-Length')||0)>100000)
          return json({error:'Bug report expects bounded JSON'},415,scopedHeaders);
        let body;try{
          const raw=await request.text();if(raw.length>100000)throw Error('large');
          body=JSON.parse(raw);
        }catch(_){return json({error:'Invalid bug report JSON'},422,scopedHeaders);}
        const result=await sharedBugReportCreate(env,body,authorized.identity||null);
        if(result.error)return json({error:result.error},result.uncertain?503:422,scopedHeaders);
        return json({ok:true,id:result.id,report:result.report},201,scopedHeaders);
      }

      if(request.method==='PATCH'){
        if(authorized.identity?.role!=='admin')
          return json({error:'Admin role required for bug report actions'},403,scopedHeaders);
        if(!/^application\/json(?:;|$)/i.test(String(request.headers.get('Content-Type')||''))||
           Number(request.headers.get('Content-Length')||0)>10000)
          return json({error:'Bug report action expects bounded JSON'},415,scopedHeaders);
        let body;try{
          const raw=await request.text();if(raw.length>10000)throw Error('large');
          body=JSON.parse(raw);
        }catch(_){return json({error:'Invalid bug report action JSON'},422,scopedHeaders);}
        if(!body||typeof body!=='object'||Array.isArray(body)||
           Object.keys(body).some(k=>!['id','action'].includes(k))||
           !bugReportIdAllowed(body.id)||!['retry','close'].includes(body.action))
          return json({error:'Invalid bug report action'},422,scopedHeaders);
        const result=await sharedBugReportAction(env,body.id,body.action);
        if(result.error){
          const status=result.error==='not-found'?404:
            result.error==='retry-not-allowed'?409:422;
          return json({error:result.error},status,scopedHeaders);
        }
        return json({ok:true,report:result.report},200,scopedHeaders);
      }
      return json({error:'Method not allowed'},405,scopedHeaders);
    }

    // Calendar collaboration gets a dedicated document endpoint instead of
    // granting browsers generic Monitor Sistema access.
    if(url.pathname==='/shared/calendar'){
      const scopedHeaders={...CORS,'Cache-Control':'private, no-store'};
      if(url.search)return json({error:'Calendar query parameters not allowed'},422,scopedHeaders);
      if(request.method==='GET'){
        const current=await sharedCalendarLoad(env);
        if(current.error)return json({error:'Shared calendar unavailable'},503,scopedHeaders);
        return json({ok:true,revision:current.revision,data:current.data},200,scopedHeaders);
      }
      if(request.method!=='PUT')return json({error:'Method not allowed'},405,scopedHeaders);
      if(!/^application\/json(?:;|$)/i.test(String(request.headers.get('Content-Type')||''))||
         Number(request.headers.get('Content-Length')||0)>100000)
        return json({error:'Calendar expects bounded JSON'},415,scopedHeaders);
      let body;try{
        const raw=await request.text();if(raw.length>100000)throw Error('large');
        body=JSON.parse(raw);
      }catch(_){return json({error:'Invalid calendar JSON'},422,scopedHeaders);}
      if(!body||Object.keys(body).some(k=>!['data','expectedRevision'].includes(k))||
         !sharedCalendarPayloadAllowed(body.data)||
         typeof body.expectedRevision!=='string'||body.expectedRevision.length>64)
        return json({error:'Invalid calendar document'},422,scopedHeaders);
      if(!env.CRM_MUTATION_GUARD)
        return json({error:'Calendar write guard unavailable'},503,scopedHeaders);
      try{
        const stub=env.CRM_MUTATION_GUARD.get(
          env.CRM_MUTATION_GUARD.idFromName('tls-shared-calendar'));
        const guarded=await stub.fetch('https://crm-write.internal/shared-calendar',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({data:body.data,expectedRevision:body.expectedRevision,
            actor:authorized.identity
              ?{email:authorized.identity.email,role:authorized.identity.role}
              :{legacy:true}})
        });
        const headers=new Headers(guarded.headers);
        Object.entries(scopedHeaders).forEach(([k,v])=>headers.set(k,v));
        return new Response(guarded.body,{status:guarded.status,headers});
      }catch(_){return json({error:'Calendar write guard unavailable'},503,scopedHeaders);}
    }


    // Agenda collaboration is scoped per signed identity. Sales users receive
    // only their own email scope; all other signed roles receive __equipo__.
    // Legacy APP_KEY mode keeps an explicit scope only until Access cutover.
    if(url.pathname==='/shared/agenda'){
      const scopedHeaders={...CORS,'Cache-Control':'private, no-store'};
      const queryKeys=[...url.searchParams.keys()];
      if(queryKeys.some(k=>k!=='scope')||url.searchParams.getAll('scope').length!==1)
        return json({error:'Agenda requires exactly one scope'},422,scopedHeaders);
      const requestedScope=url.searchParams.get('scope')||'';
      const scope=sharedAgendaScopeFor(authorized.identity,requestedScope,authorized.legacy===true);
      if(!scope)return json({error:'Agenda scope denied'},403,scopedHeaders);
      if(request.method==='GET'){
        const current=await sharedAgendaLoad(env,scope);
        if(current.error)return json({error:'Shared agenda unavailable'},503,scopedHeaders);
        return json({ok:true,scope,revision:current.revision,data:current.data},200,scopedHeaders);
      }
      if(request.method!=='PUT')return json({error:'Method not allowed'},405,scopedHeaders);
      if(!/^application\/json(?:;|$)/i.test(String(request.headers.get('Content-Type')||''))||
         Number(request.headers.get('Content-Length')||0)>100000)
        return json({error:'Agenda expects bounded JSON'},415,scopedHeaders);
      let body;try{
        const raw=await request.text();if(raw.length>100000)throw Error('large');
        body=JSON.parse(raw);
      }catch(_){return json({error:'Invalid agenda JSON'},422,scopedHeaders);}
      if(!body||Object.keys(body).some(k=>!['scope','data','expectedRevision'].includes(k))||
         body.scope!==scope||!sharedAgendaItemsAllowed(body.data)||
         typeof body.expectedRevision!=='string'||body.expectedRevision.length>64)
        return json({error:'Invalid agenda document'},422,scopedHeaders);
      if(!env.CRM_MUTATION_GUARD)
        return json({error:'Agenda write guard unavailable'},503,scopedHeaders);
      try{
        const stub=env.CRM_MUTATION_GUARD.get(
          env.CRM_MUTATION_GUARD.idFromName('tls-shared-agenda'));
        const guarded=await stub.fetch('https://crm-write.internal/shared-agenda',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({scope,data:body.data,expectedRevision:body.expectedRevision,
            actor:authorized.identity
              ?{email:authorized.identity.email,role:authorized.identity.role}
              :{legacy:true}})
        });
        const headers=new Headers(guarded.headers);
        Object.entries(scopedHeaders).forEach(([k,v])=>headers.set(k,v));
        return new Response(guarded.body,{status:guarded.status,headers});
      }catch(_){return json({error:'Agenda write guard unavailable'},503,scopedHeaders);}
    }


    // Shared mail metadata gets a narrow resource endpoint. Signatures and
    // sent-recipient history are mailbox-scoped; templates are company-wide.
    if(url.pathname==='/shared/mail'){
      const scopedHeaders={...CORS,'Cache-Control':'private, no-store'};
      const keys=[...url.searchParams.keys()];
      if(keys.some(k=>!['resource','account'].includes(k))||
         url.searchParams.getAll('resource').length!==1||
         url.searchParams.getAll('account').length>1)
        return json({error:'Mail query parameters invalid'},422,scopedHeaders);
      const resource=url.searchParams.get('resource')||'';
      if(!Object.hasOwn(SHARED_MAIL_RECORDS,resource))
        return json({error:'Unknown mail resource'},404,scopedHeaders);
      const account=url.searchParams.get('account')||'';
      if(resource==='templates'&&account)
        return json({error:'Templates do not accept a mailbox'},422,scopedHeaders);
      if(resource!=='templates'&&!sharedMailMailboxAllowed(
        authorized.identity,account,authorized.legacy===true))
        return json({error:'Mailbox scope denied'},403,scopedHeaders);
      if(request.method==='GET'){
        const current=await sharedMailLoad(env,resource,account);
        if(current.error)return json({error:'Shared mail unavailable'},503,scopedHeaders);
        return json({ok:true,resource,
          ...(resource==='templates'?{}:{account}),exists:current.exists,
          revision:current.revision,data:current.data},200,scopedHeaders);
      }
      if(request.method!=='PUT')return json({error:'Method not allowed'},405,scopedHeaders);
      if(!/^application\/json(?:;|$)/i.test(String(request.headers.get('Content-Type')||''))||
         Number(request.headers.get('Content-Length')||0)>100000)
        return json({error:'Mail expects bounded JSON'},415,scopedHeaders);
      let body;try{
        const raw=await request.text();if(raw.length>100000)throw Error('large');
        body=JSON.parse(raw);
      }catch(_){return json({error:'Invalid mail JSON'},422,scopedHeaders);}
      if(!body||Object.keys(body).some(k=>!['resource','account','data','expectedRevision'].includes(k))||
         body.resource!==resource||
         (resource==='templates'?body.account!==undefined:body.account!==account)||
         !sharedMailDataAllowed(resource,body.data)||
         typeof body.expectedRevision!=='string'||body.expectedRevision.length>64)
        return json({error:'Invalid mail document'},422,scopedHeaders);
      if(!env.CRM_MUTATION_GUARD)
        return json({error:'Mail write guard unavailable'},503,scopedHeaders);
      try{
        const stub=env.CRM_MUTATION_GUARD.get(
          env.CRM_MUTATION_GUARD.idFromName('tls-shared-mail'));
        const guarded=await stub.fetch('https://crm-write.internal/shared-mail',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({resource,
            ...(resource==='templates'?{}:{account}),
            data:body.data,expectedRevision:body.expectedRevision,
            actor:authorized.identity
              ?{email:authorized.identity.email,role:authorized.identity.role}
              :{legacy:true}})
        });
        const headers=new Headers(guarded.headers);
        Object.entries(scopedHeaders).forEach(([k,v])=>headers.set(k,v));
        return new Response(guarded.body,{status:guarded.status,headers});
      }catch(_){return json({error:'Mail write guard unavailable'},503,scopedHeaders);}
    }


    // MachineOps is isolated from generic Monitor Sistema access. Reads expose
    // only allowlisted MachineOps records (without Airtable IDs); writes are
    // serialized and CAS-guarded per domain.
    if(url.pathname==='/shared/machineops'){
      const scopedHeaders={...CORS,'Cache-Control':'private, no-store'};
      const keys=[...url.searchParams.keys()];
      if(keys.some(k=>k!=='record')||url.searchParams.getAll('record').length>1)
        return json({error:'MachineOps query parameters invalid'},422,scopedHeaders);
      const record=url.searchParams.get('record')||'';
      if(record&&record!==SHARED_MACHINEOPS_BED_HISTORY)
        return json({error:'MachineOps record denied'},403,scopedHeaders);
      if(request.method==='GET'){
        const current=await sharedMachineOpsLoad(env,record);
        if(current.error)return json({error:'MachineOps unavailable'},503,scopedHeaders);
        return json({ok:true,records:current.records,revisions:current.revisions},200,scopedHeaders);
      }
      if(request.method!=='PUT')return json({error:'Method not allowed'},405,scopedHeaders);
      if(!/^application\/json(?:;|$)/i.test(String(request.headers.get('Content-Type')||''))||
         Number(request.headers.get('Content-Length')||0)>300000)
        return json({error:'MachineOps expects bounded JSON'},415,scopedHeaders);
      let body;try{
        const raw=await request.text();if(raw.length>300000)throw Error('large');
        body=JSON.parse(raw);
      }catch(_){return json({error:'Invalid MachineOps JSON'},422,scopedHeaders);}
      if(!env.CRM_MUTATION_GUARD)
        return json({error:'MachineOps write guard unavailable'},503,scopedHeaders);
      let guardedBody;
      if(record){
        if(!body||Object.keys(body).some(k=>!['data','expectedRevision'].includes(k))||
           !sharedMachineBedHistoryAllowed(body.data)||
           typeof body.expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedRevision))
          return json({error:'Invalid machine history document'},422,scopedHeaders);
        guardedBody={mode:'record',record,data:body.data,expectedRevision:body.expectedRevision};
      }else{
        if(!body||Object.keys(body).some(k=>!['writes','meta'].includes(k))||
           !Array.isArray(body.writes)||!sharedMachinePlainObject(body.meta))
          return json({error:'Invalid MachineOps document'},422,scopedHeaders);
        guardedBody={mode:'snapshot',writes:body.writes,meta:body.meta};
      }
      guardedBody.actor=authorized.identity
        ?{email:authorized.identity.email,role:authorized.identity.role}:{legacy:true};
      try{
        const stub=env.CRM_MUTATION_GUARD.get(
          env.CRM_MUTATION_GUARD.idFromName('tls-shared-machineops'));
        const guarded=await stub.fetch('https://crm-write.internal/shared-machineops',{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(guardedBody)
        });
        const headers=new Headers(guarded.headers);
        Object.entries(scopedHeaders).forEach(([k,v])=>headers.set(k,v));
        return new Response(guarded.body,{status:guarded.status,headers});
      }catch(_){return json({error:'MachineOps write guard unavailable'},503,scopedHeaders);}
    }


    // Synthetic demand history gets a dedicated, redacted document endpoint.
    // Only admin or the explicit Marketing identity may use it under Access.
    if(url.pathname==='/shared/simulation'){
      const scopedHeaders={...CORS,'Cache-Control':'private, no-store'};
      if(url.search)return json({error:'Simulation query parameters not allowed'},422,scopedHeaders);
      if(request.method==='GET'){
        const current=await sharedSimulationLoad(env);
        if(current.error)return json({error:'Simulation history unavailable'},503,scopedHeaders);
        return json({ok:true,exists:current.exists,revision:current.revision,data:current.data},
          200,scopedHeaders);
      }
      if(request.method!=='PUT')return json({error:'Method not allowed'},405,scopedHeaders);
      if(!/^application\/json(?:;|$)/i.test(String(request.headers.get('Content-Type')||''))||
         Number(request.headers.get('Content-Length')||0)>100000)
        return json({error:'Simulation history expects bounded JSON'},415,scopedHeaders);
      let body;try{
        const raw=await request.text();if(raw.length>100000)throw Error('large');
        body=JSON.parse(raw);
      }catch(_){return json({error:'Invalid simulation history JSON'},422,scopedHeaders);}
      if(!body||Object.keys(body).some(k=>!['data','expectedRevision'].includes(k))||
         !sharedSimulationDocumentAllowed(body.data)||
         typeof body.expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedRevision))
        return json({error:'Invalid simulation history document'},422,scopedHeaders);
      if(!env.CRM_MUTATION_GUARD)
        return json({error:'Simulation history guard unavailable'},503,scopedHeaders);
      try{
        const stub=env.CRM_MUTATION_GUARD.get(
          env.CRM_MUTATION_GUARD.idFromName('tls-shared-simulation'));
        const guarded=await stub.fetch('https://crm-write.internal/shared-simulation',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({data:body.data,expectedRevision:body.expectedRevision,
            actor:authorized.identity
              ?{email:authorized.identity.email,role:authorized.identity.role}
              :{legacy:true}})
        });
        const headers=new Headers(guarded.headers);
        Object.entries(scopedHeaders).forEach(([k,v])=>headers.set(k,v));
        return new Response(guarded.body,{status:guarded.status,headers});
      }catch(_){return json({error:'Simulation history guard unavailable'},503,scopedHeaders);}
    }

    // A signed read-only viewer never receives the full Airtable CRM row.
    // Unreviewed tables fail closed; Access remains optional until cutover.
    if(authorized.identity?.role==='viewer'&&
       (url.pathname.startsWith('/v0/')||
        url.pathname.startsWith('/app1YtD74AqiPWQhy/')))
      return viewerScopedRead(request,url,env,CORS);
    // Signed operators may read company-wide commercial data, but financial
    // columns and unreviewed schema additions never reach their browsers.
    if(authorized.identity?.role==='operator'&&request.method==='GET'){
      const opPath=url.pathname.startsWith('/v0/')?url.pathname:'/v0'+url.pathname;
      const prefix='/v0/app1YtD74AqiPWQhy/';
      if(opPath.startsWith(prefix)){
        const raw=opPath.slice(prefix.length).split('/')[0];
        let table;
        try{table=decodeURIComponent(raw);}catch(_){}
        if(table&&Object.hasOwn(OPERATOR_READ_FIELDS,table))
          return viewerScopedRead(request,url,env,CORS,OPERATOR_READ_FIELDS);
      }
    }
    // All signed operator writes to CRM/suppliers are field/type guarded;
    // non-reviewed mutation tables are denied by RBAC, never forwarded here.
    if(authorized.identity?.role==='operator'&&request.method!=='GET'){
      const opPath=url.pathname.startsWith('/v0/')?url.pathname:'/v0'+url.pathname;
      const prefix='/v0/app1YtD74AqiPWQhy/';
      let table='';
      if(opPath.startsWith(prefix)){
        const raw=opPath.slice(prefix.length).split('/')[0];
        try{table=decodeURIComponent(raw);}catch(_){}
      }
      if(Object.hasOwn(OPERATOR_WRITE_FIELDS,table))
        return operatorScopedWrite(request,url,authorized.identity,env,CORS);
      if(request.method==='DELETE'&&opPath.startsWith(prefix))
        return json({error:'Operator deletion denied'},403,CORS);
    }
    // The new sales role has a dedicated owner-scoped Airtable read path.
    // It cannot reach AI, printers, SII, portal, schema or generic CRM writes.
    if(authorized.identity?.role==='sales')
      return request.method==='GET'
        ?sellerScopedRead(request,url,authorized.identity,env,CORS)
        :sellerScopedWrite(request,url,authorized.identity,env,CORS);
    // Existing privileged PATCHes must share the sales write lock whenever
    // Access is active. Legacy mode is intentionally unchanged until cutover.
    if(authorized.identity&&request.method==='PATCH'){
      const scopedPath=url.pathname.startsWith('/v0/')?url.pathname:'/v0'+url.pathname;
      const scopedParts=scopedPath.startsWith(SCOPED_CRM_PREFIX)
        ?scopedPath.slice(SCOPED_CRM_PREFIX.length).split('/'):[];
      let scopedTable;
      try{scopedTable=decodeURIComponent(scopedParts[0]||'');}catch(_){}
      if(SELLER_SCOPE_TABLES.has(scopedTable)&&
         scopedParts[0]===encodeURIComponent(scopedTable)&&
         scopedParts.length<=2)
        return privilegedScopedPatch(request,url,authorized.identity,env,CORS,scopedTable);
    }



    // Marketing spending is shared only under a verified individual Access
    // session. Legacy APP_KEY mode cannot read or mutate financial history.
    if(url.pathname.startsWith('/marketing/')){
      const isSpend=url.pathname==='/marketing/spend',
        isHistory=url.pathname==='/marketing/spend/history';
      if(!isSpend&&!isHistory)return json({error:'Marketing route not found'},404,CORS);
      if(!authorized.identity)
        return json({error:'Shared marketing spend requires Cloudflare Access',
          code:'ACCESS_REQUIRED'},503,{...CORS,'Cache-Control':'no-store'});
      if(!['finance','admin'].includes(authorized.identity.role))
        return json({error:'Marketing spend role denied'},403,CORS);
      const method=request.method;
      if(!((isSpend&&['GET','PUT'].includes(method))||(isHistory&&method==='GET')))
        return json({error:'Method not allowed'},405,CORS);
      const pairs=[...url.searchParams.entries()];
      const months=url.searchParams.getAll('month');
      const cursors=url.searchParams.getAll('before_revision');
      if(months.length!==1||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(months[0])||
         pairs.length!==1+cursors.length||cursors.length>(isHistory?1:0)||
         pairs.some(([name])=>name!=='month'&&name!=='before_revision')||
         (cursors.length>0&&!/^[1-9]\d{0,11}$/.test(cursors[0])))
        return json({error:'Expected month and optional history cursor'},422,CORS);
      if(!env.CRM_MUTATION_GUARD)
        return json({error:'Marketing spending guard unavailable'},503,CORS);
      let payload={op:isHistory?'history':method==='PUT'?'put':'get',
        month:months[0],actor:{
          role:authorized.identity.role,email:authorized.identity.email}};
      if(isHistory&&cursors.length)payload.before_revision=Number(cursors[0]);
      if(method==='PUT'){
        if(!String(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json')||
           Number(request.headers.get('Content-Length')||0)>1024)
          return json({error:'JSON required, maximum 1024 bytes'},413,CORS);
        try{
          const raw=await request.text();
          if(raw.length>1024)throw Error('too large');
          const parsed=JSON.parse(raw);
          if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
             !Object.keys(parsed).every(k=>['channel','amount_clp','expected_revision'].includes(k)))
            throw Error('invalid keys');
          payload={...payload,...parsed};
        }catch(_){return json({error:'Invalid spending update'},400,CORS);}
      }
      try{
        const id=env.CRM_MUTATION_GUARD.idFromName('tls-marketing-spend-global');
        const upstream=await env.CRM_MUTATION_GUARD.get(id).fetch('https://marketing.internal/marketing/spend',{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
        });
        return new Response(upstream.body,{status:upstream.status,
          headers:{...CORS,'Content-Type':'application/json','Cache-Control':'no-store'}});
      }catch(_){return json({error:'Shared spending temporarily unavailable'},503,CORS);}
    }

    // The lead Worker's privileged portal key never reaches Pages. This
    // bridge is disabled in legacy APP_KEY-only mode, and grants ONLY the
    // two explicit portal administration actions to verified humans.
    if(url.pathname.startsWith('/portal-admin/')){
      if(!authorized.identity)
        return json({error:'Portal requires a signed Access user session',code:'ACCESS_REQUIRED'},503,CORS);
      const action=url.pathname.slice('/portal-admin/'.length);
      if(request.method!=='POST'||url.search||!['link','revocar'].includes(action))
        return json({error:'Portal admin route not allowed'},404,CORS);
      if(!String(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
        return json({error:'Portal request must be JSON'},415,CORS);
      const size=Number(request.headers.get('Content-Length')||0);
      if(size>2048)return json({error:'Portal request too large'},413,CORS);
      let payload;
      try {
        const raw=await request.text();
        if(raw.length>2048)throw new Error('Payload too large');
        payload=JSON.parse(raw);
      }catch(_){return json({error:'Invalid portal JSON'},400,CORS);}
      if(!payload||typeof payload!=='object'||Array.isArray(payload)||
         !/^rec[A-Za-z0-9]{8,32}$/.test(payload.clienteId||'')||
         !Object.keys(payload).every(k=>k==='clienteId'||(action==='link'&&k==='dias'))||
         (action==='link'&&payload.dias!==undefined&&
           (!Number.isInteger(payload.dias)||payload.dias<1||payload.dias>365)))
        return json({error:'Invalid portal client or expiry'},400,CORS);
      let lead;
      try {
        lead=new URL(String(env.LEAD_WORKER_URL||''));
        if(lead.protocol!=='https:'||lead.username||lead.password||lead.port||
           lead.pathname!=='/'||lead.search||lead.hash||
           !(/^thelab-leads-worker\.[a-z0-9-]+\.workers\.dev$/.test(lead.hostname)||
             ['leads.thelab.solutions','portal.thelab.solutions'].includes(lead.hostname)))
          throw new Error('Untrusted lead worker origin');
      }catch(_){return json({error:'Lead Worker URL is not configured safely'},503,CORS);}
      if(typeof env.PORTAL_ADMIN_KEY!=='string'||env.PORTAL_ADMIN_KEY.length<16)
        return json({error:'Portal backend credential missing'},503,CORS);
      const body=JSON.stringify(action==='link'
        ?{clienteId:payload.clienteId,dias:payload.dias||30}
        :{clienteId:payload.clienteId});
      try {
        const upstream=await fetch(lead.origin+'/portal/'+action,{
          method:'POST',redirect:'manual',
          headers:{'Content-Type':'application/json','X-Portal-Admin-Key':env.PORTAL_ADMIN_KEY},
          body
        });
        if(upstream.status>=300&&upstream.status<400)
          return json({error:'Unexpected portal backend redirect; check result before retry'},502,CORS);
        const reply=await upstream.text();
        if(reply.length>16000||
           !String(upstream.headers.get('Content-Type')||'').toLowerCase().includes('application/json'))
          return json({error:'Invalid portal backend response; check result before retry'},502,CORS);
        return new Response(reply,{status:upstream.status,
          headers:{...CORS,'Content-Type':'application/json','Cache-Control':'no-store'}});
      }catch(_){
        return json({error:'Portal backend response uncertain; check the client before retrying'},502,CORS);
      }
    }

    // Mint short-lived, purpose-bound NPS/POD/order-tracking links. The
    // dashboard sends only an order record ID to this signed-role bridge;
    // the private portal-admin key and HMAC secret never enter GitHub Pages.
    // Legacy APP_KEY mode cannot issue signed links.
    if(url.pathname==='/feedback/link'){
      if(!authorized.identity)
        return json({error:'Signed Access required to issue feedback links',
          code:'ACCESS_REQUIRED'},503,CORS);
      if(request.method!=='POST'||url.search||
         !String(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json')||
         Number(request.headers.get('Content-Length')||0)>1024)
        return json({error:'Invalid feedback link request'},422,CORS);
      let payload;
      try{
        const raw=await request.text();
        if(raw.length>1024)throw Error('Oversized request');
        payload=JSON.parse(raw);
      }catch(_){return json({error:'Invalid feedback JSON'},400,CORS);}
      if(!payload||typeof payload!=='object'||Array.isArray(payload)||
         !/^rec[A-Za-z0-9]{14}$/.test(payload.recordId||'')||
         !['nps','pod','pedido'].includes(payload.purpose)||
         !Object.keys(payload).every(k=>['recordId','purpose','days'].includes(k))||
         (payload.days!==undefined&&
           (!Number.isInteger(payload.days)||payload.days<1||payload.days>90)))
        return json({error:'Invalid feedback purpose, record or expiry'},422,CORS);
      let lead;
      try{
        lead=new URL(String(env.LEAD_WORKER_URL||''));
        if(lead.protocol!=='https:'||lead.username||lead.password||lead.port||
           lead.pathname!=='/'||lead.search||lead.hash||
           !(/^thelab-leads-worker\.[a-z0-9-]+\.workers\.dev$/.test(lead.hostname)||
             ['leads.thelab.solutions','portal.thelab.solutions'].includes(lead.hostname)))
          throw Error('Untrusted lead worker origin');
      }catch(_){return json({error:'Lead Worker URL is not configured safely'},503,CORS);}
      if(typeof env.PORTAL_ADMIN_KEY!=='string'||env.PORTAL_ADMIN_KEY.length<16)
        return json({error:'Feedback backend credential missing'},503,CORS);
      try{
        const upstream=await fetch(lead.origin+'/feedback/link',{
          method:'POST',redirect:'manual',
          headers:{'Content-Type':'application/json','X-Portal-Admin-Key':env.PORTAL_ADMIN_KEY},
          body:JSON.stringify({
            recordId:payload.recordId,purpose:payload.purpose,
            days:payload.days===undefined?30:payload.days
          })
        });
        if(upstream.status!==200||
           !String(upstream.headers.get('Content-Type')||'').toLowerCase().includes('application/json')||
           Number(upstream.headers.get('Content-Length')||0)>4096)
          return json({error:'Feedback issuer unavailable or misconfigured'},502,CORS);
        const raw=await upstream.text();
        if(raw.length>4096)throw Error('Oversized feedback response');
        const signed=JSON.parse(raw);
        const issued=new URL(String(signed?.url||''));
        if(signed?.ok!==true||signed.purpose!==payload.purpose||
           !/^https:$/.test(issued.protocol)||issued.username||issued.password||
           issued.port||issued.hash||issued.pathname!=='/'+payload.purpose||
           (issued.origin!==lead.origin&&
             !['https://leads.thelab.solutions','https://portal.thelab.solutions'].includes(issued.origin))||
           [...issued.searchParams.keys()].some(k=>k!=='p')||
           issued.searchParams.getAll('p').length!==1||
           !/^rec[A-Za-z0-9]{14}\.[0-9a-z]{6,9}\.[A-Za-z0-9_-]{43}$/.test(
             issued.searchParams.get('p')||'')||
           !Number.isSafeInteger(signed.expires_at)||
           signed.expires_at<=Date.now()/1000||
           signed.expires_at>Date.now()/1000+91*86400)
          throw Error('Invalid feedback issuer response');
        return json({ok:true,url:issued.toString(),
          expires_at:signed.expires_at,purpose:payload.purpose},200,
          {...CORS,'Cache-Control':'no-store'});
      }catch(_){return json({error:'Cannot verify feedback issuer response'},502,CORS);}
    }

    // Issue temporary, role-scoped Farm Controller tickets from server-held
    // credentials only. Never expose any BRIDGE_* master token to Pages.
    // Unknown paths, redirects, missing role-specific keys fail closed.
    if(url.pathname.startsWith('/printer/')){
      if(!authorized.identity)
        return json({error:'Printer tickets require an authenticated user session',
          code:'ACCESS_REQUIRED'},503,CORS);
      if(url.pathname!=='/printer/session'||request.method!=='POST'||url.search||
         Number(request.headers.get('Content-Length')||0)>0)
        return json({error:'Printer ticket route not allowed'},404,CORS);
      const role=authorized.identity.role==='admin'?'admin':
        authorized.identity.role==='operator'?'operator':'viewer';
      const secretName={viewer:'PRINTER_VIEWER_TOKEN',
        operator:'PRINTER_OPERATOR_TOKEN',admin:'PRINTER_ADMIN_TOKEN'}[role];
      const secret=env[secretName];
      if(typeof secret!=='string'||secret.length<24)
        return json({error:'Farm '+role+' credential is not configured'},503,CORS);
      const farmOrigin='https://printers.thelab.solutions';
      try {
        const upstream=await fetch(farmOrigin+'/farm/session',{
          method:'POST',redirect:'manual',
          headers:{'X-Bridge-Token':secret,'Accept':'application/json'}
        });
        if(upstream.status!==201)return json({
          error:'Farm Controller did not issue a ticket; check its role tokens',
          code:'FARM_SESSION_UNAVAILABLE'
        },502,CORS);
        if(Number(upstream.headers.get('Content-Length')||0)>8192)
          return json({error:'Oversized farm session response'},502,CORS);
        const raw=await upstream.text();
        if(raw.length>8192||
           !String(upstream.headers.get('Content-Type')||'').toLowerCase().includes('application/json'))
          return json({error:'Unexpected farm session response'},502,CORS);
        const data=JSON.parse(raw);
        const expiresAt=Number(data.expiresAt),now=Date.now();
        if(data.ok!==true||data.role!==role||
           typeof data.token!=='string'||!/^[A-Za-z0-9_-]{24,200}$/.test(data.token)||
           !Number.isFinite(expiresAt)||expiresAt<=now+5000||expiresAt>now+31*60*1000)
          return json({error:'Farm Controller returned an invalid role or expiry'},502,CORS);
        return json({ok:true,token:data.token,role,expiresAt},200,
          {...CORS,'Cache-Control':'no-store','Pragma':'no-cache'});
      }catch(_){
        return json({error:'Farm Controller ticket unavailable'},502,CORS);
      }
    }

    // Proxied SII is deliberately unavailable in legacy APP_KEY-only mode.
    // Access validates the signed user's identity and requires finance/admin
    // for emit/folio; /caf is admin-only. Never forward arbitrary paths.
    if (url.pathname.startsWith('/sii/')) {
      if (!authorized.identity) {
        return json({error:'SII requires an authenticated user session',code:'ACCESS_REQUIRED'},503,CORS);
      }
      const route=url.pathname.slice('/sii'.length);
      const permitted=(route==='/emit'&&request.method==='POST')||
        (route==='/caf'&&request.method==='PUT')||
        (/^\/folio\/(33|39|52|56|61)$/.test(route)&&request.method==='GET');
      if (!permitted || url.search) return json({error:'SII proxy route not allowed'},404,CORS);
      let target;
      try {
        target=new URL(String(env.SII_WORKER_URL||''));
        if(target.protocol!=='https:'||target.username||target.password||target.search||
           target.hash||target.pathname!=='/'||
           !(target.hostname.endsWith('.workers.dev')||target.hostname==='sii.thelab.solutions'))
          throw new Error('Invalid SII backend origin');
      } catch (_) {
        return json({error:'SII backend URL is not configured safely'},503,CORS);
      }
      if(!env.SII_WORKER_KEY)
        return json({error:'SII backend secret is not configured'},503,CORS);
      let body;
      if(request.method!=='GET'){
        if(!String(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
          return json({error:'SII only accepts JSON'},415,CORS);
        body=await request.text();
        if(body.length>256000)return json({error:'SII payload exceeds limit'},413,CORS);
        try { JSON.parse(body); } catch (_) { return json({error:'Invalid SII JSON'},400,CORS); }
      }
      try {
        const upstream=await fetch(target.origin+route,{
          method:request.method,redirect:'manual',
          headers:{'Content-Type':'application/json','X-Worker-Key':env.SII_WORKER_KEY},
          ...(body===undefined?{}:{body})
        });
        // Never follow a redirect to another site with the privileged key.
        if(upstream.status>=300&&upstream.status<400)
          return json({error:'Unexpected SII redirect; document status uncertain',
            code:'DTE_PENDING_RECONCILIATION'},502,CORS);
        const replyText=await upstream.text();
        if(replyText.length>1000000||!String(upstream.headers.get('Content-Type')||'').toLowerCase().includes('application/json'))
          return json({error:'Unexpected SII response; reconcile before retrying',
            code:'DTE_PENDING_RECONCILIATION'},502,CORS);
        return new Response(replyText,{status:upstream.status,headers:{...CORS,'Content-Type':'application/json'}});
      } catch (_) {
        return json({error:'SII response unavailable; check existing folio before reissuing',
          code:'DTE_PENDING_RECONCILIATION'},502,CORS);
      }
    }

    if (url.pathname === '/anthropic/usage') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, CORS);
      const usage = await readAiBudget(env);
      return json(usage, 200, CORS);
    }

    // ── SEO fetch — trae el HTML de una página del PROPIO sitio para auditarla ──
    // Restringido a thelab.solutions (sin SSRF). Evita el CORS del navegador.
    if (url.pathname === '/seo-fetch') {
      // El hostname inicial NO basta: "redirect:follow" permitía salir a
      // destinos ajenos al sitio (open redirect → SSRF). Validar cada salto,
      // no enviar credenciales ni traer respuestas sin límite de bytes.
      const validSeoUrl = t => t.protocol === 'https:' &&
        (t.hostname === 'thelab.solutions' || t.hostname === 'www.thelab.solutions') &&
        !t.username && !t.password && !t.port;
      let target;
      try { target = new URL(url.searchParams.get('url') || ''); }
      catch (_) { return json({ error: 'URL inválida' }, 400, CORS); }
      if (!validSeoUrl(target)) return json({ error: 'Solo se permite auditar thelab.solutions' }, 403, CORS);
      const maxBytes = 2 * 1024 * 1024;
      try {
        for (let hop = 0; hop < 4; hop++) {
          const up = await fetch(target.toString(), {
            headers: { 'User-Agent': 'TheLab-SEO-Auditor/1.0' },
            redirect: 'manual',
          });
          if ([301,302,303,307,308].includes(up.status)) {
            const location = up.headers.get('Location');
            if (!location) return json({ error: 'Redirección sin destino' }, 502, CORS);
            let next;
            try { next = new URL(location, target); }
            catch (_) { return json({ error: 'Redirección inválida' }, 502, CORS); }
            if (!validSeoUrl(next)) return json({ error: 'Redirección fuera del dominio permitido' }, 403, CORS);
            target = next;
            continue;
          }
          if (Number(up.headers.get('Content-Length') || 0) > maxBytes) {
            return json({ error: 'Respuesta SEO demasiado grande' }, 413, CORS);
          }
          let html = '';
          if (up.body && typeof up.body.getReader === 'function') {
            const reader = up.body.getReader();
            const decoder = new TextDecoder();
            let total = 0;
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              total += chunk.value.byteLength;
              if (total > maxBytes) {
                await reader.cancel().catch(() => {});
                return json({ error: 'Respuesta SEO demasiado grande' }, 413, CORS);
              }
              html += decoder.decode(chunk.value, { stream: true });
            }
            html += decoder.decode();
          } else {
            html = await up.text();
            if (new TextEncoder().encode(html).byteLength > maxBytes)
              return json({ error: 'Respuesta SEO demasiado grande' }, 413, CORS);
          }
          return json({ ok: true, status: up.status, finalUrl: target.toString(), html }, 200, CORS);
        }
        return json({ error: 'Demasiadas redirecciones SEO' }, 502, CORS);
      } catch (e) {
        return json({ error: 'No se pudo traer la página: ' + (e && e.message || e) }, 502, CORS);
      }
    }

    // Latido para la "Oficina Virtual": marca este Worker como Activo en la tabla
    // Automations. Best-effort, throttled y fuera del camino crítico (waitUntil),
    // por lo que no añade latencia ni puede romper la respuesta.
    if (ctx && env.AIRTABLE_TOKEN) ctx.waitUntil(heartbeat(env).catch(() => {}));

    // ── Anthropic (Claude) — la API key vive como secreto del Worker ──
    // El dashboard llama a:  <worker>/anthropic/v1/messages
    if (url.pathname === '/anthropic/v1/messages' || leadServiceRoute) {
      if (!env.ANTHROPIC_TOKEN) {
        return json({ error: 'Worker misconfigured: missing ANTHROPIC_TOKEN secret' }, 500, CORS);
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, CORS);
      let payload;
      try { payload = await readAnthropicJson(request); }
      catch (_) { return json({ error: 'Invalid Anthropic JSON body' }, 400, CORS); }
      if (!payload || !ANTHROPIC_ALLOWED_MODELS.has(payload.model)) {
        return json({ error: 'Anthropic model not allowed by cost policy' }, 403, CORS);
      }
      const maxTokens = Number(payload.max_tokens);
      if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > ANTHROPIC_MAX_OUTPUT_TOKENS) {
        return json({ error: `max_tokens must be between 1 and ${ANTHROPIC_MAX_OUTPUT_TOKENS}` }, 400, CORS);
      }
      const source = leadServiceRoute?'lead-worker':
        sanitizeAiSource(request.headers.get('X-AI-Agent') || 'dashboard');
      const reservation = await reserveAiBudget(env, payload, source);
      if (!reservation.ok) {
        return json({
          error: reservation.error,
          code: 'AI_BUDGET_LIMIT',
          budget_usd: reservation.budget_usd,
          used_usd: reservation.used_usd,
          estimated_request_usd: reservation.estimated_request_usd,
        }, reservation.status || 429, CORS);
      }
      const target = ANTHROPIC_BASE + '/v1/messages' + (leadServiceRoute?'':url.search);
      const headers = new Headers();
      headers.set('x-api-key', env.ANTHROPIC_TOKEN);
      headers.set('anthropic-version', request.headers.get('anthropic-version') || '2023-06-01');
      headers.set('Content-Type', 'application/json');
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: JSON.stringify(payload),
      });
      const usageCopy = upstream.clone();
      const reconciliation = reconcileAiBudget(env, reservation, usageCopy).catch(() => {});
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(reconciliation);
      else await reconciliation;
      const respHeaders = new Headers(upstream.headers);
      Object.entries(CORS).forEach(([k, v]) => respHeaders.set(k, v));
      return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
    }

    // No funciona como proxy Anthropic genérico: solo Messages está expuesto.
    if (url.pathname.startsWith('/anthropic/')) return json({ error: 'Anthropic endpoint not allowed' }, 404, CORS);

    // ── OpenAI (visión + imágenes) ─────────────────────────────────────
    // Nunca funciona como proxy genérico. Solo admite las tres operaciones que usa
    // el dashboard, con modelos/parámetros acotados y el MISMO hard cap global de IA.
    // Así, copiar APP_KEY no permite elegir modelos caros ni generar sin límite.
    if (url.pathname === '/openai/usage') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, CORS);
      return json(await readAiBudget(env), 200, CORS);
    }

    if (url.pathname.startsWith('/openai/')) {
      if (!env.OPENAI_TOKEN) {
        return json({ error: 'Worker misconfigured: missing OPENAI_TOKEN secret' }, 500, CORS);
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, CORS);

      let estimate = 0;
      let source = 'openai';
      const ct = request.headers.get('Content-Type') || '';
      const clientSource = sanitizeAiSource(request.headers.get('X-AI-Agent') || '');

      if (url.pathname === '/openai/v1/chat/completions') {
        let payload;
        try { payload = await readOpenAiJson(request); }
        catch (_) { return json({ error: 'Invalid OpenAI JSON body' }, 400, CORS); }
        if (!OPENAI_ALLOWED_CHAT_MODELS.has(payload?.model)) {
          return json({ error: 'OpenAI chat model not allowed by cost policy' }, 403, CORS);
        }
        const maxTokens = Number(payload.max_tokens);
        if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > OPENAI_MAX_CHAT_OUTPUT_TOKENS) {
          return json({ error: `max_tokens must be between 1 and ${OPENAI_MAX_CHAT_OUTPUT_TOKENS}` }, 400, CORS);
        }
        if (payload.stream) return json({ error: 'Streaming is not allowed on this OpenAI route' }, 400, CORS);
        estimate = OPENAI_ESTIMATED_COST_USD.chat;
        source = clientSource || 'openai-chat';
      } else if (url.pathname === '/openai/v1/images/generations') {
        let payload;
        try { payload = await readOpenAiJson(request); }
        catch (_) { return json({ error: 'Invalid OpenAI image JSON body' }, 400, CORS); }
        if (!OPENAI_ALLOWED_IMAGE_MODELS.has(payload?.model)) {
          return json({ error: 'OpenAI image model not allowed by cost policy' }, 403, CORS);
        }
        if (Number(payload.n || 1) !== 1 || payload.size !== '1024x1024' || payload.quality !== 'low') {
          return json({ error: 'OpenAI image generation must use n=1, 1024x1024, quality=low' }, 400, CORS);
        }
        estimate = OPENAI_ESTIMATED_COST_USD.imageGenerationLow;
        source = clientSource || 'openai-image-generation';
      } else if (url.pathname === '/openai/v1/images/edits') {
        if (!ct.toLowerCase().includes('multipart/form-data')) {
          return json({ error: 'OpenAI image edit requires multipart/form-data' }, 400, CORS);
        }
        let form;
        try {
          if (!request.clone || typeof request.clone !== 'function') throw new Error('clone unavailable');
          form = await request.clone().formData();
        } catch (_) {
          return json({ error: 'Invalid OpenAI image edit body' }, 400, CORS);
        }
        const model = String(form.get('model') || '');
        const n = Number(form.get('n') || 1);
        const size = String(form.get('size') || '');
        const quality = String(form.get('quality') || '');
        const image = form.get('image');
        if (!OPENAI_ALLOWED_IMAGE_MODELS.has(model)) {
          return json({ error: 'OpenAI image model not allowed by cost policy' }, 403, CORS);
        }
        if (n !== 1 || size !== '1024x1024' || quality !== 'low') {
          return json({ error: 'OpenAI image edit must use n=1, 1024x1024, quality=low' }, 400, CORS);
        }
        if (!image || typeof image.size !== 'number' || image.size > 6 * 1024 * 1024) {
          return json({ error: 'OpenAI edit image is missing or exceeds 6 MB' }, 413, CORS);
        }
        estimate = OPENAI_ESTIMATED_COST_USD.imageEditLow;
        source = clientSource || 'openai-image-edit';
      } else {
        return json({ error: 'OpenAI endpoint not allowed' }, 404, CORS);
      }

      const reservation = await reserveAiBudget(env, { model: 'openai-budget-envelope' }, source, estimate);
      if (!reservation.ok) {
        return json({
          error: reservation.error,
          code: 'AI_BUDGET_LIMIT',
          budget_usd: reservation.budget_usd,
          used_usd: reservation.used_usd,
          estimated_request_usd: reservation.estimated_request_usd,
        }, reservation.status || 429, CORS);
      }

      const target = OPENAI_BASE + url.pathname.replace(/^\/openai/, '') + url.search;
      const headers = new Headers();
      headers.set('Authorization', 'Bearer ' + env.OPENAI_TOKEN);
      if (ct) headers.set('Content-Type', ct);
      const upstream = await fetch(target, {
        method: 'POST',
        headers,
        body: request.body,
      });
      const accounting = finalizeEstimatedAiBudget(env, reservation, upstream.ok, 'openai_http_' + upstream.status).catch(() => {});
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(accounting);
      else await accounting;

      const respHeaders = new Headers(upstream.headers);
      Object.entries(CORS).forEach(([k, v]) => respHeaders.set(k, v));
      return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
    }

    // ── Airtable (default) — el PAT vive como secreto del Worker ──
    if (!env.AIRTABLE_TOKEN) {
      return json({ error: 'Worker misconfigured: missing AIRTABLE_TOKEN secret' }, 500);
    }
    // Reducir el alcance de un APP_KEY copiado del HTML: este Worker sólo debe
    // operar sobre la base TLS, nunca convertirse en un proxy para otras bases
    // a las que el PAT del servidor también pudiera tener acceso.
    // Esto es contención, NO autenticación ni RBAC (APP_KEY es visible).
    const allowedBase = 'app1YtD74AqiPWQhy';
    const path = url.pathname.startsWith('/v0/') ? url.pathname : '/v0' + url.pathname;
    const dataPrefix = '/v0/' + allowedBase + '/';
    const metaPrefix = '/v0/meta/bases/' + allowedBase + '/';
    if (!(path.startsWith(dataPrefix) || path.startsWith(metaPrefix))) {
      return json({ error: 'Airtable base or route not allowed' }, 403, CORS);
    }
    if (!['GET','POST','PATCH','DELETE'].includes(request.method)) {
      return json({ error: 'Method not allowed' }, 405, CORS);
    }
    // El POST de Pedidos/Cotizaciones DEBE pasar por CrmMutationGuard. Airtable
    // permite referirse a una tabla por nombre O tblId y algunos routers
    // aceptan segmentos URL codificados: /%50edidos o /tbl... no deben saltarse
    // el guard por no coincidir literalmente con /Pedidos. El HTML legítimo
    // siempre usa encodeURIComponent(table), por lo que la ruta canónica se
    // puede exigir sin romper sus escrituras.
    if (path.startsWith(dataPrefix) && request.method !== 'GET') {
      const segment = path.slice(dataPrefix.length).split('/')[0];
      let table;
      try { table = decodeURIComponent(segment); }
      catch (_) { return json({ error: 'Invalid Airtable table path' }, 400, CORS); }
      if (!table || table.includes('%') || table.includes('/') || table.includes('\\') ||
          /^tbl[A-Za-z0-9]{14}$/.test(table) || segment !== encodeURIComponent(table)) {
        return json({ error: 'Noncanonical Airtable table path' }, 403, CORS);
      }
      // Airtable no debe interpretar una variante de caja como tabla crítica
      // mientras el Worker la trata como una tabla no protegida.
      const critical = table.toLowerCase();
      if ((critical === 'pedidos' || critical === 'cotizaciones' || critical === 'facturas' || critical === 'reportes') &&
          (table !== (critical === 'pedidos' ? 'Pedidos' : critical === 'cotizaciones' ? 'Cotizaciones' : critical === 'facturas' ? 'Facturas' : 'Reportes') ||
           (request.method === 'POST' && path !== dataPrefix + table) ||
           (table === 'Reportes' && request.method === 'PATCH'))) {
        return json({ error: 'CRM and Facturas creates require canonical guarded path' }, 403, CORS);
      }
    }
    // La APP_KEY publicada no autoriza operaciones genéricas sobre el esquema.
    // Conservar únicamente lectura y bootstrap de tablas/campos TLS conocidos.
    if (path.startsWith(metaPrefix)) {
      const tableList = metaPrefix + 'tables';
      if (request.method === 'GET' && path === tableList) {
        // Necesario para comprobar qué campos ya existen.
      } else if (request.method === 'POST') {
        const createTable = path === tableList;
        const fieldMatch = new RegExp('^' + tableList + '/(tbl[A-Za-z0-9]{14})/fields$').exec(path);
        if (!createTable && !fieldMatch) return json({ error: 'Schema operation not allowed' }, 403, CORS);
        let body;
        try { body = await readOpenAiJson(request); }
        catch (_) { return json({ error: 'Invalid schema JSON' }, 400, CORS); }
        if (createTable) {
          if (!body || !SCHEMA_BOOTSTRAP_TABLES.has(body.name) ||
            !Array.isArray(body.fields) || body.fields.length < 1 || body.fields.length > 30 ||
            !body.fields.every(schemaFieldAllowed)) {
            return json({ error: 'Schema table creation not allowed' }, 403, CORS);
          }
        } else if (!schemaFieldAllowed(body)) {
          return json({ error: 'Schema field creation not allowed' }, 403, CORS);
        }
        // Nunca hacer un alta sin comprobar el esquema: evita duplicados,
        // valida el tblId real y falla cerrado si la metadata no responde.
        let meta;
        try {
          const check = await fetch(AIRTABLE_BASE + tableList, {
            headers: { Authorization: 'Bearer ' + env.AIRTABLE_TOKEN }
          });
          if (!check.ok) return json({ error: 'Cannot verify schema' }, 502, CORS);
          meta = await check.json();
        } catch (_) { return json({ error: 'Cannot verify schema' }, 502, CORS); }
        if (!meta || !Array.isArray(meta.tables)) return json({ error: 'Invalid schema' }, 502, CORS);
        if (createTable) {
          if (meta.tables.some(t => t.name === body.name)) return json({ error: 'Table already exists' }, 409, CORS);
        } else {
          const found = meta.tables.find(t => t.id === fieldMatch[1]);
          if (!found || !['Cotizaciones','Pedidos','Maquinas','Maquinas_Eventos','Maquinas_Mant'].includes(found.name)) {
            return json({ error: 'Schema table not allowed' }, 403, CORS);
          }
          if ((found.fields || []).some(f => f.name === body.name)) return json({ error: 'Field already exists' }, 409, CORS);
        }
      } else {
        return json({ error: 'Schema operation not allowed' }, 403, CORS);
      }
    }
    // Las creaciones de Pedidos/Cotizaciones/Facturas no pueden depender de un
    // check-then-POST en dos navegadores. Serializar ambas en el mismo DO.
    if (request.method === 'POST' &&
        (path === dataPrefix + 'Pedidos' || path === dataPrefix + 'Cotizaciones' || path === dataPrefix + 'Facturas' || path === dataPrefix + 'Reportes')) {
      if (!env.CRM_MUTATION_GUARD) {
        return json({ error: 'CRM/Facturas write guard unavailable; creation suspended' }, 503, CORS);
      }
      let body;
      try { body = await readOpenAiJson(request); }
      catch (_) { return json({ error: 'Invalid guarded create JSON body' }, 400, CORS); }
      try {
        // Keep heavy report-history reconciliation out of the critical
        // Pedidos/Facturas queue, while still sharing the deployed DO class.
        const guardName=path===dataPrefix+'Reportes'?'tls-reportes-global':'tls-crm-global';
        const id = env.CRM_MUTATION_GUARD.idFromName(guardName);
        const guard = env.CRM_MUTATION_GUARD.get(id);
        const guarded = await guard.fetch('https://crm-write.internal/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            table: path.slice(dataPrefix.length), body, search: url.search,
          }),
        });
        const respHeaders = new Headers(guarded.headers);
        Object.entries(CORS).forEach(([k, v]) => respHeaders.set(k, v));
        return new Response(guarded.body, { status: guarded.status, headers: respHeaders });
      } catch (_) {
        return json({ error: 'CRM write guard unavailable; creation suspended' }, 503, CORS);
      }
    }
    const target = AIRTABLE_BASE + path + url.search;

    const headers = new Headers();
    headers.set('Authorization', 'Bearer ' + env.AIRTABLE_TOKEN);
    const ct = request.headers.get('Content-Type');
    if (ct) headers.set('Content-Type', ct);

    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    });

    const respHeaders = new Headers(upstream.headers);
    Object.entries(CORS).forEach(([k, v]) => respHeaders.set(k, v));

    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  },
};


function sanitizeAiSource(value) {
  return String(value || 'dashboard').toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 48) || 'dashboard';
}
function aiChileDate() {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
  catch (_) { return new Date().toISOString().slice(0, 10); }
}
function aiPrice(model) {
  return String(model || '').toLowerCase().includes('haiku') ? ANTHROPIC_PRICES.haiku : ANTHROPIC_PRICES.sonnet;
}
function aiCostUsd(model, usage) {
  const p = aiPrice(model), u = usage || {}, n = (k) => Math.max(0, Number(u[k]) || 0);
  return (n('input_tokens') * p.input +
    n('output_tokens') * p.output +
    n('cache_creation_input_tokens') * p.cacheWrite +
    n('cache_read_input_tokens') * p.cacheRead) / 1000000;
}
function estimateAiRequestUsd(payload) {
  const model = payload && payload.model;
  const p = aiPrice(model);
  const inputObj = { system: payload?.system || '', messages: payload?.messages || [], tools: payload?.tools || [] };
  const chars = JSON.stringify(inputObj).length;
  // 3 chars/token intentionally over-reserves versus the common ~4 chars/token.
  const inputTokens = Math.ceil(chars / 3);
  const outputTokens = Math.max(0, Number(payload?.max_tokens) || 0);
  // Reserva al peor precio posible del input: el primer uso de prompt caching
  // puede cobrarse como cache write, que es más caro que input normal.
  // Con max_tokens como techo de salida, la reserva queda deliberadamente >=
  // al costo facturable esperable de la solicitud.
  const inputRate = Math.max(p.input, p.cacheWrite);
  return (inputTokens * inputRate + outputTokens * p.output) / 1000000;
}

async function aiBudgetGuardCall(env, pathname, payload) {
  if (!env.AI_BUDGET_GUARD) throw new Error('AI budget Durable Object unavailable');
  const id = env.AI_BUDGET_GUARD.idFromName('anthropic-global-budget');
  const stub = env.AI_BUDGET_GUARD.get(id);
  const response = await stub.fetch('https://ai-budget.internal' + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  if (!response.ok) throw new Error('AI budget guard HTTP ' + response.status);
  return response.json();
}

async function readAiBudget(env) {
  const budget = Math.max(0.05, Number(env.ANTHROPIC_DAILY_BUDGET_USD || ANTHROPIC_DAILY_BUDGET_USD_DEFAULT));
  const perRequest = Math.max(0.01, Number(env.ANTHROPIC_REQUEST_BUDGET_USD || ANTHROPIC_REQUEST_BUDGET_USD_DEFAULT));
  const guardDate = aiChileDate();
  if (env.AI_BUDGET_GUARD) {
    try {
      return await aiBudgetGuardCall(env, '/usage', {
        date: guardDate, budget_usd: budget, request_budget_usd: perRequest,
      });
    } catch (_) {
      return { configured: false, atomic: false, date: guardDate, budget_usd: budget,
        request_budget_usd: perRequest, spent_usd: 0, reserved_usd: 0, used_usd: 0,
        remaining_usd: 0, requests: 0, by_source: {} };
    }
  }
  // Solo las pruebas unitarias pueden usar el ledger KV legado. Producción falla
  // cerrado si el Durable Object no está enlazado.
  if (!env.__TEST_ALLOW_KV_BUDGET) {
    return { configured: false, atomic: false, date: guardDate, budget_usd: budget,
      request_budget_usd: perRequest, spent_usd: 0, reserved_usd: 0, used_usd: 0,
      remaining_usd: 0, requests: 0, by_source: {} };
  }
  const key = 'anthropic-budget:' + guardDate;
  if (!env.AI_BUDGET) {
    return { configured: false, date: aiChileDate(), budget_usd: budget, request_budget_usd: perRequest,
      spent_usd: 0, reserved_usd: 0, used_usd: 0, remaining_usd: 0, requests: 0, by_source: {} };
  }
  let row = {};
  try { row = JSON.parse((await env.AI_BUDGET.get(key)) || '{}'); } catch (_) {}
  const spent = Math.max(0, Number(row.spent_usd) || 0);
  let reserved = Math.max(0, Number(row.reserved_usd) || 0);
  // Autorreparación: antes una respuesta 4xx/5xx de Anthropic podía dejar la reserva
  // atrapada hasta 48 h. Eso hacía que, incluso después de recargar créditos,
  // el dashboard siguiera respondiendo AI_BUDGET_LIMIT. Las reservas viejas no son gasto.
  const reservationAt = Date.parse(row.reserved_at || row.updated_at || '');
  if (reserved > 0 && (!Number.isFinite(reservationAt) || Date.now() - reservationAt > AI_RESERVATION_STALE_MS)) {
    reserved = 0;
    row.reserved_usd = 0;
    row.by_source = row.by_source || {};
    for (const src of Object.values(row.by_source)) if (src && typeof src === 'object') src.reserved_usd = 0;
    row.reserved_at = null;
    row.recovered_stale_reservation_at = new Date().toISOString();
    row.updated_at = row.recovered_stale_reservation_at;
    await env.AI_BUDGET.put(key, JSON.stringify(row), { expirationTtl: 172800 });
  }
  return {
    configured: true, date: aiChileDate(), budget_usd: budget, request_budget_usd: perRequest,
    spent_usd: spent, reserved_usd: reserved, used_usd: spent + reserved,
    remaining_usd: Math.max(0, budget - spent - reserved),
    requests: Math.max(0, Number(row.requests) || 0), by_source: row.by_source || {},
    updated_at: row.updated_at || null,
  };
}
async function reserveAiBudget(env, payload, source, fixedEstimate = null) {
  const estimate = Number.isFinite(Number(fixedEstimate)) && fixedEstimate !== null
    ? Math.max(0, Number(fixedEstimate))
    : estimateAiRequestUsd(payload);
  const budget = Math.max(0.05, Number(env.ANTHROPIC_DAILY_BUDGET_USD || ANTHROPIC_DAILY_BUDGET_USD_DEFAULT));
  const perRequest = Math.max(0.01, Number(env.ANTHROPIC_REQUEST_BUDGET_USD || ANTHROPIC_REQUEST_BUDGET_USD_DEFAULT));
  if (env.AI_BUDGET_GUARD) {
    try {
      return await aiBudgetGuardCall(env, '/reserve', {
        date: aiChileDate(), budget_usd: budget, request_budget_usd: perRequest,
        max_concurrent: 1, estimated_request_usd: estimate, source, model: payload && payload.model,
      });
    } catch (_) {
      return { ok: false, status: 503, error: 'AI cost guard unavailable',
        budget_usd: budget, used_usd: 0, estimated_request_usd: estimate };
    }
  }
  if (!env.__TEST_ALLOW_KV_BUDGET) {
    return { ok: false, status: 503, error: 'AI cost guard unavailable',
      budget_usd: budget, used_usd: 0, estimated_request_usd: estimate };
  }
  const snap = await readAiBudget(env);
  if (!snap.configured) return { ok: false, status: 503, error: 'AI cost guard unavailable', budget_usd: snap.budget_usd, used_usd: 0, estimated_request_usd: estimate };
  if (estimate > snap.request_budget_usd) return { ok: false, status: 429, error: 'AI request exceeds per-request cost limit', budget_usd: snap.budget_usd, used_usd: snap.used_usd, estimated_request_usd: estimate };
  if (snap.used_usd + estimate > snap.budget_usd) return { ok: false, status: 429, error: 'Daily AI budget reached', budget_usd: snap.budget_usd, used_usd: snap.used_usd, estimated_request_usd: estimate };

  const key = 'anthropic-budget:' + snap.date;
  let row = {};
  try { row = JSON.parse((await env.AI_BUDGET.get(key)) || '{}'); } catch (_) {}
  row.spent_usd = Math.max(0, Number(row.spent_usd) || 0);
  row.reserved_usd = Math.max(0, Number(row.reserved_usd) || 0) + estimate;
  row.requests = Math.max(0, Number(row.requests) || 0) + 1;
  row.by_source = row.by_source || {};
  const src = row.by_source[source] || { requests: 0, spent_usd: 0, reserved_usd: 0 };
  src.requests = Math.max(0, Number(src.requests) || 0) + 1;
  src.reserved_usd = Math.max(0, Number(src.reserved_usd) || 0) + estimate;
  row.by_source[source] = src;
  row.updated_at = new Date().toISOString();
  row.reserved_at = row.updated_at;
  await env.AI_BUDGET.put(key, JSON.stringify(row), { expirationTtl: 172800 });
  return { ok: true, key, source, estimate, model: payload.model, budget_usd: snap.budget_usd, used_usd: snap.used_usd, estimated_request_usd: estimate };
}
async function parseAnthropicUsage(response) {
  if (!response || !response.ok) return null;
  const ct = response.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    const txt = await response.text();
    let model = '', usage = {};
    for (const line of txt.split('\n')) {
      const t = line.trim(); if (!t.startsWith('data:')) continue;
      let ev; try { ev = JSON.parse(t.slice(5).trim()); } catch (_) { continue; }
      if (ev.type === 'message_start' && ev.message) {
        model = ev.message.model || model;
        usage = { ...usage, ...(ev.message.usage || {}) };
      } else if (ev.type === 'message_delta' && ev.usage) {
        usage = { ...usage, ...ev.usage };
      }
    }
    return Object.keys(usage).length ? { model, usage } : null;
  }
  try {
    const j = await response.json();
    return j && j.usage ? { model: j.model || '', usage: j.usage } : null;
  } catch (_) { return null; }
}
async function releaseAiReservation(env, reservation, reason) {
  if (!reservation?.ok) return;
  if (env.AI_BUDGET_GUARD) {
    try {
      await aiBudgetGuardCall(env, '/release', {
        date: reservation.date || aiChileDate(),
        reservation_id: reservation.reservation_id || '',
        reason: String(reason || 'no_usage').slice(0, 80),
      });
    } catch (_) {}
    return;
  }
  if (!env.__TEST_ALLOW_KV_BUDGET || !env.AI_BUDGET) return;
  let row = {};
  try { row = JSON.parse((await env.AI_BUDGET.get(reservation.key)) || '{}'); } catch (_) {}
  row.reserved_usd = Math.max(0, (Number(row.reserved_usd) || 0) - reservation.estimate);
  row.by_source = row.by_source || {};
  const src = row.by_source[reservation.source] || { requests: 0, spent_usd: 0, reserved_usd: 0 };
  src.reserved_usd = Math.max(0, (Number(src.reserved_usd) || 0) - reservation.estimate);
  row.by_source[reservation.source] = src;
  if (row.reserved_usd <= 1e-9) row.reserved_at = null;
  row.last_release_reason = String(reason || 'no_usage').slice(0, 80);
  row.updated_at = new Date().toISOString();
  await env.AI_BUDGET.put(reservation.key, JSON.stringify(row), { expirationTtl: 172800 });
}
async function reconcileAiBudget(env, reservation, response) {
  if (!reservation?.ok) return;
  if (env.AI_BUDGET_GUARD) {
    if (!response || !response.ok) {
      await releaseAiReservation(env, reservation, 'upstream_http_' + (response?.status || 'unknown'));
      return;
    }
    const parsedAtomic = await parseAnthropicUsage(response);
    // Un 2xx sin usage conserva su reserva; el guard la vence a los 2 min.
    if (!parsedAtomic) return;
    const actualAtomic = aiCostUsd(parsedAtomic.model || reservation.model, parsedAtomic.usage);
    try {
      await aiBudgetGuardCall(env, '/reconcile', {
        date: reservation.date || aiChileDate(),
        reservation_id: reservation.reservation_id || '',
        actual_usd: actualAtomic,
        source: reservation.source || 'dashboard',
      });
    } catch (_) {}
    return;
  }
  if (!env.__TEST_ALLOW_KV_BUDGET || !env.AI_BUDGET) return;
  // Un 4xx/5xx es un rechazo confirmado por Anthropic: no hubo una generación
  // facturable que justifique mantener la reserva. Liberarla permite reintentar
  // después de recargar créditos o resolver un rate limit.
  if (!response || !response.ok) {
    await releaseAiReservation(env, reservation, 'upstream_http_' + (response?.status || 'unknown'));
    return;
  }
  const parsed = await parseAnthropicUsage(response);
  // Si un 2xx excepcional no trae usage, conservamos la reserva por seguridad;
  // readAiBudget la recupera automáticamente si queda huérfana >2 min.
  if (!parsed) return;
  const actual = aiCostUsd(parsed.model || reservation.model, parsed.usage);
  let row = {};
  try { row = JSON.parse((await env.AI_BUDGET.get(reservation.key)) || '{}'); } catch (_) {}
  row.spent_usd = Math.max(0, Number(row.spent_usd) || 0) + actual;
  row.reserved_usd = Math.max(0, (Number(row.reserved_usd) || 0) - reservation.estimate);
  row.by_source = row.by_source || {};
  const src = row.by_source[reservation.source] || { requests: 0, spent_usd: 0, reserved_usd: 0 };
  src.spent_usd = Math.max(0, Number(src.spent_usd) || 0) + actual;
  src.reserved_usd = Math.max(0, (Number(src.reserved_usd) || 0) - reservation.estimate);
  row.by_source[reservation.source] = src;
  if (row.reserved_usd <= 1e-9) row.reserved_at = null;
  row.updated_at = new Date().toISOString();
  await env.AI_BUDGET.put(reservation.key, JSON.stringify(row), { expirationTtl: 172800 });
}

async function finalizeEstimatedAiBudget(env, reservation, success, reason) {
  if (!reservation?.ok) return;
  if (!success) {
    await releaseAiReservation(env, reservation, reason || 'upstream_error');
    return;
  }
  if (env.AI_BUDGET_GUARD) {
    try {
      await aiBudgetGuardCall(env, '/reconcile', {
        date: reservation.date || aiChileDate(),
        reservation_id: reservation.reservation_id || '',
        actual_usd: reservation.estimate,
        source: reservation.source || 'dashboard',
      });
    } catch (_) {}
    return;
  }
  if (!env.__TEST_ALLOW_KV_BUDGET || !env.AI_BUDGET) return;
  let row = {};
  try { row = JSON.parse((await env.AI_BUDGET.get(reservation.key)) || '{}'); } catch (_) {}
  const actual = Math.max(0, Number(reservation.estimate) || 0);
  row.spent_usd = Math.max(0, Number(row.spent_usd) || 0) + actual;
  row.reserved_usd = Math.max(0, (Number(row.reserved_usd) || 0) - actual);
  row.by_source = row.by_source || {};
  const src = row.by_source[reservation.source] || { requests: 0, spent_usd: 0, reserved_usd: 0 };
  src.spent_usd = Math.max(0, Number(src.spent_usd) || 0) + actual;
  src.reserved_usd = Math.max(0, (Number(src.reserved_usd) || 0) - actual);
  row.by_source[reservation.source] = src;
  if (row.reserved_usd <= 1e-9) row.reserved_at = null;
  row.updated_at = new Date().toISOString();
  await env.AI_BUDGET.put(reservation.key, JSON.stringify(row), { expirationTtl: 172800 });
}

async function readOpenAiJson(request) {
  if (request && typeof request.clone === 'function') return request.clone().json();
  if (typeof request.body === 'string') return JSON.parse(request.body);
  if (request.body && typeof request.body.text === 'function') return JSON.parse(await request.body.text());
  throw new Error('body unavailable');
}

async function readAnthropicJson(request) {
  // Request real de Cloudflare: clone evita consumir el stream que luego se
  // reenvía. El fallback string mantiene simples las pruebas unitarias.
  if (request && typeof request.clone === 'function') return request.clone().json();
  if (typeof request.body === 'string') return JSON.parse(request.body);
  if (request.body && typeof request.body.text === 'function') return JSON.parse(await request.body.text());
  throw new Error('body unavailable');
}

function json(data, status = 200, corsHeaders = cors('')) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// ── Heartbeat hacia la tabla Automations ──────────────────────────────
// Actualiza la fila ID="airtable-proxy" con Estado=Activo y la hora actual,
// como máximo una vez cada 5 min (throttle por isolate). Totalmente opcional:
// si la base/tabla no existen o el token no puede escribir, falla en silencio.
let _lastBeat = 0;
const HEARTBEAT_ID = 'airtable-proxy';
const HEARTBEAT_TABLE = 'Automations';
const HEARTBEAT_MIN_MS = 5 * 60 * 1000;

async function heartbeat(env) {
  const now = Date.now();
  if (now - _lastBeat < HEARTBEAT_MIN_MS) return;
  _lastBeat = now;

  const base = env.HEARTBEAT_BASE || 'app1YtD74AqiPWQhy';
  const auth = { Authorization: 'Bearer ' + env.AIRTABLE_TOKEN };
  const tbl = `${AIRTABLE_BASE}/v0/${base}/${encodeURIComponent(HEARTBEAT_TABLE)}`;

  // 1) Buscar la fila del proxy por su ID técnico
  const q = `${tbl}?maxRecords=1&filterByFormula=${encodeURIComponent(`{ID}='${HEARTBEAT_ID}'`)}`;
  const found = await fetch(q, { headers: auth });
  if (!found.ok) return;
  const data = await found.json();
  const rec = data.records && data.records[0];
  if (!rec) return;

  // 2) Marcar como Activo con la hora actual; EjecucionesHoy con reseteo diario
  const f = rec.fields || {};
  const sameDay = f.UltimaEjecucion && new Date(f.UltimaEjecucion).toDateString() === new Date().toDateString();
  const ej = (sameDay ? (Number(f.EjecucionesHoy) || 0) : 0) + 1;
  await fetch(`${tbl}/${rec.id}`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        Estado: 'Activo',
        UltimaEjecucion: new Date().toISOString(),
        EjecucionesHoy: ej,
        TareaActual: 'Proxy seguro Airtable + Claude operativo',
      },
      typecast: true,
    }),
  });
}
