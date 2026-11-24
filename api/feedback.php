<?php
// The games' feedback endpoint (/api/feedback, rewritten here by .htaccess),
// shared by every game in GAMES. A game's phone controller posts one JSON
// object when a player taps Send on its feedback form; admin/feedback reads
// the result through feedback-data.php.
//
// What is stored, one line per submission in feedback/<game>-YYYY-MM.jsonl in
// the PHP user's home, outside the document root:
// - the day (UTC, no time of day), the game and its build;
// - `session`, a value the game works out on each phone from how the play
//   went, so the phones of one couch send the same one and can be counted as
//   one. It is not an id of a room or a device;
// - what the player answered: the fun rating, the game's own questions
//   (`answers`: a short word or a number each) and the two free texts;
// - `data`, a block the game adds about the session that was played. The
//   service does not know what is in it and only holds its form: numbers,
//   yes/no and short words of a fixed alphabet (TOKEN), so no free text and
//   no markup can ride in it. What each game puts there is the game's to
//   decide; the privacy policy names the kinds of data, not each field.
// Every field is rebuilt by record(): nothing the request carries beyond it
// reaches the file, and neither does the IP address, the user agent or a time
// finer than the day. A month's file is deleted once it is KEEP_MONTHS old:
// here with each submission, and by feedback-data.php whenever the desk loads,
// so a game nobody sends from any more does not keep its files.
//
// The only other state is the rate limit, as for the contact form: a hash of
// each sender's IP address (sender() in lib.php) with the time of each
// submission, in feedback-ratelimit.json beside the folder, entries older
// than an hour dropped on every request. The privacy policy states all of
// this; change the two together.
//
// Answers 204 once the line is written (or, from a preview host, once it has
// passed the checks: those are not kept), 400 for a submission it won't keep,
// 403 for a page that may not post here, 405 for anything but POST, 429 over
// the rate limit, 507 when the month's file is full and 500 when a file can't
// be used. Bodies are empty: the controller has its own words for each.

// One row per game: the origin its controller posts from, and the pattern of
// its preview hosts (main and branch builds). A preview's form works like the
// real one, but what it sends is test data and is not stored. A new game
// needs nothing else here.
const GAMES = [
    'tinytrack' => ['https://tinytrack.paperballoon.games', '/^https:\/\/tinytrack-[a-z0-9-]+\.paperballoon\.games$/D'],
];

const MAX_BODY = 8 * 1024;          // bytes
const MAX_FILE = 50 * 1024 * 1024;  // bytes per monthly file
const PER_SENDER = 20;              // submissions per sender per window: the phones of one couch behind one router, each asked once per cup
const PER_SERVER = 600;             // submissions per window in total, all games together

// The one kind of string `answers` and `data` may hold.
const TOKEN = '/^[A-Za-z0-9 :._#()+-]{0,40}$/D';
const MAX_ANSWERS = 12;
const MAX_DEPTH = 6;                // objects and lists inside one another, `data` itself included
const MAX_VALUES = 600;             // everything in `data`, each object and list counted too

require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    http_response_code(405);
    exit;
}
$body = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > MAX_BODY || strlen($body) > MAX_BODY) {
    http_response_code(400);
    exit;
}
// Objects stay objects (not PHP arrays), so {} and [] can be told apart.
$in = json_decode($body);
$game = $in->game ?? null;
if (!$in instanceof stdClass || !is_string($game) || !isset(GAMES[$game])) {
    http_response_code(400);
    exit;
}

// The game is on another origin. The controller sends text/plain, a "simple"
// request with no preflight, so this header only decides whether its script
// may see the answer. Only the named game's own hosts may post. The one
// exception is this site served on localhost or a private address (the local
// preview), which takes any origin, so a game's dev server can be tried
// against it; under every other name the rule holds, whatever host the server
// is reached by. Requests without an Origin are not from a browser, and the
// rate limit is what holds those.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$preview = false;
if ($origin !== '') {
    [$own, $previews] = GAMES[$game];
    $local = preg_match('/^(localhost|\[::1\]|(127|10|192\.168|172\.(1[6-9]|2\d|3[01]))(\.\d+)+)(:\d+)?$/', $_SERVER['HTTP_HOST'] ?? '');
    $preview = !$local && preg_match($previews, $origin);
    if (!$local && !$preview && $origin !== $own) {
        http_response_code(403);
        exit;
    }
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
try {
    $record = record($in, $game);
} catch (InvalidArgumentException $e) {
    http_response_code(400);
    exit;
}
if ($preview) {
    http_response_code(204);
    exit;
}

// In the PHP user's home directory, as message.php's file is.
$home = posix_getpwuid(posix_geteuid())['dir'];
$file = @fopen($home . '/feedback-ratelimit.json', 'c+');
if (!$file || !flock($file, LOCK_EX)) {
    error_log('feedback: rate-limit file unusable');
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

$status = store($record, $home . '/feedback', $all, $bySender, $now);

ftruncate($file, 0);
rewind($file);
fwrite($file, json_encode(['all' => $all, 'by' => $bySender]));
fclose($file);
http_response_code($status);

// Runs under the rate-limit file's lock, so the size check and the append
// can't race another submission.
function store(array $record, string $dir, array &$all, array &$bySender, int $now): int
{
    $sender = sender();
    if (count($all) >= PER_SERVER || count($bySender[$sender] ?? []) >= PER_SENDER) {
        return 429;
    }
    // The name is a key of GAMES and the server's clock, never the request's words.
    $path = $dir . '/' . $record['game'] . '-' . gmdate('Y-m', $now) . '.jsonl';
    if (@filesize($path) > MAX_FILE) {
        return 507;
    }
    $all[] = $now;
    $bySender[$sender][] = $now;
    $line = json_encode(['day' => gmdate('Y-m-d', $now)] + $record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ((!is_dir($dir) && !@mkdir($dir, 0700)) || @file_put_contents($path, $line . "\n", FILE_APPEND | LOCK_EX) === false) {
        error_log('feedback: cannot write ' . $path);
        return 500;
    }
    drop_old_feedback($dir);
    return 204;
}

// The submission as it is stored: version 1 of the envelope, field by field,
// and the game's data block held to its form. Throws on anything of the wrong
// type or out of range.
function record(stdClass $in, string $game): array
{
    need(($in->v ?? null) === 1);
    $out = ['v' => 1, 'game' => $game, 'build' => match_of($in->build ?? null, '/^[A-Za-z0-9._+#() -]{1,24}$/D')];
    if (isset($in->session)) {
        $out['session'] = match_of($in->session, '/^[A-Za-z0-9]{6,24}$/D');
    }
    if (isset($in->fun)) {
        $out['fun'] = whole($in->fun, 1, 5);
    }
    if (isset($in->answers)) {
        need($in->answers instanceof stdClass);
        $answers = [];
        foreach ($in->answers as $question => $answer) {
            need(preg_match('/^[a-z][a-z0-9_]{0,23}$/D', (string) $question));
            $answers[$question] = is_int($answer) ? whole($answer, 0, 100) : match_of($answer, TOKEN);
        }
        need(count($answers) <= MAX_ANSWERS);
        if ($answers) {
            $out['answers'] = $answers;
        }
    }
    foreach (['liked', 'disliked'] as $key) {
        if (($words = text($in->$key ?? '', 300)) !== '') {
            $out[$key] = $words;
        }
    }
    // Nothing a person said: not feedback.
    need(isset($out['fun']) || isset($out['answers']) || isset($out['liked']) || isset($out['disliked']));

    if (isset($in->data)) {
        need($in->data instanceof stdClass);
        $left = MAX_VALUES;
        $out['data'] = data($in->data, 1, $left);
    }
    return $out;
}

// A copy of a value inside `data`, whatever the game called it: an object, a
// list, yes/no, a number or a TOKEN. $left is how many more values may follow.
function data($value, int $depth, int &$left)
{
    need(--$left >= 0);
    if (is_bool($value) || is_int($value)) {
        return $value;
    }
    if (is_float($value)) {
        // json_decode turns 1e999 into INF, which could not be written back.
        need(is_finite($value));
        return $value;
    }
    if (is_string($value)) {
        return match_of($value, TOKEN);
    }
    need($depth <= MAX_DEPTH);
    if (is_array($value)) {
        $list = [];
        foreach ($value as $item) {
            $list[] = data($item, $depth + 1, $left);
        }
        return $list;
    }
    need($value instanceof stdClass);
    $copy = new stdClass();
    foreach ($value as $key => $item) {
        $key = (string) $key;
        need(preg_match('/^[A-Za-z][A-Za-z0-9_]{0,23}$/D', $key));
        // The desk's script would call it for the object's toString() and fail.
        need($key !== 'toString');
        $copy->$key = data($item, $depth + 1, $left);
    }
    return $copy;
}

function need($ok): void
{
    if (!$ok) {
        throw new InvalidArgumentException();
    }
}

function match_of($value, string $pattern): string
{
    need(is_string($value) && preg_match($pattern, $value));
    return $value;
}

function whole($value, int $min, int $max): int
{
    need(is_int($value) && $value >= $min && $value <= $max);
    return $value;
}

// Free text on one line: line breaks and tabs become a space, other control
// characters go, and so do the marks that override text direction, which
// could make a comment read as something else on the desk. Empty when there
// is nothing left.
function text($value, int $max): string
{
    need(is_string($value) && mb_check_encoding($value, 'UTF-8'));
    $value = preg_replace('/[\r\n\t\x{2028}\x{2029}]+/u', ' ', $value);
    $value = trim(preg_replace('/[\p{Cc}\x{202A}-\x{202E}\x{2066}-\x{2069}]+/u', '', $value));
    need(mb_strlen($value, 'UTF-8') <= $max);
    return $value;
}
