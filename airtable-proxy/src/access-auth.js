/*
 * Optional Cloudflare Access identity + server-side RBAC for the Airtable proxy.
 *
 * Rollout is intentionally staged: no Access variables => legacy mode, so
 * existing dashboards stay usable until the organization configures Access.
 * As soon as ANY ACCESS_* variable is supplied, incomplete configuration
 * fails closed. Do not treat the public X-App-Key or Origin as user identity.
 *
 * Source: Cloudflare Access JWT validation documentation. Only keys fetched
 * from the configured, strictly validated Cloudflare team domain are trusted.
 */
const ACCESS_ROLES=new Set(['viewer','operator','finance','admin']);
const ACCESS_WRITE_TABLES={
  operator:new Set(['Clientes','Cotizaciones','Pedidos','Inventario','Maquinas','Maquinas_Eventos','Maquinas_Mant','Equipo_Eventos','Monitor Sistema','Proveedores']),
  finance:new Set(['Clientes','Cotizaciones','Pedidos','Facturas','Proveedores','Reportes']),
};
const ACCESS_FINANCE_TABLES=new Set([
  'Facturas','Gastos','Pagos','Libro Diario','Remuneraciones','Comisiones',
  'Presupuestos','Prestamos','Préstamos','Ventas','Caja','Reportes'
]);
const ACCESS_ALLOWED_TABLES=new Set([
  'Clientes','Cotizaciones','Pedidos','Facturas','Inventario','Maquinas',
  'Maquinas_Eventos','Maquinas_Mant','Equipo_Eventos','Monitor Sistema',
  'Proveedores','Reportes',
  'Gastos','Pagos','Libro Diario','Remuneraciones','Comisiones','Presupuestos',
  'Prestamos','Préstamos','Ventas','Caja'
]);
const ACCESS_JWKS_CACHE=new Map();
const ACCESS_JWKS_TTL=5*60*1000;

function accessConfig(env){
  const domain=String(env.ACCESS_TEAM_DOMAIN||'').trim().replace(/\/$/,'');
  const audience=String(env.ACCESS_AUD||'').trim();
  const rolesRaw=String(env.ACCESS_ROLE_MAP||'').trim();
  const enabled=String(env.ACCESS_ENFORCE||'').trim().toLowerCase();
  if(!domain&&!audience&&!rolesRaw&&!enabled)return null;
  if(enabled!=='true'||!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain)||
     !/^[A-Za-z0-9_-]{10,200}$/.test(audience)||!rolesRaw)
    throw new Error('Cloudflare Access configuration incomplete: identity protection fails closed');
  let source;
  try{source=JSON.parse(rolesRaw);}catch(_){throw new Error('ACCESS_ROLE_MAP is invalid JSON');}
  if(!source||typeof source!=='object'||Array.isArray(source)||
     Object.keys(source).length<1||
     !Object.entries(source).every(([email,role])=>
       /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email===email.toLowerCase()&&ACCESS_ROLES.has(role)))
    throw new Error('ACCESS_ROLE_MAP must contain explicit email-to-role entries');
  return {domain,audience,roles:source};
}

function accessDecode(segment){
  if(!/^[A-Za-z0-9_-]+$/.test(segment)||segment.length>8192)throw new Error('Malformed JWT');
  const raw=atob(segment.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-segment.length%4)%4));
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function accessJwks(domain,force=false){
  const cached=ACCESS_JWKS_CACHE.get(domain);
  if(!force&&cached&&cached.expires>Date.now())return cached.keys;
  const response=await fetch(domain+'/cdn-cgi/access/certs',{redirect:'error'});
  if(!response.ok)throw new Error('Access certificate lookup failed');
  const body=await response.json();
  if(!body||!Array.isArray(body.keys)||!body.keys.length||body.keys.length>20)
    throw new Error('Invalid Access JWKS');
  const keys=body.keys.filter(k=>k.kty==='RSA'&&k.kid&&k.n&&k.e);
  if(!keys.length)throw new Error('No valid Access verification key');
  ACCESS_JWKS_CACHE.set(domain,{keys,expires:Date.now()+ACCESS_JWKS_TTL});
  return keys;
}

async function accessVerifyClaims(token,config){
  if(typeof token!=='string'||token.length>20000)throw new Error('Missing Access JWT');
  const parts=token.split('.');
  if(parts.length!==3)throw new Error('Malformed Access JWT');
  const header=accessDecode(parts[0]);
  const claims=accessDecode(parts[1]);
  if(header.alg!=='RS256'||typeof header.kid!=='string'||
     !/^[A-Za-z0-9_-]{1,200}$/.test(header.kid))
    throw new Error('Unsupported Access JWT algorithm/key');
  let keys=await accessJwks(config.domain);
  let jwk=keys.find(k=>k.kid===header.kid);
  if(!jwk){keys=await accessJwks(config.domain,true);jwk=keys.find(k=>k.kid===header.kid);}
  if(!jwk)throw new Error('Access JWT signing key unknown');
  const key=await crypto.subtle.importKey('jwk',jwk,
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const signature=Uint8Array.from(atob(parts[2].replace(/-/g,'+').replace(/_/g,'/')+
    '='.repeat((4-parts[2].length%4)%4)),c=>c.charCodeAt(0));
  const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,signature,
    new TextEncoder().encode(parts[0]+'.'+parts[1]));
  if(!valid)throw new Error('Invalid Access JWT signature');
  const now=Math.floor(Date.now()/1000);
  if(claims.iss!==config.domain||!(Array.isArray(claims.aud)?claims.aud.includes(config.audience):claims.aud===config.audience)||
     !Number.isFinite(claims.exp)||claims.exp<=now||
     (claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>now))||
     (claims.iat!==undefined&&(!Number.isFinite(claims.iat)||claims.iat>now+60)))
    throw new Error('Access JWT issuer/audience/lifetime invalid');
  if(claims.type!==undefined&&claims.type!=='app')throw new Error('Only application JWTs are supported');
  return claims;
}
async function accessVerify(token,config){
  const claims=await accessVerifyClaims(token,config);
  const email=typeof claims.email==='string'?claims.email.toLowerCase():'';
  if(!email||!Object.hasOwn(config.roles,email)||claims.common_name||claims.sub==='')
    throw new Error('Access identity has no assigned role');
  return {email,role:config.roles[email]};
}

async function accessVerifyLeadService(token,config,env){
  const expected=String(env.ACCESS_LEAD_SERVICE_CLIENT_ID||'').trim();
  if(!/^[A-Za-z0-9._-]{8,180}\.access$/.test(expected))
    throw new Error('Lead service client ID not configured');
  const claims=await accessVerifyClaims(token,config);
  if(claims.type!=='app'||claims.sub!==''||claims.common_name!==expected||
     typeof claims.email==='string')
    throw new Error('Access service identity mismatch');
  return {role:'lead-service',client_id:expected};
}
function accessTable(path){
  const prefix='/v0/app1YtD74AqiPWQhy/';
  if(!path.startsWith(prefix))return '';
  const raw=path.slice(prefix.length).split('/')[0];
  let segment;
  try{segment=decodeURIComponent(raw);}catch(_){return '';}
  // Noncanonical paths, table IDs and hidden encodings cannot bypass RBAC.
  if(raw!==encodeURIComponent(segment)||!ACCESS_ALLOWED_TABLES.has(segment))return '';
  return segment;
}

function accessAllows(identity,method,path){
  if(identity.role==='admin')return true;
  const isWrite=method!=='GET'&&method!=='HEAD';
  if(path==='/access/me')return method==='GET';
  // An authenticated human may request ONLY a short-lived farm ticket.
  // The proxy maps finance/viewer to read-only, operator to printer
  // operations and admin to farm administration; shared APP_KEY cannot mint.
  if(path==='/printer/session')return method==='POST';
  if(path.startsWith('/printer/'))return false;
  // Portal administrative operations require an individual, signed session.
  // Sales/finance can create a link; revocation invalidates active links and
  // is limited to admins. Never authorize these using only public APP_KEY.
  if(path==='/portal-admin/link')return method==='POST'&&
    (identity.role==='operator'||identity.role==='finance');
  if(path==='/portal-admin/revocar'||path.startsWith('/portal-admin/'))return false;
  // Privileged SII calls are never exposed to the legacy shared APP_KEY:
  // finance may emit/read status, only admin may upload CAF.
  if(path==='/sii/emit')return identity.role==='finance'&&method==='POST';
  if(/^\/sii\/folio\/(33|39|52|56|61)$/.test(path))
    return identity.role==='finance'&&method==='GET';
  if(path==='/sii/caf')return false; // handled exclusively by admin above
  if(path.startsWith('/sii/'))return false;

  if(path.startsWith('/v0/meta/'))return false;
  if(path.startsWith('/anthropic/')||path.startsWith('/openai/')||path==='/seo-fetch')
    return !isWrite||identity.role==='operator'||identity.role==='finance';
  const table=accessTable(path);
  if(!table)return false;
  if(ACCESS_FINANCE_TABLES.has(table)&&identity.role!=='finance')return false;
  if(!isWrite)return true;
  return ACCESS_WRITE_TABLES[identity.role]?.has(table)||false;
}

export async function accessAuthorize(request,env,path){
  let config;
  try{config=accessConfig(env);}catch(_){
    return {response:new Response(JSON.stringify({error:'Access authentication misconfigured'}),{
      status:503,headers:{'Content-Type':'application/json'}})};
  }
  const leadPath='/service/lead/anthropic/v1/messages';
  if(!config){
    if(path===leadPath)
      return {response:new Response(JSON.stringify({error:'Lead service Access not activated'}),{
        status:503,headers:{'Content-Type':'application/json'}})};
    return {legacy:true};
  }
  if(path===leadPath){
    if(request.method!=='POST')
      return {response:new Response(JSON.stringify({error:'Method not allowed'}),{
        status:405,headers:{'Content-Type':'application/json'}})};
    try{
      const serviceIdentity=await accessVerifyLeadService(
        request.headers.get('Cf-Access-Jwt-Assertion'),config,env);
      return {serviceIdentity};
    }catch(_){
      return {response:new Response(JSON.stringify({error:'Valid lead service token required'}),{
        status:401,headers:{'Content-Type':'application/json'}})};
    }
  }
  let identity;
  try{identity=await accessVerify(request.headers.get('Cf-Access-Jwt-Assertion'),config);}
  catch(_){return {response:new Response(JSON.stringify({error:'Valid Cloudflare Access session required'}),{
    status:401,headers:{'Content-Type':'application/json'}})};}
  if(!accessAllows(identity,request.method,path))
    return {response:new Response(JSON.stringify({error:'Insufficient role for this operation'}),{
      status:403,headers:{'Content-Type':'application/json'}})};
  return {identity};
}
