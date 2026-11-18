/* js/pdf-fichas.js — módulo extraído de index.html (carga en el mismo punto). */

// ── PLAZO DE ENTREGA (texto para cotización / ficha) ──────────
// Fecha legible en español (ej: "15 de agosto de 2026") desde un ISO yyyy-mm-dd.
function cotFechaLarga(iso){
  if(!iso)return '';
  const d=new Date(String(iso).slice(0,10)+'T00:00:00');
  if(isNaN(d))return String(iso);
  try{return d.toLocaleDateString('es-CL',{day:'numeric',month:'long',year:'numeric'});}catch(e){return String(iso);}
}
// Texto largo del plazo: rango de días, número único o fecha fija. '' si no hay dato.
function cotPlazoTexto(f){
  if(!f)return '';
  if(f['Fecha de entrega'])return `Entrega estimada para el ${cotFechaLarga(f['Fecha de entrega'])}. Fecha sujeta a la confirmación del pedido y a la disponibilidad de stock.`;
  const min=f['Tiempo de producción'];if(!min)return '';
  const max=f['Tiempo de producción máx'];const tipo=String(f['Tipo días producción']||'DÍAS HÁBILES').toLowerCase();
  const rango=(max&&max>min)?`${min}-${max}`:`${min}`;
  return `${rango} ${tipo} desde la confirmación del pedido. Plazo podría variar dependiendo de stock de productos, contingencias sanitarias o sociales.`;
}
// Texto corto del plazo (ej: "10-15 días hábiles" o la fecha). '' si no hay dato.
function cotPlazoCorto(f){
  if(!f)return '';
  if(f['Fecha de entrega'])return cotFechaLarga(f['Fecha de entrega']);
  const min=f['Tiempo de producción'];if(!min)return '';
  const max=f['Tiempo de producción máx'];const tipo=String(f['Tipo días producción']||'DÍAS HÁBILES').toLowerCase();
  return `${(max&&max>min)?`${min}-${max}`:min} ${tipo}`;
}

// ── PDF ───────────────────────────────────────────────────────
function buildCotizacionDoc(id){
  const c=state.cotizacionesById[id];if(!c) return null;
  const f=c.fields;const clienteId=Array.isArray(f['Cliente'])?f['Cliente'][0]:null;const cf=(clienteId?state.clientes.find(x=>x.id===clienteId):null)?.fields||{};
  const num=f['N° Cotización']||'—',fecha=f['Fecha cotización']||hoyCL(),vto=f['Fecha vencimiento']||(typeof calBusinessDate==='function'?calBusinessDate(fecha,10):'—'),urgente=f['Urgencia (+25%)'],solicitud=f['Solicitud cliente (texto libre)']||'',detalle=f['Detalle productos']||'',total=f['Total final (CLP)']||0,neto=Math.round(total/1.19),iva=total-neto;
  const plazotxt=cotPlazoTexto(f)||'A coordinar con el cliente.';
  const formaPago=f['Forma de pago']||'';
  const formaDescMap={'AL CONTADO':'Pago total al momento de confirmar el pedido, vía transferencia bancaria, vale vista o cheque al día.','30 DÍAS DESDE OC':'Pago total a 30 días desde la emisión de la Orden de Compra, vía transferencia bancaria.','45 DÍAS DESDE OC':'Pago total a 45 días desde la emisión de la Orden de Compra, vía transferencia bancaria.','70% ABONO Y 30% CONTRA ENTREGA':'70% de abono al confirmar el pedido (Facturable inmediatamente), 30% restante contra entrega y conformidad de recepción, vía transferencia bancaria, vale vista o cheque al día.','50% ABONO Y 50% 30 DÍAS':'50% de abono al confirmar el pedido (Facturable inmediatamente), 50% restante a 30 días desde la Orden de Compra, vía transferencia bancaria.'};
  const formaHtml=formaPago?`<strong>${escHtml(formaPago)}:</strong> ${formaDescMap[formaPago]||''}`:'';
  const lineas=detalle.split('\n').filter(Boolean).map(l=>{const parts=l.split('|').map(s=>s.trim());const undStr=(parts[1]||'').replace(/[^\d.]/g,'');const und=parseFloat(undStr)||1;const ventaRaw=(parts[3]||parts[2]||'').replace(/[Vv]enta:\s*/,'').replace(/\./g,'').replace(/[^0-9]/g,'');const ventaTotal=parseFloat(ventaRaw)||0;const ventaUnit=und>0?Math.round(ventaTotal/und):ventaTotal;return{desc:parts[0]||'',und,ventaUnit,ventaTotal};});
  const itemsHTML=lineas.length>0?lineas.map((l,i)=>`<tr style="background:${i%2===0?'#f9f9f9':'#fff'}"><td style="padding:6px 10px;border-bottom:1px solid #e8e8e8;font-size:10px">${escHtml(l.desc)}</td><td style="padding:6px 10px;border-bottom:1px solid #e8e8e8;font-size:10px;text-align:center;color:#555">${l.und}</td><td style="padding:6px 10px;border-bottom:1px solid #e8e8e8;font-size:10px;text-align:right">${formatCLP(l.ventaUnit)}</td><td style="padding:6px 10px;border-bottom:1px solid #e8e8e8;font-size:10px;text-align:right;font-weight:600">${formatCLP(l.ventaTotal)}</td></tr>`).join(''):`<tr><td colspan="4" style="padding:12px;text-align:center;color:#999;font-size:10px">Sin detalle</td></tr>`;
  const infoRow=(label,val)=>val&&val!=='—'?`<tr><td style="padding:3px 0;font-size:10px;color:#888;width:80px;vertical-align:top">${label}</td><td style="padding:3px 0;font-size:10px;color:#1a1a1a;font-weight:500">${escHtml(val)}</td></tr>`:'';
  // Totales: cuando hay descuento, los ítems suman el neto SIN descuento; hay que
  // mostrar Subtotal → Descuento → Neto para que el documento cuadre y el cliente
  // vea de dónde sale el total (antes solo se veía el neto ya descontado, sin
  // línea de descuento, y no coincidía con la suma de los ítems).
  const sumaNeto=lineas.reduce((s,l)=>s+(l.ventaTotal||0),0);
  const descPct=Math.max(0,parseFloat(f['Descuento (%)'])||0);
  const descMonto=sumaNeto-neto; // concilia el subtotal con el neto ya descontado
  const hayDesc=descPct>0&&descMonto>0&&sumaNeto>0;
  const descPctTxt=Number.isInteger(descPct)?String(descPct):descPct.toFixed(1).replace(/\.0$/,'');
  const totalsRows=(hayDesc
    ?`<div class="totals-row"><span>Subtotal neto</span><span>${formatCLP(sumaNeto)}</span></div>`
      +`<div class="totals-row" style="color:#c0392b"><span>Descuento (${descPctTxt}%)</span><span>−${formatCLP(descMonto)}</span></div>`
      +`<div class="totals-row"><span>Neto</span><span>${formatCLP(neto)}</span></div>`
    :`<div class="totals-row"><span>Neto</span><span>${formatCLP(neto)}</span></div>`)
    +`<div class="totals-row iva"><span>IVA (19%)</span><span>${formatCLP(iva)}</span></div>`
    +`<div class="totals-row total-final"><span>TOTAL</span><span>${formatCLP(total)}</span></div>`;
  const html=`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Cotización ${escHtml(num)}</title>
<link rel="icon" href="https://dashboard.thelab.solutions/isotipo-thelab.png">
<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Helvetica Neue',Arial,sans-serif;color:#1a1a1a;background:#fff;padding:18px 24px;font-size:10px;}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:12px;border-bottom:3px solid #00d4cc;}
.logo-area img{height:28px;}.logo-area .tagline{font-size:8px;color:#aaa;margin-top:4px;letter-spacing:1.2px;text-transform:uppercase;}
.cot-meta{text-align:right;}.cot-meta h1{font-size:20px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#0a0a0a;}
.cot-meta .num{font-size:16px;font-weight:700;color:#00d4cc;font-family:monospace;margin-top:2px;}.cot-meta .fechas{font-size:9px;color:#999;margin-top:4px;line-height:1.6;}
${urgente?'.urgente-strip{background:#ff6b35;color:#fff;text-align:center;font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:5px;border-radius:5px;margin-bottom:10px;}':''}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;}
.info-box{background:#f8f8f8;border-radius:6px;padding:10px 12px;border-top:3px solid #00d4cc;}
.info-box h3{font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;margin-bottom:8px;}
.info-box table{width:100%;border-collapse:collapse;}
.section-label{font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;margin:10px 0 5px;}
.solicitud-box{background:#f0fffe;border:1px solid rgba(0,212,204,0.3);border-radius:6px;padding:8px 10px;font-size:10px;color:#333;line-height:1.7;white-space:pre-line;}
.condiciones-box{background:#f8f8f8;border-radius:6px;padding:10px 12px;margin-top:10px;border-left:4px solid #00d4cc;font-size:9px;color:#333;line-height:1.7;}
table.items{width:100%;border-collapse:collapse;border:1px solid #e8e8e8;margin-top:5px;}
table.items thead tr{background:#0a0a0a;color:#fff;}
table.items thead th{padding:7px 10px;font-size:8px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:left;}
table.items thead th:nth-child(2){text-align:center;}table.items thead th:nth-child(3),table.items thead th:nth-child(4){text-align:right;}
.totals{margin-top:8px;display:flex;justify-content:flex-end;}
.totals-box{min-width:220px;border:1px solid #e8e8e8;border-radius:6px;overflow:hidden;}
.totals-row{display:flex;justify-content:space-between;padding:6px 12px;font-size:10px;border-bottom:1px solid #f0f0f0;background:#fff;}
.totals-row.iva{color:#888;}.totals-row.total-final{background:#0a0a0a;color:#00d4cc;font-weight:700;font-size:12px;border-bottom:none;}
.transfer-box{margin-top:12px;border:1px solid #00d4cc;border-radius:6px;overflow:hidden;}
.transfer-title{background:#00d4cc;color:#0a0a0a;font-weight:700;text-align:center;padding:5px;letter-spacing:1.5px;text-transform:uppercase;font-size:9px;}
.transfer-box table{width:100%;border-collapse:collapse;}.transfer-box table td{padding:4px 10px;font-size:9px;}
.footer{margin-top:12px;padding-top:10px;border-top:2px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center;}
.footer .left{font-size:8px;color:#bbb;line-height:1.7;}.footer .validity{background:#f8f8f8;border-radius:5px;padding:5px 10px;font-size:9px;color:#555;}
.footer .validity strong{color:#0a0a0a;}
@media print{body{padding:10px 14px;}@page{margin:8mm;size:A4;}}</style></head><body>
<div class="header"><div class="logo-area"><img loading="lazy" decoding="async" src="https://dashboard.thelab.solutions/logo-thelab-black.png" onerror="this.style.display='none'"><div class="tagline">Impresión 3D · Neones · Trofeos</div></div>
<div class="cot-meta"><h1>Cotización</h1><div class="num">${escHtml(num)}</div><div class="fechas">Emitida: <strong>${escHtml(fecha)}</strong><br>Válida hasta: <strong>${escHtml(vto)}</strong></div></div></div>
${urgente?'<div class="urgente-strip">⚡ Cotización con urgencia — producción prioritaria</div>':''}
<div class="info-grid">
<div class="info-box"><h3>Cliente</h3><table>${infoRow('Empresa',cf['Empresa']||resolveClienteName(f['Cliente']))}${infoRow('RUT',cf['RUT'])}${infoRow('Contacto',cf['Contacto'])}${infoRow('Teléfono',cf['Teléfono'])}${infoRow('Email',cf['Email'])}${infoRow('Dirección',cf['Dirección']||cf['Direccion'])}${infoRow('Comuna',cf['Comuna'])}${infoRow('Región',cf['Región']||cf['Region'])}</table></div>
<div class="info-box"><h3>The Lab Solutions</h3><table>${infoRow('Web','thelab.solutions')}${infoRow('Teléfono','+56 9 7180 6142')}${infoRow('Email','hola@thelab.solutions')}${infoRow('Dirección','Zaragoza 8882, Las Condes')}${infoRow('Ciudad','Santiago, Chile')}</table></div>
</div>
${solicitud?`<div class="section-label">Solicitud del cliente</div><div class="solicitud-box">${escHtml(solicitud)}</div>`:''}
<div class="condiciones-box"><p style="margin-bottom:5px"><strong>PLAZO DE ENTREGA:</strong> ${plazotxt}</p>${formaHtml?`<p style="margin-bottom:2px;margin-top:5px"><strong>FORMA DE PAGO:</strong></p><p style="margin-bottom:5px">${formaHtml}</p>`:''}<p style="color:#888;font-style:italic">* Cotización válida por 10 días hábiles.</p></div>
<div class="section-label" style="margin-top:10px">Detalle de productos / servicios</div>
<table class="items"><thead><tr><th style="background:#0a0a0a;color:#fff">Descripción</th><th style="background:#0a0a0a;color:#fff;text-align:center">Cant.</th><th style="background:#0a0a0a;color:#fff;text-align:right">Precio Unit. Neto</th><th style="background:#0a0a0a;color:#fff;text-align:right">Total Neto</th></tr></thead><tbody>${itemsHTML}</tbody></table>
<div class="totals"><div class="totals-box">${totalsRows}</div></div>
<div class="transfer-box"><div class="transfer-title">Datos de Transferencia</div><table>
<tr style="border-bottom:1px solid #e8e8e8"><td style="color:#888;width:120px;font-weight:600;text-transform:uppercase;font-size:8px">Razón Social</td><td style="font-weight:500">WAST3D SPA</td></tr>
<tr style="border-bottom:1px solid #e8e8e8;background:#f9f9f9"><td style="color:#888;font-weight:600;text-transform:uppercase;font-size:8px">Banco</td><td style="font-weight:500">BANCO ESTADO</td></tr>
<tr style="border-bottom:1px solid #e8e8e8"><td style="color:#888;font-weight:600;text-transform:uppercase;font-size:8px">Tipo de Cuenta</td><td style="font-weight:500">CUENTA VISTA (CHEQUERA ELECTRÓNICA)</td></tr>
<tr style="border-bottom:1px solid #e8e8e8;background:#f9f9f9"><td style="color:#888;font-weight:600;text-transform:uppercase;font-size:8px">RUT</td><td style="font-weight:500">77.499.554-4</td></tr>
<tr style="border-bottom:1px solid #e8e8e8"><td style="color:#888;font-weight:600;text-transform:uppercase;font-size:8px">N° de Cuenta</td><td style="font-weight:500">90270420078</td></tr>
<tr style="background:#f9f9f9"><td style="color:#888;font-weight:600;text-transform:uppercase;font-size:8px">Email</td><td style="font-weight:500">PAGOS@THELAB.SOLUTIONS</td></tr>
</table></div>
<div class="footer"><div class="left">The Lab Solutions SpA · Santiago, Chile<br>hola@thelab.solutions · +56 9 7180 6142</div><div class="validity">Válida hasta: <strong>${escHtml(vto)}</strong></div></div>
</body></html>`;
  return {html,num,c};
}
function generarPDFCotizacion(id){
  const res=buildCotizacionDoc(id);if(!res){toast('Cotización no encontrada','error');return;}
  const blob=new Blob([res.html],{type:'text/html;charset=utf-8'});const url=URL.createObjectURL(blob);const win=window.open(url,'_blank');if(!win) toast('Permite ventanas emergentes','error');setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function descargarPDFCotizacion(id){
  const res=buildCotizacionDoc(id);if(!res){toast('Cotización no encontrada','error');return;}
  const htmlWithPrint=res.html.replace('</body></html>','<script>window.onload=function(){window.focus();window.print();};<\/script></body></html>');
  const blob=new Blob([htmlWithPrint],{type:'text/html;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const win=window.open(url,'_blank');
  if(!win){toast('Permite ventanas emergentes para descargar el PDF','error');return;}
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

// ── FICHAS TÉCNICAS ───────────────────────────────────────────
function parseFichaData(s){try{return s?JSON.parse(s):null;}catch(e){return null;}}

function openFichaModal(pedidoId){
  const ped=state.pedidosById[pedidoId];if(!ped) return;
  const f=ped.fields;
  const data=parseFichaData(f['Ficha Tecnica'])||{};
  document.getElementById('fichaPedidoId').value=pedidoId;
  const set=(id,v)=>{const el=document.getElementById(id);if(el) el.value=v||'';};
  set('fichaMaterial',data.material||'');
  set('fichaColor',data.color||'');
  set('fichaAcabado',data.acabado||'');
  set('fichaCantidad',data.cantidad||'');
  set('fichaImpresora',data.impresora||'');
  set('fichaAltaCapa',data.altaCapa||'');
  set('fichaRelleno',data.relleno||'');
  set('fichaSoportes',data.soportes||'');
  set('fichaPeso',data.peso||'');
  set('fichaTiempo',data.tiempo||'');
  set('fichaNotas',data.notas||'');
  set('fichaAprobado',data.aprobado||'');
  document.getElementById('fichaModal').style.display='flex';
}

function closeFichaModal(){document.getElementById('fichaModal').style.display='none';}

async function saveFichaModal(verPDF=false){
  const pedidoId=document.getElementById('fichaPedidoId').value;
  if(!pedidoId) return;
  const get=id=>document.getElementById(id)?.value||'';
  const data={
    material:get('fichaMaterial'),color:get('fichaColor'),acabado:get('fichaAcabado'),
    cantidad:get('fichaCantidad'),impresora:get('fichaImpresora'),altaCapa:get('fichaAltaCapa'),
    relleno:get('fichaRelleno'),soportes:get('fichaSoportes'),peso:get('fichaPeso'),
    tiempo:get('fichaTiempo'),notas:get('fichaNotas'),aprobado:get('fichaAprobado'),
    updatedAt:hoyCL()
  };
  try{
    await airtableWrite('Pedidos','PATCH',pedidoId,{'Ficha Tecnica':JSON.stringify(data)});
    const ped=state.pedidosById[pedidoId];
    if(ped) ped.fields['Ficha Tecnica']=JSON.stringify(data);
    toast('Ficha técnica guardada ✓','success');
    renderPedidos();
    if(verPDF){closeFichaModal();descargarFichaTecnica(pedidoId);}
    else closeFichaModal();
  }catch(e){toast('Error: '+e.message,'error');}
}

function buildFichaDoc(pedidoId){
  const ped=state.pedidosById[pedidoId];if(!ped) return null;
  const f=ped.fields;
  const data=parseFichaData(f['Ficha Tecnica'])||{};
  const escH=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  const num=f['N° Pedido']||'—';
  const cliente=resolveClienteName(f['Cliente']);
  const fecha=new Date().toLocaleDateString('es-CL',{day:'2-digit',month:'long',year:'numeric'});
  const entrega=f['Fecha entrega']||'—';
  const solicitud=f['Solicitud cliente (texto libre)']||'';
  const detalle=f['Detalle productos']||'';
  const estado=f['Estado pedido']||'—';
  const equipo=(f['Equipo asignado']||'').split(',').map(s=>s.trim()).filter(Boolean).join(', ')||'—';
  const qaRes=f['Resultado QA']||'Pendiente';
  let qaItems=[];
  try{qaItems=JSON.parse(f['Notas QA']||'[]');if(!Array.isArray(qaItems)) qaItems=[];}catch(e){qaItems=[];}

  const specRow=(label,val)=>val?`<tr><td class="spec-label">${escH(label)}</td><td class="spec-val">${escH(val)}</td></tr>`:'';

  const lineas=detalle.split('\n').filter(Boolean).map(l=>{const p=l.split('|').map(s=>s.trim());return{desc:p[0]||'',cant:p[1]||'',precio:(p[3]||p[2]||'').replace(/^venta:\s*/i,'').trim()};});
  const itemsHTML=lineas.length>0?lineas.map((l,i)=>`<tr style="background:${i%2===0?'#f9f9f9':'#fff'}"><td style="padding:5px 10px;font-size:10px;border-bottom:1px solid #eee">${escH(l.desc)}</td><td style="padding:5px 10px;font-size:10px;text-align:center;border-bottom:1px solid #eee">${escH(l.cant)}</td><td style="padding:5px 10px;font-size:10px;text-align:right;border-bottom:1px solid #eee;font-weight:600">${escH(l.precio)}</td></tr>`).join(''):`<tr><td colspan="3" style="padding:10px;text-align:center;color:#aaa;font-size:10px">Sin detalle</td></tr>`;

  const qaColor=qaRes==='QA aprobado'?'#10b981':qaRes==='Rechazado'?'#ef4444':'#f59e0b';
  const qaBadge=`<span style="display:inline-block;padding:3px 10px;background:${qaColor}22;color:${qaColor};border:1px solid ${qaColor}55;border-radius:20px;font-size:9px;font-weight:700;text-transform:uppercase">${escH(qaRes)}</span>`;
  const qaList=qaItems.length>0?`<ul style="margin:6px 0 0 16px;padding:0;font-size:9px;color:#555;line-height:1.8">${qaItems.map(it=>`<li>${it.checked?'✓':'✗'} ${escH(it.text||String(it))}</li>`).join('')}</ul>`:'';

  const html=`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Ficha Técnica ${escH(num)}</title>
<link rel="icon" href="https://dashboard.thelab.solutions/isotipo-thelab.png">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Helvetica Neue',Arial,sans-serif;color:#1a1a1a;background:#fff;padding:18px 24px;font-size:10px;}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:12px;border-bottom:3px solid #3b82f6;}
.logo-area img{height:28px;}.logo-area .tagline{font-size:8px;color:#aaa;margin-top:4px;letter-spacing:1.2px;text-transform:uppercase;}
.doc-meta{text-align:right;}.doc-meta h1{font-size:18px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#0a0a0a;}
.doc-meta .num{font-size:14px;font-weight:700;color:#3b82f6;font-family:monospace;margin-top:2px;}
.doc-meta .fecha{font-size:9px;color:#999;margin-top:4px;}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;}
.info-box{background:#f8f8f8;border-radius:6px;padding:10px 12px;border-top:3px solid #3b82f6;}
.info-box h3{font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;margin-bottom:8px;}
.info-row{display:flex;gap:6px;margin-bottom:4px;}.info-lbl{font-size:9px;color:#888;width:80px;flex-shrink:0;}.info-val{font-size:9px;color:#1a1a1a;font-weight:500;}
.section-label{font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;margin:12px 0 6px;}
.spec-table{width:100%;border-collapse:collapse;border:1px solid #e8e8e8;border-radius:6px;overflow:hidden;}
.spec-table .spec-label{padding:6px 12px;font-size:9px;font-weight:700;color:#555;background:#f8f8f8;border-bottom:1px solid #eee;text-transform:uppercase;letter-spacing:.5px;width:140px;}
.spec-table .spec-val{padding:6px 12px;font-size:10px;color:#1a1a1a;font-weight:600;border-bottom:1px solid #eee;}
.spec-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;}
.spec-box{background:#f8f8f8;border-radius:6px;padding:10px 12px;border-left:3px solid #3b82f6;}
.spec-box h3{font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;margin-bottom:8px;}
.solicitud-box{background:#f0f7ff;border:1px solid rgba(59,130,246,0.3);border-radius:6px;padding:8px 10px;font-size:10px;color:#333;line-height:1.5;margin-bottom:12px;}
table.items{width:100%;border-collapse:collapse;border:1px solid #e8e8e8;}
table.items thead tr{background:#0a0a0a;color:#fff;}
table.items thead th{padding:6px 10px;font-size:8px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:left;}
.qa-box{background:#f8f8f8;border-radius:6px;padding:10px 12px;margin-top:12px;border-left:4px solid ${qaColor};}
.firma-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:16px;}
.firma-box{text-align:center;}.firma-line{border-top:1px solid #ccc;padding-top:5px;margin-top:30px;font-size:8px;color:#999;text-transform:uppercase;letter-spacing:.8px;}
.footer{margin-top:14px;padding-top:10px;border-top:2px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center;}
.footer .left{font-size:8px;color:#bbb;line-height:1.7;}.footer .right{font-size:8px;color:#999;}
@media print{body{padding:10px 14px;}@page{margin:8mm;size:A4;}}
</style></head><body>
<div class="header">
  <div class="logo-area">
    <img loading="lazy" decoding="async" src="https://dashboard.thelab.solutions/logo-thelab-black.png" onerror="this.style.display='none'">
    <div class="tagline">Impresión 3D · Neones · Trofeos</div>
  </div>
  <div class="doc-meta">
    <h1>Ficha Técnica</h1>
    <div class="num">Pedido ${escH(num)}</div>
    <div class="fecha">Generada: ${escH(fecha)}${data.updatedAt?' · Actualizada: '+escH(data.updatedAt):''}</div>
  </div>
</div>

<div class="info-grid">
  <div class="info-box"><h3>Datos del pedido</h3>
    <div class="info-row"><span class="info-lbl">N° Pedido</span><span class="info-val">${escH(num)}</span></div>
    <div class="info-row"><span class="info-lbl">Cliente</span><span class="info-val">${escH(cliente)}</span></div>
    <div class="info-row"><span class="info-lbl">Estado</span><span class="info-val">${escH(estado)}</span></div>
    <div class="info-row"><span class="info-lbl">F. Entrega</span><span class="info-val">${escH(entrega)}</span></div>
    <div class="info-row"><span class="info-lbl">Equipo</span><span class="info-val">${escH(equipo)}</span></div>
  </div>
  <div class="info-box"><h3>Especificaciones</h3>
    <div class="info-row"><span class="info-lbl">Material</span><span class="info-val">${escH(data.material||'—')}</span></div>
    <div class="info-row"><span class="info-lbl">Color</span><span class="info-val">${escH(data.color||'—')}</span></div>
    <div class="info-row"><span class="info-lbl">Acabado</span><span class="info-val">${escH(data.acabado||'Sin acabado')}</span></div>
    <div class="info-row"><span class="info-lbl">Cantidad</span><span class="info-val">${escH(data.cantidad?data.cantidad+' piezas':'—')}</span></div>
    <div class="info-row"><span class="info-lbl">Peso est.</span><span class="info-val">${escH(data.peso||'—')}</span></div>
  </div>
</div>

${solicitud?`<div class="section-label">Solicitud del cliente</div><div class="solicitud-box">${escH(solicitud)}</div>`:''}

<div class="section-label">Detalle de productos / servicios</div>
<table class="items">
  <thead><tr><th>Descripción</th><th style="text-align:center">Cant.</th><th style="text-align:right">Precio</th></tr></thead>
  <tbody>${itemsHTML}</tbody>
</table>

<div class="section-label">Proceso de producción</div>
<table class="spec-table">
  ${specRow('Impresora / Equipo',data.impresora)}
  ${specRow('Altura de capa',data.altaCapa)}
  ${specRow('% Relleno',data.relleno)}
  ${specRow('Soportes',data.soportes)}
  ${specRow('Tiempo estimado',data.tiempo)}
</table>

${data.notas?`<div class="section-label">Notas de producción</div><div class="solicitud-box" style="background:#fffbf0;border-color:rgba(255,170,0,0.3)">${escH(data.notas)}</div>`:''}

<div class="qa-box">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
    <span style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#555">Control de Calidad</span>
    ${qaBadge}
  </div>
  ${qaList}
</div>

<div class="firma-grid">
  <div class="firma-box"><div class="firma-line">Producción</div></div>
  <div class="firma-box"><div class="firma-line">Control de calidad</div></div>
  <div class="firma-box"><div class="firma-line">${escH(data.aprobado||'Aprobado por')}</div></div>
</div>

<div class="footer">
  <div class="left">The Lab Solutions SpA · Zaragoza 8882, Las Condes, Santiago<br>hola@thelab.solutions · +56 9 7180 6142 · thelab.solutions</div>
  <div class="right">Ficha Técnica ${escH(num)} · Generada ${escH(fecha)}</div>
</div>
</body></html>`;
  return {html, num};
}

function generarFichaTecnica(pedidoId){
  const res=buildFichaDoc(pedidoId);if(!res){toast('Pedido no encontrado','error');return;}
  const blob=new Blob([res.html],{type:'text/html;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const win=window.open(url,'_blank');
  if(!win) toast('Permite ventanas emergentes','error');
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}

function descargarFichaTecnica(pedidoId){
  const res=buildFichaDoc(pedidoId);if(!res){toast('Pedido no encontrado','error');return;}
  const htmlWithPrint=res.html.replace('</body></html>','<script>window.onload=function(){window.focus();window.print();};<\/script></body></html>');
  const blob=new Blob([htmlWithPrint],{type:'text/html;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const win=window.open(url,'_blank');
  if(!win){toast('Permite ventanas emergentes para descargar el PDF','error');return;}
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

// ── FICHA TÉCNICA TLS: PLANTILLA OFICIAL (A4 vertical, 2 páginas) ──────
// Réplica de ~/.claude/skills/ficha-tecnica-tls/render.mjs. La fuente de verdad
// visual es el PDF del trofeo Hospital Militar del Norte (02-11-2026): mismas
// medidas, Lato, negro #0D0D0E + cian #02B2C1 y el mismo pie. Tamaños y
// márgenes calibrados contra ese PDF (hecho con WeasyPrint) midiendo cada línea
// con pdftotext -bbox: en Chrome calzan a ±1,2 pt. Si cambia la skill, cambia
// aquí también.
// En "Ficha Propuesta" (Cotizaciones) se guarda el JSON de la skill sin imágenes:
//   {v:2, fichas:[{encabezado,pagina1,pagina2}], logoCliente, updatedAt}
// Una ficha (2 páginas) por producto. Las imágenes no caben en la celda de
// Airtable (100.000 caracteres): viven en el caché local del navegador.
// La ficha antigua {numFicha,nombreProyecto,items:[...]} se sigue leyendo.
const FT_PIE=['The Lab Solutions · Fabricación personalizada para marcas','thelab.solutions · hola@thelab.solutions · +56 9 2878 5039'];
const FT_IMG_SLOTS=['foto','foto2','frontal','lateral','plano','detalle'];

function _ftBase(){try{if(/^https?:/.test(location.origin)) return location.origin;}catch(e){}return 'https://dashboard.thelab.solutions';}
// Fecha de hoy en Chile (dd-mm-aaaa). hoyCL vive en index.html; sin él, la fecha local, nunca la UTC.
function _ftHoy(){
  if(typeof hoyCL==='function') return hoyCL().split('-').reverse().join('-');
  const d=new Date();return [d.getDate(),d.getMonth()+1].map(n=>String(n).padStart(2,'0')).join('-')+'-'+d.getFullYear();
}
function _ftIsoADmy(s){const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}-${m[2]}-${m[1]}`:'';}

function ftNuevaFicha(ctx={}){
  return {
    encabezado:{tipo:ctx.producto||'',tipo_corto:'',destacado:ctx.cliente||'',
      meta:[['Cliente',ctx.cliente||''],['Producto',ctx.producto||''],['Línea',''],['Cantidad',ctx.cantidad||''],['Fecha',ctx.fecha||_ftHoy()]]},
    pagina1:{fotos:[{fondo:'gris',ajuste:'contain'},{fondo:'',ajuste:'cover'}],foto_nota:'Imagen referencial.',
      en_simple:['',''],chips:['','',''],resumen_medidas:'',especificaciones:[],
      medidas:{alto:'',ancho:'',fondo:'',nota:'Medidas en cm. Ambas vistas a la misma escala.'}},
    pagina2:{componentes:{titulo:'Componentes del producto',items:[],nota:''},detalle:{titulo:'Detalle',nota:''},
      pasos:{titulo:'Cómo se arma',items:[],nota:''},glosario:[],cuidados:[]}
  };
}
// Rellena lo que falte (fichas a medio llenar o JSON pegado desde la skill) y
// deja solo encabezado/pagina1/pagina2: es también lo que se guarda.
function ftCompletar(f){
  const b=ftNuevaFicha(),o=(f&&typeof f==='object')?f:{},arr=(v,d)=>Array.isArray(v)?v:d;
  const e={...b.encabezado,...(o.encabezado||{})},p1={...b.pagina1,...(o.pagina1||{})},p2={...b.pagina2,...(o.pagina2||{})};
  p1.medidas={...b.pagina1.medidas,...(p1.medidas||{})};
  ['componentes','detalle','pasos'].forEach(k=>{p2[k]={...b.pagina2[k],...(p2[k]||{})};});
  e.meta=arr(e.meta,[]);
  ['fotos','en_simple','chips','especificaciones'].forEach(k=>{p1[k]=arr(p1[k],b.pagina1[k]);});
  p2.componentes.items=arr(p2.componentes.items,[]);p2.pasos.items=arr(p2.pasos.items,[]);
  p2.glosario=arr(p2.glosario,[]);p2.cuidados=arr(p2.cuidados,[]);
  return {encabezado:e,pagina1:p1,pagina2:p2};
}
function ftParaGuardar(it){return JSON.parse(JSON.stringify(ftCompletar(it)));}
// Ficha antigua (una "muestra" por producto): sus textos pasan a Especificaciones.
function _ftDesdeV1(it,d,ctx){
  const f=ftNuevaFicha({cliente:ctx.cliente,producto:it.nombre||'',fecha:_ftIsoADmy(d.updatedAt)||undefined});
  if(d.nombreProyecto) f.encabezado.meta[2]=['Proyecto',d.nombreProyecto];
  const specs=f.pagina1.especificaciones;
  const par=l=>{const i=l.indexOf(':');return i>0?[l.slice(0,i).trim(),l.slice(i+1).trim()]:['Material',l.trim()];};
  if(it.tipo) specs.push(['Técnica',it.tipo]);
  String(it.material||'').split('\n').filter(s=>s.trim()).forEach(l=>specs.push(par(l)));
  const alt=[it.optLabel,...String(it.optMaterial||'').split('\n')].map(s=>String(s||'').trim()).filter(Boolean);
  if(alt.length) specs.push(['Opción 2',alt.join(' · ')]);
  if(it.dims){specs.push(['Medida total',it.dims]);f.pagina1.resumen_medidas='Medidas: '+it.dims;}
  return f;
}
function ftNormalizar(d,ctx={}){
  const logo=(d&&typeof d.logoCliente==='string')?d.logoCliente:'';
  if(d&&Array.isArray(d.fichas)&&d.fichas.length) return {fichas:d.fichas.map(ftCompletar),logoCliente:logo,v1:false};
  if(d&&Array.isArray(d.items)&&d.items.length) return {fichas:d.items.map(it=>_ftDesdeV1(it||{},d,ctx)),logoCliente:logo,v1:true};
  return {fichas:[ftNuevaFicha(ctx)],logoCliente:logo,v1:false};
}
// Lo que la cotización ya sabe: cliente, primer producto y su cantidad. Nada más
// (la skill prohíbe inventar datos técnicos).
function ftCtxCotizacion(f){
  f=f||{};
  const cli=(typeof resolveClienteName==='function')?resolveClienteName(f['Cliente']):'';
  const linea=String(f['Detalle productos']||'').split('\n').filter(s=>s.trim())[0]||'';
  const p=linea.split('|').map(s=>s.trim());
  const n=parseFloat(String(p[1]||'').replace(',','.').replace(/[^\d.]/g,''));
  return {cliente:cli&&cli!=='—'?cli:'',producto:p[0]||'',cantidad:n>0?`${String(n).replace('.',',')} ${n===1?'unidad':'unidades'}`:''};
}

// Dibujo de MEDIDAS: vista frontal y lateral A LA MISMA ESCALA, cotas en cian y
// texto en cm (mismo trazo que el SVG del ejemplo de la skill). Sin alto y
// ancho no hay dibujo. Las imágenes, si hay, van dentro de cada vista.
function ftMedidasSvg(m,imgF,imgL){
  const num=v=>{const x=parseFloat(String(v??'').replace(',','.'));return x>0?x:0;};
  const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const H=num(m&&m.alto),W=num(m&&m.ancho),D=num(m&&m.fondo);
  if(!H||!W) return '';
  const cm=v=>esc(String(v).trim().replace(/\s*cm$/i,'').replace('.',','))+' cm',r=n=>Math.round(n*10)/10;
  const L=66,R=700,T=48,MAXH=350;
  let gap=D?80:0,s,w,h,d;
  // Los títulos miden ~190 u: las vistas se separan lo justo para que no se
  // pisen, y el centro de la lateral no pasa de x=625 para que su título no se corte.
  for(let k=0;k<4;k++){
    s=Math.min(MAXH/H,(R-L-gap)/(W+D),D?(620-L-gap)/(W+D/2):Infinity);w=W*s;h=H*s;d=D?Math.max(D*s,4):0;
    if(!D||w/2+gap+d/2>=190) break;
    gap=190-w/2-d/2;
  }
  const x0=L+Math.max(0,Math.min((R-L-(w+gap+d))/2,D?625-(L+w+gap+d/2):Infinity)),yb=T+h,x1=x0+w+gap,yc=yb+26;
  const vista=(src,x,wd)=>src
    ?`<image href="${esc(src)}" x="${r(x)}" y="${T}" width="${r(wd)}" height="${r(h)}" preserveAspectRatio="xMidYMid meet"/>`
    :`<rect x="${r(x)}" y="${T}" width="${r(wd)}" height="${r(h)}" fill="#e6e8ea" stroke="#9aa0a6" stroke-width="1.6"/>`;
  const horiz=(xa,xb)=>`<line x1="${r(xa)}" y1="${r(yc)}" x2="${r(xb)}" y2="${r(yc)}"/><line x1="${r(xa)}" y1="${r(yc-8)}" x2="${r(xa)}" y2="${r(yc+8)}"/><line x1="${r(xb)}" y1="${r(yc-8)}" x2="${r(xb)}" y2="${r(yc+8)}"/>`;
  const xv=x0-26;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 ${r(yb+70)}" font-family="Lato, Helvetica, Arial, sans-serif">
<g font-size="20" letter-spacing="2.6" fill="#5b5f63" text-anchor="middle"><text x="${r(x0+w/2)}" y="26">VISTA FRONTAL</text>${D?`<text x="${r(x1+d/2)}" y="26">VISTA LATERAL</text>`:''}</g>
${vista(imgF,x0,w)}${D?vista(imgL,x1,d):''}
<g stroke="#02b2c1" stroke-width="1.8" fill="none"><line x1="${r(xv)}" y1="${T}" x2="${r(xv)}" y2="${r(yb)}"/><line x1="${r(xv-8)}" y1="${T}" x2="${r(xv+8)}" y2="${T}"/><line x1="${r(xv-8)}" y1="${r(yb)}" x2="${r(xv+8)}" y2="${r(yb)}"/>${horiz(x0,x0+w)}${D?horiz(x1,x1+d):''}</g>
<g font-size="20" fill="#3c4044" text-anchor="middle"><text x="${r(x0+w/2)}" y="${r(yb+58)}">${cm(m.ancho)}</text>${D?`<text x="${r(x1+d/2)}" y="${r(yb+58)}">${cm(m.fondo)}</text>`:''}<text transform="translate(${r(xv-16)} ${r(T+h/2)}) rotate(-90)">${cm(m.alto)}</text></g>
</svg>`;
}
function _ftResumenAuto(m){
  const v=x=>String(x??'').trim().replace(/\s*cm$/i,'').replace('.',',');
  return [['Alto',m&&m.alto],['Ancho',m&&m.ancho],['Fondo',m&&m.fondo]].filter(([,x])=>v(x)).map(([k,x])=>`${k}: ${v(x)} cm`).join(' · ');
}

// HTML de la plantilla (un documento con 2 páginas por ficha). o.imgs[i] trae
// las imágenes de la ficha i: {foto, foto2, frontal, lateral, plano, detalle}.
function fichaTLSHtml(fichas,o={}){
  const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const txt=x=>String(x??'').trim();
  const lleno=a=>(Array.isArray(a)?a:[]).filter(x=>x&&typeof x==='object'?Object.values(x).some(txt):txt(x));
  const base=o.base||_ftBase(),logoTLS=esc(base+'/logo-thelab.png');
  const label=t=>`<div class="sec"><i></i>${esc(t)}</div>`;
  const footer=`<footer><span>${esc(FT_PIE[0])}</span><span>${esc(FT_PIE[1])}</span></footer>`;
  const marca=o.logoCliente?`<img class="logo-marca" src="${esc(o.logoCliente)}" alt="">`:'';
  const paginas=(fichas||[]).map((fi,idx)=>{
    const F=ftCompletar(fi),e=F.encabezado,p1=F.pagina1,p2=F.pagina2,img=(o.imgs&&o.imgs[idx])||{};
    const meta=e.meta.filter(r=>Array.isArray(r)&&txt(r[1])).slice(0,5);
    const fotos=[img.foto,img.foto2].map((src,i)=>({...(p1.fotos[i]||{}),src})).filter(x=>x.src);
    const fotoHtml=!fotos.length?'':`<figure class="foto">${fotos.map(x=>`<div class="foto-img${x.fondo==='gris'||x.fondo==='oscuro'?' '+x.fondo:''}" style="flex:${+x.alto>0?+x.alto:1}"><img src="${esc(x.src)}" style="object-fit:${x.ajuste==='cover'?'cover':'contain'};object-position:${/^[\w%. -]+$/.test(x.posicion||'')?x.posicion:'center'}" alt=""></div>`).join('')}<figcaption>${esc(txt(p1.foto_nota)||'Imagen referencial.')}</figcaption></figure>`;
    const parrafos=lleno(p1.en_simple),chips=lleno(p1.chips).slice(0,3);
    const resumen=txt(p1.resumen_medidas)||_ftResumenAuto(p1.medidas);
    const simple=!(parrafos.length||chips.length||resumen)?'':`<div class="simple">
        ${parrafos.length?label('En simple'):''}
        ${parrafos.map(t=>`<p>${esc(t)}</p>`).join('')}
        ${chips.length?`<div class="chips">${chips.map(c=>`<div>${esc(c)}</div>`).join('')}</div>`:''}
        ${resumen?`<div class="resumen">${esc(resumen)}</div>`:''}
      </div>`;
    const specs=lleno(p1.especificaciones).filter(r=>Array.isArray(r));
    const dibujo=img.plano?`<img src="${esc(img.plano)}" alt="">`:ftMedidasSvg(p1.medidas,img.frontal,img.lateral);
    const pagina1=`<section class="pagina">
  <header class="h1">
    <div class="h1-top"><img class="logo" src="${logoTLS}" alt="The Lab Solutions"><div class="sello">Ficha técnica</div></div>
    <div class="titulo-row"><h1>${esc(e.tipo)}<span>${esc(e.destacado)}</span></h1>${marca}</div>
    ${meta.length?`<div class="meta">${meta.map(([k,v])=>`<div><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('')}</div>`:''}
  </header>
  <div class="cuerpo">
    ${fotoHtml||simple?`<div class="intro">${fotoHtml}${simple}</div>`:''}
    ${specs.length||dibujo?`<div class="dos">
      ${specs.length?`<div class="specs">${label('Especificaciones')}
        <table>${specs.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
      </div>`:''}
      ${dibujo?`<div class="medidas">${label('Medidas')}
        <div class="caja">${dibujo}<div class="nota-caja">${esc(p1.medidas.nota)}</div></div>
      </div>`:''}
    </div>`:''}
  </div>
  ${footer}
</section>`;
    const comps=lleno(p2.componentes.items).filter(c=>c&&typeof c==='object'&&!Array.isArray(c));
    const pasos=lleno(p2.pasos.items),glos=lleno(p2.glosario).filter(g=>typeof g==='object'),cuid=lleno(p2.cuidados);
    const det=img.detalle?`<div class="det">${label(txt(p2.detalle.titulo)||'Detalle')}<div class="caja"><img src="${esc(img.detalle)}" alt=""><div class="nota-caja">${esc(p2.detalle.nota)}</div></div></div>`:'';
    const pas=pasos.length?`<div class="pasos">${label(txt(p2.pasos.titulo)||'Cómo se arma')}<ol>${pasos.map((t,i)=>`<li><b>${i+1}</b><span>${esc(t)}</span></li>`).join('')}</ol>${txt(p2.pasos.nota)?`<div class="destacado">${esc(p2.pasos.nota)}</div>`:''}</div>`:'';
    if(!(comps.length||det||pas||glos.length||cuid.length)) return pagina1;
    return pagina1+`<section class="pagina">
  <header class="h2"><img class="logo" src="${logoTLS}" alt="The Lab Solutions"><div>Ficha técnica · ${esc(txt(e.tipo_corto)||e.tipo)} <span>${esc(e.destacado)}</span> · 2/2</div></header>
  <div class="cuerpo">
    ${comps.length?`${label(txt(p2.componentes.titulo)||'Componentes')}
    <div class="comps">${comps.map((c,i)=>`<div class="comp"><div class="n">${String(i+1).padStart(2,'0')}</div><div class="nom">${esc(c.nombre)}</div><p>${esc(c.desc)}</p>${txt(c.chip)?`<div class="chip">${esc(c.chip)}</div>`:''}</div>`).join('')}</div>
    ${txt(p2.componentes.nota)?`<div class="nota">${esc(p2.componentes.nota)}</div>`:''}`:''}
    ${det||pas?`<div class="dos d2">${det}${pas}</div>`:''}
    ${glos.length?`${label('Glosario para entender la ficha')}<div class="glos">${glos.map(g=>`<div><h3>${esc(g.termino)}</h3><p>${esc(g.def)}</p></div>`).join('')}</div>`:''}
    ${cuid.length?`${label('Cuidados')}<ul class="cuid">${cuid.map(c=>`<li>${esc(c)}</li>`).join('')}</ul>`:''}
  </div>
  ${footer}
</section>`;
  }).join('\n');
  const font=w=>`@font-face{font-family:'Lato';font-style:normal;font-weight:${w};src:url(${base}/assets/fonts/Lato-${w}.woff2) format('woff2');}`;
  // Las variables van en .ft y no en :root, la vista previa cuelga de
  // body.ft-preview, el aviso se oculta por CSS (no con [hidden], que el escudo
  // all:revert anula) y el salto de página va solo en @media print (html2pdf lo
  // convierte en una hoja en blanco): así el PDF de Drive (_fichaHTMLtoPdfBlob)
  // conserva los colores y no suma márgenes, barras ni páginas vacías.
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${esc(o.titulo||'Ficha técnica')}</title>
<link rel="icon" href="${esc(base)}/isotipo-thelab.png">
<style>
${font(400)}${font(700)}${font(900)}
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#fff}
.ft{--ink:#0d0d0e;--cian:#02b2c1;--g1:#f6f7f7;--g2:#eef0f1;--linea:#cfd2d5;--txt:#1d1d1f;--gris:#5b5f63;font-family:'Lato',Helvetica,Arial,sans-serif;color:var(--txt);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pagina{width:210mm;height:297mm;position:relative;overflow:hidden;background:#fff}
.logo{display:block;height:auto}
.h1{background:var(--ink);color:#fff;padding:11.3mm 14mm 1mm;border-bottom:1.7mm solid var(--cian)}
.h1-top{display:flex;justify-content:space-between;align-items:flex-start}
.h1 .logo{width:70mm;margin-top:0}
.sello{border:.4mm solid var(--cian);color:var(--cian);font-weight:700;font-size:7.4pt;letter-spacing:.42em;text-transform:uppercase;width:54mm;height:9.5mm;display:flex;align-items:center;justify-content:center;padding-left:.42em;margin-top:.7mm}
.titulo-row{display:flex;justify-content:space-between;align-items:flex-end;margin-top:4.6mm}
h1{font-weight:900;font-size:19.5pt;line-height:1.16;letter-spacing:-.005em}
h1 span{display:block;color:var(--cian);text-transform:uppercase}
.logo-marca{max-height:15mm;max-width:45mm;object-fit:contain}
.meta{display:flex;gap:9mm;margin-top:4.6mm}
.meta b{display:block;color:var(--cian);font-weight:700;font-size:6.4pt;letter-spacing:.14em;text-transform:uppercase;margin-bottom:1.2mm}
.meta span{font-size:9.4pt;white-space:nowrap}
.cuerpo{padding:7mm 14mm 0}
.cuerpo>:first-child{margin-top:0}
.sec{display:flex;align-items:center;gap:3.1mm;color:var(--cian);font-weight:700;font-size:7.4pt;letter-spacing:.42em;text-transform:uppercase}
.sec i{display:block;width:2.4mm;height:2.4mm;background:var(--cian)}
.intro{display:flex;gap:8.6mm;align-items:flex-start}
.foto{width:50mm;height:88.5mm;border:.35mm solid #d6d8da;display:flex;flex-direction:column;flex:none;background:#fff}
.foto-img{min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#fff}
.foto-img.gris{background:linear-gradient(160deg,#f4f5f6,#e3e6e8)}
.foto-img.oscuro{background:linear-gradient(160deg,#5d5f62,#2a2b2d)}
.foto-img img{width:100%;height:100%;display:block}
.foto figcaption{font-size:6.8pt;color:var(--gris);padding:2.3mm 2.4mm;border-top:.35mm solid #e2e4e6;flex:none}
.simple{flex:1;padding-top:.5mm}
.simple p{font-size:9.8pt;line-height:1.56;margin-top:2.6mm}
.simple .sec+p{margin-top:4.4mm}
.chips{display:grid;grid-template-columns:repeat(3,1fr);gap:2mm;margin-top:3mm}
.chips div{background:var(--g2);border-left:1.4mm solid var(--cian);font-weight:900;font-size:7.6pt;padding:0 3.2mm;height:10.4mm;display:flex;align-items:center}
.resumen{background:var(--g2);font-size:8.9pt;padding:0 3.6mm;height:11.5mm;display:flex;align-items:center;margin-top:1.9mm}
.dos{display:flex;gap:8mm;margin-top:7.7mm}
.specs{width:95mm;flex:none}
.medidas{flex:1}
.specs table{width:100%;border-collapse:collapse;margin-top:4.5mm}
.specs td{font-size:8.3pt;padding:1.9mm 0;border-bottom:.35mm solid var(--linea);vertical-align:top;line-height:1.3}
.specs td:first-child{color:var(--gris);width:29mm}
.specs td:last-child{font-weight:700}
.caja{border:.35mm solid #d0d3d6;background:var(--g1);margin-top:4.5mm;padding:3.6mm 3.4mm 3mm}
.caja svg,.caja img{display:block;width:100%;height:auto}
.nota-caja{font-size:6.6pt;color:var(--gris);text-align:center;margin-top:1.6mm}
footer{position:absolute;left:0;right:0;bottom:0;height:14mm;background:var(--ink);color:#fff;font-size:7.6pt;display:flex;justify-content:space-between;align-items:center;padding:0 14mm}
.h2{background:var(--ink);color:#fff;height:20.3mm;border-bottom:1.7mm solid var(--cian);display:flex;justify-content:space-between;align-items:center;padding:2.3mm 14mm 0;font-size:8.9pt}
.h2 .logo{width:61mm}
.h2 span{color:var(--cian);text-transform:uppercase}
.pagina .h2+.cuerpo{padding-top:9.6mm}
.comps{display:grid;grid-template-columns:repeat(3,1fr);gap:2.6mm 3mm;margin-top:4.6mm}
.comp{background:var(--g2);border-top:1.2mm solid var(--cian);padding:3mm 3mm 2.5mm}
.comp .n{color:var(--cian);font-weight:900;font-size:12.5pt;line-height:1}
.comp .nom{font-weight:900;font-size:8.8pt;margin-top:1.6mm}
.comp p{font-size:7.6pt;color:#55595d;line-height:1.42;margin-top:1.2mm}
.comp .chip{display:inline-block;background:#fff;font-weight:900;font-size:7pt;padding:1.6mm 2mm;margin-top:1.8mm}
.nota{font-size:6.8pt;color:var(--gris);margin-top:3.2mm}
.d2{margin-top:7.1mm;gap:8mm}
.det{width:72mm;flex:none}
.pasos{flex:1}
.pasos ol{list-style:none;margin-top:4.4mm}
.pasos li{display:flex;gap:3.6mm;align-items:flex-start;font-size:8.7pt;line-height:1.42;margin-bottom:2.2mm}
.pasos li b{flex:none;width:4.6mm;height:4.6mm;background:var(--ink);color:#fff;font-size:7pt;display:flex;align-items:center;justify-content:center;margin-top:.27mm}
.destacado{background:var(--g2);font-size:8.5pt;line-height:1.5;padding:3mm;margin-top:2.6mm}
.glos{display:grid;grid-template-columns:repeat(3,1fr);gap:7mm;margin-top:4.5mm;margin-bottom:6.4mm}
.glos div{border-top:.6mm solid var(--ink);padding-top:3.1mm}
.glos h3{font-weight:900;font-size:9.4pt}
.glos p{font-size:8.3pt;line-height:1.5;margin-top:1.6mm}
.det+.pasos,.pasos:only-child{min-width:0}
.d2+.sec,.nota+.dos{margin-top:6.7mm}
.dos.d2+.sec{margin-top:6.5mm}
.comps+.sec,.nota+.sec{margin-top:6.7mm}
.cuid{list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:2.4mm 14mm;margin-top:4.5mm}
.cuid li{position:relative;padding-left:5.6mm;font-size:8.6pt;line-height:1.5}
.cuid li::before{content:'';position:absolute;left:0;top:1mm;width:2.6mm;height:2.6mm;background:var(--cian)}
body.ft-preview{background:#d9dcdf}
body.ft-preview .pagina{margin:6mm auto;box-shadow:0 2px 14px rgba(0,0,0,.18)}
.ft-aviso{display:none;position:sticky;top:0;z-index:5;background:#fff3cd;color:#664d03;font:600 13px/1.45 Helvetica,Arial,sans-serif;padding:10px 16px;text-align:center;border-bottom:1px solid #e6c766}
.ft-aviso.on{display:block}
.ft-aviso button{margin-left:12px;font:700 12px Helvetica,Arial,sans-serif;padding:4px 10px;cursor:pointer}
@media print{body.ft-preview{background:#fff}body.ft-preview .pagina{margin:0;box-shadow:none}.ft-aviso{display:none!important}
.pagina{page-break-after:always;break-after:page}.pagina:last-child{page-break-after:auto;break-after:auto}}
</style></head><body class="ft-preview">
<div class="ft-aviso" id="ftAviso"></div>
<div class="ft">
${paginas}
</div>
<script>
// Cada página es una hoja A4 fija: si el texto no cabe, se monta sobre el pie
// (o se corta). Mismo control que render.mjs, avisado en pantalla.
window.ftRevisar=function(){
  var malas=[];
  document.querySelectorAll('.ft .pagina').forEach(function(pg,i){
    var pie=pg.querySelector('footer'),hijos=pg.querySelectorAll('.cuerpo > *'),ult=hijos[hijos.length-1];
    if(pie&&ult&&ult.getBoundingClientRect().bottom>pie.getBoundingClientRect().top-2) malas.push(i+1);
  });
  var av=document.getElementById('ftAviso');
  if(av&&malas.length){av.classList.add('on');av.textContent='⚠ El contenido se monta sobre el pie en la(s) página(s) '+malas.join(', ')+'. Acorta textos o filas en la ficha antes de enviarla.';}
  return malas;
};
(document.fonts?document.fonts.ready:Promise.resolve()).then(function(){window.ftRevisar();});
<\/script>
</body></html>`;
}

// ── FICHA PROPUESTA AL CLIENTE (modal) ────────────────────────
let _fpCotId='';
let _fpItems=[];       // una ficha por producto + img/prompts de la sesión (no se guardan en Airtable)
let _fpIdx=0;          // producto que se está editando
let _fpLogoCliente='';
let _fpRawImages={};
const _fpAbiertas=new Set(['enc']);

function parseFichaPropData(s){try{return s?JSON.parse(s):null;}catch(e){return null;}}
const _fpImgCompress=async(dataUrl,maxPx=700)=>{
  if(!dataUrl) return null;
  const img=new Image();img.src=dataUrl;
  await new Promise(r=>{img.onload=r;img.onerror=r;});
  const scale=Math.min(1,maxPx/Math.max(img.naturalWidth||maxPx,img.naturalHeight||maxPx));
  const w=Math.round((img.naturalWidth||maxPx)*scale),h=Math.round((img.naturalHeight||maxPx)*scale);
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const ctx=c.getContext('2d');
  // JPEG no tiene transparencia: sin fondo blanco, un PNG recortado sale negro.
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,w,h);
  ctx.drawImage(img,0,0,w,h);
  return c.toDataURL('image/jpeg',0.78);
};
async function saveFPImgCache(cotId){
  const cache={};
  for(let i=0;i<_fpItems.length;i++){
    const img=_fpItems[i].img||{};
    for(const c of FT_IMG_SLOTS){if(img[c]){try{cache[i+'_'+c]=await _fpImgCompress(img[c],c==='foto'||c==='foto2'?900:700);}catch(e){}}}
    if(_fpRawImages[i]?.dataUrl){try{cache[i+'_raw']=await _fpImgCompress(_fpRawImages[i].dataUrl,400);}catch(e){}}
  }
  // Estas imágenes se generaron con IA y cada una se cobra. Si no caben en el
  // navegador hay que decirlo: en silencio, al recargar desaparecen y se vuelven
  // a pagar sin que nadie sepa por qué.
  try{localStorage.setItem('fp_imgs_'+cotId,JSON.stringify(cache));}
  catch(e){
    console.warn('[fp cache] no se pudieron guardar las imágenes:',e&&e.message);
    try{toast('⚠ No se pudieron guardar las imágenes de la propuesta en este navegador (espacio lleno). Si recargas hay que volver a generarlas, y eso se cobra: descarga el PDF antes de salir.','error');}catch(_){}
  }
}
// Lee el caché local de imágenes de una cotización. Entiende las claves de la
// ficha antigua (imgFrontal/imgIsometrica/imgAerea) para no perder fotos ya pagadas.
function _fpLeerImgCache(cotId){
  let cache={};try{cache=JSON.parse(localStorage.getItem('fp_imgs_'+cotId)||'{}')||{};}catch(e){}
  const viejas={imgIsometrica:'foto',imgFrontal:'frontal',imgAerea:'lateral'},imgs=[],raw={};
  Object.keys(cache).forEach(k=>{
    const m=k.match(/^(\d+)_(\w+)$/);if(!m||!cache[k]) return;
    const i=+m[1],c=viejas[m[2]]||m[2];
    if(c==='raw'){raw[i]={dataUrl:cache[k]};return;}
    if(!FT_IMG_SLOTS.includes(c)) return;
    (imgs[i]=imgs[i]||{})[c]=cache[k];
    // En la ficha antigua la portada usaba la frontal si no había isométrica.
    if(m[2]==='imgFrontal'&&!cache[i+'_imgIsometrica']) imgs[i].foto=cache[k];
  });
  return {imgs,raw};
}
function loadFPImgCache(cotId){
  const {imgs,raw}=_fpLeerImgCache(cotId);
  _fpItems.forEach((item,i)=>{item.img={...(imgs[i]||{}),...(item.img||{})};});
  _fpRawImages={...raw,..._fpRawImages};
}

function openFichaPropModal(cotId){
  const cot=state.cotizacionesById[cotId];if(!cot) return;
  _fpCotId=cotId;
  const f=cot.fields;
  const data=ftNormalizar(parseFichaPropData(f['Ficha Propuesta']),ftCtxCotizacion(f));
  _fpItems=data.fichas.map(fi=>({...fi,img:{}}));
  _fpIdx=0;
  const av=document.getElementById('fpV1Aviso');if(av) av.style.display=data.v1?'block':'none';
  _fpLogoCliente=data.logoCliente||'';
  _fpRawImages={};
  loadFPImgCache(cotId);
  const lp=document.getElementById('fpLogoPrev'),lph=document.getElementById('fpLogoPh');
  if(_fpLogoCliente){if(lp){lp.src=_fpLogoCliente;lp.style.display='block';}if(lph) lph.style.display='none';}
  else{if(lp){lp.src='';lp.style.display='none';}if(lph) lph.style.display='flex';}
  renderFPItems();
  document.getElementById('fichaPropModal').style.display='flex';
  // Restore Drive button state if folder already exists
  const existingLink=localStorage.getItem('fp_drive_folder_'+cotId);
  const driveBtn=document.getElementById('fpDriveBtn');
  if(driveBtn){
    if(existingLink){driveBtn.textContent='📂 Ver en Drive';driveBtn.onclick=()=>window.open(existingLink,'_blank');}
    else{driveBtn.textContent='📁 Guardar en Drive';driveBtn.onclick=()=>guardarFichaEnDrive(_fpCotId);driveBtn.disabled=false;}
  }
}

function closeFichaPropModal(){document.getElementById('fichaPropModal').style.display='none';}
function openIAConfigModal(){
  // Migración de seguridad: OpenAI ya no acepta claves en el navegador.
  localStorage.removeItem('fp_openai_key');
  const o=document.getElementById('iaOpenaiKey');
  if(o){o.value='';o.disabled=true;o.placeholder='Gestionada por Proxy Worker';}
  document.getElementById('iaConfigModal').style.display='flex';
}
function closeIAConfigModal(){document.getElementById('iaConfigModal').style.display='none';}
async function testIAKey(){
  const res=document.getElementById('iaTestResult');
  if(!res) return;
  localStorage.removeItem('fp_openai_key');
  const px=(typeof _proxyCfg==='function')?_proxyCfg():null;
  res.style.display='block';
  if(!px){
    res.style.background='#f8d7da';res.style.color='#721c24';
    res.textContent='❌ Configura Proxy Worker. OpenAI está bloqueado sin proxy.';
    return;
  }
  res.style.background='var(--surface2)';res.style.color='var(--text2)';
  res.textContent='🔄 Verificando proxy sin generar contenido...';
  try{
    const r=await _openaiFetch('/usage',{method:'GET'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    const d=await r.json();
    res.style.background='#d4edda';res.style.color='#155724';
    res.textContent='✅ OpenAI protegido por Proxy Worker · presupuesto IA activo'+
      (Number.isFinite(Number(d.remaining_usd))?' · saldo interno US$'+Number(d.remaining_usd).toFixed(2):'');
  }catch(e){
    res.style.background='#f8d7da';res.style.color='#721c24';
    res.textContent='❌ Proxy OpenAI no disponible: '+e.message;
  }
}
function saveIAConfig(){
  // Compatibilidad con el botón existente: nunca guarda secretos en localStorage.
  localStorage.removeItem('fp_openai_key');
  closeIAConfigModal();
  toast('OpenAI se gestiona únicamente por Proxy Worker','info');
}

// Reduce un data URL de imagen para que su base64 quepa HOLGADO en una celda de
// texto de Airtable (límite duro 100.000 chars — usamos ~70k para dejar margen al
// resto del JSON de la ficha). Baja la resolución conservando transparencia (PNG);
// si aún no entra, cae a JPEG (sin transparencia) con calidad decreciente.
function _fpFitLogo(dataUrl,maxChars=70000){
  return new Promise(resolve=>{
    if(!dataUrl) return resolve('');
    const img=new Image();
    img.onload=()=>{
      try{
        const scaleTo=max=>{ let w=img.naturalWidth||max,h=img.naturalHeight||max;
          if(w>max||h>max){const r=Math.min(max/w,max/h);w=Math.round(w*r);h=Math.round(h*r);}
          const c=document.createElement('canvas');c.width=Math.max(1,w);c.height=Math.max(1,h);
          c.getContext('2d').drawImage(img,0,0,w,h);return c; };
        for(const max of [360,300,240,200,160,120]){                 // PNG a resolución decreciente
          const png=scaleTo(max).toDataURL('image/png');
          if(png.length<=maxChars) return resolve(png);
        }
        const c=scaleTo(240);                                        // último recurso: JPEG
        for(const q of [0.8,0.6,0.45,0.3]){ const j=c.toDataURL('image/jpeg',q); if(j.length<=maxChars) return resolve(j); }
        return resolve(c.toDataURL('image/jpeg',0.3));
      }catch(_){ resolve(dataUrl.length<=maxChars?dataUrl:''); }
    };
    img.onerror=()=>resolve(dataUrl.length<=maxChars?dataUrl:'');
    img.src=dataUrl;
  });
}
function handleFPLogo(evt){
  const file=evt.target.files[0];if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    // Ajusta el logo para que quepa en el JSON de la ficha (Airtable) sin fallar el guardado.
    _fpFitLogo(e.target.result).then(dataUrl=>{
      _fpLogoCliente=dataUrl||'';
      const prev=document.getElementById('fpLogoPrev');if(prev){prev.src=_fpLogoCliente;prev.style.display=_fpLogoCliente?'block':'none';}
      const ph=document.getElementById('fpLogoPh');if(ph) ph.style.display=_fpLogoCliente?'none':'';
    });
  };
  reader.readAsDataURL(file);
}

function handleFPRawImage(evt,idx){
  const file=evt.target.files[0];if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    _fpRawImages[idx]={dataUrl:e.target.result,type:file.type};
    const prev=document.getElementById('fpRaw-'+idx);
    if(prev){prev.src=e.target.result;prev.style.display='block';}
    const ph=document.getElementById('fpRawPh-'+idx);
    if(ph) ph.style.display='none';
  };
  reader.readAsDataURL(file);
}

// OpenAI sale exclusivamente por el Worker: ninguna API key vive en el navegador.
function _openaiFetch(path,{method='POST',body=null,isForm=false}={}){
  const px=(typeof _proxyCfg==='function')?_proxyCfg():null;
  if(!px?.url||!px?.key) return Promise.reject(new Error('Proxy IA requerido'));
  const headers={'X-App-Key':px.key,'X-AI-Agent':'openai-dashboard'};
  if(!isForm) headers['Content-Type']='application/json';
  return fetch(px.url.replace(/\/$/,'')+'/openai'+path,{method,credentials:'include',headers,body});
}
function _openaiAvailable(){return !!(typeof _proxyCfg==='function'&&_proxyCfg());}

// Config de las 3 vistas: el prompt es EDITABLE por producto (si una sale mal se
// puede afinar y regenerar solo esa). El default está aquí; el editado se guarda
// en _fpItems[idx].prompts[campo]. Cada vista llena una imagen de la ficha: la
// isométrica es la foto principal y la frontal/lateral van dentro del dibujo de medidas.
const FP_VIEWS=[
  {campo:'frontal',label:'FRONTAL',prompt:'front view centered eye level'},
  {campo:'foto',label:'ISOMÉTRICA',prompt:'isometric 45-degree angle view'},
  {campo:'lateral',label:'LATERAL',prompt:'side profile view, 90-degree lateral angle from the right side, camera at eye level showing the full side of the product'}
];
function _fpDefaultPrompt(campo){const v=FP_VIEWS.find(x=>x.campo===campo);return v?v.prompt:'';}
function _fpGetPrompt(idx,campo){return (_fpItems[idx]&&_fpItems[idx].prompts&&_fpItems[idx].prompts[campo])||_fpDefaultPrompt(campo);}
function _fpSetPrompt(idx,campo,val){if(!_fpItems[idx])return;if(!_fpItems[idx].prompts)_fpItems[idx].prompts={};_fpItems[idx].prompts[campo]=val;}

// Quita el fondo LISO (típicamente negro o blanco) de una imagen: hace un
// flood-fill desde los bordes y vuelve transparentes los píxeles del fondo, para
// que la foto no se vea con un recuadro negro dentro de la ficha (fondo blanco).
// Si las 4 esquinas NO son un color uniforme (foto real con fondo con textura),
// deja la imagen intacta. Devuelve la misma dataUrl ante cualquier error.
// Normaliza la imagen de una vista para la ficha SIN destruir el producto.
// Aprendizaje: recortar el fondo por color se come los productos claros (p.ej.
// un soporte impreso en blanco sobre fondo crema queda borrado). Por eso ya NO
// recortamos el fondo de fotos reales: se muestran tal cual (su fondo liso claro
// se ve profesional en la ficha). Sólo aplanamos la transparencia sobre blanco
// para que nunca aparezca un fondo negro en el PDF.
async function _fpRemoveBg(dataUrl){
  try{
    if(!dataUrl||typeof dataUrl!=='string'||dataUrl.indexOf('data:image')!==0) return dataUrl;
    const img=new Image();img.crossOrigin='anonymous';img.src=dataUrl;
    await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;});
    const w=img.naturalWidth||1024,h=img.naturalHeight||1024;
    const c=document.createElement('canvas');c.width=w;c.height=h;
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    const id=ctx.getImageData(0,0,w,h);const d=id.data;
    // ¿Tiene transparencia? (algún píxel con alfa < 250)
    let transp=false;
    for(let i=3;i<d.length;i+=4){ if(d[i]<250){ transp=true; break; } }
    if(!transp) return dataUrl;   // foto opaca (producto real): NO tocar
    // PNG con transparencia (p.ej. vista generada): aplánalo sobre blanco.
    const out=document.createElement('canvas');out.width=w;out.height=h;
    const octx=out.getContext('2d');octx.fillStyle='#ffffff';octx.fillRect(0,0,w,h);
    octx.drawImage(c,0,0);
    return out.toDataURL('image/png');
  }catch(e){console.warn('[_fpRemoveBg]',e);return dataUrl;}
}

// Aplana sobre blanco las imágenes con transparencia de todas las fichas ya
// cargadas en _fpItems. Se llama al abrir/descargar la ficha para que las
// fotos subidas antes de este arreglo también salgan sin fondo negro.
async function _fpNormalizeImages(){
  for(const it of (_fpItems||[])){
    if(!it||!it.img) continue;
    for(const campo of FT_IMG_SLOTS){
      const v=it.img[campo];
      if(v&&typeof v==='string'&&v.indexOf('data:image')===0){
        try{ it.img[campo]=await _fpRemoveBg(v); }catch(_){}
      }
    }
  }
}

// idx: muestra. onlyCampo (opcional): regenerar SOLO esa vista con su prompt editado.
async function generarVistasIA(idx, onlyCampo){
  const openaiKey=getOpenAIKey();
  const aiOk=_openaiAvailable();
  const rawImg=_fpRawImages[idx];
  const statusEl=document.getElementById('fpAiStatus-'+idx);
  const setStatus=msg=>{if(statusEl){statusEl.style.display='block';statusEl.innerHTML=msg;}};
  const btn=document.getElementById(onlyCampo?('fpRegenBtn-'+idx+'-'+onlyCampo):('fpGenBtn-'+idx));
  const _btnOrig=btn?btn.textContent:(onlyCampo?'🔄 Regenerar':'✨ Generar 3 vistas');
  if(btn){btn.disabled=true;btn.textContent='Generando...';}
  try{
    // Descripción del producto (para el fallback de texto): se cachea por muestra,
    // así al regenerar UNA vista no se vuelve a llamar a GPT-4o.
    let descripcion=(_fpItems[idx]&&_fpItems[idx]._descripcion)||'';
    if(!descripcion&&rawImg&&aiOk){
      setStatus('🔍 Analizando imagen con GPT-4o...');
      try{
        const visionRes=await _openaiFetch('/v1/chat/completions',{
          body:JSON.stringify({model:'gpt-4o-mini',max_tokens:150,messages:[{role:'user',content:[
            {type:'image_url',image_url:{url:rawImg.dataUrl,detail:'low'}},
            {type:'text',text:'Describe this product concisely for a luxury product photography prompt. Include: product type, materials, colors, shape, key features. English only, max 50 words, no punctuation at end.'}
          ]}]})
        });
        if(visionRes.ok){const d=await visionRes.json();descripcion=d.choices[0].message.content.trim();}
        else{const e=await visionRes.json();setStatus('⚠️ GPT-4o: '+(e.error?.message||visionRes.statusText));}
      }catch(ve){setStatus('⚠️ Visión: '+ve.message);}
    }
    if(!descripcion){
      const enc=(_fpItems[idx]&&_fpItems[idx].encabezado)||{};
      descripcion=(enc.tipo||'product')+(enc.destacado?' '+enc.destacado:'');
    }
    descripcion=descripcion.slice(0,150);
    if(_fpItems[idx]) _fpItems[idx]._descripcion=descripcion;   // cache
    // Vistas con el prompt EDITABLE de cada una; si onlyCampo, solo esa.
    const views=FP_VIEWS.map(v=>({campo:v.campo,label:v.label,prompt:_fpGetPrompt(idx,v.campo)}))
      .filter(v=>!onlyCampo||v.campo===onlyCampo);
    const genImgCanvas=(label,nombre)=>{
      const c=document.createElement('canvas');c.width=512;c.height=512;
      const x=c.getContext('2d');
      const g=x.createLinearGradient(0,0,512,512);g.addColorStop(0,'#f0fffe');g.addColorStop(1,'#e0f7f7');
      x.fillStyle=g;x.fillRect(0,0,512,512);
      x.fillStyle='#00c8cc';x.fillRect(0,0,512,60);
      x.fillStyle='#fff';x.font='bold 28px Arial';x.textAlign='center';x.fillText(label,256,40);
      x.strokeStyle='#00c8cc';x.lineWidth=4;x.strokeRect(2,2,508,508);
      x.fillStyle='#1a1a1a';x.font='bold 22px Arial';x.fillText(nombre.slice(0,30),256,180);
      x.fillStyle='#aaa';x.font='14px Arial';x.fillText('Vista generada con IA',256,340);
      x.fillStyle='#00c8cc';x.font='bold 12px Arial';x.fillText('THE LAB SOLUTIONS',256,420);
      return c.toDataURL('image/png');
    };
    const toPngBlob=async(dataUrl)=>{
      const img=new Image();img.src=dataUrl;
      await new Promise(r=>{img.onload=r;img.onerror=r;});
      const iw=img.naturalWidth||512,ih=img.naturalHeight||512;
      const scale=Math.min(1,1024/Math.max(iw,ih));
      const c=document.createElement('canvas');
      c.width=Math.max(1,Math.round(iw*scale));c.height=Math.max(1,Math.round(ih*scale));
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      return await new Promise(r=>c.toBlob(r,'image/png'));
    };
    const removeBackground=_fpRemoveBg;
    // Show shimmer on all 3 placeholders before starting
    views.forEach(v=>{
      const ph=document.getElementById('fpp-'+idx+'-'+v.campo);
      if(ph){ph.style.display='flex';ph.classList.add('fp-img-loading');ph.innerHTML='<div class="fp-spin-el"></div><span style="font-size:8px;color:#0097a7">Generando...</span>';}
      const im=document.getElementById('fpi-'+idx+'-'+v.campo);
      if(im) im.style.display='none';
    });
    let usedAI=false;
    let lastDallEError='';
    for(const v of views){
      if(btn) btn.textContent='Vista '+v.label+'...';
      setStatus('🎨 Generando '+v.label+'...');
      let imgData=null;
      if(aiOk){
        // Bloque 1: edits con foto del producto (para consistencia entre vistas)
        if(rawImg){
          try{
            setStatus('🎨 '+v.label+': enviando foto a gpt-image-1...');
            const pngBlob=await toPngBlob(rawImg.dataUrl);
            const fd=new FormData();
            fd.append('image',new File([pngBlob],'product.png',{type:'image/png'}));
            fd.append('prompt','Show this exact same product from '+v.prompt+'. Pure white background (#FFFFFF), background completely removed. The ENTIRE product must be fully visible and NOT cropped — leave generous white margins around all sides. Product occupies about 65% of the frame, centered. Professional studio product photography. Preserve exact design, colors, text, logo, shape.');
            fd.append('model','gpt-image-1');
            fd.append('n','1');
            fd.append('size','1024x1024');
            fd.append('quality','low');
            const r=await _openaiFetch('/v1/images/edits',{body:fd,isForm:true});
            if(r.ok){
              const d=await r.json();
              imgData='data:image/png;base64,'+d.data[0].b64_json;
              usedAI=true;
            }else{
              const e=await r.json();
              lastDallEError='edits: '+(e.error?.message||r.status);
              setStatus('⚠️ '+lastDallEError);
            }
          }catch(editErr){
            lastDallEError='edits exception: '+editErr.message;
            console.error('[IA edits]',editErr);
            setStatus('⚠️ '+lastDallEError);
          }
        }
        // Bloque 2: fallback texto (sin foto, o si edits falló)
        if(!imgData){
          try{
            setStatus('🎨 Generando '+v.label+' desde texto...');
            const fullPrompt='Entire product fully visible, NOT cropped, generous white margins on all sides, product centered at 65% of frame. '+v.prompt+'. Pure white background (#FFFFFF), background removed, no shadows. Product: '+descripcion.slice(0,200);
            const r=await _openaiFetch('/v1/images/generations',{
              body:JSON.stringify({model:'gpt-image-1',prompt:fullPrompt,n:1,size:'1024x1024',quality:'low'})
            });
            if(!r.ok){
              const e1=await r.json();
              throw new Error('gpt-image-1: '+(e1.error?.message||r.statusText));
            }
            const d=await r.json();
            imgData=d.data[0].b64_json?'data:image/png;base64,'+d.data[0].b64_json:null;
            if(!imgData&&d.data[0].url){
              const blob=await(await fetch(d.data[0].url)).blob();
              imgData=await new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.readAsDataURL(blob);});
            }
            if(imgData){usedAI=true;console.log('[IA generacion] OK',v.label);}
            else{console.warn('[IA generacion] no imgData',d);}
          }catch(genErr){
            lastDallEError=genErr.message;
            console.error('[IA generacion]',genErr);
            toast('Error IA: '+genErr.message,'error');
            setStatus('❌ '+genErr.message);
          }
        }
      }
      if(imgData&&usedAI){
        try{setStatus('✂️ '+v.label+': eliminando fondo...');imgData=await removeBackground(imgData);}
        catch(rbErr){console.warn('[removeBackground]',rbErr);}
      }
      if(!imgData) imgData=genImgCanvas(v.label,_fpItems[idx]?.encabezado?.tipo||descripcion);
      if(_fpItems[idx]) (_fpItems[idx].img=_fpItems[idx].img||{})[v.campo]=imgData;
      const prev=document.getElementById('fpi-'+idx+'-'+v.campo);
      if(prev){prev.src=imgData;prev.style.display='block';prev.classList.remove('fp-img-done');void prev.offsetWidth;prev.classList.add('fp-img-done');}
      const ph=document.getElementById('fpp-'+idx+'-'+v.campo);
      if(ph){ph.classList.remove('fp-img-loading');ph.style.display='none';ph.innerHTML='<span style="font-size:18px">📷</span><span style="font-size:8px">Subir foto</span>';}
    }
    if(usedAI){
      setStatus('✅ ¡Vistas IA generadas con éxito!');
    }else if(lastDallEError){
      setStatus('⚠️ DALL-E falló: '+lastDallEError+'<br>Se usaron placeholders Canvas. Verifica tu API key en 🔑 Config IA.');
    }else{
      setStatus('✅ Vistas generadas (sin API key — usando placeholders)');
    }
    setTimeout(()=>{if(statusEl) statusEl.style.display='none';},10000);
  }catch(e){
    setStatus('❌ '+e.message);
    toast('Error IA: '+e.message,'error');
  }finally{
    if(btn){btn.disabled=false;btn.textContent=_btnOrig;}
  }
}

function _fpCtx(){const cot=state.cotizacionesById[_fpCotId];return cot?ftCtxCotizacion(cot.fields):{};}
function addFPItem(){
  const nueva=ftNuevaFicha({cliente:_fpCtx().cliente});
  // Mismo cliente o marca destacada que el primer producto.
  if(_fpItems[0]) nueva.encabezado.destacado=_fpItems[0].encabezado.destacado;
  _fpItems.push({...nueva,img:{}});
  _fpIdx=_fpItems.length-1;
  renderFPItems();
}

function removeFPItem(idx){
  if(_fpItems.length<=1||!confirm('¿Quitar este producto de la ficha?')) return;
  _fpItems.splice(idx,1);
  // La foto de referencia de la IA va por índice: se corre junto con las fichas.
  const raw={};
  Object.keys(_fpRawImages).forEach(k=>{const i=+k;if(i<idx) raw[i]=_fpRawImages[k];else if(i>idx) raw[i-1]=_fpRawImages[k];});
  _fpRawImages=raw;
  _fpIdx=Math.min(_fpIdx,_fpItems.length-1);
  renderFPItems();
}
function _fpIrA(i){_fpIdx=i;renderFPItems();}

function handleFPImage(evt,idx,campo){
  const file=evt.target.files[0];if(!file) return;
  const reader=new FileReader();
  reader.onload=async e=>{
    const it=_fpItems[idx];if(!it) return;
    it.img=it.img||{};
    // Aplana la transparencia sobre blanco para que no salga un recuadro negro en la ficha
    try{it.img[campo]=(await _fpRemoveBg(e.target.result))||e.target.result;}catch(_){it.img[campo]=e.target.result;}
    renderFPItems();
  };
  reader.readAsDataURL(file);
}
function _fpQuitarImg(idx,campo){if(_fpItems[idx]&&_fpItems[idx].img){delete _fpItems[idx].img[campo];renderFPItems();}}

// Edición: cada campo escribe en la ficha abierta por su ruta ("pagina1.medidas.alto").
function _fpGet(o,path){return path.split('.').reduce((a,k)=>a==null?a:a[k],o);}
function _fpSet(path,val){
  const ks=path.split('.');let o=_fpItems[_fpIdx];if(!o) return;
  for(let i=0;i<ks.length-1;i++){if(o[ks[i]]==null||typeof o[ks[i]]!=='object') o[ks[i]]=/^\d+$/.test(ks[i+1])?[]:{};o=o[ks[i]];}
  o[ks[ks.length-1]]=val;
}
// Listas que se editan como texto, una entrada por línea.
const _fpLineas=t=>String(t||'').split('\n').map(s=>s.trim()).filter(Boolean);
const _fpPar=l=>{const i=l.indexOf(':');return i<0?[l,'']:[l.slice(0,i).trim(),l.slice(i+1).trim()];};
const FP_LISTAS={
  lineas:{parse:_fpLineas,txt:a=>(a||[]).join('\n')},
  pares:{parse:t=>_fpLineas(t).map(_fpPar),txt:a=>(a||[]).map(r=>Array.isArray(r)?(r[1]?r[0]+': '+r[1]:r[0]):String(r)).join('\n')},
  comps:{parse:t=>_fpLineas(t).map(l=>{const p=l.split('|').map(s=>s.trim());return {nombre:p[0]||'',desc:p[1]||'',chip:p.slice(2).join(' | ')};}),
    txt:a=>(a||[]).map(c=>[c.nombre,c.desc,c.chip].filter((x,i)=>i<2||x).join(' | ')).join('\n')},
  glos:{parse:t=>_fpLineas(t).map(l=>{const [termino,def]=_fpPar(l);return {termino,def};}),txt:a=>(a||[]).map(g=>g.def?g.termino+': '+g.def:g.termino).join('\n')}
};
function _fpSetLista(path,tipo,t){_fpSet(path,FP_LISTAS[tipo].parse(t));}
function _fpTabNombre(x){const e=(x&&x.encabezado)||{};return String(e.tipo_corto||e.tipo||'Producto').slice(0,26);}
function _fpSyncTab(){const b=document.querySelector('#fpItemsList .fp-tab.on');if(b) b.textContent=(_fpIdx+1)+' · '+_fpTabNombre(_fpItems[_fpIdx]);}

function _fpSlot(idx,c,lbl,alto){
  const src=((_fpItems[idx]||{}).img||{})[c]||'';
  return `<div><div class="fp-slot-lbl">${lbl}</div>
    <label class="fp-slot-box" style="height:${alto||110}px">
      <img id="fpi-${idx}-${c}" src="${src}" alt="" style="display:${src?'block':'none'}">
      <div id="fpp-${idx}-${c}" class="fp-slot-ph" style="display:${src?'none':'flex'}"><span style="font-size:18px">📷</span><span style="font-size:9px">Subir imagen</span></div>
      <input type="file" accept="image/*" style="display:none" onchange="handleFPImage(event,${idx},'${c}')">
    </label>
    ${src?`<button type="button" class="fp-slot-x" onclick="_fpQuitarImg(${idx},'${c}')">✕ Quitar</button>`:''}
  </div>`;
}
function _fpIABlock(idx){
  const raw=_fpRawImages[idx];
  return `<div class="fp-ia">
    <div class="fp-ia-tit">✨ Vistas con IA <span class="fp-opt">(opcional · cada vista se cobra)</span></div>
    <div class="fp-ia-row">
      <div style="flex:1;min-width:0">
        <label class="fp-slot-box" style="height:90px;border-color:#02b2c1">
          <img id="fpRaw-${idx}" src="${raw?.dataUrl||''}" alt="" style="display:${raw?'block':'none'}">
          <div id="fpRawPh-${idx}" class="fp-slot-ph" style="display:${raw?'none':'flex'}"><svg class="dashboard-icon" width="22" height="22" stroke-width="1.5"><use href="#icon-camera"/></svg><span style="font-size:9px;font-weight:700">Foto de referencia del producto</span></div>
          <input type="file" accept="image/*" style="display:none" onchange="handleFPRawImage(event,${idx})">
        </label>
      </div>
      <div style="display:flex;flex-direction:column;justify-content:center;align-items:center;gap:6px;flex-shrink:0">
        <button type="button" id="fpGenBtn-${idx}" class="fp-ia-btn" onclick="generarVistasIA(${idx})">✨ Generar 3 vistas</button>
        <div id="fpAiStatus-${idx}" style="font-size:9px;color:#0097a7;text-align:center;display:none;max-width:170px;line-height:1.5"></div>
      </div>
    </div>
    <div class="fp-hint">La isométrica queda como foto principal; la frontal y la lateral van dentro del dibujo de medidas.</div>
    <details class="fp-ia-prompts"><summary>Regenerar una vista o ajustar sus indicaciones</summary>
      ${FP_VIEWS.map(fv=>`<div class="fp-ia-prompt"><div class="fp-slot-lbl">${fv.label}</div><textarea class="field-input" rows="2" title="Indicaciones de la IA para esta vista: edítalas si sale mal y regenera solo esta" oninput="_fpSetPrompt(${idx},'${fv.campo}',this.value)">${escapeHtml(_fpGetPrompt(idx,fv.campo))}</textarea><button type="button" class="btn btn-ghost btn-sm" id="fpRegenBtn-${idx}-${fv.campo}" onclick="generarVistasIA(${idx},'${fv.campo}')">🔄 Regenerar ${fv.label.toLowerCase()}</button></div>`).join('')}
    </details>
  </div>`;
}

// Editor de la ficha abierta (una pestaña por producto). Las secciones siguen
// el orden de la plantilla: encabezado, fotos, en simple, especificaciones,
// medidas, y en la página 2 componentes, detalle + pasos, glosario y cuidados.
function renderFPItems(){
  const container=document.getElementById('fpItemsList');if(!container) return;
  if(!_fpItems.length) _fpItems=[{...ftNuevaFicha(_fpCtx()),img:{}}];
  _fpIdx=Math.max(0,Math.min(_fpIdx,_fpItems.length-1));
  const idx=_fpIdx,it=_fpItems[idx];
  Object.assign(it,ftCompletar(it));   // asegura todas las secciones (fichas antiguas o a medio llenar)
  while(it.encabezado.meta.length<5) it.encabezado.meta.push(['','']);
  const v=s=>escapeHtml(s==null?'':String(s)),g=p=>_fpGet(it,p);
  const inp=(p,ph,extra='')=>`<input class="field-input" value="${v(g(p))}" placeholder="${v(ph)}" oninput="_fpSet('${p}',this.value)${extra}">`;
  const area=(p,ph,rows)=>`<textarea class="field-input" rows="${rows||2}" placeholder="${v(ph)}" oninput="_fpSet('${p}',this.value)">${v(g(p))}</textarea>`;
  const lista=(p,tipo,ph,rows)=>`<textarea class="field-input" rows="${rows||4}" placeholder="${v(ph)}" oninput="_fpSetLista('${p}','${tipo}',this.value)">${v(FP_LISTAS[tipo].txt(g(p)))}</textarea>`;
  const sel=(p,ops)=>`<select class="field-input" onchange="_fpSet('${p}',this.value)">${ops.map(([val,t])=>`<option value="${val}"${(g(p)||'')===val?' selected':''}>${t}</option>`).join('')}</select>`;
  const fld=(lbl,html)=>`<div class="field-group"><label class="field-label">${lbl}</label>${html}</div>`;
  const hint=t=>`<div class="fp-hint">${t}</div>`;
  const opt=t=>` <span class="fp-opt">${t}</span>`;
  const sec=(k,titulo,html)=>`<details class="fp-sec"${_fpAbiertas.has(k)?' open':''} ontoggle="_fpAbiertas[this.open?'add':'delete']('${k}')"><summary>${titulo}</summary><div class="fp-sec-body">${html}</div></details>`;
  const tabs=`<div class="fp-tabs">${_fpItems.map((x,i)=>`<button type="button" class="fp-tab${i===idx?' on':''}" onclick="_fpIrA(${i})">${i+1} · ${v(_fpTabNombre(x))}</button>`).join('')}<button type="button" class="fp-tab fp-tab-add" onclick="addFPItem()">+ Producto</button></div>`;
  const metaPh=['Cliente','Producto o marca','ej. Impresión 3D · Trofeos','ej. 6 unidades','dd-mm-aaaa'];
  const meta=it.encabezado.meta.slice(0,5).map((r,i)=>`<div class="fp-meta-row"><input class="field-input" value="${v(r[0])}" placeholder="Dato" oninput="_fpSet('encabezado.meta.${i}.0',this.value)"><input class="field-input" value="${v(r[1])}" placeholder="${v(metaPh[i])}" oninput="_fpSet('encabezado.meta.${i}.1',this.value)"></div>`).join('');
  const fondo=[['','Fondo blanco'],['gris','Fondo gris'],['oscuro','Fondo oscuro']],ajuste=[['contain','Imagen completa'],['cover','Rellenar (recorta)']];
  const fotoCfg=i=>`<div class="fp-grid2" style="margin-top:6px">${sel(`pagina1.fotos.${i}.fondo`,fondo)}${sel(`pagina1.fotos.${i}.ajuste`,ajuste)}</div>`;
  container.innerHTML=tabs
  +sec('enc','Encabezado',`
    <div class="fp-grid2">
      ${fld('Tipo de producto',inp('encabezado.tipo','ej. Trofeo institucional',';_fpSyncTab()'))}
      ${fld('Destacado'+opt('(cliente o marca, en cian)'),inp('encabezado.destacado','ej. Hospital Militar del Norte'))}
    </div>
    ${fld('Tipo corto'+opt('(encabezado de la página 2)'),inp('encabezado.tipo_corto','ej. Trofeo',';_fpSyncTab()'))}
    ${fld('Fila de datos'+opt('(máx. 5; las vacías no salen)'),`<div class="fp-meta">${meta}</div>`)}
    ${_fpItems.length>1?`<button type="button" class="btn btn-danger btn-sm" style="align-self:flex-start" onclick="removeFPItem(${idx})">✕ Quitar este producto</button>`:''}`)
  +sec('fotos','Fotos',`
    <div class="fp-grid2">
      <div>${_fpSlot(idx,'foto','Foto principal',150)}${fotoCfg(0)}</div>
      <div>${_fpSlot(idx,'foto2','Segunda foto (opcional, va debajo)',150)}${fotoCfg(1)}</div>
    </div>
    ${fld('Nota bajo la foto',inp('pagina1.foto_nota','Imagen referencial.'))}
    ${_fpIABlock(idx)}
    ${hint('Las imágenes se guardan solo en este navegador (no caben en Airtable).')}`)
  +sec('simple','En simple',`
    ${fld('Párrafo 1',area('pagina1.en_simple.0','Qué es, de qué está hecho y cómo se ve, en palabras simples.',3))}
    ${fld('Párrafo 2',area('pagina1.en_simple.1','La base, la placa, cómo se arma o qué incluye.',3))}
    ${fld('3 palabras clave'+opt('(materiales o técnicas)'),`<div class="fp-grid3">${[0,1,2].map(i=>inp(`pagina1.chips.${i}`,['PLA MATE 3D','PLACA GRAVOPLY','ENCASTRES'][i])).join('')}</div>`)}
    ${fld('Barra de medidas',inp('pagina1.resumen_medidas','Vacía = se arma con las medidas ('+(_ftResumenAuto(it.pagina1.medidas)||'Alto: 15 cm · Ancho: 12,8 cm')+')'))}
    ${hint('Dos párrafos que se entiendan sin saber de fabricación. Frases cortas, sin relleno comercial.')}`)
  +sec('specs','Especificaciones',`
    ${lista('pagina1.especificaciones','pares','Producto: Trofeo con marquesina y placa grabada\nMaterial: PLA mate, impresión 3D FDM\nMedida total: Alto 15 · ancho 12,8 · fondo 10,6 cm\nPeso: ≈280 g por unidad',9)}
    ${hint('Una fila por línea: «Etiqueta: valor». Lo ideal son 10 a 12 filas. Si un dato no está confirmado, pon «A confirmar» u omítelo: no se inventan datos técnicos.')}`)
  +sec('medidas','Medidas',`
    <div class="fp-grid3">
      ${fld('Alto (cm)',inp('pagina1.medidas.alto','15'))}
      ${fld('Ancho (cm)',inp('pagina1.medidas.ancho','12,8'))}
      ${fld('Fondo (cm)',inp('pagina1.medidas.fondo','10,6'))}
    </div>
    ${fld('Nota bajo el dibujo',inp('pagina1.medidas.nota','Medidas en cm. Ambas vistas a la misma escala.'))}
    <div class="fp-grid3">
      ${_fpSlot(idx,'frontal','Imagen vista frontal')}
      ${_fpSlot(idx,'lateral','Imagen vista lateral')}
      ${_fpSlot(idx,'plano','Plano propio (reemplaza el dibujo)')}
    </div>
    ${hint('Con alto y ancho se dibujan la vista frontal y la lateral a la misma escala, con cotas en cian. Recorta las imágenes al borde del producto para que calcen con las cotas.')}`)
  +sec('comps','Componentes'+opt('· página 2'),`
    ${fld('Título',inp('pagina2.componentes.titulo','Componentes del trofeo'))}
    ${lista('pagina2.componentes.items','comps','Base | Cilindro con escalón, ranuras para laterales y soporte | PLA negro mate · 3D\nLaterales × 2 | Cuñas de dos planos con lengüeta inclinada | PLA piedra · 3D',6)}
    ${hint('Una pieza por línea: «Nombre | descripción corta | material». Van de a 3 por fila (lo ideal: 3 o 6).')}
    ${fld('Nota bajo las piezas',inp('pagina2.componentes.nota','ej. El texto final de la placa se confirma con el cliente antes del grabado.'))}`)
  +sec('pasos','Detalle y pasos'+opt('· página 2'),`
    <div class="fp-grid2">
      <div class="fp-col">
        ${fld('Título del detalle',inp('pagina2.detalle.titulo','ej. Placa Gravoply'))}
        ${_fpSlot(idx,'detalle','Imagen del detalle (placa, dorso, ubicación…)',130)}
        ${fld('Nota del detalle',inp('pagina2.detalle.nota','ej. Grabado láser: el texto queda en el color del núcleo.'))}
      </div>
      <div class="fp-col">
        ${fld('Título de los pasos',`<input class="field-input" list="fpPasosTit" value="${v(g('pagina2.pasos.titulo'))}" placeholder="Cómo se arma" oninput="_fpSet('pagina2.pasos.titulo',this.value)"><datalist id="fpPasosTit"><option value="Cómo se arma"><option value="Cómo se usa"><option value="Cómo se trabaja"></datalist>`)}
        ${lista('pagina2.pasos.items','lineas','Encastra el soporte central en la ranura trasera de la base.\nColoca los laterales: la lengüeta entra en la base.',6)}
        ${hint('Un paso por línea, en orden.')}
        ${fld('Nota en caja gris',area('pagina2.pasos.nota','ej. Se entrega armado y pegado.',2))}
      </div>
    </div>`)
  +sec('glos','Glosario y cuidados'+opt('· página 2'),`
    ${fld('Glosario',lista('pagina2.glosario','glos','PLA mate: Plástico de impresión 3D de origen vegetal con terminación sin brillo.\nEncastre: Unión en que una pieza entra en el calce de otra.',4))}
    ${hint('3 términos, uno por línea: «Término: definición».')}
    ${fld('Cuidados',lista('pagina2.cuidados','lineas','Calor: no dejar al sol directo ni cerca de fuentes de calor.\nLimpieza: plumero o paño seco.',4))}
    ${hint('4 viñetas cortas, una por línea: «Tema: indicación.»')}`);
}
