#!/usr/bin/env node
'use strict';

/**
 * Hace autoritativa la telemetría del agente local para decisiones desatendidas.
 * El navegador puede editar configuración y aportar lecturas como fallback,
 * pero nunca puede convertir una URL de cámara en `camera=true` si el agente
 * local no obtuvo un frame real recientemente.
 */
const fs=require('fs'),path=require('path');
const SafetyPolicy=require('../js/machineops-unattended-safety.js');
const DATA_DIR=process.env.FARM_DATA_DIR||path.join(__dirname,'data');
const AGENT_FILE=process.env.FARM_SAFETY_AGENT_FILE||path.join(DATA_DIR,'safety-agent.json');
const MAX_AGE_MS=Math.max(30000,Number(process.env.FARM_SAFETY_AGENT_MAX_AGE_MS||180000));
const originalEvaluate=SafetyPolicy.evaluateSnapshot;

function readAgent(){try{return JSON.parse(fs.readFileSync(AGENT_FILE,'utf8'))||null;}catch(_){return null;}}
function effectiveSnapshot(raw,now=Date.now()){
  const base=SafetyPolicy.normalizeSnapshot(raw),agent=readAgent(),at=Number(agent?.updatedAt||agent?.agent?.updatedAt||0),fresh=!!at&&now>=at-60000&&now-at<=MAX_AGE_MS;
  if(fresh){
    return{...base,version:2,reading:agent.reading||base.reading,cameras:agent.cameras&&typeof agent.cameras==='object'?{...agent.cameras}:{},cameraHealth:agent.cameraHealth||{},agent:{...(agent.agent||{}),fresh:true,ageMs:Math.max(0,now-at)}};
  }
  // El agente ausente/vencido es un fallo de seguridad para trabajos largos o
  // nocturnos: ninguna cámara se considera confirmada y la lectura ambiental
  // queda offline. Para trabajos cortos diurnos la política sigue sin bloquear.
  const reading=base.reading?{...base.reading,online:false,error:'agente de seguridad ausente o vencido'}:null;
  return{...base,version:2,reading,cameras:{},cameraHealth:{},agent:{fresh:false,updatedAt:at||0,ageMs:at?Math.max(0,now-at):null,error:'agente de seguridad ausente o vencido'}};
}
function evaluateAuthoritative(raw,job,now=Date.now(),hourOverride){return originalEvaluate(effectiveSnapshot(raw,now),job,now,hourOverride);}
SafetyPolicy.evaluateSnapshot=evaluateAuthoritative;
module.exports={readAgent,effectiveSnapshot,evaluateAuthoritative,MAX_AGE_MS,AGENT_FILE};
