# paperballoon.games

Landing site for **Paper Balloon** — the umbrella brand for party games where
everyone plays together on the TV/screen and phones are the controllers. Static
pages on Apache, plus a few small PHP endpoints: the contact form, and the
feedback service the games share with its desk.

Flagship game: **HexStacker Party** — live at
[hexstacker.com](https://hexstacker.com) and on the
[Apple TV App Store](https://apps.apple.com/app/hexstacker-party/id6788876779).
**Tiny Track Party** (kart racer) is playable at
[tinytrack.paperballoon.games](https://tinytrack.paperballoon.games);
**Powder Party** (skiing) is still in development.

The phone controller app is on the App Store and Google Play; each game offers
it on its own join page, this site does not. The Android TV builds are in
closed testing, gated on the
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

One face (Outfit) everywhere. `assets/site.css` holds what the pages share: a
bar-less header (the wordmark alone; the balloon mark is the favicon and
launcher icon), pill buttons, the footer and the sky parts the pages open with.
The home hero shows the flagship poster on a drawn TV under the dusk, with the
fleet's balloons in it; the beta and contact pages are that opening in a
lighter dose. Posters are shown whole, never cropped, and nothing sits on them.
The sunset gradient fills only a page's one primary button; nothing has a
shadow or glow, except light from art: the poster-tinted light under the mouse
on the home game cards.

Motion follows the rules at the top of home.css's "Motion" section (what may
animate, so weak phones and reduced motion stay fine); the theme switch's
sunset is in site.css and theme.js.

The legal pages (`assets/legal.css`) have no header or footer: the controller
apps show them in-app under their own title bar and hide the page's
`.legal-shell > h1`, so keep that selector working.

## Structure

Each file's header says what it does; this is what a file can't say about
itself.

- `index.html`, `de/index.html` — home page (EN / DE); `404.html` and
  `de/404.html` are the 404 pages, the German one for paths under `/de/`.
  `/404` and `/de/404` also answer as ordinary pages, which is what their
  language links point at
- `games-manifest.json` — fetched by the controller apps. Keep in sync with the
  controller repo's bundled copy. `art` is the 16:9 cover, `icon` the square
  brand mark (nearby-room / rejoin cards in the launcher). The apps match their
  bundled copy by **filename**, and cache anything they didn't ship by URL
  without revalidating — so re-rendered artwork ships under a new name
  (`…-v2.webp`) here, in both app bundles and in the home page's hero `srcset`;
  never as a `?v=` bump, which the filename match would swallow.
  `video` is a trailer on the game's own server; the apps cache it by
  full URL forever too, but ship no copy to match, so a re-rendered trailer is a
  `?v=` bump on `video` (here and in both app bundles), made only once the new
  file is live on the game's server
- `.well-known/apple-app-site-association`, `assetlinks.json` — the controller
  apps' links: a 6-character path on this domain opens the app, which looks the
  room code up itself. Without the app such a link is a 404 here; the games put
  their own host in their QR codes
- `controller-test.html` — a stand-in game controller that exercises every
  touchpoint in the controller repo's `CONTRACT.md`. `noindex`, and
  deliberately not in the sitemap. Update it in the same change that alters the
  contract: it is the only executable statement of that spec. The controller
  repo's contract UI tests (`ContractTest.kt`, `ContractTests.swift`) drive the
  deployed page by its element ids and button labels, so renaming one breaks
  their CI. See "Reaching the test controller from the app" below
- `beta.html`, `de/beta.html` — closed-test sign-up steps, shared by link.
  `noindex`, not in the sitemap
- `contact.html`, `de/contact.html`, `api/message.php` — the contact form and
  its mailer. The privacy policy states exactly what the mailer stores; change
  the two together
- `api/feedback.php` — the feedback service all games share, since the games
  themselves are static. A game joins with one row in `GAMES` and by sending
  the envelope `record()` checks. What a game puts into `data` belongs in the
  privacy policy
- `admin/feedback/`, `api/feedback-data.php` — the owner's charts over that
  feedback, behind a password. One-time setup on the server: the password's
  hash goes into `feedback/admin.hash` (the PHP file's header has the command).
  `noindex`, not in the sitemap. What only one game can chart is a view,
  `assets/feedback-desk-<game>.js` plus its markup in the page; the header of
  `feedback-desk.js` says what a view is made of
- `privacy.html`, `imprint.html` — legal pages (German, umbrella policy for all
  Paper Balloon infra); English versions in `en/`
- `assets/artwork/` — each poster ships at 1920px plus -720, -960 and -1280
  renditions (WebP q84, downscaled from the 1920) for the home page's
  `srcset`s; a re-rendered poster needs all four under its new name.
  `assets/sky/` is generated by `tools/night_band.py` (see its docstring before
  changing the dark sky tokens)
- `.htaccess` — the server config on Hetzner Webhosting (Apache + PHP).
  `test.paperballoon.games` and `mta-sts.paperballoon.games` are konsoleH
  subdomains onto the same folder
- `.well-known/mta-sts.txt` — the MTA-STS policy (RFC 8461). Enforcing senders
  cache it for `max_age`, so it must be right *before* the MX changes: before
  mail ever moves off Hetzner, add the new MX host to `mx:` (or set
  `mode: none`), wait `max_age`, then switch the MX. Every change to the file
  needs a new `id` in the `_mta-sts.paperballoon.games` TXT record at
  Cloudflare, or senders keep the old policy. Failures are reported daily to
  tlsrpt@ (`_smtp._tls` TXT)
- `.github/workflows/deploy.yml` — deploys over SFTP on a bare-semver tag, or by
  hand from the Actions tab. It logs in with an SSH key (secret
  `HETZNER_SFTP_KEY`, public half under konsoleH › Logindaten › Öffentliche
  SFTP-Schlüssel) and checks the server against the pinned host key
  (`HETZNER_SFTP_KNOWN_HOSTS`). Each site on the hosting has its own folder
  under `public_html`, this one `public_html/paperballoon.games` (konsoleH ›
  Serverkonfiguration › Startverzeichnis setzen, and the test subdomain's
  target). Apache applies every `.htaccess` above a site's folder too, so
  `public_html` itself must never hold one. Test the live site from GitHub's
  network, not from home: Hetzner blocks an address that sends many requests

## Local preview

Serve the repo through Apache with PHP, as on the host, so extensionless pages
(`/privacy`), the 404 page and the security headers (CSP) behave as deployed.
The repo is mounted, so edits show on reload.

```sh
docker run --rm -p 8000:80 -v "$PWD":/var/www/html:ro php:8.5-apache sh -c '
  a2enmod -q rewrite headers &&
  sed -i "s/AllowOverride None/AllowOverride All/" /etc/apache2/apache2.conf &&
  exec apache2-foreground'
```

The contact form and `/api/feedback` answer 500 there: www-data can't write
to its home (`/var/www`, owned by root), which `chown www-data /var/www` in the
container fixes, and there is no mail system. To try the form, add
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
none of the `.htaccess` routes, so `/privacy` 404s there.

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
