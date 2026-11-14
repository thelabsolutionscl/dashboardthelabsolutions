#!/usr/bin/env node
/* scripts/hy3d-smoke.js — prueba en vivo del motor Hunyuan3D del Escultor de fotos.
 *
 *   node scripts/hy3d-smoke.js --check            sólo comprueba que el servicio responde
 *                                                 (no usa GPU ni sube ninguna foto)
 *   node scripts/hy3d-smoke.js                    genera una pieza con ender5max.png
 *   node scripts/hy3d-smoke.js estandar foto.png  modo y foto a elección
 *
 * Opciones:  --token hf_xxx   (o la variable HF_TOKEN) usa tu cuota de Hugging Face
 *            --octree 256     detalle de la malla
 *            --host URL       apunta a otro servidor Gradio (para pruebas locales)
 *
 * Usa exactamente el mismo cliente (js/foto3d-hy3d.js) y la misma limpieza de
 * malla (js/foto3d-glb.js) que la herramienta, así que si esto funciona, la
 * herramienta también. Escribe hy3d-smoke.glb y hy3d-smoke.stl en la carpeta
 * actual. Necesita Node 18 o más.
 *
 * ¡Ojo! La foto se envía a un servidor público de Hugging Face. Con las fotos de
 * ejemplo del repo (impresoras) no hay problema; no uses fotos de clientes.
 */
'use strict';
const fs=require('fs');
const path=require('path');
const HY=require('../js/foto3d-hy3d.js');
const GLB=require('../js/foto3d-glb.js');
const CORE=require('../js/foto3d.js');

const args=process.argv.slice(2);
function opt(name,def){const i=args.indexOf('--'+name);if(i<0)return def;const v=args[i+1];args.splice(i,2);return v;}
const checkOnly=args.includes('--check')&&!!args.splice(args.indexOf('--check'),1);
const token=opt('token',process.env.HF_TOKEN||'');
const octree=Number(opt('octree','256'))||256;
const host=opt('host','');
const env=host?{hosts:{rapido:host,estandar:host}}:{};
const quality=['rapido','estandar'].includes(args[0])?args.shift():'rapido';
const imgPath=path.resolve(args[0]||path.join(__dirname,'..','ender5max.png'));

const ok=m=>console.log('  ✔ '+m),bad=m=>console.log('  ✘ '+m);
const t0=Date.now(),secs=()=>((Date.now()-t0)/1000).toFixed(1)+' s';

(async()=>{
  console.log(`Hunyuan3D · modo ${quality} (${HY.SPACES[quality].label}) · ${host||HY.SPACES[quality].host}`);
  try{
    const c=await HY.check({quality,token,env});
    ok(`el servicio responde · Gradio ${c.version} · la función "${HY.API_NAME}" existe`);
  }catch(e){bad(`${e.code}: ${e.message}`);process.exit(1);}
  if(checkOnly){console.log('\nListo: la conexión funciona (no se subió ninguna foto).');return;}

  if(!fs.existsSync(imgPath)){bad('no existe la foto '+imgPath);process.exit(1);}
  const png=fs.readFileSync(imgPath);
  // ¿tiene transparencia? (PNG RGBA: byte de color 6 en el IHDR)
  const hasAlpha=png.length>26&&png.readUInt32BE(0)===0x89504E47&&(png[25]===6||png[25]===4);
  console.log(`\nFoto: ${path.basename(imgPath)} (${(png.length/1024).toFixed(0)} KB, ${hasAlpha?'con transparencia → no se quita el fondo':'sin transparencia → el servicio quita el fondo'})`);
  console.log('Generando (hasta 1-2 min si hay cola; el consumo de cuota es real)…');
  let last='';
  let r;
  try{
    r=await HY.generate({png,quality,octree,seed:1234,rembg:!hasAlpha,token,env,
      onStatus:(p,x)=>{const m=p==='generating'?`generando… ${x.elapsed||0} s`:p;if(m!==last){process.stdout.write('  · '+m+'\n');last=m;}}});
  }catch(e){
    bad(`${e.code}: ${e.message}`);
    if(e.code==='quota')console.log('    (Es normal si ya usaste la cuota del día; con --token tu cuenta de Hugging Face tiene más.)');
    process.exit(2);
  }
  ok(`el servicio entregó la malla en ${r.seconds.toFixed(1)} s · ${(r.glb.byteLength/1048576).toFixed(1)} MB · semilla ${r.seed}`);
  if(r.stats)console.log('    estadísticas del servicio:',JSON.stringify(r.stats).slice(0,200));
  fs.writeFileSync('hy3d-smoke.glb',Buffer.from(r.glb));

  let clean;
  try{clean=GLB.cleanGLB(r.glb);}catch(e){bad('la malla no se pudo leer: '+e.message);process.exit(3);}
  const s=clean.stats;
  ok(`malla leída: ${s.faces.toLocaleString('es-CL')} triángulos · ${s.vertices.toLocaleString('es-CL')} vértices`);
  console.log(`    vértices soldados ${s.weldedVertices.toLocaleString('es-CL')} · islas quitadas ${s.floaterShells} (${s.floaterTris} triángulos) · agujeros cerrados ${s.holesFilled}`);
  (s.openAfter===0&&s.nonManifold===0?ok:bad)(`cierre de la malla: ${s.openAfter} aristas abiertas · ${s.nonManifold} no-manifold${s.flipped?' · estaba invertida y se corrigió':''}`);

  const placed=GLB.placeMesh(clean,{size:80,rot:0}),mesh=GLB.toTriMesh(placed.positions,placed.indices);
  const b=placed.bounds,d=[0,1,2].map(k=>(b.max[k]-b.min[k]).toFixed(1));
  const stl=Buffer.from(CORE.writeSTL(mesh,'hy3d-smoke'));
  fs.writeFileSync('hy3d-smoke.stl',stl);
  ok(`STL escrito: ${d[0]} × ${d[1]} × ${d[2]} mm · ${(stl.length/1048576).toFixed(1)} MB → hy3d-smoke.stl`);

  const front=GLB.renderFront(placed.positions,placed.indices,512);
  let cov=0;for(let i=0;i<front.alpha.length;i++)if(front.alpha[i])cov++;
  ok(`vista frontal para medallón y llavero: ${front.w}×${front.h} px, ${(100*cov/front.alpha.length).toFixed(0)} % cubierto`);
  console.log(`\nTodo funcionó en ${secs()}. Abre hy3d-smoke.stl en tu laminador y revisa que la pieza se vea bien.`);
  console.log('Si algo salió mal, pásame este texto completo.');
})().catch(e=>{bad('error inesperado: '+(e&&e.stack||e));process.exit(9);});
