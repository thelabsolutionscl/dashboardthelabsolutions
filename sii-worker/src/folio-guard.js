/*
 * SiiFolioGuard — un Durable Object por tipo de DTE.
 *
 * No se puede reservar un folio con una lectura + escritura KV: Cloudflare KV
 * es eventualmente consistente y dos invocaciones concurrentes pueden obtener
 * el mismo siguiente número. Esta instancia serializa las operaciones y
 * persiste el máximo ANTES de cualquier llamada externa al SII.
 *
 * La reserva NO se revierte por timeout, fallo de red o falta de TrackID: una
 * emisión de resultado ambiguo requiere conciliación manual con SII, nunca
 * reutilizar el mismo folio.
 */
const SUPPORTED = new Set(['33','39','61','56','52']);

function cafRange(xml, tipo) {
  const str=String(xml||'');
  const desde=Number((str.match(/<D>(\d+)<\/D>/)||[])[1]);
  const hasta=Number((str.match(/<H>(\d+)<\/H>/)||[])[1]);
  const cafTipo=(str.match(/<TD>(\d+)<\/TD>/)||[])[1];
  if (!Number.isSafeInteger(desde)||!Number.isSafeInteger(hasta)||desde<1||hasta<desde)
    throw Object.assign(new Error('CAF inválido: rango de folios ausente'),{status:400});
  if (!cafTipo || cafTipo!==tipo)
    throw Object.assign(new Error('CAF inválido: tipo de documento no coincide con el CAF'),{status:400});
  return {desde,hasta};
}
function reply(data,status=200) {
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
}
function folioNumber(value) {
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=0?n:0;
}

export class SiiFolioGuard {
  constructor(state,env) {
    this.state=state;
    this.env=env;
    this.queue=Promise.resolve();
  }

  async fetch(request) {
    // El runtime de Durable Objects permite que dos handlers se intercalen
    // cuando esperan fetch/KV. Encadenar TODA la operación (incluido KV) lo
    // impide; DO.storage guarda el high-water incluso si el isolate reinicia.
    const task=this.queue.then(()=>this.dispatch(request));
    this.queue=task.catch(()=>{});
    return task.catch(e=>reply({error:e&&e.message||'Error de reserva de folio'},e.status||500));
  }

  async dispatch(request) {
    let body;
    try { body=await request.json(); }
    catch (_) {return reply({error:'JSON inválido'},400);}
    const tipo=String(body?.tipo||''),op=String(body?.op||'');
    if (!SUPPORTED.has(tipo)) return reply({error:'Tipo de DTE no permitido'},400);
    const kv=this.env.FOLIOS_KV;
    if (!kv || !this.state?.storage) return reply({error:'Guard de folios no configurado'},503);

    // Idempotencia durable por pedido y tipo de DTE (la instancia ya se separa
    // por tipo). /begin y /complete solo son invocados desde el Worker SII;
    // el navegador nunca puede llamar al Durable Object directamente.
    const idemOp=op==='begin'||op==='complete';
    const pedidoId=String(body?.pedido_id||'');
    const fingerprint=String(body?.fingerprint||'');
    if(idemOp && (!/^rec[A-Za-z0-9]{5,}$/.test(pedidoId)||!/^[a-f0-9]{64}$/.test(fingerprint)))
      return reply({error:'Identificador de pedido o firma de documento inválidos'},400);
    const idemKey=idemOp?'emision:'+pedidoId:null;
    if(op==='complete'){
      const current=await this.state.storage.get(idemKey);
      if(!current||current.fingerprint!==fingerprint||current.folio!==Number(body.folio))
        return reply({error:'Emisión sin reserva previa o firma inconsistente'},409);
      if(current.estado==='completado')return reply({ok:true,replayed:true,folio:current.folio});
      const receipt=body.receipt;
      if(!receipt||!receipt.trackid||Number(receipt.dte_numero)!==current.folio||
          String(receipt.tipo_documento)!==tipo)
        return reply({error:'Confirmación del SII sin TrackID/folio válido'},422);
      // Respuesta completa primero en almacenamiento durable: una caída del
      // navegador tras subir al SII puede recuperarla sin emitir otro DTE.
      await this.state.storage.put(idemKey,{...current,estado:'completado',
        receipt,completado_en:new Date().toISOString()});
      return reply({ok:true,replayed:false,folio:current.folio});
    }
    const previous=folioNumber(await this.state.storage.get('last'));
    const legacy=folioNumber(await kv.get('folio_'+tipo));
    const highWater=Math.max(previous,legacy);
    if(op==='begin'){
      const current=await this.state.storage.get(idemKey);
      if(current){
        if(current.fingerprint!==fingerprint)
          return reply({error:'Ya existe una emisión para este pedido y tipo con contenido diferente; conciliar antes de emitir otra',code:'DTE_DOCUMENT_CONFLICT',folio:current.folio},409);
        if(current.estado==='completado')
          return reply({replayed:true,receipt:current.receipt,folio:current.folio},200);
        return reply({error:'Emisión anterior no confirmada: verificar en SII antes de reintentar',code:'DTE_PENDING_RECONCILIATION',folio:current.folio},409);
      }
    }

    if(op==='upload') {
      const xml=String(body.caf_xml||'');
      const range=cafRange(xml,tipo);
      // No aceptar un CAF que solo contiene números ya reservados, ni volver
      // a un rango anterior: nada puede hacer retroceder el high-water.
      if (highWater>=range.hasta)
        return reply({error:'CAF anterior o sin folios futuros: no se puede retroceder el contador'},409);
      const start=Math.max(highWater,range.desde-1);
      // DO.storage es la fuente de verdad para reserva/CAF. KV permanece como
      // espejo compatible con herramientas anteriores (nunca como candado).
      await this.state.storage.put('caf',xml);
      await this.state.storage.put('last',start);
      await kv.put('caf_'+tipo,xml);
      await kv.put('folio_'+tipo,String(start));
      return reply({ok:true,tipo_documento:tipo,rango:range,
        siguiente_folio:start+1,contador_conservado:highWater>=range.desde});
    }

    const cafXml=(await this.state.storage.get('caf'))||await kv.get('caf_'+tipo);
    if (!cafXml) return reply({error:'Sin CAF configurado para tipo '+tipo},404);
    const range=cafRange(cafXml,tipo);
    const last=Math.max(highWater,range.desde-1);

    if(op==='status') {
      const remaining=Math.max(0,range.hasta-last);
      return reply({tipo_documento:tipo,folio_actual:last,
        siguiente_folio:last+1,rango_caf:range,folios_disponibles:remaining,
        advertencia:remaining<=10?'⚠ Quedan pocos folios — solicita nuevo CAF al SII':null});
    }
    if(op!=='reserve') return reply({error:'Operación no permitida'},400);
    const next=last+1;
    if(next>range.hasta)
      return reply({error:'Folios agotados para tipo '+tipo+
        ' (rango CAF: '+range.desde+'-'+range.hasta+'). Solicita nuevo CAF al SII.'},409);

    // COMMIT ANTES DEL ENVÍO: este número nunca volverá a reservarse.
    // Para emisiones identificadas, el folio y la reserva de ese pedido
    // deben quedar JUNTOS en una transacción durable: un reinicio no puede
    // conservar el número y perder la relación de idempotencia.
    if(op==='begin'){
      if(typeof this.state.storage.transaction!=='function')
        return reply({error:'Durable Object sin transacciones: emisión bloqueada'},503);
      await this.state.storage.transaction(async txn=>{
        await txn.put('last',next);
        await txn.put(idemKey,{pedido_id:pedidoId,fingerprint,folio:next,
          tipo_documento:tipo,estado:'pendiente',creado_en:new Date().toISOString()});
      });
    }else{
      await this.state.storage.put('last',next);
    }
    // KV es espejo; su fallo NO permite volver a usar el número reservado.
    try{await kv.put('folio_'+tipo,String(next));}
    catch(e){console.error('[SII FolioGuard] KV espejo falló tras reserva segura:',e&&e.message);}
    return reply({folio:next,tipo_documento:tipo,caf_xml:cafXml,consumido:true,
      ...(op==='begin'?{idempotencia:'reservada'}:{})});
  }
}
