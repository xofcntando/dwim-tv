/* ==========================================================
   DWIM TV Player — custom, self-contained player for our own
   videos (MP4 / WebM direct links and HLS .m3u8 streams).
   No third-party branding. Exposes: DwimPlayer.mount(el, opts)
   ========================================================== */
(function () {
  const ICON = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
    vol: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/></svg>',
    fs: '<svg viewBox="0 0 24 24"><path d="M5 5h5v2H7v3H5zm9 0h5v5h-2V7h-3zM5 14h2v3h3v2H5zm12 0h2v5h-5v-2h3z"/></svg>',
    fsx: '<svg viewBox="0 0 24 24"><path d="M8 5h2v5H5V8h3zm6 0h2v3h3v2h-5zM5 14h5v5H8v-3H5zm9 0h5v2h-3v3h-2z"/></svg>',
    pip: '<svg viewBox="0 0 24 24"><path d="M19 7H5v10h14zm2-2v14H3V5zm-9 7h7v5h-7z" fill-rule="evenodd"/></svg>',
    cog: '<svg viewBox="0 0 24 24"><path d="M19.4 13a7.7 7.7 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.7 7.7 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1L11 21h4l.4-2.9c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/><text x="12" y="16" font-size="6.5" text-anchor="middle" fill="#000" font-weight="700">10</text></svg>',
    fwd: '<svg viewBox="0 0 24 24"><path d="M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/><text x="12" y="16" font-size="6.5" text-anchor="middle" fill="#000" font-weight="700">10</text></svg>',
    live: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/></svg>'
  };

  let hlsLoader = null;
  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (hlsLoader) return hlsLoader;
    hlsLoader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/hls.min.js';
      s.onload = () => resolve(window.Hls);
      s.onerror = () => reject(new Error('Could not load stream engine'));
      document.head.appendChild(s);
    });
    return hlsLoader;
  }

  function fmt(t) {
    if (!isFinite(t) || t < 0) return '0:00';
    t = Math.floor(t);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }

  function mount(host, opts) {
    opts = opts || {};
    const src = opts.src;
    const isHls = opts.type === 'hls' || /\.m3u8(\?|$)/i.test(src || '');
    const isLive = !!opts.live;
    const resumeKey = opts.resumeKey ? 'dwimtv:pos:' + opts.resumeKey : null;

    host.classList.add('dp');
    host.innerHTML = `
      <video class="dp-video" playsinline preload="metadata" ${opts.poster ? `poster="${opts.poster.replace(/"/g, '&quot;')}"` : ''}></video>
      <div class="dp-brand"><span class="dp-brand-logo"></span><span class="dp-brand-text">DWIM <b>TV</b></span></div>
      <div class="dp-spinner" hidden></div>
      <div class="dp-error" hidden></div>
      <button class="dp-bigplay" type="button" aria-label="Play">${ICON.play}</button>
      <div class="dp-skip dp-skip-l" hidden>&#9664;&#9664; 10s</div>
      <div class="dp-skip dp-skip-r" hidden>10s &#9654;&#9654;</div>
      <div class="dp-controls">
        <div class="dp-seek" ${isLive ? 'hidden' : ''}>
          <div class="dp-buf"></div><div class="dp-prog"></div><div class="dp-knob"></div>
          <div class="dp-tip" hidden>0:00</div>
        </div>
        <div class="dp-row">
          <button type="button" class="dp-btn dp-pp" aria-label="Play/Pause">${ICON.play}</button>
          <button type="button" class="dp-btn dp-b10" aria-label="Back 10 seconds" ${isLive ? 'hidden' : ''}>${ICON.back}</button>
          <button type="button" class="dp-btn dp-f10" aria-label="Forward 10 seconds" ${isLive ? 'hidden' : ''}>${ICON.fwd}</button>
          <button type="button" class="dp-btn dp-mute" aria-label="Mute">${ICON.vol}</button>
          <input class="dp-vol" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume">
          <span class="dp-time">${isLive ? '<span class="dp-livepill">&#9679; LIVE</span>' : '0:00 / 0:00'}</span>
          <span class="dp-spacer"></span>
          <div class="dp-menuwrap">
            <button type="button" class="dp-btn dp-cog" aria-label="Settings">${ICON.cog}</button>
            <div class="dp-menu" hidden></div>
          </div>
          <button type="button" class="dp-btn dp-pip" aria-label="Picture in picture">${ICON.pip}</button>
          <button type="button" class="dp-btn dp-full" aria-label="Fullscreen">${ICON.fs}</button>
        </div>
      </div>`;

    const $ = (s) => host.querySelector(s);
    const video = $('.dp-video'), controls = $('.dp-controls');
    const seek = $('.dp-seek'), prog = $('.dp-prog'), buf = $('.dp-buf'), knob = $('.dp-knob'), tip = $('.dp-tip');
    const ppBtn = $('.dp-pp'), bigPlay = $('.dp-bigplay'), muteBtn = $('.dp-mute'), vol = $('.dp-vol');
    const timeEl = $('.dp-time'), spinner = $('.dp-spinner'), errEl = $('.dp-error');
    const menu = $('.dp-menu'), cog = $('.dp-cog'), fsBtn = $('.dp-full'), pipBtn = $('.dp-pip');
    let hls = null, hideT = null, levels = [], curLevel = -1, speed = 1, menuView = 'main';

    if (!document.pictureInPictureEnabled) pipBtn.hidden = true;

    function showError(msg) {
      errEl.hidden = false;
      errEl.innerHTML = '<div>&#9888;&#65039; ' + msg + '</div>';
      spinner.hidden = true; bigPlay.hidden = true;
    }

    /* ----- load source ----- */
    if (!src) {
      showError('This video has no source yet.');
    } else if (isHls) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src; // Safari / iOS native HLS
      } else {
        loadHls().then((Hls) => {
          if (!Hls || !Hls.isSupported()) return showError('Your browser cannot play this stream.');
          hls = new Hls({ enableWorker: true, lowLatencyMode: isLive });
          hls.loadSource(src);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, (_e, d) => {
            levels = d.levels.map((l, i) => ({ i, h: l.height })).filter(l => l.h);
            if (opts.autoplay) video.play().catch(() => {});
          });
          hls.on(Hls.Events.ERROR, (_e, d) => {
            if (!d.fatal) return;
            if (d.type === Hls.ErrorTypes.NETWORK_ERROR) { hls.startLoad(); }
            else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); }
            else showError('This stream is unavailable right now.');
          });
        }).catch((e) => showError(e.message));
      }
    } else {
      video.src = src;
    }

    video.addEventListener('error', () => {
      if (!hls) showError('This video could not be loaded. Please check the link or try again later.');
    });

    /* ----- resume where you left off ----- */
    if (resumeKey && !isLive) {
      video.addEventListener('loadedmetadata', () => {
        const p = parseFloat(localStorage.getItem(resumeKey) || '0');
        if (p > 5 && p < video.duration - 10) video.currentTime = p;
      }, { once: true });
      let lastSave = 0;
      video.addEventListener('timeupdate', () => {
        const n = Date.now();
        if (n - lastSave > 3000) { lastSave = n; try { localStorage.setItem(resumeKey, String(video.currentTime)); } catch (e) {} }
      });
      video.addEventListener('ended', () => { try { localStorage.removeItem(resumeKey); } catch (e) {} });
    }

    /* ----- play / pause ----- */
    function toggle() { video.paused ? video.play().catch(() => {}) : video.pause(); }
    function syncPlay() {
      const playing = !video.paused && !video.ended;
      ppBtn.innerHTML = playing ? ICON.pause : ICON.play;
      host.classList.toggle('dp-playing', playing);
      bigPlay.hidden = playing || !!errEl.offsetParent;
      if (playing) kickHide(); else showControls();
    }
    video.addEventListener('play', syncPlay);
    video.addEventListener('pause', syncPlay);
    video.addEventListener('ended', syncPlay);
    ppBtn.onclick = toggle;
    bigPlay.onclick = toggle;

    /* ----- click video: toggle (desktop) / double-click fullscreen / double-tap skip (touch) ----- */
    let lastTap = 0, tapTimer = null;
    video.addEventListener('click', (e) => {
      const now = Date.now();
      const rect = video.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      if (now - lastTap < 300) {
        clearTimeout(tapTimer); lastTap = 0;
        if (!isLive && (x < 0.33 || x > 0.67)) { skip(x < 0.5 ? -10 : 10); } else toggleFs();
      } else {
        lastTap = now;
        tapTimer = setTimeout(() => { toggle(); }, 260);
      }
    });

    function skip(d) {
      if (isLive) return;
      video.currentTime = Math.max(0, Math.min((video.duration || 1e9), video.currentTime + d));
      const el = $(d < 0 ? '.dp-skip-l' : '.dp-skip-r');
      el.hidden = false; setTimeout(() => (el.hidden = true), 550);
    }
    $('.dp-b10').onclick = () => skip(-10);
    $('.dp-f10').onclick = () => skip(10);

    /* ----- progress ----- */
    function updTime() {
      const d = video.duration;
      if (!isLive && isFinite(d) && d > 0) {
        const pct = (video.currentTime / d) * 100;
        prog.style.width = pct + '%'; knob.style.left = pct + '%';
        timeEl.textContent = fmt(video.currentTime) + ' / ' + fmt(d);
      }
    }
    function updBuf() {
      const d = video.duration;
      if (!isFinite(d) || !d || !video.buffered.length) return;
      buf.style.width = (video.buffered.end(video.buffered.length - 1) / d) * 100 + '%';
    }
    video.addEventListener('timeupdate', updTime);
    video.addEventListener('durationchange', updTime);
    video.addEventListener('progress', updBuf);
    video.addEventListener('waiting', () => (spinner.hidden = false));
    ['playing', 'canplay', 'seeked'].forEach(ev => video.addEventListener(ev, () => (spinner.hidden = true)));

    function seekTo(clientX) {
      const r = seek.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      if (isFinite(video.duration)) video.currentTime = p * video.duration;
    }
    let dragging = false;
    seek.addEventListener('pointerdown', (e) => { dragging = true; seek.setPointerCapture(e.pointerId); seekTo(e.clientX); });
    seek.addEventListener('pointermove', (e) => {
      const r = seek.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      tip.hidden = false; tip.style.left = p * 100 + '%'; tip.textContent = fmt(p * (video.duration || 0));
      if (dragging) seekTo(e.clientX);
    });
    seek.addEventListener('pointerup', () => (dragging = false));
    seek.addEventListener('pointerleave', () => (tip.hidden = true));

    /* ----- volume ----- */
    function syncVol() {
      muteBtn.innerHTML = (video.muted || video.volume === 0) ? ICON.mute : ICON.vol;
      vol.value = video.muted ? 0 : video.volume;
    }
    muteBtn.onclick = () => { video.muted = !video.muted; syncVol(); };
    vol.oninput = () => { video.volume = +vol.value; video.muted = +vol.value === 0; syncVol(); };
    video.addEventListener('volumechange', syncVol);

    /* ----- fullscreen / pip ----- */
    function toggleFs() {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else if (host.requestFullscreen) host.requestFullscreen();
      else if (host.webkitRequestFullscreen) host.webkitRequestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen(); // iPhone
    }
    fsBtn.onclick = toggleFs;
    const onFs = () => { fsBtn.innerHTML = (document.fullscreenElement === host) ? ICON.fsx : ICON.fs; };
    document.addEventListener('fullscreenchange', onFs);
    pipBtn.onclick = () => {
      if (document.pictureInPictureElement) document.exitPictureInPicture();
      else video.requestPictureInPicture && video.requestPictureInPicture().catch(() => {});
    };

    /* ----- settings menu: speed + quality ----- */
    function renderMenu() {
      const row = (label, val, act, on) =>
        `<button type="button" class="dp-mi ${on ? 'on' : ''}" data-act="${act}">${label}<span>${val || ''}</span></button>`;
      if (menuView === 'main') {
        menu.innerHTML =
          (isLive ? '' : row('Speed', speed === 1 ? 'Normal' : speed + 'x', 'speed')) +
          (levels.length ? row('Quality', curLevel < 0 ? 'Auto' : levels.find(l => l.i === curLevel).h + 'p', 'quality') : '') ||
          '<div class="dp-mi" style="opacity:.7">No options</div>';
      } else if (menuView === 'speed') {
        menu.innerHTML = row('&lsaquo; Speed', '', 'main') +
          [0.5, 0.75, 1, 1.25, 1.5, 2].map(s => row(s === 1 ? 'Normal' : s + 'x', '', 'sp:' + s, s === speed)).join('');
      } else if (menuView === 'quality') {
        menu.innerHTML = row('&lsaquo; Quality', '', 'main') + row('Auto', '', 'q:-1', curLevel < 0) +
          levels.slice().sort((a, b) => b.h - a.h).map(l => row(l.h + 'p', '', 'q:' + l.i, l.i === curLevel)).join('');
      }
    }
    cog.onclick = (e) => { e.stopPropagation(); menuView = 'main'; renderMenu(); menu.hidden = !menu.hidden; };
    menu.onclick = (e) => {
      e.stopPropagation();
      const b = e.target.closest('.dp-mi'); if (!b) return;
      const a = b.dataset.act;
      if (a === 'speed' || a === 'quality' || a === 'main') { menuView = a; renderMenu(); }
      else if (a.startsWith('sp:')) { speed = +a.slice(3); video.playbackRate = speed; menu.hidden = true; }
      else if (a.startsWith('q:')) { curLevel = +a.slice(2); if (hls) hls.currentLevel = curLevel; menu.hidden = true; }
    };
    host.addEventListener('click', (e) => { if (!menu.contains(e.target) && e.target !== cog) menu.hidden = true; });

    /* ----- auto-hide controls ----- */
    function showControls() { host.classList.add('dp-show'); clearTimeout(hideT); }
    function kickHide() {
      showControls();
      hideT = setTimeout(() => { if (!video.paused && menu.hidden) host.classList.remove('dp-show'); }, 2800);
    }
    host.addEventListener('mousemove', kickHide);
    host.addEventListener('touchstart', kickHide, { passive: true });
    host.addEventListener('mouseleave', () => { if (!video.paused) host.classList.remove('dp-show'); });
    showControls();

    /* ----- keyboard (when player is focused / hovered) ----- */
    host.tabIndex = 0;
    host.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key;
      if (k === ' ' || k === 'k') { e.preventDefault(); toggle(); }
      else if (k === 'ArrowLeft') { e.preventDefault(); skip(-10); }
      else if (k === 'ArrowRight') { e.preventDefault(); skip(10); }
      else if (k === 'ArrowUp') { e.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); }
      else if (k === 'ArrowDown') { e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); }
      else if (k === 'm') { video.muted = !video.muted; }
      else if (k === 'f') { toggleFs(); }
      kickHide();
    });

    if (opts.autoplay) video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
    syncVol(); syncPlay();

    return {
      destroy() {
        document.removeEventListener('fullscreenchange', onFs);
        clearTimeout(hideT);
        try { video.pause(); } catch (e) {}
        if (hls) hls.destroy();
        video.removeAttribute('src'); video.load();
        host.innerHTML = ''; host.classList.remove('dp', 'dp-playing', 'dp-show');
      }
    };
  }

  window.DwimPlayer = { mount };
})();
