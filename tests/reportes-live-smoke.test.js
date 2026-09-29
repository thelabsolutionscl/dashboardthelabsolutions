#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const script=pathToFileURL(path.join(__dirname,'../scripts/reportes-live-smoke.mjs'));
const sha='a'.repeat(40);
const page='<html><div id="crmAcquisitionAuditCard">Contradicciones</div>'+
  '<input id="nl-primer-contacto"><script>register(\'sw.js?v=aaaaaaaa\')</script></html>';
const json=(body,status=200)=>Response.json(body,{status});
function server({html=page,health={ok:true,proxy:'thelab-proxy',marketing_spend_guard:true},
  pageStatus=200,proxyStatus=200,dnsFail=[]}={}){
  const requests=[];
  return {
    requests,
    resolve:async h=>{if(dnsFail.includes(h)){const e=Error('DNS');e.code='ENOTFOUND';throw e;}return {address:'127.0.0.1'};},
    fetcher:async(u,o)=>{
      requests.push({u,o});
      if(u.startsWith('https://dashboard.thelab.solutions/'))return new Response(html,{status:pageStatus});
      if(u==='https://proxy.thelab.solutions/health')return json(health,proxyStatus);
      throw Error('unexpected network destination');
    }
  };
}
test('live smoke requires exact deployed revision, markers, DNS, and marketing guard',async()=>{
  const {checkReportesLive}=await import(script.href);
  const s=server(),r=await checkReportesLive({expectedSha:sha,...s});
  assert.equal(r.ready,true);assert.equal(r.failed.length,0);
  assert.equal(r.passed.length,6);
  assert.ok(s.requests.every(x=>x.o.method==='GET'));
  assert.ok(s.requests.every(x=>!x.o.body&&!x.o.headers?.['X-App-Key']));
  assert.ok(s.requests.some(x=>x.u.includes('tls_smoke=aaaaaaaa')));
});
test('stale Pages HTML and incorrect Pages revision cannot pass',async()=>{
  const {checkReportesLive}=await import(script.href);
  for(const html of ['legacy page',page.replace('aaaaaaaa','bbbbbbbb')]){
    const r=await checkReportesLive({expectedSha:sha,...server({html})});
    assert.equal(r.ready,false);
    assert.ok(r.failed.some(x=>x.includes('HTML')));
  }
});
test('unresolvable production domains report individual failures and never trigger HTTP',async()=>{
  const {checkReportesLive}=await import(script.href);
  const s=server({dnsFail:['dashboard.thelab.solutions','proxy.thelab.solutions']});
  const r=await checkReportesLive({expectedSha:sha,...s});
  assert.equal(r.ready,false);assert.equal(r.failed.length,2);
  assert.equal(s.requests.length,0);
});
test('unavailable marketing Durable Object cannot certify production',async()=>{
  const {checkReportesLive}=await import(script.href);
  const r=await checkReportesLive({expectedSha:sha,
    ...server({health:{ok:true,proxy:'thelab-proxy',marketing_spend_guard:false}})});
  assert.equal(r.ready,false);
  assert.ok(r.failed.some(x=>x.includes('Durable Object')));
});
test('protected edge requires human verification rather than a fake pass',async()=>{
  const {checkReportesLive}=await import(script.href);
  const r=await checkReportesLive({expectedSha:sha,...server({pageStatus:302,proxyStatus:403})});
  assert.equal(r.ready,false);assert.equal(r.manual.length,2);
  assert.equal(r.failed.length,0);
});
test('invalid SHA is rejected before DNS or any requests',async()=>{
  const {checkReportesLive}=await import(script.href);
  const s=server(),r=await checkReportesLive({expectedSha:'invalid',...s});
  assert.equal(r.ready,false);
  assert.equal(r.failed.length,1);assert.equal(s.requests.length,0);
});
test('network probes never write or send credentials',async()=>{
  const {checkReportesLive}=await import(script.href);
  const s=server();
  await checkReportesLive({expectedSha:sha,...s});
  assert.ok(s.requests.every(q=>q.o.method==='GET'&&q.o.redirect==='manual'));
  assert.ok(s.requests.every(q=>!q.o.credentials&&!q.o.body));
});
