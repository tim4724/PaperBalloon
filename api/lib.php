<?php
// What the endpoints here share: the rate limits' window and who they count
// as one sender, and how long feedback is kept. Only included, never asked
// for: on its own it answers nothing.

const WINDOW = 3600;     // seconds a rate limit looks back
const KEEP_MONTHS = 24;  // monthly feedback files kept, this month included: the privacy policy's promise

// Who a rate limit counts as one sender: the hash of the IP address, or of an
// IPv6 address's first 56 bits, since one home connection often holds that
// whole block and could otherwise send from a new address every time.
function sender(): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $bytes = @inet_pton($ip);
    if ($bytes !== false && strlen($bytes) === 16) {
        $ip = bin2hex(substr($bytes, 0, 7));
    }
    return hash('sha256', $ip);
}

// The timestamps still inside the window.
function recent($times, int $now): array
{
    return is_array($times) ? array_values(array_filter($times, fn($t) => is_int($t) && $t > $now - WINDOW)) : [];
}

// Deletes every game's monthly files from before the oldest kept month.
function drop_old_feedback(string $dir): void
{
    $oldest = (new DateTimeImmutable('first day of this month', new DateTimeZone('UTC')))
        ->modify('-' . (KEEP_MONTHS - 1) . ' month')->format('Y-m');
    foreach (glob($dir . '/*.jsonl') ?: [] as $kept) {
        if (preg_match('/-(\d{4}-\d{2})\.jsonl$/', $kept, $month) && strcmp($month[1], $oldest) < 0) {
            @unlink($kept);
        }
    }
}
