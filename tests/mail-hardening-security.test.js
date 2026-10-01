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
 assert.match(postAs,/if\(!pass\)\{[\s\S]*return \{error:/);
 assert.doesNotMatch(postAs,/return this\.post\(params\)/);
});
test('mailbox passwords move from persistent local storage to tab scope',()=>{
 const src=block('getMailPassFor(email){','getMailPass(){');
 const code='function '+src.trim().replace(/,\s*$/,'');
 const store=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}};
 const persistent=store(),tab=store();
 persistent.setItem('thelab_mail_pass_sales@example.test','old-pass');
 const get=new Function('sessionStorage','localStorage',code+';return getMailPassFor;')(tab,persistent);
 assert.equal(get('sales@example.test'),'old-pass');
 assert.equal(persistent.getItem('thelab_mail_pass_sales@example.test'),null);
 assert.equal(tab.getItem('thelab_mail_pass_sales@example.test'),'old-pass');
 assert.equal(get('sales@example.test'),'old-pass');
 assert.equal(get('missing@example.test'),'');
 const pass=block('setMailPass(p){','auth(){');
 assert.match(pass,/sessionStorage\.setItem\(k,p\)/);
 assert.match(pass,/localStorage\.removeItem\(k\)/);
 assert.doesNotMatch(pass,/localStorage\.setItem\(k,p\)/);
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
