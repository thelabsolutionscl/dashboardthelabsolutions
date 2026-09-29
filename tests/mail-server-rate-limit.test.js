#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const php=fs.readFileSync(path.join(__dirname,'../mail-api.php'),'utf8');
const start=php.indexOf('function mail_send_reserve(');
const end=php.indexOf('// ── Router',start);
assert.ok(start>0&&end>start,'server-side quota helper must exist');
const fn=php.slice(start,end);
test('real send route reserves quota AFTER IMAP auth and BEFORE external transport',()=>{
 const send=php.slice(php.indexOf("case 'send':"),php.indexOf("case 'spam':"));
 const auth=send.indexOf('$conn = open_imap($user, $pass)');
 const reserve=send.indexOf('mail_send_reserve($user)');
 const resend=send.indexOf('$err = resend_send(');
 assert.ok(auth>=0&&reserve>auth&&resend>reserve);
 assert.match(send,/http_response_code\(\$quota\['status'\]/);
 assert.match(send,/Retry-After/);
 assert.match(fn,/flock\(\$handle, LOCK_EX\)/);
 assert.match(fn,/fflush\(\$handle\)/);
 assert.match(fn,/hash\('sha256', strtolower\(trim\(\$user\)\)\)/);
});
test('isolated PHP behavior: second account independent; third send gets 429 and valid retry-after',(t)=>{
 const available=spawnSync('php',['-v'],{encoding:'utf8'});
 if(available.error)return t.skip('PHP CLI not present');
 const script=fn+`
  putenv('MAIL_SEND_HOURLY_LIMIT=2');
  $tmp=tempnam(sys_get_temp_dir(),'tls-mail-test-');
  if (!$tmp) exit(7);
  try {
    $one=mail_send_reserve('sales@example.test',$tmp);
    $two=mail_send_reserve('sales@example.test',$tmp);
    $three=mail_send_reserve('sales@example.test',$tmp);
    $other=mail_send_reserve('other@example.test',$tmp);
    if (empty($one['allowed']) || empty($two['allowed']) ||
        ($three['status'] ?? 0)!==429 || ($three['retryAfter'] ?? 0)<1 ||
        empty($other['allowed'])) exit(9);
    echo 'quota_enforced';
  } finally { @unlink($tmp); }
 `;
 const r=spawnSync('php',['-r',script],{encoding:'utf8',timeout:5000});
 assert.equal(r.status,0,(r.stdout||'')+' '+(r.stderr||''));
 assert.match(r.stdout,/quota_enforced/);
});
