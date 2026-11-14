// Escultor de fotos — malla 3D (js/foto3d-glb.js): lectura de GLB, limpieza,
// orientación y vista frontal. Todo con mallas sintéticas: no hace falta el
// modelo real para comprobar que la malla que devuelva sea tratada bien.
const test=require('node:test');
const assert=require('node:assert/strict');
const G=require('../js/foto3d-glb.js');

const{sphere,unweld,makeGLB}=require('./foto3d-mesh-helpers.js');
const rep=m=>G.edgeReport(m.indices,m.positions.length/3);

test('parseGLB devuelve las posiciones y los índices tal como se guardaron',()=>{
  const s=sphere(),g=G.parseGLB(makeGLB(s.positions,s.indices));
  assert.deepEqual(Array.from(g.positions),Array.from(s.positions));
  assert.deepEqual(Array.from(g.indices),Array.from(s.indices));
});

test('parseGLB aplica traslación, escala y rotación del nodo',()=>{
  const s=sphere(8,6,1,1,1);
  // escala 2, giro de 90° en Z (x→y) y traslación (5,0,0)
  const q=[0,0,Math.SQRT1_2,Math.SQRT1_2],g=G.parseGLB(makeGLB(s.positions,s.indices,{node:{scale:[2,2,2],rotation:q,translation:[5,0,0]}}));
  // el polo superior (0,1,0) → escala (0,2,0) → giro 90° en Z → (−2,0,0) → traslación (3,0,0)
  assert.ok(Math.abs(g.positions[0]-3)<1e-5&&Math.abs(g.positions[1])<1e-5&&Math.abs(g.positions[2])<1e-5,Array.from(g.positions.slice(0,3)).join());
});

test('un nodo con escala negativa (espejo) conserva las normales hacia afuera',()=>{
  const s=sphere(),g=G.parseGLB(makeGLB(s.positions,s.indices,{node:{scale:[-1,1,1]}}));
  assert.ok(G.signedVolume(g.positions,g.indices)>0);
});

test('parseGLB rechaza archivos que no sirven con un mensaje claro',()=>{
  const s=sphere(),glb=makeGLB(s.positions,s.indices);
  assert.throws(()=>G.parseGLB(new Uint8Array(40).buffer),/GLB válido/);
  assert.throws(()=>G.parseGLB(glb.slice(0,glb.byteLength-200)),/truncado|corrupto/);
  assert.throws(()=>G.parseGLB(makeGLB(s.positions,s.indices,{extensionsRequired:['KHR_draco_mesh_compression']})),/comprimido/);
});

test('weld une los vértices repetidos y deja la malla cerrada',()=>{
  const s=sphere(),u=unweld(s);
  assert.equal(u.positions.length/3,s.indices.length);
  const w=G.weld(u.positions,u.indices);
  assert.equal(w.positions.length/3,s.positions.length/3);
  assert.equal(w.indices.length,s.indices.length);
  const r=rep(w);
  assert.equal(r.openCount,0);assert.equal(r.nonManifold,0);
});

test('dropFloaters quita las islas diminutas y conserva las partes grandes',()=>{
  const a=sphere(),tiny=sphere(6,4,.3,.3,.3,[60,0,0]),big=sphere(12,8,6,6,6,[0,40,0]);
  const join=(...ms)=>{let off=0;const P=[],I=[];for(const m of ms){P.push(...m.positions);I.push(...Array.from(m.indices,i=>i+off));off+=m.positions.length/3;}return{positions:Float32Array.from(P),indices:Uint32Array.from(I)};};
  // la isla tiene 36 triángulos (5 % de los 720 de la mayor); el umbral es el 10 %
  const m=join(a,tiny,big),r=G.dropFloaters(m.positions,m.indices,.1);
  assert.equal(r.removedShells,1);
  assert.equal(r.indices.length,a.indices.length+big.indices.length);
  assert.equal(G.shells(r.indices,r.positions.length/3).count,2);
});

test('fillHoles cierra un agujero chico y no inventa geometría en uno grande',()=>{
  const s=sphere(24,16);
  // agujero chico: se quitan los 6 triángulos que rodean a un vértice del medio
  const v=1+7*24+3,keep=[];
  for(let t=0;t<s.indices.length;t+=3){if(!(s.indices[t]===v||s.indices[t+1]===v||s.indices[t+2]===v))keep.push(s.indices[t],s.indices[t+1],s.indices[t+2]);}
  const holed={positions:s.positions,indices:Uint32Array.from(keep)};
  assert.ok(rep(holed).openCount>0);
  const f=G.fillHoles(holed.positions,holed.indices,300);
  assert.equal(f.filled,1);assert.equal(f.openEdges,0);
  assert.equal(G.edgeReport(f.indices,f.positions.length/3).nonManifold,0);
  assert.ok(G.signedVolume(f.positions,f.indices)>0);
  // agujero grande: medio hemisferio fuera → no se rellena
  const half=[];for(let t=0;t<s.indices.length;t+=3){const y=(s.positions[s.indices[t]*3+1]+s.positions[s.indices[t+1]*3+1]+s.positions[s.indices[t+2]*3+1])/3;if(y<1)half.push(s.indices[t],s.indices[t+1],s.indices[t+2]);}
  const open={positions:s.positions,indices:Uint32Array.from(half)};
  const big=G.fillHoles(open.positions,open.indices,10);
  assert.equal(big.filled,0);assert.ok(big.openEdges>0);
  assert.equal(big.indices.length,open.indices.length);
});

test('edgeReport detecta aristas no-manifold (tres caras en una arista)',()=>{
  const pos=Float32Array.from([0,0,0,1,0,0,0,1,0,0,0,1,0,-1,0]),idx=Uint32Array.from([0,1,2,0,1,3,0,1,4]);
  assert.ok(G.edgeReport(idx,5).nonManifold>=1);
});

test('cleanGLB endereza una malla invertida y lo informa',()=>{
  const s=sphere();G.flipWinding(s.indices); // normales hacia adentro
  const c=G.cleanGLB(makeGLB(s.positions,s.indices));
  assert.equal(c.stats.flipped,true);
  assert.ok(G.signedVolume(c.positions,c.indices)>0);
  assert.equal(c.stats.openAfter,0);assert.equal(c.stats.nonManifold,0);
});

test('cleanGLB: soldar, quitar islas y cerrar agujeros en un solo paso',()=>{
  const a=sphere(),tiny=sphere(6,4,.3,.3,.3,[60,0,0]);
  const P=[...a.positions,...tiny.positions],I=[...a.indices,...Array.from(tiny.indices,i=>i+a.positions.length/3)];
  const u=unweld({positions:Float32Array.from(P),indices:Uint32Array.from(I)});
  const c=G.cleanGLB(makeGLB(u.positions,u.indices),{floaterFrac:.1});
  assert.equal(c.stats.faces,a.indices.length/3);
  assert.equal(c.stats.floaterShells,1);assert.equal(c.stats.openAfter,0);
});

test('placeMesh: Z arriba, frente hacia −Y, escala en mm y apoyada en la cama',()=>{
  // Elipsoide de radios (5, 10, 20) en los ejes del GLB: ancho 10, alto 20, fondo (frente) 40.
  const e=sphere(32,20,5,10,20),p=G.placeMesh({positions:e.positions,indices:e.indices},{size:80}),b=p.bounds;
  const dx=b.max[0]-b.min[0],dy=b.max[1]-b.min[1],dz=b.max[2]-b.min[2];
  assert.ok(Math.abs(Math.max(dx,dy,dz)-80)<1e-3,'el lado mayor mide lo pedido');
  assert.ok(Math.abs(dx/dy-.25)<.01&&Math.abs(dz/dy-.5)<.01,`proporciones ${dx} ${dy} ${dz}`);
  assert.ok(Math.abs(b.min[2])<1e-6,'apoyada en z = 0');
  assert.ok(Math.abs((b.min[0]+b.max[0])/2)<1e-4&&Math.abs((b.min[1]+b.max[1])/2)<1e-4,'centrada en el plato');
  assert.ok(G.signedVolume(p.positions,p.indices)>0,'el volumen sigue positivo');
});

test('placeMesh: el frente del GLB (+Z) queda hacia −Y y "rot" lo gira en el plato',()=>{
  const e=sphere(32,20,5,10,20); // la punta de +Z del GLB es el "frente"
  let tip=0;for(let v=0;v<e.positions.length/3;v++)if(e.positions[v*3+2]>e.positions[tip*3+2])tip=v;
  const at=(rot)=>{const p=G.placeMesh({positions:e.positions,indices:e.indices},{size:80,rot});return[p.positions[tip*3],p.positions[tip*3+1]];};
  const f=at(0),b=at(180);
  assert.ok(f[1]<-19,`frente en −Y (${f[1]})`);
  assert.ok(b[1]>19,`girada 180°: frente en +Y (${b[1]})`);
});

test('renderFront: cobertura circular, centro más cercano que el borde y sin huecos',()=>{
  const s=sphere(200,100,10,10,10),p=G.placeMesh({positions:s.positions,indices:s.indices},{size:80}),r=G.renderFront(p.positions,p.indices,64);
  const cx=(r.w-1)/2,cy=(r.h-1)/2,R=(Math.min(r.w,r.h)-1)/2;
  let holes=0,out=0,covered=0;
  for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
    const d=Math.hypot(x-cx,y-cy),a=r.alpha[y*r.w+x];
    if(d<R*.93&&!a)holes++;
    if(d>R*1.06&&a)out++;
    if(a)covered++;
  }
  assert.equal(holes,0,'ni un hueco dentro del disco (triángulos más chicos que un píxel incluidos)');
  assert.equal(out,0,'nada fuera del disco');
  assert.ok(Math.abs(covered/(r.w*r.h)-Math.PI/4)<.03,`cobertura ${(covered/(r.w*r.h)).toFixed(3)}`);
  const center=r.depth[Math.round(cy)*r.w+Math.round(cx)],rim=r.depth[Math.round(cy)*r.w+Math.round(cx-R*.99)];
  // en el borde del disco la esfera está a media profundidad (0,5); a 0,99 R ya algo más cerca
  assert.ok(center>.97,`centro ${center}`);assert.ok(rim>.45&&rim<.72,`borde ${rim}`);
});

test('toTriMesh: normales unitarias y hacia afuera en la esfera',()=>{
  const s=sphere(24,16,10,10,10),m=G.toTriMesh(s.positions,s.indices);
  assert.equal(m.count,s.indices.length/3);
  let bad=0,outward=0;
  for(let i=0;i<m.count*3;i++){
    const nx=m.normals[i*3],ny=m.normals[i*3+1],nz=m.normals[i*3+2],px=m.tris[i*3],py=m.tris[i*3+1],pz=m.tris[i*3+2];
    if(Math.abs(Math.hypot(nx,ny,nz)-1)>1e-3)bad++;
    if((nx*px+ny*py+nz*pz)/Math.hypot(px,py,pz)>.9)outward++;
  }
  assert.equal(bad,0);assert.ok(outward>m.count*3*.97,`${outward} de ${m.count*3} hacia afuera`);
});

test('rendimiento: una malla de ~200 mil triángulos se limpia y se coloca en segundos',()=>{
  const s=sphere(400,250,10,12,9),t0=Date.now();
  const c=G.cleanGLB(makeGLB(unweld(s).positions,unweld(s).indices)),p=G.placeMesh(c,{size:80}),m=G.toTriMesh(p.positions,p.indices);
  const ms=Date.now()-t0;
  assert.ok(m.count>150000&&c.stats.openAfter===0,`${m.count} triángulos, ${c.stats.openAfter} aristas abiertas`);
  assert.ok(ms<8000,`tardó ${ms} ms`);
});
