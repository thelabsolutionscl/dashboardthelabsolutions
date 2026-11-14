// Escultor de fotos (js/foto3d.js): el núcleo geométrico debe producir mallas
// cerradas, bien orientadas y del tamaño pedido para cada forma de pieza. Un STL
// con agujeros o normales invertidas se lamina mal o no se lamina.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const CORE=require('../js/foto3d.js');
const GLBM=require('../js/foto3d-glb.js');
const{sphere,torus,join,makeGLB}=require('./foto3d-mesh-helpers.js');

const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const OPS=fs.readFileSync(path.join(ROOT,'js','maquinas-operaciones.js'),'utf8');
const SRC=fs.readFileSync(path.join(ROOT,'js','foto3d.js'),'utf8');
function syntheticImage(w=180,h=220,opts={}){
  const rgba=new Uint8ClampedArray(w*h*4),depth=new Float32Array(w*h);
  const cx=w/2,cy=h*.55,rx=w*.3,ry=h*.38;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,u=(x-cx)/rx,v=(y-cy)/ry,r2=u*u+v*v,inside=r2<=1;
    const c=inside?60+Math.round(40*Math.sin(x*.3)):245;
    rgba[i*4]=c;rgba[i*4+1]=c;rgba[i*4+2]=inside?90:245;rgba[i*4+3]=opts.alpha?(inside?255:0):255;
    depth[i]=inside?.4+.6*Math.sqrt(1-r2):.05+.02*(y/h);
  }
  return{img:{w,h,rgba},depth};
}

function key(t,i){return t[i].toFixed(4)+','+t[i+1].toFixed(4)+','+t[i+2].toFixed(4);}
// Cerrada y orientable: cada arista dirigida aparece una vez y su opuesta también.
function assertWatertight(mesh,label){
  const t=mesh.tris,edges=new Map();
  let degenerate=0;
  for(let f=0;f<mesh.count;f++){
    const b=f*9,k=[key(t,b),key(t,b+3),key(t,b+6)];
    if(k[0]===k[1]||k[1]===k[2]||k[0]===k[2]){degenerate++;continue;}
    for(let e=0;e<3;e++){const id=k[e]+'>'+k[(e+1)%3];edges.set(id,(edges.get(id)||0)+1);}
  }
  assert.equal(degenerate,0,`${label}: triángulos degenerados`);
  let bad=0;
  for(const[id,n]of edges){
    const[a,b]=id.split('>');
    if(n!==1||edges.get(b+'>'+a)!==1)bad++;
  }
  assert.equal(bad,0,`${label}: ${bad} aristas abiertas o no-manifold`);
  return edges;
}
// Característica de Euler por componentes: esfera = 2, con un agujero pasante = 0.
function eulerCharacteristic(mesh){
  const t=mesh.tris,V=new Set(),E=new Set();
  for(let f=0;f<mesh.count;f++){
    const b=f*9,k=[key(t,b),key(t,b+3),key(t,b+6)];
    k.forEach(x=>V.add(x));
    for(let e=0;e<3;e++){const a=k[e],c=k[(e+1)%3];E.add(a<c?a+'|'+c:c+'|'+a);}
  }
  return V.size-E.size+mesh.count;
}

test('buildSolid sobre una máscara simple da un sólido cerrado con volumen correcto',()=>{
  const w=10,h=6,mask=new Uint8Array(w*h).fill(1),top=new Float32Array(w*h).fill(3),bot=new Float32Array(w*h);
  const m=CORE.buildSolid({w,h,mask,top,bot,px:2});
  assertWatertight(m,'caja');
  assert.ok(Math.abs(CORE.meshVolume(m)-20*12*3)<1e-3,'volumen 20×12×3 mm');
  assert.equal(eulerCharacteristic(m),2);
});

test('las celdas unidas sólo por la esquina se corrigen antes de mallar',()=>{
  const w=4,h=4,mask=new Uint8Array(w*h);
  mask[1*w+1]=1;mask[2*w+2]=1; // diagonal pura → arista con 4 caras
  const fixed=CORE.fixDiagonals(mask,w,h);
  const top=new Float32Array(w*h).fill(2),bot=new Float32Array(w*h);
  assertWatertight(CORE.buildSolid({w,h,mask:fixed,top,bot,px:1}),'diagonal');
});

test('cada forma produce una malla cerrada, positiva y del tamaño pedido',()=>{
  const{img,depth}=syntheticImage();
  const F=CORE.prepareFields(img,depth);
  for(const shape of Object.keys(CORE.SHAPES)){
    const r=CORE.buildModel(F,shape,{res:120});
    assert.ok(!r.error,`${shape}: ${r.error}`);
    assertWatertight(r.mesh,shape);
    assert.ok(r.volume>0,`${shape}: volumen positivo (normales hacia afuera)`);
    assert.ok(Math.abs(r.bounds.min[2])<1e-4,`${shape}: apoya en Z=0`);
    const b=r.bounds,dx=b.max[0]-b.min[0],dy=b.max[1]-b.min[1],dz=b.max[2]-b.min[2];
    const size=CORE.SHAPES[shape].defaults.size;
    if(shape==='figura'){
      // De pie: el alto es el lado mayor del sujeto más la base.
      assert.ok(dz>size*.9&&dz<size+CORE.SHAPES.figura.defaults.baseH+2,`figura: alto ${dz}`);
      assert.equal(r.shells,2,'figura: cuerpo + base');
    }else if(shape==='llavero'){
      assert.ok(dy>size&&dy<size*1.5,`llavero: alto incluye la argolla (${dy})`);
      assert.equal(eulerCharacteristic(r.mesh),0,'llavero: la argolla es un agujero pasante');
    }else{
      assert.ok(Math.max(dx,dy)>size*.85&&Math.max(dx,dy)<size*1.12,`${shape}: lado mayor ${Math.max(dx,dy)}`);
    }
  }
});

test('la figura queda de pie, de frente hacia −Y y hundida en su base',()=>{
  const{img,depth}=syntheticImage();
  const r=CORE.buildModel(CORE.prepareFields(img,depth),'figura',{res:100,baseH:5});
  const b=r.bounds;
  assert.ok(b.max[2]-b.min[2]>b.max[1]-b.min[1],'más alta que profunda');
  // El cuerpo baja por debajo del techo de la base (5 mm): no queda flotando.
  const t=r.mesh.tris,baseTris=96*4;let bodyMinZ=Infinity;
  for(let i=0;i<(r.mesh.count-baseTris)*9;i+=3)bodyMinZ=Math.min(bodyMinZ,t[i+2]);
  assert.ok(bodyMinZ<5&&bodyMinZ>0,`cuerpo hundido en la base (z=${bodyMinZ})`);
});

test('el medallón respeta marco, placa circular y agujero para colgar',()=>{
  const{img,depth}=syntheticImage();
  const F=CORE.prepareFields(img,depth);
  const conHoyo=CORE.buildModel(F,'medallon',{res:120,plate:'circular',hang:true});
  const sinHoyo=CORE.buildModel(F,'medallon',{res:120,plate:'circular',hang:false});
  assertWatertight(conHoyo.mesh,'medallón');
  assert.equal(eulerCharacteristic(conHoyo.mesh),0);
  assert.equal(eulerCharacteristic(sinHoyo.mesh),2);
  const b=sinHoyo.bounds;
  assert.ok(Math.abs((b.max[0]-b.min[0])-(b.max[1]-b.min[1]))<2,'circular: ancho ≈ alto');
});

test('el recorte usa la transparencia del PNG y avisa si queda vacío',()=>{
  const{img,depth}=syntheticImage(140,160,{alpha:true});
  const F=CORE.prepareFields(img,depth);
  assert.equal(F.hasAlpha,true);
  assert.equal(CORE.maskSource(F,{maskMode:'auto'}).mode,'alpha');
  const vacio=CORE.buildModel(F,'llavero',{res:80,maskMode:'alpha',maskAdj:49});
  assert.ok(vacio.error||vacio.mesh.count>0);
  const blanco={w:40,h:40,rgba:new Uint8ClampedArray(40*40*4).fill(255)};
  const r=CORE.buildModel(CORE.prepareFields(blanco,null),'figura',{res:60,maskMode:'color'});
  assert.match(r.error||'',/sujeto|recorte/i);
});

test('sin IA el relieve sale del brillo y el fondo parejo se detecta solo',()=>{
  const{img}=syntheticImage();
  const F=CORE.prepareFields(img,null);
  assert.equal(F.depthN,null);
  assert.equal(F.bgUniform,true);
  assert.equal(CORE.maskSource(F,{maskMode:'auto'}).mode,'color');
  const r=CORE.buildModel(F,'objeto',{res:90,backMode:'plano'});
  assertWatertight(r.mesh,'objeto plano');
});

test('writeSTL genera un STL binario válido',()=>{
  const w=3,h=3,mask=new Uint8Array(9).fill(1),top=new Float32Array(9).fill(1),bot=new Float32Array(9);
  const m=CORE.buildSolid({w,h,mask,top,bot,px:1});
  const buf=CORE.writeSTL(m,'prueba');
  assert.equal(buf.byteLength,84+m.count*50);
  assert.equal(new DataView(buf).getUint32(80,true),m.count);
});

test('el escultor está enlazado en el Taller de Máquinas',()=>{
  assert.match(INDEX,/data-maq-view=["']escultor["']/,'falta la sección en index.html');
  assert.match(INDEX,/<script src="js\/foto3d-glb\.js\?v=%%BUILD%%"><\/script>\s*<script src="js\/foto3d\.js\?v=%%BUILD%%"><\/script>/,'foto3d-glb.js debe cargarse justo antes de foto3d.js');
  const groups=OPS.slice(OPS.indexOf('const VIEW_GROUPS='),OPS.indexOf('const VIEW_TITLES='));
  assert.match(groups,/taller:\[[^\]]*'escultor'/,'escultor debe pertenecer a la pantalla Taller');
  assert.match(OPS,/workshopNavCard\('escultor'/,'falta la tarjeta de acceso en el Taller');
});

function shapeImage(w,h,inside){
  const rgba=new Uint8ClampedArray(w*h*4),depth=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,v=inside(x,y);const c=v?60:245;rgba.set([c,c,v?90:245,255],i*4);depth[i]=v?.7:.05;}
  return CORE.prepareFields({w,h,rgba},depth);
}
function shellCount(mesh){
  const t=mesh.tris,par=new Map(),find=x=>{while(par.get(x)!==x){par.set(x,par.get(par.get(x)));x=par.get(x);}return x;};
  for(let f=0;f<mesh.count;f++){
    const b=f*9,k=[key(t,b),key(t,b+3),key(t,b+6)];
    for(const x of k)if(!par.has(x))par.set(x,x);
    par.set(find(k[0]),find(k[1]));par.set(find(k[1]),find(k[2]));
  }
  const roots=new Set();for(const x of par.keys())roots.add(find(x));return roots.size;
}

test('llavero: la argolla queda unida aunque el sujeto tenga dos orejas',()=>{
  const F=shapeImage(200,200,(x,y)=>((x-100)/60)**2+((y-120)/55)**2<=1||((x-55)/14)**2+((y-50)/30)**2<=1||((x-145)/14)**2+((y-50)/30)**2<=1);
  const r=CORE.buildModel(F,'llavero',{res:160});
  assert.ok(!r.warning,r.warning);
  assertWatertight(r.mesh,'llavero orejas');
  assert.equal(shellCount(r.mesh),1,'argolla y sujeto deben ser un solo cuerpo');
  assert.equal(eulerCharacteristic(r.mesh),0,'la argolla conserva su agujero');
});

test('figura: patas de distinto largo apoyan todas en la base',()=>{
  const F=shapeImage(200,240,(x,y)=>((x-100)/60)**2+((y-100)/70)**2<=1||(x>60&&x<80&&y>140&&y<230)||(x>120&&x<140&&y>140&&y<224));
  const r=CORE.buildModel(F,'figura',{res:160,baseH:5});
  assertWatertight(r.mesh,'figura patas');
  const t=r.mesh.tris,n=(r.mesh.count-96*4)*9;
  for(const[lo,hi]of[[-40,-15],[15,40]]){
    let z=Infinity;for(let i=0;i<n;i+=3)if(t[i]>lo&&t[i]<hi)z=Math.min(z,t[i+2]);
    assert.ok(z<5,`la pata en x∈[${lo},${hi}] debe hundirse en la base (z=${z.toFixed(2)})`);
  }
});

test('"Imagen completa" respeta el tamaño pedido y el llavero conserva la argolla',()=>{
  const F=shapeImage(100,100,()=>true);
  const r=CORE.buildModel(F,'objeto',{res:100,maskMode:'none',size:100,backMode:'plano'});
  assert.ok(Math.abs((r.bounds.max[0]-r.bounds.min[0])-100)<.5,'sin margen extra fuera de la foto');
  const k=CORE.buildModel(F,'llavero',{res:120,maskMode:'none'});
  assertWatertight(k.mesh,'llavero completo');
  assert.equal(eulerCharacteristic(k.mesh),0,'el llavero debe tener agujero');
});

test('invertir también invierte el detalle fino',()=>{
  const{img,depth}=syntheticImage();
  const F=CORE.prepareFields(img,depth);
  const a=CORE.buildModel(F,'objeto',{res:80,detail:40,gamma:1,invert:false}).grid.d;
  const b=CORE.buildModel(F,'objeto',{res:80,detail:40,gamma:1,invert:true}).grid.d;
  let maxErr=0;for(let i=0;i<a.length;i++)maxErr=Math.max(maxErr,Math.abs(a[i]+b[i]-1));
  assert.ok(maxErr<1e-5,`d invertido debe ser 1−d (error ${maxErr})`);
});

test('medallón sin sujeto avisa en vez de salir plano en silencio',()=>{
  const blanco={w:60,h:60,rgba:new Uint8ClampedArray(60*60*4).fill(255)};
  const r=CORE.buildModel(CORE.prepareFields(blanco,null),'medallon',{res:60,maskMode:'color'});
  assert.match(r.warning,/sujeto/);
});

test('estimación de gramos y ajuste al volumen de las impresoras',()=>{
  // Cubo macizo de 20 mm: 8 cm³; con cáscara de 1 mm y 15 % de relleno pesa bastante menos.
  const g=CORE.estimateGrams(8000,2400);
  assert.ok(g>2.5&&g<4.5,`gramos ${g}`);
  assert.deepEqual(CORE.printersThatFit(200,200,200),['K1','K2','Ender-5 Max','K2 Plus','Giga']);
  assert.deepEqual(CORE.printersThatFit(300,100,560),['Ender-5 Max','Giga']);
  assert.deepEqual(CORE.printersThatFit(900,10,10),[]);
});

// ── Worker de IA: se ejecuta con un transformers.js falso ─────────────────
test('figura: avisa si el centro de masa cae fuera de la base',()=>{
  // Sujeto con todo el peso a un costado y patita fina al otro: sin base se vuelca.
  const F=shapeImage(220,200,(x,y)=>((x-160)/45)**2+((y-80)/50)**2<=1||(x>40&&x<60&&y>60&&y<190)||(y>50&&y<70&&x>40&&x<160));
  const sinBase=CORE.buildModel(F,'figura',{res:120,baseShape:'ninguna'});
  assert.match(sinBase.warning,/volcarse/);
  const{img,depth}=syntheticImage();
  const ok=CORE.buildModel(CORE.prepareFields(img,depth),'figura',{res:100});
  assert.ok(!/volcarse/.test(ok.warning),'una figura centrada sobre su base no avisa');
});

// ── Fidelidad a la foto (auditoría del mallador) ──────────────────────────
// Rueda sintética: cubierta, maza y 12 rayos sobre fondo negro, con un cuerpo
// pegado. La "IA" devuelve una profundidad que varía en toda la pieza y mezcla
// el borde con el fondo en ~2 px, como hace el modelo real.
function wheelImage(spokeW=3){
  const w=320,h=300,rgba=new Uint8ClampedArray(w*h*4),gt=new Uint8Array(w*h),truth=new Float32Array(w*h);
  const cx=150,cy=160;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const dx=x-cx,dy=y-cy,r=Math.hypot(dx,dy),a=Math.atan2(dy,dx);
    const tire=r>=95&&r<=120,hub=r<=18,spoke=r<95&&r>18&&Math.abs(((a/(Math.PI/6))%1+1.5)%1-.5)*r*Math.PI/6<spokeW/2;
    const body=x>240&&x<300&&y>40&&y<200;
    const on=tire||hub||spoke||body,i=y*w+x;gt[i]=on?1:0;
    const c=on?200:5;rgba[i*4]=c;rgba[i*4+1]=c;rgba[i*4+2]=c;rgba[i*4+3]=255;
    truth[i]=.4+.4*(x/w)+.2*Math.max(0,1-r*r/14400);
  }
  const n=w*h;let d=new Float32Array(n);for(let i=0;i<n;i++)d[i]=gt[i]?truth[i]:.05;
  for(let pass=0;pass<2;pass++){const o=new Float32Array(n);for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0,c=0;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const xx=x+i,yy=y+j;if(xx<0||yy<0||xx>=w||yy>=h)continue;s+=d[yy*w+xx];c++;}o[y*w+x]=s/c;}d=o;}
  return{F:CORE.prepareFields({w,h,rgba},d),gt,truth,w,h};
}
function gridVsPhoto(r,W,fn){
  const G=r.grid,spc=r.place.spc;
  for(let j=0;j<G.h;j++)for(let i=0;i<G.w;i++){const xi=Math.floor(G.rect.x+(i+.5)*spc),yi=Math.floor(G.rect.y+(j+.5)*spc);fn(j*G.w+i,xi,yi);}
}

test('fidelidad: la silueta coincide con la foto, sin engordar ni correrse',()=>{
  const{F,gt,w,h}=wheelImage();
  const r=CORE.buildModel(F,'objeto',{res:220,size:120});
  let best=null;
  for(let sy=-1;sy<=1;sy++)for(let sx=-1;sx<=1;sx++){
    let I=0,U=0;gridVsPhoto(r,w,(c,xi,yi)=>{xi+=sx;yi+=sy;const a=xi>=0&&yi>=0&&xi<w&&yi<h?gt[yi*w+xi]:0,b=r.grid.mask[c];if(a&&b)I++;if(a||b)U++;});
    if(!best||I/U>best.iou)best={sx,sy,iou:I/U};
  }
  assert.ok(best.iou>.93,`IoU ${best.iou.toFixed(3)}`);
  assert.deepEqual([best.sx,best.sy],[0,0],'la malla no debe quedar corrida respecto de la foto');
  // Área: la cobertura ≥ 50 % no debe engordar la pieza (antes sumaba ~4 %).
  const G=r.grid,mmPerPx=G.px/r.place.spc;let cells=0;for(let i=0;i<G.mask.length;i++)cells+=G.mask[i];
  const gA=gt.reduce((s,v)=>s+v,0)*mmPerPx*mmPerPx,mA=cells*G.px*G.px;
  assert.ok(Math.abs(mA/gA-1)<.03,`área ${(100*(mA/gA-1)).toFixed(1)} %`);
});

test('fidelidad: los huecos imprimibles quedan abiertos y los rayos se conservan',()=>{
  const{F}=wheelImage(3);
  const r=CORE.buildModel(F,'objeto',{res:220,size:120,backMode:'plano'});
  assertWatertight(r.mesh,'rueda');
  assert.equal(shellCount(r.mesh),1,'maza, rayos, cubierta y cuerpo en una sola pieza');
  const genus=(2-eulerCharacteristic(r.mesh))/2;
  assert.ok(genus>=11,`los 12 huecos entre rayos deben quedar abiertos (hay ${genus})`);
});

test('fidelidad: detalles más finos que 0,8 mm se engrosan en vez de borrarse',()=>{
  const{F}=wheelImage(2);           // a 40 mm los rayos miden ~0,3 mm
  const r=CORE.buildModel(F,'objeto',{res:220,size:40,backMode:'plano'});
  assertWatertight(r.mesh,'rueda chica');
  assert.equal(shellCount(r.mesh),1,'la maza sigue unida por los rayos engrosados');
  const G=r.grid,c=Math.round((150-G.rect.x)/r.place.spc),rr=Math.round((160-G.rect.y)/r.place.spc);
  assert.equal(G.mask[rr*G.w+c],1,'la maza está en la pieza');
});

test('fidelidad: el relieve sigue a la profundidad de la IA y los rayos no hunden la rueda',()=>{
  const{F,gt,truth,w,h}=wheelImage();
  const r=CORE.buildModel(F,'objeto',{res:220,size:120});
  const A=[],B=[];
  gridVsPhoto(r,w,(c,xi,yi)=>{if(r.grid.mask[c]&&xi>=0&&yi>=0&&xi<w&&yi<h&&gt[yi*w+xi]){A.push(r.grid.d[c]);B.push(truth[yi*w+xi]);}});
  const m=a=>a.reduce((s,v)=>s+v,0)/a.length,ma=m(A),mb=m(B);let nu=0,da=0,db=0;
  for(let i=0;i<A.length;i++){nu+=(A[i]-ma)*(B[i]-mb);da+=(A[i]-ma)**2;db+=(B[i]-mb)**2;}
  const rho=nu/Math.sqrt(da*db);
  assert.ok(rho>.97,`correlación del relieve ${rho.toFixed(3)}`);
});

test('las caras de apoyo quedan exactamente en z = 0 y el STL es una copia exacta de la malla',()=>{
  const{F}=wheelImage();
  for(const[shape,p]of[['objeto',{backMode:'plano'}],['llavero',{}],['medallon',{}]]){
    const r=CORE.buildModel(F,shape,{res:120,...p}),t=r.mesh.tris;let off=0;
    for(let f=0;f<r.mesh.count;f++){const b=f*9;
      const nz=(t[b+3]-t[b])*(t[b+7]-t[b+1])-(t[b+4]-t[b+1])*(t[b+6]-t[b]);
      const l=Math.hypot((t[b+4]-t[b+1])*(t[b+8]-t[b+2])-(t[b+5]-t[b+2])*(t[b+7]-t[b+1]),(t[b+5]-t[b+2])*(t[b+6]-t[b])-(t[b+3]-t[b])*(t[b+8]-t[b+2]),nz);
      if(nz/l<-.999&&Math.max(Math.abs(t[b+2]),Math.abs(t[b+5]),Math.abs(t[b+8]))>1e-9)off++;}
    assert.equal(off,0,`${shape}: cara de apoyo fuera de z = 0`);
  }
  const r=CORE.buildModel(F,'objeto',{res:100}),buf=CORE.writeSTL(r.mesh,'x'),dv=new DataView(buf);
  for(let f=0;f<r.mesh.count;f++)for(let k=0;k<9;k++)
    assert.equal(dv.getFloat32(84+f*50+12+4*k,true),Math.fround(r.mesh.tris[f*9+k]));
});

test('contorno suave: sin caras volteadas y sin escalones de una celda',()=>{
  const{F}=wheelImage();
  const r=CORE.buildModel(F,'objeto',{res:160,size:120});
  assertWatertight(r.mesh,'contorno');
  // Con alturas constantes (arriba 1, abajo 0) las caras superiores son las de
  // z = 1: todas deben conservar su orientación en planta tras correr el borde.
  const G=r.grid,cnt=CORE.vertexCounts(G.mask,G.w,G.h);
  const phi=CORE.gaussianBlur(CORE.signedDistance(G.mask,G.w,G.h),G.w,G.h,1);
  const{ox,oy}=CORE.snapContour(G.mask,G.w,G.h,phi,cnt);
  const nv=(G.w+1)*(G.h+1),m=CORE.buildSolid({w:G.w,h:G.h,mask:G.mask,vt:new Float32Array(nv).fill(1),vb:new Float32Array(nv),ox,oy,px:1});
  assertWatertight(m,'contorno corrido');
  const t=m.tris;let tops=0,flipped=0,moved=0;
  for(let f=0;f<m.count;f++){const b=f*9;if(t[b+2]!==1||t[b+5]!==1||t[b+8]!==1)continue;tops++;
    if((t[b+3]-t[b])*(t[b+7]-t[b+1])-(t[b+4]-t[b+1])*(t[b+6]-t[b])<=0)flipped++;}
  for(let v=0;v<nv;v++)if(ox[v]||oy[v])moved++;
  assert.ok(tops>0);
  assert.equal(flipped,0,'ninguna cara superior se voltea');
  assert.ok(moved>0,'el contorno debe seguir la curva, no la escalera de la grilla');
});

// ── Definición: ondas del ViT y cantos (auditoría de definición) ─────────
// Modelo falso que reproduce el defecto real del ViT: la profundidad verdadera
// (codificada en el rojo de la imagen) más ondas atadas a la grilla de parches
// de 14 px del tamaño al que el procesador escala la imagen.
test('suavizado: quita las ondas sin borrar un escalón real (filtro guiado)',()=>{
  // Brazo delante del cuerpo: escalón de 0,3 + ondas de ±0,02.
  const w=120,h=80,n=w*h,p=new Float32Array(n),clean=new Float32Array(n),mask=new Uint8Array(n).fill(1);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;clean[i]=x<60?.4:.7;p[i]=clean[i]+.02*Math.sin(2*Math.PI*x/7)*Math.sin(2*Math.PI*y/7);}
  // mismo umbral que usa buildModel: 10 % del rango del sujeto (aquí 0,3)
  const g=CORE.guidedSmooth(p,mask,w,h,3,Math.pow(.1*.3,2)),gb=CORE.gaussianBlur(p,w,h,2);
  let rip=0,ripG=0,c=0;for(let y=10;y<h-10;y++)for(let x=10;x<w-10;x++){if(Math.abs(x-59.5)<6)continue;const i=y*w+x;rip+=(g[i]-clean[i])**2;ripG+=(p[i]-clean[i])**2;c++;}
  assert.ok(Math.sqrt(rip/c)<Math.sqrt(ripG/c)*.5,'las ondas bajan a menos de la mitad');
  const row=40*w,stepG=g[row+62]-g[row+57],stepB=gb[row+62]-gb[row+57];
  assert.ok(stepG>.27,`el escalón se conserva (${stepG.toFixed(3)} de 0,3)`);
  assert.ok(stepG>stepB+.03,'y queda más nítido que con un desenfoque gaussiano');
});

test('NaN o infinito en la profundidad nunca llegan al STL',()=>{
  const w=200,h=150,n=w*h,rgba=new Uint8ClampedArray(n*4),depth=new Float32Array(n);
  for(let i=0;i<n;i++){const x=i%w,y=(i/w)|0,inside=((x-100)/70)**2+((y-75)/50)**2<1;rgba.set(inside?[180,180,180,255]:[5,5,5,255],i*4);depth[i]=inside?.7:.1;}
  for(let k=0;k<300;k++)depth[(k*997)%n]=k%2?NaN:Infinity;
  const r=CORE.buildModel(CORE.prepareFields({w,h,rgba},depth),'objeto',{res:120});
  assert.ok(r.mesh.tris.every(Number.isFinite),'todos los vértices son números');
  assert.ok(r.volume>0);
  assertWatertight(r.mesh,'profundidad con NaN');
});

test('picos de una celda se eliminan sin redondear un escalón real',()=>{
  const w=60,h=40,n=w*h,p=new Float32Array(n),mask=new Uint8Array(n).fill(1);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)p[y*w+x]=x<30?.3:.7;
  for(const[x,y]of[[10,10],[45,20],[20,30]])p[y*w+x]=1.5;
  const m=CORE.maskedMedian3(p,mask,w,h);
  for(const[x,y]of[[10,10],[45,20],[20,30]])assert.ok(m[y*w+x]<.8,'el pico desaparece');
  assert.ok(Math.abs(m[20*w+29]-.3)<1e-6&&Math.abs(m[20*w+30]-.7)<1e-6,"el escalón queda intacto a ambos lados");
});

// ── Motor de render: triangulación y normales ─────────────────────────────
test('malla: cada celda se parte por la diagonal que une sus esquinas de altura parecida',()=>{
  // Cresta en diagonal: v00 y v11 a la misma altura, v10 y v01 a alturas distintas
  // más abajo. La arista debe unir los dos de la cresta (orden: v00, v10, v01, v11).
  const vt=new Float32Array([1,.5, 0,1]),vb=new Float32Array(4).fill(-1),mask=new Uint8Array([1]);
  const m=CORE.buildSolid({w:1,h:1,mask,vt,vb,px:1}),t=m.tris;
  const has=(a,b)=>{for(let f=0;f<m.count;f++)for(let e=0;e<3;e++){const i=f*9+e*3,j=f*9+((e+1)%3)*3;
    const P=[t[i],t[i+1],t[i+2]],Q=[t[j],t[j+1],t[j+2]];
    if((P+''===a+''&&Q+''===b+'')||(P+''===b+''&&Q+''===a+''))return true;}return false;};
  assert.ok(has([0,1,1],[1,0,1]),'la diagonal sigue la cresta (une los dos vértices altos)');
  assert.ok(!has([0,0,0],[1,1,.5]),'y no la cruza por los vértices bajos');
  assertWatertight(m,'celda con cresta');
});

test('malla: las normales para el visor son unitarias, apuntan hacia afuera y no cambian el STL',()=>{
  const{img,depth}=syntheticImage();
  const r=CORE.buildModel(CORE.prepareFields(img,depth),'figura',{res:90}),m=r.mesh,t=m.tris,q=m.normals;
  assert.equal(q.length,m.count*9,'una normal por vértice de triángulo');
  let bad=0,against=0;
  for(let f=0;f<m.count;f++){
    const b=f*9,ux=t[b+3]-t[b],uy=t[b+4]-t[b+1],uz=t[b+5]-t[b+2],vx=t[b+6]-t[b],vy=t[b+7]-t[b+1],vz=t[b+8]-t[b+2];
    const fx=uy*vz-uz*vy,fy=uz*vx-ux*vz,fz=ux*vy-uy*vx,fl=Math.hypot(fx,fy,fz);
    for(let k=0;k<3;k++){
      const nx=q[b+k*3],ny=q[b+k*3+1],nz=q[b+k*3+2];
      if(Math.abs(Math.hypot(nx,ny,nz)-1)>1e-3)bad++;
      // suavizada, pero del mismo lado que la cara (nunca hacia adentro)
      if(fl>1e-9&&(nx*fx+ny*fy+nz*fz)/fl<-.2)against++;
    }
  }
  assert.equal(bad,0,'normales unitarias');
  assert.ok(against<m.count*3*.002,`normales del lado de la cara (${against} en contra)`);
  // El STL sólo depende de los triángulos: calcula su propia normal por faceta.
  const a=Buffer.from(CORE.writeSTL(m,'x')),b2=Buffer.from(CORE.writeSTL({tris:m.tris,count:m.count},'x'));
  assert.ok(a.equals(b2),'writeSTL ignora las normales del visor');
});

test('malla: sobre una cúpula lisa las normales varían de forma continua entre celdas vecinas',()=>{
  const w=40,h=40,nv=41*41,vt=new Float32Array(nv),vb=new Float32Array(nv),mask=new Uint8Array(w*h).fill(1);
  for(let j=0;j<=h;j++)for(let i=0;i<=w;i++){const u=(i-20)/20,v=(j-20)/20;vt[j*41+i]=2+8*Math.max(0,1-u*u-v*v);}
  const m=CORE.buildSolid({w,h,mask,vt,vb,px:1}),t=m.tris,q=m.normals,seen=new Map();let worst=0;
  for(let i=0;i<m.count*9;i+=3){
    if(t[i+2]<1)continue; // sólo la cara superior…
    if(t[i]<=0||t[i]>=40||t[i+1]<=0||t[i+1]>=40)continue; // …sin el borde, que comparte posición con las paredes
    const k=t[i]+','+t[i+1]+','+t[i+2],n=[q[i],q[i+1],q[i+2]],p=seen.get(k);
    if(p)worst=Math.max(worst,Math.hypot(p[0]-n[0],p[1]-n[1],p[2]-n[2]));else seen.set(k,n);
  }
  assert.ok(worst<1e-6,'un mismo vértice lleva la misma normal en todos sus triángulos (sin facetas)');
});

// ══ Motor Hunyuan3D: objeto 3D, base y relieve desde la malla ═══════════════
const clean=m=>GLBM.cleanGLB(makeGLB(m.positions,m.indices));
const dims=b=>[0,1,2].map(k=>b.max[k]-b.min[k]);

test('el motor es Hunyuan3D: sin IA de profundidad local, sin CDN de terceros y con aviso de privacidad',()=>{
  assert.doesNotMatch(SRC,/transformers|jsdelivr|Depth Anything|estimateDepth|onnx/i,'no queda rastro del motor local');
  assert.ok(!fs.existsSync(path.join(ROOT,'js','foto3d-worker.js')),'el worker de Depth Anything se eliminó');
  assert.match(SRC,/foto3d-hy3d\.js/,'el worker de Hunyuan3D');
  assert.match(INDEX,/Hunyuan3D/);
  assert.match(INDEX,/la foto se envía|La foto sale de tu equipo/i,'avisa que la foto sale del equipo');
  assert.match(INDEX,/huggingface\.co\/spaces\/tencent\/Hunyuan3D-2\/blob\/main\/LICENSE/,'enlaza la licencia');
  assert.match(INDEX,/UE, Reino Unido ni Corea del Sur/,'avisa el límite territorial de la licencia');
  assert.match(SRC,/confirm\(/,'pide confirmación la primera vez que se envía una foto');
});

test('cada elemento que usa la interfaz existe en index.html',()=>{
  const ids=new Set([...SRC.matchAll(/\$\('(f3d\w+)'\)/g)].map(m=>m[1]));
  for(const m of SRC.matchAll(/\[('f3d\w+'(?:,'f3d\w+')*)\]/g))for(const id of m[1].split(','))ids.add(id.replace(/'/g,''));
  assert.ok(ids.size>20,'se detectaron los ids');
  const html=INDEX.slice(INDEX.indexOf('id="maquinaEscultorView"'),INDEX.indexOf('id="maquinaCalView"'));
  for(const id of ids)if(!['f3dC_'].some(p=>id.startsWith(p)))assert.ok(html.includes('id="'+id+'"'),'falta #'+id+' en index.html');
  // cada acción del HTML existe en la API pública
  const api=SRC.slice(SRC.indexOf('root.Foto3D={'));
  for(const m of html.matchAll(/Foto3D\.(\w+)\(/g))assert.match(api,new RegExp('\\b'+m[1]+'\\b'),'Foto3D.'+m[1]+' no existe en la API pública');
});

test('objeto 3D: del tamaño pedido, apoyado en la cama y con la malla de Hunyuan3D intacta',()=>{
  const c=clean(sphere(48,32,10,12,9)),r=CORE.buildSolido3D(c,{size:90});
  assert.ok(!r.error);assertWatertight(r.mesh,'objeto 3D');
  const d=dims(r.bounds);
  assert.ok(Math.abs(Math.max(...d)-90)<1e-3,`lado mayor ${d}`);
  assert.ok(Math.abs(r.bounds.min[2])<1e-6,'apoyado en z = 0');
  assert.ok(r.volume>0&&r.mesh.normals.length===r.mesh.count*9,'volumen positivo y normales para el visor');
  assert.equal(r.warning,'','una esfera cerrada no avisa nada');
  // el STL es el de la malla: cada triángulo exacto
  const buf=CORE.writeSTL(r.mesh,'x'),dv=new DataView(buf);
  assert.equal(dv.getUint32(80,true),r.mesh.count);
});

test('objeto 3D con base: la base se une al cuerpo y todo apoya en z = 0',()=>{
  const c=clean(sphere(48,32,10,12,9));
  for(const shape of['oval','rect']){
    const r=CORE.buildSolido3D(c,{size:80,baseShape:shape,baseH:6,baseMargin:5}),sin=CORE.buildSolido3D(c,{size:80});
    assertWatertight(r.mesh,'con base '+shape);
    assert.equal(r.shells,2);assert.ok(r.mesh.count>sin.mesh.count,'suma los triángulos de la base');
    assert.ok(Math.abs(r.bounds.min[2])<1e-6);
    const dz=r.bounds.max[2]-sin.bounds.max[2];
    assert.ok(dz>3.5&&dz<6.5,`el cuerpo sube por el alto de la base menos lo que se hunde (${dz.toFixed(2)})`);
    assert.ok((r.bounds.max[0]-r.bounds.min[0])>(sin.bounds.max[0]-sin.bounds.min[0])+8,'la base sobresale con su margen');
  }
});

test('objeto 3D: avisa si sin base se vuelca y si la malla trae aristas abiertas',()=>{
  // esfera grande de un lado y una chica que baja más: el apoyo queda lejos del centro de masa
  const tip=join(sphere(32,20,20,20,20,[-30,20,0]),sphere(32,20,5,5,5,[40,-5,0]));
  const r=CORE.buildSolido3D(clean(tip),{size:90});
  assert.match(r.warning,/volcarse/);
  assert.equal(CORE.buildSolido3D(clean(tip),{size:90,baseShape:'oval'}).warning,'','con base ya no avisa');
  const c=clean(sphere(24,16));c.stats=Object.assign({},c.stats,{openAfter:7});
  assert.match(CORE.buildSolido3D(c,{size:50}).warning,/7 aristas abiertas/);
});

test('girar la pieza lleva el frente al otro lado',()=>{
  const e=join(sphere(24,16,8,8,8,[10,0,0]),sphere(24,16,3,3,3,[10,0,14])); // bulto en el frente (+Z de GLB)
  const c=clean(e);
  const centro=rot=>{const r=CORE.buildSolido3D(c,{size:60,rot}),t=r.mesh.tris;let ymin=Infinity,xs=0,n=0;
    for(let i=1;i<t.length;i+=3)if(t[i]<ymin)ymin=t[i];
    return ymin;};
  const f=centro(0),b=centro(180);
  // al girar 180° el bulto pasa de −Y a +Y: la caja deja de estar simétrica respecto de su centro
  const bx=r=>{const m=CORE.buildSolido3D(c,{size:60,rot:r}),t=m.mesh.tris;let lo=Infinity,hi=-Infinity;for(let i=1;i<t.length;i+=3){lo=Math.min(lo,t[i]);hi=Math.max(hi,t[i]);}return[lo,hi];};
  const [lo0,hi0]=bx(0),[lo1,hi1]=bx(180);
  assert.ok(Math.abs((lo0+hi0)-(-(lo1+hi1)))<1e-3,'las cajas son espejo una de la otra');
  assert.ok(Math.abs(f)+Math.abs(b)>0);
});

test('relieve desde la malla: la silueta del modelo es el recorte y el agujero del anillo se conserva',()=>{
  const ring=clean(torus(64,32,14,5)); // visto de frente: anillo con agujero
  for(const shape of['medallon','llavero']){
    const F=CORE.reliefFields(ring,shape,{});
    assert.ok(F.hasAlpha&&CORE.maskSource(F,{}).mode==='alpha',shape+': el recorte sale de la silueta');
    const r=CORE.buildModel(F,shape,shape==='medallon'?{plate:'redondeado',hang:false}:{});
    assert.ok(!r.error,r.error);assertWatertight(r.mesh,shape+' desde malla');
    assert.ok(r.volume>0);
    if(shape==='llavero')assert.ok(eulerCharacteristic(r.mesh)<=-2,'el llavero conserva el agujero del anillo y suma el de la argolla ('+eulerCharacteristic(r.mesh)+')');
  }
});

test('relieve desde la malla: lo más cercano al frente queda más alto',()=>{
  // dos esferas solapadas en la vista frontal (así forman una sola silueta, como exige el llavero):
  // la de la izquierda está adelante (+Z de GLB = frente) y la de la derecha atrás
  const m=clean(join(sphere(32,20,8,8,8,[-5,0,10]),sphere(32,20,8,8,8,[5,0,-10])));
  const F=CORE.reliefFields(m,'llavero',{}),r=CORE.buildModel(F,'llavero',{edge:0,relief:10,smooth:0});
  const G=r.grid,left=[],right=[];
  for(let j=0;j<G.h;j++)for(let i=0;i<G.w;i++){const c=j*G.w+i;if(!G.mask[c])continue;(i<G.w/2?left:right).push(G.d[c]);}
  const avg=a=>a.reduce((s,v)=>s+v,0)/a.length;
  assert.ok(avg(left)>avg(right)+.15,`izquierda (adelante) ${avg(left).toFixed(2)} vs derecha (atrás) ${avg(right).toFixed(2)}`);
});

test('relieve desde la malla: el medallón circular deja margen para que el objeto quepa en la placa',()=>{
  const wide=clean(sphere(32,20,20,5,5)); // alargado: la placa circular no debe recortarlo
  const F=CORE.reliefFields(wide,'medallon',{plate:'circular'});
  assert.equal(F.w,F.h,'lienzo cuadrado');
  const r=CORE.buildModel(F,'medallon',{plate:'circular',hang:false,frame:0});
  assert.ok(!r.error);
  // toda la silueta cae dentro del círculo: no hay celdas de objeto fuera de la placa
  let lost=0,total=0;const G=r.grid;
  for(let j=0;j<G.h;j++)for(let i=0;i<G.w;i++){const c=j*G.w+i;if(G.subject[c]){total++;if(!G.mask[c])lost++;}}
  assert.ok(total>0&&lost===0,`${lost} celdas del objeto quedan fuera de la placa`);
});
