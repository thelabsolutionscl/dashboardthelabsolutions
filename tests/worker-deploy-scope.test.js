#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const selector=path.join(root,'scripts/worker-deploy-targets.sh');
const workflow=fs.readFileSync(path.join(root,'.github/workflows/deploy-worker.yml'),'utf8');
function select(mode,input='',target='all'){
  const run=spawnSync('bash',[selector,mode,target],{input,encoding:'utf8'});
  return {status:run.status,stderr:run.stderr,
    outputs:Object.fromEntries(run.stdout.trim().split('\n').map(s=>s.split('=')))};
}
test('changes to Reportes proxy deploy the proxy but never automatically SII or leads',()=>{
  assert.deepEqual(select('push','airtable-proxy/src/worker.js\ndocs/audits/REPORTES.md\n').outputs,
    {lead:'false',proxy:'true',sii:'false'});
});
test('a lead-only or SII-only change cannot deploy unrelated Workers',()=>{
  assert.deepEqual(select('push','lead-worker/src/index.js\n').outputs,
    {lead:'true',proxy:'false',sii:'false'});
  assert.deepEqual(select('push','sii-worker/src/sii-auth.js\n').outputs,
    {lead:'false',proxy:'false',sii:'true'});
});
test('a mixed push schedules only the affected Workers and paths outside components deploy none',()=>{
  assert.deepEqual(select('push','airtable-proxy/src/worker.js\nsii-worker/src/sii-auth.js\n').outputs,
    {lead:'false',proxy:'true',sii:'true'});
  assert.deepEqual(select('push','docs/security/ACCESS_RBAC_ROLLOUT.md\n.github/workflows/deploy-worker.yml\n').outputs,
    {lead:'false',proxy:'false',sii:'false'});
});
test('manual deployment remains explicit with all and individual targets',()=>{
  for(const key of ['lead','proxy','sii']){
    const result=select('manual','',key);
    assert.equal(result.status,0);
    assert.equal(result.outputs[key],'true');
    assert.equal(Object.values(result.outputs).filter(x=>x==='true').length,1);
  }
  assert.deepEqual(select('manual','','all').outputs,
    {lead:'true',proxy:'true',sii:'true'});
  assert.equal(select('manual','','unknown').status,2);
});
test('all production jobs depend on selector and skip unrelated Workers',()=>{
  for(const [job,flag] of [['deploy','lead'],['deploy-proxy','proxy'],['deploy-sii','sii']]){
    assert.match(workflow,new RegExp('  '+job+':\\n    needs: detect\\n    if: needs\\.detect\\.outputs\\.'+flag+" == 'true'"));
  }
  assert.match(workflow,/git diff --name-only "\$BEFORE" "\$SHA"/);
  assert.match(workflow,/bash scripts\/worker-deploy-targets\.sh manual "\$TARGET"/);
  assert.match(workflow,/      - 'scripts\/worker-deploy-targets\.sh'/);
  assert.match(workflow,/      - all[\s\S]*      - lead[\s\S]*      - proxy[\s\S]*      - sii/);
});
