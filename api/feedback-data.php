<?php
// The feedback desk's data (/api/feedback-data, rewritten here by .htaccess):
// what feedback.php has stored, for the site owner alone. admin/feedback is
// its only caller.
//
// The password comes with the request and nothing outlives it: no session, no
// cookie. Its hash is one line in feedback/admin.hash in the PHP user's home,
// made on the server with
//   php -r 'echo password_hash("...", PASSWORD_DEFAULT), "\n";'
// Until that file exists every request answers 503.
//
// POST password=...  200 and every game's kept records as one JSON array; each
//                    names its `game`, and the page tells them apart. 401 for
//                    a wrong password, 429 after ten wrong ones in an hour
//                    from one sender (hashed, in feedback/login-ratelimit.json,
//                    as feedback.php keeps its own), 409 while another
//                    password is being checked and 500 when that file can't
//                    be used
// Nothing here may be cached: .htaccess sends no-store for this file.

const WRONG_TRIES = 10; // wrong passwords per sender (sender() in lib.php) per window

require __DIR__ . '/lib.php';

$dir = posix_getpwuid(posix_geteuid())['dir'] . '/feedback';
$hash = trim((string) @file_get_contents($dir . '/admin.hash'));
if ($hash === '') {
    http_response_code(503);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    http_response_code(405);
    exit;
}
$status = login($dir . '/login-ratelimit.json', $hash);
if ($status !== 200) {
    http_response_code($status);
    exit;
}

// The stored lines are JSON already, so they go out as they are, joined into
// an array: the whole set is never held in memory.
header('Content-Type: application/json');
// feedback.php drops the months past KEEP_MONTHS when a submission arrives. If
// nobody sends any more the files would stay, so the desk drops them too.
drop_old_feedback($dir);
$comma = '';
echo '[';
foreach (glob($dir . '/*.jsonl') ?: [] as $path) {
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
echo ']';

// 200 for the right password, 401 for a wrong one, 429 once the sender is over
// the limit, 409 while another is checked. The lock is held while the password
// is checked, so tries sent all at once can't outrun the count.
function login(string $path, string $hash): int
{
    $file = @fopen($path, 'c+');
    if (!$file) {
        error_log('feedback-data: rate-limit file unusable');
        return 500;
    }
    // Refused, not queued: waiting requests would tie up the server's PHP processes.
    if (!flock($file, LOCK_EX | LOCK_NB)) {
        return 409;
    }
    $now = time();
    $by = [];
    foreach (json_decode(stream_get_contents($file), true) ?: [] as $sender => $times) {
        if ($times = recent($times, $now)) {
            $by[$sender] = $times;
        }
    }
    $sender = sender();
    $password = $_POST['password'] ?? '';
    if (count($by[$sender] ?? []) >= WRONG_TRIES) {
        $status = 429;
    } elseif (is_string($password) && password_verify($password, $hash)) {
        $status = 200;
    } else {
        $by[$sender][] = $now;
        $status = 401;
    }
    ftruncate($file, 0);
    rewind($file);
    fwrite($file, json_encode($by));
    fclose($file);
    return $status;
}
