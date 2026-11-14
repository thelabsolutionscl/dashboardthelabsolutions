/* js/foto3d-worker.js — IA de profundidad del Escultor de fotos (Web Worker).
 *
 * transformers.js se carga desde jsDelivr. Ejecutarlo aquí y no en la página:
 *  - aísla código de terceros de localStorage y del DOM del dashboard (donde
 *    viven claves como proxy_key o printer_device_token);
 *  - la inferencia en CPU (1–3 s) no congela la interfaz;
 *  - las peticiones se procesan de a una: ONNX Runtime no admite dos `run`
 *    simultáneos sobre la misma sesión.
 *
 * Protocolo: entra {type:'depth', id, rgba(ArrayBuffer), w, h, quality: normal|alto|maximo};
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
// parche del ViT). 518 es la de entrenamiento y la que se usa por defecto.
// 770 y 1022 dan más detalle pero están fuera de lo que el modelo vio al
// entrenar y, en GPU con fp16, pueden desbordarse en algunos parches (valores
// basura o infinitos que salían como picos en la malla): son opcionales y, si
// una pasada sale sucia, se baja de resolución sola.
const RES_BY_QUALITY={normal:518,alto:770,maximo:1022},RES_CPU=518;
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
let lastDtype='';
async function infer(rgba,w,h){
  const out=await pipe(new T.RawImage(rgba,w,h,4));
  const pd=(Array.isArray(out)?out[0]:out).predicted_depth;
  const raw=pd.data,dims=pd.dims.slice(-2);
  lastDtype=String(pd.type||(raw&&raw.constructor&&raw.constructor.name)||'');
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
// Valores no finitos (desborde fp16) y atípicos groseros: se marcan como NaN.
// Devuelve la fracción marcada.
function sanitizePass(d){
  const n=d.length,fin=[];
  for(let i=0;i<n;i+=Math.max(1,Math.floor(n/20000)))if(Number.isFinite(d[i]))fin.push(d[i]);
  if(fin.length<16){d.fill(NaN);return 1;}
  fin.sort((a,b)=>a-b);
  const q=p=>fin[Math.min(fin.length-1,Math.floor(p*(fin.length-1)))],q1=q(.25),q3=q(.75),iqr=Math.max(1e-6,q3-q1),lo=q(.005)-4*iqr,hi=q(.995)+4*iqr;
  let bad=0;for(let i=0;i<n;i++){const v=d[i];if(!Number.isFinite(v)||v<lo||v>hi){d[i]=NaN;bad++;}}
  return bad/n;
}
// Rellena NaN con el promedio de vecinos válidos, creciendo hacia adentro.
function fillNaN(d,w,h){
  let left=0;for(let i=0;i<d.length;i++)if(Number.isNaN(d[i]))left++;
  for(let it=0;left&&it<256;it++){
    const nd=Float32Array.from(d);let changed=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;if(!Number.isNaN(d[i]))continue;
      let s=0,c=0;for(let j=-1;j<=1;j++)for(let k=-1;k<=1;k++){const yy=y+j,xx=x+k;if(yy<0||xx<0||yy>=h||xx>=w)continue;const v=d[yy*w+xx];if(!Number.isNaN(v)){s+=v;c++;}}
      if(c){nd[i]=s/c;changed++;}
    }
    d.set(nd);left-=changed;if(!changed)break;
  }
  if(left){for(let i=0;i<d.length;i++)if(Number.isNaN(d[i]))d[i]=0;}
  return d;
}
class DirtyPass extends Error{}
// ── Diagnóstico ───────────────────────────────────────────────────────────
// El modelo corre en la GPU de cada usuario y sus defectos no se pueden
// reproducir en las pruebas: estas tres medidas viajan con el resultado y se
// muestran bajo la foto, para saber qué pasó sin adivinar.
// Rango robusto (p2–p98) y cantidad de niveles distintos dentro de él: pocos
// niveles = salida cuantizada (fp16), que al estirar el relieve da escalones.
function depthLevels(d){
  const step=Math.max(1,Math.floor(d.length/60000)),v=[];
  for(let i=0;i<d.length;i+=step)if(Number.isFinite(d[i]))v.push(d[i]);
  if(v.length<16)return{range:0,levels:0};
  v.sort((a,b)=>a-b);
  const lo=v[Math.floor(.02*(v.length-1))],hi=v[Math.floor(.98*(v.length-1))],range=hi-lo;
  // paso típico: mediana de las diferencias positivas entre valores vecinos del tramo central
  const gaps=[];for(let i=Math.floor(v.length*.25);i<Math.floor(v.length*.75);i++){const g=v[i+1]-v[i];if(g>0)gaps.push(g);}
  if(!gaps.length||!(range>0))return{range,levels:1};
  gaps.sort((a,b)=>a-b);
  return{range,levels:Math.min(99999,Math.round(range/gaps[gaps.length>>1]))};
}
// Amplitud de la componente periódica de periodo P a lo largo de un eje, sumada
// en fase sobre todas las filas (o columnas) con ventana de Hann.
function rippleAt(d,w,h,P,alongX){
  const x0=Math.floor(w*.15),x1=Math.ceil(w*.85),y0=Math.floor(h*.15),y1=Math.ceil(h*.85);
  let re=0,im=0,ws=0;const k=2*Math.PI/P;
  if(alongX){const n=x1-x0;for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x++){const v=d[y*w+x];if(!Number.isFinite(v))continue;const win=.5-.5*Math.cos(2*Math.PI*(x-x0)/(n-1));re+=v*win*Math.cos(k*x);im-=v*win*Math.sin(k*x);ws+=win;}}
  else{const n=y1-y0;for(let x=x0;x<x1;x+=2)for(let y=y0;y<y1;y++){const v=d[y*w+x];if(!Number.isFinite(v))continue;const win=.5-.5*Math.cos(2*Math.PI*(y-y0)/(n-1));re+=v*win*Math.cos(k*y);im-=v*win*Math.sin(k*y);ws+=win;}}
  return ws?2*Math.hypot(re,im)/ws:0;
}
// Ondas con el paso de los parches del ViT, como fracción del rango. Se resta lo
// que hay en periodos vecinos (bordes del sujeto) para medir sólo el exceso.
function patchRipple(d,w,h,Px,Py,range){
  if(!(range>0))return 0;
  const ex=(P,ax)=>Math.max(0,rippleAt(d,w,h,P,ax)-(rippleAt(d,w,h,P*1.37,ax)+rippleAt(d,w,h,P*.73,ax))/2);
  return Math.max(ex(Px,true),ex(Py,false))/range;
}
// Varias pasadas promediadas (test-time augmentation). El ViT deja ondas
// periódicas con el paso de sus parches de 14 px: corriendo el contenido medio
// parche (y espejándolo) las ondas caen en contrafase y al promediar se
// cancelan, mientras el relieve real se mantiene. El corrimiento NO cambia el
// tamaño de la imagen: si cambiara, cambiaría la escala y con ella el periodo
// de las ondas, que dejarían de cancelarse. Cada pasada es profundidad relativa
// (escala y desfase propios): se alinea a la primera por mínimos cuadrados y
// se combina con la MEDIANA por pixel: una mancha basura que sale en una sola
// pasada se descarta en vez de promediarse.
async function inferTTA(rgba,w,h,L,passes,maxDirty){
  const[mw,mh]=modelDims(w,h,L),hx=Math.max(1,Math.round(7*w/mw)),hy=Math.max(1,Math.round(7*h/mh));
  const plan=[{x:0,y:0,flip:false},{x:hx,y:hy,flip:false},{x:0,y:0,flip:true},{x:hx,y:hy,flip:true}].slice(0,passes);
  const n=w*h,runs=[],diag={dtype:'',levels:0,rippleIn:0,rippleOut:0,dirty:0};let ref=null;
  const Px=14*w/mw,Py=14*h/mh;
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
    const d=await infer(img,w,h),dirty=sanitizePass(d);
    if(dirty>maxDirty)throw new DirtyPass('pasada sucia a '+L+' px');
    diag.dirty=Math.max(diag.dirty,dirty);
    if(!ref){const lv=depthLevels(d);diag.dtype=lastDtype;diag.levels=lv.levels;diag.range=lv.range;diag.rippleIn=patchRipple(d,w,h,Px,Py,lv.range);}
    const o=new Float32Array(n).fill(NaN);
    for(let y=0;y+p.y<h;y++)for(let x=0;x+p.x<w;x++){
      const cx=p.flip?w-1-x:x;o[y*w+cx]=d[(y+p.y)*w+x+p.x];
    }
    if(ref){
      let mx=0,my=0,c=0;for(let i=0;i<n;i++)if(!Number.isNaN(o[i])&&!Number.isNaN(ref[i])){mx+=o[i];my+=ref[i];c++;}
      if(c){mx/=c;my/=c;
        let cv=0,vr=0;for(let i=0;i<n;i++)if(!Number.isNaN(o[i])&&!Number.isNaN(ref[i])){const dx=o[i]-mx;cv+=dx*(ref[i]-my);vr+=dx*dx;}
        const a=vr>1e-12?cv/vr:1,b=my-a*mx;for(let i=0;i<n;i++)o[i]=a*o[i]+b;
      }
    }else ref=o;
    runs.push(o);
  }
  const out=new Float32Array(n),v=new Float32Array(runs.length);
  for(let i=0;i<n;i++){
    let k=0;for(const r of runs)if(!Number.isNaN(r[i]))v[k++]=r[i];
    if(!k){out[i]=NaN;continue;}
    const s=v.subarray(0,k).sort();out[i]=k&1?s[k>>1]:(s[k/2-1]+s[k/2])/2;
  }
  fillNaN(out,w,h);
  diag.rippleOut=patchRipple(out,w,h,Px,Py,depthLevels(out).range);
  out.diag=diag;
  return out;
}
async function run(rgba,w,h,quality){
  const gpu=label.indexOf('GPU')===0,passes=gpu?4:2;
  if(!gpu){setModelRes(RES_CPU);const data=await inferTTA(rgba,w,h,RES_CPU,passes,1);return{data,diag:data.diag,res:RES_CPU,passes};}
  // Resoluciones a probar de mayor a menor; 518 siempre se acepta (saneada).
  const want=RES_BY_QUALITY[quality]||RES_BY_QUALITY.normal,ladder=[1022,770,518].filter(L=>L<=want);
  let last;
  for(const L of ladder){
    try{setModelRes(L);const data=await inferTTA(rgba,w,h,L,passes,L===518?1:.005);return{data,diag:data.diag,res:L,passes,asked:want};}
    catch(e){
      // Sin memoria o pasada sucia (desborde fp16): se baja de resolución en la misma GPU.
      last=e;console.warn('[Foto3D worker] GPU a '+L+' px falló ('+(e&&e.message)+'), bajo de resolución');
    }
  }
  throw last;
}
async function handle(m){
  currentId=m.id;
  const rgba=new Uint8ClampedArray(m.rgba);
  try{
    await load();
    let r;
    try{r=await run(rgba,m.w,m.h,m.quality);}
    catch(e){
      if(forceWasm)throw e;
      // Algunas GPU cargan el modelo fp16 pero fallan al ejecutar: se reintenta en CPU.
      console.warn('[Foto3D worker] inferencia en GPU falló, reintento en CPU:',e);
      forceWasm=true;pipe=null;await load();r=await run(rgba,m.w,m.h,m.quality);
    }
    self.postMessage({type:'depth',id:m.id,data:r.data,w:m.w,h:m.h,label,res:r.res,passes:r.passes,asked:r.asked||r.res,diag:r.diag||null},[r.data.buffer]);
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
