// Tiny Track Party's view on the feedback desk (feedback-desk.js, whose header
// says what a view is): the cup and TV filters, fun per cup, and the panels
// on bots, race winners, steering, the direct link and delay. Its markup is
// the data-game="tinytrack" parts of admin/feedback/index.html.
//
// It reads the game's own block of a record, `data`: { cup: { id, name },
// stats: { steering, link, fastlane, races, device } }, as the
// controller's feedback form sends it. Two things follow from the service not
// checking that block:
// - prepare() looks at its shape once. `stats` is missing when the player
//   switched it off, and is treated as missing when it is not what the charts
//   need. Such a record counts for ratings and comments and is left out of
//   everything measured.
// - Cups and cars are whatever the records name, never a list kept here.
(function () {
  var D = window.FeedbackDesk, $ = D.$, el = D.el, fill = D.fill, count = D.count, total = D.total;
  var pctOf = D.pctOf, fmtPct = D.fmtPct, share = D.share, stackRow = D.stackRow, legend = D.legend, segsFrom = D.segsFrom, blank = D.blank;

  var state = { cup: 'all', tv: 'all' };
  var CUPS = [];             // { id, name, short }, most played first
  var CUP_BY_ID = D.map();
  var CARS = [];             // most driven first
  var TV_NAME = { web: 'Browser', tvos: 'Apple TV', androidtv: 'Android TV', unknown: 'Unknown TV' };
  // One-way delay buckets, as the phone counts them.
  var EDGES = [10, 20, 35, 50, 75, 100, 150, 250, Infinity];
  var XLAB = ['<10', '10', '20', '35', '50', '75', '100', '150', '250+'];

  function isHist(h) { return Array.isArray(h) && h.length === 9 && h.every(function (v) { return typeof v === 'number'; }); }
  function usable(s) {
    return !!s && !!s.steering && typeof s.steering.tilt === 'number' && !!s.link && isHist(s.link.direct) && isHist(s.link.relay) &&
      !!s.fastlane && !!s.device && Array.isArray(s.races) && s.races.every(function (race) { return race && Array.isArray(race.order) && race.order.length; });
  }

  // Puts what the charts read at r.cup and r.stats, checked.
  function prepare(records) {
    records.forEach(function (r) {
      var data = r.data || {}, cup = data.cup || {};
      r.cup = cup.id != null ? { id: String(cup.id), name: cup.name != null ? String(cup.name) : '' } : { id: 'none', name: 'No cup' };
      r.stats = usable(data.stats) ? data.stats : null;
    });

    // A cup is called what its newest record calls it.
    CUP_BY_ID = D.map();
    records.forEach(function (r) {
      var cup = CUP_BY_ID[r.cup.id] || (CUP_BY_ID[r.cup.id] = { id: r.cup.id, name: '', n: 0 });
      cup.n++;
      if (!cup.name && r.cup.name) cup.name = r.cup.name;
    });
    CUPS = Object.keys(CUP_BY_ID).map(function (id) { return CUP_BY_ID[id]; }).sort(function (a, b) { return b.n - a.n; });
    CUPS.forEach(function (cup) {
      if (!cup.name) cup.name = cup.id;
      // Where "Cup" is already said, or there is no room for it.
      cup.short = cup.name.replace(/ Cup$/, '');
    });
    if (!CUP_BY_ID[state.cup]) state.cup = 'all';

    var drives = D.map();
    uniqueRaces(records.filter(hasStats)).forEach(function (race) {
      race.order.forEach(function (o) { var car = carOf(o); if (car) drives[car] = (drives[car] || 0) + 1; });
    });
    CARS = Object.keys(drives).sort(function (a, b) { return drives[b] - drives[a]; });
  }

  function hasStats(r) { return !!r.stats; }
  // A record without stats names no TV, so it only shows under "All".
  function filter(r) {
    return (state.cup === 'all' || r.cup.id === state.cup) && (state.tv === 'all' || (hasStats(r) && r.stats.device.tv === state.tv));
  }
  function sumHist(list, which) {
    var h = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    list.forEach(function (r) { r.stats.link[which].forEach(function (v, i) { h[i] += v; }); });
    return h;
  }
  function steerGroup(r) { return r.stats.steering.tilt >= 0.5 ? 'tilt' : 'buttons'; }
  function phoneGroup(r) {
    var d = r.stats.device;
    if (d.phone !== 'ios' && d.phone !== 'android') return 'Other phone';
    return (d.phone === 'ios' ? 'iPhone' : 'Android') + (d.app ? ' app' : ' browser');
  }
  // "human:Carve" and "you:Carve" are a player's car, "bot" is none.
  function carOf(entry) { return entry === 'bot' ? null : String(entry).split(':')[1]; }

  var CTRL = [['awkward', 'Awkward', 'var(--bad)'], ['okay', 'Okay', 'var(--warn)', 'on-warn'], ['great', 'Great', 'var(--good)']];
  var BOTS = [['too-easy', 'Too easy', 'var(--warn)', 'on-warn'], ['just-right', 'Just right', 'var(--good)'], ['too-hard', 'Too hard', 'var(--bad)']];
  var FL = [
    ['lan', 'Worked, same Wi-Fi', 'var(--good)'], ['nat', 'Worked, through the router', 'var(--good-soft)', 'on-light'],
    ['failed', 'Failed: relay only', 'var(--bad)'], ['no-webrtc', 'Not supported', 'var(--na)', 'on-light']
  ];
  // The path is optional in the payload; shown only when a record lacks it.
  var FL_OPEN = ['open', 'Worked, path not reported', 'var(--s1)'];
  var STEER = [['tilt', 'Tilt', 'var(--s1)'], ['buttons', 'Buttons', 'var(--s2)']];

  function flKey(r) { var f = r.stats.fastlane; return f.result === 'open' ? f.path || 'open' : f.result; }

  // ======================================================================
  // SECTIONS
  // ======================================================================
  // Each section draws its chart and returns its headline number as a tile.

  function renderBots(list) {
    var cups = state.cup === 'all' ? CUPS : [CUP_BY_ID[state.cup]];
    var worst = { s: 0 };
    fill($('bots'), cups.map(function (cup) {
      var c = count(list.filter(function (r) { return r.cup.id === cup.id; }), function (r) { return r.answers.bots; });
      var n = (c['too-easy'] || 0) + (c['just-right'] || 0) + (c['too-hard'] || 0);
      [['too-hard', 'too hard'], ['too-easy', 'too easy']].forEach(function (k) {
        var s = n >= 5 ? (c[k[0]] || 0) / n : 0;
        if (s > worst.s) worst = { s: s, word: k[1], name: cup.short };
      });
      return stackRow(cup.name, segsFrom(BOTS, c));
    }));
    fill($('bots-legend'), legend(BOTS.map(function (b) { return [b[1], b[2]]; })));
    var rated = list.filter(function (r) { return r.answers.bots; });
    if (!rated.length) return blank('p-bots', 'Bots just right', 'no ratings');
    var right = share(rated, function (r) { return r.answers.bots === 'just-right'; });
    return { id: 'p-bots', q: 'Bots just right', big: fmtPct(right), sub: worst.s >= 0.3 ? worst.name + ': ' + fmtPct(worst.s) + ' ' + worst.word : 'no cup stands out', level: worst.s < 0.3 ? 'good' : worst.s < 0.4 ? 'warn' : 'bad' };
  }

  function renderFastlane(list) {
    var opened = list.filter(function (r) { return r.stats.fastlane.result === 'open'; });
    var times = opened.map(function (r) { return r.stats.fastlane.firstOpenMs; }).filter(function (t) { return typeof t === 'number'; }).sort(function (a, b) { return a - b; });
    var med = times.length ? times[Math.floor(times.length / 2)] : null;
    var drops = opened.filter(function (r) { return r.stats.fastlane.drops > 0; }).length;
    var onDirect = opened.length ? opened.reduce(function (a, r) { return a + (r.stats.fastlane.share || 0); }, 0) / opened.length : 0;
    fill($('fl-facts'), [
      [med == null ? '–' : (med / 1000).toFixed(1) + ' s', 'until it opened, typically'],
      [fmtPct(pctOf(drops, opened.length)), 'of working links dropped at least once'],
      [fmtPct(onDirect), 'of the driving went over it, when it worked']
    ].map(function (f) {
      var fact = el('div', 'fact');
      fact.appendChild(el('b', '', f[0]));
      fact.appendChild(el('span', '', f[1]));
      return fact;
    }));
    var keys = count(list, flKey);
    var defs = keys.open ? FL.concat([FL_OPEN]) : FL;
    var weakest = null;
    var groups = ['iPhone app', 'iPhone browser', 'Android app', 'Android browser'];
    if (list.some(function (r) { return phoneGroup(r) === 'Other phone'; })) groups.push('Other phone');
    fill($('fl-phone'), groups.map(function (g) {
      var sub = list.filter(function (r) { return phoneGroup(r) === g; });
      var ok = share(sub, function (r) { return r.stats.fastlane.result === 'open'; });
      if (sub.length >= 5 && (!weakest || ok < weakest.ok)) weakest = { ok: ok, name: g };
      return stackRow(g, segsFrom(defs, count(sub, flKey)), sub.length + ' phones');
    }));
    var tvs = state.tv !== 'all' ? [state.tv] : ['web', 'tvos', 'androidtv'].concat(Object.keys(count(list, function (r) { return r.stats.device.tv; })).filter(function (t) { return !/^(web|tvos|androidtv)$/.test(t); }));
    fill($('fl-tv'), tvs.map(function (t) {
      var sub = list.filter(function (r) { return r.stats.device.tv === t; });
      return stackRow(TV_NAME[t] || t, segsFrom(defs, count(sub, flKey)), sub.length + ' phones');
    }));
    fill($('fl-legend'), legend(defs.map(function (f) { return [f[1], f[2]]; })));
    if (!list.length) return blank('p-fl', 'Direct link worked', 'no stats');
    var ok = pctOf(opened.length, list.length);
    return { id: 'p-fl', q: 'Direct link worked', big: fmtPct(ok), sub: weakest && weakest.ok < ok ? weakest.name + ': ' + fmtPct(weakest.ok) : (list.length - opened.length) + ' on the relay only', level: ok >= 0.9 ? 'good' : ok >= 0.8 ? 'warn' : 'bad' };
  }

  var BANDS = [['Under 50 ms: feels instant', 'var(--good)'], ['50 to 100 ms: noticeable', 'var(--warn)', 'on-warn'], ['Over 100 ms: laggy', 'var(--bad)']];
  // Buckets 0-3 end at 50 ms, 4-5 at 100 ms: the latency chip's two thresholds.
  function bands(h) { var b = [0, 0, 0]; h.forEach(function (v, i) { b[i < 4 ? 0 : i < 6 ? 1 : 2] += v; }); return b; }

  function renderDelay(list) {
    var d = sumHist(list, 'direct'), r = sumHist(list, 'relay');
    var paths = [['Direct link', bands(d)], ['Relay', bands(r)]];
    fill($('delay-bands'), paths.map(function (p) {
      return stackRow(p[0], BANDS.map(function (b, i) { return { label: b[0], n: p[1][i], color: b[1], ink: b[2] }; }), 'while it carried steering');
    }));
    fill($('delay-legend'), legend(BANDS));
    var frac = function (b, i) { return pctOf(b[i], b[0] + b[1] + b[2]); };

    var shares = [d, r].map(function (h) { var t = total(h) || 1; return h.map(function (v) { return v / t; }); });
    var max = Math.max.apply(null, shares[0].concat(shares[1])) || 1;
    var defs = [['Direct link', 'var(--s1)', d, shares[0]], ['Relay', 'var(--s2)', r, shares[1]]];
    fill($('hists'), defs.map(function (def) {
      var title = el('div', 'hist__title');
      var swatch = el('i');
      swatch.style.background = def[1];
      title.appendChild(swatch);
      title.appendChild(document.createTextNode(def[0]));
      var plot = el('div', 'hist__plot');
      def[3].forEach(function (v, i) {
        var range = i === 8 ? '250 ms and more' : (i ? EDGES[i - 1] : 0) + ' to ' + EDGES[i] + ' ms';
        var bar = D.tipped(el('div', 'hist__bar'), def[0] + ', ' + range + ': ' + fmtPct(v) + ' of the time');
        bar.style.height = (v / max * 100) + '%';
        bar.style.background = def[1];
        plot.appendChild(bar);
      });
      var x = el('div', 'hist__x');
      XLAB.forEach(function (label) { x.appendChild(el('span', '', label)); });
      var pcts = el('div', 'pcts');
      [['half', 0.5], ['9 of 10', 0.9], ['19 of 20', 0.95], ['99 of 100', 0.99]].forEach(function (q) {
        var v = D.percentile(def[2], q[1], EDGES, '250+');
        var pct = el('div', 'pct');
        pct.appendChild(el('b', '', v == null ? '–' : v));
        pct.appendChild(el('span', '', 'ms or less, ' + q[0]));
        pcts.appendChild(pct);
      });
      var hist = el('div', 'hist');
      [title, plot, x, pcts].forEach(function (part) { hist.appendChild(part); });
      return hist;
    }));
    var nos = list.reduce(function (a, x) { return a + (x.stats.link.noSignalS || 0); }, 0);
    var rec = list.reduce(function (a, x) { return a + (x.stats.link.reconnects || 0); }, 0);
    var bg = list.filter(function (x) { return x.stats.link.backgroundS > 0; }).length;
    fill($('delay-note'), [
      document.createTextNode('Also sent: '), el('b', '', nos + ' s'), document.createTextNode(' of "no signal", '),
      el('b', '', rec), document.createTextNode(' reconnects, '), el('b', '', bg), document.createTextNode(' phones that left the game mid-cup.')
    ]);

    if (!total(d) && !total(r)) return blank('p-delay', 'Steering under 50 ms', 'no stats');
    var slowR = frac(paths[1][1], 2), slowD = frac(paths[0][1], 2);
    return { id: 'p-delay', q: 'Steering under 50 ms', big: total(d) ? fmtPct(frac(paths[0][1], 0)) : '–', sub: 'relay: ' + (total(r) ? fmtPct(frac(paths[1][1], 0)) : 'not used'), level: slowR > 0.1 || slowD > 0.03 ? 'bad' : slowR > 0.05 ? 'warn' : 'good' };
  }

  // A race's fingerprint: its track, its finishing order and the winner's time.
  // Every phone of a couch reports the same one (each calls its own car "you",
  // so that is read as "human"), and two different races all but never share it.
  // A race sent without the time has nothing to match on and stands alone.
  function raceKey(r, race, i) {
    if (!race.t) return '#' + i + '|' + race.track;
    return r.cup.id + '|' + race.track + '|' + race.t + '|' + race.order.join(',').replace(/you:/g, 'human:');
  }

  // Every race is counted once however many phones reported it.
  function uniqueRaces(list) {
    var seen = D.map(), out = [];
    list.forEach(function (r, i) {
      r.stats.races.forEach(function (race) {
        var key = raceKey(r, race, i);
        if (seen[key]) return; seen[key] = 1;
        out.push({ cup: r.cup.id, order: race.order });
      });
    });
    return out;
  }

  function renderPlayers(list) {
    var races = uniqueRaces(list);
    var cups = state.cup === 'all' ? CUPS : [CUP_BY_ID[state.cup]];
    var all = { wins: 0, rn: 0 }, toughest = null;
    fill($('pvb'), cups.map(function (cup) {
      var hs = 0, hn = 0, bs = 0, bn = 0, wins = 0, rn = 0;
      races.forEach(function (race) {
        if (race.cup !== cup.id) return;
        rn++;
        race.order.forEach(function (o, i) { if (o === 'bot') { bs += i + 1; bn++; } else { hs += i + 1; hn++; } });
        if (race.order[0] !== 'bot') wins++;
      });
      all.wins += wins; all.rn += rn;
      if (rn >= 5 && (!toughest || wins / rn < toughest.w)) toughest = { w: wins / rn, name: cup.short };
      return stackRow(cup.name, [{ label: 'A player won', n: wins, color: 'var(--s1)' }, { label: 'A bot won', n: rn - wins, color: 'var(--na)', ink: 'on-light' }],
        hn && bn ? 'place ' + (hs / hn).toFixed(1) + ' vs ' + (bs / bn).toFixed(1) : rn ? rn + ' races' : 'no races');
    }));
    fill($('pvb-legend'), legend([['A player won', 'var(--s1)'], ['A bot won', 'var(--na)'], ['Small print: average place, players vs bots']]));
    fill($('cars'), CARS.map(function (car) {
      var s = 0, n = 0, wins = 0;
      races.forEach(function (race) {
        race.order.forEach(function (o, i) { if (carOf(o) === car) { s += i + 1; n++; if (i === 0) wins++; } });
      });
      return stackRow(car, [{ label: 'Won', n: wins, color: 'var(--s1)' }, { label: 'Did not win', n: n - wins, color: 'var(--na)', ink: 'on-light' }], n ? 'average place ' + (s / n).toFixed(1) : 'no drives');
    }));
    if (!all.rn) return blank('p-pvb', 'Races a player wins', 'no stats');
    var win = pctOf(all.wins, all.rn);
    return { id: 'p-pvb', q: 'Races a player wins', big: fmtPct(win), sub: toughest && cups.length > 1 ? toughest.name + ': ' + fmtPct(toughest.w) : 'bots win the rest', level: win > 0.7 || (toughest && toughest.w < 0.15) ? 'bad' : toughest && toughest.w < 0.25 ? 'warn' : 'good' };
  }

  // The headline counts every rating; what they steered with is only known
  // of the records with stats.
  function renderSteering(list, withStats) {
    var feel = function (sub) { return segsFrom(CTRL, count(sub, function (r) { return r.answers.controls; })); };
    var by = function (group, phone) { return withStats.filter(function (r) { return steerGroup(r) === group && (!phone || r.stats.device.phone === phone); }); };
    var okShare = function (sub) { return 1 - share(sub.filter(function (r) { return r.answers.controls; }), function (r) { return r.answers.controls === 'awkward'; }); };
    var groups = [['tilt', 'Tilt'], ['buttons', 'Buttons']];
    fill($('controls'), groups.map(function (g) { return stackRow(g[1], feel(by(g[0]))); }));
    fill($('controls-legend'), legend(CTRL.map(function (c) { return [c[1], c[2]]; })));
    fill($('steer'), [stackRow('All players', segsFrom(STEER, count(withStats, steerGroup)), withStats.length + ' players')]);
    fill($('steer-legend'), legend(STEER.map(function (s) { return [s[1], s[2]]; })));
    fill($('controls-os'), [['ios', 'iPhone'], ['android', 'Android']].map(function (o) {
      return stackRow('Tilt, ' + o[1], feel(by('tilt', o[0])));
    }));
    var weakest = null;
    groups.forEach(function (g) {
      var sub = by(g[0]).filter(function (r) { return r.answers.controls; });
      if (sub.length >= 5 && (!weakest || okShare(sub) < weakest.ok)) weakest = { ok: okShare(sub), name: g[1] };
    });
    if (!list.some(function (r) { return r.answers.controls; })) return blank('p-steer', 'Controls okay or great', 'no ratings');
    var ok = okShare(list);
    return { id: 'p-steer', q: 'Controls okay or great', big: fmtPct(ok), sub: weakest ? weakest.name + ': ' + fmtPct(weakest.ok) : 'too few to split', level: ok > 0.85 ? 'good' : ok > 0.75 ? 'warn' : 'bad' };
  }

  function render(list) {
    fill($('cup-segs'), [{ id: 'all', short: 'All' }].concat(CUPS).map(function (c) {
      var b = el('button', '', c.short);
      b.type = 'button';
      b.setAttribute('data-v', c.id);
      return b;
    }));
    var withStats = list.filter(hasStats);
    return {
      funLabel: state.cup === 'all' ? 'All cups' : CUP_BY_ID[state.cup].name,
      funRows: state.cup === 'all' ? CUPS.map(function (cup) { return [cup.name, list.filter(function (r) { return r.cup.id === cup.id; })]; }) : [],
      tiles: [renderBots(list), renderPlayers(withStats), renderSteering(list, withStats), renderFastlane(withStats), renderDelay(withStats)],
      also: withStats.length + ' with stats'
    };
  }

  function chips(r) {
    var s = r.stats;
    return [CUP_BY_ID[r.cup.id].name, r.fun ? 'fun ' + r.fun + '/5' : null,
      r.answers.controls ? 'controls ' + r.answers.controls : null, s ? steerGroup(r) : null,
      s ? TV_NAME[s.device.tv] || s.device.tv : null, s && s.fastlane.result !== 'open' ? 'relay only' : null, r.build, r.day].filter(Boolean);
  }

  D.views.tinytrack = { name: 'Tiny Track Party', state: state, prepare: prepare, filter: filter, render: render, chips: chips };
})();
