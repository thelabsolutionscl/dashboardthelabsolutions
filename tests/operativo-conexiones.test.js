'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const center=require('../js/operativo-conexiones.js');
const source=fs.readFileSync('js/operativo-conexiones.js','utf8');
const visual=fs.readFileSync('js/operativo-visual.js','utf8');
const css=fs.readFileSync('js/operativo-conexiones.css','utf8');

test('catálogo tiene 16 servicios independientes, sin estados verdes ficticios',()=>{
  assert.equal(center.catalog.length,16);
  assert.equal(new Set(center.catalog.map(x=>x.id)).size,16);
  for(const id of ['proxy','airtable','calendar','drive','imap','resend','printer','sii','leads','github','anthropic','openai','make','ads','meta','wordpress']){
    assert.ok(center.catalog.some(x=>x.id===id),id);
  }
  const c=center.counts(center.catalog);
  assert.equal(c.green,0);assert.equal(c.red,0);assert.equal(c.gray,16);
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

test('Claude no consume tokens y usa solo /health para presencia de configuración',async()=>{
  const previous={fetch:global.fetch,AUTH:global.AUTH,_DEFAULTS:global._DEFAULTS,_DEMO_MODE:global._DEMO_MODE};
  const urls=[];
  try{
    global.AUTH={getUser:()=>({username:'admin-test',role:'admin'})};
    global._DEFAULTS={PROXY_URL:'https://proxy.thelab.solutions'};
    global._DEMO_MODE=false;
    global.fetch=async(url,opts)=>{
      urls.push({url,opts});return {ok:true,status:200,json:async()=>({ok:true,anthropic:true,openai:false})};
    };
    const claude=await center.probe('anthropic','manual');
    const openai=await center.probe('openai','manual');
    assert.equal(claude.status,'yellow','tener token no valida la suscripción');
    assert.equal(openai.status,'gray','no declarar error si el servicio no está habilitado');
    assert.deepEqual(urls.map(x=>x.url),['https://proxy.thelab.solutions/health']);
    assert.ok(urls.every(x=>x.opts.method==='GET'));
  }finally{Object.assign(global,previous);}
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

test('IMAP hace solo lectura de carpetas bajo demanda; Resend nunca envía pruebas',async()=>{
  const previous={AUTH:global.AUTH,MAIL:global.MAIL,_DEMO_MODE:global._DEMO_MODE};
  let calls=0;
  try{
    global.AUTH={getUser:()=>({username:'mail-test',role:'admin'})};global._DEMO_MODE=false;
    global.MAIL={activeAccount:()=> 'foo@example.com',getMailPass:()=> 'no-persistir',
      post:async(p)=>{calls++;assert.deepEqual(p,{action:'folders'});return {folders:[]};}};
    assert.equal((await center.probe('imap','auto')).status,'gray');
    assert.equal(calls,0);
    assert.equal((await center.probe('imap','manual')).status,'green');
    assert.equal(calls,1);
    assert.equal((await center.probe('resend','manual')).status,'gray');
    assert.equal(calls,1);
    assert.doesNotMatch(source,/MAIL\.post\(\s*\{\s*action:['"]send/);
  }finally{Object.assign(global,previous);}
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
