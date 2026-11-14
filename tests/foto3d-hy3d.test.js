// Escultor de fotos — cliente de Hunyuan3D (js/foto3d-hy3d.js).
//
// Se prueba contra un servidor HTTP local que imita la API de Gradio 4.44 tal
// como la define el código público de los Spaces de Tencent (nombre de la función
// y orden de sus 13 entradas). Eso verifica el cliente contra el contrato leído,
// NO contra el servicio en vivo: para eso está scripts/hy3d-smoke.js.
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const{execFile}=require('node:child_process');
const path=require('node:path');
const HY=require('../js/foto3d-hy3d.js');
const G=require('../js/foto3d-glb.js');
const{sphere,makeGLB}=require('./foto3d-mesh-helpers.js');

const ROOT=path.join(__dirname,'..');
const SRC=fs.readFileSync(path.join(ROOT,'js','foto3d-hy3d.js'),'utf8');
const PNG=Uint8Array.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,1,2,3,4,5,6,7,8]);
const SPHERE=sphere(24,16,10,12,9);
const GLB=Buffer.from(makeGLB(SPHERE.positions,SPHERE.indices));

function readBody(req){return new Promise(r=>{const c=[];req.on('data',d=>c.push(d));req.on('end',()=>r(Buffer.concat(c)));});}
// o: version, apiPrefix, noApi, configStatus, callStatus, error, idle, slow, badGlb, evilUrl, steps
async function fake(o={}){
  const st={calls:[],body:null,upload:null,ev:'ev-7'};
  const pre=o.apiPrefix||'';
  const srv=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://x'),body=await readBody(req);
    st.calls.push({method:req.method,path:url.pathname,auth:req.headers.authorization||null});
    res.setHeader('Access-Control-Allow-Origin','*');
    const origin='http://127.0.0.1:'+srv.address().port;
    if(req.method==='GET'&&url.pathname==='/config'){
      if(o.configStatus){res.statusCode=o.configStatus;return res.end('no');}
      res.setHeader('content-type','application/json');
      const cfg={version:o.version||'4.44.0',dependencies:o.noApi?[{api_name:'otra'}]:[{api_name:'shape_generation'}]};
      if(o.apiPrefix)cfg.api_prefix=o.apiPrefix;
      return res.end(JSON.stringify(cfg));
    }
    if(req.method==='POST'&&url.pathname===pre+'/upload'){
      st.upload={ct:req.headers['content-type'],hasField:body.includes('name="files"'),hasPng:body.includes(Buffer.from([0x89,0x50,0x4E,0x47]))};
      res.setHeader('content-type','application/json');return res.end(JSON.stringify(['/tmp/gradio/abc/foto.png']));
    }
    if(req.method==='POST'&&url.pathname===pre+'/call/shape_generation'){
      if(o.callStatus){res.statusCode=o.callStatus;return res.end('Too Many Requests');}
      st.body=JSON.parse(body.toString());
      res.setHeader('content-type','application/json');return res.end(JSON.stringify({event_id:st.ev}));
    }
    if(req.method==='GET'&&url.pathname===pre+'/call/shape_generation/'+st.ev){
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
      res.write('event: heartbeat\r\ndata: null\r\n\r\n');
      if(o.idle)return; // nunca contesta más
      if(o.slow){return;}
      setTimeout(()=>{
        if(o.nullError){res.write('event: error\ndata: null\n\n');return res.end();} // fallo interno del Space: sin mensaje
        if(o.error!=null){res.write('event: error\ndata: '+JSON.stringify(o.error)+'\n\n');return res.end();}
        const fd={path:'/tmp/gradio/x/white_mesh.glb',url:(o.evilUrl?'http://evil.invalid':origin)+pre+'/file=/tmp/gradio/x/white_mesh.glb',orig_name:'white_mesh.glb'};
        res.write('event: complete\ndata: '+JSON.stringify([fd,'<iframe></iframe>',{number_of_faces:SPHERE.indices.length/3,time:{total:3.2}},4321])+'\n\n');
        res.end();
      },15);
      return;
    }
    if(req.method==='GET'&&url.pathname===pre+'/file=/tmp/gradio/x/white_mesh.glb'){
      res.setHeader('content-type','model/gltf-binary');return res.end(o.badGlb?Buffer.from('<html>no soy un glb</html>'):GLB);
    }
    res.statusCode=404;res.end('nf');
  });
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+srv.address().port;
  return{st,origin,env:{hosts:{rapido:origin,estandar:origin},idleMs:o.idleMs},close:()=>{srv.closeAllConnections&&srv.closeAllConnections();return new Promise(r=>srv.close(r));}};
}
const base=(f,extra)=>Object.assign({png:PNG,quality:'rapido',seed:99,octree:196,rembg:true,env:f.env},extra);
async function expectCode(p,code){
  try{await p;}catch(e){assert.equal(e.code,code,`${e.code}: ${e.message}`);return e;}
  assert.fail('debía fallar con '+code);
}

test('flujo completo: config → subida → llamada → eventos → malla, con el contrato del Space',async()=>{
  const f=await fake();
  try{
    const phases=[];
    const r=await HY.generate(base(f,{onStatus:p=>phases.push(p)}));
    assert.deepEqual(f.st.calls.map(c=>c.method+' '+c.path),['GET /config','POST /upload','POST /call/shape_generation','GET /call/shape_generation/ev-7','GET /file=/tmp/gradio/x/white_mesh.glb']);
    assert.ok(f.st.upload.ct.startsWith('multipart/form-data')&&f.st.upload.hasField&&f.st.upload.hasPng,'sube la foto como campo "files"');
    const d=f.st.body.data;
    assert.equal(d.length,13,'shape_generation tiene 13 entradas');
    assert.equal(d[0],null);
    assert.equal(d[1].path,'/tmp/gradio/abc/foto.png');assert.equal(d[1].meta._type,'gradio.FileData');
    assert.deepEqual(d.slice(2,6),[null,null,null,null],'sin vistas múltiples');
    assert.equal(d[6],5,'pasos del mini-Turbo');assert.equal(d[7],5,'guidance');
    assert.equal(d[8],99,'semilla');assert.equal(d[9],196,'octree');
    assert.equal(d[10],true,'quita el fondo');assert.equal(d[11],8000,'num_chunks');assert.equal(d[12],false,'sin semilla aleatoria');
    assert.deepEqual(phases.slice(0,2),['check','upload']);assert.ok(phases.includes('generating')&&phases.at(-1)==='download');
    assert.equal(r.seed,4321);assert.equal(r.space,'Hunyuan3D-2 mini Turbo');assert.ok(r.stats.number_of_faces>0);
    const m=G.parseGLB(r.glb);assert.equal(m.indices.length,SPHERE.indices.length);
  }finally{await f.close();}
});

test('el modo Estándar usa 30 pasos',async()=>{
  const f=await fake();
  try{await HY.generate(base(f,{quality:'estandar'}));assert.equal(f.st.body.data[6],30);}finally{await f.close();}
});

test('con Gradio 5 usa el prefijo /gradio_api que informa /config',async()=>{
  const f=await fake({version:'5.9.1',apiPrefix:'/gradio_api'});
  try{const r=await HY.generate(base(f));assert.ok(r.glb.byteLength>100);
    assert.ok(f.st.calls.some(c=>c.path==='/gradio_api/upload'));}finally{await f.close();}
});

test('el token de Hugging Face (opcional) viaja en todas las peticiones',async()=>{
  const f=await fake();
  try{await HY.generate(base(f,{token:'hf_prueba'}));
    assert.ok(f.st.calls.length===5&&f.st.calls.every(c=>c.auth==='Bearer hf_prueba'));}finally{await f.close();}
  const g=await fake();
  try{await HY.generate(base(g));assert.ok(g.st.calls.every(c=>c.auth===null),'sin token no se manda nada');}finally{await g.close();}
});

test('cuota de GPU agotada: código "quota" con el tiempo de espera',async()=>{
  const f=await fake({error:'You have exceeded your free GPU quota (60s requested vs. 20s left). Try again in 0:03:41'});
  try{const e=await expectCode(HY.generate(base(f)),'quota');
    assert.equal(e.retrySeconds,221);assert.match(e.message,/cuota gratis/);assert.match(e.message,/4 min/);}finally{await f.close();}
});

test('servicio saturado (429) y servicio caído (503)',async()=>{
  const a=await fake({callStatus:429});
  try{await expectCode(HY.generate(base(a)),'busy');}finally{await a.close();}
  const b=await fake({configStatus:503});
  try{await expectCode(HY.generate(base(b)),'busy');}finally{await b.close();}
});

test('si el Space ya no tiene shape_generation avisa que la API cambió',async()=>{
  const f=await fake({noApi:true});
  try{const e=await expectCode(HY.generate(base(f)),'api');assert.match(e.message,/shape_generation/);
    assert.equal(f.st.calls.length,1,'no sube la foto a un servicio que no sirve');}finally{await f.close();}
});

test('sin conexión: código "network"',async()=>{
  const f=await fake();await f.close(); // puerto cerrado
  await expectCode(HY.generate(base(f)),'network');
});

test('un servicio que deja de responder se corta por inactividad',async()=>{
  const f=await fake({idle:true,idleMs:150});
  try{const t0=Date.now();await expectCode(HY.generate(base(f)),'timeout');assert.ok(Date.now()-t0<3000);}finally{await f.close();}
});

test('cancelar a mitad de la espera corta la petición',async()=>{
  const f=await fake({slow:true});
  try{
    const ctl=new AbortController();
    const p=HY.generate(base(f,{signal:ctl.signal,onStatus:ph=>{if(ph==='generating')setTimeout(()=>ctl.abort(),30);}}));
    await expectCode(p,'cancelled');
  }finally{await f.close();}
});

test('si el servicio no devuelve un GLB, lo dice en vez de fallar más adelante',async()=>{
  const f=await fake({badGlb:true});
  try{await expectCode(HY.generate(base(f)),'api');}finally{await f.close();}
});

test('una URL de descarga de otro dominio se ignora: se descarga siempre desde el Space',async()=>{
  const f=await fake({evilUrl:true});
  try{const r=await HY.generate(base(f));assert.ok(r.glb.byteLength>100);
    assert.ok(f.st.calls.some(c=>c.path==='/file=/tmp/gradio/x/white_mesh.glb'));}finally{await f.close();}
});

test('handleMessage: estados en orden, malla transferible y errores con código',async()=>{
  const f=await fake(),out=[];
  try{
    await HY.handleMessage({type:'gen',id:1,png:PNG.buffer.slice(0),quality:'rapido',seed:5,octree:256,rembg:true},(m,t)=>out.push([m,t]),f.env);
    const kinds=out.map(([m])=>m.type+(m.phase?':'+m.phase:''));
    assert.deepEqual(kinds.filter((k,i)=>k!==kinds[i-1]),['status:check','status:upload','status:generating','status:download','done']);
    const done=out.at(-1);assert.ok(done[0].glb instanceof ArrayBuffer&&done[1][0]===done[0].glb,'la malla se transfiere sin copiarla');
    // error → mensaje con código
    const g=await fake({error:'quota exceeded'}),o2=[];
    try{await HY.handleMessage({type:'gen',id:2,png:PNG.buffer.slice(0),quality:'rapido'},m=>o2.push(m),g.env);}finally{await g.close();}
    assert.equal(o2.at(-1).type,'error');assert.equal(o2.at(-1).code,'quota');
    // foto inválida
    const o3=[];await HY.handleMessage({type:'gen',id:3,png:'no'},m=>o3.push(m),f.env);
    assert.equal(o3[0].type,'error');
    // comprobación de conexión
    const o4=[];await HY.handleMessage({type:'check',id:4,quality:'rapido'},m=>o4.push(m),f.env);
    assert.equal(o4[0].type,'checked');assert.equal(o4[0].version,'4.44.0');
    // mensajes ajenos se ignoran
    await HY.handleMessage(null,()=>assert.fail('no debe responder'),f.env);
    await HY.handleMessage({type:'otra'},()=>assert.fail('no debe responder'),f.env);
  }finally{await f.close();}
});

test('handleMessage: cancelar por mensaje aborta el trabajo en curso',async()=>{
  const f=await fake({slow:true}),out=[];
  try{
    const p=HY.handleMessage({type:'gen',id:9,png:PNG.buffer.slice(0),quality:'rapido'},m=>{out.push(m);if(m.phase==='generating')setTimeout(()=>HY.handleMessage({type:'cancel',id:9},()=>{},f.env),30);},f.env);
    await p;assert.equal(out.at(-1).type,'error');assert.equal(out.at(-1).code,'cancelled');
  }finally{await f.close();}
});

test('SSE: bloques con CRLF, varias líneas de datos y comentarios',()=>{
  assert.deepEqual(HY.parseBlock('event: complete\ndata: [1,\ndata: 2]'),{event:'complete',data:'[1,\n2]'});
  assert.deepEqual(HY.parseBlock(': keep-alive\nevent: heartbeat\ndata: null'),{event:'heartbeat',data:'null'});
  assert.equal(HY.parseBlock('data: x').event,'message');
});

test('clasificación de errores del servicio',()=>{
  const c=HY.classifyServiceError;
  assert.equal(c('ZeroGPU quota exceeded',0).code,'quota');
  assert.equal(c('',429).code,'busy');assert.equal(c('The space is sleeping',0).code,'sleeping');
  assert.equal(c('CUDA out of memory',0).code,'failed');
  assert.equal(c('Try again in 1:30:00 quota',0).retrySeconds,5400);
});

test('el cliente sólo habla con los Spaces oficiales de Tencent y no tiene claves',()=>{
  const hosts=[...SRC.matchAll(/https:\/\/[a-z0-9.-]+/g)].map(m=>m[0]);
  for(const h of hosts)assert.match(h,/^https:\/\/tencent-hunyuan3d-[a-z0-9-]*\.hf\.space$/,'host inesperado: '+h);
  assert.deepEqual(Object.keys(HY.SPACES).sort(),['estandar','rapido']);
  assert.doesNotMatch(SRC,/hf_[A-Za-z0-9]{20,}/,'sin tokens en el código');
});

// ── scripts/hy3d-smoke.js (el que corres tú contra el servicio real) ──────
function runSmoke(args,cwd){
  return new Promise(res=>execFile(process.execPath,[path.join(ROOT,'scripts','hy3d-smoke.js'),...args],{cwd,timeout:60000},(err,out,errOut)=>res({code:err?err.code:0,out:String(out)+String(errOut)})));
}
test('hy3d-smoke --check sólo comprueba la conexión, sin subir ninguna foto',async()=>{
  const f=await fake(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'hy3d-'));
  try{
    const r=await runSmoke(['--check','--host',f.origin],dir);
    assert.equal(r.code,0,r.out);assert.match(r.out,/el servicio responde/);assert.match(r.out,/no se subió ninguna foto/);
    assert.deepEqual(f.st.calls.map(c=>c.method+' '+c.path),['GET /config']);
  }finally{await f.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('hy3d-smoke genera, limpia y escribe el STL de punta a punta',async()=>{
  const f=await fake(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'hy3d-'));
  try{
    const r=await runSmoke(['--host',f.origin],dir);
    assert.equal(r.code,0,r.out);
    assert.match(r.out,/el servicio entregó la malla/);assert.match(r.out,/0 aristas abiertas · 0 no-manifold/);assert.match(r.out,/STL escrito/);
    const stl=fs.readFileSync(path.join(dir,'hy3d-smoke.stl')),n=stl.readUInt32LE(80);
    assert.equal(stl.length,84+n*50,'STL binario bien formado');assert.ok(n>500);
    assert.equal(fs.readFileSync(path.join(dir,'hy3d-smoke.glb')).readUInt32LE(0),0x46546C67);
    assert.equal(f.st.body.data[10],false,'ender5max.png tiene transparencia: no se pide quitar el fondo');
  }finally{await f.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('hy3d-smoke sale con error y un mensaje claro si el servicio falla',async()=>{
  const f=await fake({error:'You have exceeded your free GPU quota. Try again in 0:10:00'}),dir=fs.mkdtempSync(path.join(os.tmpdir(),'hy3d-'));
  try{
    const r=await runSmoke(['--host',f.origin],dir);
    assert.equal(r.code,2);assert.match(r.out,/quota: Se acabó la cuota gratis/);
  }finally{await f.close();fs.rmSync(dir,{recursive:true,force:true});}
});

// ── Fallo del servicio sin mensaje (el caso real de la primera prueba) ────
test('un error del servicio sin mensaje dice cuánto tardó y qué hacer, sin inventar una causa',async()=>{
  const f=await fake({nullError:true});
  try{
    const phases=[];
    const e=await expectCode(HY.generate(base(f,{quality:'estandar',onStatus:p=>phases.push(p)})),'failed');
    assert.match(e.message,/no explicó por qué/);
    assert.match(e.message,/Falló a los \d+ s \(Hunyuan3D-2\)/,'dice cuándo y en qué modelo falló');
    assert.match(e.message,/casi de inmediato/,'falló al instante: puede haber rechazado la foto');
    assert.equal(e.detail.raw,'null');assert.equal(e.detail.phase,'generating');assert.equal(e.detail.quality,'estandar');
    assert.ok(typeof e.detail.seconds==='number'&&e.detail.seconds<8);
    assert.ok(phases.includes('generating'),'el fallo vino después de encolar el trabajo');
  }finally{await f.close();}
});

test('las sugerencias dependen de cuánto tardó en fallar y del modo',()=>{
  const mk=()=>{const e=HY.classifyServiceError('null',0);e.raw='null';e.fromStream=true;return e;};
  const quick=HY.describeFailure(mk(),{elapsed:2,quality:'rapido',space:'X',phase:'generating'});
  assert.match(quick.message,/casi de inmediato.*otra \(más chica o en PNG\)/);
  const std=HY.describeFailure(mk(),{elapsed:41,quality:'estandar',space:'X',phase:'generating'});
  assert.match(std.message,/Falló a los 41 s/);assert.match(std.message,/modo Estándar es el más exigente: prueba el modo Rápido/);
  const fast=HY.describeFailure(mk(),{elapsed:41,quality:'rapido',space:'X',phase:'generating'});
  assert.match(fast.message,/malla Liviana u otra foto/);assert.doesNotMatch(fast.message,/modo Estándar/);
  // si el servicio sí dio un mensaje, se muestra tal cual y no se agregan sugerencias inventadas
  const e=HY.classifyServiceError('CUDA out of memory',0);e.fromStream=true;
  const said=HY.describeFailure(e,{elapsed:30,quality:'estandar',space:'X',phase:'generating'});
  assert.match(said.message,/: CUDA out of memory\. Falló a los 30 s/);assert.doesNotMatch(said.message,/Prueba|prueba/);
});

test('handleMessage entrega el detalle técnico del fallo a la página',async()=>{
  const f=await fake({nullError:true}),out=[];
  try{
    await HY.handleMessage({type:'gen',id:5,png:PNG.buffer.slice(0),quality:'rapido'},m=>out.push(m),f.env);
    const e=out.at(-1);assert.equal(e.type,'error');assert.equal(e.code,'failed');
    assert.equal(e.detail.raw,'null');assert.equal(e.detail.space,'Hunyuan3D-2 mini Turbo');
  }finally{await f.close();}
});

test('la página deja el modo en Rápido tras un fallo del Estándar y muestra el detalle',()=>{
  const ui=fs.readFileSync(path.join(ROOT,'js','foto3d.js'),'utf8');
  assert.match(ui,/e\.code==='failed'&&m\.quality==='estandar'[\s\S]{0,160}value='rapido'/,'cambia el selector a Rápido');
  assert.match(ui,/pulsa Generar para reintentar/,'sin reenviar la foto hasta que el usuario pulse Generar');
  assert.match(ui,/err\.detail=m\.detail/,'el detalle del worker llega a la página');
});

test('hy3d-smoke --debug muestra cada petición y cada evento; un fallo imprime el detalle técnico',async()=>{
  const f=await fake(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'hy3d-'));
  try{
    const r=await runSmoke(['--debug','--host',f.origin],dir);
    assert.equal(r.code,0,r.out);
    assert.match(r.out,/\[debug\] GET http:\/\/127\.0\.0\.1:\d+\/config/);
    assert.match(r.out,/\[debug\]   → 200 \(\d+ ms\)/);
    assert.match(r.out,/\[debug\]   evento complete:/);
  }finally{await f.close();}
  const g=await fake({nullError:true});
  try{
    const r=await runSmoke(['estandar','--host',g.origin],dir);
    assert.equal(r.code,2);
    assert.match(r.out,/no explicó por qué/);
    assert.match(r.out,/detalle técnico: \{"code":"failed","seconds":[\d.]+,"quality":"estandar".*"raw":"null"\}/);
  }finally{await g.close();fs.rmSync(dir,{recursive:true,force:true});}
});
