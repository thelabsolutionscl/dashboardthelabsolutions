/**
 * Notificaciones de fondos concursables verificadas, para Gustavo y Nicanor.
 * Cloudflare Cron existente: el 1er disparo de cada día a partir de 09:00
 * hora de Santiago. Envío individual por Resend con idempotencia y KV.
 * No procesa llamados sin fechas y NO hace envíos históricos.
 */
const TZ='America/Santiago';
export const FONDOS_CATALOGO_URL='https://dashboard.thelab.solutions/data/fondos-concursables.json';
export const FONDOS_CATALOGO_RESPALDO='https://raw.githubusercontent.com/thelabsolutionscl/dashboardthelabsolutions/main/data/fondos-concursables.json';
const RESEND_URL='https://api.resend.com/emails';
const PEOPLE={gustavo:'gustavo@thelab.solutions',nicanor:'nicanor@thelab.solutions'};
const SOURCES=new Set(['www.sercotec.cl','sercotec.cl','www.corfo.cl','corfo.cl','www.corfo.gob.cl','corfo.gob.cl','www.fondos.gob.cl','fondos.gob.cl','www.prochile.gob.cl','prochile.gob.cl','www.startupchile.org','startupchile.org']);
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function chileNow(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const get=k=>parts.find(p=>p.type===k)?.value||'';
  return {date:[get('year'),get('month'),get('day')].join('-'),hour:Number(get('hour'))};
}
function dateOnly(v){
  if(typeof v!=='string'||!/^20\d\d-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d$/.test(v))return '';
  const [y,m,d]=v.slice(0,10).split('-').map(Number),t=new Date(Date.UTC(y,m-1,d));
  if(t.getUTCFullYear()!==y||t.getUTCMonth()+1!==m||t.getUTCDate()!==d)return '';
  return v.slice(0,10);
}
function valid(f){
  if(!f||!/^[-a-z0-9]{3,90}$/.test(f.id||'')||typeof f.name!=='string'||f.name.length<4||f.name.length>200)return false;
  try{const u=new URL(f.source);return u.protocol==='https:'&&SOURCES.has(u.hostname);}catch{return false;}
}
export function dueNotifications(catalog,date=new Date()){
  const now=chileNow(date);
  if(!Array.isArray(catalog?.funds)||catalog?.schema!==1||catalog.funds.length>250)return [];
  const found=[];
  for(const f of catalog.funds){
    if(!valid(f))continue;
    for(const [phase,field] of [['apertura','open'],['cierre','close']]){
      if(dateOnly(f[field])!==now.date)continue;
      // A number of 2026 calls are historical; day-of matching alone prevents
      // stale calls being replayed after a new code release.
      const link=String(f.info||f.source);
      const detailUrl=(()=>{try{const u=new URL(link);return u.protocol==='https:'&&SOURCES.has(u.hostname)?u.href:f.source;}catch{return f.source;}})();
      found.push({id:f.id,phase,date:now.date,time:f[field].slice(11,16),name:f.name,organizer:String(f.organizer||''),requirements:String(f.requirements||''),url:detailUrl});
    }
  }
  return found.slice(0,50);
}
function address(env,person){
  const value=String(env['FONDOS_NOTIFY_TO_'+person.toUpperCase()]||PEOPLE[person]).trim().toLowerCase();
  // Restringir por defecto a la cuenta empresarial; nunca usar emails de postulantes.
  return /^[a-z0-9._%+-]+@thelab\.solutions$/.test(value)?value:null;
}
export function emailFor(f,person,address){
  const action=f.phase==='apertura'?'ABRE HOY':'CIERRA HOY';
  const subject='🏛 Fondo concursable '+action+': '+f.name;
  const body='<div style="font-family:Arial,sans-serif;color:#1d2636;line-height:1.5;max-width:650px">'+
    '<h2>'+esc(subject)+'</h2>'+
    '<p>Hola '+esc(person==='gustavo'?'Gustavo':'Nicanor')+',</p>'+
    '<p>Hoy, <b>'+esc(f.date)+'</b>, corresponde la <b>'+esc(f.phase)+'</b> de esta convocatoria ('+esc(f.organizer)+').</p>'+
    '<p><b>Horario:</b> '+(f.time==='00:00'?'No consta hora oficial en esta ficha; consulta las bases para el plazo exacto.':esc(f.time)+' (Chile continental)')+'. Confirma cualquier cambio directamente en el organismo.</p>'+
    '<p><b>Requisitos por verificar:</b> '+esc(f.requirements)+'</p>'+
    '<p><a href="'+esc(f.url)+'">Consultar convocatoria oficial y bases</a></p>'+
    '<p><a href="https://dashboard.thelab.solutions/">Abrir Calendario de TLS</a></p>'+
    '<p style="font-size:12px;color:#666">La coincidencia con TLS es preliminar. No implica elegibilidad; confirma bases, prórrogas y vigencia antes de postular.</p></div>';
  return {from:'',to:[address],subject,html:body};
}
export async function deliverFundAlerts(env,date=new Date(),fetcher=fetch){
  if(String(env.FONDOS_NOTIFY_ENABLED||'true').toLowerCase()==='false')return {skipped:'desactivado'};
  const clock=chileNow(date);
  if(clock.hour<9||clock.hour>21)return {skipped:'fuera-horario',date:clock.date};
  if(!env.RESEND_API_KEY||!env.RL)return {skipped:'falta-resend-o-kv',date:clock.date};
  // Fuente principal: misma versión mostrada por el dashboard; fallback
  // público a GitHub main si el dominio usa Cloudflare Access o un redirect.
  // Se rechaza toda carga que no cumpla el esquema esperado.
  let data,sourceError;
  for(const url of [FONDOS_CATALOGO_URL,FONDOS_CATALOGO_RESPALDO]){
    try{
      const response=await fetcher(url,{headers:{'Accept':'application/json'},cf:{cacheTtl:60}});
      if(!response.ok)throw Error('HTTP '+response.status);
      const payload=await response.json();
      if(!Array.isArray(payload?.funds)||payload.schema!==1)throw Error('schema inválido');
      data=payload;break;
    }catch(e){sourceError=e;console.warn('[fondos-notify] fallo fuente catálogo:',url,String(e.message||e));}
  }
  if(!data)throw Error('No hay catálogo de fondos verificable: '+String(sourceError?.message||sourceError));
  const candidates=dueNotifications(data,date);
  const result={date:clock.date,events:candidates.length,sent:0,alreadySent:0,errors:[]};
  for(const f of candidates){
    for(const person of ['gustavo','nicanor']){
      const email=address(env,person);
      if(!email){result.errors.push('Correo corporativo inválido: '+person);continue;}
      const key='fondos:alert:'+f.id+':'+f.phase+':'+f.date+':'+person;
      let old;
      try{old=await env.RL.get(key);}catch(e){result.errors.push('KV inaccesible: '+person);continue;}
      if(old){result.alreadySent++;continue;}
      const body=emailFor(f,person,email);body.from=env.RESEND_FROM||'The Lab Solutions <hola@thelab.solutions>';
      try{
        const response=await fetcher(RESEND_URL,{
          method:'POST',headers:{'Authorization':'Bearer '+env.RESEND_API_KEY,
            'Content-Type':'application/json','Idempotency-Key':key.slice(0,255)},
          body:JSON.stringify(body)
        });
        if(!response.ok)throw Error('Resend HTTP '+response.status);
        const data=await response.json();
        if(!data?.id)throw Error('Resend no confirmó el identificador de envío');
        // Persistir el envío. Idempotency-Key protege ante un fallo entre el
        // envío y la persistencia en KV.
        await env.RL.put(key,String(data.id),{expirationTtl:180*86400});
        result.sent++;
      }catch(e){result.errors.push(f.id+' '+f.phase+' '+person+': '+String(e.message||e));}
    }
  }
  if(result.errors.length)console.error('[fondos-notify]',result.errors.join('; '));
  return result;
}
