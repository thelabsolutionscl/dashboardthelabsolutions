#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const DEPLOY=fs.readFileSync(path.join(__dirname,'..','.github','workflows','deploy.yml'),'utf8');

test('GitHub Pages no publica un token de Airtable como fallback',()=>{
  assert.doesNotMatch(DEPLOY,/secrets\.AIRTABLE\b/,'el PAT no debe entrar al job público');
  assert.doesNotMatch(DEPLOY,/sed -i[^\n]*%%AIRTABLE_TOKEN%%/,'no se debe hornear un PAT en HTML');
});

test('el despliegue falla cerrado si no existe el proxy',()=>{
  const inject=DEPLOY.slice(DEPLOY.indexOf('- name: Inject secrets into index.html'));
  assert.ok(inject.includes('PROXY_URL')&&inject.includes('PROXY_KEY'));
  assert.ok(inject.includes('if [ -z '),'el despliegue debe rechazar configuración incompleta');
  assert.ok(inject.includes('exit 1'),'sin proxy no debe publicarse el dashboard');
  assert.ok(inject.indexOf('exit 1')<inject.indexOf('sed -i'),'la comprobación debe ocurrir antes de modificar HTML');
});
