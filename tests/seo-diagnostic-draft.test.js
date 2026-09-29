#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const js=fs.readFileSync(path.join(__dirname,'../js/seo-ads.js'),'utf8');
const a=js.indexOf('async function runSEODiag(){'),b=js.indexOf('function copySEODiagSnippet(){',a);
assert.ok(a>=0&&b>a);
const src=js.slice(a,b);
function harness({draft=true,restoreFailure=false}={}){
 const steps=[],posts=[];let title='Título original';
 const ui={innerHTML:'',style:{display:''},disabled:false,textContent:''};
 const fetch=async(url,options={})=>{
  if(url.endsWith('/users/me'))return Response.json({name:'Editor',roles:['editor']});
  if(options.method==='OPTIONS')return Response.json({schema:{properties:{meta:{properties:{
    _yoast_wpseo_title:{},_yoast_wpseo_metadesc:{}
  }}}}});
  if(url.includes('status=draft'))return Response.json(draft?[{id:2,meta:{_yoast_wpseo_title:title}}]:[]);
  if(url.endsWith('/pages/2')){
   if(options.method==='POST'){
    const next=JSON.parse(options.body).meta._yoast_wpseo_title;
    posts.push({url,next});
    if(restoreFailure&&next==='Título original')return Response.json({}, {status:503});
    title=next;
   }
   return Response.json({status:'draft',meta:{_yoast_wpseo_title:title}});
  }
  throw Error('Unexpected fetch '+url);
 };
 const deps={
  getWPConfig:()=>({url:'https://wp.example',user:'editor',pass:'test'}),
  document:{getElementById:()=>ui},
  seoDiagStep:(id,icon,title,detail,color)=>steps.push({id,icon,title,detail,color}),
  fetch,wpAuthHeader:()=>({'Authorization':'Basic stub'}),
  wpPagesCache:[{id:1,meta:{_yoast_wpseo_title:'Public title',_yoast_wpseo_metadesc:'desc'}}]
 };
 const run=new Function(...Object.keys(deps),src+'\nreturn runSEODiag;')(...Object.values(deps));
 return{run,steps,posts,title:()=>title};
}
test('SEO diagnostic never alters a published page when no safe draft exists',async()=>{
 const h=harness({draft:false});await h.run();
 assert.equal(h.posts.length,0);
 assert.ok(h.steps.some(x=>x.id==='write'&&x.title.includes('omitida')));
});
test('successful SEO diagnostic writes only a draft and verifies rollback',async()=>{
 const h=harness();await h.run();
 assert.equal(h.posts.length,2);
 assert.ok(h.posts[0].url.endsWith('/pages/2'));
 assert.ok(h.posts[0].next.startsWith('__diag_test__'));
 assert.equal(h.posts[1].next,'Título original');
 assert.equal(h.title(),'Título original');
 assert.ok(h.steps.some(x=>x.id==='done'));
});
test('a failed SEO restoration is explicitly reported, never marked successful',async()=>{
 const h=harness({restoreFailure:true});await h.run();
 assert.ok(h.steps.some(x=>x.id==='restore'&&x.icon==='❌'));
 assert.ok(!h.steps.some(x=>x.id==='done'));
});
