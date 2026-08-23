const enc=new TextEncoder();

export function b64urlBytes(bytes){
  let binary='';const arr=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  for(let i=0;i<arr.length;i+=0x8000)binary+=String.fromCharCode(...arr.subarray(i,i+0x8000));
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function b64urlText(text){return b64urlBytes(enc.encode(String(text)));}
export function fromB64url(value){
  const s=String(value||'').replace(/-/g,'+').replace(/_/g,'/');
  const padded=s+'='.repeat((4-s.length%4)%4);const bin=atob(padded),out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;
}
export function decodeJsonPart(value){try{return JSON.parse(new TextDecoder().decode(fromB64url(value)));}catch{return null;}}
export function parseJwt(token){
  const parts=String(token||'').split('.');if(parts.length!==3)return null;
  const header=decodeJsonPart(parts[0]),payload=decodeJsonPart(parts[1]);
  if(!header||!payload)return null;return{parts,header,payload,signingInput:parts[0]+'.'+parts[1],signature:fromB64url(parts[2])};
}
export function audMatches(raw,expected){return Array.isArray(raw)?raw.map(String).includes(String(expected)):String(raw||'')===String(expected);}
export function emailList(raw){return new Set(String(raw||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean));}
export function roleForEmail(email,{admins='',operators=''}={}){
  const e=String(email||'').trim().toLowerCase();if(!e)return'';
  if(emailList(admins).has(e))return'admin';
  if(emailList(operators).has(e))return'operator';
  return'viewer';
}
export async function hmacSha256(secret,message){
  const key=await crypto.subtle.importKey('raw',enc.encode(String(secret)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(String(message))));
}
export async function mintSessionToken({secret,role='viewer',sub='',aud='thelab-farm',iss='printer-access-worker',ttlSec=300,now=Math.floor(Date.now()/1000)}){
  if(!['viewer','operator','admin'].includes(role))throw new Error('rol inválido');
  if(!secret)throw new Error('FARM_SESSION_SECRET ausente');
  const ttl=Math.max(30,Math.min(900,Number(ttlSec||300)));
  const payload={v:1,role,sub:String(sub||''),iat:now,exp:now+ttl,aud:String(aud),iss:String(iss)};
  const body=b64urlText(JSON.stringify(payload)),prefix='v1.'+body;
  const sig=b64urlBytes(await hmacSha256(secret,prefix));
  return{token:prefix+'.'+sig,payload};
}
