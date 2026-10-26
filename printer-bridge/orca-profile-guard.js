'use strict';
// Fail closed when active printer, selected destination or G-code metadata disagree.
function family(value){
  const s=String(value||'');
  if(/\bK2\s*Plus\b/i.test(s))return 'K2 Plus';
  if(/\bK2\s*(?:Pro|Max)\b/i.test(s))return null;
  if(/\bK1\s*(?:Max|SE)\b/i.test(s))return null;
  if(/\bK2\b/i.test(s))return 'K2';
  if(/\bK1\b/i.test(s))return 'K1';
  if(/Ender[-\s]?5\s*Max\b/i.test(s))return 'Ender-5 Max';
  if(/\b(?:OrangeStorm\s*)?Giga\b/i.test(s))return 'Giga';
  return null;
}
function metadata(gcode){
  const lines=String(gcode||'').split(/\r?\n/);
  const out=[];
  for(const line of lines){
    const m=line.match(/^;\s*(printer_settings_id|printer_model|machine_model|printer_preset|printer_type)\s*[:=]\s*(.*?)\s*$/i);
    if(m&&m[2])out.push({key:m[1],value:m[2].slice(0,160),model:family(m[2])});
  }
  return out;
}
function verifyGcode(gcode,model,preset){
  const expected=family(model);
  if(!expected||expected!==model)throw Error('Modelo de impresora no admitido: '+model);
  const found=metadata(gcode);
  const tagged=found.filter(x=>x.model);
  if(tagged.some(x=>x.model!==expected))
    throw Error('G-code NO seguro: declara '+tagged.filter(x=>x.model!==expected).map(x=>x.value).join(', ').slice(0,180)+' y se selecciono '+expected+'. No se entregara el archivo.');
  const active=family(preset);
  if(active!==expected)throw Error('Perfil OrcaSlicer incompatible con '+expected+': '+preset);
  return{metadata:found.slice(0,8),confirmed:tagged.some(x=>x.model===expected),
    warning:tagged.length?'':('El G-code no declara un perfil de impresora verificable; revisa el inicio de G-code en OrcaSlicer antes de imprimir.')};
}
function activeProfiles(status){
  const p=status?.presets||status?.active_presets||{};
  const asName=v=>Array.isArray(v)?v.map(asName).join(' / '):
    typeof v==='string'?v:(v&&typeof v==='object'?String(v.name||v.selected||v.value||''):'');
  return{printer:asName(p.printer),filament:asName(p.filament||p.filaments),
    process:asName(p.print||p.process),printerModel:family(asName(p.printer))};
}
function hasDirtyChanges(status){
  // Fail closed for unrecognized unsaved-change markers.
  const altered=status?.modified??status?.dirty??status?.unsaved_changes??null;
  if(altered===null)return true;
  if(typeof altered==='boolean')return altered;
  if(Array.isArray(altered))return altered.length>0;
  if(typeof altered==='object')return Object.values(altered).some(v=>
    v===true||(Array.isArray(v)&&v.length>0)||(typeof v==='object'&&v!==null&&Object.keys(v).length>0));
  return true;
}
module.exports={family,metadata,verifyGcode,activeProfiles,hasDirtyChanges};
