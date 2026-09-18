#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const SRC=fs.readFileSync(path.join(__dirname,'..','js','slicer3d.js'),'utf8');

function fn(name){
  const re=new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\(');
  const m=re.exec(SRC);assert.ok(m,'falta '+name);
  let p=SRC.indexOf('(',m.index),depth=0,body=-1,quote='',esc=false,line=false,block=false;
  for(let i=p;i<SRC.length;i++){
    const ch=SRC[i],nx=SRC[i+1];
    if(line){if(ch==='\n')line=false;continue;}
    if(block){if(ch==='*'&&nx==='/'){block=false;i++;}continue;}
    if(quote){if(esc){esc=false;continue;}if(ch==='\\'){esc=true;continue;}if(ch===quote)quote='';continue;}
    if(ch==='/'&&nx==='/'){line=true;i++;continue;}if(ch==='/'&&nx==='*'){block=true;i++;continue;}
    if(ch==='"'||ch==="'"||ch===String.fromCharCode(96)){quote=ch;continue;}
    if(ch==='(')depth++;else if(ch===')'&&--depth===0){body=SRC.indexOf('{',i);break;}
  }
  assert.ok(body>0,'sin cuerpo '+name);
  depth=0;quote='';esc=false;line=false;block=false;
  for(let i=body;i<SRC.length;i++){
    const ch=SRC[i],nx=SRC[i+1];
    if(line){if(ch==='\n')line=false;continue;}
    if(block){if(ch==='*'&&nx==='/'){block=false;i++;}continue;}
    if(quote){if(esc){esc=false;continue;}if(ch==='\\'){esc=true;continue;}if(ch===quote)quote='';continue;}
    if(ch==='/'&&nx==='/'){line=true;i++;continue;}if(ch==='/'&&nx==='*'){block=true;i++;continue;}
    if(ch==='"'||ch==="'"||ch===String.fromCharCode(96)){quote=ch;continue;}
    if(ch==='{')depth++;else if(ch==='}'&&--depth===0)return SRC.slice(m.index,i+1);
  }
  throw new Error('sin cierre '+name);
}

test('STL binario truncado se rechaza en vez de cortar triángulos',()=>{
  const s=fn('parseSTL');
  assert.match(s,/expected=84\+n\*50/);
  assert.match(s,/expected>buf\.byteLength/);
  assert.match(s,/STL binario truncado/);
  assert.doesNotMatch(s,/Math\.min\(dv\.getUint32\(80,true\)/);
});

test('3MF respeta unidades, build, transforms y componentes',()=>{
  const s=fn('parse3MF');
  for(const x of ['unitScale','centimeter:10','inch:25.4','components','objectid','transform','build','item'])assert.ok(s.includes(x),'falta '+x);
  assert.match(s,/DOMParser/);
  assert.match(s,/componentes cíclicos/);
});

test('salud de malla distingue sólido cerrado de superficie abierta',()=>{
  const s=fn('_meshHealth');
  const meshHealth=new Function(s+';return _meshHealth;')();
  const tetra=new Float32Array([
    0,0,0, 1,0,0, 0,1,0,
    0,0,0, 0,0,1, 1,0,0,
    1,0,0, 0,0,1, 0,1,0,
    0,1,0, 0,0,1, 0,0,0
  ]);
  const ok=meshHealth(tetra);
  assert.equal(ok.openEdges,0);
  assert.equal(ok.nonManifoldEdges,0);
  assert.equal(ok.volumeReliable,true);
  const open=meshHealth(new Float32Array([0,0,0,1,0,0,0,1,0]));
  assert.equal(open.openEdges,3);
  assert.equal(open.volumeReliable,false);
});

test('secuencial exige despeje físico y ya no usa 18 mm mágico',()=>{
  const s=fn('_sliceSequential');
  assert.match(s,/p\.sequentialClearance/);
  assert.match(s,/despeje físico medido/);
  assert.doesNotMatch(s,/CLR=18/);
});

test('ni envío normal ni calibración arrancan Moonraker saltándose preflight',()=>{
  const send=fn('enviar'),cal=fn('enviarCal');
  assert.doesNotMatch(send,/printer\/print\/start/);
  assert.doesNotMatch(cal,/printer\/print\/start/);
  assert.match(send,/startUploadedSlicerJob/);
  assert.match(cal,/startUploadedSlicerJob/);
});

test('resultado no afirma que raft esté sin soporte y explica motor nativo',()=>{
  const s=fn('renderResult');
  assert.doesNotMatch(s,/raft<\/b>: no está soportado/i);
  assert.match(s,/Raft activado/);
  assert.match(s,/Motor nativo/);
  assert.match(s,/pieza piloto/);
});

test('selección automática exige telemetría reciente y estado administrativo',()=>{
  const s=fn('_machineReadiness');
  assert.match(s,/Date\.now\(\)-last<60000/);
  assert.match(s,/getMaquinaEstadoGlobal/);
  assert.match(s,/idle','ready','standby/);
});

test('G-code final tiene auditor de envelope antes de quedar listo',()=>{
  assert.match(SRC,/function _gcodeEnvelope\(/);
  assert.match(SRC,/function _validateGcodeForSpec\(/);
  const g=fn('generarGcode');
  assert.match(g,/_validateGcodeForSpec\(gcode,spec\)/);
  assert.match(g,/G-code fuera del volumen seguro/);
});

test('la UI aclara qué datos salen del navegador al usar IA',()=>{
  assert.match(SRC,/procesamiento local/);
  assert.match(SRC,/no la malla\/triángulos/);
});
