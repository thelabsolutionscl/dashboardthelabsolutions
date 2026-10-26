'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const STL=require('../printer-bridge/orca-stl-preflight.js');
const Adapter=require('../printer-bridge/orca-mcp.js');
function triangles(s){
  const p=(x,y,z)=>[x*s,y*s,z*s];
  return [
    [p(0,0,0),p(0,1,0),p(1,1,0)], [p(0,0,0),p(1,1,0),p(1,0,0)],
    [p(0,0,1),p(1,0,1),p(1,1,1)], [p(0,0,1),p(1,1,1),p(0,1,1)],
    [p(0,0,0),p(0,0,1),p(0,1,1)], [p(0,0,0),p(0,1,1),p(0,1,0)],
    [p(1,0,0),p(1,1,0),p(1,1,1)], [p(1,0,0),p(1,1,1),p(1,0,1)],
    [p(0,0,0),p(1,0,0),p(1,0,1)], [p(0,0,0),p(1,0,1),p(0,0,1)],
    [p(0,1,0),p(0,1,1),p(1,1,1)], [p(0,1,0),p(1,1,1),p(1,1,0)]
  ];
}
function binaryCube(s){
  const tris=triangles(s),b=Buffer.alloc(84+tris.length*50);
  b.writeUInt32LE(tris.length,80);
  for(let i=0;i<tris.length;i++)for(let j=0;j<3;j++)
    for(let k=0;k<3;k++)b.writeFloatLE(tris[i][j][k],84+i*50+12+j*12+k*4);
  return b;
}
function asciiCube(s){
  return Buffer.from('solid Cube\n'+triangles(s).map(t=>
    'facet normal 0 0 0\n outer loop\n'+t.map(p=>' vertex '+p.join(' ')).join('\n')+
    '\n endloop\nendfacet\n').join('')+'endsolid Cube\n');
}
test('normal 10 mm binary STL imports untouched and can be sliced unattended',()=>{
  const source=binaryCube(10);
  const result=STL.prepare(source,{filename:'box.stl',units:'auto'});
  assert.equal(result.changed,false);
  assert.deepEqual(result.buffer,source);
  assert.equal(Math.round(STL.parse(source).meshVolume),1000);
});
test('tiny meters STL cannot open a modal; selected meters scales to mm',()=>{
  const original=binaryCube(0.05);
  assert.throws(()=>STL.prepare(original,{filename:'tiny.stl',units:'auto'}),/No se puede laminar de forma desatendida.*Geometria STL/);
  const result=STL.prepare(original,{filename:'tiny.stl',units:'m'});
  assert.equal(result.factor,1000);
  assert.equal(Math.round(result.dimensions[0]),50);
  assert.equal(Math.round(STL.parse(result.buffer).meshVolume),125000);
  assert.notDeepEqual(result.buffer,original);
});
test('inch units convert to 25.4 mm without GUI dialog',()=>{
  const result=STL.prepare(binaryCube(2),{filename:'inch.stl',units:'in'});
  assert.equal(result.factor,25.4);
  assert.ok(Math.abs(result.dimensions[0]-50.8)<0.1);
  assert.ok(STL.parse(result.buffer).meshVolume>100000);
});
test('sub-millimeter parts fail closed, even if explicitly marked mm',()=>{
  const tiny=binaryCube(0.5);
  assert.throws(()=>STL.prepare(tiny,{filename:'tiny.stl',units:'mm'}),/No se puede laminar de forma desatendida.*Geometria STL/);
});
test('ASCII STL is converted to mm without changing other STL syntax',()=>{
  const result=STL.prepare(asciiCube(.05),{filename:'solid.stl',units:'m'});
  assert.equal(result.changed,true);
  assert.match(result.buffer.toString('utf8'),/facet normal/);
  assert.equal(Math.round(STL.parse(result.buffer).meshVolume),125000);
});
test('malformed STL and invalid unit types cannot reach slicer',()=>{
  assert.throws(()=>STL.prepare(Buffer.alloc(180),{filename:'truncated.stl'}),/No se reconoce|inconsistentes/);
  assert.throws(()=>STL.prepare(binaryCube(10),{filename:'box.stl',units:'kilometers'}),/Unidades no admitidas/);
});
test('3MF files pass through native mode; no binary STL modifications',()=>{
  const data=Buffer.from('PK\x03\x04','binary');
  assert.equal(STL.prepare(data,{filename:'project.3mf'}).buffer,data);
});
test('adapter rejects ambiguous tiny STL before even trying MCP or GUI load',async()=>{
  const input={filename:'remote.stl',model:'K2 Plus',material:'PLA',autoSelect:true,stlUnits:'auto',
    modelBase64:binaryCube(.05).toString('base64')};
  const env={ORCA_MCP_COMMAND:process.execPath,ORCA_MCP_ARGS_JSON:'[]',
    ORCA_MCP_CONFIG_FILE:path.join(os.tmpdir(),'missing-orca-preflight-'+process.pid+'.json')};
  await assert.rejects(Adapter.slice(input,env),/No se puede laminar de forma desatendida.*Geometria STL/);
});

test('error remoto incluye medidas y los tamaños alternativos sin inventar unidad',()=>{
  const tiny=binaryCube(0.05);
  assert.throws(()=>STL.prepare(tiny,{filename:'tambor.stl',units:'mm'}),e=>{
    assert.match(e.message,/Geometria STL/);
    assert.match(e.message,/si eran metros:/);
    assert.match(e.message,/si eran pulgadas:/);
    assert.match(e.message,/=> 0\.0500 x 0\.0500 x 0\.0500 mm/);
    assert.ok(!e.message.includes('automáticamente convertido'));
    assert.deepEqual(e.details.selectedUnits,'mm');
    return true;
  });
});

test('flat 102 x 101 x 1.34 mm closed model with inconsistent winding is repaired with no scale',()=>{
  const source=binaryCube(1);
  const buff=Buffer.from(source);
  // Build thin prism using existing vertices, flip alternate triangles
  for(let i=0;i<12;i++)for(let j=0;j<3;j++)for(let k=0;k<3;k++){
    const off=84+50*i+12+j*12+k*4;
    const v=buff.readFloatLE(off);
    buff.writeFloatLE(v*[102,101,1.34][k],off);
  }
  for(let i=0;i<12;i+=2){
    for(let k=0;k<3;k++){
      const a=84+50*i+12+12+k*4,b=84+50*i+12+24+k*4;
      const val=buff.readFloatLE(a);
      buff.writeFloatLE(buff.readFloatLE(b),a);
      buff.writeFloatLE(val,b);
    }
  }
  // Swap the two vertices of every second triangle; all coordinates stay unchanged.
  const pre=STL.parse(buff);
  assert.ok(pre.meshVolume<8,'winding cancellation should simulate false tiny-volume alarm');
  const result=STL.prepare(buff,{filename:'flat-piece.stl',units:'mm'});
  assert.equal(result.units,'mm');
  assert.equal(result.factor,1);
  assert.equal(result.changed,false);
  assert.equal(result.orientationRepaired,true);
  assert.ok(result.inspectedMeshVolume>10000);
  assert.deepEqual(result.dimensions.map(Math.round),[102,101,1]);
});
test('open thin STL is blocked with a useful topology diagnostic instead of a GUI modal',()=>{
  const src=binaryCube(0.1);
  const fewer=Buffer.from(src.subarray(0,src.length-50));
  fewer.writeUInt32LE(11,80);
  assert.throws(()=>STL.prepare(fewer,{filename:'broken.stl',units:'mm'}),/malla abierta|umbral/);
});
