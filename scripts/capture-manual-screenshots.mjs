import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const BASE='http://127.0.0.1:4173/';
const OUT='docs/manual/assets';
await fs.mkdir(OUT,{recursive:true});

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({
  viewport:{width:1600,height:1000},
  deviceScaleFactor:1,
  locale:'es-CL',
  timezoneId:'America/Santiago',
  colorScheme:'dark'
});
const page=await context.newPage();

const demoSession={
  username:'demo@thelab.solutions',
  name:'Demo Manual',
  role:'demo',
  expires:Date.now()+8*60*60*1000,
  remember:false
};

await page.addInitScript(session=>{
  localStorage.setItem('thelab_session_v2',JSON.stringify(session));
  sessionStorage.setItem('thelab_active_tab','overview');
  localStorage.setItem('tls_ui_theme','dark');
  localStorage.setItem('tls_ui_wallpaper','blueprint');
  localStorage.setItem('tls_ui_font','dm');
},demoSession);

async function dismiss(){
  await page.evaluate(()=>{
    try{closeUserMenu?.()}catch(_){}
    try{closeAppearanceSettings?.()}catch(_){}
    try{document.getElementById('tlsConnDialog')?.close()}catch(_){}
    try{document.getElementById('tlsBugDialog')?.close()}catch(_){}
    document.querySelectorAll('.appearance-modal-overlay.open').forEach(el=>el.classList.remove('open'));
    document.querySelectorAll('.toast,.toast-item,.sys-loader,.system-loader').forEach(el=>{el.style.display='none'});
    window.scrollTo(0,0);
  }).catch(()=>{});
}

async function shot(name,{tab,action,delay=1200,scrollY=0}={}){
  await dismiss();
  if(tab){
    await page.evaluate(t=>{ try{switchTab(t)}catch(e){console.warn(e)} },tab);
  }
  if(action)await page.evaluate(action);
  await page.waitForTimeout(delay);
  await page.evaluate(()=>{
    document.querySelectorAll('.op-switch,.op-scope-note').forEach(el=>{
      if(/simple|experto/i.test(el.textContent||''))el.style.display='none';
    });
  });
  await page.evaluate(y=>window.scrollTo(0,y),scrollY);
  await page.waitForTimeout(250);
  await page.screenshot({path:`${OUT}/${name}.png`,fullPage:false});
  console.log('captured',name);
}

await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(6000);

// La carga parte en DEMO para usar únicamente fixtures seguros. Después elevamos
// el rol visualmente a admin manteniendo _DEMO_MODE=true, para poder documentar
// también Calendario, Correo y Centro de Conexiones sin tocar servicios reales.
await page.evaluate(()=>{
  const key='thelab_session_v2';
  const s=JSON.parse(localStorage.getItem(key)||'{}');
  s.role='admin';s.name='Demo Manual';s.username='manual@thelab.solutions';
  localStorage.setItem(key,JSON.stringify(s));
  window._DEMO_MODE=true;
  try{AUTH.showUser()}catch(_){}
  try{applyRBAC()}catch(_){}
});
await page.waitForTimeout(1200);

await shot('primeros-pasos',{tab:'overview',action:()=>{try{openUserMenu()}catch(_){}}});
await shot('overview',{tab:'overview'});
await shot('clientes',{tab:'clientes'});
await shot('cotizaciones',{tab:'cotizaciones'});
await shot('pedidos',{tab:'pedidos'});
await shot('inventario',{tab:'inventario'});
await shot('proveedores',{tab:'proveedores'});
await shot('agentes',{tab:'agentes'});
await shot('oficina',{tab:'oficina',delay:1600});
await shot('redes',{tab:'redes',delay:1600});
await shot('newsletter',{tab:'newsletter',delay:1600});
await shot('maquinas',{tab:'maquinas',delay:2500});
await shot('equipo',{tab:'equipo',delay:1600});
await shot('calendario',{tab:'calendario',delay:1600});
await shot('reportes',{tab:'reporte',delay:1200});
await shot('web',{tab:'web',delay:1800});
await shot('finanzas',{tab:'finanzas',action:()=>{const n=document.querySelector('#tab-finanzas .op-scope-note');if(n)n.style.display='none'},delay:1600,scrollY:340});
await shot('remuneraciones',{tab:'remuneraciones',delay:1400});
await shot('correo',{tab:'correo',delay:1800});
await shot('centro-conexiones',{tab:'overview',action:()=>{try{openConnectionsCenterFromUserMenu()}catch(_){}} ,delay:1600});
await shot('overview-atencion',{tab:'overview',scrollY:620});
await shot('clientes-listado',{tab:'clientes',scrollY:520});
await shot('clientes-nuevo',{tab:'nuevo-lead',delay:1000});
await shot('cotizaciones-listado',{tab:'cotizaciones',scrollY:520});
await shot('nueva-cotizacion',{tab:'nueva-cot',delay:1200});
await shot('pedidos-tabla',{tab:'pedidos',action:()=>{try{setPedidosView('tabla')}catch(_){}},delay:1000});
await shot('pedidos-planificacion',{tab:'pedidos',action:()=>{try{setPedidosView('planificacion')}catch(_){}},delay:1000});
await shot('inventario-stock',{tab:'inventario',scrollY:520});
await shot('agentes-cola',{tab:'agentes',scrollY:560});
await shot('newsletter-campanas',{tab:'newsletter',scrollY:650,delay:1400});
await shot('maquinas-telemetria',{tab:'maquinas',scrollY:650,delay:2200});
await shot('maquinas-planificacion',{tab:'maquinas',action:()=>{try{MachineOps.showView('planificacion')}catch(_){}},delay:1800});
await shot('calendario-agenda',{tab:'calendario',action:()=>{try{calSetVista('agenda')}catch(_){}},delay:1200});
await shot('reportes-historial',{tab:'reporte',scrollY:600,delay:1200});
await shot('web-google-ads',{tab:'web',scrollY:650,delay:1500});
await shot('finanzas-facturas',{tab:'finanzas',action:()=>{try{finSwitchTab('facturas')}catch(_){}const n=document.querySelector('#tab-finanzas .op-scope-note');if(n)n.style.display='none'},delay:1200,scrollY:340});
await shot('finanzas-por-cobrar',{tab:'finanzas',action:()=>{try{finSwitchTab('cobrar')}catch(_){}const n=document.querySelector('#tab-finanzas .op-scope-note');if(n)n.style.display='none'},delay:1200,scrollY:340});
await shot('correo-redactar',{tab:'correo',action:()=>{try{const p=document.getElementById('mailPassModal');if(p)p.style.display='none';MAIL.openCompose({to:'cliente.demo@example.com',subject:'Ejemplo de correo',body:'Este es un borrador de demostración para el manual de usuario.'})}catch(_){}},delay:1000});
await shot('centro-conexiones-detalle',{tab:'overview',action:()=>{try{openConnectionsCenterFromUserMenu();const d=document.getElementById('tlsConnDialog');if(d)d.scrollTop=620}catch(_){}},delay:1000});

await shot('apariencia',{tab:'overview',action:()=>{try{openAppearanceSettings()}catch(_){}} ,delay:800});
await shot('reportar-problema',{tab:'overview',action:()=>{try{openBugReporter()}catch(_){}},delay:900});

// El propio manual se captura al final, cuando todas las imágenes anteriores
// ya existen en disco y el servidor local puede mostrarlas.
await page.goto(BASE+'manual.html',{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(1500);
// Evita que la captura del manual se fotografíe a sí misma y genere un efecto
// recursivo cada vez más pequeño en regeneraciones sucesivas.
await page.evaluate(()=>{
  document.querySelectorAll('.manual-shot img[src*="manual-web.png"]').forEach(img=>{
    const figure=img.closest('.manual-shot');
    if(figure)figure.style.display='none';
  });
  window.scrollTo(0,0);
});
await page.waitForTimeout(150);
await page.screenshot({path:`${OUT}/manual-web.png`,fullPage:false});
console.log('captured manual-web');

await browser.close();
