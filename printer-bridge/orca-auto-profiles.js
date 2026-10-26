'use strict';
// Deterministic, non-destructive selection: never guess between physical nozzle or brand variants.
const Guard=require('./orca-profile-guard.js');
function sameMaterial(preset,material){
  const name=String(preset||'').toUpperCase(),need=String(material||'').toUpperCase();
  if(need==='PLA+')return /(?:^|[^A-Z0-9])PLA(?:\+|\s*PLUS)(?:$|[^A-Z0-9])/.test(name);
  if(need==='TPU-95A')return /TPU[\s_-]*95A|95A[\s_-]*TPU/.test(name);
  const tokens=name.split(/[^A-Z0-9+]+/);
  if(need==='PLA')return tokens.includes('PLA')&&!sameMaterial(name,'PLA+');
  if(need==='TPU')return tokens.includes('TPU')&&!sameMaterial(name,'TPU-95A');
  return tokens.includes(need);
}
function presetNames(list,type){
  const arr=list&&list[type];
  if(!Array.isArray(arr))throw Error('OrcaSlicer no devuelve la lista de perfiles '+type);
  return [...new Set(arr.map(item=>item?.name).filter(name=>typeof name==='string'&&name.length<=180))];
}
function choosePrinter(status,model,list,preferred=''){
  const active=Guard.activeProfiles(status).printer;
  const names=presetNames(list,'printer').filter(name=>Guard.family(name)===model);
  if(preferred){
    if(!names.includes(preferred))
      throw Error('El perfil seleccionado "'+String(preferred).slice(0,100)+'" no existe o no corresponde a '+model+'. Revisa las boquillas en OrcaSlicer.');
    return{chosen:preferred,change:active!==preferred};
  }
  if(Guard.family(active)===model)return{chosen:active,change:false};
  if(names.length===1)return{chosen:names[0],change:true};
  if(!names.length)throw Error('No hay perfil de '+model+' instalado en OrcaSlicer. Configuralo antes de laminar.');
  throw Error('Hay '+names.length+' perfiles de '+model+' (pueden usar diferentes boquillas). Elige UNA VEZ el perfil exacto en el desplegable del dashboard; no se adivinara el diametro.');
}
function chooseFilament(status,material,list,preferred=''){
  const active=Guard.activeProfiles(status).filament;
  const names=presetNames(list,'filament').filter(name=>sameMaterial(name,material));
  if(preferred){
    if(!names.includes(preferred))throw Error('Perfil de filamento incompatible o inexistente para '+material);
    return{chosen:preferred,change:active!==preferred};
  }
  if(sameMaterial(active,material))return{chosen:active,change:false};
  if(names.length===1)return{chosen:names[0],change:true};
  if(!names.length)throw Error('No hay perfil de filamento '+material+' instalado en OrcaSlicer.');
  throw Error('Hay '+names.length+' perfiles para '+material+'. Selecciona el filamento especifico en OrcaSlicer antes de laminar para no confundir marcas o temperaturas.');
}
module.exports={sameMaterial,presetNames,choosePrinter,chooseFilament};
