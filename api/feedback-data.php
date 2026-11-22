<?php
// The feedback desk's data (/api/feedback-data, rewritten here by .htaccess):
// what feedback.php has stored, for the site owner alone. admin/feedback is
// its only caller.
//
// The login is a PHP session, so the site needs no absolute server path as
// Basic Auth's AuthUserFile would. The password's hash is one line in
// feedback/admin.hash in the PHP user's home, made on the server with
//   php -r 'echo password_hash("...", PASSWORD_DEFAULT), "\n";'
// Until that file exists every request answers 503.
//
// POST password=...  204 and a session cookie, or 401; 429 after ten tries in
//                    an hour from one sender (hashed, in
//                    feedback/login-ratelimit.json, as feedback.php keeps its own)
// POST logout=1      204, the session is gone
// GET ?months=N      every game's records of the last N months (1 to
//                    KEEP_MONTHS, default 3) as one JSON array, oldest month
//                    first; each names its `game`, and the page tells them
//                    apart. 401 unless logged in
// Nothing here may be cached: .htaccess sends no-store for this file.

const TRIES = 10;            // logins per sender per window
const WINDOW = 3600;         // seconds
const KEEP_MONTHS = 24;      // feedback.php's: the monthly files kept, this month included
const SESSION = 12 * 3600;   // seconds a login lasts without a request

$dir = posix_getpwuid(posix_geteuid())['dir'] . '/feedback';
$hash = trim((string) @file_get_contents($dir . '/admin.hash'));
if ($hash === '') {
    http_response_code(503);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (($_POST['logout'] ?? '') === '1') {
        if (resume($dir)) {
            session_destroy();
        }
        http_response_code(204);
        exit;
    }
    $password = $_POST['password'] ?? '';
    if (!allowed($dir . '/login-ratelimit.json')) {
        http_response_code(429);
        exit;
    }
    if (!is_string($password) || !password_verify($password, $hash)) {
        http_response_code(401);
        exit;
    }
    session($dir);
    // A fresh id, so one planted before the login is worth nothing.
    session_regenerate_id(true);
    $_SESSION['owner'] = true;
    http_response_code(204);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    header('Allow: GET, POST');
    http_response_code(405);
    exit;
}
if (!resume($dir)) {
    http_response_code(401);
    exit;
}
$months = filter_var($_GET['months'] ?? 3, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => KEEP_MONTHS]]);
if ($months === false) {
    http_response_code(400);
    exit;
}
// Lets the page's other requests through while this one streams.
session_write_close();

// The stored lines are JSON already, so they go out as they are, joined into
// an array: the whole set is never held in memory.
header('Content-Type: application/json');
$first = new DateTimeImmutable('first day of this month', new DateTimeZone('UTC'));
// feedback.php drops the months past KEEP_MONTHS when a submission arrives. A
// game nobody sends from any more would keep its files, so the desk drops
// them too.
$oldest = $first->modify('-' . (KEEP_MONTHS - 1) . ' month')->format('Y-m');
foreach (glob($dir . '/*.jsonl') ?: [] as $kept) {
    if (preg_match('/-(\d{4}-\d{2})\.jsonl$/', $kept, $month) && strcmp($month[1], $oldest) < 0) {
        @unlink($kept);
    }
}
$comma = '';
echo '[';
for ($back = $months - 1; $back >= 0; $back--) {
    foreach (glob($dir . '/*-' . $first->modify("-$back month")->format('Y-m') . '.jsonl') ?: [] as $path) {
        $file = @fopen($path, 'r');
        if (!$file) {
            continue;
        }
        // feedback.php appends under an exclusive lock: never half a line.
        flock($file, LOCK_SH);
        while (($line = fgets($file)) !== false) {
            // A line cut short (a full disk, say) is left out: it would make
            // the whole array unreadable.
            if (($line = rtrim($line)) !== '' && json_decode($line) !== null) {
                echo $comma, $line;
                $comma = ',';
            }
        }
        fclose($file);
    }
}
echo ']';

function session(string $dir): void
{
    // Sessions are kept beside the data, not in a temp folder other accounts
    // on a shared host might read or write.
    if (!is_dir($dir . '/sessions')) {
        mkdir($dir . '/sessions', 0700);
    }
    session_save_path($dir . '/sessions');
    ini_set('session.use_strict_mode', '1');
    // How long a login lasts and when its file goes are set here, not left to
    // the host's php.ini: a session unused for SESSION seconds is removed by
    // one in twenty of the requests that start one.
    ini_set('session.gc_maxlifetime', (string) SESSION);
    ini_set('session.gc_probability', '1');
    ini_set('session.gc_divisor', '20');
    // PHP's own cache headers would double the one .htaccess sends.
    session_cache_limiter('');
    session_set_cookie_params([
        'path' => '/api/feedback-data',
        // Plain HTTP only ever in a local preview.
        'secure' => ($_SERVER['HTTPS'] ?? 'off') !== 'off' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https',
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
}

// Picks up the owner's session, if the request's cookie names one. Without a
// cookie there is none to pick up, and starting one would leave a file per
// stray request; so would a cookie that names no login, which strict mode
// answers with a fresh, empty session, so that one is removed again.
function resume(string $dir): bool
{
    if (!isset($_COOKIE[session_name()])) {
        return false;
    }
    session($dir);
    if (empty($_SESSION['owner'])) {
        session_destroy();
        return false;
    }
    return true;
}

// Counts this login try against the sender's ten per hour; false once over.
// A sender is an IP address, or an IPv6 address's first 64 bits: one
// connection holds that whole block and could otherwise guess from a new
// address every time.
function allowed(string $path): bool
{
    $file = @fopen($path, 'c+');
    if (!$file || !flock($file, LOCK_EX)) {
        error_log('feedback-data: rate-limit file unusable');
        return false;
    }
    $now = time();
    $by = [];
    foreach (json_decode(stream_get_contents($file), true) ?: [] as $sender => $times) {
        if ($times = array_values(array_filter((array) $times, fn($t) => is_int($t) && $t > $now - WINDOW))) {
            $by[$sender] = $times;
        }
    }
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $bytes = @inet_pton($ip);
    if ($bytes !== false && strlen($bytes) === 16) {
        $ip = bin2hex(substr($bytes, 0, 8));
    }
    $sender = hash('sha256', $ip);
    $ok = count($by[$sender] ?? []) < TRIES;
    if ($ok) {
        $by[$sender][] = $now;
    }
    ftruncate($file, 0);
    rewind($file);
    fwrite($file, json_encode($by));
    fclose($file);
    return $ok;
}
