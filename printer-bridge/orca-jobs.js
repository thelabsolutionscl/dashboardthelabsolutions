'use strict';
// Trabajos de laminado efimeros: no print/start, sin persistencia de modelos ni credenciales.
// Separa POST /jobs (respuesta inmediata) de poll y descarga para evitar timeouts del tunnel.
const crypto=require('node:crypto');
const {MAX_GCODE}=require('./orca-mcp.js');
const JOB_TTL_MS=10*60*1000;
function createOrcaJobs(sliceFn){
  const jobs=new Map();
  function prune(now=Date.now()){
    for(const [id,job] of jobs){
      if(job.finishedAt && now-job.finishedAt>JOB_TTL_MS)jobs.delete(id);
    }
  }
  function get(id){
    prune();
    if(typeof id!=='string'||!/^[a-f0-9]{48}$/.test(id))return null;
    return jobs.get(id)||null;
  }
  function publicJob(job){
    if(!job)return null;
    const {id,state,createdAt,finishedAt,filename,bytes,seconds,grams,error,warnings,activePresets,gcodeCheck,technicalAnalysis}=job;
    return{ok:true,jobId:id,state,createdAt,finishedAt,
      filename,bytes,seconds,grams,error,warnings:state==='done'?warnings:undefined,
      activePresets:state==='done'?activePresets:undefined,
      gcodeCheck:state==='done'?gcodeCheck:undefined,
      technicalAnalysis:state==='done'?technicalAnalysis:undefined};
  }
  function start(input){
    prune();
    if([...jobs.values()].some(j=>j.state==='running')){
      const error=new Error('Ya hay un laminado en curso. Consulta el trabajo anterior antes de volver a enviar el modelo.');
      error.statusCode=409;
      throw error;
    }
    // El navegador solo conserva el trabajo mas reciente. No retener varios G-code enormes en RAM.
    jobs.clear();
    const id=crypto.randomBytes(24).toString('hex');
    const job={id,state:'running',createdAt:Date.now(),finishedAt:0,
      filename:'',bytes:0,seconds:null,grams:null,error:'',gcode:null,warnings:[],
      activePresets:null,gcodeCheck:null,technicalAnalysis:null,facts:null};
    jobs.set(id,job);
    Promise.resolve().then(()=>sliceFn(input)).then(result=>{
      if(!result?.ok||typeof result.gcodeBase64!=='string')throw Error('El servidor MCP no entrego un G-code.');
      const binary=Buffer.from(result.gcodeBase64,'base64');
      if(!binary.length||binary.length>MAX_GCODE)throw Error('G-code invalido o superior a 32 MB.');
      job.gcode=binary;
      job.state='done';
      job.filename=String(result.filename||'laminado.gcode').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,110);
      job.bytes=binary.length;
      job.seconds=result.seconds??null;
      job.grams=result.grams??null;
      job.activePresets=result.activePresets||null;
      job.gcodeCheck=result.gcodeCheck||null;
      job.technicalAnalysis=result.technicalAnalysis||null;
      job.facts={activePresets:job.activePresets,gcodeCheck:job.gcodeCheck,
        technicalAnalysis:job.technicalAnalysis,machineModel:result.machineModel,material:result.material,
        seconds:job.seconds,grams:job.grams};
      job.warnings=Array.isArray(result.warnings)?result.warnings.slice(0,10).map(x=>String(x).slice(0,200)):[];
    }).catch(e=>{
      job.state='error';
      job.error=String(e?.message||'Error de laminado').slice(0,320);
      job.gcode=null;
    }).finally(()=>{job.finishedAt=Date.now();});
    return publicJob(job);
  }
  return{start,get,publicJob,prune};
}
module.exports={createOrcaJobs,JOB_TTL_MS};
