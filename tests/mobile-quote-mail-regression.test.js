#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const HTML=fs.readFileSync('index.html','utf8');
const CSS=fs.readFileSync('styles.css','utf8');
const JS=fs.readFileSync('js/correo.js','utf8');

function makeStorage(){
  const map=new Map();
  return {
    getItem:k=>map.has(k)?map.get(k):null,
    setItem:(k,v)=>map.set(k,String(v)),
    removeItem:k=>map.delete(k),
    get length(){return map.size;},
    key:i=>Array.from(map.keys())[i]||null
  };
}
function mail(extra={}){
  const elements={
    mailRdrAtts:{style:{},replaceChildren(){}},
    mailReaderEmpty:{style:{}},mailReaderContent:{style:{}},
    mailList:{innerHTML:''},mailConnStatus:{textContent:''}
  };
  const ctx={
    AUTH:{getUser:()=>({username:'user@thelab.solutions',name:'Usuario'})},
    _proxyCfg:()=>({url:'https://proxy.example.test',key:'test-key'}),
    fetch:async()=>({ok:true,json:async()=>({ok:true,enforced:true,accounts:['user@thelab.solutions']})}),
    localStorage:makeStorage(),sessionStorage:makeStorage(),
    document:{getElementById:id=>elements[id]||null},
    ...extra
  };
  return vm.runInNewContext(JS+'\nMAIL;',ctx);
}

test('volver a Correos reutiliza la sesión IMAP activa sin consultar las credenciales otra vez',async()=>{
  const m=mail();
  m._init=true;
  let queried=0,rendered=0;
  m._loadAuthorizedAccounts=async()=>{queried++;throw Error('unexpected auth recheck');};
  m.renderAccounts=()=>rendered++;
  await m.init();
  assert.equal(queried,0);
  assert.equal(rendered,1);
  assert.equal(m._init,true);
});

test('error temporal de /mail/accounts no degrada una sesión segura a IMAP legado',async()=>{
  const m=mail({fetch:async()=>{throw Error('temporary network failure');}});
  m._secureMailReady=true;
  m._authorizedAccounts=['user@thelab.solutions'];
  const result=await m._loadAuthorizedAccounts();
  assert.equal(result,false);
  assert.equal(m._secureMailReady,true);
  assert.equal(m._authorizedAccounts[0],'user@thelab.solutions');
});

test('cambiar buzón con sesión segura no exige contraseña en memoria local',()=>{
  const m=mail();
  m._secureMailReady=true;
  m._authorizedAccounts=['user@thelab.solutions'];
  m.closeReceivedAttPreview=()=>{};
  m._clearReceivedAttCache=()=>{};
  m.renderAccounts=()=>{};
  m._hydrateSharedMailboxState=()=>Promise.resolve();
  let starts=0,modals=0;
  m.init=()=>{starts++;};
  m.showPassModal=()=>{modals++;};
  m.switchAccount('user@thelab.solutions');
  assert.equal(starts,1);
  assert.equal(modals,0);
});

test('sesión expirada no muestra la advertencia engañosa de contraseña incorrecta',async()=>{
  const m=mail();
  m._secureMailReady=true;
  m.post=async()=>({error:'MAIL_SESSION_REQUIRED'});
  m.clearMailPass=()=>{};
  let modal=0;
  m.showPassModal=()=>{modal++;};
  const ok=await m.loadFolders();
  assert.equal(ok,false);
  assert.equal(modal,0,'post() se encarga de solicitar la sesión segura');
  assert.equal(m._init,false);
});

test('crear y editar cotización tienen tarjetas con campos identificables en móvil',()=>{
  for(const cls of ['quote-mobile-desc','quote-mobile-qty','quote-mobile-cost','quote-mobile-price','quote-mobile-delete']){
    const n=(HTML.match(new RegExp('class="[^"]*'+cls+'[^"]*"','g'))||[]).length;
    assert.equal(n,2,cls+' en nueva cotización y edición');
  }
  assert.match(CSS,/#itemsContainer \.item-row,\s*#editItemsContainer \.edit-item-row\s*\{/);
  assert.match(CSS,/grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)!important/);
  assert.match(CSS,/content:attr\(data-mobile-label\)/);
  assert.match(CSS,/#itemsTotalRow>div,#editItemsTotalRow>div\s*\{/);
  assert.match(CSS,/#tab-nueva-cot \.quote-items-heading/);
});

test('correo móvil tiene controles táctiles y un panel de redacción dentro del viewport',()=>{
  assert.match(CSS,/\.mail-compose-panel\s*\{[\s\S]*?max-height:calc\(100dvh - 86px\)/);
  assert.match(CSS,/\.mail-account-tools button\{width:44px;height:44px\}/);
  assert.match(CSS,/\.mail-client\{min-height:0;height:max\(270px,calc\(100dvh - 230px\)\)\}/);
});

test('un nuevo usuario del dashboard no reutiliza la bandeja del usuario anterior',async()=>{
  const m=mail({startMailPolling:()=>{}});
  m._sessionOwner='anterior@thelab.solutions';
  m._init=true;
  m._secureMailReady=true;
  m._authorizedAccounts=['anterior@thelab.solutions'];
  m._legacyPassByAccount={'anterior@thelab.solutions':'in-memory-old-password'};
  m.msgs=[{subject:'mensaje anterior'}];
  m._currentMsg={subject:'mensaje anterior'};
  m._clearReceivedAttCache=()=>{};
  m.closeReceivedAttPreview=()=>{};
  m.renderAccounts=()=>{};
  m._hydrateSharedMailboxState=()=>Promise.resolve();
  m._loadAuthorizedAccounts=async()=>true;
  m.loadFolders=async()=>true;
  m.loadMessages=async()=>{};
  m.preloadSentAddrs=()=>{};
  await m.init();
  assert.equal(m._sessionOwner,'user@thelab.solutions');
  assert.equal(m.msgs.length,0);
  assert.equal(m._currentMsg,null);
  assert.equal(m._legacyPassByAccount['anterior@thelab.solutions'],undefined);
  assert.equal(m._authorizedAccounts,null);
});
