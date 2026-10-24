'use strict';

// Adaptador MCP de OrcaSlicer (stdio / JSON-RPC). Solo lamina: no envia G-code a impresoras.
const fs=require('node:fs');
const fsp=fs.promises;
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
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
async function liveSlice(client,request,input,workspace){
  const state=await invoke(client,'get_status');
  const profiles=verifyProfiles(state,request);
  const objects=await invoke(client,'list_objects');
  if(Array.isArray(objects.objects)&&objects.objects.length)
    throw Error('La placa de OrcaSlicer ya contiene modelos. Guardalos o limpiala antes de continuar.');
  await invoke(client,'load_model',{path:input});
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
  const metric=result.stats||{};
  const safe=(v,max)=>v!=null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=max?Number(v):null;
  return{ok:true,tool:'load_model / slice_and_wait / save_gcode',
    filename:request.filename.replace(/\.(stl|3mf)$/i,'')+'.gcode',
    gcodeBase64:gcode.toString('base64'),bytes:gcode.length,
    seconds:safe(metric.estimated_time_seconds??metric.seconds,10000000),
    grams:safe(metric.filament_used_g??metric.grams,100000),
    activePresets:profiles,warnings:result.warnings||[]};
}

async function status(env=process.env){
  let config;try{config=settings(env);}catch(e){return{ok:false,available:false,reason:e.message,tools:[]};}
  if(!config.command)return{ok:true,available:false,reason:'Configura orca-mcp.json o las variables ORCA_MCP_COMMAND / ORCA_MCP_ARGS_JSON en el equipo del Farm Controller.',tools:[]};
  try{
    return await withTools(config,10000,async(tools,client)=>{
      const live=isLiveOrca(tools);
      let problem='';
      if(live){try{await invoke(client,'get_status');}catch(e){problem=e.message;}}
      const tool=live?{name:'OrcaSlicer Remote API'}:selectTool(tools,config.preferredTool);
      return{ok:true,available:!!tool&&!problem,tool:tool?.name||null,mode:live?'live':'legacy',
        tools:tools.map(t=>t.name).filter(n=>/slice|orca|lamin|gcode|profile/i.test(n)).slice(0,25),
        reason:problem||(tool?'':'MCP conectado, pero no se encontro una herramienta de laminado. Configura ORCA_MCP_SLICE_TOOL.')};
    });
  }catch(e){return{ok:true,available:false,reason:e.message.slice(0,300),tools:[]};}
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
  if(typeof request.modelBase64!=='string'||request.modelBase64.length>Math.ceil(MAX_MODEL*4/3)+16)
    throw new Error('Modelo vacio o demasiado grande (maximo 12 MB)');
  const model=Buffer.from(request.modelBase64,'base64');
  if(!model.length||model.length>MAX_MODEL)throw new Error('Modelo vacio o demasiado grande');
  const workspace=await fsp.mkdtemp(path.join(os.tmpdir(),'tls-orca-'));
  try{
    const input=path.join(workspace,name),output=path.join(workspace,'laminado.gcode');
    await fsp.writeFile(input,model,{mode:0o600});
    return await withTools(config,180000,async(tools,client)=>{
      if(isLiveOrca(tools))return await liveSlice(client,request,input,workspace);
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
module.exports={status,slice,settings,argumentsForTool,selectTool,MAX_MODEL,MAX_GCODE};
