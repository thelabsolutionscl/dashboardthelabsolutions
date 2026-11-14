/* js/foto3d-hy3d.js — cliente de Hunyuan3D (Tencent) para el Escultor de fotos.
 *
 * Hunyuan3D genera un objeto 3D completo desde una foto, pero necesita una GPU de
 * servidor. Se usan los Spaces públicos de Tencent en Hugging Face (gratis, con
 * una cuota diaria de GPU compartida): se les habla por la API HTTP de Gradio.
 *
 *   GET  {host}/config                       versión de Gradio y funciones disponibles
 *   POST {host}/upload                       sube la foto → ruta en el servidor
 *   POST {host}/call/shape_generation        encola el trabajo → event_id
 *   GET  {host}/call/shape_generation/{id}   eventos SSE hasta `complete` (el GLB)
 *   GET  {file.url}                          descarga la malla
 *
 * El contrato (nombre de la función y orden de sus 13 entradas) sale del código
 * público de los Spaces (gradio_app.py de tencent/Hunyuan3D-2 y -2mini-Turbo).
 *
 * Corre como Web Worker: la foto sólo sale de la página desde acá. También se
 * exporta para Node (tests y scripts/hy3d-smoke.js).
 *
 * Privacidad: los Spaces son públicos y compartidos. Es la única parte del
 * Escultor que envía la foto fuera del equipo.
 */
(function(root){
'use strict';

const SPACES={
  // mini-Turbo: 0,6B parámetros, 5 pasos → pocos segundos de GPU (rinde más cuota).
  rapido:{label:'Hunyuan3D-2 mini Turbo',host:'https://tencent-hunyuan3d-2mini-turbo.hf.space',steps:5,guidance:5,chunks:8000},
  // Modelo completo: más detalle, ~30 s de GPU por pieza.
  estandar:{label:'Hunyuan3D-2',host:'https://tencent-hunyuan3d-2.hf.space',steps:30,guidance:5,chunks:8000},
};
const API_NAME='shape_generation';
const IDLE_MS=90e3,TOTAL_MS=8*60e3,MAX_GLB=120*1024*1024;

class HyError extends Error{
  constructor(code,message,extra){super(message);this.name='HyError';this.code=code;if(extra)Object.assign(this,extra);}
}
const sleep=(ms,signal)=>new Promise((res,rej)=>{
  const t=setTimeout(res,ms);
  if(signal)signal.addEventListener('abort',()=>{clearTimeout(t);rej(new HyError('cancelled','Cancelado'));},{once:true});
});
function hostFor(quality,env){
  const s=SPACES[quality]||SPACES.rapido;
  return((env&&env.hosts&&env.hosts[quality])||s.host).replace(/\/+$/,'');
}
function authHeaders(token){return token?{Authorization:'Bearer '+token}:{};}

// ── Errores del servicio → un código y un mensaje que el usuario entienda ──
function classifyServiceError(text,status){
  const t=String(text==null?'':text);
  if(/quota|exceeded your.*gpu|zerogpu/i.test(t)){
    const m=/(\d+):(\d{2}):(\d{2})/.exec(t),secs=m?(+m[1])*3600+(+m[2])*60+(+m[3]):0;
    const when=secs?` Vuelve a intentar en ${secs>=3600?Math.round(secs/3600)+' h':Math.max(1,Math.round(secs/60))+' min'}.`:'';
    return new HyError('quota','Se acabó la cuota gratis de GPU de Hugging Face por hoy.'+when,{retrySeconds:secs});
  }
  if(status===429||status===503||/queue is full|too many requests|busy|overloaded/i.test(t))
    return new HyError('busy','El servicio está saturado. Intenta de nuevo en unos minutos.',{status});
  if(/sleeping|building|starting|paused|runtime error/i.test(t))
    return new HyError('sleeping','El servicio está dormido o reiniciándose. Intenta de nuevo en un minuto.',{status});
  return new HyError('failed','El servicio no pudo generar la pieza'+(t&&t!=='null'?': '+t.slice(0,200):'.'),{status});
}
function netError(e){
  if(e&&e.code==='cancelled')return e;
  if(e&&e.name==='AbortError')return new HyError('cancelled','Cancelado');
  return new HyError('network','No se pudo conectar con el servicio (¿sin internet o bloqueado?).');
}

// ── Gradio ────────────────────────────────────────────────────────────────
function apiPrefix(cfg){
  if(typeof cfg.api_prefix==='string')return cfg.api_prefix.replace(/\/+$/,'');
  return parseInt(String(cfg.version||'4'),10)>=5?'/gradio_api':'';
}
// Lee /config: confirma que el Space responde y que la función existe.
async function check(opts){
  const env=opts.env||{},f=env.fetch||root.fetch,host=hostFor(opts.quality,env);
  let res;
  try{res=await f(host+'/config',{headers:authHeaders(opts.token),signal:opts.signal});}catch(e){throw netError(e);}
  if(!res.ok)throw classifyServiceError('',res.status);
  let cfg;
  try{cfg=await res.json();}catch(_){throw new HyError('sleeping','El servicio no respondió como una app de Gradio (¿dormido?).');}
  const prefix=apiPrefix(cfg),deps=Array.isArray(cfg.dependencies)?cfg.dependencies:[];
  const has=deps.some(d=>d&&d.api_name===API_NAME);
  if(!has)throw new HyError('api','La API del servicio cambió (no existe "'+API_NAME+'"). Hay que actualizar el Escultor.');
  return{host,prefix,version:String(cfg.version||''),label:(SPACES[opts.quality]||SPACES.rapido).label};
}
async function upload(host,prefix,png,token,signal,f){
  const fd=new FormData();
  fd.append('files',new Blob([png],{type:'image/png'}),'foto.png');
  let res;
  try{res=await f(host+prefix+'/upload',{method:'POST',body:fd,headers:authHeaders(token),signal});}catch(e){throw netError(e);}
  if(!res.ok)throw classifyServiceError(await res.text().catch(()=>''),res.status);
  const list=await res.json().catch(()=>null);
  if(!Array.isArray(list)||typeof list[0]!=='string')throw new HyError('api','El servicio rechazó la foto (respuesta de subida inesperada).');
  return list[0];
}
async function submit(host,prefix,data,token,signal,f){
  let res;
  try{res=await f(host+prefix+'/call/'+API_NAME,{method:'POST',headers:Object.assign({'Content-Type':'application/json'},authHeaders(token)),body:JSON.stringify({data}),signal});}
  catch(e){throw netError(e);}
  if(!res.ok)throw classifyServiceError(await res.text().catch(()=>''),res.status);
  const j=await res.json().catch(()=>null);
  if(!j||typeof j.event_id!=='string')throw new HyError('api','El servicio no devolvió un identificador de trabajo.');
  return j.event_id;
}
// SSE por fetch: bloques "event: x\ndata: y" separados por una línea en blanco.
function parseBlock(block){
  let event='message';const data=[];
  for(const line of block.split('\n')){
    if(line.startsWith(':')||!line)continue;
    const i=line.indexOf(':'),k=i<0?line:line.slice(0,i),v=i<0?'':line.slice(i+1).replace(/^ /,'');
    if(k==='event')event=v;else if(k==='data')data.push(v);
  }
  return{event,data:data.join('\n')};
}
async function stream(host,prefix,eventId,token,signal,f,onBeat,idleMs){
  let res;
  try{res=await f(host+prefix+'/call/'+API_NAME+'/'+eventId,{headers:Object.assign({Accept:'text/event-stream'},authHeaders(token)),signal});}
  catch(e){throw netError(e);}
  if(!res.ok||!res.body)throw classifyServiceError(await res.text().catch(()=>''),res.status);
  const reader=res.body.getReader(),dec=new TextDecoder();let buf='';
  // cancel() devuelve una promesa que se rechaza si el flujo ya falló (p. ej. por
  // un abort): sin atraparla queda como "unhandled rejection".
  const kill=()=>{try{const p=reader.cancel();if(p&&p.catch)p.catch(()=>{});}catch(_){}};
  const readIdle=()=>new Promise((resolve,reject)=>{
    const t=setTimeout(()=>{reject(new HyError('timeout','El servicio dejó de responder.'));kill();},idleMs||IDLE_MS);
    reader.read().then(r=>{clearTimeout(t);resolve(r);},e=>{clearTimeout(t);reject(netError(e));});
  });
  try{
    for(;;){
      const r=await readIdle();
      if(r.done)break;
      buf+=dec.decode(r.value,{stream:true}).replace(/\r\n/g,'\n');
      let i;
      while((i=buf.indexOf('\n\n'))>=0){
        const ev=parseBlock(buf.slice(0,i));buf=buf.slice(i+2);
        if(ev.event==='heartbeat'){if(onBeat)onBeat();continue;}
        if(ev.event==='complete'){
          let out;try{out=JSON.parse(ev.data);}catch(_){throw new HyError('api','Respuesta del servicio ilegible.');}
          return out;
        }
        if(ev.event==='error'){
          let msg=ev.data;try{const j=JSON.parse(ev.data);msg=typeof j==='string'?j:(j&&(j.error||j.message))||'';}catch(_){}
          throw classifyServiceError(msg,0);
        }
      }
    }
  }finally{kill();}
  throw new HyError('failed','El servicio cerró la conexión sin entregar la pieza.');
}
async function download(host,prefix,fileData,token,signal,f){
  if(!fileData||(!fileData.url&&!fileData.path))throw new HyError('empty','El servicio no entregó ninguna malla.');
  let url=null;
  if(fileData.url){try{if(new URL(fileData.url,host).origin===new URL(host).origin)url=new URL(fileData.url,host).href;}catch(_){}}
  if(!url&&fileData.path)url=host+prefix+'/file='+fileData.path;
  if(!url)throw new HyError('api','El servicio indicó una dirección de descarga no válida.');
  let res;
  try{res=await f(url,{headers:authHeaders(token),signal});}catch(e){throw netError(e);}
  if(!res.ok)throw classifyServiceError('',res.status);
  const len=Number(res.headers&&res.headers.get&&res.headers.get('content-length'))||0;
  if(len>MAX_GLB)throw new HyError('failed','La malla es demasiado grande.');
  const buf=await res.arrayBuffer();
  if(buf.byteLength>MAX_GLB)throw new HyError('failed','La malla es demasiado grande.');
  if(buf.byteLength<20||new DataView(buf).getUint32(0,true)!==0x46546C67)
    throw new HyError('api','El servicio no devolvió un GLB válido.');
  return buf;
}

// Foto → GLB. opts: {png, quality:'rapido'|'estandar', seed, octree, rembg, token,
// signal, onStatus(fase,extra), env:{fetch,hosts}}
async function generate(opts){
  const env=opts.env||{},f=env.fetch||root.fetch,q=SPACES[opts.quality]?opts.quality:'rapido',sp=SPACES[q];
  const ctl=new AbortController(),total=setTimeout(()=>ctl.abort(),TOTAL_MS);
  if(opts.signal){if(opts.signal.aborted)ctl.abort();else opts.signal.addEventListener('abort',()=>ctl.abort(),{once:true});}
  const say=(phase,extra)=>{if(opts.onStatus)opts.onStatus(phase,extra||{});};
  const t0=Date.now();
  try{
    say('check');
    const svc=await check({quality:q,token:opts.token,signal:ctl.signal,env});
    say('upload');
    const path=await upload(svc.host,svc.prefix,opts.png,opts.token,ctl.signal,f);
    const seed=Number.isFinite(Number(opts.seed))?Math.max(0,Math.floor(Number(opts.seed))):1234;
    const octree=Math.max(16,Math.min(512,Math.round(Number(opts.octree)||256)));
    // Orden de entradas de shape_generation (gradio_app.py del Space):
    // caption, image, mv_front, mv_back, mv_left, mv_right, steps, guidance_scale,
    // seed, octree_resolution, check_box_rembg, num_chunks, randomize_seed
    const data=[null,{path,orig_name:'foto.png',mime_type:'image/png',meta:{_type:'gradio.FileData'}},null,null,null,null,
      sp.steps,sp.guidance,seed,octree,opts.rembg!==false,sp.chunks,false];
    const id=await submit(svc.host,svc.prefix,data,opts.token,ctl.signal,f);
    say('generating',{elapsed:0});
    const out=await stream(svc.host,svc.prefix,id,opts.token,ctl.signal,f,()=>say('generating',{elapsed:Math.round((Date.now()-t0)/1000)}),env.idleMs);
    say('download');
    const glb=await download(svc.host,svc.prefix,Array.isArray(out)?out[0]:null,opts.token,ctl.signal,f);
    return{glb,seed:Array.isArray(out)&&Number.isFinite(Number(out[3]))?Number(out[3]):seed,stats:Array.isArray(out)&&out[2]&&typeof out[2]==='object'?out[2]:null,
      space:svc.label,version:svc.version,seconds:(Date.now()-t0)/1000};
  }catch(e){
    if(e&&e.name==='HyError')throw e;
    throw netError(e);
  }finally{clearTimeout(total);}
}

// ── Mensajes del Web Worker ───────────────────────────────────────────────
//  entra {type:'gen',id,png,quality,seed,octree,rembg,token} | {type:'check',id,quality,token} | {type:'cancel',id}
//  sale  {type:'status',id,phase,...} | {type:'done',id,glb,seed,stats,space,seconds}
//        | {type:'checked',id,...} | {type:'error',id,code,message,retrySeconds}
const _jobs=new Map();
async function handleMessage(m,post,env){
  if(!m||typeof m!=='object')return;
  if(m.type==='cancel'){const c=_jobs.get(m.id);if(c)c.abort();return;}
  if(m.type!=='gen'&&m.type!=='check')return;
  const ctl=new AbortController();_jobs.set(m.id,ctl);
  try{
    if(m.type==='check'){
      const r=await check({quality:m.quality,token:m.token,signal:ctl.signal,env});
      post({type:'checked',id:m.id,label:r.label,version:r.version,host:r.host});
      return;
    }
    if(!(m.png instanceof ArrayBuffer)||m.png.byteLength<8)throw new HyError('api','Foto no válida.');
    const r=await generate({png:m.png,quality:m.quality,seed:m.seed,octree:m.octree,rembg:m.rembg,token:m.token,signal:ctl.signal,env,
      onStatus:(phase,extra)=>post(Object.assign({type:'status',id:m.id,phase},extra))});
    post({type:'done',id:m.id,glb:r.glb,seed:r.seed,stats:r.stats,space:r.space,seconds:r.seconds},[r.glb]);
  }catch(e){
    const err=e&&e.name==='HyError'?e:netError(e);
    post({type:'error',id:m.id,code:err.code,message:err.message,retrySeconds:err.retrySeconds||0});
  }finally{_jobs.delete(m.id);}
}

const API={SPACES,API_NAME,HyError,check,generate,handleMessage,classifyServiceError,parseBlock,apiPrefix};
if(typeof module!=='undefined'&&module.exports)module.exports=API;
else if(typeof importScripts==='function'&&typeof self!=='undefined'){
  self.onmessage=e=>handleMessage(e.data,(msg,transfer)=>self.postMessage(msg,transfer||[]),{});
}else root.Foto3DHY=API;
})(typeof self!=='undefined'?self:(typeof window!=='undefined'?window:globalThis));
