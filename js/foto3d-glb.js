/* js/foto3d-glb.js — malla 3D (GLB) → pieza imprimible.
 *
 * Hunyuan3D devuelve la malla como GLB (glTF binario). Este módulo la lee, la
 * limpia y la deja lista para el STL: sin DOM y sin dependencias, para correr en
 * el navegador y en los tests de Node (module.exports).
 *
 *   parseGLB      GLB → posiciones + índices (con las transformaciones de nodo)
 *   weld          une vértices coincidentes (el STL no los comparte)
 *   dropFloaters  quita las islas diminutas que deja el modelo
 *   fillHoles     cierra agujeros pequeños (un fan desde el centroide)
 *   edgeReport    aristas abiertas / no-manifold
 *   cleanGLB      todo lo anterior + orientación hacia afuera
 *   placeMesh     eje Z arriba, giro, escala en mm y apoyo en la cama
 *   renderFront   profundidad de la vista frontal (para medallón y llavero)
 *
 * Convención de salida (la misma que el resto del Escultor): Z arriba, el frente
 * de la pieza mira hacia −Y y la cama es z = 0.
 */
(function(root){
'use strict';

const MAX_TRIS=6e6;
const GLTF_COMP={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
const GLTF_TYPE={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};

/* ── GLB ───────────────────────────────────────────────────────────────── */
function _bytes(buf){
  if(buf instanceof Uint8Array)return buf;
  if(buf instanceof ArrayBuffer)return new Uint8Array(buf);
  if(buf&&buf.buffer)return new Uint8Array(buf.buffer,buf.byteOffset||0,buf.byteLength);
  throw new Error('El archivo de la malla no es válido');
}
function _readAccessor(json,bin,idx){
  const a=json.accessors&&json.accessors[idx];
  if(!a||a.bufferView==null)throw new Error('GLB con accesor sin datos (no soportado)');
  if(a.sparse)throw new Error('GLB con accesores dispersos (no soportado)');
  const bv=json.bufferViews[a.bufferView],comps=GLTF_TYPE[a.type],size=GLTF_COMP[a.componentType];
  if(!bv||!comps||!size)throw new Error('GLB con un tipo de dato desconocido');
  const stride=bv.byteStride||comps*size,base=(bv.byteOffset||0)+(a.byteOffset||0),n=a.count;
  if(base+(n-1)*stride+comps*size>bin.byteLength)throw new Error('GLB truncado o corrupto');
  const dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
  if(a.componentType===5126){
    if(stride===comps*4&&(bin.byteOffset+base)%4===0)return new Float32Array(bin.buffer,bin.byteOffset+base,n*comps).slice();
    const o=new Float32Array(n*comps);
    for(let i=0;i<n;i++)for(let c=0;c<comps;c++)o[i*comps+c]=dv.getFloat32(base+i*stride+c*4,true);
    return o;
  }
  const o=new Uint32Array(n*comps),get=a.componentType===5121?(p=>dv.getUint8(p)):a.componentType===5123?(p=>dv.getUint16(p,true)):(p=>dv.getUint32(p,true));
  if(a.componentType===5120||a.componentType===5122)throw new Error('GLB con enteros con signo (no soportado)');
  for(let i=0;i<n;i++)for(let c=0;c<comps;c++)o[i*comps+c]=get(base+i*stride+c*size);
  return o;
}
function _matMul(a,b){
  const o=new Float64Array(16);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}
  return o;
}
function _nodeMatrix(n){
  if(n.matrix&&n.matrix.length===16)return Float64Array.from(n.matrix);
  const t=n.translation||[0,0,0],q=n.rotation||[0,0,0,1],s=n.scale||[1,1,1],x=q[0],y=q[1],z=q[2],w=q[3];
  const xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z,m=new Float64Array(16);
  m[0]=(1-2*(yy+zz))*s[0];m[1]=2*(xy+wz)*s[0];m[2]=2*(xz-wy)*s[0];
  m[4]=2*(xy-wz)*s[1];m[5]=(1-2*(xx+zz))*s[1];m[6]=2*(yz+wx)*s[1];
  m[8]=2*(xz+wy)*s[2];m[9]=2*(yz-wx)*s[2];m[10]=(1-2*(xx+yy))*s[2];
  m[12]=t[0];m[13]=t[1];m[14]=t[2];m[15]=1;
  return m;
}
function _det3(m){return m[0]*(m[5]*m[10]-m[9]*m[6])-m[4]*(m[1]*m[10]-m[9]*m[2])+m[8]*(m[1]*m[6]-m[5]*m[2]);}

function parseGLB(buffer){
  const u8=_bytes(buffer),dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  if(u8.length<20||dv.getUint32(0,true)!==0x46546C67)throw new Error('El servicio no devolvió un GLB válido');
  if(dv.getUint32(4,true)!==2)throw new Error('Versión de GLB no soportada');
  const total=Math.min(dv.getUint32(8,true),u8.length);
  let off=12,json=null,bin=null;
  while(off+8<=total){
    const len=dv.getUint32(off,true),type=dv.getUint32(off+4,true),start=off+8;
    if(start+len>u8.length)throw new Error('GLB truncado o corrupto');
    if(type===0x4E4F534A)json=JSON.parse(new TextDecoder().decode(u8.subarray(start,start+len)));
    else if(type===0x004E4942&&!bin)bin=u8.subarray(start,start+len);
    off=start+((len+3)&~3);
  }
  if(!json||!bin)throw new Error('GLB sin geometría');
  for(const e of(json.extensionsRequired||[]))
    if(/draco|meshopt/i.test(e))throw new Error('GLB comprimido ('+e+'): no soportado');
  const parts=[];let nPos=0,nIdx=0;
  const emit=(mesh,M)=>{
    const flip=M&&_det3(M)<0;
    for(const p of mesh.primitives||[]){
      if((p.mode==null?4:p.mode)!==4||!p.attributes||p.attributes.POSITION==null)continue;
      const pos=_readAccessor(json,bin,p.attributes.POSITION);
      let ind;
      if(p.indices!=null)ind=_readAccessor(json,bin,p.indices);
      else{ind=new Uint32Array(pos.length/3);for(let i=0;i<ind.length;i++)ind[i]=i;}
      if(M)for(let i=0;i<pos.length;i+=3){
        const x=pos[i],y=pos[i+1],z=pos[i+2];
        pos[i]=M[0]*x+M[4]*y+M[8]*z+M[12];pos[i+1]=M[1]*x+M[5]*y+M[9]*z+M[13];pos[i+2]=M[2]*x+M[6]*y+M[10]*z+M[14];
      }
      if(flip)for(let i=0;i+2<ind.length;i+=3){const t=ind[i+1];ind[i+1]=ind[i+2];ind[i+2]=t;}
      parts.push({pos,ind});nPos+=pos.length;nIdx+=ind.length;
      if(nIdx/3>MAX_TRIS)throw new Error('La malla es demasiado grande');
    }
  };
  const walk=(ni,parent,depth)=>{
    if(depth>64)return;
    const n=json.nodes[ni];if(!n)return;
    const M=parent?_matMul(parent,_nodeMatrix(n)):_nodeMatrix(n);
    if(n.mesh!=null&&json.meshes[n.mesh])emit(json.meshes[n.mesh],M);
    for(const c of n.children||[])walk(c,M,depth+1);
  };
  if(json.nodes&&json.scenes&&json.scenes.length){
    const sc=json.scenes[json.scene||0]||json.scenes[0];
    for(const ni of sc.nodes||[])walk(ni,null,0);
  }else for(const m of json.meshes||[])emit(m,null);
  if(!parts.length)throw new Error('El GLB no tiene triángulos');
  const positions=new Float32Array(nPos),indices=new Uint32Array(nIdx);
  let po=0,io=0;
  for(const p of parts){
    const base=po/3;positions.set(p.pos,po);
    for(let i=0;i<p.ind.length;i++)indices[io+i]=p.ind[i]+base;
    po+=p.pos.length;io+=p.ind.length;
  }
  return{positions,indices,primitives:parts.length};
}

/* ── Limpieza ──────────────────────────────────────────────────────────── */
function _bbox(pos){
  const mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<pos.length;i+=3)for(let k=0;k<3;k++){const v=pos[i+k];if(v<mn[k])mn[k]=v;if(v>mx[k])mx[k]=v;}
  return{min:mn,max:mx};
}
function _compact(pos,idx){
  // Descarta los vértices que ningún triángulo usa.
  const nv=pos.length/3,map=new Int32Array(nv).fill(-1);let n=0;
  for(let i=0;i<idx.length;i++){const v=idx[i];if(map[v]<0)map[v]=n++;}
  const p=new Float32Array(n*3),ix=new Uint32Array(idx.length);
  for(let v=0;v<nv;v++){const m=map[v];if(m>=0){p[m*3]=pos[v*3];p[m*3+1]=pos[v*3+1];p[m*3+2]=pos[v*3+2];}}
  for(let i=0;i<idx.length;i++)ix[i]=map[idx[i]];
  return{positions:p,indices:ix};
}
// Une vértices que caen en la misma celda de 1e-6 de la diagonal y quita los
// triángulos que quedan degenerados.
function weld(pos,idx,rel){
  const nv=pos.length/3,b=_bbox(pos),diag=Math.hypot(b.max[0]-b.min[0],b.max[1]-b.min[1],b.max[2]-b.min[2])||1;
  const q=Math.max(diag*(rel||1e-6),1e-12);
  const qx=new Int32Array(nv),qy=new Int32Array(nv),qz=new Int32Array(nv);
  for(let v=0;v<nv;v++){qx[v]=Math.round(pos[v*3]/q);qy[v]=Math.round(pos[v*3+1]/q);qz[v]=Math.round(pos[v*3+2]/q);}
  let size=1;while(size<nv*2)size<<=1;
  const table=new Int32Array(size).fill(-1),map=new Int32Array(nv),out=new Float32Array(nv*3);let n=0;
  for(let v=0;v<nv;v++){
    let h=(Math.imul(qx[v],73856093)^Math.imul(qy[v],19349663)^Math.imul(qz[v],83492791))&(size-1);
    for(;;){
      const u=table[h];
      if(u===-1){table[h]=v;map[v]=n;out[n*3]=pos[v*3];out[n*3+1]=pos[v*3+1];out[n*3+2]=pos[v*3+2];n++;break;}
      if(qx[u]===qx[v]&&qy[u]===qy[v]&&qz[u]===qz[v]){map[v]=map[u];break;}
      h=(h+1)&(size-1);
    }
  }
  const keep=[];
  for(let t=0;t+2<idx.length;t+=3){
    const a=map[idx[t]],c=map[idx[t+1]],d=map[idx[t+2]];
    if(a!==c&&c!==d&&a!==d)keep.push(a,c,d);
  }
  return{positions:out.slice(0,n*3),indices:Uint32Array.from(keep),merged:nv-n,degenerate:idx.length/3-keep.length/3};
}
function shells(idx,nv){
  const parent=new Int32Array(nv);for(let i=0;i<nv;i++)parent[i]=i;
  const find=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;};
  const T=idx.length/3;
  for(let t=0;t<T;t++){
    const a=find(idx[t*3]),b=find(idx[t*3+1]),c=find(idx[t*3+2]);
    if(a!==b)parent[b]=a;
    const a2=find(a),c2=find(c);if(a2!==c2)parent[c2]=a2;
  }
  const root=new Int32Array(T),counts=new Int32Array(nv);
  for(let t=0;t<T;t++){const r=find(idx[t*3]);root[t]=r;counts[r]++;}
  let n=0,biggest=0;for(let i=0;i<nv;i++)if(counts[i]){n++;if(counts[i]>biggest)biggest=counts[i];}
  return{root,counts,count:n,biggest};
}
// Quita las islas que tienen menos del `frac` de los triángulos de la mayor.
function dropFloaters(pos,idx,frac){
  const nv=pos.length/3,s=shells(idx,nv),min=Math.max(1,Math.ceil(s.biggest*(frac==null?.01:frac)));
  if(s.count<=1)return{positions:pos,indices:idx,removedShells:0,removedTris:0};
  const keep=[];let removed=0,removedShells=0;
  for(let i=0;i<nv;i++)if(s.counts[i]&&s.counts[i]<min)removedShells++;
  for(let t=0;t<idx.length/3;t++){
    if(s.counts[s.root[t]]>=min)keep.push(idx[t*3],idx[t*3+1],idx[t*3+2]);else removed++;
  }
  const c=_compact(pos,Uint32Array.from(keep));
  return{positions:c.positions,indices:c.indices,removedShells,removedTris:removed};
}
// Clasifica las aristas: la malla cerrada tiene cada arista exactamente una vez
// en cada sentido. Devuelve las abiertas (con su sentido) y las no-manifold.
function edgeReport(idx,nv){
  const T=idx.length/3,keys=new Float64Array(T*3);
  for(let t=0;t<T;t++)for(let e=0;e<3;e++){
    const a=idx[t*3+e],b=idx[t*3+(e+1)%3],lo=a<b?a:b,hi=a<b?b:a;
    keys[t*3+e]=(lo*nv+hi)*2+(a<b?0:1);
  }
  keys.sort();
  const open=[];let nonManifold=0,i=0;
  while(i<keys.length){
    const pair=Math.floor(keys[i]/2);let d0=0,d1=0,j=i,dir=0;
    while(j<keys.length&&Math.floor(keys[j]/2)===pair){if(keys[j]%2===0)d0++;else d1++;dir=keys[j]%2;j++;}
    if(d0+d1===1){
      const lo=Math.floor(pair/nv),hi=pair-lo*nv;
      open.push(dir===0?[lo,hi]:[hi,lo]); // a→b tal como aparece en su triángulo
    }else if(d0!==1||d1!==1)nonManifold++;
    i=j;
  }
  return{open,openCount:open.length,nonManifold};
}
// Cierra los bucles de aristas abiertas de hasta `maxLoop` aristas con un fan
// desde su centroide. Los agujeros grandes (el fondo de un objeto cortado, por
// ejemplo) no se tocan: ahí un fan inventaría geometría.
function fillHoles(pos,idx,maxLoop){
  const nv=pos.length/3,rep=edgeReport(idx,nv);
  if(!rep.openCount)return{positions:pos,indices:idx,filled:0,remaining:0,openEdges:0};
  const next=new Map(),dup=new Set();
  for(const[a,b]of rep.open){if(next.has(a))dup.add(a);next.set(a,b);}
  const used=new Set(),loops=[];let remaining=0;
  for(const[a0]of rep.open){
    if(used.has(a0))continue;
    const loop=[a0];used.add(a0);let cur=next.get(a0),ok=!dup.has(a0);
    while(cur!==a0&&ok){
      if(used.has(cur)||dup.has(cur)||!next.has(cur)){ok=false;break;}
      loop.push(cur);used.add(cur);cur=next.get(cur);
      if(loop.length>(maxLoop||300)+1){ok=false;break;}
    }
    if(ok&&cur===a0&&loop.length>=3&&loop.length<=(maxLoop||300))loops.push(loop);else remaining+=loop.length;
  }
  if(!loops.length)return{positions:pos,indices:idx,filled:0,remaining:rep.openCount,openEdges:rep.openCount};
  const extraV=loops.length,extraT=loops.reduce((s,l)=>s+l.length,0);
  const P=new Float32Array((nv+extraV)*3),I=new Uint32Array(idx.length+extraT*3);
  P.set(pos);I.set(idx);let vi=nv,ti=idx.length;
  for(const loop of loops){
    let cx=0,cy=0,cz=0;
    for(const v of loop){cx+=pos[v*3];cy+=pos[v*3+1];cz+=pos[v*3+2];}
    P[vi*3]=cx/loop.length;P[vi*3+1]=cy/loop.length;P[vi*3+2]=cz/loop.length;
    for(let k=0;k<loop.length;k++){
      const a=loop[k],b=loop[(k+1)%loop.length];
      I[ti++]=b;I[ti++]=a;I[ti++]=vi; // la arista a→b ya existe: el parche lleva b→a
    }
    vi++;
  }
  const after=edgeReport(I,nv+extraV);
  return{positions:P,indices:I,filled:loops.length,remaining:remaining,openEdges:after.openCount};
}
function signedVolume(pos,idx){
  let v=0;
  for(let t=0;t<idx.length;t+=3){
    const a=idx[t]*3,b=idx[t+1]*3,c=idx[t+2]*3;
    v+=pos[a]*(pos[b+1]*pos[c+2]-pos[b+2]*pos[c+1])-pos[a+1]*(pos[b]*pos[c+2]-pos[b+2]*pos[c])+pos[a+2]*(pos[b]*pos[c+1]-pos[b+1]*pos[c]);
  }
  return v/6;
}
function flipWinding(idx){for(let t=0;t+2<idx.length;t+=3){const x=idx[t+1];idx[t+1]=idx[t+2];idx[t+2]=x;}return idx;}

// GLB → malla indexada limpia, en los ejes del GLB. Es la parte cara y no
// depende del tamaño ni del giro: se hace una vez por modelo generado.
function cleanGLB(buffer,opts){
  opts=opts||{};
  const g=parseGLB(buffer),w=weld(g.positions,g.indices);
  const f=dropFloaters(w.positions,w.indices,opts.floaterFrac);
  const before=edgeReport(f.indices,f.positions.length/3);
  const h=fillHoles(f.positions,f.indices,opts.maxHole);
  let positions=h.positions,indices=h.indices,flipped=false;
  // Los modelos bien formados tienen volumen positivo (normales hacia afuera).
  if(signedVolume(positions,indices)<0){indices=flipWinding(Uint32Array.from(indices));flipped=true;}
  const after=edgeReport(indices,positions.length/3);
  return{positions,indices,stats:{
    faces:indices.length/3,vertices:positions.length/3,primitives:g.primitives,
    weldedVertices:w.merged,degenerate:w.degenerate,floaterShells:f.removedShells,floaterTris:f.removedTris,
    openBefore:before.openCount,holesFilled:h.filled,openAfter:after.openCount,nonManifold:after.nonManifold,flipped,
  }};
}

/* ── Colocación ────────────────────────────────────────────────────────── */
// El GLB es Y arriba y su frente mira a +Z. La pieza usa Z arriba y el frente
// hacia −Y (la cámara del visor y la vista frontal del relieve miran desde −Y):
// (x, y, z) → (x, −z, y).
function placeMesh(clean,opts){
  opts=opts||{};
  const pos=clean.positions,idx=clean.indices,nv=pos.length/3,out=new Float32Array(nv*3);
  const rot=((Number(opts.rot)||0)%360)*Math.PI/180,cr=Math.cos(rot),sr=Math.sin(rot);
  for(let v=0;v<nv;v++){
    const x=pos[v*3],y=-pos[v*3+2],z=pos[v*3+1];
    out[v*3]=x*cr-y*sr;out[v*3+1]=x*sr+y*cr;out[v*3+2]=z;
  }
  const b=_bbox(out),span=Math.max(b.max[0]-b.min[0],b.max[1]-b.min[1],b.max[2]-b.min[2])||1;
  const k=(Number(opts.size)>0?Number(opts.size):span)/span,cx=(b.min[0]+b.max[0])/2,cy=(b.min[1]+b.max[1])/2;
  for(let v=0;v<nv;v++){
    out[v*3]=(out[v*3]-cx)*k;out[v*3+1]=(out[v*3+1]-cy)*k;out[v*3+2]=(out[v*3+2]-b.min[2])*k;
  }
  return{positions:out,indices:idx,bounds:_bbox(out)};
}
// Normales por vértice (promedio ponderado por el área de sus caras): sólo para
// el sombreado suave del visor; el STL calcula las suyas por faceta.
function vertexNormals(pos,idx){
  const nv=pos.length/3,n=new Float32Array(nv*3);
  for(let t=0;t<idx.length;t+=3){
    const a=idx[t]*3,b=idx[t+1]*3,c=idx[t+2]*3;
    const ux=pos[b]-pos[a],uy=pos[b+1]-pos[a+1],uz=pos[b+2]-pos[a+2],vx=pos[c]-pos[a],vy=pos[c+1]-pos[a+1],vz=pos[c+2]-pos[a+2];
    const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx;
    for(const i of[a,b,c]){n[i]+=x;n[i+1]+=y;n[i+2]+=z;}
  }
  for(let v=0;v<nv*3;v+=3){const l=Math.hypot(n[v],n[v+1],n[v+2])||1;n[v]/=l;n[v+1]/=l;n[v+2]/=l;}
  return n;
}
// Malla indexada → formato del Escultor: tres vértices por triángulo + normales.
function toTriMesh(pos,idx){
  const T=idx.length/3,tris=new Float32Array(T*9),normals=new Float32Array(T*9),vn=vertexNormals(pos,idx);
  for(let t=0;t<T;t++)for(let k=0;k<3;k++){
    const v=idx[t*3+k]*3,o=t*9+k*3;
    tris[o]=pos[v];tris[o+1]=pos[v+1];tris[o+2]=pos[v+2];
    normals[o]=vn[v];normals[o+1]=vn[v+1];normals[o+2]=vn[v+2];
  }
  return{tris,normals,count:T};
}

/* ── Vista frontal (para medallón y llavero) ──────────────────────────── */
// Rasteriza la malla (en mm, ya colocada) mirando desde −Y: devuelve la
// "cercanía" (1 = lo más cercano al frente) y la cobertura. Es la profundidad
// exacta del modelo 3D; sustituye a la que antes estimaba la IA de profundidad.
function renderFront(pos,idx,maxPx){
  const b=_bbox(pos),dx=b.max[0]-b.min[0]||1,dy=b.max[1]-b.min[1]||1,dz=b.max[2]-b.min[2]||1;
  const sc=((maxPx||768)-1)/Math.max(dx,dz),W=Math.max(2,Math.round(dx*sc)+1),H=Math.max(2,Math.round(dz*sc)+1);
  const depth=new Float32Array(W*H).fill(-1);
  const U=new Float64Array(3),V=new Float64Array(3),N=new Float64Array(3);
  const splat=()=>{
    for(let k=0;k<3;k++){const x=Math.round(U[k]),y=Math.round(V[k]);if(x>=0&&y>=0&&x<W&&y<H&&N[k]>depth[y*W+x])depth[y*W+x]=N[k];}
  };
  for(let t=0;t<idx.length;t+=3){
    for(let k=0;k<3;k++){
      const v=idx[t+k]*3;
      U[k]=(pos[v]-b.min[0])*sc;V[k]=(b.max[2]-pos[v+2])*sc;N[k]=(b.max[1]-pos[v+1])/dy;
    }
    const area=(U[1]-U[0])*(V[2]-V[0])-(U[2]-U[0])*(V[1]-V[0]);
    const x0=Math.max(0,Math.ceil(Math.min(U[0],U[1],U[2])-.5)),x1=Math.min(W-1,Math.floor(Math.max(U[0],U[1],U[2])-.5));
    const y0=Math.max(0,Math.ceil(Math.min(V[0],V[1],V[2])-.5)),y1=Math.min(H-1,Math.floor(Math.max(V[0],V[1],V[2])-.5));
    let wrote=false;
    if(Math.abs(area)>1e-12&&x0<=x1&&y0<=y1){
      const inv=1/area,eps=-1e-7;
      for(let y=y0;y<=y1;y++){
        const py=y+.5;
        for(let x=x0;x<=x1;x++){
          const px=x+.5;
          const w1=((px-U[0])*(V[2]-V[0])-(U[2]-U[0])*(py-V[0]))*inv,w2=((U[1]-U[0])*(py-V[0])-(px-U[0])*(V[1]-V[0]))*inv,w0=1-w1-w2;
          if(w0>=eps&&w1>=eps&&w2>=eps){
            const n=w0*N[0]+w1*N[1]+w2*N[2],p=y*W+x;
            if(n>depth[p])depth[p]=n;
            wrote=true;
          }
        }
      }
    }
    // Un triángulo más chico que un píxel no cubre ningún centro: se marca por sus vértices.
    if(!wrote)splat();
  }
  const alpha=new Uint8Array(W*H);
  for(let i=0;i<W*H;i++){if(depth[i]>=0)alpha[i]=255;else depth[i]=0;}
  return{w:W,h:H,depth,alpha};
}

const API={parseGLB,weld,shells,dropFloaters,edgeReport,fillHoles,signedVolume,flipWinding,cleanGLB,placeMesh,vertexNormals,toTriMesh,renderFront};
if(typeof module!=='undefined'&&module.exports)module.exports=API;
else root.Foto3DGLB=API;
})(typeof window!=='undefined'?window:globalThis);
