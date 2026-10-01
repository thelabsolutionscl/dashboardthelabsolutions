// Read-only smoke checks for Cloudflare Access rollout.
// Never emits a DTE, uploads a CAF, changes a record, or prints a credential.
const BROWSER_ORIGIN='https://dashboard.thelab.solutions';
const APPROVED_PROXIES=new Set([
  'https://proxy.thelab.solutions',
  'https://airtable-proxy.wast3dspa.workers.dev',
]);
export async function checkAccessReadiness(config,fetcher=fetch){
  const passed=[],errors=[],manual=[];
  const fail=x=>errors.push(x),ok=x=>passed.push(x);
  const url=String(config.proxyUrl||'').replace(/\/+$/,'');
  let base;
  try{
    const parsed=new URL(url);
    if(!APPROVED_PROXIES.has(parsed.origin)||parsed.pathname!=='/'||
       parsed.search||parsed.hash||parsed.username||parsed.password)
      throw new Error('Unapproved proxy address');
    base=parsed.origin;
  }catch(_){
    fail('PROXY_URL must point to the approved HTTPS proxy hostname');
    return {passed,errors,manual,ready:false};
  }
  // Reportes needs a same-site proxy for real browser Access sessions.
  if(config.stage==='reportes'&&base!=='https://proxy.thelab.solutions'){
    fail('Reportes Access requires the same-site proxy.thelab.solutions hostname');
    return {passed,errors,manual,ready:false};
  }
  if(!config.proxyKey){
    fail('PROXY_KEY missing from workflow secrets');
    return {passed,errors,manual,ready:false};
  }
  const call=async(path,options={})=>fetcher(base+path,{
    redirect:'manual',signal:AbortSignal.timeout(12000),...options
  });
  const simpleHeaders={Origin:BROWSER_ORIGIN,'X-App-Key':config.proxyKey};
  try{
    const r=await call('/access/me',{method:'OPTIONS',headers:{
      Origin:BROWSER_ORIGIN,'Access-Control-Request-Method':'GET',
      'Access-Control-Request-Headers':'x-app-key,content-type'
    }});
    const allowed=String(r.headers.get('Access-Control-Allow-Headers')||'').toLowerCase();
    const methods=String(r.headers.get('Access-Control-Allow-Methods')||'').toUpperCase();
    if(![200,204].includes(r.status)||
       r.headers.get('Access-Control-Allow-Origin')!==BROWSER_ORIGIN||
       r.headers.get('Access-Control-Allow-Credentials')!=='true'||
       !allowed.includes('x-app-key')||!allowed.includes('content-type')||
       !methods.includes('GET')){
      fail('CORS preflight does not permit authenticated dashboard requests');
    }else ok('Dashboard CORS preflight passed');
  }catch(_){fail('CORS preflight unavailable');}
  try{
    const r=await call('/access/me',{headers:simpleHeaders});
    if(r.status===401)ok('Proxy rejects sessions without a valid Access JWT');
    else if([302,303,307,308,403].includes(r.status))
      manual.push('Access edge blocked the unauthenticated request; verify JWT enforcement at Worker origin');
    else fail('Proxy did not deny unauthenticated /access/me');
  }catch(_){fail('Cannot probe unauthenticated Access session');}

  if(config.stage==='reportes'){
    // Validate the ACTUAL published bundle, not just the merge/deploy log.
    // An Access login page or stale Pages cache must not count as Reportes.
    try{
      const r=await fetcher(BROWSER_ORIGIN+'/',{method:'GET',redirect:'manual',
        signal:AbortSignal.timeout(12000),headers:{'Cache-Control':'no-cache'}});
      const html=r.status===200?await r.text():'';
      const markers=['id="crmAcquisitionAuditCard"','Contradicciones','id="nl-primer-contacto"'];
      if(r.status!==200||!markers.every(marker=>html.includes(marker)))
        fail('Published dashboard is unavailable or does not contain the latest Reportes/CRM corrections');
      else ok('Published Pages bundle contains Reportes contradiction filter and explicit first-contact form');
    }catch(_){fail('Published dashboard cannot be checked from the workflow runner');}
    // These checks are strictly read-only. A public shared APP_KEY must not
    // grant financial read access, and we never PUT a test spending amount.
    const month=new Date().toISOString().slice(0,7);
    const paths=['/marketing/spend?month='+month,'/marketing/spend/history?month='+month];
    try{
      const r=await call(paths[0],{method:'OPTIONS',headers:{
        Origin:BROWSER_ORIGIN,'Access-Control-Request-Method':'PUT',
        'Access-Control-Request-Headers':'x-app-key,content-type'
      }});
      const allowed=String(r.headers.get('Access-Control-Allow-Headers')||'').toLowerCase();
      const methods=String(r.headers.get('Access-Control-Allow-Methods')||'').toUpperCase();
      if(![200,204].includes(r.status)||
         r.headers.get('Access-Control-Allow-Origin')!==BROWSER_ORIGIN||
         r.headers.get('Access-Control-Allow-Credentials')!=='true'||
         !allowed.includes('x-app-key')||!allowed.includes('content-type')||
         !methods.includes('PUT')){
        fail('Marketing spend CORS preflight failed for authenticated browser updates');
      }else ok('Marketing spend CORS preflight passed');
    }catch(_){fail('Marketing spend CORS preflight unavailable');}
    // An unrelated website must NEVER receive a credentialed CORS grant.
    // Testing OPTIONS performs no financial mutation.
    try{
      const outsider='https://untrusted.example';
      const r=await call(paths[0],{method:'OPTIONS',headers:{
        Origin:outsider,'Access-Control-Request-Method':'PUT',
        'Access-Control-Request-Headers':'x-app-key,content-type'
      }});
      const allowed=r.headers.get('Access-Control-Allow-Origin');
      if(![204,403].includes(r.status)||['*','null',outsider].includes(allowed))
        fail('Untrusted origin was allowed or hostile-origin CORS could not be verified');
      else ok('Marketing spend does not grant credentialed CORS to an untrusted origin');
    }catch(_){fail('Cannot verify marketing spend hostile-origin CORS');}
    for(const path of paths){
      try{
        const r=await call(path,{method:'GET',headers:simpleHeaders});
        if(r.status===401)ok('Unsigned marketing request denied: '+path.split('?')[0]);
        else if([302,303,307,308,403].includes(r.status))
          manual.push('Edge blocked unsigned marketing request; verify Worker-origin enforcement: '+path.split('?')[0]);
        else fail('Unsigned marketing request was not denied: '+path.split('?')[0]);
      }catch(_){fail('Cannot probe unsigned marketing request: '+path.split('?')[0]);}
    }
    manual.push('In two independent browsers, verify finance/admin see the same month and revision, while viewer/operator receive 403; no test spending is written.');
    return {passed,errors,manual,ready:errors.length===0&&manual.length===1};
  }
  try{
    const r=await call('/sii/folio/33',{headers:simpleHeaders});
    if(r.status===401)ok('Fiscal data denied without a verified human session');
    else if([302,303,307,308,403].includes(r.status))
      manual.push('Access edge blocked fiscal probe; verify finance RBAC at Worker origin');
    else fail('Fiscal status is not denied before SII backend access');
  }catch(_){fail('Cannot probe fiscal access guard');}
  const hasId=!!config.serviceClientId,hasSecret=!!config.serviceClientSecret;
  if(hasId!==hasSecret)fail('Both machine service credentials are required together');
  else if(!hasId)fail('Add temporary PREFLIGHT_CF_CLIENT_ID and PREFLIGHT_CF_CLIENT_SECRET for signed machine checks');
  else {
    try{
      // Invalid JSON deliberately stops BEFORE model selection, budget reserve
      // and external AI requests. HTTP 400 proves both Access edge and origin
      // accepted the service identity; no usage is incurred.
      const r=await call('/service/lead/anthropic/v1/messages',{
        method:'POST',
        headers:{'Content-Type':'application/json',
          'CF-Access-Client-Id':config.serviceClientId,
          'CF-Access-Client-Secret':config.serviceClientSecret},
        body:'invalid-json-sentinel'
      });
      const body=r.status===400?await r.json().catch(()=>({})):{};
      if(r.status===400&&body.error==='Invalid Anthropic JSON body')
        ok('Signed lead service reached model-free validation');
      else fail('Signed machine service could not reach the restricted proxy route');
    }catch(_){fail('Signed lead service probe failed');}
  }
  if(config.stage==='post'){
    if(config.siiAccessMode!=='true')fail('SII_ACCESS_MODE must be true after cutover');
    if(!config.siiWorkerKey||config.siiWorkerKey.length<16)
      fail('Original SII key required to verify the post-cutover public HTML');
    else {
      try{
        const r=await fetcher(BROWSER_ORIGIN+'/',{
          method:'GET',redirect:'manual',signal:AbortSignal.timeout(12000)
        });
        const html=r.ok?await r.text():'';
        if(!r.ok)fail('Published dashboard unavailable for exposure check');
        else if(html.includes(config.siiWorkerKey)||html.includes('%%SII_WORKER_KEY%%'))
          fail('Published dashboard still contains the SII credential or placeholder');
        else ok('Published dashboard HTML contains no matching SII worker key');
      }catch(_){fail('Cannot inspect published dashboard for SII key exposure');}
    }
  }
  manual.push('Verify logged-in finance/admin and denied viewer sessions in a real browser');
  return {passed,errors,manual,ready:errors.length===0&&manual.length===1};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  const result=await checkAccessReadiness({
    proxyUrl:process.env.PROXY_URL,proxyKey:process.env.PROXY_KEY,
    serviceClientId:process.env.PREFLIGHT_CF_CLIENT_ID,
    serviceClientSecret:process.env.PREFLIGHT_CF_CLIENT_SECRET,
    stage:process.env.STAGE||'before',
    siiAccessMode:process.env.SII_ACCESS_MODE,
    siiWorkerKey:process.env.SII_WORKER_KEY
  });
  for(const item of result.passed)console.log('PASS: '+item);
  for(const item of result.manual)console.log('MANUAL: '+item);
  for(const item of result.errors)console.error('FAIL: '+item);
  if(process.env.GITHUB_STEP_SUMMARY){
    const {appendFileSync}=await import('node:fs');
    const label=result.errors.length?'FAILED':result.manual.length>1?'INCONCLUSIVE':'AUTOMATED PASS';
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '### Access readiness — '+label+' (manual human-role checks still required)\n\n'+
      [...result.passed.map(x=>'- PASS: '+x),...result.manual.map(x=>'- MANUAL: '+x),
        ...result.errors.map(x=>'- FAIL: '+x)].join('\n')+'\n');
  }
  // Edge redirects/403 are *not* proof that the Worker itself rejects a
  // copied APP_KEY; do not mark Reportes green until the origin is verifiable.
  if(result.errors.length||(process.env.STAGE==='reportes'&&result.manual.length>1))process.exitCode=1;
  else console.log('Automated checks completed; real user-session tests remain mandatory.');
}
