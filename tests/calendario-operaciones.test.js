'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const source = fs.readFileSync('js/calendario-operaciones.js', 'utf8');

function daysBetween(from, to) {
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  return Math.round((b - a) / 86400000);
}

function runtime(events = []) {
  const values = new Map();
  const context = {
    console,
    Date,
    Intl,
    JSON,
    Math,
    Number,
    String,
    Object,
    Array,
    Set,
    Map,
    crypto: { randomUUID: () => 'uuid-test' },
    structuredClone,
    BroadcastChannel: undefined,
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value)),
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    confirm: () => true,
    alert: () => {},
    CustomEvent: function CustomEvent(name, init) { this.type = name; this.detail = init?.detail; },
    _calCrmEvents: () => events,
    window: {
      TheLabTime: {
        localISODate: () => '2026-08-03',
        daysBetween,
      },
      addEventListener: () => {},
      dispatchEvent: () => {},
    },
    document: {
      readyState: 'loading',
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { api: context.window.CalOps, values, context };
}

test('capa operacional incluye módulos críticos', () => {
  for (const token of ['Iniciar jornada', 'Simular nuevo pedido', 'Replanificación inteligente', 'Tareas recurrentes', 'Modo TV', 'Falta material', 'Postproducción', 'Historial']) {
    assert.ok(source.includes(token), `falta ${token}`);
  }
});

test('expone API CalOps y respeta integraciones existentes', () => {
  assert.match(source, /window\.CalOps\s*=\s*api/);
  assert.match(source, /renderCalendario/);
  assert.match(source, /calUpdateCrmDate/);
  assert.match(source, /MachineOps/);
  assert.match(source, /DashboardGateway/);
});

test('fecha local suma días sin usar UTC', () => {
  const { api } = runtime();
  assert.equal(api._dateAdd('2026-08-31', 1), '2026-09-01');
  assert.equal(api._dateAdd('2026-01-01', -1), '2025-12-31');
  assert.equal(api._days('2026-08-03'), 0);
  assert.equal(api._days('2026-08-04'), 1);
});

test('fecha segura considera capacidad diaria', () => {
  const { api } = runtime();
  assert.equal(api.safeDateForHours(1), '2026-08-03');
  assert.equal(api.safeDateForHours(24), '2026-08-03');
  assert.equal(api.safeDateForHours(48), '2026-08-04');
});

test('atrasadas no desplazan ni ocultan tareas de hoy', () => {
  const events = Array.from({ length: 20 }, (_, index) => ({
    id: `old-${index}`,
    recordId: `rec-old-${index}`,
    type: 'ped_delivery',
    fecha: '2026-07-01',
    titulo: `Antigua ${index}`,
    client: 'Cliente',
    personas: ['Gustavo'],
  }));
  events.push({ id: 'today', recordId: 'rec-today', type: 'ped_delivery', fecha: '2026-08-03', titulo: 'Hoy', client: 'Cliente', personas: ['Gustavo'] });
  const { api } = runtime(events);
  const groups = api.groupedFocus(6);
  assert.equal(groups.overdue.length, 6);
  assert.deepEqual(groups.today.map((event) => event.id), ['today']);
});

test('merge multiusuario conserva el registro más nuevo y deduplica historial', () => {
  const { api } = runtime();
  const local = {
    records: { rec1: { stage: 'Impresión', updatedAt: 200 } },
    history: [{ eventId: 'same', at: 10, reason: 'A' }],
    settings: { dailyHours: 24 },
    settingsUpdatedAt: 20,
  };
  const remote = {
    records: { rec1: { stage: 'Diseño', updatedAt: 100 }, rec2: { stage: 'QA', updatedAt: 300 } },
    history: [{ eventId: 'same', at: 10, reason: 'A' }, { eventId: 'remote', at: 11, reason: 'B' }],
    settings: { dailyHours: 8 },
    settingsUpdatedAt: 10,
  };
  const merged = api._mergeStores(local, remote);
  assert.equal(merged.records.rec1.stage, 'Impresión');
  assert.equal(merged.records.rec2.stage, 'QA');
  assert.equal(merged.history.length, 2);
  assert.equal(merged.settings.dailyHours, 24);
});
