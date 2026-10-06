#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../js/seo-ads.js'),'utf8');
function fragment(a,b){
 const from=source.indexOf(a),to=source.indexOf(b,from+a.length);
 assert.ok(from>=0&&to>from,'Cannot extract '+a);
 return source.slice(from,to);
}
function stores(){
 const make=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
 return {localStorage:make(),sessionStorage:make()};
}
test('limpieza definitiva elimina las credenciales heredadas de ambos almacenamientos',()=>{
 const {localStorage,sessionStorage}=stores();
 localStorage.setItem('wp_config','credencial heredada');
 sessionStorage.setItem('wp_config','credencial de sesión');
 const purge=fragment('(function clearDeprecatedSiteCredentials(){','// Auditor SEO on-page');
 new Function('localStorage','sessionStorage',purge)(localStorage,sessionStorage);
 assert.equal(localStorage.getItem('wp_config'),null);
 assert.equal(sessionStorage.getItem('wp_config'),null);
 assert.doesNotMatch(source,/function getWPConfig|\/wp-json\/|_yoast_wpseo_/);
});
test('Ads mutation secret is purged from both browser stores; only read config remains',()=>{
 const {localStorage,sessionStorage}=stores();
 localStorage.setItem('ads_config',JSON.stringify({endpoint:'https://script.google.com/macros/s/demo/exec',customerId:'123',secret:'old-key'}));
 localStorage.setItem('ads_mutation_secret','legacy-local');
 sessionStorage.setItem('ads_mutation_secret','legacy-session');
 const fn=new Function('localStorage','sessionStorage','_DEFAULTS','URL',fragment('function getAdsConfig(){','function saveAdsConfig(){')+'return getAdsConfig;')(localStorage,sessionStorage,{ADS_WEBAPP:'%%ADS_WEBAPP%%',ADS_CUSTOMER:'%%ADS_CUSTOMER%%'},URL);
 const cfg=fn();
 assert.equal(cfg.secret,undefined);
 assert.equal(cfg.customerId,'123');
 assert.equal(localStorage.getItem('ads_mutation_secret'),null);
 assert.equal(sessionStorage.getItem('ads_mutation_secret'),null);
 assert.equal(JSON.parse(localStorage.getItem('ads_config')).secret,undefined);
 const save=fragment('function saveAdsConfig(){','function toggleAdsConfig(){');
 assert.doesNotMatch(save,/ads_mutation_secret|secret/);
 assert.match(save,/localStorage\.setItem\('ads_config',JSON\.stringify\(\{endpoint,customerId\}\)\)/);
});
test('read-only guard activates for both explicit demo and live dashboard showing fixture fallback',()=>{
 const {localStorage,sessionStorage}=stores();
 const ids=new Map(),parent={insertBefore(el){ids.set(el.id,el);}};
 const campaigns={parentNode:parent};
 const document={
  createElement:()=>({style:{},setAttribute(){},textContent:'',id:''}),
  getElementById:id=>id==='adsCampaignsArea'?campaigns:ids.get(id)||null
 };
 const window={_DEMO_MODE:false,_adsLastData:{demo:true}};
 const notifications=[];
 const funcs=new Function('window','document','toast',fragment('function _adsIsReadOnly(){','function _adsQueueMutation(mutation){')+'return {_adsIsReadOnly,_adsRenderReadOnlyBanner,_adsRequireLive};')(window,document,(...args)=>notifications.push(args));
 assert.equal(funcs._adsIsReadOnly(),true);
 assert.equal(funcs._adsRequireLive(),false);
 assert.match(ids.get('adsReadonlyBanner').textContent,/SOLO LECTURA/);
 assert.equal(notifications.length,1);
 window._adsLastData={ok:true,demo:false};
 assert.equal(funcs._adsRequireLive(),true);
 funcs._adsRenderReadOnlyBanner(); // loadAdsData refreshes this when real data arrives
 assert.equal(ids.get('adsReadonlyBanner').style.display,'none');
 window._DEMO_MODE=true;
 assert.equal(funcs._adsIsReadOnly(),true);
});
test('every high-risk Ads write path checks the read-only guard before other operations',()=>{
 for(const [start,end] of [
  ['function _adsQueueMutation(mutation){','function saveCampaignMutation(){'],
  ['function openCreateCampaign(){','function openEditCampaign('],
  ['function openEditCampaign(','function closeAdsCampaignModal(){'],
  ['function openDeleteCampaign(','function closeAdsDeleteModal(){'],
  ['function saveCampaignMutation(){','function _adsTogglePujaObjetivo(){'],
  ['async function adsAutopilotDecide(','function _adsOffSyncNames(){'],
  ['function retryMutation(ts){','function retryAllErrors(){'],
  ['function retryAllErrors(){','async function loadAdsData(){']
 ]){
  const f=fragment(start,end);
  assert.match(f.slice(0,230),/if\(!_adsRequireLive\(\)\)return/,'unprotected '+start);
 }
 const send=fragment('function sendAdsMutation(mutation){','async function syncMutationStatuses(){');
 assert.match(send,/if\(_adsIsReadOnly\(\)\)/);
 const snapshots=fragment('async function syncAdsToAirtable(data,days){','async function loadAdsSnapshotsFromAirtable(){');
 assert.match(snapshots.slice(0,170),/if\(_adsIsReadOnly\(\)\|\|data\?\.demo\)return/);
 assert.ok((source.match(/_adsRenderReadOnlyBanner\(\)/g)||[]).length>=4);
});
