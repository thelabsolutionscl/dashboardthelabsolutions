'use strict';

// Adaptador MCP de OrcaSlicer (stdio / JSON-RPC). Solo lamina: no envia G-code a impresoras.
const fs=require('node:fs');
const fsp=fs.promises;
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const crypto=require('node:crypto');
const Guard=require('./orca-profile-guard.js');
const Auto=require('./orca-auto-profiles.js');
const StlPreflight=require('./orca-stl-preflight.js');
const Advisor=require('./orca-preslice-advisor.js');
const Geometry3MF=require('./orca-3mf-geometry.js');
const MAX_MODEL=12*1024*1024;
const MAX_GCODE=32*1024*1024;
const VALID_MODELS=new Set(['K1','K2','K2 Plus','Ender-5 Max','Giga']);
const VALID_MATERIALS=new Set(['PLA','PLA+','PETG','TPU','TPU-95A','ABS','ASA','PA','PC']);
let slicing=false;
const SLICE_NAME=/^(slice|slice_model|slice_stl|slice_file|orca_slice|orcaslicer_slice|laminar|laminar_modelo)$/i;

function settings(env=process.env){
  const configFile=env.ORCA_MCP_CONFIG_FILE||
    path.join(env.FARM_DATA_DIR||path.join(os.homedir(),'Library','Application Support','TheLabFarm'),'orca-mcp.json');
  let saved={};
  try{
    const st=fs.statSync(configFile);
    if(st.size>8192)throw new Error('Configuracion MCP demasiado grande');
    saved=JSON.parse(fs.readFileSync(configFile,'utf8'));
    if(!saved||typeof saved!=='object'||Array.isArray(saved))throw new Error('Configuracion MCP invalida');
  }catch(e){if(e.code!=='ENOENT')throw new Error('No se pudo leer orca-mcp.json: '+e.message);}
  const command=String(env.ORCA_MCP_COMMAND||saved.command||'').trim();
  let args=[];
  try{args=JSON.parse(env.ORCA_MCP_ARGS_JSON||JSON.stringify(saved.args||[]));}
  catch(_){throw new Error('ORCA_MCP_ARGS_JSON debe ser un array JSON');}
  if(!Array.isArray(args)||args.some(a=>typeof a!=='string')||args.length>12)
    throw new Error('ORCA_MCP_ARGS_JSON invalido');
  const e=saved.env&&typeof saved.env==='object'&&!Array.isArray(saved.env)?saved.env:{};
  const childEnv={};
  for(const key of ['ORCA_API_TOKEN','ORCA_API_URL']){
    const v=env[key]||e[key];
    if(v!=null){if(typeof v!=='string'||v.length>2048)throw Error('Invalid MCP environment: '+key);childEnv[key]=v;}
  }
  if(childEnv.ORCA_API_URL){
    let url;try{url=new URL(childEnv.ORCA_API_URL);}catch(_){throw Error('ORCA_API_URL invalida');}
    if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))
      throw Error('ORCA_API_URL solo permite localhost');
  }
  return{command,args,childEnv,preferredTool:String(env.ORCA_MCP_SLICE_TOOL||saved.sliceTool||'').trim()};
}
function cleanName(s){
  return String(s||'modelo.stl').split(/[\\/]/).pop().replace(/[^\w.\- ]/g,'_').slice(0,100);
}
function mcpClient(config, timeoutMs,workspace=''){
  const childEnv={...process.env,...config.childEnv};
  if(workspace)childEnv.PRINT_OUTCOMES_DIR=workspace;
  const child=spawn(config.command,config.args,{stdio:['pipe','pipe','pipe'],env:childEnv,windowsHide:true});
  let seq=0,buffer='',dead=false;
  const pending=new Map();
  const cleanup=(error)=>{
    if(dead)return;dead=true;
    for(const p of pending.values())p.reject(error||new Error('MCP desconectado'));
    pending.clear();
  };
  child.on('error',e=>cleanup(new Error('No se pudo iniciar MCP: '+e.message)));
  child.stdin.on('error',e=>cleanup(new Error('Canal MCP stdin: '+e.message)));
  child.stdout.on('error',e=>cleanup(new Error('Canal MCP stdout: '+e.message)));
  child.on('close',()=>cleanup(new Error('Servidor MCP finalizo la sesion')));
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{
    buffer+=chunk;
    if(buffer.length>48*1024*1024){cleanup(new Error('Respuesta MCP demasiado grande'));child.kill();return;}
    let split;
    while((split=buffer.indexOf('\n'))!==-1){
      const line=buffer.slice(0,split).trim();buffer=buffer.slice(split+1);
      if(!line.startsWith('{'))continue;
      let obj;try{obj=JSON.parse(line);}catch(_){continue;}
      if(!Object.prototype.hasOwnProperty.call(obj,'id'))continue;
      const entry=pending.get(obj.id);if(!entry)continue;pending.delete(obj.id);
      if(obj.error)entry.reject(new Error('MCP: '+String(obj.error.message||'error').slice(0,250)));
      else entry.resolve(obj.result||{});
    }
  });
  const timer=setTimeout(()=>{cleanup(new Error('Tiempo de espera MCP agotado'));child.kill();},timeoutMs);
  timer.unref?.();
  function send(method,params,notification=false){
    if(dead)return Promise.reject(new Error('MCP no esta disponible'));
    const id=++seq,body={jsonrpc:'2.0',method,params};
    if(!notification)body.id=id;
    if(notification){child.stdin.write(JSON.stringify(body)+'\n');return Promise.resolve({});}
    return new Promise((resolve,reject)=>{
      pending.set(id,{resolve,reject});
      child.stdin.write(JSON.stringify(body)+'\n',err=>{if(err){pending.delete(id);reject(err);}});
    });
  }
  return{
    async initialize(){
      await send('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'thelab-dashboard',version:'1.0.0'}});
      await send('notifications/initialized',{},true);
    },
    send,
    close(){clearTimeout(timer);cleanup(new Error('MCP cerrado'));child.kill();}
  };
}
async function withTools(config,timeout,callback,workspace=''){
  const client=mcpClient(config,timeout,workspace);
  try{
    await client.initialize();
    const list=await client.send('tools/list',{});
    if(!Array.isArray(list.tools))throw new Error('MCP no anuncio herramientas');
    return await callback(list.tools,client);
  }finally{client.close();}
}
function selectTool(tools,name){
  return tools.find(t=>t.name===name)||
    (!name?tools.find(t=>SLICE_NAME.test(t.name)):null);
}

function isLiveOrca(tools){
  return ['get_status','load_model','slice_and_wait','save_gcode'].every(name=>tools.some(t=>t.name===name));
}
function unpack(result){
  if(result?.isError)throw Error(String(result.content?.[0]?.text||'MCP error').slice(0,280));
  let data=result?.structuredContent;
  if(!data||typeof data!=='object'){
    const txt=result?.content?.find(c=>typeof c.text==='string')?.text||'';
    try{data=JSON.parse(txt);}catch(_){throw Error('Respuesta MCP sin JSON');}
  }
  if(data?.result&&typeof data.result==='object'&&!data.error)data=data.result;
  if(!data||typeof data!=='object')throw Error('Respuesta MCP vacia');
  if(data.error)throw Error('OrcaSlicer: '+String(data.error).slice(0,260));
  return data;
}
async function invoke(client,name,args={}){
  return unpack(await client.send('tools/call',{name,arguments:args}));
}
function asName(item){
  if(Array.isArray(item))return item.map(asName).join(' / ');
  if(typeof item==='string')return item;
  if(item&&typeof item==='object')return String(item.name||item.selected||item.value||'');
  return '';
}
function verifyProfiles(state,request){
  const presets=state.presets||state.active_presets||{};
  const printer=asName(presets.printer),filament=asName(presets.filament||presets.filaments),
    print=asName(presets.print||presets.process);
  if(!printer||!filament||!print)throw Error('OrcaSlicer no devuelve los 3 presets activos; verifica los perfiles en la app.');
  const detected=(printer.match(/\b(K2\s*Plus|K2|K1|Ender[- ]?5\s*Max|OrangeStorm\s*Giga|Giga)\b/i)||[])[0]||'';
  const norm=v=>String(v).toLowerCase().replace(/[^a-z0-9]/g,'');
  if(!detected||(norm(detected)!==norm(request.model)&&!(request.model==='Giga'&&/giga/i.test(detected))))
    throw Error('Perfil de impresora activo: '+printer+'. Debes seleccionar '+request.model+' en OrcaSlicer primero.');
  const selected=filament.toUpperCase(),need=request.material.toUpperCase();
  let matches=false;
  if(need==='PLA+')matches=/PLA\+|PLA\s*PLUS/.test(selected);
  else if(need==='TPU-95A')matches=/TPU[\s_-]*95A|95A[\s_-]*TPU/.test(selected);
  else matches=selected.split(/[^A-Z0-9+]+/).includes(need);
  if(!matches)throw Error('Filamento activo: '+filament+'. Cambia al material '+request.material+' en OrcaSlicer.');
  if(request.profile&&norm(request.profile)!==norm(print))
    throw Error('Perfil activo: '+print+'. Selecciona '+request.profile+' en OrcaSlicer.');
  if(state.slicing||state.is_slicing)throw Error('OrcaSlicer ya esta laminando');
  return{printer,filament,print};
}
async function autoPrepareProfiles(tools,client,request){
  if(!['get_status','list_presets','select_preset','list_objects'].every(name=>tools.some(t=>t.name===name)))
    throw Error('Este MCP no permite seleccion automatica segura de perfiles. Actualiza OrcaSlicer MCP.');
  let current=await invoke(client,'get_status');
  if(current.slicing||current.is_slicing)throw Error('OrcaSlicer esta laminando');
  const occupied=await invoke(client,'list_objects');
  if(!Array.isArray(occupied.objects))throw Error('OrcaSlicer no confirma si la placa esta vacia.');
  if(occupied.objects.length)throw Error('La placa contiene '+occupied.objects.length+' modelo(s). Guardalos y vacia la placa antes de laminar desde el dashboard.');

  const original=Guard.activeProfiles(current);
  const printerList=await invoke(client,'list_presets',{type:'printer',include_system:true});
  const plannedPrinter=Auto.choosePrinter(current,request.model,printerList,request.printerPresetName||'',request.machineNumber??'');
  // Preflight material before mutating the user's active project where possible.
  const initialFilament=Auto.sameMaterial(original.filament,request.material);
  if(!initialFilament){
    const filamentList=await invoke(client,'list_presets',{type:'filament',include_system:true});
    Auto.chooseFilament(current,request.material,filamentList,request.filamentPresetName||'');
  }
  if(request.profile){
    const processList=await invoke(client,'list_presets',{type:'print',include_system:true});
    const available=Auto.presetNames(processList,'print');
    if(!available.includes(request.profile))throw Error('No existe el perfil de proceso '+request.profile+' en OrcaSlicer.');
  }
  const changes=[];
  async function select(type,name){
    if(Guard.hasDirtyChanges(current))throw Error('No se cambio ningun perfil: hay modificaciones sin guardar en OrcaSlicer. Guardalas o descartalas manualmente antes de laminar.');
    await invoke(client,'select_preset',{type,name});
    current=await invoke(client,'get_status');
    if(current.slicing||current.is_slicing)throw Error('OrcaSlicer empezo a laminar durante el cambio de perfil');
    const final=Guard.activeProfiles(current);
    const actual=type==='printer'?final.printer:type==='filament'?final.filament:final.process;
    if(actual!==name)throw Error('OrcaSlicer no confirmo la seleccion de '+type+' "'+name+'".');
    changes.push({type,name});
  }
  if(plannedPrinter.change)await select('printer',plannedPrinter.chosen);
  // Printer switch may have changed filament/process as a side effect. Re-read.
  if(!Auto.sameMaterial(Guard.activeProfiles(current).filament,request.material) || request.filamentPresetName){
    const filaments=await invoke(client,'list_presets',{type:'filament',include_system:true});
    const choice=Auto.chooseFilament(current,request.material,filaments,request.filamentPresetName||'');
    if(choice.change)await select('filament',choice.chosen);
  }
  if(request.profile && Guard.activeProfiles(current).process!==request.profile)
    await select('print',request.profile);
  verifyProfiles(current,request);
  if(Guard.activeProfiles(current).printer!==plannedPrinter.chosen)
    throw Error('OrcaSlicer cambio el perfil de impresora inesperadamente. No se laminara.');
  return changes;
}

const PREFLIGHT_KEYS=[
  'layer_height','nozzle_diameter','line_width',
  'outer_wall_speed','inner_wall_speed','sparse_infill_speed',
  'internal_solid_infill_speed','top_surface_speed','initial_layer_speed',
  'gap_infill_speed','bridge_speed',
  'outer_wall_line_width','inner_wall_line_width','sparse_infill_line_width',
  'internal_solid_infill_line_width','top_surface_line_width',
  'initial_layer_line_width',
  'filament_max_volumetric_speed','filament_type','nozzle_temperature',
  'initial_layer_print_height','nozzle_temperature_initial_layer',
  'fan_min_speed','fan_max_speed','slow_down_layer_time',
  'retraction_length','use_firmware_retraction'
];
function validatePhysics(report){
  if(!report||!['ok','warnings','blocked'].includes(report.verdict)||
      !Array.isArray(report.fail)||!Array.isArray(report.warn))
    throw Error('El control fisico MCP no devolvio una evaluacion valida. Se cancela el laminado.');
  return report;
}
async function readPhysicalPlan(client,request){
  const cfg=await invoke(client,'get_config',{keys:PREFLIGHT_KEYS});
  if(!cfg?.config||typeof cfg.config!=='object')throw Error('OrcaSlicer no entrego la configuracion tecnica.');
  const current=validatePhysics(await invoke(client,'check_profile_physics'));
  const plan=Advisor.suggest(cfg.config,request.goal||'calidad');
  if(!plan.ok)throw Error('Analisis fisico previo: '+plan.reason);
  let proposed=current;
  if(Object.keys(plan.changes).length){
    proposed=validatePhysics(await invoke(client,'check_profile_physics',{changes:plan.changes}));
  }
  return{originalPhysics:current,proposedPhysics:proposed,plan};
}
function approvalHash(request,active,plan){
  return crypto.createHash('sha256').update(JSON.stringify({
    model:request.model,material:request.material,goal:request.goal||'calidad',
    activePrinter:active.printer,activeFilament:active.filament,activeProcess:active.process,
    fileSha256:crypto.createHash('sha256').update(String(request.modelBase64||'')).digest('hex'),
    units:request.stlUnits||'auto',changes:plan.changes,limit:plan.limit
  })).digest('hex');
}
async function preflight(request,env=process.env){
  const settingsForOrca=settings(env);
  if(!settingsForOrca.command)throw Error('OrcaSlicer MCP no configurado');
  const filename=cleanName(request.filename||'modelo.stl');
  if(!/\.(stl|3mf)$/i.test(filename)||!VALID_MODELS.has(request.model)||
      !VALID_MATERIALS.has(request.material))throw Error('Modelo, material o formato incompatible');
  if(typeof request.modelBase64!=='string'||request.modelBase64.length>Math.ceil(MAX_MODEL*4/3)+16)
    throw Error('Archivo STL/3MF vacio o muy grande');
  const source=Buffer.from(request.modelBase64,'base64');
  if(!source.length||source.length>MAX_MODEL)throw Error('Archivo STL/3MF vacio o muy grande');
  const prepared=StlPreflight.prepare(source,{filename,units:request.stlUnits||'auto'});
  const geometry=/\.stl$/i.test(filename)?Advisor.summarizeGeometry(StlPreflight.parse(prepared.buffer)):
    Geometry3MF.describe(prepared.buffer);
  return await withTools(settingsForOrca,60000,async(tools,client)=>{
    if(!['get_config','check_profile_physics','get_status'].every(x=>tools.some(t=>t.name===x)))
      throw Error('OrcaSlicer MCP no tiene los controles de analisis fisico previos al laminado');
    if(request.autoSelect===true)await autoPrepareProfiles(tools,client,request);
    const status=await invoke(client,'get_status');
    if(status.slicing||status.is_slicing)throw Error('OrcaSlicer esta laminando. No se puede analizar otro modelo.');
    const active=Guard.activeProfiles(status);
    const samePrinter=active.printerModel===request.model;
    const sameMaterial=Auto.sameMaterial(active.filament,request.material);
    if(!samePrinter||!sameMaterial)
      return{ok:true,geometry,prepared:{dimensions:prepared.dimensions||null,units:prepared.units},
        activePresets:active,ready:false,reason:'Para recomendaciones exactas debes activar primero el perfil de '+request.model+
        ' y el filamento '+request.material+' en OrcaSlicer. Se preservaron los ajustes existentes.',
        physics:null,proposedPhysics:null,changes:{},details:[]};
    const report=await readPhysicalPlan(client,request);
    const plannedBlocks=report.proposedPhysics.verdict==='blocked';
    return{ok:true,geometry,prepared:{dimensions:prepared.dimensions||null,units:prepared.units},
      activePresets:active,ready:!plannedBlocks,reason:plannedBlocks?
        'Los ajustes propuestos no superan todas las comprobaciones fisicas. No se puede laminar automaticamente.':'',
      physics:report.originalPhysics,proposedPhysics:report.proposedPhysics,
      changes:report.plan.changes,details:report.plan.details,
      safeFlow:report.plan.safetyFlow,limit:report.plan.limit,basis:report.plan.basis,
      approvalHash:approvalHash(request,active,report.plan)};
  });
}
async function applyPreslicePhysics(client,tools,request){
  if(!['check_profile_physics','get_config'].every(x=>tools.some(t=>t.name===x)))
    throw Error('Falta check_profile_physics; prohibido laminar sin preflight fisico');
  const report=await readPhysicalPlan(client,request);
  if(request.autoTune===true &&
      (!/^[a-f0-9]{64}$/.test(String(request.approvalHash||'')) ||
       request.approvalHash!==approvalHash(request,Guard.activeProfiles(await invoke(client,'get_status')),report.plan)))
    throw Error('La configuracion cambio desde el analisis previo. Repite Analizar antes de laminar.');
  if(request.autoTune===true && Object.keys(report.plan.changes).length){
    if(!tools.some(t=>t.name==='set_config'))
      throw Error('MCP no permite aplicar ajustes. No se laminara.');
    if(report.proposedPhysics.verdict==='blocked')
      throw Error('Ajustes seguros insuficientes: '+report.proposedPhysics.fail.map(x=>x.detail).join('; ').slice(0,350));
    // User approved exact bounded plan; validate before write and verify after.
    const outcome=await invoke(client,'set_config',{changes:report.plan.changes});
    if(outcome.errors&&(Array.isArray(outcome.errors)?outcome.errors.length:Object.keys(outcome.errors).length))
      throw Error('OrcaSlicer rechazo uno de los parametros propuestos.');
    const verified=await invoke(client,'get_config',{keys:Object.keys(report.plan.changes)});
    if(!verified?.config)throw Error('OrcaSlicer no confirmo los parametros aplicados.');
    for(const [key,wanted] of Object.entries(report.plan.changes)){
      const actual=Number(String(verified.config[key]??'').split(',')[0]);
      if(!Number.isFinite(actual)||Math.abs(actual-Number(wanted))>0.001)
        throw Error('OrcaSlicer no aplico '+key+' ('+String(wanted).slice(0,30)+'). No se laminara con parametros no verificados.');
    }
  }else if(report.originalPhysics.verdict==='blocked'){
    throw Error('No se inicio el laminado: parametros fisicos bloqueados. Ejecuta el analisis previo y acepta la optimizacion segura.');
  }
  const after=validatePhysics(await invoke(client,'check_profile_physics'));
  if(after.verdict==='blocked')
    throw Error('Se bloqueo el laminado ANTES del slicer: '+after.fail.map(x=>x.detail).join('; ').slice(0,350));
  return{before:report.originalPhysics,after,proposed:report.plan,applied:request.autoTune===true?report.plan.details:[]};
}
async function liveSlice(client,request,input,workspace,tools){
  let changes=[];
  if(request.autoSelect===true){
    changes=await autoPrepareProfiles(tools,client,request);
  }else{
    const state=await invoke(client,'get_status');
    verifyProfiles(state,request);
    const objects=await invoke(client,'list_objects');
    if(!Array.isArray(objects.objects)||objects.objects.length)
      throw Error('La placa de OrcaSlicer no esta confirmada vacia. Guardala y limpiala antes de continuar.');
  }
  await invoke(client,'load_model',{path:input});
  // 3MF can carry project presets: verify again after importing, not only before it.
  verifyProfiles(await invoke(client,'get_status'),request);
  const preSlice=await applyPreslicePhysics(client,tools,request);
  const result=await invoke(client,'slice_and_wait',{timeout:150});
  if(result.state!=='done')throw Error('Laminado no completado: '+String(result.message||result.state||'desconocido').slice(0,200));
  const saved=await invoke(client,'save_gcode',{filename:'laminado.gcode'});
  const output=String(saved.path||saved.gcode_path||saved.saved_path||'');
  const location=path.resolve(output);
  if(!output||!location.startsWith(workspace+path.sep))
    throw Error('El MCP no guardo el archivo en PRINT_OUTCOMES_DIR temporal');
  const stat=await fsp.stat(location);
  if(!stat.isFile()||stat.size<=0||stat.size>MAX_GCODE)throw Error('G-code vacio o excede 32 MB');
  const gcode=await fsp.readFile(location);
  const finalProfiles=verifyProfiles(await invoke(client,'get_status'),request);
  const afterSlice=validatePhysics(await invoke(client,'check_profile_physics'));
  if(afterSlice.verdict==='blocked')
    throw Error('G-code BLOQUEADO por control fisico: '+afterSlice.fail.map(x=>x.detail).join('; ').slice(0,350));
  const check=Guard.verifyGcode(gcode.toString('utf8'),request.model,finalProfiles.printer);
  if(!check.confirmed)throw Error('G-code sin metadatos de impresora verificables. Para evitar mezclar K1 y K2 no se entregara; revisa el perfil de OrcaSlicer.');
  const technicalAnalysis={physics:afterSlice,geometry:null,breakdown:null,settings:null,preSlice};
  try{
    const cfg=await invoke(client,'get_config',{keys:[
      'layer_height','initial_layer_print_height','wall_loops','top_shell_layers',
      'bottom_shell_layers','sparse_infill_density','sparse_infill_pattern',
      'enable_support','support_type','brim_type','brim_width',
      'outer_wall_speed','inner_wall_speed','nozzle_temperature',
      'hot_plate_temp','filament_max_volumetric_speed','nozzle_diameter'
    ]});
    technicalAnalysis.settings=cfg.config||null;
  }catch(_){technicalAnalysis.settings=null;}
  for(const [name,key] of [['describe_plate','geometry'],['get_slice_breakdown','breakdown']]){
    if(!name.startsWith('get_')&& !name.startsWith('describe_')&&name!=='check_profile_physics')continue;
    try{
      const report=await invoke(client,name);
      const trimmed=JSON.stringify(report);
      technicalAnalysis[key]=trimmed.length>6500?{summary:trimmed.slice(0,6500),truncated:true}:report;
    }catch(e){technicalAnalysis[key]={unavailable:true};}
  }
  const metric=result.stats||{};
  const safe=(v,max)=>v!=null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=max?Number(v):null;
  return{ok:true,tool:'load_model / slice_and_wait / save_gcode',
    filename:request.filename.replace(/\.(stl|3mf)$/i,'')+'.gcode',
    gcodeBase64:gcode.toString('base64'),bytes:gcode.length,
    seconds:safe(metric.estimated_time_seconds??metric.seconds,10000000),
    grams:safe(metric.filament_used_g??metric.grams,100000),
    activePresets:finalProfiles,profileChanges:changes,machineModel:request.model,material:request.material,
    gcodeCheck:{confirmed:check.confirmed,metadata:check.metadata,expected:request.model},
    technicalAnalysis,warnings:result.warnings||[]};
}

async function status(env=process.env){
  let config;try{config=settings(env);}catch(e){return{ok:false,available:false,reason:e.message,tools:[]};}
  if(!config.command)return{ok:true,available:false,reason:'Configura orca-mcp.json o las variables ORCA_MCP_COMMAND / ORCA_MCP_ARGS_JSON en el equipo del Farm Controller.',tools:[]};
  try{
    return await withTools(config,10000,async(tools,client)=>{
      const live=isLiveOrca(tools);
      let problem='',plateObjects=null,activePresets=null,dirtyChanges=null;
      if(live){
        try{
          const state=await invoke(client,'get_status');
          activePresets=Guard.activeProfiles(state);
          dirtyChanges=Guard.hasDirtyChanges(state);
          if(tools.some(t=>t.name==='list_objects')){
            const plate=await invoke(client,'list_objects');
            if(Array.isArray(plate.objects))plateObjects=plate.objects.length;
          }
        }catch(e){problem=e.message;}
      }
      const tool=live?{name:'OrcaSlicer Remote API'}:selectTool(tools,config.preferredTool);
      return{ok:true,available:!!tool&&!problem,tool:tool?.name||null,plateObjects,activePresets,dirtyChanges,mode:live?'live':'legacy',
        tools:tools.map(t=>t.name).filter(n=>/slice|orca|lamin|gcode|profile/i.test(n)).slice(0,25),
        reason:problem||(tool?'':'MCP conectado, pero no se encontro una herramienta de laminado. Configura ORCA_MCP_SLICE_TOOL.')};
    });
  }catch(e){return{ok:true,available:false,reason:e.message.slice(0,300),tools:[]};}
}
async function presets(env=process.env){
  const config=settings(env);
  return await withTools(config,45000,async(tools,client)=>{
    if(!isLiveOrca(tools)||!tools.some(t=>t.name==='list_presets'))throw Error('OrcaSlicer no expone list_presets.');
    const [status,list]=await Promise.all([
      invoke(client,'get_status'),
      invoke(client,'list_presets',{type:'printer',include_system:true})
    ]);
    const choices=(Array.isArray(list.printer)?list.printer:[])
      .filter(x=>x&&typeof x.name==='string'&&Guard.family(x.name))
      .map(x=>({name:x.name,model:Guard.family(x.name),selected:!!x.selected,system:!!x.system}))
      .slice(0,200);
    return{ok:true,activePresets:Guard.activeProfiles(status),
      dirtyChanges:Guard.hasDirtyChanges(status),presets:choices};
  });
}
async function selectPrinter(request,env=process.env){
  const model=String(request?.model||''),name=String(request?.presetName||'');
  if(!VALID_MODELS.has(model)||name.length>180||Guard.family(name)!==model)
    throw Error('Perfil de impresora no corresponde al modelo solicitado');
  if(slicing)throw Error('No se puede modificar el perfil durante un laminado');
  const config=settings(env);
  return await withTools(config,15000,async(tools,client)=>{
    if(!['select_preset','list_presets'].every(name=>tools.some(t=>t.name===name)))
      throw Error('MCP sin gestion de presets');
    const state=await invoke(client,'get_status');
    if(state.slicing||state.is_slicing)throw Error('OrcaSlicer esta laminando');
    const active=Guard.activeProfiles(state);
    if(active.printer===name)return{ok:true,activePresets:active,changed:false};
    if(Guard.hasDirtyChanges(state))throw Error('OrcaSlicer tiene cambios sin guardar. Guardalos o descartalos manualmente antes de cambiar de impresora.');
    const list=await invoke(client,'list_presets',{type:'printer',include_system:true});
    if(!Array.isArray(list.printer)||!list.printer.some(p=>p.name===name))
      throw Error('Perfil no encontrado en OrcaSlicer');
    await invoke(client,'select_preset',{type:'printer',name});
    const final=Guard.activeProfiles(await invoke(client,'get_status'));
    if(final.printer!==name||final.printerModel!==model)throw Error('OrcaSlicer no confirmo el cambio al perfil solicitado');
    return{ok:true,activePresets:final,changed:true,
      warning:'Comprueba el filamento y el perfil de proceso; OrcaSlicer puede ajustarlos al cambiar de impresora.'};
  });
}
function argumentsForTool(tool,request,input,output){
  const properties=tool.inputSchema?.properties||{};
  const values={
    model_path:input,input_path:input,file_path:input,stl_path:input,input_file:input,
    filename:input,path:input,file:input,
    output_path:output,output_file:output,gcode_path:output,destination:output,
    printer:request.model,printer_model:request.model,machine_model:request.model,
    model:request.model,material:request.material,filament:request.material,
    filament_type:request.material,profile:request.profile,profile_name:request.profile,
    process_profile:request.profile
  };
  const args={};
  for(const key of Object.keys(properties))if(Object.prototype.hasOwnProperty.call(values,key)){
    if(values[key])args[key]=values[key];
  }
  const required=tool.inputSchema?.required||[];
  const missing=required.filter(key=>!(key in args));
  if(missing.length)throw new Error('La herramienta MCP requiere parametros no soportados: '+missing.join(', '));
  if(!Object.keys(args).length)throw new Error('La herramienta MCP no acepta rutas de archivo conocidas');
  return args;
}
function gcodeFromMcp(result,workspace,output){
  const obj=result.structuredContent||{};
  const candidates=[output,obj.output_path,obj.gcode_path,obj.output_file,obj.file_path];
  for(const candidate of candidates){
    if(typeof candidate!=='string')continue;
    const filepath=path.resolve(candidate);
    if(!filepath.startsWith(workspace+path.sep))continue;
    try{
      const st=fs.statSync(filepath);
      if(st.isFile()&&st.size>0&&st.size<=MAX_GCODE)return fs.readFileSync(filepath);
    }catch(_){}
  }
  if(typeof obj.gcode_base64==='string')return Buffer.from(obj.gcode_base64,'base64');
  if(typeof obj.gcode==='string')return Buffer.from(obj.gcode,'utf8');
  return null;
}
async function slice(request,env=process.env){
  if(slicing)throw new Error('OrcaSlicer ya esta laminando otro trabajo');
  slicing=true;
  try{
  const config=settings(env);
  if(!config.command)throw new Error('MCP de OrcaSlicer no configurado en Farm Controller');
  const name=cleanName(request.filename||'modelo.stl');
  if(!/\.(stl|3mf)$/i.test(name))throw new Error('Solo se aceptan modelos STL o 3MF');
  if(!VALID_MODELS.has(request.model))throw new Error('Modelo de impresora no compatible');
  if(!VALID_MATERIALS.has(request.material))throw new Error('Material no compatible');
  if(request.profile!=null&&(typeof request.profile!=='string'||request.profile.length>120))
    throw new Error('Perfil demasiado largo');
  if(request.machineNumber!=null && !/^(?:[1-9]\d{0,2})$/.test(String(request.machineNumber)))
    throw new Error('Numero de impresora fisica invalido');
  if(request.printerPresetName!=null&&(typeof request.printerPresetName!=='string'||request.printerPresetName.length>180))
    throw new Error('Nombre de perfil de impresora demasiado largo');
  if(request.filamentPresetName!=null&&(typeof request.filamentPresetName!=='string'||request.filamentPresetName.length>180))
    throw new Error('Nombre de perfil de filamento demasiado largo');
  if(typeof request.modelBase64!=='string'||request.modelBase64.length>Math.ceil(MAX_MODEL*4/3)+16)
    throw new Error('Modelo vacio o demasiado grande (maximo 12 MB)');
  const model=Buffer.from(request.modelBase64,'base64');
  if(!model.length||model.length>MAX_MODEL)throw new Error('Modelo vacio o demasiado grande');
  // Before touching OrcaSlicer GUI: stop files which would open the
  // blocking 'Object too small' unit-selection modal on the workshop iMac.
  const prepared=StlPreflight.prepare(model,{filename:name,units:request.stlUnits||'auto'});
  const workspace=await fsp.mkdtemp(path.join(os.tmpdir(),'tls-orca-'));
  try{
    const input=path.join(workspace,name),output=path.join(workspace,'laminado.gcode');
    await fsp.writeFile(input,prepared.buffer,{mode:0o600});
    return await withTools(config,180000,async(tools,client)=>{
      if(isLiveOrca(tools)){
        const result=await liveSlice(client,request,input,workspace,tools);
        result.unitPreflight={units:prepared.units,changed:prepared.changed,
          factor:prepared.factor||1,dimensions:prepared.dimensions||null,
          orientationRepaired:!!prepared.orientationRepaired,
          orientationFlippedFaces:prepared.orientationFlippedFaces||0,
          inspectedMeshVolume:prepared.inspectedMeshVolume??null};
        return result;
      }
      if(request.autoSelect===true)throw Error('El MCP conectado no admite seleccion automatica segura de perfiles.');
      const tool=selectTool(tools,config.preferredTool);
      if(!tool)throw new Error('El MCP no expone herramienta de laminado. Revisa ORCA_MCP_SLICE_TOOL');
      const args=argumentsForTool(tool,request,input,output);
      const result=await client.send('tools/call',{name:tool.name,arguments:args});
      if(result.isError)throw new Error('El MCP devolvio un error de laminado: '+String(result.content?.[0]?.text||'sin detalle').slice(0,250));
      const gcode=gcodeFromMcp(result,workspace,output);
      if(!gcode||!gcode.length||gcode.length>MAX_GCODE)throw new Error('El MCP no produjo un G-code valido de hasta 32 MB en el directorio temporal');
      const sample=gcode.subarray(0,8192).toString('utf8');
      if(!/(?:^|\n)\s*(?:G[01289][01]?|M10[49]|;)/m.test(sample))
        throw new Error('El archivo devuelto no parece ser G-code');
      const stats=result.structuredContent||{};
      const finite=(v,max)=>Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=max?Number(v):null;
      return{ok:true,filename:name.replace(/\.(stl|3mf)$/i,'')+'.gcode',
        gcodeBase64:gcode.toString('base64'),bytes:gcode.length,tool:tool.name,
        seconds:finite(stats.seconds??stats.secs??stats.estimated_time_seconds,10000000),
        grams:finite(stats.grams??stats.filament_grams,100000)};
    },workspace);
  }finally{await fsp.rm(workspace,{recursive:true,force:true});}
  }finally{slicing=false;}
}
module.exports={status,slice,preflight,presets,selectPrinter,autoPrepareProfiles,settings,argumentsForTool,selectTool,MAX_MODEL,MAX_GCODE};
