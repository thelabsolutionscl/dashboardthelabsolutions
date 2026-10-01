#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const WORKFLOW=fs.readFileSync('.github/workflows/ai-bugfix.yml','utf8');
const SCRIPT=fs.readFileSync('scripts/ai-bugfix.mjs','utf8');
const WORKER=fs.readFileSync('airtable-proxy/src/worker.js','utf8')
  .replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const worker=');
const api=new Function(WORKER+'\nreturn {bugfixPathAllowed,bugfixPlanRequestAllowed,bugfixPatchRequestAllowed,bugfixResultAllowed};')();

test('workflow periódico usa OIDC y no recibe una clave Anthropic',()=>{
  assert.match(WORKFLOW,/cron: '\*\/15 \* \* \* \*'/);
  assert.match(WORKFLOW,/id-token: write/);
  assert.match(WORKFLOW,/contents: write/);
  assert.match(WORKFLOW,/pull-requests: write/);
  assert.match(WORKFLOW,/AIRTABLE_TOKEN: \$\{\{ secrets\.AIRTABLE \}\}/);
  assert.match(WORKFLOW,/PROXY_URL: \$\{\{ secrets\.PROXY_URL \}\}/);
  assert.doesNotMatch(WORKFLOW,/ANTHROPIC|OPENAI/);
});
test('servicio IA acepta solo formas acotadas',()=>{
  const report={id:'br_abcdefghijklmn',message:'No puedo enviar un correo correctamente',section:'correo',path:'/#correo',build:'abc1234'};
  assert.equal(api.bugfixPlanRequestAllowed({stage:'plan',report,repoMap:['js/correo.js','styles.css']}),true);
  assert.equal(api.bugfixPlanRequestAllowed({stage:'plan',report:{...report,screenshot:'data:text/html;base64,AAAA'},repoMap:[]}),false);
  assert.equal(api.bugfixPatchRequestAllowed({stage:'patch',report,plan:{analysis:'x',risk:'low',files:['js/correo.js'],queries:['send']},files:[{path:'js/correo.js',content:'abc'}]}),true);
  assert.equal(api.bugfixPathAllowed('../secret'),false);
  assert.equal(api.bugfixPathAllowed('/etc/passwd'),false);
});
test('respuesta IA debe ser JSON de plan o ediciones exactas',()=>{
  assert.equal(api.bugfixResultAllowed('plan',{analysis:'El botón no actualiza el estado',risk:'low',files:['js/correo.js'],queries:['sendCompose']}),true);
  assert.equal(api.bugfixResultAllowed('patch',{summary:'Corrige el envío del formulario',risk:'low',edits:[{path:'js/correo.js',find:'abc',replace:'def'}]}),true);
  assert.equal(api.bugfixResultAllowed('patch',{summary:'x',risk:'low',edits:[{path:'../x',find:'abc',replace:'def'}]}),false);
});
test('el reparador no ejecuta comandos generados por la IA y bloquea infraestructura',()=>{
  assert.match(SCRIPT,/count\(raw,edit\.find\)/);
  assert.match(SCRIPT,/raw\.replace\(edit\.find,edit\.replace\)/);
  assert.match(SCRIPT,/FORBIDDEN_PATCH/);
  assert.match(SCRIPT,/airtable-proxy/);
  assert.match(SCRIPT,/sii-worker/);
  assert.match(SCRIPT,/\.github/);
  assert.doesNotMatch(SCRIPT,/eval\(|new Function\(/);
  assert.match(SCRIPT,/node --test|--test/);
  assert.match(SCRIPT,/gh.*pr.*create|\['pr','create'/);
  assert.match(SCRIPT,/--squash/);
  assert.match(SCRIPT,/--delete-branch/);
});
test('proxy verifica identidad OIDC del workflow exacto y mantiene presupuesto IA',()=>{
  assert.match(WORKER,/token\.actions\.githubusercontent\.com/);
  assert.match(WORKER,/tls-dashboard-bugfix/);
  assert.match(WORKER,/ai-bugfix\.yml@refs\/heads\/main/);
  assert.match(WORKER,/claims\.repository!==GITHUB_BUGFIX_REPOSITORY/);
  assert.match(WORKER,/reserveAiBudget\(env,payload,'bugfix-'\+stage\)/);
  assert.match(WORKER,/reconcileAiBudget/);
  assert.match(WORKER,/url\.pathname==='\/service\/github\/bugfix-ai'/);
});
