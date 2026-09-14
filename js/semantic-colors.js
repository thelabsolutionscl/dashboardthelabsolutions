/* Shared status and metric presentation. Does not change records or actions. */
(function(global){
  'use strict';
  const normalize=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 /·-]+/g,' ').replace(/\s+/g,' ').trim();
  const groups={
    success:'completado|completada|completados|completadas|finalizado|finalizada|impresion finalizada|complete|completed|success|aprobado|aprobada|qa aprobado|despachado|despachados|entregado|entregada|pagado|pagada|cobrada|cobrado|pago total|al dia|disponible|disponibles|en linea · libre|publicado|publicada|resuelto|resuelta|respondido|respondida|activo|activa|cliente activo|conectado',
    production:'en produccion|produccion|imprimiendo|printing|procesando|processing|ejecutando|running|en curso|en proceso|trabajando|calibrando|en limpieza',
    warning:'pendiente|pendientes|solicitada|solicitado|en revision|qa pendiente|pago parcial|pago pendiente|por cobrar|por pagar|con deuda|negociacion|en evaluacion|pausado|pausada|paused|esperando repuesto|telemetria caida|sin respuesta|por vencer|aun no vence|ocupado|ocupada|en mantencion|stock bajo|bajo stock|revisar presupuesto|en cola',
    danger:'atrasado|atrasada|atrasados|entrega atrasada|vencido|vencida|vencidas|error|errores|failed|fallido|rechazado|rechazada|qa rechazado|bloqueado|fuera de servicio|detenida|shutdown|cancelado|cancelada|impresion cancelada|cancelled|anulada|critico|sin stock|agotado|ausente|con falla|exceso proyectado',
    info:'confirmado|confirmada|enviada|enviado|contactado|propuesta enviada|lead nuevo|nuevo|nueva|programada|programado|reservada|conectando|iniciando|remoto|reunion|listo para despacho|listos para despacho|listos despacho',
    analysis:'generado|generada|analisis|simulacion|proyeccion|estimacion|vacaciones',
    neutral:'borrador|borradores|inactivo|inactiva|cliente inactivo|en reposo|sin dato|sin datos|sin registros|sin fecha|sin estado|sin asignar|sin conexion|sin ip|desconocido|no disponible|offline|perdido|archivado'
  };
  const tones=new Map(Object.entries(groups).flatMap(([tone,labels])=>labels.split('|').map(l=>[l,tone])));
  function status(value,context){
    const s=normalize(value);
    if(context==='newsletter'&&/^enviad[oa]s?$/.test(s))return 'success';
    if(tones.has(s))return tones.get(s);
    return /^(\d+ dias de mora|\d+ fact vencidas?)$/.test(s)?'danger':null;
  }
  function metric(label,value){
    const s=normalize(label),v=normalize(value);
    if(!v||/^(sin datos?|sin registros|no disponible|-)$/.test(v))return 'neutral';
    // Never interpret an explicit absence or negation as a problem or success.
    if(/^(sin |no )/.test(s)&&!['sin respuesta','sin stock'].includes(s))return 'neutral';
    let tone=status(s);
    if(!tone){
      if(/\b(atrasados?|vencid[oa]s?|errores?|fallos?|rechazad[oa]s?|agotados?|exceso)\b/.test(s))tone='danger';
      else if(/\b(pendientes?|por cobrar|por pagar|por vencer|sin respuesta|deuda|stock bajo|alertas?|en cola)\b/.test(s))tone='warning';
      else if(/\b(produccion|imprimiendo|procesando|en curso|en proceso|ejecutando|trabajando)\b/.test(s))tone='production';
      else if(/\b(completad[oa]s?|despachad[oa]s?|entregad[oa]s?|cobrad[oa]s?|pagad[oa]s?|aprobad[oa]s?|publicad[oa]s?|resuelt[oa]s?|disponibles?)\b/.test(s))tone='success';
      else if(/\b(proyeccion|proyectado|estimado|margen|conversion|roas|roi|rendimiento|engagement|costo|coste|gasto|presupuesto|simulacion)\b/.test(s))tone='analysis';
      else if(/\b(ingresos?|ventas?|revenue|clientes?|leads?|visitas?|sesiones?|clics?|impresiones|alcance|audiencia|suscritos?|stock|inventario|maquinas?|pedidos?|cotizaciones?|programad[oa]s?|envios?|campanas?|equipo|trabajadores|eventos?|publicaciones|mensajes?|correos?|proveedores?|documentos?|archivos?|tokens?|ejecuciones|total|entrega)\b/.test(s))tone='info';
    }
    const n=String(value??'').replace(/[^0-9.,-]/g,'');
    if(['danger','warning'].includes(tone)&&n&&/^0+([.,]0+)*$/.test(n))return 'neutral';
    return tone;
  }
  const badges='.badge,.op-pill,.redes-pill,.status-text,.redes-cal-chip small,[data-semantic-status]';
  const metrics='.kpi-card,.stat-card,.fac-kpi,.cal-kpi,.of-kpi,.ofd-stat,.ss-stat,.avr-kpi,.op-metric,.op-priority,.redes-kpi,.op-facts>div';
  const labels='.kpi-label,.stat-label,.fac-kpi-lbl,.of-kpi-lbl,.ofd-stat-l,.ss-stat-label,.avr-kpi-label';
  const values='.kpi-value,.stat-value,.fac-kpi-val,.of-kpi-val,.ofd-stat-v,.ss-stat-val,.avr-kpi-value';
  function apply(node,tone,kind){
    if(!tone){node.removeAttribute('data-semantic-tone');node.removeAttribute('data-semantic-kind');return;}
    if(node.dataset.semanticTone!==tone)node.dataset.semanticTone=tone;
    if(node.dataset.semanticKind!==kind)node.dataset.semanticKind=kind;
  }
  function each(root,selector,fn){if(root.matches?.(selector))fn(root);root.querySelectorAll?.(selector).forEach(fn);}
  function decorate(root){
    if(!root||root.nodeType!==1)return;
    each(root,badges,n=>apply(n,status(n.dataset.semanticStatus||n.textContent,n.closest('#tab-newsletter')?'newsletter':null),'badge'));
    each(root,metrics,n=>{
      const l=n.querySelector(labels)||n.querySelector(':scope>span'),v=n.querySelector(values)||n.querySelector(':scope>strong,:scope>b');if(!l||!v)return;
      let tone=metric(l.textContent,v.textContent);
      if(/\b(margen|roas|roi|conversion|rentabilidad|alertas?|saldo|stock)\b/.test(normalize(l.textContent))){
        if(n.matches('.red,.fac-kpi-danger'))tone='danger';else if(n.matches('.orange'))tone='warning';else if(n.matches('.green'))tone='success';
      }
      if(!normalize(v.textContent)||/^(sin datos?|sin registros|-)$/.test(normalize(v.textContent)))tone='neutral';
      apply(n,tone,n.parentElement?.classList.contains('op-facts')?'fact':'metric');
    });
    each(root,'.op-record',n=>apply(n,n.querySelector('header .op-pill')?.dataset.semanticTone||null,'record'));
  }
  let frame=0;const pending=new Set();
  function queue(node){
    const root=node?.nodeType===1?node:node?.parentElement;
    if(!root||root.closest('script,style,textarea,input,[contenteditable="true"]'))return;
    pending.add(root.closest('.op-record')||root.closest(metrics+','+badges)||root);
    if(!frame)frame=requestAnimationFrame(()=>{frame=0;const roots=[...pending];pending.clear();roots.filter(r=>!roots.some(o=>o!==r&&o.contains(r))).forEach(decorate);});
  }
  function init(){decorate(document.body);new MutationObserver(changes=>changes.forEach(c=>{queue(c.target);if(c.addedNodes)c.addedNodes.forEach(queue);})).observe(document.body,{childList:true,subtree:true,characterData:true});}
  global.SemanticColors={status,metric,decorate};
  if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();}
})(typeof window!=='undefined'?window:globalThis);
