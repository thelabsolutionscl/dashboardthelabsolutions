'use strict';
// Advisory read-only geometry from a 3MF package; never execute embedded code,
// import components, or overwrite the 3MF. Dimensions are approximate because
// production packages may apply instance transforms/beam lattices/components.
const zlib=require('node:zlib');
const MAX_XML=16*1024*1024;
function invalid(message){throw Error('3MF: '+message);}
function xmlFromZip(data){
  if(!Buffer.isBuffer(data)||data.length<22)invalid('archivo comprimido incompleto');
  const start=Math.max(0,data.length-65557);
  let eocd=-1;
  for(let pos=data.length-22;pos>=start;pos--){
    if(data.readUInt32LE(pos)===0x06054b50){eocd=pos;break;}
  }
  if(eocd<0)invalid('sin directorio ZIP');
  const n=data.readUInt16LE(eocd+10),central=data.readUInt32LE(eocd+16);
  if(n>250||central>=data.length)invalid('archivo con demasiadas entradas');
  let pos=central;
  for(let i=0;i<n;i++){
    if(pos+46>data.length||data.readUInt32LE(pos)!==0x02014b50)invalid('directorio invalido');
    const method=data.readUInt16LE(pos+10),csize=data.readUInt32LE(pos+20),
      usize=data.readUInt32LE(pos+24),nl=data.readUInt16LE(pos+28),
      extra=data.readUInt16LE(pos+30),comment=data.readUInt16LE(pos+32),
      lo=data.readUInt32LE(pos+42);
    if(pos+46+nl+extra+comment>data.length)invalid('entrada truncada');
    const name=data.toString('utf8',pos+46,pos+46+nl);
    pos+=46+nl+extra+comment;
    if(!/\.model$/i.test(name)||!/3d/i.test(name))continue;
    if(usize>MAX_XML||csize>MAX_XML||lo+30>data.length||
       data.readUInt32LE(lo)!==0x04034b50)invalid('modelo demasiado grande o encabezado invalido');
    const ln=data.readUInt16LE(lo+26),ex=data.readUInt16LE(lo+28);
    const off=lo+30+ln+ex;
    if(off+csize>data.length)invalid('contenido truncado');
    const payload=data.subarray(off,off+csize);
    const plain=method===0?payload:method===8?
      zlib.inflateRawSync(payload,{maxOutputLength:MAX_XML}):invalid('compresion no soportada');
    if(plain.length>MAX_XML)invalid('XML excede limite');
    return plain.toString('utf8');
  }
  invalid('no se encontro el modelo XML');
}
function attr(attrs,name){
  const m=attrs.match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*["\\x27]([^"\\x27]*)["\\x27]','i'));
  return m?.[1]||null;
}
function describe(data){
  const xml=xmlFromZip(data);
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))invalid('entidades XML no admitidas');
  const root=xml.match(/<model\b([^>]*)>/i);
  if(!root)invalid('raiz model ausente');
  const unit=String(attr(root[1],'unit')||'millimeter').toLowerCase();
  const factors={millimeter:1,centimeter:10,meter:1000,inch:25.4,foot:304.8,micron:.001};
  if(!(unit in factors))invalid('unidad no soportada');
  const f=factors[unit],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  let count=0;
  const vertices=/<vertex\b([^>]*)\/?>/gi;
  let m;while((m=vertices.exec(xml))){
    const v=['x','y','z'].map(axis=>Number(attr(m[1],axis)));
    if(v.some(x=>!Number.isFinite(x)||Math.abs(x)>1e6))invalid('coordenadas invalidas');
    for(let k=0;k<3;k++){min[k]=Math.min(min[k],v[k]*f);max[k]=Math.max(max[k],v[k]*f);}
    if(++count>250000)invalid('demasiados vertices');
  }
  if(!count)return{dimensions:null,facets:null,note:'3MF sin malla de vertices reconocible',unit};
  const dims=max.map((x,i)=>+(x-min[i]).toFixed(2));
  const buildTransform=/<item\b[^>]*\btransform\s*=/i.test(xml);
  const components=/<components\b/i.test(xml);
  return{dimensions:buildTransform||components?null:dims,facets:(xml.match(/<triangle\b/gi)||[]).length,
    vertices:count,unit,thin:!buildTransform&&!components&&Math.max(...dims)>0&&Math.min(...dims)/Math.max(...dims)<.1,
    note:buildTransform||components?'Modelo 3MF con instancias o transformaciones: revisar dimensiones en OrcaSlicer.':
      'Dimensiones calculadas de los vertices del 3MF; aun requiere revisar voladizos, orientacion y soportes.'};
}
module.exports={describe};
