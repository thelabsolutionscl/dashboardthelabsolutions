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
      Origin:BROWSER_ORIGIN,'Access-Control-Request-Method':'POST',
      'Access-Control-Request-Headers':'x-app-key,content-type'
    }});
    const allowed=String(r.headers.get('Access-Control-Allow-Headers')||'').toLowerCase();
    const methods=String(r.headers.get('Access-Control-Allow-Methods')||'').toUpperCase();
    if(![200,204].includes(r.status)||
       r.headers.get('Access-Control-Allow-Origin')!==BROWSER_ORIGIN||
       r.headers.get('Access-Control-Allow-Credentials')!=='true'||
       !allowed.includes('x-app-key')||!allowed.includes('content-type')||
       !methods.includes('POST')){
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
  if(result.errors.length)process.exitCode=1;
  else console.log('Automated checks completed; real user-session tests remain mandatory.');
}
