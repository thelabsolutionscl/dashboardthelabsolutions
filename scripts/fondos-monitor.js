#!/usr/bin/env node
'use strict';
/*
 * Daily, cautious detection of public Sercotec calls in RM / national scope.
 * NEVER auto-publishes dates into Calendario. A reviewer must open the official
 * bases and promote a confirmed call into data/fondos-concursables.json.
 *
 * Does not use Airtable, credentials, browser automation or private data.
 */
const fs=require('node:fs');
const path=require('node:path');
const SOURCE='https://widgetsercotec.sercotec.cl/Calendario';
const OUTPUT=path.join(__dirname,'../data/fondos-detectados.json');
const YEAR=2026;
const RELEVANT=/\b(?:Crece(?:\s+Sostenible|\s+Urbano)?|Kit Digital|MejoraNegocios|Pymes Globales|Negocios Digitales|Innovaci[oó]n|Productividad|Transformaci[oó]n Digital)\b/i;

function plain(html){
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<!--[\s\S]*?-->/g,' ')
    .replace(/<\/(?:a|span|div|article|section|p|h[1-6]|li|time)>/gi,'\n')
    .replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"')
    .replace(/&aacute;/gi,'á').replace(/&eacute;/gi,'é').replace(/&iacute;/gi,'í').replace(/&oacute;/gi,'ó').replace(/&uacute;/gi,'ú')
    .replace(/\r/g,'').split(/\n+/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
}
function dt(line){
  const match=String(line||'').match(/(\d{2})[-/](\d{2})[-/](20\d{2})(?:\s+(\d{2}):(\d{2}))?/);
  if(!match)return '';
  const [ ,d,m,y,h='00',min='00']=match;
  const date=new Date(Number(y),Number(m)-1,Number(d));
  if(date.getFullYear()!==Number(y)||date.getMonth()+1!==Number(m)||date.getDate()!==Number(d)||Number(h)>23||Number(min)>59)return '';
  return [y,m,d].join('-')+'T'+h+':'+min;
}
function candidates(html){
  const lines=plain(html),found=new Map();
  for(let i=0;i<lines.length;i++){
    if(!/^Inicio\s*:?\s*/i.test(lines[i]))continue;
    const before=lines.slice(Math.max(0,i-15),i);
    const name=[...before].reverse().find(s=>RELEVANT.test(s)&&!/^Inicio\b|^Cierre\b/.test(s)&&s.length>=7&&s.length<=200);
    if(!name)continue;
    let open=dt(lines[i]);
    if(!open&&i+1<lines.length)open=dt(lines[i+1]);
    if(!open||Number(open.slice(0,4))<YEAR)continue;
    let close='',region='';
    for(let j=i+1;j<Math.min(i+25,lines.length);j++){
      if(j>i+2&&/^Inicio\s*:/i.test(lines[j]))break;
      if(!close&&/^Cierre\s*:?\s*/i.test(lines[j]))close=dt(lines[j])||dt(lines[j+1]);
      if(!region&&/Regi[oó]n Metropolitana|(?:^|\s)Nacional(?:$|\s)/i.test(lines[j]))region=/Metropolitana/i.test(lines[j])?'Región Metropolitana':'Nacional';
    }
    if(!close||!region||close<open)continue;
    const cleanName=name.replace(/^[^A-Za-zÁÉÍÓÚáéíóúÑñ]+/,'').trim().slice(0,180);
    const id=cleanName.toLocaleLowerCase('es-CL').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90)+'-'+open.slice(0,10);
    found.set(id,{id,title:cleanName,region,open,close,source:SOURCE,review:'Requiere revisar bases, alcance regional y elegibilidad TLS; NO publicar al calendario automáticamente.'});
  }
  return [...found.values()].sort((a,b)=>a.open.localeCompare(b.open)||a.id.localeCompare(b.id));
}
async function main(){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  let page;
  try{
    const response=await fetch(SOURCE,{signal:controller.signal,headers:{'User-Agent':'TheLab-FondosCatalogReview/1.0'}});
    if(!response.ok)throw Error('Sercotec HTTP '+response.status);
    page=await response.text();
  }finally{clearTimeout(timer);}
  if(page.length<1000)throw Error('Sercotec source unexpectedly small; preserve review list');
  const fresh=candidates(page),existing=JSON.parse(fs.readFileSync(OUTPUT,'utf8'));
  // The source sometimes returns an empty region/category result. That must
  // not wipe the last known candidates.
  if(!fresh.length){console.log('No eligible dated RM/national calls detected; no changes made.');return;}
  const previous=existing.candidates||[];
  if(JSON.stringify(previous)===JSON.stringify(fresh)){console.log('No new or changed calls detected.');return;}
  const result={schema:1,provider:'Sercotec (detección pendiente de revisión humana)',source:SOURCE,candidates:fresh};
  fs.writeFileSync(OUTPUT,JSON.stringify(result,null,2)+'\n','utf8');
  console.log('Review required for '+fresh.length+' potential calls. No calendar dates were auto-published.');
}
if(require.main===module)main().catch(e=>{console.error('Funding discovery failed:',e.message);process.exitCode=1;});
module.exports={plain,dt,candidates};
