// Contact form (/contact, /de/contact): posts to /api/message (api/message.php)
// and shows the page's own words for its answer. The words sit on the form as
// data-* attributes, so one script serves both languages. Without JavaScript
// the form still posts, unacknowledged.
(function () {
  var form = document.getElementById('contactform');
  if (!form) return;
  var button = form.querySelector('button[type="submit"]');
  var status = document.getElementById('contactstatus');

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    button.disabled = true;
    status.textContent = '';
    fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)) })
      .then(function (res) {
        if (res.ok) form.reset();
        show(res.ok ? 'sent' : res.status === 429 ? 'busy' : 'failed');
      }, function () { show('failed'); });
  });

  function show(key) {
    status.textContent = form.getAttribute('data-' + key);
    button.disabled = false;
  }
})();
