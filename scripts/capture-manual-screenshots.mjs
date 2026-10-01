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
    document.querySelectorAll('.appearance-modal-overlay.open').forEach(el=>el.classList.remove('open'));
    document.querySelectorAll('.toast,.toast-item,.sys-loader,.system-loader').forEach(el=>{el.style.display='none'});
    window.scrollTo(0,0);
  }).catch(()=>{});
}

async function shot(name,{tab,action,delay=1200}={}){
  await dismiss();
  if(tab){
    await page.evaluate(t=>{ try{switchTab(t)}catch(e){console.warn(e)} },tab);
  }
  if(action)await page.evaluate(action);
  await page.waitForTimeout(delay);
  await page.evaluate(()=>window.scrollTo(0,0));
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
await shot('finanzas',{tab:'finanzas',delay:1600});
await shot('remuneraciones',{tab:'remuneraciones',delay:1400});
await shot('correo',{tab:'correo',delay:1800});
await shot('centro-conexiones',{tab:'overview',action:()=>{try{openConnectionsCenterFromUserMenu()}catch(_){}} ,delay:1600});
await shot('apariencia',{tab:'overview',action:()=>{try{openAppearanceSettings()}catch(_){}} ,delay:800});

// El propio manual se captura al final, cuando todas las imágenes anteriores
// ya existen en disco y el servidor local puede mostrarlas.
await page.goto(BASE+'manual.html',{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(1500);
await page.screenshot({path:`${OUT}/manual-web.png`,fullPage:false});
console.log('captured manual-web');

await browser.close();
