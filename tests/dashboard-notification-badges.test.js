'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const badges=require('../js/dashboard-notification-badges.js');
const {moduleForItem,buildState}=badges._test;

test('correo entrante no leído se asigna a CORREO',()=>{
  assert.equal(moduleForItem({id:1,type:'mail',read:false,action:'correo'}),'correo');
});

test('confirmaciones de envío o éxito no crean pendientes contextuales',()=>{
  assert.equal(moduleForItem({id:1,type:'sent',read:false,action:'correo'}),'');
  assert.equal(moduleForItem({id:2,type:'success',read:false,action:'pedidos'}),'');
});

test('alertas no leídas se cuentan por módulo y las leídas se ignoran',()=>{
  const state=buildState([
    {id:1,type:'warning',read:false,action:'pedidos'},
    {id:2,type:'warning',read:false,action:'pedidos'},
    {id:3,type:'warning',read:true,action:'pedidos'},
    {id:4,type:'mail',read:false,action:'correo'},
  ],[]);
  assert.equal(state.pedidos.count,2);
  assert.equal(state.pedidos.severity,'warning');
  assert.equal(state.correo.count,1);
});

test('salud activa no reconocida aparece en Máquinas con severidad máxima',()=>{
  const state=buildState([], [
    {id:'a',severity:'warning',acked:false},
    {id:'b',severity:'critical',acked:false},
    {id:'c',severity:'critical',acked:true},
  ]);
  assert.equal(state.maquinas.count,2);
  assert.equal(state.maquinas.severity,'critical');
});

test('acciones internas o módulos desconocidos no generan globos',()=>{
  assert.equal(moduleForItem({type:'warning',read:false,action:'@hacerAlgo'}),'');
  assert.equal(moduleForItem({type:'warning',read:false,action:'inventado'}),'');
});
