/* js/foto3d.js — Escultor de fotos: una imagen → STL imprimible.
 *
 * Todo corre en el navegador. La profundidad la estima Depth Anything V2 Small
 * (Apache-2.0) con transformers.js: el modelo se descarga una vez desde Hugging
 * Face y queda en la caché del navegador; la foto nunca sale del equipo. Si la
 * IA no carga (sin red, CDN bloqueado) la herramienta sigue funcionando con el
 * brillo de la imagen como relieve.
 *
 * Arquitectura y decisiones: docs/ESCULTOR_FOTOS.md.
 *
 * El archivo tiene dos mitades:
 *  - CORE: geometría pura sin DOM (recorte, profundidad, malla cerrada, STL).
 *    Se exporta con module.exports para los tests de Node.
 *  - UI: vista "escultor" del Taller (data-maq-view="escultor"), visor WebGL
 *    y carga perezosa del modelo de IA.
 */
(function(root){
'use strict';

/* ══════════════════════════════════════════════════════════════════════
 *  CORE — geometría pura
 * ══════════════════════════════════════════════════════════════════════ */

const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const smoothstep=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};

// ── Muestreo: tabla de áreas sumadas para promediar sin aliasing ──────────
// Al bajar una foto de 768 px a una grilla de 220 celdas, cada celda debe
// promediar todos los píxeles que cubre; un muestreo bilineal simple produce
// ruido y escalones en el relieve.
function makeSAT(src,w,h){
  const W=w+1,sat=new Float64Array(W*(h+1));
  for(let y=0;y<h;y++){
    let row=0;
    for(let x=0;x<w;x++){row+=src[y*w+x];sat[(y+1)*W+x+1]=sat[y*W+x+1]+row;}
  }
  return{sat,w,h};
}
function _satAt(S,x,y){
  // Interpolación bilineal de la integral en coordenadas fraccionarias.
  const W=S.w+1;
  x=clamp(x,0,S.w);y=clamp(y,0,S.h);
  const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(S.w,x0+1),y1=Math.min(S.h,y0+1),tx=x-x0,ty=y-y0,s=S.sat;
  const a=s[y0*W+x0],b=s[y0*W+x1],c=s[y1*W+x0],d=s[y1*W+x1];
  return(a*(1-tx)+b*tx)*(1-ty)+(c*(1-tx)+d*tx)*ty;
}
function _bilinear(src,w,h,fx,fy){
  fx=clamp(fx,0,w-1);fy=clamp(fy,0,h-1);
  const x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),tx=fx-x0,ty=fy-y0;
  return(src[y0*w+x0]*(1-tx)+src[y0*w+x1]*tx)*(1-ty)+(src[y1*w+x0]*(1-tx)+src[y1*w+x1]*tx)*ty;
}
// Muestrea el rectángulo (rx,ry,rw,rh) de la fuente en una grilla gw×gh.
// Fuera de la imagen devuelve `outside` (relleno de márgenes).
function sampleRect(src,S,sw,sh,rx,ry,rw,rh,gw,gh,outside){
  const out=new Float32Array(gw*gh),cw=rw/gw,ch=rh/gh,area=cw*ch,down=cw>1.01||ch>1.01;
  for(let j=0;j<gh;j++){
    const y0=ry+j*ch,y1=y0+ch,cy=(y0+y1)/2;
    for(let i=0;i<gw;i++){
      const x0=rx+i*cw,x1=x0+cw,cx=(x0+x1)/2;
      if(cx<0||cy<0||cx>sw||cy>sh){out[j*gw+i]=outside;continue;}
      if(down){
        const ax0=clamp(x0,0,sw),ax1=clamp(x1,0,sw),ay0=clamp(y0,0,sh),ay1=clamp(y1,0,sh);
        const a=(ax1-ax0)*(ay1-ay0);
        if(a<=1e-9){out[j*gw+i]=outside;continue;}
        const sum=_satAt(S,ax1,ay1)-_satAt(S,ax0,ay1)-_satAt(S,ax1,ay0)+_satAt(S,ax0,ay0);
        // La parte de la celda que cae fuera de la imagen cuenta como `outside`.
        out[j*gw+i]=(sum+outside*(area-a))/area;
      }else out[j*gw+i]=_bilinear(src,sw,sh,cx-.5,cy-.5);
    }
  }
  return out;
}

// ── Filtros ───────────────────────────────────────────────────────────────
// Desenfoque de caja con bordes replicados (suma móvil, O(n) sin importar el radio).
function _boxBlurH(src,dst,w,h,r){
  const k=1/(2*r+1);
  for(let y=0;y<h;y++){
    const row=y*w;let acc=src[row]*(r+1);
    for(let x=1;x<=r;x++)acc+=src[row+Math.min(w-1,x)];
    for(let x=0;x<w;x++){
      dst[row+x]=acc*k;
      acc+=src[row+Math.min(w-1,x+r+1)]-src[row+Math.max(0,x-r)];
    }
  }
}
function _boxBlurV(src,dst,w,h,r){
  const k=1/(2*r+1);
  for(let x=0;x<w;x++){
    let acc=src[x]*(r+1);
    for(let y=1;y<=r;y++)acc+=src[Math.min(h-1,y)*w+x];
    for(let y=0;y<h;y++){
      dst[y*w+x]=acc*k;
      acc+=src[Math.min(h-1,y+r+1)*w+x]-src[Math.max(0,y-r)*w+x];
    }
  }
}
function gaussianBlur(src,w,h,sigma){
  if(!(sigma>0.05))return Float32Array.from(src);
  if(sigma>3){
    // Tres pasadas de caja ≈ gaussiana (error < 3 %) en tiempo constante por píxel.
    const wi=Math.sqrt(12*sigma*sigma/3+1);let wl=Math.floor(wi);if(wl%2===0)wl--;
    const m=Math.round((12*sigma*sigma-3*wl*wl-12*wl-9)/(-4*wl-4));
    let a=Float32Array.from(src),b=new Float32Array(w*h);
    for(let i=0;i<3;i++){const r=((i<m?wl:wl+2)-1)/2;_boxBlurH(a,b,w,h,r);_boxBlurV(b,a,w,h,r);}
    return a;
  }
  const r=Math.max(1,Math.ceil(sigma*3)),k=new Float32Array(2*r+1);let s=0;
  for(let i=-r;i<=r;i++){const v=Math.exp(-(i*i)/(2*sigma*sigma));k[i+r]=v;s+=v;}
  for(let i=0;i<k.length;i++)k[i]/=s;
  const tmp=new Float32Array(w*h),out=new Float32Array(w*h);
  for(let y=0;y<h;y++){const row=y*w;for(let x=0;x<w;x++){let acc=0;for(let t=-r;t<=r;t++){let xx=x+t;xx=xx<0?0:xx>=w?w-1:xx;acc+=src[row+xx]*k[t+r];}tmp[row+x]=acc;}}
  for(let y=0;y<h;y++){for(let x=0;x<w;x++){let acc=0;for(let t=-r;t<=r;t++){let yy=y+t;yy=yy<0?0:yy>=h?h-1:yy;acc+=tmp[yy*w+x]*k[t+r];}out[y*w+x]=acc;}}
  return out;
}
// Mediana 3×3 sólo con vecinos de la máscara: quita picos de una celda sin
// redondear cantos (un escalón recto conserva su mayoría a cada lado).
function maskedMedian3(p,mask,w,h){
  const out=Float32Array.from(p),v=new Float32Array(9);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;if(!mask[i])continue;let k=0;
    for(let j=-1;j<=1;j++)for(let q=-1;q<=1;q++){const yy=y+j,xx=x+q;if(yy<0||xx<0||yy>=h||xx>=w)continue;const c=yy*w+xx;if(mask[c])v[k++]=p[c];}
    const s=v.subarray(0,k).sort();out[i]=k&1?s[k>>1]:(s[k/2-1]+s[k/2])/2;
  }
  return out;
}
function _boxMean(a,w,h,r){const t=new Float32Array(w*h),o=new Float32Array(w*h);_boxBlurH(a,t,w,h,r);_boxBlurV(t,o,w,h,r);return o;}
// Suavizado que respeta cantos (filtro guiado de He et al., guiado por la propia
// profundidad y sólo dentro de la máscara). Donde la variación local es menor que
// √eps (ruido, ondas del modelo) promedia; donde hay un escalón real (un brazo
// delante del cuerpo, la arista de una faceta) lo conserva. Un gaussiano borraba ambos.
function guidedSmooth(p,mask,w,h,r,eps){
  const n=w*h,m=new Float32Array(n),pm=new Float32Array(n),ppm=new Float32Array(n);
  for(let i=0;i<n;i++)if(mask[i]){m[i]=1;pm[i]=p[i];ppm[i]=p[i]*p[i];}
  const N=_boxMean(m,w,h,r),MP=_boxMean(pm,w,h,r),MPP=_boxMean(ppm,w,h,r),A=new Float32Array(n),B=new Float32Array(n);
  for(let i=0;i<n;i++){
    if(!mask[i]||N[i]<1e-6)continue;
    const mu=MP[i]/N[i],v=Math.max(0,MPP[i]/N[i]-mu*mu),a=v/(v+eps);
    A[i]=a;B[i]=mu-a*mu;
  }
  const MA=_boxMean(A,w,h,r),MB=_boxMean(B,w,h,r),out=Float32Array.from(p);
  for(let i=0;i<n;i++)if(mask[i]&&N[i]>1e-6)out[i]=(MA[i]*p[i]+MB[i])/N[i];
  return out;
}
// Desenfoque normalizado: el fondo no "contamina" el borde del sujeto.
function maskedBlur(src,mask,w,h,sigma){
  if(!(sigma>0.05))return Float32Array.from(src);
  const a=new Float32Array(w*h),m=new Float32Array(w*h);
  for(let i=0;i<w*h;i++){if(mask[i]){a[i]=src[i];m[i]=1;}}
  const ba=gaussianBlur(a,w,h,sigma),bm=gaussianBlur(m,w,h,sigma),out=Float32Array.from(src);
  for(let i=0;i<w*h;i++)if(mask[i]&&bm[i]>1e-6)out[i]=ba[i]/bm[i];
  return out;
}
function percentiles(src,mask,ps){
  const vals=[];
  for(let i=0;i<src.length;i++)if(!mask||mask[i])vals.push(src[i]);
  if(!vals.length)return ps.map(()=>0);
  vals.sort((a,b)=>a-b);
  return ps.map(p=>vals[clamp(Math.round(p*(vals.length-1)),0,vals.length-1)]);
}
function otsu(src,bins=128){
  const hist=new Float64Array(bins);let n=0;
  for(let i=0;i<src.length;i++){const v=src[i];if(!(v>=0&&v<=1))continue;hist[Math.min(bins-1,Math.floor(v*bins))]++;n++;}
  if(!n)return .5;
  let sum=0;for(let i=0;i<bins;i++)sum+=i*hist[i];
  let sumB=0,wB=0,best=-1,thr=bins/2;
  for(let t=0;t<bins;t++){
    wB+=hist[t];if(!wB)continue;const wF=n-wB;if(!wF)break;
    sumB+=t*hist[t];const mB=sumB/wB,mF=(sum-sumB)/wF,between=wB*wF*(mB-mF)*(mB-mF);
    if(between>best){best=between;thr=t;}
  }
  return(thr+1)/bins;
}

// ── Transformada de distancia euclidiana exacta (Felzenszwalb) ────────────
const _INF=1e20;
function _edt1d(f,n,d,v,z){
  let k=0;v[0]=0;z[0]=-_INF;z[1]=_INF;
  for(let q=1;q<n;q++){
    let s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]);
    while(s<=z[k]){k--;s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]);}
    k++;v[k]=q;z[k]=s;z[k+1]=_INF;
  }
  k=0;
  for(let q=0;q<n;q++){while(z[k+1]<q)k++;d[q]=(q-v[k])*(q-v[k])+f[v[k]];}
}
function _edt2d(f,w,h){
  const n=Math.max(w,h),fz=new Float64Array(n),d=new Float64Array(n),v=new Int32Array(n),z=new Float64Array(n+1);
  for(let x=0;x<w;x++){for(let y=0;y<h;y++)fz[y]=f[y*w+x];_edt1d(fz,h,d,v,z);for(let y=0;y<h;y++)f[y*w+x]=d[y];}
  for(let y=0;y<h;y++){for(let x=0;x<w;x++)fz[x]=f[y*w+x];_edt1d(fz,w,d,v,z);for(let x=0;x<w;x++)f[y*w+x]=d[x];}
  return f;
}
// Distancia (en celdas) de cada celda interior al exterior más cercano. El
// borde de la grilla cuenta como exterior.
function distanceInside(mask,w,h){
  const W=w+2,H=h+2,f=new Float64Array(W*H);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x])f[(y+1)*W+x+1]=_INF;
  _edt2d(f,W,H);
  const out=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)out[y*w+x]=mask[y*w+x]?Math.sqrt(f[(y+1)*W+x+1]):0;
  return out;
}
// Distancia de cada celda a la celda interior más cercana (0 dentro).
function distanceOutside(mask,w,h){
  const f=new Float64Array(w*h);let any=false;
  for(let i=0;i<w*h;i++){if(mask[i])any=true;else f[i]=_INF;}
  const out=new Float32Array(w*h);
  if(!any){out.fill(_INF);return out;}
  _edt2d(f,w,h);
  for(let i=0;i<w*h;i++)out[i]=Math.sqrt(f[i]);
  return out;
}
function erode(mask,w,h,r){const d=distanceInside(mask,w,h),o=new Uint8Array(w*h);for(let i=0;i<w*h;i++)o[i]=d[i]>r?1:0;return o;}
function dilate(mask,w,h,r){const d=distanceOutside(mask,w,h),o=new Uint8Array(w*h);for(let i=0;i<w*h;i++)o[i]=d[i]<=r?1:0;return o;}
function openMask(mask,w,h,r){return r>0?dilate(erode(mask,w,h,r),w,h,r):mask;}
function closeMask(mask,w,h,r){return r>0?erode(dilate(mask,w,h,r),w,h,r):mask;}

// ── Componentes conexos (4-vecindad) ──────────────────────────────────────
function labelComponents(mask,w,h,value){
  const lab=new Int32Array(w*h).fill(-1),sizes=[],touches=[],stack=new Int32Array(w*h);
  let n=0;
  for(let s=0;s<w*h;s++){
    if(mask[s]!==value||lab[s]!==-1)continue;
    let sp=0,size=0,edge=false;stack[sp++]=s;lab[s]=n;
    while(sp){
      const p=stack[--sp],x=p%w,y=(p/w)|0;size++;
      if(x===0||y===0||x===w-1||y===h-1)edge=true;
      if(x>0&&mask[p-1]===value&&lab[p-1]===-1){lab[p-1]=n;stack[sp++]=p-1;}
      if(x<w-1&&mask[p+1]===value&&lab[p+1]===-1){lab[p+1]=n;stack[sp++]=p+1;}
      if(y>0&&mask[p-w]===value&&lab[p-w]===-1){lab[p-w]=n;stack[sp++]=p-w;}
      if(y<h-1&&mask[p+w]===value&&lab[p+w]===-1){lab[p+w]=n;stack[sp++]=p+w;}
    }
    sizes.push(size);touches.push(edge);n++;
  }
  return{lab,sizes,touches};
}
// La pieza debe salir en un solo cuerpo: se conserva el componente mayor.
function keepLargest(mask,w,h){
  const{lab,sizes}=labelComponents(mask,w,h,1);
  if(sizes.length<=1)return mask;
  let best=0;for(let i=1;i<sizes.length;i++)if(sizes[i]>sizes[best])best=i;
  const o=new Uint8Array(w*h);for(let i=0;i<w*h;i++)o[i]=lab[i]===best?1:0;return o;
}
// Rellena agujeros interiores pequeños (ruido); los grandes (entre brazo y
// cuerpo, por ejemplo) se respetan.
function fillHoles(mask,w,h,maxArea){
  const{lab,sizes,touches}=labelComponents(mask,w,h,0),o=Uint8Array.from(mask);
  for(let i=0;i<w*h;i++){const l=lab[i];if(l>=0&&!touches[l]&&sizes[l]<=maxArea)o[i]=1;}
  return o;
}
// Dos celdas que sólo se tocan por la esquina producen una arista con cuatro
// caras (malla no-manifold). Se elimina rellenando una de las celdas vacías.
function fixDiagonals(mask,w,h){
  const m=Uint8Array.from(mask);
  for(let pass=0;pass<32;pass++){
    let changed=false;
    for(let y=0;y<h-1;y++)for(let x=0;x<w-1;x++){
      const i=y*w+x,a=m[i],b=m[i+1],c=m[i+w],d=m[i+w+1];
      if(a&&d&&!b&&!c){m[i+1]=1;changed=true;}
      else if(b&&c&&!a&&!d){m[i]=1;changed=true;}
    }
    if(!changed)break;
  }
  return m;
}
function maskBBox(mask,w,h){
  let x0=w,y0=h,x1=-1,y1=-1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x]){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
  return x1<0?null:{x0,y0,x1,y1};
}
function maskArea(mask){let n=0;for(let i=0;i<mask.length;i++)n+=mask[i]?1:0;return n;}
function cleanMask(mask,w,h,opts={}){
  const r=opts.radius==null?1:opts.radius;
  let m=closeMask(openMask(mask,w,h,r),w,h,r);
  if(opts.single!==false)m=keepLargest(m,w,h);
  const area=maskArea(m);
  m=fillHoles(m,w,h,Math.max(4,Math.round(area*(opts.holeFrac==null?.015:opts.holeFrac))));
  return fixDiagonals(m,w,h);
}
function diskMask(w,h,cx,cy,r){
  const o=new Uint8Array(w*h);
  for(let y=Math.max(0,Math.floor(cy-r-1));y<=Math.min(h-1,Math.ceil(cy+r+1));y++)
    for(let x=Math.max(0,Math.floor(cx-r-1));x<=Math.min(w-1,Math.ceil(cx+r+1));x++){
      const dx=x+.5-cx,dy=y+.5-cy;if(dx*dx+dy*dy<=r*r)o[y*w+x]=1;
    }
  return o;
}
// Superelipse inscrita en la grilla: n=2 óvalo, n≈5 rectángulo redondeado.
function superellipseMask(w,h,n){
  const o=new Uint8Array(w*h),cx=w/2,cy=h/2;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const u=Math.abs((x+.5-cx)/cx),v=Math.abs((y+.5-cy)/cy);
    if(Math.pow(u,n)+Math.pow(v,n)<=1)o[y*w+x]=1;
  }
  return o;
}

// Argolla del llavero: sobre el punto más alto del sujeto (entre dos orejas a
// la misma altura, la más cercana al centro) y bajando hasta que el aro
// se apoye en al menos ~6 mm² de pieza; si no, el aro quedaría suelto.
function placeRing(subject,w,h,px,holeR,ringR){
  const bb=maskBBox(subject,w,h);if(!bb)return null;
  let sx=0,sc=0;
  for(let y=bb.y0;y<=bb.y1;y++)for(let x=bb.x0;x<=bb.x1;x++)if(subject[y*w+x]){sx+=x+.5;sc++;}
  const mid=sx/sc;let col=-1,colTop=0,best=Infinity,bestD=Infinity;
  for(let x=bb.x0;x<=bb.x1;x++){
    let t=-1;for(let y=bb.y0;y<=bb.y1;y++)if(subject[y*w+x]){t=y;break;}
    if(t<0)continue;
    const rank=t-bb.y0<=2?bb.y0:t,d=Math.abs(x+.5-mid);
    if(rank<best||(rank===best&&d<bestD)){best=rank;bestD=d;col=x;colTop=t;}
  }
  const rr=ringR/px,hr=holeR/px,need=Math.max(4,6/(px*px)),cx=col+.5;
  let cy=colTop-(holeR+.8)/px;
  for(let step=0,max=Math.ceil(rr+hr)+2;step<=max;step++,cy+=1){
    let ov=0;
    for(let y=Math.max(0,Math.floor(cy-rr));y<=Math.min(h-1,Math.ceil(cy+rr));y++)
      for(let x=Math.max(0,Math.floor(cx-rr));x<=Math.min(w-1,Math.ceil(cx+rr));x++){
        const dx=x+.5-cx,dy=y+.5-cy,d2=dx*dx+dy*dy;
        if(d2<=rr*rr&&d2>hr*hr&&subject[y*w+x])ov++;
      }
    if(ov>=need)break;
  }
  return{cx,cy};
}

// ── Contorno suave ────────────────────────────────────────────────────────
// La máscara es binaria por celda: su borde es una escalera. Se calcula una
// distancia con signo (+ dentro, − fuera, 0 en el borde), se suaviza y los
// vértices del borde se corren (≤ 0,45 celda) hasta su nivel 0. La topología no
// cambia, así que la malla sigue cerrada; sólo desaparecen los escalones.
function signedDistance(mask,w,h){
  const din=distanceInside(mask,w,h),dout=distanceOutside(mask,w,h),o=new Float32Array(w*h);
  for(let i=0;i<w*h;i++)o[i]=mask[i]?din[i]-.5:-(Math.min(dout[i],64)-.5);
  return o;
}
// Bilineal sobre centros de celda; (x, y) en unidades de celda con el centro
// de la celda (0,0) en (0,0). Fuera de la grilla vale `outside`.
function sampleCells(f,w,h,x,y,outside){
  const x0=Math.floor(x),y0=Math.floor(y),tx=x-x0,ty=y-y0;
  const at=(i,j)=>(i<0||j<0||i>=w||j>=h)?outside:f[j*w+i];
  return(at(x0,y0)*(1-tx)+at(x0+1,y0)*tx)*(1-ty)+(at(x0,y0+1)*(1-tx)+at(x0+1,y0+1)*tx)*ty;
}
function vertexCounts(mask,w,h){
  const VW=w+1,cnt=new Uint8Array(VW*(h+1));
  for(let j=0;j<h;j++)for(let i=0;i<w;i++)if(mask[j*w+i]){const v=j*VW+i;cnt[v]++;cnt[v+1]++;cnt[v+VW]++;cnt[v+VW+1]++;}
  return cnt;
}
function snapContour(mask,w,h,phi,cnt){
  const VW=w+1,nv=VW*(h+1),ox=new Float32Array(nv),oy=new Float32Array(nv);
  const C=(i,j)=>(i<0||j<0||i>=w||j>=h)?-1:phi[j*w+i];
  for(let j=0;j<=h;j++)for(let i=0;i<=w;i++){
    const v=j*VW+i;if(!(cnt[v]>0&&cnt[v]<4))continue;
    const a=C(i-1,j-1),b=C(i,j-1),c=C(i-1,j),d=C(i,j);
    const f=(a+b+c+d)/4,gx=((b+d)-(a+c))/2,gy=((c+d)-(a+b))/2,g2=gx*gx+gy*gy;
    if(g2<1e-6)continue;
    let dx=-f*gx/g2,dy=-f*gy/g2;const L=Math.hypot(dx,dy);
    if(L>.45){dx*=.45/L;dy*=.45/L;}
    ox[v]=dx;oy[v]=dy;
  }
  return{ox,oy};
}
// Rellena valores poco fiables (p. ej. huecos entre rayos que se cerraron:
// traen la profundidad del fondo) a partir de los vecinos fiables.
function inpaint(src,known,w,h){
  const n=w*h,out=Float32Array.from(src),done=Uint8Array.from(known);
  let left=0;for(let i=0;i<n;i++)if(!done[i])left++;
  if(!left)return out;
  const a=new Float32Array(n),m=new Float32Array(n);
  for(let i=0;i<n;i++)if(known[i]){a[i]=src[i];m[i]=1;}
  for(const sg of[1.5,3,6,12,24]){
    const ba=gaussianBlur(a,w,h,sg),bm=gaussianBlur(m,w,h,sg);
    for(let i=0;i<n;i++)if(!done[i]&&bm[i]>1e-3){out[i]=ba[i]/bm[i];done[i]=1;left--;}
    if(!left)break;
  }
  return out;
}
// Perfil de borde redondeado (cuarto de círculo): vertical en el contorno y
// plano hacia adentro, como una almohada. t = distancia / ancho del redondeo.
const roundProfile=t=>{t=clamp(t,0,1);return Math.sqrt(1-(1-t)*(1-t));};

// ── Malla cerrada desde dos campos de altura sobre una máscara ────────────
// Cada celda interior aporta dos triángulos arriba y dos abajo; cada arista
// de celda que limita con el exterior aporta una pared. Las alturas viven en
// los vértices (esquinas de celda) y se comparten, así que la malla resulta
// cerrada y con orientación consistente (normales hacia afuera).
// Alturas: por celda (top/bot, se promedian en cada vértice) o por vértice
// (vt/vb). ox/oy: corrimiento de cada vértice en celdas (contorno suave).
// Coordenadas: X = columna·px, Y = (h − fila)·px (la foto queda derecha), Z = altura.
function buildSolid(o){
  const{w,h,mask,px}=o,minT=o.minThickness==null?.4:o.minThickness;
  const VW=w+1,nv=VW*(h+1);
  let vt,vb;
  if(o.vt&&o.vb){vt=Float32Array.from(o.vt);vb=Float32Array.from(o.vb);}
  else{
    vt=new Float32Array(nv);vb=new Float32Array(nv);const cnt=new Uint8Array(nv);
    for(let j=0;j<h;j++)for(let i=0;i<w;i++){
      const c=j*w+i;if(!mask[c])continue;
      for(const v of[j*VW+i,j*VW+i+1,(j+1)*VW+i,(j+1)*VW+i+1]){vt[v]+=o.top[c];vb[v]+=o.bot[c];cnt[v]++;}
    }
    for(let v=0;v<nv;v++)if(cnt[v]){vt[v]/=cnt[v];vb[v]/=cnt[v];}
  }
  let cells=0,walls=0;
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    const c=j*w+i;if(!mask[c])continue;cells++;
    if(i===0||!mask[c-1])walls++;
    if(i===w-1||!mask[c+1])walls++;
    if(j===0||!mask[c-w])walls++;
    if(j===h-1||!mask[c+w])walls++;
  }
  // Grosor mínimo subiendo la cara superior: la inferior es la de apoyo en las
  // formas de reverso plano y tiene que quedar exactamente en z = 0.
  for(let v=0;v<nv;v++)if(vt[v]-vb[v]<minT)vt[v]=vb[v]+minT;
  const ox=o.ox?Float32Array.from(o.ox):new Float32Array(nv),oy=o.oy?Float32Array.from(o.oy):new Float32Array(nv);
  const X=v=>(v%VW+ox[v])*px,Y=v=>(h-((v/VW)|0)-oy[v])*px;
  // Un corrimiento nunca debe voltear una cara: si pasa, esa celda vuelve a la grilla.
  if(o.ox||o.oy){
    const cross=(a,b,c)=>(X(b)-X(a))*(Y(c)-Y(a))-(Y(b)-Y(a))*(X(c)-X(a));
    for(let pass=0;pass<4;pass++){
      let bad=0;
      for(let j=0;j<h;j++)for(let i=0;i<w;i++){
        if(!mask[j*w+i])continue;
        const v00=j*VW+i,v10=v00+1,v01=v00+VW,v11=v01+1;
        if(cross(v01,v11,v10)<=1e-9*px*px||cross(v01,v10,v00)<=1e-9*px*px){
          for(const v of[v00,v10,v01,v11]){ox[v]=0;oy[v]=0;}bad++;
        }
      }
      if(!bad)break;
    }
  }
  const nTris=cells*4+walls*2,tris=new Float32Array(nTris*9);let p=0;
  function tri(a,za,b,zb,c,zc){
    tris[p++]=X(a);tris[p++]=Y(a);tris[p++]=za;
    tris[p++]=X(b);tris[p++]=Y(b);tris[p++]=zb;
    tris[p++]=X(c);tris[p++]=Y(c);tris[p++]=zc;
  }
  function wall(a,b){ // a→b es la arista en el ciclo CCW de la cara superior
    tri(b,vt[b],a,vt[a],a,vb[a]);
    tri(b,vt[b],a,vb[a],b,vb[b]);
  }
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    const c=j*w+i;if(!mask[c])continue;
    const v00=j*VW+i,v10=v00+1,v01=v00+VW,v11=v01+1;
    tri(v01,vt[v01],v11,vt[v11],v10,vt[v10]);
    tri(v01,vt[v01],v10,vt[v10],v00,vt[v00]);
    tri(v01,vb[v01],v10,vb[v10],v11,vb[v11]);
    tri(v01,vb[v01],v00,vb[v00],v10,vb[v10]);
    if(j===h-1||!mask[c+w])wall(v01,v11);
    if(i===w-1||!mask[c+1])wall(v11,v10);
    if(j===0||!mask[c-w])wall(v10,v00);
    if(i===0||!mask[c-1])wall(v00,v01);
  }
  return{tris,count:nTris};
}
// Prisma de base: superelipse (n=2 óvalo, n=6 rectángulo redondeado).
function basePrism(cx,cy,rx,ry,z0,z1,n,seg){
  seg=seg||96;n=n||2;
  const pts=[];
  for(let k=0;k<seg;k++){
    const a=k/seg*Math.PI*2,c=Math.cos(a),s=Math.sin(a);
    pts.push([cx+rx*Math.sign(c)*Math.pow(Math.abs(c),2/n),cy+ry*Math.sign(s)*Math.pow(Math.abs(s),2/n)]);
  }
  const tris=new Float32Array(seg*4*9);let p=0;
  const put=(x,y,z)=>{tris[p++]=x;tris[p++]=y;tris[p++]=z;};
  for(let k=0;k<seg;k++){
    const A=pts[k],B=pts[(k+1)%seg];
    put(cx,cy,z1);put(A[0],A[1],z1);put(B[0],B[1],z1);
    put(cx,cy,z0);put(B[0],B[1],z0);put(A[0],A[1],z0);
    put(B[0],B[1],z1);put(A[0],A[1],z1);put(A[0],A[1],z0);
    put(B[0],B[1],z1);put(A[0],A[1],z0);put(B[0],B[1],z0);
  }
  return{tris,count:seg*4};
}
function concatMeshes(list){
  const count=list.reduce((s,m)=>s+m.count,0),tris=new Float32Array(count*9);let off=0;
  for(const m of list){tris.set(m.tris.subarray(0,m.count*9),off);off+=m.count*9;}
  return{tris,count};
}
function meshBounds(m){
  const mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity],t=m.tris;
  for(let i=0;i<m.count*9;i+=3)for(let k=0;k<3;k++){const v=t[i+k];if(v<mn[k])mn[k]=v;if(v>mx[k])mx[k]=v;}
  return{min:mn,max:mx};
}
function transformMesh(m,fn){
  const t=m.tris,o=[0,0,0];
  for(let i=0;i<m.count*9;i+=3){fn(t[i],t[i+1],t[i+2],o);t[i]=o[0];t[i+1]=o[1];t[i+2]=o[2];}
  return m;
}
// Volumen con signo (teorema de la divergencia): positivo si las normales
// apuntan hacia afuera.
function meshVolume(m){
  const t=m.tris;let v=0;
  for(let i=0;i<m.count*9;i+=9){
    const ax=t[i],ay=t[i+1],az=t[i+2],bx=t[i+3],by=t[i+4],bz=t[i+5],cx=t[i+6],cy=t[i+7],cz=t[i+8];
    v+=ax*(by*cz-bz*cy)-ay*(bx*cz-bz*cx)+az*(bx*cy-by*cx);
  }
  return v/6;
}
// Centro de masa (x, y) del sólido: suma de tetraedros con el origen.
function meshCentroid(m){
  const t=m.tris;let v=0,cx=0,cy=0;
  for(let i=0;i<m.count*9;i+=9){
    const ax=t[i],ay=t[i+1],az=t[i+2],bx=t[i+3],by=t[i+4],bz=t[i+5],qx=t[i+6],qy=t[i+7],qz=t[i+8];
    const dv=(ax*(by*qz-bz*qy)-ay*(bx*qz-bz*qx)+az*(bx*qy-by*qx))/6;
    v+=dv;cx+=dv*(ax+bx+qx)/4;cy+=dv*(ay+by+qy)/4;
  }
  return v?[cx/v,cy/v]:[0,0];
}
function meshArea(m){
  const t=m.tris;let a=0;
  for(let i=0;i<m.count*9;i+=9){
    const ux=t[i+3]-t[i],uy=t[i+4]-t[i+1],uz=t[i+5]-t[i+2],vx=t[i+6]-t[i],vy=t[i+7]-t[i+1],vz=t[i+8]-t[i+2];
    a+=Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)/2;
  }
  return a;
}
// Gramos de PLA con un perfil típico: ~1 mm de cáscara (paredes y tapas) y
// 15 % de relleno. Es una estimación para decidir; el laminador da el valor real.
function estimateGrams(volume,area,opts={}){
  const shell=Math.min(volume,area*(opts.shell==null?1:opts.shell)),infill=opts.infill==null?.15:opts.infill;
  return(shell+(volume-shell)*infill)/1000*(opts.density||1.24);
}
// Volumen de impresión del parque (mismo dato que SL3D.SPECS en js/slicer3d.js).
const PRINTERS=[['K1',220,220,250],['K2',350,350,350],['Ender-5 Max',400,400,600],['K2 Plus',500,500,500],['Giga',800,800,800]];
function printersThatFit(dx,dy,dz){
  return PRINTERS.filter(([,x,y,z])=>dz<=z&&((dx<=x&&dy<=y)||(dx<=y&&dy<=x))).map(p=>p[0]);
}
function writeSTL(m,label){
  const n=m.count,buf=new ArrayBuffer(84+n*50),dv=new DataView(buf),t=m.tris;
  const head=String(label||'Escultor de fotos').slice(0,79);
  for(let i=0;i<head.length;i++)dv.setUint8(i,head.charCodeAt(i)&127);
  dv.setUint32(80,n,true);
  let o=84;
  for(let i=0;i<n*9;i+=9){
    const ux=t[i+3]-t[i],uy=t[i+4]-t[i+1],uz=t[i+5]-t[i+2],vx=t[i+6]-t[i],vy=t[i+7]-t[i+1],vz=t[i+8]-t[i+2];
    let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;
    dv.setFloat32(o,nx,true);dv.setFloat32(o+4,ny,true);dv.setFloat32(o+8,nz,true);o+=12;
    for(let k=0;k<9;k++){dv.setFloat32(o,t[i+k],true);o+=4;}
    dv.setUint16(o,0,true);o+=2;
  }
  return buf;
}

// ── Formas: parámetros por defecto ────────────────────────────────────────
const SHAPES={
  figura:{label:'Figura con base',sub:'Se para sola',hint:'Se para sola sobre una base. Frente esculpido con IA, reverso redondeado.',
    defaults:{size:100,relief:16,thick:6,backMode:'espejo',back:60,edge:4,baseShape:'oval',baseH:5,baseMargin:5}},
  medallon:{label:'Medallón / cuadro',sub:'Para colgar o regalar',hint:'Relieve sobre una placa con marco. Se imprime acostado, sin soportes.',
    defaults:{size:100,relief:5,thick:3,plate:'redondeado',subject:'sujeto',edge:3,frame:4,frameH:2,hang:true}},
  llavero:{label:'Llavero / colgante',sub:'Con argolla',hint:'Silueta del sujeto con relieve y una argolla. Reverso plano.',
    defaults:{size:45,relief:2.5,thick:2.5,hole:4,edge:2}},
  objeto:{label:'Solo el objeto',sub:'Sin base',hint:'Sólo el sujeto, sin base. Decide la orientación en el laminador.',
    defaults:{size:80,relief:14,thick:5,backMode:'espejo',back:60,edge:4}},
};
const COMMON_DEFAULTS={res:300,smooth:2,detail:0,gamma:1,invert:false,maskMode:'auto',maskAdj:0};

// ── Campos de la imagen (una vez por imagen) ──────────────────────────────
// img = {w,h,rgba(Uint8ClampedArray), hasAlpha}; depth = Float32Array w·h
// (mayor = más cerca) o null para usar el brillo.
function prepareFields(img,depth,opts={}){
  const{w,h,rgba}=img,n=w*h,lum=new Float32Array(n),alpha=new Float32Array(n);
  for(let i=0;i<n;i++){
    const r=rgba[i*4],g=rgba[i*4+1],b=rgba[i*4+2],a=rgba[i*4+3]/255;
    // Sobre blanco: los PNG transparentes no aportan negro falso.
    lum[i]=((.2126*r+.7152*g+.0722*b)/255)*a+(1-a);alpha[i]=a;
  }
  // Color de fondo: mediana del borde. Si el borde es parejo, el recorte
  // automático usa distancia de color (ideal para dibujos y productos en estudio).
  const border=[];
  const push=i=>{if(rgba[i*4+3]>200)border.push([rgba[i*4],rgba[i*4+1],rgba[i*4+2]]);};
  for(let x=0;x<w;x++){push(x);push((h-1)*w+x);}
  for(let y=1;y<h-1;y++){push(y*w);push(y*w+w-1);}
  const med=k=>{const v=border.map(c=>c[k]).sort((a,b)=>a-b);return v.length?v[v.length>>1]:255;};
  const bg=[med(0),med(1),med(2)];
  let spread=0;for(const c of border)spread+=Math.hypot(c[0]-bg[0],c[1]-bg[1],c[2]-bg[2]);
  spread=border.length?spread/border.length/441.7:1;
  const colorDist=new Float32Array(n);
  for(let i=0;i<n;i++){
    const d=Math.hypot(rgba[i*4]-bg[0],rgba[i*4+1]-bg[1],rgba[i*4+2]-bg[2])/441.7;
    colorDist[i]=d*alpha[i];
  }
  let hasAlpha=false;for(let i=0;i<n;i++)if(alpha[i]<.5){hasAlpha=true;break;}
  let depthN=null;
  if(depth){
    // Un NaN o infinito (desborde fp16 en GPU) llegaba hasta los vértices del
    // STL y lo dejaba corrupto: se rellena desde los vecinos válidos.
    let bad=0;const known=new Uint8Array(n);for(let i=0;i<n;i++){if(Number.isFinite(depth[i]))known[i]=1;else bad++;}
    if(bad){
      if(bad===n)depth=new Float32Array(n);
      else{const src=new Float32Array(n);for(let i=0;i<n;i++)src[i]=known[i]?depth[i]:0;depth=inpaint(src,known,w,h);}
    }
    const[lo,hi]=percentiles(depth,null,[.01,.99]),span=hi-lo||1;
    depthN=new Float32Array(n);for(let i=0;i<n;i++)depthN[i]=clamp((depth[i]-lo)/span,0,1);
  }
  const relief=depthN||lum;
  return{w,h,lum,alpha,colorDist,depthN,relief,bg,bgUniform:spread<.07,hasAlpha,modelRes:opts.modelRes||518,
    // El recorte usa maskBinary (cobertura a resolución de la foto); aquí sólo
    // hacen falta las tablas del relieve y del brillo.
    sat:{lum:makeSAT(lum,w,h),relief:makeSAT(relief,w,h)}};
}
// Qué campo define el recorte y con qué umbral.
function maskSource(F,params){
  let mode=params.maskMode||'auto';
  if(mode==='auto')mode=F.hasAlpha?'alpha':(F.bgUniform||!F.depthN)?'color':'depth';
  const adj=(Number(params.maskAdj)||0)/100;
  if(mode==='alpha')return{mode,key:'alpha',thr:clamp(.5+adj,.02,.98),label:'transparencia del PNG'};
  if(mode==='color')return{mode,key:'colorDist',thr:clamp(.12+adj*.5,.01,.9),label:'fondo uniforme'};
  if(mode==='depth'){
    if(!F.depthN)return{mode:'color',key:'colorDist',thr:clamp(.12+adj*.5,.01,.9),label:'fondo uniforme (sin IA)'};
    return{mode,key:'relief',thr:clamp(otsu(F.depthN)+adj,.02,.98),label:'profundidad (IA)'};
  }
  return{mode:'none',key:null,thr:0,label:'imagen completa'};
}

// Recorte binario a resolución de la foto (pixel por pixel) y su tabla de
// áreas: cada celda de la grilla toma su COBERTURA y entra si es ≥ 50 %.
// Umbralizar el promedio del campo (como antes) metía en la pieza celdas con
// apenas un 20 % de sujeto y engordaba la silueta. Se cachea por imagen y umbral.
function maskBinary(F,src){
  const key=src.key+':'+src.thr.toFixed(4);
  if(F._bin&&F._bin.key===key)return F._bin;
  const W=F.w,H=F.h,fld=F[src.key],b=new Float32Array(W*H);
  for(let i=0;i<W*H;i++)b[i]=fld[i]>src.thr?1:0;
  F._bin={key,b,sat:makeSAT(b,W,H),rel:null};
  return F._bin;
}
// Fiabilidad de la profundidad, medida en píxeles de la foto: la IA trabaja a
// ~518 px y mezcla con el fondo lo que está a menos de ~4 px de él (rayos,
// manubrios, bordes).
function depthReliability(F,src){
  const B=maskBinary(F,src);
  if(!B.rel){
    const W=F.w,H=F.h,m=new Uint8Array(W*H);for(let i=0;i<W*H;i++)m[i]=B.b[i];
    // ~4 px del modelo, llevados a píxeles de la foto según la resolución usada.
    const din=distanceInside(m,W,H),k=4*Math.max(W,H)/(F.modelRes||518),rel=new Float32Array(W*H);
    for(let i=0;i<W*H;i++)rel[i]=din[i]>k?1:0;
    B.rel={rel,sat:makeSAT(rel,W,H)};
  }
  return B.rel;
}
// Limpieza del recorte en MILÍMETROS (antes era en celdas y en % del área, y a
// 200 mm borraba detalles imprimibles de 2 mm y rellenaba huecos de cientos de mm²):
//  - lo más fino que `minFeature` (0,8 mm = dos pasadas de boquilla 0,4) no se
//    borra: se engrosa hasta poder imprimirse (rayos, antenas, manubrios);
//  - se cierran rendijas de menos de ~0,4 mm y huecos de menos de 0,8 mm².
function cleanMaskMM(raw,w,h,px,opts={}){
  const minW=opts.minFeature||.8,n=w*h;
  let m=Uint8Array.from(raw);
  if(px<minW){
    const r=Math.max(1,Math.round(minW/2/px)),opened=openMask(m,w,h,r),thin=new Uint8Array(n);let any=false;
    for(let i=0;i<n;i++)if(m[i]&&!opened[i]){thin[i]=1;any=true;}
    if(any){const th=dilate(thin,w,h,r);for(let i=0;i<n;i++)if(th[i])m[i]=1;}
  }
  const rc=Math.round(.2/px);if(rc>=1)m=closeMask(m,w,h,rc);
  if(opts.single!==false)m=keepLargest(m,w,h);
  m=fillHoles(m,w,h,Math.max(2,Math.round(.8/(px*px))));
  return fixDiagonals(m,w,h);
}

// ── Construcción completa: campos + parámetros → malla lista para STL ─────
function buildModel(F,shape,params){
  const P=Object.assign({},COMMON_DEFAULTS,(SHAPES[shape]||SHAPES.figura).defaults,params||{});
  const res=clamp(Math.round(P.res),60,600),src=maskSource(F,P);
  const W=F.w,H=F.h;
  // 1) Recorte grueso para encontrar el encuadre del sujeto.
  let bbox={x0:0,y0:0,x1:W,y1:H};
  if(shape!=='medallon'&&src.key){
    const cs=Math.min(1,200/Math.max(W,H)),cw=Math.max(8,Math.round(W*cs)),ch=Math.max(8,Math.round(H*cs));
    const B=maskBinary(F,src),fld=sampleRect(B.b,B.sat,W,H,0,0,W,H,cw,ch,0);
    const m=new Uint8Array(cw*ch);for(let i=0;i<m.length;i++)m[i]=fld[i]>=.5?1:0;
    const cm=cleanMask(m,cw,ch,{radius:1});const bb=maskBBox(cm,cw,ch);
    if(!bb)return{error:'No encontré el sujeto en la imagen. Ajusta el recorte o usa "Imagen completa".'};
    bbox={x0:bb.x0*W/cw,y0:bb.y0*H/ch,x1:(bb.x1+1)*W/cw,y1:(bb.y1+1)*H/ch};
  }
  if(shape==='medallon'&&P.plate==='circular'){
    const s=Math.min(W,H);bbox={x0:(W-s)/2,y0:(H-s)/2,x1:(W+s)/2,y1:(H+s)/2};
  }
  const bw=bbox.x1-bbox.x0,bh=bbox.y1-bbox.y0,longest=Math.max(bw,bh);
  const spc=longest/res;           // píxeles de la foto por celda
  const px=P.size/res;             // mm por celda
  // 2) Márgenes: espacio para la argolla del llavero y para no cortar bordes.
  const padCells=shape==='medallon'?0:3;
  let padTop=padCells;
  const holeR=(Number(P.hole)||4)/2,ringR=holeR+2.5;
  if(shape==='llavero')padTop+=Math.ceil((2*holeR+.8+ringR)/px)+2;
  const rx=bbox.x0-padCells*spc,ry=bbox.y0-padTop*spc;
  const gw=Math.max(4,Math.round(bw/spc)+2*padCells),gh=Math.max(4,Math.round(bh/spc)+padCells+padTop);
  const n=gw*gh;
  // 3) Campos en la grilla.
  const rel=sampleRect(F.relief,F.sat.relief,W,H,rx,ry,gw*spc,gh*spc,gw,gh,0);
  const lum=sampleRect(F.lum,F.sat.lum,W,H,rx,ry,gw*spc,gh*spc,gw,gh,1);
  let subject,raw=null;
  if(src.key){
    const B=maskBinary(F,src),cov=sampleRect(B.b,B.sat,W,H,rx,ry,gw*spc,gh*spc,gw,gh,0);
    raw=new Uint8Array(n);for(let i=0;i<n;i++)raw[i]=cov[i]>=.5?1:0;
    subject=cleanMaskMM(raw,gw,gh,px,{single:shape!=='medallon'});
  }else{
    // "Imagen completa": sólo las celdas que caen dentro de la foto (sin el margen).
    subject=new Uint8Array(n);
    for(let j=0;j<gh;j++){const cy=ry+(j+.5)*spc;if(cy<0||cy>H)continue;
      for(let i=0;i<gw;i++){const cx=rx+(i+.5)*spc;if(cx>=0&&cx<=W)subject[j*gw+i]=1;}}
  }
  if(maskArea(subject)<16&&shape!=='medallon')return{error:'El recorte quedó vacío. Ajusta el recorte.'};
  const warnings=[];
  if(shape==='medallon'&&P.subject!=='todo'&&maskArea(subject)<16)
    warnings.push('No encontré el sujeto: el medallón sale plano. Ajusta el recorte o elige "Relieve en: Toda la imagen".');
  // Figura: las patas o el borde inferior que terminan un poco más arriba
  // (perspectiva de la foto) se alargan hasta el piso para que todo apoye en la base.
  const footFill=[];
  if(shape==='figura'){
    const bb=maskBBox(subject,gw,gh),hCells=bb.y1-bb.y0+1;
    const zone=Math.min(Math.round(hCells*.12),Math.max(Math.round(2/px),Math.round(hCells*.05)));
    for(let x=0;x<gw;x++){
      let low=-1;for(let y=bb.y1;y>=bb.y1-zone&&y>=0;y--)if(subject[y*gw+x]){low=y;break;}
      if(low>=0&&low<bb.y1){for(let y=low+1;y<=bb.y1;y++)subject[y*gw+x]=1;footFill.push([x,low,bb.y1]);}
    }
  }
  // Celdas que el recorte cerró (huecos entre rayos, entre brazo y cuerpo) o
  // alargó: su profundidad y brillo son del fondo y dejarían pozos. Además, la
  // IA trabaja a ~518 px y mezcla con el fondo todo lo que está a pocos píxeles
  // de él (rayos, manubrios, bordes): esas celdas tampoco son fiables. Todas se
  // rellenan desde el interior del sujeto.
  let relS=rel,lumS=lum;
  if(raw&&!(shape==='medallon'&&P.subject==='todo')){
    const base=new Uint8Array(n);let nSub=0;
    for(let i=0;i<n;i++){base[i]=subject[i]&&raw[i]?1:0;if(subject[i])nSub++;}
    let known=base;
    if(F.depthN&&src.key){
      const R=depthReliability(F,src),rg=sampleRect(R.rel,R.sat,W,H,rx,ry,gw*spc,gh*spc,gw,gh,0);
      const deep=new Uint8Array(n);let nDeep=0;
      for(let i=0;i<n;i++)if(base[i]&&rg[i]>.5){deep[i]=1;nDeep++;}
      if(nDeep>=nSub*.15)known=deep; // un sujeto todo fino se queda con lo que hay
    }
    let unk=0;for(let i=0;i<n;i++)if(subject[i]&&!known[i])unk++;
    if(unk){relS=inpaint(rel,known,gw,gh);if(known===base)lumS=inpaint(lum,known,gw,gh);else lumS=inpaint(lum,base,gw,gh);}
  }
  // 4) Relieve normalizado dentro del sujeto: suavizado, detalle fino y curva.
  const relMask=(shape==='medallon'&&P.subject==='todo')?new Uint8Array(n).fill(1):subject;
  const sm=Number(P.smooth)||0;let d;
  if(sm>0){
    const[l0,h0]=percentiles(relS,relMask,[.02,.98]),sp0=Math.max(1e-6,h0-l0);
    // Radio en celdas según el suavizado; umbral de "escalón real" ≈ 10 % del
    // rango del sujeto: las ondas del modelo (±2–3 %) se promedian, un brazo
    // delante del cuerpo (≥ 20 %) se conserva.
    // Primero la mediana: el filtro guiado conserva lo que parece un canto, y un
    // pico aislado lo parece; sin este paso los picos llegaban a la malla.
    d=guidedSmooth(maskedMedian3(relS,relMask,gw,gh),relMask,gw,gh,Math.max(1,Math.round(sm*res/220)),Math.pow(.1*sp0,2));
    // Un toque gaussiano mínimo quita el grano de celda sin tocar la forma.
    d=maskedBlur(d,relMask,gw,gh,Math.min(.8,sm*.3));
  }else d=Float32Array.from(relS);
  const[lo,hi]=percentiles(d,relMask,[.02,.98]),span=hi-lo||1;
  const detail=(Number(P.detail)||0)/100;
  const hp=detail>0?(()=>{const bl=gaussianBlur(lumS,gw,gh,2*res/220),o=new Float32Array(n);for(let i=0;i<n;i++)o[i]=lumS[i]-bl[i];return o;})():null;
  const gamma=clamp(Number(P.gamma)||1,.2,5);
  for(let i=0;i<n;i++){
    let v=clamp((d[i]-lo)/span,0,1);
    if(hp)v=clamp(v+detail*hp[i]*2.5,0,1);
    if(P.invert)v=1-v;
    d[i]=Math.pow(v,gamma);
  }
  // Las prolongaciones de las patas heredan el relieve de su último punto real.
  for(const[x,y0,y1]of footFill)for(let y=y0+1;y<=y1;y++)d[y*gw+x]=d[y0*gw+x];
  // 5) Alturas por forma.
  const top=new Float32Array(n),bot=new Float32Array(n),R=Math.max(0,Number(P.relief)||0),T=Math.max(.4,Number(P.thick)||1);
  const edgeCells=Math.max(1e-6,(Number(P.edge)||0)/px);
  let mask,taper;  // taper: sólo llavero (relieve sobre la placa)
  const taperFrom=dist=>{const t=new Float32Array(n);for(let i=0;i<n;i++)t[i]=(Number(P.edge)||0)<=0?1:smoothstep(dist[i]/edgeCells);return t;};
  if(shape==='medallon'){
    const n2={rectangular:40,redondeado:5,ovalado:2,circular:2}[P.plate]||5;
    mask=n2>=40?new Uint8Array(n).fill(1):superellipseMask(gw,gh,n2);
    const plateDist=distanceInside(mask,gw,gh),frameW=(Number(P.frame)||0)/px;
    const subjWeight=P.subject==='todo'?new Float32Array(n).fill(1):taperFrom(distanceInside(subject,gw,gh));
    for(let i=0;i<n;i++){
      if(!mask[i])continue;
      // El relieve se desvanece antes del marco para no chocar con él.
      const fade=frameW>0?smoothstep((plateDist[i]-frameW)/Math.max(1,edgeCells)):1;
      top[i]=T+R*d[i]*subjWeight[i]*fade;
      if(frameW>0&&plateDist[i]<=frameW)top[i]=Math.max(top[i],T+(Number(P.frameH)||0));
      bot[i]=0;
    }
    if(P.hang){
      const hr=2/px,cy=Math.max(frameW,1)+hr+1.5/px;
      const hole=diskMask(gw,gh,gw/2,cy,hr);for(let i=0;i<n;i++)if(hole[i])mask[i]=0;
    }
  }else if(shape==='llavero'){
    taper=taperFrom(distanceInside(subject,gw,gh));
    mask=Uint8Array.from(subject);
    const{cx,cy}=placeRing(subject,gw,gh,px,holeR,ringR);
    const ring=diskMask(gw,gh,cx,cy,ringR/px),hole=diskMask(gw,gh,cx,cy,holeR/px);
    for(let i=0;i<n;i++){if(ring[i])mask[i]=1;if(hole[i])mask[i]=0;}
    // El agujero puede separar una punta fina (oreja): se descarta el fragmento.
    mask=keepLargest(mask,gw,gh);
    let ringKept=0,ringCells=0;for(let i=0;i<n;i++)if(ring[i]&&!hole[i]&&!subject[i]){ringCells++;if(mask[i])ringKept++;}
    if(ringCells&&ringKept<ringCells*.5)warnings.push('No pude unir la argolla a la pieza: ajusta el recorte.');
    for(let i=0;i<n;i++){top[i]=T+(subject[i]?R*d[i]*taper[i]:0);bot[i]=0;}
  }else mask=subject;
  mask=fixDiagonals(mask,gw,gh);
  for(let i=0;i<n;i++)if(mask[i]&&top[i]===0&&bot[i]===0)top[i]=T; // celdas añadidas por fixDiagonals
  // Contorno suave para todas las formas.
  const VW=gw+1,cnt=vertexCounts(mask,gw,gh);
  const phi=gaussianBlur(signedDistance(mask,gw,gh),gw,gh,1);
  const{ox,oy}=snapContour(mask,gw,gh,phi,cnt);
  let vt=null,vb=null;
  if(shape==='figura'||shape==='objeto'){
    // Alturas por vértice: el redondeo se mide sobre la distancia suavizada
    // (sin escalones) y con perfil de cuarto de círculo. En la figura el borde
    // inferior se corta plano (sin redondeo) para que apoye completo en la base.
    let distMask=mask,dh=gh;
    if(shape==='figura'){
      const bb=maskBBox(mask,gw,gh),ext=Math.ceil(edgeCells)+4;dh=gh+ext;
      distMask=new Uint8Array(gw*dh);distMask.set(mask);
      for(let y=bb.y1+1;y<dh;y++)for(let x=0;x<gw;x++)distMask[y*gw+x]=mask[bb.y1*gw+x];
    }
    const phiT=shape==='figura'?gaussianBlur(signedDistance(distMask,gw,dh),gw,dh,1):phi;
    const back=clamp((Number(P.back)||0)/100,0,1),minT=.6,edgeOn=(Number(P.edge)||0)>0;
    vt=new Float32Array(VW*(gh+1));vb=new Float32Array(VW*(gh+1));
    for(let j=0;j<=gh;j++)for(let i=0;i<=gw;i++){
      const v=j*VW+i;if(!cnt[v])continue;
      let ds=0,dc=0;
      for(const[ci,cj]of[[i-1,j-1],[i,j-1],[i-1,j],[i,j]])if(ci>=0&&cj>=0&&ci<gw&&cj<gh&&mask[cj*gw+ci]){ds+=d[cj*gw+ci];dc++;}
      const dv=dc?ds/dc:0,ph=sampleCells(phiT,gw,dh,i-.5+ox[v],j-.5+oy[v],-1);
      const tp=edgeOn?roundProfile(ph/edgeCells):1;
      if(P.backMode==='plano'){vt[v]=minT+(T+R*dv)*tp;vb[v]=0;}
      else{vt[v]=minT/2+(T/2+R*dv)*tp;vb[v]=-(minT/2+(T/2+R*back*dv)*tp);}
    }
  }
  let mesh=buildSolid({w:gw,h:gh,mask,top,bot,vt,vb,ox,oy,px,minThickness:.4});
  const parts=[mesh];
  // 6) Orientación de impresión.
  if(shape==='figura'){
    // De pie: la foto pasa al plano XZ y el frente mira hacia −Y.
    transformMesh(mesh,(x,y,z,o)=>{o[0]=x;o[1]=-z;o[2]=y;});
    const b=meshBounds(mesh),bb=maskBBox(mask,gw,gh),band=Math.max(2,Math.round((bb.y1-bb.y0)*.15));
    let xs=Infinity,xe=-Infinity,ys=Infinity,ye=-Infinity;
    for(let y=bb.y1-band;y<=bb.y1+1;y++)for(let x=0;x<=gw;x++){
      const v=y*VW+x;if(!cnt[v])continue;
      const X=(x+ox[v])*px;xs=Math.min(xs,X);xe=Math.max(xe,X);ys=Math.min(ys,-vt[v]);ye=Math.max(ye,-vb[v]);
    }
    const baseH=Math.max(1,Number(P.baseH)||5),sink=Math.min(1.5,baseH*.4),dz=baseH-sink-b.min[2];
    transformMesh(mesh,(x,y,z,o)=>{o[0]=x;o[1]=y;o[2]=z+dz;});
    let foot={cx:(xs+xe)/2,cy:(ys+ye)/2,rx:(xe-xs)/2,ry:(ye-ys)/2,n:6};
    if(P.baseShape!=='ninguna'){
      const margin=Number(P.baseMargin)||0,brx=(xe-xs)/2+margin,bry=Math.max((ye-ys)/2+margin,brx*.55),n=P.baseShape==='rect'?6:2;
      parts.push(basePrism(foot.cx,foot.cy,brx,bry,0,baseH,n,96));
      foot={cx:foot.cx,cy:foot.cy,rx:brx,ry:bry,n};
    }
    // ¿Se vuelca? El centro de masa (figura + base) debe caer sobre el apoyo.
    const cm=meshCentroid(parts.length>1?concatMeshes(parts):mesh);
    const u=Math.abs(cm[0]-foot.cx)/Math.max(1e-6,foot.rx),v=Math.abs(cm[1]-foot.cy)/Math.max(1e-6,foot.ry);
    if(Math.pow(u,foot.n)+Math.pow(v,foot.n)>.8)
      warnings.push(P.baseShape==='ninguna'?'Sin base la figura puede volcarse: agrega una base.':'La figura puede volcarse: su peso cae cerca del borde de la base. Aumenta el margen de la base.');
  }
  mesh=parts.length>1?concatMeshes(parts):mesh;
  // 7) Centrar en el plato con Z mínimo = 0.
  const b=meshBounds(mesh),cx=(b.min[0]+b.max[0])/2,cy=(b.min[1]+b.max[1])/2;
  transformMesh(mesh,(x,y,z,o)=>{o[0]=x-cx;o[1]=y-cy;o[2]=z-b.min[2];});
  const bounds=meshBounds(mesh);
  // place: traslación final aplicada, para mapear la malla de vuelta a la foto
  // (x_foto = rect.x + (X + cx)/px·spc; y_foto = rect.y + (h·px − (Y + cy))/px·spc).
  return{mesh,bounds,shells:parts.length,place:{cx,cy,dz:b.min[2],spc},grid:{w:gw,h:gh,px,mask,subject,d,rect:{x:rx,y:ry,w:gw*spc,h:gh*spc}},mask:src,
    volume:meshVolume(mesh),area:meshArea(mesh),warning:warnings.join(' ')};
}

const CORE={clamp,smoothstep,makeSAT,sampleRect,gaussianBlur,maskedBlur,percentiles,otsu,
  distanceInside,distanceOutside,erode,dilate,openMask,closeMask,labelComponents,keepLargest,fillHoles,
  fixDiagonals,maskBBox,maskArea,cleanMask,diskMask,superellipseMask,buildSolid,basePrism,concatMeshes,
  meshBounds,transformMesh,meshVolume,meshArea,meshCentroid,guidedSmooth,maskedMedian3,signedDistance,snapContour,vertexCounts,inpaint,roundProfile,depthReliability,maskBinary,cleanMaskMM,estimateGrams,printersThatFit,placeRing,writeSTL,prepareFields,maskSource,buildModel,SHAPES,COMMON_DEFAULTS};

if(typeof module!=='undefined'&&module.exports){module.exports=CORE;return;}

/* ══════════════════════════════════════════════════════════════════════
 *  IA DE PROFUNDIDAD — cliente del Web Worker (js/foto3d-worker.js)
 * ══════════════════════════════════════════════════════════════════════ */
// El worker carga transformers.js desde el CDN fuera de la página: el código de
// terceros no ve localStorage ni el DOM, y la inferencia no congela la interfaz.
const SELF_SRC=(typeof document!=='undefined'&&document.currentScript&&document.currentScript.src)||'';
let _worker=null,_reqId=0,_aiLabel='',_aiRes=518;
const _pending=new Map();
function _resetWorker(){if(_worker){try{_worker.terminate();}catch(_){}_worker=null;}}
function _failAll(err){for(const p of _pending.values())p.reject(err);_pending.clear();_resetWorker();}
function depthWorker(){
  if(_worker)return _worker;
  const base=SELF_SRC||new URL('js/foto3d.js',location.href).href;
  const url=new URL('foto3d-worker.js',base);url.search=new URL(base).search; // mismo ?v= del deploy
  _worker=new Worker(url,{type:'module'});
  _worker.onmessage=e=>{
    const m=e.data||{},p=_pending.get(m.id);if(!p)return;
    if(m.type==='progress'){if(p.onProgress)p.onProgress(m.frac,m.total);return;}
    _pending.delete(m.id);
    if(m.type==='depth'&&m.data instanceof Float32Array){
      _aiLabel=(m.label||'')+(m.res?` · ${m.res} px`:'')+(m.passes>1?` · ${m.passes} pasadas`:'')+(m.asked&&m.res&&m.asked>m.res?` (bajó de ${m.asked} px: la GPU no dio resultados limpios)`:'');
      _aiRes=m.res||518;p.resolve(m);
    }
    else if(m.type==='cancelled'){const err=new Error('cancelado');err.cancelled=true;p.reject(err);}
    // Tras un error se descarta el worker: un import() fallido queda en caché
    // dentro de ese worker y "Recalcular IA" nunca volvería a intentarlo.
    else{const err=new Error(m.message||'Error de la IA de profundidad');p.reject(err);_failAll(err);}
  };
  _worker.onerror=e=>{if(e&&e.preventDefault)e.preventDefault();_failAll(new Error((e&&e.message)||'No se pudo iniciar el worker de IA'));};
  return _worker;
}
function estimateDepth(img,onProgress,quality){
  return new Promise((resolve,reject)=>{
    if(typeof Worker==='undefined'){reject(new Error('Este navegador no tiene Web Workers'));return;}
    // Los píxeles transparentes van sobre gris neutro para que la IA no invente bordes.
    const rgba=new Uint8ClampedArray(img.rgba);
    for(let i=0;i<rgba.length;i+=4){const a=rgba[i+3]/255;if(a<1){for(let k=0;k<3;k++)rgba[i+k]=rgba[i+k]*a+128*(1-a);rgba[i+3]=255;}}
    const id=++_reqId;_pending.set(id,{resolve,reject,onProgress});
    try{
      const w=depthWorker();
      w.postMessage({type:'cancel',below:id});  // lo que quedó en cola de fotos anteriores ya no sirve
      w.postMessage({type:'depth',id,rgba:rgba.buffer,w:img.w,h:img.h,quality:quality||'normal'},[rgba.buffer]);
    }catch(e){_pending.delete(id);reject(e);}
  }).then(m=>{
    if(m.w===img.w&&m.h===img.h)return m.data;
    // Versiones antiguas de transformers.js devolvían la salida cruda del modelo.
    return sampleRect(m.data,makeSAT(m.data,m.w,m.h),m.w,m.h,0,0,m.w,m.h,img.w,img.h,0);
  });
}

/* ══════════════════════════════════════════════════════════════════════
 *  VISOR WebGL (orbitar con arrastre, zoom con rueda, doble clic = vista inicial)
 * ══════════════════════════════════════════════════════════════════════ */
function createViewer(canvas){
  const gl=canvas.getContext('webgl',{antialias:true,alpha:false});
  if(!gl)return null;
  const vs=`attribute vec3 p;attribute vec3 n;uniform mat4 mvp;varying vec3 vn;void main(){gl_Position=mvp*vec4(p,1.);vn=n;}`;
  const fs=`precision mediump float;varying vec3 vn;uniform vec3 l1;uniform vec3 l2;uniform vec3 col;uniform float uFlat;
    void main(){if(uFlat>.5){gl_FragColor=vec4(col,1.);return;}vec3 N=normalize(vn);if(!gl_FrontFacing)N=-N;
    float d=max(dot(N,l1),0.)*.75+max(dot(N,l2),0.)*.3+.18;gl_FragColor=vec4(col*d,1.);}`;
  const sh=(t,s)=>{const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(o));return o;};
  let prog,loc,meshBuf,gridBuf,lost=false,lastMesh=null;
  function initGL(){
    prog=gl.createProgram();gl.attachShader(prog,sh(gl.VERTEX_SHADER,vs));gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,fs));gl.linkProgram(prog);
    loc={p:gl.getAttribLocation(prog,'p'),n:gl.getAttribLocation(prog,'n'),mvp:gl.getUniformLocation(prog,'mvp'),l1:gl.getUniformLocation(prog,'l1'),l2:gl.getUniformLocation(prog,'l2'),col:gl.getUniformLocation(prog,'col'),flat:gl.getUniformLocation(prog,'uFlat')};
    meshBuf=gl.createBuffer();gridBuf=gl.createBuffer();
  }
  initGL();
  let nv=0,gridN=0,target=[0,0,0],radius=50,yaw=-Math.PI/2-.55,pitch=.45,dist=150,home=null;
  function setMesh(m,view){
    lastMesh=m;if(lost)return;
    const t=m.tris,data=new Float32Array(m.count*18);
    for(let i=0,o=0;i<m.count*9;i+=9){
      const ux=t[i+3]-t[i],uy=t[i+4]-t[i+1],uz=t[i+5]-t[i+2],vx=t[i+6]-t[i],vy=t[i+7]-t[i+1],vz=t[i+8]-t[i+2];
      let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;
      for(let k=0;k<3;k++){data[o++]=t[i+k*3];data[o++]=t[i+k*3+1];data[o++]=t[i+k*3+2];data[o++]=nx;data[o++]=ny;data[o++]=nz;}
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,meshBuf);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);nv=m.count*3;
    const b=meshBounds(m);
    target=[(b.min[0]+b.max[0])/2,(b.min[1]+b.max[1])/2,(b.min[2]+b.max[2])/2];
    radius=Math.max(5,Math.hypot(b.max[0]-b.min[0],b.max[1]-b.min[1],b.max[2]-b.min[2])/2);
    // Cuadrícula de 10 mm en el plato para dar escala.
    const ext=Math.ceil(radius*1.4/10)*10,g=[];
    for(let v=-ext;v<=ext;v+=10){g.push(v,-ext,0,0,0,1,v,ext,0,0,0,1,-ext,v,0,0,0,1,ext,v,0,0,0,1);}
    gl.bindBuffer(gl.ARRAY_BUFFER,gridBuf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(g),gl.STATIC_DRAW);gridN=g.length/6;
    if(view){
      home=view==='figura'?{yaw:-Math.PI/2-.45,pitch:.25}:{yaw:-Math.PI/2-.35,pitch:.95};
      yaw=home.yaw;pitch=home.pitch;dist=radius*3.1;
    }
    draw();
  }
  function persp(f,a,n,fa){const t=1/Math.tan(f/2);return[t/a,0,0,0,0,t,0,0,0,0,(fa+n)/(n-fa),-1,0,0,2*fa*n/(n-fa),0];}
  function lookAt(e,c,u){
    let zx=e[0]-c[0],zy=e[1]-c[1],zz=e[2]-c[2];let l=Math.hypot(zx,zy,zz);zx/=l;zy/=l;zz/=l;
    let xx=u[1]*zz-u[2]*zy,xy=u[2]*zx-u[0]*zz,xz=u[0]*zy-u[1]*zx;l=Math.hypot(xx,xy,xz)||1;xx/=l;xy/=l;xz/=l;
    const yx=zy*xz-zz*xy,yy=zz*xx-zx*xz,yz=zx*xy-zy*xx;
    return[xx,yx,zx,0,xy,yy,zy,0,xz,yz,zz,0,-(xx*e[0]+xy*e[1]+xz*e[2]),-(yx*e[0]+yy*e[1]+yz*e[2]),-(zx*e[0]+zy*e[1]+zz*e[2]),1];
  }
  function mul(a,b){const o=new Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;}
  function draw(){
    if(lost)return;
    const dpr=Math.min(2,window.devicePixelRatio||1),cw=canvas.clientWidth,ch=canvas.clientHeight;
    if(!cw||!ch)return;
    if(canvas.width!==Math.round(cw*dpr)||canvas.height!==Math.round(ch*dpr)){canvas.width=Math.round(cw*dpr);canvas.height=Math.round(ch*dpr);}
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.clearColor(.051,.051,.051,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);
    const cp=Math.cos(pitch),dir=[cp*Math.cos(yaw),cp*Math.sin(yaw),Math.sin(pitch)];
    const eye=[target[0]+dir[0]*dist,target[1]+dir[1]*dist,target[2]+dir[2]*dist];
    const mvp=mul(persp(.7,cw/ch,Math.max(.5,dist-radius*4),dist+radius*6),lookAt(eye,target,[0,0,1]));
    gl.useProgram(prog);gl.uniformMatrix4fv(loc.mvp,false,new Float32Array(mvp));
    const side=[Math.cos(yaw+1.1),Math.sin(yaw+1.1),0];
    const L1=[dir[0]*.7+side[0]*.4,dir[1]*.7+side[1]*.4,dir[2]*.7+.55],l1n=Math.hypot(...L1);
    gl.uniform3f(loc.l1,L1[0]/l1n,L1[1]/l1n,L1[2]/l1n);gl.uniform3f(loc.l2,-side[0],-side[1],.2);
    const bind=buf=>{gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.enableVertexAttribArray(loc.p);gl.vertexAttribPointer(loc.p,3,gl.FLOAT,false,24,0);gl.enableVertexAttribArray(loc.n);gl.vertexAttribPointer(loc.n,3,gl.FLOAT,false,24,12);};
    if(gridN){bind(gridBuf);gl.uniform1f(loc.flat,1);gl.uniform3f(loc.col,.16,.17,.18);gl.drawArrays(gl.LINES,0,gridN);}
    if(nv){bind(meshBuf);gl.uniform1f(loc.flat,0);gl.uniform3f(loc.col,.86,.84,.80);gl.drawArrays(gl.TRIANGLES,0,nv);}
  }
  let drag=null;
  canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';});
  canvas.addEventListener('pointermove',e=>{if(!drag)return;yaw-=(e.clientX-drag.x)*.008;pitch=clamp(pitch+(e.clientY-drag.y)*.008,-1.45,1.45);drag={x:e.clientX,y:e.clientY};draw();});
  const end=()=>{drag=null;canvas.style.cursor='grab';};
  canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
  canvas.addEventListener('wheel',e=>{e.preventDefault();dist=clamp(dist*Math.exp(e.deltaY*.0012),radius*.6,radius*12);draw();},{passive:false});
  canvas.addEventListener('dblclick',()=>{if(home){yaw=home.yaw;pitch=home.pitch;dist=radius*3.1;draw();}});
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>draw()).observe(canvas);
  // Si el sistema reclama la GPU (otra pestaña pesada, suspensión), el visor se
  // rearma solo con la última malla al recuperar el contexto.
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;});
  canvas.addEventListener('webglcontextrestored',()=>{lost=false;initGL();if(lastMesh)setMesh(lastMesh,null);});
  return{setMesh,draw};
}

/* ══════════════════════════════════════════════════════════════════════
 *  UI — vista "escultor" del Taller
 * ══════════════════════════════════════════════════════════════════════ */
const LS_KEY='foto3d_params_v1';
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const S={img:null,name:'foto',depth:null,fields:null,shape:'figura',params:{},model:null,viewer:null,view:'mascara',timer:0,lastShape:null,depthRun:0};

// Controles: [clave, etiqueta, tipo, min, max, paso, unidad, ayuda]
const CTRL={
  size:['Tamaño (lado mayor)','range',15,300,1,'mm','Medida final del sujeto, sin contar la base ni la argolla.'],
  relief:['Profundidad del relieve','range',.5,60,.5,'mm','Cuánto sobresale lo más cercano respecto de lo más lejano.'],
  thick:['Grosor base','range',1,30,.5,'mm','Grosor mínimo del cuerpo o de la placa.'],
  backMode:['Reverso','select',[['espejo','Redondeado (volumen atrás)'],['plano','Plano (apoya en la cama)']]],
  back:['Volumen del reverso','range',0,100,5,'%','Qué tanto del relieve se repite por detrás.'],
  edge:['Redondeo de bordes','range',0,15,.5,'mm','Distancia en que el relieve baja suave hacia el contorno.'],
  baseShape:['Base','select',[['oval','Ovalada'],['rect','Rectangular'],['ninguna','Sin base']]],
  baseH:['Alto de la base','range',2,20,.5,'mm'],
  baseMargin:['Margen de la base','range',0,30,1,'mm'],
  plate:['Placa','select',[['redondeado','Rectangular redondeada'],['rectangular','Rectangular'],['ovalado','Ovalada'],['circular','Circular']]],
  subject:['Relieve en','select',[['sujeto','Sólo el sujeto'],['todo','Toda la imagen']]],
  frame:['Ancho del marco','range',0,15,.5,'mm'],
  frameH:['Alto del marco','range',0,8,.5,'mm'],
  hang:['Agujero para colgar','check'],
  hole:['Diámetro de la argolla','range',2,8,.5,'mm'],
};
const SHAPE_CTRLS={
  figura:['size','relief','thick','backMode','back','edge','baseShape','baseH','baseMargin'],
  medallon:['size','relief','thick','plate','subject','edge','frame','frameH','hang'],
  llavero:['size','relief','thick','hole','edge'],
  objeto:['size','relief','thick','backMode','back','edge'],
};
const DETAIL_CTRL={
  maskMode:['Recorte','select',[['auto','Automático'],['depth','Por profundidad (IA)'],['color','Fondo uniforme'],['none','Imagen completa']]],
  maskAdj:['Ajuste del recorte','range',-40,40,1,'','Negativo = toma más fondo; positivo = recorta más.'],
  smooth:['Suavizado','range',0,6,.1,'','Quita ruido y ondas de la IA sin borrar cantos. 0 = profundidad cruda.'],
  detail:['Detalle fino','range',0,60,1,'%','Suma textura del brillo de la foto (pelo, tela). Ojo: las sombras y manchas oscuras se vuelven hundimientos.'],
  gamma:['Curva de profundidad','range',.4,2.5,.05,'','Mayor que 1 = destaca lo más cercano; menor que 1 = relieve más parejo.'],
  invert:['Invertir relieve','check'],
  res:['Resolución','range',100,500,10,'celdas','Más celdas = más detalle y un STL más pesado.'],
};

function loadSaved(){try{const s=JSON.parse(localStorage.getItem(LS_KEY)||'{}');return s&&typeof s==='object'?s:{};}catch(_){return{};}}
function save(){try{localStorage.setItem(LS_KEY,JSON.stringify({shape:S.shape,params:S.params}));}catch(_){}}
function params(){return Object.assign({},COMMON_DEFAULTS,SHAPES[S.shape].defaults,S.params[S.shape]||{},S.params.common||{});}
function setParam(k,v){
  const bucket=DETAIL_CTRL[k]?'common':S.shape;
  S.params[bucket]=Object.assign({},S.params[bucket]||{},{[k]:v});save();schedule();
}
function ctrlHTML(k,def,val){
  const[label,type]=def,id='f3dC_'+k;
  if(type==='select')return`<label class="f3d-field"><span>${esc(label)}</span><select class="field-select" id="${id}" data-k="${k}">${def[2].map(([v,l])=>`<option value="${v}"${String(val)===v?' selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
  if(type==='check')return`<label class="f3d-field f3d-check"><input type="checkbox" id="${id}" data-k="${k}"${val?' checked':''}><span>${esc(label)}</span></label>`;
  const[, ,min,max,step,unit,tip]=def;
  return`<label class="f3d-field"${tip?` title="${esc(tip)}"`:''}><span>${esc(label)} <b id="${id}_v">${fmtVal(val,unit)}</b></span><input type="range" id="${id}" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}"></label>`;
}
function fmtVal(v,unit){const n=Number(v);const s=Math.abs(n)>=10||Number.isInteger(n)?String(Math.round(n*10)/10):n.toFixed(2).replace(/0$/,'');return s+(unit?' '+unit:'');}
function renderControls(){
  const P=params();
  $('f3dShapeBtns').innerHTML=Object.keys(SHAPES).map(k=>`<button type="button" class="f3d-shape${k===S.shape?' active':''}" onclick="Foto3D.setShape('${k}')"><b>${esc(SHAPES[k].label)}</b><small>${esc(SHAPES[k].sub)}</small></button>`).join('');
  $('f3dShapeHint').textContent=SHAPES[S.shape].hint;
  $('f3dShapeCtrls').innerHTML=SHAPE_CTRLS[S.shape].map(k=>ctrlHTML(k,CTRL[k],P[k])).join('');
  $('f3dDetailCtrls').innerHTML=Object.keys(DETAIL_CTRL).map(k=>ctrlHTML(k,DETAIL_CTRL[k],P[k])).join('');
  document.querySelectorAll('#maquinaEscultorView [data-k]').forEach(el=>{
    const k=el.dataset.k,def=CTRL[k]||DETAIL_CTRL[k];
    const on=()=>{
      const v=def[1]==='check'?el.checked:def[1]==='select'?el.value:Number(el.value);
      if(def[1]==='range'){const lab=$(el.id+'_v');if(lab)lab.textContent=fmtVal(v,def[5]);}
      setParam(k,v);
      if(k==='backMode')syncVisibility();
    };
    el.addEventListener(def[1]==='range'?'input':'change',on);
  });
  syncVisibility();
}
function syncVisibility(){
  const P=params(),back=$('f3dC_back');
  if(back)back.closest('.f3d-field').style.display=P.backMode==='plano'?'none':'';
}
function setShape(k){
  if(!SHAPES[k])return;S.shape=k;save();renderControls();schedule(true);
}
function resetShape(){delete S.params[S.shape];save();renderControls();schedule();}
function resetDetail(){delete S.params.common;save();renderControls();schedule();}
function aiNote(msg,tone){const el=$('f3dAiNote');if(!el)return;el.textContent=msg||'';el.dataset.tone=tone||'';}
function status(msg,tone){const el=$('f3dStatus');if(!el)return;el.textContent=msg||'';el.dataset.tone=tone||'';el.style.display=msg?'':'none';}
function progress(frac,label){
  const w=$('f3dProg');if(!w)return;
  if(frac==null){w.style.display='none';return;}
  w.style.display='';$('f3dProgBar').style.width=Math.round(clamp(frac,0,1)*100)+'%';$('f3dProgTxt').textContent=label||'';
}

// ── Carga de imagen ───────────────────────────────────────────────────────
function onFiles(files){
  const f=files&&files[0];if(!f)return;
  if(!/^image\//.test(f.type)){status('El archivo no es una imagen (usa JPG, PNG o WebP).','error');return;}
  S.name=(f.name||'foto').replace(/\.[^.]+$/,'').replace(/[^\w\-]+/g,'_').slice(0,40)||'foto';
  const url=URL.createObjectURL(f),im=new Image();
  im.onload=()=>{URL.revokeObjectURL(url);setImage(im);};
  im.onerror=()=>{URL.revokeObjectURL(url);status('No pude leer la imagen.','error');};
  im.src=url;
}
function setImage(im){
  // Imagen de trabajo ≤ 1024 px: la IA en GPU la ve a 1022 px (en CPU, a 518).
  const s=Math.min(1,1024/Math.max(im.naturalWidth,im.naturalHeight)),w=Math.max(8,Math.round(im.naturalWidth*s)),h=Math.max(8,Math.round(im.naturalHeight*s));
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;
  const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingQuality='high';ctx.drawImage(im,0,0,w,h);
  S.img={w,h,rgba:ctx.getImageData(0,0,w,h).data,canvas:cv};
  S.depth=null;S.model=null;
  S.fields=prepareFields(S.img,null);
  aiNote($('f3dSource').value==='ia'?'':'Profundidad: brillo de la imagen (claro = alto)');
  $('f3dDropEmpty').style.display='none';$('f3dWork').style.display='';$('f3dDrop').classList.add('has-img');
  drawSource();schedule(true);
  if($('f3dSource').value==='ia')runDepth();
}
async function runDepth(){
  if(!S.img)return;
  const img=S.img,run=++S.depthRun,mine=()=>run===S.depthRun&&S.img===img;
  $('f3dDepthBtn').disabled=true;
  aiNote(_aiLabel?'Calculando profundidad…':'Cargando la IA de profundidad…');
  progress(0,_aiLabel?'Calculando profundidad…':'Cargando la IA de profundidad (la primera vez descarga ~30–50 MB; después queda en caché)…');
  try{
    const t0=performance.now();
    const depth=await estimateDepth(img,(f,total)=>{if(mine()&&$('f3dSource').value==='ia')progress(f,f>=.999?'Calculando profundidad…':`Descargando modelo · ${Math.round(f*100)}% de ${(total/1048576).toFixed(0)} MB (queda en caché)`);},aiQuality());
    if(!mine())return; // llegó otra foto o se pidió otro cálculo mientras tanto
    S.depth=depth;S.depthRes=_aiRes;
    // Si mientras tanto se eligió "Brillo de la imagen", la profundidad queda
    // guardada (volver a "IA" no recalcula) pero no se aplica.
    if($('f3dSource').value!=='ia')return;
    progress(1,'Profundidad lista');setTimeout(()=>{if(mine())progress(null);},900);
    S.fields=prepareFields(img,depth,{modelRes:_aiRes});
    aiNote(`Profundidad: IA en ${_aiLabel||'el navegador'} · ${((performance.now()-t0)/1000).toFixed(1)} s`);
    drawSource();schedule(true);
  }catch(e){
    if(e&&e.cancelled)return;
    console.error('[Foto3D] profundidad',e);
    if(!mine()||$('f3dSource').value!=='ia')return;
    progress(null);
    // Va en la nota de profundidad, no en el estado de la malla: la próxima
    // reconstrucción no la borra.
    aiNote('No se pudo cargar la IA de profundidad (¿sin conexión o CDN bloqueado?). Uso el brillo de la imagen como relieve; "Recalcular IA" lo vuelve a intentar.','warn');
  }finally{if(run===S.depthRun)$('f3dDepthBtn').disabled=false;}
}
const AIQ_KEY='foto3d_ai_quality_v1';
function aiQuality(){const el=$('f3dAiQuality');return el&&el.value||'normal';}
function onQualityChange(){
  try{localStorage.setItem(AIQ_KEY,aiQuality());}catch(_){}
  S.depth=null;if(S.img&&$('f3dSource').value==='ia')runDepth();
}
function onSourceChange(){
  const v=$('f3dSource').value;
  if(!S.img)return;
  if(v==='ia'){
    if(S.depth){S.fields=prepareFields(S.img,S.depth,{modelRes:S.depthRes});aiNote(`Profundidad: IA en ${_aiLabel||'el navegador'}`);schedule(true);}
    else runDepth();
  }else{
    progress(null); // un cálculo en curso sigue, pero sólo guarda el resultado
    S.fields=prepareFields(S.img,null);aiNote('Profundidad: brillo de la imagen (claro = alto)');schedule(true);
  }
}

// ── Vista previa 2D: recorte o mapa de profundidad ────────────────────────
function drawSource(){
  const cv=$('f3dSrc');if(!cv||!S.img)return;
  const m=S.model&&!S.model.error?S.model:null,G=m&&m.grid;
  const box=cv.parentElement.clientWidth||320,ar=S.img.h/S.img.w,w=Math.round(box),h=Math.round(Math.min(box*ar,420));
  const scale=Math.min(w/S.img.w,h/S.img.h),dw=S.img.w*scale,dh=S.img.h*scale,ox=(w-dw)/2,oy=(h-dh)/2;
  const dpr=Math.min(2,window.devicePixelRatio||1);cv.width=w*dpr;cv.height=h*dpr;cv.style.height=h+'px';
  const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  if(S.view==='profundidad'&&S.fields){
    const F=S.fields,tmp=document.createElement('canvas');tmp.width=F.w;tmp.height=F.h;
    const id=tmp.getContext('2d').createImageData(F.w,F.h);
    for(let i=0;i<F.w*F.h;i++){const v=Math.round(F.relief[i]*255);id.data[i*4]=v;id.data[i*4+1]=v;id.data[i*4+2]=v;id.data[i*4+3]=255;}
    tmp.getContext('2d').putImageData(id,0,0);ctx.imageSmoothingQuality='high';ctx.drawImage(tmp,ox,oy,dw,dh);
  }else ctx.drawImage(S.img.canvas,ox,oy,dw,dh);
  if(G&&S.view==='mascara'){
    // Oscurece lo que queda fuera de la pieza y marca su contorno.
    const tmp=document.createElement('canvas');tmp.width=G.w;tmp.height=G.h;
    const id=tmp.getContext('2d').createImageData(G.w,G.h);
    for(let i=0;i<G.w*G.h;i++){if(!G.mask[i]){id.data[i*4+3]=170;}else{id.data[i*4]=0;id.data[i*4+1]=212;id.data[i*4+2]=204;id.data[i*4+3]=28;}}
    tmp.getContext('2d').putImageData(id,0,0);
    const r=G.rect;ctx.save();ctx.beginPath();ctx.rect(ox,oy,dw,dh);ctx.clip();
    ctx.fillStyle='rgba(0,0,0,.66)';
    // Fuera del encuadre de la pieza también es descarte.
    const rx=ox+r.x*scale,ry=oy+r.y*scale,rw=r.w*scale,rh=r.h*scale;
    ctx.fillRect(ox,oy,dw,Math.max(0,ry-oy));ctx.fillRect(ox,ry+rh,dw,Math.max(0,oy+dh-ry-rh));
    ctx.fillRect(ox,ry,Math.max(0,rx-ox),rh);ctx.fillRect(rx+rw,ry,Math.max(0,ox+dw-rx-rw),rh);
    ctx.imageSmoothingEnabled=false;ctx.drawImage(tmp,rx,ry,rw,rh);ctx.restore();
  }
}
function setView(v){
  S.view=v;document.querySelectorAll('#maquinaEscultorView [data-f3dview]').forEach(b=>b.classList.toggle('active',b.dataset.f3dview===v));drawSource();
}

// ── Reconstrucción con pausa (los deslizadores disparan muchos eventos) ──
function schedule(resetView){
  if(resetView)S.lastShape=null;
  clearTimeout(S.timer);S.timer=setTimeout(rebuild,160);
}
function rebuild(){
  if(!S.fields)return;
  const t0=performance.now();
  let model;
  try{model=buildModel(S.fields,S.shape,params());}
  catch(e){console.error('[Foto3D] malla',e);model={error:'Error al generar la malla: '+(e&&e.message||e)};}
  S.model=model;drawSource();
  const dl=$('f3dDownload');
  if(model.error){status(model.error,'error');dl.disabled=true;$('f3dStats').innerHTML='';return;}
  status(model.warning||'',model.warning?'warn':'');
  if(S.viewer==null){try{S.viewer=createViewer($('f3dCanvas'))||false;}catch(e){console.warn('[Foto3D] WebGL',e);S.viewer=false;}}
  if(S.viewer)S.viewer.setMesh(model.mesh,S.lastShape!==S.shape?S.shape:null);
  else $('f3dNoGL').style.display='';
  S.lastShape=S.shape;dl.disabled=false;
  const b=model.bounds,dx=b.max[0]-b.min[0],dy=b.max[1]-b.min[1],dz=b.max[2]-b.min[2];
  const mb=(84+model.mesh.count*50)/1048576,g=estimateGrams(model.volume,model.area),fit=printersThatFit(dx,dy,dz);
  const fitTxt=!fit.length?'No cabe en ninguna impresora del parque':fit[0]==='K1'?'Cabe en todas, desde la K1':'Sólo en: '+fit.join(', ');
  $('f3dStats').innerHTML=`<span><b>${dx.toFixed(1)} × ${dy.toFixed(1)} × ${dz.toFixed(1)} mm</b>ancho × fondo × alto</span>
    <span${fit.length?'':' class="bad"'}><b>${esc(fitTxt)}</b>volumen de impresión</span>
    <span><b>≈ ${Math.round(g)} g de PLA</b>estimado: cáscara 1 mm + 15 % relleno</span>
    <span><b>${model.mesh.count.toLocaleString('es-CL')} triángulos</b>${mb.toFixed(1)} MB · recorte: ${esc(model.mask.label)}</span>`;
}
function download(){
  const m=S.model;if(!m||m.error)return;
  const buf=writeSTL(m.mesh,'Escultor de fotos - '+S.shape);
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([buf],{type:'model/stl'}));
  a.download=`${S.name}-${S.shape}.stl`;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);
  if(typeof toast==='function')try{toast('STL descargado ✓','success');}catch(_){}
}

function init(){
  const root=$('maquinaEscultorView');if(!root||root.dataset.ready)return;root.dataset.ready='1';
  const saved=loadSaved();
  try{const q=localStorage.getItem(AIQ_KEY);if(q&&$('f3dAiQuality')&&[...$('f3dAiQuality').options].some(o=>o.value===q))$('f3dAiQuality').value=q;}catch(_){}
  if(saved.shape&&SHAPES[saved.shape])S.shape=saved.shape;
  if(saved.params&&typeof saved.params==='object')S.params=saved.params;
  renderControls();
  const drop=$('f3dDrop');
  ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over');}));
  // dragleave también salta al pasar sobre un hijo: sólo se apaga al salir de verdad.
  drop.addEventListener('dragleave',e=>{if(!drop.contains(e.relatedTarget))drop.classList.remove('over');});
  drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');});
  drop.addEventListener('drop',e=>onFiles(e.dataTransfer&&e.dataTransfer.files));
  $('f3dFile').addEventListener('change',e=>{onFiles(e.target.files);e.target.value='';});
  // Pegar una imagen (Cmd/Ctrl+V) mientras la vista está abierta.
  document.addEventListener('paste',e=>{
    if(!root.offsetParent||!e.clipboardData)return;
    const it=[...e.clipboardData.items].find(i=>/^image\//.test(i.type));if(it)onFiles([it.getAsFile()]);
  });
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>drawSource()).observe($('f3dSrcWrap'));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();

root.Foto3D={init,setShape,resetShape,resetDetail,setView,runDepth,onSourceChange,onQualityChange,download,core:CORE,_state:S,_setImage:setImage,_rebuild:rebuild};
})(typeof window!=='undefined'?window:globalThis);
