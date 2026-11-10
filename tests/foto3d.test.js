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
const WORKER=fs.readFileSync(path.join(ROOT,'js','foto3d-worker.js'),'utf8');
const vm=require('vm');

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

test('la IA corre local en un worker: versión fija y modelo Small con licencia comercial',()=>{
  assert.match(WORKER,/@huggingface\/transformers@\d+\.\d+\.\d+\//,'la librería debe ir con versión exacta');
  assert.match(WORKER,/depth-anything-v2-small/);
  for(const src of[SRC,WORKER]){
    assert.doesNotMatch(src,/depth-anything-v2-(base|large)/i,'Base/Large son no comerciales');
    assert.doesNotMatch(src,/fetch\([^)]*(api|upload)/i,'la foto no se envía a ningún servidor');
  }
  // El código del CDN no se ejecuta en la página (donde viven las claves de localStorage).
  assert.doesNotMatch(SRC,/cdn\.jsdelivr\.net|await import\(/,'foto3d.js no debe importar código de terceros');
  assert.match(SRC,/new Worker\(/);
});

// ── Regresiones de bugs encontrados en revisión ──────────────────────────
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
function loadWorker(fake){
  const posted=[];
  const code=WORKER.replace('await import(TJS_URL)','await __import(TJS_URL)');
  const self={navigator:fake.gpu?{gpu:fake.gpu}:{},postMessage:m=>posted.push(m)};
  const ctx=vm.createContext({self,console:{warn(){},log(){}},__import:async()=>fake.module,Float32Array,Uint16Array,Uint8ClampedArray,ArrayBuffer,Promise,Math,String,Array,Error});
  vm.runInContext(code,ctx);
  return{send:m=>self.onmessage({data:m}),posted,settle:()=>new Promise(r=>setTimeout(r,20))};
}
function fakeTransformers(opts={}){
  const calls=[];
  return{calls,module:{env:{},RawImage:class{constructor(d,w,h){this.width=w;this.height=h;}},
    pipeline:async(task,model,o)=>{
      calls.push(o.device);
      return async img=>{
        if(opts.failOn===o.device)throw new Error('falla '+o.device);
        return{predicted_depth:{dims:[img.height,img.width],data:new Float32Array(img.width*img.height).fill(.5)}};
      };
    }}};
}
const req=(id)=>({type:'depth',id,rgba:new ArrayBuffer(4*4*4),w:4,h:4});

test('worker: devuelve la profundidad y cancela lo que quedó en cola',async()=>{
  const T=fakeTransformers(),W=loadWorker(T);
  W.send(req(1));W.send(req(2));W.send({type:'cancel',below:3});W.send(req(3));
  for(let i=0;i<10;i++)await W.settle();
  const by=id=>W.posted.filter(m=>m.id===id&&m.type!=='progress').map(m=>m.type);
  assert.deepEqual(by(3),['depth'],'la última foto se procesa');
  assert.ok(by(2).includes('cancelled'),'una foto anterior en cola se descarta');
  const d=W.posted.find(m=>m.id===3&&m.type==='depth');
  assert.equal(d.data.length,16);assert.equal(d.label,'CPU (WASM)');
});

test('worker: si la GPU falla al ejecutar, reintenta en CPU',async()=>{
  const T=fakeTransformers({failOn:'webgpu'});
  const gpu={requestAdapter:async()=>({features:new Set(['shader-f16'])})};
  const W=loadWorker({...T,gpu});
  W.send(req(1));
  for(let i=0;i<10;i++)await W.settle();
  assert.deepEqual(T.calls,['webgpu','wasm']);
  assert.equal(W.posted.find(m=>m.type==='depth').label,'CPU (WASM)');
});

test('worker: un fallo de carga se informa como error, sin colgarse',async()=>{
  const W=loadWorker({module:{env:{},pipeline:async()=>{throw new Error('sin red');}}});
  W.send(req(7));
  for(let i=0;i<10;i++)await W.settle();
  const e=W.posted.find(m=>m.type==='error');
  assert.ok(e&&e.id===7&&/sin red/.test(e.message));
  W.send({type:'depth',id:8,rgba:'no es un buffer',w:4,h:4});
  await W.settle();
  assert.ok(!W.posted.some(m=>m.id===8),'mensajes mal formados se ignoran');
});

test('figura: avisa si el centro de masa cae fuera de la base',()=>{
  // Sujeto con todo el peso a un costado y patita fina al otro: sin base se vuelca.
  const F=shapeImage(220,200,(x,y)=>((x-160)/45)**2+((y-80)/50)**2<=1||(x>40&&x<60&&y>60&&y<190)||(y>50&&y<70&&x>40&&x<160));
  const sinBase=CORE.buildModel(F,'figura',{res:120,baseShape:'ninguna'});
  assert.match(sinBase.warning,/volcarse/);
  const{img,depth}=syntheticImage();
  const ok=CORE.buildModel(CORE.prepareFields(img,depth),'figura',{res:100});
  assert.ok(!/volcarse/.test(ok.warning),'una figura centrada sobre su base no avisa');
});
