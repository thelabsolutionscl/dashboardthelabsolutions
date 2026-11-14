const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = require('node:path').join(__dirname, '..');
function load(file, names, extra = {}) {
  const source = fs.readFileSync(root + '/' + file, 'utf8')
    .replace(/^import .*;\s*$/gm, '').replace(/export default \{/, 'const worker = {').replace(/export (class|function) /g, '$1 ');
  const context = vm.createContext({ console: {error() {}}, URL, Request, Response, Headers, TextEncoder,
    crypto: webcrypto, btoa, atob, setTimeout, clearTimeout, ...extra });
  vm.runInContext(source + '\n;globalThis.api = {' + names.join(',') + '};', context);
  return context.api;
}
const matcher = load('lead-worker/src/client-match.js', ['resolveClientMatch', 'clientIdentity']);
const row = (id, fields) => ({id, fields});
const A = 'recAAAAAAAAAAAAAA', B = 'recBBBBBBBBBBBBBB', Q = 'recQQQQQQQQQQQQQQ', P = 'recPPPPPPPPPPPPPP';
const norm = {name:'Synthetic Contact',company:'Example Alpha',email:'alpha@example.invalid',phone:'+56 9 0000 0011',service:'Prototype'};
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
  const fetchMock = async (url, init = {}) => {
    const u = new URL(url); const method = init.method || 'GET';
    if (u.hostname === 'api.linkedin.com' && options.officialLead) return Response.json(options.officialLead);
    if (method === 'GET') {
      reads.push(u);
      if (failLookup) return Response.json({}, {status:503});
      if (options.badLookup) return Response.json({unexpected:true});
      if (options.pages && !u.searchParams.has('offset')) return Response.json({records:[beta],offset:'next'});
      return Response.json({records:options.pages ? [alpha] : candidates});
    }
    const body = JSON.parse(init.body); writes.push({url:String(url),method,body});
    if (options.failPost && method === 'POST') return Response.json({}, {status:503});
    if (options.failQueue && u.pathname.endsWith('/Agent_Queue')) return Response.json({}, {status:503});
    const id = u.pathname.endsWith('/Clientes') ? A : u.pathname.endsWith('/Agent_Queue') ? Q : A;
    return Response.json({id,fields:body.fields});
  };
  const api = load('lead-worker/src/index.js', ['worker','createLeadAndQueue','retryDeadLetters','SocialEventGuard','airtableFindCliente','handleNewsletterUnsubscribe','nlSign'], {
    ...matcher, fetch:fetchMock, waNotify:async()=>[], mensajeLead:()=>'', deliverFundAlerts:async()=>{},
  });
  const env = {AIRTABLE_TOKEN:'synthetic',AIRTABLE_BASE_ID:'test',RL:kv, SOCIAL_EVENT_GUARD:{
    idFromName:k=>k, get(k) { if(!states.has(k)) states.set(k,new api.SocialEventGuard({storage:memory()},env));
      return {fetch:(url,init)=>states.get(k).fetch(new Request(url,init))}; }
  }};
  const pending = [], ctx={waitUntil:p=>pending.push(p)};
  const item = {norm:{...norm},agente:'LEAD_AGENT',evento:'lead.received',source:'web',attachment:{name:'synthetic.txt',type:'text/plain',data:'dGVzdA=='}};
  return {api,env,kv,writes,reads,states,item,ctx,pending,
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
    const body={...norm,company:'Example Other',leadId:'synthetic-event'};
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
test('same external lead ID is serialized even if a replay changes the payload',async()=>{
  const h=harness({candidates:[],failPost:true});h.item.norm.externalLeadId='synthetic-event';
  await h.submit();h.item.norm.message='transport replay changed formatting';await h.submit();
  assert.equal(h.writes.length,1);
});
