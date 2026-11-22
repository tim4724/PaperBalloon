// Language preference + German-suggestion banner for the Paper Balloon site.
// Shared by the pages that come in both languages: the landing (index.html
// carries #langbar; /de/ does not), contact, beta and the legal pages
// (/privacy, /imprint and their /en/ counterparts). The blocks below each
// no-op on pages missing the elements they target, so one file covers all of
// them.
//
// One saved choice for the whole site: picking a language on any page is what
// the banner honors next.
(function () {
  var STORE = 'cg-lang';
  var choice;
  try { choice = localStorage.getItem(STORE); } catch (e) { choice = null; }

  function save(code) {
    choice = code;
    try { localStorage.setItem(STORE, code); } catch (e) {}
  }

  // Whether German wins: the saved choice, else whichever of German and
  // English the browser ranks first.
  function prefersGerman() {
    if (choice === 'de' || choice === 'en') return choice === 'de';
    var prefs = navigator.languages || [navigator.language || ''];
    for (var i = 0; i < prefs.length; i++) {
      var code = prefs[i].slice(0, 2).toLowerCase();
      if (code === 'de' || code === 'en') return code === 'de';
    }
    return false;
  }

  document.addEventListener('click', function (ev) {
    // Remember the language whenever a switch/banner link is clicked. A saved
    // "en" silences the German banner; a saved "de" keeps offering it.
    var pref = ev.target.closest('[data-lang-set]');
    if (pref) save(pref.getAttribute('data-lang-set'));

    // Legal-page DE<->EN toggle: replace the current history entry so switching
    // does not accumulate in the back stack. Falls back to a normal link when
    // JavaScript is disabled. (Landing toggles are plain [data-lang-set] links
    // that navigate normally.)
    var swap = ev.target.closest('.lang-switch');
    if (swap) {
      ev.preventDefault();
      location.replace(swap.href);
    }
  });

  // Below only applies to a page carrying the banner (the EN root). Never
  // redirect: every URL keeps its language.
  var bar = document.getElementById('langbar');
  if (!bar || !prefersGerman()) return;

  bar.hidden = false;
  bar.querySelector('.langbar__dismiss').addEventListener('click', function () {
    bar.hidden = true;
    save('en');
  });
})();
