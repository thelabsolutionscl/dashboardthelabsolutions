/* js/foto3d-worker.js — IA de profundidad del Escultor de fotos (Web Worker).
 *
 * transformers.js se carga desde jsDelivr. Ejecutarlo aquí y no en la página:
 *  - aísla código de terceros de localStorage y del DOM del dashboard (donde
 *    viven claves como proxy_key o printer_device_token);
 *  - la inferencia en CPU (1–3 s) no congela la interfaz;
 *  - las peticiones se procesan de a una: ONNX Runtime no admite dos `run`
 *    simultáneos sobre la misma sesión.
 *
 * Protocolo: entra {type:'depth', id, rgba(ArrayBuffer), w, h};
 * {type:'cancel', below} descarta lo que siga en cola con id menor.
 * sale {type:'progress', id, frac, total} | {type:'depth', id, data, w, h, label}
 *      | {type:'cancelled', id} | {type:'error', id, message}.
 */
const TJS_URL='https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
// Small es Apache-2.0. Base/Large de Depth Anything V2 son no comerciales: no usarlos.
const MODEL_ID='onnx-community/depth-anything-v2-small';

let T=null,pipe=null,label='',forceWasm=false,currentId=0;
const files={};
function progress_callback(e){
  if(!e||!e.file)return;
  if(e.status==='progress'&&e.total)files[e.file]={l:e.loaded||0,t:e.total};
  else if(e.status==='done'&&files[e.file])files[e.file].l=files[e.file].t;
  let l=0,t=0;for(const k in files){l+=files[k].l;t+=files[k].t;}
  self.postMessage({type:'progress',id:currentId,frac:t?l/t:0,total:t});
}
async function load(){
  if(pipe)return;
  if(!T){T=await import(TJS_URL);T.env.allowLocalModels=false;}
  let fp16=false;
  if(!forceWasm&&self.navigator&&self.navigator.gpu){
    try{const a=await self.navigator.gpu.requestAdapter();fp16=!!(a&&a.features&&a.features.has('shader-f16'));}catch(_){}
  }
  const tries=[];
  if(fp16)tries.push({device:'webgpu',dtype:'fp16',label:'GPU (WebGPU)'});
  tries.push({device:'wasm',dtype:'q8',label:'CPU (WASM)'});
  let last;
  for(const t of tries){
    try{pipe=await T.pipeline('depth-estimation',MODEL_ID,{device:t.device,dtype:t.dtype,progress_callback});label=t.label;return;}
    catch(e){last=e;console.warn('[Foto3D worker] backend '+t.device+' falló:',e);}
  }
  throw last||new Error('No se pudo cargar el modelo de profundidad');
}
function halfToFloat(h){
  const s=h&0x8000?-1:1,e=(h>>10)&31,f=h&1023;
  return e===0?s*Math.pow(2,-14)*f/1024:e===31?(f?NaN:s*Infinity):s*Math.pow(2,e-15)*(1+f/1024);
}
async function infer(rgba,w,h){
  const out=await pipe(new T.RawImage(rgba,w,h,4));
  const pd=(Array.isArray(out)?out[0]:out).predicted_depth;
  const raw=pd.data,dims=pd.dims.slice(-2);
  return{data:raw instanceof Uint16Array?Float32Array.from(raw,halfToFloat):Float32Array.from(raw),h:dims[0],w:dims[1]};
}
async function handle(m){
  currentId=m.id;
  const rgba=new Uint8ClampedArray(m.rgba);
  try{
    await load();
    let r;
    try{r=await infer(rgba,m.w,m.h);}
    catch(e){
      if(forceWasm)throw e;
      // Algunas GPU cargan el modelo fp16 pero fallan al ejecutar: se reintenta en CPU.
      console.warn('[Foto3D worker] inferencia en GPU falló, reintento en CPU:',e);
      forceWasm=true;pipe=null;await load();r=await infer(rgba,m.w,m.h);
    }
    self.postMessage({type:'depth',id:m.id,data:r.data,w:r.w,h:r.h,label},[r.data.buffer]);
  }catch(e){
    self.postMessage({type:'error',id:m.id,message:String(e&&e.message||e)});
  }
}
let chain=Promise.resolve(),cancelBelow=0;
self.onmessage=e=>{
  const m=e.data;
  if(m&&m.type==='cancel'&&m.below>0){cancelBelow=Math.max(cancelBelow,m.below);return;}
  if(!m||m.type!=='depth'||!(m.rgba instanceof ArrayBuffer)||!(m.w>0)||!(m.h>0))return;
  chain=chain.then(()=>{
    if(m.id<cancelBelow){self.postMessage({type:'cancelled',id:m.id});return;}
    return handle(m);
  });
};
