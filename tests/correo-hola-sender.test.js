const test=require('node:test');
const assert=require('node:assert/strict');
const mod=require('../js/correo-hola-sender.js');

const {senderNameFor,normalizeAccounts}=mod._test;

test('hola@ usa Andrea Garrido como nombre predeterminado nuevo',()=>{
  assert.equal(senderNameFor('hola@thelab.solutions',''),'Andrea Garrido - The Lab Solutions');
  assert.equal(senderNameFor('HOLA@THELAB.SOLUTIONS','The Lab Solutions'),'Andrea Garrido - The Lab Solutions');
});

test('normaliza el valor histórico de hola@ en todas las listas locales',()=>{
  const out=normalizeAccounts([
    {email:'usuario@thelab.solutions',name:'Usuario'},
    {email:'hola@thelab.solutions',name:'The Lab Solutions'}
  ]);
  assert.equal(out[0].name,'Usuario');
  assert.equal(out[1].name,'Andrea Garrido - The Lab Solutions');
});

test('un override manual distinto se conserva',()=>{
  assert.equal(senderNameFor('hola@thelab.solutions','Nombre Personalizado'),'Nombre Personalizado');
});

test('otras casillas no cambian',()=>{
  assert.equal(senderNameFor('ventas@thelab.solutions','Equipo Ventas'),'Equipo Ventas');
});
