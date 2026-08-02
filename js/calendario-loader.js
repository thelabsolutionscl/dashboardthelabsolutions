/* Cargador de compatibilidad: calendario base + capa operacional avanzada. */
(function(){
  function load(src,next){
    const s=document.createElement('script');
    s.src=src;
    s.onload=()=>next&&next();
    s.onerror=()=>console.error('[Calendario] no se pudo cargar',src);
    document.head.appendChild(s);
  }
  load('js/calendario-base.js',()=>load('js/calendario-operaciones.js'));
})();
