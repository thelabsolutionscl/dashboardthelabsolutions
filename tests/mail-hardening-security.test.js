#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const js=read('js/correo.js'),notify=read('js/notify.js'),php=read('mail-api.php');
function block(start,end){
 const a=js.indexOf(start),b=js.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'missing '+start);
 return js.slice(a,b);
}
test('sender identity never falls back to a different active inbox',()=>{
 const postAs=block('async postAs(fromEmail,params){','async init(){');
 assert.match(postAs,/if\(!pass\)\s*(?:\{|)\s*return \{error:/);
 assert.doesNotMatch(postAs,/return this\.post\(params\)/);
});
test('mailbox passwords leave Web Storage and secure mode uses backend session',()=>{
 assert.match(js,/_legacyPassByAccount:\{\}/);
 const getter=block('getMailPassFor(email){','getMailPass(){');
 assert.match(getter,/_legacyPassByAccount/);
 assert.doesNotMatch(getter,/localStorage|sessionStorage/);
 const purge=block('_purgeLegacyMailPasswords(){','getMailPassFor(email){');
 assert.match(purge,/localStorage\.removeItem\(k\)/);
 assert.match(purge,/sessionStorage\.removeItem\(k\)/);
 const pass=block('setMailPass(p){','auth(){');
 assert.match(pass,/_legacyPassByAccount/);
 assert.doesNotMatch(pass,/localStorage\.setItem|sessionStorage\.setItem/);
 assert.match(js,/_secureMailSession\(account,password\)/);
 assert.match(js,/\/mail\/session/);
 assert.match(js,/\/mail\/rpc/);
 assert.match(notify,/MAIL\.getMailPassFor\(email\)/);
});
test('correo recibido y firmas usan saneadores separados con allowlists',()=>{
 const sanitize=block('_sanitizarCita(html,allowImages=false){','\n};');
 assert.match(sanitize,/new DOMParser\(\)/);
 assert.match(sanitize,/const keep=new Set/);
 assert.match(sanitize,/const drop=new Set/);
 assert.match(sanitize,/node\.nodeType===3/);
 assert.match(sanitize,/url\.protocol!==['"]https:['"]/);
 assert.match(sanitize,/return out\.innerHTML/);
 const compose=block('openCompose(opts={}){','closeCompose(){');
 assert.match(compose,/this\._sanitizarCita\(opts\.body\|\|''\)/);
 const sig=block('sigHtml(){','insertSignature(){');
 assert.match(sig,/this\._sanitizarFirma\(s\)/);
 const setSig=block('setSig(html){','async _saveSigsAirtable(){');
 assert.match(setSig,/this\._sanitizarFirma\(html\)/);
 const sigStyle=block('_safeSignatureStyle(styleText){','_sanitizarFirma(html){');
 assert.match(sigStyle,/javascript:/);
 assert.match(sigStyle,/expression/);
 assert.match(sigStyle,/const allowed=/);
 assert.match(sigStyle,/background-color/);
 assert.match(sigStyle,/padding/);
 assert.match(sigStyle,/list-style/);
 const sigSan=block('_sanitizarFirma(html){','\/\/ Firma independiente por cuenta');
 assert.match(sigSan,/this\._safeSignatureStyle/);
 assert.match(sigSan,/data:image/);
 assert.match(sigSan,/script style svg math iframe object embed form/);
 const reply=block('reply(){','_validEmails(str){');
 assert.match(reply,/this\._sanitizarCita\(m\.body_html\)/);
});
test('image insertion creates nodes rather than HTML interpolation and requires HTTPS',()=>{
 const insert=block('_insertEditorImage(editorId){','toggleCompose(){');
 assert.match(insert,/url\.protocol!=='https:'/);
 assert.match(insert,/document\.createElement\('img'\)/);
 assert.doesNotMatch(insert,/execCommand\('insertHTML'/);
});
test('all IMAP operations verify TLS peer and authenticate before Resend',()=>{
 assert.doesNotMatch(php,/novalidate-cert/);
 assert.match(php,/function imap_str\([\s\S]*?\/imap\/ssl\/validate-cert/);
 const send=php.slice(php.indexOf("case 'send':"),php.indexOf("case 'spam':"));
 const auth=send.indexOf('$conn = open_imap($user, $pass)');
 const external=send.indexOf('$err = resend_send(');
 assert.ok(auth>0&&external>auth);
});
