// Inline the real ESM dependency for existing new Function worker harnesses.
module.exports = require('node:fs').readFileSync(
  require('node:path').join(__dirname, '../../lead-worker/src/client-match.js'), 'utf8'
).replace(/export function /g, 'function ');
