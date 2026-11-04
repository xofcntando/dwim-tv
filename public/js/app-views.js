/* ==========================================================
   DWIM TV app shell - views: On Demand, My List, TV Guide and the
   watch modal (HD player, resume, autoplay next, related videos).
   ========================================================== */
(function () {
  'use strict';
  const App = window.DwimApp;
  const { $, $$, esc } = App;

  /* ---------- shared pieces ---------- */
  function card(v) {
    const pc = App.pct(v.id), fav = App.isFav(v.id), ch = App.channel(v.channel);
    return `<div class="dcard" tabindex="0" role="button" data-open="${esc(v.id)}" aria-label="Play ${esc(v.title)}">
      <div class="dthumb"><img data-thumb src="${esc(App.thumb(v))}" data-fallback="https://i.ytimg.com/vi/${esc(App.ytId(v.source) || '')}/mqdefault.jpg" alt="" loading="lazy" decoding="async">
        ${v.duration ? `<span class="ddur">${esc(v.duration)}</span>` : ''}
        <span class="dplay" aria-hidden="true">&#9654;</span>
        ${pc > 1 && pc < 96 ? `<i class="dprog"><b style="width:${pc}%"></b></i>` : ''}
      </div>
      <div class="dbody"><h4>${esc(v.title)}</h4><small>${esc(ch ? ch.name : v.category || '')}</small></div>
      <button type="button" tabindex="-1" class="dfav ${fav ? 'on' : ''}" data-fav="${esc(v.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Remove from My List' : 'Add to My List'}">${fav ? '&#10084;' : '&#9825;'}</button>
    </div>`;
  }
  function row(title, list, opts) {
    opts = opts || {};
    if (!list.length) return '';
    return `<section class="drow"><div class="drow-h"><h3>${esc(title)}</h3>${opts.more ? `<button type="button" class="drow-more" data-channel="${esc(opts.more)}">See all &rsaquo;</button>` : ''}</div>
      <div class="rail-wrap"><button type="button" class="rail-btn l" aria-label="Scroll left" tabindex="-1">&lsaquo;</button><div class="rail">${list.map(card).join('')}</div><button type="button" class="rail-btn r" aria-label="Scroll right" tabindex="-1">&rsaquo;</button></div></section>`;
  }
  function wireCommon(root) {
    if (root.__wired) return; root.__wired = true;
    root.addEventListener('click', (e) => {
      const fav = e.target.closest('[data-fav]');
      if (fav) {
        e.stopPropagation();
        const on = App.toggleFav(fav.getAttribute('data-fav'));
        App.toast(on ? 'Added to My List' : 'Removed from My List');
        $$('[data-fav="' + fav.getAttribute('data-fav') + '"]', root).forEach(b => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.innerHTML = on ? '&#10084;' : '&#9825;'; });
        if (root.dataset.view === 'mylist' && !on) App.rerender();
        return;
      }
      const rb = e.target.closest('.rail-btn');
      if (rb) { const rail = rb.parentNode.querySelector('.rail'); rail.scrollBy({ left: (rb.classList.contains('l') ? -1 : 1) * rail.clientWidth * 0.85, behavior: 'smooth' }); return; }
      const more = e.target.closest('[data-channel]');
      if (more) { App.state.od = { q: '', ch: more.getAttribute('data-channel') }; App.go('#/ondemand'); App.rerender(); root.scrollTop = 0; return; }
      const op = e.target.closest('[data-open]');
      if (op) { App.openVideo(op.getAttribute('data-open')); return; }
      const go = e.target.closest('[data-go]');
      if (go) { App.go(go.getAttribute('data-go')); }
    });
  }

  /* ---------- On Demand ---------- */
  let stats = { trending: [], watching: 0 }, statsAt = 0;
  async function loadStats() {
    if (Date.now() - statsAt < 60000) return;
    statsAt = Date.now();
    try { const r = await fetch('/api/stats'); if (r.ok) { stats = await r.json(); if (App.views.ondemand.open) paintBody(); } } catch (e) { /* offline */ }
  }
  function dayPick(list) { // stable "pick of the day"
    if (!list.length) return null;
    const d = new Date(), seed = d.getUTCFullYear() * 400 + d.getUTCMonth() * 31 + d.getUTCDate();
    return list[seed % list.length];
  }
  function matches(v, q) {
    const hay = App.norm([v.title, v.category, v.desc, (v.tags || []).join(' '), (App.channel(v.channel) || {}).name].join(' '));
    return App.norm(q).split(/\s+/).filter(Boolean).every(t => hay.indexOf(t) >= 0);
  }
  function odState() { return App.state.od || (App.state.od = { q: '', ch: '' }); }

  // Pick a hero whose HD poster really exists (some videos only have a grey placeholder tile)
  let heroPick = null, heroProbing = false;
  function probeHero() {
    if (heroPick || heroProbing) return; heroProbing = true;
    const all = App.videos().filter(x => x.desc && App.dur(x) > 600 && App.ytId(x.source));
    const d = new Date(), seed = d.getUTCFullYear() * 400 + d.getUTCMonth() * 31 + d.getUTCDate();
    const cands = []; for (let i = 0; i < 10 && all.length; i++) cands.push(all[(seed * 7 + i * 13) % all.length]);
    let done = false, pending = cands.length;
    cands.forEach((v, idx) => {
      const im = new Image();
      im.onload = () => { if (!done && im.naturalWidth >= 1000) { done = true; heroPick = v; if (App.views.ondemand.open) paintBody(); } else if (--pending === 0 && !done) { heroPick = cands[0]; if (App.views.ondemand.open) paintBody(); } };
      im.onerror = () => { if (--pending === 0 && !done) { heroPick = cands[0]; if (App.views.ondemand.open) paintBody(); } };
      im.src = `https://i.ytimg.com/vi/${App.ytId(v.source)}/maxresdefault.jpg`;
    });
  }
  function heroHTML() {
    const all = App.videos();
    const v = all.find(x => x.featured) || heroPick;
    if (!heroPick && !v) probeHero();
    if (!v) return '';
    const id = App.ytId(v.source), fav = App.isFav(v.id), pc = App.pct(v.id);
    const img = id ? `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` : App.thumb(v);
    const fb = id ? `https://i.ytimg.com/vi/${id}/sddefault.jpg|${App.thumb(v)}` : '';
    return `<section class="od-hero"><img class="od-hero-bg" src="${esc(App.thumb(v))}" alt="" decoding="async">
      <div class="od-hero-shade"></div>
      <div class="od-hero-art"><img data-thumb src="${esc(img)}" data-fallback="${esc(fb)}" alt="" decoding="async"></div>
      <div class="od-hero-body"><span class="hero-badge">${esc(v.category || 'Featured')}</span><h2>${esc(v.title)}</h2>
        <p>${esc(v.desc || '')}</p>
        <div class="od-hero-actions"><button type="button" class="btn-play-hero" data-open="${esc(v.id)}">&#9654; ${pc > 1 && pc < 96 ? 'Resume' : 'Play'}</button>
        <button type="button" class="btn-ghost-hero" data-fav="${esc(v.id)}" aria-pressed="${fav}">${fav ? '&#10084; In My List' : '&#9825; My List'}</button></div></div></section>`;
  }

  function bodyHTML() {
    const st = odState(), all = App.videos();
    if (st.q || st.ch) {
      let list = all;
      if (st.ch) list = list.filter(v => v.channel === st.ch);
      if (st.q) list = list.filter(v => matches(v, st.q));
      const ch = st.ch ? App.channel(st.ch) : null;
      const title = st.q ? `Results for &ldquo;${esc(st.q)}&rdquo;${ch ? ' in ' + esc(ch.name) : ''}` : esc(ch ? ch.name : 'All videos');
      return `<div class="drow-h"><h3>${title} <span class="count">${list.length}</span></h3></div>` +
        (list.length ? `<div class="dgrid">${list.slice(0, 120).map(card).join('')}</div>${list.length > 120 ? '<p class="od-note">Showing the first 120. Narrow your search to see more.</p>' : ''}`
          : `<div class="empty-state"><div>&#128269;</div><h3>Nothing found</h3><p>Try another word, like &ldquo;prayer&rdquo;, &ldquo;faith&rdquo; or a song name.</p></div>`);
    }
    const prog = App.progressAll();
    const cont = Object.keys(prog).map(id => ({ v: App.video(id), p: prog[id] })).filter(x => x.v && x.p.t > 10 && x.p.d && x.p.t < x.p.d * 0.95)
      .sort((a, b) => b.p.ts - a.p.ts).slice(0, 20).map(x => x.v);
    const mine = App.favs().map(App.video).filter(v => v && v.channel !== 'ch-breaks');
    let trend = (stats.trending || []).map(t => App.video(t.id)).filter(v => v && v.channel !== 'ch-breaks').slice(0, 16);
    if (trend.length < 4) trend = [];
    const recent = all.slice(-16).reverse();
    let html = heroHTML();
    html += row('Continue Watching', cont) + row('My List', mine) + row('Trending Now', trend);
    html += row('Recently Added', recent);
    App.channels().forEach(c => {
      const list = all.filter(v => v.channel === c.id);
      list.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
      html += row((c.icon ? c.icon + ' ' : '') + c.name, list.slice(0, 20), { more: list.length > 20 ? c.id : null });
    });
    return html;
  }
  function paintBody() {
    const b = $('#odBody'); if (!b) return;
    b.innerHTML = bodyHTML();
    $$('.od-chip', App.layerEl()).forEach(c => c.classList.toggle('active', (c.dataset.ch || '') === odState().ch));
  }

  App.views.ondemand = {
    open: false,
    render(root) {
      this.open = true;
      const st = odState();
      root.innerHTML = `<div class="app-wrap">
        <div class="app-head"><div><h1>On Demand</h1><p class="app-sub">Sermons, prayers and worship. Watch anything, any time, and pick up where you left off.</p></div>
          <form class="od-search" role="search" onsubmit="return false"><input id="odSearch" type="search" placeholder="Search sermons, songs, prayers" value="${esc(st.q)}" autocomplete="off" aria-label="Search videos"></form></div>
        <div class="od-chips" role="tablist" aria-label="Channels"><button type="button" class="od-chip ${st.ch ? '' : 'active'}" data-ch="">All</button>${App.channels().map(c => `<button type="button" class="od-chip ${st.ch === c.id ? 'active' : ''}" data-ch="${esc(c.id)}">${esc(c.icon || '')} ${esc(c.name)}</button>`).join('')}</div>
        <div id="odBody"></div></div>`;
      wireCommon(root);
      if (!root.__odWired) {
        root.__odWired = true;
        root.addEventListener('input', (e) => {
          if (e.target.id !== 'odSearch') return;
          const s = odState(); s.q = e.target.value.trim(); s.ch = s.ch;
          clearTimeout(this._t); this._t = setTimeout(() => { paintBody(); const g = $('#search'); if (g && g.value !== e.target.value) g.value = e.target.value; }, 140);
        });
        root.addEventListener('click', (e) => {
          const c = e.target.closest('.od-chip'); if (!c) return;
          const s = odState(); s.ch = c.dataset.ch || ''; paintBody();
        });
      }
      paintBody(); loadStats();
    },
    refresh() { const i = $('#odSearch'); if (i) i.value = odState().q; paintBody(); },
    close() { this.open = false; }
  };

  /* ---------- My List ---------- */
  App.views.mylist = {
    render(root) {
      const mine = App.favs().map(App.video).filter(v => v && v.channel !== 'ch-breaks');
      const prog = App.progressAll();
      const hist = Object.keys(prog).map(id => ({ v: App.video(id), p: prog[id] })).filter(x => x.v).sort((a, b) => b.p.ts - a.p.ts).slice(0, 40).map(x => x.v);
      root.innerHTML = `<div class="app-wrap"><div class="app-head"><div><h1>My List</h1><p class="app-sub">Videos you saved, and what you watched recently. Stored on this device.</p></div></div>
        <h3 class="sec-h">&#10084; Saved</h3>
        ${mine.length ? `<div class="dgrid">${mine.map(card).join('')}</div>` : `<div class="empty-state"><div>&#9825;</div><h3>Nothing saved yet</h3><p>Tap the heart on any video to keep it here.</p><button class="btn-gold" data-go="#/ondemand">Browse On Demand</button></div>`}
        <h3 class="sec-h">&#9201; Recently watched ${hist.length ? '<button type="button" class="link-btn" id="clearHist">Clear history</button>' : ''}</h3>
        ${hist.length ? `<div class="dgrid">${hist.map(card).join('')}</div>` : '<p class="app-sub">Your watch history will show here.</p>'}</div>`;
      wireCommon(root);
      const c = $('#clearHist', root); if (c) c.onclick = () => { App.clearProgress(); App.toast('History cleared'); App.rerender(); };
    }
  };

  /* ---------- TV Guide ---------- */
  const DAY_MS = 86400000;
  function tzOf() { return (App.cat().schedule && App.cat().schedule.timezone) || 'Africa/Harare'; }
  function fmtT(ms, tz) { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(new Date(ms)); }
  function fmtDay(ms, tz, long) { return new Intl.DateTimeFormat('en-GB', { weekday: long ? 'long' : 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(ms)); }
  function reminders() { return App.store.get('remind', {}); }
  App.reminders = reminders;

  function guideHTML(dayIdx) {
    const cat = App.cat(), tz = tzOf(), now = Date.now();
    if (!cat.schedule) return '<div class="empty-state"><h3>The schedule is not available right now</h3></div>';
    const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const showLocal = localTz && fmtT(now, tz) !== fmtT(now, localTz);
    const tabs = [];
    for (let i = 0; i < 7; i++) {
      const ms = now + i * DAY_MS;
      tabs.push(`<button type="button" class="g-day ${i === dayIdx ? 'active' : ''}" data-day="${i}" role="tab" aria-selected="${i === dayIdx}"><b>${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: tz }).format(new Date(ms))}</b><small>${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: tz }).format(new Date(ms))}</small></button>`);
    }
    const dayMs = now + dayIdx * DAY_MS;
    const grid = DwimSchedule.dayGrid(cat, dayMs);
    const r = dayIdx === 0 ? DwimSchedule.resolve(cat, now) : null;
    const rem = reminders();
    const rows = grid.map(g => {
      const on = now >= g.startMs && now < g.endMs, past = g.endMs <= now;
      const end = fmtT(g.endMs, tz);
      const pc = on ? Math.round((now - g.startMs) / (g.endMs - g.startMs) * 100) : 0;
      const key = String(g.startMs), reminded = !!rem[key];
      const nowPlaying = on && r && r.video ? `<div class="g-np">Playing now: <b>${esc(r.video.title)}</b></div>` : '';
      return `<li class="g-row ${on ? 'on' : ''} ${past ? 'past' : ''}">
        <div class="g-time"><b>${fmtT(g.startMs, tz)}</b><small>to ${end === '00:00' ? '24:00' : end}</small>${showLocal ? `<em>${fmtT(g.startMs, localTz)} your time</em>` : ''}</div>
        <div class="g-card"><div class="g-ic">${esc(g.block.icon || '')}</div><div class="g-main"><h3>${esc(g.block.name)} ${on ? '<i class="g-live">ON NOW</i>' : ''}</h3>
          ${g.block.desc ? `<p>${esc(g.block.desc)}</p>` : ''}${nowPlaying}${on ? `<div class="g-bar"><b style="width:${pc}%"></b></div>` : ''}</div>
          <div class="g-act">${on ? '<button type="button" class="btn-gold" data-go="#/live">&#9654; Watch live</button>'
            : past ? '' : `<button type="button" class="btn-remind ${reminded ? 'on' : ''}" data-remind="${key}" data-name="${esc(g.block.name)}" aria-pressed="${reminded}">${reminded ? '&#128276; Reminder set' : '&#128277; Remind me'}</button>`}</div></div></li>`;
    }).join('');
    let sig = '';
    const sc = cat.schedule;
    if (sc.signature) {
      const times = DwimSchedule.signatureTimes(cat, dayMs).map(ms => fmtT(ms, tz)).join(' &middot; ');
      sig = `<div class="g-sig">&#127783; <b>${esc(sc.signature.label || 'Signature song')}</b> plays every day at ${times}</div>`;
    }
    const brk = (sc.breaks || [])[0];
    const brkNote = brk && brk.everyMinutes ? `<div class="g-sig soft">&#10024; A short <b>${esc(brk.label || 'DWIM TV')}</b> break plays every ${brk.everyMinutes} minutes. Your sermon always resumes where it stopped.</div>` : '';
    return `<div class="g-days" role="tablist" aria-label="Choose a day">${tabs.join('')}</div>
      <p class="g-tz">${esc(fmtDay(dayMs, tz, true))} &middot; Times are Zimbabwe time (CAT)${showLocal ? ', with your local time shown' : ''}.</p>${sig}${brkNote}
      <ul class="g-list">${rows}</ul>`;
  }

  let guideTimer = null;
  App.views.guide = {
    render(root) {
      const idx = App.state.guideDay || 0;
      root.innerHTML = `<div class="app-wrap"><div class="app-head"><div><h1>TV Guide</h1><p class="app-sub">What is on DWIM TV today and for the next 7 days. Set a reminder and never miss a service.</p></div></div>
        <div id="guideBody">${guideHTML(idx)}</div>
        <div id="guideEvents"></div></div>`;
      wireCommon(root);
      if (App.renderEvents) App.renderEvents($('#guideEvents', root), 6);
      if (!root.__gWired) {
        root.__gWired = true;
        root.addEventListener('click', (e) => {
          const d = e.target.closest('.g-day'); if (d) { App.state.guideDay = +d.dataset.day; $('#guideBody', root).innerHTML = guideHTML(App.state.guideDay); return; }
          const rb = e.target.closest('[data-remind]'); if (rb) App.toggleReminder(rb.dataset.remind, rb.dataset.name, rb);
        });
      }
      clearInterval(guideTimer);
      guideTimer = setInterval(() => { const b = $('#guideBody'); if (b && !document.hidden) b.innerHTML = guideHTML(App.state.guideDay || 0); }, 60000);
    },
    close() { clearInterval(guideTimer); }
  };

  /* reminders: in-app + system notifications while DWIM TV is open or installed */
  App.toggleReminder = async (key, name, btn) => {
    const rem = reminders();
    if (rem[key]) { delete rem[key]; App.store.set('remind', rem); App.toast('Reminder removed'); }
    else {
      if ('Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (e) { /* ignore */ } }
      rem[key] = { name, at: +key - 5 * 60000 };
      App.store.set('remind', rem);
      const ok = 'Notification' in window && Notification.permission === 'granted';
      App.toast(ok ? `Reminder set: ${name} (5 minutes before)` : `Reminder set: ${name}. Allow notifications to be alerted.`);
    }
    if (btn) { const on = !!rem[key]; btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on); btn.innerHTML = on ? '&#128276; Reminder set' : '&#128277; Remind me'; }
  };
  function checkReminders() {
    const rem = reminders(), now = Date.now(); let changed = false;
    Object.keys(rem).forEach(k => {
      const r = rem[k];
      if (+k < now - 30 * 60000) { delete rem[k]; changed = true; return; }   // stale
      if (r.at <= now && !r.fired) {
        r.fired = true; changed = true;
        const body = `${r.name} starts at ${fmtT(+k, Intl.DateTimeFormat().resolvedOptions().timeZone)} on DWIM TV`;
        App.toast(`Starting soon: ${r.name}`, { label: 'Watch', fn: () => App.go('#/live') });
        if ('Notification' in window && Notification.permission === 'granted') {
          navigator.serviceWorker && navigator.serviceWorker.getRegistration().then(reg => {
            const opts = { body, icon: '/img/logo-192.png', badge: '/img/logo-64.png', tag: 'dwim-' + k, data: { url: '/#/live' } };
            if (reg && reg.showNotification) reg.showNotification('DWIM TV', opts); else new Notification('DWIM TV', opts);
          }).catch(() => { try { new Notification('DWIM TV', { body }); } catch (e) { /* ignore */ } });
        }
      }
    });
    if (changed) App.store.set('remind', rem);
  }
  setInterval(checkReminders, 30000);
  document.addEventListener('dwim:catalog', checkReminders);

  /* ---------- Watch modal ---------- */
  let wm = null, ytp = null, own = null, progT = null, nextT = null, wmId = null, prevFocus = null;

  function relatedFor(v) {
    const all = App.videos();
    const same = all.filter(x => x.channel === v.channel && x.id !== v.id);
    const i = all.filter(x => x.channel === v.channel).findIndex(x => x.id === v.id);
    const ordered = same.slice(Math.max(0, i)).concat(same.slice(0, Math.max(0, i)));
    const tags = new Set(v.tags || []);
    const alike = all.filter(x => x.channel !== v.channel && (x.tags || []).some(t => tags.has(t)));
    return ordered.concat(alike).slice(0, 16);
  }
  function nextFor(v) { return relatedFor(v).filter(x => x.channel === v.channel)[0] || relatedFor(v)[0] || null; }

  function sideItem(x) {
    return `<div class="side-item" tabindex="0" role="button" data-open="${esc(x.id)}" aria-label="Play ${esc(x.title)}"><div class="dthumb"><img data-thumb src="${esc(App.thumb(x))}" data-fallback="https://i.ytimg.com/vi/${esc(App.ytId(x.source) || '')}/mqdefault.jpg" alt="" loading="lazy">${x.duration ? `<span class="ddur">${esc(x.duration)}</span>` : ''}</div><div><h4>${esc(x.title)}</h4><small>${esc((App.channel(x.channel) || {}).name || x.category || '')}</small></div></div>`;
  }

  App.openWatch = (id) => {
    const v = App.video(id);
    if (!v) { App.toast('That video is not available'); App.closeVideo(); return; }
    if (wm && wmId === id) return;
    teardownPlayer();
    wmId = id;
    prevFocus = prevFocus || document.activeElement;
    if (!wm) {
      wm = document.createElement('div'); wm.id = 'watchModal'; wm.className = 'watch-modal';
      wm.setAttribute('role', 'dialog'); wm.setAttribute('aria-modal', 'true');
      document.body.appendChild(wm);
      wm.addEventListener('click', onWmClick);
      wm.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][tabindex]')) { e.preventDefault(); e.target.click(); } });
    }
    App.holdLive();
    document.body.classList.add('watch-open');
    const rel = relatedFor(v), fav = App.isFav(id), ch = App.channel(v.channel);
    wm.setAttribute('aria-label', v.title);
    wm.innerHTML = `<div class="wm-top"><button type="button" class="wm-back" data-wm-close>&lsaquo; Back</button><span class="wm-brand">DWIM <b>TV</b> On Demand</span></div>
      <div class="wm-body"><div class="wm-main"><div class="wm-stage" id="wmStage"><div id="wmPlayer"></div><div class="wm-next" id="wmNext" hidden></div></div>
        <div class="wm-info"><span class="hero-badge">${esc(v.category || (ch && ch.name) || 'Video')}</span><h2>${esc(v.title)}</h2>
          <div class="wm-meta">${ch ? esc(ch.name) : ''}${v.duration ? ' &middot; ' + esc(v.duration) : ''}${viewsLabel(id)}</div>
          <div class="wm-actions"><button type="button" class="wm-btn ${fav ? 'on' : ''}" data-wm-fav aria-pressed="${fav}">${fav ? '&#10084; Saved' : '&#9825; Save'}</button>
            <button type="button" class="wm-btn" data-wm-share>&#10150; Share</button>
            <label class="wm-auto"><input type="checkbox" id="wmAuto" ${App.store.get('autoplay', true) ? 'checked' : ''}> Autoplay next</label></div>
          ${v.desc ? `<p class="wm-desc">${esc(v.desc)}</p>` : ''}</div></div>
        <aside class="wm-side"><h3>More to watch</h3>${rel.map(sideItem).join('')}</aside></div>`;
    wm.hidden = false;
    $('.wm-back', wm).focus();
    startPlayer(v);
    fetch('/api/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {});
    try { document.title = v.title + ' | DWIM TV'; } catch (e) { /* ignore */ }
    setMedia(v);
  };
  function viewsLabel(id) { const t = (stats.trending || []).find(x => x.id === id); return t && t.views > 4 ? ` &middot; ${t.views} views` : ''; }

  App.closeWatch = () => {
    if (!wm) return;
    saveNow(); teardownPlayer();
    wm.remove(); wm = null; wmId = null;
    document.body.classList.remove('watch-open');
    document.title = 'DWIM TV — ' + ((App.cat().church || {}).name || 'Destiny Word International Ministries');
    App.releaseLive();
    if (prevFocus && document.contains(prevFocus)) { try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    prevFocus = null;
    if (App.views.ondemand.open) paintBody();
    if ((typeof TV !== 'undefined' && TV)) { try { const i = TV.info(); if (i && i.video && App.setMedia) App.setMedia(i.video, true); } catch (e) { /* ignore */ } }
  };

  function onWmClick(e) {
    if (e.target.closest('[data-wm-close]')) { App.closeVideo(); return; }
    const op = e.target.closest('[data-open]');
    if (op) { openedReplace(op.getAttribute('data-open')); return; }
    if (e.target.closest('[data-wm-fav]')) {
      const on = App.toggleFav(wmId); const b = $('[data-wm-fav]', wm);
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.innerHTML = on ? '&#10084; Saved' : '&#9825; Save';
      App.toast(on ? 'Added to My List' : 'Removed from My List'); return;
    }
    if (e.target.closest('[data-wm-share]')) {
      const v = App.video(wmId);
      App.share(v.title, `Watch "${v.title}" on DWIM TV`, location.origin + '/#/watch/' + encodeURIComponent(wmId)); return;
    }
    if (e.target.id === 'wmAuto') { App.store.set('autoplay', e.target.checked); return; }
    if (e.target.closest('[data-next-now]')) { const v = App.video(wmId), n = nextFor(v); if (n) openedReplace(n.id); return; }
    if (e.target.closest('[data-next-cancel]')) { clearInterval(nextT); $('#wmNext', wm).hidden = true; }
  }
  // switching video inside the modal replaces the history entry instead of stacking them
  function openedReplace(id) {
    const url = location.pathname + location.search + '#/watch/' + encodeURIComponent(id);
    history.replaceState(null, '', url);
    App.openWatch(id);
  }

  function teardownPlayer() {
    clearInterval(progT); clearInterval(nextT);
    if (ytp) { try { ytp.destroy(); } catch (e) { /* ignore */ } ytp = null; }
    if (own) { try { own.destroy(); } catch (e) { /* ignore */ } own = null; }
  }
  function curTime() {
    try { if (ytp && ytp.getCurrentTime) return { t: ytp.getCurrentTime(), d: ytp.getDuration() }; } catch (e) { /* ignore */ }
    if (own && own.video) return { t: own.video.currentTime, d: own.video.duration };
    return null;
  }
  function saveNow() {
    if (!wmId) return; const c = curTime();
    if (c && c.d > 30 && c.t > 5 && isFinite(c.d)) App.saveProgress(wmId, c.t >= c.d - 5 ? c.d : c.t, c.d);
  }

  async function startPlayer(v) {
    const holder = $('#wmPlayer', wm);
    const p0 = App.progress(v.id);
    let start = p0 && p0.t > 10 && p0.d && p0.t < p0.d - 30 ? p0.t : 0;
    if (App.state.fromStart) { start = 0; App.state.fromStart = false; }
    const mine = v.id;
    const onEnded = () => {
      App.saveProgress(mine, App.dur(v) || 1, App.dur(v) || 1);
      if (!App.store.get('autoplay', true)) return;
      const n = nextFor(v); if (!n || !wm) return;
      const box = $('#wmNext', wm); let left = 6; box.hidden = false;
      const paint = () => { box.innerHTML = `<div class="wn-card"><small>Up next in ${left}</small><strong>${esc(n.title)}</strong><div><button type="button" class="btn-gold" data-next-now>Play now</button><button type="button" class="btn-outline-light" data-next-cancel>Cancel</button></div></div>`; };
      paint(); const btn = $('[data-next-now]', box); if (btn) btn.focus();
      clearInterval(nextT);
      nextT = setInterval(() => { left--; if (left <= 0) { clearInterval(nextT); openedReplace(n.id); } else paint(); }, 1000);
    };
    if (v.type === 'youtube' && App.ytId(v.source)) {
      holder.innerHTML = '<div id="wmYt"></div>';
      await App.loadYT();
      if (wmId !== mine) return;
      ytp = new YT.Player('wmYt', {
        host: 'https://www.youtube-nocookie.com', videoId: App.ytId(v.source), width: '100%', height: '100%',
        playerVars: { autoplay: 1, controls: 1, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, vq: 'hd1080', start: Math.floor(start), origin: location.origin, cc_load_policy: 0 },
        events: {
          onReady: (e) => { App.hd(e.target); e.target.playVideo(); },
          onStateChange: (e) => {
            if (wmId !== mine) return;
            if (e.data === YT.PlayerState.PLAYING) { App.hd(e.target); clearInterval(progT); progT = setInterval(saveNow, 5000); }
            else if (e.data === YT.PlayerState.PAUSED) saveNow();
            else if (e.data === YT.PlayerState.ENDED) { clearInterval(progT); onEnded(); }
          },
          onError: () => {
            holder.innerHTML = `<div class="wm-err"><p>This video cannot be played here right now.</p><a class="btn-gold" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=${esc(App.ytId(v.source))}">Watch on YouTube</a></div>`;
          }
        }
      });
    } else if (v.type === 'embed') {
      holder.innerHTML = `<iframe src="${esc(v.source)}" title="${esc(v.title)}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
    } else {
      own = DwimPlayer.mount(holder, { src: v.source, type: v.type, autoplay: true, onended: onEnded });
      if (own && own.video) {
        if (start) own.video.addEventListener('loadedmetadata', () => { try { own.video.currentTime = start; } catch (e) { /* ignore */ } }, { once: true });
        own.video.addEventListener('playing', () => { clearInterval(progT); progT = setInterval(saveNow, 5000); });
        own.video.addEventListener('pause', saveNow);
      }
    }
  }
  window.addEventListener('pagehide', saveNow);

  /* ---------- Media Session (lock screen / headset / TV remote controls) ---------- */
  function setMedia(v, live) {
    if (!('mediaSession' in navigator) || !v) return;
    try {
      const art = App.thumb(v);
      navigator.mediaSession.metadata = new MediaMetadata({ title: v.title, artist: live ? 'DWIM TV Live' : 'DWIM TV', album: (App.channel(v.channel) || {}).name || 'Destiny Word International Ministries', artwork: art ? [{ src: art, sizes: '480x360', type: 'image/jpeg' }, { src: '/img/logo-512.png', sizes: '512x512', type: 'image/png' }] : [{ src: '/img/logo-512.png', sizes: '512x512', type: 'image/png' }] });
    } catch (e) { /* ignore */ }
  }
  App.setMedia = setMedia;
})();
