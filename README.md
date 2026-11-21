# paperballoon.games

Static landing site for **Paper Balloon** — the umbrella brand for party games
where everyone plays together on the TV/screen and phones are the controllers
(scan a QR to play, no install required).

Flagship game: **HexStacker Party** — live at
[hexstacker.com](https://hexstacker.com) and on the
[Apple TV App Store](https://apps.apple.com/app/hexstacker-party/id6788876779).
**Tiny Track Party** (kart racer) is playable at
[tinytrack.paperballoon.games](https://tinytrack.paperballoon.games);
**Powder** (skiing) is still in development.

The phone controller app is on the App Store and Google Play; the room page
links both. The Android TV builds are in closed testing, gated on the
[testers Google Group](https://groups.google.com/g/paperballoongames) — a Play
listing 404s for anyone who isn't a member yet. The landing page deliberately
says nothing about that: it links only what a visitor can actually open. Testers
are recruited by link instead, through `/beta` (`/de/beta`); delete those pages
and `assets/beta.css` once the TV apps are in production.

## Design

One design language with the controller apps: warm paper and ink under a dusk
sky, the game posters carry the colour. Follows the system light/dark setting
(with a toggle), and both schemes share one layout. Tokens live in
`assets/theme.css` with the rules for what the sunset, the fleet and the sky
may be used for; the apps use the same values with the system font. Fonts are
self-hosted in `assets/fonts/`.

One face (Outfit) everywhere. `assets/site.css` holds what the home, room and
beta pages share: a bar-less header (the wordmark alone; the balloon mark is
the favicon and launcher icon), the blurred-poster glow (behind the room page's
top), pill buttons, the footer panel and the sky parts the home and beta pages
open with. The home hero shows the flagship poster on a drawn TV under the
dusk, with the fleet's balloons in it; the beta page is that opening in a
lighter dose. Posters are shown whole, never cropped, and nothing sits on them.
The sunset gradient fills only a page's one primary button; nothing has a
shadow or glow, except light from art: the room page's poster glow and the
poster-tinted light under the mouse on the home game cards.

Motion follows the rules at the top of home.css's "Motion" section (what may
animate, so weak phones and reduced motion stay fine); the theme switch's
sunset is in site.css and theme.js.

The legal pages (`assets/legal.css`) have no header or footer: the controller
apps show them in-app under their own title bar and hide the page's
`.legal-shell > h1`, so keep that selector working.

## Structure

- `index.html`, `de/index.html` + `assets/home.css`, `assets/home.js` — home page (EN / DE)
- `room.html` + `assets/room.js` — room join page, served at `/<CODE>#<instance>`
  (`.htaccess` maps any 6-char base58 path to it); browser fallback for the app deep
  links in `.well-known/`. Also the site's 404 page (with status 404), offering
  code entry, since a stray path is usually a mistyped code
- `games-manifest.json` — drives the room page and is fetched by the controller
  apps. Keep in sync with the controller repo's bundled copy. `art` is the 16:9
  cover, `icon` the square brand mark (nearby-room / rejoin cards in the
  launcher). The apps match their bundled copy by **filename**, and cache
  anything they didn't ship by URL without revalidating — so re-rendered artwork
  ships under a new name (`…-v2.webp`) here, in both app bundles and in the
  home page's hero `srcset`; never as a `?v=` bump, which the filename match
  would swallow.
  `video` is a trailer on the game's own server; the apps cache it by
  full URL forever too, but ship no copy to match, so a re-rendered trailer is a
  `?v=` bump on `video` (here and in both app bundles), made only once the new
  file is live on the game's server
- `controller-test.html` + `assets/controller-test.{css,js}` — a stand-in game
  controller that exercises every touchpoint in the controller repo's
  `CONTRACT.md`, so the launcher can be tested without a real game and a game
  author can watch each one behave. `noindex`, and deliberately not in the
  sitemap. Update it in the same change that alters the contract — it is the only
  executable statement of that spec, and bump the `?v=` on its CSS/JS when you do,
  or the year-long `immutable` cache hides the change. The controller repo's contract
  UI tests (`ContractTest.kt`, `ContractTests.swift`) drive the deployed page by its
  element ids and button labels, so renaming one breaks their CI. See "Reaching it
  from the app" below
- `beta.html`, `de/beta.html` + `assets/beta.css` — closed-test sign-up steps
  (group, per-app opt-in links, install, 14 days), shared by link. `noindex`, not
  in the sitemap
- `contact.html`, `de/contact.html` + `assets/contact.{css,js}` — contact form,
  posted to `/api/message`
- `api/message.php` — the one dynamic part, behind `/api/message`: sends the
  contact form as an email to info@ through the host's own mail system, from
  form@ (an alias to info@) with the visitor's address as Reply-To and under
  the message. It stores
  nothing but the rate limit: hashed sender IPs with the time of each message,
  in `contact-ratelimit.json` in the PHP user's home, outside the document root, entries older than an
  hour dropped on every request. The privacy policy states exactly that;
  change the two together
- `privacy.html`, `imprint.html` — legal pages (German, umbrella policy for all
  Paper Balloon infra); English versions in `en/`
- `assets/` — CSS (tokens in `theme.css`, shared page parts in `site.css`, one
  stylesheet per page), 16×9 game posters and square
  brand icons in `artwork/`. Each poster ships at 1920px plus -720, -960 and
  -1280 renditions (WebP q84, downscaled from the 1920) for the home page's
  `srcset`s; a re-rendered poster needs all four under its new name. `sky/` is
  generated by `tools/night_band.py` (see its docstring before changing the dark
  sky tokens)
- `.htaccess` — the server config on Hetzner Webhosting (Apache + PHP): room
  links, extensionless pages, the 404 page, redirects, cache and security
  headers (CSP) and the test and MTA-STS hosts' rules. `health.txt` answers
  `/health`
- `.well-known/mta-sts.txt` — the MTA-STS policy (RFC 8461), served on
  `mta-sts.paperballoon.games` (a konsoleH subdomain onto this folder). It tells
  sending mail servers to deliver to `@paperballoon.games` only over verified
  TLS to a host matching `mx:`. Enforcing senders cache it for `max_age`, so it
  must be right *before* the MX changes: before mail ever moves off Hetzner, add
  the new MX host to `mx:` (or set `mode: none`), wait `max_age`, then switch
  the MX. Every change to the file needs a new `id` in the
  `_mta-sts.paperballoon.games` TXT record at Cloudflare, or senders keep the
  old policy. Failures are reported daily to tlsrpt@ (`_smtp._tls` TXT)
- `.github/workflows/deploy.yml` — deploys over SFTP on a bare-semver tag, or by
  hand from the Actions tab. The one build step is there: esbuild minifies
  `assets/*.css` and `*.js` in place (JS held to ES5), so the repo, the pages
  and the local preview keep the readable sources. The pages go up last, so
  nobody loads a page that points at a file the server doesn't have yet. A
  last step checks the live site from GitHub's network: test it from there,
  not from home, as Hetzner blocks an address that sends many requests.
  It logs in with an SSH key (secret `HETZNER_SFTP_KEY`, public half under
  konsoleH › Logindaten › Öffentliche SFTP-Schlüssel) and checks the server
  against the pinned host key (`HETZNER_SFTP_KNOWN_HOSTS`). Each site on the
  hosting has its own folder under `public_html`, this one
  `public_html/paperballoon.games` (konsoleH › Serverkonfiguration ›
  Startverzeichnis setzen, and the test subdomain's target). Apache applies
  every `.htaccess` above a site's folder too, so `public_html` itself must
  never hold one

## Local preview

Serve the repo through Apache with PHP, as on the host, so room links
(`/<CODE>`), extensionless pages (`/privacy`), the 404 page and the security
headers (CSP) behave as deployed. The repo is mounted, so edits show on reload,
but CSS/JS are served `immutable`: bump their `?v=` or disable the browser cache
while iterating.

```sh
docker run --rm -p 8000:80 -v "$PWD":/var/www/html:ro php:8.5-apache sh -c '
  a2enmod -q rewrite headers &&
  sed -i "s/AllowOverride None/AllowOverride All/" /etc/apache2/apache2.conf &&
  exec apache2-foreground'
```

The contact form answers 500 there: www-data can't write the rate-limit file
to its home (`/var/www`, owned by root) and there is no mail system. To try it, add
[Mailpit](https://mailpit.axllent.org) and hand PHP's mail to it with msmtp;
Mailpit's inbox is on :8001:

```sh
docker network create pb
docker run -d --name pb-mailpit --network pb -p 8001:8025 axllent/mailpit
docker run -d --name pb-site --network pb -p 8000:80 \
  -v "$PWD":/var/www/html:ro php:8.5-apache sh -c '
  apt-get update -qq && apt-get install -y -qq msmtp >/dev/null &&
  echo "sendmail_path = \"msmtp --host=pb-mailpit --port=1025 -t\"" \
    > /usr/local/etc/php/conf.d/mail.ini &&
  chown www-data /var/www &&
  a2enmod -q rewrite headers &&
  sed -i "s/AllowOverride None/AllowOverride All/" /etc/apache2/apache2.conf &&
  exec apache2-foreground'
```

`python3 -m http.server 8000` is enough for the landing page alone; it knows
none of the `.htaccess` routes, so room links and `/privacy` 404 there.

## Reaching the test controller from the app

The launcher only loads a page as a controller if `JoinResolver` hands it to
`joinVerbatim`. **The apex can never do that**: every `paperballoon.games` /
`www.paperballoon.games` URL is routed to the sole live game's `controllerBaseUrl`
instead, whatever its path. A `paperballoon.games` **subdomain** does load verbatim,
which is what `test.paperballoon.games` exists for.

- **Any build — tap <https://test.paperballoon.games/PBTEST>.** The 6-character path
  is not decoration: it is all the Android App Links intent filter claims, so a
  shorter or longer one opens the browser instead of the app. `.htaccess` maps it to
  `controller-test.html` on the test host only: on the apex it would shadow that
  room code for a real player who happened to draw it.
- **Debug launcher builds, over the LAN** — for iterating without a deploy. Serve
  this directory and scan the QR with the app's own scanner; private hosts take a
  debug-only branch in `JoinResolver` that exists for exactly this. Manual code
  entry can't be used — it caps input at 16 characters and resolves through the
  relay.

  ```sh
  python3 -m http.server 8000
  qrencode -t ANSIUTF8 "http://$(ipconfig getifaddr en0):8000/controller-test.html"
  ```

Either way **no room, no relay and no display are involved** — `joinVerbatim`
loads the URL as given, and the room code only labels the home rejoin card (which
is offered unverified when the URL surfaces none).

The test host serves this whole site, so `.htaccess` sends
`X-Robots-Tag: noindex` on every response there; the page carries a `noindex`
meta of its own.
