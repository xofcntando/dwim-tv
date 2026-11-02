/* ==========================================================
   DWIM TV channel - plays the catalog one video after another,
   forever, like a TV station. Viewers cannot pick or skip videos.
   ========================================================== */
const TV = (function () {
  let queue = [], idx = 0, yt = null, own = null, ytReady = null, tickT = null, stuckT = null;
  let started = false, paused = false, errStreak = 0, muted = true, nowId = null, lowerT = null;
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
      </section>`;
  }

  function mount(catalog) {
    const main = el('main');
    const newQ = buildQueue(catalog);
    if (started && el('tvStage')) { // catalog refreshed while playing: keep playing, just update the list
      const cur = queue[idx];
      queue = newQ;
      const k = cur ? queue.findIndex(v => v.id === cur.id) : -1;
      idx = k >= 0 ? k : Math.min(idx, Math.max(queue.length - 1, 0));
      return;
    }
    queue = newQ;
    main.innerHTML = stageHTML();
    el('tvSound').onclick = unmute;
    el('tvFull').onclick = fullscreen;
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !paused) nudge(); });
    if (!queue.length) { el('tvTitle').textContent = 'New messages are coming soon'; return; }
    let last = null; try { last = localStorage.getItem(KEY); } catch (e) {}
    const k = queue.findIndex(v => v.id === last);
    idx = k >= 0 ? (k + 1) % queue.length : 0; // continue after the last one this device watched
    started = true;
    play(idx);
  }

  function showLower(v) {
    el('tvTitle').textContent = v.title || '';
    el('tvCat').textContent = v.category || 'Now playing';
    const nx = queue[(idx + 1) % queue.length];
    el('tvNext').textContent = queue.length > 1 && nx ? 'Up next: ' + nx.title : '';
    const low = el('tvLower'); low.classList.remove('hide');
    clearTimeout(lowerT); lowerT = setTimeout(() => low.classList.add('hide'), 9000);
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

  async function play(i) {
    if (!queue.length) return;
    const v = queue[i];
    nowId = v.id;
    try { localStorage.setItem(KEY, v.id); } catch (e) {}
    destroyCurrent();
    showLower(v);
    // if nothing starts within 20s (blocked / unavailable), move on
    stuckT = setTimeout(() => { if (nowId === v.id) next(true); }, 20000);

    if (v.type === 'youtube') {
      await loadYT();
      if (nowId !== v.id) return;
      const t = v.t ? Math.floor(v.t) : 0;
      yt = new YT.Player('tvPlayer', {
        host: 'https://www.youtube-nocookie.com',
        videoId: ytIdOf(v.source),
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, modestbranding: 1, playsinline: 1, mute: muted ? 1 : 0, start: t, origin: location.origin },
        events: {
          onReady: (e) => { if (muted) e.target.mute(); else e.target.unMute(); e.target.playVideo(); },
          onStateChange: (e) => {
            if (nowId !== v.id) return;
            if (e.data === YT.PlayerState.PLAYING) { clearTimeout(stuckT); errStreak = 0; startTick(); updSoundBtn(); }
            else if (e.data === YT.PlayerState.ENDED) next(false);
            else if (e.data === YT.PlayerState.PAUSED && !paused) { try { yt.playVideo(); } catch (er) {} }
          },
          onError: () => { if (nowId === v.id) next(true); }
        }
      });
    } else {
      own = DwimPlayer.mount(el('tvPlayer'), {
        src: v.source, type: v.type, autoplay: true, bare: true, muted,
        onended: () => { if (nowId === v.id) next(false); },
        onerror: () => { if (nowId === v.id) next(true); }
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
      if (d > 5 && d - c < 0.7) next(false);
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
  function resume() { paused = false; nudge(); }

  return { mount, pause, resume };
})();
