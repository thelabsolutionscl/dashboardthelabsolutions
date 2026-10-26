'use strict';
// Deterministic pre-slice recommendations. Never raise temp, nozzle, or the
// filament's max volumetric speed. Orca checks every proposed change before use.
const SPEED_WIDTHS=Object.freeze({
  outer_wall_speed:'outer_wall_line_width',
  inner_wall_speed:'inner_wall_line_width',
  sparse_infill_speed:'sparse_infill_line_width',
  internal_solid_infill_speed:'internal_solid_infill_line_width',
  top_surface_speed:'top_surface_line_width',
  initial_layer_speed:'initial_layer_line_width',
  gap_infill_speed:'line_width',bridge_speed:'line_width'
});
const MIN_TEMP=Object.freeze({PLA:[195,1.2],PETG:[220,1.4],ABS:[225,1.4],ASA:[225,1.4]});
function num(x){
  if(x==null||x==='')return null;
  const s=String(x).split(',')[0].trim();
  if(!/^\d+(?:\.\d+)?$/.test(s))return null;
  const v=Number(s);return Number.isFinite(v)?v:null;
}
function mm(cfg,key,nozzle){
  const raw=String(cfg[key]??'').split(',')[0].trim();
  if(raw.endsWith('%'))return Number(raw.slice(0,-1))*nozzle/100||null;
  const val=num(raw);return val>0?val:null;
}
function goalLayer(goal,nozzle,previous){
  if(!Number.isFinite(nozzle)||!Number.isFinite(previous))return null;
  const pct=goal==='calidad'?.4:goal==='rapidez'?.6:null;
  if(!pct)return null;const size=Math.round(nozzle*pct*100)/100;
  if(size<.1||size>.8*nozzle)return null;
  return {from:previous,to:goal==='calidad'?Math.min(previous,size):Math.max(previous,size)};
}
function suggest(config,goal='calidad'){
  if(!['calidad','rapidez','resistencia'].includes(goal))throw Error('Objetivo invalido');
  const c=config||{},layer=num(c.layer_height),nozzle=num(c.nozzle_diameter),
    filamentType=String(c.filament_type||'').toUpperCase().split(/[, ]/)[0],
    cap=num(c.filament_max_volumetric_speed),temp=num(c.nozzle_temperature);
  if(!(layer>0&&nozzle>0&&cap>0))return{ok:false,reason:'OrcaSlicer no informa altura de capa, boquilla o caudal maximo del filamento; no se adivinaran velocidades.',
    changes:{},details:[],limit:null};
  const sustainable=MIN_TEMP[filamentType]&&temp!=null?Math.max(0,(temp-MIN_TEMP[filamentType][0])/MIN_TEMP[filamentType][1]):null;
  const rawLimit=sustainable===null?cap:Math.min(cap,sustainable);
  if(rawLimit<=0)return{ok:false,reason:'Temperatura del filamento incompatible con el caudal solicitado. No se modificaran temperaturas automaticamente.',
    changes:{},details:[],limit:rawLimit};
  const safeLimit=Math.floor(rawLimit*.85*100)/100;
  const widthFallback=mm(c,'line_width',nozzle);
  const changes={},details=[];
  const layers=goalLayer(goal,nozzle,layer);
  if(layers && Math.abs(layers.to-layers.from)>.001){
    changes.layer_height=layers.to.toFixed(2);
    details.push({key:'layer_height',from:layers.from,to:layers.to,reason:'Altura de capa para '+goal});
  }
  const effectiveLayer=num(changes.layer_height)||layer;
  for(const [key,widthKey] of Object.entries(SPEED_WIDTHS)){
    const speed=num(c[key]),width=mm(c,widthKey,nozzle)||widthFallback;
    if(!(speed>0&&width>effectiveLayer*.22))continue;
    const section=(width-effectiveLayer*(1-Math.PI/4))*effectiveLayer;
    if(!(section>0))continue;
    const demand=section*speed;
    if(demand>safeLimit){
      // 5 mm/s increments, downwards only.
      const candidate=Math.floor(safeLimit/section/5)*5;
      if(candidate<5)return{ok:false,reason:'Caudal insuficiente incluso a 5 mm/s para la geometria de extrusión.',
        changes:{},details:[],limit:rawLimit};
      const to=Math.min(speed,candidate);
      if(to<speed){
        changes[key]=String(to);
        details.push({key,from:speed,to,flowBefore:+demand.toFixed(2),
          flowAfter:+(to*section).toFixed(2),reason:'Caudal <= 85% del limite seguro'});
      }
    }
  }
  return{ok:true,changes,details,limit:rawLimit,safetyFlow:safeLimit,filamentType,
    nozzle,layerBefore:layer,layerAfter:effectiveLayer,
    basis:'Caudal calculado, margen 15%, geometria basica y preferencia de calidad. No constituye calibracion fisica ni IA.'};
}
function summarizeGeometry(parsed){
  if(!parsed?.dimensions)return null;
  const d=parsed.dimensions.map(Number);
  if(d.some(x=>!Number.isFinite(x)||x<0))return null;
  const max=Math.max(...d),positive=d.filter(x=>x>.0001),min=positive.length?Math.min(...positive):0;
  const thin=max>0&&min/max<.1;
  return{dimensions:d.map(x=>+x.toFixed(2)),thin,facets:parsed.facets||null,
    note:thin?'Pieza de geometria delgada: confirmar orientacion, adhesion y altura minima de paredes.':
      'Revisar soportes, voladizos y orientacion visualmente antes de imprimir.'};
}
module.exports={suggest,summarizeGeometry,num};
