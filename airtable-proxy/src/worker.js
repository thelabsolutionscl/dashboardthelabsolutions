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
  }),
  // Machine tables are operational, but they are no longer a generic Airtable
  // write tunnel for signed operators. Identity/config fields stay immutable.
  Maquinas:Object.freeze({
    'estado':'machine-state','ip':'private-ip','cam':'printer-url'
  }),
  Maquinas_Eventos:Object.freeze({
    'maquina_id':'machine-id','fecha':'date','tipo':'machine-event-type',
    'desc':'short-text','tiempo':'machine-hours','pedido_id':'record-ref'
  }),
  Maquinas_Mant:Object.freeze({
    'maquina_id':'machine-id','tipo':'maintenance-type','notas':'notes',
    'print_hours':'machine-hours','fecha':'date','ts':'timestamp-ms'
  }),
  Equipo_Eventos:Object.freeze({
    'persona_id':'team-person','fecha':'date','tipo':'team-event-type',
    'desc':'short-text','hora_inicio':'clock','hora_fin':'clock'
  })
});
const OPERATOR_WRITE_METHODS=Object.freeze({
  Clientes:new Set(['POST','PATCH']),
  Cotizaciones:new Set(['POST','PATCH']),
  Pedidos:new Set(['POST','PATCH']),
  Proveedores:new Set(['POST','PATCH']),
  Maquinas:new Set(['PATCH']),
  Maquinas_Eventos:new Set(['POST','PATCH']),
  Maquinas_Mant:new Set(['POST']),
  Equipo_Eventos:new Set(['POST','PATCH','DELETE'])
});
function operatorFieldValueAllowed(kind,value,key){
  if(value===null)return !['N° Pedido','N° Cotización','Empresa','Nombre',
    'maquina_id','tipo','fecha','ts','estado'].includes(key);
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
  if(kind==='machine-hours')return typeof value==='number'&&Number.isFinite(value)&&
    value>=0&&value<=100000;
  if(kind==='timestamp-ms')return Number.isSafeInteger(value)&&
    value>=946684800000&&value<=4102444800000;
  if(kind==='machine-id')return typeof value==='string'&&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
  if(kind==='record-ref')return typeof value==='string'&&
    (!value||/^rec[A-Za-z0-9]{14}$/.test(value));
  if(kind==='machine-state')return typeof value==='string'&&
    new Set(['disponible','reservada','calibrando','limpieza','mantencion',
      'esperando_repuesto','fuera_servicio']).has(value);
  if(kind==='machine-event-type')return typeof value==='string'&&
    new Set(['uso','mantencion']).has(value);
  if(kind==='maintenance-type')return typeof value==='string'&&
    new Set(['nozzle','lubrication','belt','extruder','bed','sensors','general']).has(value);
  if(kind==='team-person')return typeof value==='string'&&
    new Set(['gustavo','nicanor','florencia']).has(value);
  if(kind==='team-event-type')return typeof value==='string'&&
    new Set(['ocupado','reunion','remoto','ausente','vacaciones']).has(value);
  if(kind==='clock')return typeof value==='string'&&
    (value===''||/^([01]\d|2[0-3]):[0-5]\d$/.test(value));
  if(kind==='private-ip'){
    if(value==='')return true;
    if(typeof value!=='string')return false;
    const m=value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if(!m)return false;
    const o=m.slice(1).map(Number);
    return !o.some(v=>v<0||v>255)&&
      (o[0]===10||(o[0]===172&&o[1]>=16&&o[1]<=31)||(o[0]===192&&o[1]===168));
  }
  if(kind==='printer-url'){
    if(value==='')return true;
    if(typeof value!=='string'||value.length>1024)return false;
    try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&
      !u.username&&!u.password;}catch(_){return false;}
  }
  if(kind==='short-text')return typeof value==='string'&&value.length<=2000&&
    !/[\r\n\x00-\x08\x0b\x0e-\x1f]/.test(value);
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
  if(!catalog||!OPERATOR_WRITE_METHODS[table]?.has(method)||!payload||
     typeof payload!=='object'||Array.isArray(payload))return false;
  const keys=Object.keys(payload);
  if(keys.some(k=>!['fields','records','typecast'].includes(k))||
     (payload.typecast!==undefined&&payload.typecast!==false))return false;
  const fieldsOK=(fields,creating)=>{
    if(!fields||typeof fields!=='object'||Array.isArray(fields))return false;
    const keys=Object.keys(fields);
    if(!keys.length||keys.length>40||keys.some(k=>!Object.hasOwn(catalog,k)||
       (!creating&&['N° Pedido','N° Cotización','maquina_id','persona_id','fecha'].includes(k))||
       !operatorFieldValueAllowed(catalog[k],fields[k],k)))return false;
    if(creating){
      const required={
        Clientes:['Empresa'],Cotizaciones:['N° Cotización'],
        Pedidos:['N° Pedido'],Proveedores:['Nombre'],
        Maquinas_Eventos:['maquina_id','fecha','tipo'],
        Maquinas_Mant:['maquina_id','tipo','fecha','ts'],
        Equipo_Eventos:['persona_id','fecha','tipo']
      }[table];
      if(!required||required.some(k=>!Object.hasOwn(fields,k)||
         fields[k]===null||fields[k]===''||
         (typeof fields[k]==='string'&&!fields[k].trim())))return false;
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
  if(!['POST','PATCH','DELETE'].includes(request.method))
    return json({error:'Operator mutation denied'},403,CORS);
  const prefix='/v0/app1YtD74AqiPWQhy/';
  const path=url.pathname.startsWith('/v0/')?url.pathname:'/v0'+url.pathname;
  if(!path.startsWith(prefix)||url.search)
    return json({error:'Operator mutation route denied'},403,CORS);
  const parts=path.slice(prefix.length).split('/');
  let table;
  try{table=decodeURIComponent(parts[0]);}catch(_){}
  if(!Object.hasOwn(OPERATOR_WRITE_FIELDS,table||'')||
     !OPERATOR_WRITE_METHODS[table]?.has(request.method)||
     parts[0]!==encodeURIComponent(table)||
     (request.method==='POST'&&parts.length!==1)||
     (request.method==='PATCH'&&(parts.length>2||
       parts.length===2&&!/^rec[A-Za-z0-9]{14}$/.test(parts[1])))||
     (request.method==='DELETE'&&(table!=='Equipo_Eventos'||parts.length!==2||
       !/^rec[A-Za-z0-9]{14}$/.test(parts[1]))))
    return json({error:'Operator mutation route denied'},403,CORS);
  if(!env.AIRTABLE_TOKEN)return json({error:'CRM unavailable'},503,CORS);
  if(request.method==='DELETE'){
    if(Number(request.headers.get('Content-Length')||0)>0)
      return json({error:'Operator delete body denied'},422,CORS);
    try{
      const upstream=await fetch(AIRTABLE_BASE+path,{
        method:'DELETE',redirect:'manual',
        headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,Accept:'application/json'}
      });
      if(!upstream.ok||upstream.status>=300&&upstream.status<400)
        return json({error:'Operational delete rejected',code:'OPERATOR_WRITE_REJECTED'},
          [400,401,403,404,409,422].includes(upstream.status)?upstream.status:503,CORS);
      const body=await upstream.json().catch(()=>null);
      if(!body||body.id!==parts[1]||body.deleted!==true)
        return json({error:'Operational delete outcome uncertain',
          code:'OPERATOR_WRITE_UNCERTAIN'},503,CORS);
      return json({id:body.id,deleted:true},200,
        {...CORS,'Cache-Control':'private, no-store'});
    }catch(_){
      return json({error:'Operational delete outcome uncertain; reread before retrying',
        code:'OPERATOR_WRITE_UNCERTAIN'},503,CORS);
    }
  }
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
  const guardedCreate=table==='Cotizaciones'||table==='Pedidos';
  const guardedPatch=['Clientes','Cotizaciones','Pedidos'].includes(table);
  if((guardedCreate&&request.method==='POST'||guardedPatch&&request.method==='PATCH')&&
     !env.CRM_MUTATION_GUARD)return json({error:'CRM write guard unavailable'},503,CORS);
  const headers={'Content-Type':'application/json'};
  const actor={email:identity.email,role:'operator'};
  try{
    if(guardedCreate&&request.method==='POST'){
      const stub=env.CRM_MUTATION_GUARD.get(env.CRM_MUTATION_GUARD.idFromName('tls-crm-global'));
      const upstream=await stub.fetch('https://crm-write.internal/create',{
        method:'POST',headers,
        body:JSON.stringify({table,body,search:'',actor})
      });
      return operatorSafeMutationResponse(upstream,table,CORS);
    }
    if(request.method==='PATCH'&&guardedPatch){
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

const OPERATOR_CRM_RELATIONS=Object.freeze({
  Cotizaciones:Object.freeze({client:'Cliente',related:'Pedido',target:'Pedidos'}),
  Pedidos:Object.freeze({client:'Cliente',related:'Cotizaciones',target:'Cotizaciones'})
});
function operatorCrmLinks(value,max=25){
  if(value===undefined||value===null)return [];
  if(!Array.isArray(value)||value.length>max)return null;
  const out=[];
  for(const id of value){
    if(typeof id!=='string'||!/^rec[A-Za-z0-9]{14}$/.test(id)||out.includes(id))return null;
    out.push(id);
  }
  return out;
}
async function operatorCrmLoadRows(table,ids,fields,env){
  const wanted=[...new Set(ids)];
  if(!wanted.length)return new Map();
  if(wanted.length>100||wanted.some(id=>!/^rec[A-Za-z0-9]{14}$/.test(id)))
    throw Error('Invalid CRM relation lookup');
  const q=new URLSearchParams();
  q.set('pageSize','100');
  const tests=wanted.map(id=>"RECORD_ID()='"+id+"'");
  q.set('filterByFormula',tests.length===1?tests[0]:'OR('+tests.join(',')+')');
  for(const field of fields)q.append('fields[]',field);
  const target=AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+encodeURIComponent(table)+'?'+q.toString();
  const response=await fetch(target,{method:'GET',redirect:'manual',headers:{
    Authorization:'Bearer '+env.AIRTABLE_TOKEN,Accept:'application/json'
  }});
  if(!response.ok||response.status>=300&&response.status<400)
    throw Error('CRM relation lookup failed');
  const body=await response.json();
  if(!body||!Array.isArray(body.records)||body.records.length>wanted.length||
     body.offset!==undefined)
    throw Error('CRM relation lookup malformed');
  const expected=new Set(wanted),rows=new Map();
  for(const row of body.records){
    if(!row||!expected.has(row.id)||rows.has(row.id)||!row.fields||
       typeof row.fields!=='object'||Array.isArray(row.fields))
      throw Error('CRM relation row malformed');
    rows.set(row.id,row);
  }
  return rows;
}
function operatorCrmRelationError(error,status=422,code='CRM_RELATION_INVALID'){
  return {ok:false,status,error,code};
}
async function operatorCrmRelationPreflight(table,mutations,env,{creating=false}={}){
  const spec=OPERATOR_CRM_RELATIONS[table];
  if(!spec)return {ok:true};
  if(!Array.isArray(mutations)||!mutations.length||mutations.length>10)
    return operatorCrmRelationError('Invalid CRM relation mutation shape');
  const relevant=creating?mutations:mutations.filter(row=>row&&row.fields&&
    (Object.hasOwn(row.fields,spec.client)||Object.hasOwn(row.fields,spec.related)));
  if(!relevant.length)return {ok:true};

  let current=new Map();
  try{
    if(!creating){
      const sourceIds=relevant.map(row=>row.id);
      if(sourceIds.some(id=>!/^rec[A-Za-z0-9]{14}$/.test(id)))
        return operatorCrmRelationError('Invalid CRM source record');
      current=await operatorCrmLoadRows(table,sourceIds,[spec.client,spec.related],env);
      if(current.size!==new Set(sourceIds).size)
        return operatorCrmRelationError('CRM source record not found',404,'CRM_RELATION_SOURCE_MISSING');
    }
  }catch(_){
    return operatorCrmRelationError('Cannot verify CRM relationships',503,'CRM_RELATION_VERIFY_UNAVAILABLE');
  }

  const finalRows=[],clientIds=new Set(),targetIds=new Set();
  for(const mutation of relevant){
    if(!mutation||!mutation.fields||typeof mutation.fields!=='object'||Array.isArray(mutation.fields))
      return operatorCrmRelationError('Invalid CRM relation mutation shape');
    const before=creating?{}:current.get(mutation.id)?.fields||{};
    const clientValue=Object.hasOwn(mutation.fields,spec.client)?
      mutation.fields[spec.client]:before[spec.client];
    const relatedValue=Object.hasOwn(mutation.fields,spec.related)?
      mutation.fields[spec.related]:before[spec.related];
    const clients=operatorCrmLinks(clientValue,1),related=operatorCrmLinks(relatedValue,10);
    if(!clients||clients.length!==1||!related)
      return operatorCrmRelationError('CRM records require one valid client and reviewed links');
    if(table==='Cotizaciones'&&related.length>1)
      return operatorCrmRelationError('A quotation can reference at most one order');

    const beforeRelated=operatorCrmLinks(before[spec.related],10);
    if(!creating&&!beforeRelated)
      return operatorCrmRelationError('Cannot verify current CRM relationships',503,'CRM_RELATION_VERIFY_UNAVAILABLE');
    if(!creating&&table==='Cotizaciones'&&Object.hasOwn(mutation.fields,spec.related)&&
       beforeRelated.length&&
       (related.length!==beforeRelated.length||related.some((id,i)=>id!==beforeRelated[i])))
      return operatorCrmRelationError('An operator cannot reassign a quotation already linked to an order');
    if(!creating&&table==='Pedidos'&&Object.hasOwn(mutation.fields,spec.related)&&
       beforeRelated.some(id=>!related.includes(id)))
      return operatorCrmRelationError('An operator cannot detach quotations from an existing order');

    clients.forEach(id=>clientIds.add(id));
    related.forEach(id=>targetIds.add(id));
    finalRows.push({id:mutation.id||'',clients,related});
  }

  let clients,targetRows;
  try{
    clients=await operatorCrmLoadRows('Clientes',[...clientIds],['Empresa'],env);
    targetRows=await operatorCrmLoadRows(spec.target,[...targetIds],
      spec.target==='Cotizaciones'?['Cliente','Pedido']:['Cliente'],env);
  }catch(_){
    return operatorCrmRelationError('Cannot verify CRM relationships',503,'CRM_RELATION_VERIFY_UNAVAILABLE');
  }
  if(clients.size!==clientIds.size||targetRows.size!==targetIds.size)
    return operatorCrmRelationError('A linked CRM record does not exist');

  for(const row of finalRows){
    const client=row.clients[0];
    for(const targetId of row.related){
      const target=targetRows.get(targetId),targetClients=operatorCrmLinks(target?.fields?.Cliente,1);
      if(!targetClients||targetClients.length!==1||targetClients[0]!==client)
        return operatorCrmRelationError('Linked quotation/order belongs to a different client');
      if(table==='Pedidos'){
        const targetOrders=operatorCrmLinks(target.fields.Pedido,10);
        if(!targetOrders)
          return operatorCrmRelationError('Cannot verify quotation assignment',503,'CRM_RELATION_VERIFY_UNAVAILABLE');
        if(creating&&targetOrders.length)
          return operatorCrmRelationError('Quotation is already assigned to another order');
        if(!creating&&targetOrders.some(id=>id!==row.id))
          return operatorCrmRelationError('Quotation is already assigned to another order');
      }
    }
  }
  return {ok:true};
}


const PROBLEM_REPORTS_TABLE='tbl2kU5lGg1JYcrPi';
const PROBLEM_SCREENSHOT_FIELD='fldV1AHUN24F2lkdW';
const PROBLEM_REPORT_STATES=new Set(['Nuevo','En análisis','Reparación preparada','PR abierto','Reparado','Error']);
function problemText(v,max){
  return typeof v==='string'&&v.length<=max&&!/[\x00-\x08\x0b\x0e-\x1f]/.test(v);
}
function problemEmail(v){
  return typeof v==='string'&&v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
function problemReportPayloadAllowed(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||
     Object.keys(body).some(k=>!['message','section','url','build','navigator','screenshot','autoRepair','reporter'].includes(k))||
     !problemText(body.message||'',6000)||(body.message||'').trim().length<5||
     !problemText(body.section||'',120)||!problemText(body.build||'',160)||
     !problemText(body.navigator||'',1200)||
     (body.url!==undefined&&(!problemText(body.url||'',1200)||
       !/^https:\/\/dashboard\.thelab\.solutions(?:\/|$)/.test(body.url||'')))||
     (body.autoRepair!==undefined&&typeof body.autoRepair!=='boolean')||
     (body.reporter!==undefined&&!problemEmail(body.reporter)))return false;
  if(body.screenshot!==undefined&&body.screenshot!==null){
    const shot=body.screenshot;
    if(!shot||typeof shot!=='object'||Array.isArray(shot)||
       Object.keys(shot).some(k=>!['filename','contentType','base64'].includes(k))||
       !problemText(shot.filename||'',180)||
       !['image/png','image/jpeg','image/webp'].includes(shot.contentType)||
       typeof shot.base64!=='string'||shot.base64.length<20||shot.base64.length>6800000||
       !/^[A-Za-z0-9+/=\r\n]+$/.test(shot.base64))return false;
  }
  return true;
}
function problemProjectRecord(rec){
  const f=rec?.fields||{},attachments=Array.isArray(f.Screenshot)?f.Screenshot:[];
  return{
    id:String(rec?.id||''),reportId:String(f['Reporte ID']||''),estado:PROBLEM_REPORT_STATES.has(f.Estado)?f.Estado:'Nuevo',
    mensaje:String(f.Mensaje||''),usuario:String(f.Usuario||''),seccion:String(f['Sección']||''),
    url:String(f.URL||''),build:String(f.Build||''),navegador:String(f.Navegador||''),
    diagnostico:String(f['Diagnóstico IA']||''),plan:String(f['Plan reparación']||''),
    prUrl:String(f['PR URL']||''),error:String(f.Error||''),autoReparar:f['Auto reparar']===true,
    fecha:String(f.Fecha||rec?.createdTime||''),actualizado:String(f.Actualizado||''),
    screenshot:attachments.slice(0,1).map(a=>({
      id:String(a?.id||''),filename:String(a?.filename||''),url:String(a?.url||''),
      type:String(a?.type||''),width:Number(a?.width)||0,height:Number(a?.height)||0,
      thumb:String(a?.thumbnails?.large?.url||a?.thumbnails?.small?.url||'')
    }))[0]||null
  };
}
async function problemReportsList(env,identity,legacy){
  if(!env.AIRTABLE_TOKEN)return {error:'missing-token'};
  const q=new URLSearchParams();
  q.set('pageSize','100');
  q.append('sort[0][field]','Fecha');q.append('sort[0][direction]','desc');
  for(const field of ['Reporte ID','Estado','Mensaje','Screenshot','Usuario','Sección','URL','Build','Navegador',
    'Diagnóstico IA','Plan reparación','PR URL','Error','Auto reparar','Fecha','Actualizado'])q.append('fields[]',field);
  let r;try{
    r=await fetch(AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+PROBLEM_REPORTS_TABLE+'?'+q.toString(),{
      method:'GET',redirect:'manual',headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,Accept:'application/json'}
    });
  }catch(_){return {error:'network'};}
  if(!r.ok||r.status>=300&&r.status<400)return {error:'upstream'};
  let data;try{data=await r.json();}catch(_){return {error:'invalid-json'};}
  if(!Array.isArray(data?.records))return {error:'invalid-shape'};
  const all=data.records.map(problemProjectRecord);
  const reports=identity?.role==='admin'||legacy?all:all.filter(x=>x.usuario.toLowerCase()===String(identity?.email||'').toLowerCase());
  return {reports:reports.slice(0,100)};
}
async function problemReportCreate(env,body){
  if(!env.AIRTABLE_TOKEN)return {error:'Problem report storage unavailable',status:503};
  const now=new Date().toISOString();
  const reportId='BUG-'+now.slice(0,10).replace(/-/g,'')+'-'+crypto.randomUUID().slice(0,8).toUpperCase();
  const fields={
    'Reporte ID':reportId,'Estado':'Nuevo','Mensaje':body.message.trim(),'Usuario':body.reporter,
    'Sección':body.section||'','URL':body.url||'','Build':body.build||'','Navegador':body.navigator||'',
    'Auto reparar':body.autoRepair!==false,'Fecha':now,'Actualizado':now
  };
  let created;
  try{
    const r=await fetch(AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+PROBLEM_REPORTS_TABLE,{
      method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify({fields})
    });
    if(!r.ok||r.status>=300&&r.status<400)return {error:'No se pudo guardar el reporte',status:502};
    created=await r.json();
  }catch(_){return {error:'No se pudo guardar el reporte',status:503};}
  if(!/^rec[A-Za-z0-9]{14}$/.test(String(created?.id||'')))
    return {error:'Resultado de guardado inválido',status:503};
  if(body.screenshot){
    try{
      const r=await fetch('https://content.airtable.com/v0/app1YtD74AqiPWQhy/'+created.id+'/'+
        PROBLEM_SCREENSHOT_FIELD+'/uploadAttachment',{
        method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,'Content-Type':'application/json'},
        body:JSON.stringify({contentType:body.screenshot.contentType,filename:body.screenshot.filename,
          file:body.screenshot.base64.replace(/[\r\n]/g,'')})
      });
      if(!r.ok||r.status>=300&&r.status<400){
        await fetch(AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+PROBLEM_REPORTS_TABLE+'/'+created.id,{
          method:'PATCH',headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,'Content-Type':'application/json'},
          body:JSON.stringify({fields:{Error:'El reporte se guardó, pero no se pudo adjuntar el screenshot',Actualizado:new Date().toISOString()}})
        }).catch(()=>{});
      }else{
        try{created=await (await fetch(AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+PROBLEM_REPORTS_TABLE+'/'+created.id,{
          headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,Accept:'application/json'}})).json();}catch(_){}
      }
    }catch(_){}
  }
  return {report:problemProjectRecord(created)};
}
function problemRepairPayloadAllowed(body){
  return !!body&&typeof body==='object'&&!Array.isArray(body)&&
    Object.keys(body).every(k=>['action','recordId','reporter'].includes(k))&&
    body.action==='repair'&&/^rec[A-Za-z0-9]{14}$/.test(String(body.recordId||''))&&
    (body.reporter===undefined||problemEmail(body.reporter));
}
async function problemReportRepair(env,body,identity,legacy){
  if(!env.AIRTABLE_TOKEN)return {error:'Problem report storage unavailable',status:503};
  const recordId=String(body.recordId||'');
  const endpoint=AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+PROBLEM_REPORTS_TABLE+'/'+recordId;
  let current;
  try{
    const r=await fetch(endpoint,{method:'GET',redirect:'manual',
      headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,Accept:'application/json'}});
    if(r.status===404)return {error:'Reporte no encontrado',status:404};
    if(!r.ok||r.status>=300&&r.status<400)return {error:'No se pudo leer el reporte',status:502};
    current=await r.json();
  }catch(_){return {error:'No se pudo leer el reporte',status:503};}
  const projected=problemProjectRecord(current);
  const identityEmail=String(identity?.email||'').toLowerCase();
  const legacyEmail=problemEmail(body.reporter)?String(body.reporter).toLowerCase():'';
  const owns=identity?.role==='admin'||
    (identityEmail&&projected.usuario.toLowerCase()===identityEmail)||
    (legacy===true&&legacyEmail&&projected.usuario.toLowerCase()===legacyEmail);
  if(!owns)return {error:'No tienes permiso para reparar este reporte',status:403};
  if(!['Nuevo','Error'].includes(projected.estado))
    return {error:projected.estado==='Reparado'?'El reporte ya está reparado':'El reporte ya está siendo procesado',status:409};
  const now=new Date().toISOString();
  const fields={
    Estado:'Nuevo','Auto reparar':true,
    'Diagnóstico IA':'Solicitud manual de reparación recibida. En cola para el próximo ciclo del agente.',
    'Plan reparación':null,'PR URL':null,Error:null,Actualizado:now
  };
  try{
    const r=await fetch(endpoint,{method:'PATCH',redirect:'manual',
      headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({fields})});
    if(!r.ok||r.status>=300&&r.status<400)return {error:'No se pudo poner el reporte en cola',status:502};
    const updated=await r.json();
    return {report:problemProjectRecord(updated)};
  }catch(_){return {error:'No se pudo poner el reporte en cola',status:503};}
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
function mailSharedAccountMap(env){
  try{
    const raw=String(env.MAIL_SHARED_ACCOUNT_MAP||'').trim();
    if(!raw)return {};
    const parsed=JSON.parse(raw);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {};
    return parsed;
  }catch(_){return {};}
}
function mailAuthorizedAccounts(identity,env){
  if(!identity||typeof identity!=='object')return [];
  const email=String(identity.email||'').toLowerCase();
  const role=String(identity.role||'');
  const out=[];
  if(/^[^\s@]+@thelab\.solutions$/.test(email))out.push(email);
  const map=mailSharedAccountMap(env);
  for(const [account,grants] of Object.entries(map)){
    if(!/^[^\s@]+@thelab\.solutions$/.test(String(account).toLowerCase())||!Array.isArray(grants))continue;
    const allowed=grants.some(g=>{
      const v=String(g||'').toLowerCase();
      return v===role||v===email||v==='email:'+email||v==='role:'+role;
    });
    if(allowed)out.push(String(account).toLowerCase());
  }
  return [...new Set(out)].sort();
}
function mailApiEndpoint(env){
  const raw=String(env.MAIL_API_URL||'https://mail-api.thelab.solutions/mail-api.php');
  let u;try{u=new URL(raw);}catch(_){return null;}
  if(u.protocol!=='https:'||u.hostname!=='mail-api.thelab.solutions'||u.username||u.password||
     u.search||u.hash||u.pathname!=='/mail-api.php')return null;
  return u.toString();
}
function sharedMailEmailAllowed(email){
  return typeof email==='string'&&email.length<=254&&email===email.toLowerCase()&&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function sharedMailMailboxAllowed(identity,account,legacy,env){
  if(!sharedMailEmailAllowed(account))return false;
  if(legacy)return true;
  return mailAuthorizedAccounts(identity,env).includes(account);
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


const SHARED_FINANCE_NAME='FINANZAS_V2';
const SHARED_FINANCE_VERSION=1;
const SHARED_FINANCE_TOP_KEYS=new Set([
  'version','updatedAt','journal','budget','scheduledPayments','saldoInicial',
  'arqueos','cajaFondo','manualSales','loans','cobranza','costosFijos',
  'comisionCfg','metasVendedor','plazoDefault'
]);
function sharedFinancePlainObject(v){
  return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
}
function sharedFinanceText(v,max=2000){
  return typeof v==='string'&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
}
function sharedFinanceFinite(v,{min=-1e12,max=1e12}={}){
  return typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
}
function sharedFinanceJournalAllowed(rows){
  if(!Array.isArray(rows)||rows.length>1500)return false;
  const ids=new Set();
  return rows.every(r=>{
    if(!sharedFinancePlainObject(r)||Object.keys(r).some(k=>![
      'id','fecha','tipo','categoria','descripcion','monto','metodo','referencia',
      'contraparte','documentoTributario','dteCompra'
    ].includes(k)))return false;
    if(!sharedFinanceText(r.id,120)||!r.id||ids.has(r.id))return false;ids.add(r.id);
    return /^\d{4}-\d{2}-\d{2}$/.test(String(r.fecha||''))&&
      ['ingreso','gasto'].includes(r.tipo)&&sharedFinanceText(r.categoria||'',160)&&
      sharedFinanceText(r.descripcion||'',3000)&&sharedFinanceFinite(Number(r.monto),{min:0,max:1e11})&&
      sharedFinanceText(r.metodo||'',160)&&sharedFinanceText(r.referencia||'',500)&&
      sharedFinanceText(r.contraparte||'',500)&&
      (r.documentoTributario===undefined||typeof r.documentoTributario==='boolean')&&
      (r.dteCompra===undefined||typeof r.dteCompra==='boolean');
  });
}
function sharedFinanceBudgetAllowed(v){
  if(!sharedFinancePlainObject(v)||Object.keys(v).length>120)return false;
  for(const [period,row] of Object.entries(v)){
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)||!sharedFinancePlainObject(row)||
       Object.keys(row).some(k=>k!=='cats')||!Array.isArray(row.cats)||row.cats.length>20)return false;
    const seen=new Set();
    for(const c of row.cats){
      if(!sharedFinancePlainObject(c)||!sharedFinanceText(c.id,80)||!c.id||seen.has(c.id)||
         !sharedFinanceText(c.label||'',200)||!sharedFinanceText(c.color||'',40)||
         !sharedFinanceText(c.icon||'',1000)||!sharedFinanceFinite(Number(c.budget||0),{min:0,max:1e11})||
         !sharedFinanceFinite(Number(c.ejecutado||0),{min:0,max:1e11}))return false;
      seen.add(c.id);
    }
  }
  return true;
}
function sharedFinanceScheduledAllowed(rows){
  if(!Array.isArray(rows)||rows.length>300)return false;
  const ids=new Set();
  return rows.every(r=>sharedFinancePlainObject(r)&&
    Object.keys(r).every(k=>['id','concepto','monto','fecha','recurrente'].includes(k))&&
    sharedFinanceText(r.id,160)&&!!r.id&&!ids.has(r.id)&&(ids.add(r.id),true)&&
    sharedFinanceText(r.concepto||'',500)&&/^\d{4}-\d{2}-\d{2}$/.test(String(r.fecha||''))&&
    sharedFinanceFinite(Number(r.monto),{min:0,max:1e11})&&typeof r.recurrente==='boolean');
}
function sharedFinanceManualSalesAllowed(rows){
  if(!Array.isArray(rows)||rows.length>1000)return false;
  return rows.every(r=>sharedFinancePlainObject(r)&&
    Object.keys(r).every(k=>['year','mes','nombre','empresa','item','cant','valor','canal','cat','fact','pago','porCobrar','fechaFact','fechaPago','_manual'].includes(k))&&
    /^\d{4}$/.test(String(r.year||''))&&/^(0?[1-9]|1[0-2])$/.test(String(r.mes||''))&&
    sharedFinanceText(r.nombre||'',500)&&sharedFinanceText(r.empresa||'',500)&&sharedFinanceText(r.item||'',1000)&&
    sharedFinanceFinite(Number(r.cant||0),{min:0,max:1e7})&&sharedFinanceFinite(Number(r.valor||0),{min:-1e11,max:1e11})&&
    sharedFinanceText(r.canal||'',160)&&sharedFinanceText(r.cat||'',160)&&sharedFinanceText(r.fact||'',160)&&
    sharedFinanceFinite(Number(r.pago||0),{min:-1e11,max:1e11})&&sharedFinanceFinite(Number(r.porCobrar||0),{min:0,max:1e11})&&
    sharedFinanceText(r.fechaFact||'',40)&&sharedFinanceText(r.fechaPago||'',40)&&(r._manual===undefined||r._manual===true));
}
function sharedFinanceLoansAllowed(rows){
  if(!Array.isArray(rows)||rows.length>500)return false;
  return rows.every(r=>sharedFinancePlainObject(r)&&Object.keys(r).every(k=>['fecha','prestamo','devolucion','deuda','obs'].includes(k))&&
    /^\d{2}\/\d{2}\/\d{2,4}$/.test(String(r.fecha||''))&&
    (r.prestamo===null||sharedFinanceFinite(Number(r.prestamo),{min:0,max:1e11}))&&
    (r.devolucion===null||sharedFinanceFinite(Number(r.devolucion),{min:0,max:1e11}))&&
    sharedFinanceFinite(Number(r.deuda),{min:0,max:1e11})&&sharedFinanceText(r.obs||'',1000));
}
function sharedFinanceMapAllowed(v,{maxKeys=600,maxArray=100,maxText=2000}={}){
  if(!sharedFinancePlainObject(v)||Object.keys(v).length>maxKeys)return false;
  try{
    const raw=JSON.stringify(v);
    if(raw.length>70000)return false;
  }catch(_){return false;}
  const walk=x=>{
    if(x===null||typeof x==='boolean')return true;
    if(typeof x==='number')return Number.isFinite(x)&&Math.abs(x)<=1e12;
    if(typeof x==='string')return sharedFinanceText(x,maxText);
    if(Array.isArray(x))return x.length<=maxArray&&x.every(walk);
    if(sharedFinancePlainObject(x))return Object.keys(x).length<=80&&Object.entries(x).every(([k,val])=>sharedFinanceText(k,200)&&walk(val));
    return false;
  };
  return walk(v);
}
function sharedFinanceDocumentAllowed(doc){
  if(!sharedFinancePlainObject(doc)||Object.keys(doc).some(k=>!SHARED_FINANCE_TOP_KEYS.has(k))||
     doc.version!==SHARED_FINANCE_VERSION||!sharedFinanceFinite(doc.updatedAt,{min:0,max:9999999999999})||
     !sharedFinanceJournalAllowed(doc.journal)||!sharedFinanceBudgetAllowed(doc.budget)||
     !sharedFinanceScheduledAllowed(doc.scheduledPayments)||
     !sharedFinanceFinite(doc.saldoInicial,{min:-1e11,max:1e11})||
     !sharedFinanceMapAllowed(doc.arqueos,{maxKeys:800,maxArray:20,maxText:500})||
     !sharedFinanceFinite(doc.cajaFondo,{min:-1e11,max:1e11})||
     !sharedFinanceManualSalesAllowed(doc.manualSales)||!sharedFinanceLoansAllowed(doc.loans)||
     !sharedFinanceMapAllowed(doc.cobranza,{maxKeys:1000,maxArray:200,maxText:2000})||
     !sharedFinanceFinite(doc.costosFijos,{min:0,max:1e11})||
     !sharedFinancePlainObject(doc.comisionCfg)||!sharedFinanceFinite(Number(doc.comisionCfg.rate),{min:0,max:100})||
     !['venta','utilidad'].includes(doc.comisionCfg.base)||
     !sharedFinanceMapAllowed(doc.metasVendedor,{maxKeys:100,maxArray:1,maxText:200})||
     (doc.plazoDefault!==undefined&&!sharedFinanceFinite(Number(doc.plazoDefault),{min:0,max:365})))
    return false;
  try{return JSON.stringify(doc).length<=95000;}catch(_){return false;}
}
function sharedFinanceEmpty(){
  return {version:1,updatedAt:0,journal:[],budget:{},scheduledPayments:[],saldoInicial:0,
    arqueos:{},cajaFondo:0,manualSales:[],loans:[],cobranza:{},costosFijos:0,
    comisionCfg:{rate:5,base:'venta'},metasVendedor:{},plazoDefault:30};
}
async function sharedFinanceLoad(env){
  if(!env.AIRTABLE_TOKEN)return {error:'invalid-config'};
  const q=new URLSearchParams();q.set('maxRecords','2');
  q.set('filterByFormula',"{Name}='"+SHARED_FINANCE_NAME+"'");
  q.append('fields[]','Name');q.append('fields[]','Notes');
  let response;
  try{
    response=await fetch(AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+encodeURIComponent('Monitor Sistema')+'?'+q.toString(),{
      method:'GET',redirect:'manual',headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,Accept:'application/json'}
    });
  }catch(_){return {error:'network'};}
  if(!response.ok||response.status>=300&&response.status<400)return {error:'upstream'};
  let body;try{body=await response.json();}catch(_){return {error:'invalid-json'};}
  if(!body||!Array.isArray(body.records)||body.records.length>1)return {error:'invalid-shape'};
  if(!body.records.length){
    const data=sharedFinanceEmpty();
    return {recordId:'',exists:false,raw:'',data,revision:await sharedCalendarDigest('')};
  }
  const rec=body.records[0];
  if(!/^rec[A-Za-z0-9]{14}$/.test(String(rec.id||''))||rec.fields?.Name!==SHARED_FINANCE_NAME||
     typeof rec.fields?.Notes!=='string')return {error:'invalid-record'};
  let data;try{data=JSON.parse(rec.fields.Notes);}catch(_){return {error:'invalid-payload'};}
  if(!sharedFinanceDocumentAllowed(data))return {error:'invalid-payload'};
  return {recordId:rec.id,exists:true,raw:rec.fields.Notes,data,
    revision:await sharedCalendarDigest(rec.fields.Notes)};
}
function sharedFinanceActorAllowed(actor){
  return actor&&typeof actor.email==='string'&&['finance','admin'].includes(actor.role);
}


const SHARED_REM_NAME='REMUNERACIONES_V2';
const SHARED_REM_VERSION=2;
const REM_PERIOD_STATES=new Set(['draft','review','approved','closed','paid','reopened']);
const REM_EVENT_STATES=new Set(['estimated','accrued','approved','paid','reversed']);
function sharedRemEmail(v){return typeof v==='string'&&v.length<=254&&(/^\*$/.test(v)||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));}
function sharedRemDate(v){return v===null||v===''||/^\d{4}-\d{2}-\d{2}$/.test(String(v));}
function sharedRemPeriod(v){return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v||''));}
function sharedRemId(v,max=160){return typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f]/.test(v);}
function sharedRemMoney(v){return typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e11;}
function sharedRemRule(r){
  return sharedFinancePlainObject(r)&&Object.keys(r).every(k=>[
    'id','version','sellerEmail','seller','rate','basis','validFrom','validTo','contract','product'
  ].includes(k))&&sharedRemId(r.id)&&Number.isInteger(r.version)&&r.version>0&&r.version<10000&&
    sharedRemEmail(r.sellerEmail||'*')&&sharedFinanceText(r.seller||'*',250)&&
    typeof r.rate==='number'&&Number.isFinite(r.rate)&&r.rate>=0&&r.rate<=1&&
    ['net_tax_document','net_paid','net_invoiced'].includes(r.basis)&&
    sharedRemDate(r.validFrom)&&sharedRemDate(r.validTo)&&sharedFinanceText(r.contract||'',300)&&
    sharedFinanceText(r.product||'*',300);
}
function sharedRemEvent(e){
  return sharedFinancePlainObject(e)&&Object.keys(e).every(k=>[
    'id','sourceId','order','sellerEmail','seller','period','date','eligibleNet','commission',
    'status','ruleId','ruleVersion','ruleRate','basis','verifiedBase','paymentRatio','eventAt',
    'updatedAt','reversalOf','reason','invoice','payment'
  ].includes(k))&&sharedRemId(e.id)&&sharedRemId(e.sourceId)&&sharedRemPeriod(e.period)&&
    sharedRemEmail(e.sellerEmail||'*')&&sharedFinanceText(e.seller||'',250)&&sharedRemDate(e.date)&&
    sharedRemMoney(e.eligibleNet)&&sharedRemMoney(e.commission)&&REM_EVENT_STATES.has(e.status)&&
    sharedRemId(e.ruleId)&&Number.isInteger(e.ruleVersion)&&e.ruleVersion>0&&
    typeof e.ruleRate==='number'&&Number.isFinite(e.ruleRate)&&e.ruleRate>=0&&e.ruleRate<=1&&
    sharedFinanceText(e.basis||'',250)&&typeof e.verifiedBase==='boolean'&&
    typeof e.paymentRatio==='number'&&Number.isFinite(e.paymentRatio)&&e.paymentRatio>=0&&e.paymentRatio<=1&&
    sharedFinanceText(e.eventAt||'',60)&&sharedFinanceText(e.updatedAt||'',60)&&
    sharedFinanceText(e.reversalOf||'',160)&&sharedFinanceText(e.reason||'',1000)&&
    sharedFinanceText(e.order||'',160)&&sharedFinanceText(e.invoice||'',160)&&sharedFinanceText(e.payment||'',160);
}
function sharedRemPeriodRow(p){
  return sharedFinancePlainObject(p)&&Object.keys(p).every(k=>[
    'id','period','sellerEmail','seller','status','snapshotTotal','closedAt','paidAt',
    'reopenedAt','updatedAt','ruleVersions','note'
  ].includes(k))&&sharedRemId(p.id)&&sharedRemPeriod(p.period)&&sharedRemEmail(p.sellerEmail||'*')&&
    sharedFinanceText(p.seller||'',250)&&REM_PERIOD_STATES.has(p.status)&&sharedRemMoney(p.snapshotTotal)&&
    sharedFinanceText(p.closedAt||'',60)&&sharedFinanceText(p.paidAt||'',60)&&
    sharedFinanceText(p.reopenedAt||'',60)&&sharedFinanceText(p.updatedAt||'',60)&&
    Array.isArray(p.ruleVersions)&&p.ruleVersions.length<=50&&p.ruleVersions.every(v=>sharedRemId(v,160))&&
    sharedFinanceText(p.note||'',1000);
}
function sharedRemAdjustment(a){
  return sharedFinancePlainObject(a)&&Object.keys(a).every(k=>[
    'id','period','sellerEmail','seller','amount','reason','actor','evidence','createdAt','reversalOf'
  ].includes(k))&&sharedRemId(a.id)&&sharedRemPeriod(a.period)&&sharedRemEmail(a.sellerEmail||'*')&&
    sharedFinanceText(a.seller||'',250)&&sharedRemMoney(a.amount)&&sharedFinanceText(a.reason||'',1000)&&
    sharedFinanceText(a.actor||'',254)&&sharedFinanceText(a.evidence||'',1000)&&
    sharedFinanceText(a.createdAt||'',60)&&sharedFinanceText(a.reversalOf||'',160);
}
function sharedRemSalary(a){
  return sharedFinancePlainObject(a)&&Object.keys(a).every(k=>[
    'sellerEmail','seller','amount','validFrom','validTo'
  ].includes(k))&&sharedRemEmail(a.sellerEmail||'*')&&sharedFinanceText(a.seller||'',250)&&
    sharedRemMoney(a.amount)&&a.amount>=0&&sharedRemDate(a.validFrom)&&sharedRemDate(a.validTo);
}
function sharedRemAudit(a){
  return sharedFinancePlainObject(a)&&Object.keys(a).every(k=>[
    'id','at','actor','role','action','period','detail'
  ].includes(k))&&sharedRemId(a.id)&&sharedFinanceText(a.at||'',60)&&sharedFinanceText(a.actor||'',254)&&
    ['finance','admin'].includes(a.role)&&['write','close','reopen','pay','adjust'].includes(a.action)&&
    sharedFinanceText(a.period||'',20)&&sharedFinanceText(a.detail||'',1000);
}
function sharedRemDocumentAllowed(doc){
  if(!sharedFinancePlainObject(doc)||doc.version!==SHARED_REM_VERSION||
     Object.keys(doc).some(k=>!['version','updatedAt','rules','events','periods','adjustments','baseSalaries','audit'].includes(k))||
     !sharedFinanceFinite(doc.updatedAt,{min:0,max:9999999999999}))return false;
  const sets=[
    [doc.rules,300,sharedRemRule],[doc.events,2500,sharedRemEvent],[doc.periods,500,sharedRemPeriodRow],
    [doc.adjustments,1000,sharedRemAdjustment],[doc.baseSalaries,300,sharedRemSalary],[doc.audit,600,sharedRemAudit]
  ];
  for(const [rows,max,fn] of sets)if(!Array.isArray(rows)||rows.length>max||!rows.every(fn))return false;
  const uniq=(rows)=>new Set(rows.map(x=>x.id)).size===rows.length;
  if(!uniq(doc.rules)||!uniq(doc.events)||!uniq(doc.periods)||!uniq(doc.adjustments)||!uniq(doc.audit))return false;
  try{return JSON.stringify(doc).length<=150000;}catch(_){return false;}
}
function sharedRemEmpty(){
  return {version:2,updatedAt:0,rules:[{
    id:'commission-standard',version:1,sellerEmail:'*',seller:'*',rate:0.035,
    basis:'net_tax_document',validFrom:'2026-01-01',validTo:null,contract:'standard',product:'*'
  }],events:[],periods:[],adjustments:[],baseSalaries:[],audit:[]};
}
async function sharedRemLoad(env){
  if(!env.AIRTABLE_TOKEN)return {error:'invalid-config'};
  const q=new URLSearchParams();q.set('maxRecords','2');
  q.set('filterByFormula',"{Name}='"+SHARED_REM_NAME+"'");
  q.append('fields[]','Name');q.append('fields[]','Notes');
  let response;
  try{response=await fetch(AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+encodeURIComponent('Monitor Sistema')+'?'+q.toString(),{
    method:'GET',redirect:'manual',headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN,Accept:'application/json'}
  });}catch(_){return {error:'network'};}
  if(!response.ok||response.status>=300&&response.status<400)return {error:'upstream'};
  let body;try{body=await response.json();}catch(_){return {error:'invalid-json'};}
  if(!body||!Array.isArray(body.records)||body.records.length>1)return {error:'invalid-shape'};
  if(!body.records.length){
    const data=sharedRemEmpty();return {recordId:'',exists:false,raw:'',data,revision:await sharedCalendarDigest('')};
  }
  const rec=body.records[0];
  if(!/^rec[A-Za-z0-9]{14}$/.test(String(rec.id||''))||rec.fields?.Name!==SHARED_REM_NAME||
     typeof rec.fields?.Notes!=='string')return {error:'invalid-record'};
  let data;try{data=JSON.parse(rec.fields.Notes);}catch(_){return {error:'invalid-payload'};}
  if(!sharedRemDocumentAllowed(data))return {error:'invalid-payload'};
  return {recordId:rec.id,exists:true,raw:rec.fields.Notes,data,
    revision:await sharedCalendarDigest(rec.fields.Notes)};
}
function sharedRemScope(data,identity){
  if(!identity||identity.role!=='sales')return data;
  const email=String(identity.email||'').toLowerCase();
  return {...data,
    rules:data.rules.filter(r=>r.sellerEmail==='*'||String(r.sellerEmail).toLowerCase()===email),
    events:data.events.filter(r=>String(r.sellerEmail).toLowerCase()===email),
    periods:data.periods.filter(r=>String(r.sellerEmail).toLowerCase()===email),
    adjustments:data.adjustments.filter(r=>String(r.sellerEmail).toLowerCase()===email),
    baseSalaries:data.baseSalaries.filter(r=>String(r.sellerEmail).toLowerCase()===email),audit:[]};
}
function sharedRemPeriodSlice(doc,p){
  const key=x=>x.period===p.period&&String(x.sellerEmail).toLowerCase()===String(p.sellerEmail).toLowerCase();
  return {
    period:p,
    events:doc.events.filter(key).sort((a,b)=>a.id.localeCompare(b.id)),
    adjustments:doc.adjustments.filter(key).sort((a,b)=>a.id.localeCompare(b.id))
  };
}
function sharedRemEconomicEvent(e){
  const x={...e};delete x.status;delete x.updatedAt;return x;
}
function sharedRemPeriodsTransitionAllowed(current,next,actor){
  const allowed={
    draft:new Set(['draft','review']),review:new Set(['review','draft','approved']),
    approved:new Set(['approved','review','closed']),closed:new Set(['closed','paid','reopened']),
    paid:new Set(['paid','reopened']),reopened:new Set(['reopened','review','approved','closed'])
  };
  for(const p of next.periods){
    const old=current.periods.find(x=>x.id===p.id);
    if(!old){if(p.status!=='draft')return false;continue;}
    if(!allowed[old.status]?.has(p.status))return false;
    if(p.status==='reopened'&&old.status!==p.status&&actor?.role!=='admin')return false;
  }
  return current.periods.every(old=>next.periods.some(p=>p.id===old.id));
}
function sharedRemClosedTotalsValid(doc){
  for(const p of doc.periods){
    if(!['closed','paid'].includes(p.status))continue;
    const key=x=>x.period===p.period&&String(x.sellerEmail).toLowerCase()===String(p.sellerEmail).toLowerCase();
    const events=doc.events.filter(key);
    if(events.some(e=>!['approved','paid','reversed'].includes(e.status)))return false;
    const total=Math.round(events.reduce((n,e)=>n+Number(e.commission||0),0)+
      doc.adjustments.filter(key).reduce((n,a)=>n+Number(a.amount||0),0));
    if(Math.round(Number(p.snapshotTotal||0))!==total)return false;
  }
  return true;
}
function sharedRemProtected(current,next,actor){
  for(const old of current.periods){
    if(!['closed','paid'].includes(old.status))continue;
    const newer=next.periods.find(p=>p.id===old.id);
    if(!newer)return false;
    const before=sharedRemPeriodSlice(current,old),after=sharedRemPeriodSlice(next,newer);
    const sameAdjustments=JSON.stringify(before.adjustments)===JSON.stringify(after.adjustments);
    const immutablePeriod=(p)=>({
      id:p.id,period:p.period,sellerEmail:p.sellerEmail,seller:p.seller,
      snapshotTotal:p.snapshotTotal,closedAt:p.closedAt,ruleVersions:p.ruleVersions
    });
    if(JSON.stringify(immutablePeriod(old))!==JSON.stringify(immutablePeriod(newer))||!sameAdjustments)return false;
    if(newer.status==='reopened'&&actor?.role==='admin'){
      if(JSON.stringify(before.events)!==JSON.stringify(after.events))return false;
      continue;
    }
    if(old.status==='closed'&&newer.status==='paid'){
      if(before.events.length!==after.events.length)return false;
      const afterById=new Map(after.events.map(e=>[e.id,e]));
      for(const ev of before.events){
        const ne=afterById.get(ev.id);if(!ne)return false;
        if(JSON.stringify(sharedRemEconomicEvent(ev))!==JSON.stringify(sharedRemEconomicEvent(ne)))return false;
        if(ev.status==='approved'&&ne.status!=='paid')return false;
        if(ev.status==='reversed'&&ne.status!=='reversed')return false;
        if(ev.status==='paid'&&ne.status!=='paid')return false;
      }
      continue;
    }
    if(JSON.stringify(before)!==JSON.stringify(after))return false;
  }
  return true;
}
function sharedRemAction(current,next){
  for(const p of next.periods){
    const old=current.periods.find(x=>x.id===p.id);
    if(old?.status!==p.status){
      if(p.status==='closed')return {action:'close',period:p.period};
      if(p.status==='paid')return {action:'pay',period:p.period};
      if(p.status==='reopened')return {action:'reopen',period:p.period};
    }
  }
  if(next.adjustments.length!==current.adjustments.length)return {action:'adjust',period:next.adjustments.at(-1)?.period||''};
  return {action:'write',period:''};
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
  ]),
  Maquinas:new Set([...VIEWER_READ_FIELDS.Maquinas,'ip','cam']),
  Maquinas_Eventos:new Set([...VIEWER_READ_FIELDS.Maquinas_Eventos,'desc','pedido_id']),
  Maquinas_Mant:new Set([...VIEWER_READ_FIELDS.Maquinas_Mant,'notas','ts']),
  Equipo_Eventos:new Set(['persona_id','fecha','tipo','desc','hora_inicio','hora_fin'])
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

const VISUAL_AI_PROVIDER='https://api.muapi.ai/api/v1';
const VISUAL_AI_ALLOWED_ENDPOINTS=new Set([
  'add-image-watermark',
  'ai-anime-generator',
  'ai-background-remover',
  'ai-color-photo',
  'ai-dress-change',
  'ai-ghibli-style',
  'ai-image-extension',
  'ai-image-face-swap',
  'ai-image-upscaler',
  'ai-object-eraser',
  'ai-product-photography',
  'ai-product-shot',
  'ai-skin-enhancer',
  'ai-video-effects',
  'bytedance-seededit-image',
  'bytedance-seedream-v4.5',
  'creatify-lipsync',
  'flux-dev-image',
  'flux-kontext-dev',
  'flux-kontext-effects',
  'flux-kontext-max',
  'flux-kontext-pro',
  'flux-kontext-pro-i2i',
  'flux-schnell-image',
  'google-imagen4',
  'google-imagen4-ultra',
  'gpt-image-2-image-to-image',
  'gpt4o-edit',
  'gpt4o-text-to-image',
  'grok-imagine-image-to-video',
  'grok-imagine-text-to-image',
  'grok-imagine-text-to-video',
  'hidream-i1-full',
  'hunyuan-image-to-video',
  'hunyuan-text-to-video',
  'ideogram-v3',
  'image-effects',
  'infinitetalk-image-to-video',
  'kling-v2.1-master-i2v',
  'kling-v2.6-std-motion-control',
  'kling-v3.0-pro-image-to-video',
  'kling-v3.0-pro-motion-control',
  'kling-v3.0-pro-text-to-video',
  'kling-v3.0-standard-image-to-video',
  'ltx-2-19b-lipsync',
  'ltx-2-19b-text-to-video',
  'ltx-2-pro-image-to-video',
  'ltx-2-pro-text-to-video',
  'midjourney-v7-text-to-image',
  'minimax-hailuo-02-pro-i2v',
  'minimax-hailuo-2.3-pro-i2v',
  'minimax-speech-2.6-hd',
  'minimax-voice-clone',
  'mmaudio-v2-text-to-audio',
  'motion-controls',
  'nano-banana',
  'nano-banana-edit',
  'nano-banana-effects',
  'openai-sora-2-image-to-video',
  'openai-sora-2-pro-text-to-video',
  'openai-sora-2-text-to-video',
  'pixverse-v5-i2v',
  'qwen-image-edit',
  'reve-image-edit',
  'runway-image-to-video',
  'runway-text-to-video',
  'seedance-pro-i2v',
  'seedance-v2.0-i2v',
  'seedvr2-image-upscale',
  'suno-create-music',
  'suno-extend-music',
  'suno-remix-music',
  'sync-lipsync',
  'topaz-image-upscale',
  'veed-lipsync',
  'veo3-image-to-video',
  'veo3-text-to-video',
  'veo3.1-image-to-video',
  'veo3.1-text-to-video',
  'vfx',
  'video-effects',
  'wan2.2-image-to-video',
  'wan2.2-speech-to-video',
  'wan2.5-text-to-video',
  'wan2.6-image-edit',
  'wan2.6-text-to-video',
]);
const VISUAL_AI_MAX_PROMPT=3000;
const VISUAL_AI_MAX_UPLOAD_BYTES=8*1024*1024;
const VISUAL_AI_MAX_GENERATIONS_PER_DAY=40;
const VISUAL_AI_RESULT_HOST_SUFFIXES=[
  'muapi.ai','fal.media','replicate.delivery','cloudfront.net','amazonaws.com'
];
function visualAiHttpsUrl(value){
  try{
    const u=new URL(String(value||''));
    if(u.protocol!=='https:'||u.username||u.password)return null;
    const h=u.hostname.toLowerCase();
    if(!h||h==='localhost'||h.endsWith('.local')||/^\d+\.\d+\.\d+\.\d+$/.test(h))return null;
    return u.toString();
  }catch(_){return null;}
}
function visualAiResultUrl(value){
  const safe=visualAiHttpsUrl(value);if(!safe)return null;
  const h=new URL(safe).hostname.toLowerCase();
  return VISUAL_AI_RESULT_HOST_SUFFIXES.some(s=>h===s||h.endsWith('.'+s))?safe:null;
}
function visualAiPayloadAllowed(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return false;
  const allowed=new Set(['prompt','images_list','image_url','model_image_url','person_image_url',
    'aspect_ratio','duration','resolution']);
  if(Object.keys(payload).some(k=>!allowed.has(k)))return false;
  if(payload.prompt!=null&&(typeof payload.prompt!=='string'||payload.prompt.length>VISUAL_AI_MAX_PROMPT))return false;
  for(const k of ['image_url','model_image_url','person_image_url']){
    if(payload[k]!=null&&!visualAiHttpsUrl(payload[k]))return false;
  }
  if(payload.images_list!=null&&(!Array.isArray(payload.images_list)||payload.images_list.length>4||
    payload.images_list.some(v=>!visualAiHttpsUrl(v))))return false;
  if(payload.aspect_ratio!=null&&!['1:1','16:9','9:16','4:3','3:4','21:9'].includes(payload.aspect_ratio))return false;
  if(payload.duration!=null&&![5,10].includes(Number(payload.duration)))return false;
  if(payload.resolution!=null&&!['480p','720p','1080p'].includes(payload.resolution))return false;
  return true;
}
function visualAiActorAllowed(actor){
  return actor&&typeof actor.email==='string'&&['sales','operator','finance','admin'].includes(actor.role);
}

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
  'Access-Control-Expose-Headers': 'X-AI-Estimated-Cost-USD,X-AI-Cost-Provenance',
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
  "Monto Pagado": ["number"],
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
  "Saldo Pendiente": ["number"],
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
      ?this._handleSpend(request):path==='/ads-shell'
        ?this._handleAdsShell(request):path==='/shared-calendar'
        ?this._handleSharedCalendar(request):path==='/shared-agenda'
          ?this._handleSharedAgenda(request):path==='/shared-mail'
            ?this._handleSharedMail(request):path==='/mail-session'
              ?this._handleMailSession(request):path==='/mail-rpc'
                ?this._handleMailRpc(request):path==='/shared-machineops'
              ?this._handleSharedMachineOps(request):path==='/shared-simulation'
                ?this._handleSharedSimulation(request):path==='/shared-finance'
                  ?this._handleSharedFinance(request):path==='/shared-remunerations'
                    ?this._handleSharedRemunerations(request):path==='/visual-ai-guard'
                    ?this._handleVisualAiGuard(request):path==='/newsletter-send'
                      ?this._handleNewsletterSend(request):path==='/social-lead'
                        ?this._handleSocialLead(request):path==='/scoped-patch'
                  ?this._handleScopedPatch(request):this._handle(request));
    this._queue = run.catch(() => {});
    return run;
  }
  _json(data, status) {
    return new Response(JSON.stringify(data), {
      status, headers: { 'Content-Type': 'application/json' },
    });
  }
  async _handleAdsShell(request){
    if(request.method!=='POST')return this._json({error:'Method not allowed'},405);
    let payload;try{payload=await request.json();}catch(_){return this._json({error:'Invalid Ads shell request'},422);}
    const actor=payload?.actor;
    const signed=actor&&typeof actor.email==='string'&&['operator','finance','admin'].includes(actor.role);
    const legacy=actor?.legacy===true;
    if(!signed&&!legacy||typeof payload.mutationId!=='string'||payload.mutationId.length<10||
       typeof payload.nombre!=='string'||!payload.nombre.trim()||
       !Number.isSafeInteger(Number(payload.presupuesto)))
      return this._json({error:'Ads shell write denied'},403);
    if(!this.env.ADS_MAKE_SHELL_URL||!this.env.ADS_MAKE_SHELL_KEY)
      return this._json({error:'Ads shell backend not configured'},503);
    let endpoint;try{endpoint=new URL(this.env.ADS_MAKE_SHELL_URL);}catch(_){return this._json({error:'Ads shell backend misconfigured'},503);}
    if(endpoint.protocol!=='https:'||!/^hook\.[a-z0-9-]+\.make\.com$/i.test(endpoint.hostname))
      return this._json({error:'Ads shell backend host denied'},503);
    const key='ads-shell:'+payload.mutationId;
    const prior=await this.state.storage.get(key);
    if(prior?.ok)return this._json({ok:true,reused:true,createdAt:prior.createdAt},200);
    endpoint.searchParams.set('clave',this.env.ADS_MAKE_SHELL_KEY);
    endpoint.searchParams.set('nombre',payload.nombre.trim());
    endpoint.searchParams.set('presupuesto',String(payload.presupuesto));
    let upstream;
    try{
      upstream=await fetch(endpoint.toString(),{method:'POST',redirect:'manual',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({clave:this.env.ADS_MAKE_SHELL_KEY,nombre:payload.nombre.trim(),
          presupuesto:payload.presupuesto,mutationId:payload.mutationId})});
    }catch(_){return this._json({error:'Ads shell outcome uncertain; retry uses same mutationId',
      code:'ADS_SHELL_UNCERTAIN'},503);}
    if(!upstream.ok||upstream.status>=300&&upstream.status<400){
      try{await upstream.body?.cancel?.();}catch(_){}
      return this._json({error:'Ads shell backend rejected request',code:'ADS_SHELL_REJECTED'},502);
    }
    try{await upstream.body?.cancel?.();}catch(_){}
    const createdAt=new Date().toISOString();
    await this.state.storage.put(key,{ok:true,createdAt,nombre:payload.nombre.trim(),
      actor:signed?actor.email:'legacy'});
    return this._json({ok:true,reused:false,createdAt},201);
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


  _mailSessionKey(actor,account){
    return 'mail-session:'+String(actor?.email||'').toLowerCase()+':'+String(account||'').toLowerCase();
  }
  async _mailPost(account,password,params){
    const endpoint=mailApiEndpoint(this.env);
    if(!endpoint)return {response:null,error:'Mail API misconfigured'};
    const fd=new URLSearchParams();
    fd.set('user',account);fd.set('pass',password);
    for(const [k,v] of Object.entries(params||{}))fd.set(k,String(v??''));
    try{
      const response=await fetch(endpoint,{method:'POST',redirect:'manual',
        headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8',
          'Origin':'https://dashboard.thelab.solutions'},
        body:fd.toString()});
      return {response};
    }catch(_){return {response:null,error:'Mail API unavailable'};}
  }
  async _handleMailSession(request){
    if(!['POST','DELETE'].includes(request.method))return this._json({error:'Method not allowed'},405);
    let p;try{p=await request.json();}catch(_){return this._json({error:'Invalid mail session JSON'},422);}
    const actor=p?.actor,account=String(p?.account||'').toLowerCase();
    if(!actor||typeof actor.email!=='string'||!['sales','operator','finance','admin'].includes(actor.role)||
       !sharedMailEmailAllowed(account)||!Array.isArray(p.allowedAccounts)||!p.allowedAccounts.includes(account))
      return this._json({error:'Mailbox not authorized'},403);
    const key=this._mailSessionKey(actor,account);
    if(request.method==='DELETE'){
      await this.state.storage.delete(key);
      return this._json({ok:true,account},200);
    }
    const password=String(p?.password||'');
    if(!password||password.length>512)return this._json({error:'Mailbox password required'},422);
    const probe=await this._mailPost(account,password,{action:'folders'});
    if(!probe.response)return this._json({error:probe.error||'Mail API unavailable'},503);
    let data;try{data=await probe.response.json();}catch(_){return this._json({error:'Mail API invalid response'},502);}
    if(!probe.response.ok||data?.error)return this._json({error:'Credenciales de correo inválidas o cuenta no disponible.'},401);
    const ttl=4*60*60*1000,expiresAt=Date.now()+ttl;
    await this.state.storage.put(key,{password,expiresAt,account,actorEmail:actor.email});
    return this._json({ok:true,account,expiresAt,build:data?.build||null},201);
  }
  async _handleMailRpc(request){
    if(request.method!=='POST')return this._json({error:'Method not allowed'},405);
    let p;try{p=await request.json();}catch(_){return this._json({error:'Invalid mail RPC JSON'},422);}
    const actor=p?.actor,account=String(p?.account||'').toLowerCase(),params=p?.params;
    if(!actor||typeof actor.email!=='string'||!['sales','operator','finance','admin'].includes(actor.role)||
       !sharedMailEmailAllowed(account)||!Array.isArray(p.allowedAccounts)||!p.allowedAccounts.includes(account)||
       !params||typeof params!=='object'||Array.isArray(params))
      return this._json({error:'Mail RPC denied'},403);
    const action=String(params.action||'');
    const allowed=new Set(['folders','list','snippets','read','search','attachment','sent_addrs',
      'mark','spam','trash','send','resend_status']);
    if(!allowed.has(action))return this._json({error:'Mail action denied'},403);
    const key=this._mailSessionKey(actor,account);
    const session=await this.state.storage.get(key);
    if(!session||typeof session.password!=='string'||Number(session.expiresAt||0)<=Date.now()){
      if(session)await this.state.storage.delete(key);
      return this._json({error:'MAIL_SESSION_REQUIRED',account},401);
    }
    const safe={...params};
    delete safe.user;delete safe.pass;
    const out=await this._mailPost(account,session.password,safe);
    if(!out.response)return this._json({error:out.error||'Mail API unavailable'},503);
    const text=await out.response.text();
    let body;try{body=JSON.parse(text);}catch(_){return this._json({error:'Mail API invalid response'},502);}
    if(action==='send'&&body?.ok){
      body.account=account;
    }
    return this._json(body,out.response.status||200);
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


  async _handleSocialLead(request){
    if(request.method!=='POST'||!this.env.AIRTABLE_TOKEN)
      return this._json({error:'Social lead guard unavailable'},503);
    let p;try{p=await request.json();}catch(_){return this._json({error:'Invalid social lead request'},422);}
    const actor=p?.actor;
    if(!actor||!(actor.role==='admin'||actor.email==='marketing@thelab.solutions')||
       typeof p.interactionId!=='string'||!/^rec[A-Za-z0-9]{14}$/.test(p.interactionId))
      return this._json({error:'Social lead denied'},403);
    const storageKey='social-lead:'+p.interactionId,prior=await this.state.storage.get(storageKey);
    if(prior?.ok)return this._json({...prior,replayed:true},200);
    const H={Authorization:'Bearer '+this.env.AIRTABLE_TOKEN,'Content-Type':'application/json'};
    const base=AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/';
    const getJson=async r=>{let d={};try{d=await r.json();}catch(_){}return d;};
    const ir=await fetch(base+encodeURIComponent('Social_Interactions')+'/'+p.interactionId,{headers:H,redirect:'manual'});
    if(!ir.ok)return this._json({error:'Social interaction unavailable'},ir.status===404?404:503);
    const inter=await getJson(ir),f=inter.fields||{};
    if(f['Lead creado']===true&&f['Cliente ID']){
      const done={ok:true,clienteId:String(f['Cliente ID']),queueId:String(f['Agent Queue ID']||''),interactionId:p.interactionId};
      await this.state.storage.put(storageKey,done);return this._json({...done,replayed:true},200);
    }
    const red=String(f.Red||'redes'),platformUser=String(f['Platform user ID']||'').trim();
    const identity=platformUser?(red+':'+platformUser).toLowerCase():'interaction:'+p.interactionId;
    const esc=v=>String(v||'').replace(/'/g,"\\'");
    const cq=new URLSearchParams({maxRecords:'1',filterByFormula:`LOWER({Social identity key} & "")=LOWER('${esc(identity)}')`});
    let cr=await fetch(base+encodeURIComponent('Clientes')+'?'+cq,{headers:H,redirect:'manual'});
    if(!cr.ok)return this._json({error:'Client identity lookup unavailable'},503);
    let cdata=await getJson(cr),clienteId=cdata.records?.[0]?.id||'';
    if(!clienteId){
      const body={fields:{Empresa:String(f.Usuario||'Lead redes sociales').slice(0,200),
        Contacto:String(f.Usuario||'Lead redes').slice(0,200),'Origen lead':'Redes sociales',
        Validado:false,'Social identity key':identity,
        'Notas internas':('Lead desde '+red+' ('+String(f.Tipo||'interacción')+'): '+String(f.Mensaje||'')).slice(0,90000)},
        typecast:true};
      cr=await fetch(base+encodeURIComponent('Clientes'),{method:'POST',headers:H,redirect:'manual',body:JSON.stringify(body)});
      if(!cr.ok)return this._json({error:'Client create failed'},503);
      clienteId=(await getJson(cr)).id||'';
    }
    const campaign='interaction:'+p.interactionId;
    const qq=new URLSearchParams({maxRecords:'1',filterByFormula:`AND({Evento}='social.lead_received',{Campaign}='${campaign}')`});
    let qr=await fetch(base+encodeURIComponent('Agent_Queue')+'?'+qq,{headers:H,redirect:'manual'});
    if(!qr.ok)return this._json({error:'Social queue lookup unavailable'},503);
    let qdata=await getJson(qr),queueId=qdata.records?.[0]?.id||'';
    if(!queueId){
      const qb={fields:{Evento:'social.lead_received',Entidad:'Cliente','ID entidad':clienteId,
        Agente:'LEAD_AGENT',Estado:'Pendiente',Prioridad:'Alta',Source:red.toLowerCase(),Campaign:campaign,
        'Input JSON':JSON.stringify({source:'redes',interactionId:p.interactionId,red,usuario:f.Usuario||'',mensaje:f.Mensaje||'',intencion:f['Intención']||''}),
        'Fecha creación':new Date().toISOString()},typecast:true};
      qr=await fetch(base+encodeURIComponent('Agent_Queue'),{method:'POST',headers:H,redirect:'manual',body:JSON.stringify(qb)});
      if(!qr.ok)return this._json({error:'Social queue create failed'},503);
      queueId=(await getJson(qr)).id||'';
    }
    const patch={fields:{'Lead creado':true,'Cliente ID':clienteId,'Agent Queue ID':queueId}};
    const pr=await fetch(base+encodeURIComponent('Social_Interactions')+'/'+p.interactionId,{
      method:'PATCH',headers:H,redirect:'manual',body:JSON.stringify(patch)});
    if(!pr.ok)return this._json({error:'Social interaction link uncertain',code:'SOCIAL_LEAD_LINK_UNCERTAIN'},503);
    const done={ok:true,clienteId,queueId,interactionId:p.interactionId};
    await this.state.storage.put(storageKey,done);
    return this._json({...done,replayed:false},201);
  }

  async _handleNewsletterSend(request){
    if(request.method!=='POST'||!this.env.AIRTABLE_TOKEN||!this.env.RESEND_API_KEY||
       !this.env.NEWSLETTER_SECRET||!this.env.NEWSLETTER_UNSUBSCRIBE_BASE)
      return this._json({error:'Newsletter transport unavailable'},503);
    let p;try{p=await request.json();}catch(_){return this._json({error:'Invalid newsletter send request'},422);}
    if(!p?.actor||p.actor.role!=='admin'||
       typeof p.campaignId!=='string'||!/^rec[A-Za-z0-9]{14}$/.test(p.campaignId))
      return this._json({error:'Newsletter send denied'},403);
    const lockKey='newsletter-lock:'+p.campaignId,now=Date.now(),lease=await this.state.storage.get(lockKey);
    if(lease&&Number(lease)>now)return this._json({error:'Newsletter campaign already sending',code:'NEWSLETTER_LOCKED'},409);
    await this.state.storage.put(lockKey,now+10*60*1000);
    const H={Authorization:'Bearer '+this.env.AIRTABLE_TOKEN,Accept:'application/json'};
    const j=async r=>{let d={};try{d=await r.json();}catch(_){}return d;};
    try{
      const base=AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/';
      const campRes=await fetch(base+encodeURIComponent('Newsletter_Campañas')+'/'+p.campaignId,{headers:H,redirect:'manual'});
      if(!campRes.ok)return this._json({error:'Campaign unavailable'},campRes.status===404?404:503);
      const camp=await j(campRes),f=camp.fields||{},notes=String(f.Notas||'');
      const match=notes.match(/(?:^|\n)\[AUDIENCIA NEWSLETTER\]\s*(\{[^\n]*\})/);
      let snapshot;try{snapshot=match?JSON.parse(match[1]):null;}catch(_){}
      if(!snapshot||snapshot.version!==1||!Array.isArray(snapshot.approved)||snapshot.approved.length<1||snapshot.approved.length>500)
        return this._json({error:'Campaign has no approved audience snapshot',code:'AUDIENCE_NOT_APPROVED'},409);
      const scheduleMatch=notes.match(/(?:^|\n)\[PROGRAMACION NEWSLETTER\]\s*(\{[^\n]*\})/);
      let schedule;try{schedule=scheduleMatch?JSON.parse(scheduleMatch[1]):null;}catch(_){}
      if(schedule){
        if(schedule.zone!=='America/Santiago'||typeof schedule.local!=='string'||
           !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.local))
          return this._json({error:'Invalid newsletter schedule',code:'NEWSLETTER_SCHEDULE_INVALID'},422);
        const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',
          day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
        const val=t=>parts.find(x=>x.type===t)?.value||'';
        const localNow=val('year')+'-'+val('month')+'-'+val('day')+'T'+val('hour')+':'+val('minute');
        if(localNow<schedule.local)return this._json({error:'Newsletter campaign is not due yet',
          code:'NEWSLETTER_NOT_DUE',scheduled_local:schedule.local,zone:schedule.zone},409);
      }
      const subject=String(f.Asunto||f.Campaña||'Newsletter').slice(0,200);
      const baseHtml=String(f['Cuerpo HTML']||'');
      if(!baseHtml||baseHtml.length>100000)return this._json({error:'Campaign HTML missing or too large'},422);

      let allEnvios=[],offset='';
      do{
        const q=new URLSearchParams({pageSize:'100'});
        for(const fld of ['Envío','Campaña','Cliente','Email','Estado','Notas'])q.append('fields[]',fld);
        if(offset)q.set('offset',offset);
        const rr=await fetch(base+encodeURIComponent('Newsletter_Envios')+'?'+q,{headers:H,redirect:'manual'});
        if(!rr.ok)return this._json({error:'Newsletter send ledger unavailable'},503);
        const dd=await j(rr);allEnvios.push(...(dd.records||[]));offset=dd.offset||'';
      }while(offset&&allEnvios.length<2000);

      const terminal=new Set(['Enviado','Entregado','Abierto','Click']);
      const suppressedStates=new Set(['Rebote','Baja','Spam']);
      const suppressedEmails=new Set(allEnvios.filter(r=>suppressedStates.has(r.fields?.Estado))
        .map(r=>String(r.fields?.Email||'').trim().toLowerCase()).filter(Boolean));
      let sent=0,skipped=0,failed=0,suppressed=0;
      const results=[];
      for(const item of snapshot.approved){
        const clientId=String(item?.id||''),approvedEmail=String(item?.email||'').trim().toLowerCase();
        if(!/^rec[A-Za-z0-9]{14}$/.test(clientId)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(approvedEmail)){
          failed++;results.push({email:approvedEmail,status:'invalid-approved-entry'});continue;
        }
        const cr=await fetch(base+encodeURIComponent('Clientes')+'/'+clientId+'?'+new URLSearchParams([
          ['fields[]','Email'],['fields[]','Suscrito newsletter'],['fields[]','Baja newsletter'],
          ['fields[]','Email válido'],['fields[]','Industria / Rubro']
        ]),{headers:H,redirect:'manual'});
        if(!cr.ok){failed++;results.push({email:approvedEmail,status:'client-unavailable'});continue;}
        const client=await j(cr),cf=client.fields||{},email=String(cf.Email||'').trim().toLowerCase();
        if(email!==approvedEmail||cf['Suscrito newsletter']!==true||cf['Baja newsletter']===true||
           cf['Email válido']!==true||suppressedEmails.has(email)){
          suppressed++;results.push({email:approvedEmail,status:'suppressed'});continue;
        }
        const key=p.campaignId+'_'+clientId;
        let envio=allEnvios.find(r=>String(r.fields?.['Envío']||'')===key);
        if(envio&&terminal.has(envio.fields?.Estado)){skipped++;results.push({email,status:'already-sent',id:envio.id});continue;}
        if(!envio){
          const create=await fetch(base+encodeURIComponent('Newsletter_Envios'),{
            method:'POST',headers:{...H,'Content-Type':'application/json'},redirect:'manual',
            body:JSON.stringify({fields:{'Envío':key,'Campaña':[p.campaignId],'Cliente':[clientId],
              'Email':email,'Rubro':String(cf['Industria / Rubro']||''),'Notas':'Reservado por transporte autoritativo'}})
          });
          if(!create.ok){failed++;results.push({email,status:'reserve-failed'});continue;}
          envio=await j(create);allEnvios.push(envio);
        }
        const enc=new TextEncoder(),secret=enc.encode(String(this.env.NEWSLETTER_SECRET));
        const hk=await crypto.subtle.importKey('raw',secret,{name:'HMAC',hash:'SHA-256'},false,['sign']);
        const sig=new Uint8Array(await crypto.subtle.sign('HMAC',hk,enc.encode('unsubscribe:'+email)));
        let token='';for(const b of sig)token+=String.fromCharCode(b);
        token=btoa(token).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
        const unsub=String(this.env.NEWSLETTER_UNSUBSCRIBE_BASE).replace(/\/$/,'')+
          '/newsletter/unsubscribe?e='+encodeURIComponent(email)+'&t='+encodeURIComponent(token);
        let html=baseHtml.replace(/mailto:hola@thelab\.solutions\?subject=BAJA%20newsletter/gi,unsub);
        if(html===baseHtml)html=baseHtml.replace(/<\/body>/i,
          '<p style="font-size:11px"><a href="'+unsub+'">Darme de baja</a></p></body>');
        const payload={from:String(this.env.RESEND_FROM||'The Lab Solutions <hola@thelab.solutions>'),
          to:[email],subject,html,
          headers:{'List-Unsubscribe':'<'+unsub+'>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'},
          tags:[{name:'envio_id',value:String(envio.id)},{name:'campaign_id',value:p.campaignId}]};
        let rr;
        try{rr=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'manual',
          headers:{Authorization:'Bearer '+this.env.RESEND_API_KEY,'Content-Type':'application/json',
            'Idempotency-Key':'newsletter/'+envio.id},
          body:JSON.stringify(payload)});}
        catch(_){
          failed++;await fetch(base+encodeURIComponent('Newsletter_Envios')+'/'+envio.id,{
            method:'PATCH',headers:{...H,'Content-Type':'application/json'},body:JSON.stringify({fields:{
              'Notas':'PENDING_RECONCILIATION · idempotency newsletter/'+envio.id}})}).catch(()=>{});
          results.push({email,status:'uncertain',id:envio.id});continue;
        }
        const rd=await j(rr);
        if(!rr.ok){
          failed++;await fetch(base+encodeURIComponent('Newsletter_Envios')+'/'+envio.id,{
            method:'PATCH',headers:{...H,'Content-Type':'application/json'},body:JSON.stringify({fields:{
              'Notas':('ERROR Resend '+rr.status+' '+String(rd?.message||rd?.error||'')).slice(0,900)}})}).catch(()=>{});
          results.push({email,status:'rejected',id:envio.id});continue;
        }
        const patch={Estado:'Enviado','Fecha envío':new Date().toISOString(),
          'Notas':('resend_id='+String(rd?.id||'')+' · idempotency=newsletter/'+envio.id).slice(0,900)};
        const pr=await fetch(base+encodeURIComponent('Newsletter_Envios')+'/'+envio.id,{
          method:'PATCH',headers:{...H,'Content-Type':'application/json'},redirect:'manual',
          body:JSON.stringify({fields:patch})});
        if(!pr.ok){failed++;results.push({email,status:'sent-ledger-uncertain',id:envio.id});continue;}
        sent++;results.push({email,status:'sent',id:envio.id,resendId:String(rd?.id||'')});
      }
      const finalState=(failed||suppressed)?'Pausada':'Enviada';
      const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      const campaignPatch={'Estado':finalState,'Enviados':sent+skipped,'Fecha envío':f['Fecha envío']||day,
        'Notas':(notes+'\n[TRANSPORTE NEWSLETTER] '+JSON.stringify({at:new Date().toISOString(),sent,skipped,failed,suppressed})).slice(-95000)};
      const cp=await fetch(base+encodeURIComponent('Newsletter_Campañas')+'/'+p.campaignId,{
        method:'PATCH',headers:{...H,'Content-Type':'application/json'},redirect:'manual',
        body:JSON.stringify({fields:campaignPatch})});
      if(!cp.ok)return this._json({error:'Emails processed but campaign close is uncertain',
        code:'NEWSLETTER_CLOSE_UNCERTAIN',sent,skipped,failed,suppressed,results},503);
      return this._json({ok:failed===0&&suppressed===0,state:finalState,sent,skipped,failed,suppressed,results},
        failed||suppressed?207:200);
    }finally{await this.state.storage.delete(lockKey);}
  }

  async _handleVisualAiGuard(request){
    if(request.method!=='POST')return this._json({error:'Method not allowed'},405);
    let p;try{p=await request.json();}catch(_){return this._json({error:'Invalid visual job'},422);}
    if(!visualAiActorAllowed(p?.actor))
      return this._json({error:'Visual job denied'},403);
    const max=Math.max(1,Math.min(200,Number(this.env.VISUAL_AI_DAILY_LIMIT)||VISUAL_AI_MAX_GENERATIONS_PER_DAY));
    if(p.op==='quota'){
      const day=aiChileDate(),count=Math.max(0,Number(await this.state.storage.get('visual-count:'+day))||0);
      return this._json({ok:true,used:count,limit:max,remaining:Math.max(0,max-count)},200);
    }
    if(typeof p.jobId!=='string'||!/^[A-Za-z0-9_-]{10,100}$/.test(p.jobId))
      return this._json({error:'Visual job denied'},403);
    const key='visual-job:'+p.jobId;
    if(p.op==='reserve'){
      if(!VISUAL_AI_ALLOWED_ENDPOINTS.has(p.endpoint))return this._json({error:'Visual model denied'},422);
      const existing=await this.state.storage.get(key);
      if(existing?.committed&&existing.response)return this._json({ok:true,replayed:true,response:existing.response},200);
      if(existing)return this._json({error:'Visual job result uncertain; do not duplicate',code:'VISUAL_JOB_PENDING'},409);
      const day=aiChileDate(),counterKey='visual-count:'+day;
      const count=Math.max(0,Number(await this.state.storage.get(counterKey))||0);
      if(count>=max)return this._json({error:'Visual AI daily quota reached',code:'VISUAL_AI_QUOTA',used:count,limit:max},429);
      await this.state.storage.put(key,{endpoint:p.endpoint,actor:p.actor.email,createdAt:Date.now(),committed:false});
      await this.state.storage.put(counterKey,count+1);
      return this._json({ok:true,replayed:false,used:count+1,limit:max},200);
    }
    if(p.op==='commit'){
      const row=await this.state.storage.get(key);
      if(!row)return this._json({error:'Visual job reservation missing'},409);
      if(row.committed)return this._json({ok:true,replayed:true,response:row.response},200);
      if(!p.response||typeof p.response.request_id!=='string'||p.response.request_id.length>240)
        return this._json({error:'Invalid provider receipt'},422);
      row.committed=true;row.response={request_id:p.response.request_id};row.committedAt=Date.now();
      await this.state.storage.put(key,row);
      return this._json({ok:true,response:row.response},200);
    }
    if(p.op==='release'){
      await this.state.storage.delete(key);
      return this._json({ok:true},200);
    }
    return this._json({error:'Unknown visual guard operation'},404);
  }

  async _handleSharedRemunerations(request){
    if(request.method!=='POST'||!this.env.AIRTABLE_TOKEN)
      return this._json({error:'Shared remunerations guard unavailable'},503);
    let payload;try{payload=await request.json();}catch(_){
      return this._json({error:'Invalid shared remunerations request'},422);
    }
    const actor=payload?.actor;
    if(!actor||typeof actor.email!=='string'||!['finance','admin'].includes(actor.role)||
       !sharedRemDocumentAllowed(payload?.data)||typeof payload.expectedRevision!=='string'||
       !/^[a-f0-9]{64}$/.test(payload.expectedRevision))
      return this._json({error:'Shared remunerations write denied'},403);
    const current=await sharedRemLoad(this.env);
    if(current.error)return this._json({error:'Shared remunerations unavailable'},503);
    if(current.revision!==payload.expectedRevision)
      return this._json({error:'Remunerations changed on another device',
        code:'REMUNERATIONS_REVISION_CONFLICT',revision:current.revision,data:current.data},409);
    if(!sharedRemPeriodsTransitionAllowed(current.data,payload.data,actor))
      return this._json({error:'Invalid remuneration period transition',
        code:'REMUNERATIONS_TRANSITION_DENIED'},409);
    if(!sharedRemClosedTotalsValid(payload.data))
      return this._json({error:'Closed remuneration snapshot does not reconcile',
        code:'REMUNERATIONS_SNAPSHOT_MISMATCH'},409);
    if(!sharedRemProtected(current.data,payload.data,actor))
      return this._json({error:'Closed remuneration period is immutable',
        code:'REMUNERATIONS_PERIOD_LOCKED'},409);
    const transition=sharedRemAction(current.data,payload.data);
    const next=structuredClone(payload.data);
    next.updatedAt=Date.now();
    next.audit=[...(current.data.audit||[]),{
      id:'rem-audit-'+crypto.randomUUID(),at:new Date().toISOString(),actor:actor.email,role:actor.role,
      action:transition.action,period:transition.period,detail:'Cambio serializado por proxy'
    }].slice(-600);
    if(!sharedRemDocumentAllowed(next))return this._json({error:'Remunerations document invalid after audit'},422);
    const raw=JSON.stringify(next),target=AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+encodeURIComponent('Monitor Sistema')+
      (current.recordId?'/'+current.recordId:'');
    let upstream;
    try{upstream=await fetch(target,{method:current.recordId?'PATCH':'POST',redirect:'manual',
      headers:{Authorization:'Bearer '+this.env.AIRTABLE_TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify({fields:{Name:SHARED_REM_NAME,Notes:raw}})});
    }catch(_){return this._json({error:'Remunerations write outcome uncertain; reread before retrying',
      code:'REMUNERATIONS_WRITE_UNCERTAIN'},503);}
    if([400,401,403,404,422].includes(upstream.status))
      return this._json({error:'Remunerations write rejected',code:'REMUNERATIONS_WRITE_REJECTED'},422);
    if(!upstream.ok||upstream.status>=300&&upstream.status<400)
      return this._json({error:'Remunerations write outcome uncertain; reread before retrying',
        code:'REMUNERATIONS_WRITE_UNCERTAIN'},503);
    const verified=await sharedRemLoad(this.env);
    if(verified.error||verified.raw!==raw)
      return this._json({error:'Remunerations verification uncertain; reread before retrying',
        code:'REMUNERATIONS_WRITE_UNCERTAIN'},503);
    return this._json({ok:true,exists:true,revision:verified.revision,data:verified.data},200);
  }

  async _handleSharedFinance(request){
    if(request.method!=='POST'||!this.env.AIRTABLE_TOKEN)
      return this._json({error:'Shared finance guard unavailable'},503);
    let payload;try{payload=await request.json();}catch(_){
      return this._json({error:'Invalid shared finance request'},422);
    }
    if(!sharedFinanceActorAllowed(payload?.actor)||!sharedFinanceDocumentAllowed(payload?.data)||
       typeof payload.expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(payload.expectedRevision))
      return this._json({error:'Shared finance write denied'},403);
    const current=await sharedFinanceLoad(this.env);
    if(current.error)return this._json({error:'Shared finance unavailable'},503);
    if(current.revision!==payload.expectedRevision)
      return this._json({error:'Finance data changed on another device',
        code:'FINANCE_REVISION_CONFLICT',revision:current.revision,data:current.data},409);
    const raw=JSON.stringify(payload.data);
    const target=AIRTABLE_BASE+'/v0/app1YtD74AqiPWQhy/'+encodeURIComponent('Monitor Sistema')+
      (current.recordId?'/'+current.recordId:'');
    let upstream;
    try{
      upstream=await fetch(target,{method:current.recordId?'PATCH':'POST',redirect:'manual',
        headers:{Authorization:'Bearer '+this.env.AIRTABLE_TOKEN,'Content-Type':'application/json'},
        body:JSON.stringify({fields:{Name:SHARED_FINANCE_NAME,Notes:raw}})});
    }catch(_){return this._json({error:'Finance write outcome uncertain; reread before retrying',
      code:'FINANCE_WRITE_UNCERTAIN'},503);}
    if([400,401,403,404,422].includes(upstream.status))
      return this._json({error:'Finance write rejected',code:'FINANCE_WRITE_REJECTED'},422);
    if(!upstream.ok||upstream.status>=300&&upstream.status<400)
      return this._json({error:'Finance write outcome uncertain; reread before retrying',
        code:'FINANCE_WRITE_UNCERTAIN'},503);
    const verified=await sharedFinanceLoad(this.env);
    if(verified.error||verified.raw!==raw)
      return this._json({error:'Finance write verification uncertain; reread before retrying',
        code:'FINANCE_WRITE_UNCERTAIN'},503);
    return this._json({ok:true,revision:verified.revision,data:verified.data},200);
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
        const rows=path===root?payload.records:[{
          id:path.slice(root.length+1),fields:payload.fields
        }];
        const relation=await operatorCrmRelationPreflight(table,rows,this.env,{creating:false});
        if(!relation.ok)return this._json({
          error:relation.error,code:relation.code
        },relation.status);
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
    if(data?.actor?.role==='operator'&&['Pedidos','Cotizaciones'].includes(table)){
      const relation=await operatorCrmRelationPreflight(table,[{fields:data.body.fields}],
        this.env,{creating:true});
      if(!relation.ok)return this._json({
        error:relation.error,code:relation.code
      },relation.status);
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


const OFFICE_BASE_ID='app1YtD74AqiPWQhy';
const OFFICE_TZ='America/Santiago';
const OFFICE_AUTOMATION_EXPECT=Object.freeze({
  'lead-worker':90,'airtable-proxy':45,'printer-bridge':15,'mail-api':30,'sii-worker':360,
  'social-listen':30,'social-metrics':180,'social-publish':30
});
function officeHeaders(env){return{Authorization:'Bearer '+env.AIRTABLE_TOKEN,Accept:'application/json','Content-Type':'application/json'};}
function officeEsc(v){return String(v??'').replace(/'/g,"\\'");}
function officeDateCL(d=new Date()){
  return new Intl.DateTimeFormat('en-CA',{timeZone:OFFICE_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
}
async function officeJson(r){let d={};try{d=await r.json();}catch(_){}return d;}
async function officeList(env,table,{fields=[],formula='',max=8000}={}){
  const out=[];let offset='';
  do{
    const q=new URLSearchParams({pageSize:'100'});
    for(const x of fields)q.append('fields[]',x);
    if(formula)q.set('filterByFormula',formula);
    if(offset)q.set('offset',offset);
    const r=await fetch(AIRTABLE_BASE+'/v0/'+OFFICE_BASE_ID+'/'+encodeURIComponent(table)+'?'+q,{
      headers:officeHeaders(env),redirect:'manual'});
    if(!r.ok)throw new Error(table+' '+r.status);
    const d=await officeJson(r);
    if(!Array.isArray(d.records))throw new Error(table+' payload invalid');
    out.push(...d.records);offset=String(d.offset||'');
    if(out.length>=max&&offset)throw new Error(table+' coverage incomplete');
  }while(offset);
  return out;
}
async function officeFind(env,table,formula,fields=[]){
  const rows=await officeList(env,table,{formula,fields,max:100});
  return rows[0]||null;
}
async function officeCreate(env,table,fields){
  const r=await fetch(AIRTABLE_BASE+'/v0/'+OFFICE_BASE_ID+'/'+encodeURIComponent(table),{
    method:'POST',headers:officeHeaders(env),redirect:'manual',body:JSON.stringify({fields,typecast:true})});
  if(!r.ok)throw new Error(table+' create '+r.status);
  return officeJson(r);
}
async function officePatch(env,table,id,fields){
  const r=await fetch(AIRTABLE_BASE+'/v0/'+OFFICE_BASE_ID+'/'+encodeURIComponent(table)+'/'+id,{
    method:'PATCH',headers:officeHeaders(env),redirect:'manual',body:JSON.stringify({fields,typecast:true})});
  if(!r.ok)throw new Error(table+' patch '+r.status);
  return officeJson(r);
}
function officeMaskText(value){
  let x=String(value||'').slice(0,300);
  x=x.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]');
  x=x.replace(/\b(?:\+?56\s*)?9(?:[\s.-]*\d){8}\b/g,'[tel]');
  x=x.replace(/\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g,'[rut]');
  x=x.replace(/\b(?:CLP|US\$|\$)\s?[\d.]+(?:,\d+)?\b/gi,'[monto]');
  return x;
}
function officeSensitivity(agent,input){
  const s=(String(agent)+' '+String(input)).toLowerCase();
  if(/finance|finanza|remuner|sueldo|factur|sii|banco|rut|payroll/.test(s))return 'restricted';
  if(/cliente|correo|email|tel[eé]fono|lead|crm/.test(s))return 'sensitive';
  return 'internal';
}
function officeRunForRole(rec,identity){
  const f=rec.fields||{},admin=identity?.role==='admin';
  const state=String(f['Estado ejecución']||'completed').toLowerCase();
  const sens=String(f['Sensibilidad']||officeSensitivity(f.Agente,f.Consulta));
  const input=String(f.Consulta||''),output=String(f.Resultado||'');
  const canFull=admin;
  return {
    id:rec.id,executionId:String(f['Execution ID']||rec.id),agent:String(f.Agente||''),
    input:canFull?input:officeMaskText(input),output:canFull?output:officeMaskText(output),
    contentRestricted:!canFull,sensitivity:sens,user:canFull?String(f.Usuario||''):'',
    owner:canFull?String(f.Propietario||''):'',
    startedAt:String(f['Started At']||f.Fecha||rec.createdTime||''),
    heartbeatAt:String(f['Heartbeat At']||''),finishedAt:String(f['Finished At']||''),
    time:String(f.Fecha||f['Finished At']||f['Started At']||rec.createdTime||''),
    state,error:canFull?String(f['Error ejecución']||''):String(f['Error ejecución']?'Error registrado':''),
    source:String(f['Fuente ejecución']||'dashboard')
  };
}
function officeAutomationState(f,id){
  if(!f)return{state:'unknown',label:'Sin telemetría',age_ms:null};
  const last=Date.parse(f.UltimaEjecucion||'')||0,age=last?Date.now()-last:null;
  const raw=String(f['Heartbeat estado']||f.Estado||'').toLowerCase();
  if(/paus|repos/.test(raw))return{state:'paused',label:'Pausado',age_ms:age};
  if(/error|fall|down|ca[ií]d/.test(raw))return{state:'down',label:'Caído',age_ms:age};
  if(!last)return{state:'unknown',label:'Sin telemetría',age_ms:null};
  const exp=(OFFICE_AUTOMATION_EXPECT[id]||60)*60000;
  if(age>Math.max(exp*3,24*3600000))return{state:'down',label:'Sin señal',age_ms:age};
  if(age>exp)return{state:'degraded',label:'Atrasado',age_ms:age};
  return{state:'healthy',label:'Operativo',age_ms:age};
}
async function officeAudit(env,identity,action,entity,executionId,detail=''){
  return officeCreate(env,'Oficina_Auditoria',{
    Evento:action+' · '+(entity||'Oficina'),Usuario:identity.email,Rol:identity.role,
    'Acción':action,Entidad:String(entity||''),'Execution ID':String(executionId||''),
    Fecha:new Date().toISOString(),Detalle:String(detail||'').slice(0,5000)
  });
}
async function officeIncident(env,{key,title,source,entityId,severity='Alta',detail='',responsible='Operaciones',slaHours=4},healthy=false){
  const found=await officeFind(env,'Incidencias_Operativas',`{Clave}='${officeEsc(key)}'`);
  if(healthy){
    if(found&&found.fields?.Estado!=='Resuelta')await officePatch(env,'Incidencias_Operativas',found.id,{
      Estado:'Resuelta',Resuelta:new Date().toISOString(),Detalle:String(detail||'Recuperado').slice(0,9000)});
    return;
  }
  if(found&&found.fields?.Estado!=='Resuelta'){
    await officePatch(env,'Incidencias_Operativas',found.id,{Detalle:String(detail).slice(0,9000),Severidad:severity});
    return;
  }
  const sla=new Date(Date.now()+slaHours*3600000).toISOString();
  await officeCreate(env,'Incidencias_Operativas',{
    Incidencia:title,Clave:key,Fuente:source,'Entidad ID':entityId,Severidad:severity,Estado:'Abierta',
    Responsable:responsible,SLA:sla,Abierta:new Date().toISOString(),Detalle:String(detail).slice(0,9000)
  });
}
async function officeSnapshot(env,identity){
  const fetchedAt=new Date().toISOString(),source={};
  const load=async(name,fn)=>{const t=Date.now();try{const v=await fn();source[name]={ok:true,at:new Date().toISOString(),latency_ms:Date.now()-t};return v;}
    catch(e){source[name]={ok:false,at:new Date().toISOString(),latency_ms:Date.now()-t,error:String(e.message||e).slice(0,200)};return null;}};
  const [logs,queue,autos,machines,inventory,incidents]=await Promise.all([
    load('agent_log',()=>officeList(env,'Agent_Log',{fields:['Agente','Consulta','Resultado','Usuario','Fecha','Execution ID','Started At','Heartbeat At','Finished At','Estado ejecución','Error ejecución','Sensibilidad','Propietario','Fuente ejecución','Retener hasta']})),
    load('agent_queue',()=>officeList(env,'Agent_Queue',{fields:['Estado','Prioridad','Agente','Fecha creación'],formula:"{Estado}='Pendiente'"})),
    load('automations',()=>officeList(env,'Automations',{fields:['Nombre','ID','Tipo','Estado','TareaActual','UltimaEjecucion','EjecucionesHoy','Periodo ejecuciones','Zona horaria','Heartbeat estado','Error último'],max:500})),
    load('machines',()=>officeList(env,'Maquinas',{fields:['id','nombre','num','numG','modelo','color','estado','cam','Ultima telemetria','Estado telemetria'],max:500})),
    load('inventory',()=>officeList(env,'Inventario',{max:2000})),
    load('incidents',()=>officeList(env,'Incidencias_Operativas',{formula:"OR({Estado}='Abierta',{Estado}='Reconocida')",max:1000}))
  ]);
  const cutoff=Date.now()-31*24*3600000;
  const liveRuns=(logs||[]).filter(r=>{
    const f=r.fields||{},t=Date.parse(f['Started At']||f.Fecha||r.createdTime||'')||0;
    const until=Date.parse(f['Retener hasta']||'')||Infinity;
    return t>=cutoff&&until>Date.now();
  }).map(r=>officeRunForRole(r,identity)).sort((a,b)=>Date.parse(b.time||0)-Date.parse(a.time||0));
  const seen=new Set(),runs=[];
  for(const r of liveRuns){const k=r.executionId||r.id;if(seen.has(k))continue;seen.add(k);runs.push(r);}
  const auto=(autos||[]).map(r=>{const f=r.fields||{},id=String(f.ID||f.Nombre||'').toLowerCase();
    return{id,name:String(f.Nombre||id),type:String(f.Tipo||''),task:String(f.TareaActual||''),last:String(f.UltimaEjecucion||''),
      today:Number(f.EjecucionesHoy||0),period:String(f['Periodo ejecuciones']||''),zone:String(f['Zona horaria']||''),
      ...officeAutomationState(f,id)};});
  const today=officeDateCL();
  for(const a of auto){if(a.today&&(a.period!==today||a.zone!==OFFICE_TZ))a.today_verified=false;else a.today_verified=true;}
  const printers=(machines||[]).map(r=>{const f=r.fields||{},last=String(f['Ultima telemetria']||''),age=Date.now()-(Date.parse(last)||0);
    const telemetry=last?(age<=5*60000?'healthy':age<=20*60000?'degraded':'down'):'unknown';
    return{id:String(f.id||r.id),name:String(f.nombre||''),num:Number(f.numG||f.num||0),model:String(f.modelo||''),state:String(f.estado||''),
      telemetry,lastTelemetry:last,cam:!!f.cam};});
  const healthRequired=['agent_log','agent_queue','automations','machines','inventory'];
  const sourceBad=healthRequired.filter(k=>!source[k]?.ok);
  const autoBad=auto.filter(a=>!['healthy','paused'].includes(a.state));
  const printerBad=printers.filter(p=>['down','unknown'].includes(p.telemetry));
  const health=sourceBad.length||autoBad.length||printerBad.length?'degraded':'healthy';
  const coverage={complete30d:!!source.agent_log?.ok,from:new Date(cutoff).toISOString(),to:fetchedAt,
    run_count:runs.length,pending_queue_count:(queue||[]).length};
  return {ok:true,fetchedAt,zone:OFFICE_TZ,identity:{role:identity.role,email:identity.email},
    source,coverage,health,runs,queue:{pending_count:(queue||[]).length},automations:auto,printers,
    inventory:(inventory||[]).map(r=>({id:r.id,fields:r.fields||{}})),incidents:(incidents||[]).map(r=>({id:r.id,fields:r.fields||{}}))};
}
async function officeHandleExecution(request,env,identity){
  let p;try{p=await request.json();}catch(_){return{status:422,body:{error:'Invalid execution JSON'}};}
  const action=String(p?.action||''),executionId=String(p?.executionId||'');
  if(!['start','heartbeat','finish','error'].includes(action)||!/^[A-Za-z0-9_-]{12,100}$/.test(executionId))
    return{status:422,body:{error:'Invalid execution lifecycle'}};
  const formula=`{Execution ID}='${officeEsc(executionId)}'`;
  let row=await officeFind(env,'Agent_Log',formula);
  const now=new Date().toISOString();
  if(action==='start'){
    if(row)return{status:200,body:{ok:true,replayed:true,id:row.id,executionId}};
    const agent=String(p.agent||'').slice(0,150),input=String(p.input||'').slice(0,5000);
    if(!agent)return{status:422,body:{error:'Agent required'}};
    const sensitivity=officeSensitivity(agent,input);
    row=await officeCreate(env,'Agent_Log',{Agente:agent,Consulta:input,Resultado:'',Usuario:identity.email,Fecha:now,
      'Execution ID':executionId,'Started At':now,'Heartbeat At':now,'Estado ejecución':'running',
      Sensibilidad:sensitivity,Propietario:identity.email,'Fuente ejecución':String(p.source||'dashboard').slice(0,120),
      'Retener hasta':new Date(Date.now()+31*24*3600000).toISOString()});
    return{status:201,body:{ok:true,replayed:false,id:row.id,executionId}};
  }
  if(!row)return{status:409,body:{error:'Execution was not started',code:'OFFICE_EXECUTION_MISSING'}};
  if(action==='heartbeat'){
    if(String(row.fields?.['Estado ejecución']||'')!=='running')return{status:200,body:{ok:true,replayed:true,id:row.id,executionId}};
    await officePatch(env,'Agent_Log',row.id,{'Heartbeat At':now});
    return{status:200,body:{ok:true,id:row.id,executionId}};
  }
  const completed=String(row.fields?.['Estado ejecución']||'');
  if(['completed','error','cancelled'].includes(completed))return{status:200,body:{ok:true,replayed:true,id:row.id,executionId,state:completed}};
  const fields={'Heartbeat At':now,'Finished At':now,'Estado ejecución':action==='finish'?'completed':'error'};
  if(action==='finish'){
    fields.Resultado=String(p.output||'').slice(0,95000);fields.Fecha=now;
  }else fields['Error ejecución']=String(p.error||'Error no especificado').slice(0,9000);
  await officePatch(env,'Agent_Log',row.id,fields);
  return{status:200,body:{ok:true,id:row.id,executionId,state:fields['Estado ejecución']}};
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
    const visualServiceRoute=url.pathname==='/visual-ai/rpc';
    if (leadServiceRoute && url.search)
      return json({error:'Lead service query parameters not allowed'},400,CORS);
    if (!leadServiceRoute && !ALLOWED_ORIGINS.includes(origin)) {
      return json({ error: 'Forbidden origin' }, 403, CORS);
    }

    // Auth — la passphrase nunca sale al cliente como un token de servicio real
    const appKey = request.headers.get('X-App-Key');
    // Visual AI standalone (GitHub Pages) authenticates exclusively with signed
    // Cloudflare Access identity; it never receives the shared APP_KEY.
    if (!leadServiceRoute && !visualServiceRoute && (!appKey || appKey !== env.APP_KEY)) {
      return json({ error: 'Unauthorized' }, 403, CORS);
    }
    // After configuration, the shared app key is only a compatibility check.
    // Cloudflare Access signs each user's identity, and role decisions happen
    // on the server; a forged Origin or copied APP_KEY cannot grant rights.
    const authorized=await accessAuthorize(request,env,
      leadServiceRoute?'/service/lead/anthropic/v1/messages':
      url.pathname.startsWith('/v0/')||url.pathname.startsWith('/anthropic/')||
      url.pathname.startsWith('/openai/')||url.pathname.startsWith('/seo-')||url.pathname.startsWith('/sii/')||url.pathname.startsWith('/portal-admin/')||url.pathname==='/feedback/link'||url.pathname.startsWith('/printer/')||url.pathname.startsWith('/marketing/')||url.pathname.startsWith('/ads/')||url.pathname==='/integrations/check'||url.pathname==='/shared/calendar'||url.pathname==='/shared/agenda'||url.pathname==='/shared/mail'||url.pathname==='/mail/accounts'||url.pathname==='/mail/session'||url.pathname==='/mail/rpc'||url.pathname==='/shared/problems'||url.pathname==='/shared/machineops'||url.pathname==='/shared/simulation'||url.pathname==='/shared/finance'||url.pathname==='/shared/remunerations'||url.pathname==='/shared/remunerations/audit'||url.pathname==='/visual-ai/rpc'||url.pathname==='/newsletter/send'||url.pathname==='/social/lead'||url.pathname.startsWith('/office/')||url.pathname==='/access/me'
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

    if(url.pathname==='/office/snapshot'){
      const headers={...CORS,'Cache-Control':'private, no-store'};
      if(request.method!=='GET')return json({error:'Method not allowed'},405,headers);
      if(!authorized.identity||!env.AIRTABLE_TOKEN)return json({error:'Office snapshot unavailable'},503,headers);
      try{
        const snap=await officeSnapshot(env,authorized.identity);
        // Important unknown/down states become durable incidents. Recovery closes them.
        for(const a of snap.automations||[]){
          const bad=['unknown','degraded','down'].includes(a.state);
          try{await officeIncident(env,{key:'automation:'+a.id,title:'Automatización '+a.name+' '+a.label,
            source:'Automations',entityId:a.id,severity:a.state==='down'?'Crítica':'Alta',
            detail:a.label+' · última señal '+(a.last||'sin telemetría'),responsible:'Operaciones',
            slaHours:a.state==='down'?2:4},!bad);}catch(_){}
        }
        for(const p of snap.printers||[]){
          const bad=['unknown','down'].includes(p.telemetry);
          try{await officeIncident(env,{key:'printer:'+p.id,title:'Impresora '+(p.name||p.id)+' sin telemetría',
            source:'Maquinas',entityId:p.id,severity:p.telemetry==='down'?'Alta':'Media',
            detail:'Estado de telemetría: '+p.telemetry+' · '+(p.lastTelemetry||'sin señal'),
            responsible:'Taller',slaHours:4},!bad);}catch(_){}
        }
        for(const [name,src] of Object.entries(snap.source||{})){
          const bad=!src.ok;
          try{await officeIncident(env,{key:'office-source:'+name,title:'Fuente Oficina no disponible: '+name,
            source:name,entityId:name,severity:'Alta',detail:src.error||'Fuente sin respuesta',
            responsible:'Sistemas',slaHours:2},!bad);}catch(_){}
        }
        return json(snap,200,headers);
      }catch(e){return json({error:'Office snapshot failed',detail:String(e?.message||e).slice(0,300)},503,headers);}
    }
    if(url.pathname==='/office/execution'){
      const headers={...CORS,'Cache-Control':'private, no-store'};
      if(request.method!=='POST')return json({error:'Method not allowed'},405,headers);
      if(!authorized.identity||!env.AIRTABLE_TOKEN)return json({error:'Office execution unavailable'},503,headers);
      const r=await officeHandleExecution(request,env,authorized.identity);
      return json(r.body,r.status,headers);
    }
    if(url.pathname==='/office/audit'){
      const headers={...CORS,'Cache-Control':'private, no-store'};
      if(request.method!=='POST')return json({error:'Method not allowed'},405,headers);
      let p;try{p=await request.json();}catch(_){return json({error:'Invalid audit JSON'},422,headers);}
      const action=String(p?.action||''),entity=String(p?.entity||''),executionId=String(p?.executionId||'');
      if(!['view','copy','export','digest'].includes(action)||entity.length>200||executionId.length>120)
        return json({error:'Invalid office audit event'},422,headers);
      try{await officeAudit(env,authorized.identity,action,entity,executionId,String(p?.detail||''));return json({ok:true},201,headers);}
      catch(_){return json({error:'Office audit unavailable'},503,headers);}
    }
    if(url.pathname==='/office/incidents'){
      const headers={...CORS,'Cache-Control':'private, no-store'};
      if(!authorized.identity)return json({error:'Office incidents require Access'},403,headers);
      if(request.method==='GET'){
        try{const rows=await officeList(env,'Incidencias_Operativas',{max:1000});
          return json({ok:true,records:rows},200,headers);}catch(_){return json({error:'Incidents unavailable'},503,headers);}
      }
      let p;try{p=await request.json();}catch(_){return json({error:'Invalid incident JSON'},422,headers);}
      const id=String(p?.id||''),state=String(p?.state||'');
      if(!/^rec[A-Za-z0-9]{14}$/.test(id)||!['Reconocida','Resuelta'].includes(state))
        return json({error:'Invalid incident update'},422,headers);
      try{const fields={Estado:state};if(state==='Resuelta')fields.Resuelta=new Date().toISOString();
        const row=await officePatch(env,'Incidencias_Operativas',id,fields);return json({ok:true,record:row},200,headers);}
      catch(_){return json({error:'Incident update failed'},503,headers);}
    }
    if(url.pathname==='/social/lead'){
      const headers={...CORS,'Cache-Control':'private, no-store'};
      if(url.search||request.method!=='POST')return json({error:'Method not allowed'},405,headers);
      if(!authorized.identity||(authorized.identity.role!=='admin'&&authorized.identity.email!=='marketing@thelab.solutions'))
        return json({error:'Social lead role denied'},403,headers);
      if(!/^application\/json(?:;|$)/i.test(String(request.headers.get('Content-Type')||''))||
         Number(request.headers.get('Content-Length')||0)>1000)
        return json({error:'Social lead expects bounded JSON'},415,headers);
      let body;try{body=JSON.parse(await request.text());}catch(_){return json({error:'Invalid social lead JSON'},422,headers);}
      if(!body||Object.keys(body).some(k=>k!=='interactionId')||
         typeof body.interactionId!=='string'||!/^rec[A-Za-z0-9]{14}$/.test(body.interactionId))
        return json({error:'Invalid social interaction'},422,headers);
      if(!env.CRM_MUTATION_GUARD)return json({error:'Social lead guard unavailable'},503,headers);
      try{
        const stub=env.CRM_MUTATION_GUARD.get(env.CRM_MUTATION_GUARD.idFromName('tls-social-leads'));
        const guarded=await stub.fetch('https://crm-write.internal/social-lead',{method:'POST',
          headers:{'Content-Type':'application/json'},body:JSON.stringify({interactionId:body.interactionId,
            actor:{email:authorized.identity.email,role:authorized.identity.role}})});
        const h=new Headers(guarded.headers);Object.entries(headers).forEach(([k,v])=>h.set(k,v));
        return new Response(guarded.body,{status:guarded.status,headers:h});
      }catch(_){return json({error:'Social lead guard unavailable'},503,headers);}
    }

    if(url.pathname==='/newsletter/send'){
      const scopedHeaders={...CORS,'Cache-Control':'private, no-store'};
      if(url.search)return json({error:'Newsletter query parameters not allowed'},422,scopedHeaders);
      if(request.method!=='POST')return json({error:'Method not allowed'},405,scopedHeaders);
      if(!authorized.identity)return json({error:'Newsletter send requires Cloudflare Access'},503,scopedHeaders);
      if(authorized.identity.role!=='admin')return json({error:'Newsletter send role denied'},403,scopedHeaders);
      if(!/^application\/json(?:;|$)/i.test(String(request.headers.get('Content-Type')||''))||
         Number(request.headers.get('Content-Length')||0)>2000)
        return json({error:'Newsletter send expects bounded JSON'},415,scopedHeaders);
      let body;try{body=JSON.parse(await request.text());}catch(_){return json({error:'Invalid newsletter send JSON'},422,scopedHeaders);}
      if(!body||Object.keys(body).some(k=>k!=='campaignId')||typeof body.campaignId!=='string'||
         !/^rec[A-Za-z0-9]{14}$/.test(body.campaignId))
        return json({error:'Invalid newsletter campaign'},422,scopedHeaders);
      if(!env.CRM_MUTATION_GUARD)return json({error:'Newsletter send guard unavailable'},503,scopedHeaders);
      try{
        const stub=env.CRM_MUTATION_GUARD.get(env.CRM_MUTATION_GUARD.idFromName('tls-newsletter-send'));
        const guarded=await stub.fetch('https://crm-write.internal/newsletter-send',{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
            campaignId:body.campaignId,actor:{email:authorized.identity.email,role:authorized.identity.role}
          })
        });
        const headers=new Headers(guarded.headers);Object.entries(scopedHeaders).forEach(([k,v])=>headers.set(k,v));
        return new Response(guarded.body,{status:guarded.status,headers});
      }catch(_){return json({error:'Newsletter send guard unavailable'},503,scopedHeaders);}
    }

    if(url.pathname==='/visual-ai/rpc'){
      const headers={...CORS,'Cache-Control':'private, no-store'};
      if(!authorized.identity||!visualAiActorAllowed(authorized.identity))
        return json({error:'Visual AI requires signed user access'},403,headers);
      if(request.method!=='POST'||url.search)return json({error:'Method not allowed'},405,headers);
      if(!/^application\/json(?:;|$)/i.test(String(request.headers.get('Content-Type')||''))||
         Number(request.headers.get('Content-Length')||0)>12000000)
        return json({error:'Visual AI expects bounded JSON'},415,headers);
      let body;try{const raw=await request.text();if(raw.length>12000000)throw Error('large');body=JSON.parse(raw);}
      catch(_){return json({error:'Invalid Visual AI JSON'},422,headers);}
      if(!body||typeof body.action!=='string')return json({error:'Invalid Visual AI request'},422,headers);
      if(!env.MUAPI_KEY)return json({error:'Visual AI provider is not configured',code:'VISUAL_AI_NOT_CONFIGURED'},503,headers);
      const providerHeaders={'x-api-key':env.MUAPI_KEY};

      if(body.action==='quota'){
        if(!env.CRM_MUTATION_GUARD)return json({error:'Visual AI quota guard unavailable'},503,headers);
        const stub=env.CRM_MUTATION_GUARD.get(env.CRM_MUTATION_GUARD.idFromName('tls-visual-ai-global'));
        let gate;
        try{gate=await stub.fetch('https://crm-write.internal/visual-ai-guard',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({op:'quota',actor:{email:authorized.identity.email,role:authorized.identity.role}})});}
        catch(_){return json({error:'Visual AI quota guard unavailable'},503,headers);}
        const q=await gate.json().catch(()=>({}));
        if(!gate.ok)return json({error:'Visual AI quota unavailable'},503,headers);
        return json({ok:true,provider:'MuAPI via TLS secure proxy',
          daily_limit:q.limit,used:q.used,remaining:q.remaining,estimated_cost_usd:null},200,headers);
      }

      if(body.action==='upload'){
        if(typeof body.dataUrl!=='string'||body.dataUrl.length>VISUAL_AI_MAX_UPLOAD_BYTES*1.4)
          return json({error:'Image upload too large'},413,headers);
        const m=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl);
        if(!m)return json({error:'Unsupported image upload'},422,headers);
        let bytes;try{bytes=Uint8Array.from(atob(m[2]),c=>c.charCodeAt(0));}catch(_){return json({error:'Invalid image data'},422,headers);}
        if(!bytes.length||bytes.length>VISUAL_AI_MAX_UPLOAD_BYTES)return json({error:'Image upload too large'},413,headers);
        const jpeg=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
        const png=bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47;
        const webp=bytes.length>12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
        if(!(jpeg||png||webp))return json({error:'Image signature does not match an allowed format'},422,headers);
        const fd=new FormData();
        fd.append('file',new File([bytes],'upload.'+(jpeg?'jpg':png?'png':'webp'),{type:m[1]}));
        let upstream;try{upstream=await fetch(VISUAL_AI_PROVIDER+'/upload_file',{method:'POST',headers:providerHeaders,body:fd,redirect:'manual'});}
        catch(_){return json({error:'Visual upload unavailable'},502,headers);}
        if(!upstream.ok||upstream.status>=300&&upstream.status<400)return json({error:'Visual upload rejected by provider'},502,headers);
        let d;try{d=await upstream.json();}catch(_){return json({error:'Visual upload returned invalid JSON'},502,headers);}
        const asset=visualAiResultUrl(d.url||d.file_url||d.data?.url);
        if(!asset)return json({error:'Visual upload returned an untrusted URL'},502,headers);
        return json({ok:true,url:asset},200,headers);
      }

      if(body.action==='generate'){
        const endpoint=String(body.endpoint||'');
        if(!VISUAL_AI_ALLOWED_ENDPOINTS.has(endpoint)||!visualAiPayloadAllowed(body.payload)||
           typeof body.jobId!=='string'||!/^[A-Za-z0-9_-]{10,100}$/.test(body.jobId))
          return json({error:'Visual generation request denied'},422,headers);
        if(!env.CRM_MUTATION_GUARD)return json({error:'Visual AI job guard unavailable'},503,headers);
        const stub=env.CRM_MUTATION_GUARD.get(env.CRM_MUTATION_GUARD.idFromName('tls-visual-ai-global'));
        const actor={email:authorized.identity.email,role:authorized.identity.role};
        let gate;
        try{gate=await stub.fetch('https://crm-write.internal/visual-ai-guard',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({op:'reserve',jobId:body.jobId,endpoint,actor})});}
        catch(_){return json({error:'Visual AI job guard unavailable'},503,headers);}
        const gateBody=await gate.json().catch(()=>({}));
        if(!gate.ok)return json(gateBody,gate.status,headers);
        if(gateBody.replayed&&gateBody.response)return json({ok:true,replayed:true,...gateBody.response,quota:{used:gateBody.used,limit:gateBody.limit}},200,headers);
        let upstream;
        try{
          upstream=await fetch(VISUAL_AI_PROVIDER+'/'+endpoint,{method:'POST',redirect:'manual',
            headers:{...providerHeaders,'Content-Type':'application/json'},body:JSON.stringify(body.payload)});
        }catch(_){
          return json({error:'Visual generation outcome uncertain; do not retry this job',code:'VISUAL_JOB_PENDING'},503,headers);
        }
        let d={};try{d=await upstream.json();}catch(_){}
        if(!upstream.ok||upstream.status>=300&&upstream.status<400){
          if(upstream.status>=400&&upstream.status<500){
            try{await stub.fetch('https://crm-write.internal/visual-ai-guard',{method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({op:'release',jobId:body.jobId,actor})});}catch(_){}
          }
          return json({error:typeof d.error==='string'?d.error:'Visual provider rejected request'},upstream.status>=400&&upstream.status<500?422:502,headers);
        }
        const requestId=String(d.request_id||d.id||'');
        if(!requestId||requestId.length>240)return json({error:'Visual provider returned no request id',code:'VISUAL_JOB_PENDING'},502,headers);
        const receipt={request_id:requestId};
        let commit;try{commit=await stub.fetch('https://crm-write.internal/visual-ai-guard',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({op:'commit',jobId:body.jobId,response:receipt,actor})});}
        catch(_){return json({error:'Visual request created but receipt could not be committed',code:'VISUAL_JOB_PENDING'},503,headers);}
        if(!commit.ok)return json({error:'Visual request created but receipt is pending reconciliation',code:'VISUAL_JOB_PENDING'},503,headers);
        return json({ok:true,...receipt,quota:{used:gateBody.used,limit:gateBody.limit}},200,headers);
      }

      if(body.action==='poll'){
        const requestId=String(body.requestId||'');
        if(!/^[A-Za-z0-9._:-]{4,240}$/.test(requestId))return json({error:'Invalid visual request id'},422,headers);
        let upstream;try{upstream=await fetch(VISUAL_AI_PROVIDER+'/predictions/'+encodeURIComponent(requestId)+'/result',
          {method:'GET',headers:providerHeaders,redirect:'manual'});}
        catch(_){return json({error:'Visual provider temporarily unavailable',transient:true},502,headers);}
        if(!upstream.ok||upstream.status>=300&&upstream.status<400)
          return json({error:'Visual provider status unavailable',transient:upstream.status>=500},upstream.status>=500?502:422,headers);
        let d;try{d=await upstream.json();}catch(_){return json({error:'Visual provider returned invalid JSON',transient:true},502,headers);}
        const status=String(d.status||'').toLowerCase();
        const rawUrl=d.url||d.outputs?.[0]||d.output?.[0]||'';
        const asset=rawUrl?visualAiResultUrl(rawUrl):null;
        if(rawUrl&&!asset)return json({error:'Visual provider returned an untrusted asset URL'},502,headers);
        const costRaw=Number(d.cost_usd??d.cost??d.usage?.cost_usd);
        const costUsd=Number.isFinite(costRaw)&&costRaw>=0&&costRaw<=100?costRaw:null;
        return json({ok:true,status,url:asset||null,error:typeof d.error==='string'?d.error.slice(0,500):null,cost_usd:costUsd},200,headers);
      }
      return json({error:'Unknown Visual AI action'},404,headers);
    }

    // Google Ads privileged bridge. The Make webhook and its shared key never
    // reach Pages; the browser submits only a bounded idempotent command.
    if(url.pathname==='/ads/campaign-shell'){
      const scopedHeaders={...CORS,'Cache-Control':'private, no-store'};
      if(url.search)return json({error:'Ads shell query parameters not allowed'},422,scopedHeaders);
      if(request.method!=='POST')return json({error:'Method not allowed'},405,scopedHeaders);
      if(!/^application\/json(?:;|$)/i.test(String(request.headers.get('Content-Type')||''))||
         Number(request.headers.get('Content-Length')||0)>12000)
        return json({error:'Ads shell expects bounded JSON'},415,scopedHeaders);
      let body;try{const raw=await request.text();if(raw.length>12000)throw Error('large');body=JSON.parse(raw);}
      catch(_){return json({error:'Invalid Ads shell JSON'},422,scopedHeaders);}
      if(!body||Object.keys(body).some(k=>!['mutationId','nombre','presupuesto'].includes(k))||
         typeof body.mutationId!=='string'||body.mutationId.length<10||body.mutationId.length>100||
         typeof body.nombre!=='string'||!body.nombre.trim()||body.nombre.length>120||
         !Number.isSafeInteger(Number(body.presupuesto))||Number(body.presupuesto)<1000||Number(body.presupuesto)>500000)
        return json({error:'Invalid Ads shell request'},422,scopedHeaders);
      if(!env.CRM_MUTATION_GUARD)return json({error:'Ads mutation guard unavailable'},503,scopedHeaders);
      try{
        const stub=env.CRM_MUTATION_GUARD.get(env.CRM_MUTATION_GUARD.idFromName('tls-ads-shell-global'));
        const guarded=await stub.fetch('https://crm-write.internal/ads-shell',{method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({mutationId:body.mutationId,nombre:body.nombre.trim(),
            presupuesto:Number(body.presupuesto),actor:authorized.identity
              ?{email:authorized.identity.email,role:authorized.identity.role}:{legacy:true}})});
        const headers=new Headers(guarded.headers);Object.entries(scopedHeaders).forEach(([k,v])=>headers.set(k,v));
        return new Response(guarded.body,{status:guarded.status,headers});
      }catch(_){return json({error:'Ads shell guard unavailable'},503,scopedHeaders);}
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

    // Problem reports are stored in their own Airtable table. Every signed user
    // may report and review their own issues; admins see the complete history.
    if(url.pathname==='/shared/problems'){
      const scopedHeaders={...CORS,'Cache-Control':'private, no-store'};
      if(url.search)return json({error:'Problem report query parameters not allowed'},422,scopedHeaders);
      if(request.method==='GET'){
        const out=await problemReportsList(env,authorized.identity,authorized.legacy===true);
        if(out.error)return json({error:'Problem reports unavailable'},503,scopedHeaders);
        return json({ok:true,reports:out.reports},200,scopedHeaders);
      }
      if(request.method!=='POST')return json({error:'Method not allowed'},405,scopedHeaders);
      if(!/^application\/json(?:;|$)/i.test(String(request.headers.get('Content-Type')||''))||
         Number(request.headers.get('Content-Length')||0)>7500000)
        return json({error:'Problem report expects bounded JSON'},415,scopedHeaders);
      let body;try{
        const raw=await request.text();if(raw.length>7500000)throw Error('large');
        body=JSON.parse(raw);
      }catch(_){return json({error:'Invalid problem report JSON'},422,scopedHeaders);}
      if(body?.action==='repair'){
        if(!problemRepairPayloadAllowed(body))
          return json({error:'Invalid repair request'},422,scopedHeaders);
        const queued=await problemReportRepair(env,body,authorized.identity,authorized.legacy===true);
        if(queued.error)return json({error:queued.error},queued.status||503,scopedHeaders);
        return json({ok:true,queued:true,report:queued.report},200,scopedHeaders);
      }
      if(!problemReportPayloadAllowed(body))
        return json({error:'Invalid problem report'},422,scopedHeaders);
      const reporter=authorized.identity?.email||
        (authorized.legacy===true&&problemEmail(body.reporter)?String(body.reporter).toLowerCase():'');
      if(!reporter)return json({error:'Reporter identity required'},403,scopedHeaders);
      const created=await problemReportCreate(env,{...body,reporter});
      if(created.error)return json({error:created.error},created.status||503,scopedHeaders);
      return json({ok:true,report:created.report},201,scopedHeaders);
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


    if(url.pathname==='/mail/accounts'){
      const h={...CORS,'Cache-Control':'private, no-store'};
      if(request.method!=='GET'||url.search)return json({error:'Method not allowed'},405,h);
      if(!authorized.identity)return json({error:'Cloudflare Access required'},401,h);
      const accounts=mailAuthorizedAccounts(authorized.identity,env);
      return json({ok:true,accounts},200,h);
    }
    if(url.pathname==='/mail/session'){
      const h={...CORS,'Cache-Control':'private, no-store'};
      if(!authorized.identity)return json({error:'Cloudflare Access required'},401,h);
      if(!['POST','DELETE'].includes(request.method)||url.search)return json({error:'Method not allowed'},405,h);
      if(!env.CRM_MUTATION_GUARD)return json({error:'Mail session guard unavailable'},503,h);
      let body;try{body=await request.json();}catch(_){return json({error:'Invalid mail session JSON'},422,h);}
      const account=String(body?.account||'').toLowerCase(),allowedAccounts=mailAuthorizedAccounts(authorized.identity,env);
      if(!allowedAccounts.includes(account))return json({error:'Mailbox scope denied'},403,h);
      if(request.method==='POST'&&(typeof body.password!=='string'||body.password.length<1||body.password.length>512))
        return json({error:'Mailbox password required'},422,h);
      try{
        const stub=env.CRM_MUTATION_GUARD.get(env.CRM_MUTATION_GUARD.idFromName('tls-mail-session:'+authorized.identity.email));
        const guarded=await stub.fetch('https://crm-write.internal/mail-session',{method:request.method,
          headers:{'Content-Type':'application/json'},body:JSON.stringify({account,password:body.password||'',
            allowedAccounts,actor:{email:authorized.identity.email,role:authorized.identity.role}})});
        const headers=new Headers(guarded.headers);Object.entries(h).forEach(([k,v])=>headers.set(k,v));
        return new Response(guarded.body,{status:guarded.status,headers});
      }catch(_){return json({error:'Mail session guard unavailable'},503,h);}
    }
    if(url.pathname==='/mail/rpc'){
      const h={...CORS,'Cache-Control':'private, no-store'};
      if(request.method!=='POST'||url.search)return json({error:'Method not allowed'},405,h);
      if(!authorized.identity||!env.CRM_MUTATION_GUARD)return json({error:'Mail RPC unavailable'},503,h);
      let body;try{const raw=await request.text();if(raw.length>32000000)throw Error('large');body=JSON.parse(raw);}
      catch(_){return json({error:'Invalid mail RPC JSON'},422,h);}
      const account=String(body?.account||'').toLowerCase(),allowedAccounts=mailAuthorizedAccounts(authorized.identity,env);
      if(!allowedAccounts.includes(account)||!body.params||typeof body.params!=='object'||Array.isArray(body.params))
        return json({error:'Mailbox scope denied'},403,h);
      try{
        const stub=env.CRM_MUTATION_GUARD.get(env.CRM_MUTATION_GUARD.idFromName('tls-mail-session:'+authorized.identity.email));
        const guarded=await stub.fetch('https://crm-write.internal/mail-rpc',{method:'POST',
          headers:{'Content-Type':'application/json'},body:JSON.stringify({account,params:body.params,allowedAccounts,
            actor:{email:authorized.identity.email,role:authorized.identity.role}})});
        const headers=new Headers(guarded.headers);Object.entries(h).forEach(([k,v])=>headers.set(k,v));
        if(body.params.action==='send'&&guarded.ok){
          try{await officeAudit(env,authorized.identity,'export','correo-envio',account,
            'Envío aceptado por mail-api');}catch(_){}
        }
        return new Response(guarded.body,{status:guarded.status,headers});
      }catch(_){return json({error:'Mail RPC unavailable'},503,h);}
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
        authorized.identity,account,authorized.legacy===true,env))
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


    // Remuneraciones: documento revisionado, con lectura backend-scoped por vendedor.
    if(url.pathname==='/shared/remunerations'){
      const scopedHeaders={...CORS,'Cache-Control':'private, no-store'};
      if(!authorized.identity)return json({error:'Remunerations require Cloudflare Access'},403,scopedHeaders);
      if(!['sales','finance','admin'].includes(authorized.identity.role))
        return json({error:'Remunerations role denied'},403,scopedHeaders);
      if(url.search)return json({error:'Remunerations query parameters not allowed'},422,scopedHeaders);
      if(request.method==='GET'){
        const current=await sharedRemLoad(env);
        if(current.error)return json({error:'Shared remunerations unavailable'},503,scopedHeaders);
        try{await officeAudit(env,authorized.identity,'view','remuneraciones','','Lectura de remuneraciones');}catch(_){}
        return json({ok:true,exists:current.exists,revision:current.revision,
          data:sharedRemScope(current.data,authorized.identity)},200,scopedHeaders);
      }
      if(request.method!=='PUT')return json({error:'Method not allowed'},405,scopedHeaders);
      if(!['finance','admin'].includes(authorized.identity.role))
        return json({error:'Remunerations write role denied'},403,scopedHeaders);
      if(!/^application\/json(?:;|$)/i.test(String(request.headers.get('Content-Type')||''))||
         Number(request.headers.get('Content-Length')||0)>160000)
        return json({error:'Shared remunerations expects bounded JSON'},415,scopedHeaders);
      let body;try{const raw=await request.text();if(raw.length>160000)throw Error('large');body=JSON.parse(raw);}
      catch(_){return json({error:'Invalid shared remunerations JSON'},422,scopedHeaders);}
      if(!body||Object.keys(body).some(k=>!['data','expectedRevision'].includes(k))||
         !sharedRemDocumentAllowed(body.data)||typeof body.expectedRevision!=='string'||
         !/^[a-f0-9]{64}$/.test(body.expectedRevision))
        return json({error:'Invalid shared remunerations document'},422,scopedHeaders);
      if(!env.CRM_MUTATION_GUARD)return json({error:'Shared remunerations guard unavailable'},503,scopedHeaders);
      try{
        const stub=env.CRM_MUTATION_GUARD.get(env.CRM_MUTATION_GUARD.idFromName('tls-shared-remunerations'));
        const guarded=await stub.fetch('https://crm-write.internal/shared-remunerations',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({data:body.data,expectedRevision:body.expectedRevision,
            actor:{email:authorized.identity.email,role:authorized.identity.role}})
        });
        const headers=new Headers(guarded.headers);Object.entries(scopedHeaders).forEach(([k,v])=>headers.set(k,v));
        return new Response(guarded.body,{status:guarded.status,headers});
      }catch(_){return json({error:'Shared remunerations guard unavailable'},503,scopedHeaders);}
    }
    if(url.pathname==='/shared/remunerations/audit'){
      const scopedHeaders={...CORS,'Cache-Control':'private, no-store'};
      if(request.method!=='POST'||!authorized.identity||
         !['sales','finance','admin'].includes(authorized.identity.role))
        return json({error:'Remunerations audit denied'},403,scopedHeaders);
      let body;try{body=await request.json();}catch(_){return json({error:'Invalid audit JSON'},422,scopedHeaders);}
      if(!body||body.action!=='export'||typeof body.period!=='string'||body.period.length>30||
         !Number.isInteger(body.count)||body.count<0||body.count>10000)
        return json({error:'Invalid remuneration audit event'},422,scopedHeaders);
      try{await officeAudit(env,authorized.identity,'export','remuneraciones',body.period,'Filas: '+body.count);
        return json({ok:true},201,scopedHeaders);}
      catch(_){return json({error:'Remunerations audit unavailable'},503,scopedHeaders);}
    }

    // Finance state is a single revisioned document. It contains only the
    // business finance UI state that previously lived in browser localStorage.
    // It requires an authenticated finance/admin Access identity.
    if(url.pathname==='/shared/finance'){
      const scopedHeaders={...CORS,'Cache-Control':'private, no-store'};
      if(!authorized.identity)
        return json({error:'Shared finance requires Cloudflare Access',code:'ACCESS_REQUIRED'},503,scopedHeaders);
      if(!['finance','admin'].includes(authorized.identity.role))
        return json({error:'Shared finance role denied'},403,scopedHeaders);
      if(url.search)return json({error:'Finance query parameters not allowed'},422,scopedHeaders);
      if(request.method==='GET'){
        const current=await sharedFinanceLoad(env);
        if(current.error)return json({error:'Shared finance unavailable'},503,scopedHeaders);
        return json({ok:true,exists:current.exists,revision:current.revision,data:current.data},200,scopedHeaders);
      }
      if(request.method!=='PUT')return json({error:'Method not allowed'},405,scopedHeaders);
      if(!/^application\/json(?:;|$)/i.test(String(request.headers.get('Content-Type')||''))||
         Number(request.headers.get('Content-Length')||0)>100000)
        return json({error:'Shared finance expects bounded JSON'},415,scopedHeaders);
      let body;try{
        const raw=await request.text();if(raw.length>100000)throw Error('large');body=JSON.parse(raw);
      }catch(_){return json({error:'Invalid shared finance JSON'},422,scopedHeaders);}
      if(!body||Object.keys(body).some(k=>!['data','expectedRevision'].includes(k))||
         !sharedFinanceDocumentAllowed(body.data)||typeof body.expectedRevision!=='string'||
         !/^[a-f0-9]{64}$/.test(body.expectedRevision))
        return json({error:'Invalid shared finance document'},422,scopedHeaders);
      if(!env.CRM_MUTATION_GUARD)
        return json({error:'Shared finance guard unavailable'},503,scopedHeaders);
      try{
        const stub=env.CRM_MUTATION_GUARD.get(env.CRM_MUTATION_GUARD.idFromName('tls-shared-finance'));
        const guarded=await stub.fetch('https://crm-write.internal/shared-finance',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({data:body.data,expectedRevision:body.expectedRevision,
            actor:{email:authorized.identity.email,role:authorized.identity.role}})
        });
        const headers=new Headers(guarded.headers);
        Object.entries(scopedHeaders).forEach(([k,v])=>headers.set(k,v));
        return new Response(guarded.body,{status:guarded.status,headers});
      }catch(_){return json({error:'Shared finance guard unavailable'},503,scopedHeaders);}
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
      respHeaders.set('X-AI-Estimated-Cost-USD',String(Number(reservation.estimated_request_usd||reservation.estimate||0).toFixed(6)));
      respHeaders.set('X-AI-Cost-Provenance','budget-reservation');
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
      respHeaders.set('X-AI-Estimated-Cost-USD',String(Number(reservation.estimated_request_usd||reservation.estimate||0).toFixed(6)));
      respHeaders.set('X-AI-Cost-Provenance','budget-reservation');
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
