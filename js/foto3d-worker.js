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
// Resolución de entrada del modelo (lado mayor, múltiplo de 14 = tamaño de
// parche del ViT). 518 es la de entrenamiento; con GPU se usa 1022 para ver
// cuatro veces más píxeles de la foto (más definición en caras y pliegues).
const RES_GPU=1022,RES_GPU_LOW=770,RES_CPU=518;
let gpuRes=RES_GPU;
function setModelRes(L){
  const ip=pipe&&pipe.processor&&(pipe.processor.image_processor||pipe.processor.feature_extractor);
  if(ip&&ip.size)ip.size={width:L,height:L};
}
function resample(src,sw,sh,dw,dh){
  if(sw===dw&&sh===dh)return src;
  const o=new Float32Array(dw*dh);
  for(let y=0;y<dh;y++){
    const fy=Math.min(sh-1,Math.max(0,(y+.5)*sh/dh-.5)),y0=Math.floor(fy),y1=Math.min(sh-1,y0+1),ty=fy-y0;
    for(let x=0;x<dw;x++){
      const fx=Math.min(sw-1,Math.max(0,(x+.5)*sw/dw-.5)),x0=Math.floor(fx),x1=Math.min(sw-1,x0+1),tx=fx-x0;
      o[y*dw+x]=(src[y0*sw+x0]*(1-tx)+src[y0*sw+x1]*tx)*(1-ty)+(src[y1*sw+x0]*(1-tx)+src[y1*sw+x1]*tx)*ty;
    }
  }
  return o;
}
async function infer(rgba,w,h){
  const out=await pipe(new T.RawImage(rgba,w,h,4));
  const pd=(Array.isArray(out)?out[0]:out).predicted_depth;
  const raw=pd.data,dims=pd.dims.slice(-2);
  const data=raw instanceof Uint16Array?Float32Array.from(raw,halfToFloat):Float32Array.from(raw);
  return resample(data,dims[1],dims[0],w,h);
}
// Tamaño al que el procesador de DPT escala la imagen para un `size` L×L: elige
// la escala más cercana a 1 entre ajustar ancho o alto y redondea a múltiplos
// de 14 (misma regla que transformers.js 3.x, get_resize_output_image_size).
function modelDims(W,H,L){
  let sw=L/W,sh=L/H;
  if(Math.abs(1-sw)<Math.abs(1-sh))sh=sw;else sw=sh;
  const r=v=>Math.max(14,Math.round(v/14)*14);
  return[r(sw*W),r(sh*H)];
}
// Varias pasadas promediadas (test-time augmentation). El ViT deja ondas
// periódicas con el paso de sus parches de 14 px: corriendo el contenido medio
// parche (y espejándolo) las ondas caen en contrafase y al promediar se
// cancelan, mientras el relieve real se mantiene. El corrimiento NO cambia el
// tamaño de la imagen: si cambiara, cambiaría la escala y con ella el periodo
// de las ondas, que dejarían de cancelarse. Cada pasada es profundidad relativa
// (escala y desfase propios): se alinea a la primera por mínimos cuadrados.
async function inferTTA(rgba,w,h,L,passes){
  const[mw,mh]=modelDims(w,h,L),hx=Math.max(1,Math.round(7*w/mw)),hy=Math.max(1,Math.round(7*h/mh));
  const plan=[{x:0,y:0,flip:false},{x:hx,y:hy,flip:false},{x:0,y:0,flip:true},{x:hx,y:hy,flip:true}].slice(0,passes);
  const n=w*h,acc=new Float32Array(n),wsum=new Float32Array(n);let ref=null;
  for(const p of plan){
    // Contenido corrido (x, y) px: se replica el borde que entra y se pierde el que sale.
    const img=new Uint8ClampedArray(n*4);
    for(let y=0;y<h;y++){
      const sy=Math.max(0,y-p.y);
      for(let x=0;x<w;x++){
        let sx=Math.max(0,x-p.x);if(p.flip)sx=w-1-sx;
        const a=(sy*w+sx)*4,b=(y*w+x)*4;img[b]=rgba[a];img[b+1]=rgba[a+1];img[b+2]=rgba[a+2];img[b+3]=255;
      }
    }
    const d=await infer(img,w,h),o=new Float32Array(n),valid=new Uint8Array(n);
    for(let y=0;y+p.y<h;y++)for(let x=0;x+p.x<w;x++){
      const cx=p.flip?w-1-x:x;o[y*w+cx]=d[(y+p.y)*w+x+p.x];valid[y*w+cx]=1;
    }
    let a=1,b=0;
    if(ref){
      let mx=0,my=0,c=0;for(let i=0;i<n;i++)if(valid[i]){mx+=o[i];my+=ref[i];c++;}mx/=c;my/=c;
      let cv=0,vr=0;for(let i=0;i<n;i++)if(valid[i]){const dx=o[i]-mx;cv+=dx*(ref[i]-my);vr+=dx*dx;}
      a=vr>1e-12?cv/vr:1;b=my-a*mx;
    }else ref=o;
    for(let i=0;i<n;i++)if(valid[i]){acc[i]+=a*o[i]+b;wsum[i]++;}
  }
  for(let i=0;i<n;i++)acc[i]=wsum[i]?acc[i]/wsum[i]:ref[i];
  return acc;
}
async function run(rgba,w,h){
  const gpu=label.indexOf('GPU')===0,passes=gpu?4:2;
  if(!gpu){setModelRes(RES_CPU);return{data:await inferTTA(rgba,w,h,RES_CPU,passes),res:RES_CPU,passes};}
  try{setModelRes(gpuRes);return{data:await inferTTA(rgba,w,h,gpuRes,passes),res:gpuRes,passes};}
  catch(e){
    // A 1022 px una GPU modesta puede quedarse sin memoria: antes de pasar a
    // CPU (518 px) se intenta una resolución intermedia en la misma GPU.
    if(gpuRes===RES_GPU_LOW)throw e;
    console.warn('[Foto3D worker] GPU a '+gpuRes+' px falló, reintento a '+RES_GPU_LOW+' px:',e);
    gpuRes=RES_GPU_LOW;setModelRes(gpuRes);
    return{data:await inferTTA(rgba,w,h,gpuRes,passes),res:gpuRes,passes};
  }
}
async function handle(m){
  currentId=m.id;
  const rgba=new Uint8ClampedArray(m.rgba);
  try{
    await load();
    let r;
    try{r=await run(rgba,m.w,m.h);}
    catch(e){
      if(forceWasm)throw e;
      // Algunas GPU cargan el modelo fp16 pero fallan al ejecutar: se reintenta en CPU.
      console.warn('[Foto3D worker] inferencia en GPU falló, reintento en CPU:',e);
      forceWasm=true;pipe=null;await load();r=await run(rgba,m.w,m.h);
    }
    self.postMessage({type:'depth',id:m.id,data:r.data,w:m.w,h:m.h,label,res:r.res,passes:r.passes},[r.data.buffer]);
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
