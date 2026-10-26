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
// Parse machine identifiers such as "K1 No2", "K2 Nº12" or "K1 #3".
// Bare preset names such as "Creality K2 0.4 nozzle" do NOT identify a physical printer.
function machineNo(name){
  const match=String(name||'').match(/(?:^|[\s(_-])(?:No\.?|Nº|N°|#)\s*(\d{1,3})(?=$|[\s)._-])/i);
  return match?String(Number(match[1])):'';
}
function choosePrinter(status,model,list,preferred='',machineNumber=''){
  const active=Guard.activeProfiles(status).printer;
  const names=presetNames(list,'printer').filter(name=>Guard.family(name)===model);
  const wanted=machineNumber===''?'':String(Number(machineNumber));
  if(preferred){
    if(!names.includes(preferred))
      throw Error('El perfil seleccionado "'+String(preferred).slice(0,100)+'" no existe o no corresponde a '+model+'. Revisa las boquillas en OrcaSlicer.');
    return{chosen:preferred,change:active!==preferred};
  }
  if(!names.length)throw Error('No hay perfil de '+model+' instalado en OrcaSlicer. Configuralo antes de laminar.');
  // Prefer exact physical printer profile when identifiable, even if another K1 is active.
  if(wanted && /^\d+$/.test(wanted)){
    const matches=names.filter(name=>machineNo(name)===wanted);
    if(matches.length===1)return{chosen:matches[0],change:active!==matches[0]};
    if(matches.length>1)throw Error('Hay '+matches.length+' perfiles para '+model+' #'+wanted+' con boquillas distintas. Elige UNA VEZ el perfil exacto del desplegable.');
  }
  const shared=names.filter(name=>!machineNo(name));
  // Do not re-use another numbered machine preset merely because it is the same family.
  if(Guard.family(active)===model && (!wanted || !machineNo(active) || machineNo(active)===wanted))
    return{chosen:active,change:false};
  if(shared.length===1)return{chosen:shared[0],change:active!==shared[0]};
  if(names.length===1&&!machineNo(names[0]))return{chosen:names[0],change:active!==names[0]};
  throw Error('Hay varios perfiles o perfiles de otras maquinas para '+model+
    (wanted?' #'+wanted:'')+'. Elige UNA VEZ el perfil y diametro de boquilla correctos en el desplegable.');
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
module.exports={sameMaterial,presetNames,machineNo,choosePrinter,chooseFilament};
