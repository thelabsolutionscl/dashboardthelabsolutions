#!/usr/bin/env node
'use strict';

/** Farm Auth Gateway: sesiones cortas -> tokens locales exactos por rol. */
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=__dirname,DATA_DIR=process.env.FARM_DATA_DIR||path.join(ROOT,'data');
const SECRET_FILE=process.env.FARM_SESSION_SECRET_FILE||path.join(DATA_DIR,'session-secret');
const AUDIENCE=String(process.env.FARM_SESSION_AUDIENCE||'thelab-farm'),ISSUER=String(process.env.FARM_SESSION_ISSUER||'printer-access-worker');
const CLOCK_SKEW_SEC=Math.max(0,Math.min(120,Number(process.env.FARM_SESSION_CLOCK_SKEW_SEC||20))),ROLE_RANK={viewer:1,operator:2,admin:3};
fs.mkdirSync(DATA_DIR,{recursive:true,mode:0o700});
function b64url(buf){return Buffer.from(buf).toString('base64url');}
function decodePart(value){try{return JSON.parse(Buffer.from(String(value||''),'base64url').toString('utf8'));}catch(_){return null;}}
function safeEq(a,b){const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);}
function secureReadOrCreate(file,bytes=32){try{const s=fs.readFileSync(file,'utf8').trim();if(s){try{fs.chmodSync(file,0o600);}catch(_){}return s;}}catch(_){}const s=crypto.randomBytes(bytes).toString('base64url');fs.writeFileSync(file,s+'\n',{mode:0o600});try{fs.chmodSync(file,0o600);}catch(_){}return s;}
function loadSecret(){const env=String(process.env.FARM_SESSION_SECRET||'').trim();return env||secureReadOrCreate(SECRET_FILE,32);}const SESSION_SECRET=loadSecret();
function ensureAdminToken(){
  let token=String(process.env.BRIDGE_ADMIN_TOKEN||process.env.BRIDGE_TOKEN||'').trim();
  if(!token){try{token=fs.readFileSync(path.join(ROOT,'.bridge-token'),'utf8').trim();}catch(_){}}
  if(!token)token=secureReadOrCreate(path.join(DATA_DIR,'bridge-admin-token'),24);
  // Este preload corre primero. Propagar ambos nombres evita que preloads
  // heredados intenten crear `.bridge-token` dentro del checkout read-only.
  process.env.BRIDGE_ADMIN_TOKEN=token;
  if(!String(process.env.BRIDGE_TOKEN||'').trim())process.env.BRIDGE_TOKEN=token;
  return token;
}
function ensureRoleToken(role,envName){const configured=String(process.env[envName]||'').trim();if(configured)return configured;const token=secureReadOrCreate(path.join(DATA_DIR,`bridge-${role}-token`),24);process.env[envName]=token;return token;}
const ROLE_TOKENS={admin:ensureAdminToken(),operator:ensureRoleToken('operator','BRIDGE_OPERATOR_TOKEN'),viewer:ensureRoleToken('viewer','BRIDGE_VIEWER_TOKEN')};
function localTokenForRole(role){return ROLE_RANK[role]?String(ROLE_TOKENS[role]||''):'';}
function signPayload(payload,secret=SESSION_SECRET){const body=b64url(Buffer.from(JSON.stringify(payload))),sig=b64url(crypto.createHmac('sha256',secret).update('v1.'+body).digest());return`v1.${body}.${sig}`;}
function mintSession({role='viewer',sub='local-test',ttlSec=300,now=Math.floor(Date.now()/1000),aud=AUDIENCE,iss=ISSUER}={},secret=SESSION_SECRET){if(!ROLE_RANK[role])throw new Error('rol inválido');const ttl=Math.max(30,Math.min(900,Number(ttlSec||300)));return signPayload({v:1,role,sub:String(sub||''),iat:now,exp:now+ttl,aud,iss},secret);}
function verifySession(token,{now=Math.floor(Date.now()/1000),secret=SESSION_SECRET,aud=AUDIENCE,iss=ISSUER}={}){const parts=String(token||'').split('.');if(parts.length!==3||parts[0]!=='v1')return{ok:false,error:'formato'};const expected=b64url(crypto.createHmac('sha256',secret).update('v1.'+parts[1]).digest());if(!safeEq(parts[2],expected))return{ok:false,error:'firma'};const payload=decodePart(parts[1]);if(!payload||payload.v!==1||!ROLE_RANK[payload.role])return{ok:false,error:'payload'};if(String(payload.aud||'')!==String(aud)||String(payload.iss||'')!==String(iss))return{ok:false,error:'audiencia'};if(!Number.isFinite(Number(payload.exp))||Number(payload.exp)+CLOCK_SKEW_SEC<now)return{ok:false,error:'expirada'};if(Number(payload.iat||0)-CLOCK_SKEW_SEC>now)return{ok:false,error:'iat'};return{ok:true,role:payload.role,sub:String(payload.sub||''),exp:Number(payload.exp),payload};}
function bearer(req){const h=String(req?.headers?.authorization||''),m=h.match(/^Bearer\s+(.+)$/i);return m?m[1].trim():'';}
function sessionFromReq(req){const u=new URL(req.url,'http://farm.local'),candidates=[bearer(req),u.searchParams.get('st')||'',u.searchParams.get('bt')||''];for(const token of candidates){const v=verifySession(token);if(v.ok)return{...v,token};}return null;}
function stripSessionQuery(rawUrl){const u=new URL(rawUrl,'http://farm.local'),bt=u.searchParams.get('bt')||'';if(verifySession(bt).ok)u.searchParams.delete('bt');u.searchParams.delete('st');return u.pathname+(u.searchParams.toString()?'?'+u.searchParams.toString():'');}
const originalCreateServer=http.createServer;
http.createServer=function patchedCreateServer(listener){if(typeof listener!=='function')return originalCreateServer.apply(this,arguments);return originalCreateServer.call(this,function farmAuthWrapped(req,res){delete req.headers['x-farm-session-role'];delete req.headers['x-farm-session-sub'];const session=sessionFromReq(req);if(session){const local=localTokenForRole(session.role);if(local)req.headers['x-bridge-token']=local;req.headers['x-farm-session-role']=session.role;req.headers['x-farm-session-sub']=session.sub;req.url=stripSessionQuery(req.url);res.setHeader('X-Farm-Session','1');res.setHeader('X-Farm-Session-Role',session.role);}return listener.call(this,req,res);});};
module.exports={mintSession,verifySession,sessionFromReq,stripSessionQuery,localTokenForRole,ROLE_RANK,ROLE_TOKENS,AUDIENCE,ISSUER,_test:{signPayload,decodePart,b64url,safeEq,secureReadOrCreate,ensureRoleToken,ensureAdminToken}};
