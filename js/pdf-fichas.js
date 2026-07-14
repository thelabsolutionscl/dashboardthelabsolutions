/* js/pdf-fichas.js — módulo extraído de index.html (carga en el mismo punto). */
// ── PDF ───────────────────────────────────────────────────────
function buildCotizacionDoc(id){
  const c=state.cotizacionesById[id];if(!c) return null;
  const f=c.fields;const clienteId=Array.isArray(f['Cliente'])?f['Cliente'][0]:null;const cf=(clienteId?state.clientes.find(x=>x.id===clienteId):null)?.fields||{};
  const num=f['N° Cotización']||'—',fecha=f['Fecha cotización']||new Date().toISOString().split('T')[0],vto=f['Fecha vencimiento']||'—',urgente=f['Urgencia (+25%)'],solicitud=f['Solicitud cliente (texto libre)']||'',detalle=f['Detalle productos']||'',total=f['Total final (CLP)']||0,neto=Math.round(total/1.19),iva=total-neto;
  const tiempoProd=f['Tiempo de producción'];const tipoDias=(f['Tipo días producción']||'DÍAS HÁBILES').toLowerCase();
  const plazotxt=tiempoProd?`${tiempoProd} ${tipoDias} desde la confirmación del pedido. Plazo podría variar dependiendo de stock de productos, contingencias sanitarias o sociales.`:'A coordinar con el cliente.';
  const formaPago=f['Forma de pago']||'';
  const formaDescMap={'AL CONTADO':'Pago total al momento de confirmar el pedido, vía transferencia bancaria, vale vista o cheque al día.','30 DÍAS DESDE OC':'Pago total a 30 días desde la emisión de la Orden de Compra, vía transferencia bancaria.','45 DÍAS DESDE OC':'Pago total a 45 días desde la emisión de la Orden de Compra, vía transferencia bancaria.','70% ABONO Y 30% CONTRA ENTREGA':'70% de abono al confirmar el pedido (Facturable inmediatamente), 30% restante contra entrega y conformidad de recepción, vía transferencia bancaria, vale vista o cheque al día.','50% ABONO Y 50% 30 DÍAS':'50% de abono al confirmar el pedido (Facturable inmediatamente), 50% restante a 30 días desde la Orden de Compra, vía transferencia bancaria.'};
  const formaHtml=formaPago?`<strong>${escHtml(formaPago)}:</strong> ${formaDescMap[formaPago]||''}`:'';
  const lineas=detalle.split('\n').filter(Boolean).map(l=>{const parts=l.split('|').map(s=>s.trim());const undStr=(parts[1]||'').replace(/[^\d.]/g,'');const und=parseFloat(undStr)||1;const ventaRaw=(parts[3]||parts[2]||'').replace(/[Vv]enta:\s*/,'').replace(/\./g,'').replace(/[^0-9]/g,'');const ventaTotal=parseFloat(ventaRaw)||0;const ventaUnit=und>0?Math.round(ventaTotal/und):ventaTotal;return{desc:parts[0]||'',und,ventaUnit,ventaTotal};});
  const itemsHTML=lineas.length>0?lineas.map((l,i)=>`<tr style="background:${i%2===0?'#f9f9f9':'#fff'}"><td style="padding:6px 10px;border-bottom:1px solid #e8e8e8;font-size:10px">${escHtml(l.desc)}</td><td style="padding:6px 10px;border-bottom:1px solid #e8e8e8;font-size:10px;text-align:center;color:#555">${l.und}</td><td style="padding:6px 10px;border-bottom:1px solid #e8e8e8;font-size:10px;text-align:right">${formatCLP(l.ventaUnit)}</td><td style="padding:6px 10px;border-bottom:1px solid #e8e8e8;font-size:10px;text-align:right;font-weight:600">${formatCLP(l.ventaTotal)}</td></tr>`).join(''):`<tr><td colspan="4" style="padding:12px;text-align:center;color:#999;font-size:10px">Sin detalle</td></tr>`;
  const infoRow=(label,val)=>val&&val!=='—'?`<tr><td style="padding:3px 0;font-size:10px;color:#888;width:80px;vertical-align:top">${label}</td><td style="padding:3px 0;font-size:10px;color:#1a1a1a;font-weight:500">${escHtml(val)}</td></tr>`:'';
  const html=`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Cotización ${escHtml(num)}</title>
<link rel="icon" href="https://dashboard.thelab.solutions/isotipo-thelab.png">
<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Helvetica Neue',Arial,sans-serif;color:#1a1a1a;background:#fff;padding:18px 24px;font-size:10px;}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:12px;border-bottom:3px solid #00d4cc;}
.logo-area img{height:28px;filter:brightness(0);}.logo-area .tagline{font-size:8px;color:#aaa;margin-top:4px;letter-spacing:1.2px;text-transform:uppercase;}
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
<div class="header"><div class="logo-area"><img loading="lazy" decoding="async" src="https://dashboard.thelab.solutions/logo-thelab.png" onerror="this.style.display='none'"><div class="tagline">Impresión 3D · Neones · Trofeos</div></div>
<div class="cot-meta"><h1>Cotización</h1><div class="num">${escHtml(num)}</div><div class="fechas">Emitida: <strong>${escHtml(fecha)}</strong><br>Válida hasta: <strong>${escHtml(vto)}</strong></div></div></div>
${urgente?'<div class="urgente-strip">⚡ Cotización con urgencia — se aplica recargo del 25%</div>':''}
<div class="info-grid">
<div class="info-box"><h3>Cliente</h3><table>${infoRow('Empresa',cf['Empresa']||resolveClienteName(f['Cliente']))}${infoRow('RUT',cf['RUT'])}${infoRow('Contacto',cf['Contacto'])}${infoRow('Teléfono',cf['Teléfono'])}${infoRow('Email',cf['Email'])}${infoRow('Dirección',cf['Dirección']||cf['Direccion'])}${infoRow('Comuna',cf['Comuna'])}${infoRow('Región',cf['Región']||cf['Region'])}</table></div>
<div class="info-box"><h3>The Lab Solutions</h3><table>${infoRow('Web','thelab.solutions')}${infoRow('Teléfono','+56 9 7180 6142')}${infoRow('Email','hola@thelab.solutions')}${infoRow('Dirección','Zaragoza 8882, Las Condes')}${infoRow('Ciudad','Santiago, Chile')}</table></div>
</div>
${solicitud?`<div class="section-label">Solicitud del cliente</div><div class="solicitud-box">${escHtml(solicitud)}</div>`:''}
<div class="condiciones-box"><p style="margin-bottom:5px"><strong>PLAZO DE ENTREGA:</strong> ${plazotxt}</p>${formaHtml?`<p style="margin-bottom:2px;margin-top:5px"><strong>FORMA DE PAGO:</strong></p><p style="margin-bottom:5px">${formaHtml}</p>`:''}<p style="color:#888;font-style:italic">* Cotización válida por 10 días hábiles.</p></div>
<div class="section-label" style="margin-top:10px">Detalle de productos / servicios</div>
<table class="items"><thead><tr><th style="background:#0a0a0a;color:#fff">Descripción</th><th style="background:#0a0a0a;color:#fff;text-align:center">Cant.</th><th style="background:#0a0a0a;color:#fff;text-align:right">Precio Unit. Neto</th><th style="background:#0a0a0a;color:#fff;text-align:right">Total Neto</th></tr></thead><tbody>${itemsHTML}</tbody></table>
<div class="totals"><div class="totals-box"><div class="totals-row"><span>Neto</span><span>${formatCLP(neto)}</span></div><div class="totals-row iva"><span>IVA (19%)</span><span>${formatCLP(iva)}</span></div><div class="totals-row total-final"><span>TOTAL</span><span>${formatCLP(total)}</span></div></div></div>
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
    updatedAt:new Date().toISOString().slice(0,10)
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
.logo-area img{height:28px;filter:brightness(0);}.logo-area .tagline{font-size:8px;color:#aaa;margin-top:4px;letter-spacing:1.2px;text-transform:uppercase;}
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
    <img loading="lazy" decoding="async" src="https://dashboard.thelab.solutions/logo-thelab.png" onerror="this.style.display='none'">
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

// ── FICHA PROPUESTA AL CLIENTE ────────────────────────────────
let _fpCotId='';
let _fpItems=[];
let _fpLogoCliente='';
let _fpRawImages={};

function parseFichaPropData(s){try{return s?JSON.parse(s):null;}catch(e){return null;}}
const _fpImgCompress=async(dataUrl,maxPx=700)=>{
  if(!dataUrl) return null;
  const img=new Image();img.src=dataUrl;
  await new Promise(r=>{img.onload=r;img.onerror=r;});
  const scale=Math.min(1,maxPx/Math.max(img.naturalWidth||maxPx,img.naturalHeight||maxPx));
  const w=Math.round((img.naturalWidth||maxPx)*scale),h=Math.round((img.naturalHeight||maxPx)*scale);
  const c=document.createElement('canvas');c.width=w;c.height=h;
  c.getContext('2d').drawImage(img,0,0,w,h);
  return c.toDataURL('image/jpeg',0.78);
};
async function saveFPImgCache(cotId){
  const campos=['imgFrontal','imgIsometrica','imgAerea'];
  const cache={};
  for(let i=0;i<_fpItems.length;i++){
    for(const c of campos){if(_fpItems[i][c]){try{cache[i+'_'+c]=await _fpImgCompress(_fpItems[i][c]);}catch(e){}}}
    if(_fpRawImages[i]?.dataUrl){try{cache[i+'_raw']=await _fpImgCompress(_fpRawImages[i].dataUrl,400);}catch(e){}}
  }
  try{localStorage.setItem('fp_imgs_'+cotId,JSON.stringify(cache));}
  catch(e){console.warn('[fp cache] quota excedida, omitiendo imágenes');}
}
function loadFPImgCache(cotId){
  try{
    const cache=JSON.parse(localStorage.getItem('fp_imgs_'+cotId)||'{}');
    _fpItems.forEach((item,i)=>{
      ['imgFrontal','imgIsometrica','imgAerea'].forEach(c=>{if(cache[i+'_'+c]) item[c]=cache[i+'_'+c];});
      if(cache[i+'_raw']) _fpRawImages[i]={dataUrl:cache[i+'_raw']};
    });
  }catch(e){}
}

function openFichaPropModal(cotId){
  const cot=state.cotizacionesById[cotId];if(!cot) return;
  _fpCotId=cotId;
  const f=cot.fields;
  const saved=parseFichaPropData(f['Ficha Propuesta'])||{};
  document.getElementById('fpNumFicha').value=saved.numFicha||'';
  document.getElementById('fpNombreProyecto').value=saved.nombreProyecto||'';
  if(saved.items?.length){
    _fpItems=saved.items.map(it=>({nombre:it.nombre||'',tipo:it.tipo||'',material:it.material||'',optLabel:it.optLabel||'',optMaterial:it.optMaterial||'',dims:it.dims||'',imgFrontal:'',imgIsometrica:'',imgAerea:''}));
  } else {
    const lineas=(f['Detalle productos']||'').split('\n').filter(Boolean);
    _fpItems=lineas.map(l=>{const p=l.split('|').map(s=>s.trim());return{nombre:p[0]||'',tipo:'',material:'',optLabel:'',optMaterial:'',dims:'',imgFrontal:'',imgIsometrica:'',imgAerea:''};});
    if(!_fpItems.length) _fpItems=[{nombre:'',tipo:'',material:'',optLabel:'',optMaterial:'',dims:'',imgFrontal:'',imgIsometrica:'',imgAerea:''}];
  }
  _fpLogoCliente='';
  _fpRawImages={};
  loadFPImgCache(cotId);
  const lp=document.getElementById('fpLogoPrev');if(lp){lp.src='';lp.style.display='none';}
  const lph=document.getElementById('fpLogoPh');if(lph) lph.style.display='flex';
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
  const o=document.getElementById('iaOpenaiKey');if(o) o.value=localStorage.getItem('fp_openai_key')||'';
  document.getElementById('iaConfigModal').style.display='flex';
}
function closeIAConfigModal(){document.getElementById('iaConfigModal').style.display='none';}
async function testIAKey(){
  const key=(document.getElementById('iaOpenaiKey')?.value||'').trim();
  const res=document.getElementById('iaTestResult');
  if(!res) return;
  if(!key){res.style.display='block';res.style.background='#fff3cd';res.style.color='#856404';res.innerHTML='⚠️ Ingresa una API key primero.';return;}
  res.style.display='block';res.style.background='var(--surface2)';res.style.color='var(--text2)';res.innerHTML='🔄 Probando key...';
  const lines=[];
  // Test 1: chat completions (GPT-4o mini — barato)
  try{
    const r=await _openaiFetch('/v1/chat/completions',{directKey:key,
      body:JSON.stringify({model:'gpt-4o-mini',max_tokens:5,messages:[{role:'user',content:'hi'}]})
    });
    if(r.ok) lines.push('✅ GPT-4o-mini: OK');
    else{const e=await r.json();lines.push('❌ GPT-4o-mini: '+(e.error?.message||r.status));}
  }catch(e){lines.push('❌ GPT-4o-mini: '+e.message);}
  // Test 2: gpt-image-1 (nuevo modelo), con fallback a dall-e-3
  res.innerHTML='🔄 Probando generación de imágenes...';
  try{
    const r=await _openaiFetch('/v1/images/generations',{directKey:key,
      body:JSON.stringify({model:'gpt-image-1',prompt:'a red apple on white background',n:1,size:'1024x1024',quality:'low'})
    });
    if(r.ok){lines.push('✅ gpt-image-1: OK — imágenes funcionan');}
    else{
      const e=await r.json();const msg=e.error?.message||r.status;
      const r2=await _openaiFetch('/v1/images/generations',{directKey:key,
        body:JSON.stringify({model:'dall-e-3',prompt:'a red apple',n:1,size:'1024x1024',quality:'standard'})
      });
      if(r2.ok){lines.push('✅ dall-e-3: OK — imágenes funcionan');}
      else{const e2=await r2.json();lines.push('❌ Imágenes: gpt-image-1='+msg+' / dall-e-3='+(e2.error?.message||r2.status));}
    }
  }catch(e){lines.push('❌ Imágenes: '+e.message);}
  const allOk=lines.every(l=>l.startsWith('✅'));
  res.style.background=allOk?'#d4edda':'#f8d7da';
  res.style.color=allOk?'#155724':'#721c24';
  res.innerHTML=lines.join('<br>');
}
function saveIAConfig(){
  const o=document.getElementById('iaOpenaiKey');
  if(o?.value.trim()) localStorage.setItem('fp_openai_key',o.value.trim());
  closeIAConfigModal();
  toast(o?.value.trim()?'OpenAI key guardada ✓':'Sin API key configurada','success');
}

function handleFPLogo(evt){
  const file=evt.target.files[0];if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    _fpLogoCliente=e.target.result;
    const prev=document.getElementById('fpLogoPrev');if(prev){prev.src=e.target.result;prev.style.display='block';}
    const ph=document.getElementById('fpLogoPh');if(ph) ph.style.display='none';
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

// Llama a OpenAI vía el proxy Worker si está configurado (la key vive server-side y
// evita el CORS del navegador: OpenAI NO habilita CORS directo, a diferencia de
// Anthropic). Sin proxy, cae a la llamada directa con la key local (solo dev).
// isForm=true para multipart (images/edits): el FormData fija su propio Content-Type.
function _openaiFetch(path,{method='POST',body=null,isForm=false,directKey=null}={}){
  const px=(typeof _proxyCfg==='function')?_proxyCfg():null;
  const headers=px?{'X-App-Key':px.key}:{'Authorization':'Bearer '+(directKey||getOpenAIKey())};
  if(!isForm) headers['Content-Type']='application/json';
  const url=(px?px.url+'/openai':'https://api.openai.com')+path;
  return fetch(url,{method,headers,body});
}
// ¿Hay CÓMO llamar a OpenAI? (proxy configurado O key local) — las compuertas IA
// deben preguntar esto, no si hay una key en el navegador.
function _openaiAvailable(){return !!(getOpenAIKey()||(typeof _proxyCfg==='function'&&_proxyCfg()));}
async function generarVistasIA(idx){
  const openaiKey=getOpenAIKey();
  const aiOk=_openaiAvailable();
  const rawImg=_fpRawImages[idx];
  const statusEl=document.getElementById('fpAiStatus-'+idx);
  const setStatus=msg=>{if(statusEl){statusEl.style.display='block';statusEl.innerHTML=msg;}};
  const btn=document.getElementById('fpGenBtn-'+idx);
  if(btn){btn.disabled=true;btn.textContent='Generando...';}
  try{
    let descripcion='';
    if(rawImg&&aiOk){
      setStatus('🔍 Analizando imagen con GPT-4o...');
      try{
        const visionRes=await _openaiFetch('/v1/chat/completions',{
          body:JSON.stringify({model:'gpt-4o',max_tokens:150,messages:[{role:'user',content:[
            {type:'image_url',image_url:{url:rawImg.dataUrl,detail:'low'}},
            {type:'text',text:'Describe this product concisely for a luxury product photography prompt. Include: product type, materials, colors, shape, key features. English only, max 50 words, no punctuation at end.'}
          ]}]})
        });
        if(visionRes.ok){const d=await visionRes.json();descripcion=d.choices[0].message.content.trim();}
        else{const e=await visionRes.json();setStatus('⚠️ GPT-4o: '+(e.error?.message||visionRes.statusText));}
      }catch(ve){setStatus('⚠️ Visión: '+ve.message);}
    }
    if(!descripcion){
      const item=_fpItems[idx];
      descripcion=(item.nombre||'product')+(item.tipo?' '+item.tipo:'');
    }
    descripcion=descripcion.slice(0,150);
    const views=[
      {campo:'imgFrontal',label:'FRONTAL',prompt:'front view centered eye level'},
      {campo:'imgIsometrica',label:'ISOMÉTRICA',prompt:'isometric 45-degree angle view'},
      {campo:'imgAerea',label:'LATERAL',prompt:'side profile view, 90-degree lateral angle from the right side, camera at eye level showing the full side of the product'}
    ];
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
      const c=document.createElement('canvas');c.width=img.naturalWidth||512;c.height=img.naturalHeight||512;
      c.getContext('2d').drawImage(img,0,0);
      return await new Promise(r=>c.toBlob(r,'image/png'));
    };
    const removeBackground=async(dataUrl)=>{
      const img=new Image();img.crossOrigin='anonymous';img.src=dataUrl;
      await new Promise(r=>{img.onload=r;img.onerror=r;});
      const w=img.naturalWidth||1024,h=img.naturalHeight||1024;
      const c=document.createElement('canvas');c.width=w;c.height=h;
      const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
      const id=ctx.getImageData(0,0,w,h);const d=id.data;
      // sample background from 4 corners and average
      const corners=[0,(w-1)*4,(h-1)*w*4,((h-1)*w+(w-1))*4];
      let bgR=0,bgG=0,bgB=0;
      corners.forEach(i=>{bgR+=d[i];bgG+=d[i+1];bgB+=d[i+2];});
      bgR=Math.round(bgR/4);bgG=Math.round(bgG/4);bgB=Math.round(bgB/4);
      const thresh=40;
      const isBg=(i)=>Math.abs(d[i]-bgR)+Math.abs(d[i+1]-bgG)+Math.abs(d[i+2]-bgB)<thresh*3;
      const visited=new Uint8Array(w*h);
      const queue=[];
      // seed BFS from all 4 edges
      for(let x=0;x<w;x++){[x,x+(h-1)*w].forEach(p=>{if(!visited[p]&&isBg(p*4)){visited[p]=1;queue.push(p);}});}
      for(let y=1;y<h-1;y++){[y*w,y*w+(w-1)].forEach(p=>{if(!visited[p]&&isBg(p*4)){visited[p]=1;queue.push(p);}});}
      let qi=0;
      while(qi<queue.length){
        const p=queue[qi++];const pi=p*4;d[pi+3]=0;
        const x=p%w,y=Math.floor(p/w);
        if(x>0){const n=p-1;if(!visited[n]&&isBg(n*4)){visited[n]=1;queue.push(n);}}
        if(x<w-1){const n=p+1;if(!visited[n]&&isBg(n*4)){visited[n]=1;queue.push(n);}}
        if(y>0){const n=p-w;if(!visited[n]&&isBg(n*4)){visited[n]=1;queue.push(n);}}
        if(y<h-1){const n=p+w;if(!visited[n]&&isBg(n*4)){visited[n]=1;queue.push(n);}}
      }
      ctx.putImageData(id,0,0);
      return c.toDataURL('image/png');
    };
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
            let r=await _openaiFetch('/v1/images/generations',{
              body:JSON.stringify({model:'gpt-image-1',prompt:fullPrompt,n:1,size:'1024x1024',quality:'low'})
            });
            if(!r.ok){
              const e1=await r.json();
              r=await _openaiFetch('/v1/images/generations',{
                body:JSON.stringify({model:'dall-e-3',prompt:fullPrompt,n:1,size:'1024x1024',quality:'standard',response_format:'b64_json'})
              });
              if(!r.ok){const e2=await r.json();throw new Error('gpt-image-1: '+(e1.error?.message||'?')+' / dall-e-3: '+(e2.error?.message||r.statusText));}
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
      if(!imgData) imgData=genImgCanvas(v.label,_fpItems[idx]?.nombre||descripcion);
      _fpItems[idx][v.campo]=imgData;
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
    if(btn){btn.disabled=false;btn.textContent='✨ Generar 3 vistas';}
  }
}

function addFPItem(){
  _fpItems.push({nombre:'',tipo:'',material:'',optLabel:'',optMaterial:'',dims:'',imgFrontal:'',imgIsometrica:'',imgAerea:''});
  renderFPItems();
}

function removeFPItem(idx){
  _fpItems.splice(idx,1);
  renderFPItems();
}

function handleFPImage(evt,idx,campo){
  const file=evt.target.files[0];if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    _fpItems[idx][campo]=e.target.result;
    const prev=document.getElementById(`fpi-${idx}-${campo}`);
    if(prev){prev.src=e.target.result;prev.style.display='block';}
    const ph=document.getElementById(`fpp-${idx}-${campo}`);
    if(ph) ph.style.display='none';
  };
  reader.readAsDataURL(file);
}

function renderFPItems(){
  const container=document.getElementById('fpItemsList');if(!container) return;
  if(!_fpItems.length){container.innerHTML='<div style="text-align:center;color:var(--text3);padding:24px;font-size:12px">Sin muestras — agrega la primera ↑</div>';return;}
  container.innerHTML=_fpItems.map((item,idx)=>`
    <div style="border:1px solid var(--border2);border-radius:12px;overflow:hidden;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--surface2);border-bottom:1px solid var(--border2)">
        <span style="font-size:11px;font-weight:700;color:#00d4cc;letter-spacing:.5px">MUESTRA ${idx+1}</span>
        <button class="btn btn-danger btn-sm" style="padding:4px 8px" onclick="removeFPItem(${idx})">✕ Eliminar</button>
      </div>
      <div style="padding:14px;background:var(--surface);display:flex;flex-direction:column;gap:12px">
        <div class="fp-fields-grid">
          <div class="field-group">
            <label class="field-label">Nombre del producto</label>
            <input class="field-input" placeholder="ej. CARTEL ILUMINADO NEGRO" value="${escapeHtml(item.nombre||'')}" oninput="_fpItems[${idx}].nombre=this.value">
          </div>
          <div class="field-group">
            <label class="field-label">Tipo de muestra</label>
            <input class="field-input" placeholder="ej. 3D Y ACRÍLICO" value="${escapeHtml(item.tipo||'')}" oninput="_fpItems[${idx}].tipo=this.value">
          </div>
          <div class="field-group fp-span-2">
            <label class="field-label">Material principal</label>
            <textarea class="field-input" rows="2" placeholder="ej. 3D: PLA Terminación blanca&#10;ACRÍLICO: Transparente 2mm" oninput="_fpItems[${idx}].material=this.value">${escapeHtml(item.material||'')}</textarea>
          </div>
          <div class="field-group">
            <label class="field-label">Opción alternativa</label>
            <input class="field-input" placeholder="ej. 3D Y LAMINADO MIC" value="${escapeHtml(item.optLabel||'')}" oninput="_fpItems[${idx}].optLabel=this.value">
          </div>
          <div class="field-group">
            <label class="field-label">Material opción alt.</label>
            <textarea class="field-input" rows="2" placeholder="ej. GRÁFICA: Laminado MIC 240." oninput="_fpItems[${idx}].optMaterial=this.value">${escapeHtml(item.optMaterial||'')}</textarea>
          </div>
          <div class="field-group fp-span-2">
            <label class="field-label">Dimensiones</label>
            <input class="field-input" placeholder="ej. 40 × 35 × 8 cm" value="${escapeHtml(item.dims||'')}" oninput="_fpItems[${idx}].dims=this.value">
          </div>
        </div>
        <div style="border:1px solid #00c8cc;border-radius:10px;padding:14px;background:linear-gradient(135deg,rgba(0,200,204,0.06),rgba(0,151,167,0.04))">
          <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#0097a7;margin-bottom:12px">✨ Generar vistas con IA</div>
          <div class="fp-ia-row">
            <div style="flex:1;min-width:0">
              <div style="font-size:9px;color:var(--text3);margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.4px">Foto de referencia del producto</div>
              <label style="cursor:pointer;display:block;border:2px dashed #00c8cc;border-radius:8px;overflow:hidden;background:var(--surface)">
                <img loading="lazy" decoding="async" id="fpRaw-${idx}" src="${_fpRawImages[idx]?.dataUrl||''}" style="width:100%;height:100px;object-fit:contain;display:${_fpRawImages[idx]?'block':'none'}">
                <div id="fpRawPh-${idx}" style="display:${_fpRawImages[idx]?'none':'flex'};flex-direction:column;align-items:center;justify-content:center;height:100px;gap:6px;color:#0097a7">
                  <svg class="dashboard-icon" width="28" height="28" stroke-width="1.5"><use href="#icon-camera"/></svg>
                  <span style="font-size:9px;font-weight:700">Subir foto del producto</span>
                </div>
                <input type="file" accept="image/*" style="display:none" onchange="handleFPRawImage(event,${idx})">
              </label>
            </div>
            <div style="display:flex;flex-direction:column;justify-content:center;align-items:center;gap:8px;flex-shrink:0">
              <button id="fpGenBtn-${idx}" onclick="generarVistasIA(${idx})" style="background:linear-gradient(135deg,#00c8cc,#0097a7);color:#fff;border:none;border-radius:8px;padding:11px 16px;cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap">✨ Generar 3 vistas</button>
              <div id="fpAiStatus-${idx}" style="font-size:9px;color:#0097a7;text-align:center;display:none;max-width:160px;line-height:1.5"></div>
            </div>
          </div>
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:10px">Fotos del producto</div>
          <div class="fp-views-grid">
            ${[{c:'imgFrontal',l:'Vista Frontal'},{c:'imgIsometrica',l:'Vista Isométrica'},{c:'imgAerea',l:'Vista Lateral'}].map(({c,l})=>`
              <div>
                <div style="background:linear-gradient(135deg,#00d4cc,#0097a7);color:#fff;text-align:center;padding:6px 4px;border-radius:8px 8px 0 0;font-size:9px;font-weight:800;letter-spacing:1px;text-transform:uppercase">${l}</div>
                <label style="cursor:pointer;display:block;border:2px solid #00d4cc;border-top:none;border-radius:0 0 8px 8px;overflow:hidden;background:var(--surface);aspect-ratio:1/1">
                  <img loading="lazy" decoding="async" id="fpi-${idx}-${c}" src="${item[c]||''}" style="width:100%;height:100%;object-fit:contain;background:var(--surface);display:${item[c]?'block':'none'}">
                  <div id="fpp-${idx}-${c}" style="display:${item[c]?'none':'flex'};flex-direction:column;align-items:center;justify-content:center;height:100%;gap:6px;color:var(--text3)">
                    <span style="font-size:22px">📷</span>
                    <span style="font-size:9px;font-weight:600">Subir foto</span>
                  </div>
                  <input type="file" accept="image/*" style="display:none" onchange="handleFPImage(event,${idx},'${c}')">
                </label>
              </div>`).join('')}
          </div>
          <div style="font-size:9px;color:var(--text3);margin-top:6px">Las fotos se guardan localmente en este navegador al guardar la ficha.</div>
        </div>
      </div>
    </div>
  `).join('');
}
