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
function patchyTransformers(amp=.04){
  const calls=[];
  const ip={size:{width:518,height:518}};
  return{calls,ip,module:{env:{},RawImage:class{constructor(d,w,h){this.data=d;this.width=w;this.height=h;}},
    pipeline:async(task,model,o)=>{
      const f=async img=>{
        const L=ip.size.width,W=img.width,H=img.height,d=new Float32Array(W*H);
        let sw=L/W,sh=L/H;if(Math.abs(1-sw)<Math.abs(1-sh))sh=sw;else sw=sh;
        const mw=Math.round(sw*W/14)*14,mh=Math.round(sh*H/14)*14,Px=14*W/mw,Py=14*H/mh;
        calls.push({device:o.device,L,W,H});
        for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;d[i]=img.data[i*4]/255+amp*(Math.cos(2*Math.PI*x/Px)+Math.cos(2*Math.PI*y/Py));}
        return{predicted_depth:{dims:[H,W],data:d}};
      };
      f.processor={image_processor:ip};
      return f;
    }}};
}
function truthImage(w,h){
  const rgba=new Uint8ClampedArray(w*h*4),t=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,v=.3+.4*Math.exp(-((x-w*.45)**2+(y-h*.5)**2)/(2*(w*.25)**2))+.2*x/w;t[i]=Math.round(v*255)/255;rgba[i*4]=Math.round(v*255);rgba[i*4+3]=255;}
  return{rgba,t};
}
async function runWorker(T,gpu,w,h,rgba,quality){
  const W=loadWorker({...T,gpu});
  W.send({type:'depth',id:1,rgba:rgba.buffer.slice(0),w,h,quality});
  for(let i=0;i<40;i++)await W.settle();
  return W.posted.find(m=>m.type==='depth');
}
function rmsVsTruth(d,t,w,h){
  // compara tras alinear escala y desfase (la profundidad es relativa)
  const n=w*h;let md=0,mt=0;for(let i=0;i<n;i++){md+=d[i];mt+=t[i];}md/=n;mt/=n;
  let cv=0,vd=0;for(let i=0;i<n;i++){cv+=(d[i]-md)*(t[i]-mt);vd+=(d[i]-md)**2;}
  const a=cv/vd,b=mt-a*md;let e=0,c=0;
  for(let y=20;y<h-20;y++)for(let x=20;x<w-20;x++){const i=y*w+x;e+=(a*d[i]+b-t[i])**2;c++;}
  return Math.sqrt(e/c);
}

test('worker: las pasadas desplazadas cancelan las ondas de los parches del ViT',async()=>{
  const w=400,h=300,{rgba,t}=truthImage(w,h);
  const one=await runWorker(patchyTransformers(),null,w,h,rgba);
  // referencia: una sola pasada, la misma onda
  const T1=patchyTransformers();const f1=await T1.module.pipeline('d','m',{});T1.ip.size={width:518,height:518};
  const raw=(await f1(new T1.module.RawImage(new Uint8ClampedArray(rgba),w,h))).predicted_depth.data;
  const eSingle=rmsVsTruth(raw,t,w,h),eTTA=rmsVsTruth(one.data,t,w,h);
  assert.equal(one.passes,2,'en CPU se hacen 2 pasadas');
  assert.ok(eTTA<eSingle*.3,`las ondas deben bajar ≥ 70 % (una pasada ${eSingle.toFixed(4)}, promediadas ${eTTA.toFixed(4)})`);
});

const GPU={requestAdapter:async()=>({features:new Set(['shader-f16'])})};
test('worker: con GPU usa por defecto 518 px (resolución de entrenamiento) y 4 pasadas',async()=>{
  const w=300,h=200,{rgba}=truthImage(w,h),T=patchyTransformers();
  const r=await runWorker(T,GPU,w,h,rgba);
  assert.equal(r.res,518);assert.equal(r.passes,4);assert.match(r.label,/GPU/);
  assert.equal(r.data.length,w*h,'la profundidad vuelve al tamaño de la foto');
});
test('worker: "Máximo" pide 1022 px al procesador del modelo',async()=>{
  const w=300,h=200,{rgba}=truthImage(w,h),T=patchyTransformers();
  const r=await runWorker(T,GPU,w,h,rgba,'maximo');
  assert.equal(r.res,1022);
  assert.ok(T.calls.every(c=>c.L===1022),'el procesador recibe la resolución alta');
});

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

test('worker: si la GPU no da abasto a 1022 px, baja a 770 px antes de pasar a CPU',async()=>{
  const quality='maximo';
  const w=200,h=150,{rgba}=truthImage(w,h),T=patchyTransformers();
  const orig=T.module.pipeline;
  T.module.pipeline=async(...a)=>{const f=await orig(...a);const g=async img=>{if(T.ip.size.width===1022)throw new Error('sin memoria de GPU');return f(img);};g.processor=f.processor;return g;};
  const r=await runWorker(T,GPU,w,h,rgba,quality);
  assert.equal(r.res,770);assert.match(r.label,/GPU/);assert.equal(r.passes,4);
  assert.equal(r.asked,1022,'informa que bajó de la resolución pedida');
});

// ── Picos (tercera prueba real: picos agudos en toda la pieza) ────────────
test('worker: una pasada con desborde fp16 (NaN/infinito) baja de resolución sola',async()=>{
  const w=200,h=150,{rgba}=truthImage(w,h),T=patchyTransformers(0);
  const orig=T.module.pipeline;
  T.module.pipeline=async(...a)=>{const f=await orig(...a);
    const g=async img=>{const o=await f(img);if(T.ip.size.width>518){const d=o.predicted_depth.data;for(let i=0;i<d.length;i+=40)d[i]=i%80?NaN:Infinity;}return o;};
    g.processor=f.processor;return g;};
  const r=await runWorker(T,GPU,w,h,rgba,'maximo');
  assert.equal(r.res,518,'1022 y 770 salen sucias: se queda en 518');
  assert.ok(r.data.every(Number.isFinite),'sin NaN ni infinitos');
});

test('worker: una mancha basura en una sola pasada no llega al resultado (mediana)',async()=>{
  const w=200,h=150,{rgba,t}=truthImage(w,h),T=patchyTransformers(0);
  const orig=T.module.pipeline;let call=0;
  T.module.pipeline=async(...a)=>{const f=await orig(...a);
    const g=async img=>{const o=await f(img);if(call++===2){const d=o.predicted_depth.data;for(let y=60;y<70;y++)for(let x=90;x<100;x++)d[y*w+x]=5;}return o;};
    g.processor=f.processor;return g;};
  const r=await runWorker(T,GPU,w,h,rgba);
  let maxErr=0;for(let y=58;y<72;y++)for(let x=88;x<102;x++)maxErr=Math.max(maxErr,Math.abs(r.data[y*w+x]-t[y*w+x]));
  assert.ok(maxErr<.05,`la mancha se descarta (error ${maxErr.toFixed(3)})`);
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
