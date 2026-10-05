#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const FARM=fs.readFileSync(path.join(ROOT,'printer-bridge','farm-controller.js'),'utf8');

function between(a,b){
  const i=FARM.indexOf(a),j=FARM.indexOf(b,i);
  assert.ok(i>=0&&j>i,'bloque esperado ausente');
  return FARM.slice(i,j);
}

test('Farm Controller intercepta /update antes del proxy legado y exige admin POST',()=>{
  const block=between("if(p==='/update')","if (p === '/farm/session'");
  assert.match(block,/req\.method!=='POST'/);
  assert.match(block,/requireRole\(req,res,'admin'\)/);
  assert.match(block,/UPDATE_ENABLED/);
  assert.ok(FARM.indexOf("if(p==='/update')")<FARM.indexOf("const minimum = routeMinimumRole"),'update debe resolverse en el padre antes del proxy');
});

test('actualización del padre usa únicamente fast-forward de origin/main',()=>{
  const block=between('function updateFarmController()','function routeMinimumRole');
  assert.match(block,/\['-C',REPO_DIR,'pull','--ff-only','origin','main'\]/);
  assert.doesNotMatch(block,/reset|checkout|--force/);
});
