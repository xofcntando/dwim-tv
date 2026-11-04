/* ==========================================================
   DWIM TV app shell - live TV extras: control bar, volume, sleep
   timer, viewers, TV mode, events, verse of the day, notices,
   media session and update notice.
   ========================================================== */
(function () {
  'use strict';
  const App = window.DwimApp;
  const { $, $$, esc } = App;

  /* ---------- Live control bar ---------- */
  let sleepEnd = 0, sleepT = null, sleepLabelT = null, sid = null;

  function ensureLiveBar() {
    if ($('#liveBar')) return;
    const stage = $('#tvStage'); if (!stage) return;
    const bar = document.createElement('div');
    bar.id = 'liveBar'; bar.className = 'livebar';
    bar.innerHTML = `
      <div class="lb-vol"><button type="button" id="lbMute" aria-label="Mute or unmute">&#128266;</button>
        <input type="range" id="lbVol" min="0" max="100" step="5" value="100" aria-label="Volume"></div>
      <div class="lb-now"><small id="lbCat">Now playing</small><b id="lbTitle">DWIM TV</b></div>
      <span class="lb-watch" id="lbWatch" hidden><i></i><span></span></span>
      <div class="lb-actions">
        <button type="button" id="lbSave" aria-pressed="false" title="Save to My List">&#9825; <span>Save</span></button>
        <button type="button" id="lbFromStart" title="Watch this video from the beginning">&#9198; <span>From start</span></button>
        <label class="lb-sleep" title="Sleep timer"><span aria-hidden="true">&#128564;</span><select id="lbSleep" aria-label="Sleep timer"><option value="0">Sleep: off</option><option value="15">15 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="60">1 hour</option><option value="90">90 min</option></select></label>
        <button type="button" id="lbShare" title="Share DWIM TV">&#10150; <span>Share</span></button>
        <button type="button" id="lbTv" title="Big-screen TV mode (T)">&#128250; <span>TV mode</span></button>
      </div>`;
    stage.parentNode.insertBefore(bar, stage.nextSibling);

    $('#lbMute').onclick = () => TV.toggleMute();
    $('#lbVol').oninput = (e) => TV.setVolume(+e.target.value);
    $('#lbSave').onclick = () => { const i = TV.info(); if (!i.video) return; const on = App.toggleFav(i.video.id); App.toast(on ? 'Added to My List' : 'Removed from My List'); paintBar(); };
    $('#lbFromStart').onclick = () => { const i = TV.info(); if (i.video) { App.state.fromStart = true; App.openVideo(i.video.id); } };
    $('#lbShare').onclick = () => App.share('DWIM TV', 'Watch DWIM TV: sermons, worship and prayer, live 24/7. Distance is not a barrier!', location.origin);
    $('#lbTv').onclick = () => App.toggleTvMode();
    $('#lbSleep').onchange = (e) => setSleep(+e.target.value);
    paintBar();
  }

  function paintBar() {
    if (!(typeof TV !== 'undefined' && TV)) return;
    const i = TV.info(), v = i.video;
    const t = $('#lbTitle'); if (!t) return;
    t.textContent = v ? v.title : 'DWIM TV';
    $('#lbCat').textContent = i.block ? ((i.block.icon || '') + ' ' + i.block.name) : (v && v.category) || 'Now playing';
    const m = $('#lbMute'); const silent = i.muted || i.volume === 0;
    m.innerHTML = silent ? '&#128263;' : '&#128266;'; m.setAttribute('aria-pressed', String(silent));
    $('#lbVol').value = silent ? 0 : i.volume;
    const fav = v && App.isFav(v.id), sv = $('#lbSave');
    sv.setAttribute('aria-pressed', String(!!fav)); sv.innerHTML = (fav ? '&#10084; ' : '&#9825; ') + '<span>' + (fav ? 'Saved' : 'Save') + '</span>';
    sv.disabled = !v || v.channel === 'ch-breaks';
    const fs = $('#lbFromStart'); fs.hidden = !(v && v.type !== 'hls' && v.channel !== 'ch-breaks');
    if ((typeof TV !== 'undefined' && TV) && App.setMedia && v && !document.getElementById('watchModal')) App.setMedia(v, true);
    const tm = $('#tvmNow'); if (tm) tm.textContent = v ? v.title : '';
  }

  function setSleep(min) {
    clearTimeout(sleepT); clearInterval(sleepLabelT); sleepEnd = 0;
    const sel = $('#lbSleep');
    if (!min) { if (sel) sel.options[0].textContent = 'Sleep: off'; return; }
    sleepEnd = Date.now() + min * 60000;
    sleepT = setTimeout(() => {
      TV.pause(); sleepEnd = 0; if (sel) { sel.value = '0'; sel.options[0].textContent = 'Sleep: off'; }
      App.toast('Sleep timer ended. God bless you.', { label: 'Resume', fn: () => TV.resume() });
    }, min * 60000);
    const lab = () => { const left = Math.max(0, Math.ceil((sleepEnd - Date.now()) / 60000)); if (sel) sel.options[0].textContent = left ? `Sleeping in ${left}m` : 'Sleep: off'; };
    lab(); sleepLabelT = setInterval(lab, 20000);
    App.toast(`Sleep timer set for ${min} minutes`);
  }

  /* ---------- Viewers (presence) ---------- */
  function sessionId() {
    if (sid) return sid;
    try { sid = sessionStorage.getItem('dwimtv:sid'); } catch (e) { /* ignore */ }
    if (!sid) { sid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, '').slice(0, 24); try { sessionStorage.setItem('dwimtv:sid', sid); } catch (e) { /* ignore */ } }
    return sid;
  }
  async function beat() {
    if (document.hidden) return;
    try {
      const r = await fetch('/api/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: sessionId() }) });
      if (!r.ok) return; const j = await r.json();
      const w = $('#lbWatch'); if (!w) return;
      if (j.watching > 0) { w.hidden = false; $('span', w).textContent = `${j.watching} watching now`; }
    } catch (e) { /* offline */ }
  }
  setInterval(beat, 45000);

  /* ---------- TV mode (big screen / smart TV) ---------- */
  let tvUiT = null;
  function ensureTvMenu() {
    let m = $('#tvMenu'); if (m) return m;
    m = document.createElement('nav'); m.id = 'tvMenu'; m.className = 'tv-menu'; m.setAttribute('aria-label', 'TV menu');
    m.innerHTML = `<div class="tvm-now"><small>Now on DWIM TV</small><b id="tvmNow"></b></div>
      <div class="tvm-btns"><button type="button" data-go="#/live">&#128250; Live</button><button type="button" data-go="#/guide">&#128197; Guide</button><button type="button" data-go="#/ondemand">&#9654; On Demand</button><button type="button" data-go="#/mylist">&#10084; My List</button>
      <button type="button" data-tv="sound">&#128266; Sound</button><button type="button" data-tv="exit">&#10005; Exit TV mode</button></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => {
      const g = e.target.closest('[data-go]'); if (g) { App.go(g.dataset.go); return; }
      const t = e.target.closest('[data-tv]'); if (!t) return;
      if (t.dataset.tv === 'sound') { TV.toggleMute(); if (TV.isMuted() === false && TV.info().volume === 0) TV.setVolume(60); }
      else App.exitTvMode();
    });
    return m;
  }
  App.pingTvUi = () => {
    if (!document.body.classList.contains('tvmode')) return;
    document.body.classList.add('tvm-show');
    clearTimeout(tvUiT);
    tvUiT = setTimeout(() => { if (!(App.layerEl() && !App.layerEl().hidden)) document.body.classList.remove('tvm-show'); }, 7000);
  };
  App.toggleTvMode = () => document.body.classList.contains('tvmode') ? App.exitTvMode() : App.enterTvMode();
  App.enterTvMode = (noFs) => {
    if (!$('#tvStage')) { App.go('#/live'); return; }
    ensureTvMenu(); paintBar();
    document.body.classList.add('tvmode');
    App.pingTvUi();
    if (!noFs && !document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    const b = $('#tvMenu button'); if (b) b.focus();
  };
  App.exitTvMode = () => {
    document.body.classList.remove('tvmode', 'tvm-show');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  };
  ['mousemove', 'touchstart', 'pointerdown'].forEach(ev => document.addEventListener(ev, () => App.pingTvUi(), { passive: true }));

  /* ---------- Events, weekly services, verse of the day ---------- */
  const VERSES = [
    ['Thy word is a lamp unto my feet, and a light unto my path.', 'Psalm 119:105'], ['Call unto me, and I will answer thee, and shew thee great and mighty things, which thou knowest not.', 'Jeremiah 33:3'],
    ['I can do all things through Christ which strengtheneth me.', 'Philippians 4:13'], ['Fear thou not; for I am with thee: be not dismayed; for I am thy God: I will strengthen thee; yea, I will help thee.', 'Isaiah 41:10'],
    ['The LORD is my shepherd; I shall not want.', 'Psalm 23:1'], ['And we know that all things work together for good to them that love God, to them who are the called according to his purpose.', 'Romans 8:28'],
    ['Trust in the LORD with all thine heart; and lean not unto thine own understanding.', 'Proverbs 3:5'], ['For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.', 'John 3:16'],
    ['Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee whithersoever thou goest.', 'Joshua 1:9'], ['Come unto me, all ye that labour and are heavy laden, and I will give you rest.', 'Matthew 11:28'],
    ['God is our refuge and strength, a very present help in trouble.', 'Psalm 46:1'], ['They that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles.', 'Isaiah 40:31'],
    ['For God hath not given us the spirit of fear; but of power, and of love, and of a sound mind.', '2 Timothy 1:7'], ['The LORD is my light and my salvation; whom shall I fear?', 'Psalm 27:1'],
    ['What things soever ye desire, when ye pray, believe that ye receive them, and ye shall have them.', 'Mark 11:24'], ['The effectual fervent prayer of a righteous man availeth much.', 'James 5:16'],
    ['So then faith cometh by hearing, and hearing by the word of God.', 'Romans 10:17'], ['Now faith is the substance of things hoped for, the evidence of things not seen.', 'Hebrews 11:1'],
    ['He that dwelleth in the secret place of the most High shall abide under the shadow of the Almighty.', 'Psalm 91:1'], ['But my God shall supply all your need according to his riches in glory by Christ Jesus.', 'Philippians 4:19'],
    ['No weapon that is formed against thee shall prosper.', 'Isaiah 54:17'], ['For I know the thoughts that I think toward you, saith the LORD, thoughts of peace, and not of evil, to give you an expected end.', 'Jeremiah 29:11'],
    ['O taste and see that the LORD is good: blessed is the man that trusteth in him.', 'Psalm 34:8'], ['Now unto him that is able to do exceeding abundantly above all that we ask or think, according to the power that worketh in us.', 'Ephesians 3:20'],
    ['Greater is he that is in you, than he that is in the world.', '1 John 4:4'], ['But seek ye first the kingdom of God, and his righteousness; and all these things shall be added unto you.', 'Matthew 6:33'],
    ['Delight thyself also in the LORD; and he shall give thee the desires of thine heart.', 'Psalm 37:4'], ['And they overcame him by the blood of the Lamb, and by the word of their testimony.', 'Revelation 12:11'],
    ['If the Son therefore shall make you free, ye shall be free indeed.', 'John 8:36'], ['It is of the LORD\u2019S mercies that we are not consumed, because his compassions fail not.', 'Lamentations 3:22'],
    ['The LORD bless thee, and keep thee: The LORD make his face shine upon thee, and be gracious unto thee.', 'Numbers 6:24-25']
  ];
  function zoneDateStr(ms) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Harare', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); }
  function renderVerse() {
    const m = $('#verseCard'); if (!m) return;
    const d = zoneDateStr(Date.now()).split('-').map(Number);
    const day = Math.floor(Date.UTC(d[0], d[1] - 1, d[2]) / 86400000);
    const v = VERSES[day % VERSES.length];
    m.innerHTML = `<div class="verse-card"><span class="block-kicker gold-kicker">&#128214; Verse of the Day</span><blockquote>&ldquo;${esc(v[0])}&rdquo;</blockquote><cite>${esc(v[1])} (KJV)</cite>
      <button type="button" class="btn-outline-light" id="verseShare">&#10150; Share this verse</button></div>`;
    $('#verseShare').onclick = () => App.share('Verse of the Day', `\u201C${v[0]}\u201D ${v[1]} - DWIM TV`, location.origin);
  }

  function icsFor(ev) {
    const pad = (n) => String(n).padStart(2, '0');
    const [y, mo, d] = ev.date.split('-').map(Number);
    const stamp = (dt) => dt.getUTCFullYear() + pad(dt.getUTCMonth() + 1) + pad(dt.getUTCDate()) + 'T' + pad(dt.getUTCHours()) + pad(dt.getUTCMinutes()) + '00Z';
    let dt;
    if (ev.time) { const [h, mi] = ev.time.split(':').map(Number); dt = `DTSTART:${stamp(new Date(Date.UTC(y, mo - 1, d, h - 2, mi)))}\r\nDTEND:${stamp(new Date(Date.UTC(y, mo - 1, d, h - 2 + 2, mi)))}`; }
    else { const nx = new Date(Date.UTC(y, mo - 1, d + 1)); dt = `DTSTART;VALUE=DATE:${y}${pad(mo)}${pad(d)}\r\nDTEND;VALUE=DATE:${nx.getUTCFullYear()}${pad(nx.getUTCMonth() + 1)}${pad(nx.getUTCDate())}`; }
    const t = (s) => String(s || '').replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DWIM TV//Events//EN', 'BEGIN:VEVENT', `UID:${ev.date}-${ev.title.length}@dwimtv`, `DTSTAMP:${stamp(new Date())}`, dt, `SUMMARY:${t(ev.title)}`, `DESCRIPTION:${t(ev.desc || 'Destiny Word International Ministries')}`, `LOCATION:${t(ev.place || '')}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
  }
  function evDate(ev) {
    const [y, m, d] = ev.date.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12));
    return { mon: new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(dt).toUpperCase(), day: d, wd: new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(dt) };
  }
  function upcoming() {
    const today = zoneDateStr(Date.now());
    return (App.cat().events || []).filter(e => e.date >= today).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  }
  App.renderEvents = (box, max) => {
    if (!box) return;
    const list = upcoming().slice(0, max || 4);
    const services = ((App.cat().church || {}).services || []);
    const evHTML = list.map((e, i) => { const d = evDate(e); return `<article class="ev-card"><div class="ev-date"><small>${d.mon}</small><b>${d.day}</b></div><div class="ev-body"><h4>${esc(e.title)}</h4><p class="ev-when">${d.wd}${e.time ? ' &middot; ' + esc(e.time) + ' CAT' : ''}${e.place ? ' &middot; ' + esc(e.place) : ''}</p>${e.desc ? `<p>${esc(e.desc)}</p>` : ''}<button type="button" class="link-btn" data-ics="${i}">&#128197; Add to calendar</button></div></article>`; }).join('');
    const svHTML = services.length ? `<div class="ev-services"><h4>Every week</h4><ul>${services.map(s => `<li><b>${esc(s.name)}</b><span>${esc(s.time)}</span></li>`).join('')}</ul></div>` : '';
    box.innerHTML = `<div class="ev-wrap"><h3 class="sec-h">&#128197; Coming up</h3>${evHTML || '<p class="app-sub">No special events announced yet. Join us every week below.</p>'}${svHTML}</div>`;
    $$('[data-ics]', box).forEach(b => b.onclick = () => {
      const ev = list[+b.dataset.ics]; const blob = new Blob([icsFor(ev)], { type: 'text/calendar' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = ev.title.replace(/\W+/g, '-').toLowerCase() + '.ics'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
  };

  /* ---------- Announcement bar ---------- */
  function renderNotices() {
    const bar = $('#noticeBar'); if (!bar) return;
    const today = zoneDateStr(Date.now());
    let dismissed = []; try { dismissed = JSON.parse(sessionStorage.getItem('dwimtv:nd') || '[]'); } catch (e) { /* ignore */ }
    const list = (App.cat().announcements || []).filter(n => n.text && (!n.until || n.until >= today) && dismissed.indexOf(n.text) < 0);
    if (!list.length) { bar.hidden = true; return; }
    let i = 0;
    const paint = () => {
      const n = list[i % list.length];
      bar.innerHTML = `<span class="nb-ic">&#128226;</span>${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.text)}</a>` : `<span>${esc(n.text)}</span>`}<button type="button" aria-label="Dismiss announcement">&times;</button>`;
      $('button', bar).onclick = () => { dismissed.push(n.text); try { sessionStorage.setItem('dwimtv:nd', JSON.stringify(dismissed)); } catch (e) { /* ignore */ } renderNotices(); };
    };
    bar.hidden = false; paint();
    clearInterval(renderNotices.t);
    if (list.length > 1) renderNotices.t = setInterval(() => { i++; paint(); }, 7000);
  }

  /* ---------- wire up ---------- */
  function init() {
    renderVerse(); renderNotices();
    App.renderEvents($('#eventsMount'), 4);
    const evSec = $('#events'); if (evSec) evSec.hidden = false;
    ensureLiveBar(); paintBar();
  }
  document.addEventListener('dwim:catalog', () => { init(); setTimeout(init, 800); });
  document.addEventListener('dwim:favs', paintBar);
  if ((typeof TV !== 'undefined' && TV)) {
    TV.on((type) => {
      if (type === 'change') { ensureLiveBar(); beat(); }
      if (type === 'change' || type === 'volume' || type === 'playing' || type === 'pause' || type === 'resume') paintBar();
    });
  }

  // Media session controls for the live channel (headset / lock screen / TV remote keys)
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => { if ((typeof TV !== 'undefined' && TV)) { TV.resume(); if (TV.isMuted()) TV.toggleMute(); } });
      navigator.mediaSession.setActionHandler('pause', () => { if ((typeof TV !== 'undefined' && TV)) TV.toggleMute(); });
    } catch (e) { /* unsupported action */ }
  }

  // Smart-TV browsers and ?tv=1 open straight into TV mode
  const ua = navigator.userAgent || '';
  const isTvDevice = /SMART-TV|SmartTV|Tizen|Web0S|webOS|NetCast|AppleTV|BRAVIA|HbbTV|AFT[A-Z]|CrKey|Roku|Hisense|VIDAA/i.test(ua);
  document.addEventListener('dwim:catalog', function once() {
    document.removeEventListener('dwim:catalog', once);
    if (/[?&]tv=1/.test(location.search) || isTvDevice) setTimeout(() => App.enterTvMode(true), 1200);
  });

  // New version available
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing; if (!nw) return;
        nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) App.toast('A new version of DWIM TV is ready', { label: 'Refresh', fn: () => location.reload() }); });
      });
    }).catch(() => {});
  }
})();
