/* ==========================================================
   DWIM TV channel - plays the catalog one video after another,
   forever, like a TV station. Viewers cannot pick or skip videos.
   ========================================================== */
const TV = (function () {
  let queue = [], idx = 0, yt = null, own = null, ytReady = null, tickT = null, stuckT = null;
  let started = false, paused = false, errStreak = 0, muted = true, nowId = null, lowerT = null;
  let cat = null, curToken = null, watchT = null, uiT = null, cur = null;
  const KEY = 'dwimtv:tv:last';

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function ytIdOf(u) { const m = String(u).match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/); return m ? m[1] : null; }

  function buildQueue(catalog) {
    return (catalog.videos || [])
      .filter(v => v.source && (v.type === 'youtube' ? ytIdOf(v.source) : (v.type === 'direct' || v.type === 'hls')))
      .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
  }

  function loadYT() {
    if (ytReady) return ytReady;
    ytReady = new Promise((resolve) => {
      if (window.YT && window.YT.Player) return resolve();
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
    return ytReady;
  }

  function stageHTML() {
    return `
      <section class="tv-section" id="watch">
        <div class="tv-head"><span class="tv-onair"><span class="pulse"></span> DWIM TV</span><h2>Now Showing</h2></div>
        <div class="tv-stage" id="tvStage">
          <div id="tvPlayer"></div>
          <div class="tv-shield" id="tvShield"></div>
          <div class="tv-brand"><i></i><span>DWIM <b>TV</b></span></div>
          <div class="tv-btns">
            <button type="button" class="tv-btn" id="tvSound">&#128266; Tap for sound</button>
            <button type="button" class="tv-btn" id="tvFull">&#9974; Fullscreen</button>
          </div>
          <div class="tv-lower" id="tvLower"><small id="tvCat">Now playing</small><strong id="tvTitle">&nbsp;</strong><em id="tvNext"></em></div>
        </div>
        <p class="tv-note">DWIM TV plays sermons, prayers and worship around the clock. Sit back and be blessed.</p>
        <div class="tv-sched" id="tvSched" hidden></div>
      </section>`;
  }

  function mount(catalog) {
    cat = catalog;
    const sched = !!(catalog.schedule && DwimSchedule.resolve(catalog, Date.now()));
    const main = el('main');
    const newQ = buildQueue(catalog);
    if (started && el('tvStage')) { // catalog refreshed while playing: keep playing, just update the data
      const curV = queue[idx];
      queue = newQ;
      const k = curV ? queue.findIndex(v => v.id === curV.id) : -1;
      idx = k >= 0 ? k : Math.min(idx, Math.max(queue.length - 1, 0));
      renderSchedule();
      return;
    }
    queue = newQ;
    main.innerHTML = stageHTML();
    el('tvSound').onclick = unmute;
    el('tvFull').onclick = fullscreen;
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !paused) { sync(false); nudge(); } });
    if (!queue.length) { el('tvTitle').textContent = 'New messages are coming soon'; return; }
    started = true;
    if (sched) {
      // Scheduled programming: what is on air is decided by the clock (Zimbabwe time), the same for everyone
      renderSchedule();
      clearInterval(watchT); watchT = setInterval(() => { if (!paused) sync(false); }, 5000);
      clearInterval(uiT); uiT = setInterval(renderSchedule, 30000);
      sync(true);
      return;
    }
    let last = null; try { last = localStorage.getItem(KEY); } catch (e) {}
    const k = queue.findIndex(v => v.id === last);
    idx = k >= 0 ? (k + 1) % queue.length : 0; // no schedule: continue after the last one this device watched
    play(idx);
  }

  /* ---- scheduled mode ---- */
  function scheduleOn() { return !!(cat && cat.schedule && cur); }

  // Compare what should be on air now with what is playing; switch if a slot changed
  function sync(force) {
    if (!cat) return;
    const r = DwimSchedule.resolve(cat, Date.now());
    if (!r) return;
    if (force || r.token !== curToken || !cur) startItem(r, r.offset < 15 ? 0 : r.offset);
  }

  function startItem(r, offset) {
    curToken = r.token;
    cur = { video: r.video, kind: r.kind, block: r.block };
    playVideo(r.video, offset, r);
    renderSchedule();
  }

  // The video ended (or failed): continue the programme
  function advance(fromError) {
    if (!scheduleOn()) return next(fromError);
    if (fromError) { errStreak++; if (errStreak > 6) { setTimeout(() => { errStreak = 0; advance(false); }, 30000); return; } } else errStreak = 0;
    const endedId = cur.video.id;
    const r = DwimSchedule.resolve(cat, Date.now());
    if (!r) return next(fromError);
    if (r.kind === 'signature' && r.video.id === endedId) { // signature song ended a moment early: move on to the block
      const r2 = DwimSchedule.resolve(cat, Date.now() + (r.remaining + 1) * 1000);
      if (r2) { startItem(r2, r2.offset < 20 ? 0 : r2.offset); return; }
    }
    if (r.token === curToken && r.video.id === endedId && r.playlist) {
      // clock says it is still the same item (ended a few seconds early): next playlist entry
      const j = (r.index + 1) % r.playlist.length; r.video = r.playlist[j]; r.index = j; r.offset = 0;
    }
    startItem(r, r.offset < 20 ? 0 : r.offset);
  }

  function showLower(v, r) {
    if (r && cat && cat.schedule) {
      const sig = r.kind === 'signature';
      el('tvTitle').textContent = v.title || '';
      el('tvCat').textContent = (r.block ? r.block.icon + ' ' + r.block.name : 'Now playing') + (sig ? ' · Let It Rain' : '');
      const up = DwimSchedule.upNext(cat, r, Date.now());
      el('tvNext').textContent = up ? 'Up next: ' + up.title + (up.atBoundary && up.block ? ' · ' + up.block.name : '') : '';
    } else {
      el('tvTitle').textContent = v.title || '';
      el('tvCat').textContent = v.category || 'Now playing';
      const nx = queue[(idx + 1) % queue.length];
      el('tvNext').textContent = queue.length > 1 && nx ? 'Up next: ' + nx.title : '';
    }
    const low = el('tvLower'); low.classList.remove('hide');
    clearTimeout(lowerT); lowerT = setTimeout(() => low.classList.add('hide'), 9000);
  }

  /* ---- Today's programme panel ---- */
  function fmtT(ms, tz) { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(new Date(ms)); }
  function renderSchedule() {
    const box = el('tvSched'); if (!box || !cat || !cat.schedule) return;
    const sc = cat.schedule, tz = sc.timezone || 'Africa/Harare', now = Date.now();
    const grid = DwimSchedule.dayGrid(cat, now);
    if (!grid.length) return;
    const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const showLocal = localTz && fmtT(now, tz) !== fmtT(now, localTz);
    const rows = grid.map(g => {
      const on = now >= g.startMs && now < g.endMs;
      const end = fmtT(g.endMs, tz);
      const t = fmtT(g.startMs, tz) + ' - ' + (end === '00:00' ? '24:00' : end);
      const lt = showLocal ? ' <em>(' + fmtT(g.startMs, localTz) + ' your time)</em>' : '';
      return '<li class="' + (on ? 'on' : '') + '"><span class="ts-ic">' + esc(g.block.icon || '') + '</span><div><b>' + esc(g.block.name) + (on ? ' <i>ON NOW</i>' : '') + '</b><small>' + t + lt + '</small>' +
        (g.block.desc ? '<p>' + esc(g.block.desc) + '</p>' : '') + '</div></li>';
    }).join('');
    let sig = '';
    if (sc.signature) {
      const times = DwimSchedule.signatureTimes(cat, now).map(ms => fmtT(ms, tz) + (showLocal ? ' (' + fmtT(ms, localTz) + ')' : '')).join(' · ');
      sig = '<div class="ts-sig">&#127783; <b>' + esc(sc.signature.label || 'Signature song') + '</b> plays every day at ' + times + '</div>';
    }
    box.innerHTML = '<h3>&#128197; Today on DWIM TV</h3>' + sig + '<ul>' + rows + '</ul><p class="ts-note">' + esc(sc.note || 'Times are Zimbabwe time (CAT).') + '</p>';
    box.hidden = false;
  }

  function clearTimers() { clearInterval(tickT); clearTimeout(stuckT); }

  function destroyCurrent() {
    clearTimers();
    if (yt) { try { yt.destroy(); } catch (e) {} yt = null; }
    if (own) { try { own.destroy(); } catch (e) {} own = null; }
    const stage = el('tvStage');
    if (stage) { const old = el('tvPlayer'); if (old) old.remove(); const d = document.createElement('div'); d.id = 'tvPlayer'; stage.insertBefore(d, stage.firstChild); }
  }

  function next(fromError) {
    if (fromError) { errStreak++; if (errStreak > Math.max(queue.length, 3)) { setTimeout(() => { errStreak = 0; next(false); }, 30000); return; } }
    else errStreak = 0;
    idx = (idx + 1) % queue.length;
    play(idx);
  }

  function play(i) {
    if (!queue.length) return;
    const v = queue[i];
    try { localStorage.setItem(KEY, v.id); } catch (e) {}
    cur = null; curToken = null;
    playVideo(v, v.t ? Math.floor(v.t) : 0, null);
  }

  async function playVideo(v, startAt, r) {
    nowId = v.id;
    destroyCurrent();
    showLower(v, r);
    // if nothing starts within 20s (blocked / unavailable), move on
    stuckT = setTimeout(() => { if (nowId === v.id) advance(true); }, 20000);

    if (v.type === 'youtube') {
      await loadYT();
      if (nowId !== v.id) return;
      const t = Math.floor(startAt || 0);
      yt = new YT.Player('tvPlayer', {
        host: 'https://www.youtube-nocookie.com',
        videoId: ytIdOf(v.source),
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, modestbranding: 1, playsinline: 1, mute: muted ? 1 : 0, start: t, origin: location.origin },
        events: {
          onReady: (e) => { if (muted) e.target.mute(); else e.target.unMute(); e.target.playVideo(); },
          onStateChange: (e) => {
            if (nowId !== v.id) return;
            if (e.data === YT.PlayerState.PLAYING) { clearTimeout(stuckT); errStreak = 0; startTick(); updSoundBtn(); }
            else if (e.data === YT.PlayerState.ENDED) advance(false);
            else if (e.data === YT.PlayerState.PAUSED && !paused) { try { yt.playVideo(); } catch (er) {} }
          },
          onError: () => { if (nowId === v.id) advance(true); }
        }
      });
    } else {
      own = DwimPlayer.mount(el('tvPlayer'), {
        src: v.source, type: v.type, autoplay: true, bare: true, muted,
        onended: () => { if (nowId === v.id) advance(false); },
        onerror: () => { if (nowId === v.id) advance(true); }
      });
      own.video.addEventListener('playing', () => { clearTimeout(stuckT); errStreak = 0; updSoundBtn(); }, { once: true });
    }
  }

  // advance just before the video ends so YouTube's end-screen suggestions never show
  function startTick() {
    clearInterval(tickT);
    tickT = setInterval(() => {
      if (!yt || !yt.getDuration) return;
      const d = yt.getDuration(), c = yt.getCurrentTime();
      if (d > 5 && d - c < 0.7) advance(false);
    }, 400);
  }

  function updSoundBtn() { el('tvSound').hidden = !muted; }
  function unmute() {
    muted = false;
    try { if (yt) { yt.unMute(); yt.setVolume(100); } } catch (e) {}
    if (own) own.video.muted = false;
    updSoundBtn();
  }
  function fullscreen() {
    const s = el('tvStage');
    if (document.fullscreenElement) document.exitFullscreen();
    else (s.requestFullscreen || s.webkitRequestFullscreen).call(s);
  }
  function nudge() { try { if (yt && yt.getPlayerState() !== 1) yt.playVideo(); if (own && own.video.paused) own.video.play(); } catch (e) {} }
  function pause() { paused = true; try { if (yt) yt.pauseVideo(); if (own) own.video.pause(); } catch (e) {} }
  function resume() { paused = false; if (scheduleOn()) sync(false); nudge(); }

  return { mount, pause, resume };
})();
