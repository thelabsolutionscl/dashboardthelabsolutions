'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const center=require('../js/operativo-conexiones.js');
const source=fs.readFileSync('js/operativo-conexiones.js','utf8');
const visual=fs.readFileSync('js/operativo-visual.js','utf8');
const css=fs.readFileSync('js/operativo-conexiones.css','utf8');

test('catálogo tiene 15 servicios independientes, sin estados verdes ficticios',()=>{
  assert.equal(center.catalog.length,15);
  assert.equal(new Set(center.catalog.map(x=>x.id)).size,15);
  for(const id of ['proxy','airtable','calendar','drive','imap','resend','printer','sii','leads','github','anthropic','openai','make','ads','meta']){
    assert.ok(center.catalog.some(x=>x.id===id),id);
  }
  const c=center.counts(center.catalog);
  assert.equal(c.green,0);assert.equal(c.red,0);assert.equal(c.gray,15);
  assert.match(source,/status:'gray',message:'Todavía no se ha ejecutado una prueba'/);
});

test('las URLs de diagnóstico rechazan secretos y hosts inseguros',()=>{
  assert.equal(center.configuredUrl('https://proxy.thelab.solutions/v0?api_key=123'),'');
  assert.equal(center.configuredUrl('https://admin:pass@proxy.thelab.solutions'),'');
  assert.equal(center.configuredUrl('http://proxy.thelab.solutions'),'');
  assert.equal(center.configuredUrl('%%PROXY_URL%%'),'');
  assert.equal(center.configuredUrl('https://proxy.thelab.solutions/path'),'https://proxy.thelab.solutions');
  assert.equal(center.configuredUrl('http://localhost:8080/health'),'http://localhost:8080');
});

test('el semáforo no conserva verde tras vencer la validez de la prueba',()=>{
  center.result('proxy','green','Prueba', 'manual');
  assert.equal(center.displayStatus('proxy').status,'green');
  const now=Date.now,at=now();
  try{
    Date.now=()=>at+16*60000;
    assert.equal(center.displayStatus('proxy').status,'yellow');
    assert.match(center.displayStatus('proxy').message,/desactualizada/);
    assert.equal(center.counts(center.catalog).green,0,'el resumen no debe dejar verde un diagnóstico vencido');
  }finally{Date.now=now;}
});

test('health GET es una lectura sin credenciales, cuerpos ni cambios remotos',async()=>{
  const orig=global.fetch;let called;
  try{
    global.fetch=async(url,options)=>{
      called={url,options};return {ok:true,status:200,json:async()=>({ok:true,airtable:true})};
    };
    const r=await center.getJson('https://proxy.thelab.solutions/health');
    assert.equal(r.status,'green');assert.equal(r.data.airtable,true);
    assert.equal(called.url,'https://proxy.thelab.solutions/health');
    assert.equal(called.options.method,'GET');
    assert.equal(called.options.credentials,'omit');
    assert.equal(called.options.body,undefined);
  }finally{global.fetch=orig;}
});

test('401, 503 y fallo de red se clasifican sin presentar CORS como caída confirmada',async()=>{
  const orig=global.fetch;
  try{
    global.fetch=async()=>({status:401,ok:false});
    assert.equal((await center.getJson('https://ejemplo.cl/health')).status,'yellow');
    global.fetch=async()=>({status:503,ok:false});
    assert.equal((await center.getJson('https://ejemplo.cl/health')).status,'red');
    global.fetch=async()=>{throw new TypeError('Failed to fetch');};
    const net=await center.getJson('https://ejemplo.cl/health');
    assert.equal(net.status,'yellow');assert.doesNotMatch(net.message,/caído/);
  }finally{global.fetch=orig;}
});

test('Claude/OpenAI verifican credenciales reales sin consumir tokens ni exponer la clave',async()=>{
  const prev={fetch:global.fetch,AUTH:global.AUTH,_DEFAULTS:global._DEFAULTS,
    _proxyCfg:global._proxyCfg,_DEMO_MODE:global._DEMO_MODE};
  const urls=[];
  try{
    global.AUTH={getUser:()=>({username:'admin-test',role:'admin'})};
    global._DEFAULTS={PROXY_URL:'https://proxy.thelab.solutions',PROXY_KEY:'test-only'};
    global._proxyCfg=()=>({url:'https://proxy.thelab.solutions',key:'test-only'});
    global._DEMO_MODE=false;
    global.fetch=async(url,opts)=>{
      urls.push({url,opts});
      if(String(url).endsWith('/health'))
        return {ok:true,status:200,json:async()=>({ok:true,anthropic:true,openai:true})};
      return {ok:true,status:200,json:async()=>String(url).includes('anthropic')?
        {status:'green',verified:true,message:'Autenticación correcta'}:
        {status:'red',verified:false,message:'Clave rechazada'}};
    };
    const claude=await center.probe('anthropic','manual');
    const openai=await center.probe('openai','manual');
    assert.equal(claude.status,'green');assert.equal(claude.verified,true);
    assert.equal(openai.status,'red');
    assert.deepEqual(urls.map(x=>x.url),[
      'https://proxy.thelab.solutions/integrations/check?service=anthropic',
      'https://proxy.thelab.solutions/integrations/check?service=openai'
    ]);
    assert.ok(urls.every(x=>x.opts.method==='GET'&&!x.opts.body));
    assert.ok(urls.every(x=>x.opts.headers['X-App-Key']==='test-only'));
    assert.ok(urls.every(x=>x.opts.credentials==='include'));
  }finally{Object.assign(global,prev);}
});

test('Calendar y Drive no fuerzan ventanas de OAuth durante el monitoreo automático',async()=>{
  const previous={AUTH:global.AUTH,_DEMO_MODE:global._DEMO_MODE,_calClientId:global._calClientId,
    _calTokenVigente:global._calTokenVigente,_driveGetClientId:global._driveGetClientId};
  try{
    global.AUTH={getUser:()=>({username:'user-test',role:'admin'})};global._DEMO_MODE=false;
    global._calClientId=()=>'valid.apps.googleusercontent.com';
    global._calTokenVigente=()=>false;
    global._driveGetClientId=()=>'valid.apps.googleusercontent.com';
    assert.equal((await center.probe('calendar','auto')).status,'gray');
    assert.equal((await center.probe('drive','auto')).status,'gray');
    assert.doesNotMatch(source,/requestAccessToken\(/,'el OAuth debe estar a cargo del flujo oficial existente');
  }finally{Object.assign(global,previous);}
});

test('IMAP verifica carpetas y Resend solo su token sin enviar correos',async()=>{
  const prev={AUTH:global.AUTH,MAIL:global.MAIL,_DEMO_MODE:global._DEMO_MODE};
  const actions=[];
  try{
    global.AUTH={getUser:()=>({username:'mail-test',role:'admin'})};global._DEMO_MODE=false;
    global.MAIL={activeAccount:()=> 'foo@example.com',getMailPass:()=> 'no-persistir',
      post:async(p)=>{actions.push(p.action);return p.action==='folders'?
        {folders:[]}:{ok:true,verified:true,configured:true};}};
    assert.equal((await center.probe('imap','auto')).status,'gray');
    assert.deepEqual(actions,[]);
    assert.equal((await center.probe('imap','manual')).status,'green');
    assert.equal((await center.probe('resend','manual')).status,'green');
    assert.deepEqual(actions,['folders','resend_status']);
    assert.doesNotMatch(source,/MAIL\.post\(\s*\{\s*action:['"]send/);
  }finally{Object.assign(global,prev);}
});

test('los 15 servicios tienen Conectar/configurar y Verificar conexión',()=>{
  assert.match(source,/button\('Verificar conexión','check',s\.id\)/);
  assert.match(source,/button\(connectLabel,'connect',s\.id\)/);
  assert.match(source,/if\(action==='connect'\)connectService\(id\)/);
  assert.match(source,/if\(id==='ads'\)/);
  assert.match(source,/if\(id==='imap'\)/);
  assert.match(source,/https:\/\/console\.anthropic\.com/);
  assert.match(source,/https:\/\/platform\.openai\.com/);
  assert.doesNotMatch(source,/requestAccessToken\(/);
});

test('OVERVIEW integra script y estilos versionados con panel fuera del render comercial',()=>{
  assert.match(visual,/global\.TLSConnections\?\.mount\?\.\(\)/);
  assert.match(visual,/document\.currentScript\?\.src/);
  assert.match(visual,/new URL\('operativo-conexiones\.js',src\)/);
  assert.match(visual,/url\.searchParams\.set\('v',original\.searchParams\.get\('v'\)\)/);
  assert.match(source,/new URL\('operativo-conexiones\.css',script\)/);
  assert.match(source,/target\.closest\('\.card'\)\|\|target/);
  assert.match(css,/\.tls-conn-kpi-green/);assert.match(css,/\.tls-conn-kpi-yellow/);
  assert.match(css,/\.tls-conn-kpi-red/);assert.match(css,/\.tls-conn-kpi-gray/);
});

test('el centro aparece una sola vez en OVERVIEW y carga CSS con el hash del build',()=>{
  const vm=require('node:vm'),ids=new Map(),listeners={},inserted=[],styles=[];
  function element(tag){
    const node={tag,dataset:{},children:[],hidden:false,
      setAttribute(){},classList:{toggle(){}},append(...x){this.children.push(...x);},
      appendChild(x){this.children.push(x);},replaceChildren(...x){this.children=x;},
      insertAdjacentElement(pos,x){inserted.push({pos,x});},closest(){return null;},
      scrollIntoView(){},showModal(){this.open=true;},close(){this.open=false;}};
    Object.defineProperty(node,'id',{get(){return this._id;},set(x){this._id=x;ids.set(x,this);}});
    return node;
  }
  const overview=element('section');overview.id='tab-overview';
  const today=element('div');today.id='opToday';
  const doc={readyState:'loading',hidden:false,currentScript:{src:'https://dashboard.example/js/operativo-conexiones.js?v=abc12345'},
    head:{append:x=>styles.push(x)},body:{append:x=>{}},
    getElementById:id=>ids.get(id)||null,createElement:element,addEventListener:(name,cb)=>{listeners[name]=cb;}};
  const root={_DEMO_MODE:true};
  const sandbox={document:doc,window:root,URL,console,
    AUTH:{getUser:()=>({username:'usuario@ejemplo.cl',role:'admin'})},
    RBAC:{tabs:{admin:['overview','clientes','cotizaciones','pedidos','finanzas','calendario','correo','maquinas','web','redes','reporte']}},
    localStorage:{getItem:()=>null,setItem(){}},
    setTimeout:()=>{},setInterval:()=>{}};
  vm.runInNewContext(source,sandbox);
  assert.equal(typeof root.TLSConnections.mount,'function');
  listeners.DOMContentLoaded();
  assert.equal(inserted.length,1);
  assert.equal(inserted[0].x.id,'tlsConnectionsPanel');
  assert.equal(styles.length,1);
  assert.equal(styles[0].href,'https://dashboard.example/js/operativo-conexiones.css?v=abc12345');
  root.TLSConnections.mount();
  assert.equal(inserted.length,1,'no duplicar el panel al actualizar el overview');
  root.TLSConnections.result('proxy','red','Error simulado','manual');
  assert.equal(root.TLSConnections.summary().red,1);
  sandbox.AUTH.getUser=()=>({username:'otro@ejemplo.cl',role:'admin'});
  root.TLSConnections.mount();
  assert.equal(root.TLSConnections.summary().red,0,'cambiar de usuario no muestra errores de otra sesión');
});

test('no hay ficha, acciones ni verificación del proveedor retirado',()=>{
  assert.ok(!center.catalog.some(s=>s.id==='wordpress'));
  for(const legacy of ['verifyWordPress','wp-json','wpConfigPanel'])assert.equal(source.includes(legacy),false,legacy);
});


test('Comprobar ahora revisa todas las conexiones en una sola pasada sin bloqueo serial',()=>{
  assert.match(source,/const queue=list\.slice\(\)/);
  assert.match(source,/Math\.min\(4,queue\.length\)/);
  assert.match(source,/Promise\.allSettled\(workers\)/);
  assert.match(source,/await check\(service\.id,mode\)/);
  assert.doesNotMatch(source,/for\(const s of list\).*await check\(s\.id/);
});


test('el arranque hace una comprobación completa equivalente al botón sin abrir OAuth',async()=>{
  assert.match(source,/setTimeout\(\(\)=>\{if\(!DOC\.hidden&&user\(\)\)void sweep\(false,true\);\},1800\)/);
  assert.match(source,/const manual=mode==='manual'\|\|mode==='startup'/);
  assert.match(source,/visibleServices\(\)\.filter\(s=>manual\|\|includeAll\|\|s\.auto\)/);
  assert.match(source,/const mode=manual\?'manual':includeAll\?'startup':'auto'/);

  const previous={AUTH:global.AUTH,_DEMO_MODE:global._DEMO_MODE,_calClientId:global._calClientId,
    _calTokenVigente:global._calTokenVigente,_driveGetClientId:global._driveGetClientId};
  try{
    global.AUTH={getUser:()=>({username:'startup-test',role:'admin'})};global._DEMO_MODE=false;
    global._calClientId=()=>'valid.apps.googleusercontent.com';
    global._calTokenVigente=()=>false;
    global._driveGetClientId=()=>'valid.apps.googleusercontent.com';
    assert.equal((await center.probe('calendar','startup')).status,'gray');
    assert.equal((await center.probe('drive','startup')).status,'gray');
    assert.doesNotMatch(source,/requestAccessToken\(/);
  }finally{Object.assign(global,previous);}
});

test('cada diagnóstico tiene timeout aislado para no frenar las demás tarjetas',()=>{
  assert.match(source,/function probeWithTimeout\(id,mode,timeoutMs=12000\)/);
  assert.match(source,/Promise\.race\(\[Promise\.resolve\(\)\.then\(\(\)=>probe\(id,mode\)\),timeout\]\)/);
  assert.match(source,/La comprobación tardó demasiado/);
});


test('Resend distingue clave send-only y evidencia de envío real',()=>{
  assert.match(source,/send_only_or_forbidden/);
  assert.match(source,/Envía un correo normal y vuelve a verificar/);
  assert.match(source,/evidence==='recent_send'/);
  assert.doesNotMatch(source,/Resend rechazó la API key/);
  assert.match(source,/La clave Resend está limitada a envío o no autoriza lecturas/);
});


test('una respuesta unauthorized de /domains no se presenta como clave inválida',()=>{
  assert.doesNotMatch(source,/error_code==='unauthorized'[\s\S]{0,160}status:'red'/);
  assert.match(source,/error_code==='unauthorized'\|\|d\?\.error_code==='send_only_or_forbidden'/);
});


test('GitHub Pages se verifica contra la versión publicada sin usar la API privada de Actions',()=>{
  assert.doesNotMatch(source,/api\.github\.com\/repos\/thelabsolutionscl\/dashboardthelabsolutions\/actions/);
  assert.match(source,/new URL\('index\.html',base\)/);
  assert.match(source,/_tls_build_check/);
  assert.match(source,/cache:'no-store'/);
  assert.match(source,/credentials:'same-origin'/);
  assert.match(source,/operativo-visual\\\.js\\\?v=/);
  assert.match(source,/GitHub Pages responde y la versión publicada coincide/);
});
