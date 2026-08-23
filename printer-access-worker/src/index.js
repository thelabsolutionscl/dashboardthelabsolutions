import{parseJwt,audMatches,roleForEmail,mintSessionToken}from'./session.mjs';

let certCache={at:0,keys:[]};
const CERT_TTL=5*60*1000;

function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});}
function originHeaders(origin,allowed){if(!origin||origin!==allowed)return{};return{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Content-Type,Cf-Access-Jwt-Assertion','Access-Control-Allow-Methods':'GET,OPTIONS','Vary':'Origin'};}
function cookieValue(raw,name){for(const part of String(raw||'').split(';')){const i=part.indexOf('=');if(i<0)continue;if(part.slice(0,i).trim()===name)return decodeURIComponent(part.slice(i+1).trim());}return'';}
async function accessKeys(teamDomain,force=false){
  if(!force&&certCache.keys.length&&Date.now()-certCache.at<CERT_TTL)return certCache.keys;
  const host=String(teamDomain||'').replace(/^https?:\/\//,'').replace(/\/$/,'');if(!host)throw new Error('CLOUDFLARE_TEAM_DOMAIN ausente');
  const r=await fetch(`https://${host}/cdn-cgi/access/certs`,{headers:{Accept:'application/json'},cache:'no-store'});if(!r.ok)throw new Error('No se pudieron obtener certificados Access: '+r.status);
  const d=await r.json(),keys=Array.isArray(d.keys)?d.keys:[];if(!keys.length)throw new Error('Cloudflare Access no entregó claves');certCache={at:Date.now(),keys};return keys;
}
async function verifyAccessJwt(token,env,now=Math.floor(Date.now()/1000)){
  const parsed=parseJwt(token);if(!parsed)return{ok:false,error:'JWT inválido'};
  if(parsed.header.alg!=='RS256'||!parsed.header.kid)return{ok:false,error:'algoritmo Access no permitido'};
  let keys=await accessKeys(env.CLOUDFLARE_TEAM_DOMAIN),jwk=keys.find(k=>k.kid===parsed.header.kid);
  // Rotación de claves: un kid nuevo no debe dejar el dashboard fuera hasta que
  // venza la caché local de 5 minutos.
  if(!jwk){keys=await accessKeys(env.CLOUDFLARE_TEAM_DOMAIN,true);jwk=keys.find(k=>k.kid===parsed.header.kid);}
  if(!jwk)return{ok:false,error:'kid Access desconocido'};
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const ok=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,parsed.signature,new TextEncoder().encode(parsed.signingInput));if(!ok)return{ok:false,error:'firma Access inválida'};
  const p=parsed.payload,skew=30;if(Number(p.exp||0)+skew<now)return{ok:false,error:'Access expirado'};if(Number(p.nbf||0)-skew>now)return{ok:false,error:'Access aún no válido'};
  if(!audMatches(p.aud,env.CLOUDFLARE_ACCESS_AUD))return{ok:false,error:'audiencia Access inválida'};
  const issuer=String(env.CLOUDFLARE_ACCESS_ISSUER||`https://${String(env.CLOUDFLARE_TEAM_DOMAIN||'').replace(/^https?:\/\//,'').replace(/\/$/,'')}`);if(String(p.iss||'')!==issuer)return{ok:false,error:'issuer Access inválido'};
  const email=String(p.email||p.sub||'').toLowerCase();if(!email)return{ok:false,error:'Access sin identidad'};return{ok:true,email,payload:p};
}
function accessAssertion(request){return request.headers.get('Cf-Access-Jwt-Assertion')||cookieValue(request.headers.get('Cookie'),'CF_Authorization');}
function safeReturn(raw,allowed){try{const u=new URL(String(raw||allowed));return u.origin===allowed?u.toString():allowed;}catch{return allowed;}}

export default{
  async fetch(request,env){
    const allowed=String(env.DASHBOARD_ORIGIN||'https://dashboard.thelab.solutions'),origin=request.headers.get('Origin')||'',cors=originHeaders(origin,allowed),url=new URL(request.url);
    if(request.method==='OPTIONS'){if(origin!==allowed)return new Response(null,{status:403});return new Response(null,{status:204,headers:cors});}
    if(url.pathname==='/health')return json({ok:true,service:'printer-access-worker'},200,cors);
    if(!['/session','/login'].includes(url.pathname)||request.method!=='GET')return json({ok:false,error:'not found'},404,cors);
    // /session sólo se consume desde el dashboard; /login es navegación directa
    // para que Cloudflare Access pueda establecer CF_Authorization y devolver al usuario.
    if(url.pathname==='/session'&&origin!==allowed)return json({ok:false,error:'forbidden origin'},403,cors);
    const assertion=accessAssertion(request);if(!assertion)return json({ok:false,error:'Cloudflare Access requerido'},401,cors);
    try{
      const access=await verifyAccessJwt(assertion,env);if(!access.ok)return json({ok:false,error:access.error},401,cors);
      if(url.pathname==='/login')return Response.redirect(safeReturn(url.searchParams.get('return'),allowed),302);
      const role=roleForEmail(access.email,{admins:env.ADMIN_EMAILS,operators:env.OPERATOR_EMAILS});
      const minted=await mintSessionToken({secret:env.FARM_SESSION_SECRET,role,sub:access.email,aud:String(env.FARM_SESSION_AUDIENCE||'thelab-farm'),iss:String(env.FARM_SESSION_ISSUER||'printer-access-worker'),ttlSec:Number(env.SESSION_TTL_SEC||300)});
      return json({ok:true,session:minted.token,role,expiresAt:minted.payload.exp*1000,email:access.email},200,cors);
    }catch(e){return json({ok:false,error:'No se pudo emitir sesión: '+(e?.message||String(e))},500,cors);}
  }
};
export{verifyAccessJwt,accessKeys,safeReturn};
