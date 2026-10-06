#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const php=fs.readFileSync(path.join(__dirname,'../mail-api.php'),'utf8');

function block(start,end){
  const a=php.indexOf(start),b=php.indexOf(end,a);
  assert.ok(a>=0&&b>a,'missing block '+start);
  return php.slice(a,b);
}

test('mail API rejects unapproved browser origins and non-POST methods before credentials',()=>{
  assert.match(php,/\$_origin_allowed\s*=\s*in_array\(\$_origin, \$_origins, true\)/);
  assert.match(php,/if \(\$_origin_allowed\) header\('Access-Control-Allow-Origin: ' \. \$_origin\)/);
  assert.doesNotMatch(php,/\? \$_origin : \$_origins\[0\]/,
    'never advertise an approved CORS origin to an unauthorized caller');
  const gate=block("if (!\$_origin_allowed) {","\$user   = trim");
  assert.match(gate,/http_response_code\(403\)/);
  assert.match(gate,/Origen no autorizado/);
  assert.match(gate,/REQUEST_METHOD.*!== 'POST'/s);
  assert.match(gate,/http_response_code\(405\)/);
  assert.match(gate,/Allow: POST, OPTIONS/);
});

test('mailbox identity is constrained to TLS domain accounts',()=>{
  const area=php.slice(php.indexOf("if (!\$user || !\$pass)"),php.indexOf('// ── Polyfills'));
  assert.match(area,/FILTER_VALIDATE_EMAIL/);
  assert.match(area,/@thelab\\\.solutions\$\/i/);
  assert.match(area,/http_response_code\(403\)/);
  assert.match(area,/Casilla no autorizada/);
});

test('send route validates recipients, count, headers, body and attachments server-side',()=>{
  const send=block("case 'send':","case 'spam':");
  for(const field of ['to','cc','bcc'])
    assert.match(send,new RegExp('mail_recipient_list\\(\\$'+field));
  assert.match(send,/\$toCheck\['count'\].*\$ccCheck\['count'\].*\$bccCheck\['count'\]/s);
  assert.match(send,/Máximo 50 destinatarios/);
  assert.match(send,/strlen\(\$subject\) > 250/);
  assert.match(send,/strlen\(\$body_html\) > 2 \* 1024 \* 1024/);
  assert.match(send,/strlen\(\$from_name\) > 120/);
  assert.match(send,/mail_parse_outgoing_attachments\(\$_POST\['atts'\]/);
  const auth=send.indexOf('$conn = open_imap($user, $pass)');
  const external=send.indexOf('$err = resend_send(');
  assert.ok(auth>0&&external>auth,'IMAP authentication must still happen before Resend');
});

test('outgoing attachment helper rejects malformed base64 and count overflow',t=>{
  const start=php.indexOf('function mail_parse_outgoing_attachments(');
  const end=php.indexOf('function decode_str(',start);
  assert.ok(start>0&&end>start);
  const helper=php.slice(start,end);
  assert.match(helper,/count\(\$parsed\) > 10/);
  assert.match(helper,/base64_decode\(\$a\['data'\], true\)/);
  assert.match(helper,/\$total > 20 \* 1024 \* 1024/);

  const available=spawnSync('php',['-v'],{encoding:'utf8'});
  if(available.error)return t.skip('PHP CLI not present');
  const script=helper+
    "\n$ok=mail_parse_outgoing_attachments(json_encode(["+
    "['name'=>'uno.pdf','type'=>'application/pdf','data'=>base64_encode('abc')],"+
    "['name'=>'dos.txt','type'=>'text/plain','data'=>base64_encode('xyz')]"+
    "]));"+
    "if (count($ok['attachments'] ?? [])!==2 || ($ok['bytes'] ?? 0)!==6) exit(10);"+
    "$bad=mail_parse_outgoing_attachments(json_encode(["+
    "['name'=>'malo.pdf','type'=>'application/pdf','data'=>'***not-base64***']"+
    "]));"+
    "if (($bad['error'] ?? '')!=='Adjunto base64 inválido') exit(11);"+
    "$many=[]; for($i=0;$i<11;$i++) $many[]=['name'=>'f'.$i.'.txt','data'=>base64_encode('x')];"+
    "$tooMany=mail_parse_outgoing_attachments(json_encode($many));"+
    "if (($tooMany['error'] ?? '')!=='Máximo 10 adjuntos por correo') exit(12);"+
    "echo 'mail_attachment_validation_ok';";
  const r=spawnSync('php',['-r',script],{encoding:'utf8',timeout:5000});
  assert.equal(r.status,0,(r.stdout||'')+' '+(r.stderr||''));
  assert.match(r.stdout,/mail_attachment_validation_ok/);
});

test('recipient parser performs server-side RFC822 validation and count limiting',()=>{
  const fn=block('function mail_recipient_list(','function mail_parse_outgoing_attachments(');
  assert.match(fn,/imap_rfc822_parse_adrlist/);
  assert.match(fn,/FILTER_VALIDATE_EMAIL/);
  assert.match(fn,/count\(\$emails\) > \$max/);
  assert.match(fn,/implode\(',', \$emails\)/);
  assert.match(fn,/preg_replace\('\/\[;\\r\\n\]\+\/'/);
});

test('attachment download validates part path and applies preflight plus decoded caps',()=>{
  const att=block("case 'attachment':","case 'check':");
  assert.match(att,/\$uid < 1/);
  assert.match(att,/preg_match\('\/\^\\d\+\(\?:\\\\\.\\d\+\)\*\$\/'/);
  assert.match(att,/\$target->bytes.*28 \* 1024 \* 1024/s);
  assert.match(att,/strlen\(\$raw\) > 28 \* 1024 \* 1024/);
  assert.match(att,/base64_decode\(\$raw, true\)/);
  assert.match(att,/strlen\(\$bin\) > 20 \* 1024 \* 1024/);
  assert.match(att,/mb_substr\(trim\(\$fname\), 0, 200\)/);
});

test('build marker identifies October boundary hardening',()=>{
  assert.match(php,/MAIL_API_BUILD', '2026-10-06-mail-boundaries'/);
});
