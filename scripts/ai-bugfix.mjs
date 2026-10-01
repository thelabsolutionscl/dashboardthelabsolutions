#!/usr/bin/env node
'use strict';

import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';

const BASE='app1YtD74AqiPWQhy';
const TABLE='Monitor Sistema';
const META='BUG_REPORT_META:';
const IMG='BUG_REPORT_IMG:';
const AIRTABLE=String(process.env.AIRTABLE_TOKEN||'').trim();
const PROXY=String(process.env.PROXY_URL||'').trim().replace(/\/$/,'');
const GH_TOKEN=String(process.env.GH_TOKEN||'').trim();
const REPO=String(process.env.GITHUB_REPOSITORY||'thelabsolutionscl/dashboardthelabsolutions');
const MAX_ATTEMPTS=3;

if(!AIRTABLE||!PROXY||!GH_TOKEN)throw new Error('Faltan AIRTABLE_TOKEN, PROXY_URL o GH_TOKEN');
if(REPO!=='thelabsolutionscl/dashboardthelabsolutions')throw new Error('Repositorio no autorizado');

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function sh(cmd,args,opts={}){
  return execFileSync(cmd,args,{encoding:'utf8',stdio:opts.stdio||['ignore','pipe','pipe'],...opts}).trim();
}
function safeJson(s){try{return JSON.parse(s);}catch(_){return null;}}
function isId(id){return /^br_[a-z0-9]{12,28}$/.test(String(id||''));}
function repair(meta,patch){
  meta.repair={...(meta.repair||{}),...patch,updatedAt:new Date().toISOString()};
  return meta;
}
function formulaExact(name){
  return '{Name}="'+String(name).replace(/"/g,'\\"')+'"';
}
async function airtable(path,options={}){
  const r=await fetch('https://api.airtable.com/v0/'+BASE+'/'+encodeURIComponent(TABLE)+path,{
    ...options,headers:{Authorization:'Bearer '+AIRTABLE,...(options.headers||{})}
  });
  let data={};try{data=await r.json();}catch(_){}
  if(!r.ok)throw new Error('Airtable '+r.status+': '+String(data?.error?.message||data?.error||'error').slice(0,300));
  return data;
}
async function listRows(formula,max=300){
  const out=[];let offset='';
  do{
    const q=new URLSearchParams({pageSize:'100',filterByFormula:formula});
    q.append('fields[]','Name');q.append('fields[]','Notes');
    if(offset)q.set('offset',offset);
    const data=await airtable('?'+q.toString());
    out.push(...(Array.isArray(data.records)?data.records:[]));
    offset=typeof data.offset==='string'?data.offset:'';
  }while(offset&&out.length<max);
  return out.slice(0,max);
}
async function listReports(){
  const rows=await listRows('LEFT({Name},16)="'+META+'"');
  const out=[];
  for(const row of rows){
    const meta=safeJson(row?.fields?.Notes);
    if(meta&&isId(meta.id)&&row.fields?.Name===META+meta.id)out.push({recordId:row.id,meta});
  }
  return out;
}
async function imageFor(id){
  const rows=await listRows(formulaExact(IMG+id),2);
  if(rows.length!==1)return '';
  const raw=String(rows[0]?.fields?.Notes||'');
  return /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(raw)&&raw.length<=44000?raw:'';
}
async function save(row){
  await airtable('/'+row.recordId,{
    method:'PATCH',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({fields:{Notes:JSON.stringify(row.meta)}})
  });
}
async function update(row,status,patch={}){
  row.meta.status=status;repair(row.meta,patch);await save(row);
}
function ghJson(args){return safeJson(sh('gh',args))||{};}
async function reconcileExisting(rows){
  for(const row of rows){
    const m=row.meta,r=m.repair||{};
    if(m.status==='pr_creado'&&Number.isInteger(r.prNumber)){
      let pr={};try{pr=ghJson(['pr','view',String(r.prNumber),'--repo',REPO,'--json','state,mergedAt,url']);}catch(_){continue;}
      if(pr.mergedAt){
        await update(row,'resuelto',{analysis:r.analysis||'Reparación fusionada y publicada en main.',prUrl:pr.url||r.prUrl,error:''});
      }else if(pr.state==='CLOSED'){
        await update(row,'needs_review',{error:'El PR de reparación fue cerrado sin merge.'});
      }
      continue;
    }
    if(['analizando','reparando'].includes(m.status)){
      const age=Date.now()-Date.parse(r.updatedAt||m.createdAt||0);
      if(Number.isFinite(age)&&age>2*60*60*1000){
        const attempts=Number(r.attempts||0);
        await update(row,attempts<MAX_ATTEMPTS?'nuevo':'error',{
          error:attempts<MAX_ATTEMPTS?'Ejecución anterior interrumpida; reintentando automáticamente.':'La reparación IA se interrumpió varias veces.'
        });
      }
    }
  }
}
async function oidcToken(){
  const base=String(process.env.ACTIONS_ID_TOKEN_REQUEST_URL||'');
  const bearer=String(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN||'');
  if(!base||!bearer)throw new Error('GitHub Actions OIDC no disponible');
  const u=new URL(base);u.searchParams.set('audience','tls-dashboard-bugfix');
  const r=await fetch(u,{headers:{Authorization:'Bearer '+bearer}});
  const d=await r.json();
  if(!r.ok||typeof d.value!=='string')throw new Error('No se pudo obtener token OIDC');
  return d.value;
}
async function ai(stage,body){
  const token=await oidcToken();
  const r=await fetch(PROXY+'/service/github/bugfix-ai',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({stage,...body})
  });
  let d={};try{d=await r.json();}catch(_){}
  if(!r.ok||d.ok!==true)throw new Error(String(d.error||('Bugfix AI HTTP '+r.status)).slice(0,700));
  return d.result;
}
function trackedFiles(){
  const all=sh('git',['ls-files']).split('\n').filter(Boolean);
  const allowed=all.filter(p=>
    /^(?:index\.html|manual\.html|styles\.css|mail-api\.php|js\/|tests\/|docs\/)/.test(p)&&
    !/^docs\/security\//.test(p)&&
    !/^vendor\//.test(p)&&
    !/\.(?:png|jpe?g|gif|webp|pdf|zip|csv|woff2?|ttf|ico)$/i.test(p)
  );
  return allowed.slice(0,1400);
}
const FORBIDDEN_PATCH=[
  /^\.github\//,/^airtable-proxy\//,/^lead-worker\//,/^sii-worker\//,/^printer-bridge\//,
  /^docs\/security\//,/^SECURITY\.md$/,/access-auth/i,/wrangler\.toml$/i,/secrets?/i
];
const NO_AUTOMERGE=[
  /^index\.html$/,/^mail-api\.php$/,/^js\/finanzas\.js$/,/^js\/auth/i,/^js\/.*sii/i,
  /^js\/.*factur/i,/^tests\/access-/,/^tests\/.*security/i
];
function forbidden(path){return FORBIDDEN_PATCH.some(r=>r.test(path));}
function noAutomerge(path){return NO_AUTOMERGE.some(r=>r.test(path));}
function count(hay,needle){
  if(!needle)return 0;let n=0,pos=0;
  while((pos=hay.indexOf(needle,pos))>=0){n++;pos+=needle.length;}
  return n;
}
function excerpt(path,queries){
  const raw=readFileSync(path,'utf8');
  if(raw.length<=18000)return raw;
  const lines=raw.split('\n'),hits=new Set();
  for(const q of queries||[]){
    const needle=String(q||'').toLowerCase();if(!needle)continue;
    lines.forEach((line,i)=>{if(line.toLowerCase().includes(needle))for(let x=Math.max(0,i-28);x<=Math.min(lines.length-1,i+28);x++)hits.add(x);});
  }
  if(!hits.size){
    for(let i=0;i<Math.min(120,lines.length);i++)hits.add(i);
  }
  const ordered=[...hits].sort((a,b)=>a-b);
  let out='',last=-2;
  for(const i of ordered){
    if(i!==last+1)out+='\n/* … fragmento omitido … */\n';
    out+=String(i+1).padStart(6,' ')+' | '+lines[i]+'\n';last=i;
    if(out.length>=18000)break;
  }
  return out.slice(0,18000);
}
function sourceBundle(plan,files){
  const wanted=(plan.files||[]).filter(p=>files.includes(p)&&existsSync(p)&&!forbidden(p));
  const result=[];let total=0;
  for(const path of wanted){
    const content=excerpt(path,plan.queries||[]);
    if(total+content.length>48000)break;
    result.push({path,content});total+=content.length;
  }
  return result;
}
function applyEdits(result,available){
  const changed=new Set();
  for(const edit of result.edits||[]){
    if(!available.includes(edit.path)||forbidden(edit.path))throw new Error('Ruta de parche no permitida: '+edit.path);
    const raw=readFileSync(edit.path,'utf8'),occ=count(raw,edit.find);
    if(occ!==1)throw new Error('El bloque a reemplazar no es único en '+edit.path+' ('+occ+')');
    const next=raw.replace(edit.find,edit.replace);
    if(next===raw)throw new Error('La edición no produjo cambios en '+edit.path);
    writeFileSync(edit.path,next);changed.add(edit.path);
  }
  return [...changed];
}
function testPatch(changed){
  for(const path of changed.filter(p=>p.endsWith('.js'))){
    const r=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});
    if(r.status!==0)throw new Error('Syntax check falló en '+path+': '+String(r.stderr||r.stdout).slice(-1500));
  }
  if(changed.some(p=>p.endsWith('.php'))){
    const r=spawnSync('php',['-l',...changed.filter(p=>p.endsWith('.php'))],{encoding:'utf8'});
    if(r.status!==0)throw new Error('PHP lint falló: '+String(r.stderr||r.stdout).slice(-1500));
  }
  const tests=spawnSync(process.execPath,['--test','tests/*.test.js'],{encoding:'utf8',shell:true,maxBuffer:12*1024*1024});
  if(tests.status!==0)throw new Error('Tests fallaron:\n'+String(tests.stdout||'').slice(-5000)+'\n'+String(tests.stderr||'').slice(-1500));
}
function cleanTitle(message){
  const one=String(message||'Problema reportado').replace(/\s+/g,' ').trim();
  return one.length>72?one.slice(0,69)+'…':one;
}
async function main(){
  sh('git',['config','user.name','tls-ai-repair[bot]']);
  sh('git',['config','user.email','tls-ai-repair@users.noreply.github.com']);
  let rows=await listReports();
  await reconcileExisting(rows);
  rows=await listReports();
  const pending=rows.filter(r=>r.meta.status==='nuevo').sort((a,b)=>Date.parse(a.meta.createdAt)-Date.parse(b.meta.createdAt))[0];
  if(!pending){console.log('Sin reportes pendientes.');return;}

  const m=pending.meta,attempts=Number(m.repair?.attempts||0)+1;
  await update(pending,'analizando',{attempts,error:'',analysis:'Analizando el reporte y localizando el código relacionado.'});
  try{
    const screenshot=await imageFor(m.id);
    const repoMap=trackedFiles();
    const report={id:m.id,message:m.message,section:m.section||'',path:m.path||'',build:m.build||'',...(screenshot?{screenshot}:{})};
    const plan=await ai('plan',{report,repoMap});
    await update(pending,'reparando',{attempts,analysis:plan.analysis,error:''});

    if(plan.risk==='high'||(plan.files||[]).some(forbidden)){
      await update(pending,'needs_review',{attempts,analysis:plan.analysis,
        error:'La IA detectó que el problema toca un área de alto riesgo. Se requiere revisión antes de modificar producción.'});
      return;
    }

    const files=sourceBundle(plan,repoMap);
    if(!files.length)throw new Error('La IA no pudo localizar archivos seguros para reparar');
    const patch=await ai('patch',{report:{id:m.id,message:m.message,section:m.section||'',path:m.path||'',build:m.build||''},plan,files});
    if(patch.risk==='high')throw new Error('El parche fue clasificado como alto riesgo');
    const changed=applyEdits(patch,files.map(f=>f.path));
    if(!changed.length)throw new Error('La IA no produjo cambios');
    testPatch(changed);

    const branch='ai-fix/'+m.id;
    sh('git',['checkout','-b',branch]);
    sh('git',['add','--',...changed]);
    sh('git',['commit','-m','fix(ai): '+cleanTitle(m.message)+' ('+m.id+')']);
    sh('git',['push','-u','origin',branch]);

    const body=[
      'Reparación automática generada desde **Mi cuenta → Reportar problema**.',
      '',
      '**Reporte:** '+m.id,
      '**Sección:** '+(m.section||'Dashboard'),
      '',
      '**Descripción**',
      m.message,
      '',
      '**Análisis IA**',
      plan.analysis,
      '',
      '**Parche**',
      patch.summary,
      '',
      '**Archivos:** '+changed.map(x=>'`'+x+'`').join(', '),
      '',
      'Las pruebas del repositorio pasaron antes de crear este PR.'
    ].join('\n');
    writeFileSync('/tmp/tls-bugfix-pr.md',body);
    const prUrl=sh('gh',['pr','create','--repo',REPO,'--base','main','--head',branch,
      '--title','fix(ai): '+cleanTitle(m.message),'--body-file','/tmp/tls-bugfix-pr.md']);
    const pr=ghJson(['pr','view',prUrl,'--repo',REPO,'--json','number,url,state,mergedAt']);
    const auto=patch.risk==='low'&&changed.every(p=>!noAutomerge(p));
    let status=auto?'pr_creado':'needs_review',error=auto?'':'PR generado por IA; requiere revisión humana antes del merge.';
    await update(pending,status,{attempts,analysis:plan.analysis,prUrl:pr.url||prUrl,prNumber:pr.number,
      branch,changedFiles:changed,error});

    if(auto){
      try{
        sh('gh',['pr','merge',String(pr.number),'--repo',REPO,'--squash','--auto']);
      }catch(e){
        console.log('Auto-merge no disponible; PR queda abierto:',String(e.message||e).slice(0,300));
      }
      await sleep(1200);
      let after={};try{after=ghJson(['pr','view',String(pr.number),'--repo',REPO,'--json','state,mergedAt,url']);}catch(_){}
      if(after.mergedAt)await update(pending,'resuelto',{attempts,analysis:plan.analysis,prUrl:after.url||prUrl,
        prNumber:pr.number,branch,changedFiles:changed,error:''});
    }
  }catch(e){
    try{sh('git',['reset','--hard','HEAD']);}catch(_){}
    const msg=String(e?.message||e).slice(0,2800);
    await update(pending,attempts<MAX_ATTEMPTS?'nuevo':'error',{attempts,error:msg,
      analysis:pending.meta.repair?.analysis||'La reparación automática no pudo completarse.'});
    if(attempts<MAX_ATTEMPTS)console.log('Reparación falló; quedará para reintento automático:',msg);
    else console.error('Reparación agotó reintentos:',msg);
    if(attempts>=MAX_ATTEMPTS)process.exitCode=1;
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
