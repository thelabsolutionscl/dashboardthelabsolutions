#!/usr/bin/env node
'use strict';

/** Fuerza el listener público del Farm Controller a loopback.
 * cloudflared corre en el mismo host y debe apuntar a 127.0.0.1:8347.
 * El bridge legado vive en un proceso hijo separado, por lo que no se altera.
 */
const net=require('net');
const PORT=Number(process.env.BRIDGE_PORT||8347);
const HOST=String(process.env.FARM_BIND_HOST||'127.0.0.1');
const original=net.Server.prototype.listen;

function rewriteArgs(args){
  const out=[...args];
  if(typeof out[0]==='object'&&out[0]){
    const opts={...out[0]};
    if(Number(opts.port)===PORT)opts.host=HOST;
    out[0]=opts;return out;
  }
  if(Number(out[0])===PORT){
    if(typeof out[1]==='string')out[1]=HOST;
    else out.splice(1,0,HOST);
  }
  return out;
}
net.Server.prototype.listen=function(){return original.apply(this,rewriteArgs(arguments));};
module.exports={rewriteArgs,PORT,HOST};
