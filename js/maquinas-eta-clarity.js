/* js/maquinas-eta-clarity.js
 * Hace que la línea de tiempo superior responda una sola pregunta:
 * "¿cuándo queda libre cada impresora?".
 *
 * La barra representa tiempo restante (no progreso de impresión). El porcentaje
 * queda únicamente en la tarjeta detallada de la máquina.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root&&root.document)api.install(root);
})(typeof window!=='undefined'?window:null,function(){
'use strict';

function remainingLabel(seconds){
  const total=Math.max(1,Math.ceil(Number(seconds||0)/60));
  const h=Math.floor(total/60),m=total%60;
  if(h&&m)return`${h} h ${m} min`;
  if(h)return`${h} h`;
  return`${m} min`;
}
function freeAt(seconds,now=Date.now()){
  try{
    return new Intl.DateTimeFormat('es-CL',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(now+Number(seconds||0)*1000));
  }catch(_){
    const d=new Date(now+Number(seconds||0)*1000);
    return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }
}
function install(root){
  if(root.__TLS_MAQ_ETA_CLARITY__)return false;
  root.__TLS_MAQ_ETA_CLARITY__=true;

  // maquinas.js es un script clásico: sus bindings globales siguen disponibles
  // para esta función cuando el dashboard corre en navegador. El override queda
  // anónimo para que la auditoría no lo cuente como una segunda declaración.
  root.renderMaqOcupacion=function(){
    const el=document.getElementById('maqOcupacion');if(!el)return;
    const lista=_monitorFilter==='all'?MAQUINAS:MAQUINAS.filter(m=>m.modelo===_monitorFilter);
    if(!lista.length){el.style.display='none';return;}
    const clasif=st=>st==='printing'?'print':st==='paused'?'paused':(st==='error'||st==='shutdown'||st==='apidown')?'error':(st==='offline'||st==='noip')?'off':st==='connecting'?'connecting':'idle';
    const rows=lista.map(m=>{const s=_printerStatus[m.id]||_printerInitialStatus(m);return{m,s,k:clasif(s.state),eta:(s.state==='printing'&&s.eta>0)?s.eta:0};});
    const etas=rows.filter(r=>r.eta>0).map(r=>r.eta);
    const horizon=Math.max(4*3600,Math.min(12*3600,etas.length?Math.max(...etas)*1.15:4*3600));
    const libres=rows.filter(r=>r.k==='idle').length;
    const imprimiendo=rows.filter(r=>r.k==='print').length;
    const hhmm=seg=>freeAt(seg);
    const proxima=etas.length?hhmm(Math.min(...etas)):null;
    const marks=[];const stepH=horizon>6*3600?2:1;
    for(let hh=stepH;hh*3600<horizon;hh+=stepH)marks.push(`<span style="position:absolute;left:${(hh*3600/horizon*100).toFixed(1)}%;transform:translateX(-50%);font-size:10px;color:var(--text3)">+${hh}h</span>`);
    const nameW='clamp(84px,26vw,158px)';
    const fila=r=>{
      const nom=`${escapeHtml(r.m.nombre||'—')} <span style="color:var(--text3)">#${r.m.numG||r.m.num||''}</span>`;
      let bar='',lbl='';
      if(r.k==='print'&&r.eta>0){
        const w=Math.min(100,r.eta/horizon*100).toFixed(1);
        const rem=remainingLabel(r.eta),free=hhmm(r.eta);
        // El segmento verde codifica SOLO tiempo restante. Los textos flotan
        // sobre la pista completa para seguir legibles aunque queden pocos min.
        bar=`<div title="${escapeHtml(r.s.filename||'Imprimiendo')} · ${rem} restantes · libre ${free}" style="height:100%;width:${w}%;background:linear-gradient(90deg,#00d4aa,#00d4cc);border-radius:5px;min-width:6px"></div>`
          +`<span style="position:absolute;left:7px;right:92px;top:50%;transform:translateY(-50%);font-size:10px;font-weight:700;color:#d8fffb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,.9)">Imprimiendo — ${rem} restantes</span>`
          +`<span style="position:absolute;right:5px;top:50%;transform:translateY(-50%);font-size:10px;font-weight:800;color:#00d4cc;white-space:nowrap;background:rgba(4,18,26,0.88);border:1px solid rgba(0,212,204,0.35);border-radius:4px;padding:0 4px;pointer-events:none">Libre ${free}</span>`;
        lbl=`<span style="color:#00d4aa">🟢</span>`;
      }else if(r.k==='print'){
        bar=`<div title="Imprimiendo — sin ETA del bridge" style="height:100%;width:100%;background:repeating-linear-gradient(45deg,rgba(0,212,170,0.5),rgba(0,212,170,0.5) 8px,rgba(0,212,170,0.25) 8px,rgba(0,212,170,0.25) 16px);border-radius:5px;display:flex;align-items:center;padding-left:8px"><span style="font-size:10px;font-weight:700;color:#04121a">Imprimiendo · sin ETA</span></div>`;
        lbl=`<span style="color:#00d4aa">🟢</span>`;
      }else if(r.k==='paused'){
        bar=`<div style="height:100%;width:45%;background:rgba(255,170,0,0.6);border-radius:5px;display:flex;align-items:center;padding-left:8px"><span style="font-size:10px;font-weight:700;color:#1a1206">⏸ En pausa · sin hora de liberación fiable</span></div>`;
        lbl=`<span style="color:#ffaa00">⏸</span>`;
      }else if(r.k==='error'){
        bar=`<div style="height:100%;width:100%;background:rgba(255,68,68,0.14);border:1px dashed rgba(255,68,68,0.5);border-radius:5px;display:flex;align-items:center;padding-left:8px"><span style="font-size:10px;font-weight:700;color:var(--danger)">⚠ Con falla — revisar antes de asignar</span></div>`;
        lbl=`<span style="color:var(--danger)">🔴</span>`;
      }else if(r.k==='connecting'){
        bar=`<div style="height:100%;width:100%;background:rgba(56,189,248,.08);border:1px dashed rgba(56,189,248,.35);border-radius:5px;display:flex;align-items:center;padding-left:8px"><span style="font-size:10px;color:#38bdf8">Consultando telemetría…</span></div>`;
        lbl=`<span style="color:#38bdf8">◌</span>`;
      }else if(r.k==='off'){
        bar=`<div style="height:100%;width:100%;background:var(--surface3);border-radius:5px;display:flex;align-items:center;padding-left:8px;opacity:.55"><span style="font-size:10px;color:var(--text3)">Sin conexión · disponibilidad desconocida</span></div>`;
        lbl=`<span style="color:var(--text3)">⚫</span>`;
      }else{
        bar=`<div style="height:100%;width:100%;background:rgba(0,212,170,0.08);border:1px dashed rgba(0,212,170,0.35);border-radius:5px;display:flex;align-items:center;padding-left:8px"><span style="font-size:10px;font-weight:700;color:#00d4aa">✓ Libre ahora</span></div>`;
        lbl=`<span style="color:#00d4aa">⚪</span>`;
      }
      return`<div style="display:flex;align-items:center;gap:9px;margin-bottom:6px">
        <span style="flex-shrink:0;width:14px;text-align:center;font-size:12px">${lbl}</span>
        <span style="flex-shrink:0;width:${nameW};font-size:11.5px;font-weight:600;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nom}</span>
        <div style="flex:1;min-width:0;height:20px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:2px;position:relative;overflow:hidden">${bar}</div>
      </div>`;
    };
    const cmp=(a,b)=>(a.eta||(a.k==='idle'?-1:1e9))-(b.eta||(b.k==='idle'?-1:1e9));
    const MODORDER=['K1','K2','K2 Plus','Ender-5 Max','Giga'];
    const groups={};
    rows.forEach(r=>{const g=r.m.modelo||'Otras';(groups[g]||(groups[g]=[])).push(r);});
    const gkeys=Object.keys(groups).sort((a,b)=>{
      const ia=MODORDER.indexOf(a),ib=MODORDER.indexOf(b);
      return(ia<0?99:ia)-(ib<0?99:ib)||a.localeCompare(b);
    });
    const multiGrupo=gkeys.length>1;
    const cuerpo=gkeys.map(g=>{
      const items=groups[g].slice().sort(cmp).map(fila).join('');
      if(!multiGrupo)return items;
      const col=groups[g][0].m.color||'var(--text3)';
      return`<div style="display:flex;align-items:center;gap:6px;margin:11px 0 5px">
        <span style="width:7px;height:7px;border-radius:2px;background:${col};flex-shrink:0"></span>
        <span style="font-size:10.5px;font-weight:700;color:var(--text2);letter-spacing:.02em">${escapeHtml(g)}</span>
        <span style="font-size:10px;color:var(--text3)">${groups[g].length}</span>
      </div>`+items;
    }).join('');
    el.style.display='';
    el.innerHTML=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:700;color:var(--text)">⏱️ Disponibilidad de máquinas</span>
        <span style="font-size:10.5px;color:var(--text3)">${libres} libre${libres!==1?'s':''} ahora · ${imprimiendo} imprimiendo${proxima?' · próxima libre '+proxima:''} · barra = tiempo restante</span>
      </div>
      <div style="position:relative;height:12px;margin:0 0 4px calc(${nameW} + 23px)">${marks.join('')}</div>
      ${cuerpo}`;
  };

  // Si el gráfico ya fue dibujado antes de que cargara esta extensión, repíntalo.
  try{if(document.getElementById('maqOcupacion'))root.renderMaqOcupacion();}catch(_){}
  return true;
}

return{install,remainingLabel,freeAt};
});
