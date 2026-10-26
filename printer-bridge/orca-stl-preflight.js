'use strict';
// STL has no standard unit metadata. Never send tiny ambiguous geometry to a
// GUI load_model call, because OrcaSlicer can show a blocking scale dialog.
const UNIT_FACTORS=Object.freeze({mm:1,m:1000,in:25.4});
const MAX_FACETS=500000;
const SMALL_VOLUME=8; // OrcaSlicer Model.cpp looks_like_imperial_units() threshold, mm^3
function bad(message,details=null){
  const e=new Error(message);
  e.code='STL_PREFLIGHT';
  if(details)e.details=details;
  return e;
}
function dimensions(min,max){
  return max.map((x,i)=>Math.max(0,x-min[i]));
}
function volumeOfTriangle(a,b,c){
  return (a[0]*(b[1]*c[2]-b[2]*c[1])
        +a[1]*(b[2]*c[0]-b[0]*c[2])
        +a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
}
function parseBinary(data,transform=1){
  const count=data.readUInt32LE(80);
  if(!count||count>MAX_FACETS||data.length!==84+count*50)
    throw bad('Archivo STL binario con triangulos inconsistentes.');
  const result=Buffer.from(data);
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  let signed=0;
  for(let i=0;i<count;i++){
    const off=84+50*i,tri=[];
    for(let j=0;j<3;j++){
      const vec=[];
      for(let k=0;k<3;k++){
        const offset=off+12+j*12+k*4;
        const num=data.readFloatLE(offset);
        if(!Number.isFinite(num)||Math.abs(num)>1e7)throw bad('Coordenadas STL fuera de rango.');
        const converted=num*transform;
        if(!Number.isFinite(converted)||Math.abs(converted)>1e7)throw bad('STL excede dimensiones permitidas.');
        vec.push(converted);min[k]=Math.min(min[k],converted);max[k]=Math.max(max[k],converted);
        if(transform!==1)result.writeFloatLE(converted,offset);
      }
      tri.push(vec);
    }
    signed+=volumeOfTriangle(...tri);
  }
  return{buffer:result,dimensions:dimensions(min,max),meshVolume:Math.abs(signed),facets:count,format:'binary'};
}
const ASCII_VERTEX=/^(\s*vertex\s+)([-+.\deE]+)(\s+)([-+.\deE]+)(\s+)([-+.\deE]+)(\s*)$/gm;
function parseAscii(data,transform=1){
  const txt=data.toString('utf8');
  if(!/^\s*solid(?:\s|$)/i.test(txt)||!/\bendsolid\b/i.test(txt))
    throw bad('No se reconoce un STL ASCII valido.');
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  let vertices=0,signed=0,tri=[];
  const out=txt.replace(ASCII_VERTEX,(_,lead,x,sep1,y,sep2,z,tail)=>{
    const numbers=[x,y,z].map(Number);
    if(numbers.some(n=>!Number.isFinite(n)||Math.abs(n)>1e7))
      throw bad('Coordenadas STL invalidas.');
    const scaled=numbers.map((n,k)=>{
      const v=n*transform;
      if(!Number.isFinite(v)||Math.abs(v)>1e7)throw bad('STL excede dimensiones permitidas.');
      min[k]=Math.min(min[k],v);max[k]=Math.max(max[k],v);return v;
    });
    tri.push(scaled);
    if(tri.length===3){signed+=volumeOfTriangle(...tri);tri=[];}
    vertices++;
    if(vertices>MAX_FACETS*3)throw bad('STL supera limite de triangulos.');
    return lead+scaled[0]+sep1+scaled[1]+sep2+scaled[2]+tail;
  });
  if(vertices<3||vertices%3||tri.length)throw bad('STL ASCII incompleto o sin triangulos.');
  return{buffer:Buffer.from(out,'utf8'),dimensions:dimensions(min,max),meshVolume:Math.abs(signed),facets:vertices/3,format:'ascii'};
}
function parse(data,transform=1){
  if(!Buffer.isBuffer(data)||data.length<30)throw bad('STL vacio o incompleto.');
  if(data.length>=84){
    const n=data.readUInt32LE(80);
    if(n>0&&n<=MAX_FACETS&&data.length===84+n*50)return parseBinary(data,transform);
  }
  return parseAscii(data,transform);
}
function formatNumber(n){
  if(!Number.isFinite(n))return '?';
  return Math.abs(n)>=10?n.toFixed(1):Math.abs(n)>=1?n.toFixed(2):n.toPrecision(3);
}
function dimensionText(dim){return dim.map(formatNumber).join(' x ');}
function scaleDiagnosis(observed,unit='auto',factor=1){
  const original=dimensionText(observed.dimensions);
  const physical=dimensionText(observed.dimensions.map(n=>n*factor));
  const alternatives=[
    'si eran metros: '+dimensionText(observed.dimensions.map(n=>n*1000))+' mm',
    'si eran pulgadas: '+dimensionText(observed.dimensions.map(n=>n*25.4))+' mm'
  ];
  const volume=observed.meshVolume;
  const volumeWarn=volume<0.0000000001&&Math.max(...observed.dimensions)>2
    ?' Volumen casi cero: la malla podria estar abierta o tener caras invertidas.'
    :'';
  return 'Geometria STL: '+original+' unidades; '+(unit==='auto'?'escala original':unit)+
    ' => '+physical+' mm. '+alternatives.join('; ')+'.'+volumeWarn;
}
function prepare(data,{filename,units='auto'}={}){
  if(!/\.stl$/i.test(String(filename||'')))return{buffer:data,units:'native',changed:false};
  if(!['auto','mm','m','in'].includes(units))throw bad('Unidades no admitidas. Escoge Auto, mm, metros o pulgadas.');
  const observed=parse(data);
  const originalSize=observed.dimensions.map(n=>+n.toFixed(4));
  const small=observed.meshVolume<SMALL_VOLUME||!Number.isFinite(observed.meshVolume);
  const details={dimensions:originalSize,meshVolume:+observed.meshVolume.toFixed(5),
    options:['mm','m','in'],reason:'STL sin unidades declaradas'};
  if(units==='auto'&&small)
    throw bad('Escala sin confirmar. '+scaleDiagnosis(observed)+ ' Selecciona las unidades reales desde el dashboard; no se abrio OrcaSlicer.',details);
  const factor=units==='auto'?1:UNIT_FACTORS[units];
  const selected=factor===1?observed:parse(data,factor);
  const maxDimension=Math.max(...selected.dimensions);
  if(!Number.isFinite(selected.meshVolume)||selected.meshVolume<SMALL_VOLUME ||
      maxDimension<2||maxDimension>800||
      selected.dimensions.some(n=>!Number.isFinite(n)))
    throw bad('No se puede laminar sin confirmacion de escala. '+scaleDiagnosis(observed,units,factor)+' Verifica el tamano o repara la malla antes de importar.',{
      ...details,selectedUnits:units,resultingDimensions:selected.dimensions.map(n=>+n.toFixed(4))
    });
  if(selected.buffer.length>12*1024*1024)throw bad('STL escalado excede el limite de 12 MB.');
  return{buffer:selected.buffer,units:units==='auto'?'mm':units,changed:factor!==1,
    factor,dimensions:selected.dimensions.map(n=>+n.toFixed(3)),originalDimensions:originalSize};
}
module.exports={prepare,parse,bad,UNIT_FACTORS,SMALL_VOLUME};
