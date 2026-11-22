<?php
// The contact form's endpoint (/api/message, rewritten here by .htaccess). It
// hands the message to the server's own mail system, addressed to info@.
//
// The message itself is never stored. The only state is the rate limit: a
// hash of each sender's IP address with the time of each message, in one file
// outside the document root, and entries older than an hour are dropped on
// every request. The privacy policy states exactly that; change the two
// together.
//
// Answers 204 once the mail is handed over, 400 for a form it won't send, 429
// over the rate limit, 502 when the mail system refused and 500 when the
// rate-limit file can't be used. Bodies are empty: the page has its own words
// for each.

const MAX_MESSAGE = 5000; // characters
const PER_SENDER = 5;     // messages per sender (sender() below) per window
const PER_SERVER = 30;    // messages per window in total, against spam from many addresses
const WINDOW = 3600;      // seconds
const TO = 'info@paperballoon.games';
// Sender and bounce address: an alias to info@. Never the visitor's address,
// which would fail SPF/DMARC; theirs goes into Reply-To.
const FROM = 'form@paperballoon.games';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    http_response_code(405);
    exit;
}
if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 32 * 1024) {
    http_response_code(400);
    exit;
}

// In the PHP user's home directory: outside the document root and writable on
// Hetzner (/usr/home/<user>, apart from every site's folder) as in the local
// preview (www-data's /var/www).
$file = @fopen(posix_getpwuid(posix_geteuid())['dir'] . '/contact-ratelimit.json', 'c+');
if (!$file || !flock($file, LOCK_EX)) {
    error_log('contact: rate-limit file unusable');
    http_response_code(500);
    exit;
}
$now = time();
$state = json_decode(stream_get_contents($file), true);
$all = recent($state['all'] ?? [], $now);
$bySender = [];
foreach ($state['by'] ?? [] as $hash => $times) {
    if ($times = recent($times, $now)) {
        $bySender[$hash] = $times;
    }
}

$status = handle($all, $bySender, $now);

ftruncate($file, 0);
rewind($file);
fwrite($file, json_encode(['all' => $all, 'by' => $bySender]));
fclose($file);
http_response_code($status);

function handle(array &$all, array &$bySender, int $now): int
{
    // A field people never see: whatever fills it is told it worked. The
    // page's script never sends it, since autofill fills hidden fields too.
    if (field('website') !== '') {
        return 204;
    }
    $text = trim(field('message'));
    if ($text === '' || !mb_check_encoding($text, 'UTF-8') || mb_strlen($text, 'UTF-8') > MAX_MESSAGE) {
        return 400;
    }
    // Optional, and a bare address when given. The filter rejects line breaks,
    // so it can't smuggle in extra headers.
    $replyTo = trim(field('email'));
    if ($replyTo !== '' && (strlen($replyTo) > 254 || filter_var($replyTo, FILTER_VALIDATE_EMAIL) === false)) {
        return 400;
    }
    $sender = sender();
    if (count($all) >= PER_SERVER || count($bySender[$sender] ?? []) >= PER_SENDER) {
        return 429;
    }
    $all[] = $now;
    $bySender[$sender][] = $now;
    return send($text, $replyTo) ? 204 : 502;
}

function send(string $text, string $replyTo): bool
{
    $headers = [
        'From' => 'Paper Balloon <' . FROM . '>',
        'MIME-Version' => '1.0',
        'Content-Type' => 'text/plain; charset=utf-8',
        'Content-Transfer-Encoding' => 'quoted-printable',
    ];
    if ($replyTo !== '') {
        $headers['Reply-To'] = $replyTo;
    }
    // Mail clients hide Reply-To, so the address is under the message too.
    // Without one, a reply would only reach form@, which is our own inbox.
    $text .= "\n\n" . ($replyTo !== '' ? 'Antwortadresse: ' . $replyTo : 'Keine Antwortadresse angegeben.');
    // CRLF line breaks, which mail() expects and quoted-printable keeps as
    // line breaks (a bare LF would be encoded as =0A).
    $body = quoted_printable_encode(preg_replace('/\r\n?|\n/', "\r\n", $text));
    return mail(TO, subject($text), $body, $headers, '-f' . FROM);
}

// The subject carries the start of the message, so mail clients don't thread
// every form message together.
function subject(string $text): string
{
    $line = trim(strtok(str_replace("\r", "\n", $text), "\n"));
    if (mb_strlen($line, 'UTF-8') > 60) {
        $line = mb_substr($line, 0, 60, 'UTF-8') . '…';
    }
    return mb_encode_mimeheader('[Kontakt] ' . $line, 'UTF-8', 'Q');
}

function field(string $name): string
{
    $value = $_POST[$name] ?? '';
    return is_string($value) ? $value : '';
}

// Who the rate limit counts as one sender: the hash of the IP address, or of
// an IPv6 address's first 64 bits, since one connection holds that whole block
// and could otherwise send from a new address every time.
function sender(): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $bytes = @inet_pton($ip);
    if ($bytes !== false && strlen($bytes) === 16) {
        $ip = bin2hex(substr($bytes, 0, 8));
    }
    return hash('sha256', $ip);
}

// The timestamps still inside the window.
function recent($times, int $now): array
{
    return is_array($times) ? array_values(array_filter($times, fn($t) => is_int($t) && $t > $now - WINDOW)) : [];
}
