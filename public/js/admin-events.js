/* Admin: events, announcements and audience stats */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let events = [], notices = [];

  function evRow(e, i) {
    return `<div class="svc-row" data-i="${i}" style="display:grid;grid-template-columns:1.4fr 150px 110px 1fr auto;gap:8px;margin-bottom:8px;align-items:center">
      <input data-f="title" placeholder="Event title" value="${esc(e.title)}">
      <input data-f="date" type="date" value="${esc(e.date)}">
      <input data-f="time" type="time" value="${esc(e.time)}">
      <input data-f="place" placeholder="Place (optional)" value="${esc(e.place)}">
      <button type="button" class="btn-admin-ghost" data-del-ev="${i}" aria-label="Remove">&#10005;</button>
      <input data-f="desc" placeholder="Short description (optional)" value="${esc(e.desc)}" style="grid-column:1 / -1">
    </div>`;
  }
  function anRow(n, i) {
    return `<div class="svc-row" data-i="${i}" style="display:grid;grid-template-columns:1.6fr 1fr 150px auto;gap:8px;margin-bottom:8px;align-items:center">
      <input data-f="text" placeholder="Announcement text" value="${esc(n.text)}" maxlength="240">
      <input data-f="link" placeholder="Link (optional)" value="${esc(n.link)}">
      <input data-f="until" type="date" title="Hide after this date" value="${esc(n.until)}">
      <button type="button" class="btn-admin-ghost" data-del-an="${i}" aria-label="Remove">&#10005;</button>
    </div>`;
  }
  function paint() {
    $('evList').innerHTML = events.length ? events.map(evRow).join('') : '<p class="hint">No events yet.</p>';
    $('anList').innerHTML = notices.length ? notices.map(anRow).join('') : '<p class="hint">No announcements yet.</p>';
  }
  function collect() {
    const read = (box, arr) => box.querySelectorAll('[data-i]').forEach(row => { const i = +row.dataset.i; row.querySelectorAll('[data-f]').forEach(inp => { arr[i][inp.dataset.f] = inp.value; }); });
    read($('evList'), events); read($('anList'), notices);
  }

  window.loadEventsAdmin = async function () {
    try {
      const j = await (await fetch('/api/admin/events')).json();
      if (j.ok) { events = j.events || []; notices = j.announcements || []; paint(); }
    } catch (e) { /* ignore */ }
    loadAudience();
  };

  async function loadAudience() {
    const box = $('audience'); if (!box) return;
    try {
      const [st, cat] = await Promise.all([fetch('/api/stats').then(r => r.json()), fetch('/api/catalog').then(r => r.json())]);
      const byId = new Map((cat.videos || []).map(v => [v.id, v]));
      const rows = (st.trending || []).slice(0, 10).map((t, i) => `<li><span>${i + 1}. ${esc((byId.get(t.id) || {}).title || t.id)}</span><b>${t.views} views</b></li>`).join('');
      box.innerHTML = `<p><b>${st.watching || 0}</b> watching live right now.</p><h3 style="margin-top:12px">Most watched on demand</h3>` +
        (rows ? `<ul style="list-style:none;margin-top:8px">${rows}</ul>` : '<p class="hint">Views will appear here once people watch videos on demand.</p>');
      box.querySelectorAll('li').forEach(li => { li.style.cssText = 'display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-top:1px solid rgba(255,255,255,.08);font-size:14px'; });
    } catch (e) { box.innerHTML = '<p class="hint">Could not load stats.</p>'; }
  }

  document.addEventListener('click', (e) => {
    if (e.target.id === 'evAdd') { collect(); events.push({ title: '', date: '', time: '', place: '', desc: '' }); paint(); }
    else if (e.target.id === 'anAdd') { collect(); notices.push({ text: '', link: '', until: '' }); paint(); }
    else if (e.target.dataset && e.target.dataset.delEv !== undefined) { collect(); events.splice(+e.target.dataset.delEv, 1); paint(); }
    else if (e.target.dataset && e.target.dataset.delAn !== undefined) { collect(); notices.splice(+e.target.dataset.delAn, 1); paint(); }
  });
  document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'eventsForm') return;
    e.preventDefault(); collect();
    const m = $('evMsg');
    const ev = events.filter(x => x.title || x.date), an = notices.filter(x => x.text);
    try {
      const r = await fetch('/api/admin/events', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: ev, announcements: an }) });
      const j = await r.json();
      m.textContent = j.ok ? 'Saved. The site now shows your events and announcements.' : (j.error || 'Could not save');
      m.className = 'form-msg ' + (j.ok ? 'ok' : 'err');
      if (j.ok) { events = j.events; notices = j.announcements; paint(); }
    } catch (err) { m.textContent = 'Network error'; m.className = 'form-msg err'; }
  });
})();
