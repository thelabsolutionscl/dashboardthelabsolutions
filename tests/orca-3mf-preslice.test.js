'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Zip=require('../printer-bridge/orca-3mf-geometry.js');
const AI=require('../printer-bridge/orca-ai.js');
function simple3mf(){
 const xml=Buffer.from('<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'+
 '<resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0" />'+
 '<vertex x="25.82" y="0" z="0" /><vertex x="0" y="25.65" z="34.04" />'+
 '</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources>'+
 '<build><item objectid="1"/></build></model>');
 const name=Buffer.from('3D/3dmodel.model'),start=0;
 const local=Buffer.alloc(30);
 local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt32LE(xml.length,18);
 local.writeUInt32LE(xml.length,22);local.writeUInt16LE(name.length,26);
 const cd=Buffer.alloc(46);cd.writeUInt32LE(0x02014b50,0);cd.writeUInt16LE(20,4);cd.writeUInt16LE(20,6);
 cd.writeUInt32LE(xml.length,20);cd.writeUInt32LE(xml.length,24);cd.writeUInt16LE(name.length,28);
 cd.writeUInt32LE(start,42);
 const central=Buffer.concat([cd,name]),off=local.length+name.length+xml.length;
 const eocd=Buffer.alloc(22);eocd.writeUInt32LE(0x06054b50,0);eocd.writeUInt16LE(1,8);
 eocd.writeUInt16LE(1,10);eocd.writeUInt32LE(central.length,12);eocd.writeUInt32LE(off,16);
 return Buffer.concat([local,name,xml,central,eocd]);
}
test('3MF geometry is inspected in mm without slicing or changing project',()=>{
 const d=Zip.describe(simple3mf());
 assert.deepEqual(d.dimensions,[25.82,25.65,34.04]);
 assert.equal(d.facets,1);
 assert.equal(d.unit,'millimeter');
});
test('malformed archive is refused safely, not executed',()=>{
 assert.throws(()=>Zip.describe(Buffer.from('not zip')),/incompleto/);
});
test('AI preflight can see only numeric geometry and bounded speed proposals, never raw files',()=>{
 const input={geometry:{dimensions:[25.82,25.65,34.04],thin:false,facets:912,
   filename:'PRIVATE_CUSTOMER.stl',notes:'PRIVATE NOTES'},
   changes:{nozzle_temperature:1000},details:[{key:'inner_wall_speed',from:300,to:185},
     {key:'apiKey',from:1,to:2}],
   limit:18,safeFlow:15.3,physics:{verdict:'blocked'},proposedPhysics:{verdict:'ok'},
   gcode:'SECRET_GCODE',modelBase64:'SECRET_STL',token:'SECRET_TOKEN'};
 const result=AI.safePreviewFacts(input,'calidad','K1','PLA');
 const json=JSON.stringify(result);
 for(const sensitive of ['PRIVATE_CUSTOMER','PRIVATE NOTES','SECRET_GCODE','SECRET_STL','SECRET_TOKEN','apiKey','nozzle_temperature']){
   assert.ok(!json.includes(sensitive));
 }
 assert.equal(result.proposedChanges.length,1);
 assert.deepEqual(result.geometry.dimensionsMm,[25.82,25.65,34.04]);
});
