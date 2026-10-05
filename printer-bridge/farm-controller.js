#!/usr/bin/env node
'use strict';

/**
 * The Lab Solutions — Farm Controller
 * Capa de control delante del printer-bridge legado.
 * - cola durable en disco, independiente del navegador
 * - registry con identidad estable y discovery LAN
 * - autorización por roles viewer/operator/admin
 * - CORS cerrado al dashboard por defecto
 * - compatibilidad hacia atrás con el mismo túnel y ?bt=TOKEN
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const SafetyPolicy = require('../js/machineops-unattended-safety.js');

const ROOT = __dirname;
const DATA_DIR = process.env.FARM_DATA_DIR || path.join(ROOT, 'data');
const QUEUE_FILE = process.env.FARM_QUEUE_FILE || path.join(DATA_DIR, 'queue.json');
const REGISTRY_FILE = process.env.FARM_REGISTRY_FILE || path.join(DATA_DIR, 'registry.json');
const SAFETY_FILE = process.env.FARM_SAFETY_FILE || path.join(DATA_DIR, 'safety.json');
const OPERATIONS_FILE = process.env.FARM_OPERATIONS_FILE || path.join(DATA_DIR, 'operations.json');
const AUDIT_LEGACY_FILE = process.env.FARM_AUDIT_FILE || path.join(DATA_DIR, 'printer-audits.json');
const AUDIT_DIR = process.env.FARM_AUDIT_DIR || path.join(DATA_DIR, 'printer-audits');
const AUDIT_INDEX_FILE = path.join(AUDIT_DIR, 'index.json');
const PAYLOAD_DIR = process.env.FARM_PAYLOAD_DIR || path.join(DATA_DIR, 'payloads');
const PUBLIC_PORT = Number(process.env.BRIDGE_PORT || 8347);
const LEGACY_PORT = Number(process.env.LEGACY_BRIDGE_PORT || 8348);
const DASHBOARD_ORIGIN = process.env.BRIDGE_ALLOW_ORIGIN || 'https://dashboard.thelab.solutions';
const DISCOVERY_PREFIX = process.env.FARM_LAN_PREFIX || '192.168.100.';
const DISCOVERY_INTERVAL_MS = Math.max(60_000, Number(process.env.FARM_DISCOVERY_INTERVAL_MS || 10 * 60_000));
const MAX_BODY = 64 * 1024 * 1024;
const UPDATE_ENABLED = process.env.BRIDGE_UPDATE !== '0';
const REPO_DIR = process.env.BRIDGE_REPO_DIR || path.resolve(ROOT, '..');

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(PAYLOAD_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(AUDIT_DIR, { recursive: true, mode: 0o700 });

async function atomicWrite(file, value) {
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
  await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await fs.promises.rename(tmp, file);
}
function payloadPath(jobOrId) {
  const id=String(typeof jobOrId==='object'?jobOrId?.id:jobOrId||'').replace(/[^A-Za-z0-9_.-]/g,'_');
  return id?path.join(PAYLOAD_DIR,id+'.gcode'):'';
}
async function writePayload(id,base64) {
  const file=payloadPath(id),tmp=file+'.tmp-'+process.pid+'-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex');
  if(!file)throw new Error('id de payload inválido');
  const bytes=Buffer.from(String(base64||''),'base64');
  if(!bytes.length)throw new Error('payload G-code vacío');
  await fs.promises.writeFile(tmp,bytes,{mode:0o600});
  await fs.promises.rename(tmp,file);
  return{file:path.basename(file),bytes:bytes.length};
}
async function readPayload(job) {
  const file=job?.payloadFile?path.join(PAYLOAD_DIR,path.basename(String(job.payloadFile))):payloadPath(job);
  try{return await fs.promises.readFile(file);}catch(_){
    return Buffer.from(String(job?.gcodeBase64||''),'base64');
  }
}
async function deletePayload(job) {
  const file=job?.payloadFile?path.join(PAYLOAD_DIR,path.basename(String(job.payloadFile))):payloadPath(job);
  if(!file)return;
  try{await fs.promises.unlink(file);}catch(e){if(e?.code!=='ENOENT')console.warn('[queue] payload cleanup',e.message);}
}
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; } }
function uid(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + crypto.randomBytes(5).toString('hex'); }
function nowIso() { return new Date().toISOString(); }
function safeEq(a, b) {
  const aa = Buffer.from(String(a || '')), bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}
function isPrivateIp(ip) {
  const m = String(ip || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some(x => x < 0 || x > 255)) return false;
  return o[0] === 10 || o[0] === 127 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
}
function cleanPrintFilename(value) {
  const s = String(value || '').replace(/\\/g, '/');
  return decodeURIComponentSafe(s.split('/').pop() || '').trim().toLowerCase();
}
function decodeURIComponentSafe(value) { try { return decodeURIComponent(value); } catch (_) { return value; } }
function samePrintFilename(a, b) { return !!a && !!b && cleanPrintFilename(a) === cleanPrintFilename(b); }
function fileKey(value) {
  return cleanPrintFilename(value).replace(/\.(gcode|gco|3mf)$/i,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'');
}
function bedSignatureFromPrintStats(ps={}) {
  return [fileKey(ps.filename||''),Math.round(Number(ps.print_duration||0)),String(ps.state||'')].join('|');
}
const QUEUE_ACTIVE_STATES=new Set(['queued','retry','checking','uploading','uploaded','started','printing','paused']);
const QUEUE_TERMINAL_STATES=new Set(['completed','cancelled','failed']);

function loadOrCreateMasterToken() {
  if (process.env.BRIDGE_TOKEN) return process.env.BRIDGE_TOKEN.trim();
  const file = path.join(ROOT, '.bridge-token');
  try { const t = fs.readFileSync(file, 'utf8').trim(); if (t) return t; } catch (_) {}
  const t = crypto.randomBytes(24).toString('base64url');
  fs.writeFileSync(file, t + '\n', { mode: 0o600 });
  return t;
}
const MASTER_TOKEN = loadOrCreateMasterToken();
const TOKENS = {
  admin: (process.env.BRIDGE_ADMIN_TOKEN || MASTER_TOKEN).trim(),
  operator: (process.env.BRIDGE_OPERATOR_TOKEN || '').trim(),
  viewer: (process.env.BRIDGE_VIEWER_TOKEN || '').trim(),
};
const INTERNAL_TOKEN = crypto.randomBytes(32).toString('base64url');
const ROLE_RANK = { viewer: 1, operator: 2, admin: 3 };
const SESSION_TTL_MS = Math.max(60_000, Math.min(30*60_000, Number(process.env.BRIDGE_SESSION_TTL_MS || 10*60_000)));
const sessionTokens = new Map();
function purgeSessions(now=Date.now()) {
  for(const [token,row] of sessionTokens)if(!row||row.expiresAt<=now)sessionTokens.delete(token);
}
function issueSession(role) {
  purgeSessions();
  const token=crypto.randomBytes(24).toString('base64url'),expiresAt=Date.now()+SESSION_TTL_MS;
  sessionTokens.set(token,{role,expiresAt});
  return{token,role,expiresAt};
}
function tokenFromReq(req) {
  const u = new URL(req.url, 'http://farm.local');
  return String(req.headers['x-bridge-token'] || u.searchParams.get('bt') || '');
}
function roleForToken(token) {
  if (TOKENS.admin && safeEq(token, TOKENS.admin)) return 'admin';
  if (TOKENS.operator && safeEq(token, TOKENS.operator)) return 'operator';
  if (TOKENS.viewer && safeEq(token, TOKENS.viewer)) return 'viewer';
  purgeSessions();
  const session=sessionTokens.get(String(token||''));
  return session&&session.expiresAt>Date.now()?session.role:'';
}
// Los preloads se cargan antes que este módulo, pero resuelven roles en tiempo de petición.
// Compartir el resolver canónico permite que acepten también tickets efímeros /farm/session.
globalThis.__TLS_FARM_ROLE_FOR_TOKEN__ = roleForToken;

function requireRole(req, res, minimum) {
  const role = roleForToken(tokenFromReq(req));
  if (!role || ROLE_RANK[role] < ROLE_RANK[minimum]) {
    json(res, 403, { ok: false, error: 'forbidden', requiredRole: minimum });
    return '';
  }
  return role;
}

function normalizeQueue(raw) {
  const q = raw && typeof raw === 'object' ? raw : {};
  return { version: 1, updatedAt: q.updatedAt || 0, jobs: Array.isArray(q.jobs) ? q.jobs : [] };
}
function recoverQueueJobs(q) {
  let recovered = 0;
  for (const j of (q && Array.isArray(q.jobs) ? q.jobs : [])) {
    if (['checking', 'uploading', 'uploaded'].includes(j.state)) {
      j.state = 'retry';
      j.lastError = 'recuperado tras reinicio del Farm Controller';
      j.updatedAt = nowIso();
      recovered++;
    }
  }
  return recovered;
}
function normalizeRegistry(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return { version: 1, updatedAt: r.updatedAt || 0, machines: Array.isArray(r.machines) ? r.machines : [] };
}
function normalizeOperations(raw,now=Date.now()){
  const source=raw&&typeof raw==='object'?raw:{},rows=source.machines&&typeof source.machines==='object'?source.machines:{};
  const machines={};
  for(const [id,value] of Object.entries(rows)){
    const expiresAt=Number(value?.expiresAt||0);if(!id||!expiresAt||expiresAt<=now)continue;
    machines[id]={machineId:id,type:['bed_calibration','gcode','maintenance'].includes(value.type)?value.type:'gcode',label:String(value.label||'').slice(0,120),phase:String(value.phase||'').slice(0,240),source:String(value.source||'').slice(0,80),sessionId:String(value.sessionId||'').slice(0,120),startedAt:Number(value.startedAt||now),expiresAt,updatedAt:Number(value.updatedAt||now)};
  }
  return{version:1,updatedAt:Number(source.updatedAt||0),machines};
}
function sanitizeOperation(machineId,body={},now=Date.now()){
  const id=String(machineId||'').trim();if(!id)throw new Error('machineId requerido');
  const type=String(body.type||'');if(!['bed_calibration','gcode','maintenance'].includes(type))throw new Error('tipo de operación no válido');
  const startedAt=Number(body.startedAt||now),expiresAt=Math.min(now+24*60*60*1000,Math.max(now+5000,Number(body.expiresAt||now+30*60*1000)));
  return{machineId:id,type,label:String(body.label||'').slice(0,120),phase:String(body.phase||'').slice(0,240),source:String(body.source||'').slice(0,80),sessionId:String(body.sessionId||'').slice(0,120),startedAt,expiresAt,updatedAt:now};
}

const AUDIT_MAX_PER_MACHINE=80,AUDIT_MAX_BODY=512*1024,AUDIT_MAX_EVIDENCE=380*1024,AUDIT_MAX_RESULT=96*1024;
const AUDIT_FINDING_STATES=new Set(['new','reviewing','resolved','ignored']);
const AUDIT_SCAN_TTL_MS=15*60*1000;
const auditScanSessions=new Map();
const auditLocks=new Map();
function withAuditLock(key,fn){
  const k=String(key||'audit'),previous=auditLocks.get(k)||Promise.resolve();
  const run=previous.catch(()=>{}).then(fn);auditLocks.set(k,run);
  return run.finally(()=>{if(auditLocks.get(k)===run)auditLocks.delete(k);});
}
function auditJsonClone(value,maxBytes=AUDIT_MAX_EVIDENCE){
  const raw=JSON.stringify(value==null?null:value);
  if(Buffer.byteLength(raw,'utf8')>maxBytes)throw new Error('reporte de auditoría demasiado grande');
  return JSON.parse(raw);
}
function auditLegacySafeName(value){
  const out=String(value||'').replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,180);
  return !out||out==='.'||out==='..'?'':out;
}
function auditPathSegment(value){
  const raw=String(value||'').trim();if(!raw)return'';
  const base=(raw.replace(/[^A-Za-z0-9_.-]/g,'_').replace(/^\.+$/,'id').slice(0,120)||'id');
  const suffix=crypto.createHash('sha256').update(raw).digest('hex').slice(0,16);
  return base+'-'+suffix;
}
function auditPathInsideRoot(dir){
  const root=path.resolve(AUDIT_DIR)+path.sep,resolved=path.resolve(dir)+path.sep;
  return resolved.startsWith(root);
}
function auditReportPath(machineId,auditId){
  const machine=auditPathSegment(machineId),id=auditPathSegment(auditId);
  if(!machine||!id)throw new Error('identificador de auditoría inválido');
  const dir=path.resolve(AUDIT_DIR,machine);
  if(!auditPathInsideRoot(dir))throw new Error('ruta de auditoría inválida');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  return path.join(dir,id+'.json');
}
function auditLegacyReportPath(machineId,auditId){
  const machine=auditLegacySafeName(machineId),id=auditLegacySafeName(auditId);
  if(!machine||!id)return'';
  const dir=path.resolve(AUDIT_DIR,machine);
  if(!auditPathInsideRoot(dir))return'';
  return path.join(dir,id+'.json');
}
function auditHash(value){return crypto.createHash('sha256').update(JSON.stringify(value??null)).digest('hex');}
function loadOrCreateAuditSealKey(){
  const env=String(process.env.FARM_AUDIT_SEAL_KEY||'').trim();
  if(env)return Buffer.from(env,'utf8');
  const file=path.join(DATA_DIR,'.audit-seal-key');
  try{const v=fs.readFileSync(file,'utf8').trim();if(v)return Buffer.from(v,'utf8');}catch(_){}
  const generated=crypto.randomBytes(32).toString('base64url');
  try{fs.writeFileSync(file,generated+'\n',{mode:0o600});return Buffer.from(generated,'utf8');}
  catch(e){console.warn('[audits] no se pudo persistir seal key; usando derivación estable del master token:',e.message);return crypto.createHash('sha256').update('audit-seal:'+MASTER_TOKEN).digest();}
}
const AUDIT_SEAL_KEY=loadOrCreateAuditSealKey();
function auditSealPayload(report){
  return{
    version:report.version,sealVersion:report.sealVersion||0,id:report.id,machineId:report.machineId,
    requestId:report.requestId||'',createdAt:report.createdAt,actorRole:report.actorRole,clientActor:report.clientActor||'',
    model:report.model,durationMs:report.durationMs||0,sourceMatrix:report.sourceMatrix||{},cost:report.cost||null,
    scanId:report.scanId||'',evidenceHash:report.evidenceHash||'',scanEvidenceHash:report.scanEvidenceHash||'',
    result:report.result||{}
  };
}
function auditSealHash(report){
  return crypto.createHmac('sha256',AUDIT_SEAL_KEY).update(JSON.stringify(auditSealPayload(report))).digest('hex');
}
function auditByteLength(value){return Buffer.byteLength(JSON.stringify(value??null),'utf8');}
function compactAuditScanCore(value){
  const c=auditJsonClone(value,2*1024*1024);
  if(c&&typeof c==='object')delete c.cameraFrame;
  if(auditByteLength(c)<=AUDIT_MAX_EVIDENCE)return c;
  if(c?.ssh?.output)c.ssh.output=String(c.ssh.output).slice(-120000);
  if(auditByteLength(c)<=AUDIT_MAX_EVIDENCE)return c;
  if(c?.ssh?.output)c.ssh.output=String(c.ssh.output).slice(-60000);
  if(c?.moonraker?.history?.result?.jobs)c.moonraker.history.result.jobs=c.moonraker.history.result.jobs.slice(0,10);
  if(c?.moonraker?.gcodeResponses)c.moonraker.gcodeResponses=c.moonraker.gcodeResponses.slice(-30);
  if(auditByteLength(c)<=AUDIT_MAX_EVIDENCE)return c;
  if(c?.ssh?.output)c.ssh.output=String(c.ssh.output).slice(-24000);
  if(c?.moonraker?.history)c.moonraker.history={result:{jobs:(c.moonraker.history.result?.jobs||[]).slice(0,5)}};
  if(auditByteLength(c)>AUDIT_MAX_EVIDENCE)throw new Error('escaneo técnico excede el presupuesto seguro');
  return c;
}
function findingIdFor(row,index){
  const raw=[row?.area||'',row?.finding||'',row?.action||'',index].join('|');
  return 'finding-'+crypto.createHash('sha256').update(raw).digest('hex').slice(0,18);
}
function normalizeAuditResult(raw={},createdAt=nowIso()){
  const result=raw&&typeof raw==='object'&&!Array.isArray(raw)?auditJsonClone(raw,AUDIT_MAX_RESULT):{};
  const findings=Array.isArray(result.findings)?result.findings.slice(0,40):[];
  result.findings=findings.map((row,index)=>{
    const r=row&&typeof row==='object'&&!Array.isArray(row)?row:{};
    const existing=/^finding-[a-f0-9]{12,40}$/i.test(String(r.findingId||''))?String(r.findingId):findingIdFor(r,index);
    const state=AUDIT_FINDING_STATES.has(String(r.status||''))?String(r.status):'new';
    return{...r,findingId:existing,status:state,statusUpdatedAt:String(r.statusUpdatedAt||createdAt).slice(0,40),statusNote:String(r.statusNote||'').slice(0,1200)};
  });
  return result;
}
function auditResultSummary(result={}){
  const findings=Array.isArray(result.findings)?result.findings:[],counts={new:0,reviewing:0,resolved:0,ignored:0};
  for(const f of findings)counts[AUDIT_FINDING_STATES.has(f?.status)?f.status:'new']++;
  return{
    overall:String(result.overall||'unknown').slice(0,24),
    score:Math.max(0,Math.min(100,Number(result.score)||0)),
    confidence:Math.max(0,Math.min(100,Number(result.confidence)||0)),
    summary:String(result.summary||'').slice(0,1800),
    findingCount:findings.length,
    findingStates:counts,
  };
}
function auditSummaryFromReport(report){
  return{
    id:report.id,machineId:report.machineId,requestId:report.requestId||'',createdAt:report.createdAt,
    actorRole:report.actorRole,clientActor:report.clientActor||'',model:report.model||'',
    durationMs:report.durationMs||0,sourceMatrix:report.sourceMatrix||{},
    result:auditResultSummary(report.result),cost:report.cost||null,
    evidenceHash:report.evidenceHash||'',reportHash:report.reportHash||'',
    scanId:report.scanId||'',sealVersion:report.sealVersion||0,version:2,
  };
}
function auditSummaryForRole(row,role){
  if(role!=='viewer')return row;
  return{id:row.id,machineId:row.machineId,createdAt:row.createdAt,model:row.model||'',result:row.result,version:row.version||2};
}
function pruneAuditReports(rows){
  const sorted=(Array.isArray(rows)?rows:[]).filter(x=>x&&x.machineId&&x.id)
    .sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0));
  const counts=new Map(),out=[];
  for(const row of sorted){
    const id=String(row.machineId),n=counts.get(id)||0;
    if(n>=AUDIT_MAX_PER_MACHINE)continue;
    counts.set(id,n+1);out.push(row);
  }
  return out;
}
function normalizeAuditStore(raw){
  const source=raw&&typeof raw==='object'?raw:{},reports=pruneAuditReports(source.reports);
  return{version:2,updatedAt:Number(source.updatedAt||0),reports};
}
function sanitizeAuditCost(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const estimatedUsd=Math.max(0,Math.min(5,Number(raw.estimatedUsd)||0));
  return{
    currency:'USD',provenance:raw.provenance==='proxy-budget-reservation'?'client-attested-proxy-budget-reservation':'client-estimate',estimatedUsd:Number(estimatedUsd.toFixed(6)),
    textModel:String(raw.textModel||'').slice(0,80),visionModel:String(raw.visionModel||'').slice(0,80),
    textInputTokens:Math.max(0,Math.floor(Number(raw.textInputTokens)||0)),
    textOutputTokens:Math.max(0,Math.floor(Number(raw.textOutputTokens)||0)),
    visionUsed:raw.visionUsed===true,
  };
}
function deriveAuditSourceMatrix(evidence={}){
  const scan=evidence.scan||{},src=scan.sources||{},dash=evidence.dashboard||{},stability=scan.stability||{};
  return{
    moonraker:!!src.moonraker?.available,
    sshLogs:!!src.ssh?.logsCaptured,
    camera:!!src.camera?.available,
    cameraVision:!!evidence.vision?.available,
    dashboardTelemetry:!!dash.live&&typeof dash.live==='object'&&Object.keys(dash.live).length>0,
    centralHistory:!!dash.history?.durable,
    farmHealth:!!dash.central?.central,
    bedMesh:!!evidence.bed&&evidence.bed.code!=='unavailable',
    maintenance:Array.isArray(dash.maintenance),
    incidents:Array.isArray(dash.incidents),
    configDrift:!!dash.drift,
    networkStability:Number(stability.network?.total||0)>0,
    thermalStability:!!(stability.thermal?.hotend||stability.thermal?.bed)
  };
}
function purgeAuditScanSessions(now=Date.now()){
  for(const [id,row] of auditScanSessions)if(!row||row.expiresAt<=now)auditScanSessions.delete(id);
}
function issueAuditScan(machineId,diagnostics,role){
  purgeAuditScanSessions();
  const scanId=uid('scan'),core=compactAuditScanCore(diagnostics);
  const row={scanId,machineId,role,diagnostics:core,evidenceHash:auditHash(core),createdAt:nowIso(),expiresAt:Date.now()+AUDIT_SCAN_TTL_MS};
  auditScanSessions.set(scanId,row);return row;
}
function sanitizeAuditReport(machineId,body={},role='operator'){
  const idMachine=String(machineId||'').trim();
  if(!idMachine||idMachine.length>120)throw new Error('machineId inválido');
  purgeAuditScanSessions();
  const scanId=String(body.scanId||'');
  const scan=auditScanSessions.get(scanId);
  if(!scan||scan.machineId!==idMachine)throw new Error('escaneo de auditoría inválido o expirado');
  const createdAt=nowIso(),id=uid('audit');
  const requestId=/^[A-Za-z0-9_.:-]{8,180}$/.test(String(body.requestId||''))?String(body.requestId):('req-'+scanId);
  const submittedEvidence=body.evidence&&typeof body.evidence==='object'&&!Array.isArray(body.evidence)?auditJsonClone(body.evidence,AUDIT_MAX_EVIDENCE):{};
  submittedEvidence.scan=scan.diagnostics;
  const evidence=auditJsonClone(submittedEvidence,AUDIT_MAX_EVIDENCE);
  const result=normalizeAuditResult(body.result,createdAt);
  const model=['claude-haiku-4-5','deterministic-fallback'].includes(String(body.model||''))?String(body.model):'unknown';
  const report={
    version:2,sealVersion:2,id,requestId,machineId:idMachine,createdAt,actorRole:role,
    clientActor:String(body.actor||'').slice(0,160),model,
    durationMs:Math.max(0,Math.min(30*60*1000,Number(body.durationMs)||0)),
    sourceMatrix:deriveAuditSourceMatrix(evidence),
    cost:sanitizeAuditCost(body.cost),scanId,
    result,evidence,
  };
  report.evidenceHash=auditHash(report.evidence);
  report.scanEvidenceHash=scan.evidenceHash;
  report.reportHash=auditSealHash(report);
  return report;
}
function migrateLegacyAudits(){
  const existing=readJson(AUDIT_INDEX_FILE,null);
  if(existing)return normalizeAuditStore(existing);
  const legacy=readJson(AUDIT_LEGACY_FILE,null);
  const rows=pruneAuditReports(Array.isArray(legacy?.reports)?legacy.reports:[]);
  if(!rows.length)return normalizeAuditStore(null);
  const summaries=[];
  for(const old of rows){
    try{
      const createdAt=Number.isFinite(Date.parse(old.createdAt||''))?new Date(old.createdAt).toISOString():nowIso();
      const report={
        version:2,sealVersion:2,id:/^[A-Za-z0-9_.:-]{8,160}$/.test(String(old.id||''))?String(old.id):uid('audit'),
        requestId:'legacy-'+crypto.randomBytes(8).toString('hex'),
        machineId:String(old.machineId||'').slice(0,120),createdAt,actorRole:'legacy',
        clientActor:String(old.actor||'').slice(0,160),model:String(old.model||'legacy').slice(0,120),
        durationMs:Math.max(0,Number(old.durationMs)||0),cost:null,scanId:'',
        result:normalizeAuditResult(old.result,createdAt),evidence:auditJsonClone(old.evidence||{},AUDIT_MAX_EVIDENCE),
      };
      if(!report.machineId)continue;
      report.sourceMatrix=deriveAuditSourceMatrix(report.evidence);
      report.evidenceHash=auditHash(report.evidence);report.scanEvidenceHash='';
      report.reportHash=auditSealHash(report);
      fs.writeFileSync(auditReportPath(report.machineId,report.id),JSON.stringify(report,null,2)+'\n',{mode:0o600});
      summaries.push(auditSummaryFromReport(report));
    }catch(e){console.warn('[audits] migración omitida:',e.message);}
  }
  const store={version:2,updatedAt:Date.now(),reports:pruneAuditReports(summaries)};
  try{fs.writeFileSync(AUDIT_INDEX_FILE,JSON.stringify(store,null,2)+'\n',{mode:0o600});}catch(e){console.warn('[audits] índice migrado no persistió:',e.message);}
  return store;
}
async function readAuditReport(machineId,auditId){
  const primary=auditReportPath(machineId,auditId);
  try{return JSON.parse(await fs.promises.readFile(primary,'utf8'));}catch(_){}
  const legacy=auditLegacyReportPath(machineId,auditId);
  if(!legacy||legacy===primary)return null;
  try{
    const report=JSON.parse(await fs.promises.readFile(legacy,'utf8'));
    // Migración perezosa: una lectura válida mueve el archivo a la ruta hash-safe.
    try{await atomicWrite(primary,report);await fs.promises.unlink(legacy);}catch(e){if(e?.code!=='ENOENT')console.warn('[audits] lazy path migration',e.message);}
    return report;
  }catch(_){return null;}
}
function verifyAuditReport(report){
  if(!report||typeof report!=='object')return false;
  const evidenceHash=auditHash(report.evidence||{});
  if(evidenceHash!==report.evidenceHash)return false;
  if(Number(report.sealVersion||0)>=2)return auditSealHash({...report,evidenceHash})===report.reportHash;
  const legacyHash=auditHash({version:report.version,id:report.id,machineId:report.machineId,createdAt:report.createdAt,actorRole:report.actorRole,model:report.model,evidenceHash,scanEvidenceHash:report.scanEvidenceHash||'',result:report.result,cost:report.cost||null});
  return legacyHash===report.reportHash;
}
let queue = normalizeQueue(readJson(QUEUE_FILE, null));
let registry = normalizeRegistry(readJson(REGISTRY_FILE, null));
let safety = SafetyPolicy.normalizeSnapshot(readJson(SAFETY_FILE, null));
let operations = normalizeOperations(readJson(OPERATIONS_FILE, null));
let audits = migrateLegacyAudits();
let queueWrite = Promise.resolve(), registryWrite = Promise.resolve(), safetyWrite = Promise.resolve(), operationsWrite=Promise.resolve(), auditWrite=Promise.resolve();
function persistQueue() {
  queue.updatedAt=Date.now();
  const snapshot=JSON.parse(JSON.stringify(queue));
  queueWrite=queueWrite.then(()=>atomicWrite(QUEUE_FILE,snapshot).then(()=>true)).catch(e=>{console.error('[queue] persist',e);return false;});
  return queueWrite;
}
function persistRegistry() {
  registry.updatedAt=Date.now();
  const snapshot=JSON.parse(JSON.stringify(registry));
  registryWrite=registryWrite.then(()=>atomicWrite(REGISTRY_FILE,snapshot).then(()=>true)).catch(e=>{console.error('[registry] persist',e);return false;});
  return registryWrite;
}
function persistSafety() {
  safety.updatedAt=Date.now();
  const snapshot=JSON.parse(JSON.stringify(safety));
  safetyWrite=safetyWrite.then(()=>atomicWrite(SAFETY_FILE,snapshot).then(()=>true)).catch(e=>{console.error('[safety] persist',e);return false;});
  return safetyWrite;
}
function persistOperations(){
  operations=normalizeOperations({...operations,updatedAt:Date.now()});
  const snapshot=JSON.parse(JSON.stringify(operations));
  operationsWrite=operationsWrite.then(()=>atomicWrite(OPERATIONS_FILE,snapshot).then(()=>true)).catch(e=>{console.error('[operations] persist',e);return false;});
  return operationsWrite;
}
function persistAudits(){
  audits={...audits,version:2,updatedAt:Date.now(),reports:pruneAuditReports(audits.reports)};
  const snapshot=JSON.parse(JSON.stringify(audits));
  auditWrite=auditWrite.then(()=>atomicWrite(AUDIT_INDEX_FILE,snapshot).then(()=>true)).catch(e=>{console.error('[audits] persist',e);return false;});
  return auditWrite;
}
async function deleteAuditReportFiles(machineId,auditId){
  const paths=[auditReportPath(machineId,auditId),auditLegacyReportPath(machineId,auditId)].filter(Boolean);
  for(const file of new Set(paths))try{await fs.promises.unlink(file);}catch(e){if(e?.code!=='ENOENT')console.warn('[audits] cleanup',e.message);}
}
async function cleanupAuditOrphans(graceMs=24*60*60*1000){
  const keep=new Set();
  for(const row of audits.reports){
    try{keep.add(path.resolve(auditReportPath(row.machineId,row.id)));}catch(_){}
    const legacy=auditLegacyReportPath(row.machineId,row.id);if(legacy)keep.add(path.resolve(legacy));
  }
  let removed=0,now=Date.now(),dirs=[];
  try{dirs=await fs.promises.readdir(AUDIT_DIR,{withFileTypes:true});}catch(_){return 0;}
  for(const dirent of dirs){
    if(!dirent.isDirectory())continue;
    const dir=path.resolve(AUDIT_DIR,dirent.name);
    if(!auditPathInsideRoot(dir))continue;
    let files=[];try{files=await fs.promises.readdir(dir,{withFileTypes:true});}catch(_){continue;}
    for(const fileent of files){
      if(!fileent.isFile()||!fileent.name.endsWith('.json'))continue;
      const file=path.resolve(dir,fileent.name);if(keep.has(file))continue;
      try{
        const st=await fs.promises.stat(file);if(now-st.mtimeMs<graceMs)continue;
        await fs.promises.unlink(file);removed++;
      }catch(e){if(e?.code!=='ENOENT')console.warn('[audits] orphan cleanup',e.message);}
    }
    try{if(!(await fs.promises.readdir(dir)).length)await fs.promises.rmdir(dir);}catch(_){}
  }
  if(removed)console.warn('[audits] '+removed+' archivo(s) huérfano(s) eliminado(s)');
  return removed;
}
function auditSummaryByRequestId(machineId,requestId){
  return audits.reports.find(row=>row.machineId===machineId&&row.requestId===requestId)||null;
}
async function saveAuditReport(report){
  return withAuditLock('audit-index',async()=>{
    const previous=audits.reports.slice(),summary=auditSummaryFromReport(report),file=auditReportPath(report.machineId,report.id);
    await atomicWrite(file,report);
    audits.reports=pruneAuditReports([summary,...audits.reports.filter(row=>row.id!==report.id)]);
    const keep=new Set(audits.reports.map(row=>row.id));
    const removed=previous.filter(row=>row.machineId===report.machineId&&!keep.has(row.id));
    const durable=await persistAudits();
    if(!durable){
      audits.reports=previous;
      try{await fs.promises.unlink(file);}catch(e){if(e?.code!=='ENOENT')console.warn('[audits] rollback detail',e.message);}
      const error=new Error('no se pudo persistir el índice de auditorías');error.statusCode=503;throw error;
    }
    auditScanSessions.delete(report.scanId);
    for(const row of removed)await deleteAuditReportFiles(row.machineId,row.id);
    return summary;
  });
}
async function saveAuditRequest(machineId,body,role){
  const rawScan=String(body?.scanId||''),requestId=/^[A-Za-z0-9_.:-]{8,180}$/.test(String(body?.requestId||''))?String(body.requestId):('req-'+rawScan);
  if(!requestId||requestId==='req-')throw new Error('requestId/scanId requerido');
  return withAuditLock('save:'+machineId+':'+requestId,async()=>{
    const existing=auditSummaryByRequestId(machineId,requestId);
    if(existing){
      const report=await readAuditReport(machineId,existing.id);
      if(!report||!verifyAuditReport(report)){const error=new Error('auditoría idempotente existente sin detalle íntegro');error.statusCode=409;throw error;}
      return{report,summary:existing,idempotent:true};
    }
    const report=sanitizeAuditReport(machineId,{...body,requestId},role);
    const summary=await saveAuditReport(report);
    return{report,summary,idempotent:false};
  });
}
async function updateAuditFinding(machineId,auditId,findingId,patch,role){
  return withAuditLock('finding:'+machineId+':'+auditId,async()=>withAuditLock('audit-index',async()=>{
    const report=await readAuditReport(machineId,auditId);if(!report)return null;
    if(!verifyAuditReport(report)){const error=new Error('la auditoría no supera verificación de integridad');error.statusCode=409;throw error;}
    const originalReport=auditJsonClone(report,AUDIT_MAX_BODY),previousIndex=audits.reports.slice();
    const findings=Array.isArray(report.result?.findings)?report.result.findings:[];
    const row=findings.find(f=>f.findingId===findingId);if(!row)throw new Error('hallazgo no encontrado');
    const status=String(patch.status||'');if(!AUDIT_FINDING_STATES.has(status))throw new Error('estado de hallazgo inválido');
    row.status=status;row.statusUpdatedAt=nowIso();row.statusUpdatedByRole=role;row.statusNote=String(patch.note||'').slice(0,1200);
    report.result=normalizeAuditResult(report.result,report.createdAt);
    report.sealVersion=2;
    report.requestId=report.requestId||('legacy-'+crypto.randomBytes(8).toString('hex'));
    report.sourceMatrix=deriveAuditSourceMatrix(report.evidence||{});
    report.evidenceHash=auditHash(report.evidence||{});
    report.reportHash=auditSealHash(report);
    const file=auditReportPath(machineId,auditId);
    await atomicWrite(file,report);
    const summary=auditSummaryFromReport(report),idx=audits.reports.findIndex(r=>r.id===auditId&&r.machineId===machineId);
    if(idx>=0)audits.reports[idx]=summary;else audits.reports.unshift(summary);
    if(!await persistAudits()){
      audits.reports=previousIndex;
      try{await atomicWrite(file,originalReport);}catch(e){console.error('[audits] rollback finding detail',e);}
      const error=new Error('no se pudo persistir estado del hallazgo');error.statusCode=503;throw error;
    }
    return{report,summary};
  }));
}
const recoveredAtBoot = recoverQueueJobs(queue);
if (recoveredAtBoot) {
  console.warn(`[queue] ${recoveredAtBoot} trabajo(s) intermedio(s) recuperado(s) tras reinicio`);
  persistQueue();
}
function publicJob(j) { const { gcodeBase64, payloadFile, ...rest } = j; return { ...rest, hasPayload: !!payloadFile || !!gcodeBase64 }; }
function machineByIdentity({ id, serial, mac, hostname, ip } = {}) {
  let hit = registry.machines.find(m =>
    (id && m.id === id) || (serial && m.serial && m.serial === serial) ||
    (mac && m.mac && m.mac.toLowerCase() === String(mac).toLowerCase()) || (ip && m.ip === ip));
  if (hit || !hostname) return hit;
  const same = registry.machines.filter(m => m.hostname && m.hostname === hostname);
  return same.length === 1 ? same[0] : undefined;
}
function upsertMachine(patch) {
  let m = machineByIdentity(patch);
  if (!m) {
    m = { id: patch.id || uid('machine'), createdAt: nowIso(), firstSeenAt: nowIso() };
    registry.machines.push(m);
  }
  const oldIp = m.ip;
  Object.assign(m, patch, { updatedAt: nowIso(), lastSeenAt: patch.lastSeenAt || m.lastSeenAt || nowIso() });
  if (oldIp && patch.ip && oldIp !== patch.ip) {
    m.ipHistory = Array.isArray(m.ipHistory) ? m.ipHistory : [];
    m.ipHistory.unshift({ ip: oldIp, until: nowIso() });
    m.ipHistory = m.ipHistory.slice(0, 20);
  }
  persistRegistry();
  return m;
}

function setCors(req, res) {
  const origin = String(req.headers.origin || '');
  if (!origin || DASHBOARD_ORIGIN === '*' || origin === DASHBOARD_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', origin || DASHBOARD_ORIGIN);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key,X-Bridge-Token,Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'X-Bridge-Error,X-Farm-Role');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 'no-store');
}
function json(res, status, body, headers = {}) {
  if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}
function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const parts = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('payload demasiado grande')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}
function cleanForwardPath(rawUrl) {
  const u = new URL(rawUrl, 'http://farm.local');
  u.searchParams.delete('bt');
  return u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '');
}

let legacy = null;
function startLegacy() {
  if (legacy) return;
  const env = { ...process.env, BRIDGE_PORT: String(LEGACY_PORT), BRIDGE_TOKEN: INTERNAL_TOKEN, BRIDGE_ALLOW_ORIGIN: 'http://127.0.0.1' };
  legacy = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env, stdio: ['ignore', 'inherit', 'inherit'] });
  legacy.on('exit', (code, signal) => {
    console.error(`[farm] legacy bridge salió code=${code} signal=${signal || ''}; reiniciando en 2s`);
    legacy = null;
    setTimeout(startLegacy, 2000).unref();
  });
}

let _controllerUpdating=false;
function updateFarmController(){
  if(_controllerUpdating)return Promise.resolve({ok:false,error:'actualización ya en curso'});
  _controllerUpdating=true;
  return new Promise(resolve=>{
    const finish=value=>{if(!value?.ok)_controllerUpdating=false;resolve(value);};
    const run=git=>execFile(git,['-C',REPO_DIR,'pull','--ff-only','origin','main'],{timeout:90000},(err,stdout,stderr)=>{
      if(err&&err.code==='ENOENT'&&git==='git')return run('/usr/bin/git');
      const out=String(stdout||'').trim(),errOut=String(stderr||'').trim();
      if(err)return finish({ok:false,error:errOut||out||err.message});
      finish({ok:true,out});
    });
    run('git');
  });
}

function routeMinimumRole(req, pathname) {
  if (pathname === '/healthz') return null;
  if (pathname === '/authcheck') return 'viewer';
  if (pathname.startsWith('/farm/')) return null;
  if (pathname === '/restart' || pathname === '/update' || pathname === '/pubkey' || pathname.startsWith('/sshcheck/') || pathname.startsWith('/diagnostics/') || pathname.startsWith('/recover/') || pathname.startsWith('/recover-camera/') || pathname.startsWith('/maint/')) return 'admin';
  if (req.method === 'GET' || req.method === 'HEAD') return 'viewer';
  if (/\/printer\/(print|gcode|objects\/subscribe|emergency_stop)/.test(pathname) || /\/server\/files\/(upload|delete)/.test(pathname)) return 'operator';
  return 'admin';
}
function proxyLegacy(req, res, role) {
  const bodyless = req.method === 'GET' || req.method === 'HEAD';
  const targetPath = cleanForwardPath(req.url);
  const streamUpload = req.method === 'POST' && /\/server\/files\/upload(?:\?|$)/.test(targetPath);
  const forward = (body) => {
    const headers = { ...req.headers, host: `127.0.0.1:${LEGACY_PORT}`, 'x-bridge-token': INTERNAL_TOKEN };
    delete headers.origin; delete headers.referer;
    if(!streamUpload)delete headers['content-length'];
    if (body) headers['content-length'] = String(body.length);
    const p = http.request({ host: '127.0.0.1', port: LEGACY_PORT, path: targetPath, method: req.method, headers, timeout: streamUpload ? 120_000 : 20_000 }, pr => {
      const h = { ...pr.headers, 'x-farm-role': role || 'public' };
      delete h['access-control-allow-origin']; delete h['access-control-allow-methods']; delete h['access-control-allow-headers'];
      res.writeHead(pr.statusCode || 502, h);
      pr.pipe(res);
    });
    p.on('timeout', () => p.destroy(new Error(streamUpload?'upload timeout':'legacy timeout')));
    p.on('error', e => json(res, 502, { ok: false, error: 'legacy bridge no disponible: ' + e.message }, { 'X-Bridge-Error': '1' }));
    if (body) p.end(body); else req.pipe(p);
  };
  if (bodyless || streamUpload) forward(null); else readBody(req).then(forward).catch(e => json(res, 413, { ok: false, error: e.message }));
}

function queueJobById(id) { return queue.jobs.find(j => j.id === id); }
function cleanJobMetadata(value) {
  const v=value&&typeof value==='object'?value:{},out={};
  const strings=['source','name','material','nozzle','model','profileName'];
  for(const k of strings)if(v[k]!=null)out[k]=String(v[k]).slice(0,160);
  for(const k of['sizeX','sizeY','sizeZ','grams','secs'])if(Number.isFinite(Number(v[k])))out[k]=Number(v[k]);
  if(v.params&&typeof v.params==='object')out.params={
    layerHeight:Number(v.params.layerHeight)||0,infillPct:Number(v.params.infillPct)||0,infillType:String(v.params.infillType||'').slice(0,32),
    supports:!!v.params.supports,maxVolumetricFlow:Number(v.params.maxVolumetricFlow)||0
  };
  if(v.mesh&&typeof v.mesh==='object')out.mesh={volumeReliable:!!v.mesh.volumeReliable,openEdges:Number(v.mesh.openEdges)||0,nonManifoldEdges:Number(v.mesh.nonManifoldEdges)||0};
  return out;
}
async function enqueue(payload) {
  const requestedId=String(payload.machineId||'');
  const machine=machineByIdentity({id:requestedId})||machineByIdentity({ip:String(payload.ip||'')});
  if(!machine?.id||!isPrivateIp(machine.ip))throw new Error('máquina no registrada o sin IP válida en Farm Registry');
  const machineId=String(machine.id),ip=String(machine.ip);
  const filename=String(payload.filename||'').replace(/[\\/]/g,'_').slice(0,200);
  if(!filename)throw new Error('filename requerido');
  const existingFile=payload.existingFile===true;
  const gcodeBase64=String(payload.gcodeBase64||'');
  if(!existingFile&&!gcodeBase64)throw new Error('gcodeBase64 requerido');
  const idempotencyKey=String(payload.idempotencyKey||'').trim().slice(0,160);
  if(idempotencyKey){
    const previous=queue.jobs.find(j=>j.idempotencyKey===idempotencyKey);
    if(previous)return previous;
  }
  const id=payload.id||uid('print');
  let payloadStored={file:'',bytes:0};
  if(!existingFile)payloadStored=await writePayload(id,gcodeBase64);
  const j={
    id,idempotencyKey,machineId,ip,filename,payloadFile:payloadStored.file,existingFile,
    bytes:payloadStored.bytes,
    grams:Number(payload.grams||0),secs:Number(payload.secs||0),
    priority:Math.max(0,Math.min(100,Number(payload.priority||50))),
    state:'queued',attempts:0,createdAt:nowIso(),updatedAt:nowIso(),
    source:String(payload.source||'dashboard'),metadata:cleanJobMetadata(payload.metadata),lastError:'',safetyBlocked:false,bedBlocked:false,
  };
  queue.jobs.push(j);
  queue.jobs.sort((a,b)=>b.priority-a.priority||Date.parse(a.createdAt)-Date.parse(b.createdAt));
  const durable=await persistQueue();
  if(!durable){
    queue.jobs=queue.jobs.filter(row=>row!==j);
    await deletePayload(j);
    throw new Error('no se pudo persistir la cola durable');
  }
  return j;
}
function markJob(id, patch) {
  const j = queueJobById(id); if (!j) return null;
  Object.assign(j, patch, { updatedAt: nowIso() }); persistQueue(); return j;
}
function requeueSafetyBlocked() {
  let changed=0;
  for(const j of queue.jobs){
    if(j.state!=='blocked'||j.safetyBlocked!==true)continue;
    const check=SafetyPolicy.evaluateSnapshot(safety,j,Date.now());
    if(!check.ok)continue;
    Object.assign(j,{state:'queued',safetyBlocked:false,safetyBlockers:[],lastError:'',updatedAt:nowIso()});changed++;
  }
  if(changed)persistQueue();
  return changed;
}
function requeueBedBlocked(machineId){
  let changed=0;
  for(const j of queue.jobs){
    if(j.machineId!==machineId||j.state!=='blocked'||j.bedBlocked!==true)continue;
    Object.assign(j,{state:'queued',bedBlocked:false,lastError:'',updatedAt:nowIso()});changed++;
  }
  if(changed)persistQueue();
  return changed;
}
async function pruneQueue(now=Date.now()){
  const cutoff=now-30*86400000;
  const active=queue.jobs.filter(j=>!QUEUE_TERMINAL_STATES.has(String(j.state||'')));
  const terminal=queue.jobs.filter(j=>QUEUE_TERMINAL_STATES.has(String(j.state||''))&&(Date.parse(j.updatedAt||j.createdAt||0)||0)>=cutoff)
    .sort((a,b)=>Date.parse(b.updatedAt||0)-Date.parse(a.updatedAt||0)).slice(0,1000);
  if(active.length+terminal.length!==queue.jobs.length){
    const next=[...active,...terminal],kept=new Set(next.map(j=>j.id)),removed=queue.jobs.filter(j=>!kept.has(j.id));
    const previous=queue.jobs;queue.jobs=next;
    const durable=await persistQueue();
    if(durable)await Promise.all(removed.map(deletePayload));else queue.jobs=previous;
  }
}
function requestLegacy(method, targetPath, body, headers = {}, timeoutMs = 25_000) {
  return new Promise(resolve => {
    const h = { ...headers, 'x-bridge-token': INTERNAL_TOKEN };
    if (body) h['content-length'] = String(body.length);
    const r = http.request({ host: '127.0.0.1', port: LEGACY_PORT, path: targetPath, method, headers: h, timeout: timeoutMs }, res => {
      const parts = []; res.on('data', c => parts.push(c)); res.on('end', () => resolve({ ok: (res.statusCode || 500) < 300, status: res.statusCode || 0, body: Buffer.concat(parts) }));
    });
    r.on('timeout', () => { r.destroy(); resolve({ ok: false, status: 0, body: Buffer.from('timeout') }); });
    r.on('error', e => resolve({ ok: false, status: 0, body: Buffer.from(e.message) }));
    if (body) r.end(body); else r.end();
  });
}
function multipartUpload(filename, content) {
  const boundary = '----tlsfarm' + crypto.randomBytes(10).toString('hex');
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename.replace(/"/g, '')}"\r\nContent-Type: text/plain\r\n\r\n`);
  const mid = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="root"\r\n\r\ngcodes\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, content, mid]), contentType: 'multipart/form-data; boundary=' + boundary };
}
function recordProductionEvent(j,result,ps={}){
  return new Promise(resolve=>{
    const started=Date.parse(j.startedAt||0)||0,end=Date.now(),durSec=Math.max(0,Number(ps.print_duration||0));
    const body=Buffer.from(JSON.stringify({eventId:'farm:'+j.id,machineId:j.machineId,id:j.machineId,file:j.filename,start:started||Math.max(0,end-durSec*1000),end,
      dur:durSec?durSec/60:Math.max(0,(end-started)/60000),result,filamentMm:Math.max(0,Number(ps.filament_used||0)),ts:end}));
    const req=http.request({host:'127.0.0.1',port:PUBLIC_PORT,path:'/farm/production/events',method:'POST',
      headers:{'content-type':'application/json','content-length':String(body.length),'x-bridge-token':MASTER_TOKEN},timeout:5000},res=>{res.resume();res.on('end',resolve);});
    req.on('timeout',()=>{req.destroy();resolve();});req.on('error',()=>resolve());req.end(body);
  });
}
const activeJobRuns=new Set(),activeMachineRuns=new Set();
async function runQueuedJob(j) {
  const machineRunKey=String(j?.machineId||j?.ip||'');
  if(!j||!['queued','retry'].includes(j.state)||activeJobRuns.has(j.id)||!machineRunKey||activeMachineRuns.has(machineRunKey))return;
  activeJobRuns.add(j.id);activeMachineRuns.add(machineRunKey);
  const queuedState=j.state;
  try {
    markJob(j.id, { state: 'checking', lastError: '' });
    const machine = machineByIdentity({ id: j.machineId }) || machineByIdentity({ ip: j.ip });
    const ip = machine?.ip || j.ip;
    if (!isPrivateIp(ip)) return markJob(j.id, { state: 'blocked', safetyBlocked: false, lastError: 'IP de máquina no disponible' });
    // Fail-closed para trabajos largos/nocturnos. El controller decide de nuevo
    // justo antes de hablar con Moonraker, sin confiar en que siga abierto el navegador.
    const safetyCheck = SafetyPolicy.evaluateSnapshot(safety, j, Date.now());
    if (!safetyCheck.ok) {
      return markJob(j.id, {
        state: 'blocked', safetyBlocked: true, safetyCheckedAt: nowIso(),
        safetyBlockers: safetyCheck.blockers, lastError: 'seguridad desatendida: ' + safetyCheck.blockers.join(' '),
      });
    }
    markJob(j.id, { safetyBlocked: false, safetyBlockers: [], safetyCheckedAt: nowIso() });
    const live = await requestLegacy('GET', `/${ip}/printer/objects/query?print_stats&webhooks`);
    if (!live.ok) return markJob(j.id, { state: 'retry', lastError: `preflight HTTP ${live.status}` });
    try {
      const body = JSON.parse(live.body.toString('utf8') || '{}');
      const st = body.result?.status || {}, ps = st.print_stats || {}, wh = st.webhooks || {};
      const printState = String(ps.state || '').toLowerCase();
      if(['printing','paused'].includes(printState)){
        if(samePrintFilename(ps.filename,j.filename)){
          await deletePayload(j);
          return markJob(j.id,{state:printState==='paused'?'paused':'printing',ip,startedAt:j.startedAt||nowIso(),recovered:true,payloadFile:'',gcodeBase64:'',lastError:''});
        }
        return markJob(j.id,{state:queuedState,lastError:`esperando: impresora ${printState}`});
      }
      if(printState==='complete'){
        const signature=bedSignatureFromPrintStats(ps),approved=machine?.bedClearSignature===signature;
        if(!approved)return markJob(j.id,{state:'blocked',bedBlocked:true,safetyBlocked:false,bedSignature:signature,lastError:'retirar pieza y confirmar cama libre antes del siguiente trabajo'});
      }
      if(['shutdown','error','startup'].includes(String(wh.state||'').toLowerCase()))return markJob(j.id,{state:'blocked',safetyBlocked:false,lastError:`Klipper ${wh.state}`});
    } catch (_) { return markJob(j.id, { state: 'retry', lastError: 'preflight inválido' }); }
    const nextAttempts=Number(j.attempts||0)+1;
    if(!j.existingFile){
      markJob(j.id,{state:'uploading',ip,attempts:nextAttempts,lastError:''});
      const gcode=await readPayload(j);
      if(!gcode.length)return markJob(j.id,{state:'failed',lastError:'payload G-code ausente'});
      const mp=multipartUpload(j.filename,gcode);
      const upload=await requestLegacy('POST',`/${ip}/server/files/upload`,mp.body,{'content-type':mp.contentType});
      if(!upload.ok)return markJob(j.id,{state:nextAttempts<4?'retry':'failed',lastError:`upload HTTP ${upload.status}: ${upload.body.toString('utf8').slice(0,300)}`});
      markJob(j.id,{state:'uploaded'});
    }else markJob(j.id,{state:'uploaded',ip,attempts:nextAttempts,lastError:''});
    const start=await requestLegacy('POST',`/${ip}/printer/print/start?filename=${encodeURIComponent(j.filename)}`);
    if(!start.ok)return markJob(j.id,{state:nextAttempts<4?'retry':'failed',lastError:`start HTTP ${start.status}: ${start.body.toString('utf8').slice(0,300)}`});
    if(machine?.bedClearSignature){delete machine.bedClearSignature;delete machine.bedClearedAt;machine.updatedAt=nowIso();persistRegistry();}
    await deletePayload(j);
    return markJob(j.id,{state:'started',startedAt:nowIso(),payloadFile:'',gcodeBase64:'',lastError:''});
  } finally {
    activeJobRuns.delete(j.id);activeMachineRuns.delete(machineRunKey);
  }
}
async function reconcileStartedJobs(){
  for(const j of queue.jobs.filter(x=>['started','printing','paused'].includes(String(x.state||'')))){
    const machine=machineByIdentity({id:j.machineId});const ip=machine?.ip||j.ip;if(!isPrivateIp(ip))continue;
    const live=await requestLegacy('GET',`/${ip}/printer/objects/query?print_stats&webhooks`);
    if(!live.ok)continue;
    let ps={};try{ps=JSON.parse(live.body.toString('utf8')||'{}').result?.status?.print_stats||{};}catch(_){continue;}
    const state=String(ps.state||'').toLowerCase(),same=samePrintFilename(ps.filename,j.filename);
    if(same&&state==='printing'){markJob(j.id,{state:'printing',lastError:''});continue;}
    if(same&&state==='paused'){markJob(j.id,{state:'paused',lastError:''});continue;}
    if(same&&state==='complete'){
      markJob(j.id,{state:'completed',completedAt:nowIso(),lastError:''});await recordProductionEvent(j,'Completado',ps);continue;
    }
    if(same&&['cancelled','canceled'].includes(state)){
      markJob(j.id,{state:'cancelled',completedAt:nowIso(),lastError:'impresión cancelada'});await recordProductionEvent(j,'Cancelado',ps);continue;
    }
    if(same&&state==='error'){
      markJob(j.id,{state:'failed',completedAt:nowIso(),lastError:'Moonraker reportó error'});await recordProductionEvent(j,'Cancelado',ps);
    }
  }
}
let queueWorkerBusy=false;
async function queueWorker() {
  if (queueWorkerBusy) return;
  queueWorkerBusy = true;
  try {
    await reconcileStartedJobs();
    await pruneQueue();
    const candidates=queue.jobs.filter(j=>['queued','retry'].includes(j.state));
    for (const j of candidates) {
      // `started` es histórico, NO un lock: el estado vivo de Moonraker decide
      // si la máquina sigue ocupada. Contarlo aquí dejaba bloqueado el segundo
      // trabajo para siempre después de arrancar el primero.
      const sameMachineTransition = queue.jobs.some(x => x.id !== j.id && x.machineId === j.machineId && ['checking', 'uploading', 'uploaded'].includes(x.state));
      if (!sameMachineTransition) await runQueuedJob(j);
    }
  } catch (e) { console.error('[queue] worker', e); } finally { queueWorkerBusy = false; }
}

function probe(ip, port, pathname, timeout = 1200) {
  return new Promise(resolve => {
    const r = http.get({ host: ip, port, path: pathname, timeout }, res => {
      const parts = []; let total = 0;
      res.on('data', c => { total += c.length; if (total < 128 * 1024) parts.push(c); });
      res.on('end', () => resolve({ ok: true, status: res.statusCode || 0, body: Buffer.concat(parts).toString('utf8') }));
    });
    r.on('timeout', () => { r.destroy(); resolve({ ok: false }); });
    r.on('error', () => resolve({ ok: false }));
  });
}
function findMac(value) {
  if (!value || typeof value !== 'object') return '';
  for (const [k,v] of Object.entries(value)) {
    if (/^(mac|mac_address|hwaddr)$/i.test(k) && typeof v === 'string' && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(v)) return v.toLowerCase();
    const nested = findMac(v); if (nested) return nested;
  }
  return '';
}
async function identifyPrinter(ip) {
  const info = await probe(ip, 7125, '/printer/info', 1800);
  if (!info.ok) return null;
  let parsed = {}; try { parsed = JSON.parse(info.body || '{}').result || {}; } catch (_) {}
  const [serverInfo, systemInfo] = await Promise.all([probe(ip, 7125, '/server/info', 1800), probe(ip, 7125, '/machine/system_info', 1800)]);
  let si = {}, sys = {};
  try { si = JSON.parse(serverInfo.body || '{}').result || {}; } catch (_) {}
  try { sys = JSON.parse(systemInfo.body || '{}').result?.system_info || {}; } catch (_) {}
  const hostname = String(si.hostname || sys.hostname || parsed.hostname || '');
  const mac = findMac(sys);
  return { ip, hostname, mac, klipper: parsed.software_version || '', moonraker: si.moonraker_version || '', lastSeenAt: nowIso(), online: true };
}
async function discoverLan() {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.$/.test(DISCOVERY_PREFIX)) return;
  const ips = Array.from({ length: 253 }, (_, i) => DISCOVERY_PREFIX + (i + 2));
  const concurrency = 32; let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < ips.length) { const ip = ips[cursor++]; const id = await identifyPrinter(ip); if (id) upsertMachine(id); }
  });
  await Promise.all(workers);
}

const server = http.createServer(async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const u = new URL(req.url, 'http://farm.local'), p = u.pathname;
  // El bridge legado ejecutaba /restart sin validar método. Desde el controller
  // el reinicio es admin + POST-only, evitando que una navegación/GET lo dispare.
  if (p === '/restart' && req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { ok: false, error: 'method not allowed' }); }
  if (p === '/healthz') return json(res, 200, { ok: true, service: 'farm-controller', uptime: Math.round(process.uptime()), queue: queue.jobs.filter(j => QUEUE_ACTIVE_STATES.has(String(j.state||''))).length, machines: registry.machines.length, operations:Object.keys(normalizeOperations(operations).machines).length, audits:audits.reports.length, auditPendingScans:auditScanSessions.size, safetyUpdatedAt: safety.updatedAt || 0 });
  if (p === '/authcheck') {
    const role = requireRole(req, res, 'viewer'); if (!role) return;
    return json(res, 200, { ok: true, role, capabilities:{auditRun:ROLE_RANK[role]>=ROLE_RANK.operator,auditEvidence:ROLE_RANK[role]>=ROLE_RANK.operator,auditFindings:ROLE_RANK[role]>=ROLE_RANK.operator}, rolesEnabled: { viewer: !!TOKENS.viewer, operator: !!TOKENS.operator, admin: !!TOKENS.admin } }, { 'X-Farm-Role': role });
  }
  // Actualiza y reinicia el proceso PADRE. Antes /update se delegaba al bridge
  // legado hijo: el git pull ocurría, pero Farm Controller seguía ejecutando el
  // código viejo en memoria. Este endpoint hace el mismo fast-forward seguro y
  // luego sale completo para que launchd levante controller + bridge nuevos.
  if(p==='/update'){
    if(req.method!=='POST'){res.setHeader('Allow','POST');return json(res,405,{ok:false,error:'method not allowed'});}
    const role=requireRole(req,res,'admin');if(!role)return;
    if(!UPDATE_ENABLED)return json(res,200,{ok:false,error:'actualización desactivada (BRIDGE_UPDATE=0)'},{'X-Farm-Role':role});
    const result=await updateFarmController();
    json(res,200,{...result,restarting:!!result.ok,scope:'farm-controller'},{'X-Farm-Role':role});
    if(result.ok){
      console.log('[farm] actualizado vía /update — reiniciando controller completo.');
      setTimeout(shutdown,500).unref?.();
    }
    return;
  }
  if (p === '/farm/session' && req.method === 'POST') {
    const role=requireRole(req,res,'viewer');if(!role)return;
    const session=issueSession(role);
    return json(res,201,{ok:true,token:session.token,role:session.role,expiresAt:session.expiresAt,ttlMs:SESSION_TTL_MS},{'X-Farm-Role':role});
  }
  const auditScan=p.match(/^\/farm\/audit-scan\/([^/]+)$/);
  if(auditScan&&req.method==='POST'){
    const role=requireRole(req,res,'operator');if(!role)return;
    const machineId=decodeURIComponent(auditScan[1]),m=machineByIdentity({id:machineId});
    if(!m?.id||!isPrivateIp(m.ip))return json(res,404,{ok:false,error:'máquina no registrada o sin IP válida'});
    const scan=await requestLegacy('GET','/diagnostics/'+m.ip,null,{},45_000);
    if(!scan.ok)return json(res,502,{ok:false,error:'diagnóstico profundo no disponible',status:scan.status});
    try{
      const diagnostics=JSON.parse(scan.body.toString('utf8')||'{}');
      const sessionDiagnostics={...diagnostics};delete sessionDiagnostics.cameraFrame;
      const issued=issueAuditScan(machineId,sessionDiagnostics,role);
      return json(res,200,{ok:true,scanId:issued.scanId,scanEvidenceHash:issued.evidenceHash,expiresAt:issued.expiresAt,machine:{id:m.id,ip:m.ip,name:m.name||m.nombre||'',model:m.model||m.modelo||''},diagnostics});
    }catch(e){return json(res,502,{ok:false,error:'respuesta de diagnóstico inválida'});}
  }

  const auditFinding=p.match(/^\/farm\/audits\/([^/]+)\/([^/]+)\/findings\/([^/]+)$/);
  if(auditFinding&&req.method==='PATCH'){
    const role=requireRole(req,res,'operator');if(!role)return;
    try{
      const machineId=decodeURIComponent(auditFinding[1]),auditId=decodeURIComponent(auditFinding[2]),findingId=decodeURIComponent(auditFinding[3]);
      const body=JSON.parse((await readBody(req,32*1024)).toString('utf8')||'{}');
      const updated=await updateAuditFinding(machineId,auditId,findingId,body,role);
      if(!updated)return json(res,404,{ok:false,error:'auditoría no encontrada'});
      return json(res,200,{ok:true,report:updated.report,summary:updated.summary});
    }catch(e){return json(res,Number(e.statusCode)||400,{ok:false,error:e.message});}
  }

  const auditDetail=p.match(/^\/farm\/audits\/([^/]+)\/([^/]+)$/);
  if(auditDetail&&req.method==='GET'){
    const role=requireRole(req,res,'operator');if(!role)return;
    const machineId=decodeURIComponent(auditDetail[1]),auditId=decodeURIComponent(auditDetail[2]);
    const report=await readAuditReport(machineId,auditId);
    if(!report||report.machineId!==machineId||report.id!==auditId)return json(res,404,{ok:false,error:'auditoría no encontrada'});
    return json(res,200,{ok:true,integrityValid:verifyAuditReport(report),report});
  }

  const auditHistory=p.match(/^\/farm\/audits\/([^/]+)$/);
  if(auditHistory&&req.method==='GET'){
    const role=requireRole(req,res,'viewer');if(!role)return;
    const machineId=decodeURIComponent(auditHistory[1]),limit=Math.max(1,Math.min(80,Number(u.searchParams.get('limit')||30)));
    const reports=audits.reports.filter(row=>row.machineId===machineId).slice(0,limit).map(row=>auditSummaryForRole(row,role));
    return json(res,200,{ok:true,version:2,updatedAt:audits.updatedAt,reports});
  }
  if(auditHistory&&req.method==='POST'){
    const role=requireRole(req,res,'operator');if(!role)return;
    try{
      const machineId=decodeURIComponent(auditHistory[1]),m=machineByIdentity({id:machineId});
      if(!m?.id)return json(res,404,{ok:false,error:'máquina no registrada'});
      const body=JSON.parse((await readBody(req,AUDIT_MAX_BODY)).toString('utf8')||'{}');
      const saved=await saveAuditRequest(machineId,body,role);
      return json(res,saved.idempotent?200:201,{ok:true,idempotent:saved.idempotent,integrityValid:true,report:saved.report,summary:saved.summary});
    }catch(e){return json(res,Number(e.statusCode)||400,{ok:false,error:e.message});}
  }

  if (p === '/farm/queue' && req.method === 'GET') {
    const role = requireRole(req, res, 'viewer'); if (!role) return;
    return json(res, 200, { ok: true, updatedAt: queue.updatedAt, jobs: queue.jobs.map(publicJob) });
  }
  if (p === '/farm/queue' && req.method === 'POST') {
    const role = requireRole(req, res, 'operator'); if (!role) return;
    try { const body = JSON.parse((await readBody(req, 48 * 1024 * 1024)).toString('utf8') || '{}'); const j = await enqueue(body); return json(res, 201, { ok: true, job: publicJob(j) }); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  if(p==='/farm/queue/existing'&&req.method==='POST'){
    const role=requireRole(req,res,'operator');if(!role)return;
    try{
      const body=JSON.parse((await readBody(req,1024*1024)).toString('utf8')||'{}');
      const j=await enqueue({...body,existingFile:true,gcodeBase64:''});
      runQueuedJob(j).catch(e=>markJob(j.id,{state:'failed',lastError:e.message}));
      return json(res,202,{ok:true,job:publicJob(j)});
    }catch(e){return json(res,400,{ok:false,error:e.message});}
  }
  const ready=p.match(/^\/farm\/ready\/([^/]+)$/);
  if(ready&&req.method==='POST'){
    const role=requireRole(req,res,'operator');if(!role)return;
    try{
      const id=decodeURIComponent(ready[1]),m=machineByIdentity({id});if(!m)return json(res,404,{ok:false,error:'máquina no registrada'});
      const body=JSON.parse((await readBody(req,64*1024)).toString('utf8')||'{}'),signature=String(body.signature||'').slice(0,240);
      if(!signature)return json(res,400,{ok:false,error:'signature requerida'});
      m.bedClearSignature=signature;m.bedClearedAt=nowIso();m.updatedAt=nowIso();
      const durable=await persistRegistry();if(!durable)return json(res,503,{ok:false,error:'no se pudo persistir la confirmación de cama libre'});
      const released=requeueBedBlocked(id);setTimeout(queueWorker,0).unref?.();
      return json(res,200,{ok:true,released,machine:{id:m.id,bedClearSignature:m.bedClearSignature,bedClearedAt:m.bedClearedAt}});
    }catch(e){return json(res,400,{ok:false,error:e.message});}
  }
  const qRun = p.match(/^\/farm\/queue\/([^/]+)\/run$/);
  if (qRun && req.method === 'POST') {
    const role = requireRole(req, res, 'operator'); if (!role) return;
    const j = queueJobById(decodeURIComponent(qRun[1])); if (!j) return json(res, 404, { ok: false, error: 'job no encontrado' });
    runQueuedJob(j).catch(e => markJob(j.id, { state: 'failed', lastError: e.message }));
    return json(res, 202, { ok: true, job: publicJob(j) });
  }
  const qDel = p.match(/^\/farm\/queue\/([^/]+)$/);
  if (qDel && req.method === 'DELETE') {
    const role = requireRole(req, res, 'operator'); if (!role) return;
    const id = decodeURIComponent(qDel[1]), before = queue.jobs.length;
    const removed=queue.jobs.find(j=>j.id===id&&!['checking','uploading','started','printing','paused'].includes(j.state));
    queue.jobs = queue.jobs.filter(j => j.id !== id || ['checking','uploading','started','printing','paused'].includes(j.state));
    if (queue.jobs.length === before) return json(res, 409, { ok: false, error: 'job no encontrado o ya está ejecutándose' });
    const durable=await persistQueue();
    if(!durable){if(removed)queue.jobs.push(removed);return json(res,503,{ok:false,error:'no se pudo persistir la eliminación'});}
    if(removed)await deletePayload(removed);
    return json(res, 200, { ok: true });
  }
  if(p==='/farm/operations'&&req.method==='GET'){
    const role=requireRole(req,res,'viewer');if(!role)return;
    operations=normalizeOperations(operations);
    return json(res,200,{ok:true,updatedAt:operations.updatedAt,operations:Object.values(operations.machines)});
  }
  const operationRoute=p.match(/^\/farm\/operations\/([^/]+)$/);
  if(operationRoute&&req.method==='PUT'){
    const role=requireRole(req,res,'operator');if(!role)return;
    try{
      const id=decodeURIComponent(operationRoute[1]);if(!machineByIdentity({id}))return json(res,404,{ok:false,error:'máquina no registrada'});
      const body=JSON.parse((await readBody(req,128*1024)).toString('utf8')||'{}'),operation=sanitizeOperation(id,body);
      operations.machines[id]=operation;const durable=await persistOperations();if(!durable)return json(res,503,{ok:false,error:'no se pudo persistir la operación'});
      return json(res,200,{ok:true,operation});
    }catch(e){return json(res,400,{ok:false,error:e.message});}
  }
  if(operationRoute&&req.method==='DELETE'){
    const role=requireRole(req,res,'operator');if(!role)return;
    const id=decodeURIComponent(operationRoute[1]),existed=!!operations.machines[id];delete operations.machines[id];
    const durable=await persistOperations();if(!durable)return json(res,503,{ok:false,error:'no se pudo persistir el cierre de operación'});
    return json(res,200,{ok:true,removed:existed});
  }
  if (p === '/farm/safety' && req.method === 'GET') {
    const role = requireRole(req, res, 'viewer'); if (!role) return;
    return json(res, 200, { ok: true, safety });
  }
  if (p === '/farm/safety' && req.method === 'PUT') {
    const role = requireRole(req, res, 'operator'); if (!role) return;
    try {
      const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}');
      const safeBody=role==='admin'?body:{...body,config:safety.config};
      safety=SafetyPolicy.normalizeSnapshot({...safeBody,updatedAt:Date.now()});
      await persistSafety();
      const released = requeueSafetyBlocked();
      setTimeout(queueWorker, 0).unref?.();
      return json(res, 200, { ok: true, released, safety });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  if (p === '/farm/registry' && req.method === 'GET') {
    const role = requireRole(req, res, 'viewer'); if (!role) return;
    return json(res, 200, { ok: true, updatedAt: registry.updatedAt, machines: registry.machines });
  }
  if (p === '/farm/registry' && (req.method === 'POST' || req.method === 'PATCH')) {
    const role = requireRole(req, res, 'admin'); if (!role) return;
    try {
      const body=JSON.parse((await readBody(req,1024*1024)).toString('utf8')||'{}');
      if(body.ip&&!isPrivateIp(body.ip))throw new Error('IP no válida');
      const m=upsertMachine(body),durable=await persistRegistry();
      if(!durable)return json(res,503,{ok:false,error:'no se pudo persistir Farm Registry'});
      return json(res,200,{ok:true,machine:m});
    }catch(e){return json(res,400,{ok:false,error:e.message});}
  }
  if (p === '/farm/discover' && req.method === 'POST') {
    const role = requireRole(req, res, 'admin'); if (!role) return;
    discoverLan().catch(e => console.warn('[registry] manual discovery', e.message));
    return json(res, 202, { ok: true, started: true });
  }
  const minimum = routeMinimumRole(req, p);
  if (minimum === null) return proxyLegacy(req, res, 'public');
  const role = requireRole(req, res, minimum); if (!role) return;
  proxyLegacy(req, res, role);
});

function start(){
  startLegacy();
  setInterval(queueWorker, 10_000).unref();
  setTimeout(queueWorker, 1500).unref();
  setInterval(()=>purgeAuditScanSessions(),5*60_000).unref();
  setTimeout(()=>cleanupAuditOrphans().catch(e=>console.warn('[audits] cleanup inicial',e.message)),3000).unref();
  if (process.env.FARM_DISCOVERY_ENABLED !== '0') {
    setTimeout(() => discoverLan().catch(e => console.warn('[registry] discovery', e.message)), 5000).unref();
    setInterval(() => discoverLan().catch(e => console.warn('[registry] discovery', e.message)), DISCOVERY_INTERVAL_MS).unref();
  }
  // Aviso por WhatsApp de impresiones con error/finalizadas (solo si hay PRINT_NOTIFY_URL/KEY).
  try { require('./print-notify').start(); } catch (e) { console.warn('[print-notify] no arrancó', e.message); }
  server.listen(PUBLIC_PORT, '0.0.0.0', () => {
    console.log('─'.repeat(64));
    console.log('  The Lab Solutions — Farm Controller');
    console.log(`  Público         : 0.0.0.0:${PUBLIC_PORT}`);
    console.log(`  Bridge interno  : 127.0.0.1:${LEGACY_PORT}`);
    console.log(`  CORS            : ${DASHBOARD_ORIGIN}`);
    console.log(`  Queue           : ${QUEUE_FILE}`);
    console.log(`  Registry        : ${REGISTRY_FILE}`);
    console.log(`  Safety          : ${SAFETY_FILE}`);
    console.log(`  Operations      : ${OPERATIONS_FILE}`);
    console.log(`  Auditorías IA   : ${AUDIT_DIR}`);
    console.log(`  Payloads        : ${PAYLOAD_DIR}`);
    console.log(`  Roles           : viewer=${TOKENS.viewer ? 'sí' : 'fallback'} operator=${TOKENS.operator ? 'sí' : 'fallback'} admin=sí`);
    console.log('─'.repeat(64));
  });
}
function shutdown() {
  try { if (legacy) legacy.kill('SIGTERM'); } catch (_) {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
if (require.main === module) {
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  start();
}
module.exports = { isPrivateIp, normalizeQueue, recoverQueueJobs, samePrintFilename, bedSignatureFromPrintStats, normalizeRegistry, normalizeOperations, sanitizeOperation, normalizeAuditStore, sanitizeAuditReport, pruneAuditReports, auditSummaryFromReport, auditSummaryForRole, auditResultSummary, auditReportPath, auditLegacyReportPath, auditHash, auditSealHash, deriveAuditSourceMatrix, compactAuditScanCore, issueAuditScan, purgeAuditScanSessions, readAuditReport, verifyAuditReport, saveAuditReport, saveAuditRequest, cleanupAuditOrphans, updateAuditFinding, updateFarmController, roleForToken, routeMinimumRole, cleanJobMetadata, payloadPath, readPayload, writePayload, deletePayload, issueSession, purgeSessions, start,
  normalizeSafetySnapshot: SafetyPolicy.normalizeSnapshot, evaluateSafetySnapshot: SafetyPolicy.evaluateSnapshot, jobIsUnattended: SafetyPolicy.jobIsUnattended };
