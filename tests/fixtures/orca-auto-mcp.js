'use strict';
const fs=require('node:fs'),path=require('node:path');
const dirty=process.argv.includes('dirty'),fast=process.argv.includes('fast');
let printer='Creality K1 (0.4 nozzle)',filament='Generic PETG',buf='';
const config={layer_height:'0.2',nozzle_diameter:'0.4',line_width:'0.45',
 inner_wall_speed:fast?'300':'150',outer_wall_speed:'100',
 sparse_infill_speed:fast?'250':'130',top_surface_speed:'75',
 filament_max_volumetric_speed:'18',nozzle_temperature:'240',filament_type:'PETG'};
function reply(name,args){
 if(name==='get_status')return {presets:{printer,filament,print:'0.20 Standard'},
   modified:{printer:[],filament:dirty?['temp']:[],print:[]}};
 if(name==='list_objects')return {objects:[]};
 if(name==='list_presets')return {
   printer:[{name:'Creality K1 (0.4 nozzle)'},{name:'Creality K2 0.2 nozzle'},
     {name:'Creality K2 0.4 nozzle'}],
   filament:[{name:'Generic PLA'}],print:[{name:'0.20 Standard'}]};
 if(name==='select_preset'){
   if(args.type==='printer')printer=args.name;
   if(args.type==='filament')filament=args.name;
   return {ok:true};
 }
 if(name==='load_model'){if(!fs.existsSync(args.path))throw Error('missing stl');return{loaded:true};}
 if(name==='slice_and_wait')return {state:'done',stats:{estimated_time_seconds:720,filament_used_g:11},warnings:[]};
 if(name==='save_gcode'){
   const dest=path.join(process.env.PRINT_OUTCOMES_DIR,'gcode','out.gcode');
   fs.mkdirSync(path.dirname(dest),{recursive:true});
   fs.writeFileSync(dest,'; printer_settings_id = '+printer+'\nG1 X1 Y1 F1200\n');
   return{path:dest};
 }
 if(name==='get_config')return{config:{...config,filament_type:filament.includes('PLA')?'PLA':'PETG',
  nozzle_temperature:filament.includes('PLA')?'220':'240'}};
 if(name==='set_config'){
  Object.assign(config,args.changes||{});
  return{applied:Object.keys(args.changes||{}),errors:[]};
 }
 if(name==='check_profile_physics'){
  const c={...config,...(args.changes||{})};
  const layer=Number(c.layer_height),width=Number(c.line_width);
  const demand=Number(c.inner_wall_speed)*layer*(width-layer*(1-Math.PI/4));
  const max=filament.includes('PLA')?Math.min(18,(220-195)/1.2):Math.min(18,(240-220)/1.4);
  const blocked=demand>max;
  return{verdict:blocked?'blocked':'ok',pass:[],warn:[],fail:blocked?
   [{name:'flow_ceiling',detail:'inner wall requires '+demand.toFixed(1)+' > '+max.toFixed(1)}]:[]};
 }
 if(name==='describe_plate')return{objects:[]};
 if(name==='get_slice_breakdown')return{};
 return{};
}
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{buf+=chunk;let i;
 while((i=buf.indexOf('\n'))>=0){
 const line=buf.slice(0,i);buf=buf.slice(i+1);
 let req;try{req=JSON.parse(line);}catch(_){continue;}
 if(!req.id)continue;
 let value={};
 if(req.method==='initialize')value={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'mock',version:'0.1'}};
 else if(req.method==='tools/list')value={tools:[
 'get_status','list_objects','list_presets','select_preset','load_model','slice_and_wait',
 'save_gcode','get_config','set_config','check_profile_physics','describe_plate','get_slice_breakdown'
 ].map(name=>({name,inputSchema:{type:'object',properties:{}}}))};
 else if(req.method==='tools/call')value={structuredContent:reply(req.params.name,req.params.arguments||{})};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result:value})+'\n');
 }
});
