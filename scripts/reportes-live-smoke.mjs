// Independent public production smoke: no X-App-Key, Access JWT, writes, or model calls.
// Runs only AFTER a completed Pages deployment, never as proof of human RBAC.
import {lookup} from 'node:dns/promises';
import {appendFileSync} from 'node:fs';
const DASHBOARD='https://dashboard.thelab.solutions/';
const PROXY='https://proxy.thelab.solutions/health';
const MARKERS=['id="crmAcquisitionAuditCard"','Contradicciones','id="nl-primer-contacto"'];
export async function checkReportesLive({expectedSha,fetcher=fetch,resolve=lookup}={}){
  const passed=[],failed=[],manual=[];
  if(!/^[0-9a-f]{40}$/.test(String(expectedSha||''))){
    failed.push('Expected GitHub deployment SHA must contain 40 hexadecimal characters');
    return {passed,failed,manual,ready:false};
  }
  const version=expectedSha.slice(0,8);
  const lookupDomain=async(host)=>{
    try{await resolve(host);passed.push('DNS resolves: '+host);return true;}
    catch(e){failed.push('DNS cannot resolve '+host+' ('+String(e?.code||'lookup_failed').slice(0,30)+')');return false;}
  };
  if(await lookupDomain('dashboard.thelab.solutions')){
    try{
      // Query changes only cache key; there are no credentials in the URL.
      const r=await fetcher(DASHBOARD+'?tls_smoke='+version,{
        method:'GET',redirect:'manual',signal:AbortSignal.timeout(12000),
        headers:{'Cache-Control':'no-cache'}
      });
      if([301,302,303,307,308,401,403].includes(r.status)){
        manual.push('Dashboard requires edge authentication; public Pages bundle must be checked in an authorized browser');
      }else if(r.status!==200){
        failed.push('Dashboard HTTP status is '+r.status+' instead of 200');
      }else{
        const html=await r.text();
        if(!MARKERS.every(m=>html.includes(m)))failed.push('Published HTML lacks expected CRM and Reportes markers');
        else passed.push('Published HTML contains Reportes and new-client corrections');
        if(!html.includes('sw.js?v='+version))failed.push('Published HTML build version does not match deployed GitHub commit '+version);
        else passed.push('Published HTML version matches deployed commit '+version);
      }
    }catch(e){failed.push('Dashboard HTTP probe failed ('+String(e?.cause?.code||e?.code||'network_error').slice(0,30)+')');}
  }
  if(await lookupDomain('proxy.thelab.solutions')){
    try{
      const r=await fetcher(PROXY,{method:'GET',redirect:'manual',
        signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});
      if([301,302,303,307,308,401,403].includes(r.status)){
        manual.push('Proxy /health is protected by Access edge; confirm Worker health with authorized diagnostics');
      }else if(r.status!==200){
        failed.push('Proxy /health HTTP status is '+r.status);
      }else{
        const data=await r.json();
        if(data?.ok!==true||data.proxy!=='thelab-proxy')failed.push('Proxy /health is not the expected Worker response');
        else passed.push('Live proxy health responded successfully');
        if(data?.marketing_spend_guard!==true)failed.push('Marketing spend Durable Object binding is unavailable');
        else passed.push('Live proxy reports the marketing spend guard binding');
      }
    }catch(e){failed.push('Proxy /health probe failed ('+String(e?.cause?.code||e?.code||'network_error').slice(0,30)+')');}
  }
  return {passed,failed,manual,ready:failed.length===0&&manual.length===0&&passed.length===6};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  const result=await checkReportesLive({expectedSha:process.env.EXPECTED_SHA});
  for(const line of result.passed)console.log('PASS: '+line);
  for(const line of result.manual)console.log('MANUAL: '+line);
  for(const line of result.failed)console.error('FAIL: '+line);
  const status=result.failed.length?'FAIL':result.manual.length?'INCONCLUSIVE':'PASS';
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '### Reportes public production smoke — '+status+'\n\n'+
    [...result.passed.map(x=>'- PASS: '+x),...result.manual.map(x=>'- MANUAL: '+x),
      ...result.failed.map(x=>'- FAIL: '+x)].join('\n')+
    '\n\nCloudflare Access RBAC still requires real authenticated browsers.\n');
  if(!result.ready)process.exitCode=1;
}
