// Contact form (/contact, /de/contact): posts to /api/message (api/message.php)
// and shows the page's own words while it waits and for its answer. The words
// sit on the form as data-* attributes, so one script serves both languages.
// Without JavaScript the form still posts, unacknowledged.
(function () {
  var form = document.getElementById('contactform');
  if (!form) return;
  var button = form.querySelector('button[type="submit"]');
  var status = document.getElementById('contactstatus');

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    button.disabled = true;
    // Handing the mail over takes a second or two on the host.
    say('sending', true);
    fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)) })
      .then(function (res) {
        if (res.ok) form.reset();
        done(res.ok ? 'sent' : res.status === 429 ? 'busy' : 'failed');
      }, function () { done('failed'); });
  });

  function say(key, pending) {
    status.textContent = form.getAttribute('data-' + key);
    status.classList.toggle('contact__status--pending', pending);
  }

  function done(key) {
    say(key, false);
    button.disabled = false;
  }
})();
