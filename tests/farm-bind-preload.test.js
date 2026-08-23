'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const path=require('path');
process.env.BRIDGE_PORT='8347';process.env.FARM_BIND_HOST='127.0.0.1';const b=require('../printer-bridge/farm-bind-preload.js');
test('reescribe el listener del proceso actual sólo en su puerto',()=>{assert.deepEqual(b.rewriteArgs([8347,'0.0.0.0']),[8347,'127.0.0.1']);assert.deepEqual(b.rewriteArgs([8348,'0.0.0.0']),[8348,'0.0.0.0']);assert.equal(b.rewriteArgs([{port:8347,host:'0.0.0.0'}])[0].host,'127.0.0.1');});
test('inyecta el bind preload al server.js hijo del bridge legado',()=>{const out=b.childArgs([path.join('/tmp','printer-bridge','server.js')],{env:{BRIDGE_PORT:'8348'}});assert.equal(out.args[0],'-r');assert.ok(out.args[1].endsWith('farm-bind-preload.js'));assert.ok(out.args.some(x=>x.endsWith('server.js')));assert.equal(out.options.env.FARM_BIND_HOST,'127.0.0.1');assert.equal(out.options.env.BRIDGE_PORT,'8348');});
test('no altera hijos que no son server.js',()=>{const args=['other.js'];const out=b.childArgs(args,{env:{BRIDGE_PORT:'8348'}});assert.deepEqual(out.args,args);});
