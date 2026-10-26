'use strict';
// Analyze a suspicious low-volume STL by edge topology, not only a signed
// tetrahedral volume. Repair only inconsistent face winding of a CLOSED mesh.
// Never fill holes, change coordinates, scale, or alter the customer's original file.
const MAX_TRIANGLES=125000;
function fail(reason,info={}){return{ok:false,reason,...info};}
function triangleData(file){
  if(!Buffer.isBuffer(file))return fail('bad STL');
  if(file.length>=84){
    const n=file.readUInt32LE(80);
    if(n>0&&n<=MAX_TRIANGLES&&file.length===84+50*n){
      const tris=[];
      for(let i=0;i<n;i++){
        const face=[];
        for(let j=0;j<3;j++){
          const vec=[0,1,2].map(k=>file.readFloatLE(84+50*i+12+j*12+k*4));
          if(vec.some(x=>!Number.isFinite(x)))return fail('coordenadas invalidas');
          face.push(vec);
        }
        tris.push(face);
      }
      return{ok:true,faces:tris};
    }
    if(n>MAX_TRIANGLES&&file.length===84+50*n)return fail('malla muy compleja para reparacion automatica');
  }
  const s=file.toString('utf8');
  if(!/^\s*solid(?:\s|$)/i.test(s)||!/\bendsolid\b/i.test(s))return fail('STL invalido');
  const vs=[];
  for(const line of s.split(/\r?\n/)){
    const m=line.match(/^\s*vertex\s+([-+.\deE]+)\s+([-+.\deE]+)\s+([-+.\deE]+)\s*$/i);
    if(!m)continue;
    const v=m.slice(1,4).map(Number);
    if(v.some(x=>!Number.isFinite(x)))return fail('coordenadas invalidas');
    vs.push(v);
    if(vs.length>MAX_TRIANGLES*3)return fail('malla muy compleja para reparacion automatica');
  }
  if(!vs.length||vs.length%3)return fail('STL sin caras completas');
  const faces=[];for(let i=0;i<vs.length;i+=3)faces.push(vs.slice(i,i+3));
  return{ok:true,faces};
}
function tetra(a,b,c){
  const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];
  const v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
  return (a[0]*(u[1]*v[2]-u[2]*v[1])+
    a[1]*(u[2]*v[0]-u[0]*v[2])+
    a[2]*(u[0]*v[1]-u[1]*v[0]))/6;
}
function fixWinding(file){
  const decoded=triangleData(file);
  if(!decoded.ok)return decoded;
  const faces=decoded.faces,n=faces.length,lookup=new Map(),edges=new Map();
  function vertexKey(v){return v.join('|');}
  function vId(v){
    const key=vertexKey(v);
    if(!lookup.has(key))lookup.set(key,lookup.size);
    return lookup.get(key);
  }
  const adjacency=Array.from({length:n},()=>[]);
  for(let i=0;i<n;i++){
    const verts=faces[i].map(vId);
    if(new Set(verts).size!==3)return fail('triangulos degenerados',{degenerate:true});
    for(let j=0;j<3;j++){
      const a=verts[j],b=verts[(j+1)%3];
      const lo=Math.min(a,b),hi=Math.max(a,b);
      const key=lo+'-'+hi,dir=a===lo?1:-1;
      const seen=edges.get(key);
      if(seen){
        if(seen.length>=2)return fail('malla no manifold',{edge:key});
        seen.push({face:i,dir});
      }else edges.set(key,[{face:i,dir}]);
    }
  }
  let openEdges=0;
  for(const occurrences of edges.values()){
    if(occurrences.length!==2){openEdges++;continue;}
    const [a,b]=occurrences;
    const same=a.dir===b.dir;
    adjacency[a.face].push([b.face,same]);
    adjacency[b.face].push([a.face,same]);
  }
  if(openEdges)return fail('malla abierta: faltan caras',{openEdges,faces:n});
  const flip=new Int8Array(n).fill(-1);
  let total=0,adjusted=0,components=0;
  for(let k=0;k<n;k++){
    if(flip[k]>=0)continue;
    components++;
    const queue=[k],group=[k];
    flip[k]=0;
    for(let head=0;head<queue.length;head++){
      const i=queue[head];
      for(const [other,same] of adjacency[i]){
        const expected=flip[i]^(same?1:0);
        if(flip[other]>=0&&flip[other]!==expected)
          return fail('malla no orientable');
        if(flip[other]<0){
          flip[other]=expected;queue.push(other);group.push(other);
        }
      }
    }
    let componentVolume=0;
    for(const i of group){
      const f=faces[i],vol=tetra(f[0],f[1],f[2]);
      componentVolume+=(flip[i]?-1:1)*vol;
    }
    if(componentVolume<0){
      for(const i of group)flip[i]^=1;
      componentVolume=-componentVolume;
    }
    total+=componentVolume;
    adjusted+=group.filter(i=>flip[i]===1).length;
  }
  if(!Number.isFinite(total)||total<1e-10)return fail('volumen casi cero aun tras corregir caras',{volume:total,faces:n});
  const result=Buffer.alloc(84+n*50);
  Buffer.from('TLS STL normal orientation (temporary)').copy(result,0,0,80);
  result.writeUInt32LE(n,80);
  for(let i=0;i<n;i++){
    const f=faces[i],order=flip[i]?[0,2,1]:[0,1,2];
    for(let j=0;j<3;j++)for(let k=0;k<3;k++){
      const v=f[order[j]][k];
      result.writeFloatLE(v,84+50*i+12+j*12+k*4);
    }
  }
  return{ok:true,buffer:result,volume:total,flippedFaces:adjusted,facets:n,components};
}
module.exports={fixWinding,triangleData};
