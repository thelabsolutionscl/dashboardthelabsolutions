'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createOrcaJobs,JOB_TTL_MS}=require('../printer-bridge/orca-jobs.js');

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const valid=()=>({
  ok:true,filename:'pieza.gcode',gcodeBase64:Buffer.from('; slicer\nG1 X5 Y6\n').toString('base64'),
  seconds:123,grams:9.8,warnings:[]
});
test('POST asincrono retorna un identificador sin esperar el laminado',async()=>{
  let finish;
  const jobs=createOrcaJobs(()=>new Promise(resolve=>{finish=resolve;}));
  const created=jobs.start({filename:'pieza.stl'});
  assert.match(created.jobId,/^[a-f0-9]{48}$/);
  assert.equal(created.state,'running');
  await tick();
  assert.throws(()=>jobs.start({filename:'otro.stl'}),e=>e.statusCode===409);
  finish(valid());
  await tick();
  const done=jobs.publicJob(jobs.get(created.jobId));
  assert.equal(done.state,'done');
  assert.equal(done.filename,'pieza.gcode');
  assert.equal(done.bytes,Buffer.from(valid().gcodeBase64,'base64').length);
  assert.equal(done.seconds,123);
  assert.equal(done.gcodeBase64,undefined);
  assert.match(jobs.get(created.jobId).gcode.toString(),/G1 X5/);
});
test('permite recibir el error del servidor sin reintentar el laminado',async()=>{
  const jobs=createOrcaJobs(async()=>{throw new Error('La placa contiene modelos');});
  const started=jobs.start({});
  await tick();
  const finished=jobs.publicJob(jobs.get(started.jobId));
  assert.equal(finished.ok,true);
  assert.equal(finished.state,'error');
  assert.match(finished.error,/placa contiene/);
  assert.equal(finished.gcode,undefined);
});
test('rechaza G-code excesivo y no expone bytes en estado JSON',async()=>{
  const jobs=createOrcaJobs(async()=>({...valid(),gcodeBase64:Buffer.alloc(32*1024*1024+1).toString('base64')}));
  const started=jobs.start({});
  await tick();
  const job=jobs.get(started.jobId);
  assert.equal(job.state,'error');
  assert.match(job.error,/32 MB/);
});
test('caduca trabajos completos tras TTL, sin afectar trabajos activos',async()=>{
  let done;
  const jobs=createOrcaJobs(()=>new Promise(resolve=>{done=resolve;}));
  const started=jobs.start({});
  await tick();
  jobs.prune(Date.now()+JOB_TTL_MS*3);
  assert.equal(jobs.get(started.jobId).state,'running');
  done(valid());
  await tick();
  const finished=jobs.get(started.jobId);
  jobs.prune(finished.finishedAt+JOB_TTL_MS+1);
  assert.equal(jobs.get(started.jobId),null);
});
