const test=require('node:test');
const assert=require('node:assert/strict');
const adapter=require('../js/machineops-storage-adapter.js');
const t=adapter._test;

test('splitPayload separa dominios y meta',()=>{
  const src={version:4,updatedAt:123,jobs:[{id:'j1'}],spools:[{id:'s1'}],automation:{enabled:true}};
  const out=t.splitPayload(src);
  assert.equal(out.fragments.length,t.DOMAINS.length);
  const jobs=out.fragments.find(x=>x.domain==='jobs');
  assert.equal(jobs.name,'MACHINE_OPS_V3:jobs');
  assert.deepEqual(JSON.parse(jobs.notes).data,[{id:'j1'}]);
  assert.equal(JSON.parse(out.meta.notes).updatedAt,123);
});

test('composePayload migra desde legacy y sobrepone V3 confirmado',()=>{
  const records=[
    {id:'old',fields:{Name:'MACHINE_OPS_V2',Notes:JSON.stringify({version:4,updatedAt:10,jobs:[{id:'old'}],spools:[{id:'s1'}]})}},
    {id:'jobs',fields:{Name:'MACHINE_OPS_V3:jobs',Notes:JSON.stringify({schema:3,domain:'jobs',writtenAt:20,data:[{id:'new'}]})}},
    {id:'meta',fields:{Name:'MACHINE_OPS_V3:meta',Notes:JSON.stringify({schema:3,domain:'meta',writtenAt:21,version:4,updatedAt:30})}},
  ];
  const out=t.composePayload(records);
  assert.equal(out.normalized,2);
  assert.deepEqual(out.data.jobs,[{id:'new'}]);
  assert.deepEqual(out.data.spools,[{id:'s1'}]);
  assert.equal(out.data.updatedAt,30);
});

test('sin meta ignora fragmentos V3 incompletos',()=>{
  const records=[
    {fields:{Name:'MACHINE_OPS_V2',Notes:JSON.stringify({jobs:[{id:'legacy'}]})}},
    {fields:{Name:'MACHINE_OPS_V3:jobs',Notes:JSON.stringify({schema:3,domain:'jobs',writtenAt:20,data:[{id:'partial'}]})}},
  ];
  const out=t.composePayload(records);
  assert.equal(out.normalized,0);
  assert.deepEqual(out.data.jobs,[{id:'legacy'}]);
});

test('ignora un fragmento posterior al último meta confirmado',()=>{
  const records=[
    {fields:{Name:'MACHINE_OPS_V2',Notes:JSON.stringify({jobs:[{id:'legacy'}]})}},
    {fields:{Name:'MACHINE_OPS_V3:jobs',Notes:JSON.stringify({schema:3,domain:'jobs',writtenAt:20,data:[{id:'committed'}]})}},
    {fields:{Name:'MACHINE_OPS_V3:jobs',Notes:JSON.stringify({schema:3,domain:'jobs',writtenAt:30,data:[{id:'partial-future'}]})}},
    {fields:{Name:'MACHINE_OPS_V3:meta',Notes:JSON.stringify({schema:3,domain:'meta',writtenAt:21,version:4,updatedAt:21})}},
  ];
  assert.deepEqual(t.composePayload(records).data.jobs,[{id:'committed'}]);
});

test('wrapper divide MACHINE_OPS_V2 y escribe meta al final',async()=>{
  const calls=[];
  const root={
    airtableFetch:async()=>({records:[]}),
    _monitorUpsert:async(name,notes,idKey)=>{calls.push({name,notes,idKey});return true;},
  };
  assert.equal(adapter.install(root),true);
  await root._monitorUpsert('MACHINE_OPS_V2',JSON.stringify({version:4,updatedAt:999,jobs:[{id:'wrapped'}],spools:[]}), 'machineOpsRecordId');
  assert.equal(calls.some(c=>c.name==='MACHINE_OPS_V2'),false);
  assert.ok(calls.some(c=>c.name==='MACHINE_OPS_V3:jobs'));
  assert.equal(calls.at(-1).name,'MACHINE_OPS_V3:meta');
});
