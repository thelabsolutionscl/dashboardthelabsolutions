// Ayudantes de los tests del Escultor: mallas sintéticas y un armador de GLB.
// (No termina en .test.js: el runner no lo toma como prueba.)
const G=require('../js/foto3d-glb.js');
// Esfera cerrada (ejes de GLB: Y arriba), con vértices compartidos y volumen positivo.
function sphere(nu=24,nv=16,rx=10,ry=10,rz=10,c=[0,0,0]){
  const pos=[c[0],c[1]+ry,c[2]];
  for(let i=1;i<nv;i++){const ph=Math.PI*i/nv;for(let j=0;j<nu;j++){const th=2*Math.PI*j/nu;
    pos.push(c[0]+rx*Math.sin(ph)*Math.cos(th),c[1]+ry*Math.cos(ph),c[2]+rz*Math.sin(ph)*Math.sin(th));}}
  pos.push(c[0],c[1]-ry,c[2]);
  const ring=(i,j)=>1+(i-1)*nu+(j%nu),bottom=pos.length/3-1,idx=[];
  for(let j=0;j<nu;j++)idx.push(0,ring(1,j+1),ring(1,j));
  for(let i=1;i<nv-1;i++)for(let j=0;j<nu;j++){
    const a=ring(i,j),b=ring(i,j+1),c2=ring(i+1,j),d=ring(i+1,j+1);
    idx.push(a,b,c2,b,d,c2);
  }
  for(let j=0;j<nu;j++)idx.push(bottom,ring(nv-1,j),ring(nv-1,j+1));
  let m={positions:Float32Array.from(pos),indices:Uint32Array.from(idx)};
  if(G.signedVolume(m.positions,m.indices)<0)G.flipWinding(m.indices);
  return m;
}
function unweld(m){ // cada triángulo con sus 3 vértices propios (como un STL)
  const T=m.indices.length/3,p=new Float32Array(T*9),i=new Uint32Array(T*3);
  for(let t=0;t<T;t++)for(let k=0;k<3;k++){
    const v=m.indices[t*3+k];p.set(m.positions.subarray(v*3,v*3+3),t*9+k*3);i[t*3+k]=t*3+k;
  }
  return{positions:p,indices:i};
}
function makeGLB(positions,indices,opts={}){
  const posBytes=new Uint8Array(positions.buffer,positions.byteOffset,positions.byteLength),idxBytes=new Uint8Array(indices.buffer,indices.byteOffset,indices.byteLength);
  const pad=n=>(4-n%4)%4,bin=new Uint8Array(posBytes.length+idxBytes.length);bin.set(posBytes,0);bin.set(idxBytes,posBytes.length);
  let mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<positions.length;i+=3)for(let k=0;k<3;k++){mn[k]=Math.min(mn[k],positions[i+k]);mx[k]=Math.max(mx[k],positions[i+k]);}
  const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[Object.assign({mesh:0},opts.node||{})],meshes:[{primitives:[{attributes:{POSITION:0},indices:1,mode:4}]}],
    buffers:[{byteLength:bin.length}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:posBytes.length},{buffer:0,byteOffset:posBytes.length,byteLength:idxBytes.length}],
    accessors:[{bufferView:0,componentType:5126,count:positions.length/3,type:'VEC3',min:mn,max:mx},{bufferView:1,componentType:5125,count:indices.length,type:'SCALAR'}]};
  if(opts.extensionsRequired)json.extensionsRequired=opts.extensionsRequired;
  let js=new TextEncoder().encode(JSON.stringify(json));const jp=new Uint8Array(js.length+pad(js.length)).fill(0x20);jp.set(js);
  const bp=new Uint8Array(bin.length+pad(bin.length));bp.set(bin);
  const total=12+8+jp.length+8+bp.length,out=new Uint8Array(total),dv=new DataView(out.buffer);
  dv.setUint32(0,0x46546C67,true);dv.setUint32(4,2,true);dv.setUint32(8,total,true);
  dv.setUint32(12,jp.length,true);dv.setUint32(16,0x4E4F534A,true);out.set(jp,20);
  dv.setUint32(20+jp.length,bp.length,true);dv.setUint32(24+jp.length,0x004E4942,true);out.set(bp,28+jp.length);
  return out.buffer;
}

// Toro con el eje en Z de GLB (el frente): visto de frente es un anillo con agujero.
function torus(nu=48,nv=24,R=14,r=5,c=[0,0,0]){
  const pos=[],idx=[];
  for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){
    const th=2*Math.PI*i/nu,ph=2*Math.PI*j/nv;
    pos.push(c[0]+(R+r*Math.cos(ph))*Math.cos(th),c[1]+(R+r*Math.cos(ph))*Math.sin(th),c[2]+r*Math.sin(ph));
  }
  const at=(i,j)=>(i%nu)*nv+(j%nv);
  for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){const a=at(i,j),b=at(i+1,j),c2=at(i,j+1),d=at(i+1,j+1);idx.push(a,b,c2,b,d,c2);}
  const m={positions:Float32Array.from(pos),indices:Uint32Array.from(idx)};
  if(G.signedVolume(m.positions,m.indices)<0)G.flipWinding(m.indices);
  return m;
}
function join(...ms){
  let off=0;const P=[],I=[];
  for(const m of ms){for(const v of m.positions)P.push(v);for(const i of m.indices)I.push(i+off);off+=m.positions.length/3;}
  return{positions:Float32Array.from(P),indices:Uint32Array.from(I)};
}
module.exports={sphere,unweld,makeGLB,torus,join};
