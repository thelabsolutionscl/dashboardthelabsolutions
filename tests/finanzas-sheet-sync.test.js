'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const bridge=fs.readFileSync('js/finanzas-sheet-sync.js','utf8');
const finance=fs.readFileSync('js/finanzas.js','utf8');

test('Google Sheets finance UI compiles as classic browser JavaScript',()=>{
  assert.doesNotThrow(()=>new Function(bridge));
});
test('bridge targets exactly the selected spreadsheet and the November 2026 template',()=>{
  assert.match(bridge,/12OYYXY8ExcAvhwB_A4PTPkghowA5Cm_8BSgJ_gZAuqo/);
  assert.match(bridge,/const SHEET_NAME='NOVIEMBRE 2026'/);
  assert.match(bridge,/const DAYS=30/);
  assert.match(bridge,/day\+3/);
});
test('read/write is limited to daily ledger cells; monthly totals/formulas remain untouched',()=>{
  assert.match(bridge,/read\('C3:F34'\)/);
  assert.match(bridge,/read\('I3'\)/);
  assert.match(bridge,/sheetRange\('D'\+row\+':F'\+row\)/);
  assert.doesNotMatch(bridge,/sheetRange\('H'\+row/);
  assert.doesNotMatch(bridge,/sheetRange\('I'\+row/);
});
test('optimistic remote read checks source day and refuses stale values before updates',()=>{
  assert.match(bridge,/read\('C'\+row\+':F'\+row\)/);
  assert.match(bridge,/Number\(cells\[0\]\)!==day/);
  assert.match(bridge,/equal\(rowValue\(cells\.slice\(1\)\),bases\.get\(row\)\)/);
  assert.match(bridge,/await write\(row,values\)/);
  assert.match(bridge,/await read\('C'\+row\+':F'\+row\)/);
});
test('frontend reuses existing Google Drive OAuth instead of committing service secrets',()=>{
  assert.match(bridge,/_driveApiFetch/);
  assert.doesNotMatch(bridge,/sk-ant-|AIza[0-9A-Za-z_-]+|client_secret|private_key/);
  assert.match(finance,/js\/finanzas-sheet-sync\.js\?v=20261105/);
});
test('sync never copies manual Sheets rows into the shared accounting document or invoices',()=>{
  assert.doesNotMatch(bridge,/_finSharedMutate|\/shared\/finance|airtableWrite|finFacturas/);
});

test('Google Sheets panel is readable against the dark dashboard theme',()=>{
  assert.match(bridge,/#tls-sheet-caja\{[^}]*background:#11191c!important;color:#edf6f6!important/);
  assert.match(bridge,/#tls-sheet-caja \[data-tls-refresh\]\{[^}]*background:#00c7c0!important;color:#082122!important/);
  assert.match(bridge,/#tls-sheet-caja \.tls-sheet-field\{[^}]*background:#0c1518!important;color:#f5fafa!important/);
  assert.match(finance,/js\/finanzas-sheet-sync\.js\?v=20261105-dark2/);
});
