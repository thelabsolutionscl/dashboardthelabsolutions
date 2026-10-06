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
const ACCESS_ROLES=new Set(['viewer','operator','finance','admin','sales']);
// Verified against the live Airtable single-select schemas for all three
// commercial tables (2026-09-29). No default ownership for unassigned records.
const ACCESS_SELLER_VALUES=new Set(['florencia','nicanor','gustavo']);
const ACCESS_SELLER_TABLES=new Set(['Clientes','Cotizaciones','Pedidos']);
// Only tables with a reviewed, field-level viewer projection may be read.
// The signed viewer role never inherits future tables or private system logs.
const ACCESS_VIEWER_TABLES=new Set([
  'Clientes','Cotizaciones','Pedidos','Proveedores','Maquinas',
  'Maquinas_Eventos','Maquinas_Mant'
]);
const ACCESS_WRITE_TABLES={
  finance:new Set(['Clientes','Cotizaciones','Pedidos','Facturas','Proveedores','Reportes']),
};
const ACCESS_OPERATOR_WRITE_METHODS=Object.freeze({
  Clientes:new Set(['POST','PATCH']),
  Cotizaciones:new Set(['POST','PATCH']),
  Pedidos:new Set(['POST','PATCH']),
  Proveedores:new Set(['POST','PATCH']),
  Maquinas:new Set(['PATCH']),
  Maquinas_Eventos:new Set(['POST','PATCH']),
  Maquinas_Mant:new Set(['POST']),
  Equipo_Eventos:new Set(['POST','PATCH','DELETE'])
});
const ACCESS_FINANCE_TABLES=new Set([
  'Facturas','Gastos','Pagos','Libro Diario','Remuneraciones','Comisiones',
  'Presupuestos','Prestamos','Préstamos','Ventas','Caja','Reportes'
]);
const ACCESS_ALLOWED_TABLES=new Set([
  'Clientes','Cotizaciones','Pedidos','Facturas','Inventario','Maquinas',
  'Maquinas_Eventos','Maquinas_Mant','Equipo_Eventos','Monitor Sistema',
  'Proveedores','Reportes',
  'Gastos','Pagos','Libro Diario','Remuneraciones','Comisiones','Presupuestos',
  'Prestamos','Préstamos','Ventas','Caja',
  // Explicitly observed dashboard tables: admin needs these at Access cutover.
  // Do not automatically widen reader/operator/finance access to campaign,
  // notification or operational logs, which can contain personal information.
  'Automations','Agent_Queue','Agent_Log','Social_Posts',
  'Social_Interactions','Social_Metrics','LinkedIn_Prospects',
  'Newsletter_Campañas','Newsletter_Envios','Google_Ads_KPIs'
]);
const ACCESS_ADMIN_ONLY_TABLES=new Set([
  // Live Monitor Sistema records share one unrestricted Notes column for
  // machine safety/cost configuration, mail signatures, jobs and calendars.
  // Read/write requires admin until a per-record scoped service exists.
  'Monitor Sistema',
  'Automations','Agent_Queue','Agent_Log','Social_Posts',
  'Social_Interactions','Social_Metrics','LinkedIn_Prospects',
  'Newsletter_Campañas','Newsletter_Envios','Google_Ads_KPIs'
]);
const ACCESS_JWKS_CACHE=new Map();
const ACCESS_JWKS_TTL=5*60*1000;

function accessConfig(env){
  const domain=String(env.ACCESS_TEAM_DOMAIN||'').trim().replace(/\/$/,'');
  const audience=String(env.ACCESS_AUD||'').trim();
  const rolesRaw=String(env.ACCESS_ROLE_MAP||'').trim();
  const enabled=String(env.ACCESS_ENFORCE||'').trim().toLowerCase();
  // Optional emergency revocation controls. Supplying only either of these
  // must NOT silently leave the Worker in unauthenticated legacy mode.
  const blockedRaw=String(env.ACCESS_BLOCKED_EMAILS||'').trim();
  const notBeforeRaw=String(env.ACCESS_SESSION_NOT_BEFORE||'').trim();
  const sellersRaw=String(env.ACCESS_SELLER_MAP||'').trim();
  const salesWrites=String(env.ACCESS_SALES_WRITES_ENABLED||'').trim().toLowerCase();
  if(salesWrites&&salesWrites!=='true'&&salesWrites!=='false')
    throw new Error('ACCESS_SALES_WRITES_ENABLED must be an explicit boolean');
  if(!domain&&!audience&&!rolesRaw&&!enabled&&!blockedRaw&&!notBeforeRaw&&
     !sellersRaw&&salesWrites!=='true')return null;
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
  let blocked=[],notBefore=Object.create(null);
  if(blockedRaw){
    try{blocked=JSON.parse(blockedRaw);}catch(_){throw new Error('ACCESS_BLOCKED_EMAILS must be a JSON array');}
    if(!Array.isArray(blocked)||blocked.length>200||
       !blocked.every(email=>typeof email==='string'&&
         /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email===email.toLowerCase())||
       new Set(blocked).size!==blocked.length)
      throw new Error('ACCESS_BLOCKED_EMAILS must contain unique lowercase emails');
  }
  if(notBeforeRaw){
    let parsed;
    try{parsed=JSON.parse(notBeforeRaw);}catch(_){throw new Error('ACCESS_SESSION_NOT_BEFORE must be a JSON object');}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
       Object.keys(parsed).length>200||
       !Object.entries(parsed).every(([email,cutoff])=>
         /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email===email.toLowerCase()&&
         Number.isSafeInteger(cutoff)&&cutoff>=1000000000&&cutoff<=4102444800))
      throw new Error('ACCESS_SESSION_NOT_BEFORE requires lowercase emails and Unix seconds');
    notBefore=Object.assign(Object.create(null),parsed);
  }
  let sellers=Object.create(null);
  if(sellersRaw){
    let parsed;
    try{parsed=JSON.parse(sellersRaw);}catch(_){throw new Error('ACCESS_SELLER_MAP must be a JSON object');}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
       Object.keys(parsed).length>100||
       !Object.entries(parsed).every(([email,name])=>
         /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email===email.toLowerCase()&&
         ACCESS_SELLER_VALUES.has(name)))
      throw new Error('ACCESS_SELLER_MAP must map lowercase emails to verified Airtable Vendedor choices');
    sellers=Object.assign(Object.create(null),parsed);
  }
  // Every signed sales identity must have a single, explicit owner assignment.
  // Other roles are unchanged; there is never an implicit global sales scope.
  if(Object.entries(source).some(([email,role])=>role==='sales'&&!Object.hasOwn(sellers,email)))
    throw new Error('ACCESS_SELLER_MAP missing a signed sales user');
  return {domain,audience,roles:source,blockedEmails:new Set(blocked),
    sessionNotBefore:notBefore,sellers};
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
  // A valid, unexpired Access JWT is not enough if the organization blocks a
  // person after issuing it. These controls take effect on the NEXT request.
  // Keep token cutoffs separate from the persistent email denylist: a later
  // reauthentication can renew an old session, but cannot evade a block.
  if(config.blockedEmails?.has(email))
    throw new Error('Access user administratively blocked');
  if(Object.hasOwn(config.sessionNotBefore||{},email)){
    const cutoff=config.sessionNotBefore[email];
    if(!Number.isSafeInteger(claims.iat)||claims.iat<=cutoff)
      throw new Error('Access user session issued before revocation cutoff');
  }
  const role=config.roles[email];
  if(role==='sales'){
    const seller=config.sellers?.[email];
    if(!ACCESS_SELLER_VALUES.has(seller))
      throw new Error('Sales identity has no verified seller assignment');
    return {email,role,seller};
  }
  return {email,role};
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
  const parts=path.slice(prefix.length).split('/');
  if(parts.length>2||!parts[0]||
     (parts.length===2&&!/^rec[A-Za-z0-9]{14}$/.test(parts[1])))return '';
  const raw=parts[0];
  let segment;
  try{segment=decodeURIComponent(raw);}catch(_){return '';}
  // Both the table name and optional record ID must be canonical. In
  // particular, an admin JWT is not a license to use the Airtable PAT as a
  // proxy for unknown tables, subresources or path-encoded aliases.
  if(raw!==encodeURIComponent(segment)||!ACCESS_ALLOWED_TABLES.has(segment))return '';
  return segment;
}

function accessAllows(identity,method,path){
  if(!identity||!ACCESS_ROLES.has(identity.role))return false;
  const admin=identity.role==='admin';
  const finance=identity.role==='finance';
  const operator=identity.role==='operator';
  const isWrite=method!=='GET';
  if(path==='/access/me')return method==='GET';
  // Solo administradores verificados consultan las claves de servicios externos.
  if(path==='/integrations/check')return admin&&method==='GET';
  if(path==='/ads/campaign-shell')return method==='POST'&&(operator||finance||admin);
  if(path==='/shared/calendar')return method==='GET'||
    (method==='PUT'&&['sales','operator','finance','admin'].includes(identity.role));
  if(path==='/shared/agenda')return method==='GET'||
    (method==='PUT'&&['sales','operator','finance','admin'].includes(identity.role));
  if(path==='/shared/mail')return method==='GET'||
    (method==='PUT'&&['sales','operator','finance','admin'].includes(identity.role));
  if(path==='/shared/problems')return ['GET','POST'].includes(method);
  if(path==='/shared/machineops')return ['operator','admin'].includes(identity.role)&&
    ['GET','PUT'].includes(method);
  if(path==='/shared/simulation')return (admin||identity.email==='marketing@thelab.solutions')&&
    ['GET','PUT'].includes(method);
  // Sales reads remain owner-scoped. The sole write shape admitted by RBAC
  // is a single-record PATCH on an approved commercial table; the Worker
  // applies a *separate opt-in switch*, field allowlist, optimistic precondition
  // and serial Durable Object guard. No sales CREATE/DELETE/approval/relations.
  if(identity.role==='sales'){
    const table=accessTable(path);
    if(!ACCESS_SELLER_TABLES.has(table))return false;
    if(method==='GET')return true;
    return method==='PATCH'&&
      /^\/v0\/app1YtD74AqiPWQhy\/[^/]+\/rec[A-Za-z0-9]{14}$/.test(path);
  }
  // Financial endpoints are explicitly constrained even for administrators.
  if(path==='/marketing/spend')return (finance||admin)&&['GET','PUT'].includes(method);
  if(path==='/marketing/spend/history')return (finance||admin)&&method==='GET';
  if(path==='/printer/session')return method==='POST';
  if(path.startsWith('/printer/'))return false;

  if(path==='/feedback/link')return method==='POST'&&(operator||finance||admin);
  if(path==='/portal-admin/link')return method==='POST'&&(operator||finance||admin);
  if(path==='/portal-admin/revocar')return method==='POST'&&admin;
  if(path.startsWith('/portal-admin/'))return false;

  if(path==='/sii/emit')return method==='POST'&&(finance||admin);
  if(/^\/sii\/folio\/(33|39|52|56|61)$/.test(path))
    return method==='GET'&&(finance||admin);
  if(path==='/sii/caf')return method==='PUT'&&admin;
  if(path.startsWith('/sii/'))return false;

  // The proxy itself permits only the table-list GET and validated schema
  // bootstrap POST. Do not grant admin access to arbitrary metadata paths.
  const meta='/v0/meta/bases/app1YtD74AqiPWQhy/tables';
  if(path.startsWith('/v0/meta/'))return admin&&(
    (path===meta&&['GET','POST'].includes(method))||
    (method==='POST'&&new RegExp('^'+meta+'/tbl[A-Za-z0-9]{14}/fields$').test(path))
  );

  // Keep the supported AI/SEO routes explicit; the budget/SSRF checks remain
  // in the Worker and are not replaced by an administrator's broad role.
  if(path==='/anthropic/usage'||path==='/openai/usage')return method==='GET';
  if(['/anthropic/v1/messages','/openai/v1/chat/completions',
      '/openai/v1/images/generations','/openai/v1/images/edits'].includes(path))
    return method==='POST'&&(operator||finance||admin);
  if(path==='/seo-fetch')return method==='GET';
  if(path.startsWith('/anthropic/')||path.startsWith('/openai/'))return false;

  const table=accessTable(path);
  if(!table)return false;
  if(identity.role==='viewer')return method==='GET'&&ACCESS_VIEWER_TABLES.has(table);
  if(ACCESS_ADMIN_ONLY_TABLES.has(table)&&!admin)return false;
  if(ACCESS_FINANCE_TABLES.has(table)&&!finance&&!admin)return false;
  if(!isWrite)return true;
  // Admin has unrestricted access to *recognized* data tables, not to any
  // arbitrary upstream method, table name or nested endpoint.
  if(admin)return ['POST','PATCH','DELETE'].includes(method);
  // No destructive permissions for operational staff. CRM and supplier
  // POST/PATCH also require a separate server-side field/type guard.
  if(operator)return ACCESS_OPERATOR_WRITE_METHODS[table]?.has(method)===true;
  return ['POST','PATCH','DELETE'].includes(method)&&
    !!ACCESS_WRITE_TABLES[identity.role]?.has(table);
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
