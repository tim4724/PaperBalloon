# Static site image for paperballoon.games — unprivileged nginx. The repo is
# served as is, except that the CSS/JS are minified on the way into the image.

# Minify stage: esbuild rewrites assets/*.css and *.js in place, same names, so
# the pages, their ?v= query strings and the local preview (which serves the
# repo unminified) are untouched. Runs on the build host's own platform: the
# output is plain text, the same for every image platform. JS is held to ES5,
# the syntax it is written in, so minifying never raises what a browser or
# launcher webview must support; CSS has no target, so nothing is rewritten
# for older browsers either.
FROM --platform=$BUILDPLATFORM node:24-alpine AS minify
RUN npm install --global esbuild@0.28.2
WORKDIR /site
COPY assets/*.css assets/*.js assets/
RUN esbuild assets/*.js --minify --target=es5 --outdir=assets --allow-overwrite --log-level=warning \
 && esbuild assets/*.css --minify --outdir=assets --allow-overwrite --log-level=warning

FROM nginxinc/nginx-unprivileged:1.30-alpine

# Server block: listens on 8080 (non-root), security headers, /health, no SPA fallback.
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Shared security-header snippet, included by the server block above.
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf

# Site content. .dockerignore keeps git/editor/docker meta out of the image.
COPY . /usr/share/nginx/html/
# The minified CSS/JS over their sources.
COPY --from=minify /site/assets/ /usr/share/nginx/html/assets/

# The nginx config files must be in the build context for the COPYs above, but
# must not be served as static content — strip them from the web root (needs
# root; the base image runs as the unprivileged nginx user).
USER root
RUN rm -f /usr/share/nginx/html/nginx.conf /usr/share/nginx/html/security-headers.conf
# Numeric UID (not the name "nginx") so Kubernetes' runAsNonRoot can verify
# the container is non-root without resolving /etc/passwd.
USER 101

EXPOSE 8080
