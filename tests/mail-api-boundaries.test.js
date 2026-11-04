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
  const policyStart=php.indexOf('function mail_active_attachment_blocked(');
  const start=php.indexOf('function mail_parse_outgoing_attachments(');
  const end=php.indexOf('function decode_str(',start);
  assert.ok(policyStart>0&&start>policyStart&&end>start);
  const helper=php.slice(policyStart,end);
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
  assert.ok(att.includes("preg_match('/^\\d+(?:\\.\\d+)*$/', $part)"),
    'part must be a dotted numeric IMAP section');
  assert.match(att,/\$target->bytes.*28 \* 1024 \* 1024/s);
  assert.match(att,/strlen\(\$raw\) > 28 \* 1024 \* 1024/);
  assert.match(att,/base64_decode\(\$raw, true\)/);
  assert.match(att,/strlen\(\$bin\) > 20 \* 1024 \* 1024/);
  assert.match(att,/mb_substr\(trim\(\$fname\), 0, 200\)/);
});

test('build marker identifies the charset-safe read deploy',()=>{
  assert.match(php,/MAIL_API_BUILD', '2026-11-04-mail-read-charset-safe'/);
});

test('reading a message never 500s on an unknown or malformed charset',t=>{
  // PHP 8: mb_convert_encoding() lanza ValueError con un charset desconocido y
  // el @ no lo silencia. Ningún mb_convert_encoding del camino de lectura puede
  // recibir el charset que declara el correo sin pasar por la versión segura.
  const decoders=block('function decode_str(','function looks_binary(');
  const risky=[...decoders.matchAll(/^.*mb_convert_encoding\([^)]*,\s*\$\w+\s*\).*$/gm)].map(m=>m[0]);
  assert.ok(risky.length>0,'expected the guarded converter');
  for(const line of risky)
    assert.match(line,/try \{/,'mb_convert_encoding con charset variable debe ir dentro de try: '+line.trim());
  assert.match(decoders,/catch \(\\Throwable \$e\)/);
  assert.match(decoders,/iconv\(\$cs, 'UTF-8\/\/IGNORE'/);
  const part=block('function parse_part(','// ── Envío SMTP');
  assert.match(part,/try \{[\s\S]*?decode_transfer[\s\S]*?\} catch \(\\Throwable \$e\)/,
    'una parte rota se omite sin tumbar el mensaje');
  const read=block("case 'read':","case 'send':");
  assert.match(read,/try \{\s*parse_part\(/);
  assert.match(read,/catch \(\\Throwable \$e\)/);

  const available=spawnSync('php',['-v'],{encoding:'utf8'});
  if(available.error)return t.skip('PHP CLI not present');
  const helpers=block('function decode_str(','function looks_binary(');
  const script=helpers+`
$latin = "Cotizaci\\xF3n";
$cases = ['x-unknown','unknown-8bit','iso-8859-8-i','ks_c_5601-1987','3Dutf-8','"utf-8"','utf-8*es',
          'windows-1250','windows-1257','macintosh','x-mac-roman','big5','_iso-2022-jp$esc','cp-850','', null];
foreach ($cases as $cs) {
    $out = to_utf8($latin, $cs);
    if (!is_string($out) || !mb_check_encoding($out, 'UTF-8')) { echo "bad:" . var_export($cs, true); exit(20); }
}
if (to_utf8("Cotizaci\\xC3\\xB3n", 'x-unknown') !== 'Cotización') exit(21);
if (to_utf8($latin, 'iso-8859-1') !== 'Cotización') exit(22);
if (to_utf8($latin, 'win-1252') !== 'Cotización') exit(23);
if (to_utf8("Cotizaci\\xF3n", 'iso8859-15') !== 'Cotización') exit(24);
if (to_utf8("\\xE8au", 'windows-1250') !== 'čau') exit(25);
if (mail_convert_to_utf8('abc', 'x-unknown') !== false) exit(26);
if (mail_convert_to_utf8('abc', 'base64') !== false) exit(27);
echo 'mail_charset_safe_ok';`;
  const r=spawnSync('php',['-r',script],{encoding:'utf8',timeout:5000});
  assert.equal(r.status,0,(r.stdout||'')+' '+(r.stderr||''));
  assert.match(r.stdout,/mail_charset_safe_ok/);
});
