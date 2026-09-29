'use strict';
const test=require('node:test');
test('lead service route is bounded',()=>{const fs=require('node:fs');const s=fs.readFileSync('airtable-proxy/src/worker.js','utf8');if(!s.includes("leadServiceRoute=url.pathname==='/service/lead/anthropic/v1/messages'"))throw Error('service route missing');});
