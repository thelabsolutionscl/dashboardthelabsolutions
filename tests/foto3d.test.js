// Escultor de fotos (js/foto3d.js): el núcleo geométrico debe producir mallas
// cerradas, bien orientadas y del tamaño pedido para cada forma de pieza. Un STL
// con agujeros o normales invertidas se lamina mal o no se lamina.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const CORE=require('../js/foto3d.js');

const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const OPS=fs.readFileSync(path.join(ROOT,'js','maquinas-operaciones.js'),'utf8');
const SRC=fs.readFileSync(path.join(ROOT,'js','foto3d.js'),'utf8');

// Foto sintética: fondo blanco parejo y un sujeto oscuro elíptico; la
// "profundidad" es una semiesfera (más cerca en el centro), como la entregaría la IA.
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
  assert.match(INDEX,/<script src="js\/foto3d\.js\?v=%%BUILD%%"><\/script>/,'falta cargar js/foto3d.js');
  const groups=OPS.slice(OPS.indexOf('const VIEW_GROUPS='),OPS.indexOf('const VIEW_TITLES='));
  assert.match(groups,/taller:\[[^\]]*'escultor'/,'escultor debe pertenecer a la pantalla Taller');
  assert.match(OPS,/workshopNavCard\('escultor'/,'falta la tarjeta de acceso en el Taller');
});

test('la IA corre local: versión fija de transformers.js y modelo Small con licencia comercial',()=>{
  assert.match(SRC,/@huggingface\/transformers@\d+\.\d+\.\d+\//,'la librería debe ir con versión exacta');
  assert.match(SRC,/depth-anything-v2-small/);
  assert.doesNotMatch(SRC,/depth-anything-v2-(base|large)/i,'Base/Large son no comerciales');
  assert.doesNotMatch(SRC,/fetch\([^)]*(api|upload)/i,'la foto no se envía a ningún servidor');
});
