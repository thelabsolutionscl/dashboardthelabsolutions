/* js/comisiones-35-standard.js
 * Regla comercial estándar: comisión de ventas fija en 3,5% sobre venta neta.
 * Corrige configuraciones locales antiguas que podían quedar en 5%.
 */
(function(root){
'use strict';
if(!root)return;

const COM35_KEY='thelab_comision_cfg_v1';
const COM35_RATE=3.5;

function com35Enforce(){
  try{
    const raw=root.localStorage?.getItem(COM35_KEY)||'{}';
    let cfg={};
    try{cfg=JSON.parse(raw)||{};}catch(_){cfg={};}
    cfg.rate=COM35_RATE;
    cfg.base='venta';
    root.localStorage?.setItem(COM35_KEY,JSON.stringify(cfg));
    return cfg;
  }catch(_){return{rate:COM35_RATE,base:'venta'};}
}

com35Enforce();

if(typeof root.renderComisiones==='function'&&!root.__TLS_COM35_RENDER_PATCHED__){
  root.__TLS_COM35_RENDER_PATCHED__=true;
  const originalRenderComisiones=root.renderComisiones;
  root.renderComisiones=function(){
    com35Enforce();
    return originalRenderComisiones.apply(this,arguments);
  };
}

root.setComisionCfg=function(){
  com35Enforce();
  try{if(typeof root.toast==='function')root.toast('Comisión de ventas fijada en 3,5% sobre venta neta','success');}catch(_){}
  try{if(typeof root.renderComisiones==='function')root.renderComisiones();}catch(_){}
  try{if(typeof root.renderRemuneraciones==='function')root.renderRemuneraciones();}catch(_){}
};

try{if(typeof root.renderComisiones==='function')root.renderComisiones();}catch(_){}
try{if(typeof root.renderRemuneraciones==='function')root.renderRemuneraciones();}catch(_){}

})(typeof window!=='undefined'?window:null);
