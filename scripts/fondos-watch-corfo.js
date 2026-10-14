#!/usr/bin/env node
'use strict';
/* Sentinel Corfo: revisa fuentes oficiales del catálogo y genera una lista
   de cambios para revisión humana, sin crear alertas ni fechas automáticamente.
   Es intencionalmente conservador: no usa fechas de tarjetas ajenas.
*/
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const CATALOG=path.join(ROOT,'data/fondos-concursables.json');
const OUTPUT=path.join(ROOT,'data/fondos-corfo-por-revisar.json');
const MAX_BODY=1500000;
const OFFICIAL=new Set(['www.corfo.gob.cl','corfo.gob.cl','www.corfo.cl','corfo.cl']);
function sanitize(html){
  return String(html||'')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<!--[\s\S]*?-->/g,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/\s+/g,' ').trim();
}
function official(url){try{const u=new URL(url);return u.protocol==='https:'&&OFFICIAL.has(u.hostname);}catch{return false;}}
function signal(html){
  const text=sanitize(html);
  // No confiar en la tabla general de programas para generar aperturas:
  // extraer menciones solo para revisión de un ser humano.
  const observations=[];
  const patterns=[
    /(?:Apertura|Fecha Inicio|Inicio Postulaci[oó]n|Postulaciones Abiertas)\s*:?\s*(.{0,100})/gi,
    /(?:Cierre|Fecha T[eé]rmino|Termino Postulaci[oó]n|Postulaciones Cerradas)\s*:?\s*(.{0,100})/gi,
    /(?:20(?:25|26|27)[-/]\d{2}[-/]\d{2}|\d{2}[-/]\d{2}[-/]20(?:25|26|27))\b/g
  ];
  for(const re of patterns){
    for(const match of text.matchAll(re)){
      const val=match[0].replace(/\s+/g,' ').trim().slice(0,135);
      if(!observations.includes(val))observations.push(val);
      if(observations.length>=20)break;
    }
    if(observations.length>=20)break;
  }
  return observations;
}
async function audit({fetcher=fetch,records,delayMs=0}={}){
  const catalog=records||JSON.parse(fs.readFileSync(CATALOG,'utf8')).funds;
  const seen=new Set(),out=[],issues=[];
  for(const f of catalog){
    const url=f.info||f.source;
    if(!official(url)||seen.has(url))continue;
    seen.add(url);
    try{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
      let response;
      try{response=await fetcher(url,{signal:controller.signal,headers:{Accept:'text/html'}});}
      finally{clearTimeout(timer);}
      if(!response.ok)throw Error('HTTP '+response.status);
      const html=(await response.text()).slice(0,MAX_BODY);
      const markers=signal(html);
      if(!markers.length)continue;
      out.push({source:url,program:f.name,markers,review:'Corroborar cada fecha en ficha individual y bases; NO copiar automáticamente a calendario.'});
    }catch(e){issues.push({source:url,error:String(e?.message||e).slice(0,120)});}
    if(delayMs)await new Promise(r=>setTimeout(r,delayMs));
  }
  return {out:out.sort((a,b)=>a.source.localeCompare(b.source)),issues};
}
async function main(){
  const {out,issues}=await audit();
  if(!out.length){console.log('Sin cambios verificables: mantener estado anterior. Fuentes fallidas:',issues.length);return;}
  const next={schema:1,provider:'Corfo — detección previa a revisión humana',candidates:out};
  const old=JSON.parse(fs.readFileSync(OUTPUT,'utf8'));
  if(JSON.stringify(old)===JSON.stringify(next)){console.log('Corfo sin nuevos cambios observables.');return;}
  fs.writeFileSync(OUTPUT,JSON.stringify(next,null,2)+'\n');
  console.log('Corfo: '+out.length+' fichas con señales por verificar; '+issues.length+' errores. Ninguna fecha publicada automáticamente.');
}
if(require.main===module)main().catch(e=>{console.error('Corfo watcher:',e.message);process.exitCode=1;});
module.exports={sanitize,official,signal,audit};
