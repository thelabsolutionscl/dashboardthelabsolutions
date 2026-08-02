/* Reutiliza en todas las páginas del Modo TV el mismo logo horizontal del dashboard. */
(function(){
  'use strict';
  const PATCHED='data-tv-dashboard-logo';
  const LOGO_CLASS='tv-shared-dashboard-logo';

  function dashboardLogo(){
    const selectors=[
      '.topbar-logo img',
      '.brand img',
      '.sidebar-logo img',
      'header img[alt*="Lab" i]',
      'img[alt*="The Lab" i]',
      'img.logo'
    ];
    for(const selector of selectors){
      const img=document.querySelector(selector);
      if((img&&img.currentSrc)||img?.src)return img;
    }
    return null;
  }

  function isTvContext(){
    return document.fullscreenElement||document.body.classList.contains('kiosk')||document.querySelector('.cal-tv,[class*="tv-"],[class*="-tv"],[data-tv-mode],.of-tv,.oficina-tv');
  }

  function visibleTvRoots(){
    const selectors=['.cal-tv','[data-tv-mode]','.of-tv','.oficina-tv','[class*="tv-page"]','[class*="tv-view"]','[class*="-tv"]'];
    const roots=[...document.querySelectorAll(selectors.join(','))].filter(el=>{
      const cs=getComputedStyle(el);return cs.display!=='none'&&cs.visibility!=='hidden';
    });
    if(document.fullscreenElement)roots.push(document.fullscreenElement);
    if(document.body.classList.contains('kiosk'))roots.push(document.body);
    return [...new Set(roots)];
  }

  function pageTitle(root){
    const title=root.querySelector('[data-tv-title],h1,h2,.title,.page-title,.tv-title');
    const txt=(title?.textContent||'').replace(/THE LAB SOLUTIONS/ig,'').replace(/\s+/g,' ').trim();
    return txt||'';
  }

  function ensureHeader(root,source){
    if(root.querySelector('.'+LOGO_CLASS))return;
    let header=root.querySelector('[data-tv-header],.tv-header,header');
    if(!header){
      header=document.createElement('div');
      header.setAttribute('data-tv-header','1');
      root.prepend(header);
    }
    const logo=source.cloneNode(true);
    logo.removeAttribute('id');
    logo.className=LOGO_CLASS;
    logo.alt='The Lab Solutions';
    logo.style.cssText='display:block;width:auto;height:34px;max-width:270px;object-fit:contain;flex:0 0 auto';
    const titleText=pageTitle(root);
    const title=document.createElement('span');
    title.textContent=titleText;
    title.style.cssText='color:#777;font:700 22px/1 "Bebas Neue",sans-serif;letter-spacing:1.5px;white-space:nowrap';
    header.prepend(title);
    header.prepend(logo);
    header.style.display='flex';
    header.style.alignItems='center';
    header.style.gap='18px';
    header.setAttribute(PATCHED,'1');
  }

  function patch(){
    if(!isTvContext())return;
    const source=dashboardLogo();
    if(!source)return;
    for(const root of visibleTvRoots())ensureHeader(root,source);
  }

  const observer=new MutationObserver(patch);
  const start=()=>{
    patch();
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});
    document.addEventListener('fullscreenchange',patch);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
