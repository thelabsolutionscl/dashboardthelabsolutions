/* js/maquinas-led.js — control seguro de iluminación por impresora (Moonraker/Klipper). */
// Admite las configuraciones más comunes sin asumir que todas las máquinas usan
// el mismo nombre: output_pin, led/neopixel/dotstar, macros ON/OFF y M355.
const _printerLightCaps={};
const _printerLightBusy={};
const _PRINTER_LIGHT_OVERRIDE_PREFIX='printer_light_override_';
const _PRINTER_LIGHT_STATE_PREFIX='printer_light_state_';

function _printerLightSafeName(value){return/^[A-Za-z0-9_.-]+$/.test(String(value||''));}
function _printerLightSafeMacro(value){return/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value||''));}

function _printerLightParseOverride(raw){
  const value=String(raw||'').trim();
  if(!value)return null;
  if(/^M355$/i.test(value))return{available:true,kind:'macro',onScript:'M355 S1',offScript:'M355 S0',label:'M355',source:'manual'};
  const objectMatch=value.match(/^(output_pin|led|neopixel|dotstar|pca9533|pca9632)\s+([A-Za-z0-9_.-]+)$/i);
  if(objectMatch){
    const type=objectMatch[1].toLowerCase(),name=objectMatch[2];
    return{available:true,kind:type==='output_pin'?'pin':'led',object:`${type} ${name}`,name,type,source:'manual'};
  }
  const macroMatch=value.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\/\s*([A-Za-z_][A-Za-z0-9_]*)$/);
  if(macroMatch)return{available:true,kind:'macro',onScript:macroMatch[1].toUpperCase(),offScript:macroMatch[2].toUpperCase(),label:`${macroMatch[1]}/${macroMatch[2]}`,source:'manual'};
  return{error:'Usa “Auto”, “output_pin caselight”, “led chamber_led”, “LIGHT_ON/LIGHT_OFF” o “M355”.'};
}

function _printerLightNameScore(name){
  const n=String(name||'').toLowerCase();
  if(/(^|[_-])(status|indicator|error)([_-]|$)/.test(n))return-100;
  if(['caselight','case_light','chamber_light','cabinet_light','light','lights','led'].includes(n))return 100;
  if(/case|chamber|cabinet|lamp|light/.test(n))return 80;
  if(/(^|[_-])led([_-]|$)/.test(n))return 45;
  return 0;
}

function _printerLightChooseCapability(objects,commands){
  const candidates=[];
  (Array.isArray(objects)?objects:[]).forEach(object=>{
    const match=String(object||'').match(/^(output_pin|led|neopixel|dotstar|pca9533|pca9632)\s+(.+)$/i);
    if(!match||!_printerLightSafeName(match[2]))return;
    const type=match[1].toLowerCase(),name=match[2],score=_printerLightNameScore(name);
    if(score>0)candidates.push({available:true,kind:type==='output_pin'?'pin':'led',object:`${type} ${name}`,name,type,source:'auto',score:score+(type==='output_pin'?5:0)});
  });
  candidates.sort((a,b)=>b.score-a.score||a.object.localeCompare(b.object));
  if(candidates[0]){delete candidates[0].score;return candidates[0];}

  const available=new Set((Array.isArray(commands)?commands:[]).map(x=>String(x||'').toUpperCase()));
  const pairs=[
    ['CASE_LIGHT_ON','CASE_LIGHT_OFF'],['CASELIGHT_ON','CASELIGHT_OFF'],
    ['CHAMBER_LIGHT_ON','CHAMBER_LIGHT_OFF'],['LIGHTS_ON','LIGHTS_OFF'],
    ['LIGHT_ON','LIGHT_OFF'],['LED_ON','LED_OFF'],
  ];
  const pair=pairs.find(([on,off])=>available.has(on)&&available.has(off));
  if(pair)return{available:true,kind:'macro',onScript:pair[0],offScript:pair[1],label:pair.join('/'),source:'auto'};
  const genericOn=[...available].filter(cmd=>/(LIGHT|LAMP|LED)/.test(cmd)&&!/(STATUS|INDICATOR|ERROR)/.test(cmd)&&cmd.endsWith('_ON')).sort()[0];
  if(genericOn){
    const genericOff=genericOn.slice(0,-3)+'_OFF';
    if(available.has(genericOff))return{available:true,kind:'macro',onScript:genericOn,offScript:genericOff,label:`${genericOn}/${genericOff}`,source:'auto'};
  }
  if(available.has('M355'))return{available:true,kind:'macro',onScript:'M355 S1',offScript:'M355 S0',label:'M355',source:'auto'};
  return null;
}

function _printerLightReadStatus(cap,status){
  if(!cap?.object||!status||!Object.prototype.hasOwnProperty.call(status,cap.object))return null;
  const obj=status[cap.object]||{};
  if(cap.kind==='pin')return{on:Number(obj.value||0)>0.001};
  const raw=Array.isArray(obj.color_data?.[0])?obj.color_data[0]:(Array.isArray(obj.color_data)?obj.color_data:null);
  if(!raw)return null;
  const colors=raw.map(v=>Math.max(0,Math.min(1,Number(v)||0)));
  return{on:colors.some(v=>v>0.001),colors};
}

function _printerLightBuildCommand(cap,on){
  if(!cap?.available)return'';
  if(cap.kind==='pin'&&_printerLightSafeName(cap.name))return`SET_PIN PIN=${cap.name} VALUE=${on?1:0}`;
  if(cap.kind==='led'&&_printerLightSafeName(cap.name)){
    const fallback=(cap.channels||cap.lastColor?.length||3)>=4?[1,1,1,1]:[1,1,1];
    const colors=on&&Array.isArray(cap.lastColor)&&cap.lastColor.some(v=>v>0.001)?cap.lastColor:fallback;
    const vals=on?colors.map(v=>Math.max(0,Math.min(1,Number(v)||0))):colors.map(()=>0);
    let script=`SET_LED LED=${cap.name} RED=${vals[0]||0} GREEN=${vals[1]||0} BLUE=${vals[2]||0}`;
    if(vals.length>=4)script+=` WHITE=${vals[3]||0}`;
    return script+' SYNC=0';
  }
  if(cap.kind==='macro'){
    const script=on?cap.onScript:cap.offScript;
    if(/^M355 S[01]$/.test(script||''))return script;
    return _printerLightSafeMacro(script)?script:'';
  }
  return'';
}

function _printerLightApplyStatus(id,status){
  const cap=_printerLightCaps[id];
  const reading=_printerLightReadStatus(cap,status);
  if(!reading)return cap||null;
  cap.on=reading.on;cap.onKnown=true;
  if(reading.colors){cap.channels=reading.colors.length;if(reading.on)cap.lastColor=reading.colors;}
  try{localStorage.setItem(_PRINTER_LIGHT_STATE_PREFIX+id,cap.on?'1':'0');}catch(_){ }
  return cap;
}

function _printerLightView(id){
  const cap=_printerLightCaps[id];
  if(!cap)return{available:null,on:false,busy:!!_printerLightBusy[id]};
  return{available:cap.available!==false,on:!!cap.on,busy:!!_printerLightBusy[id],label:cap.label||cap.name||''};
}

function _printerLightFingerprint(id){
  const view=_printerLightView(id);
  return`${view.available===null?'unknown':view.available?'ready':'missing'}:${view.on?1:0}`;
}

function _printerLightQuerySuffix(id){
  const object=_printerLightCaps[id]?.object;
  return object?'&'+encodeURIComponent(object):'';
}

function _printerLightWsObjects(id){
  const objects={print_stats:null,heater_bed:null,extruder:null,display_status:null,virtual_sdcard:null,webhooks:null};
  const object=_printerLightCaps[id]?.object;if(object)objects[object]=null;
  return objects;
}

function _printerLightResubscribe(id){
  if(typeof _wsConn==='undefined')return;
  const ws=_wsConn[id];if(!ws||ws.readyState!==1)return;
  try{ws.send(JSON.stringify({jsonrpc:'2.0',method:'printer.objects.subscribe',params:{objects:_printerLightWsObjects(id)},id:Date.now()}));}catch(_){ }
}

function _printerLightHelpCommands(help){
  const result=help?.result?.gcode_help||help?.result||{};
  return result&&typeof result==='object'&&!Array.isArray(result)?Object.keys(result):[];
}

async function _detectPrinterLight(id,force=false){
  const cached=_printerLightCaps[id];
  if(!force&&cached&&(cached.available!==false||Date.now()<(cached.retryAt||0)))return cached;
  const rawOverride=localStorage.getItem(_PRINTER_LIGHT_OVERRIDE_PREFIX+id)||'';
  const parsed=_printerLightParseOverride(rawOverride);
  if(parsed?.error){const cap={available:false,reason:parsed.error,retryAt:Date.now()+30000};_printerLightCaps[id]=cap;return cap;}

  let cap=parsed;
  if(!cap){
    const [list,help]=await Promise.all([
      _moonrakerGet(id,'/printer/objects/list',7000),
      _moonrakerGet(id,'/printer/gcode/help',7000),
    ]);
    cap=_printerLightChooseCapability(list?.result?.objects||[],_printerLightHelpCommands(help));
  }
  if(!cap){
    cap={available:false,reason:'Moonraker no informó un pin, LED o macro compatible.',retryAt:Date.now()+30000};
    _printerLightCaps[id]=cap;return cap;
  }
  const saved=localStorage.getItem(_PRINTER_LIGHT_STATE_PREFIX+id);
  cap.on=saved==='1';cap.onKnown=saved==='1'||saved==='0';
  _printerLightCaps[id]=cap;
  if(cap.object){
    const data=await _moonrakerGet(id,'/printer/objects/query?'+encodeURIComponent(cap.object),7000);
    _printerLightApplyStatus(id,data?.result?.status||{});
  }
  _printerLightResubscribe(id);
  return cap;
}

function _renderPrinterLightButton(id){
  const view=_printerLightView(id),state=view.available===null?'unknown':view.available?'ready':'unavailable';
  const title=view.busy?'Cambiando luz…':view.available===null?'Detectar y controlar luz LED':view.available?(view.on?'Apagar luz LED':'Encender luz LED'):'LED no detectado · configura el control en ⚙';
  return`<button id="plight_${id}" class="printer-light-btn ${state}${view.on?' on':''}${view.busy?' busy':''}" onclick="togglePrinterLight('${id}',this)" aria-label="${title}" aria-pressed="${view.on?'true':'false'}" title="${title}" ${view.busy?'disabled':''}>${view.busy?'…':'💡'}</button>`;
}

function _patchPrinterLightButton(id){
  const button=document.getElementById('plight_'+id);if(!button)return;
  const view=_printerLightView(id),state=view.available===null?'unknown':view.available?'ready':'unavailable';
  button.className=`printer-light-btn ${state}${view.on?' on':''}${view.busy?' busy':''}`;
  button.disabled=view.busy;button.textContent=view.busy?'…':'💡';
  const title=view.busy?'Cambiando luz…':view.available===null?'Detectar y controlar luz LED':view.available?(view.on?'Apagar luz LED':'Encender luz LED'):'LED no detectado · configura el control en ⚙';
  button.title=title;button.setAttribute('aria-label',title);button.setAttribute('aria-pressed',view.on?'true':'false');
}

async function togglePrinterLight(id,button){
  if(_printerLightBusy[id])return;
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  if(window._DEMO_MODE){
    const cap=_printerLightCaps[id]||(_printerLightCaps[id]={available:true,kind:'demo',on:false,onKnown:true,label:'Demo'});
    cap.on=!cap.on;try{localStorage.setItem(_PRINTER_LIGHT_STATE_PREFIX+id,cap.on?'1':'0');}catch(_){ }
    toast(`💡 Luz ${cap.on?'encendida':'apagada'} · ${m.nombre} #${m.numG}`,'success');
    renderMonitorGrid();_patchPrinterLightButton(id);return;
  }
  const state=_printerStatus[id]?.state;
  if(!getPrinterIp(m)){toast('Sin IP configurada','error');return;}
  if(['offline','noip','shutdown','startup'].includes(state)){toast('La impresora no está disponible para controlar la luz','error');return;}

  _printerLightBusy[id]=true;if(button)button.disabled=true;_patchPrinterLightButton(id);
  try{
    const cap=await _detectPrinterLight(id);
    if(!cap?.available){
      toast('💡 LED no detectado. Abre ⚙ y configura “Control LED”.','error');return;
    }
    const turnOn=!cap.on,script=_printerLightBuildCommand(cap,turnOn);
    if(!script){toast('Configuración LED inválida. Revísala en ⚙.','error');return;}
    // La iluminación es segura durante una impresión: no mueve ejes ni modifica temperaturas.
    const ok=await _sendGcode(id,script,`💡 Luz ${turnOn?'encendida':'apagada'} · ${m.nombre} #${m.numG}`,{allowBusy:true});
    if(!ok)return;
    cap.on=turnOn;cap.onKnown=true;
    try{localStorage.setItem(_PRINTER_LIGHT_STATE_PREFIX+id,turnOn?'1':'0');}catch(_){ }
    if(_printerStatus[id])_printerStatus[id].light={available:true,on:turnOn};
  }finally{
    _printerLightBusy[id]=false;
    renderMonitorGrid();_patchPrinterLightButton(id);
  }
}

// Primitivas expuestas solo para pruebas unitarias; no incluyen red ni credenciales.
window.PrinterLights={_test:{parseOverride:_printerLightParseOverride,chooseCapability:_printerLightChooseCapability,readStatus:_printerLightReadStatus,buildCommand:_printerLightBuildCommand}};

// Bootstrap de extensiones de Máquinas. Este archivo se carga entre maquinas.js
// y maquinas-operaciones.js, por lo que aquí podemos insertar extensiones de
// forma parser-blocking sin tocar el index.html gigante. Conservamos el mismo
// ?v=BUILD del script actual para que el cache/versionado siga alineado.
(function _loadMachineExtensions(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  if(window.__TLS_MACHINE_EXTENSIONS_BOOTSTRAP__)return;
  window.__TLS_MACHINE_EXTENSIONS_BOOTSTRAP__=true;
  const current=document.currentScript;
  const raw=current?.src||'';
  const suffix=raw.includes('?')?'?'+raw.split('?').slice(1).join('?'):'';
  const paths=['js/maquinas-farm-controller.js','js/machineops-storage-adapter.js'];
  if(document.readyState==='loading'&&typeof document.write==='function'){
    document.write(paths.map(path=>`<script src="${path}${suffix}"><\/script>`).join(''));
    return;
  }
  // Fallback para cargas manuales/tardías (por ejemplo en tests o consola).
  if(typeof document.createElement!=='function'||!document.head)return;
  let chain=Promise.resolve();
  paths.forEach(path=>{
    chain=chain.then(()=>new Promise((resolve,reject)=>{
      if(Array.from(document.scripts||[]).some(s=>String(s.src||'').includes('/'+path)))return resolve();
      const s=document.createElement('script');s.src=path+suffix;s.onload=resolve;s.onerror=reject;document.head.appendChild(s);
    }));
  });
  chain.catch(e=>console.warn('[Máquinas] no se pudo cargar una extensión',e));
})();
