<?php
/**
 * mail-api.php — API de correo para The Lab Solutions Dashboard
 *
 * INSTALACIÓN:
 *   1. Subir este archivo a https://thelab.solutions/mail-api.php
 *   2. Verificar que PHP IMAP esté habilitado en cPanel > PHP Extensions
 *   3. El servidor de correo se conecta a mail.thelab.solutions:993 (IMAP SSL)
 *      y mail.thelab.solutions:465 (SMTP SSL)
 *
 * REQUISITOS: PHP 7.4+ con extensión IMAP habilitada
 */

header('Access-Control-Allow-Origin: https://thelabsolutionscl.github.io');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

$user   = trim($_POST['user']   ?? '');
$pass   =      $_POST['pass']   ?? '';
$action = trim($_POST['action'] ?? '');

if (!$user || !$pass) {
    echo json_encode(['error' => 'Credenciales requeridas']);
    exit;
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
function smtp_send($user, $pass, $from_name, $to, $cc, $subject, $body_html) {
    $sock = @fsockopen('ssl://' . SMTP_HOST, SMTP_PORT, $errno, $errstr, 15);
    if (!$sock) return "No se pudo conectar al servidor SMTP ($errstr)";

    function smtp_read($sock) {
        $r = '';
        while (!feof($sock)) {
            $line = fgets($sock, 512);
            $r   .= $line;
            if (isset($line[3]) && $line[3] === ' ') break;
        }
        return $r;
    }
    function smtp_cmd($sock, $cmd) {
        fwrite($sock, $cmd . "\r\n");
        return smtp_read($sock);
    }

    try {
        smtp_read($sock); // greeting
        $r = smtp_cmd($sock, 'EHLO ' . SMTP_HOST);
        if (!str_starts_with($r, '250')) throw new Exception("EHLO: $r");
        $r = smtp_cmd($sock, 'AUTH LOGIN');
        if (!str_starts_with($r, '334')) throw new Exception("AUTH LOGIN: $r");
        $r = smtp_cmd($sock, base64_encode($user));
        if (!str_starts_with($r, '334')) throw new Exception("User: $r");
        $r = smtp_cmd($sock, base64_encode($pass));
        if (!str_starts_with($r, '235')) throw new Exception("Pass: $r");

        $from_header = $from_name ? "\"$from_name\" <$user>" : $user;
        $r = smtp_cmd($sock, "MAIL FROM:<$user>");
        if (!str_starts_with($r, '250')) throw new Exception("MAIL FROM: $r");

        $recipients = array_filter(array_map('trim', array_merge(
            explode(',', $to),
            $cc ? explode(',', $cc) : []
        )));
        foreach ($recipients as $rcpt) {
            $addr = preg_match('/<(.+)>/', $rcpt, $m) ? $m[1] : $rcpt;
            $r = smtp_cmd($sock, "RCPT TO:<$addr>");
            if (!str_starts_with($r, '250')) throw new Exception("RCPT TO $addr: $r");
        }

        $r = smtp_cmd($sock, 'DATA');
        if (!str_starts_with($r, '354')) throw new Exception("DATA: $r");

        $boundary = 'bound_' . bin2hex(random_bytes(8));
        $date     = date('r');
        $subj_enc = '=?UTF-8?B?' . base64_encode($subject) . '?=';
        $msg      = "Date: $date\r\n"
                  . "From: $from_header\r\n"
                  . "To: $to\r\n"
                  . ($cc ? "Cc: $cc\r\n" : '')
                  . "Subject: $subj_enc\r\n"
                  . "MIME-Version: 1.0\r\n"
                  . "Content-Type: multipart/alternative; boundary=\"$boundary\"\r\n"
                  . "\r\n"
                  . "--$boundary\r\n"
                  . "Content-Type: text/plain; charset=UTF-8\r\n"
                  . "Content-Transfer-Encoding: quoted-printable\r\n\r\n"
                  . quoted_printable_encode(strip_tags(str_replace(['<br>', '<br/>', '<br />'], "\n", $body_html))) . "\r\n"
                  . "--$boundary\r\n"
                  . "Content-Type: text/html; charset=UTF-8\r\n"
                  . "Content-Transfer-Encoding: quoted-printable\r\n\r\n"
                  . quoted_printable_encode($body_html) . "\r\n"
                  . "--$boundary--";

        // Escape lines starting with a dot
        $msg = preg_replace('/^\.$/m', '..', $msg);
        fwrite($sock, $msg . "\r\n.\r\n");
        $r = smtp_read($sock);
        if (!str_starts_with($r, '250')) throw new Exception("Send: $r");

        smtp_cmd($sock, 'QUIT');
        fclose($sock);
        return null; // success

    } catch (Exception $e) {
        fclose($sock);
        return $e->getMessage();
    }
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
        $result[] = [
            'uid'      => (int)$m->uid,
            'msgno'    => (int)$m->msgno,
            'from'     => decode_str($m->from ?? ''),
            'subject'  => decode_str($m->subject ?? '(Sin asunto)'),
            'date'     => $m->date ?? '',
            'seen'     => (int)($m->seen     ?? 0),
            'answered' => (int)($m->answered ?? 0),
            'flagged'  => (int)($m->flagged  ?? 0),
        ];
    }
    imap_close($conn);
    echo json_encode([
        'messages' => $result,
        'total'    => $total,
        'page'     => $page,
        'pages'    => max(1, (int)ceil($total / $perpage)),
    ]);
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
    $subject   = trim($_POST['subject']   ?? '');
    $body_html = $_POST['body']           ?? '';
    $from_name = trim($_POST['from_name'] ?? '');

    if (!$to)      { echo json_encode(['error' => 'Destinatario requerido']); exit; }
    if (!$subject) { echo json_encode(['error' => 'Asunto requerido']); exit; }

    $err = smtp_send($user, $pass, $from_name, $to, $cc, $subject, $body_html);
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

    if ($seen) imap_setflag_full($conn,   (string)$msgno, '\\Seen');
    else       imap_clearflag_full($conn, (string)$msgno, '\\Seen');

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

default:
    echo json_encode(['error' => 'Acción desconocida: ' . htmlspecialchars($action)]);
}
