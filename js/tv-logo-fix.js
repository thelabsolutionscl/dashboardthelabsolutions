/* Reutiliza en Modo TV el mismo logo horizontal visible en el dashboard. */
(function(){
  'use strict';
  const PATCHED='data-tv-dashboard-logo';

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
      if(img&&img.currentSrc||img?.src)return img;
    }
    return null;
  }

  function tvBrandCandidates(){
    return [...document.querySelectorAll('header,div,section,span')].filter(el=>{
      if(el.hasAttribute(PATCHED))return false;
      const text=(el.textContent||'').replace(/\s+/g,' ').trim().toUpperCase();
      if(text.length>80)return false;
      return text.includes('THE LAB SOLUTIONS')&&text.includes('IMPRESORAS');
    });
  }

  function patch(){
    const source=dashboardLogo();
    if(!source)return;
    for(const target of tvBrandCandidates()){
      const logo=source.cloneNode(true);
      logo.removeAttribute('id');
      logo.removeAttribute('class');
      logo.alt='The Lab Solutions';
      logo.style.cssText='display:block;width:auto;height:34px;max-width:270px;object-fit:contain;flex:0 0 auto';
      target.replaceChildren(logo);
      const section=document.createElement('span');
      section.textContent='IMPRESORAS';
      section.style.cssText='color:#777;font:700 22px/1 "Bebas Neue",sans-serif;letter-spacing:1.5px;white-space:nowrap';
      target.appendChild(section);
      target.style.display='flex';
      target.style.alignItems='center';
      target.style.gap='18px';
      target.setAttribute(PATCHED,'1');
    }
  }

  const observer=new MutationObserver(patch);
  const start=()=>{patch();observer.observe(document.body,{childList:true,subtree:true});};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
