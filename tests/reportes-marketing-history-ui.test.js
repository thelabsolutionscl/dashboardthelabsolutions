#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createPager,validatePage,_test}=require('../js/reportes-marketing-history.js');
const month='2026-09',earlier='2026-08';
const entry=(n,m=month)=>({revision:n,month:m,channel:'Google Ads',before_clp:n-1,
  after_clp:n,actor_email:'finance@example.com',at:'2026-09-29T12:00:00Z'});
function backend(data){
  const calls=[];
  async function fetchPage(m,before){
    calls.push({month:m,before});
    const all=(data[m]||[]).sort((a,b)=>b.revision-a.revision);
    const remain=before===null?all:all.filter(e=>e.revision<before);
    const events=remain.slice(0,100);
    return {month:m,events,latest_revision:all[0]?.revision||0,
      has_more:remain.length>100,
      next_before_revision:remain.length>100?events.at(-1).revision:null};
  }
  return{calls,fetchPage};
}
test('UI pager reads 205 revisions without duplicates and preserves a cursor during concurrent writes',async()=>{
  const data={[month]:Array.from({length:205},(_,i)=>entry(i+1))};
  const api=backend(data),states=[],pager=createPager(api.fetchPage,s=>states.push(s));
  pager.reset(month);
  assert.equal(await pager.loadMore(),true);
  let s=pager.snapshot();
  assert.equal(s.events.length,100);
  assert.equal(s.cursor,106);
  assert.equal(s.latestRevision,205);
  data[month].push(entry(206));
  assert.equal(await pager.loadMore(),true);
  s=pager.snapshot();
  assert.equal(s.events.length,200);
  assert.equal(s.cursor,6);
  assert.equal(s.newerAvailable,true);
  assert.equal(await pager.loadMore(),true);
  s=pager.snapshot();
  assert.equal(s.events.length,205);
  assert.equal(s.hasMore,false);
  assert.equal(s.cursor,null);
  assert.deepEqual(s.events.map(e=>e.revision),
    Array.from({length:205},(_,i)=>205-i));
  assert.equal(await pager.loadMore(),false);
  assert.deepEqual(api.calls,[{month,before:null},{month,before:106},{month,before:6}]);
  assert.ok(states.some(x=>x.loading===true));
});
test('changing the month resets the cursor and never mixes audit events from different months',async()=>{
  const data={[month]:[entry(1)], [earlier]:[entry(2,earlier),entry(1,earlier)]};
  const api=backend(data),pager=createPager(api.fetchPage);
  pager.reset(month);await pager.loadMore();
  pager.reset(earlier);await pager.loadMore();
  const s=pager.snapshot();
  assert.equal(s.month,earlier);
  assert.deepEqual(s.events.map(e=>e.revision),[2,1]);
  assert.ok(s.events.every(e=>e.month===earlier));
  assert.equal(s.hasMore,false);
});
test('failed older page preserves earlier results and retries the exact same cursor',async()=>{
  const api=backend({[month]:Array.from({length:101},(_,i)=>entry(i+1))});
  let fail=true;
  const pager=createPager(async(m,before)=>{
    if(before!==null&&fail){fail=false;throw new Error('network failed');}
    return api.fetchPage(m,before);
  });
  pager.reset(month);
  await pager.loadMore();
  assert.equal((await pager.loadMore()),false);
  let s=pager.snapshot();
  assert.equal(s.events.length,100);
  assert.equal(s.cursor,2);
  assert.equal(s.error,'network failed');
  assert.equal((await pager.loadMore()),true);
  s=pager.snapshot();
  assert.equal(s.events.length,101);
  assert.equal(s.error,'');
  assert.deepEqual(s.events.map(e=>e.revision),Array.from({length:101},(_,i)=>101-i));
});
test('a slow response for the previous month cannot replace the current period',async()=>{
  let release;
  const slow=new Promise(resolve=>{release=resolve;});
  const pager=createPager((m)=>m===month?slow:Promise.resolve({
    month:earlier,events:[entry(1,earlier)],latest_revision:1,has_more:false,
    next_before_revision:null
  }));
  pager.reset(month);
  const first=pager.loadMore();
  pager.reset(earlier);
  assert.equal(await pager.loadMore(),true);
  release({month,events:[entry(500)],latest_revision:500,has_more:false,
    next_before_revision:null});
  assert.equal(await first,false);
  assert.equal(pager.snapshot().month,earlier);
  assert.deepEqual(pager.snapshot().events.map(e=>e.revision),[1]);
});
test('duplicate, out-of-order, wrong-month and broken cursors fail closed',async()=>{
  const cases=[
    {month,events:[entry(5),entry(5)],latest_revision:5,has_more:false,next_before_revision:null},
    {month,events:[entry(4),entry(5)],latest_revision:5,has_more:false,next_before_revision:null},
    {month,events:[entry(5,earlier)],latest_revision:5,has_more:false,next_before_revision:null},
    {month,events:[entry(5)],latest_revision:5,has_more:true,next_before_revision:4},
    {month,events:[],latest_revision:5,has_more:true,next_before_revision:5},
    {month,events:[entry(5)],latest_revision:5,has_more:false,next_before_revision:1}
  ];
  for(const broken of cases){
    assert.throws(()=>validatePage(broken,month,null),{code:'integrity'});
    const pager=createPager(async()=>broken);
    pager.reset(month);
    assert.equal(await pager.loadMore(),false);
    assert.equal(pager.snapshot().errorCode,'integrity');
    assert.deepEqual(pager.snapshot().events,[]);
  }
});
test('server replay of an already shown revision does not double-count the audit',async()=>{
  let count=0;
  const pager=createPager(async()=>{
    count++;
    if(count===1)return {month,events:[entry(3),entry(2)],latest_revision:3,has_more:true,next_before_revision:2};
    return {month,events:[entry(2),entry(1)],latest_revision:3,has_more:false,next_before_revision:null};
  });
  pager.reset(month);await pager.loadMore();
  assert.equal(await pager.loadMore(),false);
  assert.equal(pager.snapshot().events.length,2);
  assert.equal(pager.snapshot().errorCode,'integrity');
});
test('shared Access endpoint is read-only, same-site, and withholds the public key from unknown hosts',async()=>{
  let req=null;
  const config={url:'https://proxy.thelab.solutions',key:'test-public-proxy-key'};
  const root={_proxyCfg:()=>config,fetch:async(url,options)=>{
    req={url,options};
    return Response.json({month,events:[],latest_revision:0,has_more:false,next_before_revision:null});
  }};
  const fetchPage=_test.realFetch(root);
  assert.equal((await fetchPage(month,null)).month,month);
  assert.equal(new URL(req.url).searchParams.get('month'),month);
  assert.equal(req.options.method,'GET');
  assert.equal(req.options.credentials,'include');
  assert.equal(req.options.redirect,'manual');
  assert.equal(req.options.headers['X-App-Key'],config.key);
  assert.equal(new URL(req.url).origin,config.url);
  req=null;
  config.url='https://untrusted.example';
  await assert.rejects(fetchPage(month,null),{code:'setup'});
  assert.equal(req,null);
});
test('403 and integrity 503 are distinct errors, with no local fallback or writes',async()=>{
  const root={_proxyCfg:()=>({url:'https://proxy.thelab.solutions',key:'test'}),
    fetch:async()=>new Response(null,{status:403})};
  const f=_test.realFetch(root);
  await assert.rejects(f(month,null),{code:'denied'});
  root.fetch=async()=>Response.json({error:'Marketing audit integrity check failed'},{status:503});
  await assert.rejects(f(month,null),{code:'integrity'});
  root.fetch=async()=>Response.json({error:'Shared spending temporarily unavailable'},{status:503});
  await assert.rejects(f(month,null),{code:'setup'});
});
test('existing Reportes module loads new history adapter with build version and original editor remains intact',()=>{
  const op=fs.readFileSync(path.join(__dirname,'../js/operativo-secciones.js'),'utf8');
  const history=fs.readFileSync(path.join(__dirname,'../js/reportes-marketing-history.js'),'utf8');
  assert.match(op,/js\/reportes-marketing-history\.js/);
  assert.match(op,/currentScript\?\.src/);
  assert.match(history,/cacCanalCard/);
  assert.match(history,/next_before_revision/);
  assert.match(history,/reportesSpendHistoryPanel/);
  assert.match(history,/role==='finance'\|\|role==='admin'/);
  assert.doesNotMatch(history,/method:'PUT'|method:'POST'|localStorage\.setItem/);
});
