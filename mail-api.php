<?php
/**
 * mail-api.php — API de correo para The Lab Solutions Dashboard
 *
 * INSTALACIÓN:
 *   1. Subir este archivo a https://mail-api.thelab.solutions/mail-api.php
 *      (subdominio del cPanel — el sitio principal ya no corre PHP: vive en Vercel)
 *   2. Verificar que PHP IMAP esté habilitado en cPanel > PHP Extensions
 *   3. La bandeja (leer) usa IMAP en mail.thelab.solutions:993 (IMAP SSL).
 *   4. El ENVÍO sale por Resend (API). Configura la key SOLO en el servidor,
 *      de una de estas formas (junto a este archivo, fuera del repo):
 *        a) variable de entorno RESEND_API_KEY, o
 *        b) archivo mail-api-config.php con:  <?php define('RESEND_API_KEY','re_...');
 *        c) archivo resend.key con la clave adentro.
 *      El dominio thelab.solutions debe estar verificado en Resend (SPF/DKIM).
 *      Si NO hay key, cae a SMTP (mail.thelab.solutions:465) como respaldo.
 *
 * REQUISITOS: PHP 7.4+ con extensión IMAP habilitada (curl recomendado para Resend)
 */

$_origins = ['https://thelabsolutionscl.github.io', 'https://dashboard.thelab.solutions'];
$_origin  = $_SERVER['HTTP_ORIGIN'] ?? '';
header('Access-Control-Allow-Origin: ' . (in_array($_origin, $_origins, true) ? $_origin : $_origins[0]));
header('Vary: Origin');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

// Marcador de versión: permite confirmar qué código está realmente desplegado
// (abre la URL en el navegador y mira "build" en el JSON).
define('MAIL_API_BUILD', '2026-07-15-resend2');

// ── Robustez: nunca devolver un 500 con cuerpo no-JSON ────────────────
// Bufferizamos TODA la salida: si ocurre un fatal de PHP, descartamos lo que
// hubiera a medias y respondemos un JSON limpio que incluye el error REAL
// (tipo, mensaje y línea) para poder diagnosticar la causa exacta.
@ini_set('memory_limit', '512M');
@set_time_limit(120);
@ini_set('display_errors', '0');
ob_start();
register_shutdown_function(function () {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_RECOVERABLE_ERROR], true)) {
        while (ob_get_level() > 0) { @ob_end_clean(); }   // descarta salida a medias
        if (!headers_sent()) { http_response_code(200); header('Content-Type: application/json; charset=utf-8'); }
        $detail = sprintf('[tipo %d] %s en %s:%d', $e['type'], $e['message'], basename($e['file'] ?? '?'), $e['line'] ?? 0);
        echo json_encode([
            'error'  => 'Error interno del servidor de correo — detalle técnico: ' . mb_substr($detail, 0, 400),
            'build'  => MAIL_API_BUILD,
        ]);
    } else {
        while (ob_get_level() > 0) { @ob_end_flush(); }   // respuesta normal
    }
});
set_exception_handler(function ($ex) {
    while (ob_get_level() > 0) { @ob_end_clean(); }
    if (!headers_sent()) { http_response_code(200); header('Content-Type: application/json; charset=utf-8'); }
    $detail = get_class($ex) . ': ' . $ex->getMessage() . ' en ' . basename($ex->getFile()) . ':' . $ex->getLine();
    echo json_encode(['error' => 'Error interno del servidor de correo — detalle técnico: ' . mb_substr($detail, 0, 400), 'build' => MAIL_API_BUILD]);
    exit;
});

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

$user   = trim($_POST['user']   ?? '');
$pass   =      $_POST['pass']   ?? '';
$action = trim($_POST['action'] ?? '');

// Config server-side (clave de Resend, etc.). Se carga temprano para poder
// mostrar en el health-check si la clave quedó bien puesta.
if (is_file(__DIR__ . '/mail-api-config.php')) { require_once __DIR__ . '/mail-api-config.php'; }

if (!$user || !$pass) {
    // Al abrir la URL en el navegador (sin credenciales) mostramos un diagnóstico:
    //  resend=true  → se detectó la API key (el envío saldrá por Resend)
    //  cfg=true     → existe el archivo mail-api-config.php junto a este
    echo json_encode([
        'error'  => 'Credenciales requeridas',
        'build'  => MAIL_API_BUILD,
        'resend' => resend_api_key() ? true : false,
        'cfg'    => is_file(__DIR__ . '/mail-api-config.php'),
    ]);
    exit;
}

// ── Polyfills PHP 7.4 ─────────────────────────────────────────
if (!function_exists('str_starts_with')) {
    function str_starts_with($haystack, $needle) {
        return strncmp($haystack, $needle, strlen($needle)) === 0;
    }
}
if (!function_exists('str_contains')) {
    function str_contains($haystack, $needle) {
        return $needle === '' || strpos($haystack, $needle) !== false;
    }
}

// ── Configuración ─────────────────────────────────────────────
define('IMAP_HOST', 'mail.thelab.solutions');
define('IMAP_PORT', 993);
define('SMTP_HOST', 'mail.thelab.solutions');
define('SMTP_PORT', 465);

function imap_str($folder = 'INBOX') {
    return '{' . IMAP_HOST . ':' . IMAP_PORT . '/imap/ssl/novalidate-cert}' . $folder;
}

function open_imap($user, $pass, $folder = 'INBOX') {
    $conn = @imap_open(imap_str($folder), $user, $pass, 0, 1, ['DISABLE_AUTHENTICATOR' => 'GSSAPI']);
    if (!$conn) {
        $errors = imap_errors() ?: [];
        $last   = $errors ? end($errors) : 'No se pudo conectar al servidor de correo';
        return ['error' => $last];
    }
    return $conn;
}

function decode_str($str) {
    if (empty($str)) return '';
    $parts  = imap_mime_header_decode($str);
    $result = '';
    foreach ($parts as $p) {
        $charset = strtoupper($p->charset ?? 'UTF-8');
        $text    = $p->text;
        if ($charset !== 'DEFAULT' && $charset !== 'UTF-8') {
            $text = @mb_convert_encoding($text, 'UTF-8', $charset) ?: $text;
        }
        $result .= $text;
    }
    return $result;
}

function addr_str($addr) {
    if (!$addr) return '';
    $name  = decode_str($addr->personal ?? '');
    $email = ($addr->mailbox ?? '') . '@' . ($addr->host ?? '');
    return $name ? "$name <$email>" : $email;
}

function decode_body($raw, $encoding, $charset) {
    switch ((int)$encoding) {
        case 3: $raw = base64_decode($raw); break;
        case 4: $raw = quoted_printable_decode($raw); break;
    }
    $cs = strtoupper(trim($charset ?: 'UTF-8'));
    if ($cs && $cs !== 'UTF-8') {
        $raw = @mb_convert_encoding($raw, 'UTF-8', $cs) ?: $raw;
    }
    return $raw;
}

function get_charset($params) {
    foreach (($params ?? []) as $p) {
        if (strtolower($p->attribute) === 'charset') return $p->value;
    }
    return 'UTF-8';
}

// Encuentra la primera parte de TEXTO (prefiere text/plain) para el snippet,
// devolviendo [partno, encoding, parameters, bytes, subtype]. NO baja adjuntos:
// así el listado nunca descarga el mensaje completo (evita agotar la memoria).
function find_text_part($structure, $prefix = '') {
    $type = (int)($structure->type ?? 0);
    if ($type === 0) { // text
        $partno = $prefix === '' ? '1' : $prefix;
        return [$partno, (int)($structure->encoding ?? 0), $structure->parameters ?? [], (int)($structure->bytes ?? 0), strtolower($structure->subtype ?? '')];
    }
    if ($type === 1 && !empty($structure->parts)) { // multipart
        $fallback = null;
        foreach ($structure->parts as $i => $part) {
            $pno   = $prefix === '' ? (string)($i + 1) : $prefix . '.' . ($i + 1);
            $found = find_text_part($part, $pno);
            if ($found) {
                if ($found[4] === 'plain') return $found; // preferimos texto plano
                if ($fallback === null) $fallback = $found;
            }
        }
        return $fallback;
    }
    return null;
}

function parse_part($conn, $msgno, $structure, $partno, &$html, &$text, &$atts) {
    $type    = (int)$structure->type;
    $subtype = strtolower($structure->subtype ?? '');

    if ($type === 0) { // text
        $raw     = imap_fetchbody($conn, $msgno, $partno);
        $charset = get_charset($structure->parameters ?? []);
        $decoded = decode_body($raw, $structure->encoding, $charset);
        if ($subtype === 'html') $html .= $decoded;
        else                     $text .= $decoded;

    } elseif ($type === 1) { // multipart
        foreach (($structure->parts ?? []) as $i => $part) {
            $pno = $partno === '' ? (string)($i + 1) : $partno . '.' . ($i + 1);
            parse_part($conn, $msgno, $part, $pno, $html, $text, $atts);
        }

    } else { // attachment / other
        $fname = '';
        foreach (($structure->dparameters ?? []) as $p) {
            if (strtolower($p->attribute) === 'filename') { $fname = decode_str($p->value); break; }
        }
        if (!$fname) {
            foreach (($structure->parameters ?? []) as $p) {
                if (strtolower($p->attribute) === 'name') { $fname = decode_str($p->value); break; }
            }
        }
        if ($fname) $atts[] = ['name' => $fname, 'part' => $partno, 'type' => $type, 'subtype' => $subtype];
    }
}

// ── Envío SMTP ────────────────────────────────────────────────
function smtp_send($user, $pass, $from_name, $to, $cc, $subject, $body_html, $attachments = [], $bcc = '') {
    $sock = @fsockopen('ssl://' . SMTP_HOST, SMTP_PORT, $errno, $errstr, 15);
    if (!$sock) return "No se pudo conectar al servidor SMTP ($errstr)";

    $smtp_read = function() use ($sock) {
        $r = '';
        while (!feof($sock)) {
            $line = fgets($sock, 512);
            $r   .= $line;
            if (isset($line[3]) && $line[3] === ' ') break;
        }
        return $r;
    };
    $smtp_cmd = function($cmd) use ($sock, $smtp_read) {
        fwrite($sock, $cmd . "\r\n");
        return $smtp_read();
    };

    try {
        $smtp_read(); // greeting
        $r = $smtp_cmd('EHLO ' . SMTP_HOST);
        if (!str_starts_with($r, '250')) throw new Exception("EHLO: $r");
        $r = $smtp_cmd('AUTH LOGIN');
        if (!str_starts_with($r, '334')) throw new Exception("AUTH LOGIN: $r");
        $r = $smtp_cmd(base64_encode($user));
        if (!str_starts_with($r, '334')) throw new Exception("User: $r");
        $r = $smtp_cmd(base64_encode($pass));
        if (!str_starts_with($r, '235')) throw new Exception("Pass: $r");

        $from_header = $from_name ? "\"$from_name\" <$user>" : $user;
        $r = $smtp_cmd("MAIL FROM:<$user>");
        if (!str_starts_with($r, '250')) throw new Exception("MAIL FROM: $r");

        // BCC: entra como RCPT TO (recibe el correo) pero NO va en las cabeceras,
        // así los demás destinatarios no lo ven — comportamiento estándar de copia oculta.
        $recipients = array_filter(array_map('trim', array_merge(
            explode(',', $to),
            $cc  ? explode(',', $cc)  : [],
            $bcc ? explode(',', $bcc) : []
        )));
        foreach ($recipients as $rcpt) {
            $addr = preg_match('/<(.+)>/', $rcpt, $m) ? $m[1] : $rcpt;
            $r = $smtp_cmd("RCPT TO:<$addr>");
            if (!str_starts_with($r, '250')) throw new Exception("RCPT TO $addr: $r");
        }

        $r = $smtp_cmd('DATA');
        if (!str_starts_with($r, '354')) throw new Exception("DATA: $r");

        $boundary = 'bound_' . bin2hex(random_bytes(8));
        $date     = date('r');
        $subj_enc = '=?UTF-8?B?' . base64_encode($subject) . '?=';

        // Parte alternativa: texto plano + HTML
        $alt_boundary = 'alt_' . bin2hex(random_bytes(8));
        $alt_part = "--$alt_boundary\r\n"
                  . "Content-Type: text/plain; charset=UTF-8\r\n"
                  . "Content-Transfer-Encoding: quoted-printable\r\n\r\n"
                  . quoted_printable_encode(strip_tags(str_replace(['<br>', '<br/>', '<br />'], "\n", $body_html))) . "\r\n"
                  . "--$alt_boundary\r\n"
                  . "Content-Type: text/html; charset=UTF-8\r\n"
                  . "Content-Transfer-Encoding: quoted-printable\r\n\r\n"
                  . quoted_printable_encode($body_html) . "\r\n"
                  . "--$alt_boundary--";

        $headers = "Date: $date\r\n"
                 . "From: $from_header\r\n"
                 . "To: $to\r\n"
                 . ($cc ? "Cc: $cc\r\n" : '')
                 . "Subject: $subj_enc\r\n"
                 . "MIME-Version: 1.0\r\n";

        if (empty($attachments)) {
            $msg = $headers
                 . "Content-Type: multipart/alternative; boundary=\"$alt_boundary\"\r\n\r\n"
                 . $alt_part;
        } else {
            // multipart/mixed: cuerpo alternativo + adjuntos
            $msg = $headers
                 . "Content-Type: multipart/mixed; boundary=\"$boundary\"\r\n\r\n"
                 . "--$boundary\r\n"
                 . "Content-Type: multipart/alternative; boundary=\"$alt_boundary\"\r\n\r\n"
                 . $alt_part . "\r\n";
            foreach ($attachments as $att) {
                $fname = preg_replace('/[\r\n"]/', '', $att['name'] ?? 'archivo');
                $mime  = preg_replace('/[\r\n]/', '', $att['type'] ?? 'application/octet-stream');
                $fname_enc = '=?UTF-8?B?' . base64_encode($fname) . '?=';
                $msg .= "--$boundary\r\n"
                      . "Content-Type: $mime; name=\"$fname_enc\"\r\n"
                      . "Content-Disposition: attachment; filename=\"$fname_enc\"\r\n"
                      . "Content-Transfer-Encoding: base64\r\n\r\n"
                      . chunk_split($att['data'] ?? '', 76, "\r\n");
            }
            $msg .= "--$boundary--";
        }

        // Escape lines starting with a dot
        $msg = preg_replace('/^\.$/m', '..', $msg);
        fwrite($sock, $msg . "\r\n.\r\n");
        $r = $smtp_read();
        if (!str_starts_with($r, '250')) throw new Exception("Send: $r");

        $smtp_cmd('QUIT');
        fclose($sock);
        return null; // success

    } catch (Exception $e) {
        fclose($sock);
        return $e->getMessage();
    }
}

// ── Envío por Resend (API HTTP) ───────────────────────────────
// El ENVÍO sale por Resend (https://resend.com) para no depender del SMTP del
// hosting (que se suspende al superar su tope). La lectura de la bandeja y el
// guardado en "Enviados" siguen por IMAP.
// La API key vive SOLO en el servidor, nunca en el front:
//   1) variable de entorno RESEND_API_KEY, o
//   2) constante RESEND_API_KEY definida en mail-api-config.php (junto a este
//      archivo, fuera del repo), o
//   3) un archivo resend.key con la clave adentro (junto a este archivo).
//   (mail-api-config.php se incluye arriba, temprano, para el health-check).
function resend_api_key() {
    $k = getenv('RESEND_API_KEY');
    if ($k) return trim($k);
    if (defined('RESEND_API_KEY') && RESEND_API_KEY) return trim(RESEND_API_KEY);
    $f = __DIR__ . '/resend.key';
    if (is_file($f)) return trim((string) @file_get_contents($f));
    return '';
}
function _http_post_json($url, $headers, $bodyJson) {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_POSTFIELDS     => $bodyJson,
        ]);
        $resp = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $cerr = curl_error($ch);
        curl_close($ch);
        return [$resp === false ? null : $resp, $code, $cerr];
    }
    $ctx = stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => implode("\r\n", $headers),
        'content'       => $bodyJson,
        'timeout'       => 30,
        'ignore_errors' => true,
    ]]);
    $resp = @file_get_contents($url, false, $ctx);
    $code = 0;
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) $code = (int) $m[1];
    return [$resp === false ? null : $resp, $code, $resp === false ? 'Sin conexión' : ''];
}
// Devuelve null si se envió OK, o un string de error.
function resend_send($from_name, $from_addr, $to, $cc, $subject, $body_html, $attachments = [], $bcc = '') {
    $key = resend_api_key();
    if (!$key) return 'Falta la API key de Resend en el servidor.';
    $split = function ($s) { return $s ? array_values(array_filter(array_map('trim', explode(',', $s)))) : []; };
    $from  = $from_name ? sprintf('%s <%s>', $from_name, $from_addr) : $from_addr;
    $text  = trim(strip_tags(str_replace(['<br>', '<br/>', '<br />'], "\n", $body_html)));
    $payload = [
        'from'     => $from,
        'to'       => $split($to),
        'subject'  => $subject,
        'html'     => $body_html,
        'reply_to' => $from_addr,
    ];
    if ($text !== '') $payload['text'] = $text;
    if ($cc)  $payload['cc']  = $split($cc);
    if ($bcc) $payload['bcc'] = $split($bcc);
    if (!empty($attachments)) {
        $payload['attachments'] = array_map(function ($a) {
            return ['filename' => $a['name'] ?? 'archivo', 'content' => $a['data'] ?? ''];
        }, $attachments);
    }
    $endpoint = getenv('RESEND_ENDPOINT') ?: 'https://api.resend.com/emails';
    list($resp, $code, $cerr) = _http_post_json(
        $endpoint,
        ['Authorization: Bearer ' . $key, 'Content-Type: application/json'],
        json_encode($payload)
    );
    if ($resp === null) return 'No se pudo contactar a Resend: ' . $cerr;
    $json = json_decode($resp, true);
    if ($code >= 200 && $code < 300 && !empty($json['id'])) return null; // éxito
    $msg = is_array($json) ? ($json['message'] ?? ($json['error']['message'] ?? ($json['name'] ?? $resp))) : $resp;
    return 'Resend (' . $code . '): ' . mb_substr((string) $msg, 0, 300);
}

// ── Router ────────────────────────────────────────────────────
switch ($action) {

// ── folders ──────────────────────────────────────────────────
case 'folders':
    $conn = open_imap($user, $pass);
    if (is_array($conn)) { echo json_encode($conn); exit; }

    $prefix = '{' . IMAP_HOST . ':' . IMAP_PORT . '/imap/ssl/novalidate-cert}';
    $list   = imap_list($conn, $prefix, '*') ?: [];
    $result = [];
    foreach ($list as $f) {
        $name   = str_replace($prefix, '', $f);
        $status = @imap_status($conn, $f, SA_ALL);
        $result[] = [
            'name'     => $name,
            'messages' => $status ? (int)$status->messages : 0,
            'unseen'   => $status ? (int)$status->unseen   : 0,
        ];
    }
    imap_close($conn);
    echo json_encode(['folders' => $result]);
    break;

// ── list ─────────────────────────────────────────────────────
case 'list':
    $folder  = $_POST['folder'] ?? 'INBOX';
    $page    = max(1, (int)($_POST['page'] ?? 1));
    $perpage = 30;

    $conn = open_imap($user, $pass, $folder);
    if (is_array($conn)) { echo json_encode($conn); exit; }

    $total = imap_num_msg($conn);
    $end   = max(1, $total - ($page - 1) * $perpage);
    $start = max(1, $end - $perpage + 1);
    $msgs  = ($total > 0 && $start <= $end) ? (imap_fetch_overview($conn, "$start:$end", 0) ?: []) : [];
    $msgs  = array_reverse($msgs);

    $result = [];
    foreach ($msgs as $m) {
        // SOLO datos de cabecera (envelope) que entrega imap_fetch_overview:
        // NO se lee la estructura ni el cuerpo de cada correo. Así el listado es
        // inmune a correos corruptos o pesados, que antes podían agotar la memoria
        // o incluso crashear la extensión IMAP de PHP → 500 en páginas profundas.
        // (El preview/snippet se sacrifica a cambio de que la bandeja nunca falle.)
        $result[] = [
            'uid'      => (int)($m->uid ?? 0),
            'msgno'    => (int)($m->msgno ?? 0),
            'from'     => decode_str($m->from ?? ''),
            'subject'  => decode_str($m->subject ?? '(Sin asunto)'),
            'date'     => $m->date ?? '',
            'seen'     => (int)($m->seen     ?? 0),
            'answered' => (int)($m->answered ?? 0),
            'flagged'  => (int)($m->flagged  ?? 0),
            'snippet'  => '',
        ];
    }
    imap_close($conn);
    echo json_encode([
        'messages' => $result,
        'total'    => $total,
        'page'     => $page,
        'pages'    => max(1, (int)ceil($total / $perpage)),
        'build'    => MAIL_API_BUILD,
    ]);
    break;

// ── snippets ──────────────────────────────────────────────────
// Vista previa (preview) de un LOTE pequeño de correos, pedida aparte por el
// cliente en segundo plano. Va separada de 'list' a propósito: si un correo
// corrupto hiciera fallar esta lectura, la bandeja ya cargó igual — solo ese
// lote se queda sin preview. Acotada por tamaño y por tiempo.
case 'snippets':
    $folder = $_POST['folder'] ?? 'INBOX';
    $uids   = (string)($_POST['uids'] ?? '');

    $conn = open_imap($user, $pass, $folder);
    if (is_array($conn)) { echo json_encode($conn); exit; }

    $ids = array_slice(array_filter(array_map('intval', explode(',', $uids))), 0, 15);
    $out = [];
    $deadline = microtime(true) + 8.0;
    foreach ($ids as $uid) {
        $snippet = '';
        try {
            if (microtime(true) >= $deadline) break;
            $msgno = @imap_msgno($conn, $uid);
            if ($msgno) {
                $struct = @imap_fetchstructure($conn, $msgno);
                if ($struct) {
                    $tp = find_text_part($struct);
                    if ($tp && $tp[3] <= 200000) { // no bajar partes de texto enormes
                        $raw = @imap_fetchbody($conn, $msgno, $tp[0], FT_PEEK);
                        if ($raw !== false && $raw !== '') {
                            $decoded = decode_body($raw, $tp[1], get_charset($tp[2]));
                            $snippet = mb_substr(trim(preg_replace('/\s+/', ' ', strip_tags($decoded))), 0, 140);
                        }
                    }
                }
            }
        } catch (\Throwable $e) { $snippet = ''; }
        $out[(string)$uid] = $snippet;
    }
    imap_close($conn);
    echo json_encode(['snippets' => $out, 'build' => MAIL_API_BUILD]);
    break;

// ── read ─────────────────────────────────────────────────────
case 'read':
    $folder = $_POST['folder'] ?? 'INBOX';
    $uid    = (int)($_POST['uid'] ?? 0);

    $conn = open_imap($user, $pass, $folder);
    if (is_array($conn)) { echo json_encode($conn); exit; }

    $msgno = imap_msgno($conn, $uid);
    if (!$msgno) { echo json_encode(['error' => 'Mensaje no encontrado']); imap_close($conn); exit; }

    imap_setflag_full($conn, (string)$msgno, '\\Seen');

    $header    = imap_headerinfo($conn, $msgno);
    $structure = imap_fetchstructure($conn, $msgno);

    $html = ''; $text = ''; $atts = [];
    parse_part($conn, $msgno, $structure, '', $html, $text, $atts);

    // If no html and no text, fetch raw body
    if (!$html && !$text) {
        $raw     = imap_body($conn, $msgno);
        $decoded = decode_body($raw, $structure->encoding ?? 0, get_charset($structure->parameters ?? []));
        if (strtolower($structure->subtype ?? '') === 'html') $html = $decoded;
        else $text = $decoded;
    }

    $to_list = [];
    foreach (($header->to ?? []) as $t) {
        $n = decode_str($t->personal ?? '');
        $e = ($t->mailbox ?? '') . '@' . ($t->host ?? '');
        $to_list[] = $n ? "$n <$e>" : $e;
    }

    imap_close($conn);

    $from_name  = decode_str($header->from[0]->personal ?? '');
    $from_email = ($header->from[0]->mailbox ?? '') . '@' . ($header->from[0]->host ?? '');

    echo json_encode([
        'uid'        => $uid,
        'from_name'  => $from_name,
        'from_email' => $from_email,
        'to'         => $to_list,
        'cc'         => array_map(fn($t) => addr_str($t), $header->cc ?? []),
        'subject'    => decode_str($header->subject ?? '(Sin asunto)'),
        'date'       => $header->date ?? '',
        'body_html'  => $html,
        'body_text'  => $text,
        'has_html'   => !empty($html),
        'attachments'=> $atts,
    ]);
    break;

// ── send ─────────────────────────────────────────────────────
case 'send':
    $to        = trim($_POST['to']        ?? '');
    $cc        = trim($_POST['cc']        ?? '');
    $bcc       = trim($_POST['bcc']       ?? '');
    $subject   = trim($_POST['subject']   ?? '');
    $body_html = $_POST['body']           ?? '';
    $from_name = trim($_POST['from_name'] ?? '');

    if (!$to)      { echo json_encode(['error' => 'Destinatario requerido']); exit; }
    if (!$subject) { echo json_encode(['error' => 'Asunto requerido']); exit; }

    // Adjuntos: JSON [{name, type, data(base64)}] — máx 20 MB decodificado
    $attachments = [];
    if (!empty($_POST['atts'])) {
        $parsed = json_decode($_POST['atts'], true);
        if (is_array($parsed)) {
            $total = 0;
            foreach ($parsed as $a) {
                if (empty($a['data']) || empty($a['name'])) continue;
                $total += strlen($a['data']) * 0.75;
                if ($total > 20 * 1024 * 1024) { echo json_encode(['error' => 'Adjuntos superan 20 MB']); exit; }
                $attachments[] = $a;
            }
        }
    }

    // Envío por Resend si hay API key configurada en el servidor; si no, SMTP
    // (respaldo, por si aún no se configura la key). El "from" usa el buzón
    // activo: su dominio debe estar verificado en Resend.
    if (resend_api_key()) {
        $err = resend_send($from_name, $user, $to, $cc, $subject, $body_html, $attachments, $bcc);
    } else {
        $err = smtp_send($user, $pass, $from_name, $to, $cc, $subject, $body_html, $attachments, $bcc);
    }
    if ($err) { echo json_encode(['error' => $err]); exit; }

    // Guardar en carpeta Enviados via IMAP APPEND
    $conn = open_imap($user, $pass);
    if (!is_array($conn)) {
        $prefix = '{' . IMAP_HOST . ':' . IMAP_PORT . '/imap/ssl/novalidate-cert}';
        $list   = imap_list($conn, $prefix, '*') ?: [];
        $sent   = 'Sent';
        foreach ($list as $f) {
            $n = strtolower(str_replace($prefix, '', $f));
            if (str_contains($n, 'sent') || str_contains($n, 'enviado')) { $sent = str_replace($prefix, '', $f); break; }
        }
        $raw = "Date: " . date('r') . "\r\nFrom: $user\r\nTo: $to\r\n"
             . ($cc ? "Cc: $cc\r\n" : '')
             . "Subject: $subject\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n$body_html";
        @imap_append($conn, $prefix . $sent, $raw, '\\Seen');
        imap_close($conn);
    }

    echo json_encode(['ok' => true]);
    break;

// ── trash ─────────────────────────────────────────────────────
case 'trash':
    $folder = $_POST['folder'] ?? 'INBOX';
    $uid    = (int)($_POST['uid'] ?? 0);

    $conn = open_imap($user, $pass, $folder);
    if (is_array($conn)) { echo json_encode($conn); exit; }

    $msgno = imap_msgno($conn, $uid);
    if (!$msgno) { echo json_encode(['error' => 'Mensaje no encontrado']); imap_close($conn); exit; }

    // Try to move to Trash folder first
    $prefix = '{' . IMAP_HOST . ':' . IMAP_PORT . '/imap/ssl/novalidate-cert}';
    $list   = imap_list($conn, $prefix, '*') ?: [];
    $trash  = '';
    foreach ($list as $f) {
        $n = strtolower(str_replace($prefix, '', $f));
        if (str_contains($n, 'trash') || str_contains($n, 'papelera') || str_contains($n, 'deleted')) {
            $trash = str_replace($prefix, '', $f); break;
        }
    }
    if ($trash && $trash !== $folder) {
        imap_mail_move($conn, (string)$msgno, $trash);
    } else {
        imap_delete($conn, (string)$msgno);
    }
    imap_expunge($conn);
    imap_close($conn);
    echo json_encode(['ok' => true]);
    break;

// ── mark ─────────────────────────────────────────────────────
case 'mark':
    $folder = $_POST['folder'] ?? 'INBOX';
    $uid    = (int)($_POST['uid'] ?? 0);
    $seen   = (int)($_POST['seen'] ?? 1);

    $conn = open_imap($user, $pass, $folder);
    if (is_array($conn)) { echo json_encode($conn); exit; }

    $msgno = imap_msgno($conn, $uid);
    if (!$msgno) { echo json_encode(['error' => 'Mensaje no encontrado']); imap_close($conn); exit; }

    if (isset($_POST['flagged'])) {
        if ((int)$_POST['flagged']) imap_setflag_full($conn,   (string)$msgno, '\\Flagged');
        else                        imap_clearflag_full($conn, (string)$msgno, '\\Flagged');
    } else {
        if ($seen) imap_setflag_full($conn,   (string)$msgno, '\\Seen');
        else       imap_clearflag_full($conn, (string)$msgno, '\\Seen');
    }

    imap_close($conn);
    echo json_encode(['ok' => true]);
    break;

// ── search ───────────────────────────────────────────────────
case 'search':
    $folder = $_POST['folder'] ?? 'INBOX';
    $query  = trim($_POST['query'] ?? '');

    if (!$query) { echo json_encode(['messages' => [], 'total' => 0]); exit; }

    $conn = open_imap($user, $pass, $folder);
    if (is_array($conn)) { echo json_encode($conn); exit; }

    $found = imap_search($conn, 'TEXT "' . addslashes($query) . '"') ?: [];
    $found = array_slice(array_reverse($found), 0, 50);

    $result = [];
    foreach ($found as $mn) {
        $ov = imap_fetch_overview($conn, (string)$mn, 0);
        if ($ov) {
            $m = $ov[0];
            $result[] = [
                'uid'     => (int)$m->uid,
                'msgno'   => (int)$m->msgno,
                'from'    => decode_str($m->from    ?? ''),
                'subject' => decode_str($m->subject ?? '(Sin asunto)'),
                'date'    => $m->date ?? '',
                'seen'    => (int)($m->seen ?? 0),
            ];
        }
    }
    imap_close($conn);
    echo json_encode(['messages' => $result, 'total' => count($result)]);
    break;

// ── attachment ────────────────────────────────────────────────
// Descarga un adjunto: devuelve base64 + nombre + mime
case 'attachment':
    $folder = $_POST['folder'] ?? 'INBOX';
    $uid    = (int)($_POST['uid'] ?? 0);
    $part   = $_POST['part'] ?? '';

    if (!$part) { echo json_encode(['error' => 'Parte requerida']); exit; }

    $conn = open_imap($user, $pass, $folder);
    if (is_array($conn)) { echo json_encode($conn); exit; }

    $msgno = imap_msgno($conn, $uid);
    if (!$msgno) { echo json_encode(['error' => 'Mensaje no encontrado']); imap_close($conn); exit; }

    // Localizar la estructura de la parte pedida para conocer encoding y nombre
    $structure = imap_fetchstructure($conn, $msgno);
    $target = $structure;
    foreach (explode('.', $part) as $idx) {
        $i = (int)$idx - 1;
        if (!isset($target->parts[$i])) { echo json_encode(['error' => 'Parte no encontrada']); imap_close($conn); exit; }
        $target = $target->parts[$i];
    }

    $raw = imap_fetchbody($conn, $msgno, $part, FT_PEEK);
    imap_close($conn);

    // Decodificar según encoding original y re-codificar a base64 limpio
    switch ((int)$target->encoding) {
        case 3: $bin = base64_decode($raw); break;
        case 4: $bin = quoted_printable_decode($raw); break;
        default: $bin = $raw;
    }

    $fname = 'archivo';
    foreach (($target->dparameters ?? []) as $p) {
        if (strtolower($p->attribute) === 'filename') { $fname = decode_str($p->value); break; }
    }
    if ($fname === 'archivo') {
        foreach (($target->parameters ?? []) as $p) {
            if (strtolower($p->attribute) === 'name') { $fname = decode_str($p->value); break; }
        }
    }

    $type_names = [0=>'text',1=>'multipart',2=>'message',3=>'application',4=>'audio',5=>'image',6=>'video',7=>'other'];
    $mime = ($type_names[(int)$target->type] ?? 'application') . '/' . strtolower($target->subtype ?? 'octet-stream');

    echo json_encode(['name' => $fname, 'mime' => $mime, 'data' => base64_encode($bin)]);
    break;

// ── check ─────────────────────────────────────────────────────
// Endpoint liviano: solo devuelve el conteo de no leídos en INBOX
case 'check':
    $conn = open_imap($user, $pass, 'INBOX');
    if (is_array($conn)) { echo json_encode($conn); exit; }
    $status = @imap_status($conn, imap_str('INBOX'), SA_ALL);
    imap_close($conn);
    echo json_encode([
        'unseen'   => $status ? (int)$status->unseen   : 0,
        'messages' => $status ? (int)$status->messages : 0,
    ]);
    break;

default:
    echo json_encode(['error' => 'Acción desconocida: ' . htmlspecialchars($action)]);
}
