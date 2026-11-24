// The feedback desk (/admin/feedback): reads what players sent from
// /api/feedback-data (api/feedback-data.php, which also checks the password). The
// records are what api/feedback.php stores; its record() is the statement of
// their envelope, and `data` in them is each game's own.
//
// This file is the shell every game shares: the login, the period and game
// filters, the counts, "Did they have fun?" and the comments. What only one
// game can answer is a view in a file of its own (feedback-desk-<game>.js),
// loaded after this one. A view registers itself as FeedbackDesk.views[game]:
//   name        what the game is called on the game switch
//   state       its own filters, { name: value }; the buttons of a
//               [data-filter="name"] group in its markup set them
//   prepare(records)   once per load, with all of its game's records
//   filter(record)     whether its filters let a record through
//   render(list)       draws its panels from the filtered records and returns
//                      { tiles, funLabel, funRows, also }: its headline
//                      tiles, the label of the overall fun bar and further
//                      [label, records] bars under it, and what it adds to
//                      the count line ("40 with stats")
//   chips(record)      the small print under a comment
// All of it is optional, and a game without a view still gets the shell's
// parts. A view's markup is in index.html, marked data-game="<game>", and is
// shown only while that game is.
//
// Every string from a record reaches the page as text (textContent), and
// every colour or size is set on the element: the CSP allows no style
// attribute, so nothing here builds markup from strings.
(function () {
  var D = window.FeedbackDesk = { views: {} };
  var $ = D.$ = function (id) { return document.getElementById(id); };
  var records = [];

  // Keyed by strings from the data, so without Object's own names in the way.
  function map() { return Object.create(null); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  // Days are the server's, in UTC.
  function dayStr(ago) {
    var now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - ago * 864e5).toISOString().slice(0, 10);
  }

  // ======================================================================
  // LOADING + LOGIN
  // ======================================================================
  function say(text) {
    $('status').textContent = text;
    $('status').hidden = !text;
  }

  // The password goes with the request and is not kept: a reload asks again.
  $('login').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var body = new URLSearchParams();
    body.append('password', $('password').value);
    say('Loading the feedback.');
    fetch('/api/feedback-data', { method: 'POST', body: body }).then(function (res) {
      if (res.status === 409) { say('Another sign-in is being checked. Try again.'); return; }
      $('password').value = '';
      if (res.status === 401) { say('Wrong password.'); $('password').focus(); return; }
      if (res.status === 429) { say('Too many tries. Wait an hour.'); return; }
      if (res.status === 503) { say('No password has been set up on the server yet. The top of api/feedback-data.php says how.'); return; }
      if (!res.ok) { say('The feedback could not be loaded (error ' + res.status + ').'); return; }
      $('login').hidden = true;
      return res.json().then(show, function () { say('The stored feedback could not be read.'); });
    }, function () { say('The feedback could not be loaded. Is the server reachable?'); });
  });

  function show(data) {
    records = (Array.isArray(data) ? data : []).filter(function (r) {
      return r && typeof r.day === 'string' && typeof r.game === 'string';
    });
    if (!records.length) { say('No feedback has been sent yet.'); return; }
    records.forEach(function (r) { if (!r.answers || typeof r.answers !== 'object') r.answers = {}; });
    records.sort(function (a, b) { return a.day < b.day ? 1 : a.day > b.day ? -1 : 0; });

    // The games are whichever the records name, the busiest first.
    var perGame = count(records, function (r) { return r.game; });
    var games = Object.keys(perGame).sort(function (a, b) { return perGame[b] - perGame[a]; });
    if (!perGame[state.game]) state.game = games[0];
    games.forEach(function (game) {
      var view = D.views[game];
      if (!view) return;
      for (var name in view.state) if (typeof saved[game + '.' + name] === 'string') view.state[name] = saved[game + '.' + name];
      if (view.prepare) view.prepare(records.filter(function (r) { return r.game === game; }));
    });
    fill($('game-segs'), games.map(function (game) {
      var b = el('button', '', D.views[game] && D.views[game].name || game);
      b.type = 'button';
      b.setAttribute('data-v', game);
      return b;
    }));
    $('game-filter').hidden = games.length < 2;

    say('');
    $('main').hidden = false;
    render();
  }

  // ======================================================================
  // FILTERS + AGGREGATION
  // ======================================================================
  var state = { period: '30', game: '', tab: 'disliked', q: '', shown: 12 };
  // The filters as they were left: the shell's by name, a view's as "<game>.<name>".
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem('fdesk') || '{}') || {}; } catch (e) {}
  if (typeof saved.period === 'string') state.period = saved.period;
  if (typeof saved.game === 'string') state.game = saved.game;

  function current() {
    var view = D.views[state.game];
    var cutoff = state.period === 'all' ? '' : dayStr(Number(state.period) - 1);
    return records.filter(function (r) {
      return r.game === state.game && r.day >= cutoff && (!view || !view.filter || view.filter(r));
    });
  }
  function count(list, fn) { var m = map(); list.forEach(function (r) { var k = fn(r); if (k != null) m[k] = (m[k] || 0) + 1; }); return m; }
  function total(h) { return h.reduce(function (a, b) { return a + b; }, 0); }
  function pctOf(n, d) { return d ? n / d : 0; }
  function fmtPct(x) { return Math.round(x * 100) + '%'; }
  function share(list, fn) { return list.length ? list.filter(fn).length / list.length : 0; }
  // The value a share q of a histogram's samples stay under. edges are the
  // buckets' upper ends, the last one Infinity; lastLabel is what to call a
  // value in that last bucket.
  function percentile(h, q, edges, lastLabel) {
    var all = total(h);
    if (!all) return null;
    var target = q * all, cum = 0;
    for (var i = 0; i < h.length; i++) {
      if (cum + h[i] >= target) {
        if (edges[i] === Infinity) return lastLabel;
        var lo = i ? edges[i - 1] : 0, hi = edges[i];
        return Math.round(lo + (target - cum) / h[i] * (hi - lo));
      }
      cum += h[i];
    }
    return lastLabel;
  }

  // ======================================================================
  // RENDER HELPERS
  // ======================================================================
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function fill(node, children) {
    node.textContent = '';
    children.forEach(function (child) { node.appendChild(child); });
  }
  function tipped(node, tip) {
    node.setAttribute('data-tip', tip);
    node.setAttribute('aria-label', tip);
    node.tabIndex = 0;
    return node;
  }

  // A 100% bar. segs: [{label, n, color, ink}]
  function stackRow(label, segs, extra) {
    var all = segs.reduce(function (a, s) { return a + s.n; }, 0);
    var bar = el('div', 'sbar');
    segs.forEach(function (s) {
      if (!s.n) return;
      var part = s.n / all;
      var seg = tipped(el('div', 'seg ' + (s.ink || 'on-dark'), part >= 0.1 ? fmtPct(part) : ''), label + ': ' + s.label + ', ' + fmtPct(part) + ' (' + s.n + ')');
      seg.style.flex = s.n + ' 1 0px';
      seg.style.background = s.color;
      bar.appendChild(seg);
    });
    if (!all) {
      var none = el('div', 'seg on-light', 'no answers');
      none.style.flex = '1';
      none.style.background = 'var(--grid)';
      bar.appendChild(none);
    }
    var name = el('div', 'srow__label', label);
    name.appendChild(el('small', '', extra != null ? extra : all + ' answers'));
    var row = el('div', 'srow');
    row.appendChild(name);
    row.appendChild(bar);
    return row;
  }
  // items: [label, colour]; no colour, no swatch.
  function legend(items) {
    return items.map(function (it) {
      var entry = el('span');
      if (it[1]) { var swatch = el('i'); swatch.style.background = it[1]; entry.appendChild(swatch); }
      entry.appendChild(document.createTextNode(it[0]));
      return entry;
    });
  }
  // defs: [key, label, colour, ink]; counts: what count() returned.
  function segsFrom(defs, counts) {
    return defs.map(function (d) { return { label: d[1], n: counts[d[0]] || 0, color: d[2], ink: d[3] }; });
  }

  // A headline tile: { id, q, big, unit, sub, level }. id is the panel a click
  // scrolls to, level one of LEVEL. blank() is the tile of a section with
  // nothing to go on.
  var LEVEL = { good: 'Good', warn: 'Watch', bad: 'Bad' };
  function blank(id, q, why) { return { id: id, q: q, big: '–', sub: why, level: null }; }

  // What the views build with.
  D.map = map; D.count = count; D.total = total; D.pctOf = pctOf; D.fmtPct = fmtPct; D.share = share; D.percentile = percentile;
  D.el = el; D.fill = fill; D.tipped = tipped; D.stackRow = stackRow; D.legend = legend; D.segsFrom = segsFrom; D.blank = blank;

  // ======================================================================
  // SECTIONS
  // ======================================================================
  var FUN = [['1', 'var(--bad)'], ['2', 'var(--bad-soft)', 'on-light'], ['3', 'var(--warn)', 'on-warn'], ['4', 'var(--good-soft)', 'on-light'], ['5', 'var(--good)']];

  function renderShort(list, out, tiles) {
    // The phones of one couch send the same `session`. A record without one
    // is counted as a couch of its own.
    var seen = map(), couches = 0;
    list.forEach(function (r) {
      if (typeof r.session !== 'string' || !seen[r.session]) couches++;
      if (typeof r.session === 'string') seen[r.session] = 1;
    });
    var written = list.filter(function (r) { return r.liked || r.disliked; }).length;
    $('short-count').textContent = list.length + ' submissions from ' + couches + ' couches, ' + written + ' with a comment' + (out.also ? ', ' + out.also : '') + '.';
    fill($('short'), tiles.map(function (o) {
      var tile = el('button', 'tile');
      tile.type = 'button';
      tile.setAttribute('data-go', o.id);
      var label = el('span', 'tile__label', o.q);
      if (o.level) {
        var st = el('em', 'st st--' + o.level);
        st.appendChild(el('i'));
        st.appendChild(document.createTextNode(LEVEL[o.level]));
        label.appendChild(st);
      }
      var value = el('span', 'tile__value', o.big);
      if (o.unit) value.appendChild(el('small', '', o.unit));
      tile.appendChild(label);
      tile.appendChild(value);
      tile.appendChild(el('span', 'tile__sub', o.sub));
      return tile;
    }));
  }

  function renderFun(list, out) {
    var rows = [[out.funLabel || 'All answers', list]].concat(out.funRows || []);
    fill($('ratings'), rows.map(function (row) {
      var fun = count(row[1], function (r) { return r.fun; });
      return stackRow(row[0], FUN.map(function (f) { return { label: f[0] + ' of 5', n: fun[f[0]] || 0, color: f[1], ink: f[2] }; }));
    }));
    fill($('ratings-legend'), legend(FUN.map(function (f, i) { return [['1, no fun', '2', '3', '4', '5, loved it'][i], f[1]]; })));
    var rated = list.filter(function (r) { return typeof r.fun === 'number'; });
    if (!rated.length) return blank('p-fun', 'Fun', 'no ratings');
    var avg = rated.reduce(function (a, r) { return a + r.fun; }, 0) / rated.length;
    var happy = share(rated, function (r) { return r.fun >= 4; });
    return { id: 'p-fun', q: 'Fun', big: avg.toFixed(1), unit: ' / 5', sub: fmtPct(happy) + ' rated 4 or 5', level: avg >= 4 ? 'good' : avg >= 3.5 ? 'warn' : 'bad' };
  }

  function renderComments(list) {
    var view = D.views[state.game];
    var key = state.tab, q = state.q.trim().toLowerCase();
    var items = list.filter(function (r) { return typeof r[key] === 'string' && r[key] && (!q || r[key].toLowerCase().indexOf(q) >= 0); });
    fill($('clist'), items.slice(0, state.shown).map(function (r) {
      var item = el('li', 'citem');
      item.appendChild(el('p', '', r[key]));
      var row = el('div', 'chips');
      (view && view.chips ? view.chips(r) : [r.build, r.day]).forEach(function (c) { row.appendChild(el('span', 'chip', c)); });
      item.appendChild(row);
      return item;
    }));
    if (!items.length) {
      var none = el('li');
      none.appendChild(el('p', 'empty', 'No comments match.'));
      $('clist').appendChild(none);
    }
    $('more').hidden = items.length <= state.shown;
    $('more').textContent = 'Show more (' + (items.length - state.shown) + ')';
  }

  // ======================================================================
  // Which of state and the view's state a filter group sets.
  function holder(name) { return name in state ? state : (D.views[state.game] || {}).state || {}; }

  function render() {
    var view = D.views[state.game];
    Array.prototype.forEach.call(document.querySelectorAll('[data-game]'), function (part) { part.hidden = part.getAttribute('data-game') !== state.game; });
    var list = current();
    var out = view && view.render ? view.render(list) : {};
    Array.prototype.forEach.call(document.querySelectorAll('[data-filter]'), function (g) {
      var name = g.getAttribute('data-filter');
      Array.prototype.forEach.call(g.children, function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === holder(name)[name])); });
    });
    Array.prototype.forEach.call($('ctabs').children, function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === state.tab)); });
    renderShort(list, out, [renderFun(list, out)].concat(out.tiles || []));
    renderComments(list);
  }
  $('short').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-go]'); if (b) $(b.getAttribute('data-go')).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.querySelector('.filters').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    var g = b.closest('[data-filter]'); if (!g) return;
    var name = g.getAttribute('data-filter'), value = b.getAttribute('data-v');
    holder(name)[name] = value; state.shown = 12;
    saved[name in state ? name : state.game + '.' + name] = value;
    try { localStorage.setItem('fdesk', JSON.stringify(saved)); } catch (e) {}
    render();
  });
  $('ctabs').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b) return; state.tab = b.getAttribute('data-v'); state.shown = 12; render(); });
  $('search').addEventListener('input', function (ev) { state.q = ev.target.value; state.shown = 12; renderComments(current()); });
  $('more').addEventListener('click', function () { state.shown += 12; renderComments(current()); });

  // one tooltip for every mark
  var tip = $('tip');
  function showTip(el, x, y) { tip.textContent = el.getAttribute('data-tip'); tip.hidden = false; tip.style.left = x + 'px'; tip.style.top = y + 'px'; }
  document.addEventListener('pointermove', function (ev) {
    var el = ev.target.closest && ev.target.closest('[data-tip]');
    if (!el) { tip.hidden = true; return; }
    showTip(el, clamp(ev.clientX, 140, window.innerWidth - 140), ev.clientY);
  });
  document.addEventListener('focusin', function (ev) {
    var el = ev.target.closest && ev.target.closest('[data-tip]');
    if (!el) { tip.hidden = true; return; }
    var r = el.getBoundingClientRect();
    showTip(el, clamp(r.left + r.width / 2, 140, window.innerWidth - 140), r.top);
  });
  document.addEventListener('focusout', function () { tip.hidden = true; });
  window.addEventListener('scroll', function () { tip.hidden = true; }, { passive: true });

  // Once the views, loaded after this file, have registered.
  document.addEventListener('DOMContentLoaded', function () {
    $('login').hidden = false;
    $('password').focus();
  });
})();
