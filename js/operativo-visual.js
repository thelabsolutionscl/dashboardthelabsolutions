/* Presentación operativa: usa registros existentes, sin llamadas IA ni escrituras CRM. */
(function(global){
  'use strict';
  const views=['overview','pedidos','cotizaciones','finanzas','clientes','maquinas','web','calendario','redes','reporte','equipo','newsletter'];
  const simpleOnlyViews=new Set(['overview','calendario']);
  const closed=['Despachado','Completado','Cancelado'];
  const stages=['Confirmado','En producción','Listo para despacho','Despachado','Completado'];
  const ui={cot:'all',search:'',aging:'all',limit:24,returnFocus:null};
  const $=id=>document.getElementById(id);
  const detailState=new Map();
  const allowed=page=>typeof AUTH!=='undefined'&&typeof RBAC!=='undefined'&&(RBAC.tabs[AUTH.getUser()?.role]||[]).includes(page);
  const esc=v=>escapeHtml(String(v??''));
  const money=v=>v==null||v===''||!Number.isFinite(Number(v))?'Sin dato':formatCLP(Math.round(Number(v)));
  const own=rows=>(typeof isVendorMode==='function'&&isVendorMode())?(rows||[]).filter(vendorOwnsRecord):(rows||[]);
  const button=(label,action,arg='',kind='')=>`<button type="button" class="op-button ${kind}" data-op="${action}" data-arg="${esc(arg)}">${esc(label)}</button>`;
  const pill=(text,tone='neutral')=>`<span class="op-pill op-${tone}">${esc(text)}</span>`;
  const metric=(label,value,detail,action,arg)=>`<${action?'button type="button"':'div'} class="op-metric"${action?` data-op="${action}" data-arg="${esc(arg||'')}"`:''}><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(detail||'')}</small></${action?'button':'div'}>`;
  function day(value){
    const s=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
    const n=Date.parse(s+'T12:00:00Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===s?Math.floor(n/86400000):null;
  }
  function today(){return day(typeof hoyCL==='function'?hoyCL():new Date().toISOString());}
  function until(value){const d=day(value);return d===null?null:d-today();}
  function dateText(value){const n=until(value);return n===null?'Sin fecha':n<0?`${Math.abs(n)} días de atraso`:n===0?'Hoy':n===1?'Mañana':`En ${n} días`;}
  function mode(page,value){
    const el=$('tab-'+page);if(!el)return;
    // OVERVIEW y CALENDARIO tienen una sola presentación canónica: Simple.
    // En ambas, Experto duplicaba la misma interfaz sin aportar información útil.
    value=simpleOnlyViews.has(page)?'simple':(value==='expert'?'expert':'simple');el.dataset.opView=value;
    el.querySelectorAll('.op-revealed').forEach(n=>closeDetail(n.id,false));
    el.querySelectorAll('.op-detail-close').forEach(n=>n.remove());
    el.querySelectorAll('details.op-disclosure,details.op-post-actions').forEach(n=>{n.open=value==='expert';});
    el.querySelectorAll('details.op-telemetry').forEach(n=>{n.open=true;});
    el.querySelectorAll('[data-op="mode"]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.arg===page+':'+value)));
    try{localStorage.setItem('op_view_'+page,value);}catch(e){}
    if(page==='finanzas'&&value==='expert'&&typeof finDrawChart==='function')requestAnimationFrame(()=>finDrawChart());
  }
  function mount(){
    views.forEach(page=>{
      const el=$('tab-'+page),header=el?.querySelector('.section-header');if(!header||el.dataset.opReady)return;
      el.dataset.opReady='1';
      if(simpleOnlyViews.has(page)){
        header.querySelector?.('.op-switch')?.remove?.();
        mode(page,'simple');
      }else{
        header.insertAdjacentHTML('beforeend',`<div class="op-switch" role="group" aria-label="Presentación de ${esc(page)}">${button('Simple','mode',page+':simple')}${button('Experto','mode',page+':expert')}</div>`);
        let value='simple';try{value=localStorage.getItem('op_view_'+page)||value;}catch(e){}mode(page,value);
      }
      if(page==='pedidos'&&typeof setPedidosView==='function'){
        let value='simple';try{value=localStorage.getItem('op_view_'+page)||value;}catch(e){}

        let layout=value==='expert'?'tabla':'tarjetas';
        try{layout=localStorage.getItem('op_layout_pedidos')||layout;}catch(e){}
        setPedidosView(layout,{persist:false});
      }
    });
  }
  // Despliega la acción solicitada sin convertirla en una preferencia permanente.
  function closeDetail(id,restoreFocus=true){
    const node=$(id),saved=detailState.get(id);
    node?.classList.remove('op-revealed');
    node?.querySelectorAll('.op-revealed').forEach(n=>n.classList.remove('op-revealed'));
    if(saved){saved.opened.forEach(n=>{n.open=false;});detailState.delete(id);
      if(saved.layout&&$('tab-pedidos')?.dataset.opLayout==='tabla'&&typeof setPedidosView==='function')setPedidosView(saved.layout,{persist:false});
      if(restoreFocus)saved.trigger?.focus?.();}
    const close=node?.previousElementSibling;if(close?.classList.contains('op-detail-close'))close.remove();
  }
  function reveal(id){
    const node=$(id),panel=node?.closest('.tab-panel');if(!node||!panel)return;
    let top=node;while(top.parentElement&&top.parentElement!==panel&&!top.parentElement.id.startsWith('fin-panel-'))top=top.parentElement;
    if(!top.id)top.id='opDetail-'+id;
    const saved=detailState.get(top.id)||{trigger:document.activeElement,opened:[]};
    for(let n=node;n&&n!==panel;n=n.parentElement){
      if(n.matches?.('details')&&!n.open){n.open=true;saved.opened.push(n);}
    }
    detailState.set(top.id,saved);top.classList.add('op-revealed');
    // Las reglas de Simple pueden ocultar también el destino dentro del contenedor.
    if(node!==top){node.classList.add('op-revealed');}
    if(!top.previousElementSibling?.classList.contains('op-detail-close'))top.insertAdjacentHTML('beforebegin',button('Cerrar detalle','close-detail',top.id,'op-detail-close op-simple'));
    node.scrollIntoView({block:'center'});
  }
  function payment(p){
    const f=p.fields||{},total=Number(f['Monto total (CLP)']);
    const amountKnown=f['Monto total (CLP)']!=null&&f['Monto total (CLP)']!==''&&Number.isFinite(total)&&total>=0;
    const a=!!f['Anticipo pagado (50%)'],s=!!f['Saldo pagado (50%)'];
    const explicit=f['Monto abono (CLP)']!=null&&f['Monto abono (CLP)']!==''&&Number.isFinite(Number(f['Monto abono (CLP)']));
    const paid=a&&s?total:(a?(explicit?Number(f['Monto abono (CLP)']):total*.5):0)+(s?total*.5:0);
    const remaining=amountKnown?Math.max(0,total-paid):null;
    const estimated=amountKnown&&!(a&&s)&&((a&&!explicit)||s);
    const form=typeof pedFormaPago==='function'?pedFormaPago(f):(f['Forma de pago']||'');
    return {remaining,estimated,form,label:a&&s?'Pagado':a||s?'Pago parcial':'Pendiente',tone:a&&s?'good':'neutral'};
  }
  function paymentControls(p){
    const f=p.fields||{},a=!!f['Anticipo pagado (50%)'],s=!!f['Saldo pagado (50%)'],t=a&&s;
    const form=typeof pedFormaPago==='function'?pedFormaPago(f):(f['Forma de pago']||'');
    const d30=/^30 D[ÍI]AS DESDE OC$/i.test(String(form||'').trim());
    const monto=f['Monto abono (CLP)'];
    const labelAbono=a&&monto?`✓ Abono ${money(monto)}`:a?'✓ Abono':'Abono';
    return `<div class="op-payment-quick" aria-label="Cambiar estado de pago">
      <span class="op-payment-quick-label">Cambiar pago</span>
      ${button(labelAbono,'order-pay-abono',p.id,a?'op-pay-active':'')}
      ${button(s?'✓ Saldo':'Saldo','order-pay-saldo',p.id,s?'op-pay-active':'')}
      ${button(t?'✓ Total':'Total','order-pay-total',p.id,t?'op-pay-active':'')}
      ${button(d30?'✓ Pago a 30 días':'Pago a 30 días','order-pay-30',p.id,d30?'op-pay-active':'')}
    </div>`;
  }
  function orderPaymentDropdown(p){
    const f=p.fields||{},pay=payment(p);
    const a=!!f['Anticipo pagado (50%)'],s=!!f['Saldo pagado (50%)'],t=a&&s;
    const form=typeof pedFormaPago==='function'?pedFormaPago(f):(f['Forma de pago']||'');
    const d30=/^30 D[ÍI]AS DESDE OC$/i.test(String(form||'').trim());
    const monto=f['Monto abono (CLP)'];
    const abonoLabel=a&&monto?`✓ Abono ${money(monto)}`:a?'✓ Abono':'Abono';
    return `<details class="op-payment-dropdown">
      <summary class="op-payment-summary op-payment-${pay.tone==='good'?'good':pay.label==='Pago parcial'?'partial':'pending'}" title="Cambiar estado de pago">${esc(pay.label)}<span aria-hidden="true">▾</span></summary>
      <div class="op-payment-menu" role="menu" aria-label="Cambiar estado de pago">
        <button type="button" class="${a?'is-active':''}" data-op="card-pay-abono" data-arg="${p.id}">${abonoLabel}</button>
        <button type="button" class="${s?'is-active':''}" data-op="card-pay-saldo" data-arg="${p.id}">${s?'✓ Saldo':'Saldo'}</button>
        <button type="button" class="${t?'is-active':''}" data-op="card-pay-total" data-arg="${p.id}">${t?'✓ Total':'Total'}</button>
        <button type="button" class="${d30?'is-active':''}" data-op="card-pay-30" data-arg="${p.id}">${d30?'✓ Pago a 30 días':'Pago a 30 días'}</button>
      </div>
    </details>`;
  }
  function marginColor(value){
    const n=Number(value);
    if(!Number.isFinite(n))return '';
    const p=Math.max(0,Math.min(100,n));
    const shade=(start,end,h1,h2,sat,l1,l2)=>{
      const t=end===start?1:Math.max(0,Math.min(1,(p-start)/(end-start)));
      const hue=Math.round(h1+(h2-h1)*t);
      const light=Math.round(l1+(l2-l1)*t);
      return `hsl(${hue} ${sat}% ${light}%)`;
    };
    // Rangos visuales con degradé dentro de cada familia:
    // <25 azul · 25–40 verde · 40–55 naranjo · >55 rojo.
    if(p<25)return shade(0,25,215,200,88,68,56);
    if(p<40)return shade(25,40,145,115,78,60,52);
    if(p<=55)return shade(40,55,38,22,95,62,55);
    return shade(55,100,4,0,90,61,50);
  }
  function quoteStateActions(c){
    const q=quoteInfo(c),e=q.e,id=c.id,parts=[];
    if(['Solicitada','Enviada','Negociación'].includes(e)){
      if(e==='Solicitada')parts.push(button('Marcar enviada','quote-status',`${id}::Enviada`));
      if(e==='Enviada')parts.push(button('Pasar a negociación','quote-status',`${id}::Negociación`));
      parts.push(button('Aprobar cotización','quote-status',`${id}::Aprobada`,'op-primary'));
      parts.push(button('Rechazar cotización','quote-status',`${id}::Rechazada`,'op-danger-action'));
    }else if(e==='Rechazada'||e==='Vencida'){
      parts.push(button('Reactivar como enviada','quote-status',`${id}::Enviada`,'op-primary'));
    }else if(e==='Aprobada'){
      if(q.linkedOrder)parts.push(button('Ver pedido vinculado','quote-linked-order',q.linkedOrder.id,'op-primary'));
      else parts.push(button('Crear pedido pendiente','quote-order',id,'op-primary'));
    }
    if(!parts.length)return '';
    return `<div class="op-quote-state-actions"><div class="op-quote-state-head"><span>Acciones de estado</span><small>${esc(e)}</small></div><div class="op-quote-state-buttons">${parts.join('')}</div></div>`;
  }
  function quoteInfo(c){
    const f=c.fields,e=f['Estado cotización']||'Sin estado';
    const expires=until(f['Fecha vencimiento']),age=until(f['Fecha cotización']);
    const awaiting=e==='Enviada',pending=e==='Solicitada';
    const linkedOrder=e==='Aprobada'&&typeof _pedidoDeCot==='function'?_pedidoDeCot(c):undefined;
    let next=pending?'Preparar y enviar propuesta':awaiting?'Revisar seguimiento':e==='Aprobada'?(linkedOrder===null?'Crear pedido pendiente':'Revisar pedido vinculado'):e==='Negociación'?'Revisar condiciones':'Revisar historial';
    if(awaiting&&expires!==null&&expires<0)next='Revisar propuesta vencida';
    return {e,expires,age,awaiting,pending,next,linkedOrder};
  }
  function filterQuotes(rows){
    return rows.filter(c=>{
      const q=quoteInfo(c),f=c.fields;
      const match=ui.cot==='all'||ui.cot==='open'&&(q.pending||q.awaiting)||ui.cot==='pending'&&q.pending||ui.cot==='awaiting'&&q.awaiting||ui.cot==='expiring'&&q.awaiting&&q.expires!==null&&q.expires>=0&&q.expires<=3;
      const text=[f['N° Cotización'],f['Alias / Título'],resolveClienteName(f['Cliente'])].join(' ').toLocaleLowerCase('es');
      return match&&(!ui.search||text.includes(ui.search.toLocaleLowerCase('es')));
    });
  }
  function stepper(e){const current=stages.indexOf(e);return `<ol class="op-stages" aria-label="Etapas de producción">${stages.map((s,i)=>`<li class="${current>=i?'is-done':''}"${i===current?' aria-current="step"':''}><span>${esc(s)}</span></li>`).join('')}</ol>`;}
  function nextOrderStage(p){
    const raw=String(p?.fields?.['Estado pedido']||'').trim();
    const i=stages.findIndex(s=>s.toLocaleLowerCase('es')===raw.toLocaleLowerCase('es'));
    return i>=0&&i<stages.length-1?stages[i+1]:null;
  }
  function orderTeamControls(p){
    let people=[];try{people=(typeof PERSONAS!=='undefined'&&Array.isArray(PERSONAS))?PERSONAS:[];}catch(_){}
    if(!people.length)return '';
    const selected=new Set(String(p?.fields?.['Equipo asignado']||'').split(',').map(x=>x.trim()).filter(Boolean));
    const chips=people.map(person=>{
      const name=String(person?.nombre||person?.name||person?.id||'').trim();if(!name)return '';
      const on=selected.has(name),short=name.split(/\s+/)[0]||name;
      return `<button type="button" class="op-team-chip${on?' is-selected':''}" data-persona="${esc(name)}" aria-pressed="${on?'true':'false'}" title="${on?'Quitar':'Asignar'} a ${esc(name)}" onclick="event.stopPropagation();toggleEquipoPedidoCard('${p.id}',this.dataset.persona,event)">${on?'✓ ':''}${esc(short)}</button>`;
    }).join('');
    return `<div class="op-card-control"><div class="op-card-control-head"><span>Equipo</span><small>clic para asignar</small></div><div class="op-team-chips">${chips}</div></div>`;
  }
  function orderStateTone(state){
    return state==='Confirmado'?'confirmed':state==='En producción'?'production':state==='Listo para despacho'?'ready':state==='Despachado'?'dispatched':state==='Completado'?'completed':'neutral';
  }
  function quoteMoneyRaw(v){
    if(v==null||v==='')return null;
    if(typeof v==='number')return Number.isFinite(v)?v:null;
    const s=String(v).replace(/\./g,'').replace(/,/g,'.').replace(/[^0-9.-]/g,'');
    const n=Number(s);return Number.isFinite(n)?n:null;
  }
  function quoteWorkItems(c){
    const f=c?.fields||{};
    let items=[];
    const rawJson=f['Detalle JSON'];
    if(rawJson){
      try{
        const parsed=typeof rawJson==='string'?JSON.parse(rawJson):rawJson;
        if(Array.isArray(parsed))items=parsed.map(it=>{
          const qty=quoteMoneyRaw(it?.und??it?.cantidad??it?.qty??'');
          const costUnit=quoteMoneyRaw(it?.costoUnit??it?.costo_unit??it?.costo??null);
          const saleUnit=quoteMoneyRaw(it?.ventaUnit??it?.venta_unit??it?.venta??null);
          const costTotal=quoteMoneyRaw(it?.costoTotal??it?.costo_total??null)??(qty!=null&&costUnit!=null?qty*costUnit:null);
          const saleTotal=quoteMoneyRaw(it?.ventaTotal??it?.venta_total??null)??(qty!=null&&saleUnit!=null?qty*saleUnit:null);
          const margin=saleTotal!=null&&saleTotal>0&&costTotal!=null?(saleTotal-costTotal)/saleTotal*100:null;
          return {desc:String(it?.desc||it?.descripcion||it?.nombre||'').trim(),qty,costUnit,saleUnit,costTotal,saleTotal,margin};
        }).filter(it=>it.desc);
      }catch(e){}
    }
    if(!items.length){
      const detalle=String(f['Detalle productos']||'');
      items=detalle.split('\n').map(line=>{
        const parts=line.split('|').map(s=>s.trim());
        const desc=parts[0]||'';
        const qtyMatch=(parts[1]||'').match(/-?\d+(?:[.,]\d+)?/);
        const qty=qtyMatch?quoteMoneyRaw(qtyMatch[0]):null;
        const costPart=parts.find(p=>/^costo\s*:/i.test(p))||parts[2]||'';
        const salePart=parts.find(p=>/^venta\s*:/i.test(p))||parts[3]||'';
        const costTotal=quoteMoneyRaw(costPart.replace(/^costo\s*:/i,''));
        const saleTotal=quoteMoneyRaw(salePart.replace(/^venta\s*:/i,''));
        const costUnit=qty&&costTotal!=null?costTotal/qty:null;
        const saleUnit=qty&&saleTotal!=null?saleTotal/qty:null;
        const margin=saleTotal!=null&&saleTotal>0&&costTotal!=null?(saleTotal-costTotal)/saleTotal*100:null;
        return {desc,qty,costUnit,saleUnit,costTotal,saleTotal,margin};
      }).filter(it=>it.desc);
    }
    return items;
  }
  function quoteWorkDetail(c){
    const f=c?.fields||{},items=quoteWorkItems(c);
    const quoteNum=f['N° Cotización']||'';
    const totalIva=quoteMoneyRaw(f['Total final (CLP)']);
    const neto=totalIva!=null?Math.round(totalIva/1.19):null;
    const iva=totalIva!=null&&neto!=null?totalIva-neto:null;
    const itemsCost=items.reduce((s,it)=>s+(it.costTotal||0),0);
    const itemsSale=items.reduce((s,it)=>s+(it.saleTotal||0),0);
    const costoTotal=items.some(it=>it.costTotal!=null)?itemsCost:quoteMoneyRaw(f['Subtotal (CLP)']);
    const ventaAntesDesc=items.some(it=>it.saleTotal!=null)?itemsSale:null;
    const descPct=quoteMoneyRaw(f['Descuento (%)'])||0;
    const descMonto=ventaAntesDesc!=null&&neto!=null?Math.max(0,ventaAntesDesc-neto):null;
    let margenGlobal=null;try{margenGlobal=typeof getMargenCot==='function'?getMargenCot(f):null;}catch(e){}
    const fmt=v=>v==null?'—':money(v);
    const pct=v=>v==null||!Number.isFinite(Number(v))?'—':Number(v).toFixed(1).replace('.0','')+'%';
    const rows=items.length?items.map(it=>{
      const qty=it.qty==null?'—':(Number.isInteger(it.qty)?String(it.qty):String(it.qty).replace('.',','));
      const marginColorValue=it.margin==null?'':marginColor(it.margin);
      return `<div class='op-quote-edit-row'><div class='op-q-desc' data-label='Descripción'>${esc(it.desc)}</div><div data-label='Und.'>${esc(qty)}</div><div data-label='Costo unit.'>${fmt(it.costUnit)}</div><div data-label='Venta unit.'>${fmt(it.saleUnit)}</div><div data-label='Costo total'>${fmt(it.costTotal)}</div><div data-label='Venta total'>${fmt(it.saleTotal)}</div><div class='op-q-margin' data-label='Margen' style='${marginColorValue?`--op-q-margin:${marginColorValue}`:''}'>${pct(it.margin)}</div></div>`;
    }).join(''):`<div class='op-work-empty'>Sin detalle de productos registrado en esta cotización.</div>`;
    const plazo=f['Fecha de entrega']||((f['Tiempo de producción']||f['Tiempo de producción máx'])?[f['Tiempo de producción'],f['Tiempo de producción máx']].filter(Boolean).join('–')+' '+String(f['Tipo días producción']||'días').toLowerCase():'—');
    const discountText=descPct?`${pct(descPct)}${descMonto!=null&&descMonto>0?` · −${fmt(descMonto)}`:''}`:'Sin descuento';
    return `<section class='op-work-detail op-quote-work-detail op-quote-editlike' aria-label='Detalle de la cotización'>
      <div class='op-work-head'><div><span class='op-eyebrow'>DETALLE DE LA COTIZACIÓN</span><h4>Ítems cotizados</h4></div><small>${esc(quoteNum?`Cotización ${quoteNum}`:'Cotización')}</small></div>
      <div class='op-quote-edit-table'><div class='op-quote-edit-row op-quote-edit-head'><div>Descripción</div><div>Und.</div><div>Costo unit.</div><div>Venta unit.</div><div>Costo total</div><div>Venta total</div><div>Margen</div></div>${rows}</div>
      <div class='op-quote-edit-totals'>
        <div><span>Costo total</span><b>${fmt(costoTotal)}</b></div>
        <div><span>Venta neta</span><b>${fmt(ventaAntesDesc)}</b></div>
        <div><span>Descuento</span><b>${discountText}</b></div>
        <div><span>Neto</span><b>${fmt(neto)}</b></div>
        <div><span>IVA 19%</span><b>${fmt(iva)}</b></div>
        <div class='is-total'><span>Total con IVA</span><b>${fmt(totalIva)}</b></div>
        <div class='op-q-global-margin' style='${margenGlobal!=null?`--op-q-margin:${marginColor(margenGlobal)}`:''}'><span>Margen</span><b>${pct(margenGlobal)}</b></div>
      </div>
      <div class='op-quote-edit-meta'>
        <div><span>Forma de pago</span><b>${esc(f['Forma de pago']||'—')}</b></div>
        <div><span>Fecha cotización</span><b>${esc(f['Fecha cotización']||'—')}</b></div>
        <div><span>Vencimiento</span><b>${esc(f['Fecha vencimiento']||'—')}</b></div>
        <div><span>Entrega / plazo</span><b>${esc(plazo)}</b></div>
        <div><span>Urgencia</span><b>${f['Urgencia (+25%)']?'Sí':'No'}</b></div>
      </div>
    </section>`;
  }
  function orderWorkItems(p){
    const f=p?.fields||{};
    const cotId=Array.isArray(f['Cotizaciones'])?f['Cotizaciones'][0]:f['Cotizaciones'];
    const cot=cotId?state.cotizacionesById?.[cotId]:null;
    const source=cot?.fields||f;
    const quoteNum=cot?.fields?.['N° Cotización']||'';
    let items=[];
    const rawJson=source['Detalle JSON'];
    if(rawJson){
      try{
        const parsed=typeof rawJson==='string'?JSON.parse(rawJson):rawJson;
        if(Array.isArray(parsed))items=parsed.map(it=>({
          desc:String(it?.desc||it?.descripcion||it?.nombre||'').trim(),
          qty:it?.und??it?.cantidad??it?.qty??''
        })).filter(it=>it.desc);
      }catch(e){}
    }
    if(!items.length){
      const detalle=String(source['Detalle productos']||'');
      items=detalle.split('\n').map(line=>{
        const parts=line.split('|').map(s=>s.trim());
        const desc=parts[0]||'';
        const qtyRaw=parts[1]||'';
        const qtyMatch=qtyRaw.match(/-?\d+(?:[.,]\d+)?/);
        return {desc,qty:qtyMatch?qtyMatch[0].replace(',','.'):(qtyRaw||'')};
      }).filter(it=>it.desc);
    }
    return {items,quoteNum,linked:!!cot};
  }
  function orderWorkDetail(p){
    const data=orderWorkItems(p);
    const sourceLabel=data.quoteNum?`Cotización ${data.quoteNum}`:(data.linked?'Cotización asociada':'Pedido');
    const rows=data.items.length?data.items.map(it=>{
      const raw=String(it.qty??'').trim();
      const numeric=raw!==''?Number(raw.replace(',','.')):NaN;
      const qty=Number.isFinite(numeric)?(Number.isInteger(numeric)?String(numeric):String(numeric).replace('.',',')):raw;
      const unitLabel=qty?`${qty} ${numeric===1?'unidad':'unidades'}`:'Cantidad sin registrar';
      return `<div class='op-work-item'><div><span>${esc(it.desc)}</span></div><b>${esc(unitLabel)}</b></div>`;
    }).join(''):`<div class='op-work-empty'>Sin detalle de productos o unidades en la cotización asociada.</div>`;
    return `<section class='op-work-detail' aria-label='Detalle del trabajo'><div class='op-work-head'><div><span class='op-eyebrow'>DETALLE DEL TRABAJO</span><h4>Qué se está haciendo</h4></div><small>${esc(sourceLabel)}</small></div><div class='op-work-list'>${rows}</div></section>`;
  }
  function orderStatusDropdown(p){
    const current=String(p?.fields?.['Estado pedido']||'').trim();
    const tone=orderStateTone(current);
    return `<div class="op-status-select-wrap op-status-${tone}" title="Cambiar estado del pedido">
      <select class="op-status-select" aria-label="Estado del pedido ${esc(p?.fields?.['N° Pedido']||'')}" onchange="event.stopPropagation();if(this.value!==this.dataset.current){advancePedido('${p.id}',this.value)}" onclick="event.stopPropagation()" data-current="${esc(current)}">
        ${stages.map(s=>`<option value="${esc(s)}" ${s===current?'selected':''}>${esc(s)}</option>`).join('')}
      </select>
    </div>`;
  }
  function orderCard(p,detail=false){
    const f=p.fields,e=f['Estado pedido']||'Sin estado',pay=payment(p),late=until(f['Fecha entrega'])<0&&until(f['Fecha entrega'])!==null&&!closed.includes(e);
    const nextStage=detail?nextOrderStage(p):null;
    const cot=state.cotizacionesById?.[f['Cotizaciones']?.[0]];
    const title=f['Alias / Título']||cot?.fields?.['Alias / Título']||f['N° Pedido']||'Pedido';
    const next=e==='Listo para despacho'&&f['Resultado QA']!=='QA aprobado'?'Revisar control de calidad':e==='Confirmado'?'Preparar producción':e==='En producción'?'Revisar avance y entrega':e==='Despachado'?'Revisar entrega y pago':e==='Cancelado'?'Pedido cancelado':'Consultar detalle';
    const cardMenu=!detail&&typeof pedidoActMenuHtml==='function'?pedidoActMenuHtml(p,`actmenu-ped-card-${p.id}`):'';
    const mainAction=detail&&nextStage?button(nextStage==='En producción'?'Pasar a producción':nextStage==='Completado'?'Marcar completado':`Pasar a ${nextStage}`,'order-advance',p.id,'op-primary'):detail?'':button('Ver pedido','order',p.id,'op-primary');
    const statusControl=detail||late?pill(late?'Entrega atrasada':e,late?'danger':'neutral'):orderStatusDropdown(p);
    return `<article class="op-record ${late?'op-record-alert':''}"><header><div><span class="op-eyebrow">${esc(f['N° Pedido']||'Pedido')}</span><h3>${esc(resolveClienteName(f['Cliente']))}</h3><p>${esc(title)}</p></div>${statusControl}</header>
      <div class="op-facts"><div><span>Entrega</span><b>${esc(f['Fecha entrega']?(closed.includes(e)?'Fecha programada':dateText(f['Fecha entrega'])):'Sin fecha registrada')}</b><small>${esc(f['Fecha entrega']||'')}</small></div><div><span>Saldo ${pay.estimated?'estimado':'pendiente'} · con IVA</span><b>${money(pay.remaining)}</b><small>${esc(pay.label)}</small></div></div>
      ${detail?orderWorkDetail(p):''}
      <div class="op-payment"><b>Pago</b> ${detail?pill(pay.label,pay.tone):orderPaymentDropdown(p)}<span>${esc(pay.form||'Condición sin definir')}</span>${/D[ÍI]AS/i.test(pay.form)&&pay.remaining!==0?'<small>Vencimiento de pago: revisar fecha de OC / factura</small>':''}</div>
      ${detail?paymentControls(p):orderTeamControls(p)}
      ${stepper(e)}<footer><span><small>Siguiente paso</small>${esc(next)}</span><div class="op-card-footer-actions">${cardMenu}${mainAction}</div></footer></article>`;
  }
  function orders(rows,all){
    mount();const el=$('opOrders');if(!el)return;
    const source=all||own(state.pedidos),counts=[['Atrasados',source.filter(p=>pedidoAtrasado(p.fields)).length,'atrasados'],['En producción',source.filter(p=>p.fields['Estado pedido']==='En producción').length,'En producción'],['Listos para despacho',source.filter(p=>p.fields['Estado pedido']==='Listo para despacho').length,'Listo para despacho']];
    $('opOrderMetrics').innerHTML=counts.map(([l,n,f])=>metric(l,String(n),'Ver pedidos','ped-filter',f)).join('');
    el.innerHTML=rows.length?rows.slice(0,ui.limit).map(p=>orderCard(p)).join(''):'<div class="op-empty">No hay pedidos en esta selección. Cambia el filtro o la búsqueda.</div>';
    $('opOrderMore').innerHTML=rows.length>ui.limit?button(`Ver más · ${rows.length-ui.limit} pendientes`,'more-orders'):'';
  }
  function quotes(rows){
    mount();const el=$('opQuotes');if(!el)return;
    const all=own(state.cotizaciones);
    const metrics=[['Sin respuesta',all.filter(c=>quoteInfo(c).awaiting).length,'awaiting'],['Por vencer · 3 días',all.filter(c=>{const q=quoteInfo(c);return q.awaiting&&q.expires!==null&&q.expires>=0&&q.expires<=3;}).length,'expiring'],['Pendientes de envío',all.filter(c=>quoteInfo(c).pending).length,'pending']];
    $('opQuoteMetrics').innerHTML=metrics.map(([l,n,f])=>metric(l,String(n),'Filtrar cotizaciones','cot-filter',f)).join('');
    $('opQuoteSelection').textContent=({all:'Todas',open:'Gestiones comerciales',awaiting:'Sin respuesta',expiring:'Por vencer en 3 días',pending:'Pendientes de envío'})[ui.cot]+' · '+rows.length+' cotizaciones';
    el.innerHTML=rows.length?rows.slice(0,ui.limit).map(c=>{
      const f=c.fields,q=quoteInfo(c),m=getMargenCot(f);
      const missingOrder=q.e==='Aprobada'&&q.linkedOrder===null;
      return `<article class="op-record"><header><div><span class="op-eyebrow">${esc(f['N° Cotización']||'Cotización')}</span><h3>${esc(resolveClienteName(f['Cliente']))}</h3><p>${esc(f['Alias / Título']||'Sin título')}</p></div>${pill(q.e)}</header><div class="op-facts"><div><span>Total neto</span><b>${money(f['Total final (CLP)']==null?null:Number(f['Total final (CLP)'])/1.19)}</b></div><div class="op-margin-fact" style="${m==null?'':`--op-margin-color:${marginColor(m)}`}"><span>Margen</span><b>${m==null?'Sin dato':Number(m).toFixed(1)+'%'}</b></div></div><p class="op-caption">${q.awaiting&&q.age!==null?`${Math.max(0,-q.age)} días desde la fecha de cotización · `:''}Vigencia: ${esc(f['Fecha vencimiento']||'sin fecha')}</p><footer><span><small>Siguiente paso</small>${esc(q.next)}</span>${button(missingOrder?'Crear pedido':'Ver propuesta',missingOrder?'quote-order':'quote',c.id,'op-primary')}</footer></article>`;
    }).join(''):'<div class="op-empty">No hay cotizaciones en esta selección.</div>';
    $('opQuoteMore').innerHTML=rows.length>ui.limit?button(`Ver más · ${rows.length-ui.limit} pendientes`,'more-quotes'):'';
  }
  function overview(){
    mount();const el=$('opToday');if(!el)return;
    const ps=own(state.pedidos),cs=own(state.cotizaciones);
    const late=ps.filter(p=>pedidoAtrasado(p.fields));
    const soon=ps.filter(p=>{const n=until(p.fields['Fecha entrega']);return n!==null&&n>=0&&n<=3&&!closed.includes(p.fields['Estado pedido']);});
    const pending=cs.filter(c=>quoteInfo(c).pending||quoteInfo(c).awaiting);
    const cards=[{page:'pedidos',title:late.length?'Pedidos atrasados':'Entregas próximas',n:late.length||soon.length,sub:late.length?'Revisa los compromisos de entrega.':'Entregas para los próximos 3 días.',action:'today-orders',arg:late.length?'atrasados':'soon',tone:late.length?'danger':'neutral'},
      {page:'cotizaciones',title:'Gestiones comerciales',n:pending.length,sub:'Propuestas por enviar o esperando respuesta.',action:'today-quotes',arg:'open',tone:'neutral'}];
    if(allowed('finanzas')){
      const due=receivables().filter(r=>r.days>0);cards.push({page:'finanzas',title:'Facturas vencidas',n:due.length,sub:money(due.reduce((s,r)=>s+r.porCobrar,0))+' por cobrar · con IVA',action:'today-aging',arg:'overdue',tone:due.length?'warn':'neutral'});
    }
    el.innerHTML=`<div class="op-section-heading"><div><span class="op-eyebrow">TU JORNADA</span><h2>Hoy requiere tu atención</h2><p>Prioridades de los registros cargados${global._DEMO_MODE?' · DEMO':''}.</p></div>${button('Ver todas las acciones','all-actions')}</div><div class="op-metrics">${cards.filter(c=>allowed(c.page)).map(c=>`<button class="op-priority op-${c.tone}" data-op="${c.action}" data-arg="${c.arg}"><span>${esc(c.title)}</span><strong>${c.n}</strong><p>${esc(c.sub)}</p><b>Revisar →</b></button>`).join('')}</div>`;
  }
  function receivables(){
    if(typeof finGetAllFacturas!=='function')return [];
    return finGetAllFacturas().filter(r=>Number(r.porCobrar)>0).map(r=>{
      const date=finVenc(r),ds=Number.isFinite(date.getTime())?`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`:'';
      const n=until(ds);return {...r,porCobrar:Number(r.porCobrar),due:ds,days:n===null?null:-n,estimated:!r.venc};
    });
  }
  function agingMatch(r,key){return key==='all'||key==='overdue'&&r.days>0||key==='current'&&r.days!==null&&r.days<=0||key==='1-30'&&r.days>0&&r.days<=30||key==='31-60'&&r.days>30&&r.days<=60||key==='61+'&&r.days>60;}
  function collections(){
    if(!allowed('finanzas'))return;
    const el=$('opCollections');if(!el)return;
    const all=receivables(),rows=all.filter(r=>agingMatch(r,ui.aging)).sort((a,b)=>(b.days??-Infinity)-(a.days??-Infinity)||b.porCobrar-a.porCobrar);
    const buckets=[['Todas','all'],['Por vencer / hoy','current'],['Vencidas 1–30 días','1-30'],['31–60 días','31-60'],['Más de 60 días','61+']];
    el.innerHTML=`<div class="op-section-heading"><div><h2>Prioriza tus cobros</h2><p>Saldos con IVA · vencimientos estimados identificados.</p></div></div><div class="op-buckets">${buckets.map(([l,k])=>`<button class="op-metric" data-op="aging" data-arg="${k}" aria-pressed="${ui.aging===k}"><span>${l}</span><strong>${money(all.filter(r=>agingMatch(r,k)).reduce((s,r)=>s+r.porCobrar,0))}</strong></button>`).join('')}</div><p class="op-caption">${rows.length} registros · ${ui.aging==='overdue'?'Todas las vencidas':buckets.find(b=>b[1]===ui.aging)?.[0]||''}</p><div class="op-records">${rows.slice(0,ui.limit).map(r=>{
      const company=r.empresa&&r.empresa!=='—'?r.empresa:r.nombre;
      const cli=own(state.clientes).find(c=>String(c.fields['Empresa']||'').toLowerCase()===String(company||'').toLowerCase());
      const last=typeof _cobLast==='function'?_cobLast(company):null;
      const lastText=last&&Number.isFinite(Number(last.ts))?new Date(Number(last.ts)).toLocaleDateString('es-CL')+' · '+String(last.via||'gestión registrada'):'Sin gestión registrada';
      return `<article class="op-record"><header><div><h3>${esc(company||'Sin cliente')}</h3><p>Factura ${esc(r.fact||'sin folio')} · ${esc(r.item||'')}</p></div>${pill(r.days===null?'Sin fecha':r.days>0?`${r.days} días de mora`:'Aún no vence',r.days>0?'warn':'neutral')}</header><div class="op-facts"><div><span>Saldo por cobrar · con IVA</span><b>${money(r.porCobrar)}</b></div><div><span>Vencimiento${r.estimated?' estimado':''}</span><b>${esc(r.due||'Sin dato')}</b></div></div><p class="op-caption">Última gestión: ${esc(lastText)}</p><footer><span><small>Siguiente paso</small>${r.days>0?'Revisar gestión de cobro':'Preparar seguimiento'}</span>${cli?button('Ver cliente','client',cli.id,'op-primary'):button('Ver gestión','collection-detail','','op-primary')}</footer></article>`;
    }).join('')||'<div class="op-empty">No hay facturas en este tramo.</div>'}</div>${rows.length>ui.limit?button('Ver más facturas','more-aging'):''}`;
  }
  function finance(){
    if(!allowed('finanzas'))return;
    mount();const el=$('opFinance');if(!el)return;
    const month=(typeof hoyCL==='function'?hoyCL():new Date().toISOString()).slice(0,7);
    const entries=typeof ldGetAll==='function'?ldGetAll():[];
    const incoming=entries.filter(r=>r.tipo!=='gasto'&&String(r.fecha||'').startsWith(month));
    const pending=receivables(),payments=typeof _pagosProg==='function'?_pagosProg():[];
    el.innerHTML=`<div class="op-section-heading"><div><span class="op-eyebrow">FINANZAS</span><h2>Cobros y compromisos</h2><p>Fuentes y períodos visibles en cada indicador.</p></div></div><div class="op-metrics">${metric('Cobrado · '+month,incoming.length?money(incoming.reduce((s,r)=>s+(Number(r.monto)||0),0)):'Sin registros','Ingresos del Libro Diario','finance-tab','diario')}${metric('Por cobrar',money(pending.reduce((s,r)=>s+r.porCobrar,0)),'Todas las facturas pendientes · con IVA','finance-tab','cobrar')}${metric('Por pagar programado',payments.length?money(payments.reduce((s,r)=>s+(Number(r.monto)||0),0)):'Sin registros','Pagos programados registrados','payments')}</div><p class="op-caption">Cobrado refleja ingresos registrados, no ventas facturadas. Los pagos programados son compromisos de caja, no el total de la deuda.</p>`;
    collections();
  }
  function ads(data,days){
    const el=$('opAds');if(!el)return;
    let raw=0;try{raw=Number(localStorage.getItem('ads_monthly_cap_net'));}catch(e){}
    const cap=raw>0&&Number.isFinite(raw)?raw:250000;
    const spent=Number(data.gasto),n=Number(days);
    if(data.gasto==null||!Number.isFinite(spent)||spent<0||!Number.isFinite(n)||n<=0){el.innerHTML='<p class="op-empty">Sin datos suficientes para proyectar el gasto.</p>';return;}
    const d=new Date(),monthDays=new Date(d.getFullYear(),d.getMonth()+1,0).getDate(),projection=Math.round(spent/n*monthDays),remaining=cap-projection;
    el.innerHTML=`<div class="op-section-heading"><div><span class="op-eyebrow">PRESUPUESTO ADS${data.demo?' · DEMO':''}</span><h2>${remaining<0?'La proyección supera tu tope':'Control del gasto publicitario'}</h2><p>Estimación al ritmo del período seleccionado · importes netos.</p></div>${pill(remaining<0?'Revisar presupuesto':'Dentro de la proyección',remaining<0?'warn':'good')}</div><div class="op-metrics">${metric('Gastado · '+n+' días',money(spent),data.periodo||'Período seleccionado')}${metric('Cierre mensual estimado',money(projection),'Promedio diario × días del mes')}${metric(remaining<0?'Exceso proyectado':'Disponible en proyección',money(Math.abs(remaining)),'Tope mensual: '+money(cap))}</div><div class="op-budget-track" role="progressbar" aria-label="Proyección frente al tope" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100,Math.round(projection/cap*100))}"><i style="width:${Math.min(100,projection/cap*100)}%"></i></div><p class="op-caption">Proyección orientativa; no representa el saldo real del mes ni modifica el presupuesto de Google Ads.</p>`;
  }
  function client(c,cots,peds){
    const el=$('opClient');if(!el)return;
    const cs=cots.filter(x=>!['Rechazada','Vencida','Aprobada'].includes(x.fields['Estado cotización']));
    const ps=peds.filter(x=>!closed.includes(x.fields['Estado pedido']));
    const account=typeof _estadoCuentaData==='function'?_estadoCuentaData(c.id,c.fields['Empresa']||''):null;
    // Reutiliza la conciliación de facturas para respetar abonos y saldos parciales.
    el.innerHTML=`<div class="op-metrics">${metric('Cotizaciones abiertas',String(cs.length),'Ver actividad','client-tab','actividad')}${metric('Pedidos activos',String(ps.length),'Ver actividad','client-tab','actividad')}${metric('Saldo pendiente',account?money(account.pendiente):'Sin dato','Facturas · con IVA','client-tab','facturas')}</div>`;
  }
  function openRecord(kind,id){
    if(!allowed(kind==='order'?'pedidos':'cotizaciones'))return;
    const rows=own(kind==='order'?state.pedidos:state.cotizaciones),r=rows.find(x=>x.id===id);if(!r)return;
    let dlg=$('opDrawer');if(!dlg){dlg=document.createElement('dialog');dlg.id='opDrawer';dlg.className='op-drawer';document.body.appendChild(dlg);dlg.addEventListener('close',()=>ui.returnFocus?.focus?.());dlg.addEventListener('click',e=>{if(e.target===dlg){const b=dlg.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right)dlg.close();}});}
    ui.returnFocus=document.activeElement;
    dlg.setAttribute('aria-label',kind==='order'?'Detalle del pedido':'Detalle de la cotización');
    dlg.dataset.kind=kind;
    const f=r.fields,isOrder=kind==='order';
    const nextStage=isOrder?nextOrderStage(r):null;
    const editTone=!isOrder||!nextStage?'op-primary':'';
    dlg.innerHTML=`<div class="op-drawer-head"><span class="op-eyebrow">${isOrder?'PEDIDO':'COTIZACIÓN'}</span>${button('Cerrar ×','close-drawer')}</div><h2>${esc(f[isOrder?'N° Pedido':'N° Cotización']||'Detalle')}</h2>${isOrder?orderCard(r,true):`<h3>${esc(resolveClienteName(f['Cliente']))}</h3><p>${esc(f['Alias / Título']||'')}</p><div class="op-facts"><div><span>Estado</span><b>${esc(f['Estado cotización']||'Sin estado')}</b></div><div><span>Total neto</span><b>${money(f['Total final (CLP)']==null?null:Number(f['Total final (CLP)'])/1.19)}</b></div></div>${quoteWorkDetail(r)}<p>${esc(quoteInfo(r).next)}</p>${quoteStateActions(r)}`}<div class="op-drawer-actions">${button(isOrder?'Editar pedido':'Editar cotización',isOrder?'edit-order':'edit-quote',id,editTone)}${isOrder?button('Control de calidad','qa',id)+button('Ficha técnica','ficha',id)+button('Administrar pagos','order-payments',id):button('Ver PDF','quote-pdf',id)+button('Notas','quote-notes',id)}</div><p class="op-caption">${isOrder?'Producción y pago se gestionan por separado.':'Las acciones de estado disponibles aparecen arriba; Editar conserva el control completo de la cotización.'}</p>`;
    if(!dlg.open)dlg.showModal();
  }
  function goFinance(tab){if(!allowed('finanzas'))return;switchTab('finanzas');finSwitchTab(tab);finance();}
  function selectCot(filter){ui.cot=filter;ui.limit=24;renderCotizaciones();}
  async function events(e){
    // Los <details> no se cierran solos al hacer click fuera. Mantén abierto solo
    // el menú de pago que contiene el click actual y cierra cualquier otro.
    const activePaymentDropdown=e.target.closest?.('.op-payment-dropdown');
    document.querySelectorAll?.('.op-payment-dropdown[open]').forEach(dropdown=>{
      if(dropdown!==activePaymentDropdown)dropdown.open=false;
    });
    const b=e.target.closest('[data-op]');if(!b)return;
    const a=b.dataset.op,arg=b.dataset.arg||'';
    if(a==='mode'){const [page,value]=arg.split(':');mode(page,value);return;}
    if(a==='close-detail'){closeDetail(arg);return;}
    if(a==='ped-filter'){renderPedidos(arg);return;}
    if(a==='cot-filter'){selectCot(arg);return;}
    if(a==='aging'){ui.aging=arg;ui.limit=24;collections();return;}
    if(a==='order'||a==='quote'){openRecord(a,arg);return;}
    if(a==='quote-order'){convertirCotAPedido(arg,b);return;}
    if(a==='close-drawer'){$('opDrawer')?.close();return;}
    if(a==='today-orders'){if(!allowed('pedidos'))return;switchTab('pedidos');renderPedidos(arg==='soon'?'proximos':arg);return;}
    if(a==='today-quotes'){if(!allowed('cotizaciones'))return;switchTab('cotizaciones');selectCot(arg);return;}
    if(a==='today-aging'){ui.aging=arg;goFinance('cobrar');return;}
    if(a==='all-actions'){reveal('accionesHoyCard');return;}
    if(a==='more-orders'){ui.limit+=24;renderPedidos();return;}
    if(a==='more-quotes'){ui.limit+=24;renderCotizaciones();return;}
    if(a==='more-aging'){ui.limit+=24;collections();return;}
    if(a==='finance-tab'){goFinance(arg);return;}
    if(a==='payments'){goFinance('cobrar');reveal('finFlujoCaja');return;}
    if(a==='collection-detail'){reveal('finCobranzaActions');return;}
    if(a==='client'){if(!allowed('clientes'))return;openClienteDetalle(arg);return;}
    if(a==='client-tab'){if(!allowed('clientes'))return;cdTab(arg);return;}
    if(a==='quote-status'){
      const sep=arg.indexOf('::'),id=sep>=0?arg.slice(0,sep):'',estado=sep>=0?arg.slice(sep+2):'';
      if(!id||!estado||typeof updateCotizacionEstado!=='function')return;
      await updateCotizacionEstado(id,estado);
      openRecord('quote',id);
      return;
    }
    if(a==='quote-linked-order'){openRecord('order',arg);return;}
    if(a==='card-pay-abono'||a==='card-pay-saldo'||a==='card-pay-total'||a==='card-pay-30'){
      const p=own(state.pedidos).find(p=>p.id===arg);if(!p)return;
      const f=p.fields||{};
      if(a==='card-pay-abono'){
        if(f['Anticipo pagado (50%)'])await toggleAnticipo(arg,true);
        else openAbonoModal(arg);
        return;
      }
      if(a==='card-pay-saldo'){await toggleSaldo(arg,!!f['Saldo pagado (50%)']);return;}
      if(a==='card-pay-total'){await toggleTotal(arg,!!(f['Anticipo pagado (50%)']&&f['Saldo pagado (50%)']));return;}
      if(a==='card-pay-30'){await marcarPago30Dias(arg);return;}
    }
    if(a==='order-pay-abono'||a==='order-pay-saldo'||a==='order-pay-total'||a==='order-pay-30'){
      const p=own(state.pedidos).find(p=>p.id===arg);if(!p)return;
      const f=p.fields||{};
      if(a==='order-pay-abono'){
        if(f['Anticipo pagado (50%)']){await toggleAnticipo(arg,true);openRecord('order',arg);}
        else{
          window._opReturnPaymentDrawer=arg;
          $('opDrawer')?.close();
          openAbonoModal(arg);
        }
        return;
      }
      if(a==='order-pay-saldo'){await toggleSaldo(arg,!!f['Saldo pagado (50%)']);openRecord('order',arg);return;}
      if(a==='order-pay-total'){await toggleTotal(arg,!!(f['Anticipo pagado (50%)']&&f['Saldo pagado (50%)']));openRecord('order',arg);return;}
      if(a==='order-pay-30'){await marcarPago30Dias(arg);openRecord('order',arg);return;}
    }
    if(a==='order-advance'){
      const p=own(state.pedidos).find(p=>p.id===arg),next=nextOrderStage(p);
      if(!p||!next||typeof advancePedido!=='function')return;
      await advancePedido(arg,next);
      const current=own(state.pedidos).find(p=>p.id===arg);
      if(current?.fields?.['Estado pedido']===next)openRecord('order',arg);
      return;
    }
    $('opDrawer')?.close();
    if(a==='edit-order')openEditPedidoModal(arg);
    if(a==='edit-quote')openEditCot(arg);
    if(a==='qa'){const p=own(state.pedidos).find(p=>p.id===arg);if(p)openQAModal(arg,p.fields['N° Pedido']||'Pedido');}
    if(a==='ficha')openFichaModal(arg);
    if(a==='order-payments'){const layout=$('tab-pedidos')?.dataset.opLayout;switchTab('pedidos');setPedidosView('tabla',{persist:false});reveal('pedidosTableWrap');const saved=detailState.get('pedidosTableWrap');if(saved){saved.layout=layout;saved.trigger=ui.returnFocus;}const p=own(state.pedidos).find(p=>p.id===arg);const query=p?.fields['N° Pedido']||'';if($('pedidosSearch'))$('pedidosSearch').value=query;searchPedidos(query);renderPedidos(p?.fields['Estado pedido']==='Completado'?'Completado':'all');const row=document.querySelector(`#pedidosTableBody tr[data-id="${CSS.escape(arg)}"]`);row?.scrollIntoView({block:'center'});}
    if(a==='quote-pdf')generarPDFCotizacion(arg);
    if(a==='quote-notes')openNotasModal('cot',arg,'Cotización');
  }
  global.OP={mount,mode,reveal,orders,quotes,overview,finance,collections,ads,client,filterQuotes,payment,paymentControls,orderPaymentDropdown,quoteInfo,quoteStateActions,marginColor,orderTeamControls,orderStateTone,orderStatusDropdown,quoteWorkItems,quoteWorkDetail,orderWorkItems,orderWorkDetail,agingMatch,day,until,openRecord,nextOrderStage};
  document.addEventListener('click',events);
  document.addEventListener('input',e=>{if(e.target.id==='opQuoteSearch'){ui.search=e.target.value;ui.limit=24;renderCotizaciones(true);}});
  document.addEventListener('DOMContentLoaded',mount);
})(window);
