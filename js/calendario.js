/* Cargador del calendario: conserva el módulo base y activa la planificación avanzada. */
(function(){
  function load(src,next){
    const s=document.createElement('script');
    s.src=src;
    s.onload=()=>next&&next();
    s.onerror=()=>console.error('[Dashboard] no se pudo cargar',src);
    document.head.appendChild(s);
  }
  load('js/calendario-base.js',()=>load('js/calendario-operaciones.js',()=>load('js/calendario-collapsible.js',()=>load('js/tv-logo-fix.js',()=>load('js/tv-control-center.js')))));
})();
