/* js/maquinas-informe-tecnico.js — Informe técnico por impresora.
 *
 * Botón «🩺 INFORME» de cada tarjeta en Máquinas. Arma la misma revisión que el
 * informe manual INF-261005 (K1 · 192.168.100.51):
 *   1. Pruebas controladas opcionales desde el navegador (ventiladores y
 *      calentamiento del hotend), sólo con la impresora libre y confirmación.
 *   2. Auditoría V3 del Farm Controller (Moonraker, logs de varios días, PID,
 *      ventiladores, historial) interpretada por IA en modo informe.
 *   3. PDF con la identidad de las cotizaciones (buildCotizacionDoc).
 * Las pruebas siempre terminan con calentador y ventiladores en 0.
 */
(function(){
'use strict';

const TURQ='#00d4cc',ORANGE='#ff6b35';
const HEAT_TIMEOUT_S=240,HOLD_S=60,HOLD_FAN_S=45,OVERHEAT_MARGIN=15;
const _run={};

function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function fixed(v,d){return Number.isFinite(Number(v))?Number(v).toFixed(d).replace('.',','):'—';}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
function machines(){try{return typeof MAQUINAS!=='undefined'&&Array.isArray(MAQUINAS)?MAQUINAS:[];}catch(_){return[];}}
function machine(id){return machines().find(function(m){return String(m.id)===String(id);})||null;}
function liveStatus(id){try{return (typeof _printerStatus!=='undefined'&&_printerStatus[id])||{};}catch(_){return{};}}
function ipOf(m){try{return typeof getPrinterIp==='function'?getPrinterIp(m):m?.ip||'';}catch(_){return m?.ip||'';}}
function note(msg,type){try{if(typeof toast==='function')toast(msg,type||'info');}catch(_){}}
function label(m){return m?[m.modelo,m.nombre].filter(Boolean).join(' · ')+(m.numG!=null?' #'+m.numG:''):'';}

// ── Elegibilidad de las pruebas físicas ────────────────────────
function testEligibility(id){
  const s=liveStatus(id),state=String(s.state||'');
  if(typeof _printerControlFresh==='function'&&!_printerControlFresh(id))return{ok:false,reason:'Sin telemetría fresca de la impresora'};
  if(['printing','paused','calibrating'].includes(state))return{ok:false,reason:'La impresora está ocupada ('+state+')'};
  try{if(typeof _printerPhysicallyBusy==='function'&&_printerPhysicallyBusy(id))return{ok:false,reason:'Hay una operación física en curso'};}catch(_){}
  if(num(s.hotend?.actual)>120)return{ok:false,reason:'El hotend sigue caliente ('+Math.round(num(s.hotend?.actual))+' °C)'};
  return{ok:true,reason:''};
}

// ── Moonraker vía las rutas ya autenticadas del dashboard ──────
async function mrGet(id,path,timeout){
  if(typeof _moonrakerGet!=='function')return null;
  return _moonrakerGet(id,path,timeout||5000);
}
async function gcode(id,script){
  if(typeof _sendGcode!=='function')return false;
  // allowStale: los apagados del final deben salir aunque la telemetría se haya
  // marcado vieja a mitad de la prueba; la elegibilidad ya se validó al inicio.
  return _sendGcode(id,script,'',{allowBusy:true,allowStale:true,quietFailure:true,timeout:12000});
}
const CONTROLLABLE_FAN=/^(fan|fan_generic .+|output_pin fan\d+)$/;
function fanCommands(name){
  if(name==='fan')return{on:'M106 S255',off:'M107',usage:'Ventilador de pieza'};
  let m=name.match(/^fan_generic (.+)$/);
  if(m)return{on:'SET_FAN_SPEED FAN='+m[1]+' SPEED=1',off:'SET_FAN_SPEED FAN='+m[1]+' SPEED=0',usage:'Ventilador '+m[1]};
  m=name.match(/^output_pin fan(\d+)$/);
  if(m){
    // Convención Creality (K1/K2): M106 P<n>; fan0 pieza, fan1 trasero, fan2 auxiliar.
    const usage={0:'Ventilador de pieza (cabezal)',1:'Ventilador trasero (cámara)',2:'Ventilador auxiliar lateral'}[m[1]]||'Ventilador '+m[1];
    return{on:'M106 P'+m[1]+' S255',off:'M106 P'+m[1]+' S0',usage};
  }
  return null;
}
function fanReading(obj){
  if(!obj||typeof obj!=='object')return{value:null,rpm:null};
  const value=obj.speed!=null?num(obj.speed):obj.value!=null?num(obj.value):null;
  return{value,rpm:obj.rpm==null?null:num(obj.rpm)};
}
function partFanOf(fans){
  return fans.find(function(f){return f.name==='output_pin fan0';})||fans.find(function(f){return f.name==='fan';})||null;
}

async function fanTest(id,progress){
  const list=await mrGet(id,'/printer/objects/list',6000);
  const names=(list?.result?.objects||[]).filter(function(n){return CONTROLLABLE_FAN.test(String(n));}).slice(0,6);
  const rows=[];
  for(const name of names){
    const cmd=fanCommands(name);if(!cmd)continue;
    if(_run[id]?.cancelled)break;
    progress('Ventiladores','Encendiendo '+name+' al 100%…');
    const accepted=await gcode(id,cmd.on);
    await sleep(3500);
    const q=await mrGet(id,'/printer/objects/query?'+encodeURIComponent(name),5000),on=fanReading(q?.result?.status?.[name]);
    await gcode(id,cmd.off);
    await sleep(1200);
    const q2=await mrGet(id,'/printer/objects/query?'+encodeURIComponent(name),5000),off=fanReading(q2?.result?.status?.[name]);
    rows.push({name,usage:cmd.usage,command:cmd.on,accepted:!!accepted,valueOn:on.value,valueOff:off.value,rpmOn:on.rpm,spinConfirmed:on.rpm!=null&&on.rpm>0?true:null});
  }
  return rows;
}

async function heatTest(id,target,fans,progress){
  const series=[],errors=[],startedAt=Date.now(),part=partFanOf(fans);
  const partCmd=part?fanCommands(part.name):null;
  let phase='heating',reachedAt=null,t200=null,holdStart=null,fanStart=null,failures=0,startTemp=null,aborted='';
  if(!await gcode(id,'M104 S'+target))throw new Error('La impresora no aceptó la orden de calentamiento');
  try{
    while(true){
      if(_run[id]?.cancelled){aborted='Cancelada por el operador';break;}
      const t=(Date.now()-startedAt)/1000;
      const q=await mrGet(id,'/printer/objects/query?extruder=temperature,target,power&webhooks=state,state_message',4000);
      const st=q?.result?.status;
      if(!st){if(++failures>=5){aborted='Se perdió la telemetría durante la prueba';break;}await sleep(1000);continue;}
      failures=0;
      const temp=num(st.extruder?.temperature),power=num(st.extruder?.power),klState=String(st.webhooks?.state||'');
      if(startTemp==null)startTemp=temp;
      series.push({t:Number(t.toFixed(1)),temp:Number(temp.toFixed(1)),target:num(st.extruder?.target),power:Number(power.toFixed(3)),phase});
      if(klState&&klState!=='ready'){errors.push('Klipper pasó a '+klState+': '+String(st.webhooks?.state_message||'').slice(0,200));aborted='Klipper dejó de estar listo';break;}
      if(temp>target+OVERHEAT_MARGIN){errors.push('Temperatura '+temp.toFixed(1)+' °C supera el objetivo + '+OVERHEAT_MARGIN+' °C');aborted='Sobretemperatura';break;}
      if(t200==null&&temp>=Math.min(200,target-20))t200=t;
      if(phase==='heating'){
        progress('Calentando hotend',temp.toFixed(1)+' °C → '+target+' °C · '+Math.round(t)+' s');
        if(temp>=target-1){reachedAt=t;phase='hold';holdStart=t;}
        else if(t>HEAT_TIMEOUT_S){errors.push('No alcanzó '+target+' °C en '+HEAT_TIMEOUT_S+' s');aborted='No alcanzó la temperatura';break;}
      }else if(phase==='hold'){
        progress('Estabilidad a '+target+' °C','Sin ventiladores · '+temp.toFixed(1)+' °C · potencia '+Math.round(power*100)+'% · '+Math.round(t-holdStart)+'/'+HOLD_S+' s');
        if(t-holdStart>=HOLD_S){
          if(partCmd){await gcode(id,partCmd.on);phase='hold_fan';fanStart=t;}
          else break;
        }
      }else if(phase==='hold_fan'){
        progress('Estabilidad con ventilador de pieza','100% · '+temp.toFixed(1)+' °C · potencia '+Math.round(power*100)+'% · '+Math.round(t-fanStart)+'/'+HOLD_FAN_S+' s');
        if(t-fanStart>=HOLD_FAN_S)break;
      }
      await sleep(1000);
    }
  }finally{
    await gcode(id,'M104 S0');
    if(partCmd)await gcode(id,partCmd.off);
  }
  const phaseStats=function(name){
    const rows=series.filter(function(r){return r.phase===name;});if(!rows.length)return null;
    const temps=rows.map(function(r){return r.temp;}),pw=rows.map(function(r){return r.power;});
    return{min:Math.min.apply(null,temps),max:Math.max.apply(null,temps),avgPower:pw.reduce(function(a,b){return a+b;},0)/pw.length,seconds:Math.round(rows[rows.length-1].t-rows[0].t)};
  };
  const heating=series.filter(function(r){return r.phase==='heating';});
  const afterReach=series.filter(function(r){return reachedAt!=null&&r.t>=reachedAt&&r.t<=reachedAt+40;});
  const overshoot=afterReach.length?Math.max.apply(null,afterReach.map(function(r){return r.temp;})):null;
  return{
    target,startTemp,aborted,errors,
    heatToNear200Sec:t200,reachSec:reachedAt,
    rateCps:t200&&startTemp!=null?Number(((Math.min(200,target-20)-startTemp)/t200).toFixed(2)):null,
    avgPowerHeating:heating.length?heating.reduce(function(a,r){return a+r.power;},0)/heating.length:null,
    overshootMax:overshoot,overshoot:overshoot!=null?Number((overshoot-target).toFixed(1)):null,
    hold:phaseStats('hold'),holdFan:phaseStats('hold_fan'),partFan:part?part.name:'',
    // 1 punto cada ~2 s: suficiente para el gráfico y liviano para el sello.
    series:series.filter(function(_,i){return i%2===0;}).map(function(r){return[r.t,r.temp,r.target,r.power];})
  };
}

async function runControlledTests(id,target,progress){
  const m=machine(id),startedAt=Date.now(),out={performedAt:new Date().toISOString(),fans:[],heat:null,finalState:null,errors:[]};
  try{if(typeof _machineOperationSet==='function')_machineOperationSet(id,{type:'maintenance',label:'Pruebas del informe técnico',phase:'PRUEBAS · ventiladores y calentamiento',source:'dashboard-informe',startedAt,expiresAt:startedAt+12*60000});}catch(_){}
  try{
    out.fans=await fanTest(id,progress);
    if(!_run[id]?.cancelled)out.heat=await heatTest(id,target,out.fans,progress);
  }catch(e){out.errors.push(String(e?.message||e).slice(0,300));}
  finally{
    // Estado seguro siempre: calentador y ventiladores probados en 0.
    await gcode(id,'M104 S0');
    for(const f of out.fans){const c=fanCommands(f.name);if(c)await gcode(id,c.off);}
    try{if(typeof _machineOperationClear==='function')_machineOperationClear(id);}catch(_){}
  }
  await sleep(1500);
  const q=await mrGet(id,'/printer/objects/query?extruder=temperature,target&heater_bed=temperature,target&webhooks=state',5000),st=q?.result?.status||{};
  out.finalState={hotend:num(st.extruder?.temperature),hotendTarget:num(st.extruder?.target),bed:num(st.heater_bed?.temperature),bedTarget:num(st.heater_bed?.target),klipper:String(st.webhooks?.state||''),fansOff:out.fans.map(function(f){return f.name;})};
  out.machine={id,label:label(m)};
  return out;
}

// ── Diálogo del botón ──────────────────────────────────────────
function dialog(){
  let el=document.getElementById('mrepModal');if(el)return el;
  el=document.createElement('div');el.id='mrepModal';
  el.style.cssText='display:none;position:fixed;inset:0;z-index:10070;background:rgba(4,8,14,.78);backdrop-filter:blur(6px);align-items:center;justify-content:center;padding:16px';
  el.innerHTML='<div style="width:min(620px,96vw);max-height:92vh;overflow:auto;background:var(--surface);border:1px solid var(--border);border-top:3px solid '+TURQ+';border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,.45)"><div style="display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--border)"><div id="mrepTitle" style="font-size:14px;font-weight:900;letter-spacing:.4px;flex:1">INFORME TÉCNICO</div><button class="btn btn-ghost btn-sm" onclick="MachineReport.close()">✕</button></div><div id="mrepBody" style="padding:16px 18px"></div></div>';
  el.addEventListener('click',function(e){if(e.target===el&&!Object.keys(_run).length)close();});
  document.body.appendChild(el);return el;
}
function close(){const el=document.getElementById('mrepModal');if(el)el.style.display='none';}

async function open(id){
  const m=machine(id);if(!m){note('Máquina no encontrada','error');return false;}
  try{if(typeof _refreshPrinterAccessTicket==='function')await _refreshPrinterAccessTicket(false);}catch(_){}
  if(window.MachineOps?.canRunPrinterAudit&&!window.MachineOps.canRunPrinterAudit()){
    note('Para auditar necesitas una sesión operator/admin con el Farm Controller','error');return false;
  }
  if(_run[id]){note('Ya hay un informe en curso para esta impresora','info');return false;}
  const el=dialog(),body=document.getElementById('mrepBody'),elig=testEligibility(id);
  document.getElementById('mrepTitle').textContent='INFORME TÉCNICO · '+label(m);
  body.innerHTML=
    '<div style="font-size:12px;color:var(--text2);line-height:1.55;margin-bottom:12px">Revisión remota vía Moonraker: logs de Klipper de los últimos días, historial de trabajos, configuración térmica (PID), ventiladores y estabilidad. La IA arma el diagnóstico y se genera un PDF con la identidad de The Lab Solutions.</div>'+
    '<label style="display:block;font-size:10px;font-weight:800;letter-spacing:.9px;color:var(--text3);text-transform:uppercase;margin-bottom:5px">Problema observado (opcional)</label>'+
    '<textarea id="mrepProblem" rows="2" maxlength="300" placeholder="Ej.: pieza derretida a mitad de impresión" style="width:100%;box-sizing:border-box;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font:inherit;font-size:12px;resize:vertical"></textarea>'+
    '<div style="margin-top:12px;padding:11px 12px;border:1px solid var(--border2);border-left:3px solid '+(elig.ok?TURQ:'var(--warn)')+';border-radius:9px;background:var(--surface2)">'+
      '<label style="display:flex;gap:9px;align-items:flex-start;font-size:12px;color:var(--text);cursor:'+(elig.ok?'pointer':'not-allowed')+'"><input id="mrepTests" type="checkbox" '+(elig.ok?'':'disabled')+' style="margin-top:2px"><span><b>Incluir pruebas controladas</b><br><span style="color:var(--text3);font-size:11px;line-height:1.5">Enciende cada ventilador unos segundos y calienta el hotend a <input id="mrepTarget" type="number" min="180" max="260" value="220" style="width:52px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:11px;padding:1px 4px"> °C durante ~4 min. Al final deja todo apagado.'+(elig.ok?'':'<br><b style="color:var(--warn)">No disponible: '+esc(elig.reason)+'</b>')+'</span></span></label></div>'+
    '<div id="mrepProgress" style="display:none;margin-top:12px;padding:11px 12px;border-radius:9px;background:rgba(0,212,204,.08);border:1px solid rgba(0,212,204,.3)"><b id="mrepProgTitle" style="font-size:12px;color:var(--accent)"></b><div id="mrepProgDetail" style="font-size:11.5px;color:var(--text2);margin-top:3px"></div></div>'+
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button id="mrepCancel" class="btn btn-ghost btn-sm" onclick="MachineReport.cancel(\''+esc(id)+'\')">Cancelar</button><button id="mrepGo" class="btn btn-primary btn-sm" style="font-weight:900;letter-spacing:.4px" onclick="MachineReport.run(\''+esc(id)+'\')">🩺 GENERAR INFORME</button></div>'+
    '<div id="mrepHistory" style="margin-top:16px;border-top:1px solid var(--border2);padding-top:12px"><div style="font-size:11px;color:var(--text3)">Cargando informes anteriores…</div></div>';
  el.style.display='flex';
  loadHistory(id);
  return true;
}
async function loadHistory(id){
  const box=document.getElementById('mrepHistory');if(!box)return;
  try{
    const rows=await window.MachineOps.fetchPrinterAuditHistory(id,6);
    box.innerHTML='<div style="font-size:10px;font-weight:800;letter-spacing:.9px;color:var(--text3);text-transform:uppercase;margin-bottom:6px">Informes anteriores</div>'+(rows.length?rows.map(function(r){
      return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border2);font-size:11.5px"><span style="flex:1;color:var(--text2)">'+esc(new Date(r.createdAt).toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'}))+' · <b>'+Math.round(num(r.result?.score))+'/100</b></span><button class="btn btn-ghost btn-sm" data-audit="'+esc(r.id)+'" onclick="MachineReport.pdfFromHistory(\''+esc(id)+'\',this.dataset.audit)">⬇ PDF</button></div>';
    }).join(''):'<div style="font-size:11px;color:var(--text3)">Todavía no hay auditorías guardadas para esta impresora.</div>');
  }catch(e){box.innerHTML='<div style="font-size:11px;color:var(--text3)">No se pudo leer el historial: '+esc(e.message)+'</div>';}
}
function setProgress(title,detail){
  const box=document.getElementById('mrepProgress');if(!box)return;
  box.style.display='';document.getElementById('mrepProgTitle').textContent=title;document.getElementById('mrepProgDetail').textContent=detail||'';
}
function cancel(id){
  if(_run[id]){_run[id].cancelled=true;setProgress('Cancelando…','Apagando calentador y ventiladores.');return;}
  close();
}
async function run(id){
  if(_run[id])return false;
  const problem=String(document.getElementById('mrepProblem')?.value||'').trim().slice(0,300);
  const withTests=!!document.getElementById('mrepTests')?.checked;
  const target=Math.max(180,Math.min(260,Math.round(num(document.getElementById('mrepTarget')?.value)||220)));
  let tests=null;
  if(withTests){
    const elig=testEligibility(id);if(!elig.ok){note('Pruebas no disponibles: '+elig.reason,'error');return false;}
    if(!confirm('Pruebas controladas en '+label(machine(id))+'\n\n• Cada ventilador se encenderá al 100% unos segundos.\n• El hotend se calentará a '+target+' °C durante ~4 minutos.\n\nConfirma que la cama está despejada, la boquilla no está sobre una pieza y hay alguien cerca de la impresora.'))return false;
  }
  _run[id]={cancelled:false};
  const go=document.getElementById('mrepGo');if(go){go.disabled=true;go.textContent='EN CURSO…';}
  try{
    if(withTests){
      setProgress('Pruebas controladas','Preparando…');
      tests=await runControlledTests(id,target,setProgress);
      if(_run[id].cancelled){note('Pruebas canceladas · calentador y ventiladores apagados','info');close();return false;}
    }
    close();
    return await window.MachineOps.runPrinterAudit(id,null,{technicalReport:true,problem,controlledTests:tests});
  }catch(e){note('No se pudo generar el informe: '+(e?.message||e),'error');return false;}
  finally{delete _run[id];if(go){go.disabled=false;go.textContent='🩺 GENERAR INFORME';}}
}
async function pdfFromHistory(id,auditId){
  const w=window.open('','_blank');
  if(!w){note('Permite ventanas emergentes para ver el PDF','error');return false;}
  w.document.write('<p style="font-family:Arial;padding:24px;color:#555">Preparando informe…</p>');
  try{
    const saved=await window.MachineOps.fetchPrinterAuditDetail(id,auditId);
    if(!saved)throw new Error('Auditoría no encontrada');
    if(saved.integrityValid===false)throw new Error('el informe no supera la verificación de integridad');
    return openPdf(saved,w);
  }catch(e){w.close();note('No se pudo abrir el informe: '+e.message,'error');return false;}
}

// ── Gráfico SVG (turquesa = medición, naranja = potencia/alerta) ─
function lineChart(opts){
  const W=opts.width||680,H=opts.height||200,L=42,R=opts.right?40:12,T=10,B=26,pw=W-L-R,ph=H-T-B;
  const xs=[];opts.series.forEach(function(s){s.points.forEach(function(p){xs.push(p[0]);});});
  if(!xs.length)return'';
  const xMin=opts.xMin!=null?opts.xMin:Math.min.apply(null,xs),xMax=Math.max(xMin+1,opts.xMax!=null?opts.xMax:Math.max.apply(null,xs));
  const yMin=opts.yMin,yMax=opts.yMax;
  const X=function(v){return L+(v-xMin)/(xMax-xMin)*pw;},Y=function(v,axis){const a=axis==='right'?opts.right:{min:yMin,max:yMax};return T+ph-(v-a.min)/(a.max-a.min)*ph;};
  let g='';
  for(let i=0;i<=4;i++){const v=yMin+(yMax-yMin)*i/4,y=Y(v);g+='<line x1="'+L+'" x2="'+(L+pw)+'" y1="'+y.toFixed(1)+'" y2="'+y.toFixed(1)+'" stroke="#eee"/><text x="'+(L-6)+'" y="'+(y+3).toFixed(1)+'" font-size="8" fill="#888" text-anchor="end">'+Math.round(v)+'</text>';}
  if(opts.right)for(let i=0;i<=4;i++){const v=opts.right.min+(opts.right.max-opts.right.min)*i/4;g+='<text x="'+(L+pw+6)+'" y="'+(Y(v,'right')+3).toFixed(1)+'" font-size="8" fill="'+ORANGE+'">'+Math.round(v)+(opts.right.unit||'')+'</text>';}
  for(let i=0;i<=5;i++){const v=xMin+(xMax-xMin)*i/5,x=X(v);g+='<text x="'+x.toFixed(1)+'" y="'+(H-10)+'" font-size="8" fill="#888" text-anchor="middle">'+(opts.xFmt?opts.xFmt(v):Math.round(v))+'</text>';}
  const lines=opts.series.map(function(s){
    const d=s.points.filter(function(p){return Number.isFinite(p[1]);}).map(function(p,i){return(i?'L':'M')+X(p[0]).toFixed(1)+' '+Y(p[1],s.axis).toFixed(1);}).join('');
    return d?'<path d="'+d+'" fill="none" stroke="'+s.color+'" stroke-width="'+(s.width||1.6)+'"'+(s.dash?' stroke-dasharray="'+s.dash+'"':'')+'/>':'';
  }).join('');
  const legend=opts.series.map(function(s,i){return'<span style="margin-right:12px"><i style="display:inline-block;width:14px;height:0;border-top:2px '+(s.dash?'dashed':'solid')+' '+s.color+';vertical-align:middle;margin-right:4px"></i>'+esc(s.label)+'</span>';}).join('');
  return'<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="display:block" xmlns="http://www.w3.org/2000/svg">'+g+'<line x1="'+L+'" x2="'+L+'" y1="'+T+'" y2="'+(T+ph)+'" stroke="#ccc"/><line x1="'+L+'" x2="'+(L+pw)+'" y1="'+(T+ph)+'" y2="'+(T+ph)+'" stroke="#ccc"/>'+lines+'<text x="'+(L+pw/2)+'" y="'+(H-1)+'" font-size="8" fill="#aaa" text-anchor="middle">'+esc(opts.xLabel||'')+'</text></svg><div style="font-size:8.5px;color:#666;margin-top:3px">'+legend+'</div>';
}

// ── PDF ────────────────────────────────────────────────────────
function reportNumber(saved,m){
  const d=new Date(saved.createdAt||Date.now()),p=function(n){return String(n).padStart(2,'0');};
  const ymd=String(d.getFullYear()).slice(2)+p(d.getMonth()+1)+p(d.getDate());
  const suffix=m?.numG!=null?'-'+p(m.numG):'';
  return 'INF-'+ymd+suffix;
}
function severityOf(result){
  const r=result?.report?.severity;if(r)return r;
  return result?.overall==='critical'?'alta':result?.overall==='attention'?'media':result?.overall==='ok'?'baja':'';
}
function sevLabel(sev){return{alta:'▲ Alta',media:'▲ Media',baja:'Baja',ninguna:'Sin falla'}[sev]||'Indeterminada';}
function findingsSummary(scan){
  const files=scan?.logForensics?.files||[];const codes={};
  files.forEach(function(f){Object.entries(f.codes||{}).forEach(function(e){codes[e[0]]=(codes[e[0]]||0)+num(e[1]);});});
  return{files,codes};
}
function buildDoc(saved){
  const result=saved?.result||{},rep=result.report||{},ev=saved?.evidence||{},scan=ev.scan||{},moon=scan.moonraker||{};
  const dm=ev.dashboard?.machine||{},m=machine(saved.machineId)||{};
  const ip=dm.ip||ipOf(m)||scan.ip||'',model=dm.model||m.modelo||'',name=dm.name||m.nombre||'';
  const sw=moon.printerInfo?.result?.software_version||'',api=moon.serverInfo?.result?.moonraker_version||'';
  const numero=reportNumber(saved,m),created=new Date(saved.createdAt||Date.now());
  const fecha=created.toLocaleDateString('sv-SE'),sev=severityOf(result);
  const tests=ev.controlledTests||null,heat=tests?.heat||null,fans=tests?.fans||[];
  const problem=String(ev.problem||'').trim();
  const logo=new URL('logo-thelab-black.png',location.href).href;
  const infoRow=function(l,v){return v?'<tr><td class="k">'+esc(l)+'</td><td class="v">'+esc(v)+'</td></tr>':'';};
  const table=function(head,rows){return'<table class="items"><thead><tr>'+head.map(function(h){return'<th>'+esc(h)+'</th>';}).join('')+'</tr></thead><tbody>'+rows.map(function(r,i){return'<tr class="'+(i%2?'odd':'even')+'">'+r.map(function(c){return'<td>'+c+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table>';};
  let sec=0;const section=function(title,html){if(!html)return'';sec++;return'<div class="sec"><h2><span class="sq"></span><span class="n">'+String(sec).padStart(2,'0')+'</span>'+esc(title)+'</h2>'+html+'</div>';};
  const fs=findingsSummary(scan);

  // Conclusión
  const c=rep.conclusion||{};
  const conclusion=(c.probableCause||c.testResult||c.recommendedAction)?
    (c.probableCause?'<p><b>CAUSA MÁS PROBABLE:</b> '+esc(c.probableCause)+'</p>':'')+(c.testResult?'<p><b>PRUEBA DE HOY:</b> '+esc(c.testResult)+'</p>':'')+(c.recommendedAction?'<p><b>ACCIÓN RECOMENDADA:</b> '+esc(c.recommendedAction)+'</p>':'')+(c.caveat?'<p class="muted">* '+esc(c.caveat)+'</p>':'')
    :'<p>'+esc(result.summary||'Sin resumen')+'</p>';

  // Resumen de resultados
  let summaryRows=(rep.summaryRows||[]).map(function(r){return['<b>'+esc(r.label)+'</b>',esc(r.value)];});
  if(!summaryRows.length){
    summaryRows=[['<b>Gravedad</b>',esc(sevLabel(sev))],['<b>Puntaje de salud</b>',Math.round(num(result.score))+'/100 · confianza '+Math.round(num(result.confidence))+'%'],['<b>Hallazgos</b>',String((result.findings||[]).length)]];
    if(fs.files.length)summaryRows.push(['<b>Errores en logs</b>',esc(Object.entries(fs.codes).map(function(e){return e[1]+' × '+e[0];}).join(' · ')||'Sin errores conocidos')]);
    if(heat)summaryRows.push(['<b>Prueba de hoy</b>',esc(heat.aborted?'Interrumpida: '+heat.aborted:'Calentamiento a '+heat.target+' °C sin errores')]);
  }

  // 01 Alcance y método
  const sm=saved.sourceMatrix||{},scope=[];
  scope.push('Estado, configuración e historial de trabajos a través de la API de Moonraker'+(ip?' ('+esc(ip)+':7125)':'')+', sin acceso físico.');
  if(fs.files.length)scope.push('Logs de Klipper: '+fs.files.map(function(f){return esc(f.file);}).join(', ')+'.');
  else if(sm.sshLogs)scope.push('Últimas líneas de los logs de Klipper y Moonraker.');
  if(moon.configfile)scope.push('Configuración activa del hotend, ventiladores y protecciones de calentamiento'+(moon.configfile.saveConfigPending?' (hay cambios pendientes de guardar)':'')+'.');
  if(sm.camera)scope.push('Cámara de la impresora'+(sm.cameraVision?' con análisis visual':'')+'.');
  if(sm.thermalStability)scope.push('Muestreo de estabilidad térmica y de red.');
  if(tests)scope.push('Pruebas controladas: encendido de cada ventilador'+(heat?' y calentamiento a '+heat.target+' °C, con apagado al final':'')+'.');
  const scopeHtml='<ul>'+scope.map(function(x){return'<li>'+x+'</li>';}).join('')+'</ul><p class="muted">Las horas de los logs son las del reloj interno de la impresora.</p>';

  // 02 Hallazgos en los logs
  let logsHtml='';
  if((rep.timeline||[]).length)logsHtml=table(['Fecha','Qué registró la impresora','Qué significa'],rep.timeline.map(function(r){return[esc(r.date),esc(r.event),esc(r.meaning)];}));
  else if(fs.files.length)logsHtml=table(['Archivo','Coincidencias','Códigos detectados'],fs.files.map(function(f){return[esc(f.file),String(num(f.matches)),esc(Object.entries(f.codes||{}).map(function(e){return e[1]+' × '+e[0];}).join(' · ')||'—')];}));
  const store=moon.temperatureStore?.series?.extruder;
  if(!tests&&store&&Array.isArray(store.temperatures)&&store.temperatures.some(function(v){return num(v)>45;})){
    const iv=num(moon.temperatureStore.intervalSec)||5,n=store.temperatures.length;
    const pts=function(arr){return(arr||[]).map(function(v,i){return[(i-n+1)*iv/60,v==null?NaN:Number(v)];});};
    logsHtml+='<div class="fig">'+lineChart({series:[{label:'Hotend (°C)',color:TURQ,points:pts(store.temperatures)},{label:'Objetivo',color:'#999',dash:'4 3',width:1,points:pts(store.targets)}],yMin:0,yMax:Math.max(240,Math.ceil((Math.max.apply(null,store.temperatures.map(num))+10)/40)*40),xLabel:'minutos antes de la revisión',xFmt:function(v){return v.toFixed(0);}})+'<div class="cap">Figura 1. Temperatura del hotend registrada por Moonraker en los minutos previos a la revisión.</div></div>';
  }

  // 03 Pruebas
  let testsHtml='';
  if(tests){
    if(fans.length)testsHtml+='<h3>3.1 · Ventiladores</h3>'+table(['Ventilador','Uso','Responde a la orden','Giro confirmado'],fans.map(function(f){return[esc(f.name.replace('output_pin ','')),esc(f.usage),f.accepted&&num(f.valueOn)>0?'Sí':f.accepted?'Aceptó la orden':'No',f.spinConfirmed?'Sí ('+Math.round(num(f.rpmOn))+' RPM)':'No se puede medir: revisar a ojo'];}));
    if(heat){
      const ph=function(label,s,extra){return s?[esc(label),fixed(s.min,1)+' – '+fixed(s.max,1)+' °C',Math.round(num(s.avgPower)*100)+'%',extra||(s.max-s.min<=3?'Estable':'Variable')]:null;};
      const rows=[
        ['Calentamiento '+(heat.startTemp!=null?Math.round(heat.startTemp):'?')+' → '+Math.min(200,heat.target-20)+' °C',heat.heatToNear200Sec!=null?Math.round(heat.heatToNear200Sec)+' s'+(heat.rateCps?' (≈'+fixed(heat.rateCps,1)+' °C/s)':''):'No alcanzó',heat.avgPowerHeating!=null?Math.round(heat.avgPowerHeating*100)+'%':'—',heat.heatToNear200Sec!=null?'Normal':'Revisar'],
        heat.reachSec!=null?['Llegada a '+heat.target+' °C y sobrepaso',Math.round(heat.reachSec)+' s · máx. '+fixed(heat.overshootMax,1)+' °C ('+(heat.overshoot>=0?'+':'')+fixed(heat.overshoot,1)+')','—',num(heat.overshoot)<=5?'Normal':'Sobrepaso alto']:null,
        ph(heat.target+' °C sin ventiladores',heat.hold),
        ph('+ ventilador de pieza 100%',heat.holdFan),
        ['Errores durante la prueba',esc((heat.errors||[]).join(' · ')||'Ninguno'),'–',heat.aborted?'Interrumpida':'–']
      ].filter(Boolean);
      testsHtml+='<h3>'+(fans.length?'3.2':'3.1')+' · Hotend a '+heat.target+' °C</h3>'+table(['Fase','Temperatura','Potencia media','Lectura'],rows);
      if((heat.series||[]).length>3){
        testsHtml+='<div class="fig">'+lineChart({series:[{label:'Lectura del sensor (°C)',color:TURQ,points:heat.series.map(function(r){return[r[0],r[1]];})},{label:'Objetivo',color:'#999',dash:'4 3',width:1,points:heat.series.map(function(r){return[r[0],r[2]];})},{label:'Potencia del calentador (%)',color:ORANGE,width:1,axis:'right',points:heat.series.map(function(r){return[r[0],r[3]*100];})}],yMin:0,yMax:Math.ceil((heat.target+15)/40)*40,right:{min:0,max:100,unit:'%'},xLabel:'segundos desde el inicio de la prueba'})+'<div class="cap">Figura 1. Prueba de hoy: lectura del hotend (turquesa) y potencia del calentador (naranja).</div></div>';
      }
    }
    if((tests.errors||[]).length)testsHtml+='<p class="muted">Incidencias de la prueba: '+esc(tests.errors.join(' · '))+'</p>';
  }

  // 04 Por qué / causas
  let whyHtml='';
  if(rep.whyItHappened)whyHtml+='<p>'+esc(rep.whyItHappened)+'</p>';
  if((rep.causes||[]).length)whyHtml+='<h3>Otras causas revisadas</h3>'+table(['Posible causa','Resultado','Veredicto'],rep.causes.map(function(r){return[esc(r.cause),esc(r.result),'<b>'+esc(r.verdict)+'</b>'];}));

  // 05 Otros hallazgos
  let otherHtml='';
  if((rep.otherFindings||[]).length)otherHtml='<ul>'+rep.otherFindings.map(function(r){return'<li>'+(r.title?'<b>'+esc(r.title)+'.</b> ':'')+esc(r.detail)+'</li>';}).join('')+'</ul>';
  else if((result.findings||[]).length)otherHtml=table(['Severidad','Área','Hallazgo','Acción'],result.findings.map(function(f){return['<b>'+esc(String(f.severity||'').toUpperCase())+'</b>',esc(f.area),esc(f.finding),esc(f.action)];}));
  if(moon.configfile?.saveConfigPending)otherHtml+='<p class="muted">Hay cambios de configuración pendientes de guardar (SAVE_CONFIG): '+esc(Object.keys(moon.configfile.saveConfigPendingItems||{}).join(', ')||'sin detalle')+'.</p>';

  // 06 Plan
  const plan=(rep.repairPlan||[]).length?rep.repairPlan:(result.recommendedActions||[]);
  const planHtml=plan.length?'<div class="plan"><div class="plan-title">Pasos recomendados</div><ol>'+plan.map(function(x){return'<li>'+esc(x)+'</li>';}).join('')+'</ol></div>':'';

  // 07 Estado final
  let finalHtml=rep.finalState?'<p>'+esc(rep.finalState)+'</p>':'';
  if(!finalHtml&&tests?.finalState){const f=tests.finalState;finalHtml='<p>Hotend '+(f.hotendTarget>0?'con objetivo '+f.hotendTarget+' °C':'apagado')+' ('+fixed(f.hotend,0)+' °C en el último control), cama '+(f.bedTarget>0?'con objetivo '+f.bedTarget+' °C':'apagada')+'. Ventiladores probados en 0. Klipper: '+esc(f.klipper||'sin dato')+'. No se cambió ni guardó ninguna configuración.</p>';}
  if(!finalHtml)finalHtml='<p>Revisión de solo lectura: no se envió ningún comando a la impresora ni se cambió su configuración.</p>';

  // Anexo
  const lim=(result.limitations||[]);
  const annex='<div class="annex">'+(lim.length?'<b>Limitaciones:</b> '+esc(lim.join(' · '))+'<br>':'')+'Auditoría '+esc(saved.id||'')+' · '+esc(saved.model||'')+' · sello '+esc(String(saved.reportHash||'').slice(0,16))+(saved.integrityValid===false?' · ⚠ SELLO INVÁLIDO':'')+'</div>';

  const banner=(sev==='alta'||sev==='media')?'<div class="urgente-strip">▲ Gravedad '+esc(sev)+(rep.banner?' · '+esc(rep.banner):'')+'</div>':'';
  const footLeft='The Lab Solutions SpA · Santiago, Chile\\A hola@thelab.solutions · +56 9 7180 6142';
  const title='Informe_auditoria_'+String(model||'impresora').replace(/[^A-Za-z0-9]+/g,'')+'_'+(ip||saved.machineId);

  return'<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>'+esc(title)+'</title>'+
'<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:"Helvetica Neue",Arial,sans-serif;color:#1a1a1a;background:#fff;padding:18px 24px;font-size:10px;line-height:1.5}'+
'.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:12px;border-bottom:3px solid '+TURQ+'}.logo-area img{height:28px}.logo-area .tagline{font-size:8px;color:#aaa;margin-top:4px;letter-spacing:1.2px;text-transform:uppercase}'+
'.meta{text-align:right}.meta h1{font-size:20px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#0a0a0a}.meta .num{font-size:16px;font-weight:700;color:'+TURQ+';font-family:monospace;margin-top:2px}.meta .fechas{font-size:9px;color:#999;margin-top:4px;line-height:1.6}'+
'.urgente-strip{background:'+ORANGE+';color:#fff;text-align:center;font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:5px;border-radius:5px;margin-bottom:10px}'+
'.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}.info-box{background:#f8f8f8;border-radius:6px;padding:10px 12px;border-top:3px solid '+TURQ+'}.info-box h3{font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;margin-bottom:8px}.info-box table{width:100%;border-collapse:collapse}.info-box td{padding:3px 0;font-size:10px;vertical-align:top}.info-box td.k{color:#888;width:80px}.info-box td.v{font-weight:500}'+
'.section-label{font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;margin:12px 0 5px}'+
'.concl{background:#f8f8f8;border-radius:6px;padding:10px 12px;border-left:4px solid '+TURQ+';font-size:9.5px;color:#333;line-height:1.7}.concl p{margin-bottom:4px}.muted{color:#888;font-style:italic;font-size:9px;margin-top:4px}'+
'table.items{width:100%;border-collapse:collapse;border:1px solid #e8e8e8;margin-top:5px;page-break-inside:auto}table.items tr{page-break-inside:avoid}table.items thead th{background:#0a0a0a;color:#fff;padding:7px 10px;font-size:8px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:left}table.items td{padding:6px 10px;border-bottom:1px solid #e8e8e8;font-size:9.5px;vertical-align:top}table.items tr.even td{background:#f9f9f9}'+
'.sec{margin-top:16px}.sec h2{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:#0a0a0a;margin-bottom:7px;page-break-after:avoid}.sec h2 .sq{width:9px;height:9px;background:'+TURQ+';display:inline-block}.sec h2 .n{color:'+TURQ+';font-family:monospace}.sec h3{page-break-after:avoid;break-after:avoid;font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#555;margin:10px 0 3px}.sec ul,.sec ol{padding-left:16px}.sec li{margin-bottom:3px}.sec p{margin-bottom:5px}'+
'.fig{margin-top:10px;page-break-inside:avoid}.fig .cap{font-size:8.5px;color:#777;margin-top:4px;font-style:italic}'+
'.plan{border:1px solid '+TURQ+';border-left:4px solid '+TURQ+';border-radius:6px;overflow:hidden}.plan-title{background:'+TURQ+';color:#0a0a0a;font-weight:700;text-align:center;padding:5px;letter-spacing:1.5px;text-transform:uppercase;font-size:9px}.plan ol{padding:8px 12px 8px 28px}.plan li{margin-bottom:4px}'+
'.annex{margin-top:16px;font-size:8px;color:#aaa;line-height:1.6}'+
'.footer{margin-top:14px;padding-top:10px;border-top:2px solid #f0f0f0;display:flex;justify-content:space-between;font-size:8px;color:#bbb;line-height:1.7}'+
'@media print{body{padding:0}.footer{display:none}@page{size:A4;margin:14mm 12mm 16mm;@bottom-left{content:"'+footLeft+'";white-space:pre;font:8px Arial,sans-serif;color:#aaa}@bottom-right{content:"Informe '+numero+' · Página " counter(page);font:8px Arial,sans-serif;color:#aaa}@top-right{content:"INFORME TÉCNICO   '+numero+'";font:bold 8px Arial,sans-serif;color:'+TURQ+';letter-spacing:1px}}@page:first{@top-right{content:none}}}'+
'</style></head><body>'+
'<div class="header"><div class="logo-area"><img src="'+esc(logo)+'" onerror="this.style.display=\'none\'"><div class="tagline">Impresión 3D · Neones · Trofeos</div></div><div class="meta"><h1>Informe técnico</h1><div class="num">'+esc(numero)+'</div><div class="fechas">Emitido: <strong>'+esc(fecha)+'</strong><br>Equipo: <strong>'+esc([model,ip].filter(Boolean).join(' · '))+'</strong></div></div></div>'+
banner+
'<div class="info-grid"><div class="info-box"><h3>Equipo auditado</h3><table>'+infoRow('Modelo',model)+infoRow('Nombre',name)+infoRow('IP',ip)+infoRow('Software',[sw?'Klipper '+sw:'',api?'Moonraker '+api:''].filter(Boolean).join(' · '))+infoRow('Problema',problem||'Revisión preventiva')+'</table></div>'+
'<div class="info-box"><h3>The Lab Solutions</h3><table>'+infoRow('Web','thelab.solutions')+infoRow('Teléfono','+56 9 7180 6142')+infoRow('Email','hola@thelab.solutions')+infoRow('Dirección','Zaragoza 8882, Las Condes')+infoRow('Ciudad','Santiago, Chile')+'</table></div></div>'+
'<div class="section-label">Conclusión</div><div class="concl">'+conclusion+'</div>'+
'<div class="section-label">Resumen de resultados</div>'+table(['Indicador','Resultado'],summaryRows)+
section('Alcance y método',scopeHtml)+
section('Hallazgos en los logs',logsHtml)+
section('Pruebas realizadas hoy',testsHtml)+
section('Por qué ocurrió',whyHtml)+
section('Otros hallazgos',otherHtml)+
section('Plan de reparación',planHtml)+
section('Estado en que quedó la impresora',finalHtml)+
annex+
'<div class="footer"><div>The Lab Solutions SpA · Santiago, Chile<br>hola@thelab.solutions · +56 9 7180 6142</div><div>Informe '+esc(numero)+'</div></div>'+
'</body></html>';
}
function openPdf(saved,win){
  if(!saved){note('Informe no disponible','error');return false;}
  const html=buildDoc(saved).replace('</body></html>','<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},300);};<\/script></body></html>');
  const blob=new Blob([html],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(blob);
  const w=win||window.open(url,'_blank');
  if(!w){note('Permite ventanas emergentes para descargar el PDF','error');URL.revokeObjectURL(url);return false;}
  if(win)w.location.href=url;
  setTimeout(function(){URL.revokeObjectURL(url);},60000);
  return true;
}

window.MachineReport={open,close,run,cancel,pdfFromHistory,openPdf,buildDoc,
  _test:{fanCommands,fanReading,partFanOf,testEligibility,reportNumber,severityOf,lineChart}};
})();
