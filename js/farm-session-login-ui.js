/* Banner de bootstrap para la sesión corta de MÁQUINAS. */
(function(){
'use strict';
if(typeof window==='undefined'||typeof document==='undefined'||window.__TLS_FARM_SESSION_LOGIN_UI__)return;window.__TLS_FARM_SESSION_LOGIN_UI__=true;
const ID='farmSessionLoginBanner';
function remove(){document.getElementById(ID)?.remove();}
function render(){
  const api=window.FarmSessionAuth;if(!api?.status)return;const s=api.status();
  if(!s.loginRequired||s.mode!=='unavailable'){remove();return;}
  let el=document.getElementById(ID);if(!el){el=document.createElement('div');el.id=ID;el.setAttribute('role','status');el.style.cssText='position:fixed;z-index:10020;left:50%;top:18px;transform:translateX(-50%);max-width:min(92vw,560px);background:var(--surface,#17191d);color:var(--text,#fff);border:1px solid var(--warn,#f5a623);border-radius:10px;padding:10px 12px;box-shadow:0 10px 35px #0008;display:flex;gap:10px;align-items:center;font:12px/1.35 system-ui';el.innerHTML='<span style="flex:1"><b>🔐 MÁQUINAS necesita iniciar sesión</b><br><span style="opacity:.75">Cloudflare Access debe autorizar este navegador antes de conectar con la granja.</span></span><button type="button" style="border:0;border-radius:7px;padding:8px 11px;font-weight:700;cursor:pointer">Conectar MÁQUINAS</button>';el.querySelector('button').onclick=()=>api.login?.();document.body.appendChild(el);}
}
window.addEventListener('farm-session-updated',render);window.addEventListener('focus',()=>setTimeout(render,100));setInterval(render,5000);setTimeout(render,1200);
})();
