#!/usr/bin/env bash
# Runs the PHP endpoints as the host does, Apache with .htaccess and the host's
# PHP version, in a throwaway container, and checks what they answer, store and
# mail. Needs Docker. The limits and what is kept are the privacy policy's
# words, so they are held to here.
set -uo pipefail
cd "$(dirname "$0")/.."

# The image has no php.ini, so display_errors is on: a warning or an uncaught
# error lands in a body that should be empty. Mail goes to a file.
c=$(docker run -d --rm -p 127.0.0.1::80 -v "$PWD":/var/www/html:ro php:8.5-apache sh -c '
  printf "#!/bin/sh\n{ echo \"ARGS \$*\"; cat; } >> /tmp/mail\n" > /usr/local/bin/to-file &&
  chmod +x /usr/local/bin/to-file &&
  echo "sendmail_path = /usr/local/bin/to-file" > /usr/local/etc/php/conf.d/mail.ini &&
  chown www-data /var/www &&
  a2enmod -q rewrite headers &&
  sed -i "s/AllowOverride None/AllowOverride All/" /etc/apache2/apache2.conf &&
  exec apache2-foreground') || exit 1
tmp=$(mktemp -d)
trap 'docker rm -f "$c" >/dev/null; rm -rf "$tmp"' EXIT
base=http://$(docker port "$c" 80 | head -1)
curl -s -o /dev/null --retry 30 --retry-delay 1 --retry-all-errors "$base/health" || exit 1

fail=0
is() { # what it shows, what came, what should have
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: $2, expected $3"; fail=1; fi
}
expect() { # expected status, what it shows, then curl's arguments
  is "$2" "$(curl -s -o "$tmp/body" -D "$tmp/head" -w '%{http_code}' "${@:3}")" "$1"
  if [ "$1" != 200 ] && [ -s "$tmp/body" ]; then is "$2, empty body" "$(head -c 300 "$tmp/body")" ""; fi
}
header() { tr -d '\r' < "$tmp/head" | sed -n "s/^$1: //Ip"; }
in_box() { docker exec "$c" "$@"; }
# Makes every entry of a rate-limit file an hour older.
hour_passes() {
  in_box php -r '$f = $argv[1]; file_put_contents($f, preg_replace_callback("/\b\d{10}\b/", fn($t) => $t[0] - 3600, file_get_contents($f)));' "$1"
}
site=(-H 'Host: paperballoon.games' -H 'X-Forwarded-Proto: https')

echo "# Routes and headers"
for path in message feedback; do
  expect 405 "GET $path" "$base/api/$path"
  is "$path is never cached" "$(header cache-control)" no-store
  is "$path has the CSP" "$(header content-security-policy | grep -c "default-src 'self'")" 1
done
is "lib.php answers nothing" "$(curl -s "$base/api/lib.php")" ""
is "no endpoints on the MTA-STS host" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: mta-sts.paperballoon.games' -H 'X-Forwarded-Proto: https' "$base/api/feedback")" 404

# Four addresses of two /56 blocks, then two IPv4 ones: 1 1 1 2 3 4.
is "who counts as one sender" "$(in_box php -r '
  require "/var/www/html/api/lib.php";
  $seen = [];
  foreach (["2001:db8:0:100::1", "2001:db8:0:100:a:b:c:d", "2001:db8:0:1ff::1", "2001:db8:0:200::1", "192.0.2.1", "192.0.2.2"] as $_SERVER["REMOTE_ADDR"]) {
    $seen[sender()] ??= count($seen) + 1;
    echo $seen[sender()], " ";
  }')" "1 1 1 2 3 4 "

echo "# Feedback"
feedback() { expect "$1" "$2" -H 'Content-Type: text/plain' --data-binary "$3" "${@:4}" "$base/api/feedback"; }
plus() { echo "{\"v\":1,\"game\":\"tinytrack\",\"build\":\"1\",\"fun\":3,$1}"; }
good='{"v":1,"game":"tinytrack","build":"1.2.3","session":"abc123","fun":4,"answers":{"bots":"just-right"},"liked":"good\nfun","data":{"cup":{"id":"a"},"n":[1,2.5,true]}}'
feedback 204 "feedback is stored" "$good"
feedback 204 "a field the envelope lacks is dropped" "$(plus '"ip":"203.0.113.9"')"
feedback 400 "an unknown game" '{"v":1,"game":"nope","build":"1","fun":3}'
feedback 400 "nothing a person said" '{"v":1,"game":"tinytrack","build":"1"}'
feedback 400 "a rating out of range" '{"v":1,"game":"tinytrack","build":"1","fun":6}'
feedback 400 "markup in data" "$(plus '"data":{"x":"<b>"}')"
feedback 400 "a key that breaks the desk" "$(plus '"data":{"cup":{"id":{"toString":1}}}')"
feedback 400 "a key outside the alphabet" "$(plus '"data":{"__proto__":{"x":1}}')"
feedback 400 "a number too big to write back" "$(plus '"data":{"x":1e999}')"
feedback 400 "data nested too deep" "$(plus '"data":{"a":{"a":{"a":{"a":{"a":{"a":{}}}}}}}')"
feedback 400 "too many values" "$(plus "\"data\":{\"x\":[$(printf '1,%.0s' {1..600})1]}")"
feedback 400 "text over its length" "$(plus "\"liked\":\"$(printf 'a%.0s' {1..301})\"")"
feedback 400 "not JSON" 'fun=3'
long=$(plus "\"liked\":\"$(printf 'a%.0s' {1..9000})\"")
feedback 400 "a body over 8 KB" "$long"
feedback 400 "a body over 8 KB that hides its length" "$long" -H 'Transfer-Encoding: chunked'
feedback 403 "another site's page" "$good" "${site[@]}" -H 'Origin: https://example.com'
feedback 403 "a page without an origin" "$good" "${site[@]}" -H 'Origin: null'
feedback 204 "the game's own page" "$good" "${site[@]}" -H 'Origin: https://tinytrack.paperballoon.games'
is "its script may read the answer" "$(header access-control-allow-origin)" https://tinytrack.paperballoon.games
feedback 204 "a preview's page, not stored" "$good" "${site[@]}" -H 'Origin: https://tinytrack-main.paperballoon.games'
# Three are stored above; 17 more make PER_SENDER.
for i in {1..17}; do feedback 204 "up to the sender's limit" "$good" >/dev/null; done
feedback 429 "over the sender's limit" "$good"

stored=$(in_box sh -c 'cat /var/www/feedback/tinytrack-*.jsonl')
is "the stored line" "$(head -1 <<< "$stored")" '{"day":"'"$(date -u +%F)"'","v":1,"game":"tinytrack","build":"1.2.3","session":"abc123","fun":4,"answers":{"bots":"just-right"},"liked":"good fun","data":{"cup":{"id":"a"},"n":[1,2.5,true]}}'
is "lines stored" "$(wc -l <<< "$stored" | tr -d ' ')" 20
is "unknown fields stored" "$(grep -c 203.0.113.9 <<< "$stored")" 0
is "the folder is the PHP user's alone" "$(in_box stat -c '%a %U' /var/www/feedback)" "700 www-data"
is "the rate limit keeps hashes and times only" "$(in_box cat /var/www/feedback-ratelimit.json | sed -E 's/[0-9a-f]{64}/HASH/g; s/[0-9]{10}(,[0-9]{10})*/TIMES/g')" '{"all":[TIMES],"by":{"HASH":[TIMES]}}'

hour_passes /var/www/feedback-ratelimit.json
feedback 204 "an hour later" "$good"
is "entries over an hour old are gone" "$(in_box cat /var/www/feedback-ratelimit.json | grep -oE '[0-9]{10}[],]' | wc -l | tr -d ' ')" 2

# Files from 24 and 23 months before this one: past the kept months, and the oldest of them.
months_ago() { in_box php -r 'echo (new DateTime("first day of this month", new DateTimeZone("UTC")))->modify("-$argv[1] month")->format("Y-m");' "$1"; }
past=/var/www/feedback/tinytrack-$(months_ago 24).jsonl
oldest=/var/www/feedback/tinytrack-$(months_ago 23).jsonl
in_box sh -c "echo '{\"day\":\"old\"}' | tee $past > $oldest"
feedback 204 "a submission" "$good"
is "drops a month past 24" "$(in_box sh -c "ls $past 2>/dev/null")" ""
is "keeps the 24th" "$(in_box ls "$oldest")" "$oldest"

echo "# Feedback desk"
desk() { expect "$1" "$2" "${@:3}" "$base/api/feedback-data"; }
desk 503 "no password set up" -d 'password=smoke'
in_box sh -c 'php -r "echo password_hash(\"smoke\", PASSWORD_DEFAULT, [\"cost\" => 4]);" > /var/www/feedback/admin.hash'
desk 405 "no password in an address" -G -d 'password=smoke'
desk 401 "a wrong password" -d 'password=wrong'
desk 401 "a password that is a list" -d 'password[]=smoke'
desk 401 "no password" -d 'x=1'
# What a full disk leaves: half a line. It must not spoil the rest.
in_box sh -c "printf '{\"day\":' >> $oldest; touch $past"
for i in {1..11}; do desk 200 "the right password, never counted" -d 'password=smoke' >/dev/null; done
desk 200 "the right password" -d 'password=smoke'
is "every whole record" "$(jq length "$tmp/body")" 23
is "no cookie" "$(header set-cookie)" ""
is "never cached" "$(header cache-control)" no-store
is "drops a month past 24 too" "$(in_box sh -c "ls $past 2>/dev/null")" ""
# Another request holds the lock, as it does while its password is checked.
limits=/var/www/feedback/login-ratelimit.json
in_box touch /tmp/hold
docker exec -d "$c" php -r '$f = fopen($argv[1], "c+"); flock($f, LOCK_EX); touch("/tmp/held"); while (file_exists("/tmp/hold")) { usleep(50000); clearstatcache(); }' "$limits"
in_box sh -c 'while [ ! -e /tmp/held ]; do sleep 0.1; done'
desk 409 "refused, not queued, while another is checked" --max-time 5 -d 'password=smoke'
in_box sh -c 'rm /tmp/hold'
in_box php -r 'flock(fopen($argv[1], "c+"), LOCK_EX);' "$limits"
desk 200 "answered again after that" -d 'password=smoke'
for i in {1..7}; do desk 401 "up to ten wrong ones" -d 'password=wrong' >/dev/null; done
desk 429 "over the limit" -d 'password=wrong'
desk 429 "over the limit, even the right one" -d 'password=smoke'
hour_passes /var/www/feedback/login-ratelimit.json
desk 200 "an hour later" -d 'password=smoke'

echo "# Contact form"
message() { expect "$1" "$2" "${@:3}" "$base/api/message"; }
message 400 "an empty message" -d 'message='
message 400 "a message that is a list" -d 'message[]=hi'
message 400 "a message over its length" -d "message=$(printf 'a%.0s' {1..5001})"
message 400 "a message that isn't UTF-8" -d 'message=%ff'
message 400 "a broken reply address" -d 'message=hi&email=nope'
message 400 "a reply address with a line break" -d 'message=hi&email=a@example.com%0aBcc:b@example.com'
message 400 "a reply address with an escaped line break" -d 'message=hi&email=%22a%5c%0aBcc:b%22@example.com'
message 204 "the trap field, told it worked" -d 'message=hi&website=x'
is "nothing mailed so far" "$(in_box sh -c 'cat /tmp/mail 2>/dev/null')" ""
message 204 "a message" -d 'message=Grüße%0aBcc:b@example.com&email=someone@example.com'
is "the mail" "$(in_box cat /tmp/mail | tr -d '\r')" 'ARGS -fform@paperballoon.games
To: info@paperballoon.games
Subject: [Kontakt] =?UTF-8?Q?Gr=C3=BC=C3=9Fe?=
From: Paper Balloon <form@paperballoon.games>
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: quoted-printable
Reply-To: someone@example.com

Gr=C3=BC=C3=9Fe
Bcc:b@example.com

Antwortadresse: someone@example.com'
# One counted above; 4 more make PER_SENDER.
for i in {1..4}; do message 204 "up to the sender's limit" -d 'message=hi' >/dev/null; done
message 429 "over the sender's limit" -d 'message=hi'
is "mails handed over" "$(in_box grep -c '^ARGS' /tmp/mail)" 5
is "the rate limit keeps hashes and times only" "$(in_box cat /var/www/contact-ratelimit.json | sed -E 's/[0-9a-f]{64}/HASH/g; s/[0-9]{10}(,[0-9]{10})*/TIMES/g')" '{"all":[TIMES],"by":{"HASH":[TIMES]}}'
hour_passes /var/www/contact-ratelimit.json
message 204 "an hour later" -d 'message=hi'

echo "# Error log"
# Days 7 and 6 before today: past the kept days, and the oldest of them.
past=/var/www/php_logs/$(in_box date -u -d '-7 day' +%F).log
oldest=/var/www/php_logs/$(in_box date -u -d '-6 day' +%F).log
in_box sh -c "echo old | tee $past > $oldest"
message 204 "a message" -d 'message=hi'
is "drops a day past 7" "$(in_box sh -c "ls $past 2>/dev/null")" ""
is "keeps the 7th" "$(in_box ls "$oldest")" "$oldest"

# Errors before lib.php runs, such as a parse error, are in the container's own
# log rather than in php_logs/.
is "PHP's own complaints" "$({ docker logs "$c" 2>&1; in_box sh -c 'cat /var/www/php_logs/*.log'; } | grep -E 'PHP (Parse|Fatal|Warning|Notice|Deprecated)')" ""
exit $fail
