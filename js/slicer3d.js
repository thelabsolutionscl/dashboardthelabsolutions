/* js/slicer3d.js — módulo extraído de index.html (mismo orden de carga).
 * El deploy estampa la versión en el src del index para bustear la caché. */

// ── AGENTE DE IMPRESIÓN 3D — STL/OBJ → G-code con IA + slicer nativo ─────
// Flujo: cargar STL/OBJ → análisis geométrico local → Claude elige parámetros
// → laminado nativo en el navegador (sin dependencias) → descarga o envío Moonraker.
const SL3D=(function(){
  const SPECS={
    'K1':{x:220,y:220,z:250,vmax:300},
    'K2':{x:350,y:350,z:350,vmax:300},
    'K2 Plus':{x:500,y:500,z:500,vmax:300},
    'Ender-5 Max':{x:400,y:400,z:600,vmax:250},
    'Giga':{x:800,y:800,z:800,vmax:150},
  };
  const MATS={
    PLA:    {noz:210,bed:60, fan:100,dens:1.24},
    'PLA+': {noz:215,bed:65, fan:100,dens:1.24},
    PETG:   {noz:240,bed:80, fan:40, dens:1.27},
    ABS:    {noz:250,bed:100,fan:25, dens:1.04},
    ASA:    {noz:250,bed:100,fan:15, dens:1.07},
    TPU:    {noz:225,bed:50, fan:60, dens:1.21,vcap:35},
    'TPU-95A':{noz:230,bed:55,fan:50,dens:1.22,vcap:30},
    'ABS-CF':{noz:255,bed:105,fan:10,dens:1.09},
    'PETG-CF':{noz:245,bed:85,fan:30,dens:1.28},
    PA:     {noz:270,bed:90, fan:0,  dens:1.13,vcap:40},
    'PA-CF':{noz:275,bed:90, fan:0,  dens:1.22,vcap:40},
    PC:     {noz:280,bed:110,fan:0,  dens:1.20},
    HIPS:   {noz:240,bed:100,fan:25, dens:1.04},
    PVA:    {noz:215,bed:60, fan:50, dens:1.23,vcap:25},
  };
  const FIELDS=[
    {k:'layerHeight',l:'Altura capa (mm)',s:0.04},{k:'firstLayerHeight',l:'1ª capa (mm)',s:0.04},
    {k:'shells',l:'Perímetros',s:1},{k:'topLayers',l:'Capas sup.',s:1},{k:'bottomLayers',l:'Capas inf.',s:1},
    {k:'infillPct',l:'Relleno (%)',s:5},{k:'infillType',l:'Patrón',sel:['grid','gyroid','triangle','hex','honeycomb','cubic','concentric','lightning','adaptive','linear']},
    {k:'speed',l:'Velocidad (mm/s)',s:10},{k:'outerSpeed',l:'Vel. pared ext.',s:5},{k:'infillSpeed',l:'Vel. relleno',s:10},
    {k:'firstLayerSpeed',l:'Vel. 1ª capa',s:5},{k:'travelSpeed',l:'Vel. viaje',s:10},{k:'accel',l:'Aceleración (mm/s²)',s:500},
    {k:'accelOuter',l:'Accel pared ext. (0=auto)',s:500},{k:'accelInfill',l:'Accel relleno (0=auto)',s:500},{k:'jerk',l:'Jerk (mm/s, 0=off)',s:1},{k:'bridgeFlow',l:'Flujo puente (%)',s:5},
    {k:'nozzleTemp',l:'Boquilla (°C)',s:5},{k:'bedTemp',l:'Cama (°C)',s:5},{k:'fanPct',l:'Ventilador (%)',s:10},
    {k:'supports',l:'Soportes',sel:['no','sí']},{k:'treeSupports',l:'Soporte árbol',sel:['no','sí']},{k:'supportAngle',l:'Áng. soporte (°)',s:5},
    {k:'supGrid',l:'Soporte: rejilla (mm)',s:0.5},{k:'supZGap',l:'Soporte: sep. Z (mm)',s:0.05},{k:'supDensity',l:'Soporte: densidad (%)',s:5},
    {k:'supInterface',l:'Soporte: interfaz (capas)',s:1},{k:'supOnPlate',l:'Soporte solo desde cama',sel:['no','sí']},
    {k:'infillOverlap',l:'Solape relleno/pared (%)',s:5},{k:'pauseAtZ',l:'Pausa a Z (mm, 0=off)',s:1},
    {k:'adaptiveLayerHeight',l:'Capa adaptativa',sel:['no','sí']},
    {k:'minLayerTime',l:'Tiempo mín. capa (s)',s:1},{k:'overhangSpeed',l:'Vel. voladizo (mm/s)',s:5},
    {k:'flowRatio',l:'Flujo (%)',s:1},{k:'pressureAdvance',l:'Pressure Advance',s:0.005},{k:'wipeDist',l:'Wipe (mm)',s:0.2},
    {k:'widthOuter',l:'Ancho pared ext. (mm)',s:0.02},{k:'widthInfill',l:'Ancho relleno (mm)',s:0.02},
    {k:'seamMode',l:'Costura',sel:['cercano','alineado','agudo','aleatorio']},{k:'outerWallLast',l:'Pared ext. al final',sel:['no','sí']},
    {k:'seamScarf',l:'Costura scarf (oculta)',sel:['no','sí']},{k:'scarfLen',l:'Scarf: largo (mm)',s:0.5},
    {k:'bridgeDetect',l:'Detectar puentes',sel:['no','sí']},{k:'arcFitting',l:'Arcos G2/G3',sel:['no','sí']},{k:'gradualTemp',l:'Temp. gradual',sel:['no','sí']},
    {k:'excludeObject',l:'Exclude Object (Klipper)',sel:['no','sí']},{k:'sequential',l:'Impresión secuencial',sel:['no','sí']},
    {k:'gapFill',l:'Relleno de huecos',sel:['no','sí']},{k:'fuzzySkin',l:'Piel rugosa (mm)',s:0.05},{k:'coasting',l:'Coasting (mm)',s:0.1},
    {k:'fuzzyAll',l:'Piel rugosa: todas paredes',sel:['no','sí']},{k:'fuzzyPointDist',l:'Piel rugosa: paso (mm)',s:0.1},{k:'draftShield',l:'Pantalla anti-corriente',sel:['no','sí']},
    {k:'spiralize',l:'Modo jarrón',sel:['no','sí']},{k:'monotonic',l:'Relleno monot.',sel:['no','sí']},{k:'arachne',l:'Arachne (pared var.)',sel:['no','sí']},
    {k:'elephantFoot',l:'Pie de elefante (mm)',s:0.05},{k:'xyCompensation',l:'Compensación XY (mm)',s:0.02},
    {k:'skirt',l:'Skirt (líneas)',s:1},{k:'skirtGap',l:'Skirt sep. (mm)',s:0.5},
    {k:'brim',l:'Brim (líneas)',s:1},{k:'brimGap',l:'Brim: separación (mm)',s:0.05},{k:'raft',l:'Raft',sel:['no','sí']},
    {k:'ironing',l:'Planchado',sel:['no','sí']},{k:'ironingFlow',l:'Planchado: flujo (%)',s:1},{k:'retractMinTravel',l:'Retrac. mín. viaje (mm)',s:0.2},
    {k:'retractDist',l:'Retracción (mm)',s:0.1},{k:'retractSpeed',l:'Vel. retrac.',s:5},{k:'zHop',l:'Z-hop (mm)',s:0.1},
  ];
  const S={tris:null,objects:[],prev:null,stats:null,name:'',params:null,gcode:'',rot:{a:0.7,b:-1.1},enginePromise:null,drag:null,modifiers:[],supRegions:[],layFlatMode:false,showSupports:false,supSticks:null,objSettings:null};
  const el=id=>document.getElementById(id);

  // ── Parsers ─────────────────────────────────────────────────
  function parseSTL(buf){
    const head=new TextDecoder().decode(buf.slice(0,Math.min(600,buf.byteLength)));
    if(/^\s*solid[\s\S]*?facet/i.test(head)){
      const txt=new TextDecoder().decode(buf);
      const re=/vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;const v=[];let m;
      while((m=re.exec(txt)))v.push(+m[1],+m[2],+m[3]);
      const n=Math.floor(v.length/9)*9;
      if(!n)throw new Error('STL ASCII sin triángulos');
      return new Float32Array(v.slice(0,n));
    }
    if(buf.byteLength<84)throw new Error('STL inválido (muy corto)');
    const dv=new DataView(buf);
    const n=Math.min(dv.getUint32(80,true),Math.floor((buf.byteLength-84)/50));
    if(!n)throw new Error('STL binario sin triángulos');
    const out=new Float32Array(n*9);let o=84;
    for(let i=0;i<n;i++){o+=12;for(let j=0;j<9;j++){out[i*9+j]=dv.getFloat32(o,true);o+=4;}o+=2;}
    return out;
  }
  function parseOBJ(txt){
    const vs=[],out=[];
    for(const line of txt.split('\n')){
      if(line[0]==='v'&&line[1]===' '){const p=line.trim().split(/\s+/);vs.push(+p[1],+p[2],+p[3]);}
      else if(line[0]==='f'&&line[1]===' '){
        const idx=line.trim().split(/\s+/).slice(1).map(t=>{let i=parseInt(t.split('/')[0],10);if(i<0)i=vs.length/3+i+1;return i-1;});
        for(let i=1;i<idx.length-1;i++)for(const k of[idx[0],idx[i],idx[i+1]])out.push(vs[k*3],vs[k*3+1],vs[k*3+2]);
      }
    }
    if(!out.length)throw new Error('OBJ sin caras');
    return new Float32Array(out);
  }
  // 3MF = ZIP con 3D/3dmodel.model (XML). Descomprime con DecompressionStream (sin librerías).
  async function parse3MF(buf){
    const dv=new DataView(buf),u8=new Uint8Array(buf);
    // Buscar End Of Central Directory (firma 0x06054b50) desde el final
    let eocd=-1;for(let i=buf.byteLength-22;i>=0;i--){if(dv.getUint32(i,true)===0x06054b50){eocd=i;break;}}
    if(eocd<0)throw new Error('3MF inválido (no es ZIP)');
    const cdOff=dv.getUint32(eocd+16,true),cdCount=dv.getUint16(eocd+10,true);
    let p=cdOff,modelEntry=null;
    for(let e=0;e<cdCount&&p<buf.byteLength;e++){
      if(dv.getUint32(p,true)!==0x02014b50)break;
      const method=dv.getUint16(p+10,true),compSize=dv.getUint32(p+20,true),nameLen=dv.getUint16(p+28,true),extraLen=dv.getUint16(p+30,true),commLen=dv.getUint16(p+32,true),lho=dv.getUint32(p+42,true);
      const name=new TextDecoder().decode(u8.subarray(p+46,p+46+nameLen));
      if(/\.model$/i.test(name)){modelEntry={method,compSize,lho};}
      p+=46+nameLen+extraLen+commLen;
    }
    if(!modelEntry)throw new Error('3MF sin modelo .model');
    // Cabecera local para saltar al dato comprimido
    const lh=modelEntry.lho,lnameLen=dv.getUint16(lh+26,true),lextraLen=dv.getUint16(lh+28,true),dataStart=lh+30+lnameLen+lextraLen;
    const comp=u8.subarray(dataStart,dataStart+modelEntry.compSize);
    let xml;
    if(modelEntry.method===0){xml=new TextDecoder().decode(comp);}
    else{
      const ds=new DecompressionStream('deflate-raw');
      const ab=await new Response(new Blob([comp]).stream().pipeThrough(ds)).arrayBuffer();
      xml=new TextDecoder().decode(ab);
    }
    // Parsear vértices y triángulos del XML
    const vs=[],vre=/<vertex\s+x="([-\d.eE+]+)"\s+y="([-\d.eE+]+)"\s+z="([-\d.eE+]+)"/g;let m;
    while((m=vre.exec(xml)))vs.push(+m[1],+m[2],+m[3]);
    const out=[],tre=/<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g;
    while((m=tre.exec(xml))){const a=+m[1],b=+m[2],c=+m[3];for(const k of[a,b,c])out.push(vs[k*3],vs[k*3+1],vs[k*3+2]);}
    if(!out.length)throw new Error('3MF sin geometría');
    return new Float32Array(out);
  }

  // ── Análisis geométrico ─────────────────────────────────────
  function analyze(t){
    let mnx=1e9,mny=1e9,mnz=1e9,mxx=-1e9,mxy=-1e9,mxz=-1e9;
    for(let i=0;i<t.length;i+=3){const x=t[i],y=t[i+1],z=t[i+2];
      if(x<mnx)mnx=x;if(x>mxx)mxx=x;if(y<mny)mny=y;if(y>mxy)mxy=y;if(z<mnz)mnz=z;if(z>mxz)mxz=z;}
    // centrar XY en 0 y apoyar en Z=0 (sistema interno de Kiri:Moto)
    const cx=(mnx+mxx)/2,cy=(mny+mxy)/2;
    for(let i=0;i<t.length;i+=3){t[i]-=cx;t[i+1]-=cy;t[i+2]-=mnz;}
    const dx=mxx-mnx,dy=mxy-mny,dz=mxz-mnz;
    let vol=0,area=0,ovArea=0;
    for(let i=0;i<t.length;i+=9){
      const ax=t[i],ay=t[i+1],az=t[i+2],bx=t[i+3],by=t[i+4],bz=t[i+5],cxx=t[i+6],cyy=t[i+7],cz=t[i+8];
      const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cxx-ax,vy=cyy-ay,vz=cz-az;
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
      const ln=Math.sqrt(nx*nx+ny*ny+nz*nz),a2=ln/2;
      area+=a2;
      vol+=(ax*(by*cz-bz*cyy)+bx*(cyy*az-cz*ay)+cxx*(ay*bz-az*by))/6;
      // voladizo: cara hacia abajo >55° de la vertical, no apoyada en cama
      if(ln>0&&nz/ln<-0.57&&Math.min(az,bz,cz)>0.5)ovArea+=a2;
    }
    vol=Math.abs(vol);
    S.stats={dx,dy,dz,vol:vol/1000,area:area/100,tris:t.length/9,
      ovPct:area?ovArea/area*100:0,hr:dz/Math.max(5,Math.min(dx,dy))};
    S.bounds={dx,dy,dz};
  }

  // ── Preview 3D (canvas, sin librerías) ──────────────────────
  function buildPreview(){
    const n=S.tris.length/9,cap=12000;
    if(n<=cap){S.prev=S.tris;return;}
    const stride=Math.ceil(n/cap),out=new Float32Array(Math.ceil(n/stride)*9);let o=0;
    for(let i=0;i<n;i+=stride){out.set(S.tris.subarray(i*9,i*9+9),o);o+=9;}
    S.prev=out;
  }
  // Z donde la vertical (x,y) cruza el triángulo o → null si fuera del triángulo
  function _triZatXY(t,o,x,y){
    const ax=t[o],ay=t[o+1],az=t[o+2],bx=t[o+3],by=t[o+4],bz=t[o+5],cx=t[o+6],cy=t[o+7],cz=t[o+8];
    const d=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(d)<1e-9)return null;
    const wa=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/d,wb=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/d,wc=1-wa-wb;
    if(wa<-0.001||wb<-0.001||wc<-0.001)return null;
    return wa*az+wb*bz+wc*cz;
  }
  // Columnas de soporte aproximadas: bajo cada voladizo, palito vertical hasta el modelo de abajo o la cama.
  // Se calcula una vez (cacheado en S.supSticks) y se reproyecta en cada frame.
  function _computeSupportSticks(){
    if(!S.tris){S.supSticks=[];return;}
    // En mallas enormes usa la versión decimada para no congelar la UI (raycast O(reps×triángulos))
    const t=(S.tris.length/9>60000&&S.prev)?S.prev:S.tris,m=t.length/9;
    const ovAng=S.params?-(Math.cos((90-(S.params.supportAngle||50))*Math.PI/180)):-0.57;
    const thr=ovAng<-0.2?ovAng:-0.57,GS=4,buckets=new Map();
    for(let i=0;i<m;i++){
      const o=i*9;
      const ax=t[o],ay=t[o+1],az=t[o+2],bx=t[o+3],by=t[o+4],bz=t[o+5],cx=t[o+6],cy=t[o+7],cz=t[o+8];
      const Ux=bx-ax,Uy=by-ay,Uz=bz-az,Vx=cx-ax,Vy=cy-ay,Vz=cz-az;
      const Nx=Uy*Vz-Uz*Vy,Ny=Uz*Vx-Ux*Vz,Nz=Ux*Vy-Uy*Vx,Nl=Math.hypot(Nx,Ny,Nz)||1;
      if(Nz/Nl>=thr)continue;                 // no es voladizo
      const gx=(ax+bx+cx)/3,gy=(ay+by+cy)/3,gz=(az+bz+cz)/3;
      if(gz<=0.6)continue;                     // apoyado en la cama
      const key=Math.round(gx/GS)+'_'+Math.round(gy/GS);
      const ex=buckets.get(key);
      if(!ex||gz<ex.gz)buckets.set(key,{gx,gy,gz});   // el voladizo más bajo de la columna
    }
    const reps=[...buckets.values()],sticks=[];
    for(const r of reps){
      let below=0;                             // busca la superficie más alta estrictamente debajo
      for(let k=0;k<m;k++){const zk=_triZatXY(t,k*9,r.gx,r.gy);if(zk!==null&&zk<r.gz-0.4&&zk>below)below=zk;}
      sticks.push([r.gx,r.gy,r.gz,below]);
    }
    S.supSticks=sticks;
  }
  // Normales por vértice con detección de pliegues: promedia las caras que comparten vértice
  // SÓLO si su ángulo es suave (curva) → superficies curvas suaves, pero bordes duros (cubo) nítidos.
  function _computeVertexNormals(t){
    const m=t.length/9,fN=new Float32Array(m*3);
    for(let i=0;i<m;i++){const o=i*9;const ux=t[o+3]-t[o],uy=t[o+4]-t[o+1],uz=t[o+5]-t[o+2],vx=t[o+6]-t[o],vy=t[o+7]-t[o+1],vz=t[o+8]-t[o+2];fN[i*3]=uy*vz-uz*vy;fN[i*3+1]=uz*vx-ux*vz;fN[i*3+2]=ux*vy-uy*vx;}
    const map=new Map(),EPS=1e-3,key=(x,y,z)=>Math.round(x/EPS)+'_'+Math.round(y/EPS)+'_'+Math.round(z/EPS);
    for(let i=0;i<m;i++){const o=i*9;for(let j=0;j<3;j++){const k=key(t[o+j*3],t[o+j*3+1],t[o+j*3+2]);(map.get(k)||map.set(k,[]).get(k)).push(i);}}
    const out=new Float32Array(t.length),COS=0.5; // pliegue ~60°: caras a más de 60° = borde duro
    for(let i=0;i<m;i++){const o=i*9;const fx=fN[i*3],fy=fN[i*3+1],fz=fN[i*3+2],fl=Math.hypot(fx,fy,fz)||1;
      for(let j=0;j<3;j++){const inc=map.get(key(t[o+j*3],t[o+j*3+1],t[o+j*3+2]))||[i];let nx=0,ny=0,nz=0;
        for(const ti of inc){const gx=fN[ti*3],gy=fN[ti*3+1],gz=fN[ti*3+2],gl=Math.hypot(gx,gy,gz)||1;if((fx*gx+fy*gy+fz*gz)/(fl*gl)>=COS){nx+=gx;ny+=gy;nz+=gz;}}
        const l=Math.hypot(nx,ny,nz)||1;out[o+j*3]=nx/l;out[o+j*3+1]=ny/l;out[o+j*3+2]=nz/l;}}
    return out;
  }
  function render(){
    const cv=el('slCanvas');if(!S.prev||cv.style.display==='none')return;
    const dpr=window.devicePixelRatio||1,w=cv.clientWidth||420,h=300;
    cv.width=w*dpr;cv.height=h*dpr;
    const ctx=cv.getContext('2d');ctx.scale(dpr,dpr);
    // Fondo con degradado suave (estudio) en vez de negro plano
    {const bg=ctx.createLinearGradient(0,0,0,h);bg.addColorStop(0,'#1b1e22');bg.addColorStop(0.55,'#121417');bg.addColorStop(1,'#0a0b0d');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);}
    const st=S.stats,zm=st.dz/2,ca=Math.cos(S.rot.a),sa=Math.sin(S.rot.a),cb=Math.cos(S.rot.b),sb=Math.sin(S.rot.b);
    const rad=Math.sqrt(st.dx*st.dx+st.dy*st.dy+st.dz*st.dz)/2||1,sc=0.42*Math.min(w,h)/rad;
    // ── Cama de impresión (plano Z=0) + eje Z: deja claro cuál es la base ──
    const proj=(x,y,z)=>{const zz=z-zm;const x1=x*ca-y*sa,y1=x*sa+y*ca;const y2=y1*cb-zz*sb,z2=y1*sb+zz*cb;return[w/2+x1*sc,h/2-z2*sc];};
    (function drawBed(){
      const ext=Math.max(st.dx,st.dy)*0.72+6,n=8,step=ext*2/n;
      ctx.lineWidth=1;
      for(let i=0;i<=n;i++){
        const c=-ext+i*step,mid=(i===n/2);
        ctx.strokeStyle=mid?'rgba(0,212,204,0.45)':'rgba(255,255,255,0.09)';
        let a=proj(c,-ext,0),b=proj(c,ext,0);
        ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();
        let d=proj(-ext,c,0),e=proj(ext,c,0);
        ctx.beginPath();ctx.moveTo(d[0],d[1]);ctx.lineTo(e[0],e[1]);ctx.stroke();
      }
      const z0=proj(0,0,0),z1=proj(0,0,st.dz*0.6+4);
      ctx.strokeStyle='rgba(0,212,204,0.55)';ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(z0[0],z0[1]);ctx.lineTo(z1[0],z1[1]);ctx.stroke();
      ctx.fillStyle='rgba(0,212,204,0.9)';ctx.font='10px JetBrains Mono,monospace';
      ctx.fillText('Z↑',z1[0]+3,z1[1]+3);
    })();
    // Sombra de contacto blanda bajo la pieza (asienta el modelo en la cama)
    {const base=proj(0,0,0),rsh=Math.max(st.dx,st.dy)*0.55*sc+5;ctx.save();ctx.translate(base[0],base[1]);ctx.scale(1,Math.abs(sb)*0.5+0.16);const rg=ctx.createRadialGradient(0,0,0,0,0,rsh);rg.addColorStop(0,'rgba(0,0,0,0.42)');rg.addColorStop(0.7,'rgba(0,0,0,0.18)');rg.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=rg;ctx.beginPath();ctx.arc(0,0,rsh,0,6.283);ctx.fill();ctx.restore();}
    const t=S.prev,m=t.length/9,list=new Array(m);
    if(S._prevNfor!==t){S.prevN=_computeVertexNormals(t);S._prevNfor=t;} // normales suaves cacheadas por malla
    const VN=S.prevN;
    const ovAng=S.params?-(Math.cos((90-(S.params.supportAngle||50))*Math.PI/180)):-0.57; // criterio según ángulo
    for(let i=0;i<m;i++){
      const o=i*9,P=[];let dsum=0;
      // normal en espacio-modelo → para detectar voladizo (cara hacia abajo no apoyada en la cama)
      const ax=t[o],ay=t[o+1],az=t[o+2],bx=t[o+3],by=t[o+4],bz=t[o+5],cx2=t[o+6],cy2=t[o+7],cz2=t[o+8];
      const Ux=bx-ax,Uy=by-ay,Uz=bz-az,Vx=cx2-ax,Vy=cy2-ay,Vz=cz2-az;
      const Nx=Uy*Vz-Uz*Vy,Ny=Uz*Vx-Ux*Vz,Nz=Ux*Vy-Uy*Vx,Nl=Math.hypot(Nx,Ny,Nz)||1;
      const over=S.showSupports&&(Nz/Nl< (ovAng<-0.2?ovAng:-0.57))&&Math.min(az,bz,cz2)>0.5;
      let diff=0,spec=0;
      for(let j=0;j<3;j++){
        const x=t[o+j*3],y=t[o+j*3+1],z=t[o+j*3+2]-zm;
        const x1=x*ca-y*sa,y1=x*sa+y*ca;
        const y2=y1*cb-z*sb,z2=y1*sb+z*cb;
        P.push(w/2+x1*sc,h/2-z2*sc);dsum+=y2;
        // Normal SUAVE del vértice, rotada igual que el vértice → sombreado tipo Gouraud
        const vnx=VN[o+j*3],vny=VN[o+j*3+1],vnz=VN[o+j*3+2];
        const r1=vnx*ca-vny*sa,r2=vnx*sa+vny*ca,rD=r2*cb-vnz*sb,rU=r2*sb+vnz*cb;
        const d1=Math.max(0,r1*-0.398+rD*-0.498+rU*0.747); // luz principal (arriba-izq-frente)
        const d2=Math.max(0,r1*0.707+rD*0.566+rU*0.424);   // luz de relleno (abajo-der, suave)
        diff+=0.30+0.66*d1+0.18*d2+0.10*Math.abs(rD);      // ambiental + principal + relleno + luz de cabeza
        const hsp=Math.abs(r1*-0.233+rD*-0.876+rU*0.437);  // half-vector → brillo especular
        spec+=Math.pow(hsp,22);
      }
      diff=Math.min(1,diff/3);spec=spec/3*0.5;
      list[i]={d:dsum,P,diff,spec,over};
    }
    list.sort((p,q)=>q.d-p.d);
    for(const f of list){
      ctx.beginPath();ctx.moveTo(f.P[0],f.P[1]);ctx.lineTo(f.P[2],f.P[3]);ctx.lineTo(f.P[4],f.P[5]);ctx.closePath();
      const sp=Math.round(f.spec*255);
      // Voladizos en naranja (necesitan soporte); resto en teal · brillo especular sumado en blanco
      const col=f.over
        ?`rgb(${Math.min(255,Math.round(236*f.diff)+sp)},${Math.min(255,Math.round(128*f.diff)+sp)},${Math.min(255,Math.round(52*f.diff)+sp)})`
        :`rgb(${Math.min(255,Math.round(70*f.diff)+sp)},${Math.min(255,Math.round(200*f.diff)+sp)},${Math.min(255,Math.round(190*f.diff)+sp)})`;
      ctx.fillStyle=col;ctx.fill();
      ctx.strokeStyle=col;ctx.lineWidth=1;ctx.lineJoin='round';ctx.stroke(); // tapa costuras → superficie continua
    }
    // ── Columnas de soporte (palitos verticales bajo los voladizos) ──
    if(S.showSupports){
      if(!S.supSticks)_computeSupportSticks();
      ctx.strokeStyle='rgba(255,150,40,0.85)';ctx.lineWidth=1.4;
      for(const s of S.supSticks){
        const a=proj(s[0],s[1],s[3]),b=proj(s[0],s[1],s[2]);
        ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();
        ctx.fillStyle='rgba(255,170,60,0.9)';ctx.beginPath();ctx.arc(b[0],b[1],1.8,0,6.283);ctx.fill();
      }
    }
    ctx.fillStyle='rgba(255,255,255,0.35)';ctx.font='10px JetBrains Mono,monospace';
    ctx.fillText(S.layFlatMode?'haz clic en una cara para apoyarla en la cama':(S.showSupports?`soportes: ${S.supSticks?S.supSticks.length:0} columnas · naranja = voladizos`:'arrastra para rotar · la rejilla es la cama'),10,h-10);
  }

  // ── Auto-orientación: prueba orientaciones y elige la de menos voladizos ──
  function _rotTris(tris,rx,ry){
    const ca=Math.cos(rx),sa=Math.sin(rx),cb=Math.cos(ry),sb=Math.sin(ry),out=new Float32Array(tris.length);
    for(let i=0;i<tris.length;i+=3){
      const x=tris[i],y=tris[i+1],z=tris[i+2];
      const y1=y*ca-z*sa,z1=y*sa+z*ca;
      out[i]=x*cb+z1*sb;out[i+1]=y1;out[i+2]=-x*sb+z1*cb;
    }
    return out;
  }
  function _overhangMetric(tris){
    let mnz=1e9,mxz=-1e9;for(let i=2;i<tris.length;i+=3){if(tris[i]<mnz)mnz=tris[i];if(tris[i]>mxz)mxz=tris[i];}
    let ov=0,area=0;
    for(let i=0;i<tris.length;i+=9){
      const ax=tris[i],ay=tris[i+1],az=tris[i+2],bx=tris[i+3],by=tris[i+4],bz=tris[i+5],cxx=tris[i+6],cyy=tris[i+7],cz=tris[i+8];
      const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cxx-ax,vy=cyy-ay,vz=cz-az;
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,ln=Math.sqrt(nx*nx+ny*ny+nz*nz),a2=ln/2;area+=a2;
      if(ln>0&&nz/ln<-0.5&&Math.min(az,bz,cz)-mnz>0.5)ov+=a2;
    }
    return{ov,area,h:mxz-mnz};
  }
  function autoOrient(){
    if(!S.tris){toast('Carga un modelo primero','error');return;}
    const cands=[[0,0],[Math.PI,0],[Math.PI/2,0],[-Math.PI/2,0],[0,Math.PI/2],[0,-Math.PI/2]];
    let best=S.tris,bestScore=1e18,bestI=0;
    cands.forEach(([rx,ry],i)=>{const tt=_rotTris(S.tris,rx,ry);const m=_overhangMetric(tt);const score=(m.area?m.ov/m.area:0)*100+m.h*0.02;if(score<bestScore){bestScore=score;best=tt;bestI=i;}});
    S.tris=best;S.objBBs=null;analyze(S.tris);buildPreview();S.supSticks=null;render();renderStats();
    S.params=null;S.gcode='';S.modifiers=[];S.supRegions=[];el('slParamsWrap').style.display='none';el('slRazon').style.display='none';el('slResult').style.display='none';
    toast(bestI===0?`Ya estaba en la mejor orientación (voladizos ${S.stats.ovPct.toFixed(1)}%)`:`Re-orientado: voladizos ahora ${S.stats.ovPct.toFixed(1)}%`,'success');
  }
  // ── Apoyar cara en la cama (lay-flat por clic) ──────────────
  // Rota toda la malla para que la normal `n` apunte hacia abajo (−Z) → esa cara queda sobre la cama.
  function _alignTris(t,n){
    let nx=n[0],ny=n[1],nz=n[2];const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;
    // eje de giro = n × (0,0,−1) = (−ny, nx, 0) ; dot = n·(0,0,−1) = −nz
    let ax=-ny,ay=nx,az=0;
    const al=Math.hypot(ax,ay,az),dot=-nz;
    const o=new Float32Array(t.length);
    if(al<1e-6){
      if(dot>0)return t.slice();           // ya mira hacia abajo
      for(let i=0;i<t.length;i+=3){o[i]=t[i];o[i+1]=-t[i+1];o[i+2]=-t[i+2];}// antiparalela: girar 180° en X
      return o;
    }
    ax/=al;ay/=al;az/=al;
    const ang=Math.atan2(al,dot),c=Math.cos(ang),s=Math.sin(ang),C=1-c;
    const r00=c+ax*ax*C,r01=ax*ay*C-az*s,r02=ax*az*C+ay*s;
    const r10=ay*ax*C+az*s,r11=c+ay*ay*C,r12=ay*az*C-ax*s;
    const r20=az*ax*C-ay*s,r21=az*ay*C+ax*s,r22=c+az*az*C;
    for(let i=0;i<t.length;i+=3){const x=t[i],y=t[i+1],z=t[i+2];o[i]=r00*x+r01*y+r02*z;o[i+1]=r10*x+r11*y+r12*z;o[i+2]=r20*x+r21*y+r22*z;}
    return o;
  }
  function _pointInTri2(px,py,ax,ay,bx,by,cx,cy){
    const d1=(px-bx)*(ay-by)-(ax-bx)*(py-by);
    const d2=(px-cx)*(by-cy)-(bx-cx)*(py-cy);
    const d3=(px-ax)*(cy-ay)-(cx-ax)*(py-ay);
    const neg=(d1<0)||(d2<0)||(d3<0),pos=(d1>0)||(d2>0)||(d3>0);
    return!(neg&&pos);
  }
  // Raycast 2D sobre el visor: encuentra la cara frontal bajo el cursor y la apoya en la cama.
  function _layFlatAt(px,py){
    if(!S.tris||!S.stats)return;
    const cv=el('slCanvas'),w=cv.clientWidth||420,h=300;
    const st=S.stats,zm=st.dz/2,ca=Math.cos(S.rot.a),sa=Math.sin(S.rot.a),cb=Math.cos(S.rot.b),sb=Math.sin(S.rot.b);
    const rad=Math.sqrt(st.dx*st.dx+st.dy*st.dy+st.dz*st.dz)/2||1,sc=0.42*Math.min(w,h)/rad;
    const t=S.tris,m=t.length/9;let bestD=1e18,bestN=null;
    for(let i=0;i<m;i++){
      const o=i*9,P=[];let d=0;
      for(let j=0;j<3;j++){
        const x=t[o+j*3],y=t[o+j*3+1],z=t[o+j*3+2]-zm;
        const x1=x*ca-y*sa,y1=x*sa+y*ca;
        const y2=y1*cb-z*sb,z2=y1*sb+z*cb;
        P.push(w/2+x1*sc,h/2-z2*sc);d+=y2;
      }
      if(!_pointInTri2(px,py,P[0],P[1],P[2],P[3],P[4],P[5]))continue;
      if(d<bestD){// menor profundidad = cara frontal (la que el usuario ve)
        bestD=d;
        const ax=t[o],ay=t[o+1],az=t[o+2],bx=t[o+3],by=t[o+4],bz=t[o+5],cx2=t[o+6],cy2=t[o+7],cz2=t[o+8];
        const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx2-ax,vy=cy2-ay,vz=cz2-az;
        bestN=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx];
      }
    }
    if(!bestN){toast('No se detectó cara ahí — haz clic sobre la figura','error');return;}
    S.tris=_alignTris(S.tris,bestN);S.objBBs=null;
    analyze(S.tris);buildPreview();S.supSticks=null;
    S.params=null;S.gcode='';S.modifiers=[];S.supRegions=[];
    el('slParamsWrap').style.display='none';el('slRazon').style.display='none';el('slResult').style.display='none';
    renderModifiers();renderSupRegions();renderObjSettings();
    S.layFlatMode=false;_updLayFlatBtn();
    render();renderStats();
    toast(`✓ Cara apoyada en la cama (voladizos ${S.stats.ovPct.toFixed(1)}%) — revisa parámetros y vuelve a generar`,'success');
  }
  function _updLayFlatBtn(){
    const b=el('slLayFlatBtn'),cv=el('slCanvas');if(!b)return;
    if(S.layFlatMode){b.classList.add('btn-primary');b.classList.remove('btn-ghost');b.textContent='📐 Clic en una cara…';if(cv)cv.style.cursor='crosshair';}
    else{b.classList.remove('btn-primary');b.classList.add('btn-ghost');b.textContent='📐 Apoyar cara';if(cv)cv.style.cursor='grab';}
  }
  function toggleLayFlat(){
    if(!S.tris){toast('Carga un modelo primero','error');return;}
    S.layFlatMode=!S.layFlatMode;_updLayFlatBtn();render();
    if(S.layFlatMode)toast('Haz clic en la cara que quieres apoyar en la cama','success');
  }
  // Vista previa de soportes: pinta de naranja las caras con voladizo (las que necesitarán soporte)
  function toggleSupportPreview(){
    if(!S.tris){toast('Carga un modelo primero','error');return;}
    S.showSupports=!S.showSupports;
    const b=el('slSupPrevBtn');
    if(b){if(S.showSupports){b.classList.add('btn-primary');b.classList.remove('btn-ghost');}else{b.classList.remove('btn-primary');b.classList.add('btn-ghost');}}
    render();
    if(S.showSupports)toast(`Voladizos en naranja${S.stats?` — ${S.stats.ovPct.toFixed(1)}% del área`:''}`,'success');
  }
  // ── Plating multi-objeto: centra cada pieza y las acomoda en rejilla ──
  function _centerTris(t){
    let mnx=1e9,mny=1e9,mnz=1e9,mxx=-1e9,mxy=-1e9;
    for(let i=0;i<t.length;i+=3){if(t[i]<mnx)mnx=t[i];if(t[i]>mxx)mxx=t[i];if(t[i+1]<mny)mny=t[i+1];if(t[i+1]>mxy)mxy=t[i+1];if(t[i+2]<mnz)mnz=t[i+2];}
    const cx=(mnx+mxx)/2,cy=(mny+mxy)/2,o=new Float32Array(t.length);
    for(let i=0;i<t.length;i+=3){o[i]=t[i]-cx;o[i+1]=t[i+1]-cy;o[i+2]=t[i+2]-mnz;}
    return o;
  }
  function _plate(objs){
    const items=objs.map(t=>{let mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;for(let i=0;i<t.length;i+=3){if(t[i]<mnx)mnx=t[i];if(t[i]>mxx)mxx=t[i];if(t[i+1]<mny)mny=t[i+1];if(t[i+1]>mxy)mxy=t[i+1];}return{t,w:mxx-mnx,d:mxy-mny};});
    const GAP=6,bedW=Math.max(...items.map(it=>it.w))+ Math.sqrt(items.length)*60;
    items.sort((a,b)=>b.d-a.d);
    let curX=0,curY=0,rowH=0;const placed=[];
    for(const it of items){if(curX>0&&curX+it.w>bedW){curX=0;curY+=rowH+GAP;rowH=0;}placed.push({t:it.t,ox:curX+it.w/2,oy:curY+it.d/2,w:it.w,d:it.d});curX+=it.w+GAP;rowH=Math.max(rowH,it.d);}
    // Cajas por objeto en coords centradas (= como queda la malla tras analyze) → para EXCLUDE_OBJECT
    let MX0=1e9,MY0=1e9,MX1=-1e9,MY1=-1e9;
    for(const pl of placed){MX0=Math.min(MX0,pl.ox-pl.w/2);MX1=Math.max(MX1,pl.ox+pl.w/2);MY0=Math.min(MY0,pl.oy-pl.d/2);MY1=Math.max(MY1,pl.oy+pl.d/2);}
    const ccx=(MX0+MX1)/2,ccy=(MY0+MY1)/2;
    S._plateBBs=placed.map((pl,i)=>({name:'obj_'+(i+1),x0:pl.ox-pl.w/2-ccx,y0:pl.oy-pl.d/2-ccy,x1:pl.ox+pl.w/2-ccx,y1:pl.oy+pl.d/2-ccy}));
    let len=0;for(const t of objs)len+=t.length;const out=new Float32Array(len);let o=0;
    for(const pl of placed){const t=pl.t;for(let i=0;i<t.length;i+=3){out[o++]=t[i]+pl.ox;out[o++]=t[i+1]+pl.oy;out[o++]=t[i+2];}}
    return out;
  }
  function _replate(){
    S.tris=S.objects.length>1?_plate(S.objects):S.objects[0];
    S.objBBs=S.objects.length>1?S._plateBBs:null; // EXCLUDE_OBJECT sólo con 2+ piezas
    S.objSettings=S.objects.length>1?(S._plateBBs||[]).map((_,i)=>(S.objSettings&&S.objSettings[i])||{}):null; // ajustes por pieza
    analyze(S.tris);buildPreview();
    const fn=el('slFileName');fn.style.display='block';fn.textContent=S.objects.length>1?`✓ ${S.objects.length} piezas en el plato`:'✓ '+S.name;
    el('slCanvas').style.display='block';render();renderStats();
    el('slBtnIA').disabled=false;el('slBtnBase').disabled=false;
    el('slParamsWrap').style.display='none';el('slRazon').style.display='none';el('slResult').style.display='none';
    S.params=null;S.gcode='';
  }
  // ── Reparación de malla: descarta triángulos inválidos (NaN/Inf) y degenerados (área ~0),
  //    suelda vértices casi-coincidentes a una rejilla fina (cierra micro-huecos de ruido de coma flotante).
  //    Conservadora: una malla sana pasa intacta. Devuelve {tris, removed, welded}.
  function _repairMesh(t){
    if(!t||!t.length)return{tris:t,removed:0,welded:0};
    const triCnt=t.length/9,out=new Float32Array(t.length);
    // Rejilla de soldadura: 1µm — por debajo de la resolución de impresión, no altera la geometría real
    const SNAP=0.001,snap=v=>Math.round(v/SNAP)*SNAP;
    let o=0,removed=0,welded=0;
    for(let i=0;i<triCnt;i++){
      const b=i*9;
      let ok=true;for(let j=0;j<9;j++){if(!isFinite(t[b+j])){ok=false;break;}}
      if(!ok){removed++;continue;}
      // Soldadura a rejilla
      const v=[];for(let j=0;j<9;j++){const s=snap(t[b+j]);if(s!==t[b+j])welded++;v.push(s);}
      // Descarta degenerados: dos vértices iguales o área ~0 (colineales)
      const ux=v[3]-v[0],uy=v[4]-v[1],uz=v[5]-v[2],vx=v[6]-v[0],vy=v[7]-v[1],vz=v[8]-v[2];
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
      if(Math.sqrt(nx*nx+ny*ny+nz*nz)/2<1e-7){removed++;continue;}
      for(let j=0;j<9;j++)out[o++]=v[j];
    }
    return{tris:out.subarray(0,o),removed,welded:Math.round(welded/3)};
  }
  async function _parseFile(file){
    const ext=(file.name.split('.').pop()||'').toLowerCase();
    const buf=await file.arrayBuffer();
    if(ext==='obj')return parseOBJ(new TextDecoder().decode(buf));
    if(ext==='3mf')return await parse3MF(buf);
    return parseSTL(buf);
  }
  async function loadFiles(fileList){
    const files=Array.from(fileList||[]).filter(f=>/\.(stl|obj|3mf)$/i.test(f.name));
    if(!files.length){toast('Formato no soportado — usa STL, OBJ o 3MF','error');return;}
    try{
      const parsed=[];let totRemoved=0,totWelded=0;
      for(const f of files){const r=_repairMesh(await _parseFile(f));totRemoved+=r.removed;totWelded+=r.welded;parsed.push(_centerTris(r.tris));}
      S.objects=parsed;S.name=files[0].name.replace(/\.(stl|obj|3mf)$/i,'')+(files.length>1?` +${files.length-1}`:'');
      S.modifiers=[];S.supRegions=[]; // nuevos rangos de Z dependen del modelo → limpiar al cargar uno nuevo
      S.layFlatMode=false;S.supSticks=null;_updLayFlatBtn();
      _replate();
      const repMsg=totRemoved>0?` · reparado: ${totRemoved} triángulo(s) inválido(s) descartado(s)`:'';
      toast((files.length>1?`${files.length} piezas cargadas y acomodadas en el plato`:`Modelo cargado: ${S.stats.tris.toLocaleString('es-CL')} triángulos`)+repMsg,'success');
    }catch(e){toast('Error al leer el modelo: '+e.message,'error');}
  }
  async function addObject(fileList){
    const files=Array.from(fileList||[]).filter(f=>/\.(stl|obj|3mf)$/i.test(f.name));
    if(!files.length)return;
    if(!S.objects.length){return loadFiles(files);}
    try{
      for(const f of files)S.objects.push(_centerTris(_repairMesh(await _parseFile(f)).tris));
      S.name=S.name.replace(/ \+\d+$/,'')+` +${S.objects.length-1}`;
      _replate();
      toast(`Pieza agregada — ${S.objects.length} en el plato`,'success');
    }catch(e){toast('Error: '+e.message,'error');}
  }

  // ── Carga de archivo (compat: delega en loadFiles para mantener el estado del plato) ──
  async function loadFile(file){if(file)return loadFiles([file]);}
  function fitsIn(spec){const st=S.stats;return st.dx<=spec.x-2&&st.dy<=spec.y-2&&st.dz<=spec.z-2;}
  function renderStats(){
    const st=S.stats,spec=SPECS[el('slPrinter').value]||SPECS.K1;
    const fits=fitsIn(spec);
    el('slStats').style.display='block';
    el('slStats').innerHTML=`
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <span class="badge badge-gray">📐 ${st.dx.toFixed(1)} × ${st.dy.toFixed(1)} × ${st.dz.toFixed(1)} mm</span>
        <span class="badge badge-gray">🧊 ${st.vol.toFixed(1)} cm³</span>
        <span class="badge badge-gray">▲ ${st.tris.toLocaleString('es-CL')} tris</span>
        <span class="badge ${st.ovPct>8?'badge-yellow':'badge-green'}">⛰ voladizos ${st.ovPct.toFixed(1)}%</span>
        ${st.hr>3?'<span class="badge badge-yellow">⚠ pieza alta y delgada</span>':''}
        <span class="badge ${fits?'badge-green':'badge-red'}">${fits?'✓ cabe en '+el('slPrinter').value:'✕ NO cabe en '+el('slPrinter').value}</span>
      </div>`;
  }

  // ── IA: selección de parámetros ─────────────────────────────
  function resumen(){
    const st=S.stats,model=el('slPrinter').value,spec=SPECS[model],mat=el('slMaterial').value;
    const obj=el('slObjetivo').selectedOptions[0].textContent,noz=el('slNozzle').value,notas=el('slNotas').value.trim();
    return`PIEZA: ${S.name}
- Dimensiones (X×Y×Z): ${st.dx.toFixed(1)} × ${st.dy.toFixed(1)} × ${st.dz.toFixed(1)} mm
- Volumen sólido: ${st.vol.toFixed(1)} cm³ · Área: ${st.area.toFixed(0)} cm² · ${st.tris} triángulos
- Voladizos >55° sin apoyo: ${st.ovPct.toFixed(1)}% del área
- Relación altura/base: ${st.hr.toFixed(1)} ${st.hr>3?'(riesgo de volcarse — considerar brim)':'(estable)'}
IMPRESORA: ${model} — volumen ${spec.x}×${spec.y}×${spec.z}mm, velocidad máx ${spec.vmax}mm/s, boquilla ${noz}mm
MATERIAL: ${mat} · OBJETIVO: ${obj}${notas?'\nNOTAS DEL OPERADOR: '+notas:''}`;
  }
  const IA_SYS=`Eres KAI-SLICER, ingeniero experto en impresión 3D FDM de The Lab Solutions (Santiago, Chile).
Eliges parámetros de laminado óptimos según geometría de la pieza, material, impresora y objetivo.
REGLAS: TPU máx 35mm/s y retracción corta. PETG ventilador ≤50%, no exceder 250°C. ABS cama 95-105°C, ventilador ≤30%, ideal brim. Voladizos >55° o >8% del área → soportes (el slicer genera columnas bajo voladizos). Si activas soportes (supports=true), pon SIEMPRE treeSupports=true por defecto (troncos de celosía con base ancha, estables y fáciles de retirar); usa treeSupports=false solo si el voladizo es una superficie plana grande y continua que necesita interfaz densa. adaptiveLayerHeight=true en piezas con curvas pronunciadas o detalles finos: reduce capas en zonas planas y usa capas finas en curvas. Pieza alta/delgada (ratio >3) → brim 6-10 líneas. Primera capa: más gruesa y lenta. Altura de capa entre 25% y 75% del diámetro de boquilla. Piezas funcionales: 3-4 perímetros y relleno gyroid 30-50%. Piezas estéticas: capa fina, velocidad moderada, activa ironing para cara superior lisa. Patrones de relleno: grid (general), gyroid (resistente isótropo), triangle/hex (rígido), cubic (3D resistente), concentric (sigue el contorno, bueno para flexibles/sellos), linear (rápido).
COSTURA (seamMode): "alineado" oculta la costura atrás de la pieza (estético), "agudo" en esquinas, "cercano" minimiza viaje. outerWallLast=true imprime la pared exterior al final → mejor acabado. bridgeDetect=true para voladizos horizontales. elephantFoot (mm, 0-0.3): encoge la 1ª capa. xyCompensation (mm, -0.3 a 0.3): negativo agranda agujeros. arcFitting=false salvo que se indique (requiere [gcode_arcs] en Klipper).
VELOCIDAD: outerSpeed (mm/s, 0=auto) baja la pared exterior para mejor acabado (60% de speed en piezas vistosas). infillSpeed (0=auto) sube el relleno. accel (mm/s², 0=no tocar) limita aceleración para reducir ringing en piezas finas. ADHESIÓN: skirt (líneas, ceba el filamento sin pegarse a la pieza), brim (pegado, para piezas altas o ABS), raft=true (base completa bajo la pieza, para superficies difíciles o ABS — encarece). DETALLE: gapFill=true rellena paredes finas sin huecos. fuzzySkin (mm, 0.1-0.3) da textura rugosa mate a la pared exterior. coasting (mm, 0.1-0.3) corta la extrusión antes del fin del perímetro para evitar el blob de costura.
CALIDAD (estilo OrcaSlicer): minLayerTime (s, 5-12) ralentiza capas chicas para que enfríen → mejor en piezas pequeñas/torres. overhangSpeed (mm/s, 0=off) baja la velocidad de la pared exterior sobre voladizos. flowRatio (%, 95-105) ajusta extrusión. pressureAdvance (mm, 0=off; típico 0.02-0.05 en Klipper) reduce blobbing en esquinas — déjalo en 0 salvo que conozcas el valor de la impresora. wipeDist (mm, 0.5-1.5) limpia la boquilla al retraer → menos stringing. widthOuter/widthInfill (mm, 0=auto) anchos de línea por feature (outer un poco más fino = más nítido). seamMode también acepta "aleatorio" (costura dispersa).
RESPONDE SOLO con un objeto JSON válido (sin markdown, sin texto extra) con EXACTAMENTE estas claves:
{"layerHeight":0.2,"firstLayerHeight":0.25,"shells":2,"topLayers":4,"bottomLayers":3,"infillPct":15,"infillType":"grid|gyroid|triangle|hex|cubic|concentric|lightning|adaptive|linear","speed":120,"outerSpeed":0,"infillSpeed":0,"firstLayerSpeed":30,"travelSpeed":200,"accel":0,"nozzleTemp":210,"bedTemp":60,"fanPct":100,"minLayerTime":8,"overhangSpeed":0,"flowRatio":100,"pressureAdvance":0,"wipeDist":0.8,"widthOuter":0,"widthInfill":0,"supports":false,"treeSupports":false,"supportAngle":50,"adaptiveLayerHeight":false,"seamMode":"cercano|alineado|agudo|aleatorio","outerWallLast":false,"bridgeDetect":false,"gapFill":true,"fuzzySkin":0,"coasting":0,"elephantFoot":0,"xyCompensation":0,"arcFitting":false,"skirt":2,"skirtGap":2,"brim":0,"raft":false,"ironing":false,"retractDist":0.8,"retractSpeed":35,"zHop":0.2,"razonamiento":"2-4 frases en español con las decisiones clave","advertencias":["lista de riesgos, puede ser vacía"]}`;
  async function analizarIA(){
    if(!S.stats)return;
    if(!getAnthropicKey()){showAnthropicModal(()=>analizarIA());return;}
    const btn=el('slBtnIA');btn.disabled=true;btn.textContent='⏳ Analizando…';
    try{showAgentWorking('PRODUCTION',{name:'KAI-Slicer',emoji:'🖨️',verb:'está calculando los parámetros de impresión…',messages:['Analizando la geometría de la pieza…','Eligiendo capas, relleno y soportes…','Ajustando velocidad y temperatura…']});}catch(e){}
    try{
      const out=await callClaude(IA_SYS,resumen());
      const a=out.indexOf('{'),b=out.lastIndexOf('}');
      if(a<0||b<=a)throw new Error('respuesta sin JSON');
      const p=JSON.parse(out.slice(a,b+1));
      S.params=clampParams(p);
      showRazon((p.razonamiento||'Parámetros calculados por IA.'),p.advertencias||[]);
      renderParams();
    }catch(e){
      toast('IA no disponible ('+e.message+') — usando perfil base','error');
      usarPerfilBase();
    }finally{try{hideAgentWorking();}catch(e){}btn.disabled=false;btn.textContent='✨ Analizar con IA';}
  }
  function usarPerfilBase(){
    if(!S.stats)return;
    const st=S.stats,mat=MATS[el('slMaterial').value]||MATS['PLA'],spec=SPECS[el('slPrinter').value];
    const obj=el('slObjetivo').value,noz=+el('slNozzle').value;
    const vbase=Math.min(spec.vmax*(obj==='rapido'?0.85:obj==='calidad'?0.4:0.6),mat.vcap||999);
    const p={
      layerHeight:+(noz*(obj==='calidad'?0.3:obj==='rapido'?0.7:0.5)).toFixed(2),
      firstLayerHeight:+(noz*0.6).toFixed(2),
      shells:obj==='resistente'?4:obj==='calidad'?3:2,
      topLayers:obj==='rapido'?3:4,bottomLayers:3,
      infillPct:obj==='resistente'?40:obj==='rapido'?10:15,
      infillType:obj==='resistente'?'gyroid':'grid',
      speed:Math.round(vbase),outerSpeed:obj==='calidad'?Math.round(vbase*0.6):0,infillSpeed:obj==='rapido'?0:Math.round(vbase*1.1),
      firstLayerSpeed:Math.min(30,Math.round(vbase/2)),travelSpeed:Math.min(spec.vmax,300),accel:0,
      nozzleTemp:mat.noz,bedTemp:mat.bed,fanPct:mat.fan,
      supports:st.ovPct>8,treeSupports:st.ovPct>8,supportAngle:50,supGrid:3,supZGap:0.2,supDensity:25,supInterface:2,supOnPlate:false,infillOverlap:15,pauseAtZ:0,brimGap:0,ironingFlow:12,retractMinTravel:1,fuzzyAll:false,fuzzyPointDist:0.4,draftShield:false,
      minLayerTime:8,overhangSpeed:obj==='rapido'?0:Math.min(30,Math.round(vbase*0.4)),flowRatio:100,pressureAdvance:0,wipeDist:0.8,widthOuter:0,widthInfill:0,
      adaptiveLayerHeight:obj==='calidad',
      seamMode:obj==='calidad'?'alineado':'cercano',outerWallLast:obj==='calidad'||obj==='resistente',seamScarf:false,scarfLen:5,accelOuter:0,accelInfill:0,jerk:0,bridgeFlow:100,
      bridgeDetect:st.ovPct>8,arcFitting:false,gradualTemp: obj!=='rapido',
      spiralize:false,monotonic:obj==='calidad',arachne:obj==='calidad',
      gapFill:obj!=='rapido',fuzzySkin:0,coasting:obj==='calidad'?0.2:0,
      elephantFoot:obj==='calidad'?0.15:0,xyCompensation:0,
      skirt:st.hr>3?0:2,skirtGap:2,
      brim:st.hr>3?8:0,raft:false,ironing:obj==='calidad',
      retractDist:(mat===MATS.TPU||mat===MATS['TPU-95A'])?0.5:0.8,retractSpeed:(mat===MATS.TPU||mat===MATS['TPU-95A'])?20:35,zHop:0.2,
      };
    S.params=clampParams(p);
    showRazon('Perfil heurístico local (sin IA): calculado según material, objetivo y geometría. Puedes editar cualquier parámetro antes de generar el G-code.',[]);
    renderParams();
  }
  function clampParams(p){
    const noz=+el('slNozzle').value,spec=SPECS[el('slPrinter').value];
    const mat=MATS[el('slMaterial').value]||{};
    const vmax=Math.min(spec.vmax,mat.vcap||spec.vmax); // tope de velocidad por impresora Y material (TPU 35mm/s)
    const cl=(v,a,b,d)=>{v=+v;return isFinite(v)?Math.min(b,Math.max(a,v)):d;};
    return{
      layerHeight:cl(p.layerHeight,0.05,noz*0.8,noz*0.5),
      firstLayerHeight:cl(p.firstLayerHeight,0.1,noz*0.9,noz*0.6),
      shells:Math.round(cl(p.shells,1,8,2)),topLayers:Math.round(cl(p.topLayers,0,10,4)),bottomLayers:Math.round(cl(p.bottomLayers,0,10,3)),
      infillPct:Math.round(cl(p.infillPct,0,100,15)),
      infillType:['grid','gyroid','triangle','hex','honeycomb','cubic','concentric','lightning','adaptive','linear'].includes(p.infillType)?p.infillType:'grid',
      speed:Math.round(cl(p.speed,10,vmax,60)),
      outerSpeed:Math.round(cl(p.outerSpeed,0,vmax,0)),infillSpeed:Math.round(cl(p.infillSpeed,0,vmax,0)),
      firstLayerSpeed:Math.round(cl(p.firstLayerSpeed,5,Math.min(80,vmax),30)),
      travelSpeed:Math.round(cl(p.travelSpeed,30,500,200)),accel:Math.round(cl(p.accel,0,30000,0)),
      accelOuter:Math.round(cl(p.accelOuter,0,30000,0)),accelInfill:Math.round(cl(p.accelInfill,0,30000,0)),jerk:cl(p.jerk,0,40,0),bridgeFlow:Math.round(cl(p.bridgeFlow,40,150,100)),
      nozzleTemp:Math.round(cl(p.nozzleTemp,170,300,210)),bedTemp:Math.round(cl(p.bedTemp,0,110,60)),
      fanPct:Math.round(cl(p.fanPct,0,100,100)),
      supports:!!p.supports&&p.supports!=='no',treeSupports:!!p.treeSupports&&p.treeSupports!=='no',supportAngle:Math.round(cl(p.supportAngle,20,80,50)),
      supGrid:cl(p.supGrid,1.5,8,3),supZGap:cl(p.supZGap,0,0.6,0.2),supDensity:Math.round(cl(p.supDensity,10,90,25)),
      supInterface:Math.round(cl(p.supInterface,0,5,2)),supOnPlate:!!p.supOnPlate&&p.supOnPlate!=='no',infillOverlap:Math.round(cl(p.infillOverlap,0,40,15)),pauseAtZ:cl(p.pauseAtZ,0,1000,0),
      brimGap:cl(p.brimGap,0,1,0),ironingFlow:Math.round(cl(p.ironingFlow,5,30,12)),retractMinTravel:cl(p.retractMinTravel,0,10,1),
      fuzzyAll:!!p.fuzzyAll&&p.fuzzyAll!=='no',fuzzyPointDist:cl(p.fuzzyPointDist,0.2,2,0.4),draftShield:!!p.draftShield&&p.draftShield!=='no',
      seamScarf:!!p.seamScarf&&p.seamScarf!=='no',scarfLen:cl(p.scarfLen,1,15,5),
      minLayerTime:Math.round(cl(p.minLayerTime,0,30,8)),overhangSpeed:Math.round(cl(p.overhangSpeed,0,vmax,0)),flowRatio:cl(p.flowRatio,80,120,100),pressureAdvance:cl(p.pressureAdvance,0,1.5,0),wipeDist:cl(p.wipeDist,0,5,0.8),widthOuter:cl(p.widthOuter,0,2,0),widthInfill:cl(p.widthInfill,0,2,0),
      excludeObject:!!p.excludeObject&&p.excludeObject!=='no',sequential:!!p.sequential&&p.sequential!=='no',
      adaptiveLayerHeight:!!p.adaptiveLayerHeight&&p.adaptiveLayerHeight!=='no',
      seamMode:['cercano','alineado','agudo'].includes(p.seamMode)?p.seamMode:'cercano',
      outerWallLast:!!p.outerWallLast&&p.outerWallLast!=='no',
      bridgeDetect:!!p.bridgeDetect&&p.bridgeDetect!=='no',
      arcFitting:!!p.arcFitting&&p.arcFitting!=='no',
      gradualTemp:!!p.gradualTemp&&p.gradualTemp!=='no',
      gapFill:!!p.gapFill&&p.gapFill!=='no',fuzzySkin:cl(p.fuzzySkin,0,0.6,0),coasting:cl(p.coasting,0,2,0),
      spiralize:!!p.spiralize&&p.spiralize!=='no',monotonic:!!p.monotonic&&p.monotonic!=='no',arachne:!!p.arachne&&p.arachne!=='no',
      elephantFoot:cl(p.elephantFoot,0,0.6,0),xyCompensation:cl(p.xyCompensation,-0.3,0.3,0),
      skirt:Math.round(cl(p.skirt,0,5,0)),skirtGap:cl(p.skirtGap,0.5,10,2),
      brim:Math.round(cl(p.brim,0,20,0)),raft:!!p.raft&&p.raft!=='no',ironing:!!p.ironing&&p.ironing!=='no',
      retractDist:cl(p.retractDist,0,8,0.8),retractSpeed:Math.round(cl(p.retractSpeed,5,80,35)),
      zHop:cl(p.zHop,0,2,0.2),
    };
  }
  function showRazon(txt,adv){
    const box=el('slRazon');box.style.display='block';
    box.innerHTML='<b style="color:var(--accent4)">🧠 Razonamiento del agente</b><br>'+escapeHtml(txt)+
      (adv&&adv.length?'<br><br><b style="color:var(--warn)">⚠ Advertencias</b><br>'+adv.map(a=>'• '+escapeHtml(a)).join('<br>'):'');
  }
  function renderParams(){
    const g=el('slParamsGrid');g.innerHTML='';
    for(const f of FIELDS){
      const v=S.params[f.k];
      const div=document.createElement('div');
      if(f.sel){
        const isBool=f.sel[0]==='no';
        const cur=isBool?(v?'sí':'no'):v;
        div.innerHTML=`<label class="field-label" style="font-size:9px">${f.l}</label>
          <select class="field-select" id="sl_f_${f.k}" style="padding:6px 8px;font-size:11px">${f.sel.map(o=>`<option ${o===cur?'selected':''}>${o}</option>`).join('')}</select>`;
      }else{
        div.innerHTML=`<label class="field-label" style="font-size:9px">${f.l}</label>
          <input class="field-input" id="sl_f_${f.k}" type="number" step="${f.s}" value="${v}" style="padding:6px 8px;font-size:11px">`;
      }
      g.appendChild(div);
    }
    el('slParamsWrap').style.display='block';
    renderProfileSel();
    renderModifiers();renderSupRegions();renderObjSettings();
  }
  // ── Perfiles de laminado (guardar/cargar conjuntos de parámetros) ──
  function _slProfiles(){try{return JSON.parse(localStorage.getItem('sl_profiles')||'{}');}catch(e){return{};}}
  function _slProfilesSave(m){localStorage.setItem('sl_profiles',JSON.stringify(m));}
  function renderProfileSel(){
    const sel=el('slProfileSel');if(!sel)return;
    const m=_slProfiles(),names=Object.keys(m).sort();
    sel.innerHTML='<option value="">— elegir perfil guardado —</option>'+names.map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  }
  function saveProfile(){
    if(!el('sl_f_layerHeight')){toast('Genera o carga parámetros primero','error');return;}
    const name=(prompt('Nombre del perfil:','')||'').trim();if(!name)return;
    const vals={};for(const f of FIELDS){const e=el('sl_f_'+f.k);if(e)vals[f.k]=e.value;}
    const m=_slProfiles();m[name]=vals;_slProfilesSave(m);renderProfileSel();
    el('slProfileSel').value=name;toast(`✓ Perfil "${name}" guardado`,'success');
  }
  function loadProfile(name){
    if(!name)return;const m=_slProfiles(),vals=m[name];if(!vals)return;
    for(const f of FIELDS){const e=el('sl_f_'+f.k);if(e&&vals[f.k]!==undefined)e.value=vals[f.k];}
    toast(`Perfil "${name}" cargado — revisa y genera`,'success');
  }
  function deleteProfile(){
    const name=el('slProfileSel').value;if(!name){toast('Elige un perfil para borrar','error');return;}
    const m=_slProfiles();delete m[name];_slProfilesSave(m);renderProfileSel();toast(`Perfil "${name}" borrado`,'info');
  }
  // ── Modificadores por altura y regiones de soporte ──────────
  function toggleAdvanced(){
    const b=el('slAdvBody'),c=el('slAdvCaret');
    const open=b.style.display==='none';
    b.style.display=open?'block':'none';c.textContent=open?'▴':'▾';
    if(open){loadMachineGcode();renderObjSettings();}
  }
  // ── G-code de máquina (inicio/fin) por impresora ──
  function _sub(tpl,vars){return tpl.replace(/\{(\w+)\}/g,(m,k)=>k in vars?vars[k]:m);}
  function _gcMachine(){return el('slPrinter')?el('slPrinter').value:'default';}
  function loadMachineGcode(){
    const m=_gcMachine();
    const nm=el('slGcMachineName');if(nm)nm.textContent=m;
    const s=el('slStartGcode'),e=el('slEndGcode'),lg=el('slLayerGcode');
    if(s)s.value=localStorage.getItem('sl_startgcode_'+m)||'';
    if(e)e.value=localStorage.getItem('sl_endgcode_'+m)||'';
    if(lg)lg.value=localStorage.getItem('sl_layergcode_'+m)||'';
  }
  function saveMachineGcode(){
    const m=_gcMachine(),s=el('slStartGcode'),e=el('slEndGcode'),lg=el('slLayerGcode');
    if(s)localStorage.setItem('sl_startgcode_'+m,s.value);
    if(e)localStorage.setItem('sl_endgcode_'+m,e.value);
    if(lg)localStorage.setItem('sl_layergcode_'+m,lg.value);
  }
  function gcodePreset(flavor){
    const s=el('slStartGcode'),e=el('slEndGcode');if(!s||!e)return;
    if(flavor==='klipper'){
      s.value='PRINT_START BED_TEMP={bed} EXTRUDER_TEMP={nozzle}';
      e.value='PRINT_END';
    }else{
      s.value='M140 S{bed}\nM104 S{nozzle}\nG28\nM190 S{bed}\nM109 S{nozzle}';
      e.value='M107\nM104 S0\nM140 S0\nM84';
    }
    saveMachineGcode();
    toast(flavor==='klipper'?'Preset Klipper cargado — requiere macros PRINT_START/PRINT_END en tu printer.cfg':'Preset Marlin cargado','success');
  }
  const _MOD_FIELDS=['infillPct','infillType','shells','topLayers','bottomLayers'];
  function addModifier(){
    const zMax=S.stats?+S.stats.dz.toFixed(1):20;
    S.modifiers.push({zMin:0,zMax,infillPct:'',infillType:'',shells:'',topLayers:'',bottomLayers:''});
    renderModifiers();
  }
  function removeModifier(i){S.modifiers.splice(i,1);renderModifiers();}
  function updModifier(i,k,v){if(S.modifiers[i])S.modifiers[i][k]=v;}
  function renderModifiers(){
    const c=el('slModList');if(!c)return;
    if(!S.modifiers.length){c.innerHTML='<div style="font-size:10px;color:var(--text3);padding:2px 0 8px">Sin modificadores — todo el modelo usa los parámetros de arriba.</div>';return;}
    const patOpts=['','grid','gyroid','triangle','hex','honeycomb','cubic','concentric','lightning','adaptive','linear'];
    c.innerHTML=S.modifiers.map((m,i)=>`
      <div style="background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:8px;margin-bottom:6px">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:10px;color:var(--text3)">
          <span>Z desde</span><input type="number" step="0.5" value="${m.zMin}" onchange="SL3D.updModifier(${i},'zMin',+this.value)" style="width:56px;background:var(--surface);border:1px solid var(--border2);border-radius:5px;color:var(--text);padding:3px 5px;font-size:11px;font-family:monospace">
          <span>hasta</span><input type="number" step="0.5" value="${m.zMax}" onchange="SL3D.updModifier(${i},'zMax',+this.value)" style="width:56px;background:var(--surface);border:1px solid var(--border2);border-radius:5px;color:var(--text);padding:3px 5px;font-size:11px;font-family:monospace"><span>mm</span>
          <button onclick="SL3D.removeModifier(${i})" style="margin-left:auto;background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px" title="Quitar">✕</button>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
          <label style="font-size:9px;color:var(--text3)">Relleno %<br><input type="number" step="5" placeholder="—" value="${m.infillPct}" onchange="SL3D.updModifier(${i},'infillPct',this.value)" style="width:60px;background:var(--surface);border:1px solid var(--border2);border-radius:5px;color:var(--text);padding:3px 5px;font-size:11px;font-family:monospace"></label>
          <label style="font-size:9px;color:var(--text3)">Patrón<br><select onchange="SL3D.updModifier(${i},'infillType',this.value)" style="background:var(--surface);border:1px solid var(--border2);border-radius:5px;color:var(--text);padding:3px 5px;font-size:11px">${patOpts.map(o=>`<option value="${o}" ${o===m.infillType?'selected':''}>${o||'—'}</option>`).join('')}</select></label>
          <label style="font-size:9px;color:var(--text3)">Perímetros<br><input type="number" step="1" placeholder="—" value="${m.shells}" onchange="SL3D.updModifier(${i},'shells',this.value)" style="width:60px;background:var(--surface);border:1px solid var(--border2);border-radius:5px;color:var(--text);padding:3px 5px;font-size:11px;font-family:monospace"></label>
          <label style="font-size:9px;color:var(--text3)">Capas sup.<br><input type="number" step="1" placeholder="—" value="${m.topLayers}" onchange="SL3D.updModifier(${i},'topLayers',this.value)" style="width:60px;background:var(--surface);border:1px solid var(--border2);border-radius:5px;color:var(--text);padding:3px 5px;font-size:11px;font-family:monospace"></label>
          <label style="font-size:9px;color:var(--text3)">Capas inf.<br><input type="number" step="1" placeholder="—" value="${m.bottomLayers}" onchange="SL3D.updModifier(${i},'bottomLayers',this.value)" style="width:60px;background:var(--surface);border:1px solid var(--border2);border-radius:5px;color:var(--text);padding:3px 5px;font-size:11px;font-family:monospace"></label>
        </div>
      </div>`).join('');
  }
  function addSupRegion(){
    const dx=S.stats?S.stats.dx:40,dy=S.stats?S.stats.dy:40,dz=S.stats?+S.stats.dz.toFixed(1):20;
    S.supRegions.push({mode:'block',x0:+(-dx/4).toFixed(1),y0:+(-dy/4).toFixed(1),x1:+(dx/4).toFixed(1),y1:+(dy/4).toFixed(1),zMin:0,zMax:dz});
    renderSupRegions();
  }
  function removeSupRegion(i){S.supRegions.splice(i,1);renderSupRegions();}
  function updSupRegion(i,k,v){if(S.supRegions[i])S.supRegions[i][k]=v;}
  function renderSupRegions(){
    const c=el('slSupRegList');if(!c)return;
    if(!S.supRegions.length){c.innerHTML='<div style="font-size:10px;color:var(--text3);padding:2px 0 8px">Sin regiones — el soporte se calcula automáticamente por ángulo.</div>';return;}
    c.innerHTML=S.supRegions.map((r,i)=>`
      <div style="background:var(--surface2);border:1px solid ${r.mode==='enforce'?'rgba(0,212,170,0.4)':'rgba(255,107,53,0.4)'};border-radius:8px;padding:8px;margin-bottom:6px">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:10px;color:var(--text3)">
          <select onchange="SL3D.updSupRegion(${i},'mode',this.value)" style="background:var(--surface);border:1px solid var(--border2);border-radius:5px;color:var(--text);padding:3px 5px;font-size:11px">
            <option value="block" ${r.mode==='block'?'selected':''}>🚫 Bloquear soporte</option>
            <option value="enforce" ${r.mode==='enforce'?'selected':''}>✅ Forzar soporte</option>
          </select>
          <button onclick="SL3D.removeSupRegion(${i})" style="margin-left:auto;background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px" title="Quitar">✕</button>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;font-size:9px;color:var(--text3)">
          ${['x0','y0','x1','y1','zMin','zMax'].map(k=>`<label>${k}<br><input type="number" step="1" value="${r[k]}" onchange="SL3D.updSupRegion(${i},'${k}',+this.value)" style="width:54px;background:var(--surface);border:1px solid var(--border2);border-radius:5px;color:var(--text);padding:3px 5px;font-size:11px;font-family:monospace"></label>`).join('')}
        </div>
      </div>`).join('');
  }
  // ── Ajustes por pieza (overrides de relleno/perímetros/soporte por objeto del plato) ──
  const _inStyle="width:58px;background:var(--surface);border:1px solid var(--border2);border-radius:5px;color:var(--text);padding:3px 5px;font-size:11px;font-family:monospace";
  function renderObjSettings(){
    const wrap=el('slObjSetWrap'),list=el('slObjSetList');if(!wrap||!list)return;
    if(!S.objSettings||!S.objBBs||S.objBBs.length<2){wrap.style.display='none';return;}
    wrap.style.display='block';
    const pats=['','grid','gyroid','triangle','hex','honeycomb','cubic','concentric','lightning','adaptive','linear'];
    list.innerHTML=S.objSettings.map((s,i)=>`
      <div style="background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:8px;margin-bottom:6px">
        <div style="font-size:10px;font-weight:700;color:var(--text2);margin-bottom:6px">Pieza ${i+1}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <label style="font-size:9px;color:var(--text3)">Relleno %<br><input type="number" step="5" placeholder="—" value="${s.infillPct??''}" onchange="SL3D.updObjSetting(${i},'infillPct',this.value)" style="${_inStyle}"></label>
          <label style="font-size:9px;color:var(--text3)">Patrón<br><select onchange="SL3D.updObjSetting(${i},'infillType',this.value)" style="background:var(--surface);border:1px solid var(--border2);border-radius:5px;color:var(--text);padding:3px 5px;font-size:11px">${pats.map(o=>`<option value="${o}" ${o===(s.infillType||'')?'selected':''}>${o||'—'}</option>`).join('')}</select></label>
          <label style="font-size:9px;color:var(--text3)">Perímetros<br><input type="number" step="1" placeholder="—" value="${s.shells??''}" onchange="SL3D.updObjSetting(${i},'shells',this.value)" style="${_inStyle}"></label>
          <label style="font-size:9px;color:var(--text3)">Soporte<br><select onchange="SL3D.updObjSetting(${i},'supports',this.value)" style="background:var(--surface);border:1px solid var(--border2);border-radius:5px;color:var(--text);padding:3px 5px;font-size:11px"><option value="" ${!s.supports?'selected':''}>global</option><option value="sí" ${s.supports==='sí'?'selected':''}>sí</option><option value="no" ${s.supports==='no'?'selected':''}>no</option></select></label>
        </div>
      </div>`).join('');
  }
  function updObjSetting(i,k,v){if(S.objSettings&&S.objSettings[i])S.objSettings[i][k]=v;}
  // Parámetros efectivos para una capa a altura curZ (aplica modificadores que cubran ese Z).
  // Sin modificadores activos → devuelve el mismo objeto p (cero cambios en la salida).
  function _layerParams(p,curZ){
    if(!S.modifiers||!S.modifiers.length)return p;
    const cli=(v,a,b)=>Math.max(a,Math.min(b,Math.round(+v)));
    const PATS=['grid','gyroid','triangle','hex','honeycomb','cubic','concentric','lightning','adaptive','linear'];
    let pe=null;
    for(const m of S.modifiers){
      if(curZ<m.zMin-1e-6||curZ>m.zMax+1e-6)continue;
      for(const k of _MOD_FIELDS){
        const raw=m[k];if(raw===''||raw===null||raw===undefined)continue;
        if(!pe)pe=Object.assign({},p);
        if(k==='infillType'){if(PATS.includes(raw))pe.infillType=raw;}
        else if(k==='infillPct')pe.infillPct=cli(raw,0,100);
        else if(k==='shells')pe.shells=cli(raw,1,8);
        else pe[k]=cli(raw,0,10); // topLayers / bottomLayers
      }
    }
    return pe||p;
  }
  function readParams(){
    const p={};
    for(const f of FIELDS){
      const elv=el('sl_f_'+f.k);if(!elv)continue;
      p[f.k]=f.sel?(f.sel[0]==='no'?elv.value==='sí':elv.value):+elv.value;
    }
    return clampParams(p);
  }

  // ── Laminado con Kiri:Moto ──────────────────────────────────
  // ── Slicer nativo (sin dependencias externas) ────────────────
  // Algoritmos: intersección triángulo-plano → contornos → shells (inset miter) → infill scanline
  const FILA_AREA=Math.PI*0.765625; // sección filamento 1.75mm = π·0.875²
  function _buildContours(segs){
    if(!segs.length)return[];
    // Clave numérica (sin allocación de string) → mismo redondeo EPS, mucho más rápido por capa
    const EPS=0.05,round=v=>Math.round(v/EPS),K=(p)=>(round(p[0])+1e6)*4000001+(round(p[1])+1e6);
    const map=new Map();
    for(let i=0;i<segs.length;i++){
      const k0=K(segs[i][0]),k1=K(segs[i][1]);
      (map.get(k0)||map.set(k0,[]).get(k0)).push({idx:i,side:0});
      (map.get(k1)||map.set(k1,[]).get(k1)).push({idx:i,side:1});
    }
    const used=new Uint8Array(segs.length);const contours=[];
    const GAP=EPS*5,GAP2=GAP*GAP; // reparación de malla: tolerancia para puentear huecos pequeños
    for(let start=0;start<segs.length;start++){
      if(used[start])continue;used[start]=1;
      const c=[segs[start][0],segs[start][1]];
      for(let _=0;_<segs.length;_++){
        const last=c[c.length-1];const nb=map.get(K(last))||[];let found=false;
        for(const{idx,side}of nb){if(used[idx])continue;used[idx]=1;c.push(side===0?segs[idx][1]:segs[idx][0]);found=true;break;}
        if(!found){
          // Reparación: ningún vértice coincide exacto → conecta el extremo libre más cercano dentro de GAP
          let bi=-1,bside=0,bd=GAP2;
          for(let s=0;s<segs.length;s++){if(used[s])continue;
            for(let sd=0;sd<2;sd++){const pt=segs[s][sd];const dd=(pt[0]-last[0])**2+(pt[1]-last[1])**2;if(dd<bd){bd=dd;bi=s;bside=sd;}}
          }
          if(bi>=0){used[bi]=1;c.push(segs[bi][bside===0?1:0]);found=true;}
        }
        if(!found)break;
        if(K(c[c.length-1])===K(c[0]))break;
      }
      // Descarta loops degenerados: <3 pts o área minúscula (motas de ruido al rozar una cara casi horizontal)
      if(c.length>=3&&Math.abs(_polyArea(c))>=0.02)contours.push(c);
    }
    return contours;
  }
  // Slicea el mesh en Z dado usando solo los triángulos del índice ordenado
  function _sliceIdx(tris,sortedIdx,triZmin,triZmax,z){
    const segs=[];
    for(const i of sortedIdx){
      if(triZmin[i]>z)break; // todos los siguientes están por encima
      if(triZmax[i]<=z)continue; // este triángulo está completamente abajo
      const b=i*9;
      const pts=[[tris[b],tris[b+1],tris[b+2]],[tris[b+3],tris[b+4],tris[b+5]],[tris[b+6],tris[b+7],tris[b+8]]];
      const cr=[];
      for(let a=0;a<3;a++){const pa=pts[a],pb=pts[(a+1)%3];
        if((pa[2]>z)!==(pb[2]>z)){const tt=(z-pa[2])/(pb[2]-pa[2]);cr.push([pa[0]+tt*(pb[0]-pa[0]),pa[1]+tt*(pb[1]-pa[1])]);}
      }
      if(cr.length===2)segs.push(cr);
    }
    return _buildContours(segs);
  }
  function sliceAtZ(t,z){return _sliceIdx(t,Array.from({length:t.length/9},(_,i)=>i),new Float32Array(t.length/9),new Float32Array(t.length/9).fill(Infinity),z);}
  function _polyArea(p){let a=0;const n=p.length;for(let i=0;i<n;i++){const j=(i+1)%n;a+=p[i][0]*p[j][1]-p[j][0]*p[i][1];}return a/2;}
  function _inset(poly,d){
    const n=poly.length;if(n<3||d<=0)return poly;
    const res=[];
    for(let i=0;i<n;i++){
      const prev=poly[(i-1+n)%n],curr=poly[i],next=poly[(i+1)%n];
      let e1x=curr[0]-prev[0],e1y=curr[1]-prev[1];let e2x=next[0]-curr[0],e2y=next[1]-curr[1];
      const l1=Math.hypot(e1x,e1y),l2=Math.hypot(e2x,e2y);
      if(!l1||!l2){res.push(curr);continue;}
      e1x/=l1;e1y/=l1;e2x/=l2;e2y/=l2;
      const n1x=-e1y,n1y=e1x,n2x=-e2y,n2y=e2x;
      const mx=n1x+n2x,my=n1y+n2y,ml=Math.hypot(mx,my);
      if(!ml){res.push([curr[0]+n1x*d,curr[1]+n1y*d]);continue;}
      // Math.max(0,…) evita sqrt de negativo cuando dot < -1 por error de punto flotante (vértice en horquilla) → NaN
      const dot=n1x*n2x+n1y*n2y,ms=d/Math.max(0.25,Math.sqrt(Math.max(0,(1+dot)/2)));
      const rx=curr[0]+(mx/ml)*Math.min(ms,d*5),ry=curr[1]+(my/ml)*Math.min(ms,d*5);
      if(!isFinite(rx)||!isFinite(ry)){res.push([curr[0]+n1x*d,curr[1]+n1y*d]);continue;}
      res.push([rx,ry]);
    }
    const oa=Math.abs(_polyArea(poly)),ia=Math.abs(_polyArea(res));
    return(ia<0.05||ia>oa*1.15)?null:res;
  }
  function _scanfill(poly,spacing,angle){
    const r=angle*Math.PI/180,cos=Math.cos(-r),sin=Math.sin(-r);
    const rot=([x,y])=>[x*cos-y*sin,x*sin+y*cos],unrot=([x,y])=>[x*cos+y*sin,-x*sin+y*cos];
    const rp=poly.map(rot);
    let mnY=1e9,mxY=-1e9;for(const[,y]of rp){if(y<mnY)mnY=y;if(y>mxY)mxY=y;}
    const lines=[],n=rp.length;
    for(let y=mnY+spacing/2;y<mxY;y+=spacing){
      const xs=[];
      for(let i=0;i<n;i++){const j=(i+1)%n;const[ax,ay]=rp[i],[bx,by]=rp[j];
        if((ay<=y&&by>y)||(by<=y&&ay>y))xs.push(ax+(y-ay)/(by-ay)*(bx-ax));}
      xs.sort((a,b)=>a-b);
      for(let i=0;i+1<xs.length;i+=2)lines.push([unrot([xs[i],y]),unrot([xs[i+1],y])]);
    }
    for(let i=1;i<lines.length;i+=2)lines[i].reverse();
    return lines;
  }
  // Punto dentro de polígono (ray casting) — para gyroid y soportes
  function _pointInPoly(x,y,poly){
    let inside=false,n=poly.length;
    for(let i=0,j=n-1;i<n;j=i++){
      const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];
      if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))inside=!inside;
    }
    return inside;
  }
  // Relleno giroide aproximado: ondas senoidales con fase que gira con Z (se entrelazan capa a capa)
  function _gyroidFill(poly,spacing,z){
    let mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;
    for(const[x,y]of poly){if(x<mnx)mnx=x;if(x>mxx)mxx=x;if(y<mny)mny=y;if(y>mxy)mxy=y;}
    const period=Math.max(spacing*1.7,3),k=2*Math.PI/period,amp=spacing*0.5,step=Math.max(0.7,period/10);
    const segs=[];let row=0;
    for(let y0=mny+spacing/2;y0<mxy;y0+=spacing,row++){
      const ph=k*z*0.6+(row%2?Math.PI:0);let prev=null;
      for(let x=mnx;x<=mxx;x+=step){
        const y=y0+amp*Math.sin(k*x+ph);
        const ins=_pointInPoly(x,y,poly);
        if(ins&&prev)segs.push([prev,[x,y]]);
        prev=ins?[x,y]:null;
      }
    }
    return segs;
  }
  // ── Relleno consciente de agujeros (regla even-odd sobre todos los loops) ──
  function _inSolid(x,y,loops){let c=0;for(const L of loops)if(_pointInPoly(x,y,L))c++;return c%2===1;}
  // ── Optimización: bounding-box por loop para descartar point-in-poly sin overlap ──
  function _bbOf(poly){let mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;for(const p of poly){if(p[0]<mnx)mnx=p[0];if(p[0]>mxx)mxx=p[0];if(p[1]<mny)mny=p[1];if(p[1]>mxy)mxy=p[1];}return[mnx,mny,mxx,mxy];}
  function _inSolidBB(x,y,loops,bbs){let c=0;for(let i=0;i<loops.length;i++){const b=bbs[i];if(x<b[0]||x>b[2]||y<b[1]||y>b[3])continue;if(_pointInPoly(x,y,loops[i]))c++;}return c%2===1;}
  // Slicer con lista activa: para z CRECIENTE sólo evalúa triángulos que cruzan el plano (no re-escanea todo)
  function _activeSweeper(tris,sortedIdx,triZmin,triZmax){
    let addPtr=0,active=[];const triCnt=sortedIdx.length;
    return function(zc){
      while(addPtr<triCnt&&triZmin[sortedIdx[addPtr]]<=zc){active.push(sortedIdx[addPtr]);addPtr++;}
      const segs=[],keep=[];
      for(const i of active){
        if(triZmax[i]<=zc)continue;
        keep.push(i);
        const b=i*9,za=tris[b+2],zb=tris[b+5],zcc=tris[b+8];
        const pts=[[tris[b],tris[b+1],za],[tris[b+3],tris[b+4],zb],[tris[b+6],tris[b+7],zcc]],cr=[];
        for(let a=0;a<3;a++){const pa=pts[a],pb=pts[(a+1)%3];if((pa[2]>zc)!==(pb[2]>zc)){const tt=(zc-pa[2])/(pb[2]-pa[2]);cr.push([pa[0]+tt*(pb[0]-pa[0]),pa[1]+tt*(pb[1]-pa[1])]);}}
        if(cr.length===2)segs.push(cr);
      }
      active=keep;
      return _buildContours(segs);
    };
  }
  // Recorta líneas a los sub-tramos donde pred(x,y) es verdadero (muestreo cada `step`).
  // Sirve para imprimir superficies sólidas (top/bottom) sólo donde toca y dejar el resto disperso.
  function _clipLines(lines,pred,step){
    const out=[];
    for(const[a,b]of lines){
      const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),n=Math.max(1,Math.ceil(len/step));
      let segS=null,last=null;
      for(let i=0;i<=n;i++){const t=i/n,x=a[0]+dx*t,y=a[1]+dy*t;
        if(pred(x,y)){if(segS===null)segS=[x,y];last=[x,y];}
        else{if(segS&&last&&(last[0]!==segS[0]||last[1]!==segS[1]))out.push([segS,last]);segS=null;}
      }
      if(segS&&last&&(last[0]!==segS[0]||last[1]!==segS[1]))out.push([segS,last]);
    }
    return out;
  }
  function _scanfillAll(loops,spacing,angle,mono){
    const r=angle*Math.PI/180,cos=Math.cos(-r),sin=Math.sin(-r);
    const rot=([x,y])=>[x*cos-y*sin,x*sin+y*cos],unrot=([x,y])=>[x*cos+y*sin,-x*sin+y*cos];
    const rls=loops.map(L=>L.map(rot));
    let mnY=1e9,mxY=-1e9;for(const rp of rls)for(const[,y]of rp){if(y<mnY)mnY=y;if(y>mxY)mxY=y;}
    const lines=[];
    for(let y=mnY+spacing/2;y<mxY;y+=spacing){
      const xs=[];
      for(const rp of rls){const n=rp.length;
        for(let i=0;i<n;i++){const j=(i+1)%n;const[ax,ay]=rp[i],[bx,by]=rp[j];
          if((ay<=y&&by>y)||(by<=y&&ay>y))xs.push(ax+(y-ay)/(by-ay)*(bx-ax));}}
      xs.sort((a,b)=>a-b);
      for(let i=0;i+1<xs.length;i+=2)lines.push([unrot([xs[i],y]),unrot([xs[i+1],y])]);
    }
    // Monotonic: todas las líneas van en la misma dirección → superficie más uniforme sin marcas de costura
    // Boustrophedon (por defecto): líneas alternas invertidas → menos viajes pero puede dejar marcas
    if(!mono)for(let i=1;i<lines.length;i+=2)lines[i].reverse();
    return lines;
  }
  function _gyroidFillMulti(loops,spacing,z){
    const bbs=loops.map(_bbOf);
    let mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;
    for(const b of bbs){if(b[0]<mnx)mnx=b[0];if(b[2]>mxx)mxx=b[2];if(b[1]<mny)mny=b[1];if(b[3]>mxy)mxy=b[3];}
    const period=Math.max(spacing*1.7,3),k=2*Math.PI/period,amp=spacing*0.5,step=Math.max(0.7,period/10);
    const segs=[];let row=0;
    for(let y0=mny+spacing/2;y0<mxy;y0+=spacing,row++){
      const ph=k*z*0.6+(row%2?Math.PI:0);let prev=null;
      for(let x=mnx;x<=mxx;x+=step){
        const y=y0+amp*Math.sin(k*x+ph);
        const ins=_inSolidBB(x,y,loops,bbs);
        if(ins&&prev)segs.push([prev,[x,y]]);
        prev=ins?[x,y]:null;
      }
    }
    return segs;
  }
  // Relleno concéntrico: anillos que siguen el contorno hacia adentro (recortados a la región sólida)
  function _concentricFill(loops,spacing){
    let outer=loops[0];for(const L of loops)if(Math.abs(_polyArea(L))>Math.abs(_polyArea(outer)))outer=L;
    const out=[];let ring=outer;
    for(let k=0;k<300;k++){
      ring=_inset(ring,spacing);
      if(!ring||ring.length<3)break;
      const segs=[];for(let i=0;i<ring.length;i++)segs.push([ring[i],ring[(i+1)%ring.length]]);
      for(const s of _clipLines(segs,(x,y)=>_inSolid(x,y,loops),spacing*0.5))out.push(s);
    }
    return out;
  }
  function _infillMulti(loops,spacing,pattern,li,z){
    if(pattern==='gyroid')return _gyroidFillMulti(loops,spacing,z);
    if(pattern==='honeycomb'){
      // Verdadero patrón hexagonal: celdas hexagonales con filas offset
      const bbs=loops.map(_bbOf);
      let mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;
      for(const b of bbs){if(b[0]<mnx)mnx=b[0];if(b[2]>mxx)mxx=b[2];if(b[1]<mny)mny=b[1];if(b[3]>mxy)mxy=b[3];}
      const s=spacing,h=s*Math.sqrt(3)/2;
      const segs=[];
      for(let row=0;(mny+row*h)<mxy+h;row++){
        const yOff=row%2?s/2:0,yc=mny+row*h;
        for(let col=0;(mnx+col*s*1.5-s)<mxx+s;col++){
          const xc=mnx+col*s*1.5+yOff;
          // 6 vértices del hexágono
          const pts=Array.from({length:6},(_,i)=>[xc+s*Math.cos(i*Math.PI/3),yc+s*Math.sin(i*Math.PI/3)]);
          // Sólo los lados que no se duplican (lados 0-2 del hexágono, los otros son compartidos)
          for(let i=0;i<6;i++){
            const a=pts[i],b=pts[(i+1)%6];
            const cx2=(a[0]+b[0])/2,cy2=(a[1]+b[1])/2;
            if(_inSolidBB(cx2,cy2,loops,bbs))segs.push([a,b]);
          }
        }
      }
      return segs;
    }
    if(pattern==='concentric')return _concentricFill(loops,spacing);
    if(pattern==='grid')return _scanfillAll(loops,spacing*2,45).concat(_scanfillAll(loops,spacing*2,135));
    if(pattern==='cubic'){const r=(z*18)%120;return _scanfillAll(loops,spacing*3,r).concat(_scanfillAll(loops,spacing*3,r+60),_scanfillAll(loops,spacing*3,r+120));}
    if(pattern==='triangle'||pattern==='hex')return _scanfillAll(loops,spacing*3,0).concat(_scanfillAll(loops,spacing*3,60),_scanfillAll(loops,spacing*3,120));
    return _scanfillAll(loops,spacing,li%2?135:45); // linear
  }
  // Profundidad de anidamiento (cuántos contornos contienen a éste) → par=exterior, impar=agujero.
  // Usa un punto sobre el borde del contorno (no el centroide, que puede caer dentro de un agujero concéntrico).
  function _depth(contour,all){
    const n=contour.length,a=contour[0],b=contour[1%n];
    let mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2,dx=b[0]-a[0],dy=b[1]-a[1],ln=Math.hypot(dx,dy)||1;
    mx+=(-dy/ln)*0.01;my+=(dx/ln)*0.01; // empuje mínimo hacia el interior del loop (CCW)
    let d=0;for(const o of all){if(o===contour)continue;if(_pointInPoly(mx,my,o))d++;}
    return d;
  }
  // Igual que _depth pero con prefiltro por bounding-box (descarta loops sin overlap antes del ray-cast)
  function _depthBB(ci,all,bbs){
    const contour=all[ci],n=contour.length,a=contour[0],b=contour[1%n];
    let mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2,dx=b[0]-a[0],dy=b[1]-a[1],ln=Math.hypot(dx,dy)||1;
    mx+=(-dy/ln)*0.01;my+=(dx/ln)*0.01;
    let d=0;for(let i=0;i<all.length;i++){if(i===ci)continue;const bb=bbs[i];if(mx<bb[0]||mx>bb[2]||my<bb[1]||my>bb[3])continue;if(_pointInPoly(mx,my,all[i]))d++;}
    return d;
  }
  // Detección de puentes: cobertura del área sólida por la capa inferior + orientación de span
  function _bridgeInfoMulti(loops,prev){
    const bbs=loops.map(_bbOf);
    let mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;
    for(const b of bbs){if(b[0]<mnx)mnx=b[0];if(b[2]>mxx)mxx=b[2];if(b[1]<mny)mny=b[1];if(b[3]>mxy)mxy=b[3];}
    const angle=(mxx-mnx)<=(mxy-mny)?0:90; // líneas a lo largo de la dimensión corta (vanos más cortos)
    if(!prev||!prev.length)return{cov:0,angle};
    const pbbs=prev.map(_bbOf),N=7;let inP=0,cov=0;
    for(let i=0;i<=N;i++)for(let j=0;j<=N;j++){
      const x=mnx+(mxx-mnx)*i/N,y=mny+(mxy-mny)*j/N;
      if(!_inSolidBB(x,y,loops,bbs))continue;inP++;
      if(_inSolidBB(x,y,prev,pbbs))cov++;
    }
    return{cov:inP?cov/inP:1,angle};
  }
  // Punto de inicio de costura según modo (cercano / alineado atrás / esquina aguda)
  function _seamStart(poly,mode,cX,cY,ox,oy){
    const n=poly.length;
    if(mode==='aleatorio')return Math.floor(Math.random()*n); // costura dispersa → no se acumula una cicatriz vertical
    if(mode==='alineado'){
      let bi=0,bv=-1e9;
      for(let i=0;i<n;i++){const yy=poly[i][1];if(yy>bv+1e-6||(Math.abs(yy-bv)<=1e-6&&poly[i][0]<poly[bi][0])){bv=yy;bi=i;}}
      return bi;
    }
    if(mode==='agudo'){
      let bi=-1,bs=2;
      for(let i=0;i<n;i++){
        const pr=poly[(i-1+n)%n],cu=poly[i],ne=poly[(i+1)%n];
        let ax=cu[0]-pr[0],ay=cu[1]-pr[1],bx=ne[0]-cu[0],by=ne[1]-cu[1];
        const la=Math.hypot(ax,ay),lb=Math.hypot(bx,by);if(!la||!lb)continue;
        ax/=la;ay/=la;bx/=lb;by/=lb;
        if(ax*by-ay*bx<=0)continue; // sólo esquinas convexas (poly CCW)
        const dot=ax*bx+ay*by;
        if(dot<bs){bs=dot;bi=i;}
      }
      if(bi>=0)return bi;
    }
    // 'cercano' (por defecto)
    let bi=0,bd=1e9;
    for(let i=0;i<n;i++){const d=Math.hypot(poly[i][0]+ox-cX,poly[i][1]+oy-cY);if(d<bd){bd=d;bi=i;}}
    return bi;
  }
  // ── Arc welding: convierte tramos rectos en arcos G2/G3 (archivos más livianos) ──
  function _circ(a,b,c){
    const ax=a[0],ay=a[1],bx=b[0],by=b[1],cx=c[0],cy=c[1];
    const d=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by));
    if(Math.abs(d)<1e-9)return null;
    const a2=ax*ax+ay*ay,b2=bx*bx+by*by,c2=cx*cx+cy*cy;
    return[(a2*(by-cy)+b2*(cy-ay)+c2*(ay-by))/d,(a2*(cx-bx)+b2*(ax-cx)+c2*(bx-ax))/d];
  }
  function _arcWeld(src){
    const TOL=0.04,MINR=0.6,MAXR=300,MINSEG=4,MAXSWEEP=5.7;
    const inL=src.split('\n'),out=[];
    let px=0,py=0,pe=0,lastF=0,run=[],anchor=null;
    const fx=v=>(+v).toFixed(3),fe=v=>(+v).toFixed(4);
    function emitRun(){
      if(!run.length)return;
      if(run.length<MINSEG){for(const m of run)out.push(`G1 X${fx(m.x)} Y${fx(m.y)} E${fe(m.e)} F${m.f}`);run=[];anchor=null;return;}
      const pts=[anchor,...run.map(m=>[m.x,m.y])];
      let i=0;
      while(i<pts.length-1){
        let bestJ=-1,bestC=null,bestDir=0,j=i+2;
        while(j<pts.length){
          const mid=(i+j)>>1,C=_circ(pts[i],pts[mid],pts[j]);
          if(!C)break;
          const R=Math.hypot(pts[i][0]-C[0],pts[i][1]-C[1]);
          if(R<MINR||R>MAXR)break;
          let ok=true,dir=0,cum=0,prevAng=Math.atan2(pts[i][1]-C[1],pts[i][0]-C[0]);
          for(let k=i+1;k<=j;k++){
            const rr=Math.hypot(pts[k][0]-C[0],pts[k][1]-C[1]);
            if(Math.abs(rr-R)>TOL){ok=false;break;}
            let ang=Math.atan2(pts[k][1]-C[1],pts[k][0]-C[0]),dA=ang-prevAng;
            while(dA>Math.PI)dA-=2*Math.PI;while(dA<-Math.PI)dA+=2*Math.PI;
            if(Math.abs(dA)<1e-6||Math.abs(dA)>2.6){ok=false;break;}
            const s=dA>0?1:-1;if(dir===0)dir=s;else if(s!==dir){ok=false;break;}
            cum+=dA;if(Math.abs(cum)>MAXSWEEP){ok=false;break;}
            prevAng=ang;
          }
          if(ok){bestJ=j;bestC=C;bestDir=dir;j++;}else break;
        }
        if(bestJ>=i+3){
          const C=bestC,g=bestDir<0?'G2':'G3',I=C[0]-pts[i][0],J=C[1]-pts[i][1],m=run[bestJ-1];
          out.push(`${g} X${fx(pts[bestJ][0])} Y${fx(pts[bestJ][1])} I${fx(I)} J${fx(J)} E${fe(m.e)} F${m.f}`);
          i=bestJ;
        }else{const m=run[i];out.push(`G1 X${fx(pts[i+1][0])} Y${fx(pts[i+1][1])} E${fe(m.e)} F${m.f}`);i++;}
      }
      run=[];anchor=null;
    }
    for(const raw of inL){
      const c=raw.trim();
      let nx=px,ny=py,ne=pe,nf=null,hasX=false,hasY=false,hasZ=false,hasE=false,isG=false;
      if(c.startsWith('G1')||c.startsWith('G0')){
        isG=true;
        for(const w of c.split(/\s+/)){if(!w)continue;const v=+w.slice(1);if(!isFinite(v))continue;
          if(w[0]==='X'){nx=v;hasX=true;}else if(w[0]==='Y'){ny=v;hasY=true;}else if(w[0]==='Z'){hasZ=true;}else if(w[0]==='E'){ne=v;hasE=true;}else if(w[0]==='F'){nf=v;}}
      }
      const extruding=isG&&c.startsWith('G1')&&hasX&&hasY&&hasE&&!hasZ&&ne>pe+1e-9;
      if(extruding){
        if(!run.length)anchor=[px,py];
        run.push({x:nx,y:ny,e:ne,f:nf!=null?nf:lastF});
        px=nx;py=ny;pe=ne;if(nf!=null)lastF=nf;
      }else{
        emitRun();out.push(raw);
        if(isG){px=nx;py=ny;if(hasE)pe=ne;if(nf!=null)lastF=nf;}
        else if(c.startsWith('G92')){const m=/E([-\d.]+)/.exec(c);if(m)pe=+m[1];}
      }
    }
    emitRun();
    return out.join('\n');
  }
  // ── EXCLUDE_OBJECT (Klipper): etiqueta cada pieza para poder cancelarla sin abortar la placa ──
  // Post-proceso: envuelve las extrusiones de cada objeto según su caja XY (las piezas no se solapan).
  function _wrapExcludeObject(gcode,objBBs,offX,offY){
    if(!objBBs||objBBs.length<2)return gcode;
    const M=1.0; // margen alrededor de cada caja
    const bbs=objBBs.map(b=>({name:b.name,x0:b.x0+offX-M,y0:b.y0+offY-M,x1:b.x1+offX+M,y1:b.y1+offY+M,cx:(b.x0+b.x1)/2+offX,cy:(b.y0+b.y1)/2+offY}));
    const which=(x,y)=>{for(let i=0;i<bbs.length;i++){const b=bbs[i];if(x>=b.x0&&x<=b.x1&&y>=b.y0&&y<=b.y1)return i;}return -1;};
    const lines=gcode.split('\n'),out=[];let x=0,y=0,cur=-1,injected=false;
    for(const ln of lines){
      if(!injected&&/^G92 E0/.test(ln)){out.push(ln);for(const b of bbs)out.push(`EXCLUDE_OBJECT_DEFINE NAME=${b.name} CENTER=${b.cx.toFixed(2)},${b.cy.toFixed(2)} POLYGON=[[${b.x0.toFixed(1)},${b.y0.toFixed(1)}],[${b.x1.toFixed(1)},${b.y0.toFixed(1)}],[${b.x1.toFixed(1)},${b.y1.toFixed(1)}],[${b.x0.toFixed(1)},${b.y1.toFixed(1)}]]`);injected=true;continue;}
      if(ln.charCodeAt(0)===71&&ln.startsWith('G1 ')){
        const mx=/X(-?[\d.]+)/.exec(ln),my=/Y(-?[\d.]+)/.exec(ln);
        const nx=mx?+mx[1]:x,ny=my?+my[1]:y;
        const isE=/E-?[\d.]/.test(ln)&&(nx!==x||ny!==y);
        if(isE){const w=which((nx+x)/2,(ny+y)/2);if(w!==cur){if(cur>=0)out.push(`EXCLUDE_OBJECT_END NAME=${bbs[cur].name}`);if(w>=0)out.push(`EXCLUDE_OBJECT_START NAME=${bbs[w].name}`);cur=w;}}
        out.push(ln);x=nx;y=ny;
      }else out.push(ln);
    }
    if(cur>=0)out.push(`EXCLUDE_OBJECT_END NAME=${bbs[cur].name}`);
    return out.join('\n');
  }
  // Despacho de patrón de relleno disperso
  function _infill(poly,spacing,pattern,li,z){
    if(pattern==='gyroid')return _gyroidFill(poly,spacing,z);
    if(pattern==='grid')return _scanfill(poly,spacing*2,45).concat(_scanfill(poly,spacing*2,135));
    if(pattern==='triangle'||pattern==='hex')return _scanfill(poly,spacing*3,0).concat(_scanfill(poly,spacing*3,60),_scanfill(poly,spacing*3,120));
    return _scanfill(poly,spacing,li%2?135:45); // linear
  }
  // Líneas de soporte activas en una capa: conecta columnas por fila y da cuerpo a cada una (cruz + zócalo)
  function _supportLinesAtLayer(cols,li,gs,p){
    const active=cols.filter(c=>c.top>=li&&c.bot<=li);
    if(!active.length)return[];
    const lines=[];
    // Conexión por filas (tramos contiguos) — evita columnas sueltas
    const rows=new Map();
    for(const c of active){const key=Math.round(c.y/gs);(rows.get(key)||rows.set(key,[]).get(key)).push(c);}
    for(const arr of rows.values()){
      arr.sort((a,b)=>a.x-b.x);let rs=arr[0],prev=arr[0];
      for(let i=1;i<arr.length;i++){
        if(arr[i].x-prev.x<=gs*1.6){prev=arr[i];}
        else{if(prev.x>rs.x)lines.push([[rs.x,rs.y],[prev.x,prev.y]]);rs=arr[i];prev=arr[i];}
      }
      if(prev.x>rs.x)lines.push([[rs.x,rs.y],[prev.x,prev.y]]);
    }
    // Cuerpo por columna: cruz (da grosor real, no un hilo) + base ensanchada en las primeras capas
    for(const c of active){
      const fromBot=c.bot!=null?li-c.bot:li;
      const r=gs*0.42+(fromBot<8?(8-fromBot)*0.05*gs:0);
      lines.push([[c.x-r,c.y],[c.x+r,c.y]]);
      lines.push([[c.x,c.y-r],[c.x,c.y+r]]);
    }
    return lines;
  }
  // ── Soportes tipo árbol ─────────────────────────────────────
  // hitFn(x,y,li) = ¿hay modelo ahí? → se usa para inclinar el tronco y esquivar la pieza
  function _buildTreeSupport(cols,hitFn,totalL){
    if(!cols||!cols.length)return[];
    // Clustering local ACOTADO: cada contacto se une al cluster cuyo centroide
    // esté más cerca dentro de MERGE_R; si ninguno, abre uno nuevo. Evita el
    // encadenamiento transitivo (union-find) que fusionaba contactos lejanos en
    // muy pocos troncos y dejaba ramas largas flotando hacia contactos inalcanzables.
    const MERGE_R=6; // = radio máx del cluster (mm) → ramas cortas e imprimibles
    const clusters=[];
    for(const c of cols){
      let best=null,bd=MERGE_R;
      for(const cl of clusters){const d=Math.hypot(c.x-cl.cx,c.y-cl.cy);if(d<bd){bd=d;best=cl;}}
      if(best){best.mem.push(c);best.cx+=(c.x-best.cx)/best.mem.length;best.cy+=(c.y-best.cy)/best.mem.length;}
      else clusters.push({mem:[c],cx:c.x,cy:c.y});
    }
    const MAXSTEP=0.45; // desplazamiento horizontal máximo por capa (imprimible)
    return clusters.map(({mem})=>{
      const cx=mem.reduce((s,c)=>s+c.x,0)/mem.length;
      const cy=mem.reduce((s,c)=>s+c.y,0)/mem.length;
      const reach=Math.max(0.01,...mem.map(c=>Math.hypot(c.x-cx,c.y-cy))); // alcance horizontal de ramas
      const topLi=Math.max(...mem.map(c=>c.top));
      const baseLi=Math.min(...mem.map(c=>c.bot));
      // Camino del tronco (de arriba hacia abajo): si entra en la pieza, se desvía gradualmente; si está libre, vuelve bajo el contacto
      const path=new Array(topLi+1);let x=cx,y=cy;
      for(let li=topLi;li>=baseLi;li--){
        if(hitFn&&hitFn(x,y,li)){
          // buscar la salida libre más cercana (anillos crecientes) y avanzar hacia ella, capado por capa
          let best=null;
          for(let rad=1;rad<=16&&!best;rad+=1.5)for(let a=0;a<12&&!best;a++){const an=a*Math.PI/6,nx=x+Math.cos(an)*rad,ny=y+Math.sin(an)*rad;if(!hitFn(nx,ny,li))best={nx,ny};}
          if(best){const dx=best.nx-x,dy=best.ny-y,d=Math.hypot(dx,dy)||1,s=Math.min(d,MAXSTEP);x+=dx/d*s;y+=dy/d*s;}
        }else{
          const dx=cx-x,dy=cy-y,d=Math.hypot(dx,dy);
          if(d>0.01){const s=Math.min(d,MAXSTEP*0.5);x+=dx/d*s;y+=dy/d*s;}
        }
        if(!isFinite(x)||!isFinite(y)){x=cx;y=cy;}
        path[li]={x,y};
      }
      return{mem,cx,cy,topLi,baseLi,path,reach};
    });
  }
  function _treeSupportAtLayer(trees,li,extW,p){
    if(!trees||!trees.length)return[];
    const lines=[];
    for(const tree of trees){
      const{mem,cx,cy,topLi,baseLi,path,reach}=tree;
      const active=mem.filter(c=>c.top>=li&&c.bot<=li);
      if(!active.length)continue;
      const tc=(path&&path[li])||{x:cx,y:cy}; // centro del tronco en esta capa (camino que esquiva la pieza)
      // Altura de la zona de ramas proporcional al alcance horizontal → suben a ~45°
      // (imprimibles) en vez de un nº fijo de capas que con capa fina (0.12mm) flotaba.
      const BRANCH=Math.max(6,Math.ceil((reach||1)/Math.max(0.08,(p&&p.layerHeight)||0.2)));
      if(li>=topLi-BRANCH){
        // Zona de ramas: UNA línea fina del tronco a cada contacto + punta (snap-off fácil)
        const prog=Math.max(0,(li-(topLi-BRANCH))/BRANCH); // 0 = tronco, 1 = contacto
        for(const c of active){
          const bx=tc.x+(c.x-tc.x)*prog,by=tc.y+(c.y-tc.y)*prog;
          const ax=tc.x+(c.x-tc.x)*Math.max(0,prog-0.5),ay=tc.y+(c.y-tc.y)*Math.max(0,prog-0.5);
          lines.push([[ax,ay],[bx,by]]); // rama: una sola línea (ligera)
          if(li>=c.top-1){const r=li>=c.top?extW*0.8:extW*1.4;lines.push([[c.x-r,c.y],[c.x+r,c.y]]);if(li<c.top)lines.push([[c.x,c.y-r],[c.x,c.y+r]]);}
        }
      }else{
        // Tronco fino tipo tubo: solo contorno octogonal (sin celosía maciza) → ligero y retirable
        const fromBot=li-baseLi;
        let R=Math.min(2.2,1.0+mem.length*0.15);
        if(fromBot<8)R+=(8-fromBot)*0.12; // pequeño zócalo de adhesión en las primeras capas
        const SEG=8,pts=[];
        for(let a=0;a<SEG;a++){const an=a/SEG*2*Math.PI;pts.push([tc.x+Math.cos(an)*R,tc.y+Math.sin(an)*R]);}
        for(let a=0;a<SEG;a++)lines.push([pts[a],pts[(a+1)%SEG]]);
        if(R>1.7)lines.push([[tc.x-R*0.6,tc.y],[tc.x+R*0.6,tc.y]]); // refuerzo único solo si el tronco es ancho
      }
    }
    return lines;
  }
  // ── Adaptive layer heights ──────────────────────────────────
  async function _buildAdaptiveLayers(sliceZFn,p,zMax){
    const minLH=Math.max(0.05,+(p.layerHeight*0.45).toFixed(2));
    const maxLH=Math.min(+(p.layerHeight*1.4).toFixed(2),0.4);
    const STEP=maxLH;
    const samples=[];
    for(let z=STEP;z<=zMax+STEP;z+=STEP){
      const cs=sliceZFn(Math.min(z,zMax)).filter(c=>c.length>=3);
      samples.push(cs.reduce((s,c)=>s+Math.abs(_polyArea(c)),0));
    }
    // Normalise slope
    const slopes=samples.map((a,i)=>i===0||i===samples.length-1?0:Math.abs(samples[i+1]-samples[i-1])/(2*STEP));
    const maxSlope=Math.max(...slopes,1);
    const lhs=[p.firstLayerHeight];
    let zSum=p.firstLayerHeight,si=0;
    while(zSum<zMax-0.001){
      while(si<slopes.length-1&&(si+1)*STEP<=zSum)si++;
      const sn=Math.min(1,slopes[si]/maxSlope);
      let lh=+(maxLH-(maxLH-minLH)*sn).toFixed(2);
      lh=Math.round(lh/0.05)*0.05;
      lh=Math.max(minLH,Math.min(maxLH,Math.min(lh,zMax-zSum)));
      if(lh<minLH*0.15)break;
      lhs.push(lh);zSum+=lh;
    }
    return lhs;
  }
  // Estado de wipe: dirección del último segmento impreso → se limpia hacia atrás sobre él al retraer
  let _wipeState={dx:0,dy:0,has:false};
  function _setWipe(ax,ay,bx,by){const dx=bx-ax,dy=by-ay,l=Math.hypot(dx,dy);if(l>1e-4){_wipeState={dx:dx/l,dy:dy/l,has:true};}}
  // Retracción + viaje (con wipe y z-hop) centralizado → devuelve [E, x, y] en el destino
  function _retractTravel(gc,cX,cY,sx,sy,z,E,p,td){
    if(p.wipeDist>0&&_wipeState.has){
      const wx=cX-_wipeState.dx*p.wipeDist,wy=cY-_wipeState.dy*p.wipeDist;
      E-=p.retractDist;
      if(isFinite(wx)&&isFinite(wy))gc.push(`G1 X${wx.toFixed(3)} Y${wy.toFixed(3)} E${E.toFixed(4)} F${Math.round(p.retractSpeed*60)} ; wipe`);
      else gc.push(`G1 E${E.toFixed(4)} F${p.retractSpeed*60}`);
    }else{
      E-=p.retractDist;gc.push(`G1 E${E.toFixed(4)} F${p.retractSpeed*60}`);
    }
    if(p.zHop>0&&td>5)gc.push(`G1 Z${(z+p.zHop).toFixed(3)} F600`);
    gc.push(`G1 X${sx.toFixed(3)} Y${sy.toFixed(3)} F${p.travelSpeed*60}`);
    if(p.zHop>0&&td>5)gc.push(`G1 Z${z.toFixed(3)} F600`);
    E+=p.retractDist;gc.push(`G1 E${E.toFixed(4)} F${p.retractSpeed*60}`);
    return[E,sx,sy];
  }
  function _printPoly(gc,poly,z,ox,oy,cX,cY,E,lh,extW,feed,p,fuzzy,ohTest,ohFeed,scarf){
    const bi=_seamStart(poly,p&&p.seamMode,cX,cY,ox,oy);
    let ord=[...poly.slice(bi),...poly.slice(0,bi)];
    // Piel rugosa (fuzzy skin): resamplea el contorno al paso indicado y perturba cada punto a lo largo de su normal
    if(fuzzy&&p&&p.fuzzySkin>0){
      const pd=Math.max(0.2,p.fuzzyPointDist||0.4),rs=[];
      for(let i=0;i<ord.length;i++){const a=ord[i],b=ord[(i+1)%ord.length];rs.push(a);const d=Math.hypot(b[0]-a[0],b[1]-a[1]),steps=Math.floor(d/pd);for(let k=1;k<steps;k++){const t=k/steps;rs.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}
      const n=rs.length;
      ord=rs.map((pt,i)=>{const pr=rs[(i-1+n)%n],ne=rs[(i+1)%n];let nx=pr[1]-ne[1],ny=ne[0]-pr[0];const l=Math.hypot(nx,ny)||1;const r=(Math.random()*2-1)*p.fuzzySkin;return[pt[0]+nx/l*r,pt[1]+ny/l*r];});
    }
    // Defensa en profundidad: descarta cualquier punto no-finito antes de imprimir (jamás un G1 XNaN)
    ord=ord.filter(pt=>isFinite(pt[0])&&isFinite(pt[1]));
    if(ord.length<3)return[E,cX,cY];
    const sx=ord[0][0]+ox,sy=ord[0][1]+oy;
    // Solo retraer/z-hop si el salto es real — evita retracciones inútiles entre paredes concéntricas
    const td=Math.hypot(sx-cX,sy-cY),doRet=td>Math.max(extW*3,(p.retractMinTravel||0));
    if(doRet){[E,cX,cY]=_retractTravel(gc,cX,cY,sx,sy,z,E,p,td);}
    else{gc.push(`G1 X${sx.toFixed(3)} Y${sy.toFixed(3)} F${p.travelSpeed*60}`);cX=sx;cY=sy;}
    // Recorrido absoluto cerrado + coasting (deja de extruir en los últimos `coast` mm para evitar blob de costura)
    const pts=[];for(let i=0;i<=ord.length;i++){const pt=ord[i%ord.length];pts.push([pt[0]+ox,pt[1]+oy]);}
    let total=0;for(let i=1;i<pts.length;i++)total+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
    // Costura scarf: imprime el lazo con rampa de flujo al inicio y un solape decreciente al final → costura casi invisible
    if(scarf>0&&total>scarf*2.2){
      let acc2=0;
      for(let i=1;i<pts.length;i++){
        const qx=pts[i][0],qy=pts[i][1];if(!isFinite(qx)||!isFinite(qy)){continue;}
        const seg=Math.hypot(qx-cX,qy-cY),mid=acc2+seg/2;
        const f=mid<scarf?Math.max(0.05,mid/scarf):1; // rampa de subida en los primeros `scarf` mm
        const sf=(ohTest&&ohFeed&&ohTest((cX+qx)/2,(cY+qy)/2))?ohFeed:feed;
        E+=(seg*extW*lh*f)/FILA_AREA;gc.push(`G1 X${qx.toFixed(3)} Y${qy.toFixed(3)} E${E.toFixed(4)} F${sf}`);
        acc2+=seg;cX=qx;cY=qy;
      }
      // Solape: re-traza el inicio con flujo decreciente (1→0)
      let ov=0;
      for(let i=1;i<pts.length&&ov<scarf;i++){
        const qx=pts[i][0],qy=pts[i][1];if(!isFinite(qx)||!isFinite(qy))break;
        const seg=Math.hypot(qx-cX,qy-cY)||1e-6,use=Math.min(seg,scarf-ov);
        const tt=use/seg,ex=cX+(qx-cX)*tt,ey=cY+(qy-cY)*tt;
        const f=Math.max(0,1-(ov+use/2)/scarf);
        E+=(use*extW*lh*f)/FILA_AREA;gc.push(`G1 X${ex.toFixed(3)} Y${ey.toFixed(3)} E${E.toFixed(4)} F${feed}`);
        ov+=use;cX=ex;cY=ey;
      }
      if(pts.length>=2)_setWipe(pts[pts.length-2][0],pts[pts.length-2][1],cX,cY);
      return[E,cX,cY];
    }
    const coast=(p&&p.coasting)||0,coastStart=total-coast;
    let acc=0;
    for(let i=1;i<pts.length;i++){
      const qx=pts[i][0],qy=pts[i][1];
      if(!isFinite(qx)||!isFinite(qy))continue;
      const seg=Math.hypot(qx-cX,qy-cY);
      // Velocidad reducida en voladizos: si el punto medio del segmento está sobre aire, usa ohFeed
      const sf=(ohTest&&ohFeed&&ohTest((cX+qx)/2,(cY+qy)/2))?ohFeed:feed;
      if(coast>0&&acc<coastStart&&acc+seg>coastStart){
        const tt=(coastStart-acc)/seg,mx=cX+(qx-cX)*tt,my=cY+(qy-cY)*tt;
        E+=(Math.hypot(mx-cX,my-cY)*extW*lh)/FILA_AREA;gc.push(`G1 X${mx.toFixed(3)} Y${my.toFixed(3)} E${E.toFixed(4)} F${sf}`);
        gc.push(`G1 X${qx.toFixed(3)} Y${qy.toFixed(3)} F${sf}`);
      }else if(coast>0&&acc>=coastStart){
        gc.push(`G1 X${qx.toFixed(3)} Y${qy.toFixed(3)} F${sf}`);
      }else{
        E+=(seg*extW*lh)/FILA_AREA;gc.push(`G1 X${qx.toFixed(3)} Y${qy.toFixed(3)} E${E.toFixed(4)} F${sf}`);
      }
      acc+=seg;cX=qx;cY=qy;
    }
    if(pts.length>=2)_setWipe(pts[pts.length-2][0],pts[pts.length-2][1],cX,cY);
    return[E,cX,cY];
  }
  // Arachne: pared de ancho variable — igual que _printPoly pero con E escalado por wRatio (0..1)
  function _printPolyScaled(gc,poly,z,ox,oy,cX,cY,E,lh,extW,wRatio,feed,p){
    const bi=_seamStart(poly,p&&p.seamMode,cX,cY,ox,oy);
    const ord=[...poly.slice(bi),...poly.slice(0,bi)];
    const sx=ord[0][0]+ox,sy=ord[0][1]+oy,td=Math.hypot(sx-cX,sy-cY);
    if(td>Math.max(extW*3,(p.retractMinTravel||0))){[E,cX,cY]=_retractTravel(gc,cX,cY,sx,sy,z,E,p,td);}
    else{gc.push(`G1 X${sx.toFixed(3)} Y${sy.toFixed(3)} F${p.travelSpeed*60}`);cX=sx;cY=sy;}
    const pts=[];for(let i=0;i<=ord.length;i++){const pt=ord[i%ord.length];pts.push([pt[0]+ox,pt[1]+oy]);}
    for(let i=1;i<pts.length;i++){
      const qx=pts[i][0],qy=pts[i][1];
      if(!isFinite(qx)||!isFinite(qy))continue;
      const seg=Math.hypot(qx-cX,qy-cY);
      E+=(seg*extW*lh*wRatio)/FILA_AREA;gc.push(`G1 X${qx.toFixed(3)} Y${qy.toFixed(3)} E${E.toFixed(4)} F${feed}`);
      cX=qx;cY=qy;
    }
    if(pts.length>=2)_setWipe(pts[pts.length-2][0],pts[pts.length-2][1],cX,cY);
    return[E,cX,cY];
  }
  // Spiralize: imprime el perímetro exterior con Z creciendo continuamente (sin costura de capa)
  function _printPolySpiralZ(gc,poly,zStart,zEnd,ox,oy,cX,cY,E,lh,extW,feed,p){
    const bi=_seamStart(poly,p&&p.seamMode,cX,cY,ox,oy);
    const ord=[...poly.slice(bi),...poly.slice(0,bi)];
    const sx=ord[0][0]+ox,sy=ord[0][1]+oy,td=Math.hypot(sx-cX,sy-cY);
    if(td>extW*3){
      E-=p.retractDist;gc.push(`G1 E${E.toFixed(4)} F${p.retractSpeed*60}`);
      gc.push(`G1 X${sx.toFixed(3)} Y${sy.toFixed(3)} Z${zStart.toFixed(3)} F${p.travelSpeed*60}`);
      E+=p.retractDist;gc.push(`G1 E${E.toFixed(4)} F${p.retractSpeed*60}`);
    }else{gc.push(`G1 X${sx.toFixed(3)} Y${sy.toFixed(3)} F${p.travelSpeed*60}`);}
    cX=sx;cY=sy;
    // Calcular longitud total del perímetro cerrado
    const pts=[];for(let i=0;i<=ord.length;i++){const pt=ord[i%ord.length];pts.push([pt[0]+ox,pt[1]+oy]);}
    let totalLen=0;for(let i=1;i<pts.length;i++)totalLen+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
    let acc=0;
    for(let i=1;i<pts.length;i++){
      const qx=pts[i][0],qy=pts[i][1];
      if(!isFinite(qx)||!isFinite(qy))continue;
      const seg=Math.hypot(qx-cX,qy-cY);
      acc+=seg;
      const zz=totalLen>0?zStart+(acc/totalLen)*(zEnd-zStart):zEnd;
      E+=(seg*extW*lh)/FILA_AREA;gc.push(`G1 X${qx.toFixed(3)} Y${qy.toFixed(3)} Z${zz.toFixed(3)} E${E.toFixed(4)} F${feed}`);
      cX=qx;cY=qy;
    }
    return[E,cX,cY];
  }
  // Ordena segmentos por vecino más cercano (greedy) → minimiza viajes. Crucial para
  // el soporte: muchas islas dispersas impresas en orden de generación = spaghetti de viajes.
  function _orderLines(lines,sx,sy){
    if(!lines||lines.length<3||lines.length>4000)return lines; // tope: evita O(n²) en capas enormes
    const used=new Array(lines.length).fill(false),out=[];let px=sx,py=sy;
    for(let k=0;k<lines.length;k++){
      let bi=-1,bd=Infinity,flip=false;
      for(let i=0;i<lines.length;i++){if(used[i])continue;const a=lines[i][0],b=lines[i][1];
        const da=(a[0]-px)*(a[0]-px)+(a[1]-py)*(a[1]-py),db=(b[0]-px)*(b[0]-px)+(b[1]-py)*(b[1]-py);
        if(da<bd){bd=da;bi=i;flip=false;}if(db<bd){bd=db;bi=i;flip=true;}}
      used[bi]=true;const s=flip?[lines[bi][1],lines[bi][0]]:lines[bi];out.push(s);px=s[1][0];py=s[1][1];
    }
    return out;
  }
  function _printLines(gc,lines,z,ox,oy,cX,cY,E,lh,extW,feed,p,retractThresh,optimize){
    if(optimize)lines=_orderLines(lines,cX-ox,cY-oy); // reordena para minimizar viajes (soporte)
    const rt=Math.max(retractThresh||extW*3,(p.retractMinTravel||0)); // combing + viaje mínimo: menos retracciones
    for(const[p1,p2]of lines){
      const sx=p1[0]+ox,sy=p1[1]+oy,ex=p2[0]+ox,ey=p2[1]+oy;
      if(!isFinite(sx)||!isFinite(sy)||!isFinite(ex)||!isFinite(ey))continue;
      const td=Math.hypot(sx-cX,sy-cY);
      if(td>rt){[E,cX,cY]=_retractTravel(gc,cX,cY,sx,sy,z,E,p,td);}
      else{gc.push(`G1 X${sx.toFixed(3)} Y${sy.toFixed(3)} F${p.travelSpeed*60}`);cX=sx;cY=sy;}
      E+=(Math.hypot(ex-sx,ey-sy)*extW*lh)/FILA_AREA;
      gc.push(`G1 X${ex.toFixed(3)} Y${ey.toFixed(3)} E${E.toFixed(4)} F${feed}`);cX=ex;cY=ey;
      _setWipe(sx,sy,ex,ey);
    }
    return[E,cX,cY];
  }
  // Tiempo mínimo de capa: si la capa imprime en < minSec, ralentiza SOLO los movimientos de extrusión
  // (no los viajes) para dar tiempo a enfriar. Devuelve true si ralentizó (→ subir ventilador).
  function _applyMinLayerTime(gc,fromIdx,minSec){
    if(!(minSec>0))return false;
    let x=null,y=null,extT=0,travT=0;const extIdx=[];
    for(let i=fromIdx;i<gc.length;i++){
      const c=gc[i];if(c.charCodeAt(0)!==71||!(c.startsWith('G1 ')||c.startsWith('G0 ')))continue; // 71='G'
      const mx=/X(-?[\d.]+)/.exec(c),my=/Y(-?[\d.]+)/.exec(c),mf=/F([\d.]+)/.exec(c);
      const nx=mx?+mx[1]:x,ny=my?+my[1]:y,f=mf?+mf[1]:null;
      const isE=/E-?[\d.]/.test(c);
      if(x!=null&&f&&(nx!==x||ny!==y)){const d=Math.hypot(nx-x,ny-y),t=d/(f/60);if(isE){extT+=t;extIdx.push(i);}else travT+=t;}
      if(mx)x=nx;if(my)y=ny;
    }
    const total=extT+travT;
    if(total>=minSec||extT<=0)return false;
    const targetExt=Math.max(0.01,minSec-travT);
    let factor=extT/targetExt;if(factor>1)factor=1;if(factor<0.08)factor=0.08; // tope ~12× más lento
    const minF=8*60; // nunca por debajo de 8 mm/s
    for(const i of extIdx)gc[i]=gc[i].replace(/F([\d.]+)/,(m,f)=>'F'+Math.max(minF,Math.round(+f*factor)));
    return true;
  }
  // ── Web Worker para el precompute de contornos (la etapa más pesada) ──
  // Se construye desde el .toString() de las funciones puras reales → sin duplicar código.
  // El worker recibe la malla y devuelve las capas; el hilo principal queda libre (UI fluida).
  let _slWorkerURL=null;
  function _slWorkerURLGet(){
    if(_slWorkerURL)return _slWorkerURL;
    const kernel=[_polyArea,_bbOf,_pointInPoly,_depthBB,_buildContours,_activeSweeper].map(f=>f.toString()).join('\n');
    const body=kernel+`
self.onmessage=function(ev){
  try{
    var d=ev.data,tris=d.tris,sortedIdx=d.sortedIdx,triZmin=d.triZmin,triZmax=d.triZmax,lhs=d.lhs;
    var totalL=lhs.length;
    var layerTopZ=[],layerPolys=[],layerParity=[],layerNetArea=[],layerBB=[];
    var sweep=_activeSweeper(tris,sortedIdx,triZmin,triZmax),z=0;
    for(var li=0;li<totalL;li++){
      z+=lhs[li];layerTopZ.push(z);
      var cs=sweep(z-lhs[li]/2).filter(function(c){return c.length>=3;}).map(function(c){return _polyArea(c)<0?c.slice().reverse():c;});
      cs.sort(function(a,b){return Math.abs(_polyArea(b))-Math.abs(_polyArea(a));});
      var bbs=cs.map(_bbOf),areas=cs.map(function(c){return Math.abs(_polyArea(c));});
      layerPolys.push(cs);layerBB.push(bbs);
      var par=cs.map(function(ct,ci){return _depthBB(ci,cs,bbs)%2===1;});layerParity.push(par);
      layerNetArea.push(cs.reduce(function(s,_,ci){return s+(par[ci]?-1:1)*areas[ci];},0));
      if(li%16===0)self.postMessage({progress:li/totalL});
    }
    self.postMessage({done:true,layerTopZ:layerTopZ,layerPolys:layerPolys,layerParity:layerParity,layerNetArea:layerNetArea,layerBB:layerBB});
  }catch(e){self.postMessage({error:String(e&&e.message||e)});}
};`;
    _slWorkerURL=URL.createObjectURL(new Blob([body],{type:'application/javascript'}));
    return _slWorkerURL;
  }
  // Calcula las capas en un worker; ante cualquier fallo cae al cálculo en hilo principal (idéntico resultado).
  function _precomputeLayers(tris,sortedIdx,triZmin,triZmax,lhs,totalL,onProg){
    const inline=()=>{
      const layerTopZ=[],layerPolys=[],layerParity=[],layerNetArea=[],layerBB=[];
      const sweep=_activeSweeper(tris,sortedIdx,triZmin,triZmax);let z=0;
      for(let li=0;li<totalL;li++){
        z+=lhs[li];layerTopZ.push(z);
        let cs=sweep(z-lhs[li]/2).filter(c=>c.length>=3).map(c=>_polyArea(c)<0?[...c].reverse():c);
        cs.sort((a,b)=>Math.abs(_polyArea(b))-Math.abs(_polyArea(a)));
        const bbs=cs.map(_bbOf),areas=cs.map(c=>Math.abs(_polyArea(c)));
        layerPolys.push(cs);layerBB.push(bbs);
        const par=cs.map((ct,ci)=>_depthBB(ci,cs,bbs)%2===1);layerParity.push(par);
        layerNetArea.push(cs.reduce((s,_,ci)=>s+(par[ci]?-1:1)*areas[ci],0));
      }
      return{layerTopZ,layerPolys,layerParity,layerNetArea,layerBB};
    };
    return new Promise(resolve=>{
      if(typeof Worker==='undefined'||typeof URL==='undefined'||typeof Blob==='undefined'){resolve(inline());return;}
      let w=null,settled=false;
      const done=v=>{if(settled)return;settled=true;try{w&&w.terminate();}catch(e){}resolve(v);};
      try{
        w=new Worker(_slWorkerURLGet());
        w.onerror=()=>done(inline()); // fallback transparente
        w.onmessage=ev=>{
          const m=ev.data;
          if(m.progress!=null){if(onProg)onProg(m.progress);return;}
          if(m.error){done(inline());return;}
          if(m.done)done({layerTopZ:m.layerTopZ,layerPolys:m.layerPolys,layerParity:m.layerParity,layerNetArea:m.layerNetArea,layerBB:m.layerBB});
        };
        // Copias estructuradas (no transferibles: tris/índices se reutilizan en el hilo principal)
        w.postMessage({tris,sortedIdx,triZmin,triZmax,lhs});
      }catch(e){done(inline());}
    });
  }
  async function _nativeSlice(tris,p,spec,nozD,matName,modelName){
    const extW=nozD*1.05;
    const offX=spec.x/2,offY=spec.y/2;
    const gc=[];let E=0;
    // ── Header ───────────────────────────────────
    gc.push('; The Lab Solutions — Native AI Slicer');
    gc.push(`; ${S.name} | ${modelName} | ${matName} | boquilla:${nozD}mm capa:${p.layerHeight}mm relleno:${p.infillPct}%`);
    if(p.supports)gc.push('; soportes activados — columnas en rejilla bajo voladizos (básicos, retirar a mano)');
    // G-code de inicio: plantilla por impresora (Klipper PRINT_START / Marlin) o secuencia por defecto
    const _gcVars={nozzle:p.nozzleTemp,bed:p.bedTemp,accel:p.accel||0,flow:Math.round(p.flowRatio||100),pa:(+p.pressureAdvance||0).toFixed(4),first_layer_height:p.firstLayerHeight,material:matName,model:modelName};
    const _startTpl=(localStorage.getItem('sl_startgcode_'+modelName)||'').trim();
    const _layerTpl=(localStorage.getItem('sl_layergcode_'+modelName)||'').trim();
    if(_startTpl)_sub(_startTpl,_gcVars).split('\n').forEach(l=>gc.push(l));
    else{gc.push('M140 S'+p.bedTemp);gc.push('M104 S'+p.nozzleTemp);gc.push('G28');gc.push('M190 S'+p.bedTemp);gc.push('M109 S'+p.nozzleTemp);}
    gc.push('G21 ; mm');gc.push('G90 ; absoluto XYZ');gc.push('M82 ; E absoluto');gc.push('G92 E0');
    if(p.accel>0)gc.push('M204 S'+p.accel+' ; aceleración');
    if(p.jerk>0)gc.push('M205 X'+(+p.jerk).toFixed(1)+' Y'+(+p.jerk).toFixed(1)+' ; jerk (Marlin)');
    if(p.flowRatio&&Math.round(p.flowRatio)!==100)gc.push('M221 S'+Math.round(p.flowRatio)+' ; flujo %');
    if(p.pressureAdvance>0)gc.push('SET_PRESSURE_ADVANCE ADVANCE='+(+p.pressureAdvance).toFixed(4)+' ; pressure advance (Klipper)');
    // Línea de purga
    const purgeY0=5,purgeY1=Math.min(spec.y-5,55);
    gc.push(`G1 Z${p.firstLayerHeight.toFixed(3)} F600`);gc.push(`G1 X3 Y${purgeY0} F3000`);
    E+=(purgeY1-purgeY0)*extW*p.firstLayerHeight/FILA_AREA;
    gc.push(`G1 X3 Y${purgeY1} E${E.toFixed(4)} F${p.firstLayerSpeed*60}`);
    gc.push('G92 E0');E=0;gc.push('G1 Z2 F900');
    gc.push('; <<<BODY_START>>>'); // marcador para impresión secuencial (separar prólogo/cuerpo/epílogo)
    // ── Índice de triángulos ordenado por Zmin (sweep line) — construido una sola vez ───
    const zMax=S.stats.dz;
    const triCnt=tris.length/9;
    const triZmin=new Float32Array(triCnt),triZmax=new Float32Array(triCnt);
    for(let i=0;i<triCnt;i++){
      const b=i*9,z0=tris[b+2],z1=tris[b+5],z2=tris[b+8];
      triZmin[i]=Math.min(z0,z1,z2);triZmax[i]=Math.max(z0,z1,z2);
    }
    const sortedIdx=Array.from({length:triCnt},(_,i)=>i).sort((a,b)=>triZmin[a]-triZmin[b]);
    const sliceZ=(z)=>_sliceIdx(tris,sortedIdx,triZmin,triZmax,z);
    // ── Calcular alturas de capa (fijas o adaptativas, reutilizando el mismo índice) ──
    let lhs;
    if(p.adaptiveLayerHeight){
      setProg(2.5,'Calculando alturas de capa adaptativas…');await new Promise(r=>setTimeout(r,0));
      lhs=await _buildAdaptiveLayers(sliceZ,p,zMax);
    }else{
      lhs=[p.firstLayerHeight];let zSum=p.firstLayerHeight;
      while(zSum<zMax-0.001){const lh=Math.min(p.layerHeight,zMax-zSum);if(lh<p.layerHeight*0.15)break;lhs.push(lh);zSum+=lh;}
    }
    const totalL=lhs.length;
    setProg(3,`${totalL} capas para ${zMax.toFixed(1)}mm${p.adaptiveLayerHeight?' (adaptativas)':''}…`);
    await new Promise(r=>setTimeout(r,0));
    // ── Precomputar contornos por capa (sweep activo: O(triángulos que cruzan) por capa, no O(todos)) ──
    //    Se ejecuta en un Web Worker (UI fluida); si no hay soporte cae al hilo principal con resultado idéntico.
    const _pre=await _precomputeLayers(tris,sortedIdx,triZmin,triZmax,lhs,totalL,
      f=>setProg(3+f*1.5,`Calculando contornos… ${Math.round(f*100)}%`));
    const layerTopZ=_pre.layerTopZ,layerPolys=_pre.layerPolys,layerParity=_pre.layerParity,layerNetArea=_pre.layerNetArea,layerBB=_pre.layerBB;
    // ── Ajustes por pieza: mapa (x,y)→objeto y overrides de relleno/perímetros/soporte ──
    const _objBBs=S.objBBs||[],_objSet=S.objSettings||[];
    const _hasObjSet=_objBBs.length>1&&_objSet.some(s=>s&&((s.infillPct!==''&&s.infillPct!=null)||s.infillType||(s.shells!==''&&s.shells!=null)||s.supports));
    const _objIdx=(x,y)=>{for(let i=0;i<_objBBs.length;i++){const b=_objBBs[i];if(x>=b.x0-1&&x<=b.x1+1&&y>=b.y0-1&&y<=b.y1+1)return i;}return -1;};
    const _objParams=(base,oi)=>{const s=_objSet[oi];if(!s)return base;const o=Object.assign({},base);const cl=(v,a,b)=>Math.max(a,Math.min(b,Math.round(+v)));if(s.infillPct!==''&&s.infillPct!=null)o.infillPct=cl(s.infillPct,0,100);if(s.infillType)o.infillType=s.infillType;if(s.shells!==''&&s.shells!=null)o.shells=cl(s.shells,1,8);return o;};
    const _objSupOff=(x,y)=>_hasObjSet&&((s)=>s&&s.supports==='no')(_objSet[_objIdx(x,y)]);
    const _objSupOn=(x,y)=>((s)=>s&&s.supports==='sí')(_objSet[_objIdx(x,y)]);
    const _hasObjSupOn=_objBBs.length>1&&_objSet.some(s=>s&&s.supports==='sí');
    // ── Soportes: columnas bajo voladizos (rejilla o árbol) ──
    let supCols=null,supTrees=null;const SUP_GS=p.supGrid||3;
    const gapLayers=Math.max(0,Math.round((p.supZGap||0)/p.layerHeight)); // separación de aire (capas) entre soporte y pieza
    const ifaceLayers=Math.max(0,Math.round(p.supInterface!=null?p.supInterface:2)); // capas de interfaz densa justo bajo la pieza
    const _hasEnforce=(S.supRegions||[]).some(r=>r.mode==='enforce');
    if(p.supports||_hasEnforce||_hasObjSupOn){
      setProg(3.5,'Calculando soportes…');await new Promise(r=>setTimeout(r,0));
      const dx=S.stats.dx,dy=S.stats.dy,minZ=Math.max(0.8,lhs[0]+0.4),cols=[];
      // ¿Hay material sólido en (x,y) en la capa li? Regla par-impar → los agujeros cuentan como aire.
      const hit=(x,y,li)=>{const ps=layerPolys[li],bbs=layerBB[li];let inside=false;for(let k=0;k<ps.length;k++){const b=bbs[k];if(x<b[0]||x>b[2]||y<b[1]||y>b[3])continue;if(_pointInPoly(x,y,ps[k]))inside=!inside;}return inside;};
      // Regiones de soporte (opcional): bloquear o forzar soporte en cajas XY·Z. Sin regiones → sin efecto.
      const regs=S.supRegions||[];
      const inRegXY=(r,x,y)=>x>=Math.min(r.x0,r.x1)&&x<=Math.max(r.x0,r.x1)&&y>=Math.min(r.y0,r.y1)&&y<=Math.max(r.y0,r.y1);
      const inRegZ=(r,z)=>z>=r.zMin-1e-6&&z<=r.zMax+1e-6;
      const blocked=(x,y,z)=>regs.some(r=>r.mode==='block'&&inRegXY(r,x,y)&&inRegZ(r,z));
      const enforced=(x,y,z)=>regs.some(r=>r.mode==='enforce'&&inRegXY(r,x,y)&&inRegZ(r,z));
      for(let gx=-dx/2+SUP_GS/2;gx<dx/2;gx+=SUP_GS)for(let gy=-dy/2+SUP_GS/2;gy<dy/2;gy+=SUP_GS){
        // Presencia de material por capa en esta columna (una sola pasada)
        const sol=new Array(totalL);
        for(let li=0;li<totalL;li++)sol[li]=hit(gx,gy,li);
        // Detectar TODOS los voladizos de la columna: material en li con aire justo debajo (li-1).
        // Antes sólo se miraba la primera capa con material → se perdían voladizos sobre material ya impreso.
        for(let li=1;li<totalL;li++){
          if(!sol[li]||sol[li-1])continue;            // sólo transiciones aire→sólido
          const cz=layerTopZ[li];
          if(cz<=minZ)continue;                        // muy cerca de la cama, se imprime directo
          if(blocked(gx,gy,cz))continue;               // región bloquea soporte aquí
          // Auto-soporte por ángulo: si la capa de abajo tiene material a ≤ tol (= altura·tan(ángulo)),
          // el voladizo es suave y se sostiene solo → no necesita soporte. Honra p.supportAngle.
          const tol=Math.max(0.1,lhs[li]*Math.tan((p.supportAngle||50)*Math.PI/180));
          let selfSup=false;
          for(let a=0;a<8&&!selfSup;a++){const an=a*Math.PI/4;if(hit(gx+tol*Math.cos(an),gy+tol*Math.sin(an),li-1))selfSup=true;}
          // Ajuste por pieza: una pieza con soporte 'no' nunca recibe; con 'sí' fuerza soporte (como enforce).
          if(_objSupOff(gx,gy))continue;
          const _objOn=_objSupOn(gx,gy);
          // Si el soporte global está activo: añade por ángulo (salvo bloqueo) + forzados. Si está apagado: sólo forzados.
          const want=p.supports?(!selfSup||enforced(gx,gy,cz)||_objOn):(enforced(gx,gy,cz)||_objOn);
          if(!want)continue;
          // Base de la columna: baja hasta el modelo de abajo (deja de poner soporte ahí) o la cama.
          let bot=0;
          for(let b=li-2;b>=0;b--){if(sol[b]){bot=b+1;break;}}
          // Separación de aire: el soporte se detiene `gapLayers` por debajo del voladizo → retiro limpio
          const top=li-1-gapLayers;
          if(top<bot)continue; // el hueco consume la columna: el voladizo bridgeará solo
          if(p.supOnPlate&&bot>0)continue; // "solo desde la cama": descarta soportes que nacen sobre el modelo
          cols.push({x:gx,y:gy,bot,top,contactLi:li});
        }
      }
      if(cols.length){
        if(p.treeSupports){supTrees=_buildTreeSupport(cols,hit,totalL);gc.push(`; soportes árbol: ${supTrees.length} troncos · ${cols.length} contactos · sep.Z ${(p.supZGap||0).toFixed(2)}mm · dens ${p.supDensity}%`);}
        else{supCols=cols;gc.push(`; soportes: ${cols.length} columnas · rejilla ${SUP_GS}mm · sep.Z ${(p.supZGap||0).toFixed(2)}mm`);}
      }
    }
    // ── Adhesión: skirt / brim / raft (capa 1, antes del modelo) ────────
    let curZ=lhs[0],cX=3,cY=purgeY1;
    const RAFT_GAP=0.25,raftBaseLH=0.3;
    const zBase=p.raft?(raftBaseLH+lhs[0]+RAFT_GAP):0; // el modelo se eleva sobre el raft
    const adhBig=(()=>{const c0=sliceZ(lhs[0]*0.5);return c0.length?c0.sort((a,b)=>Math.abs(_polyArea(b))-Math.abs(_polyArea(a)))[0]:null;})();
    if(p.raft&&adhBig){
      const pad=_insetRaw(adhBig,-4); // 4mm de margen alrededor de la pieza
      if(pad&&pad.length>=3){
        gc.push('\n; === Raft (base) ===');gc.push(`G1 Z${raftBaseLH.toFixed(3)} F600`);
        const baseLines=_scanfillAll([pad],extW*2.5,0);
        [E,cX,cY]=_printLines(gc,baseLines,raftBaseLH,offX,offY,cX,cY,E,raftBaseLH,extW*1.6,Math.round(p.firstLayerSpeed*0.8)*60,p);
        gc.push('; === Raft (interfaz) ===');gc.push(`G1 Z${(raftBaseLH+lhs[0]).toFixed(3)} F600`);
        const ifaceLines=_scanfillAll([pad],extW*1.05,90);
        [E,cX,cY]=_printLines(gc,ifaceLines,raftBaseLH+lhs[0],offX,offY,cX,cY,E,lhs[0],extW,Math.round(p.firstLayerSpeed)*60,p);
      }
    }else{
      // Skirt (cebado del filamento, separado de la pieza)
      if(p.skirt>0&&adhBig){
        gc.push('\n; === Skirt ===');gc.push(`G1 Z${curZ.toFixed(3)} F600`);
        for(let k=0;k<p.skirt;k++){const r=_insetRaw(adhBig,-(p.skirtGap+(k+1)*extW));if(!r||r.length<3)break;[E,cX,cY]=_printPoly(gc,r,curZ,offX,offY,cX,cY,E,lhs[0],extW,p.firstLayerSpeed*60,p);}
      }
      // Brim (adhesión pegada a la pieza)
      if(p.brim>0&&adhBig){
        gc.push(`\n; === Brim (capa 1) ===`);gc.push(`G1 Z${curZ.toFixed(3)} F600`);
        for(let b=0;b<p.brim;b++){const outer=_insetRaw(adhBig,-((p.brimGap||0)+extW*(b+1)));if(!outer||outer.length<3)break;[E,cX,cY]=_printPoly(gc,outer,curZ,offX,offY,cX,cY,E,lhs[0],extW,p.firstLayerSpeed*60,p);}
      }
    }
    // ── Capas ────────────────────────────────────
    curZ=0;let _pausedAtZ=false;
    // Aceleración por feature: emite M204 sólo al cambiar (pared ext. más lenta, relleno más rápido)
    const gAccel=p.accel||0;let _accelCur=gAccel;
    const setAccel=t=>{const eff=t>0?t:gAccel;if(eff>0&&eff!==_accelCur){gc.push('M204 S'+Math.round(eff));_accelCur=eff;}};
    for(let li=0;li<totalL;li++){
      const lh=lhs[li];curZ+=lh;const zOut=curZ+zBase; // zOut = altura física (sube sobre el raft)
      const pe=_layerParams(p,curZ); // parámetros efectivos: aplica modificadores por altura (pe===p si no hay)
      const spd=li===0?p.firstLayerSpeed:p.speed;
      const outerF=(li>0&&p.outerSpeed>0?p.outerSpeed:spd)*60; // velocidad pared exterior
      const innerF=Math.round(spd*0.9)*60;
      // Anchos de línea por feature (0 = auto = base extW). 1ª capa más ancha para adherencia.
      const wOuter=li===0?extW*1.1:(p.widthOuter>0?p.widthOuter:extW);
      const wInner=li===0?extW*1.1:extW;
      const wInfill=li===0?extW*1.1:(p.widthInfill>0?p.widthInfill:extW);
      // Voladizo: punto sobre aire en la capa de abajo → velocidad reducida en la pared exterior
      const _ob1=li>0?(layerPolys[li-1]||[]):[],_ob1BB=li>0?(layerBB[li-1]||[]):[];
      const ohTest=(li>0&&p.overhangSpeed>0)?((x,y)=>!_inSolidBB(x,y,_ob1,_ob1BB)):null;
      const ohFeed=(p.overhangSpeed>0?p.overhangSpeed:Math.round(spd*0.5))*60;
      if(li===1&&p.fanPct>0)gc.push(`M106 S${Math.round(p.fanPct*2.55)} ; ventilador`);
      // Temperatura gradual: reduce 5°C a 50% y 10°C a 80% de altura → menos stringing en las capas superiores
      if(p.gradualTemp&&li>0&&p.nozzleTemp>175){
        const pct=li/totalL;
        if(Math.abs(pct-0.5)<0.5/totalL+0.01)gc.push(`M104 S${Math.round(p.nozzleTemp*0.975)} ; temp gradual 50%`);
        else if(Math.abs(pct-0.8)<0.5/totalL+0.01)gc.push(`M104 S${Math.round(p.nozzleTemp*0.95)} ; temp gradual 80%`);
      }
      gc.push('');gc.push(`; === Capa ${li+1}/${totalL}  Z=${curZ.toFixed(3)}mm ===`);
      // ── Modo jarrón / spiralize: base sólida + espiral continuo sin costura ──
      if(p.spiralize && li>=p.bottomLayers){
        const ctrs=layerPolys[li];
        if(ctrs.length){
          gc.push('; spiralize — espiralizado continuo');
          // Sólo el contorno exterior (mayor área, no agujeros)
          const outer=ctrs.filter((_,ci)=>!layerParity[li][ci]).sort((a,b)=>Math.abs(_polyArea(b))-Math.abs(_polyArea(a)))[0];
          if(outer&&outer.length>=3){
            const zStart=zOut-lh;
            [E,cX,cY]=_printPolySpiralZ(gc,outer,zStart,zOut,offX,offY,cX,cY,E,lh,extW,outerF,p);
          }
        }
        if(li%8===0){setProg(4+li/totalL*92,`Laminando capa ${li+1}/${totalL}…`);await new Promise(r=>setTimeout(r,0));}
        continue; // omitir relleno, soportes, infill
      }
      gc.push(`G1 Z${zOut.toFixed(3)} F600`);
      // Pausa programada por altura (inserto de tuerca / cambio de color manual) — PAUSE de Klipper
      if(p.pauseAtZ>0&&!_pausedAtZ&&curZ>=p.pauseAtZ){_pausedAtZ=true;gc.push(`; === PAUSA programada a Z=${(+p.pauseAtZ).toFixed(2)}mm (inserto/cambio de color) ===`);gc.push('PAUSE');}
      const _layerStartIdx=gc.length; // para el tiempo mínimo de capa (ralentiza extrusión si la capa es muy corta)
      // G-code por cambio de capa (timelapse/macros) — placeholders {layer} {z} + los del header
      if(_layerTpl)_sub(_layerTpl,Object.assign({layer:li+1,z:zOut.toFixed(3)},_gcVars)).split('\n').forEach(l=>{if(l.trim())gc.push(l);});
      // Pantalla anti-corriente (draft shield): pared sacrificial alrededor de la pieza (ABS/TPU)
      if(p.draftShield&&adhBig){const ds=_insetRaw(adhBig,-(3+extW));if(ds&&ds.length>=3){gc.push('; draft shield');[E,cX,cY]=_printPoly(gc,ds,zOut,offX,offY,cX,cY,E,lh,extW,(li===0?p.firstLayerSpeed:p.speed)*60,p);}}
      // Soporte (antes del modelo de esta capa)
      if(supCols){
        const sl=_supportLinesAtLayer(supCols,li,SUP_GS,p);
        if(sl.length){gc.push('; soporte');[E,cX,cY]=_printLines(gc,sl,zOut,offX,offY,cX,cY,E,lh,extW,Math.round(spd*1.2)*60,p,undefined,true);}
      }
      if(supTrees){
        const sl=_treeSupportAtLayer(supTrees,li,extW,p);
        if(sl.length){gc.push('; soporte árbol');[E,cX,cY]=_printLines(gc,sl,zOut,offX,offY,cX,cY,E,lh,extW,Math.round(spd*1.15)*60,p,undefined,true);}
      }
      // Interfaz de soporte: relleno denso en las capas justo bajo la pieza (facilita el desprendimiento)
      if(supCols){
        const IGS=SUP_GS;
        const ifcCols=supCols.filter(c=>c.top>=li&&c.top-li<ifaceLayers&&c.bot<=li);
        if(ifcCols.length){
          const rows=new Map();
          for(const c of ifcCols){const ky=Math.round(c.y/IGS);(rows.get(ky)||rows.set(ky,[]).get(ky)).push(c);}
          const ifcLines=[];
          for(const arr of rows.values()){
            arr.sort((a,b)=>a.x-b.x);
            const x0=arr[0].x-IGS/2,x1=arr[arr.length-1].x+IGS/2,cy=arr[0].y;
            for(let x=x0+extW/2;x<x1;x+=extW*1.05)ifcLines.push([[x,cy-IGS/2],[x,cy+IGS/2]]);
          }
          if(ifcLines.length){gc.push('; interfaz soporte (densa)');[E,cX,cY]=_printLines(gc,ifcLines,zOut,offX,offY,cX,cY,E,lh,extW,Math.round(spd*0.75)*60,p,undefined,true);}
        }
      }
      const contours=layerPolys[li];
      if(!contours.length)continue;
      const parity=layerParity[li]; // true = agujero (anidamiento impar) — precalculado
      // Compensación dimensional: pie de elefante (sólo capa 0) + expansión XY uniforme
      let comp=(p.xyCompensation||0)-((li===0&&p.elephantFoot>0)?p.elephantFoot:0);
      let baseC=contours;
      if(Math.abs(comp)>0.001){
        baseC=contours.map((ct,ci)=>{const off=parity[ci]?comp:-comp;const r=_insetRaw(ct,off);return(r&&r.length>=3)?r:ct;});
      }
      // Agrupar contornos por pieza (ajustes por pieza); sin ajustes → un solo grupo = comportamiento idéntico
      let _grps;
      if(_hasObjSet){const gm=new Map();for(let _ci=0;_ci<baseC.length;_ci++){const _ct=baseC[_ci];if(_ct.length<3)continue;let _sx=0,_sy=0;for(const _pt of _ct){_sx+=_pt[0];_sy+=_pt[1];}const _oi=_objIdx(_sx/_ct.length,_sy/_ct.length);(gm.get(_oi)||gm.set(_oi,[]).get(_oi)).push(_ci);}_grps=[...gm.entries()].map(([oi,cis])=>({oi,cis}));}
      else _grps=[{oi:-1,cis:baseC.map((_,i)=>i)}];
      for(const _grp of _grps){
      const peo=_hasObjSet?_objParams(pe,_grp.oi):pe;
      // Paredes por contorno: exterior crece hacia adentro, agujero crece hacia afuera (más material alrededor)
      const fillLoops=[],gapLoops=[];
      // Orden de islas por proximidad (greedy NN desde la posición del cabezal) → menos
      // viajes entre contornos separados (paredes). Con una sola isla = orden anterior.
      const _rem=new Set(_grp.cis.filter(_ci=>baseC[_ci]&&baseC[_ci].length>=3));
      const _cent=new Map();
      for(const _ci of _rem){const _ct=baseC[_ci];let _sx=0,_sy=0;for(const _pt of _ct){_sx+=_pt[0];_sy+=_pt[1];}_cent.set(_ci,[_sx/_ct.length+offX,_sy/_ct.length+offY]);}
      while(_rem.size){
        let ci=null,_bd=Infinity;for(const _k of _rem){const _c=_cent.get(_k);const _d=(_c[0]-cX)*(_c[0]-cX)+(_c[1]-cY)*(_c[1]-cY);if(_d<_bd){_bd=_d;ci=_k;}}
        _rem.delete(ci);
        const ct=baseC[ci];if(ct.length<3)continue;
        const hole=parity[ci];
        const shells=[ct];
        for(let s=1;s<peo.shells;s++){
          const ins=hole?_insetRaw(shells[s-1],-extW):_inset(shells[s-1],extW);
          if(ins&&ins.length>=3)shells.push(ins);else break;
        }
        const idxs=[...shells.keys()];if(p.outerWallLast)idxs.reverse(); // pared exterior al final → mejor acabado
        const _scarf=(p.seamScarf&&li>0)?(p.scarfLen||5):0;
        for(const s of idxs){
          gc.push(s===0?'; pared exterior':'; pared interior');
          setAccel(s===0?p.accelOuter:0);
          [E,cX,cY]=_printPoly(gc,shells[s],zOut,offX,offY,cX,cY,E,lh,s===0?wOuter:wInner,s===0?outerF:innerF,p,(p.fuzzyAll||s===0)&&li>0,s===0?ohTest:null,ohFeed,s===0?_scarf:0);
        }
        fillLoops.push(shells[shells.length-1]);
        // Gap fill: pared fina donde no cupieron 2 perímetros → cordón central sólido para no dejar hueco
        if(p.gapFill&&peo.shells>=2&&shells.length<2&&!hole)gapLoops.push(ct);
        // Arachne: si la pared es más delgada que 2×extW, rellenar con una pared central de ancho variable
        if(p.arachne&&!hole&&peo.shells>=2&&shells.length===1){
          const inner=_insetRaw(ct,extW);
          if(inner&&inner.length>=3){
            // El inset cabe → la pared es ≥ extW pero falta la segunda pared
            // Estimamos el ancho real: promedio de las distancias entre shell[0] y shell[1] sería el gap
            // Aproximamos con inset al 50% → línea central con E al 75%
            const center=_insetRaw(ct,extW*0.75);
            if(center&&center.length>=3){
              [E,cX,cY]=_printPolyScaled(gc,center,zOut,offX,offY,cX,cY,E,lh,extW,0.5,innerF,p);
            }
          }
        }
      }
      // ── Relleno con detección de superficies por región (even-odd excluye agujeros) ──
      if(fillLoops.length){
        setAccel(p.accelInfill); // aceleración de relleno (si está configurada)
        const solidFeed=(li>0&&p.infillSpeed>0?p.infillSpeed:Math.round(spd*1.1))*60,solidAngle=li%2?135:45,COMB=Math.max(extW*3,2);
        // Solape relleno↔pared: expande los lazos de relleno hacia la pared → sin hueco entre relleno y perímetro
        const _ovl=extW*((p.infillOverlap||0)/100);
        const infLoops=_ovl>0.001?fillLoops.map(l=>{const r=_insetRaw(l,-_ovl);return(r&&r.length>=3)?r:l;}):fillLoops;
        const aLi=layerNetArea[li],aTop=layerNetArea[li+peo.topLayers],aBot=layerNetArea[li-peo.bottomLayers];
        // ¿Hay alguna cara expuesta? Sólo si arriba/abajo (N capas) la sección encoge (o no existe = global)
        // Lightning siempre usa el camino muestreado: necesita escanear hacia arriba para hallar techos.
        const exposed=(peo.infillType==='lightning')||(aTop===undefined||aTop<aLi*0.98)||(aBot===undefined||aBot<aLi*0.98);
        if(!exposed){
          // Interior macizo prismático → sólo relleno disperso (camino rápido, sin muestreo)
          if(peo.infillPct>0){
            const sp=_infillMulti(infLoops,extW/(peo.infillPct/100),peo.infillType==='adaptive'?'cubic':peo.infillType,li,curZ);
            if(sp.length){gc.push('; relleno');[E,cX,cY]=_printLines(gc,sp,zOut,offX,offY,cX,cY,E,lh,wInfill,solidFeed,p,COMB,true);}
          }
        }else{
          const above=layerPolys[li+peo.topLayers]||[],below=layerPolys[li-peo.bottomLayers]||[],below1=li>0?(layerPolys[li-1]||[]):[];
          const aboveBB=layerBB[li+peo.topLayers]||[],belowBB=layerBB[li-peo.bottomLayers]||[],below1BB=li>0?(layerBB[li-1]||[]):[];
          const isTop=(x,y)=>!_inSolidBB(x,y,above,aboveBB),isBot=(x,y)=>!_inSolidBB(x,y,below,belowBB);
          const isSurf=(x,y)=>isTop(x,y)||isBot(x,y);
          const isBridge=(x,y)=>p.bridgeDetect&&li>0&&!_inSolidBB(x,y,below1,below1BB);
          // 1) Superficies sólidas (top/bottom) que no son puente
          const surf=_clipLines(_scanfillAll(infLoops,extW*1.02,solidAngle,p.monotonic),(x,y)=>isSurf(x,y)&&!isBridge(x,y),extW);
          if(surf.length){gc.push('; superficie');[E,cX,cY]=_printLines(gc,surf,zOut,offX,offY,cX,cY,E,lh,wInfill,solidFeed,p,COMB,true);}
          // 2) Puentes (cara inferior sobre aire) — sólido, lento, ventilador máximo, orientado al vano
          if(p.bridgeDetect){
            const bAng=_bridgeInfoMulti(fillLoops,below1).angle;
            const br=_clipLines(_scanfillAll(fillLoops,extW*1.02,bAng),(x,y)=>isBridge(x,y),extW);
            if(br.length){
              gc.push('; puente (bridge) — relleno sólido orientado al vano');
              if(p.fanPct<100)gc.push('M106 S255 ; ventilador máx para puente');
              [E,cX,cY]=_printLines(gc,br,zOut,offX,offY,cX,cY,E,lh,extW*((p.bridgeFlow||100)/100),Math.max(15,Math.min(30,Math.round(spd*0.6)))*60,p,COMB);
              if(p.fanPct<100)gc.push(`M106 S${Math.round(p.fanPct*2.55)} ; restaurar ventilador`);
            }
          }
          // 3) Relleno disperso en el interior (ni superficie)
          if(peo.infillType==='lightning'){
            // Lightning: estructura mínima tipo árbol — sólo soporta techos dentro del alcance vertical,
            // dejando el resto del interior hueco. Gran ahorro de material y tiempo.
            const reach=Math.max(4,peo.topLayers+3);
            const isAirAt=(x,y,L)=>{const pp=layerPolys[L];if(!pp||!pp.length)return true;return !_inSolidBB(x,y,pp,layerBB[L]);};
            const needsLight=(x,y)=>{
              if(isSurf(x,y))return false;
              for(let d=1;d<=reach;d++){const L=li+d;if(L>=totalL)return false;if(isAirAt(x,y,L))return true;}
              return false; // techo lejano → sin relleno (ahorro)
            };
            const lspac=Math.max(extW*2,extW/Math.max(0.05,peo.infillPct/100)*1.4);
            const sp=_clipLines(_scanfillAll(infLoops,lspac,li%2?135:45),needsLight,extW);
            if(sp.length){gc.push('; lightning infill (árbol mínimo)');[E,cX,cY]=_printLines(gc,sp,zOut,offX,offY,cX,cY,E,lh,extW,solidFeed,p,COMB,true);}
          }else if(peo.infillType==='adaptive'&&peo.infillPct>0){
            // Relleno adaptativo: base disperso cúbico en todo el interior + pasada extra densa cerca de los techos
            const baseSp=_clipLines(_infillMulti(infLoops,extW/(peo.infillPct/100),'cubic',li,curZ),(x,y)=>!isSurf(x,y),extW);
            if(baseSp.length){gc.push('; relleno adaptativo (base)');[E,cX,cY]=_printLines(gc,baseSp,zOut,offX,offY,cX,cY,E,lh,wInfill,solidFeed,p,COMB,true);}
            const reach=Math.max(4,peo.topLayers+4);
            const isAirAt=(x,y,L)=>{const pp=layerPolys[L];if(!pp||!pp.length)return true;return !_inSolidBB(x,y,pp,layerBB[L]);};
            const nearCeil=(x,y)=>{if(isSurf(x,y))return false;for(let d=1;d<=reach;d++){const L=li+d;if(L>=totalL)return false;if(isAirAt(x,y,L))return true;}return false;};
            const densSp=_clipLines(_scanfillAll(infLoops,extW/Math.max(0.05,peo.infillPct/100)*0.7,li%2?45:135),nearCeil,extW);
            if(densSp.length){gc.push('; relleno adaptativo (densificado bajo techos)');[E,cX,cY]=_printLines(gc,densSp,zOut,offX,offY,cX,cY,E,lh,wInfill,solidFeed,p,COMB,true);}
          }else if(peo.infillPct>0){
            const sp=_clipLines(_infillMulti(infLoops,extW/(peo.infillPct/100),peo.infillType,li,curZ),(x,y)=>!isSurf(x,y),extW);
            if(sp.length){gc.push('; relleno');[E,cX,cY]=_printLines(gc,sp,zOut,offX,offY,cX,cY,E,lh,wInfill,solidFeed,p,COMB,true);}
          }
        }
        // Gap fill: cordón central en paredes finas (un sólo paso de scanline ≈ línea central)
        if(gapLoops.length){
          const gl=_scanfillAll(gapLoops,extW,solidAngle);
          if(gl.length){gc.push('; gap-fill');[E,cX,cY]=_printLines(gc,gl,zOut,offX,offY,cX,cY,E,lh,extW,Math.round(spd*0.8)*60,p,COMB,true);}
        }
        // Ironing: plancha TODAS las caras top-expuestas (no sólo la última capa)
        if(p.ironing){
          const above1=layerPolys[li+1]||[],above1BB=layerBB[li+1]||[];
          const ir=_clipLines(_scanfillAll(fillLoops,extW*0.5,li%2?45:135),(x,y)=>!_inSolidBB(x,y,above1,above1BB),extW*0.5);
          if(ir.length){gc.push('; ironing');[E,cX,cY]=_printLines(gc,ir,zOut,offX,offY,cX,cY,E,lh*((p.ironingFlow||12)/100),extW,Math.round(Math.min(spd,40))*60,p,COMB);}
        }
      }
      } // fin loop por pieza (ajustes por pieza)
      // Tiempo mínimo de capa: ralentiza la extrusión de esta capa si imprime muy rápido (enfría mejor)
      if(li>0&&p.minLayerTime>0){
        const cooled=_applyMinLayerTime(gc,_layerStartIdx,p.minLayerTime);
        if(cooled&&(p.fanPct||0)<100){gc.splice(_layerStartIdx,0,'M106 S255 ; enfriamiento — capa corta');gc.push(`M106 S${Math.round((p.fanPct||0)*2.55)} ; restaurar ventilador`);}
      }
      if(li%8===0){setProg(4+li/totalL*92,`Laminando capa ${li+1}/${totalL}…`);await new Promise(r=>setTimeout(r,0));}
    }
    gc.push('; <<<BODY_END>>>'); // marcador fin de cuerpo (impresión secuencial)
    // ── Footer ───────────────────────────────────
    const _endTpl=(localStorage.getItem('sl_endgcode_'+modelName)||'').trim();
    if(_endTpl){
      gc.push('');
      if(p.retractDist>0)gc.push(`G1 E${(E-p.retractDist).toFixed(4)} F${p.retractSpeed*60} ; retracción final (anti-ooze)`);
      _sub(_endTpl,_gcVars).split('\n').forEach(l=>gc.push(l));
    }else{
      gc.push('\nM107');gc.push('M104 S0');gc.push('M140 S0');
      if(p.retractDist>0)gc.push(`G1 E${(E-p.retractDist).toFixed(4)} F${p.retractSpeed*60} ; retracción final (anti-ooze)`);
      gc.push('G92 E0');gc.push('G91');gc.push('G1 Z5 F900');gc.push('G90');
      gc.push(`G1 X0 Y${(spec.y-10).toFixed(0)} F3000`);gc.push('M84');
    }
    return gc.join('\n');
  }
  // Versión de _inset sin validación de área (para expansiones del brim)
  function _insetRaw(poly,d){
    const n=poly.length;if(n<3)return null;
    const res=[];
    for(let i=0;i<n;i++){
      const prev=poly[(i-1+n)%n],curr=poly[i],next=poly[(i+1)%n];
      let e1x=curr[0]-prev[0],e1y=curr[1]-prev[1];let e2x=next[0]-curr[0],e2y=next[1]-curr[1];
      const l1=Math.hypot(e1x,e1y),l2=Math.hypot(e2x,e2y);
      if(!l1||!l2){res.push(curr);continue;}
      e1x/=l1;e1y/=l1;e2x/=l2;e2y/=l2;
      const n1x=-e1y,n1y=e1x,n2x=-e2y,n2y=e2x;
      const mx=n1x+n2x,my=n1y+n2y,ml=Math.hypot(mx,my);
      if(!ml){res.push([curr[0]+n1x*d,curr[1]+n1y*d]);continue;}
      const dot=n1x*n2x+n1y*n2y,ms=d/Math.max(0.25,Math.sqrt(Math.max(0,(1+dot)/2)));
      const clamp=Math.min(Math.abs(ms),Math.abs(d)*5)*Math.sign(ms);
      const rx=curr[0]+(mx/ml)*clamp,ry=curr[1]+(my/ml)*clamp;
      if(!isFinite(rx)||!isFinite(ry)){res.push([curr[0]+n1x*d,curr[1]+n1y*d]);continue;}
      res.push([rx,ry]);
    }
    return res.length>=3?res:null;
  }
  function setProg(pct,msg){
    el('slProgWrap').style.display='block';
    el('slProgBar').style.width=Math.min(100,Math.round(pct))+'%';
    el('slProgTxt').textContent=msg;
  }
  // Desplaza X/Y de una línea G0/G1 (para reposicionar el cuerpo de una pieza en impresión secuencial)
  function _shiftXY(ln,shX,shY){
    if(ln.charCodeAt(0)!==71||!(ln.startsWith('G1 ')||ln.startsWith('G0 ')))return ln;
    return ln.replace(/X(-?[\d.]+)/,(m,v)=>'X'+(+v+shX).toFixed(3)).replace(/Y(-?[\d.]+)/,(m,v)=>'Y'+(+v+shY).toFixed(3));
  }
  // Impresión secuencial: lamina cada pieza por separado y la imprime completa antes de la siguiente.
  // Seguridad: sube a Z libre sobre lo ya impreso antes de viajar a la pieza siguiente; aborta si no caben con separación.
  async function _sliceSequential(p,spec,nozD,matName,model){
    const objs=S.objects,CLR=18; // separación generosa entre piezas (clearance del cabezal)
    const items=objs.map((t)=>{let mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9,mxz=-1e9;for(let i=0;i<t.length;i+=3){if(t[i]<mnx)mnx=t[i];if(t[i]>mxx)mxx=t[i];if(t[i+1]<mny)mny=t[i+1];if(t[i+1]>mxy)mxy=t[i+1];if(t[i+2]>mxz)mxz=t[i+2];}return{t,w:mxx-mnx,d:mxy-mny,h:mxz};});
    items.sort((a,b)=>a.h-b.h); // bajas primero
    const usableW=spec.x-20;let curX=10,curY=10,rowH=0;
    for(const it of items){if(curX>10&&curX+it.w>usableW){curX=10;curY+=rowH+CLR;rowH=0;}it.ox=curX+it.w/2;it.oy=curY+it.d/2;curX+=it.w+CLR;rowH=Math.max(rowH,it.d);}
    const maxY=Math.max(...items.map(it=>it.oy+it.d/2));
    if(maxY>spec.y-10)throw new Error('secuencial: las piezas no caben con separación segura — reduce la cantidad o usa impresión normal');
    items.sort((a,b)=>a.oy-b.oy||a.h-b.h); // imprimir de adelante hacia atrás
    const _tris=S.tris,_stats=S.stats,_sup=S.supRegions,_mod=S.modifiers,_bb=S.objBBs;
    S.supRegions=[];S.modifiers=[];S.objBBs=null;
    let prologue=null,epilogue=null;const bodies=[];
    try{
      for(let k=0;k<items.length;k++){
        const it=items[k];
        setProg(4,`Secuencial: pieza ${k+1}/${items.length}…`);await new Promise(r=>setTimeout(r,0));
        S.tris=it.t.slice();analyze(S.tris);
        const lines=(await _nativeSlice(S.tris,p,spec,nozD,matName,model)).split('\n');
        const bs=lines.indexOf('; <<<BODY_START>>>'),be=lines.indexOf('; <<<BODY_END>>>');
        if(bs<0||be<0)throw new Error('marcadores de cuerpo no encontrados');
        if(!prologue){prologue=lines.slice(0,bs+1).join('\n');epilogue=lines.slice(be).join('\n');}
        const shX=it.ox-spec.x/2,shY=it.oy-spec.y/2;
        bodies.push({body:lines.slice(bs+1,be).map(l=>_shiftXY(l,shX,shY)),it});
      }
    }finally{S.tris=_tris;S.stats=_stats;S.supRegions=_sup;S.modifiers=_mod;S.objBBs=_bb;}
    const out=[prologue];let printedH=0;
    for(let k=0;k<bodies.length;k++){
      const{body,it}=bodies[k];
      if(k>0){
        out.push(`\n; ===== Pieza secuencial ${k+1}/${bodies.length} =====`);
        out.push('G92 E0');
        if(p.retractDist>0)out.push(`G1 E${(-p.retractDist).toFixed(4)} F${p.retractSpeed*60}`);
        out.push(`G1 Z${(printedH+5).toFixed(2)} F600 ; subir para librar piezas ya impresas`);
        out.push(`G1 X${it.ox.toFixed(2)} Y${it.oy.toFixed(2)} F${p.travelSpeed*60} ; ir sobre la siguiente pieza`);
        if(p.retractDist>0)out.push(`G1 E0 F${p.retractSpeed*60}`);
      }
      out.push(body.join('\n'));
      printedH=Math.max(printedH,it.h);
    }
    out.push(epilogue);
    return out.join('\n');
  }
  // ── Etiquetas de tipo de línea para OrcaSlicer/PrusaSlicer/Bambu ──────────
  // El slicer emite comentarios en español (; pared exterior, ; relleno, …) que
  // sirven a nuestra propia vista previa, pero OrcaSlicer no los entiende y mete
  // toda la extrusión en "Indefinido". Traducimos cada comentario al tag estándar
  // "; FEATURE: <rol>" que OrcaSlicer parsea para colorear y desglosar perímetros,
  // relleno, soporte, etc. (los nombres deben coincidir con los roles de OrcaSlicer).
  function _orcaFeature(c){
    // Anclamos al INICIO del comentario (tras ";") para no marcar frases de cabecera
    // que contengan "relleno:40%" o "soportes activados" como si fueran secciones.
    const t=c.replace(/^;+\s*/,'').toLowerCase();
    if(t.startsWith('pared exterior'))return'Outer wall';
    if(t.startsWith('pared interior'))return'Inner wall';
    if(/^puente\b/.test(t)||/^bridge\b/.test(t))return'Bridge';
    if(/^gap[- ]?fill\b/.test(t))return'Gap infill';
    if(t.startsWith('interfaz soporte')||t.startsWith('interfaz de soporte'))return'Support interface';
    if(/^soporte\b/.test(t))return'Support';          // "soporte", "soporte árbol" — NO "soportes activados"
    if(/^ironing\b/.test(t))return'Ironing';
    if(t.startsWith('superficie'))return'Top surface';
    if(/^(relleno|lightning)\b/.test(t))return'Sparse infill';
    if(t.startsWith('draft shield'))return'Skirt';
    if(/===\s*skirt/.test(t)||/^skirt\b/.test(t))return'Skirt';
    if(/===\s*brim/.test(t)||/^brim\b/.test(t))return'Brim';
    if(/===\s*raft/.test(t))return'Support';
    return null;
  }
  function _tagFeatures(gc){
    const out=[];let last=null;
    for(const raw of gc.split('\n')){
      const c=raw.trim();
      if(c[0]===';'){
        const f=_orcaFeature(c);
        // Emitimos AMBOS prefijos: ";TYPE:" lo lee OrcaSlicer en impresoras NO-Bambu
        // (Creality, Marlin, Klipper…), "; FEATURE:" en impresoras Bambu. El nombre
        // de rol es el mismo en los dos (lo resuelve string_to_role).
        if(f){out.push(raw);if(f!==last){out.push(';TYPE:'+f);out.push('; FEATURE: '+f);last=f;}continue;}
      }
      out.push(raw);
    }
    return out.join('\n');
  }
  // ── Pie de estadísticas (neutro) ─────────────────────────────────────────
  // El recuadro "Estimación total" de OrcaSlicer se calcula sumando el filamento
  // de los roles RECONOCIDOS, así que se llena solo al tener bien las etiquetas
  // ";TYPE:" (no hace falta HEADER ni CONFIG_BLOCK, que además ni se leían).
  // Dejamos solo comentarios neutros (sin "OrcaSlicer" ni marcadores de bloque)
  // para no disparar la detección de productor; útiles para Moonraker/Klipper.
  function _fmtHMS(s){s=Math.max(0,Math.round(s));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),sec=s%60;return (h?h+'h ':'')+(h||m?m+'m ':'')+sec+'s';}
  function _footerStats(est){
    const L=(est.filM*1000).toFixed(2),G=est.grams.toFixed(2),T=_fmtHMS(est.secs);
    return ['','; ── Resumen — The Lab Solutions ──',
      `; estimated printing time (normal mode) = ${T}`,
      `; filament used [mm] = ${L}`,
      `; filament used [g] = ${G}`,
      `; total filament used [g] = ${G}`].join('\n');
  }
  async function generarGcode(){
    if(!S.stats)return;
    const p=readParams();S.params=p;
    const model=el('slPrinter').value,spec=SPECS[model];
    // En secuencial cada pieza se reempaqueta y _sliceSequential hace su propio chequeo de espacio → no aplica el límite del plato combinado
    const _seqMode=p.sequential&&S.objects&&S.objects.length>1;
    if(!_seqMode&&!fitsIn(spec)){toast(`La pieza (${S.stats.dx.toFixed(0)}×${S.stats.dy.toFixed(0)}×${S.stats.dz.toFixed(0)}mm) no cabe en ${model} — elige otra impresora o escala el modelo`,'error');return;}
    const btn=el('slBtnGcode');btn.disabled=true;el('slResult').style.display='none';
    try{
      setProg(2,'Iniciando slicer nativo…');
      await new Promise(r=>setTimeout(r,0));
      const nozD=+el('slNozzle').value,matName=el('slMaterial').value;
      const _seq=p.sequential&&S.objects&&S.objects.length>1;
      let gcode=_seq?await _sliceSequential(p,spec,nozD,matName,model):await _nativeSlice(S.tris,p,spec,nozD,matName,model);
      if(_seq)toast('⚠ Secuencial: verifica que el cabezal libre las piezas ya impresas. Probar primero en piezas bajas/separadas.','info');
      if(!gcode.includes('G1'))throw new Error('slicer produjo G-code vacío');
      // Estimación sobre G-code recto (preciso); arc welding sólo afecta la salida
      const _est=estimate(gcode,MATS[matName],model);
      // EXCLUDE_OBJECT (Klipper): etiqueta cada pieza del plato para cancelarla sin abortar la placa
      if(p.excludeObject&&!_seq&&S.objBBs&&S.objBBs.length>1){gcode=_wrapExcludeObject(gcode,S.objBBs,spec.x/2,spec.y/2);}
      if(p.arcFitting){setProg(98,'Optimizando arcos (G2/G3)…');await new Promise(r=>setTimeout(r,0));gcode=_arcWeld(gcode);}
      gcode=_tagFeatures(gcode); // ";TYPE:"/"; FEATURE:" → desglose por tipo de línea (y llena "Estimación total" por roles)
      gcode=gcode+'\n'+_footerStats(_est); // comentarios neutros (Moonraker), sin disparar error de carga
      S.gcode=gcode;
      setProg(100,'✓ G-code listo');
      localStorage.setItem('sl_last_est_secs',_est.secs.toFixed(1));
      renderResult(_est);
    }catch(e){
      setProg(0,'✕ Error');
      toast('Error al laminar: '+e.message,'error');
    }finally{btn.disabled=false;}
  }
  // Perfil de velocidad trapezoidal — tiempo real por segmento
  const _ACCELS={'K1':18000,'K2':18000,'K2 Plus':15000,'Ender-5 Max':5000,'Giga':2000};
  function _moveTime(d,v,accel){
    if(d<0.001)return 0;
    const da=v*v/(2*accel);// dist para alcanzar v desde 0
    if(d>=2*da)return 2*v/accel+(d-2*da)/v;
    return 2*Math.sqrt(d/accel);
  }
  function estimate(gc,mat,printerModel){
    const accel=_ACCELS[printerModel]||8000;
    let t=0,x=0,y=0,z=0,f=3000,abs=true,eAbs=0,eMaxSeg=0,filament=0;
    for(const raw of gc.split('\n')){
      const c=raw.trim();if(!c||c[0]===';')continue;
      if(c.startsWith('M82')){abs=true;continue;}
      if(c.startsWith('M83')){abs=false;continue;}
      if(c.startsWith('G92')){const m=/E([-\d.]+)/.exec(c);if(m){filament+=eMaxSeg;eMaxSeg=0;eAbs=+m[1];}continue;}
      if(!(c.startsWith('G1')||c.startsWith('G0')))continue;
      let nx=x,ny=y,nz=z,ne=null;
      for(const w of c.split(' ')){
        const v=+w.slice(1);if(!isFinite(v))continue;
        if(w[0]==='X')nx=v;else if(w[0]==='Y')ny=v;else if(w[0]==='Z')nz=v;else if(w[0]==='E')ne=v;else if(w[0]==='F')f=v;
      }
      const d=Math.hypot(nx-x,ny-y,nz-z);
      if(d>0.001)t+=_moveTime(d,f/60,accel);
      // Filamento = marca de agua máxima por segmento G92: las retracciones bajan E y
      // lo recuperan, así que el máximo alcanzado = filamento real (sin contar des-retracciones)
      if(ne!==null){eAbs=abs?ne:eAbs+ne;if(eAbs>eMaxSeg)eMaxSeg=eAbs;}
      x=nx;y=ny;z=nz;
    }
    filament+=eMaxSeg;
    // Auto-calibración por impresora desde historial Moonraker
    const cal=parseFloat(localStorage.getItem('sl_time_cal_'+(printerModel||'default')))||1.0;
    t*=cal;
    const volMm3=filament*Math.PI*0.765625;
    return{secs:t,filM:filament/1000,grams:volMm3/1000*mat.dens};
  }
  function fmtTime(s){const h=Math.floor(s/3600),m=Math.round(s%3600/60);return h?`${h}h ${m}min`:`${m}min`;}
  function gcodeFileName(){
    const lh=S.params?('_'+S.params.layerHeight+'mm'):'';
    return(S.name||'pieza').replace(/[^\w\-]+/g,'_')+'_'+el('slMaterial').value+lh+'.gcode';
  }
  // ── Suite de calibración (genera G-code de test sin necesidad de modelo) ──
  function _calGen(type){
    const matName=el('slMaterial').value,mat=MATS[matName],noz=+el('slNozzle').value,spec=SPECS[el('slPrinter').value];
    const extW=noz*1.05,lh=0.2,bed=mat.bed,cx=spec.x/2,cy=spec.y/2;
    const gc=[],st={x:0,y:0,E:0};
    const EXT=(x,y,w,h,f)=>{const d=Math.hypot(x-st.x,y-st.y);st.E+=d*(w||extW)*(h||lh)/FILA_AREA;gc.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} E${st.E.toFixed(4)} F${f}`);st.x=x;st.y=y;};
    const TRV=(x,y,f)=>{gc.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${f||3000}`);st.x=x;st.y=y;};
    function header(top){
      gc.push('; The Lab Solutions — Calibración: '+type+' · '+matName);
      gc.push('M140 S'+bed);gc.push('M104 S'+top);gc.push('G28');gc.push('M190 S'+bed);gc.push('M109 S'+top);
      gc.push('G21');gc.push('G90');gc.push('M82');gc.push('G92 E0');gc.push('M106 S'+Math.round((mat.fan||100)*2.55));
      gc.push('G1 Z0.24 F600');TRV(5,5);st.E+=40*extW*0.24/FILA_AREA;gc.push(`G1 X5 Y45 E${st.E.toFixed(4)} F1200`);st.x=5;st.y=45;gc.push('G92 E0');st.E=0;
    }
    function box(li,z,w,d,feed){const x0=cx-w/2,x1=cx+w/2,y0=cy-d/2,y1=cy+d/2;gc.push(`G1 Z${z.toFixed(3)} F600`);TRV(x0,y0);const f=li===0?Math.round(feed*0.5):feed;EXT(x1,y0,0,0,f);EXT(x1,y1,0,0,f);EXT(x0,y1,0,0,f);EXT(x0,y0,0,0,f);}
    function footer(){gc.push('M107');gc.push('M104 S0');gc.push('M140 S0');if(st.E)gc.push(`G1 E${(st.E-0.8).toFixed(4)} F2100`);gc.push('G91');gc.push('G1 Z10 F900');gc.push('G90');gc.push('M84');}
    if(type==='temp'){
      const t0=Math.min(300,mat.noz+15),bands=5,bl=30;header(t0);
      for(let li=0;li<bands*bl;li++){if(li%bl===0){const t=t0-5*(li/bl);gc.push(`M104 S${t}`);gc.push(`; --- ${t}°C ---`);}box(li,(li+1)*lh,25,12,1500);}
      footer();return{gcode:gc.join('\n'),name:`temp_${matName}_${t0}-${t0-20}`,info:`<b>Torre de temperatura</b> ${t0}°C → ${t0-20}°C (caliente abajo, frío arriba), 5 bandas de 6mm. Elige la banda con mejor brillo/capa, sin stringing ni burbujas, y usá esa temperatura de boquilla.`};
    }
    if(type==='flow'){header(mat.noz);for(let li=0;li<25;li++)box(li,(li+1)*lh,30,30,1200);footer();
      return{gcode:gc.join('\n'),name:`flujo_${matName}`,info:`<b>Cubo de pared simple</b> 30×30mm. Mide el grosor de la pared con calibre: debería dar <b>${extW.toFixed(2)}mm</b>. Flujo nuevo = flujo actual × (${extW.toFixed(2)} / medido).`};}
    if(type==='pa'){const bands=8,bl=12;header(mat.noz);
      for(let li=0;li<bands*bl;li++){if(li%bl===0){const pa=(li/bl)*0.01;gc.push(`SET_PRESSURE_ADVANCE ADVANCE=${pa.toFixed(3)}`);gc.push(`; --- PA ${pa.toFixed(3)} ---`);}box(li,(li+1)*lh,30,30,3000);}
      footer();return{gcode:gc.join('\n'),name:`pa_${matName}`,info:`<b>Torre Pressure Advance</b> 0 → 0.07 (Klipper, requiere SET_PRESSURE_ADVANCE). Impresa rápido para exagerar el efecto. Mide la altura donde las esquinas dejan de abultarse: PA = (altura_mm / 2.4) × 0.01 ≈ banda × 0.01.`};}
    if(type==='retract'){const bands=6,bl=15,ax=cx-25,bx=cx+25;header(mat.noz);
      for(let li=0;li<bands*bl;li++){const z=(li+1)*lh,rd=0.4+0.4*Math.floor(li/bl);if(li%bl===0)gc.push(`; --- retracción ${rd.toFixed(1)}mm ---`);gc.push(`G1 Z${z.toFixed(3)} F600`);
        for(const bc of[ax,bx]){st.E-=rd;gc.push(`G1 E${st.E.toFixed(4)} F2100`);TRV(bc-5,cy-5,6000);st.E+=rd;gc.push(`G1 E${st.E.toFixed(4)} F2100`);const f=li===0?700:1600;EXT(bc+5,cy-5,0,0,f);EXT(bc+5,cy+5,0,0,f);EXT(bc-5,cy+5,0,0,f);EXT(bc-5,cy-5,0,0,f);}}
      footer();return{gcode:gc.join('\n'),name:`retract_${matName}`,info:`<b>Torres de retracción</b>: dos postes con un viaje entre ellos en cada capa. La retracción sube 0.4mm por banda (0.4→2.4mm). Elige la banda con menos hilos entre las torres y usá esa distancia de retracción.`};}
    // firstlayer: parche sólido de una capa
    header(mat.noz);const w=40,x0=cx-w/2,x1=cx+w/2,y0=cy-w/2,y1=cy+w/2;gc.push(`G1 Z${lh.toFixed(3)} F600`);TRV(x0,y0);
    EXT(x1,y0,0,0,1000);EXT(x1,y1,0,0,1000);EXT(x0,y1,0,0,1000);EXT(x0,y0,0,0,1000);
    let yy=y0+extW,toRight=true;TRV(x0+extW,yy,3000);
    while(yy<y1-extW){const tx=toRight?x1-extW:x0+extW;EXT(tx,yy,0,0,1500);yy+=extW;if(yy<y1-extW)EXT(tx,yy,0,0,1500);toRight=!toRight;}
    footer();return{gcode:gc.join('\n'),name:`primeracapa_${matName}`,info:`<b>Parche sólido 40×40</b> de una capa. Las líneas deben tocarse sin huecos ni sobre-aplastado. Ajustá el Z-offset / nivelación de la cama hasta que quede uniforme.`};
  }
  function calibrar(){
    let res;try{res=_calGen(el('slCalType').value);}catch(e){toast('Error generando test: '+e.message,'error');return;}
    S.gcode=res.gcode;S.name=res.name;S.params=null;
    const machines=MAQUINAS.filter(m=>getPrinterIp(m));
    const opts=machines.map(m=>`<option value="${m.id}">${escapeHtml(m.nombre)} #${m.numG}</option>`).join('');
    const kb=Math.round(res.gcode.length/1024);
    const box=el('slCalResult');box.style.display='block';
    box.innerHTML=`<div style="padding:12px;background:rgba(0,212,170,0.07);border:1px solid rgba(0,212,170,0.3);border-radius:10px">
      <div style="font-size:11px;color:var(--text2);line-height:1.55;margin-bottom:10px">${res.info}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-primary" onclick="SL3D.descargar()">⬇ Descargar .gcode</button>
        <span class="badge badge-gray">${kb} KB</span>
        ${machines.length?`<select class="field-select" id="slCalTarget" style="width:auto;min-width:150px">${opts}</select><button class="btn btn-ghost" id="slBtnCalSend" onclick="SL3D.enviarCal()">📤 Enviar e imprimir</button>`:''}
      </div></div>`;
    toast('Test de calibración generado ✓','success');
  }
  function enviarCal(){
    const id=el('slCalTarget')?.value;if(!id||!S.gcode)return;
    const m=MAQUINAS.find(x=>x.id===id),ip=getPrinterIp(m);if(!ip){toast('Esa impresora no tiene IP','error');return;}
    if(typeof _isPrinterBusy==='function'&&_isPrinterBusy((_printerStatus[id]||{}).state)){toast('🔒 La impresora está ocupada — no se interrumpe','error');return;}
    const fname=gcodeFileName(),btn=el('slBtnCalSend');btn.disabled=true;btn.textContent='⏳ Subiendo…';
    const fd=new FormData();fd.append('file',new Blob([S.gcode],{type:'text/plain'}),fname);fd.append('root','gcodes');
    const xhr=new XMLHttpRequest();xhr.open('POST',printerUrl(ip,'/server/files/upload'));
    const hdrs=getPrinterAuthHeaders(id);for(const k in hdrs)xhr.setRequestHeader(k,hdrs[k]);
    xhr.onload=async()=>{btn.disabled=false;btn.textContent='📤 Enviar e imprimir';
      if(xhr.status>=200&&xhr.status<300){try{const r=await fetch(printerUrl(ip,`/printer/print/start?filename=${encodeURIComponent(fname)}`),{method:'POST',signal:AbortSignal.timeout(8000),headers:getPrinterAuthHeaders(id)});toast(r.ok?`▶ Calibrando en ${m.nombre} #${m.numG}`:'Subido, no se pudo iniciar',r.ok?'success':'error');if(typeof pollPrinters==='function')pollPrinters();}catch(e){toast('Subido, no se pudo iniciar: '+e.message,'error');}}else toast('Error al subir ('+xhr.status+')','error');};
    xhr.onerror=()=>{btn.disabled=false;btn.textContent='📤 Enviar e imprimir';toast('Impresora inaccesible','error');};
    xhr.send(fd);
  }
  function _money(n){return '$'+Math.round(n||0).toLocaleString('es-CL');}
  function costRecalc(){
    const pk=+(el('slPriceKg')?.value)||0,rh=+(el('slRateH')?.value)||0;
    try{localStorage.setItem('sl_price_kg',pk);localStorage.setItem('sl_rate_h',rh);}catch(e){}
    const est=S.est;if(!est)return;
    const fc=est.grams/1000*pk,tc=est.secs/3600*rh,tot=fc+tc;
    const out=el('slCostOut');
    if(out)out.innerHTML=`<b style="color:var(--accent3);font-size:16px">${_money(tot)}</b> <span style="color:var(--text3);font-size:10px">= filamento ${_money(fc)} + máquina ${_money(tc)}</span>`;
    // Precio sugerido al margen objetivo del taller (precio = costo / (1 - margen))
    const mEl=el('slMargen');const m=Math.max(0,Math.min(95,+(mEl?.value)||0));
    try{if(mEl)localStorage.setItem('cot_margen_min',m);}catch(e){}
    const sug=el('slPriceSuggest');
    if(sug){const precio=m<95?tot/(1-m/100):0;sug.innerHTML=precio>0?`<b style="color:var(--accent);font-size:14px">${_money(precio)}</b> <span style="color:var(--text3);font-size:9px">+ IVA = ${_money(precio*1.19)}</span>`:'—';}
  }
  // ── Vista previa del G-code por capas ───────────────────────
  function _parseGcodeLayers(){
    const layers=[];let cur=null,x=0,y=0,z=0,le=0,abs=true,feat=0; // feat: 0 modelo,1 soporte,2 puente,3 adhesión
    const ensure=(nz)=>{if(!cur||Math.abs(nz-cur.z)>0.001){cur={z:nz,segs:[],travels:[]};layers.push(cur);}return cur;};
    for(const raw of S.gcode.split('\n')){
      const c=raw.trim();if(!c)continue;
      if(c[0]===';'){
        if(/pared exterior/i.test(c))feat=0;
        else if(/pared interior/i.test(c))feat=1;
        else if(/relleno|lightning|gap-fill|adaptativo/i.test(c))feat=2;
        else if(/superficie/i.test(c))feat=3;
        else if(/soporte/i.test(c))feat=4;
        else if(/puente/i.test(c))feat=5;
        else if(/skirt|brim|raft/i.test(c))feat=6;
        else if(/=== Capa/.test(c))feat=1;
        continue;
      }
      if(c.startsWith('M82')){abs=true;continue;}
      if(c.startsWith('M83')){abs=false;continue;}
      if(c.startsWith('G92')){const m=/E([-\d.]+)/.exec(c);if(m)le=+m[1];continue;}
      const isArc=c.startsWith('G2')||c.startsWith('G3');
      if(!(c.startsWith('G1')||c.startsWith('G0')||isArc))continue;
      let nx=x,ny=y,nz=z,ne=null,I=null,J=null;
      for(const w of c.split(' ')){const v=+w.slice(1);if(!isFinite(v))continue;if(w[0]==='X')nx=v;else if(w[0]==='Y')ny=v;else if(w[0]==='Z')nz=v;else if(w[0]==='E')ne=v;else if(w[0]==='I')I=v;else if(w[0]==='J')J=v;}
      let ext=0;if(ne!==null){ext=abs?ne-le:ne;if(abs)le=ne;}
      if(ext>0.0001){
        const L=ensure(nz);
        if(isArc&&I!==null&&J!==null){ // teselar arco en segmentos para la vista previa
          const cx=x+I,cy=y+J,r=Math.hypot(I,J),cw=c.startsWith('G2');
          let a0=Math.atan2(y-cy,x-cx),a1=Math.atan2(ny-cy,nx-cx);
          if(cw){while(a1>=a0)a1-=2*Math.PI;}else{while(a1<=a0)a1+=2*Math.PI;}
          const steps=Math.max(2,Math.ceil(Math.abs(a1-a0)/0.2));
          let pxx=x,pyy=y;
          for(let s=1;s<=steps;s++){const a=a0+(a1-a0)*s/steps,qx=cx+r*Math.cos(a),qy=cy+r*Math.sin(a);L.segs.push([pxx,pyy,qx,qy,feat]);pxx=qx;pyy=qy;}
        }else if(nx!==x||ny!==y){L.segs.push([x,y,nx,ny,feat]);}
      }else if(nx!==x||ny!==y){ensure(nz).travels.push([x,y,nx,ny]);} // viaje (sin extrusión)
      x=nx;y=ny;z=nz;
    }
    return layers;
  }
  // pared ext, pared int, relleno, superficie, soporte, puente, adhesión
  const _GCOL=['#ff5a5a','#ffb13a','#c9a227','#00d4aa','#7a8a99','#3aa0ff','#a78bfa'];
  function _drawGcodeLayer(idx){
    if(S.gcode3D)return _drawGcode3D(idx);
    const layers=S.gcodeLayers;if(!layers||!layers.length)return;
    idx=Math.max(0,Math.min(layers.length-1,idx));S.previewIdx=idx;
    const cv=el('slGcodeCanvas');if(!cv)return;
    const w=cv.clientWidth||420,h=320,dpr=window.devicePixelRatio||1;
    cv.width=w*dpr;cv.height=h*dpr;const ctx=cv.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
    const b=S.previewBounds,sc=0.88*Math.min(w,h)/Math.max(b.dx,b.dy,1);
    const tx=X=>w/2+(X-b.cx)*sc,ty=Y=>h/2-(Y-b.cy)*sc;
    if(idx>0){ctx.globalAlpha=0.15;ctx.strokeStyle='#456';ctx.lineWidth=0.7;ctx.beginPath();for(const s of layers[idx-1].segs){ctx.moveTo(tx(s[0]),ty(s[1]));ctx.lineTo(tx(s[2]),ty(s[3]));}ctx.stroke();}
    if(S.showTravel&&layers[idx].travels){ctx.globalAlpha=0.55;ctx.strokeStyle='#8893a0';ctx.lineWidth=0.4;ctx.setLineDash([2,2]);ctx.beginPath();for(const s of layers[idx].travels){ctx.moveTo(tx(s[0]),ty(s[1]));ctx.lineTo(tx(s[2]),ty(s[3]));}ctx.stroke();ctx.setLineDash([]);}
    ctx.globalAlpha=0.95;ctx.lineWidth=1.0;
    for(let t=0;t<7;t++){ctx.strokeStyle=_GCOL[t];ctx.beginPath();for(const s of layers[idx].segs){if((s[4]||0)===t){ctx.moveTo(tx(s[0]),ty(s[1]));ctx.lineTo(tx(s[2]),ty(s[3]));}}ctx.stroke();}
    const info=el('slPreviewInfo');if(info)info.textContent=`Capa ${idx+1}/${layers.length} · Z=${layers[idx].z.toFixed(2)}mm · ${layers[idx].segs.length} trazos`;
  }
  // Vista 3D de trayectorias (todas las capas hasta idx, rotable) — estilo OrcaSlicer
  function _drawGcode3D(idx){
    const layers=S.gcodeLayers;if(!layers||!layers.length)return;
    idx=Math.max(0,Math.min(layers.length-1,idx));S.previewIdx=idx;
    const cv=el('slGcodeCanvas');if(!cv)return;
    const w=cv.clientWidth||420,h=320,dpr=window.devicePixelRatio||1;
    cv.width=w*dpr;cv.height=h*dpr;const ctx=cv.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
    const b=S.previewBounds,zmax=layers[idx].z,zmid=zmax/2;
    const rad=Math.max(Math.hypot(b.dx,b.dy)/2,zmax/2,1),sc=0.42*Math.min(w,h)/rad;
    const r=S.gcodeRot||(S.gcodeRot={a:0.6,b:-1.0});
    const ca=Math.cos(r.a),sa=Math.sin(r.a),cb=Math.cos(r.b),sb=Math.sin(r.b);
    const proj=(x,y,z)=>{const X=x-b.cx,Y=y-b.cy,Z=z-zmid;const x1=X*ca-Y*sa,y1=X*sa+Y*ca;const z2=y1*sb+Z*cb;return[w/2+x1*sc,h/2-z2*sc];};
    let total=0;for(let L=0;L<=idx;L++)total+=layers[L].segs.length;
    const stride=total>45000?Math.ceil(total/45000):1;
    ctx.lineWidth=0.6;ctx.globalAlpha=0.9;
    for(let t=0;t<7;t++){
      ctx.strokeStyle=_GCOL[t];ctx.beginPath();
      for(let L=0;L<=idx;L++){const z=layers[L].z,segs=layers[L].segs;for(let i=0;i<segs.length;i+=stride){const s=segs[i];if((s[4]||0)!==t)continue;const a=proj(s[0],s[1],z),bb=proj(s[2],s[3],z);ctx.moveTo(a[0],a[1]);ctx.lineTo(bb[0],bb[1]);}}
      ctx.stroke();
    }
    const info=el('slPreviewInfo');if(info)info.textContent=`3D · capas 1–${idx+1}/${layers.length} · Z=${zmax.toFixed(2)}mm${stride>1?' · vista simplificada':''} · arrastra para rotar`;
  }
  function toggleGcode3D(on){S.gcode3D=on;_drawGcodeLayer(S.previewIdx||0);}
  function preview(){
    if(!S.gcode){toast('Genera primero el G-code','error');return;}
    S.gcodeLayers=_parseGcodeLayers();
    if(!S.gcodeLayers.length){toast('Sin capas para previsualizar','error');return;}
    let mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;
    for(const L of S.gcodeLayers)for(const s of L.segs){
      if(s[0]<mnx)mnx=s[0];if(s[2]<mnx)mnx=s[2];if(s[0]>mxx)mxx=s[0];if(s[2]>mxx)mxx=s[2];
      if(s[1]<mny)mny=s[1];if(s[3]<mny)mny=s[3];if(s[1]>mxy)mxy=s[1];if(s[3]>mxy)mxy=s[3];
    }
    S.previewBounds={cx:(mnx+mxx)/2,cy:(mny+mxy)/2,dx:mxx-mnx,dy:mxy-mny};
    el('slPreviewWrap').style.display='block';
    const sld=el('slPreviewSlider');sld.max=S.gcodeLayers.length-1;sld.value=S.gcodeLayers.length-1;
    _drawGcodeLayer(S.gcodeLayers.length-1);
  }
  function previewSlide(v){_drawGcodeLayer(+v);}
  function toggleTravel(on){S.showTravel=on;_drawGcodeLayer(S.previewIdx||0);}
  function _suggestPrinter(machines,est){
    // Score each machine: idle>standby>other; model match bonus; queue empty bonus
    const model=el('slPrinter').value;
    const scores=machines.map(m=>{
      const st=(_printerStatus[m.id]||{}).state||'offline';
      const busy=st==='printing'||st==='paused';
      const idle=st==='idle'||st==='standby'||st==='ready';
      const spec=SPECS[m.modelo]||SPECS[model]||{};
      const fits=S.bounds?(S.bounds.dx<=(spec.x||300)&&S.bounds.dy<=(spec.y||300)&&S.bounds.dz<=(spec.z||300)):true;
      let score=0;
      if(busy)score-=100;
      if(idle)score+=10;
      if(m.modelo===model)score+=5;
      if(fits)score+=8;
      if(!_queueCount(m.id))score+=3;
      return{m,score,idle,busy,fits};
    });
    scores.sort((a,b)=>b.score-a.score);
    return scores[0]?.m||null;
  }
  function renderResult(est){
    S.est=est;
    const model=el('slPrinter').value;
    const machines=MAQUINAS.filter(m=>getPrinterIp(m));
    const suggested=_suggestPrinter(machines,est);
    const opts=machines.map(m=>{
      const isSugg=suggested&&m.id===suggested.id;
      const st=(_printerStatus[m.id]||{}).state||'offline';
      const q=_queueCount(m.id);
      const label=`${escapeHtml(m.nombre)} #${m.numG}${isSugg?' ★':''}${q?' ('+q+' en cola)':''}${st==='printing'?' [imprimiendo]':''}`;
      return`<option value="${m.id}" ${isSugg?'selected':m.modelo===model?'selected':''}>${label}</option>`;
    }).join('');
    const kb=Math.round(S.gcode.length/1024);
    // Precio del filamento: usa el ya configurado en Máquinas (filament_cost_clp) si el slicer no tiene uno propio, para mantener un solo número en toda la app
    const pk=localStorage.getItem('sl_price_kg')||localStorage.getItem('filament_cost_clp')||'15000',rh=localStorage.getItem('sl_rate_h')||'1500';
    const warns=[];
    if(S.params.supports)warns.push('<b>Soportes activados</b>: '+(S.params.treeSupports?'tipo árbol (ramas que se fusionan en troncos, fáciles de retirar)':'columnas en rejilla bajo los voladizos, retirar a mano')+'. Para voladizos muy complejos un slicer dedicado dará mejor acabado.');
    if(S.params.raft)warns.push('Se pidió <b>raft</b>: no está soportado — se imprime brim como adhesión alternativa.');
    if(S.params.arcFitting)warns.push('<b>Arcos G2/G3 activados</b>: el archivo es más liviano, pero tu Klipper debe tener <code>[gcode_arcs]</code> habilitado (las K1/K2 modernas lo traen). Si la impresora rechaza G2/G3, vuelve a desactivar esta opción.');
    const suggHint=suggested?`<div style="font-size:10px;color:var(--accent);margin-bottom:8px">💡 Impresora sugerida: <b>${escapeHtml(suggested.nombre)} #${suggested.numG}</b> — ${((_printerStatus[suggested.id]||{}).state||'offline')}</div>`:'';
    el('slResult').style.display='block';
    el('slResult').innerHTML=`
      ${warns.length?`<div style="padding:11px 13px;margin-bottom:12px;background:rgba(255,170,0,0.1);border:1px solid rgba(255,170,0,0.4);border-radius:10px;font-size:11px;color:#ffaa00;line-height:1.5">⚠ ${warns.join('<br>⚠ ')}</div>`:''}
      <div style="padding:14px;background:rgba(0,212,170,0.07);border:1px solid rgba(0,212,170,0.3);border-radius:10px">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          <span class="badge badge-green">⏱ ~${fmtTime(est.secs)}</span>
          <span class="badge badge-green">🧵 ${est.filM.toFixed(1)} m</span>
          <span class="badge badge-green">⚖ ~${est.grams.toFixed(0)} g</span>
          <span class="badge badge-gray">📄 ${kb.toLocaleString('es-CL')} KB</span>
        </div>
        <!-- COSTO -->
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px;background:var(--surface2);border-radius:8px;margin-bottom:12px">
          <span style="font-size:10px;color:var(--text3)">Filamento $/kg</span>
          <input id="slPriceKg" type="number" value="${pk}" oninput="SL3D.costRecalc()" style="width:80px;background:var(--surface);border:1px solid var(--border2);border-radius:6px;padding:4px 7px;color:var(--text);font-size:11px">
          <span style="font-size:10px;color:var(--text3)">Máquina $/h</span>
          <input id="slRateH" type="number" value="${rh}" oninput="SL3D.costRecalc()" style="width:70px;background:var(--surface);border:1px solid var(--border2);border-radius:6px;padding:4px 7px;color:var(--text);font-size:11px">
          <span style="margin-left:auto;font-size:10px;color:var(--text3)">Costo estimado:&nbsp;</span><span id="slCostOut"></span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 10px;background:var(--surface2);border-radius:8px;margin-bottom:12px;font-size:10px;color:var(--text3)">
          <span>Margen objetivo</span>
          <input id="slMargen" type="number" min="0" max="95" value="${localStorage.getItem('cot_margen_min')||25}" oninput="SL3D.costRecalc()" style="width:55px;background:var(--surface);border:1px solid var(--border2);border-radius:6px;padding:4px 7px;color:var(--text);font-size:11px;text-align:center"> %
          <span style="margin-left:auto">Precio sugerido (neto):&nbsp;</span><span id="slPriceSuggest"></span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-primary" onclick="SL3D.descargar()">⬇ Descargar .gcode</button>
          <button class="btn btn-ghost" onclick="SL3D.preview()">👁 Vista previa por capas</button>
          <button onclick="SL3D.slicerToCot()" class="btn btn-ghost btn-sm" style="flex:1" title="Pre-llenar cotización con los datos de esta pieza">📋 Cotizar</button>
          ${machines.length?`
          <div style="display:flex;flex-direction:column;gap:6px;width:100%;margin-top:4px">
            ${suggHint}
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <select class="field-select" id="slTarget" style="width:auto;min-width:180px">${opts}</select>
              <label style="font-size:10px;color:var(--text2);display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" id="slAutoStart"> Iniciar al subir</label>
              <button class="btn btn-ghost" id="slBtnSend" onclick="SL3D.enviar()">📤 Enviar</button>
              <button class="btn btn-ghost" id="slBtnQueue" onclick="SL3D.encolar()" title="Encolar: el trabajo se iniciará automáticamente cuando la impresora quede libre">🔁 Encolar</button>
              <button class="btn btn-ghost" onclick="SL3D.enviarATodas()" title="Enviar a todas las impresoras libres simultáneamente">📤 Todas las libres</button>
            </div>
          </div>
          `:'<span style="font-size:10px;color:var(--text3)">Configura la IP de una impresora para enviar directo</span>'}
        </div>
        <!-- VISTA PREVIA -->
        <div id="slPreviewWrap" style="display:none;margin-top:12px">
          <canvas id="slGcodeCanvas" height="320" style="width:100%;border-radius:8px;background:#0d0d0d;border:1px solid var(--border);display:block"></canvas>
          <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
            <input id="slPreviewSlider" type="range" min="0" max="1" value="0" oninput="SL3D.previewSlide(this.value)" style="flex:1">
            <span id="slPreviewInfo" style="font-size:10px;color:var(--text3);font-family:'JetBrains Mono',monospace;white-space:nowrap"></span>
          </div>
          <div style="display:flex;align-items:center;gap:12px;margin-top:6px;flex-wrap:wrap;font-size:10px;color:var(--text3)">
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" id="slPreview3D" onchange="SL3D.toggleGcode3D(this.checked)" style="cursor:pointer">3D</label>
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" id="slPreviewTravel" onchange="SL3D.toggleTravel(this.checked)" style="cursor:pointer">viajes</label>
            <span style="color:#ff5a5a">━ pared ext</span><span style="color:#ffb13a">━ pared int</span><span style="color:#c9a227">━ relleno</span><span style="color:#00d4aa">━ superficie</span><span style="color:#7a8a99">━ soporte</span><span style="color:#3aa0ff">━ puente</span><span style="color:#a78bfa">━ adhesión</span>
          </div>
        </div>
      </div>`;
    costRecalc();
  }
  function descargar(){
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([S.gcode],{type:'text/plain'}));
    a.download=gcodeFileName();a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),5000);
  }
  function enviar(){
    const id=el('slTarget')?.value;if(!id||!S.gcode)return;
    const m=MAQUINAS.find(x=>x.id===id);const ip=getPrinterIp(m);
    if(!ip){toast('Esa impresora no tiene IP configurada','error');return;}
    const fname=gcodeFileName(),autoStart=el('slAutoStart')?.checked;
    const btn=el('slBtnSend');btn.disabled=true;btn.textContent='⏳ Subiendo…';
    const fd=new FormData();
    fd.append('file',new Blob([S.gcode],{type:'text/plain'}),fname);
    fd.append('root','gcodes');
    const xhr=new XMLHttpRequest();
    xhr.open('POST',printerUrl(ip,'/server/files/upload'));
    const hdrs=getPrinterAuthHeaders(id);for(const k in hdrs)xhr.setRequestHeader(k,hdrs[k]);
    xhr.upload.onprogress=ev=>{if(ev.lengthComputable)btn.textContent='⏳ '+Math.round(ev.loaded/ev.total*100)+'%';};
    xhr.onload=async()=>{
      btn.disabled=false;btn.textContent='📤 Enviar a impresora';
      if(xhr.status>=200&&xhr.status<300){
        toast(`✓ ${fname} subido a ${m.nombre} #${m.numG}`,'success');
        if(autoStart){
          try{
            const r=await fetch(printerUrl(ip,`/printer/print/start?filename=${encodeURIComponent(fname)}`),{method:'POST',signal:AbortSignal.timeout(8000),headers:getPrinterAuthHeaders(id)});
            toast(r.ok?`▶ Imprimiendo en ${m.nombre} #${m.numG}`:'No se pudo iniciar la impresión',r.ok?'success':'error');
            if(typeof pollPrinters==='function')pollPrinters();
          }catch(e){toast('No se pudo iniciar: '+e.message,'error');}
        }
      }else toast('Error al subir ('+xhr.status+')','error');
    };
    xhr.onerror=()=>{btn.disabled=false;btn.textContent='📤 Enviar a impresora';toast('Impresora inaccesible — revisa modo Local/Remoto y el túnel','error');};
    xhr.send(fd);
  }
  function encolar(){
    const id=el('slTarget')?.value;if(!id||!S.gcode)return;
    const m=MAQUINAS.find(x=>x.id===id);if(!m){toast('Impresora no encontrada','error');return;}
    const st=(_printerStatus[id]||{}).state||'offline';
    const busy=st==='printing'||st==='paused';
    if(!busy){
      // printer is free: just send + auto-start
      const autoOld=el('slAutoStart');if(autoOld)autoOld.checked=true;
      enviar();return;
    }
    const fname=gcodeFileName();
    _queueAdd(id,S.gcode,fname,S.est?.secs,S.est?.grams);
  }

  // ── Cotizar desde slicer: transfiere datos a la pestaña de cotización ──
  function slicerToCot(){
    if(!S.est||!S.params){toast('Genera el G-code primero','error');return;}
    const matName=el('slMaterial').value,grams=S.est.grams.toFixed(0),secs=S.est.secs,nom=S.name||'Pieza 3D';
    // Costo y precio sugerido (mismo cálculo que el panel de costo) para llevarlo como referencia a la cotización
    const pk=+(el('slPriceKg')?.value)||+localStorage.getItem('sl_price_kg')||15000;
    const rh=+(el('slRateH')?.value)||+localStorage.getItem('sl_rate_h')||1500;
    const mg=+(el('slMargen')?.value)||+localStorage.getItem('cot_margen_min')||25;
    const costo=S.est.grams/1000*pk+secs/3600*rh;
    const precio=mg<95?costo/(1-mg/100):costo;
    if(typeof switchTab==='function')switchTab('nueva-cot');
    setTimeout(()=>{
      const obs=document.getElementById('cotObs')||document.querySelector('textarea[id*="obs"],textarea[placeholder*="observ" i]');
      if(obs)obs.value=`Impresión 3D: ${nom} — Material: ${matName}, ~${grams}g, ~${typeof fmtTime==='function'?fmtTime(secs):Math.round(secs/60)+'min'} · Costo est. ${_money(costo)} · Precio sugerido ${_money(precio)} (margen ${mg}%, neto)`;
      toast('Datos del slicer copiados a cotización','success');
    },300);
  }
  // ── Enviar a todas las impresoras libres ──
  function enviarATodas(){
    if(!S.gcode){toast('Genera el G-code primero','error');return;}
    const libres=MAQUINAS.filter(m=>{
      const st=(typeof _printerStatus!=='undefined'&&_printerStatus[m.id]||{}).state||'offline';
      return(st==='idle'||st==='ready'||st==='standby')&&(typeof getPrinterIp==='function'&&getPrinterIp(m));
    });
    if(!libres.length){toast('No hay impresoras libres con IP configurada','error');return;}
    if(!confirm(`¿Enviar a ${libres.length} impresora(s) libre(s)?\n${libres.map(m=>m.nombre+' #'+m.numG).join(', ')}`))return;
    libres.forEach(m=>{
      // enviar() recibe el id explícito; el select sólo se sincroniza si existe
      const slSel=document.getElementById('slSendTo');if(slSel)slSel.value=m.id;
      enviar(m.id);
    });
    toast(`Enviando a ${libres.length} impresora(s)…`,'success');
  }
  // ── Init ────────────────────────────────────────────────────
  function onPrinterChange(){if(S.stats)renderStats();loadMachineGcode();}
  document.addEventListener('DOMContentLoaded',()=>{
    const sel=el('slPrinter');if(!sel)return;
    sel.innerHTML=Object.keys(SPECS).map(k=>`<option value="${k}">${k} — ${SPECS[k].x}×${SPECS[k].y}×${SPECS[k].z}mm</option>`).join('');
    const drop=el('slDrop');
    ['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.style.borderColor='var(--accent)';drop.style.background='rgba(0,212,204,0.05)';}));
    ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.style.borderColor='var(--border2)';drop.style.background='';}));
    drop.addEventListener('drop',e=>loadFiles(e.dataTransfer.files));
    const cv=el('slCanvas');let _ptStart=null,_ptMoved=0;
    cv.addEventListener('pointerdown',e=>{S.drag={x:e.clientX,y:e.clientY};_ptStart={x:e.clientX,y:e.clientY};_ptMoved=0;cv.setPointerCapture(e.pointerId);if(!S.layFlatMode)cv.style.cursor='grabbing';});
    cv.addEventListener('pointermove',e=>{if(!S.drag)return;_ptMoved+=Math.abs(e.clientX-S.drag.x)+Math.abs(e.clientY-S.drag.y);S.rot.a+=(e.clientX-S.drag.x)*0.01;S.rot.b+=(e.clientY-S.drag.y)*0.01;S.drag={x:e.clientX,y:e.clientY};render();});
    cv.addEventListener('pointerup',e=>{
      const wasClick=_ptStart&&_ptMoved<6;S.drag=null;_ptStart=null;
      cv.style.cursor=S.layFlatMode?'crosshair':'grab';
      if(wasClick&&S.layFlatMode){const r=cv.getBoundingClientRect();_layFlatAt(e.clientX-r.left,e.clientY-r.top);}
    });
    // Arrastrar para rotar el preview 3D de trayectorias
    const gcv=el('slGcodeCanvas');
    if(gcv){gcv.style.touchAction='none';let gd=null;
      gcv.addEventListener('pointerdown',e=>{if(!S.gcode3D)return;gd={x:e.clientX,y:e.clientY};gcv.setPointerCapture(e.pointerId);gcv.style.cursor='grabbing';});
      gcv.addEventListener('pointermove',e=>{if(!gd)return;S.gcodeRot=S.gcodeRot||{a:0.6,b:-1.0};S.gcodeRot.a+=(e.clientX-gd.x)*0.01;S.gcodeRot.b+=(e.clientY-gd.y)*0.01;gd={x:e.clientX,y:e.clientY};_drawGcode3D(S.previewIdx||0);});
      gcv.addEventListener('pointerup',()=>{gd=null;gcv.style.cursor='grab';});
    }
  });
  return{loadFile,loadFiles,addObject,autoOrient,toggleLayFlat,toggleSupportPreview,analizarIA,usarPerfilBase,generarGcode,descargar,enviar,encolar,onPrinterChange,costRecalc,preview,previewSlide,calibrar,enviarCal,slicerToCot,enviarATodas,toggleAdvanced,addModifier,removeModifier,updModifier,addSupRegion,removeSupRegion,updSupRegion,updObjSetting,gcodePreset,saveMachineGcode,saveProfile,loadProfile,deleteProfile,toggleTravel,toggleGcode3D};
})();
