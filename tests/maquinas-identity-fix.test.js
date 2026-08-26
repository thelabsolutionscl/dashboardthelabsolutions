'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fix=require('../js/maquinas-identity-fix.js');

function storage(initial={}){
  const data=new Map(Object.entries(initial));
  return{
    getItem:k=>data.has(k)?data.get(k):null,
    setItem:(k,v)=>data.set(k,String(v)),
    removeItem:k=>data.delete(k),
    dump:()=>Object.fromEntries(data),
  };
}

test('elimina .95 de Ender #8 y .51 de K1 #1 para respetar Airtable',()=>{
  const s=storage({
    'printer_ip_e5-3':'192.168.100.95',
    'printer_cam_e5-3':'http://192.168.100.95:8080/?action=stream',
    'printer_ip_k1-1':'192.168.100.51',
    'printer_cam_k1-1':'http://192.168.100.51:8080/?action=stream',
  });
  const out=fix._test.migrateStorage(s);
  const d=s.dump();
  assert.equal(out.changed,true);
  assert.equal(d['printer_ip_e5-3'],undefined);
  assert.equal(d['printer_cam_e5-3'],undefined);
  assert.equal(d['printer_ip_k1-1'],undefined);
  assert.equal(d['printer_cam_k1-1'],undefined);
  assert.equal(d[fix._test.MARKER],'1');
});

test('no borra overrides de otras máquinas ni valores desconocidos',()=>{
  const s=storage({
    'printer_ip_e5-2':'192.168.100.64',
    'printer_ip_e5-3':'192.168.100.123',
    'printer_ip_k1-1':'192.168.100.120',
    'printer_cam_k1-2':'http://192.168.100.89:8080/?action=stream',
  });
  const out=fix._test.migrateStorage(s);
  const d=s.dump();
  assert.equal(out.changed,false);
  assert.equal(d['printer_ip_e5-2'],'192.168.100.64');
  assert.equal(d['printer_ip_e5-3'],'192.168.100.123');
  assert.equal(d['printer_ip_k1-1'],'192.168.100.120');
  assert.equal(d['printer_cam_k1-2'],'http://192.168.100.89:8080/?action=stream');
});
