'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const css=fs.readFileSync('styles.css','utf8');

test('mobile user menu is not killed by display:none on its parent chip',()=>{
  assert.match(css,/#userChip\{width:0!important;[\s\S]*?visibility:hidden!important;[\s\S]*?pointer-events:none!important;/);
  assert.match(css,/\.user-menu\.open\{position:fixed!important;[\s\S]*?visibility:visible!important;[\s\S]*?pointer-events:auto!important;/);
  const mobileBlocks=[...css.matchAll(/@media\(max-width:768px\)\{([\s\S]*?)(?=\n\}|\n@media|$)/g)].map(m=>m[1]).join('\n');
  assert.doesNotMatch(mobileBlocks,/\.user-chip\s*\{\s*display\s*:\s*none\s*!important/);
});
