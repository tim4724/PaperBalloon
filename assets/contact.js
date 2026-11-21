// Contact form (/contact, /de/contact): posts to /api/message (api/message.php).
// Once the message is handed over, the form gives way to a confirmation that
// shows what was sent and where the reply will go, so a mistyped address
// shows up. The page's own words sit on the form and the confirmation as
// data-* attributes, so one script serves both languages. Without JavaScript
// the form still posts, unacknowledged.
(function () {
  var form = document.getElementById('contactform');
  if (!form) return;
  var button = form.querySelector('button[type="submit"]');
  var status = document.getElementById('contactstatus');
  var done = document.getElementById('contactdone');

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    // As the server will see them (it trims both).
    var message = form.elements.message.value.trim();
    var email = form.elements.email.value.trim();
    // Not the trap field (website): autofill and password managers fill
    // hidden fields too, and the server drops a filled one without a word.
    // It still catches bots that post the form without running this.
    var body = new URLSearchParams();
    body.append('message', form.elements.message.value);
    body.append('email', form.elements.email.value);
    button.disabled = true;
    // Handing the mail over takes a second or two on the host.
    say('sending', true);
    fetch(form.action, { method: 'POST', body: body })
      .then(function (res) {
        if (res.ok) sent(message, email);
        else finish(res.status === 429 ? 'busy' : 'failed');
      }, function () { finish('failed'); });
  });

  // Back to the form, with the address kept: it is the same person, and a
  // mistyped one can be fixed right there.
  document.getElementById('contactagain').addEventListener('click', function () {
    done.hidden = true;
    form.hidden = false;
    form.elements.message.focus();
  });

  function sent(message, email) {
    // textContent only: both are the visitor's own input.
    document.getElementById('contactdone-message').textContent = message;
    var reply = document.getElementById('contactdone-reply');
    reply.textContent = '';
    if (email) {
      var address = document.createElement('strong');
      address.textContent = email;
      reply.appendChild(document.createTextNode(done.getAttribute('data-to') + ' '));
      reply.appendChild(address);
      reply.appendChild(document.createTextNode('.'));
    } else {
      reply.textContent = done.getAttribute('data-none');
    }
    form.elements.message.value = '';
    finish(null);
    form.hidden = true;
    done.hidden = false;
    // Takes screen readers and the keyboard along to the confirmation.
    done.focus();
  }

  function say(key, pending) {
    status.textContent = key ? form.getAttribute('data-' + key) : '';
    status.classList.toggle('contact__status--pending', pending);
  }

  function finish(key) {
    say(key, false);
    button.disabled = false;
  }
})();
