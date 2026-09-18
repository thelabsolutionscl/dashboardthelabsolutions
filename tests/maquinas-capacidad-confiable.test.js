const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const api=require('../js/maquinas-capacidad-confiable.js');
const SOURCE=fs.readFileSync(path.join(ROOT,'js','maquinas-capacidad-confiable.js'),'utf8');
const LOADER=fs.readFileSync(path.join(ROOT,'js','maquinas-led.js'),'utf8');

test('las horas de carga provienen de ciclos y minutos del trabajo, no del valor del pedido',()=>{
  assert.equal(api.jobMinutes({cycles:3,minutesPerCycle:40}),120);
  assert.equal(api.jobMinutes({cycles:1,minutesPerCycle:75}),75);
  assert.doesNotMatch(SOURCE,/Monto total \(CLP\)|\/\s*25000|\/\s*15000/);
  assert.match(SOURCE,/ciclos × min\/ciclo/);
});

test('un día futuro sin reserva no se presenta como libre',()=>{
  const row=api.classifyDay({isToday:false,isPast:false,adminState:'disponible',event:null,live:null});
  assert.equal(row.kind,'unplanned');
  assert.equal(row.label,'Sin reserva');
  assert.match(row.detail,/No equivale a disponibilidad confirmada/);
});

test('hoy sin telemetría reciente queda desconocido y no libre',()=>{
  const now=Date.now();
  const row=api.classifyDay({isToday:true,adminState:'disponible',live:{state:'idle',lastSeenAt:now-61000},event:null});
  assert.equal(row.kind,'unknown');
  assert.notEqual(row.label,'Libre ahora');
});

test('hoy solo se marca libre con telemetría reciente y estado libre',()=>{
  const now=Date.now();
  const free=api.classifyDay({isToday:true,adminState:'disponible',live:{state:'idle',lastSeenAt:now-5000},event:null});
  const printing=api.classifyDay({isToday:true,adminState:'disponible',live:{state:'printing',lastSeenAt:now-5000},event:null});
  assert.equal(free.kind,'free');
  assert.equal(free.label,'Libre ahora');
  assert.equal(printing.kind,'printing');
});

test('estado administrativo bloqueado domina una supuesta disponibilidad técnica',()=>{
  const row=api.classifyDay({isToday:true,adminState:'mantencion',live:{state:'idle',lastSeenAt:Date.now()},event:null});
  assert.equal(row.kind,'blocked');
  assert.equal(row.label,'No operativa');
});

test('referencia antigua de una máquina no puede ocultar una distribución real distinta',()=>{
  const order={fields:{'Máquina asignada':'k1-1'}};
  assert.equal(api.legacyConflict(order,[{machineId:'k1-1'}]),null);
  assert.match(api.legacyConflict(order,[{machineId:'k2-1'}]).reason,/no coincide/);
  assert.match(api.legacyConflict(order,[{machineId:'k1-1'},{machineId:'k2-1'}]).reason,/no representa/);
});

test('agenda semanal cuenta solo reservas y horas registradas',()=>{
  const days=[new Date('2026-09-14T00:00:00'),new Date('2026-09-15T00:00:00')];
  const machines=[{id:'k1-1'},{id:'k1-2'}];
  const events={
    'k1-1_2026-09-14':{tipo:'uso',tiempo:3.5},
    'k1-2_2026-09-14':{tipo:'mantencion'},
    'k1-1_2026-09-15':{tipo:'uso'},
  };
  assert.deepEqual(api.weekEvidence(events,machines,days),{reservations:2,maintenance:1,hours:3.5});
});

test('la extensión reemplaza las dos vistas y se carga desde el bootstrap de Máquinas',()=>{
  assert.match(SOURCE,/root\.renderCargaMaquinas=function renderCargaMaquinasConfiable/);
  assert.match(SOURCE,/root\.renderMaquinasCalendar=function renderMaquinasCalendarConfiable/);
  assert.match(SOURCE,/root\.sugerirMaquina=function sugerirMaquinaConEvidencia/);
  assert.match(SOURCE,/root\.onMaquinaModalPedidoChange=function onMaquinaModalPedidoChangeConfiable/);
  assert.match(LOADER,/js\/maquinas-capacidad-confiable\.js/);
  const cap=LOADER.indexOf('js/maquinas-capacidad-confiable.js');
  const storage=LOADER.indexOf('js/machineops-storage-adapter.js');
  assert.ok(cap>=0&&storage>cap,'la vista confiable debe instalarse antes del adaptador MachineOps');
});
