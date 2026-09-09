/* js/slicer3d.js â€” mÃ³dulo extraÃ­do de index.html (mismo orden de carga).
 * El deploy estampa la versiÃ³n en el src del index para bustear la cachÃ©. */

// â”€â”€ AGENTE DE IMPRESIÃ“N 3D â€” STL/OBJ â†’ G-code con IA + slicer nativo â”€â”€â”€â”€â”€
// Flujo: cargar STL/OBJ â†’ anÃ¡lisis geomÃ©trico local â†’ Claude elige parÃ¡metros
// â†’ laminado nativo en el navegador (sin dependencias) â†’ descarga o envÃ­o Moonraker.
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
    {k:'layerHeight',l:'Altura capa (mm)',s:0.04},{k:'firstLayerHeight',l:'1Âª capa (mm)',s:0.04},
    {k:'shells',l:'PerÃ­metros',s:1},{k:'topLayers',l:'Capas sup.',s:1},{k:'bottomLayers',l:'Capas inf.',s:1},
    {k:'infillPct',l:'Relleno (%)',s:5},{k:'infillType',l:'PatrÃ³n',sel:['grid','gyroid','triangle','hex','honeycomb','cubic','concentric','lightning','adaptive','linear']},
    {k:'speed',l:'Velocidad (mm/s)',s:10},{k:'outerSpeed',l:'Vel. pared ext.',s:5},{k:'infillSpeed',l:'Vel. relleno',s:10},
    {k:'firstLayerSpeed',l:'Vel. 1Âª capa',s:5},{k:'travelSpeed',l:'Vel. viaje',s:10},{k:'accel',l:'AceleraciÃ³n (mm/sÂ²)',s:500},
    {k:'accelOuter',l:'Accel pared ext. (0=auto)',s:500},{k:'accelInfill',l:'Accel relleno (0=auto)',s:500},{k:'jerk',l:'Jerk (mm/s, 0=off)',s:1},{k:'bridgeFlow',l:'Flujo puente (%)',s:5},
    {k:'nozzleTemp',l:'Boquilla (Â°C)',s:5},{k:'bedTemp',l:'Cama (Â°C)',s:5},{k:'fanPct',l:'Ventilador (%)',s:10},
    {k:'supports',l:'Soportes',sel:['no','sÃ­']},{k:'treeSupports',l:'Soporte Ã¡rbol',sel:['no','sÃ­']},{k:'supportAngle',l:'Ãng. soporte (Â°)',s:5},
    {k:'supGrid',l:'Soporte: rejilla (mm)',s:0.5},{k:'supZGap',l:'Soporte: sep. Z (mm)',s:0.05},{k:'supDensity',l:'Soporte: densidad (%)',s:5},
    {k:'supInterface',l:'Soporte: interfaz (capas)',s:1},{k:'supOnPlate',l:'Soporte solo desde cama',sel:['no','sÃ­']},
    {k:'infillOverlap',l:'Solape relleno/pared (%)',s:5},{k:'pauseAtZ',l:'Pausa a Z (mm, 0=off)',s:1},
    {k:'adaptiveLayerHeight',l:'Capa adaptativa',sel:['no','sÃ­']},
    {k:'minLayerTime',l:'Tiempo mÃ­n. capa (s)',s:1},{k:'overhangSpeed',l:'Vel. voladizo (mm/s)',s:5},
    {k:'flowRatio',l:'Flujo (%)',s:1},{k:'pressureAdvance',l:'Pressure Advance',s:0.005},{k:'wipeDist',l:'Wipe (mm)',s:0.2},
    {k:'widthOuter',l:'Ancho pared ext. (mm)',s:0.02},{k:'widthInfill',l:'Ancho relleno (mm)',s:0.02},
    {k:'seamMode',l:'Costura',sel:['cercano','alineado','agudo','aleatorio']},{k:'outerWallLast',l:'Pared ext. al final',sel:['no','sÃ­']},
    {k:'seamScarf',l:'Costura scarf (oculta)',sel:['no','sÃ­']},{k:'scarfLen',l:'Scarf: largo (mm)',s:0.5},
    {k:'bridgeDetect',l:'Detectar puentes',sel:['no','sÃ­']},{k:'arcFitting',l:'Arcos G2/G3',sel:['no','sÃ­']},{k:'gradualTemp',l:'Temp. gradual',sel:['no','sÃ­']},
    {k:'excludeObject',l:'Exclude Object (Klipper)',sel:['no','sÃ­']},{k:'sequential',l:'ImpresiÃ³n secuencial',sel:['no','sÃ­']},
    {k:'gapFill',l:'Relleno de huecos',sel:['no','sÃ­']},{k:'fuzzySkin',l:'Piel rugosa (mm)',s:0.05},{k:'coasting',l:'Coasting (mm)',s:0.1},
    {k:'fuzzyAll',l:'Piel rugosa: todas paredes',sel:['no','sÃ­']},{k:'fuzzyPointDist',l:'Piel rugosa: paso (mm)',s:0.1},{k:'draftShield',l:'Pantalla anti-corriente',sel:['no','sÃ­']},
    {k:'spiralize',l:'Modo jarrÃ³n',sel:['no','sÃ­']},{k:'monotonic',l:'Relleno monot.',sel:['no','sÃ­']},{k:'arachne',l:'Arachne (pared var.)',sel:['no','sÃ­']},
    {k:'elephantFoot',l:'Pie de elefante (mm)',s:0.05},{k:'xyCompensation',l:'CompensaciÃ³n XY (mm)',s:0.02},
    {k:'skirt',l:'Skirt (lÃ­neas)',s:1},{k:'skirtGap',l:'Skirt sep. (mm)',s:0.5},
    {k:'brim',l:'Brim (lÃ­neas)',s:1},{k:'brimGap',l:'Brim: separaciÃ³n (mm)',s:0.05},{k:'raft',l:'Raft',sel:['no','sÃ­']},
    {k:'ironing',l:'Planchado',sel:['no','sÃ­']},{k:'ironingFlow',l:'Planchado: flujo (%)',s:1},{k:'retractMinTravel',l:'Retrac. mÃ­n. viaje (mm)',s:0.2},
    {k:'retractDist',l:'RetracciÃ³n (mm)',s:0.1},{k:'retractSpeed',l:'Vel. retrac.',s:5},{k:'zHop',l:'Z-hop (mm)',s:0.1},
  ];
  const S={tris:null,objects:[],prev:null,stats:null,name:'',params:null,gcode:'',rot:{a:0.7,b:-1.1},enginePromise:null,drag:null,modifiers:[],supRegions:[],layFlatMode:false,showSupports:false,supSticks:null,objSettings:null};
  const el=id=>document.getElementById(id);

  // â”€â”€ Parsers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function parseSTL(buf){
    const head=new TextDecoder().decode(buf.slice(0,Math.min(600,buf.byteLength)));
    if(/^\s*solid[\s\S]*?facet/i.test(head)){
      const txt=new TextDecoder().decode(buf);
      const re=/vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;const v=[];let m;
      while((m=re.exec(txt)))v.push(+m[1],+m[2],+m[3]);
      const n=Math.floor(v.length/9)*9;
      if(!n)throw new Error('STL ASCII sin triÃ¡ngulos');
      return new Float32Array(v.slice(0,n));
    }
    if(buf.byteLength<84)throw new Error('STL invÃ¡lido (muy corto)');
    const dv=new DataView(buf);
    const n=Math.min(dv.getUint32(80,true),Math.floor((buf.byteLength-84)/50));
    if(!n)throw new Error('STL binario sin triÃ¡ngulos');
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
  // 3MF = ZIP con 3D/3dmodel.model (XML). Descomprime con DecompressionStream (sin librerÃ­as).
  async function parse3MF(buf){
    const dv=new DataView(buf),u8=new Uint8Array(buf);
    // Buscar End Of Central Directory (firma 0x06054b50) desde el final
    let eocd=-1;for(let i=buf.byteLength-22;i>=0;i--){if(dv.getUint32(i,true)===0x06054b50){eocd=i;break;}}
    if(eocd<0)throw new Error('3MF invÃ¡lido (no es ZIP)');
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
    // Parsear vÃ©rtices y triÃ¡ngulos del XML
    const vs=[],vre=/<vertex\s+x="([-\d.eE+]+)"\s+y="([-\d.eE+]+)"\s+z="([-\d.eE+]+)"/g;let m;
    while((m=vre.exec(xml)))vs.push(+m[1],+m[2],+m[3]);
    const out=[],tre=/<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g;
    while((m=tre.exec(xml))){const a=+m[1],b=+m[2],c=+m[3];for(const k of[a,b,c])out.push(vs[k*3],vs[k*3+1],vs[k*3+2]);}
    if(!out.length)throw new Error('3MF sin geometrÃ­a');
    return new Float32Array(out);
  }

  // â”€â”€ AnÃ¡lisis geomÃ©trico â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      // voladizo: cara hacia abajo >55Â° de la vertical, no apoyada en cama
      if(ln>0&&nz/ln<-0.57&&Math.min(az,bz,cz)>0.5)ovArea+=a2;
    }
    vol=Math.abs(vol);
    S.stats={dx,dy,dz,vol:vol/1000,area:area/100,tris:t.length/9,
      ovPct:area?ovArea/area*100:0,hr:dz/Math.max(5,Math.min(dx,dy))};
    S.bounds={dx,dy,dz};
  }

  // â”€â”€ Preview 3D (canvas, sin librerÃ­as) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function buildPreview(){
    const n=S.tris.length/9,cap=12000;
    if(n<=cap){S.prev=S.tris;return;}
    const stride=Math.ceil(n/cap),out=new Float32Array(Math.ceil(n/stride)*9);let o=0;
    for(let i=0;i<n;i+=stride){out.set(S.tris.subarray(i*9,i*9+9),o);o+=9;}
    S.prev=out;
  }
  // Z donde la vertical (x,y) cruza el triÃ¡ngulo o â†’ null si fuera del triÃ¡ngulo
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
    // En mallas enormes usa la versiÃ³n decimada para no congelar la UI (raycast O(repsÃ—triÃ¡ngulos))
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
      if(!ex||gz<ex.gz)buckets.set(key,{gx,gy,gz});   // el voladizo mÃ¡s bajo de la columna
    }
    const reps=[...buckets.values()],sticks=[];
    for(const r of reps){
      let below=0;                             // busca la superficie mÃ¡s alta estrictamente debajo
      for(let k=0;k<m;k++){const zk=_triZatXY(t,k*9,r.gx,r.gy);if(zk!==null&&zk<r.gz-0.4&&zk>below)below=zk;}
      sticks.push([r.gx,r.gy,r.gz,below]);
    }
    S.supSticks=sticks;
  }
  // Normales por vÃ©rtice con detecciÃ³n de pliegues: promedia las caras que comparten vÃ©rtice
  // SÃ“LO si su Ã¡ngulo es suave (curva) â†’ superficies curvas suaves, pero bordes duros (cubo) nÃ­tidos.
  function _computeVertexNormals(t){
    const m=t.length/9,fN=new Float32Array(m*3);
    for(let i=0;i<m;i++){const o=i*9;const ux=t[o+3]-t[o],uy=t[o+4]-t[o+1],uz=t[o+5]-t[o+2],vx=t[o+6]-t[o],vy=t[o+7]-t[o+1],vz=t[o+8]-t[o+2];fN[i*3]=uy*vz-uz*vy;fN[i*3+1]=uz*vx-ux*vz;fN[i*3+2]=ux*vy-uy*vx;}
    const map=new Map(),EPS=1e-3,key=(x,y,z)=>Math.round(x/EPS)+'_'+Math.round(y/EPS)+'_'+Math.round(z/EPS);
    for(let i=0;i<m;i++){const o=i*9;for(let j=0;j<3;j++){const k=key(t[o+j*3],t[o+j*3+1],t[o+j*3+2]);(map.get(k)||map.set(k,[]).get(k)).push(i);}}
    const out=new Float32Array(t.length),COS=0.5; // pliegue ~60Â°: caras a mÃ¡s de 60Â° = borde duro
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
    // â”€â”€ Cama de impresiÃ³n (plano Z=0) + eje Z: deja claro cuÃ¡l es la base â”€â”€
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
      ctx.fillText('Zâ†‘',z1[0]+3,z1[1]+3);
    })();
    // Sombra de contacto blanda bajo la pieza (asienta el modelo en la cama)
    {const base=proj(0,0,0),rsh=Math.max(st.dx,st.dy)*0.55*sc+5;ctx.save();ctx.translate(base[0],base[1]);ctx.scale(1,Math.abs(sb)*0.5+0.16);const rg=ctx.createRadialGradient(0,0,0,0,0,rsh);rg.addColorStop(0,'rgba(0,0,0,0.42)');rg.addColorStop(0.7,'rgba(0,0,0,0.18)');rg.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=rg;ctx.beginPath();ctx.arc(0,0,rsh,0,6.283);ctx.fill();ctx.restore();}
    const t=S.prev,m=t.length/9,list=new Array(m);
    if(S._prevNfor!==t){S.prevN=_computeVertexNormals(t);S._prevNfor=t;} // normales suaves cacheadas por malla
    const VN=S.prevN;
    const ovAng=S.params?-(Math.cos((90-(S.params.supportAngle||50))*Math.PI/180)):-0.57; // criterio segÃºn Ã¡ngulo
    for(let i=0;i<m;i++){
      const o=i*9,P=[];let dsum=0;
      // normal en espacio-modelo â†’ para detectar voladizo (cara hacia abajo no apoyada en la cama)
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
        // Normal SUAVE del vÃ©rtice, rotada igual que el vÃ©rtice â†’ sombreado tipo Gouraud
        const vnx=VN[o+j*3],vny=VN[o+j*3+1],vnz=VN[o+j*3+2];
        const r1=vnx*ca-vny*sa,r2=vnx*sa+vny*ca,rD=r2*cb-vnz*sb,rU=r2*sb+vnz*cb;
        const d1=Math.max(0,r1*-0.398+rD*-0.498+rU*0.747); // luz principal (arriba-izq-frente)
        const d2=Math.max(0,r1*0.707+rD*0.566+rU*0.424);   // luz de relleno (abajo-der, suave)
        diff+=0.30+0.66*d1+0.18*d2+0.10*Math.abs(rD);      // ambiental + principal + relleno + luz de cabeza
        const hsp=Math.abs(r1*-0.233+rD*-0.876+rU*0.437);  // half-vector â†’ brillo especular
        spec+=Math.pow(hsp,22);
      }
      diff=Math.min(1,diff/3);spec=spec/3*0.5;
      list[i]={d:dsum,P,diff,spec,over};
    }
    list.sort((p,q)=>q.d-p.d);
    for(const f of list){
      ctx.beginPath();ctx.moveTo(f.P[0],f.P[1]);ctx.lineTo(f.P[2],f.P[3]);ctx.lineTo(f.P[4],f.P[5]);ctx.closePath();
      const sp=Math.round(f.spec*255);
      // Voladizos en naranja (necesitan soporte); resto en teal Â· brillo especular sumado en blanco
      const col=f.over
        ?`rgb(${Math.min(255,Math.round(236*f.diff)+sp)},${Math.min(255,Math.round(128*f.diff)+sp)},${Math.min(255,Math.round(52*f.diff)+sp)})`
        :`rgb(${Math.min(255,Math.round(70*f.diff)+sp)},${Math.min(255,Math.round(200*f.diff)+sp)},${Math.min(255,Math.round(190*f.diff)+sp)})`;
      ctx.fillStyle=col;ctx.fill();
      ctx.strokeStyle=col;ctx.lineWidth=1;ctx.lineJoin='round';ctx.stroke(); // tapa costuras â†’ superficie continua
    }
    // â”€â”€ Columnas de soporte (palitos verticales bajo los voladizos) â”€â”€
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
    ctx.fillText(S.layFlatMode?'haz clic en una cara para apoyarla en la cama':(S.showSupports?`soportes: ${S.supSticks?S.supSticks.length:0} columnas Â· naranja = voladizos`:'arrastra para rotar Â· la rejilla es la cama'),10,h-10);
  }

  // â”€â”€ Auto-orientaciÃ³n: prueba orientaciones y elige la de menos voladizos â”€â”€
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
    toast(bestI===0?`Ya estaba en la mejor orientaciÃ³n (voladizos ${S.stats.ovPct.toFixed(1)}%)`:`Re-orientado: voladizos ahora ${S.stats.ovPct.toFixed(1)}%`,'success');
  }
  // â”€â”€ Apoyar cara en la cama (lay-flat por clic) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Rota toda la malla para que la normal `n` apunte hacia abajo (âˆ’Z) â†’ esa cara queda sobre la cama.
  function _alignTris(t,n){
    let nx=n[0],ny=n[1],nz=n[2];const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;
    // eje de giro = n Ã— (0,0,âˆ’1) = (âˆ’ny, nx, 0) ; dot = nÂ·(0,0,âˆ’1) = âˆ’nz
    let ax=-ny,ay=nx,az=0;
    const al=Math.hypot(ax,ay,az),dot=-nz;
    const o=new Float32Array(t.length);
    if(al<1e-6){
      if(dot>0)return t.slice();           // ya mira hacia abajo
      for(let i=0;i<t.length;i+=3){o[i]=t[i];o[i+1]=-t[i+1];o[i+2]=-t[i+2];}// antiparalela: girar 180Â° en X
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
    if(!bestN){toast('No se detectÃ³ cara ahÃ­ â€” haz clic sobre la figura','error');return;}
    S.tris=_alignTris(S.tris,bestN);S.objBBs=null;
    analyze(S.tris);buildPreview();S.supSticks=null;
    S.params=null;S.gcode='';S.modifiers=[];S.supRegions=[];
    el('slParamsWrap').style.display='none';el('slRazon').style.display='none';el('slResult').style.display='none';
    renderModifiers();renderSupRegions();renderObjSettings();
    S.layFlatMode=false;_updLayFlatBtn();
    render();renderStats();
    toast(`âœ“ Cara apoyada en la cama (voladizos ${S.stats.ovPct.toFixed(1)}%) â€” revisa parÃ¡metros y vuelve a generar`,'success');
  }
  function _updLayFlatBtn(){
    const b=el('slLayFlatBtn'),cv=el('slCanvas');if(!b)return;
    if(S.layFlatMode){b.classList.add('btn-primary');b.classList.remove('btn-ghost');b.textContent='ğŸ“ Clic en una caraâ€¦';if(cv)cv.style.cursor='crosshair';}
    else{b.classList.remove('btn-primary');b.classList.add('btn-ghost');b.textContent='ğŸ“ Apoyar cara';if(cv)cv.style.cursor='grab';}
  }
  function toggleLayFlat(){
    if(!S.tris){toast('Carga un modelo primero','error');return;}
    S.layFlatMode=!S.layFlatMode;_updLayFlatBtn();render();
    if(S.layFlatMode)toast('Haz clic en la cara que quieres apoyar en la cama','success');
  }
  // Vista previa de soportes: pinta de naranja las caras con voladizo (las que necesitarÃ¡n soporte)
  function toggleSupportPreview(){
    if(!S.tris){toast('Carga un modelo primero','error');return;}
    S.showSupports=!S.showSupports;
    const b=el('slSupPrevBtn');
    if(b){if(S.showSupports){b.classList.add('btn-primary');b.classList.remove('btn-ghost');}else{b.classList.remove('btn-primary');b.classList.add('btn-ghost');}}
    render();
    if(S.showSupports)toast(`Voladizos en naranja${S.stats?` â€” ${S.stats.ovPct.toFixed(1)}% del Ã¡rea`:''}`,'success');
  }
  // â”€â”€ Plating multi-objeto: centra cada pieza y las acomoda en rejilla â”€â”€
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
    // Cajas por objeto en coords centradas (= como queda la malla tras analyze) â†’ para EXCLUDE_OBJECT
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
    S.objBBs=S.objects.length>1?S._plateBBs:null; // EXCLUDE_OBJECT sÃ³lo con 2+ piezas
    S.objSettings=S.objects.length>1?(S._plateBBs||[]).map((_,i)=>(S.objSettings&&S.objSettings[i])||{}):null; // ajustes por pieza
    analyze(S.tris);buildPreview();
    const fn=el('slFileName');fn.style.display='block';fn.textContent=S.objects.length>1?`âœ“ ${S.objects.length} piezas en el plato`:'âœ“ '+S.name;
    el('slCanvas').style.display='block';render();renderStats();
    el('slBtnIA').disabled=false;el('slBtnBase').disabled=false;
    el('slParamsWrap').style.display='none';el('slRazon').style.display='none';el('slResult').style.display='none';
    S.params=null;S.gcode='';
  }
  // â”€â”€ ReparaciÃ³n de malla: descarta triÃ¡ngulos invÃ¡lidos (NaN/Inf) y degenerados (Ã¡rea ~0),
  //    suelda vÃ©rtices casi-coincidentes a una rejilla fina (cierra micro-huecos de ruido de coma flotante).
  //    Conservadora: una malla sana pasa intacta. Devuelve {tris, removed, welded}.
  function _repairMesh(t){
    if(!t||!t.length)return{tris:t,removed:0,welded:0};
    const triCnt=t.length/9,out=new Float32Array(t.length);
    // Rejilla de soldadura: 1Âµm â€” por debajo de la resoluciÃ³n de impresiÃ³n, no altera la geometrÃ­a real
    const SNAP=0.001,snap=v=>Math.round(v/SNAP)*SNAP;
    let o=0,removed=0,welded=0;
    for(let i=0;i<triCnt;i++){
      const b=i*9;
      let ok=true;for(let j=0;j<9;j++){if(!isFinite(t[b+j])){ok=false;break;}}
      if(!ok){removed++;continue;}
      // Soldadura a rejilla
      const v=[];for(let j=0;j<9;j++){const s=snap(t[b+j]);if(s!==t[b+j])welded++;v.push(s);}
      // Descarta degenerados: dos vÃ©rtices iguales o Ã¡rea ~0 (colineales)
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
    if(!files.length){toast('Formato no soportado â€” usa STL, OBJ o 3MF','error');return;}
    try{
      const parsed=[];let totRemoved=0,totWelded=0;
      for(const f of files){const r=_repairMesh(await _parseFile(f));totRemoved+=r.removed;totWelded+=r.welded;parsed.push(_centerTris(r.tris));}
      S.objects=parsed;S.name=files[0].name.replace(/\.(stl|obj|3mf)$/i,'')+(files.length>1?` +${files.length-1}`:'');
      S.modifiers=[];S.supRegions=[]; // nuevos rangos de Z dependen del modelo â†’ limpiar al cargar uno nuevo
      S.layFlatMode=false;S.supSticks=null;_updLayFlatBtn();
      _replate();
      const repMsg=totRemoved>0?` Â· reparado: ${totRemoved} triÃ¡ngulo(s) invÃ¡lido(s) descartado(s)`:'';
      toast((files.length>1?`${files.length} piezas cargadas y acomodadas en el plato`:`Modelo cargado: ${S.stats.tris.toLocaleString('es-CL')} triÃ¡ngulos`)+repMsg,'success');
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
      toast(`Pieza agregada â€” ${S.objects.length} en el plato`,'success');
    }catch(e){toast('Error: '+e.message,'error');}
  }

  // â”€â”€ Carga de archivo (compat: delega en loadFiles para mantener el estado del plato) â”€â”€
  async function loadFile(file){if(file)return loadFiles([file]);}
  function fitsIn(spec){const st=S.stats;return st.dx<=spec.x-2&&st.dy<=spec.y-2&&st.dz<=spec.z-2;}
  function renderStats(){
    const st=S.stats,spec=SPECS[el('slPrinter').value]||SPECS.K1;
    const fits=fitsIn(spec);
    el('slStats').style.display='block';
    el('slStats').innerHTML=`
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <span class="badge badge-gray">ğŸ“ ${st.dx.toFixed(1)} Ã— ${st.dy.toFixed(1)} Ã— ${st.dz.toFixed(1)} mm</span>
        <span class="badge badge-gray">ğŸ§Š ${st.vol.toFixed(1)} cmÂ³</span>
        <span class="badge badge-gray">â–² ${st.tris.toLocaleString('es-CL')} tris</span>
        <span class="badge ${st.ovPct>8?'badge-yellow':'badge-green'}">â›° voladizos ${st.ovPct.toFixed(1)}%</span>
        ${st.hr>3?'<span class="badge badge-yellow">âš  pieza alta y delgada</span>':''}
        <span class="badge ${fits?'badge-green':'badge-red'}">${fits?'âœ“ cabe en '+el('slPrinter').value:'âœ• NO cabe en '+el('slPrinter').value}</span>
      </div>`;
  }

  // â”€â”€ IA: selecciÃ³n de parÃ¡metros â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function resumen(){
    const st=S.stats,model=el('slPrinter').value,spec=SPECS[model],mat=el('slMaterial').value;
    const obj=el('slObjetivo').selectedOptions[0].textContent,noz=el('slNozzle').value,notas=el('slNotas').value.trim();
    return`PIEZA: ${S.name}
- Dimensiones (XÃ—YÃ—Z): ${st.dx.toFixed(1)} Ã— ${st.dy.toFixed(1)} Ã— ${st.dz.toFixed(1)} mm
- Volumen sÃ³lido: ${st.vol.toFixed(1)} cmÂ³ Â· Ãrea: ${st.area.toFixed(0)} cmÂ² Â· ${st.tris} triÃ¡ngulos
- Voladizos >55Â° sin apoyo: ${st.ovPct.toFixed(1)}% del Ã¡rea
- RelaciÃ³n altura/base: ${st.hr.toFixed(1)} ${st.hr>3?'(riesgo de volcarse â€” considerar brim)':'(estable)'}
IMPRESORA: ${model} â€” volumen ${spec.x}Ã—${spec.y}Ã—${spec.z}mm, velocidad mÃ¡x ${spec.vmax}mm/s, boquilla ${noz}mm
MATERIAL: ${mat} Â· OBJETIVO: ${obj}${notas?'\nNOTAS DEL OPERADOR: '+notas:''}`;
  }
  const IA_SYS=`Eres KAI-SLICER, ingeniero experto en impresiÃ³n 3D FDM de The Lab Solutions (Santiago, Chile).
Eliges parÃ¡metros de laminado Ã³ptimos segÃºn geometrÃ­a de la pieza, material, impresora y objetivo.
REGLAS: TPU mÃ¡x 35mm/s y retracciÃ³n corta. PETG ventilador â‰¤50%, no exceder 250Â°C. ABS cama 95-105Â°C, ventilador â‰¤30%, ideal brim. Voladizos >55Â° o >8% del Ã¡rea â†’ soportes (el slicer genera columnas bajo voladizos). Si activas soportes (supports=true), pon SIEMPRE treeSupports=true por defecto (troncos de celosÃ­a con base ancha, estables y fÃ¡ciles de retirar); usa treeSupports=false solo si el voladizo es una superficie plana grande y continua que necesita interfaz densa. adaptiveLayerHeight=true en piezas con curvas pronunciadas o detalles finos: reduce capas en zonas planas y usa capas finas en curvas. Pieza alta/delgada (ratio >3) â†’ brim 6-10 lÃ­neas. Primera capa: mÃ¡s gruesa y lenta. Altura de capa entre 25% y 75% del diÃ¡metro de boquilla. Piezas funcionales: 3-4 perÃ­metros y relleno gyroid 30-50%. Piezas estÃ©ticas: capa fina, velocidad moderada, activa ironing para cara superior lisa. Patrones de relleno: grid (general), gyroid (resistente isÃ³tropo), triangle/hex (rÃ­gido), cubic (3D resistente), concentric (sigue el contorno, bueno para flexibles/sellos), linear (rÃ¡pido).
COSTURA (seamMode): "alineado" oculta la costura atrÃ¡s de la pieza (estÃ©tico), "agudo" en esquinas, "cercano" minimiza viaje. outerWallLast=true imprime la pared exterior al final â†’ mejor acabado. bridgeDetect=true para voladizos horizontales. elephantFoot (mm, 0-0.3): encoge la 1Âª capa. xyCompensation (mm, -0.3 a 0.3): negativo agranm«ëŒ+Š×®º+º$zzb¥ç'FFò(	BW65DÂÂô$¢ò4ÔbrÂvW'&÷"r“·&WGW&ã·Ğ¢G'—°¢6öç7B'6VCÕµÓ¶ÆWBF÷E&VÖ÷fVCÓÇF÷EvVÆFVCÓ°¢f÷"†6öç7Bböbf–ÆW2—¶6öç7B#Õ÷&W—$ÖW6‚†v—B÷'6Tf–ÆR†b’“·F÷E&VÖ÷fVB³×"ç&VÖ÷fVC·F÷EvVÆFVB³×"çvVÆFVC·'6VBçW6‚…ö6VçFW%G&—2‡"çG&—2’“·Ğ¢2æö&¦V7G3×'6VCµ2ææÖSÖf–ÆW5³ÒææÖRç&WÆ6R‚õÂâ‡7FÇÆö&§Ã6Öb’Bö’Ârr’²†f–ÆW2æÆVæwFƒãö²G¶f–ÆW2æÆVæwF‚ÓÖ¢rr“°¢2æÖöF–f–W'3ÕµÓµ2ç7W&Vv–öç3ÕµÓ²òòçVWf÷2&æv÷2FR¢FWVæFVâFVÂÖöFVÆò(i"Æ–×–"Â6&v"VæòçVWfğ¢2æÆ”fÆDÖöFSÖfÇ6Sµ2ç7W7F–6·3ÖçVÆÃµ÷WDÆ”fÆD'Fâ‚“°¢÷&WÆFR‚“°¢6öç7B&W×6s×F÷E&VÖ÷fVCãö+r&W&Fó¢G·F÷E&VÖ÷fVGÒG&œ:æwVÆò‡2’–çl:Æ–Fò‡2’FW66'FFò‡2–¢rs°¢Fö7B‚†f–ÆW2æÆVæwFƒãöG¶f–ÆW2æÆVæwF‡Ò–W¦26&vF2’6öÖöFF2VâVÂÆFö¦ÖöFVÆò6&vFó¢Gµ2ç7FG2çG&—2çFôÆö6ÆU7G&–ær‚vW2Ô4Âr—ÒG&œ:æwVÆ÷6’·&W×6rÂw7V66W72r“°¢Ö6F6‚†R—·Fö7B‚tW'&÷"ÂÆVW"VÂÖöFVÆó¢r¶RæÖW76vRÂvW'&÷"r“·Ğ¢Ğ¢7–æ2gVæ7F–öâFDö&¦V7B†f–ÆTÆ—7B—°¢6öç7Bf–ÆW3Ô'&’æg&öÒ†f–ÆTÆ—7GÇÅµÒ’æf–ÇFW"†cÓâõÂâ‡7FÇÆö&§Ã6Öb’Bö’çFW7B†bææÖR’“°¢–b‚f–ÆW2æÆVæwF‚—&WGW&ã°¢–b‚2æö&¦V7G2æÆVæwF‚—·&WGW&âÆöDf–ÆW2†f–ÆW2“·Ğ¢G'—°¢f÷"†6öç7Bböbf–ÆW2•2æö&¦V7G2çW6‚…ö6VçFW%G&—2…÷&W—$ÖW6‚†v—B÷'6Tf–ÆR†b’’çG&—2’“°¢2ææÖSÕ2ææÖRç&WÆ6R‚òÂµÆB²BòÂrr’¶²Gµ2æö&¦V7G2æÆVæwF‚ÓÖ°¢÷&WÆFR‚“°¢Fö7B†–W¦w&VvF(	BGµ2æö&¦V7G2æÆVæwF‡ÒVâVÂÆFöÂw7V66W72r“°¢Ö6F6‚†R—·Fö7B‚tW'&÷#¢r¶RæÖW76vRÂvW'&÷"r“·Ğ¢Ğ ¢òò)H)H6&vFR&6†—fò†6ö×C¢FVÆVvVâÆöDf–ÆW2&ÖçFVæW"VÂW7FFòFVÂÆFò’)H)H ¢7–æ2gVæ7F–öâÆöDf–ÆR†f–ÆR—¶–b†f–ÆR—&WGW&âÆöDf–ÆW2…¶f–ÆUÒ“·Ğ¢gVæ7F–öâf—G4–â‡7V2—¶6öç7B7CÕ2ç7FG3·&WGW&â7BæGƒÃ×7V2ç‚Ó"bg7BæG“Ã×7V2ç’Ó"bg7BæG£Ã×7V2ç¢Ó#·Ğ¢gVæ7F–öâ&VæFW%7FG2‚—°¢6öç7B7CÕ2ç7FG2Ç7V3Õ5T55¶VÂ‚w6Å&–çFW"r’çfÇVU×ÇÅ5T52ä³°¢6öç7Bf—G3Öf—G4–â‡7V2“°¢VÂ‚w6Å7FG2r’ç7G–ÆRæF—7Æ“Òv&Æö6²s°¢VÂ‚w6Å7FG2r’æ–ææW$…DÔÃÖ ¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£gƒ¶fÆW‚×w&§w&#à¢Ç7â6Æ73Ò&&FvR&FvRÖw&’#ï	ù9G·7BæG‚çFôf—†VBƒ—Ò9rG·7BæG’çFôf—†VBƒ—Ò9rG·7BæG¢çFôf—†VBƒ—ÒÖÓÂ÷7ãà¢Ç7â6Æ73Ò&&FvR&FvRÖw&’#ï	úx¢G·7BçföÂçFôf—†VBƒ—Ò6Ü+3Â÷7ãà¢Ç7â6Æ73Ò&&FvR&FvRÖw&’#î)k"G·7BçG&—2çFôÆö6ÆU7G&–ær‚vW2Ô4Âr—ÒG&—3Â÷7ãà¢Ç7â6Æ73Ò&&FvRG·7Bæ÷e7Cãƒòv&FvR×–VÆÆ÷rs¢v&FvRÖw&VVâwÒ#î)»föÆF—¦÷2G·7Bæ÷e7BçFôf—†VBƒ—ÒSÂ÷7ãà¢G·7Bæ‡#ã3òsÇ7â6Æ73Ò&&FvR&FvR×–VÆÆ÷r#î)ª–W¦ÇF’FVÆvFÂ÷7ãâs¢rwĞ¢Ç7â6Æ73Ò&&FvRG¶f—G3òv&FvRÖw&VVâs¢v&FvR×&VBwÒ#âG¶f—G3ò~)É26&RVâr¶VÂ‚w6Å&–çFW"r’çfÇVS¢~)ÉRäò6&RVâr¶VÂ‚w6Å&–çFW"r’çfÇVWÓÂ÷7ãà¢ÂöF—cæ°¢Ğ ¢òò)H)H”¢6VÆV66œ;6âFR,:ÖWG&÷2)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢gVæ7F–öâ&W7VÖVâ‚—°¢6öç7B7CÕ2ç7FG2ÆÖöFVÃÖVÂ‚w6Å&–çFW"r’çfÇVRÇ7V3Õ5T55¶ÖöFVÅÒÆÖCÖVÂ‚w6ÄÖFW&–Âr’çfÇVS°¢6öç7Bö&£ÖVÂ‚w6Äö&¦WF—fòr’ç6VÆV7FVD÷F–öç5³ÒçFW‡D6öçFVçBÆæ÷£ÖVÂ‚w6Äæ÷§¦ÆRr’çfÇVRÆæ÷F3ÖVÂ‚w6Äæ÷F2r’çfÇVRçG&–Ò‚“°¢&WGW&æ”U¤¢Gµ2ææÖWĞ¢ÒF–ÖVç6–öæW2…Œ9uœ9u¢“¢G·7BæG‚çFôf—†VBƒ—Ò9rG·7BæG’çFôf—†VBƒ—Ò9rG·7BæG¢çFôf—†VBƒ—ÒÖĞ¢ÒföÇVÖVâ<;6Æ–Fó¢G·7BçföÂçFôf—†VBƒ—Ò6Ü+2+r8&V¢G·7Bæ&VçFôf—†VBƒ—Ò6Ü+"+rG·7BçG&—7ÒG&œ:æwVÆ÷0¢ÒföÆF—¦÷2ãS\+6–â÷–ó¢G·7Bæ÷e7BçFôf—†VBƒ—ÒRFVÂ:&V¢Ò&VÆ6œ;6âÇGW&ö&6S¢G·7Bæ‡"çFôf—†VBƒ—ÒG·7Bæ‡#ã3òr‡&–W6vòFRföÆ6'6R(	B6öç6–FW&"'&–Ò’s¢r†W7F&ÆR’wĞ¤”Õ$U4õ$¢G¶ÖöFVÇÒ(	BföÇVÖVâG·7V2ç‡Ü9rG·7V2ç—Ü9rG·7V2ç§ÖÖÒÂfVÆö6–FBÜ:‚G·7V2çfÖ‡ÖÖÒ÷2Â&÷V–ÆÆG¶æ÷§ÖÖĞ¤ÔDU$”Ã¢G¶ÖGÒ+rô$¤UD•dó¢G¶ö&§ÒG¶æ÷F3òuÆääõD2DTÂõU$Dõ#¢r¶æ÷F3¢rwÖ°¢Ğ¢6öç7B”õ5•3ÖW&W2´’Õ4Ä”4U"Â–ævVæ–W&òW‡W'FòVâ–×&W6œ;6â4BdDÒFRF†RÆ"6öÇWF–öç2…6çF–vòÂ6†–ÆR’à¤VÆ–vW2,:ÖWG&÷2FRÆÖ–æFò;7F–Ö÷26V|;¦âvVöÖWG,:ÖFRÆ–W¦ÂÖFW&–ÂÂ–×&W6÷&’ö&¦WF—fòà¥$TtÄ3¢ERÜ:‚3VÖÒ÷2’&WG&66œ;6â6÷'FâUDrfVçF–ÆF÷"(šCSRÂæòW†6VFW"#S+2â%26Ö“RÓ\+2ÂfVçF–ÆF÷"(šC3RÂ–FVÂ'&–ÒâföÆF—¦÷2ãS\+òã‚RFVÂ:&V(i"6÷÷'FW2†VÂ6Æ–6W"vVæW&6öÇVÖæ2&¦òföÆF—¦÷2’â6’7F—f26÷÷'FW2‡7W÷'G3×G'VR’Âöâ4”TÕ$RG&VU7W÷'G3×G'VR÷"FVfV7Fò‡G&öæ6÷2FR6VÆ÷<:Ö6öâ&6Ræ6†ÂW7F&ÆW2’l:6–ÆW2FR&WF—&"“²W6G&VU7W÷'G3ÖfÇ6R6öÆò6’VÂföÆF—¦òW2Væ7WW&f–6–RÆæw&æFR’6öçF–çVVRæV6W6—F–çFW&f¢FVç6âFF—fTÆ–W$†V–v‡C×G'VRVâ–W¦26öâ7W'f2&öçVæ6–F2òFWFÆÆW2f–æ÷3¢&VGV6R62Vâ¦öæ2Ææ2’W662f–æ2Vâ7W'f2â–W¦ÇFöFVÆvF‡&F–òã2’(i"'&–ÒbÓÌ:ÖæV2â&–ÖW&6¢Ü:2w'VW6’ÆVçFâÇGW&FR6VçG&R#RR’sRRFVÂFœ:ÖWG&òFR&÷V–ÆÆâ–W¦2gVæ6–öæÆW3¢2ÓBW,:ÖÖWG&÷2’&VÆÆVæòw—&ö–B3ÓSRâ–W¦2W7L:—F–63¢6f–æÂfVÆö6–FBÖöFW&FÂ7F—f—&öæ–ær&6&7WW&–÷"Æ—6âG&öæW2FR&VÆÆVæó¢w&–B†vVæW&Â’Âw—&ö–B‡&W6—7FVçFR—<;7G&÷ò’ÂG&–ævÆRö†W‚‡,:Öv–Fò’Â7V&–2ƒ4B&W6—7FVçFR’Â6öæ6VçG&–2‡6–wVRVÂ6öçF÷&æòÂ'VVæò&fÆW†–&ÆW2÷6VÆÆ÷2’ÂÆ–æV"‡,:–Fò’à¤4õ5EU$‡6VÔÖöFR“¢&Æ–æVFò"ö7VÇFÆ6÷7GW&G,:2FRÆ–W¦†W7L:—F–6ò’Â&wVFò"VâW7V–æ2Â&6W&6æò"Ö–æ–Ö—¦f–¦Râ÷WFW%vÆÄÆ7C×G'VR–×&–ÖRÆ&VBW‡FW&–÷"Âf–æÂ(i"ÖV¦÷"6&Fòâ'&–FvTFWFV7C×G'VR&föÆF—¦÷2†÷&—¦öçFÆW2âVÆW†çDfö÷B†ÖÒÂÓã2“¢Væ6övRÆ*¢6â‡”6ö×Vç6F–öâ†ÖÒÂÓã2ã2“¢æVvF—fòw&æFwV¦W&÷2â&4f—GF–æsÖfÇ6R6ÇfòVR6R–æF—VR‡&WV–W&R¶v6öFUö&75ÒVâ¶Æ—W"’à¥dTÄô4”DC¢÷WFW%7VVB†ÖÒ÷2ÂÖWFò’&¦Æ&VBW‡FW&–÷"&ÖV¦÷"6&FòƒcRFR7VVBVâ–W¦2f—7F÷62’â–æf–ÆÅ7VVBƒÖWFò’7V&RVÂ&VÆÆVæòâ66VÂ†ÖÒ÷<+"ÂÖæòFö6"’Æ–Ö—F6VÆW&6œ;6â&&VGV6—"&–æv–ærVâ–W¦2f–æ2âD„U4œ94ã¢6¶—'B†Ì:ÖæV2Â6V&VÂf–ÆÖVçFò6–âVv'6RÆ–W¦’Â'&–Ò‡VvFòÂ&–W¦2ÇF2ò%2’Â&gC×G'VR†&6R6ö×ÆWF&¦òÆ–W¦Â&7WW&f–6–W2F–l:Ö6–ÆW2ò%2(	BVæ6&V6R’âDUDÄÄS¢vf–ÆÃ×G'VR&VÆÆVæ&VFW2f–æ26–â‡VV6÷2âgW§§•6¶–â†ÖÒÂãÓã2’FFW‡GW&'Vv÷6ÖFRÆ&VBW‡FW&–÷"â6ö7F–ær†ÖÒÂãÓã2’6÷'FÆW‡G'W6œ;6âçFW2FVÂf–âFVÂW,:ÖÖWG&ò&Wf—F"VÂ&Æö"FR6÷7GW&à¤4Ä”DB†W7F–Æò÷&66Æ–6W"“¢Ö–äÆ–W%F–ÖR‡2ÂRÓ"’&ÆVçF—¦626†–62&VRVæg,:ÖVâ(i"ÖV¦÷"Vâ–W¦2WV\;2÷F÷'&W2â÷fW&†æu7VVB†ÖÒ÷2ÂÖöfb’&¦ÆfVÆö6–FBFRÆ&VBW‡FW&–÷"6ö'&RföÆF—¦÷2âfÆ÷u&F–ò‚RÂ“RÓR’§W7FW‡G'W6œ;6ââ&W77W&TGfæ6R†ÖÒÂÖöfc²L:×–6òã"ÓãRVâ¶Æ—W"’&VGV6R&Æö&&–ærVâW7V–æ2(	BL:–¦ÆòVâ6ÇfòVR6öæ÷¦62VÂfÆ÷"FRÆ–×&W6÷&âv—TF—7B†ÖÒÂãRÓãR’Æ–×–Æ&÷V–ÆÆÂ&WG&W"(i"ÖVæ÷27G&–æv–ærâv–GF„÷WFW"÷v–GF„–æf–ÆÂ†ÖÒÂÖWFò’æ6†÷2FRÌ:ÖæV÷"fVGW&R†÷WFW"Vâö6òÜ:2f–æòÒÜ:2ì:×F–Fò’â6VÔÖöFRFÖ&œ:–â6WF&ÆVF÷&–ò"†6÷7GW&F—7W'6’à¥$U5ôäDR4ôÄò6öâVâö&¦WFò¥4ôâl:Æ–Fò‡6–âÖ&¶F÷vâÂ6–âFW‡FòW‡G&’6öâU„5DÔTåDRW7F26ÆfW3 §²&Æ–W$†V–v‡B#£ã"Â&f—'7DÆ–W$†V–v‡B#£ã#RÂ'6†VÆÇ2#£"Â'F÷Æ–W'2#£BÂ&&÷GFöÔÆ–W'2#£2Â&–æf–ÆÅ7B#£RÂ&–æf–ÆÅG—R#¢&w&–GÆw—&ö–GÇG&–ævÆWÆ†W‡Æ7V&–7Æ6öæ6VçG&–7ÆÆ–v‡Fæ–æwÆFF—fWÆÆ–æV""Â'7VVB#£#Â&÷WFW%7VVB#£Â&–æf–ÆÅ7VVB#£Â&f—'7DÆ–W%7VVB#£3Â'G&fVÅ7VVB#£#Â&66VÂ#£Â&æ÷§¦ÆUFV×#£#Â&&VEFV×#£cÂ&få7B#£Â&Ö–äÆ–W%F–ÖR#£‚Â&÷fW&†æu7VVB#£Â&fÆ÷u&F–ò#£Â'&W77W&TGfæ6R#£Â'v—TF—7B#£ã‚Â'v–GF„÷WFW"#£Â'v–GF„–æf–ÆÂ#£Â'7W÷'G2#¦fÇ6RÂ'G&VU7W÷'G2#¦fÇ6RÂ'7W÷'DævÆR#£SÂ&FF—fTÆ–W$†V–v‡B#¦fÇ6RÂ'6VÔÖöFR#¢&6W&6æ÷ÆÆ–æVF÷ÆwVF÷ÆÆVF÷&–ò"Â&÷WFW%vÆÄÆ7B#¦fÇ6RÂ&'&–FvTFWFV7B#¦fÇ6RÂ&vf–ÆÂ#§G'VRÂ&gW§§•6¶–â#£Â&6ö7F–ær#£Â&VÆW†çDfö÷B#£Â'‡”6ö×Vç6F–öâ#£Â&&4f—GF–ær#¦fÇ6RÂ'6¶—'B#£"Â'6¶—'Dv#£"Â&'&–Ò#£Â'&gB#¦fÇ6RÂ&—&öæ–ær#¦fÇ6RÂ'&WG&7DF—7B#£ã‚Â'&WG&7E7VVB#£3RÂ'¤†÷#£ã"Â'&¦öæÖ–VçFò#¢#"ÓBg&6W2VâW7;öÂ6öâÆ2FV6—6–öæW26ÆfR"Â&GfW'FVæ6–2#¥²&Æ—7FFR&–W6v÷2ÂVVFR6W"f<:Ö%×Ö°¢7–æ2gVæ7F–öâæÆ—¦$”‚—°¢–b‚2ç7FG2—&WGW&ã°¢–b‚‡G—Vöb†46ÆVFT66W73ÓÓÒvgVæ7F–öâsö†46ÆVFT66W72‚“¦vWDçF‡&÷–4¶W’‚’’—·6†÷tçF‡&÷–4ÖöFÂ‚‚“ÓææÆ—¦$”‚’“·&WGW&ã·Ğ¢6öç7B'FãÖVÂ‚w6Ä'Fä”r“¶'FâæF—6&ÆVC×G'VS¶'FâçFW‡D6öçFVçCÒ~(û2æÆ—¦æFş(
bs°¢G'—·6†÷tvVçEv÷&¶–ær‚u$ôET5D”ôârÇ¶æÖS¢t´’Õ6Æ–6W"rÆVÖö¦“¢	ùjûˆòrÇfW&#¢vW7L:6Æ7VÆæFòÆ÷2,:ÖWG&÷2FR–×&W6œ;6î(
brÆÖW76vW3¥²tæÆ—¦æFòÆvVöÖWG,:ÖFRÆ–W¦(
brÂtVÆ–v–VæFò62Â&VÆÆVæò’6÷÷'FW>(
brÂt§W7FæFòfVÆö6–FB’FV×W&GW&(
bu×Ò“·Ö6F6‚†R—·Ğ¢G'—°¢6öç7B÷WCÖv—B6ÆÄvVçD6ÆVFR‚u$ôET5D”ôârÄ”õ5•2Ç&W7VÖVâ‚’“°¢6öç7BÖ÷WBæ–æFW„öb‚w²r’Æ#Ö÷WBæÆ7D–æFW„öb‚wÒr“°¢–b†ÃÇÆ#ÃÖ—F‡&÷ræWrW'&÷"‚w&W7VW7F6–â¥4ôâr“°¢6öç7BÔ¥4ôâç'6R†÷WBç6Æ–6R†Æ"³’“°¢2ç&×3Ö6Æ×&×2‡“°¢6†÷u&¦öâ‚‡ç&¦öæÖ–VçF÷ÇÂu,:ÖWG&÷26Æ7VÆF÷2÷"”âr’ÇæGfW'FVæ6–7ÇÅµÒ“°¢&VæFW%&×2‚“°¢Ö6F6‚†R—°¢Fö7B‚t”æòF—7öæ–&ÆR‚r¶RæÖW76vR²r’(	BW6æFòW&f–Â&6RrÂvW'&÷"r“°¢W6%W&f–Ä&6R‚“°¢Öf–æÆÇ—·G'—¶†–FTvVçEv÷&¶–ær‚“·Ö6F6‚†R—·Ö'FâæF—6&ÆVCÖfÇ6S¶'FâçFW‡D6öçFVçCÒ~)Ê‚æÆ—¦"6öâ”s·Ğ¢Ğ¢gVæ7F–öâW6%W&f–Ä&6R‚—°¢–b‚2ç7FG2—&WGW&ã°¢6öç7B7CÕ2ç7FG2ÆÖCÔÔE5¶VÂ‚w6ÄÖFW&–Âr’çfÇVU×ÇÄÔE5²uÄuÒÇ7V3Õ5T55¶VÂ‚w6Å&–çFW"r’çfÇVUÓ°¢6öç7Bö&£ÖVÂ‚w6Äö&¦WF—fòr’çfÇVRÆæ÷£Ò¶VÂ‚w6Äæ÷§¦ÆRr’çfÇVS°¢6öç7Bf&6SÔÖF‚æÖ–â‡7V2çfÖ‚¢†ö&£ÓÓÒw&–FòsóãƒS¦ö&£ÓÓÒv6Æ–FBsóãC£ãb’ÆÖBçf6ÇÃ““’“°¢6öç7B×°¢Æ–W$†V–v‡C¢²†æ÷¢¢†ö&£ÓÓÒv6Æ–FBsóã3¦ö&£ÓÓÒw&–Fòsóãs£ãR’’çFôf—†VBƒ"’À¢f—'7DÆ–W$†V–v‡C¢²†æ÷¢£ãb’çFôf—†VBƒ"’À¢6†VÆÇ3¦ö&£ÓÓÒw&W6—7FVçFRsóC¦ö&£ÓÓÒv6Æ–FBsó3£"À¢F÷Æ–W'3¦ö&£ÓÓÒw&–Fòsó3£BÆ&÷GFöÔÆ–W'3£2À¢–æf–ÆÅ7C¦ö&£ÓÓÒw&W6—7FVçFRsóC¦ö&£ÓÓÒw&–Fòsó£RÀ¢–æf–ÆÅG—S¦ö&£ÓÓÒw&W6—7FVçFRsòvw—&ö–Bs¢vw&–BrÀ¢7VVC¤ÖF‚ç&÷VæB‡f&6R’Æ÷WFW%7VVC¦ö&£ÓÓÒv6Æ–FBsôÖF‚ç&÷VæB‡f&6R£ãb“£Æ–æf–ÆÅ7VVC¦ö&£ÓÓÒw&–Fòsó¤ÖF‚ç&÷VæB‡f&6R£ã’À¢f—'7DÆ–W%7VVC¤ÖF‚æÖ–âƒ3ÄÖF‚ç&÷VæB‡f&6Ró"’’ÇG&fVÅ7VVC¤ÖF‚æÖ–â‡7V2çfÖ‚Ã3’Æ66VÃ£À¢æ÷§¦ÆUFV×¦ÖBææ÷¢Æ&VEFV×¦ÖBæ&VBÆfå7C¦ÖBæfâÀ¢7W÷'G3§7Bæ÷e7Cã‚ÇG&VU7W÷'G3§7Bæ÷e7Cã‚Ç7W÷'DævÆS£SÇ7Ww&–C£2Ç7W¤v£ã"Ç7WFVç6—G“£#RÇ7W–çFW&f6S£"Ç7WöåÆFS¦fÇ6RÆ–æf–ÆÄ÷fW&Æ£RÇW6TE££Æ'&–Ôv£Æ—&öæ–ætfÆ÷s£"Ç&WG&7DÖ–åG&fVÃ£ÆgW§§”ÆÃ¦fÇ6RÆgW§§•ö–çDF—7C£ãBÆG&gE6†–VÆC¦fÇ6RÀ¢Ö–äÆ–W%F–ÖS£‚Æ÷fW&†æu7VVC¦ö&£ÓÓÒw&–Fòsó¤ÖF‚æÖ–âƒ3ÄÖF‚ç&÷VæB‡f&6R£ãB’’ÆfÆ÷u&F–ó£Ç&W77W&TGfæ6S£Çv—TF—7C£ã‚Çv–GF„÷WFW#£Çv–GF„–æf–ÆÃ£À¢FF—fTÆ–W$†V–v‡C¦ö&£ÓÓÒv6Æ–FBrÀ¢6VÔÖöFS¦ö&£ÓÓÒv6Æ–FBsòvÆ–æVFòs¢v6W&6æòrÆ÷WFW%vÆÄÆ7C¦ö&£ÓÓÒv6Æ–FBwÇÆö&£ÓÓÒw&W6—7FVçFRrÇ6VÕ66&c¦fÇ6RÇ66&dÆVã£RÆ66VÄ÷WFW#£Æ66VÄ–æf–ÆÃ£Æ¦W&³£Æ'&–FvTfÆ÷s£À¢'&–FvTFWFV7C§7Bæ÷e7Cã‚Æ&4f—GF–æs¦fÇ6RÆw&GVÅFV×¢ö&¢ÓÒw&–FòrÀ¢7—&Æ—¦S¦fÇ6RÆÖöæ÷Föæ–3¦ö&£ÓÓÒv6Æ–FBrÆ&6†æS¦ö&£ÓÓÒv6Æ–FBrÀ¢vf–ÆÃ¦ö&¢ÓÒw&–FòrÆgW§§•6¶–ã£Æ6ö7F–æs¦ö&£ÓÓÒv6Æ–FBsóã#£À¢VÆW†çDfö÷C¦ö&£ÓÓÒv6Æ–FBsóãS£Ç‡”6ö×Vç6F–öã£À¢6¶—'C§7Bæ‡#ã3ó£"Ç6¶—'Dv£"À¢'&–Ó§7Bæ‡#ã3óƒ£Ç&gC¦fÇ6RÆ—&öæ–æs¦ö&£ÓÓÒv6Æ–FBrÀ¢&WG&7DF—7C¢†ÖCÓÓÔÔE2åEWÇÆÖCÓÓÔÔE5²uERÓ“TuÒ“óãS£ã‚Ç&WG&7E7VVC¢†ÖCÓÓÔÔE2åEWÇÆÖCÓÓÔÔE5²uERÓ“TuÒ“ó#£3RÇ¤†÷£ã"À¢Ó°¢2ç&×3Ö6Æ×&×2‡“°¢6†÷u&¦öâ‚uW&f–Â†WW,:×7F–6òÆö6Â‡6–â”“¢6Æ7VÆFò6V|;¦âÖFW&–ÂÂö&¦WF—fò’vVöÖWG,:ÖâVVFW2VF—F"7VÇV–W",:ÖWG&òçFW2FRvVæW&"VÂrÖ6öFRârÅµÒ“°¢&VæFW%&×2‚“°¢Ğ¢gVæ7F–öâ6Æ×&×2‡—°¢6öç7Bæ÷£Ò¶VÂ‚w6Äæ÷§¦ÆRr’çfÇVRÇ7V3Õ5T55¶VÂ‚w6Å&–çFW"r’çfÇVUÓ°¢6öç7BÖCÔÔE5¶VÂ‚w6ÄÖFW&–Âr’çfÇVU×ÇÇ·Ó°¢6öç7BfÖƒÔÖF‚æÖ–â‡7V2çfÖ‚ÆÖBçf6ÇÇ7V2çfÖ‚“²òòF÷RFRfVÆö6–FB÷"–×&W6÷&’ÖFW&–Â…ER3VÖÒ÷2¢6öç7B6ÃÒ‡bÆÆ"ÆB“Óç·cÒ·c·&WGW&âÖF‚æÖ–â†"ÄÖF‚æÖ‚†Æ—4f–æ—FR‡b“÷c¦B’“·Ó²òòVÂFVfVÇBFÖ&œ:–â6R6÷F¢7VVCÓcæòFV&R7WW&"VÂF÷RFVÂÖFW&–Â…ER3VÖÒ÷2’6’Æ”öÖ—FRVÂ6×ğ¢&WGW&ç°¢Æ–W$†V–v‡C¦6Â‡æÆ–W$†V–v‡BÃãRÆæ÷¢£ã‚Ææ÷¢£ãR’À¢f—'7DÆ–W$†V–v‡C¦6Â‡æf—'7DÆ–W$†V–v‡BÃãÆæ÷¢£ã’Ææ÷¢£ãb’À¢6†VÆÇ3¤ÖF‚ç&÷VæB†6Â‡ç6†VÆÇ2ÃÃ‚Ã"’’ÇF÷Æ–W'3¤ÖF‚ç&÷VæB†6Â‡çF÷Æ–W'2ÃÃÃB’’Æ&÷GFöÔÆ–W'3¤ÖF‚ç&÷VæB†6Â‡æ&÷GFöÔÆ–W'2ÃÃÃ2’’À¢–æf–ÆÅ7C¤ÖF‚ç&÷VæB†6Â‡æ–æf–ÆÅ7BÃÃÃR’’À¢–æf–ÆÅG—S¥²vw&–BrÂvw—&ö–BrÂwG&–ævÆRrÂv†W‚rÂv†öæW–6öÖ"rÂv7V&–2rÂv6öæ6VçG&–2rÂvÆ–v‡Fæ–ærrÂvFF—fRrÂvÆ–æV"uÒæ–æ6ÇVFW2‡æ–æf–ÆÅG—R“÷æ–æf–ÆÅG—S¢vw&–BrÀ¢7VVC¤ÖF‚ç&÷VæB†6Â‡ç7VVBÃÇfÖ‚Ãc’’À¢÷WFW%7VVC¤ÖF‚ç&÷VæB†6Â‡æ÷WFW%7VVBÃÇfÖ‚Ã’’Æ–æf–ÆÅ7VVC¤ÖF‚ç&÷VæB†6Â‡æ–æf–ÆÅ7VVBÃÇfÖ‚Ã’’À¢f—'7DÆ–W%7VVC¤ÖF‚ç&÷VæB†6Â‡æf—'7DÆ–W%7VVBÃRÄÖF‚æÖ–âƒƒÇfÖ‚’Ã3’’À¢G&fVÅ7VVC¤ÖF‚ç&÷VæB†6Â‡çG&fVÅ7VVBÃ3ÃSÃ#’’Æ66VÃ¤ÖF‚ç&÷VæB†6Â‡æ66VÂÃÃ3Ã’’À¢66VÄ÷WFW#¤ÖF‚ç&÷VæB†6Â‡æ66VÄ÷WFW"ÃÃ3Ã’’Æ66VÄ–æf–ÆÃ¤ÖF‚ç&÷VæB†6Â‡æ66VÄ–æf–ÆÂÃÃ3Ã’’Æ¦W&³¦6Â‡æ¦W&²ÃÃCÃ’Æ'&–FvTfÆ÷s¤ÖF‚ç&÷VæB†6Â‡æ'&–FvTfÆ÷rÃCÃSÃ’’À¢æ÷§¦ÆUFV×¤ÖF‚ç&÷VæB†6Â‡ææ÷§¦ÆUFV×ÃsÃ3Ã#’’Æ&VEFV×¤ÖF‚ç&÷VæB†6Â‡æ&VEFV×ÃÃÃc’’À¢få7C¤ÖF‚ç&÷VæB†6Â‡æfå7BÃÃÃ’’À¢7W÷'G3¢ç7W÷'G2bgç7W÷'G2ÓÒvæòrÇG&VU7W÷'G3¢çG&VU7W÷'G2bgçG&VU7W÷'G2ÓÒvæòrÇ7W÷'DævÆS¤ÖF‚ç&÷VæB†6Â‡ç7W÷'DævÆRÃ#ÃƒÃS’’À¢7Ww&–C¦6Â‡ç7Ww&–BÃãRÃ‚Ã2’Ç7W¤v¦6Â‡ç7W¤vÃÃãbÃã"’Ç7WFVç6—G“¤ÖF‚ç&÷VæB†6Â‡ç7WFVç6—G’ÃÃ“Ã#R’’À¢7W–çFW&f6S¤ÖF‚ç&÷VæB†6Â‡ç7W–çFW&f6RÃÃRÃ"’’Ç7WöåÆFS¢ç7WöåÆFRbgç7WöåÆFRÓÒvæòrÆ–æf–ÆÄ÷fW&Æ¤ÖF‚ç&÷VæB†6Â‡æ–æf–ÆÄ÷fW&ÆÃÃCÃR’’ÇW6TE£¦6Â‡çW6TE¢ÃÃÃ’À¢'&–Ôv¦6Â‡æ'&–ÔvÃÃÃ’Æ—&öæ–ætfÆ÷s¤ÖF‚ç&÷VæB†6Â‡æ—&öæ–ætfÆ÷rÃRÃ3Ã"’’Ç&WG&7DÖ–åG&fVÃ¦6Â‡ç&WG&7DÖ–åG&fVÂÃÃÃ’À¢gW§§”ÆÃ¢ægW§§”ÆÂbgægW§§”ÆÂÓÒvæòrÆgW§§•ö–çDF—7C¦6Â‡ægW§§•ö–çDF—7BÃã"Ã"ÃãB’ÆG&gE6†–VÆC¢æG&gE6†–VÆBbgæG&gE6†–VÆBÓÒvæòrÀ¢6VÕ66&c¢ç6VÕ66&bbgç6VÕ66&bÓÒvæòrÇ66&dÆVã¦6Â‡ç66&dÆVâÃÃRÃR’À¢Ö–äÆ–W%F–ÖS¤ÖF‚ç&÷VæB†6Â‡æÖ–äÆ–W%F–ÖRÃÃ3Ã‚’’Æ÷fW&†æu7VVC¤ÖF‚ç&÷VæB†6Â‡æ÷fW&†æu7VVBÃÇfÖ‚Ã’’ÆfÆ÷u&F–ó¦6Â‡æfÆ÷u&F–òÃƒÃ#Ã’Ç&W77W&TGfæ6S¦6Â‡ç&W77W&TGfæ6RÃÃãRÃ’Çv—TF—7C¦6Â‡çv—TF—7BÃÃRÃã‚’Çv–GF„÷WFW#¦6Â‡çv–GF„÷WFW"ÃÃ"Ã’Çv–GF„–æf–ÆÃ¦6Â‡çv–GF„–æf–ÆÂÃÃ"Ã’À¢W†6ÇVFTö&¦V7C¢æW†6ÇVFTö&¦V7BbgæW†6ÇVFTö&¦V7BÓÒvæòrÇ6WVVçF–Ã¢ç6WVVçF–Âbgç6WVVçF–ÂÓÒvæòrÀ¢FF—fTÆ–W$†V–v‡C¢æFF—fTÆ–W$†V–v‡BbgæFF—fTÆ–W$†V–v‡BÓÒvæòrÀ¢6VÔÖöFS¥²v6W&6æòrÂvÆ–æVFòrÂvwVFòrÂvÆVF÷&–òuÒæ–æ6ÇVFW2‡ç6VÔÖöFR“÷ç6VÔÖöFS¢v6W&6æòrÂòòvÆVF÷&–òrÆòög&V6RÆT’ÂÆò–FRVÂ&ö×B’Æò–×ÆVÖVçF÷6VÕ7F'C²6–â:–Â\:Ò6RFW66'F&Vâ6–ÆVæ6–ğ ¢÷WFW%vÆÄÆ7C¢æ÷WFW%vÆÄÆ7Bbgæ÷WFW%vÆÄÆ7BÓÒvæòrÀ¢'&–FvTFWFV7C¢æ'&–FvTFWFV7Bbgæ'&–FvTFWFV7BÓÒvæòrÀ¢&4f—GF–æs¢æ&4f—GF–ærbgæ&4f—GF–ærÓÒvæòrÀ¢w&GVÅFV×¢æw&GVÅFV×bgæw&GVÅFV×ÓÒvæòrÀ¢vf–ÆÃ¢ævf–ÆÂbgævf–ÆÂÓÒvæòrÆgW§§•6¶–ã¦6Â‡ægW§§•6¶–âÃÃãbÃ’Æ6ö7F–æs¦6Â‡æ6ö7F–ærÃÃ"Ã’À¢7—&Æ—¦S¢ç7—&Æ—¦Rbgç7—&Æ—¦RÓÒvæòrÆÖöæ÷Föæ–3¢æÖöæ÷Föæ–2bgæÖöæ÷Föæ–2ÓÒvæòrÆ&6†æS¢æ&6†æRbgæ&6†æRÓÒvæòrÀ¢VÆW†çDfö÷C¦6Â‡æVÆW†çDfö÷BÃÃãbÃ’Ç‡”6ö×Vç6F–öã¦6Â‡ç‡”6ö×Vç6F–öâÂÓã2Ãã2Ã’À¢6¶—'C¤ÖF‚ç&÷VæB†6Â‡ç6¶—'BÃÃRÃ’’Ç6¶—'Dv¦6Â‡ç6¶—'DvÃãRÃÃ"’À¢'&–Ó¤ÖF‚ç&÷VæB†6Â‡æ'&–ÒÃÃ#Ã’’Ç&gC¢ç&gBbgç&gBÓÒvæòrÆ—&öæ–æs¢æ—&öæ–ærbgæ—&öæ–ærÓÒvæòrÀ¢&WG&7DF—7C¦6Â‡ç&WG&7DF—7BÃÃ‚Ãã‚’Ç&WG&7E7VVC¤ÖF‚ç&÷VæB†6Â‡ç&WG&7E7VVBÃRÃƒÃ3R’’À¢¤†÷¦6Â‡ç¤†÷ÃÃ"Ãã"’À¢Ó°¢Ğ¢gVæ7F–öâ6†÷u&¦öâ‡G‡BÆGb—°¢6öç7B&÷ƒÖVÂ‚w6Å&¦öâr“¶&÷‚ç7G–ÆRæF—7Æ“Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÃÒsÆ"7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ66VçCB’#ï	úz&¦öæÖ–VçFòFVÂvVçFSÂö#ãÆ'#âr¶W66T‡FÖÂ‡G‡B’°¢†GbbfGbæÆVæwFƒòsÆ'#ãÆ'#ãÆ"7G–ÆSÒ&6öÆ÷#§f"‚Ò×v&â’#î)ªGfW'FVæ6–3Âö#ãÆ'#âr¶GbæÖ†Óâ~(
"r¶W66T‡FÖÂ†’’æ¦ö–â‚sÆ'#âr“¢rr“°¢Ğ¢gVæ7F–öâ&VæFW%&×2‚—°¢6öç7BsÖVÂ‚w6Å&×4w&–Br“¶ræ–ææW$…DÔÃÒrs°¢f÷"†6öç7Bböbd”TÄE2—°¢6öç7BcÕ2ç&×5¶bæµÓ°¢6öç7BF—cÖFö7VÖVçBæ7&VFTVÆVÖVçB‚vF—br“°¢–b†bç6VÂ—°¢6öç7B—4&ööÃÖbç6VÅ³ÓÓÓÒvæòs°¢6öç7B7W#Ö—4&ööÃò‡còw<:Òs¢væòr“§c°¢F—bæ–ææW$…DÔÃÖÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ"7G–ÆSÒ&föçB×6—¦S£—‚#âG¶bæÇÓÂöÆ&VÃà¢Ç6VÆV7B6Æ73Ò&f–VÆB×6VÆV7B"–CÒ'6ÅöeòG¶bæ·Ò"7G–ÆSÒ'FF–æs£g‚‡ƒ¶föçB×6—¦S£‚#âG¶bç6VÂæÖ†óÓæÆ÷F–öâG¶óÓÓÖ7W#òw6VÆV7FVBs¢rwÓâG¶÷ÓÂö÷F–öãæ’æ¦ö–â‚rr—ÓÂ÷6VÆV7Cæ°¢ÖVÇ6W°¢F—bæ–ææW$…DÔÃÖÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ"7G–ÆSÒ&föçB×6—¦S£—‚#âG¶bæÇÓÂöÆ&VÃà¢Æ–çWB6Æ73Ò&f–VÆBÖ–çWB"–CÒ'6ÅöeòG¶bæ·Ò"G—SÒ&çVÖ&W""7FWÒ"G¶bç7Ò"fÇVSÒ"G·gÒ"7G–ÆSÒ'FF–æs£g‚‡ƒ¶föçB×6—¦S£‚#æ°¢Ğ¢ræVæD6†–ÆB†F—b“°¢Ğ¢VÂ‚w6Å&×5w&r’ç7G–ÆRæF—7Æ“Òv&Æö6²s°¢&VæFW%&öf–ÆU6VÂ‚“°¢&VæFW$ÖöF–f–W'2‚“·&VæFW%7W&Vv–öç2‚“·&VæFW$ö&¥6WGF–æw2‚“°¢Ğ¢òò)H)HW&f–ÆW2FRÆÖ–æFò†wV&F"ö6&v"6öæ§VçF÷2FR,:ÖWG&÷2’)H)H ¢gVæ7F–öâ÷6Å&öf–ÆW2‚—·G'—·&WGW&â¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ‚w6Å÷&öf–ÆW2r—ÇÂw·Òr“·Ö6F6‚†R—·&WGW&ç·Ó·×Ğ¢gVæ7F–öâ÷6Å&öf–ÆW56fR†Ò—¶Æö6Å7F÷&vRç6WD—FVÒ‚w6Å÷&öf–ÆW2rÄ¥4ôâç7G&–æv–g’†Ò’“·Ğ¢gVæ7F–öâ&VæFW%&öf–ÆU6VÂ‚—°¢6öç7B6VÃÖVÂ‚w6Å&öf–ÆU6VÂr“¶–b‚6VÂ—&WGW&ã°¢6öç7BÓÕ÷6Å&öf–ÆW2‚’ÆæÖW3Ôö&¦V7Bæ¶W—2†Ò’ç6÷'B‚“°¢6VÂæ–ææW$…DÔÃÒsÆ÷F–öâfÇVSÒ"#î(	BVÆVv—"W&f–ÂwV&FFò(	CÂö÷F–öãâr¶æÖW2æÖ†ãÓæÆ÷F–öâfÇVSÒ"G¶W66T‡FÖÂ†â—Ò#âG¶W66T‡FÖÂ†â—ÓÂö÷F–öãæ’æ¦ö–â‚rr“°¢Ğ¢gVæ7F–öâ6fU&öf–ÆR‚—°¢–b‚VÂ‚w6ÅöeöÆ–W$†V–v‡Br’—·Fö7B‚tvVæW&ò6&v,:ÖWG&÷2&–ÖW&òrÂvW'&÷"r“·&WGW&ã·Ğ¢6öç7BæÖSÒ‡&ö×B‚tæöÖ'&RFVÂW&f–Ã¢rÂrr—ÇÂrr’çG&–Ò‚“¶–b‚æÖR—&WGW&ã°¢6öç7BfÇ3×·Ó¶f÷"†6öç7Bböbd”TÄE2—¶6öç7BSÖVÂ‚w6Åöeòr¶bæ²“¶–b†R—fÇ5¶bæµÓÖRçfÇVS·Ğ¢6öç7BÓÕ÷6Å&öf–ÆW2‚“¶Õ¶æÖUÓ×fÇ3µ÷6Å&öf–ÆW56fR†Ò“·&VæFW%&öf–ÆU6VÂ‚“°¢–b‡v–æF÷räÖ6†–æT÷3òæ6GW&U6Æ–6W%&öf–ÆR—v–æF÷räÖ6†–æT÷2æ6GW&U6Æ–6W%&öf–ÆR†æÖRÇfÇ2Ç¶ÖöFVÃ¦VÂ‚w6Å&–çFW"r“òçfÇVWÇÂrrÆÖFW&–Ã¦VÂ‚w6ÄÖFW&–Âr“òçfÇVWÇÂrrÆæ÷§¦ÆS¦VÂ‚w6Äæ÷§¦ÆRr“òçfÇVWÇÂsãBwÒ“°¢VÂ‚w6Å&öf–ÆU6VÂr’çfÇVSÖæÖS·Fö7B†)É2W&f–Â"G¶æÖWÒ"wV&FFöÂw7V66W72r“°¢Ğ¢gVæ7F–öâÆöE&öf–ÆR†æÖR—°¢–b‚æÖR—&WGW&ã¶6öç7BÓÕ÷6Å&öf–ÆW2‚’ÇfÇ3ÖÕ¶æÖUÓ¶–b‚fÇ2—&WGW&ã°¢f÷"†6öç7Bböbd”TÄE2—¶6öç7BSÖVÂ‚w6Åöeòr¶bæ²“¶–b†RbgfÇ5¶bæµÒÓ×VæFVf–æVB–RçfÇVS×fÇ5¶bæµÓ·Ğ¢Fö7B†W&f–Â"G¶æÖWÒ"6&vFò(	B&Wf—6’vVæW&Âw7V66W72r“°¢Ğ¢gVæ7F–öâFVÆWFU&öf–ÆR‚—°¢6öç7BæÖSÖVÂ‚w6Å&öf–ÆU6VÂr’çfÇVS¶–b‚æÖR—·Fö7B‚tVÆ–vRVâW&f–Â&&÷'&"rÂvW'&÷"r“·&WGW&ã·Ğ¢6öç7BÓÕ÷6Å&öf–ÆW2‚“¶FVÆWFRÕ¶æÖUÓµ÷6Å&öf–ÆW56fR†Ò“·&VæFW%&öf–ÆU6VÂ‚“·Fö7B†W&f–Â"G¶æÖWÒ"&÷'&FöÂv–æfòr“°¢Ğ¢òò)H)HÖöF–f–6F÷&W2÷"ÇGW&’&Vv–öæW2FR6÷÷'FR)H)H)H)H)H)H)H)H)H)H ¢gVæ7F–öâFövvÆTGfæ6VB‚—°¢6öç7B#ÖVÂ‚w6ÄGd&öG’r’Æ3ÖVÂ‚w6ÄGd6&WBr“°¢6öç7B÷VãÖ"ç7G–ÆRæF—7Æ“ÓÓÒvæöæRs°¢"ç7G–ÆRæF—7Æ“Ö÷Vãòv&Æö6²s¢væöæRs¶2çFW‡D6öçFVçCÖ÷Vãò~)kBs¢~)kâs°¢–b†÷Vâ—¶ÆöDÖ6†–æTv6öFR‚“·&VæFW$ö&¥6WGF–æw2‚“·Ğ¢Ğ¢òò)H)HrÖ6öFRFRÜ:V–æ†–æ–6–òöf–â’÷"–×&W6÷&)H)H ¢gVæ7F–öâ÷7V"‡GÂÇf'2—·&WGW&âGÂç&WÆ6R‚õÇ²…Çr²•ÇÒörÂ†ÒÆ²“Óæ²–âf'3÷f'5¶µÓ¦Ò“·Ğ¢gVæ7F–öâöv4Ö6†–æR‚—·&WGW&âVÂ‚w6Å&–çFW"r“öVÂ‚w6Å&–çFW"r’çfÇVS¢vFVfVÇBs·Ğ¢gVæ7F–öâÆöDÖ6†–æTv6öFR‚—°¢6öç7BÓÕöv4Ö6†–æR‚“°¢6öç7BæÓÖVÂ‚w6Äv4Ö6†–æTæÖRr“¶–b†æÒ–æÒçFW‡D6öçFVçCÖÓ°¢6öç7B3ÖVÂ‚w6Å7F'Dv6öFRr’ÆSÖVÂ‚w6ÄVæDv6öFRr’ÆÆsÖVÂ‚w6ÄÆ–W$v6öFRr“°¢–b‡2—2çfÇVSÖÆö6Å7F÷&vRævWD—FVÒ‚w6Å÷7F'Fv6öFUòr¶Ò—ÇÂrs°¢–b†R–RçfÇVSÖÆö6Å7F÷&vRævWD—FVÒ‚w6ÅöVæFv6öFUòr¶Ò—ÇÂrs°¢–b†Ær–ÆrçfÇVSÖÆö6Å7F÷&vRævWD—FVÒ‚w6ÅöÆ–W&v6öFUòr¶Ò—ÇÂrs°¢Ğ¢gVæ7F–öâ6fTÖ6†–æTv6öFR‚—°¢6öç7BÓÕöv4Ö6†–æR‚’Ç3ÖVÂ‚w6Å7F'Dv6öFRr’ÆSÖVÂ‚w6ÄVæDv6öFRr’ÆÆsÖVÂ‚w6ÄÆ–W$v6öFRr“°¢–b‡2–Æö6Å7F÷&vRç6WD—FVÒ‚w6Å÷7F'Fv6öFUòr¶ÒÇ2çfÇVR“°¢–b†R–Æö6Å7F÷&vRç6WD—FVÒ‚w6ÅöVæFv6öFUòr¶ÒÆRçfÇVR“°¢–b†Ær–Æö6Å7F÷&vRç6WD—FVÒ‚w6ÅöÆ–W&v6öFUòr¶ÒÆÆrçfÇVR“°¢Ğ¢gVæ7F–öâv6öFU&W6WB†fÆf÷"—°¢6öç7B3ÖVÂ‚w6Å7F'Dv6öFRr’ÆSÖVÂ‚w6ÄVæDv6öFRr“¶–b‚7ÇÂR—&WGW&ã°¢–b†fÆf÷#ÓÓÒv¶Æ—W"r—°¢2çfÇVSÒu$”åEõ5D%B$TEõDTÕ×¶&VGÒU…E%TDU%õDTÕ×¶æ÷§¦ÆWÒs°¢RçfÇVSÒu$”åEôTäBs°¢ÖVÇ6W°¢2çfÇVSÒtÓC7¶&VGÕÆäÓB7¶æ÷§¦ÆWÕÆäs#…ÆäÓ“7¶&VGÕÆäÓ’7¶æ÷§¦ÆWÒs°¢RçfÇVSÒtÓuÆäÓB3ÆäÓC3ÆäÓƒBs°¢Ğ¢6fTÖ6†–æTv6öFR‚“°¢Fö7B†fÆf÷#ÓÓÒv¶Æ—W"sòu&W6WB¶Æ—W"6&vFò(	B&WV–W&RÖ7&÷2$”åEõ5D%Bõ$”åEôTäBVâGR&–çFW"æ6frs¢u&W6WBÖ&Æ–â6&vFòrÂw7V66W72r“°¢Ğ¢6öç7BôÔôEôd”TÄE3Õ²v–æf–ÆÅ7BrÂv–æf–ÆÅG—RrÂw6†VÆÇ2rÂwF÷Æ–W'2rÂv&÷GFöÔÆ–W'2uÓ°¢gVæ7F–öâFDÖöF–f–W"‚—°¢6öç7B¤ÖƒÕ2ç7FG3òµ2ç7FG2æG¢çFôf—†VBƒ“£#°¢2æÖöF–f–W'2çW6‚‡·¤Ö–ã£Ç¤Ö‚Æ–æf–ÆÅ7C¢rrÆ–æf–ÆÅG—S¢rrÇ6†VÆÇ3¢rrÇF÷Æ–W'3¢rrÆ&÷GFöÔÆ–W'3¢rwÒ“°¢&VæFW$ÖöF–f–W'2‚“°¢Ğ¢gVæ7F–öâ&VÖ÷fTÖöF–f–W"†’—µ2æÖöF–f–W'2ç7Æ–6R†’Ã“·&VæFW$ÖöF–f–W'2‚“·Ğ¢gVæ7F–öâWDÖöF–f–W"†’Æ²Çb—¶–b…2æÖöF–f–W'5¶•Ò•2æÖöF–f–W'5¶•Õ¶µÓ×c·Ğ¢gVæ7F–öâ&VæFW$ÖöF–f–W'2‚—°¢6öç7B3ÖVÂ‚w6ÄÖöDÆ—7Br“¶–b‚2—&WGW&ã°¢–b‚2æÖöF–f–W'2æÆVæwF‚—¶2æ–ææW$…DÔÃÒsÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“·FF–æs£'‚‡‚#å6–âÖöF–f–6F÷&W2(	BFöFòVÂÖöFVÆòW6Æ÷2,:ÖWG&÷2FR'&–&ãÂöF—câs·&WGW&ã·Ğ¢6öç7BD÷G3Õ²rrÂvw&–BrÂvw—&ö–BrÂwG&–ævÆRrÂv†W‚rÂv†öæW–6öÖ"rÂv7V&–2rÂv6öæ6VçG&–2rÂvÆ–v‡Fæ–ærrÂvFF—fRrÂvÆ–æV"uÓ°¢2æ–ææW$…DÔÃÕ2æÖöF–f–W'2æÖ‚†ÒÆ’“Óæ ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£‡ƒ·FF–æs£‡ƒ¶Ö&v–âÖ&÷GFöÓ£g‚#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£gƒ¶Æ–vâÖ—FV×3¦6VçFW#¶fÆW‚×w&§w&¶föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#à¢Ç7ãå¢FW6FSÂ÷7ããÆ–çWBG—SÒ&çVÖ&W""7FWÒ#ãR"fÇVSÒ"G¶Òç¤Ö–çÒ"öæ6†ævSÒ%4Ã4BçWDÖöF–f–W"‚G¶—ÒÂw¤Ö–ârÂ·F†—2çfÇVR’"7G–ÆSÒ'v–GFƒ£Sgƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£Wƒ¶6öÆ÷#§f"‚Ò×FW‡B“·FF–æs£7‚Wƒ¶föçB×6—¦S£ƒ¶föçBÖfÖ–Ç“¦Ööæ÷76R#à¢Ç7ãæ†7FÂ÷7ããÆ–çWBG—SÒ&çVÖ&W""7FWÒ#ãR"fÇVSÒ"G¶Òç¤Ö‡Ò"öæ6†ævSÒ%4Ã4BçWDÖöF–f–W"‚G¶—ÒÂw¤Ö‚rÂ·F†—2çfÇVR’"7G–ÆSÒ'v–GFƒ£Sgƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£Wƒ¶6öÆ÷#§f"‚Ò×FW‡B“·FF–æs£7‚Wƒ¶föçB×6—¦S£ƒ¶föçBÖfÖ–Ç“¦Ööæ÷76R#ãÇ7ãæÖÓÂ÷7ãà¢Æ'WGFöâöæ6Æ–6³Ò%4Ã4Bç&VÖ÷fTÖöF–f–W"‚G¶—Ò’"7G–ÆSÒ&Ö&v–âÖÆVgC¦WFó¶&6¶w&÷VæC¦æöæS¶&÷&FW#¦æöæS¶6öÆ÷#§f"‚Ò×FW‡C2“¶7W'6÷#§ö–çFW#¶föçB×6—¦S£G‚"F—FÆSÒ%V—F"#î)ÉSÂö'WGFöãà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£gƒ¶fÆW‚×w&§w&¶Ö&v–â×F÷£g‚#à¢ÆÆ&VÂ7G–ÆSÒ&föçB×6—¦S£—ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#å&VÆÆVæòSÆ'#ãÆ–çWBG—SÒ&çVÖ&W""7FWÒ#R"Æ6V†öÆFW#Ò.(	B"fÇVSÒ"G¶Òæ–æf–ÆÅ7GÒ"öæ6†ævSÒ%4Ã4BçWDÖöF–f–W"‚G¶—ÒÂv–æf–ÆÅ7BrÇF†—2çfÇVR’"7G–ÆSÒ'v–GFƒ£cƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£Wƒ¶6öÆ÷#§f"‚Ò×FW‡B“·FF–æs£7‚Wƒ¶föçB×6—¦S£ƒ¶föçBÖfÖ–Ç“¦Ööæ÷76R#ãÂöÆ&VÃà¢ÆÆ&VÂ7G–ÆSÒ&föçB×6—¦S£—ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#åG,;6ãÆ'#ãÇ6VÆV7Böæ6†ævSÒ%4Ã4BçWDÖöF–f–W"‚G¶—ÒÂv–æf–ÆÅG—RrÇF†—2çfÇVR’"7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£Wƒ¶6öÆ÷#§f"‚Ò×FW‡B“·FF–æs£7‚Wƒ¶föçB×6—¦S£‚#âG·D÷G2æÖ†óÓæÆ÷F–öâfÇVSÒ"G¶÷Ò"G¶óÓÓÖÒæ–æf–ÆÅG—Sòw6VÆV7FVBs¢rwÓâG¶÷ÇÂ~(	BwÓÂö÷F–öãæ’æ¦ö–â‚rr—ÓÂ÷6VÆV7CãÂöÆ&VÃà¢ÆÆ&VÂ7G–ÆSÒ&föçB×6—¦S£—ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#åW,:ÖÖWG&÷3Æ'#ãÆ–çWBG—SÒ&çVÖ&W""7FWÒ#"Æ6V†öÆFW#Ò.(	B"fÇVSÒ"G¶Òç6†VÆÇ7Ò"öæ6†ævSÒ%4Ã4BçWDÖöF–f–W"‚G¶—ÒÂw6†VÆÇ2rÇF†—2çfÇVR’"7G–ÆSÒ'v–GFƒ£cƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£Wƒ¶6öÆ÷#§f"‚Ò×FW‡B“·FF–æs£7‚Wƒ¶föçB×6—¦S£ƒ¶föçBÖfÖ–Ç“¦Ööæ÷76R#ãÂöÆ&VÃà¢ÆÆ&VÂ7G–ÆSÒ&föçB×6—¦S£—ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#ä627WãÆ'#ãÆ–çWBG—SÒ&çVÖ&W""7FWÒ#"Æ6V†öÆFW#Ò.(	B"fÇVSÒ"G¶ÒçF÷Æ–W'7Ò"öæ6†ævSÒ%4Ã4BçWDÖöF–f–W"‚G¶—ÒÂwF÷Æ–W'2rÇF†—2çfÇVR’"7G–ÆSÒ'v–GFƒ£cƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£Wƒ¶6öÆ÷#§f"‚Ò×FW‡B“·FF–æs£7‚Wƒ¶föçB×6—¦S£ƒ¶föçBÖfÖ–Ç“¦Ööæ÷76R#ãÂöÆ&VÃà¢ÆÆ&VÂ7G–ÆSÒ&föçB×6—¦S£—ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#ä62–æbãÆ'#ãÆ–çWBG—SÒ&çVÖ&W""7FWÒ#"Æ6V†öÆFW#Ò.(	B"fÇVSÒ"G¶Òæ&÷GFöÔÆ–W'7Ò"öæ6†ævSÒ%4Ã4BçWDÖöF–f–W"‚G¶—ÒÂv&÷GFöÔÆ–W'2rÇF†—2çfÇVR’"7G–ÆSÒ'v–GFƒ£cƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£Wƒ¶6öÆ÷#§f"‚Ò×FW‡B“·FF–æs£7‚Wƒ¶föçB×6—¦S£ƒ¶föçBÖfÖ–Ç“¦Ööæ÷76R#ãÂöÆ&VÃà¢ÂöF—cà¢ÂöF—cæ’æ¦ö–â‚rr“°¢Ğ¢gVæ7F–öâFE7W&Vv–öâ‚—°¢6öç7BGƒÕ2ç7FG3õ2ç7FG2æGƒ£CÆG“Õ2ç7FG3õ2ç7FG2æG“£CÆG£Õ2ç7FG3òµ2ç7FG2æG¢çFôf—†VBƒ“£#°¢2ç7W&Vv–öç2çW6‚‡¶ÖöFS¢v&Æö6²rÇƒ¢²‚ÖG‚óB’çFôf—†VBƒ’Ç“¢²‚ÖG’óB’çFôf—†VBƒ’Çƒ¢²†G‚óB’çFôf—†VBƒ’Ç“¢²†G’óB’çFôf—†VBƒ’Ç¤Ö–ã£Ç¤Öƒ¦G§Ò“°¢&VæFW%7W&Vv–öç2‚“°¢Ğ¢gVæ7F–öâ&VÖ÷fU7W&Vv–öâ†’—µ2ç7W&Vv–öç2ç7Æ–6R†’Ã“·&VæFW%7W&Vv–öç2‚“·Ğ¢gVæ7F–öâWE7W&Vv–öâ†’Æ²Çb—¶–b…2ç7W&Vv–öç5¶•Ò•2ç7W&Vv–öç5¶•Õ¶µÓ×c·Ğ¢gVæ7F–öâ&VæFW%7W&Vv–öç2‚—°¢6öç7B3ÖVÂ‚w6Å7W&VtÆ—7Br“¶–b‚2—&WGW&ã°¢–b‚2ç7W&Vv–öç2æÆVæwF‚—¶2æ–ææW$…DÔÃÒsÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“·FF–æs£'‚‡‚#å6–â&Vv–öæW2(	BVÂ6÷÷'FR6R6Æ7VÆWFöÜ:F–6ÖVçFR÷":æwVÆòãÂöF—câs·&WGW&ã·Ğ¢2æ–ææW$…DÔÃÕ2ç7W&Vv–öç2æÖ‚‡"Æ’“Óæ ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–BG·"æÖöFSÓÓÒvVæf÷&6Rsòw&v&ƒÃ#"ÃsÃãB’s¢w&v&ƒ#SRÃrÃS2ÃãB’wÓ¶&÷&FW"×&F—W3£‡ƒ·FF–æs£‡ƒ¶Ö&v–âÖ&÷GFöÓ£g‚#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£gƒ¶Æ–vâÖ—FV×3¦6VçFW#¶fÆW‚×w&§w&¶föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#à¢Ç6VÆV7Böæ6†ævSÒ%4Ã4BçWE7W&Vv–öâ‚G¶—ÒÂvÖöFRrÇF†—2çfÇVR’"7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£Wƒ¶6öÆ÷#§f"‚Ò×FW‡B“·FF–æs£7‚Wƒ¶föçB×6—¦S£‚#à¢Æ÷F–öâfÇVSÒ&&Æö6²"G·"æÖöFSÓÓÒv&Æö6²sòw6VÆV7FVBs¢rwÓï	ùª²&Æ÷VV"6÷÷'FSÂö÷F–öãà¢Æ÷F–öâfÇVSÒ&Væf÷&6R"G·"æÖöFSÓÓÒvVæf÷&6Rsòw6VÆV7FVBs¢rwÓî)ÈRf÷'¦"6÷÷'FSÂö÷F–öãà¢Â÷6VÆV7Cà¢Æ'WGFöâöæ6Æ–6³Ò%4Ã4Bç&VÖ÷fU7W&Vv–öâ‚G¶—Ò’"7G–ÆSÒ&Ö&v–âÖÆVgC¦WFó¶&6¶w&÷VæC¦æöæS¶&÷&FW#¦æöæS¶6öÆ÷#§f"‚Ò×FW‡C2“¶7W'6÷#§ö–çFW#¶föçB×6—¦S£G‚"F—FÆSÒ%V—F"#î)ÉSÂö'WGFöãà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£gƒ¶fÆW‚×w&§w&¶Ö&v–â×F÷£gƒ¶föçB×6—¦S£—ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#à¢Gµ²wƒrÂw“rÂwƒrÂw“rÂw¤Ö–ârÂw¤Ö‚uÒæÖ†³ÓæÆÆ&VÃâG¶·ÓÆ'#ãÆ–çWBG—SÒ&çVÖ&W""7FWÒ#"fÇVSÒ"G·%¶µ×Ò"öæ6†ævSÒ%4Ã4BçWE7W&Vv–öâ‚G¶—ÒÂrG¶·ÒrÂ·F†—2çfÇVR’"7G–ÆSÒ'v–GFƒ£SGƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£Wƒ¶6öÆ÷#§f"‚Ò×FW‡B“·FF–æs£7‚Wƒ¶föçB×6—¦S£ƒ¶föçBÖfÖ–Ç“¦Ööæ÷76R#ãÂöÆ&VÃæ’æ¦ö–â‚rr—Ğ¢ÂöF—cà¢ÂöF—cæ’æ¦ö–â‚rr“°¢Ğ¢òò)H)H§W7FW2÷"–W¦†÷fW'&–FW2FR&VÆÆVæò÷W,:ÖÖWG&÷2÷6÷÷'FR÷"ö&¦WFòFVÂÆFò’)H)H ¢6öç7Bö–å7G–ÆSÒ'v–GFƒ£S‡ƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£Wƒ¶6öÆ÷#§f"‚Ò×FW‡B“·FF–æs£7‚Wƒ¶föçB×6—¦S£ƒ¶föçBÖfÖ–Ç“¦Ööæ÷76R#°¢gVæ7F–öâ&VæFW$ö&¥6WGF–æw2‚—°¢6öç7Bw&ÖVÂ‚w6Äö&¥6WEw&r’ÆÆ—7CÖVÂ‚w6Äö&¥6WDÆ—7Br“¶–b‚w&ÇÂÆ—7B—&WGW&ã°¢–b‚2æö&¥6WGF–æw7ÇÂ2æö&¤$'7ÇÅ2æö&¤$'2æÆVæwFƒÃ"—·w&ç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·Ğ¢w&ç7G–ÆRæF—7Æ“Òv&Æö6²s°¢6öç7BG3Õ²rrÂvw&–BrÂvw—&ö–BrÂwG&–ævÆRrÂv†W‚rÂv†öæW–6öÖ"rÂv7V&–2rÂv6öæ6VçG&–2rÂvÆ–v‡Fæ–ærrÂvFF—fRrÂvÆ–æV"uÓ°¢Æ—7Bæ–ææW$…DÔÃÕ2æö&¥6WGF–æw2æÖ‚‡2Æ’“Óæ ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£‡ƒ·FF–æs£‡ƒ¶Ö&v–âÖ&÷GFöÓ£g‚#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶föçB×vV–v‡C£s¶6öÆ÷#§f"‚Ò×FW‡C"“¶Ö&v–âÖ&÷GFöÓ£g‚#å–W¦G¶’³ÓÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£gƒ¶fÆW‚×w&§w&#à¢ÆÆ&VÂ7G–ÆSÒ&föçB×6—¦S£—ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#å&VÆÆVæòSÆ'#ãÆ–çWBG—SÒ&çVÖ&W""7FWÒ#R"Æ6V†öÆFW#Ò.(	B"fÇVSÒ"G·2æ–æf–ÆÅ7CóòrwÒ"öæ6†ævSÒ%4Ã4BçWDö&¥6WGF–ær‚G¶—ÒÂv–æf–ÆÅ7BrÇF†—2çfÇVR’"7G–ÆSÒ"Gµö–å7G–ÆWÒ#ãÂöÆ&VÃà¢ÆÆ&VÂ7G–ÆSÒ&föçB×6—¦S£—ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#åG,;6ãÆ'#ãÇ6VÆV7Böæ6†ævSÒ%4Ã4BçWDö&¥6WGF–ær‚G¶—ÒÂv–æf–ÆÅG—RrÇF†—2çfÇVR’"7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£Wƒ¶6öÆ÷#§f"‚Ò×FW‡B“·FF–æs£7‚Wƒ¶föçB×6—¦S£‚#âG·G2æÖ†óÓæÆ÷F–öâfÇVSÒ"G¶÷Ò"G¶óÓÓÒ‡2æ–æf–ÆÅG—WÇÂrr“òw6VÆV7FVBs¢rwÓâG¶÷ÇÂ~(	BwÓÂö÷F–öãæ’æ¦ö–â‚rr—ÓÂ÷6VÆV7CãÂöÆ&VÃà¢ÆÆ&VÂ7G–ÆSÒ&föçB×6—¦S£—ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#åW,:ÖÖWG&÷3Æ'#ãÆ–çWBG—SÒ&çVÖ&W""7FWÒ#"Æ6V†öÆFW#Ò.(	B"fÇVSÒ"G·2ç6†VÆÇ3óòrwÒ"öæ6†ævSÒ%4Ã4BçWDö&¥6WGF–ær‚G¶—ÒÂw6†VÆÇ2rÇF†—2çfÇVR’"7G–ÆSÒ"Gµö–å7G–ÆWÒ#ãÂöÆ&VÃà¢ÆÆ&VÂ7G–ÆSÒ&föçB×6—¦S£—ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#å6÷÷'FSÆ'#ãÇ6VÆV7Böæ6†ævSÒ%4Ã4BçWDö&¥6WGF–ær‚G¶—ÒÂw7W÷'G2rÇF†—2çfÇVR’"7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£Wƒ¶6öÆ÷#§f"‚Ò×FW‡B“·FF–æs£7‚Wƒ¶föçB×6—¦S£‚#ãÆ÷F–öâfÇVSÒ""G²2ç7W÷'G3òw6VÆV7FVBs¢rwÓævÆö&ÃÂö÷F–öããÆ÷F–öâfÇVSÒ'<:Ò"G·2ç7W÷'G3ÓÓÒw<:Òsòw6VÆV7FVBs¢rwÓç<:ÓÂö÷F–öããÆ÷F–öâfÇVSÒ&æò"G·2ç7W÷'G3ÓÓÒvæòsòw6VÆV7FVBs¢rwÓææóÂö÷F–öããÂ÷6VÆV7CãÂöÆ&VÃà¢ÂöF—cà¢ÂöF—cæ’æ¦ö–â‚rr“°¢Ğ¢gVæ7F–öâWDö&¥6WGF–ær†’Æ²Çb—¶–b…2æö&¥6WGF–æw2be2æö&¥6WGF–æw5¶•Ò•2æö&¥6WGF–æw5¶•Õ¶µÓ×c·Ğ¢òò,:ÖWG&÷2VfV7F—f÷2&Væ6ÇGW&7W%¢†Æ–6ÖöF–f–6F÷&W2VR7V'&âW6R¢’à¢òò6–âÖöF–f–6F÷&W27F—f÷2(i"FWgVVÇfRVÂÖ—6Öòö&¦WFò†6W&ò6Ö&–÷2VâÆ6Æ–F’à¢gVæ7F–öâöÆ–W%&×2‡Æ7W%¢—°¢–b‚2æÖöF–f–W'7ÇÂ2æÖöF–f–W'2æÆVæwF‚—&WGW&â°¢6öç7B6Æ“Ò‡bÆÆ"“ÓäÖF‚æÖ‚†ÄÖF‚æÖ–â†"ÄÖF‚ç&÷VæB‚·b’’“°¢6öç7BE3Õ²vw&–BrÂvw—&ö–BrÂwG&–ævÆRrÂv†W‚rÂv†öæW–6öÖ"rÂv7V&–2rÂv6öæ6VçG&–2rÂvÆ–v‡Fæ–ærrÂvFF—fRrÂvÆ–æV"uÓ°¢ÆWBSÖçVÆÃ°¢f÷"†6öç7BÒöb2æÖöF–f–W'2—°¢–b†7W%£ÆÒç¤Ö–âÓRÓgÇÆ7W%£æÒç¤Ö‚³RÓb–6öçF–çVS°¢f÷"†6öç7B²öbôÔôEôd”TÄE2—°¢6öç7B&sÖÕ¶µÓ¶–b‡&sÓÓÒrwÇÇ&sÓÓÖçVÆÇÇÇ&sÓÓ×VæFVf–æVB–6öçF–çVS°¢–b‚R—SÔö&¦V7Bæ76–vâ‡·ÒÇ“°¢–b†³ÓÓÒv–æf–ÆÅG—Rr—¶–b…E2æ–æ6ÇVFW2‡&r’—Ræ–æf–ÆÅG—S×&s·Ğ¢VÇ6R–b†³ÓÓÒv–æf–ÆÅ7Br—Ræ–æf–ÆÅ7CÖ6Æ’‡&rÃÃ“°¢VÇ6R–b†³ÓÓÒw6†VÆÇ2r—Rç6†VÆÇ3Ö6Æ’‡&rÃÃ‚“°¢VÇ6RU¶µÓÖ6Æ’‡&rÃÃ“²òòF÷Æ–W'2ò&÷GFöÔÆ–W'0¢Ğ¢Ğ¢&WGW&âWÇÇ°¢Ğ¢gVæ7F–öâ&VE&×2‚—°¢6öç7B×·Ó°¢f÷"†6öç7Bböbd”TÄE2—°¢6öç7BVÇcÖVÂ‚w6Åöeòr¶bæ²“¶–b‚VÇb–6öçF–çVS°¢¶bæµÓÖbç6VÃò†bç6VÅ³ÓÓÓÒvæòsöVÇbçfÇVSÓÓÒw<:Òs¦VÇbçfÇVR“¢¶VÇbçfÇVS°¢Ğ¢&WGW&â6Æ×&×2‡“°¢Ğ ¢òò)H)HÆÖ–æFò6öâ¶—&“¤Ö÷Fò)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢òò)H)H6Æ–6W"æF—fò‡6–âFWVæFVæ6–2W‡FW&æ2’)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢òòÆv÷&—FÖ÷3¢–çFW'6V66œ;6âG&œ:æwVÆò×Ææò(i"6öçF÷&æ÷2(i"6†VÆÇ2†–ç6WBÖ—FW"’(i"–æf–ÆÂ66æÆ–æP¢6öç7Bd”Äô$TÔÖF‚å’£ãscSc#S²òò6V66œ;6âf–ÆÖVçFòãsVÖÒÒø+sãƒs\+ ¢gVæ7F–öâö'V–ÆD6öçF÷W'2‡6Vw2—°¢–b‚6Vw2æÆVæwF‚—&WGW&åµÓ°¢òò6ÆfRçVÜ:—&–6‡6–âÆÆö66œ;6âFR7G&–ær’(i"Ö—6Öò&VFöæFVòU2Â×V6†òÜ:2,:–Fò÷"6¢6öç7BU3ÓãRÇ&÷VæC×cÓäÖF‚ç&÷VæB‡bôU2’Ä³Ò‡“Óâ‡&÷VæB‡³Ò’³Sb’£C²‡&÷VæB‡³Ò’³Sb“°¢6öç7BÖÖæWrÖ‚“°¢f÷"†ÆWB“Ó¶“Ç6Vw2æÆVæwFƒ¶’²²—°¢6öç7B³Ô²‡6Vw5¶•Õ³Ò’Æ³Ô²‡6Vw5¶•Õ³Ò“°¢†ÖævWB†³—ÇÆÖç6WB†³ÅµÒ’ævWB†³’’çW6‚‡¶–Ú±î¸Â¸­yêë¢°k¢G§¦*^dx:i,side:0});
      (map.get(k1)||map.set(k1,[]).get(k1)).push({idx:i,side:1});
    }
    const used=new Uint8Array(segs.length);const contours=[];
    const GAP=EPS*5,GAP2=GAP*GAP; // reparaciÃ³n de malla: tolerancia para puentear huecos pequeÃ±os
    for(let start=0;start<segs.length;start++){
      if(used[start])continue;used[start]=1;
      const c=[segs[start][0],segs[start][1]];
      for(let _=0;_<segs.length;_++){
        const last=c[c.length-1];const nb=map.get(K(last))||[];let found=false;
        for(const{idx,side}of nb){if(used[idx])continue;used[idx]=1;c.push(side===0?segs[idx][1]:segs[idx][0]);found=true;break;}
        if(!found){
          // ReparaciÃ³n: ningÃºn vÃ©rtice coincide exacto â†’ conecta el extremo libre mÃ¡s cercano dentro de GAP
          let bi=-1,bside=0,bd=GAP2;
          for(let s=0;s<segs.length;s++){if(used[s])continue;
            for(let sd=0;sd<2;sd++){const pt=segs[s][sd];const dd=(pt[0]-last[0])**2+(pt[1]-last[1])**2;if(dd<bd){bd=dd;bi=s;bside=sd;}}
          }
          if(bi>=0){used[bi]=1;c.push(segs[bi][bside===0?1:0]);found=true;}
        }
        if(!found)break;
        if(K(c[c.length-1])===K(c[0]))break;
      }
      // Descarta loops degenerados: <3 pts o Ã¡rea minÃºscula (motas de ruido al rozar una cara casi horizontal)
      if(c.length>=3&&Math.abs(_polyArea(c))>=0.02)contours.push(c);
    }
    return contours;
  }
  // Slicea el mesh en Z dado usando solo los triÃ¡ngulos del Ã­ndice ordenado
  function _sliceIdx(tris,sortedIdx,triZmin,triZmax,z){
    const segs=[];
    for(const i of sortedIdx){
      if(triZmin[i]>z)break; // todos los siguientes estÃ¡n por encima
      if(triZmax[i]<=z)continue; // este triÃ¡ngulo estÃ¡ completamente abajo
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
      // Math.max(0,â€¦) evita sqrt de negativo cuando dot < -1 por error de punto flotante (vÃ©rtice en horquilla) â†’ NaN
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
  // Punto dentro de polÃ­gono (ray casting) â€” para gyroid y soportes
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
  // â”€â”€ Relleno consciente de agujeros (regla even-odd sobre todos los loops) â”€â”€
  function _inSolid(x,y,loops){let c=0;for(const L of loops)if(_pointInPoly(x,y,L))c++;return c%2===1;}
  // â”€â”€ OptimizaciÃ³n: bounding-box por loop para descartar point-in-poly sin overlap â”€â”€
  function _bbOf(poly){let mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;for(const p of poly){if(p[0]<mnx)mnx=p[0];if(p[0]>mxx)mxx=p[0];if(p[1]<mny)mny=p[1];if(p[1]>mxy)mxy=p[1];}return[mnx,mny,mxx,mxy];}
  function _inSolidBB(x,y,loops,bbs){let c=0;for(let i=0;i<loops.length;i++){const b=bbs[i];if(x<b[0]||x>b[2]||y<b[1]||y>b[3])continue;if(_pointInPoly(x,y,loops[i]))c++;}return c%2===1;}
  // Slicer con lista activa: para z CRECIENTE sÃ³lo evalÃºa triÃ¡ngulos que cruzan el plano (no re-escanea todo)
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
  // Recorta lÃ­neas a los sub-tramos donde pred(x,y) es verdadero (muestreo cada `step`).
  // Sirve para imprimir superficies sÃ³lidas (top/bottom) sÃ³lo donde toca y dejar el resto disperso.
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
    // Monotonic: todas las lÃ­neas van en la misma direcciÃ³n â†’ superficie mÃ¡s uniforme sin marcas de costura
    // Boustrophedon (por defecto): lÃ­neas alternas invertidas â†’ menos viajes pero puede dejar marcas
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
  // Relleno concÃ©ntrico: anillos que siguen el contorno hacia adentro (recortados a la regiÃ³n sÃ³lida)
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
      // Verdadero patrÃ³n hexagonal: celdas hexagonales con filas offset
      const bbs=loops.map(_bbOf);
      let mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;
      for(const b of bbs){if(b[0]<mnx)mnx=b[0];if(b[2]>mxx)mxx=b[2];if(b[1]<mny)mny=b[1];if(b[3]>mxy)mxy=b[3];}
      const s=spacing,h=s*Math.sqrt(3)/2;
      const segs=[];
      for(let row=0;(mny+row*h)<mxy+h;row++){
        const yOff=row%2?s/2:0,yc=mny+row*h;
        for(let col=0;(mnx+col*s*1.5-s)<mxx+s;col++){
          const xc=mnx+col*s*1.5+yOff;
          // 6 vÃ©rtices del hexÃ¡gono
          const pts=Array.from({length:6},(_,i)=>[xc+s*Math.cos(i*Math.PI/3),yc+s*Math.sin(i*Math.PI/3)]);
          // SÃ³lo los lados que no se duplican (lados 0-2 del hexÃ¡gono, los otros son compartidos)
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
  // Profundidad de anidamiento (cuÃ¡ntos contornos contienen a Ã©ste) â†’ par=exterior, impar=agujero.
  // Usa un punto sobre el borde del contorno (no el centroide, que puede caer dentro de un agujero concÃ©ntrico).
  function _depth(contour,all){
    const n=contour.length,a=contour[0],b=contour[1%n];
    let mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2,dx=b[0]-a[0],dy=b[1]-a[1],ln=Math.hypot(dx,dy)||1;
    mx+=(-dy/ln)*0.01;my+=(dx/ln)*0.01; // empuje mÃ­nimo hacia el interior del loop (CCW)
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
  // DetecciÃ³n de puentes: cobertura del Ã¡rea sÃ³lida por la capa inferior + orientaciÃ³n de span
  function _bridgeInfoMulti(loops,prev){
    const bbs=loops.map(_bbOf);
    let mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;
    for(const b of bbs){if(b[0]<mnx)mnx=b[0];if(b[2]>mxx)mxx=b[2];if(b[1]<mny)mny=b[1];if(b[3]>mxy)mxy=b[3];}
    const angle=(mxx-mnx)<=(mxy-mny)?0:90; // lÃ­neas a lo largo de la dimensiÃ³n corta (vanos mÃ¡s cortos)
    if(!prev||!prev.length)return{cov:0,angle};
    const pbbs=prev.map(_bbOf),N=7;let inP=0,cov=0;
    for(let i=0;i<=N;i++)for(let j=0;j<=N;j++){
      const x=mnx+(mxx-mnx)*i/N,y=mny+(mxy-mny)*j/N;
      if(!_inSolidBB(x,y,loops,bbs))continue;inP++;
      if(_inSolidBB(x,y,prev,pbbs))cov++;
    }
    return{cov:inP?cov/inP:1,angle};
  }
  // Punto de inicio de costura segÃºn modo (cercano / alineado atrÃ¡s / esquina aguda)
  function _seamStart(poly,mode,cX,cY,ox,oy){
    const n=poly.length;
    if(mode==='aleatorio')return Math.floor(Math.random()*n); // costura dispersa â†’ no se acumula una cicatriz vertical
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
        if(ax*by-ay*bx<=0)continue; // sÃ³lo esquinas convexas (poly CCW)
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
  // â”€â”€ Arc welding: convierte tramos rectos en arcos G2/G3 (archivos mÃ¡s livianos) â”€â”€
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
  // â”€â”€ EXCLUDE_OBJECT (Klipper): etiqueta cada pieza para poder cancelarla sin abortar la placa â”€â”€
  // Post-proceso: envuelve las extrusiones de cada objeto segÃºn su caja XY (las piezas no se solapan).
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
  // Despacho de patrÃ³n de relleno disperso
  function _infill(poly,spacing,pattern,li,z){
    if(pattern==='gyroid')return _gyroidFill(poly,spacing,z);
    if(pattern==='grid')return _scanfill(poly,spacing*2,45).concat(_scanfill(poly,spacing*2,135));
    if(pattern==='triangle'||pattern==='hex')return _scanfill(poly,spacing*3,0).concat(_scanfill(poly,spacing*3,60),_scanfill(poly,spacing*3,120));
    return _scanfill(poly,spacing,li%2?135:45); // linear
  }
  // LÃ­neas de soporte activas en una capa: conecta columnas por fila y da cuerpo a cada una (cruz + zÃ³calo)
  function _supportLinesAtLayer(cols,li,gs,p){
    const active=cols.filter(c=>c.top>=li&&c.bot<=li);
    if(!active.length)return[];
    const lines=[];
    // ConexiÃ³n por filas (tramos contiguos) â€” evita columnas sueltas
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
  // â”€â”€ Soportes tipo Ã¡rbol â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // hitFn(x,y,li) = Â¿hay modelo ahÃ­? â†’ se usa para inclinar el tronco y esquivar la pieza
  function _buildTreeSupport(cols,hitFn,totalL){
    if(!cols||!cols.length)return[];
    // Clustering local ACOTADO: cada contacto se une al cluster cuyo centroide
    // estÃ© mÃ¡s cerca dentro de MERGE_R; si ninguno, abre uno nuevo. Evita el
    // encadenamiento transitivo (union-find) que fusionaba contactos lejanos en
    // muy pocos troncos y dejaba ramas largas flotando hacia contactos inalcanzables.
    const MERGE_R=6; // = radio mÃ¡x del cluster (mm) â†’ ramas cortas e imprimibles
    const clusters=[];
    for(const c of cols){
      let best=null,bd=MERGE_R;
      for(const cl of clusters){const d=Math.hypot(c.x-cl.cx,c.y-cl.cy);if(d<bd){bd=d;best=cl;}}
      if(best){best.mem.push(c);best.cx+=(c.x-best.cx)/best.mem.length;best.cy+=(c.y-best.cy)/best.mem.length;}
      else clusters.push({mem:[c],cx:c.x,cy:c.y});
    }
    const MAXSTEP=0.45; // desplazamiento horizontal mÃ¡ximo por capa (imprimible)
    return clusters.map(({mem})=>{
      const cx=mem.reduce((s,c)=>s+c.x,0)/mem.length;
      const cy=mem.reduce((s,c)=>s+c.y,0)/mem.length;
      const reach=Math.max(0.01,...mem.map(c=>Math.hypot(c.x-cx,c.y-cy))); // alcance horizontal de ramas
      const topLi=Math.max(...mem.map(c=>c.top));
      const baseLi=Math.min(...mem.map(c=>c.bot));
      // Camino del tronco (de arriba hacia abajo): si entra en la pieza, se desvÃ­a gradualmente; si estÃ¡ libre, vuelve bajo el contacto
      const path=new Array(topLi+1);let x=cx,y=cy;
      for(let li=topLi;li>=baseLi;li--){
        if(hitFn&&hitFn(x,y,li)){
          // buscar la salida libre mÃ¡s cercana (anillos crecientes) y avanzar hacia ella, capado por capa
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
      // Altura de la zona de ramas proporcional al alcance horizontal â†’ suben a ~45Â°
      // (imprimibles) en vez de un nÂº fijo de capas que con capa fina (0.12mm) flotaba.
      const BRANCH=Math.max(6,Math.ceil((reach||1)/Math.max(0.08,(p&&p.layerHeight)||0.2)));
      if(li>=topLi-BRANCH){
        // Zona de ramas: UNA lÃ­nea fina del tronco a cada contacto + punta (snap-off fÃ¡cil)
        const prog=Math.max(0,(li-(topLi-BRANCH))/BRANCH); // 0 = tronco, 1 = contacto
        for(const c of active){
          const bx=tc.x+(c.x-tc.x)*prog,by=tc.y+(c.y-tc.y)*prog;
          const ax=tc.x+(c.x-tc.x)*Math.max(0,prog-0.5),ay=tc.y+(c.y-tc.y)*Math.max(0,prog-0.5);
          lines.push([[ax,ay],[bx,by]]); // rama: una sola lÃ­nea (ligera)
          if(li>=c.top-1){const r=li>=c.top?extW*0.8:extW*1.4;lines.push([[c.x-r,c.y],[c.x+r,c.y]]);if(li<c.top)lines.push([[c.x,c.y-r],[c.x,c.y+r]]);}
        }
      }else{
        // Tronco fino tipo tubo: solo contorno octogonal (sin celosÃ­a maciza) â†’ ligero y retirable
        const fromBot=li-baseLi;
        let R=Math.min(2.2,1.0+mem.length*0.15);
        if(fromBot<8)R+=(8-fromBot)*0.12; // pequeÃ±o zÃ³calo de adhesiÃ³n en las primeras capas
        const SEG=8,pts=[];
        for(let a=0;a<SEG;a++){const an=a/SEG*2*Math.PI;pts.push([tc.x+Math.cos(an)*R,tc.y+Math.sin(an)*R]);}
        for(let a=0;a<SEG;a++)lines.push([pts[a],pts[(a+1)%SEG]]);
        if(R>1.7)lines.push([[tc.x-R*0.6,tc.y],[tc.x+R*0.6,tc.y]]); // refuerzo Ãºnico solo si el tronco es ancho
      }
    }
    return lines;
  }
  // â”€â”€ Adaptive layer heights â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  // Estado de wipe: direcciÃ³n del Ãºltimo segmento impreso â†’ se limpia hacia atrÃ¡s sobre Ã©l al retraer
  let _wipeState={dx:0,dy:0,has:false};
  function _setWipe(ax,ay,bx,by){const dx=bx-ax,dy=by-ay,l=Math.hypot(dx,dy);if(l>1e-4){_wipeState={dx:dx/l,dy:dy/l,has:true};}}
  // RetracciÃ³n + viaje (con wipe y z-hop) centralizado â†’ devuelve [E, x, y] en el destino
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
    // Defensa en profundidad: descarta cualquier punto no-finito antes de imprimir (jamÃ¡s un G1 XNaN)
    ord=ord.filter(pt=>isFinite(pt[0])&&isFinite(pt[1]));
    if(ord.length<3)return[E,cX,cY];
    const sx=ord[0][0]+ox,sy=ord[0][1]+oy;
    // Solo retraer/z-hop si el salto es real â€” evita retracciones inÃºtiles entre paredes concÃ©ntricas
    const td=Math.hypot(sx-cX,sy-cY),doRet=td>Math.max(extW*3,(p.retractMinTravel||0));
    if(doRet){[E,cX,cY]=_retractTravel(gc,cX,cY,sx,sy,z,E,p,td);}
    else{gc.push(`G1 X${sx.toFixed(3)} Y${sy.toFixed(3)} F${p.travelSpeed*60}`);cX=sx;cY=sy;}
    // Recorrido absoluto cerrado + coasting (deja de extruir en los Ãºltimos `coast` mm para evitar blob de costura)
    const pts=[];for(let i=0;i<=ord.length;i++){const pt=ord[i%ord.length];pts.push([pt[0]+ox,pt[1]+oy]);}
    let total=0;for(let i=1;i<pts.length;i++)total+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
    // Costura scarf: imprime el lazo con rampa de flujo al inicio y un solape decreciente al final â†’ costura casi invisible
    if(scarf>0&&total>scarf*2.2){
      let acc2=0;
      for(let i=1;i<pts.length;i++){
        const qx=pts[i][0],qy=pts[i][1];if(!isFinite(qx)||!isFinite(qy)){continue;}
        const seg=Math.hypot(qx-cX,qy-cY),mid=acc2+seg/2;
        const f=mid<scarf?Math.max(0.05,mid/scarf):1; // rampa de subida en los primeros `scarf` mm
        const sf=(ohTest&&ohFeed&&ohTest((cX+qx)/2,(cY+qy)/2))?ohFeed:feed;
        E+=(sm«ëŒ+Š×®º+º$zzb¥æVr¦W‡Er¦Æ‚¦b’ôd”Äô$T¶v2çW6‚†s‚G·‚çFôf—†VBƒ2—Ò’G·’çFôf—†VBƒ2—ÒRG´RçFôf—†VBƒB—ÒbG·6gÖ“°¢63"³×6Vs¶5ƒ×ƒ¶5“×“°¢Ğ¢òò6öÆS¢&R×G&¦VÂ–æ–6–ò6öâfÇV¦òFV7&V6–VçFRƒ(i#¢ÆWB÷cÓ°¢f÷"†ÆWB“Ó¶“ÇG2æÆVæwF‚bf÷cÇ66&c¶’²²—°¢6öç7Bƒ×G5¶•Õ³ÒÇ“×G5¶•Õ³Ó¶–b‚—4f–æ—FR‡‚—ÇÂ—4f–æ—FR‡’’–'&V³°¢6öç7B6VsÔÖF‚æ‡—÷B‡‚Ö5‚Ç’Ö5’—ÇÃRÓbÇW6SÔÖF‚æÖ–â‡6VrÇ66&bÖ÷b“°¢6öç7BGC×W6R÷6VrÆWƒÖ5‚²‡‚Ö5‚’§GBÆW“Ö5’²‡’Ö5’’§GC°¢6öç7BcÔÖF‚æÖ‚ƒÃÒ†÷b·W6Ró"’÷66&b“°¢R³Ò‡W6R¦W‡Er¦Æ‚¦b’ôd”Äô$T¶v2çW6‚†s‚G¶W‚çFôf—†VBƒ2—Ò’G¶W’çFôf—†VBƒ2—ÒRG´RçFôf—†VBƒB—ÒbG¶fVVGÖ“°¢÷b³×W6S¶5ƒÖWƒ¶5“ÖW“°¢Ğ¢–b‡G2æÆVæwFƒãÓ"•÷6WEv—R‡G5·G2æÆVæwF‚Ó%Õ³ÒÇG5·G2æÆVæwF‚Ó%Õ³ÒÆ5‚Æ5’“°¢&WGW&å´RÆ5‚Æ5•Ó°¢Ğ¢6öç7B6ö7CÒ‡bgæ6ö7F–ær—ÇÃÆ6ö7E7F'C×F÷FÂÖ6ö7C°¢ÆWB63Ó°¢f÷"†ÆWB“Ó¶“ÇG2æÆVæwFƒ¶’²²—°¢6öç7Bƒ×G5¶•Õ³ÒÇ“×G5¶•Õ³Ó°¢–b‚—4f–æ—FR‡‚—ÇÂ—4f–æ—FR‡’’–6öçF–çVS°¢6öç7B6VsÔÖF‚æ‡—÷B‡‚Ö5‚Ç’Ö5’“°¢òòfVÆö6–FB&VGV6–FVâföÆF—¦÷3¢6’VÂVçFòÖVF–òFVÂ6VvÖVçFòW7L:6ö'&R—&RÂW6ö„fVV@¢6öç7B6cÒ†ö…FW7Bbfö„fVVBbfö…FW7B‚†5‚·‚’ó"Â†5’·’’ó"’“öö„fVVC¦fVVC°¢–b†6ö7Cãbf63Æ6ö7E7F'Bbf62·6Vsæ6ö7E7F'B—°¢6öç7BGCÒ†6ö7E7F'BÖ62’÷6VrÆ×ƒÖ5‚²‡‚Ö5‚’§GBÆ×“Ö5’²‡’Ö5’’§GC°¢R³Ò„ÖF‚æ‡—÷B†×‚Ö5‚Æ×’Ö5’’¦W‡Er¦Æ‚’ôd”Äô$T¶v2çW6‚†s‚G¶×‚çFôf—†VBƒ2—Ò’G¶×’çFôf—†VBƒ2—ÒRG´RçFôf—†VBƒB—ÒbG·6gÖ“°¢v2çW6‚†s‚G·‚çFôf—†VBƒ2—Ò’G·’çFôf—†VBƒ2—ÒbG·6gÖ“°¢ÖVÇ6R–b†6ö7Cãbf63ãÖ6ö7E7F'B—°¢v2çW6‚†s‚G·‚çFôf—†VBƒ2—Ò’G·’çFôf—†VBƒ2—ÒbG·6gÖ“°¢ÖVÇ6W°¢R³Ò‡6Vr¦W‡Er¦Æ‚’ôd”Äô$T¶v2çW6‚†s‚G·‚çFôf—†VBƒ2—Ò’G·’çFôf—†VBƒ2—ÒRG´RçFôf—†VBƒB—ÒbG·6gÖ“°¢Ğ¢62³×6Vs¶5ƒ×ƒ¶5“×“°¢Ğ¢–b‡G2æÆVæwFƒãÓ"•÷6WEv—R‡G5·G2æÆVæwF‚Ó%Õ³ÒÇG5·G2æÆVæwF‚Ó%Õ³ÒÆ5‚Æ5’“°¢&WGW&å´RÆ5‚Æ5•Ó°¢Ğ¢òò&6†æS¢&VBFRæ6†òf&–&ÆR(	B–wVÂVR÷&–çEöÇ’W&ò6öâRW66ÆFò÷"u&F–òƒâã¢gVæ7F–öâ÷&–çEöÇ•66ÆVB†v2ÇöÇ’Ç¢Æ÷‚Æ÷’Æ5‚Æ5’ÄRÆÆ‚ÆW‡ErÇu&F–òÆfVVBÇ—°¢6öç7B&“Õ÷6VÕ7F'B‡öÇ’Çbgç6VÔÖöFRÆ5‚Æ5’Æ÷‚Æ÷’“°¢6öç7B÷&CÕ²ââçöÇ’ç6Æ–6R†&’’ÂââçöÇ’ç6Æ–6RƒÆ&’•Ó°¢6öç7B7ƒÖ÷&E³Õ³Ò¶÷‚Ç7“Ö÷&E³Õ³Ò¶÷’ÇFCÔÖF‚æ‡—÷B‡7‚Ö5‚Ç7’Ö5’“°¢–b‡FCäÖF‚æÖ‚†W‡Er£2Â‡ç&WG&7DÖ–åG&fVÇÇÃ’’—µ´RÆ5‚Æ5•ÓÕ÷&WG&7EG&fVÂ†v2Æ5‚Æ5’Ç7‚Ç7’Ç¢ÄRÇÇFB“·Ğ¢VÇ6W¶v2çW6‚†s‚G·7‚çFôf—†VBƒ2—Ò’G·7’çFôf—†VBƒ2—ÒbG·çG&fVÅ7VVB£cÖ“¶5ƒ×7ƒ¶5“×7“·Ğ¢6öç7BG3ÕµÓ¶f÷"†ÆWB“Ó¶“ÃÖ÷&BæÆVæwFƒ¶’²²—¶6öç7BCÖ÷&E¶’V÷&BæÆVæwF…Ó·G2çW6‚…·E³Ò¶÷‚ÇE³Ò¶÷•Ò“·Ğ¢f÷"†ÆWB“Ó¶“ÇG2æÆVæwFƒ¶’²²—°¢6öç7Bƒ×G5¶•Õ³ÒÇ“×G5¶•Õ³Ó°¢–b‚—4f–æ—FR‡‚—ÇÂ—4f–æ—FR‡’’–6öçF–çVS°¢6öç7B6VsÔÖF‚æ‡—÷B‡‚Ö5‚Ç’Ö5’“°¢R³Ò‡6Vr¦W‡Er¦Æ‚§u&F–ò’ôd”Äô$T¶v2çW6‚†s‚G·‚çFôf—†VBƒ2—Ò’G·’çFôf—†VBƒ2—ÒRG´RçFôf—†VBƒB—ÒbG¶fVVGÖ“°¢5ƒ×ƒ¶5“×“°¢Ğ¢–b‡G2æÆVæwFƒãÓ"•÷6WEv—R‡G5·G2æÆVæwF‚Ó%Õ³ÒÇG5·G2æÆVæwF‚Ó%Õ³ÒÆ5‚Æ5’“°¢&WGW&å´RÆ5‚Æ5•Ó°¢Ğ¢òò7—&Æ—¦S¢–×&–ÖRVÂW,:ÖÖWG&òW‡FW&–÷"6öâ¢7&V6–VæFò6öçF–çVÖVçFR‡6–â6÷7GW&FR6¢gVæ7F–öâ÷&–çEöÇ•7—&Å¢†v2ÇöÇ’Ç¥7F'BÇ¤VæBÆ÷‚Æ÷’Æ5‚Æ5’ÄRÆÆ‚ÆW‡ErÆfVVBÇ—°¢6öç7B&“Õ÷6VÕ7F'B‡öÇ’Çbgç6VÔÖöFRÆ5‚Æ5’Æ÷‚Æ÷’“°¢6öç7B÷&CÕ²ââçöÇ’ç6Æ–6R†&’’ÂââçöÇ’ç6Æ–6RƒÆ&’•Ó°¢6öç7B7ƒÖ÷&E³Õ³Ò¶÷‚Ç7“Ö÷&E³Õ³Ò¶÷’ÇFCÔÖF‚æ‡—÷B‡7‚Ö5‚Ç7’Ö5’“°¢–b‡FCæW‡Er£2—°¢RÓ×ç&WG&7DF—7C¶v2çW6‚†sRG´RçFôf—†VBƒB—ÒbG·ç&WG&7E7VVB£cÖ“°¢v2çW6‚†s‚G·7‚çFôf—†VBƒ2—Ò’G·7’çFôf—†VBƒ2—Ò¢G·¥7F'BçFôf—†VBƒ2—ÒbG·çG&fVÅ7VVB£cÖ“°¢R³×ç&WG&7DF—7C¶v2çW6‚†sRG´RçFôf—†VBƒB—ÒbG·ç&WG&7E7VVB£cÖ“°¢ÖVÇ6W¶v2çW6‚†s‚G·7‚çFôf—†VBƒ2—Ò’G·7’çFôf—†VBƒ2—ÒbG·çG&fVÅ7VVB£cÖ“·Ğ¢5ƒ×7ƒ¶5“×7“°¢òò6Æ7VÆ"Æöæv—GVBF÷FÂFVÂW,:ÖÖWG&ò6W'&Fğ¢6öç7BG3ÕµÓ¶f÷"†ÆWB“Ó¶“ÃÖ÷&BæÆVæwFƒ¶’²²—¶6öç7BCÖ÷&E¶’V÷&BæÆVæwF…Ó·G2çW6‚…·E³Ò¶÷‚ÇE³Ò¶÷•Ò“·Ğ¢ÆWBF÷FÄÆVãÓ¶f÷"†ÆWB“Ó¶“ÇG2æÆVæwFƒ¶’²²—F÷FÄÆVâ³ÔÖF‚æ‡—÷B‡G5¶•Õ³Ò×G5¶’ÓÕ³ÒÇG5¶•Õ³Ò×G5¶’ÓÕ³Ò“°¢ÆWB63Ó°¢f÷"†ÆWB“Ó¶“ÇG2æÆVæwFƒ¶’²²—°¢6öç7Bƒ×G5¶•Õ³ÒÇ“×G5¶•Õ³Ó°¢–b‚—4f–æ—FR‡‚—ÇÂ—4f–æ—FR‡’’–6öçF–çVS°¢6öç7B6VsÔÖF‚æ‡—÷B‡‚Ö5‚Ç’Ö5’“°¢62³×6Vs°¢6öç7B§£×F÷FÄÆVãã÷¥7F'B²†62÷F÷FÄÆVâ’¢‡¤VæB×¥7F'B“§¤VæC°¢R³Ò‡6Vr¦W‡Er¦Æ‚’ôd”Äô$T¶v2çW6‚†s‚G·‚çFôf—†VBƒ2—Ò’G·’çFôf—†VBƒ2—Ò¢G·§¢çFôf—†VBƒ2—ÒRG´RçFôf—†VBƒB—ÒbG¶fVVGÖ“°¢5ƒ×ƒ¶5“×“°¢Ğ¢&WGW&å´RÆ5‚Æ5•Ó°¢Ğ¢òò÷&FVæ6VvÖVçF÷2÷"fV6–æòÜ:26W&6æò†w&VVG’’(i"Ö–æ–Ö—¦f–¦W2â7'V6–Â&¢òòVÂ6÷÷'FS¢×V6†2—6Æ2F—7W'62–×&W62Vâ÷&FVâFRvVæW&6œ;6âÒ7v†WGF’FRf–¦W2à¢gVæ7F–öâö÷&FW$Æ–æW2†Æ–æW2Ç7‚Ç7’—°¢–b‚Æ–æW7ÇÆÆ–æW2æÆVæwFƒÃ7ÇÆÆ–æW2æÆVæwFƒãC—&WGW&âÆ–æW3²òòF÷S¢Wf—Fò†ì+"’Vâ62Væ÷&ÖW0¢6öç7BW6VCÖæWr'&’†Æ–æW2æÆVæwF‚’æf–ÆÂ†fÇ6R’Æ÷WCÕµÓ¶ÆWBƒ×7‚Ç“×7“°¢f÷"†ÆWB³Ó¶³ÆÆ–æW2æÆVæwFƒ¶²²²—°¢ÆWB&“ÒÓÆ&CÔ–æf–æ—G’ÆfÆ—ÖfÇ6S°¢f÷"†ÆWB“Ó¶“ÆÆ–æW2æÆVæwFƒ¶’²²—¶–b‡W6VE¶•Ò–6öçF–çVS¶6öç7BÖÆ–æW5¶•Õ³ÒÆ#ÖÆ–æW5¶•Õ³Ó°¢6öç7BFÒ†³Ò×‚’¢†³Ò×‚’²†³Ò×’’¢†³Ò×’’ÆF#Ò†%³Ò×‚’¢†%³Ò×‚’²†%³Ò×’’¢†%³Ò×’“°¢–b†FÆ&B—¶&CÖF¶&“Ö“¶fÆ—ÖfÇ6S·Ö–b†F#Æ&B—¶&CÖF#¶&“Ö“¶fÆ—×G'VS·×Ğ¢W6VE¶&•Ó×G'VS¶6öç7B3ÖfÆ—õ¶Æ–æW5¶&•Õ³ÒÆÆ–æW5¶&•Õ³ÕÓ¦Æ–æW5¶&•Ó¶÷WBçW6‚‡2“·ƒ×5³Õ³Ó·“×5³Õ³Ó°¢Ğ¢&WGW&â÷WC°¢Ğ¢gVæ7F–öâ÷&–çDÆ–æW2†v2ÆÆ–æW2Ç¢Æ÷‚Æ÷’Æ5‚Æ5’ÄRÆÆ‚ÆW‡ErÆfVVBÇÇ&WG&7EF‡&W6‚Æ÷F–Ö—¦R—°¢–b†÷F–Ö—¦R–Æ–æW3Õö÷&FW$Æ–æW2†Æ–æW2Æ5‚Ö÷‚Æ5’Ö÷’“²òò&V÷&FVæ&Ö–æ–Ö—¦"f–¦W2‡6÷÷'FR¢6öç7B'CÔÖF‚æÖ‚‡&WG&7EF‡&W6‡ÇÆW‡Er£2Â‡ç&WG&7DÖ–åG&fVÇÇÃ’“²òò6öÖ&–ær²f–¦RÜ:Öæ–Öó¢ÖVæ÷2&WG&66–öæW0¢f÷"†6öç7E·Ç%ÖöbÆ–æW2—°¢6öç7B7ƒ×³Ò¶÷‚Ç7“×³Ò¶÷’ÆWƒ×%³Ò¶÷‚ÆW“×%³Ò¶÷“°¢–b‚—4f–æ—FR‡7‚—ÇÂ—4f–æ—FR‡7’—ÇÂ—4f–æ—FR†W‚—ÇÂ—4f–æ—FR†W’’–6öçF–çVS°¢6öç7BFCÔÖF‚æ‡—÷B‡7‚Ö5‚Ç7’Ö5’“°¢–b‡FCç'B—µ´RÆ5‚Æ5•ÓÕ÷&WG&7EG&fVÂ†v2Æ5‚Æ5’Ç7‚Ç7’Ç¢ÄRÇÇFB“·Ğ¢VÇ6W¶v2çW6‚†s‚G·7‚çFôf—†VBƒ2—Ò’G·7’çFôf—†VBƒ2—ÒbG·çG&fVÅ7VVB£cÖ“¶5ƒ×7ƒ¶5“×7“·Ğ¢R³Ò„ÖF‚æ‡—÷B†W‚×7‚ÆW’×7’’¦W‡Er¦Æ‚’ôd”Äô$T°¢v2çW6‚†s‚G¶W‚çFôf—†VBƒ2—Ò’G¶W’çFôf—†VBƒ2—ÒRG´RçFôf—†VBƒB—ÒbG¶fVVGÖ“¶5ƒÖWƒ¶5“ÖW“°¢÷6WEv—R‡7‚Ç7’ÆW‚ÆW’“°¢Ğ¢&WGW&å´RÆ5‚Æ5•Ó°¢Ğ¢òòF–V×òÜ:Öæ–ÖòFR6¢6’Æ6–×&–ÖRVâÂÖ–å6V2Â&ÆVçF—¦4ôÄòÆ÷2Ö÷f–Ö–VçF÷2FRW‡G'W6œ;6à¢òò†æòÆ÷2f–¦W2’&F"F–V×òVæg&–"âFWgVVÇfRG'VR6’&ÆVçF—¬;2(i"7V&—"fVçF–ÆF÷"’à¢gVæ7F–öâöÇ”Ö–äÆ–W%F–ÖR†v2Æg&öÔ–G‚ÆÖ–å6V2—°¢–b‚†Ö–å6V3ã’—&WGW&âfÇ6S°¢ÆWBƒÖçVÆÂÇ“ÖçVÆÂÆW‡ECÓÇG&eCÓ¶6öç7BW‡D–GƒÕµÓ°¢f÷"†ÆWB“Ög&öÔ–Gƒ¶“Æv2æÆVæwFƒ¶’²²—°¢6öç7B3Öv5¶•Ó¶–b†2æ6†$6öFTBƒ’ÓÓsÇÂ†2ç7F'G5v—F‚‚tsr—ÇÆ2ç7F'G5v—F‚‚tsr’’–6öçF–çVS²òòsÒtrp¢6öç7B×ƒÒõ‚‚ÓõµÆBåÒ²’òæW†V2†2’Æ×“Òõ’‚ÓõµÆBåÒ²’òæW†V2†2’ÆÖcÒôb…µÆBåÒ²’òæW†V2†2“°¢6öç7BçƒÖ×ƒò¶×…³Ó§‚Æç“Ö×“ò¶×•³Ó§’ÆcÖÖcò¶Öe³Ó¦çVÆÃ°¢6öç7B—4SÒôRÓõµÆBåÒòçFW7B†2“°¢–b‡‚ÖçVÆÂbfbbb†ç‚Ó×‡ÇÆç’Ó×’’—¶6öç7BCÔÖF‚æ‡—÷B†ç‚×‚Æç’×’’ÇCÖBò†bóc“¶–b†—4R—¶W‡EB³×C¶W‡D–G‚çW6‚†’“·ÖVÇ6RG&eB³×C·Ğ¢–b†×‚—ƒÖçƒ¶–b†×’—“Öç“°¢Ğ¢6öç7BF÷FÃÖW‡EB·G&eC°¢–b‡F÷FÃãÖÖ–å6V7ÇÆW‡ECÃÓ—&WGW&âfÇ6S°¢6öç7BF&vWDW‡CÔÖF‚æÖ‚ƒãÆÖ–å6V2×G&eB“°¢ÆWBf7F÷#ÖW‡EB÷F&vWDW‡C¶–b†f7F÷#ã–f7F÷#Ó¶–b†f7F÷#Ãã‚–f7F÷#Óãƒ²òòF÷Rã,9rÜ:2ÆVçFğ¢6öç7BÖ–äcÓ‚£c²òòçVæ6÷"FV&¦òFR‚ÖÒ÷0¢f÷"†6öç7B’öbW‡D–G‚–v5¶•ÓÖv5¶•Òç&WÆ6R‚ôb…µÆBåÒ²’òÂ†ÒÆb“Óâtbr´ÖF‚æÖ‚†Ö–äbÄÖF‚ç&÷VæB‚¶b¦f7F÷"’’“°¢&WGW&âG'VS°¢Ğ¢òò)H)HvV"v÷&¶W"&VÂ&V6ö×WFRFR6öçF÷&æ÷2†ÆWFÜ:2W6F’)H)H ¢òò6R6öç7G'W–RFW6FRVÂçFõ7G&–ær‚’FRÆ2gVæ6–öæW2W&2&VÆW2(i"6–âGWÆ–6"<;6F–vòà¢òòVÂv÷&¶W"&V6–&RÆÖÆÆ’FWgVVÇfRÆ263²VÂ†–Æò&–æ6—ÂVVFÆ–'&R…T’fÇV–F’à¢ÆWB÷6Åv÷&¶W%U$ÃÖçVÆÃ°¢gVæ7F–öâ÷6Åv÷&¶W%U$ÄvWB‚—°¢–b…÷6Åv÷&¶W%U$Â—&WGW&â÷6Åv÷&¶W%U$Ã°¢6öç7B¶W&æVÃÕµ÷öÇ”&VÅö&$öbÅ÷ö–çD–åöÇ’ÅöFWF„$"Åö'V–ÆD6öçF÷W'2Åö7F—fU7vVWW%ÒæÖ†cÓæbçFõ7G&–ær‚’’æ¦ö–â‚uÆâr“°¢6öç7B&öG“Ö¶W&æVÂ¶ §6VÆbæöæÖW76vSÖgVæ7F–öâ†Wb—°¢G'—°¢f"CÖWbæFFÇG&—3ÖBçG&—2Ç6÷'FVD–GƒÖBç6÷'FVD–G‚ÇG&•¦Ö–ãÖBçG&•¦Ö–âÇG&•¦ÖƒÖBçG&•¦Ö‚ÆÆ‡3ÖBæÆ‡3°¢f"F÷FÄÃÖÆ‡2æÆVæwFƒ°¢f"Æ–W%F÷£ÕµÒÆÆ–W%öÇ—3ÕµÒÆÆ–W%&—G“ÕµÒÆÆ–W$æWD&VÕµÒÆÆ–W$$#ÕµÓ°¢f"7vVWÕö7F—fU7vVWW"‡G&—2Ç6÷'FVD–G‚ÇG&•¦Ö–âÇG&•¦Ö‚’Ç£Ó°¢f÷"‡f"Æ“Ó¶Æ“ÇF÷FÄÃ¶Æ’²²—°¢¢³ÖÆ‡5¶Æ•Ó¶Æ–W%F÷¢çW6‚‡¢“°¢f"73×7vVW‡¢ÖÆ‡5¶Æ•Òó"’æf–ÇFW"†gVæ7F–öâ†2—·&WGW&â2æÆVæwFƒãÓ3·Ò’æÖ†gVæ7F–öâ†2—·&WGW&â÷öÇ”&V†2“Ãö2ç6Æ–6R‚’ç&WfW'6R‚“¦3·Ò“°¢72ç6÷'B†gVæ7F–öâ†Æ"—·&WGW&âÖF‚æ'2…÷öÇ”&V†"’’ÔÖF‚æ'2…÷öÇ”&V†’“·Ò“°¢f"&'3Ö72æÖ…ö&$öb’Æ&V3Ö72æÖ†gVæ7F–öâ†2—·&WGW&âÖF‚æ'2…÷öÇ”&V†2’“·Ò“°¢Æ–W%öÇ—2çW6‚†72“¶Æ–W$$"çW6‚†&'2“°¢f"#Ö72æÖ†gVæ7F–öâ†7BÆ6’—·&WGW&âöFWF„$"†6’Æ72Æ&'2’S#ÓÓÓ·Ò“¶Æ–W%&—G’çW6‚‡"“°¢Æ–W$æWD&VçW6‚†72ç&VGV6R†gVæ7F–öâ‡2ÅòÆ6’—·&WGW&â2²‡%¶6•ÓòÓ£’¦&V5¶6•Ó·ÒÃ’“°¢–b†Æ’ScÓÓÓ—6VÆbç÷7DÖW76vR‡·&öw&W73¦Æ’÷F÷FÄÇÒ“°¢Ğ¢6VÆbç÷7DÖW76vR‡¶FöæS§G'VRÆÆ–W%F÷£¦Æ–W%F÷¢ÆÆ–W%öÇ—3¦Æ–W%öÇ—2ÆÆ–W%&—G“¦Æ–W%&—G’ÆÆ–W$æWD&V¦Æ–W$æWD&VÆÆ–W$$#¦Æ–W$$'Ò“°¢Ö6F6‚†R—·6VÆbç÷7DÖW76vR‡¶W'&÷#¥7G&–ær†RbfRæÖW76vWÇÆR—Ò“·Ğ§Ó¶°¢÷6Åv÷&¶W%U$ÃÕU$Âæ7&VFTö&¦V7EU$Â†æWr&Æö"…¶&öG•ÒÇ·G—S¢vÆ–6F–öâö¦f67&—BwÒ’“°¢&WGW&â÷6Åv÷&¶W%U$Ã°¢Ğ¢òò6Æ7VÆÆ262VâVâv÷&¶W#²çFR7VÇV–W"fÆÆò6RÂ<:Æ7VÆòVâ†–Æò&–æ6—Â†–L:–çF–6ò&W7VÇFFò’à¢gVæ7F–öâ÷&V6ö×WFTÆ–W'2‡G&—2Ç6÷'FVD–G‚ÇG&•¦Ö–âÇG&•¦Ö‚ÆÆ‡2ÇF÷FÄÂÆöå&ör—°¢6öç7B–æÆ–æSÒ‚“Óç°¢6öç7BÆ–W%F÷£ÕµÒÆÆ–W%öÇ—3ÕµÒÆÆ–W%&—G“ÕµÒÆÆ–W$æWD&VÕµÒÆÆ–W$$#ÕµÓ°¢6öç7B7vVWÕö7F—fU7vVWW"‡G&—2Ç6÷'FVD–G‚ÇG&•¦Ö–âÇG&•¦Ö‚“¶ÆWB£Ó°¢f÷"†ÆWBÆ“Ó¶Æ“ÇF÷FÄÃ¶Æ’²²—°¢¢³ÖÆ‡5¶Æ•Ó¶Æ–W%F÷¢çW6‚‡¢“°¢ÆWB73×7vVW‡¢ÖÆ‡5¶Æ•Òó"’æf–ÇFW"†3Óæ2æÆVæwFƒãÓ2’æÖ†3Óå÷öÇ”&V†2“Ãõ²ââæ5Òç&WfW'6R‚“¦2“°¢72ç6÷'B‚†Æ"“ÓäÖF‚æ'2…÷öÇ”&V†"’’ÔÖF‚æ'2…÷öÇ”&V†’’“°¢6öç7B&'3Ö72æÖ…ö&$öb’Æ&V3Ö72æÖ†3ÓäÖF‚æ'2…÷öÇ”&V†2’’“°¢Æ–W%öÇ—2çW6‚†72“¶Æ–W$$"çW6‚†&'2“°¢6öç7B#Ö72æÖ‚†7BÆ6’“ÓåöFWF„$"†6’Æ72Æ&'2’S#ÓÓÓ“¶Æ–W%&—G’çW6‚‡"“°¢Æ–W$æWD&VçW6‚†72ç&VGV6R‚‡2ÅòÆ6’“Óç2²‡%¶6•ÓòÓ£’¦&V5¶6•ÒÃ’“°¢Ğ¢&WGW&ç¶Æ–W%F÷¢ÆÆ–W%öÇ—2ÆÆ–W%&—G’ÆÆ–W$æWD&VÆÆ–W$$'Ó°¢Ó°¢&WGW&âæWr&öÖ—6R‡&W6öÇfSÓç°¢–b‡G—Vöbv÷&¶W#ÓÓÒwVæFVf–æVBwÇÇG—VöbU$ÃÓÓÒwVæFVf–æVBwÇÇG—Vöb&Æö#ÓÓÒwVæFVf–æVBr—·&W6öÇfR†–æÆ–æR‚’“·&WGW&ã·Ğ¢ÆWBsÖçVÆÂÇ6WGFÆVCÖfÇ6S°¢6öç7BFöæS×cÓç¶–b‡6WGFÆVB—&WGW&ã·6WGFÆVC×G'VS·G'—·rbgrçFW&Ö–æFR‚“·Ö6F6‚†R—·×&W6öÇfR‡b“·Ó°¢G'—°¢sÖæWrv÷&¶W"…÷6Åv÷&¶W%U$ÄvWB‚’“°¢ræöæW'&÷#Ò‚“ÓæFöæR†–æÆ–æR‚’“²òòfÆÆ&6²G&ç7&VçFP¢ræöæÖW76vSÖWcÓç°¢6öç7BÓÖWbæFF°¢–b†Òç&öw&W72ÖçVÆÂ—¶–b†öå&ör–öå&ör†Òç&öw&W72“·&WGW&ã·Ğ¢–b†ÒæW'&÷"—¶FöæR†–æÆ–æR‚’“·&WGW&ã·Ğ¢–b†ÒæFöæR–FöæR‡¶Æ–W%F÷£¦ÒæÆ–W%F÷¢ÆÆ–W%öÇ—3¦ÒæÆ–W%öÇ—2ÆÆ–W%&—G“¦ÒæÆ–W%&—G’ÆÆ–W$æWD&V¦ÒæÆ–W$æWD&VÆÆ–W$$#¦ÒæÆ–W$$'Ò“°¢Ó°¢òò6÷–2W7G'V7GW&F2†æòG&ç6fW&–&ÆW3¢G&—2ü:ÖæF–6W26R&WWF–Æ—¦âVâVÂ†–Æò&–æ6—Â¢rç÷7DÖW76vR‡·G&—2Ç6÷'FVD–G‚ÇG&•¦Ö–âÇG&•¦Ö‚ÆÆ‡7Ò“°¢Ö6F6‚†R—¶FöæR†–æÆ–æR‚’“·Ğ¢Ò“°¢Ğ¢7–æ2gVæ7F–öâöæF—fU6Æ–6R‡G&—2ÇÇ7V2Ææ÷¤BÆÖDæÖRÆÖöFVÄæÖR—°¢6öç7BW‡EsÖæ÷¤B£ãS°¢6öç7Böfeƒ×7V2ç‚ó"Æöfe“×7V2ç’ó#°¢6öç7Bv3ÕµÓ¶ÆWBSÓ°¢òò)H)H†VFW")H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢v2çW6‚‚s²F†RÆ"6öÇWF–öç2(	BæF—fR’6Æ–6W"r“°¢v2çW6‚†²Gµ2ææÖWÒÂG¶ÖöFVÄæÖWÒÂG¶ÖDæÖWÒÂ&÷V–ÆÆ¢G¶æ÷¤GÖÖÒ6¢G·æÆ–W$†V–v‡GÖÖÒ&VÆÆVæó¢G·æ–æf–ÆÅ7GÒV“°¢–b‡ç7W÷'G2–v2çW6‚‚s²6÷÷'FW27F—fF÷2(	B6öÇVÖæ2Vâ&V¦–ÆÆ&¦òföÆF—¦÷2†,:6–6÷2Â&WF—&"Öæò’r“°¢òòrÖ6öFRFR–æ–6–ó¢ÆçF–ÆÆ÷"–×&W6÷&„¶Æ—W"$”åEõ5D%BòÖ&Æ–â’ò6V7VVæ6–÷"FVfV7Fğ¢6öç7Böv5f'3×¶æ÷§¦ÆS§ææ÷§¦ÆUFV×Æ&VC§æ&VEFV×Æ66VÃ§æ66VÇÇÃÆfÆ÷s¤ÖF‚ç&÷VæB‡æfÆ÷u&F–÷ÇÃ’Ç¢‚·ç&W77W&TGfæ6WÇÃ’çFôf—†VBƒB’Æf—'7EöÆ–W%ö†V–v‡C§æf—'7DÆ–W$†V–v‡BÆÖFW&–Ã¦ÖDæÖRÆÖöFVÃ¦ÖöFVÄæÖWÓ°¢6öç7B÷7F'EGÃÒ†Æö6Å7F÷&vRævWD—FVÒ‚w6Å÷7F'Fv6öFUòr¶ÖöFVÄæÖR—ÇÂrr’çG&–Ò‚“°¢6öç7BöÆ–W%GÃÒ†Æö6Å7F÷&vRævWD—FVÒ‚w6ÅöÆ–W&v6öFUòr¶ÖöFVÄæÖR—ÇÂrr’çG&–Ò‚“°¢–b…÷7F'EGÂ•÷7V"…÷7F'EGÂÅöv5f'2’ç7Æ—B‚uÆâr’æf÷$V6‚†ÃÓæv2çW6‚†Â’“°¢VÇ6W¶v2çW6‚‚tÓC2r·æ&VEFV×“¶v2çW6‚‚tÓB2r·ææ÷§¦ÆUFV×“¶v2çW6‚‚ts#‚r“¶v2çW6‚‚tÓ“2r·æ&VEFV×“¶v2çW6‚‚tÓ’2r·ææ÷§¦ÆUFV×“·Ğ¢v2çW6‚‚ts#²ÖÒr“¶v2çW6‚‚ts“²'6öÇWFò…•¢r“¶v2çW6‚‚tÓƒ"²R'6öÇWFòr“¶v2çW6‚‚ts“"Sr“°¢–b‡æ66VÃã–v2çW6‚‚tÓ#B2r·æ66VÂ²r²6VÆW&6œ;6âr“°¢–b‡æ¦W&³ã–v2çW6‚‚tÓ#R‚r²‚·æ¦W&²’çFôf—†VBƒ’²r’r²‚·æ¦W&²’çFôf—†VBƒ’²r²¦W&²„Ö&Æ–â’r“°¢–b‡æfÆ÷u&F–òbdÖF‚ç&÷VæB‡æfÆ÷u&F–ò’ÓÓ–v2çW6‚‚tÓ##2r´ÖF‚ç&÷VæB‡æfÆ÷u&F–ò’²r²fÇV¦òRr“°¢–b‡ç&W77W&TGfæ6Sã–v2çW6‚‚u4UEõ$U55U$UôEdä4REdä4SÒr²‚·ç&W77W&TGfæ6R’çFôf—†VBƒB’²r²&W77W&RGfæ6R„¶Æ—W"’r“°¢òòÌ:ÖæVFRW&v¢6öç7BW&vU“ÓRÇW&vU“ÔÖF‚æÖ–â‡7V2ç’ÓRÃSR“°¢v2çW6‚†s¢G·æf—'7DÆ–W$†V–v‡BçFôf—†VBƒ2—Òcc“¶v2çW6‚†sƒ2’G·W&vU“Òc3“°¢R³Ò‡W&vU“×W&vU“’¦W‡Er§æf—'7DÆ–W$†V–v‡Bôd”Äô$T°¢v2çW6‚†sƒ2’G·W&vU“ÒRG´RçFôf—†VBƒB—ÒbG·æf—'7DÆ–W%7VVB£cÖ“°¢v2çW6‚‚ts“"Sr“´SÓ¶v2çW6‚‚ts£"c“r“°¢v2çW6‚‚s²ÃÃÄ$ôE•õ5D%Cããâr“²òòÖ&6F÷"&–×&W6œ;6â6V7VVæ6–Â‡6W&",;6Æövòö7VW'òöW:ÖÆövò¢òò)H)H8ÖæF–6RFRG&œ:æwVÆ÷2÷&FVæFò÷"¦Ö–â‡7vVWÆ–æR’(	B6öç7G'V–FòVæ6öÆfW¢)H)H)H ¢6öç7B¤ÖƒÕ2ç7FG2æG£°¢6öç7BG&”6çC×G&—2æÆVæwF‚ó“°¢6öç7BG&•¦Ö–ãÖæWrfÆöC3$'&’‡G&”6çB’ÇG&•¦ÖƒÖæWrfÆöC3$'&’‡G&”6çB“°¢f÷"†ÆWB“Ó¶“ÇG&”6çC¶’²²—°¢6öç7B#Ö’£’Ç£×G&—5¶"³%ÒÇ£×G&—5¶"³UÒÇ£#×G&—5¶"³…Ó°¢G&•¦Ö–å¶•ÓÔÖF‚æÖ–â‡£Ç£Ç£"“·G&•¦Ö…¶•ÓÔÖF‚æÖ‚‡£Ç£Ç£"“°¢Ğ¢6öç7B6÷'FVD–GƒÔ'&’æg&öÒ‡¶ÆVæwFƒ§G&”6çGÒÂ…òÆ’“Óæ’’ç6÷'B‚†Æ"“ÓçG&•¦Ö–å¶Ò×G&•¦Ö–å¶%Ò“°¢6öç7B6Æ–6U£Ò‡¢“Óå÷6Æ–6T–G‚‡G&—2Ç6÷'FVD–G‚ÇG&•¦Ö–âÇG&•¦Ö‚Ç¢“°¢òò)H)H6Æ7VÆ"ÇGW&2FR6†f–¦2òFFF—f2Â&WWF–Æ—¦æFòVÂÖ—6Öò:ÖæF–6R’)H)H ¢ÆWBÆ‡3°¢–b‡æFF—fTÆ–W$†V–v‡B—°¢6WE&örƒ"ãRÂt6Æ7VÆæFòÇGW&2FR6FFF—f>(
br“¶v—BæWr&öÖ—6R‡#Óç6WEF–ÖV÷WB‡"Ã’“°¢Æ‡3Öv—Bö'V–ÆDFF—fTÆ–W'2‡6Æ–6U¢ÇÇ¤Ö‚“°¢ÖVÇ6W°¢Æ‡3Õ·æf—'7DÆ–W$†V–v‡EÓ¶ÆWB¥7VÓ×æf—'7DÆ–W$†V–v‡C°¢v†–ÆR‡¥7VÓÇ¤Ö‚Óã—¶6öç7BÆƒÔÖF‚æÖ–â‡æÆ–W$†V–v‡BÇ¤Ö‚×¥7VÒ“¶–b†ÆƒÇæÆ–W$†V–v‡B£ãR–'&V³¶Æ‡2çW6‚†Æ‚“·¥7VÒ³ÖÆƒ·Ğ¢Ğ¢6öç7BF÷FÄÃÖÆ‡2æÆVæwFƒ°¢6WE&örƒ2ÆG·F÷FÄÇÒ62&G·¤Ö‚çFôf—†VBƒ—ÖÖÒG·æFF—fTÆ–W$†V–v‡Còr†FFF—f2’s¢rwŞ(
f“°¢v—BæWr&öÖ—6R‡#Óç6WEF–ÖV÷WB‡"Ã’“°¢òò)H)H&V6ö×WF"6öçF÷&æ÷2÷"6‡7vVW7F—fó¢ò‡G&œ:æwVÆ÷2VR7'W¦â’÷"6Âæòò‡FöF÷2’’)H)H ¢òò6RV¦V7WFVâVâvV"v÷&¶W"…T’fÇV–F“²6’æò†’6÷÷'FR6RÂ†–Æò&–æ6—Â6öâ&W7VÇFFò–L:–çF–6òà¢6öç7B÷&SÖv—B÷&V6ö×WFTÆ–W'2‡G&—2Ç6÷'FVD–G‚ÇG&•¦Ö–âÇG&•¦Ö‚ÆÆ‡2ÇF÷FÄÂÀ¢cÓç6WE&örƒ2¶b£ãRÆ6Æ7VÆæFò6öçF÷&æ÷>(
bG´ÖF‚ç&÷VæB†b£—ÒV’“°¢6öç7BÆ–W%F÷£Õ÷&RæÆ–W%F÷¢ÆÆ–W%öÇ—3Õ÷&RæÆ–W%öÇ—2ÆÆ–W%&—G“Õ÷&RæÆ–W%&—G’ÆÆ–W$æWD&VÕ÷&RæÆ–W$æWD&VÆÆ–W$$#Õ÷&RæÆ–W$$#°¢òò)H)H§W7FW2÷"–W¦¢Ö‡‚Ç’(i&ö&¦WFò’÷fW'&–FW2FR&VÆÆVæò÷W,:ÖÖWG&÷2÷6÷÷'FR)H)H ¢6öç7Böö&¤$'3Õ2æö&¤$'7ÇÅµÒÅöö&¥6WCÕ2æö&¥6WGF–æw7ÇÅµÓ°¢6öç7Bö†4ö&¥6WCÕöö&¤$'2æÆVæwFƒãbeöö&¥6WBç6öÖR‡3Óç2bb‚‡2æ–æf–ÆÅ7BÓÒrrbg2æ–æf–ÆÅ7BÖçVÆÂ—ÇÇ2æ–æf–ÆÅG—WÇÂ‡2ç6†VÆÇ2ÓÒrrbg2ç6†VÆÇ2ÖçVÆÂ—ÇÇ2ç7W÷'G2’“°¢6öç7Böö&¤–GƒÒ‡‚Ç’“Óç¶f÷"†ÆWB“Ó¶“Åöö&¤$'2æÆVæwFƒ¶’²²—¶6öç7B#Õöö&¤$'5¶•Ó¶–b‡ƒãÖ"çƒÓbgƒÃÖ"çƒ³bg“ãÖ"ç“Óbg“ÃÖ"ç“³—&WGW&â“·×&WGW&âÓ·Ó°¢6öç7Böö&¥&×3Ò†&6RÆö’“Óç¶6öç7B3Õöö&¥6WE¶ö•Ó¶–b‚2—&WGW&â&6S¶6öç7BóÔö&¦V7Bæ76–vâ‡·ÒÆ&6R“¶6öç7B6ÃÒ‡bÆÆ"“ÓäÖF‚æÖ‚†ÄÖF‚æÖ–â†"ÄÖF‚ç&÷VæB‚·b’’“¶–b‡2æ–æf–ÆÅ7BÓÒrrbg2æ–æf–ÆÅ7BÖçVÆÂ–òæ–æf–ÆÅ7CÖ6Â‡2æ–æf–ÆÅ7BÃÃ“¶–b‡2æ–æf–ÆÅG—R–òæ–æf–ÆÅG—S×2æ–æf–ÆÅG—S¶–b‡2ç6†VÆÇ2ÓÒrrbg2ç6†VÆÇ2ÖçVÆÂ–òç6†VÆÇ3Ö6Â‡2ç6†VÆÇ2ÃÃ‚“·&WGW&âó·Ó°¢6öç7Böö&¥7WöfcÒ‡‚Ç’“Óåö†4ö&¥6WBbb‚‡2“Óç2bg2ç7W÷'G3ÓÓÒvæòr’…öö&¥6WEµöö&¤–G‚‡‚Ç’•Ò“°¢6öç7Böö&¥7WöãÒ‡‚Ç’“Óâ‚‡2“Óç2bg2ç7W÷'G3ÓÓÒw<:Òr’…öö&¥6WEµöö&¤–G‚‡‚Ç’•Ò“°¢6öç7Bö†4ö&¥7WöãÕöö&¤$'2æÆVæwFƒãbeöö&¥6WBç6öÖR‡3Óç2bg2ç7W÷'G3ÓÓÒw<:Òr“°¢òò)H)H6÷÷'FW3¢6öÇVÖæ2&¦òföÆF—¦÷2‡&V¦–ÆÆò:&&öÂ’)H)H ¢ÆWB7W6öÇ3ÖçVÆÂÇ7WG&VW3ÖçVÆÃ¶6öç7B5Uôu3×ç7Ww&–GÇÃ3°¢6öç7BvÆ–W'3ÔÖF‚æÖ‚ƒÄÖF‚ç&÷VæB‚‡ç7W¤vÇÃ’÷æÆ–W$†V–v‡B’“²òò6W&6œ;6âFR—&R†62’VçG&R6÷÷'FR’–W¦¢6öç7B–f6TÆ–W'3ÔÖF‚æÖ‚ƒÄÖF‚ç&÷VæB‡ç7W–çFW&f6RÖçVÆÃ÷ç7W–çFW&f6S£"’“²òò62FR–çFW&f¢FVç6§W7Fò&¦òÆ–W¦¢6öç7Bö†4Væf÷&6SÒ…2ç7W&Vv–öç7ÇÅµÒ’ç6öÖR‡#Óç"æÖöFSÓÓÒvVæf÷&6Rr“°¢–b‡ç7W÷'G7ÇÅö†4Væf÷&6WÇÅö†4ö&¥7Wöâ—°¢6WE&örƒ2ãRÂt6Æ7VÆæFò6÷÷'FW>(
br“¶v—BæWr&öÖ—6R‡#Óç6WEF–ÖV÷WB‡"Ã’“°¢6öç7BGƒÕ2ç7FG2æG‚ÆG“Õ2ç7FG2æG’ÆÖ–å£ÔÖF‚æÖ‚ƒã‚ÆÆ‡5³Ò³ãB’Æ6öÇ3ÕµÓ°¢òò+ô†’ÖFW&–Â<;6Æ–FòVâ‡‚Ç’’VâÆ6Æ“ò&VvÆ"Ö–×"(i"Æ÷2wV¦W&÷27VVçFâ6öÖò—&Rà¢6öç7B†—CÒ‡‚Ç’ÆÆ’“Óç¶6öç7B3ÖÆ–W%öÇ—5¶Æ•ÒÆ&'3ÖÆ–W$$%¶Æ•Ó¶ÆWB–ç6–FSÖfÇ6S¶f÷"†ÆWB³Ó¶³Ç2æÆVæwFƒ¶²²²—¶6öç7B#Ö&'5¶µÓ¶–b‡ƒÆ%³×ÇÇƒæ%³%×ÇÇ“Æ%³×ÇÇ“æ%³5Ò–6öçF–çVS¶–b…÷ö–çD–åöÇ’‡‚Ç’Ç5¶µÒ’––ç6–FSÒ–ç6–FS·×&WGW&â–ç6–FS·Ó°¢òò&Vv–öæW2FR6÷÷'FR†÷6–öæÂ“¢&Æ÷VV"òf÷'¦"6÷÷'FRVâ6¦2…œ+u¢â6–â&Vv–öæW2(i"6–âVfV7Fòà¢6öç7B&Vw3Õ2ç7W&Vv–öç7ÇÅµÓ°¢6öç7B–å&Vu…“Ò‡"Ç‚Ç’“ÓçƒãÔÖF‚æÖ–â‡"çƒÇ"çƒ’bgƒÃÔÖF‚æÖ‚‡"çƒÇ"çƒ’bg“ãÔÖF‚æÖ–â‡"ç“Ç"ç“’bg“ÃÔÖF‚æÖ‚‡"ç“Ç"ç““°¢6öç7B–å&Vu£Ò‡"Ç¢“Óç£ã×"ç¤Ö–âÓRÓbbg£Ã×"ç¤Ö‚³RÓc°¢6öç7B&Æö6¶VCÒ‡‚Ç’Ç¢“Óç&Vw2ç6öÖR‡#Óç"æÖöFSÓÓÒv&Æö6²rbf–å&Vu…’‡"Ç‚Ç’’bf–å&Vu¢‡"Ç¢’“°¢6öç7BVæf÷&6VCÒ‡‚Ç’Ç¢“Óç&Vw2ç6öÖR‡#Óç"æÖöFSÓÓÒvVæf÷&6Rrbf–å&Vu…’‡"Ç‚Ç’’bf–å&Vu¢‡"Ç¢’“°¢f÷"†ÆWBwƒÒÖG‚ó"µ5Uôu2ó#¶wƒÆG‚ó#¶w‚³Õ5Uôu2–f÷"†ÆWBw“ÒÖG’ó"µ5Uôu2ó#¶w“ÆG’ó#¶w’³Õ5Uôu2—°¢òò&W6Væ6–FRÖFW&–Â÷"6VâW7F6öÇVÖæ‡Væ6öÆ6F¢6öç7B6öÃÖæWr'&’‡F÷FÄÂ“°¢f÷"†ÆWBÆ“Ó¶Æ“ÇF÷FÄÃ¶Æ’²²—6öÅ¶Æ•ÓÖ†—B†w‚Æw’ÆÆ’“°¢òòFWFV7F"DôDõ2Æ÷2föÆF—¦÷2FRÆ6öÇVÖæ¢ÖFW&–ÂVâÆ’6öâ—&R§W7FòFV&¦ò†Æ’Ó’à¢òòçFW2<;6Æò6RÖ—&&Æ&–ÖW&66öâÖFW&–Â(i"6RW&L:ÖâföÆF—¦÷26ö'&RÖFW&–Â––×&W6òà¢f÷"†ÆWBÆ“Ó¶Æ“ÇF÷FÄÃ¶Æ’²²—°¢–b‚6öÅ¶Æ•×ÇÇ6öÅ¶Æ’ÓÒ–6öçF–çVS²òò<;6ÆòG&ç6–6–öæW2—&^(i'<;6Æ–Fğ¢6öç7B7£ÖÆ–W%F÷¥¶Æ•Ó°¢–b†7£ÃÖÖ–å¢–6öçF–çVS²òò×W’6W&6FRÆ6ÖÂ6R–×&–ÖRF—&V7Fğ¢–b†&Æö6¶VB†w‚Æw’Æ7¢’–6öçF–çVS²òò&Vvœ;6â&Æ÷VV6÷÷'FR\:Ğ¢òòWFò×6÷÷'FR÷":æwVÆó¢6’Æ6FR&¦òF–VæRÖFW&–Â(šBFöÂƒÒÇGW&+wFâŒ:æwVÆò’’À¢òòVÂföÆF—¦òW27VfR’6R6÷7F–VæR6öÆò(i"æòæV6W6—F6÷÷'FRâ†öç&ç7W÷'DævÆRà¢6öç7BFöÃÔÖF‚æÖ‚ƒãÆÆ‡5¶Æ•Ò¤ÖF‚çFâ‚‡ç7W÷'DævÆWÇÃS’¤ÖF‚å’óƒ’“°¢ÆWB6VÆe7WÖfÇ6S°¢f÷"†ÆWBÓ¶Ã‚bb6VÆe7W¶²²—¶6öç7BãÖ¤ÖF‚å’óC¶–b††—B†w‚·FöÂ¤ÖF‚æ6÷2†â’Æw’·FöÂ¤ÖF‚ç6–â†â’ÆÆ’Ó’—6VÆe7W×G'VS·Ğ¢òò§W7FR÷"–W¦¢Væ–W¦6öâ6÷÷'FRvæòrçVæ6&V6–&S²6öâw<:ÒrgVW'¦6÷÷'FR†6öÖòVæf÷&6R’à¢–b…öö&¥7Wöfb†w‚Æw’’–6öçF–çVS°¢6öç7Böö&¤öãÕöö&¥7Wöâ†w‚Æw’“°¢òò6’VÂ6÷÷'FRvÆö&ÂW7L:7F—fó¢;FR÷":æwVÆò‡6Çfò&Æ÷VVò’²f÷'¦F÷2â6’W7L:vFó¢<;6Æòf÷'¦F÷2à¢6öç7BvçC×ç7W÷'G3ò‚6VÆe7WÇÆVæf÷&6VB†w‚Æw’Æ7¢—ÇÅöö&¤öâ“¢†Væf÷&6VB†w‚Æw’Æ7¢—ÇÅöö&¤öâ“°¢–b‚vçB–6öçF–çVS°¢òò&6RFRÆ6öÇVÖæ¢&¦†7FVÂÖöFVÆòFR&¦ò†FV¦FRöæW"6÷÷'FRŒ:Ò’òÆ6Öà¢ÆWB&÷CÓ°¢f÷"†ÆWB#ÖÆ’Ó#¶#ãÓ¶"ÒÒ—¶–b‡6öÅ¶%Ò—¶&÷CÖ"³¶'&V³·×Ğ¢òò6W&6œ;6âFR—&S¢VÂ6÷÷'FR6RFWF–VæRvÆ–W'6÷"FV&¦òFVÂföÆF—¦ò(i"&WF—&òÆ–×–ğ¢6öç7BF÷ÖÆ’ÓÖvÆ–W'3°¢–b‡F÷Æ&÷B–6öçF–çVS²òòVÂ‡VV6ò6öç7VÖRÆ6öÇVÖæ¢VÂföÆF—¦ò'&–FvV,:6öÆğ¢–b‡ç7WöåÆFRbf&÷Cã–6öçF–çVS²òò'6öÆòFW6FRÆ6Ö#¢FW66'F6÷÷'FW2VRæ6Vâ6ö'&RVÂÖöFVÆğ¢6öÇ2çW6‚‡·ƒ¦w‚Ç“¦w’Æ&÷BÇF÷Æ6öçF7DÆ“¦Æ—Ò“°¢Ğ¢Ğ¢–b†6öÇ2æÆVæwF‚—°¢–b‡çG&VU7W÷'G2—·7WG&VW3Õö'V–ÆEG&VU7W÷'B†6öÇ2Æ†—BÇF÷FÄÂ“¶v2çW6‚†²6÷÷'FW2:&&öÃ¢G·7WG&VW2æÆVæwF‡ÒG&öæ6÷2+rG¶6öÇ2æÆVæwF‡Ò6öçF7F÷2+r6Wå¢G²‡ç7W¤vÇÃ’çFôf—†VBƒ"—ÖÖÒ+rFVç2G·ç7WFVç6—G—ÒV“·Ğ¢VÇ6W·7W6öÇ3Ö6öÇ3¶v2çW6‚†²6÷÷'FW3¢G¶6öÇ2æÆVæwF‡Ò6öÇVÖæ2+r&V¦–ÆÆGµ5Uôu7ÖÖÒ+r6Wå¢G²‡ç7W¤vÇÃ’çFôf—†VBƒ"—ÖÖÖ“·Ğ¢Ğ¢Ğ¢òò)H)HF†W6œ;6ã¢6¶—'Bò'&–Òò&gB†6ÂçFW2FVÂÖöFVÆò’)H)H)H)H)H)H)H)H ¢ÆWB7W%£ÖÆ‡5³ÒÆ5ƒÓ2Æ5“×W&vU“°¢6öç7B$eEôtÓã#RÇ&gD&6TÄƒÓã3°¢6öç7B¤&6S×ç&gCò‡&gD&6TÄ‚¶Æ‡5³Òµ$eEôt“£²òòVÂÖöFVÆò6RVÆWf6ö'&RVÂ&g@¢6öç7BF„&–sÒ‚‚“Óç¶6öç7B3×6Æ–6U¢†Æ‡5³Ò£ãR“·&WGW&â3æÆVæwFƒö3ç6÷'B‚†Æ"“ÓäÖF‚æ'2…÷öÇ”&V†"’’ÔÖF‚æ'2…÷öÇ”&V†’’•³Ó¦çVÆÃ·Ò’‚“°¢–b‡ç&gBbfF„&–r—°¢6öç7BCÕö–ç6WE&r†F„&–rÂÓB“²òòFÖÒFRÖ&vVâÇ&VFVF÷"FRÆ–W¦¢–b‡BbgBæÆVæwFƒãÓ2—°¢v2çW6‚‚uÆã²ÓÓÒ&gB†&6R’ÓÓÒr“¶v2çW6‚†s¢G·&gD&6TÄ‚çFôf—†VBƒ2—Òcc“°¢6öç7B&6TÆ–æW3Õ÷66æf–ÆÄÆÂ…·EÒÆW‡Er£"ãRÃ“°¢´RÆ5‚Æ5•ÓÕ÷&–çDÆ–æW2†v2Æ&6TÆ–æW2Ç&gD&6TÄ‚Æöfe‚Æöfe’Æ5‚Æ5’ÄRÇ&gD&6TÄ‚ÆW‡Er£ãbÄÖF‚ç&÷VæB‡æf—'7DÆ–W%7VVB£ã‚’£cÇ“°¢v2çW6‚‚s²ÓÓÒ&gB†–çFW&f¢’ÓÓÒr“¶v2çW6‚†s¢G²‡&gD&6TÄ‚¶Æ‡5³Ò’çFôf—†VBƒ2—Òcc“°¢6öç7B–f6TÆ–æW3Õ÷66æf–ÆÄÆÂ…·EÒÆW‡Er£ãRÃ““°¢´RÆ5‚Æ5•ÓÕ÷&–çDÆ–æW2†v2Æ–f6TÆ–æW2Ç&gD&6TÄ‚¶Æ‡5³ÒÆöfe‚Æöfe’Æ5‚Æ5’ÄRÆÆ‡5³ÒÆW‡ErÄÖF‚ç&÷VæB‡æf—'7DÆ–W%7VVB’£cÇ“°¢Ğ¢ÖVÇ6W°¢òò6¶—'B†6V&FòFVÂf–ÆÖVçFòÂ6W&FòFRÆ–W¦¢–b‡ç6¶—'CãbfF„&–r—°¢v2çW6‚‚uÆã²ÓÓÒ6¶—'BÓÓÒr“¶v2çW6‚†s¢G¶7W%¢çFôf—†VBƒ2—Òcc“°¢f÷"†ÆWB³Ó¶³Çç6¶—'C¶²²²—¶6öç7B#Õö–ç6WE&r†F„&–rÂÒ‡ç6¶—'Dv²†²³’¦W‡Er’“¶–b‚'ÇÇ"æÆVæwFƒÃ2–'&V³µ´RÆ5‚Æ5•ÓÕ÷&–çEöÇ’†v2Ç"Æ7W%¢Æöfe‚Æöfe’Æ5‚Æ5’ÄRÆÆ‡5³ÒÆW‡ErÇæf—'7DÆ–W%7VVB£cÇ“·Ğ¢Ğ¢òò'&–Ò†F†W6œ;6âVvFÆ–W¦¢–b‡æ'&–ÓãbfF„&–r—°¢v2çW6‚†Æã²ÓÓÒ'&–Ò†6’ÓÓÖ“¶v2çW6‚†s¢G¶7W%¢çFôf—†VBƒ2—Òcc“°¢f÷"†ÆWB#Ó¶#Çæ'&–Ó¶"²²—¶6öç7B÷WFW#Õö–ç6WE&r†F„&–rÂÒ‚‡æ'&–ÔvÇÃ’¶W‡Er¢†"³’’“¶–b‚÷WFW'ÇÆ÷WFW"æÆVæwFƒÃ2–'&V³µ´RÆ5‚Æ5•ÓÕ÷&–çEöÇ’†v2Æ÷WFW"Æ7W%¢Æöfe‚Æöfe’Æ5‚Æ5’ÄRÆÆ‡5³ÒÆW‡ErÇæf—'7DÆ–W%7VVB£cÇ“·Ğ¢Ğ¢Ğ¢òò)H)H62)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢7W%£Ó¶ÆWB÷W6VDE£ÖfÇ6S°¢òò6VÆW&6œ;6â÷"fVGW&S¢VÖ—FRÓ#B<;6ÆòÂ6Ö&–"‡&VBW‡BâÜ:2ÆVçFÂ&VÆÆVæòÜ:2,:–Fò¢6öç7Bt66VÃ×æ66VÇÇÃ¶ÆWBö66VÄ7W#Öt66VÃ°¢6öç7B6WD66VÃ×CÓç¶6öç7BVfc×Cã÷C¦t66VÃ¶–b†VfcãbfVfbÓÕö66VÄ7W"—¶v2çW6‚‚tÓ#B2r´ÖF‚ç&÷VæB†Vfb’“µö66VÄ7W#ÖVfc·×Ó°¢f÷"†ÆWBÆ“Ó¶Æ“ÇF÷FÄÃ¶Æ’²²—°¢6öç7BÆƒÖÆ‡5¶Æ•Ó¶7W%¢³ÖÆƒ¶6öç7B¤÷WCÖ7W%¢·¤&6S²òò¤÷WBÒÇGW&l:×6–6‡7V&R6ö'&RVÂ&gB¢6öç7BSÕöÆ–W%&×2‡Æ7W%¢“²òò,:ÖWG&÷2VfV7F—f÷3¢Æ–6ÖöF–f–6F÷&W2÷"ÇGW&‡SÓÓ×6’æò†’¢6öç7B7CÖÆ“ÓÓÓ÷æf—'7DÆ–W%7VVC§ç7VVC°¢6öç7B÷WFW$cÒ†Æ“ãbgæ÷WFW%7VVCã÷æ÷WFW%7VVC§7B’£c²òòfVÆö6–FB&VBW‡FW&–÷ ¢6öç7B–ææW$cÔÖF‚ç&÷VæB‡7B£ã’’£c°¢òòæ6†÷2FRÌ:ÖæV÷"fVGW&RƒÒWFòÒ&6RW‡Er’â*¢6Ü:2æ6†&F†W&Væ6–à¢6öç7Bt÷WFW#ÖÆ“ÓÓÓöW‡Er£ã¢‡çv–GF„÷WFW#ã÷çv–GF„÷WFW#¦W‡Er“°¢6öç7Bt–ææW#ÖÆ“ÓÓÓöW‡Er£ã¦W‡Es°¢6öç7Bt–æf–ÆÃÖÆ“ÓÓÓöW‡Er£ã¢‡çv–GF„–æf–ÆÃã÷çv–GF„–æf–ÆÃ¦W‡Er“°¢òòföÆF—¦ó¢VçFò6ö'&R—&RVâÆ6FR&¦ò(i"fVÆö6–FB&VGV6–FVâÆ&VBW‡FW&–÷ ¢6öç7Böö#ÖÆ“ãò†Æ–W%öÇ—5¶Æ’Ó×ÇÅµÒ“¥µÒÅöö#$#ÖÆ“ãò†Æ–W$$%¶Æ’Ó×ÇÅµÒ“¥µÓ°¢6öç7Bö…FW7CÒ†Æ“ãbgæ÷fW&†æu7VVCã“ò‚‡‚Ç’“Óâö–å6öÆ–D$"‡‚Ç’Åöö#Åöö#$"’“¦çVÆÃ°¢6öç7Bö„fVVCÒ‡æ÷fW&†æu7VVCã÷æ÷fW&†æu7VVC¤ÖF‚ç&÷VæB‡7B£ãR’’£c°¢–b†Æ“ÓÓÓbgæfå7Cã–v2çW6‚†Ób2G´ÖF‚ç&÷VæB‡æfå7B£"ãSR—Ò²fVçF–ÆF÷&“°¢òòFV×W&GW&w&GVÃ¢&VGV6R\+2SR’+2ƒRFRÇGW&(i"ÖVæ÷27G&–æv–ærVâÆ2627WW&–÷&W0¢–b‡æw&GVÅFV×bfÆ“ãbgææ÷§¦ÆUFV×ãsR—°¢6öç7B7CÖÆ’÷F÷FÄÃ°¢–b„ÖF‚æ'2‡7BÓãR“ÃãR÷F÷FÄÂ³ã–v2çW6‚†ÓB2G´ÖF‚ç&÷VæB‡ææ÷§¦ÆUFV×£ã“sR—Ò²FV×w&GVÂSV“°¢VÇ6R–b„ÖF‚æ'2‡7BÓã‚“ÃãR÷F÷FÄÂ³ã–v2çW6‚†ÓB2G´ÖF‚ç&÷VæB‡ææ÷§¦ÆUFV×£ã“R—Ò²FV×w&GVÂƒV“°¢Ğ¢v2çW6‚‚rr“¶v2çW6‚†²ÓÓÒ6G¶Æ’³ÒòG·F÷FÄÇÒ£ÒG¶7W%¢çFôf—†VBƒ2—ÖÖÒÓÓÖ“°¢òò)H)HÖöFò¦',;6âò7—&Æ—¦S¢&6R<;6Æ–F²W7—&Â6öçF–çVò6–â6÷7GW&)H)H ¢–b‡ç7—&Æ—¦RbbÆ“ã×æ&÷GFöÔÆ–W'2—°¢6öç7B7G'3ÖÆ–W%öÇ—5¶Æ•Ó°¢–b†7G'2æÆVæwF‚—°¢v2çW6‚‚s²7—&Æ—¦R(	BW7—&Æ—¦Fò6öçF–çVòr“°¢òò<;6ÆòVÂ6öçF÷&æòW‡FW&–÷"†Ö–÷":&VÂæòwV¦W&÷2¢6öç7B÷WFW#Ö7G'2æf–ÇFW"‚…òÆ6’“ÓâÆ–W%&—G•¶Æ•Õ¶6•Ò’ç6÷'B‚†Æ"“ÓäÖF‚æ'2…÷öÇ”&V†"’’ÔÖF‚æ'2…÷öÇ”&V†’’•³Ó°¢–b†÷WFW"bf÷WFW"æÆVæwFƒãÓ2—°¢6öç7B¥7F'C×¤÷WBÖÆƒ°¢´RÆ5‚Æ5•ÓÕ÷&–çEöÇ•7—&Å¢†v2Æ÷WFW"Ç¥7F'BÇ¤÷WBÆöfe‚Æöfe’Æ5‚Æ5’ÄRÆÆ‚ÆW‡ErÆ÷WFW$bÇ“°¢Ğ¢Ğ¢–b†Æ’SƒÓÓÓ—·6WE&örƒB¶Æ’÷F÷FÄÂ£“"ÆÆÖ–ææFò6G¶Æ’³ÒòG·F÷FÄÇŞ(
f“¶v—BæWr&öÖ—6R‡#Óç6WEF–ÖV÷WB‡"Ã’“·Ğ¢6öçF–çVS²òòöÖ—F—"&VÆÆVæòÂ6÷÷'FW2Â–æf–ÆÀ¢Ğ¢v2çW6‚†s¢G·¤÷WBçFôf—†VBƒ2—Òcc“°¢òòW6&öw&ÖF÷"ÇGW&†–ç6W'FòFRGVW&6ò6Ö&–òFR6öÆ÷"ÖçVÂ’(	BU4RFR¶Æ—W ¢–b‡çW6TE£ãbb÷W6VDE¢bf7W%£ã×çW6TE¢—µ÷W6VDE£×G'VS¶v2çW6‚†²ÓÓÒU4&öw&ÖF£ÒG²‚·çW6TE¢’çFôf—†VBƒ"—ÖÖÒ†–ç6W'Fòö6Ö&–òFR6öÆ÷"’ÓÓÖ“¶v2çW6‚‚uU4Rr“·Ğ¢6öç7BöÆ–W%7F'D–GƒÖv2æÆVæwFƒ²òò&VÂF–V×òÜ:Öæ–ÖòFR6‡&ÆVçF—¦W‡G'W6œ;6â6’Æ6W2×W’6÷'F¢òòrÖ6öFR÷"6Ö&–òFR6‡F–ÖVÆ6RöÖ7&÷2’(	BÆ6V†öÆFW'2¶Æ–W'Ò·§Ò²Æ÷2FVÂ†VFW ¢–b…öÆ–W%GÂ•÷7V"…öÆ–W%GÂÄö&¦V7Bæ76–vâ‡¶Æ–W#¦Æ’³Ç£§¤÷WBçFôf—†VBƒ2—ÒÅöv5f'2’’ç7Æ—B‚uÆâr’æf÷$V6‚†ÃÓç¶–b†ÂçG&–Ò‚’–v2çW6‚†Â“·Ò“°¢òòçFÆÆçF’Ö6÷'&–VçFR†G&gB6†–VÆB“¢&VB67&–f–6–ÂÇ&VFVF÷"FRÆ–W¦„%2õER¢–b‡æG&gE6†–VÆBbfF„&–r—¶6öç7BG3Õö–ç6WE&r†F„&–rÂÒƒ2¶W‡Er’“¶–b†G2bfG2æÆVæwFƒãÓ2—¶v2çW6‚‚s²G&gB6†–VÆBr“µ´RÆ5‚Æ5•ÓÕ÷&–çEöÇ’†v2ÆG2Ç¤÷WBÆöfe‚Æöfe’Æ5‚Æ5’ÄRÆÆ‚ÆW‡ErÂ†Æ“ÓÓÓ÷æf—'7DÆ–W%7VVC§ç7VVB’£cÇ“·×Ğ¢òò6÷÷'FR†çFW2FVÂÖöFVÆòFRW7F6¢–b‡7W6öÇ2—°¢6öç7B6ÃÕ÷7W÷'DÆ–æW4DÆ–W"‡7W6öÇ2ÆÆ’Å5Uôu2Ç“°¢–b‡6ÂæÆVæwF‚—¶v2çW6‚‚s²6÷÷'FRr“µ´RÆ5‚Æ5•ÓÕ÷&–çDÆ–æW2†v2Ç6ÂÇ¤÷WBÆöfe‚Æöfe’Æ5‚Æ5’ÄRÆÆ‚ÆW‡ErÄÖF‚ç&÷VæB‡7B£ã"’£cÇÇVæFVf–æVBÇG'VR“·Ğ¢Ğ¢–b‡7WG&VW2—°¢6öç7B6ÃÕ÷G&VU7W÷'DDÆ–W"‡7WG&VW2ÆÆ’ÆW‡ErÇ“°¢–b‡6ÂæÆVæwF‚—¶v2çW6‚‚s²6÷÷'FR:&&öÂr“µ´RÆ5‚Æ5•ÓÕ÷&–çDÆ–æW2†v2Ç6ÂÇ¤÷WBÆöfe‚Æöfe’Æ5‚Æ5’ÄRÆÆ‚ÆW‡ErÄÖF‚ç&÷VæB‡7B£ãR’£cÇÇVæFVf–æVBÇG'VR“·Ğ¢Ğ¢òò–çFW&f¢FR6÷÷'FS¢&VÆÆVæòFVç6òVâÆ262§W7Fò&¦òÆ–W¦†f6–Æ—FVÂFW7&VæF–Ö–VçFò¢–b‡7W6öÇ2—°¢6öç7B”u3Õ5Uôu3°¢6öç7B–f46öÇ3×7W6öÇ2æf–ÇFW"†3Óæ2çF÷ãÖÆ’bf2çF÷ÖÆ“Æ–f6TÆ–W'2bf2æ&÷CÃÖÆ’“°¢–b†–f46öÇ2æÆVæwF‚—°¢6öç7B&÷w3ÖæWrÖ‚“°¢f÷"†6öç7B2öb–f46öÇ2—¶6öç7B·“ÔÖF‚ç&÷VæB†2ç’ô”u2“²‡&÷w2ævWB†·’—ÇÇ&÷w2ç6WB†·’ÅµÒ’ævWB†·’’’çW6‚†2“·Ğ¢6öç7B–f4Æ–æW3ÕµÓ°¢f÷"†6öç7B'"öb&÷w2çfÇVW2‚’—°¢'"ç6÷'B‚†Æ"“Óæç‚Ö"ç‚“°¢6öç7BƒÖ'%³Òç‚Ô”u2ó"ÇƒÖ'%¶'"æÆVæwF‚ÓÒç‚´”u2ó"Æ7“Ö'%³Òç“°¢f÷"†ÆWBƒ×ƒ¶W‡Eró#·ƒÇƒ·‚³ÖW‡Er£ãR––f4Æ–æW2çW6‚…µ·‚Æ7’Ô”u2ó%ÒÅ·‚Æ7’´”u2ó%ÕÒ“°¢Ğ¢–b†–f4Æ–æW2æÆVæwF‚—¶v2çW6‚‚s²–çFW&f¢6÷÷'FR†FVç6’r“µ´RÆ5‚Æ5•ÓÕ÷&–çDÆ–æW2†v2Æ–f4Æ–æW2Ç¤÷WBÆöfe‚Æöfe’Æ5‚Æ5’ÄRÆÆ‚ÆW‡ErÄÖF‚ç&÷VæB‡7B£ãsR’£cÇÇVæFVf–æVBÇG'VR“·Ğ¢Ğ¢Ğ¢6öç7B6öçF÷W'3ÖÆ–W%öÇ—5¶Æ•Ó°¢–b‚6öçF÷W'2æÆVæwF‚–6öçF–çVS°¢6öç7B&—G“ÖÆ–W%&—G•¶Æ•Ó²òòG'VRÒwV¦W&ò†æ–FÖ–VçFò–×"’(	B&V6Æ7VÆFğ¢òò6ö×Vç66œ;6âF–ÖVç6–öæÃ¢–RFRVÆVfçFR‡<;6Æò6’²W‡ç6œ;6â…’Væ–f÷&ÖP¢ÆWB6ö×Ò‡ç‡”6ö×Vç6F–öçÇÃ’Ò‚†Æ“ÓÓÓbgæVÆW†çDfö÷Cã“÷æVÆW†çDfö÷C£“°¢ÆWB&6T3Ö6öçF÷W'3°¢–b„ÖF‚æ'2†6ö×“ãã—°¢&6T3Ö6öçF÷W'2æÖ‚†7BÆ6’“Óç¶6öç7Böfc×&—G•¶6•Óö6ö×¢Ö6ö×¶6öç7B#Õö–ç6WE&r†7BÆöfb“·&WGW&â‡"bg"æÆVæwFƒãÓ2“÷#¦7C·Ò“°¢Ğ¢òòw'W"6öçF÷&æ÷2÷"–W¦†§W7FW2÷"–W¦“²6–â§W7FW2(i"Vâ6öÆòw'WòÒ6ö×÷'FÖ–VçFò–L:–çF–6ğ¢ÆWBöw'3°¢–b…ö†4ö&¥6WB—¶6öç7BvÓÖæWrÖ‚“¶f÷"†ÆWBö6“Óµö6“Æ&6T2æÆVæwFƒµö6’²²—¶6öç7Bö7CÖ&6T5µö6•Ó¶–b…ö7BæÆVæwFƒÃ2–6öçF–çVS¶ÆWB÷7ƒÓÅ÷7“Ó¶f÷"†6öç7B÷Böbö7B—µ÷7‚³Õ÷E³Óµ÷7’³Õ÷E³Ó·Ö6öç7Böö“Õöö&¤–G‚…÷7‚õö7BæÆVæwF‚Å÷7’õö7BæÆVæwF‚“²†vÒævWB…öö’—ÇÆvÒç6WB…öö’ÅµÒ’ævWB…öö’’’çW6‚…ö6’“·Õöw'3Õ²ââævÒæVçG&–W2‚•ÒæÖ‚…¶ö’Æ6—5Ò“Óâ‡¶ö’Æ6—7Ò’“·Ğ¢VÇ6Röw'3Õ·¶ö“¢ÓÆ6—3¦&6T2æÖ‚…òÆ’“Óæ’—ÕÓ°¢f÷"†6öç7Böw'öböw'2—°¢6öç7BVóÕö†4ö&¥6WCõöö&¥&×2‡RÅöw'æö’“§S°¢òò&VFW2÷"6öçF÷&æó¢W‡FW&–÷"7&V6R†6–FVçG&òÂwV¦W&ò7&V6R†6–gVW&†Ü:2ÖFW&–ÂÇ&VFVF÷"¢6öç7Bf–ÆÄÆö÷3ÕµÒÆvÆö÷3ÕµÓ°¢òò÷&FVâFR—6Æ2÷"&÷†–Ö–FB†w&VVG’äâFW6FRÆ÷6–6œ;6âFVÂ6&W¦Â’(i"ÖVæ÷0¢òòf–¦W2VçG&R6öçF÷&æ÷26W&F÷2‡&VFW2’â6öâVæ6öÆ—6ÆÒ÷&FVâçFW&–÷"à¢6öç7B÷&VÓÖæWr6WB…öw'æ6—2æf–ÇFW"…ö6“Óæ&6T5µö6•Òbf&6T5µö6•ÒæÆVæwFƒãÓ2’“°¢6öç7Bö6VçCÖæWrÖ‚“°¢f÷"†6öç7Bö6’öb÷&VÒ—¶6öç7Bö7CÖ&6T5µö6•Ó¶ÆWB÷7ƒÓÅ÷7“Ó¶f÷"†6öç7B÷Böbö7B—µ÷7‚³Õ÷E³Óµ÷7’³Õ÷E³Ó·Õö6VçBç6WB…ö6’Åµ÷7‚õö7BæÆVæwF‚¶öfe‚Å÷7’õö7BæÆVæwF‚¶öfe•Ò“·Ğ¢v†–ÆR…÷&VÒç6—¦R—°¢ÆWB6“ÖçVÆÂÅö&CÔ–æf–æ—G“¶f÷"†6öç7Bö²öb÷&VÒ—¶6öç7Bö3Õö6VçBævWB…ö²“¶6öç7BöCÒ…ö5³ÒÖ5‚’¢…ö5³ÒÖ5‚’²…ö5³ÒÖ5’’¢…ö5³ÒÖ5’“¶–b…öCÅö&B—µö&CÕöC¶6“Õö³·×Ğ¢÷&VÒæFVÆWFR†6’“°¢6öç7B7CÖ&6T5¶6•Ó¶–b†7BæÆVæwFƒÃ2–6öçF–çVS°¢6öç7B†öÆS×&—G•¶6•Ó°¢6öç7B6†VÆÇ3Õ¶7EÓ°¢f÷"†ÆWB3Ó·3ÇVòç6†VÆÇ3·2²²—°¢6öç7B–ç3Ö†öÆSõö–ç6WE&r‡6†VÆÇ5·2ÓÒÂÖW‡Er“¥ö–ç6WB‡6†VÆÇ5·2ÓÒÆW‡Er“°¢–b†–ç2bf–ç2æÆVæwFƒãÓ2—6†VÆÇ2çW6‚†–ç2“¶VÇ6R'&V³°¢Ğ¢6öç7B–G‡3Õ²ââç6†VÆÇ2æ¶W—2‚•Ó¶–b‡æ÷WFW%vÆÄÆ7B––G‡2ç&WfW'6R‚“²òò&VBW‡FW&–÷"Âf–æÂ(i"ÖV¦÷"6&Fğ¢6öç7B÷66&cÒ‡ç6VÕ66&bbfÆ“ã“ò‡ç66&dÆVçÇÃR“£°¢f÷"†6öç7B2öb–G‡2—°¢v2çW6‚‡3ÓÓÓòs²&VBW‡FW&–÷"s¢s²&VB–çFW&–÷"r“°¢6WD66VÂ‡3ÓÓÓ÷æ66VÄ÷WFW#£“°¢´RÆ5‚Æ5•ÓÕ÷&–çEöÇ’†v2Ç6†VÆÇ5·5ÒÇ¤÷WBÆöfe‚Æöfe’Æ5‚Æ5’ÄRÆÆ‚Ç3ÓÓÓ÷t÷WFW#§t–ææW"Ç3ÓÓÓö÷WFW$c¦–ææW$bÇÂ‡ægW§§”ÆÇÇÇ3ÓÓÓ’bfÆ“ãÇ3ÓÓÓöö…FW7C¦çVÆÂÆö„fVVBÇ3ÓÓÓõ÷66&c£“°¢Ğ¢f–ÆÄÆö÷2çW6‚‡6†VÆÇ5·6†VÆÇ2æÆVæwF‚ÓÒ“°¢òòvf–ÆÃ¢&VBf–æFöæFRæò7W–W&öâ"W,:ÖÖWG&÷2(i"6÷&L;6â6Ú±î¸Â¸­yêë¢°k¢G§¦*^entral sÃ³lido para no dejar hueco
        if(p.gapFill&&peo.shells>=2&&shells.length<2&&!hole)gapLoops.push(ct);
        // Arachne: si la pared es mÃ¡s delgada que 2Ã—extW, rellenar con una pared central de ancho variable
        if(p.arachne&&!hole&&peo.shells>=2&&shells.length===1){
          const inner=_insetRaw(ct,extW);
          if(inner&&inner.length>=3){
            // El inset cabe â†’ la pared es â‰¥ extW pero falta la segunda pared
            // Estimamos el ancho real: promedio de las distancias entre shell[0] y shell[1] serÃ­a el gap
            // Aproximamos con inset al 50% â†’ lÃ­nea central con E al 75%
            const center=_insetRaw(ct,extW*0.75);
            if(center&&center.length>=3){
              [E,cX,cY]=_printPolyScaled(gc,center,zOut,offX,offY,cX,cY,E,lh,extW,0.5,innerF,p);
            }
          }
        }
      }
      // â”€â”€ Relleno con detecciÃ³n de superficies por regiÃ³n (even-odd excluye agujeros) â”€â”€
      if(fillLoops.length){
        setAccel(p.accelInfill); // aceleraciÃ³n de relleno (si estÃ¡ configurada)
        const solidFeed=(li>0&&p.infillSpeed>0?p.infillSpeed:Math.round(spd*1.1))*60,solidAngle=li%2?135:45,COMB=Math.max(extW*3,2);
        // Solape rellenoâ†”pared: expande los lazos de relleno hacia la pared â†’ sin hueco entre relleno y perÃ­metro
        const _ovl=extW*((p.infillOverlap||0)/100);
        const infLoops=_ovl>0.001?fillLoops.map(l=>{const r=_insetRaw(l,-_ovl);return(r&&r.length>=3)?r:l;}):fillLoops;
        const aLi=layerNetArea[li],aTop=layerNetArea[li+peo.topLayers],aBot=layerNetArea[li-peo.bottomLayers];
        // Â¿Hay alguna cara expuesta? SÃ³lo si arriba/abajo (N capas) la secciÃ³n encoge (o no existe = global)
        // Lightning siempre usa el camino muestreado: necesita escanear hacia arriba para hallar techos.
        const exposed=(peo.infillType==='lightning')||(aTop===undefined||aTop<aLi*0.98)||(aBot===undefined||aBot<aLi*0.98);
        if(!exposed){
          // Interior macizo prismÃ¡tico â†’ sÃ³lo relleno disperso (camino rÃ¡pido, sin muestreo)
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
          // 1) Superficies sÃ³lidas (top/bottom) que no son puente
          const surf=_clipLines(_scanfillAll(infLoops,extW*1.02,solidAngle,p.monotonic),(x,y)=>isSurf(x,y)&&!isBridge(x,y),extW);
          if(surf.length){gc.push('; superficie');[E,cX,cY]=_printLines(gc,surf,zOut,offX,offY,cX,cY,E,lh,wInfill,solidFeed,p,COMB,true);}
          // 2) Puentes (cara inferior sobre aire) â€” sÃ³lido, lento, ventilador mÃ¡ximo, orientado al vano
          if(p.bridgeDetect){
            const bAng=_bridgeInfoMulti(fillLoops,below1).angle;
            const br=_clipLines(_scanfillAll(fillLoops,extW*1.02,bAng),(x,y)=>isBridge(x,y),extW);
            if(br.length){
              gc.push('; puente (bridge) â€” relleno sÃ³lido orientado al vano');
              if(p.fanPct<100)gc.push('M106 S255 ; ventilador mÃ¡x para puente');
              [E,cX,cY]=_printLines(gc,br,zOut,offX,offY,cX,cY,E,lh,extW*((p.bridgeFlow||100)/100),Math.max(15,Math.min(30,Math.round(spd*0.6)))*60,p,COMB);
              if(p.fanPct<100)gc.push(`M106 S${Math.round(p.fanPct*2.55)} ; restaurar ventilador`);
            }
          }
          // 3) Relleno disperso en el interior (ni superficie)
          if(peo.infillType==='lightning'){
            // Lightning: estructura mÃ­nima tipo Ã¡rbol â€” sÃ³lo soporta techos dentro del alcance vertical,
            // dejando el resto del interior hueco. Gran ahorro de material y tiempo.
            const reach=Math.max(4,peo.topLayers+3);
            const isAirAt=(x,y,L)=>{const pp=layerPolys[L];if(!pp||!pp.length)return true;return !_inSolidBB(x,y,pp,layerBB[L]);};
            const needsLight=(x,y)=>{
              if(isSurf(x,y))return false;
              for(let d=1;d<=reach;d++){const L=li+d;if(L>=totalL)return false;if(isAirAt(x,y,L))return true;}
              return false; // techo lejano â†’ sin relleno (ahorro)
            };
            const lspac=Math.max(extW*2,extW/Math.max(0.05,peo.infillPct/100)*1.4);
            const sp=_clipLines(_scanfillAll(infLoops,lspac,li%2?135:45),needsLight,extW);
            if(sp.length){gc.push('; lightning infill (Ã¡rbol mÃ­nimo)');[E,cX,cY]=_printLines(gc,sp,zOut,offX,offY,cX,cY,E,lh,extW,solidFeed,p,COMB,true);}
          }else if(peo.infillType==='adaptive'&&peo.infillPct>0){
            // Relleno adaptativo: base disperso cÃºbico en todo el interior + pasada extra densa cerca de los techos
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
        // Gap fill: cordÃ³n central en paredes finas (un sÃ³lo paso de scanline â‰ˆ lÃ­nea central)
        if(gapLoops.length){
          const gl=_scanfillAll(gapLoops,extW,solidAngle);
          if(gl.length){gc.push('; gap-fill');[E,cX,cY]=_printLines(gc,gl,zOut,offX,offY,cX,cY,E,lh,extW,Math.round(spd*0.8)*60,p,COMB,true);}
        }
        // Ironing: plancha TODAS las caras top-expuestas (no sÃ³lo la Ãºltima capa)
        if(p.ironing){
          const above1=layerPolys[li+1]||[],above1BB=layerBB[li+1]||[];
          const ir=_clipLines(_scanfillAll(fillLoops,extW*0.5,li%2?45:135),(x,y)=>!_inSolidBB(x,y,above1,above1BB),extW*0.5);
          if(ir.length){gc.push('; ironing');[E,cX,cY]=_printLines(gc,ir,zOut,offX,offY,cX,cY,E,lh*((p.ironingFlow||12)/100),extW,Math.round(Math.min(spd,40))*60,p,COMB);}
        }
      }
      } // fin loop por pieza (ajustes por pieza)
      // Tiempo mÃ­nimo de capa: ralentiza la extrusiÃ³n de esta capa si imprime muy rÃ¡pido (enfrÃ­a mejor)
      if(li>0&&p.minLayerTime>0){
        const cooled=_applyMinLayerTime(gc,_layerStartIdx,p.minLayerTime);
        if(cooled&&(p.fanPct||0)<100){gc.splice(_layerStartIdx,0,'M106 S255 ; enfriamiento â€” capa corta');gc.push(`M106 S${Math.round((p.fanPct||0)*2.55)} ; restaurar ventilador`);}
      }
      if(li%8===0){setProg(4+li/totalL*92,`Laminando capa ${li+1}/${totalL}â€¦`);await new Promise(r=>setTimeout(r,0));}
    }
    gc.push('; <<<BODY_END>>>'); // marcador fin de cuerpo (impresiÃ³n secuencial)
    // â”€â”€ Footer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const _endTpl=(localStorage.getItem('sl_endgcode_'+modelName)||'').trim();
    if(_endTpl){
      gc.push('');
      if(p.retractDist>0)gc.push(`G1 E${(E-p.retractDist).toFixed(4)} F${p.retractSpeed*60} ; retracciÃ³n final (anti-ooze)`);
      _sub(_endTpl,_gcVars).split('\n').forEach(l=>gc.push(l));
    }else{
      gc.push('\nM107');gc.push('M104 S0');gc.push('M140 S0');
      if(p.retractDist>0)gc.push(`G1 E${(E-p.retractDist).toFixed(4)} F${p.retractSpeed*60} ; retracciÃ³n final (anti-ooze)`);
      gc.push('G92 E0');gc.push('G91');gc.push('G1 Z5 F900');gc.push('G90');
      gc.push(`G1 X0 Y${(spec.y-10).toFixed(0)} F3000`);gc.push('M84');
    }
    return gc.join('\n');
  }
  // VersiÃ³n de _inset sin validaciÃ³n de Ã¡rea (para expansiones del brim)
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
  // Desplaza X/Y de una lÃ­nea G0/G1 (para reposicionar el cuerpo de una pieza en impresiÃ³n secuencial)
  function _shiftXY(ln,shX,shY){
    if(ln.charCodeAt(0)!==71||!(ln.startsWith('G1 ')||ln.startsWith('G0 ')))return ln;
    return ln.replace(/X(-?[\d.]+)/,(m,v)=>'X'+(+v+shX).toFixed(3)).replace(/Y(-?[\d.]+)/,(m,v)=>'Y'+(+v+shY).toFixed(3));
  }
  // ImpresiÃ³n secuencial: lamina cada pieza por separado y la imprime completa antes de la siguiente.
  // Seguridad: sube a Z libre sobre lo ya impreso antes de viajar a la pieza siguiente; aborta si no caben con separaciÃ³n.
  async function _sliceSequential(p,spec,nozD,matName,model){
    const objs=S.objects,CLR=18; // separaciÃ³n generosa entre piezas (clearance del cabezal)
    const items=objs.map((t)=>{let mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9,mxz=-1e9;for(let i=0;i<t.length;i+=3){if(t[i]<mnx)mnx=t[i];if(t[i]>mxx)mxx=t[i];if(t[i+1]<mny)mny=t[i+1];if(t[i+1]>mxy)mxy=t[i+1];if(t[i+2]>mxz)mxz=t[i+2];}return{t,w:mxx-mnx,d:mxy-mny,h:mxz};});
    items.sort((a,b)=>a.h-b.h); // bajas primero
    const usableW=spec.x-20;let curX=10,curY=10,rowH=0;
    for(const it of items){if(curX>10&&curX+it.w>usableW){curX=10;curY+=rowH+CLR;rowH=0;}it.ox=curX+it.w/2;it.oy=curY+it.d/2;curX+=it.w+CLR;rowH=Math.max(rowH,it.d);}
    const maxY=Math.max(...items.map(it=>it.oy+it.d/2));
    if(maxY>spec.y-10)throw new Error('secuencial: las piezas no caben con separaciÃ³n segura â€” reduce la cantidad o usa impresiÃ³n normal');
    items.sort((a,b)=>a.oy-b.oy||a.h-b.h); // imprimir de adelante hacia atrÃ¡s
    const _tris=S.tris,_stats=S.stats,_sup=S.supRegions,_mod=S.modifiers,_bb=S.objBBs;
    S.supRegions=[];S.modifiers=[];S.objBBs=null;
    let prologue=null,epilogue=null;const bodies=[];
    try{
      for(let k=0;k<items.length;k++){
        const it=items[k];
        setProg(4,`Secuencial: pieza ${k+1}/${items.length}â€¦`);await new Promise(r=>setTimeout(r,0));
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
  // â”€â”€ Etiquetas de tipo de lÃ­nea para OrcaSlicer/PrusaSlicer/Bambu â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // El slicer emite comentarios en espaÃ±ol (; pared exterior, ; relleno, â€¦) que
  // sirven a nuestra propia vista previa, pero OrcaSlicer no los entiende y mete
  // toda la extrusiÃ³n en "Indefinido". Traducimos cada comentario al tag estÃ¡ndar
  // "; FEATURE: <rol>" que OrcaSlicer parsea para colorear y desglosar perÃ­metros,
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
    if(/^soporte\b/.test(t))return'Support';          // "soporte", "soporte Ã¡rbol" â€” NO "soportes activados"
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
        // (Creality, Marlin, Klipperâ€¦), "; FEATURE:" en impresoras Bambu. El nombre
        // de rol es el mismo en los dos (lo resuelve string_to_role).
        if(f){out.push(raw);if(f!==last){out.push(';TYPE:'+f);out.push('; FEATURE: '+f);last=f;}continue;}
      }
      out.push(raw);
    }
    return out.join('\n');
  }
  // â”€â”€ Pie de estadÃ­sticas (neutro) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // El recuadro "EstimaciÃ³n total" de OrcaSlicer se calcula sumando el filamento
  // de los roles RECONOCIDOS, asÃ­ que se llena solo al tener bien las etiquetas
  // ";TYPE:" (no hace falta HEADER ni CONFIG_BLOCK, que ademÃ¡s ni se leÃ­an).
  // Dejamos solo comentarios neutros (sin "OrcaSlicer" ni marcadores de bloque)
  // para no disparar la detecciÃ³n de productor; Ãºtiles para Moonraker/Klipper.
  function _fmtHMS(s){s=Math.max(0,Math.round(s));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),sec=s%60;return (h?h+'h ':'')+(h||m?m+'m ':'')+sec+'s';}
  function _footerStats(est){
    const L=(est.filM*1000).toFixed(2),G=est.grams.toFixed(2),T=_fmtHMS(est.secs);
    return ['','; â”€â”€ Resumen â€” The Lab Solutions â”€â”€',
      `; estimated printing time (normal mode) = ${T}`,
      `; filament used [mm] = ${L}`,
      `; filament used [g] = ${G}`,
      `; total filament used [g] = ${G}`].join('\n');
  }
  async function generarGcode(){
    if(!S.stats)return;
    const p=readParams();S.params=p;
    const model=el('slPrinter').value,spec=SPECS[model];
    // En secuencial cada pieza se reempaqueta y _sliceSequential hace su propio chequeo de espacio â†’ no aplica el lÃ­mite del plato combinado
    const _seqMode=p.sequential&&S.objects&&S.objects.length>1;
    if(!_seqMode&&!fitsIn(spec)){toast(`La pieza (${S.stats.dx.toFixed(0)}Ã—${S.stats.dy.toFixed(0)}Ã—${S.stats.dz.toFixed(0)}mm) no cabe en ${model} â€” elige otra impresora o escala el modelo`,'error');return;}
    const btn=el('slBtnGcode');btn.disabled=true;el('slResult').style.display='none';
    try{
      setProg(2,'Iniciando slicer nativoâ€¦');
      await new Promise(r=>setTimeout(r,0));
      const nozD=+el('slNozzle').value,matName=el('slMaterial').value;
      const _seq=p.sequential&&S.objects&&S.objects.length>1;
      let gcode=_seq?await _sliceSequential(p,spec,nozD,matName,model):await _nativeSlice(S.tris,p,spec,nozD,matName,model);
      if(_seq)toast('âš  Secuencial: verifica que el cabezal libre las piezas ya impresas. Probar primero en piezas bajas/separadas.','info');
      if(!gcode.includes('G1'))throw new Error('slicer produjo G-code vacÃ­o');
      // EstimaciÃ³n sobre G-code recto (preciso); arc welding sÃ³lo afecta la salida
      const _est=estimate(gcode,MATS[matName],model);
      // EXCLUDE_OBJECT (Klipper): etiqueta cada pieza del plato para cancelarla sin abortar la placa
      if(p.excludeObject&&!_seq&&S.objBBs&&S.objBBs.length>1){gcode=_wrapExcludeObject(gcode,S.objBBs,spec.x/2,spec.y/2);}
      if(p.arcFitting){setProg(98,'Optimizando arcos (G2/G3)â€¦');await new Promise(r=>setTimeout(r,0));gcode=_arcWeld(gcode);}
      gcode=_tagFeatures(gcode); // ";TYPE:"/"; FEATURE:" â†’ desglose por tipo de lÃ­nea (y llena "EstimaciÃ³n total" por roles)
      gcode=gcode+'\n'+_footerStats(_est); // comentarios neutros (Moonraker), sin disparar error de carga
      S.gcode=gcode;
      setProg(100,'âœ“ G-code listo');
      localStorage.setItem('sl_last_est_secs',_est.secs.toFixed(1));
      renderResult(_est);
    }catch(e){
      setProg(0,'âœ• Error');
      toast('Error al laminar: '+e.message,'error');
    }finally{btn.disabled=false;}
  }
  // Perfil de velocidad trapezoidal â€” tiempo real por segmento
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
      // Filamento = marca de agua mÃ¡xima por segmento G92: las retracciones bajan E y
      // lo recuperan, asÃ­ que el mÃ¡ximo alcanzado = filamento real (sin contar des-retracciones)
      if(ne!==null){eAbs=abs?ne:eAbs+ne;if(eAbs>eMaxSeg)eMaxSeg=eAbs;}
      x=nx;y=ny;z=nz;
    }
    filament+=eMaxSeg;
    // Auto-calibraciÃ³n por impresora desde historial Moonraker
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
  // â”€â”€ Suite de calibraciÃ³n (genera G-code de test sin necesidad de modelo) â”€â”€
  function _calGen(type){
    const matName=el('slMaterial').value,mat=MATS[matName],noz=+el('slNozzle').value,spec=SPECS[el('slPrinter').value];
    const extW=noz*1.05,lh=0.2,bed=mat.bed,cx=spec.x/2,cy=spec.y/2;
    const gc=[],st={x:0,y:0,E:0};
    const EXT=(x,y,w,h,f)=>{const d=Math.hypot(x-st.x,y-st.y);st.E+=d*(w||extW)*(h||lh)/FILA_AREA;gc.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} E${st.E.toFixed(4)} F${f}`);st.x=x;st.y=y;};
    const TRV=(x,y,f)=>{gc.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${f||3000}`);st.x=x;st.y=y;};
    function header(top){
      gc.push('; The Lab Solutions â€” CalibraciÃ³n: '+type+' Â· '+matName);
      gc.push('M140 S'+bed);gc.push('M104 S'+top);gc.push('G28');gc.push('M190 S'+bed);gc.push('M109 S'+top);
      gc.push('G21');gc.push('G90');gc.push('M82');gc.push('G92 E0');gc.push('M106 S'+Math.round((mat.fan||100)*2.55));
      gc.push('G1 Z0.24 F600');TRV(5,5);st.E+=40*extW*0.24/FILA_AREA;gc.push(`G1 X5 Y45 E${st.E.toFixed(4)} F1200`);st.x=5;st.y=45;gc.push('G92 E0');st.E=0;
    }
    function box(li,z,w,d,feed){const x0=cx-w/2,x1=cx+w/2,y0=cy-d/2,y1=cy+d/2;gc.push(`G1 Z${z.toFixed(3)} F600`);TRV(x0,y0);const f=li===0?Math.round(feed*0.5):feed;EXT(x1,y0,0,0,f);EXT(x1,y1,0,0,f);EXT(x0,y1,0,0,f);EXT(x0,y0,0,0,f);}
    function footer(){gc.push('M107');gc.push('M104 S0');gc.push('M140 S0');if(st.E)gc.push(`G1 E${(st.E-0.8).toFixed(4)} F2100`);gc.push('G91');gc.push('G1 Z10 F900');gc.push('G90');gc.push('M84');}
    if(type==='temp'){
      const t0=Math.min(300,mat.noz+15),bands=5,bl=30;header(t0);
      for(let li=0;li<bands*bl;li++){if(li%bl===0){const t=t0-5*(li/bl);gc.push(`M104 S${t}`);gc.push(`; --- ${t}Â°C ---`);}box(li,(li+1)*lh,25,12,1500);}
      footer();return{gcode:gc.join('\n'),name:`temp_${matName}_${t0}-${t0-20}`,info:`<b>Torre de temperatura</b> ${t0}Â°C â†’ ${t0-20}Â°C (caliente abajo, frÃ­o arriba), 5 bandas de 6mm. Elige la banda con mejor brillo/capa, sin stringing ni burbujas, y usÃ¡ esa temperatura de boquilla.`};
    }
    if(type==='flow'){header(mat.noz);for(let li=0;li<25;li++)box(li,(li+1)*lh,30,30,1200);footer();
      return{gcode:gc.join('\n'),name:`flujo_${matName}`,info:`<b>Cubo de pared simple</b> 30Ã—30mm. Mide el grosor de la pared con calibre: deberÃ­a dar <b>${extW.toFixed(2)}mm</b>. Flujo nuevo = flujo actual Ã— (${extW.toFixed(2)} / medido).`};}
    if(type==='pa'){const bands=8,bl=12;header(mat.noz);
      for(let li=0;li<bands*bl;li++){if(li%bl===0){const pa=(li/bl)*0.01;gc.push(`SET_PRESSURE_ADVANCE ADVANCE=${pa.toFixed(3)}`);gc.push(`; --- PA ${pa.toFixed(3)} ---`);}box(li,(li+1)*lh,30,30,3000);}
      footer();return{gcode:gc.join('\n'),name:`pa_${matName}`,info:`<b>Torre Pressure Advance</b> 0 â†’ 0.07 (Klipper, requiere SET_PRESSURE_ADVANCE). Impresa rÃ¡pido para exagerar el efecto. Mide la altura donde las esquinas dejan de abultarse: PA = (altura_mm / 2.4) Ã— 0.01 â‰ˆ banda Ã— 0.01.`};}
    if(type==='retract'){const bands=6,bl=15,ax=cx-25,bx=cx+25;header(mat.noz);
      for(let li=0;li<bands*bl;li++){const z=(li+1)*lh,rd=0.4+0.4*Math.floor(li/bl);if(li%bl===0)gc.push(`; --- retracciÃ³n ${rd.toFixed(1)}mm ---`);gc.push(`G1 Z${z.toFixed(3)} F600`);
        for(const bc of[ax,bx]){st.E-=rd;gc.push(`G1 E${st.E.toFixed(4)} F2100`);TRV(bc-5,cy-5,6000);st.E+=rd;gc.push(`G1 E${st.E.toFixed(4)} F2100`);const f=li===0?700:1600;EXT(bc+5,cy-5,0,0,f);EXT(bc+5,cy+5,0,0,f);EXT(bc-5,cy+5,0,0,f);EXT(bc-5,cy-5,0,0,f);}}
      footer();return{gcode:gc.join('\n'),name:`retract_${matName}`,info:`<b>Torres de retracciÃ³n</b>: dos postes con un viaje entre ellos en cada capa. La retracciÃ³n sube 0.4mm por banda (0.4â†’2.4mm). Elige la banda con menos hilos entre las torres y usÃ¡ esa distancia de retracciÃ³n.`};}
    // firstlayer: parche sÃ³lido de una capa
    header(mat.noz);const w=40,x0=cx-w/2,x1=cx+w/2,y0=cy-w/2,y1=cy+w/2;gc.push(`G1 Z${lh.toFixed(3)} F600`);TRV(x0,y0);
    EXT(x1,y0,0,0,1000);EXT(x1,y1,0,0,1000);EXT(x0,y1,0,0,1000);EXT(x0,y0,0,0,1000);
    let yy=y0+extW,toRight=true;TRV(x0+extW,yy,3000);
    while(yy<y1-extW){const tx=toRight?x1-extW:x0+extW;EXT(tx,yy,0,0,1500);yy+=extW;if(yy<y1-extW)EXT(tx,yy,0,0,1500);toRight=!toRight;}
    footer();return{gcode:gc.join('\n'),name:`primeracapa_${matName}`,info:`<b>Parche sÃ³lido 40Ã—40</b> de una capa. Las lÃ­neas deben tocarse sin huecos ni sobre-aplastado. AjustÃ¡ el Z-offset / nivelaciÃ³n de la cama hasta que quede uniforme.`};
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
        <button class="btn btn-primary" onclick="SL3D.descargar()">â¬‡ Descargar .gcode</button>
        <span class="badge badge-gray">${kb} KB</span>
        ${machines.length?`<select class="field-select" id="slCalTarget" style="width:auto;min-width:150px">${opts}</select><button class="btn btn-ghost" id="slBtnCalSend" onclick="SL3D.enviarCal()">ğŸ“¤ Enviar e imprimir</button>`:''}
      </div></div>`;
    toast('Test de calibraciÃ³n generado âœ“','success');
  }
  function enviarCal(){
    const id=el('slCalTarget')?.value;if(!id||!S.gcode)return;
    const m=MAQUINAS.find(x=>x.id===id),ip=getPrinterIp(m);if(!ip){toast('Esa impresora no tiene IP','error');return;}
    if(typeof _isPrinterBusy==='function'&&_isPrinterBusy((_printerStatus[id]||{}).state)){toast('ğŸ”’ La impresora estÃ¡ ocupada â€” no se interrumpe','error');return;}
    const fname=gcodeFileName(),btn=el('slBtnCalSend');btn.disabled=true;btn.textContent='â³ Subiendoâ€¦';
    const fd=new FormData();fd.append('file',new Blob([S.gcode],{type:'text/plain'}),fname);fd.append('root','gcodes');
    const xhr=new XMLHttpRequest();xhr.open('POST',printerUrl(ip,'/server/files/upload'));
    const hdrs=getPrinterAuthHeaders(id);for(const k in hdrs)xhr.setRequestHeader(k,hdrs[k]);
    xhr.onload=async()=>{btn.disabled=false;btn.textContent='ğŸ“¤ Enviar e imprimir';
      if(xhr.status>=200&&xhr.status<300){try{const r=await fetch(printerUrl(ip,`/printer/print/start?filename=${encodeURIComponent(fname)}`),{method:'POST',signal:AbortSignal.timeout(8000),headers:getPrinterAuthHeaders(id)});toast(r.ok?`â–¶ Calibrando en ${m.nombre} #${m.numG}`:'Subido, no se pudo iniciar',r.ok?'success':'error');if(typeof pollPrinters==='function')pollPrinters();}catch(e){toast('Subido, no se pudo iniciar: '+e.message,'error');}}else toast('Error al subir ('+xhr.status+')','error');};
    xhr.onerror=()=>{btn.disabled=false;btn.textContent='ğŸ“¤ Enviar e imprimir';toast('Impresora inaccesible','error');};
    xhr.send(fd);
  }
  function _money(n){return '$'+Math.round(n||0).toLocaleString('es-CL');}
  // Un solo lugar para el margen objetivo y para el precio. El panel de costo lo
  // acotaba a 0â€“95 y lo guardaba en sl_margen_obj; el traspaso a cotizaciÃ³n no
  // acotaba nada y leÃ­a OTRA clave (cot_margen_min, que es el piso de margen de
  // las cotizaciones, otra cosa). Con `||`, escribir 0 % caÃ­a al respaldo y la
  // cotizaciÃ³n decÃ­a 25 %; escribir 150 % dejaba el precio igual al costo â€”o sea
  // cotizar sin margenâ€” mientras el panel mostraba otra cifra.
  function _margenObj(){
    const e=el('slMargen');
    let v=(e&&String(e.value).trim()!=='')?+e.value:parseFloat(localStorage.getItem('sl_margen_obj'));
    if(!isFinite(v))v=25;
    return Math.max(0,Math.min(95,v));
  }
  // precio = costo / (1 - margen); el divisor se acota para que el tope de 95 %
  // no termine en divisiÃ³n por cero ni en un precio de 0.
  function _precioSug(costo,m){return (costo||0)/Math.max(0.05,1-m/100);}
  function costRecalc(){
    const pk=+(el('slPriceKg')?.value)||0,rh=+(el('slRateH')?.value)||0;
    try{localStorage.setItem('sl_price_kg',pk);localStorage.setItem('sl_rate_h',rh);}catch(e){}
    const est=S.est;if(!est)return;
    const fc=est.grams/1000*pk,tc=est.secs/3600*rh,tot=fc+tc;
    const out=el('slCostOut');
    if(out)out.innerHTML=`<b style="color:var(--accent3);font-size:16px">${_money(tot)}</b> <span style="color:var(--text3);font-size:10px">= filamento ${_money(fc)} + mÃ¡quina ${_money(tc)}</span>`;
    // Precio sugerido al margen objetivo del taller (precio = costo / (1 - margen))
    const mEl=el('slMargen');const m=_margenObj();
    try{if(mEl)localStorage.setItem('sl_margen_obj',m);}catch(e){}
    const sug=el('slPriceSuggest');
    if(sug){const precio=_precioSug(tot,m);sug.innerHTML=tot>0?`<b style="color:var(--accent);font-size:14px">${_money(precio)}</b> <span style="color:var(--text3);font-size:9px">+ IVA = ${_money(precio*1.19)}</span>`:'â€”';}
  }
  // â”€â”€ Vista previa del G-code por capas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function _parseGcodeLayers(){
    const layers=[];let cur=null,x=0,y=0,z=0,le=0,abs=true,feat=0; // feat: 0 modelo,1 soporte,2 puente,3 adhesiÃ³n
    consm«ëŒ+Š×®º+º$zzb¥