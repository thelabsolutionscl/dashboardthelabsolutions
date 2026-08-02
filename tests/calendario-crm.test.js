#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const CAL_SRC = fs.readFileSync(path.join(ROOT, 'js', 'calendario-base.js'), 'utf8');
const LOADER_SRC = fs.readFileSync(path.join(ROOT, 'js', 'calendario.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const MOPS = fs.readFileSync(path.join(ROOT, 'js', 'maquinas-operaciones.js'), 'utf8');

function calendarContext(state = { cotizaciones: [], pedidos: [], clientes: [] }) {
  const storage = new Map();
  const context = vm.createContext({
    console, Date, Intl, JSON, Math, Set, Map,
    state,
    PERSONAS: [
      { id: 'gustavo', nombre: 'Gustavo Kaiser', color: '#00d4cc' },
      { id: 'nicanor', nombre: 'Nicanor Marambio', color: '#ff6b35' },
      { id: 'florencia', nombre: 'Florencia Cancino', color: '#a78bfa' },
    ],
    resolveClienteName: value => Array.isArray(value) ? (value[0] || 'Sin cliente') : (value || 'Sin cliente'),
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    setTimeout: () => 0,
    setInterval: () => 0,
    clearInterval: () => {},
  });
  vm.runInContext(CAL_SRC, context, { filename: 'calendario-base.js' });
  return context;
}

test('el cargador respeta el orden completo de módulos', () => {
  const expected = [
    'js/calendario-base.js',
    'js/calendario-operaciones.js',
    'js/calendario-collapsible.js',
    'js/tv-logo-fix.js',
    'js/tv-control-center.js',
  ];
  let cursor = -1;
  for (const file of expected) {
    const next = LOADER_SRC.indexOf(file);
    assert.ok(next > cursor, `${file} debe cargarse en orden`);
    cursor = next;
  }
  assert.match(LOADER_SRC, /CalendarModulesReady/);
  assert.match(LOADER_SRC, /thelab:calendar-ready/);
});

test('genera compromisos CRM distintos para cotizaciones y pedidos', () => {
  const state = {
    clientes: [],
    cotizaciones: [
      { id: 'cot-pend', fields: { 'N° Cotización': 'COT-1', 'Estado cotización': 'Solicitada', 'Fecha límite cotización': '2026-08-05', Vendedor: 'Gustavo' } },
      { id: 'cot-send', fields: { 'N° Cotización': 'COT-2', 'Estado cotización': 'Enviada', 'Fecha vencimiento': '2026-08-15', Vendedor: 'Florencia' } },
    ],
    pedidos: [
      { id: 'ped-1', fields: { 'N° Pedido': 'PED-1', 'Estado pedido': 'En producción', 'Fecha objetivo interna': '2026-08-08', 'Fecha entrega': '2026-08-11', 'Equipo asignado': 'Nicanor, Gustavo Kaiser' } },
    ],
  };
  const ctx = calendarContext(state);
  const events = vm.runInContext('_calCrmEvents()', ctx);
  assert.deepEqual(Array.from(events, e => e.type), ['cot_due', 'cot_expiry', 'ped_internal', 'ped_delivery']);
  assert.equal(events[0].id, 'crm-cot-due-cot-pend');
  assert.deepEqual(Array.from(events[0].personas), ['gustavo']);
  assert.equal(events[2].field, 'Fecha objetivo interna');
  assert.equal(events[3].field, 'Fecha entrega');
  assert.deepEqual(Array.from(events[2].personas), ['nicanor', 'gustavo']);
});

test('no muestra compromisos cerrados ni fecha de preparación después de enviar', () => {
  const state = {
    clientes: [],
    cotizaciones: [
      { id: 'sent', fields: { 'Estado cotización': 'Enviada', 'Fecha límite cotización': '2026-08-05', 'Fecha vencimiento': '2026-08-20' } },
      { id: 'closed', fields: { 'Estado cotización': 'Aprobada', 'Fecha límite cotización': '2026-08-05' } },
    ],
    pedidos: [{ id: 'done', fields: { 'Estado pedido': 'Completado', 'Fecha entrega': '2026-08-10' } }],
  };
  const events = vm.runInContext('_calCrmEvents()', calendarContext(state));
  assert.deepEqual(Array.from(events, e => e.type), ['cot_expiry']);
});

test('fechas internas saltan fines de semana y feriados nacionales de Chile', () => {
  const ctx = calendarContext();
  assert.equal(vm.runInContext("calBusinessDate('2026-09-17', 1)", ctx), '2026-09-21');
  assert.equal(vm.runInContext("calInternalDate('2026-09-22', 2)", ctx), '2026-09-17');
  assert.equal(vm.runInContext("calBusinessDate('2026-04-02', 1)", ctx), '2026-04-06');
  assert.equal(vm.runInContext("calBusinessDate('2027-06-18', 1)", ctx), '2027-06-22');
  assert.equal(vm.runInContext("calBusinessDate('2028-06-23', 1)", ctx), '2028-06-27');
});

test('sugiere fechas seguras y mantiene Despachado bajo control hasta Completado', () => {
  const state = {
    clientes: [],
    cotizaciones: [
      { id: 'requested', fields: { 'N° Cotización': 'COT-10', 'Estado cotización': 'Solicitada', 'Fecha cotización': '2099-08-03' } },
      { id: 'sent', fields: { 'N° Cotización': 'COT-11', 'Estado cotización': 'Enviada', 'Fecha cotización': '2099-08-03' } },
    ],
    pedidos: [
      { id: 'shipped', fields: { 'N° Pedido': 'PED-10', 'Estado pedido': 'Despachado' } },
      { id: 'production', fields: { 'N° Pedido': 'PED-11', 'Estado pedido': 'En producción', 'Fecha entrega': '2026-09-22' } },
      { id: 'done', fields: { 'N° Pedido': 'PED-12', 'Estado pedido': 'Completado' } },
    ],
  };
  const rows = vm.runInContext('_calMissingItems()', calendarContext(state));
  const plain = Array.from(rows, row => ({ id: row.id, field: row.field, suggested: row.suggested }));
  assert.deepEqual(plain, [
    { id: 'requested', field: 'Fecha límite cotización', suggested: '2099-08-05' },
    { id: 'sent', field: 'Fecha vencimiento', suggested: '2099-08-17' },
    { id: 'shipped', field: 'Fecha entrega', suggested: '' },
    { id: 'shipped', field: 'Fecha objetivo interna', suggested: '' },
    { id: 'production', field: 'Fecha objetivo interna', suggested: '2026-09-17' },
  ]);
});

test('bloquea secuencias de fechas incoherentes', () => {
  const ctx = calendarContext();
  assert.match(vm.runInContext("_calValidateCrmDates('pedido',{internal:'2026-08-12',delivery:'2026-08-10'})", ctx), /meta interna/);
  assert.match(vm.runInContext("_calValidateCrmDates('cotizacion',{due:'2026-08-12',expiry:'2026-08-10'})", ctx), /vencimiento/);
  assert.equal(vm.runInContext("_calValidateCrmDates('pedido',{internal:'2026-08-08',delivery:'2026-08-10'})", ctx), '');
});

test('Google Calendar recibe la secuencia completa de recordatorios CRM', () => {
  const ctx = calendarContext();
  const body = vm.runInContext("_calGcalBody({titulo:'Entrega',fecha:'2026-08-10',allDay:true,reminders:[4320,1440,180,0]}, 'direct', '')", ctx);
  assert.equal(body.reminders.useDefault, false);
  assert.deepEqual(Array.from(body.reminders.overrides, x => x.minutes), [4320, 1440, 180, 0]);
});

test('concilia IDs de Google entre navegadores y conserva lápidas recientes', () => {
  const ctx = calendarContext();
  const merged = vm.runInContext(`_calCrmMetaMerge(
    {a:{gcal:{gustavo:{ev:'g1'}},gsyncMts:100}},
    {a:{gcal:{florencia:{ev:'f1'}},gsyncMts:200},b:{gcal:{},gsyncMts:Date.now(),del:true}}
  )`, ctx);
  assert.deepEqual(Object.keys(merged.a.gcal).sort(), ['florencia', 'gustavo']);
  assert.equal(merged.b.del, true);
  assert.deepEqual(Object.keys(merged.b.gcal), []);
  const removed = vm.runInContext(`_calCrmMetaMerge(
    {a:{gcal:{gustavo:{ev:'old',mts:100}},gsyncMts:100}},
    {a:{gcal:{},removed:{gustavo:300},gsyncMts:300}}
  )`, ctx);
  assert.deepEqual(Object.keys(removed.a.gcal), []);
  assert.equal(removed.a.removed.gustavo, 300);
});

test('UI y persistencia incluyen fechas, historial, vistas y sincronización selectiva', () => {
  for (const id of ['calKpis', 'calFocus', 'calTipoChips', 'calSinFecha', 'calMissingSummary', 'calApplySuggestedBtn', 'calHistory', 'calCrmModal', 'cot-fecha-limite', 'editCotFechaLimite', 'editPedidoFechaInterna']) {
    assert.match(HTML, new RegExp(`id=["']${id}["']`), `falta ${id}`);
  }
  for (const field of ['Fecha límite cotización', 'Fecha objetivo interna', 'Historial fechas calendario']) assert.match(HTML + CAL_SRC, new RegExp(field));
  for (const type of ['cot_due', 'cot_expiry', 'ped_internal', 'ped_delivery']) assert.match(CAL_SRC, new RegExp(type));
  assert.match(CAL_SRC, /function calRescheduleEvent/);
  assert.match(CAL_SRC, /Motivo:/);
  assert.match(CAL_SRC, /function calShareReminder/);
  assert.match(CAL_SRC, /function calApplySuggestedDates/);
  assert.match(CAL_SRC, /function renderCalFocus/);
  assert.match(MOPS, /function deadlineCapacityRisk/);
  assert.match(MOPS, /deadlineCapacityRisk,/);
});
