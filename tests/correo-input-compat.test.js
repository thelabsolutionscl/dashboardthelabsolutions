'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const compat=require('../js/correo-input-compat.js');
const {shouldShieldEvent,IDS}=compat._test;

test('teclas muertas y composición IME quedan aisladas de atajos globales',()=>{
  assert.equal(shouldShieldEvent({key:'Dead'}),true);
  assert.equal(shouldShieldEvent({key:'a',isComposing:true}),true);
  assert.equal(shouldShieldEvent({key:'Process'}),true);
  assert.equal(shouldShieldEvent({key:'a',keyCode:229}),true);
});

test('Option/Alt y AltGraph quedan disponibles para tildes y caracteres internacionales',()=>{
  assert.equal(shouldShieldEvent({key:'e',altKey:true,metaKey:false}),true);
  assert.equal(shouldShieldEvent({key:'e',altKey:true,metaKey:false,getModifierState:k=>k==='AltGraph'}),true);
});

test('tecleo normal y atajos Cmd no se bloquean',()=>{
  assert.equal(shouldShieldEvent({key:'a',altKey:false,metaKey:false}),false);
  assert.equal(shouldShieldEvent({key:'b',metaKey:true,altKey:false}),false);
  assert.equal(shouldShieldEvent({key:'b',metaKey:true,altKey:true}),false);
});

test('protección cubre asunto, cuerpo y firma del correo',()=>{
  assert.ok(IDS.includes('mailCmpSubject'));
  assert.ok(IDS.includes('mailCmpBody'));
  assert.ok(IDS.includes('mailSigEditor'));
});
