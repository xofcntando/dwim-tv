/* ==========================================================
   DWIM TV app shell - core: storage, toasts, router, app layer,
   keyboard / remote-control navigation. Views live in app-views.js,
   live-TV extras in app-live.js.
   ========================================================== */
(function () {
  'use strict';
  const App = window.DwimApp = { views: {}, state: {} };

  /* ---------- tiny helpers ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  App.$ = $; App.$$ = $$; App.esc = esc;

  App.norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  App.ytId = (u) => { const m = String(u || '').match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/); return m ? m[1] : null; };
  App.dur = (v) => (typeof DwimSchedule !== 'undefined' ? DwimSchedule.durSec(v) : 0);
  App.fmtDur = (sec) => {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  };
  App.cat = () => (typeof CATALOG !== 'undefined' ? CATALOG : { videos: [], channels: [] });
  App.videos = () => (App.cat().videos || []).filter(v => v.source && v.channel !== 'ch-breaks');
  App.video = (id) => (App.cat().videos || []).find(v => v.id === id) || null;
  App.channel = (id) => (App.cat().channels || []).find(c => c.id === id) || null;
  App.channels = () => (App.cat().channels || []).filter(c => c.id !== 'ch-all' && c.id !== 'ch-breaks');
  App.thumb = (v) => v.thumb || (App.ytId(v.source) ? `https://i.ytimg.com/vi/${App.ytId(v.source)}/hqdefault.jpg` : '');

  /* ---------- storage (favourites, progress) ---------- */
  const Store = App.store = {
    get(k, d) { try { const v = localStorage.getItem('dwimtv:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('dwimtv:' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };
  App.favs = () => Store.get('fav', []);
  App.isFav = (id) => App.favs().indexOf(id) >= 0;
  App.toggleFav = (id) => {
    let f = App.favs(); const had = f.indexOf(id) >= 0;
    f = had ? f.filter(x => x !== id) : [id].concat(f);
    Store.set('fav', f);
    document.dispatchEvent(new CustomEvent('dwim:favs', { detail: { id, on: !had } }));
    return !had;
  };
  App.progressAll = () => Store.get('prog', {});
  App.progress = (id) => App.progressAll()[id] || null;
  App.saveProgress = (id, t, d) => {
    const all = App.progressAll();
    all[id] = { t: Math.floor(t), d: Math.floor(d), ts: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > 80) keys.sort((a, b) => all[a].ts - all[b].ts).slice(0, keys.length - 80).forEach(k => delete all[k]);
    Store.set('prog', all);
  };
  App.clearProgress = (id) => { const all = App.progressAll(); if (id) delete all[id]; else Object.keys(all).forEach(k => delete all[k]); Store.set('prog', all); };
  App.pct = (id) => { const p = App.progress(id); return p && p.d > 0 ? Math.min(100, Math.round(p.t / p.d * 100)) : 0; };

  /* ---------- toast ---------- */
  let toastT = null;
  App.toast = (msg, action) => {
    let t = $('#appToast');
    if (!t) { t = document.createElement('div'); t.id = 'appToast'; t.className = 'app-toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t); }
    t.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button">${esc(action.label)}</button>` : '');
    if (action) t.querySelector('button').onclick = () => { t.classList.remove('show'); action.fn(); };
    t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), action ? 9000 : 3200);
  };

  App.share = async (title, text, url) => {
    try {
      if (navigator.share) { await navigator.share({ title, text, url }); return; }
      if (navigator.clipboard) { await navigator.clipboard.writeText(url); App.toast('Link copied'); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    window.open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + url), '_blank', 'noopener');
  };

  /* ---------- YouTube IFrame API loader (shared) ---------- */
  let ytP = null;
  App.loadYT = () => {
    if (ytP) return ytP;
    ytP = new Promise((resolve) => {
      if (window.YT && window.YT.Player) return resolve();
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(); };
      if (!$('script[src*="youtube.com/iframe_api"]')) { const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s); }
    });
    return ytP;
  };
  App.hd = (p) => {
    try {
      const lv = (p.getAvailableQualityLevels && p.getAvailableQualityLevels()) || [];
      const pick = lv.indexOf('hd1080') >= 0 ? 'hd1080' : (['hd2160', 'hd1440', 'hd720'].find(q => lv.indexOf(q) >= 0) || 'hd1080');
      if (p.setPlaybackQualityRange) p.setPlaybackQualityRange(pick, pick);
      if (p.setPlaybackQuality) p.setPlaybackQuality(pick);
    } catch (e) { /* ignore */ }
  };

  /* ---------- app layer (Guide / On Demand / My List) ---------- */
  let layer = null, curView = null, liveHeld = false, openedWatchInternally = false, lastBase = '';
  const bar = $('.topbar');
  function syncBarH() { document.documentElement.style.setProperty('--topbar-h', (bar ? bar.offsetHeight : 64) + 'px'); }
  syncBarH(); window.addEventListener('resize', syncBarH);

  function ensureLayer() {
    if (layer) return layer;
    layer = document.createElement('div');
    layer.id = 'appLayer'; layer.className = 'app-layer'; layer.hidden = true;
    layer.setAttribute('role', 'region'); layer.setAttribute('aria-label', 'DWIM TV');
    document.body.appendChild(layer);
    layer.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][tabindex]')) { e.preventDefault(); e.target.click(); } });
    return layer;
  }

  App.openLayer = (name, params) => {
    const view = App.views[name]; if (!view) return;
    ensureLayer(); syncBarH();
    const same = curView === name && !layer.hidden;
    const top = same ? layer.scrollTop : 0;
    curView = name; App.state.params = params || {};
    layer.hidden = false; layer.dataset.view = name;
    document.body.classList.add('layer-open');
    view.render(layer, App.state.params);
    layer.scrollTop = top;
    markNav(name);
    if (!same) { const h = $('h1, h2', layer); if (h) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } }
  };
  App.closeLayer = () => {
    if (!layer || layer.hidden) { markNav(''); return; }
    const v = App.views[curView]; if (v && v.close) v.close();
    layer.hidden = true; layer.innerHTML = ''; curView = null;
    document.body.classList.remove('layer-open');
    markNav('');
  };
  App.layerEl = () => layer;
  App.rerender = () => { if (curView && layer && !layer.hidden) App.openLayer(curView, App.state.params); };

  function markNav(name) {
    $$('.topnav a, .tabbar a').forEach(a => {
      const on = !!name && a.getAttribute('data-route') === name;
      a.classList.toggle('route-on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (!name) {
      const hash = location.hash;
      $$('.tabbar a').forEach(a => { const r = a.getAttribute('data-route'); if (r === 'live' && (hash === '' || hash === '#/live' || hash === '#watch')) { a.classList.add('route-on'); } });
    }
  }

  /* ---------- watch modal hooks (implemented in app-views.js) ---------- */
  App.holdLive = () => { try { if ((typeof TV !== 'undefined' && TV) && !TV.info().paused) { TV.pause(); liveHeld = true; } } catch (e) { /* ignore */ } };
  App.releaseLive = () => { if (liveHeld) { liveHeld = false; try { TV.resume(); } catch (e) { /* ignore */ } } };

  /* ---------- router ---------- */
  App.go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
  App.openVideo = (id) => { openedWatchInternally = true; App.go('#/watch/' + encodeURIComponent(id)); };
  App.closeVideo = () => {
    if (openedWatchInternally && history.length > 1) { openedWatchInternally = false; history.back(); }
    else { openedWatchInternally = false; App.go(lastBase || '#/ondemand'); }
  };
  App.openChannel = (id) => { App.state.od = { q: '', ch: id }; App.go('#/ondemand'); if (location.hash === '#/ondemand') App.rerender(); };
  App.search = (q) => {
    App.state.od = { q: q || '', ch: '' };
    if (curView !== 'ondemand' || (layer && layer.hidden)) { App.go('#/ondemand'); if (curView === 'ondemand') App.rerender(); }
    else if (App.views.ondemand.refresh) App.views.ondemand.refresh();
  };

  function route() {
    const h = location.hash || '';
    const m = h.match(/^#\/(live|guide|ondemand|mylist|watch)(?:\/([^?]*))?/);
    if (!m) { App.closeWatch && App.closeWatch(); App.closeLayer(); markNav(''); return; }
    const name = m[1], arg = m[2] ? decodeURIComponent(m[2]) : '';
    if (name === 'watch') {
      if (!App.cat().videos || !App.cat().videos.length) { App.pendingRoute = true; return; }
      if (!layer || layer.hidden) { /* direct link: put On Demand underneath */ App.openLayer('ondemand'); }
      App.openWatch(arg);
      return;
    }
    lastBase = h;
    App.closeWatch && App.closeWatch();
    if (name === 'live') {
      App.closeLayer();
      const w = document.getElementById('watch') || document.getElementById('hero');
      if (w) w.scrollIntoView({ behavior: 'smooth', block: 'start' });
      markNav('live');
      return;
    }
    App.openLayer(name);
  }
  window.addEventListener('hashchange', route);

  document.addEventListener('dwim:catalog', () => {
    if (App.pendingRoute) { App.pendingRoute = false; route(); return; }
    if (layer && !layer.hidden && !document.getElementById('watchModal')) App.rerender();
  });

  /* ---------- keyboard + D-pad / TV remote ---------- */
  function typing(e) { const t = e.target; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }

  function focusables(root) {
    return $$('button:not([disabled]), a[href], input:not([type="hidden"]), select, [tabindex="0"]', root).filter(el => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const st = getComputedStyle(el); return st.visibility !== 'hidden';
    });
  }
  function dpad(dir, root) {
    const list = focusables(root); if (!list.length) return false;
    const cur = document.activeElement;
    if (!cur || !root.contains(cur) || cur === document.body) { list[0].focus(); return true; }
    const cr = cur.getBoundingClientRect(), cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    let best = null, bestScore = Infinity;
    list.forEach(el => {
      if (el === cur) return;
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const dx = x - cx, dy = y - cy;
      let main, cross;
      if (dir === 'ArrowRight') { main = dx; cross = Math.abs(dy); }
      else if (dir === 'ArrowLeft') { main = -dx; cross = Math.abs(dy); }
      else if (dir === 'ArrowDown') { main = dy; cross = Math.abs(dx); }
      else { main = -dy; cross = Math.abs(dx); }
      if (main <= 4) return;
      const score = main + cross * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    if (best) { best.focus(); best.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return true; }
    return false;
  }

  function helpHTML() {
    const rows = [['L', 'Live TV'], ['G', 'TV Guide'], ['O', 'On Demand'], ['S or /', 'Search'], ['+', 'Save the selected video to My List'], ['M', 'Mute / unmute'], ['F', 'Fullscreen'], ['T', 'TV mode (big screen)'], ['Arrow keys', 'Move around (TV remote friendly)'], ['Esc', 'Close / go back'], ['?', 'This help']];
    return `<div class="help-card" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"><h3>Keyboard &amp; remote</h3><dl>${rows.map(r => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join('')}</dl><button type="button" class="btn-gold" data-close-help>Close</button></div>`;
  }
  App.toggleHelp = () => {
    let h = $('#helpOverlay');
    if (h) { h.remove(); return; }
    h = document.createElement('div'); h.id = 'helpOverlay'; h.className = 'help-overlay'; h.innerHTML = helpHTML();
    h.addEventListener('click', (e) => { if (e.target === h || e.target.hasAttribute('data-close-help')) h.remove(); });
    document.body.appendChild(h); $('button', h).focus();
  };

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const wm = document.getElementById('watchModal');
    const help = $('#helpOverlay');
    if (k === 'Escape' || k === 'BrowserBack' || k === 'GoBack' || (k === 'Backspace' && !typing(e) && document.body.classList.contains('tvmode'))) {
      if (help) { help.remove(); e.preventDefault(); return; }
      if (wm) { App.closeVideo(); e.preventDefault(); return; }
      if (layer && !layer.hidden) { e.preventDefault(); App.go('#/live'); return; }
      if (document.body.classList.contains('tvmode') && App.exitTvMode) { App.exitTvMode(); e.preventDefault(); }
      return;
    }
    if (help) return;
    if (typing(e)) return;
    const root = wm || (layer && !layer.hidden ? layer : null) || (document.body.classList.contains('tvmode') ? $('#tvMenu') : null);
    if (/^Arrow/.test(k) && root) {
      if (document.body.classList.contains('tvmode') && !wm && (!layer || layer.hidden) && (typeof TV !== 'undefined' && TV) && (k === 'ArrowUp' || k === 'ArrowDown')) {
        e.preventDefault(); TV.setVolume(TV.info().volume + (k === 'ArrowUp' ? 10 : -10)); App.pingTvUi && App.pingTvUi(); return;
      }
      if (dpad(k, root)) { e.preventDefault(); App.pingTvUi && App.pingTvUi(); }
      return;
    }
    const lk = k.length === 1 ? k.toLowerCase() : k;
    if (lk === 'g') { e.preventDefault(); App.go('#/guide'); }
    else if (lk === 'o') { e.preventDefault(); App.go('#/ondemand'); }
    else if (lk === 'l') { e.preventDefault(); App.go('#/live'); }
    else if (lk === 'm' && (typeof TV !== 'undefined' && TV) && !wm) { e.preventDefault(); TV.toggleMute(); }
    else if (lk === 'f' && (typeof TV !== 'undefined' && TV) && !wm && (!layer || layer.hidden)) { e.preventDefault(); TV.fullscreen(); }
    else if (lk === 't' && App.toggleTvMode) { e.preventDefault(); App.toggleTvMode(); }
    else if ((lk === '+' || lk === '=') && document.activeElement) {
      const card = document.activeElement.closest && document.activeElement.closest('[data-open]');
      if (card) { e.preventDefault(); const fb = card.querySelector('[data-fav]'); if (fb) fb.click(); }
    }
    else if (lk === 's' || lk === '/') { const s = $('#search'); if (s) { e.preventDefault(); s.focus(); s.select(); } }
    else if (lk === '?') { e.preventDefault(); App.toggleHelp(); }
  });

  /* thumbnails that fail to load fall back to a branded tile */
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.hasAttribute('data-thumb')) {
      const chain = (t.getAttribute('data-fallback') || '').split('|').filter(Boolean);
      const i = +(t.dataset.fb || 0);
      if (i < chain.length) { t.dataset.fb = String(i + 1); t.src = chain[i]; return; }
      t.removeAttribute('data-thumb'); t.src = '/img/logo-192.png'; t.classList.add('thumb-fallback');
    }
  }, true);

  document.addEventListener('DOMContentLoaded', route);
  if (document.readyState !== 'loading') setTimeout(route, 0);
})();
