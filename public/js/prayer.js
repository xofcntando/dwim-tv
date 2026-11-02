/* Prayer request form (public) */
(function () {
  var ov = document.getElementById('prOverlay');
  var form = document.getElementById('prForm');
  if (!ov || !form) return;
  var msg = document.getElementById('prMsg');
  var btn = document.getElementById('prSubmit');
  function open() { ov.hidden = false; document.body.style.overflow = 'hidden'; msg.textContent = ''; msg.className = 'pr-msg'; setTimeout(function () { form.request.focus(); }, 50); }
  function close() { ov.hidden = true; document.body.style.overflow = ''; }
  document.getElementById('prayerFormBtn').addEventListener('click', open);
  document.getElementById('prClose').addEventListener('click', close);
  ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !ov.hidden) close(); });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    btn.disabled = true; msg.className = 'pr-msg'; msg.textContent = 'Sending…';
    var body = {}; new FormData(form).forEach(function (v, k) { body[k] = v; });
    fetch('/api/prayer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.ok) {
          form.reset();
          msg.className = 'pr-msg ok';
          msg.textContent = 'Received. We are standing with you in prayer. God bless you!';
          setTimeout(close, 3500);
        } else { msg.className = 'pr-msg err'; msg.textContent = j.error || 'Something went wrong.'; }
      })
      .catch(function () { msg.className = 'pr-msg err'; msg.textContent = 'Network error. Please try again.'; })
      .then(function () { btn.disabled = false; });
  });
})();
