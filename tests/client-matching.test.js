const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = require('node:path').join(__dirname, '..');
function load(file, names, extra = {}) {
  const source = fs.readFileSync(root + '/' + file, 'utf8')
    .replace(/^import .*;\s*$/gm, '').replace(/export default \{/, 'const worker = {').replace(/export (async )?(class|function) /g, '$1$2 ');
  const context = vm.createContext({ console: {error() {}}, URL, Request, Response, Headers, TextEncoder, TextDecoder,
    crypto: webcrypto, btoa, atob, setTimeout, clearTimeout, ...extra });
  vm.runInContext(source + '\n;globalThis.api = {' + names.join(',') + '};', context);
  return context.api;
}
const matcher = load('lead-worker/src/client-match.js', ['resolveClientMatch', 'clientIdentity']);
const row = (id, fields) => ({id, fields});
const A = 'recAAAAAAAAAAAAAA', B = 'recBBBBBBBBBBBBBB', Q = 'recQQQQQQQQQQQQQQ', P = 'recPPPPPPPPPPPPPP';
const norm = {submissionId:'11111111-1111-4111-8111-111111111111',name:'Synthetic Contact',company:'Example Alpha',email:'alpha@example.invalid',phone:'+56 9 0000 0011',service:'Prototype'};
const alpha = row(A, {Empresa:norm.company,Email:norm.email,'Teléfono':norm.phone});
const beta = row(B, {Empresa:'Example Beta',Email:'beta@example.invalid','Teléfono':norm.phone});
const identity = fields => matcher.resolveClientMatch(fields, [alpha,beta]);
function memory() {
  const map = new Map();
  return {map, async get(k) { return map.get(k); }, async put(k,v) { map.set(k,structuredClone(v)); },
    async delete(k) { map.delete(k); }, async list({prefix}) { return {keys:[...map.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name}))}; }};
}
function harness(options = {}) {
  const kv = memory(), states = new Map(), writes = [], reads = [];
  let candidates = options.candidates || [beta,alpha], failLookup = !!options.failLookup;
  const recordsById=new Map((options.records||[]).map(r=>[r.id,r]));
  const fetchMock = async (url, init = {}) => {
    const u = new URL(url); const method = init.method || 'GET';
    if (u.hostname === 'api.linkedin.com' && options.officialLead) return Response.json(options.officialLead);
    if (method === 'GET') {
      reads.push(u);
      if (failLookup) return Response.json({}, {status:503});
      if (options.badLookup) return Response.json({unexpected:true});
      const recordId=u.pathname.split('/').pop();
      if(recordId.startsWith('rec')){const record=recordsById.get(recordId)||candidates.find(r=>r.id===recordId);return Response.json(record||{}, {status:record?200:404});}
      if (options.pages && !u.searchParams.has('offset')) return Response.json({records:[beta],offset:'next'});
      return Response.json({records:options.pages ? [alpha] : candidates});
    }
    const body = JSON.parse(init.body); writes.push({url:String(url),method,body});
    if (options.failPost && method === 'POST') return Response.json({}, {status:503});
    if (options.failQueue && u.pathname.endsWith('/Agent_Queue')) return Response.json({}, {status:503});
    const id = u.pathname.endsWith('/Clientes') ? A : u.pathname.endsWith('/Agent_Queue') ? Q : A;
    if(method==='POST')recordsById.set(id,{id,fields:body.fields});
    return Response.json({id,fields:body.fields});
  };
  const api = load('lead-worker/src/index.js', ['worker','handleLeadReview','createLeadAndQueue','retryDeadLetters','SocialEventGuard','airtableFindCliente','handleNewsletterUnsubscribe','nlSign'], {
    ...matcher, accessAuthorize:options.accessAuthorize|| (async(_request,env)=>env.testAuth||{legacy:true}), fetch:fetchMock, waNotify:async()=>[], mensajeLead:()=>'', deliverFundAlerts:async()=>{},
  });
  const env = {AIRTABLE_TOKEN:'synthetic',AIRTABLE_BASE_ID:'test',RL:kv, SOCIAL_EVENT_GUARD:{
    idFromName:k=>k, get(k) { if(!states.has(k)) states.set(k,new api.SocialEventGuard({storage:memory()},env));
      return {fetch:(url,init)=>states.get(k).fetch(new Request(url,init))}; }
  }};
  const pending = [], ctx={waitUntil:p=>pending.push(p)};
  const item = {norm:{...norm},agente:'LEAD_AGENT',evento:'lead.received',source:'web',attachment:{name:'synthetic.txt',type:'text/plain',data:'dGVzdA=='}};
  return {api,env,kv,writes,reads,states,item,ctx,pending,recordsById,
    async submit() { const r=await api.createLeadAndQueue(env,ctx,{},item); await Promise.all(pending); return {status:r.status,body:await r.json()}; },
    setCandidates(v){candidates=v;}, recover(){failLookup=false;}};
}

test('exact email wins over shared phone regardless of record order',()=>{
  for (const records of [[alpha,beta],[beta,alpha]]) assert.equal(matcher.resolveClientMatch(norm,records).record.id,A);
});
test('conflicting company/email, duplicate exact email, phone-only and RUT conflict are ambiguous',()=>{
  for(const p of [{...norm,company:'Example Other'}, {phone:norm.phone}, {...norm,email:'other@example.invalid'}])
    assert.equal(identity(p).status,'ambiguous');
  assert.equal(matcher.resolveClientMatch(norm,[alpha,row(B,alpha.fields)]).status,'ambiguous');
  assert.equal(matcher.resolveClientMatch({...norm,rut:'11.111.111-1'},[row(A,{...alpha.fields,RUT:'22.222.222-2'})]).status,'ambiguous');
  assert.equal(matcher.resolveClientMatch(norm,[]).status,'not_found');
  assert.equal(matcher.resolveClientMatch({},[]).status,'ambiguous');
});
test('platform identities are exact and scoped; conflicting email still blocks',()=>{
  assert.equal(matcher.resolveClientMatch({socialIdentity:'instagram:123'},[row(A,{'Social identity key':'facebook:123'})]).status,'not_found');
  assert.equal(matcher.resolveClientMatch({linkedinUrl:'https://www.linkedin.com/in/example/?x=1'},[row(A,{'LinkedIn URL':'https://linkedin.com/in/example'})]).record.id,A);
  assert.equal(matcher.resolveClientMatch({email:'other@example.invalid',linkedinUrl:'https://linkedin.com/in/example'},[row(A,{Email:norm.email,'LinkedIn URL':'https://linkedin.com/in/example'})]).status,'ambiguous');
});
test('intake updates and attaches only to exact-email client, paginates all candidates',async()=>{
  const h=harness({pages:true}); const result=await h.submit();
  assert.equal(result.body.clienteId,A); assert.equal(result.body.queueId,Q);
  assert.ok(h.reads.some(u=>u.searchParams.get('offset')==='next'));
  assert.ok(h.reads.every(u=>!u.searchParams.has('maxRecords')));
  assert.ok(h.writes.every(w=>!w.url.includes(B)));
  assert.equal(h.writes.find(w=>w.url.endsWith('/Agent_Queue')).body.fields['ID entidad'],A);
  assert.ok(h.writes.some(w=>w.url.includes(A) && w.url.includes('uploadAttachment')));
});
test('ambiguous intake retains full lead and attachment, creates no workflow and cron cannot release it',async()=>{
  const h=harness(); h.item.norm.company='Example Other';
  const result=await h.submit(); assert.equal(result.body.reviewRequired,true); assert.equal(result.body.clienteId,null);
  assert.equal(h.writes.length,0); const held=JSON.parse([...h.kv.map.values()][0]); assert.deepEqual(held.attachment,h.item.attachment);
  h.setCandidates([]); await h.api.retryDeadLetters(h.env); assert.equal(h.writes.length,0); assert.equal(h.kv.map.size,1);
});
test('failed lookup never creates, successful recovery retries safely and only once',async()=>{
  const h=harness({failLookup:true}); assert.equal((await h.submit()).body.buffered,true); assert.equal(h.writes.length,0);
  h.recover(); await h.api.retryDeadLetters(h.env); await h.api.retryDeadLetters(h.env);
  assert.equal(h.writes.filter(w=>w.url.endsWith('/Agent_Queue')).length,1);
  assert.equal(h.writes.filter(w=>w.url.endsWith('/Clientes')&&w.method==='POST').length,0);
});
test('malformed lookup is a failure, never absence',async()=>{
  const h=harness({badLookup:true}); assert.equal((await h.submit()).body.buffered,true); assert.equal(h.writes.length,0);
});
test('uncertain client POST is never retried, including replay and overlapping cron',async()=>{
  const h=harness({candidates:[],failPost:true}); assert.equal((await h.submit()).body.reviewRequired,true);
  await Promise.all([h.api.retryDeadLetters(h.env),h.api.retryDeadLetters(h.env),h.submit()]);
  assert.equal(h.writes.length,1); assert.equal(h.kv.map.size,1);
});
test('uncertain queue POST retains known client and never repeats a POST',async()=>{
  const h=harness({candidates:[],failQueue:true}); await h.submit(); await h.api.retryDeadLetters(h.env); await h.submit();
  assert.equal(h.writes.filter(w=>w.url.endsWith('/Clientes')).length,1);
  assert.equal(h.writes.filter(w=>w.url.endsWith('/Agent_Queue')).length,1);
});
test('completed intake replays without updates, new queue or duplicate attachments',async()=>{
  const h=harness(); await h.submit(); const count=h.writes.length;
  const r=await h.submit(); assert.equal(r.body.replayed,true); assert.equal(h.writes.length,count);
});
test('missing persistence fails closed and legacy buffer is retained without writes',async()=>{
  const h=harness(); await h.kv.put('dl:legacy',JSON.stringify({norm})); await h.api.retryDeadLetters(h.env); assert.equal(h.writes.length,0);
  delete h.env.SOCIAL_EVENT_GUARD; assert.equal((await h.submit()).status,503); assert.equal(h.writes.length,0);
});
test('newsletter/social compatibility returns IDs only for unique identity and throws on ambiguity or failure',async()=>{
  const h=harness({candidates:[alpha]}); assert.equal(await h.api.airtableFindCliente(h.env,{email:norm.email}),A);
  h.setCandidates([alpha,row(B,alpha.fields)]); await assert.rejects(h.api.airtableFindCliente(h.env,{email:norm.email}));
  h.setCandidates([row(A,{'Social identity key':'instagram:123'})]); assert.equal(await h.api.airtableFindCliente(h.env,{socialIdentity:'instagram:123'}),A);
  const failed=harness({failLookup:true}); await assert.rejects(failed.api.airtableFindCliente(failed.env,{email:norm.email}));
});
function proxyHarness(candidates, fail=false) {
  const writes=[], store=memory();
  const prospect=row(P,{Prospecto:'Synthetic Contact',Empresa:norm.company,Email:norm.email,'Teléfono':norm.phone,Estado:'Calificado'});
  const api=load('airtable-proxy/src/worker.js',['CrmMutationGuard'],{...matcher,fetch:async(url,init={})=>{
    if((init.method||'GET')==='GET') {
      if(String(url).includes('LinkedIn_Prospects/')) return Response.json(prospect);
      if(fail) return Response.json({}, {status:503});
      return Response.json({records:candidates});
    }
    writes.push({url:String(url),...init}); return Response.json({id:String(url).includes('LinkedIn_Prospects')?P:A,fields:JSON.parse(init.body).fields});
  }});
  const guard=new api.CrmMutationGuard({storage:store},{AIRTABLE_TOKEN:'synthetic'});
  return {writes,store,async convert(){const r=await guard._handleLinkedinCommand(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({action:'convert',id:P,actor:{role:'admin',email:'admin@example.invalid'}})}));return {status:r.status,body:await r.json()};}};
}
test('LinkedIn conversion chooses exact email independent of order and does not write wrong client',async()=>{
  for(const rows of [[alpha,beta],[beta,alpha]]){
    const h=proxyHarness(rows); const r=await h.convert(); assert.equal(r.status,200);assert.equal(r.body.client.id,A);
    assert.ok(h.writes.every(w=>!w.url.includes(B)));
  }
});
test('LinkedIn ambiguity and lookup failure keep prospect unconverted and write nothing',async()=>{
  for(const [rows,fail,status] of [[[beta],false,409],[[alpha,row(B,alpha.fields)],false,409],[[],true,503]]){
    const h=proxyHarness(rows,fail); assert.equal((await h.convert()).status,status);assert.equal(h.writes.length,0);
  }
});
test('LinkedIn uncertain previous create cannot create another client',async()=>{
  const h=proxyHarness([]); await h.store.put('linkedin:convert:'+P,{pending:true});
  assert.equal((await h.convert()).status,503);assert.equal(h.writes.length,0);
});
test('web, Ads and LinkedIn HTTP routes hold identity conflicts without CRM writes',async()=>{
  for(const [path,key,header] of [['/lead','PUBLIC_LEAD_KEY','X-Public-Lead-Key'],['/webhooks/google-ads','GOOGLE_ADS_WEBHOOK_KEY','X-Google-Ads-Webhook-Key'],['/webhooks/linkedin','LINKEDIN_WEBHOOK_KEY','X-Linkedin-Webhook-Key']]) {
    const h=harness(); h.env[key]='synthetic-key';
    const body={...norm,company:'Example Other',leadId:'synthetic-event',lead_id:'synthetic-event'};
    const request=()=>new Request('https://test.invalid'+path,{method:'POST',headers:{[header]:'synthetic-key','Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await h.api.worker.fetch(request(),h.env,h.ctx);assert.equal(result.status,200);
    assert.equal((await result.json()).reviewRequired,true);await Promise.all(h.pending);assert.equal(h.writes.filter(w=>/Clientes|Agent_Queue|uploadAttachment/.test(w.url)).length,0);
    const replay=await h.api.worker.fetch(request(),h.env,h.ctx);assert.equal((await replay.json()).buffered,true);assert.equal(h.writes.filter(w=>/Clientes|Agent_Queue|uploadAttachment/.test(w.url)).length,0);
    const denied=await h.api.worker.fetch(new Request('https://test.invalid'+path,{method:'POST',body:JSON.stringify(body)}),h.env,h.ctx);
    assert.equal(denied.status,401);
  }
});
test('newsletter opt-out applies only to all exact-email rows even with different companies',async()=>{
  const h=harness({candidates:[alpha,row(B,{...beta.fields,Email:norm.email})]});h.env.NEWSLETTER_SECRET='synthetic-secret';
  const token=await h.api.nlSign(h.env,'unsubscribe',norm.email);
  const r=await h.api.handleNewsletterUnsubscribe(new Request('https://test.invalid/newsletter/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:norm.email,token,t:token})}),h.env);
  assert.equal(r.status,200);assert.equal(h.writes.length,2);
  assert.ok(h.writes.every(w=>w.body.fields['Baja newsletter']===true));
});
test('supplied business identity cannot be ignored on an incomplete contact',()=>{
  assert.equal(matcher.resolveClientMatch(norm,[row(A,{Email:norm.email})]).status,'ambiguous');
  assert.equal(matcher.resolveClientMatch({email:norm.email},[alpha]).status,'match');
  assert.equal(matcher.resolveClientMatch({phone:'0011'},[alpha]).status,'ambiguous');
});
test('official LinkedIn signed webhook preserves ambiguous form data and blocks client/workflow writes',async()=>{
  const values={FIRST_NAME:'Synthetic',COMPANY_NAME:'Example Other',WORK_EMAIL:norm.email,PHONE_NUMBER:norm.phone};
  const officialLead={id:'synthetic-response',form:{content:{questions:Object.keys(values).map(k=>({questionId:k,predefinedField:k}))}},
    formResponse:{answers:Object.entries(values).map(([k,v])=>({questionId:k,answerDetails:{textQuestionAnswer:{answer:v}}}))}};
  const h=harness({officialLead});h.env.LINKEDIN_CLIENT_SECRET='synthetic-secret';h.env.LINKEDIN_ACCESS_TOKEN='synthetic-access';
  const raw=JSON.stringify({type:'LEAD_ACTION',leadAction:'CREATED',leadGenFormResponse:'urn:li:leadGenFormResponse:synthetic-response',occurredAt:'1'});
  const signature=require('node:crypto').createHmac('sha256','synthetic-secret').update('hmacsha256='+raw).digest('hex');
  const r=await h.api.worker.fetch(new Request('https://test.invalid/webhooks/linkedin/official',{method:'POST',headers:{'X-LI-Signature':signature},body:raw}),h.env,h.ctx);
  assert.equal(r.status,200);assert.equal((await r.json()).reviewRequired,true);await Promise.all(h.pending);
  assert.equal(h.writes.filter(w=>/Clientes|Agent_Queue|uploadAttachment/.test(w.url)).length,0);
  assert.ok([...h.kv.map.keys()].some(k=>k.startsWith('dl:')));
});
test('changed replay preserves canonical payload and attachment in every held phase',async()=>{
  for (const options of [{candidates:[],failPost:true},{candidates:[],failQueue:true},{}]) {
    const h=harness(options);h.item.norm.externalLeadId='synthetic-event';
    if(!options.failPost&&!options.failQueue)h.item.norm.company='Example Other';
    await h.submit();
    const key=[...h.kv.map.keys()].find(k=>k.startsWith('dl:'));
    const original=JSON.parse(await h.kv.get(key));const count=h.writes.length;
    h.item.norm.message='changed replay';h.item.norm.email='changed@example.invalid';
    h.item.attachment={name:'replacement.pdf',type:'application/pdf',data:'cmVwbGFjZWQ='};
    await Promise.all([h.submit(),h.submit(),h.api.retryDeadLetters(h.env)]);
    const held=JSON.parse(await h.kv.get(key));
    assert.deepEqual(held.norm,original.norm);assert.deepEqual(held.attachment,original.attachment);
    assert.equal(h.writes.length,count);
  }
});
test('lookup recovery uses original identity and attachment even if replay changes payload',async()=>{
  const h=harness({failLookup:true});h.item.norm.externalLeadId='synthetic-event';
  await h.submit();h.recover();h.env.RESEND_API_KEY='synthetic';
  h.item.norm.email='changed@example.invalid';h.item.norm.company='Example Other';
  h.item.attachment={name:'replacement.pdf',type:'application/pdf',data:'cmVwbGFjZWQ='};
  const recovered=await h.submit();assert.equal(recovered.body.clienteId,A);
  const upload=h.writes.find(w=>w.url.includes('uploadAttachment'));
  assert.equal(upload.body.filename,'synthetic.txt');assert.equal(upload.body.file,'dGVzdA==');
  const reply=h.writes.find(w=>w.url==='https://api.resend.com/emails');
  assert.deepEqual(reply.body.to,[norm.email]);assert.equal(recovered.body.canonicalItem,undefined);
});
test('uncertain initial KV write cannot be replaced by a different payload',async()=>{
  const h=harness();h.item.norm.externalLeadId='synthetic-event';
  const put=h.kv.put.bind(h.kv);let fail=true;
  h.kv.put=async(k,v)=>{if(fail&&k.startsWith('dl:'))throw new Error('synthetic storage failure');return put(k,v);};
  assert.equal((await h.submit()).status,503);assert.equal(h.writes.length,0);
  fail=false;h.item.norm.message='different replay';
  assert.equal((await h.submit()).status,503);assert.equal(h.kv.map.size,0);assert.equal(h.writes.length,0);
  delete h.item.norm.message;assert.equal((await h.submit()).status,200);
});
test('completed LinkedIn transport replay cannot overwrite staging with changed contact data',async()=>{
  const h=harness();h.env.LINKEDIN_WEBHOOK_KEY='synthetic-key';
  const send=async body=>{
    const r=await h.api.worker.fetch(new Request('https://test.invalid/webhooks/linkedin',{method:'POST',
      headers:{'X-Linkedin-Webhook-Key':'synthetic-key','Content-Type':'application/json'},body:JSON.stringify(body)}),h.env,h.ctx);
    await Promise.all(h.pending);return await r.json();
  };
  const body={...norm,leadId:'synthetic-event'};await send(body);
  // Simulate a missing/expired outer transport cache; the durable guard remains.
  await h.kv.delete('linkedin:webhook:synthetic-event');const before=h.writes.length;
  const replay=await send({...body,email:'changed@example.invalid',company:'Example Other'});
  assert.equal(replay.replayed,true);assert.equal(replay.canonicalItem,undefined);assert.equal(h.writes.length,before);
});
const admin={identity:{role:'admin',email:'admin@example.invalid'}};
async function review(h, action='inspect', fields={}){
  h.env.testAuth=admin;
  const key=fields.key||[...h.kv.map.keys()].find(k=>k.startsWith('dl:'));
  const request=action==='inspect'
    ?new Request('https://test.invalid/lead/review?key='+encodeURIComponent(key))
    :new Request('https://test.invalid/lead/review',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({key,action,requestId:webcrypto.randomUUID(),reason:'Synthetic identity checked by administrator',...fields})});
  const r=await h.api.handleLeadReview(request,h.env,h.ctx,{});await Promise.all(h.pending);
  return {status:r.status,body:await r.json()};
}
test('admin review resumes a held intake against a verified customer, audits actor, and replays without extra writes',async()=>{
  const h=harness({candidates:[beta],records:[alpha]});const held=await h.submit();
  assert.equal(held.body.reviewRequired,true);assert.equal(h.writes.length,0);
  const inspected=await review(h);const requestId=webcrypto.randomUUID();
  const fields={key:held.body.intakeKey,expectedRevision:inspected.body.revision,clienteId:A,requestId,actor:{role:'admin',email:'forged@example.invalid'}};
  const resumed=await review(h,'resume',fields);assert.equal(resumed.status,200);assert.equal(resumed.body.clienteId,A);
  assert.ok(h.writes.every(w=>!w.url.includes(B)));
  assert.equal(h.writes.filter(w=>w.method==='PATCH'&&w.url.includes('Clientes')).length,0);
  const count=h.writes.length;assert.equal((await review(h,'resume',fields)).body.replayed,true);assert.equal(h.writes.length,count);
  const final=await review(h,'inspect',{key:held.body.intakeKey});
  assert.equal(final.body.state.phase,'complete');assert.equal(final.body.audit[0].actor,'admin@example.invalid');
  assert.equal(final.body.audit[0].decision,'resume');assert.ok(await h.kv.get('reviewed:'+held.body.intakeKey));
});
test('review rejects stale revisions, conflicting customer and non-admin/legacy/service identities',async()=>{
  const h=harness({candidates:[beta]});const held=await h.submit();const inspected=await review(h);
  assert.equal((await review(h,'resume',{expectedRevision:'0'.repeat(64),clienteId:A})).status,409);
  assert.equal((await review(h,'resume',{expectedRevision:inspected.body.revision,clienteId:B})).status,409);
  for(const auth of [{legacy:true},{serviceIdentity:{role:'lead-service'}},{identity:{role:'operator'}},{identity:{role:'sales'}},{identity:{role:'finance'}}]){
    h.env.testAuth=auth;
    const r=await h.api.handleLeadReview(new Request('https://test.invalid/lead/review?key='+held.body.intakeKey),h.env,h.ctx,{});
    assert.equal(r.status,403);
  }
  assert.equal(h.writes.length,0);
  const authApi=load('airtable-proxy/src/access-auth.js',['accessAllows','accessAuthorize']);
  for(const role of ['viewer','sales','operator','finance'])assert.equal(authApi.accessAllows({role},'POST','/lead/review'),false);
  assert.equal(authApi.accessAllows({role:'admin'},'POST','/lead/review'),true);
  const missing=await authApi.accessAuthorize(new Request('https://test.invalid'),{},'/lead/review');assert.equal(missing.legacy,true);
});
test('uncertain writes cannot resume; reconciliation verifies existing queue and never repeats CRM writes',async()=>{
  for(const options of [{candidates:[],failPost:true},{failQueue:true}]){
    const h=harness(options);const held=await h.submit();h.recordsById.set(A,alpha);
    const inspected=await review(h);const fields={key:held.body.intakeKey,expectedRevision:inspected.body.revision,clienteId:A};
    const before=h.writes.length;
    assert.equal((await review(h,'resume',fields)).status,409);
    const queue={id:Q,fields:{Entidad:'Cliente','ID entidad':B,Evento:h.item.evento,Agente:h.item.agente,'Input JSON':JSON.stringify(h.item.norm)}};
    h.recordsById.set(Q,queue);
    assert.equal((await review(h,'reconcile',{...fields,queueId:Q})).status,409);
    queue.fields['ID entidad']=A;h.recordsById.set(Q,queue);
    const reconciled=await review(h,'reconcile',{...fields,queueId:Q});assert.equal(reconciled.body.reconciled,true);
    await h.api.retryDeadLetters(h.env);assert.equal(h.writes.length,before);
    const final=await review(h,'inspect',{key:held.body.intakeKey});assert.equal(final.body.state.phase,'complete');
    assert.equal(final.body.audit[0].before,inspected.body.state.phase);
  }
});
test('new submission IDs allow identical legitimate requests while same ID replays exactly once',async()=>{
  const h=harness();await h.submit();await h.submit();
  assert.equal(h.writes.filter(w=>w.url.endsWith('/Agent_Queue')).length,1);
  h.item.norm.submissionId=webcrypto.randomUUID();await h.submit();
  assert.equal(h.writes.filter(w=>w.url.endsWith('/Agent_Queue')).length,2);
});
test('missing submission ID preserves each receipt for review, with no automatic CRM or notification workflow',async()=>{
  const h=harness();delete h.item.norm.submissionId;
  const one=await h.submit(),two=await h.submit();
  assert.equal(one.body.reason,'missing_submission_id');assert.equal(two.body.reviewRequired,true);
  assert.notEqual(one.body.intakeKey,two.body.intakeKey);assert.equal(h.writes.length,0);
  assert.equal([...h.kv.map.keys()].filter(k=>k.startsWith('dl:')).length,2);
  await h.api.retryDeadLetters(h.env);assert.equal(h.writes.length,0);
});
test('review uses real JWT verification: signed admin succeeds, wrong audience, expired, forged and non-admin tokens fail closed',async()=>{
  const {generateKeyPairSync,sign}=require('node:crypto');
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid:'synthetic-key',alg:'RS256',use:'sig'};
  const team='https://synthetic-review.cloudflareaccess.com',aud='synthetic-review-audience';
  const auth=load('airtable-proxy/src/access-auth.js',['accessAuthorize'],{fetch:async()=>Response.json({keys:[jwk]})});
  const h=harness({candidates:[beta],records:[alpha],accessAuthorize:auth.accessAuthorize});
  Object.assign(h.env,{ACCESS_ENFORCE:'true',ACCESS_TEAM_DOMAIN:team,ACCESS_AUD:aud,
    ACCESS_ROLE_MAP:JSON.stringify({'admin@example.invalid':'admin','viewer@example.invalid':'viewer'})});
  const held=await h.submit();const url='https://test.invalid/lead/review?key='+held.body.intakeKey;
  const token=(email='admin@example.invalid',extra={})=>{
    const now=Math.floor(Date.now()/1000),encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
    const body=encode({alg:'RS256',kid:'synthetic-key'})+'.'+encode({iss:team,aud:[aud],iat:now-2,exp:now+120,type:'app',email,...extra});
    return body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url');
  };
  for(const [jwt,status] of [['',401],['forged',401],[token('viewer@example.invalid'),403],[token(undefined,{aud:['wrong']}),401],[token(undefined,{exp:1}),401]]){
    const r=await h.api.handleLeadReview(new Request(url,{headers:{'Cf-Access-Jwt-Assertion':jwt}}),h.env,h.ctx,{});assert.equal(r.status,status);
  }
  const r=await h.api.handleLeadReview(new Request(url,{headers:{'Cf-Access-Jwt-Assertion':token()}}),h.env,h.ctx,{});
  assert.equal(r.status,200);assert.equal(h.writes.length,0);
});
