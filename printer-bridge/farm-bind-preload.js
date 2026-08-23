#!/usr/bin/env node
'use strict';

/** Fuerza listeners del proceso cargado a loopback.
 * Además, cuando Farm Controller lanza `server.js` como bridge legado hijo,
 * inserta este mismo preload en el child. Así 8348 tampoco queda expuesto en LAN.
 */
const net=require('net'),childProcess=require('child_process'),path=require('path');
const PORT=Number(process.env.BRIDGE_PORT||8347);
const HOST=String(process.env.FARM_BIND_HOST||'127.0.0.1');
const originalListen=net.Server.prototype.listen;

function rewriteArgs(args){
  const out=[...args];
  if(typeof out[0]==='object'&&out[0]){const opts={...out[0]};if(Number(opts.port)===PORT)opts.host=HOST;out[0]=opts;return out;}
  if(Number(out[0])===PORT){if(typeof out[1]==='string')out[1]=HOST;else out.splice(1,0,HOST);}return out;
}
net.Server.prototype.listen=function(){return originalListen.apply(this,rewriteArgs(arguments));};

const originalSpawn=childProcess.spawn;
function childArgs(args,options){
  const list=Array.isArray(args)?[...args]:args;if(!Array.isArray(list))return{args:list,options};
  const target=list[0]||'',env=options?.env||{};
  if(path.basename(String(target))==='server.js'&&env.BRIDGE_PORT&&Number(env.BRIDGE_PORT)!==PORT&&!list.includes(__filename)){
    return{args:['-r',__filename,...list],options:{...(options||{}),env:{...env,FARM_BIND_HOST:'127.0.0.1'}}};
  }
  return{args:list,options};
}
childProcess.spawn=function(command,args,options){const next=childArgs(args,options);return originalSpawn.call(this,command,next.args,next.options);};

module.exports={rewriteArgs,childArgs,PORT,HOST};
