/* ==========================================================
   DWIM TV - Songs & Playlists ("DWIM TV Best Songs" and more).
   Route: #/songs (all playlists) and #/songs/<playlistId>.
   Playing a playlist sets a queue, so the watch page plays the
   songs in order, then loops. Built by Ntandomods.
   ========================================================== */
(function () {
  'use strict';
  const App = window.DwimApp;
  if (!App) return;
  const { $, $$, esc } = App;

  const lists = () => (App.cat().playlists || []).filter(p => p && p.id && (p.videoIds || []).length);
  const get = (id) => lists().find(p => p.id === id) || null;
  const tracks = (p) => (p.videoIds || []).map(App.video).filter(v => v && v.source);

  function shuffled(arr, firstId) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    if (firstId) { const k = a.indexOf(firstId); if (k > 0) { a.splice(k, 1); a.unshift(firstId); } }
    return a;
  }

  /* start playing a playlist (optionally from a given song, optionally shuffled) */
  App.playPlaylist = (id, opts) => {
    opts = opts || {};
    const p = get(id); if (!p) return;
    let ids = tracks(p).map(v => v.id); if (!ids.length) return;
    const first = opts.start && ids.indexOf(opts.start) >= 0 ? opts.start : ids[0];
    if (opts.shuffle) ids = shuffled(ids, opts.start || null);
    else if (opts.start) { const k = ids.indexOf(first); ids = ids.slice(k).concat(ids.slice(0, k)); }
    App.state.queue = { id: p.id, name: p.name, ids };
    App.openVideo(ids[0]);
  };

  function mosaic(p) {
    const t = tracks(p).slice(0, 4);
    const imgs = t.map(v => `<div class="pl-cell"><img src="${esc(App.thumb(v))}" alt="" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'"></div>`).join('');
    return `<div class="pl-mosaic n${t.length}">${imgs}</div>`;
  }
  function plCard(p) {
    const n = tracks(p).length;
    return `<div class="pl-card ${p.featured ? 'feat' : ''}" tabindex="0" role="button" data-pl="${esc(p.id)}" aria-label="Open playlist ${esc(p.name)}">
      ${mosaic(p)}<div class="pl-cbody"><h4><span class="pl-ico">${esc(p.icon || '&#9835;')}</span> ${esc(p.name)}</h4><small>${n} songs</small></div>
      <button type="button" class="pl-cplay" data-pl-play="${esc(p.id)}" aria-label="Play ${esc(p.name)}" tabindex="-1">&#9654;</button></div>`;
  }

  /* row shown on top of On Demand */
  App.plRow = () => {
    const l = lists(); if (!l.length) return '';
    return `<section class="drow"><div class="drow-h"><h3>&#127942; Best Songs &amp; Playlists</h3><button type="button" class="drow-more" data-go="#/songs">See all &rsaquo;</button></div>
      <div class="pl-rail">${l.map(plCard).join('')}</div></section>`;
  };

  function credit() {
    return `<div class="nm-credit-bar"><img src="img/ntandomods-mark.svg" alt="" width="22" height="22"><span>DWIM TV is built by <b>Ntandomods</b>, Zimbabwe.</span></div>`;
  }

  function trackRow(v, i, p) {
    const fav = App.isFav(v.id);
    return `<div class="pl-track" tabindex="0" role="button" data-track="${esc(v.id)}" aria-label="Play ${esc(v.title)}">
      <span class="pl-num">${i + 1}</span>
      <div class="pl-tthumb"><img data-thumb src="${esc(App.thumb(v))}" data-fallback="https://i.ytimg.com/vi/${esc(App.ytId(v.source) || '')}/mqdefault.jpg" alt="" loading="lazy" decoding="async"><i>&#9654;</i></div>
      <div class="pl-tinfo"><h4>${esc(v.title)}</h4><small>${esc(v.category || '')}</small></div>
      <span class="pl-dur">${esc(v.duration || '')}</span>
      <button type="button" tabindex="-1" class="dfav pl-fav ${fav ? 'on' : ''}" data-fav="${esc(v.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Remove from My List' : 'Add to My List'}">${fav ? '&#10084;' : '&#9825;'}</button>
    </div>`;
  }

  function mins(list) {
    let sec = 0;
    list.forEach(v => { sec += App.dur ? (App.dur(v) || 0) : 0; });
    const m = Math.round(sec / 60);
    if (!m) return '';
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  }

  function hubHTML() {
    const l = lists();
    const best = l.find(p => p.featured) || l[0];
    if (!best) return '<div class="empty-state"><div>&#127925;</div><h3>No playlists yet</h3><p>Songs and playlists will show here soon.</p></div>';
    const bt = tracks(best);
    const hero = `<section class="pl-hero">
      ${mosaic(best)}
      <div class="pl-hero-body"><span class="hero-badge">&#127942; Featured playlist</span><h2>${esc(best.name)}</h2>
        <p>${esc(best.desc || '')}</p>
        <div class="pl-meta">${bt.length} songs${mins(bt) ? ' &middot; ' + mins(bt) : ''}</div>
        <div class="pl-actions"><button type="button" class="btn-gold" data-pl-play="${esc(best.id)}">&#9654; Play all</button>
          <button type="button" class="btn-outline-light" data-pl-shuffle="${esc(best.id)}">&#128256; Shuffle</button>
          <button type="button" class="btn-outline-light" data-pl="${esc(best.id)}">View songs</button></div></div></section>`;
    return hero + `<h3 class="sec-h">All playlists</h3><div class="pl-grid">${l.map(plCard).join('')}</div>` + credit();
  }

  function detailHTML(p) {
    const t = tracks(p);
    return `<button type="button" class="link-btn pl-back" data-go="#/songs">&lsaquo; All playlists</button>
      <section class="pl-hero small">${mosaic(p)}
        <div class="pl-hero-body"><span class="hero-badge">${esc(p.icon || '')} Playlist</span><h2>${esc(p.name)}</h2>
          <p>${esc(p.desc || '')}</p><div class="pl-meta">${t.length} songs${mins(t) ? ' &middot; ' + mins(t) : ''}</div>
          <div class="pl-actions"><button type="button" class="btn-gold" data-pl-play="${esc(p.id)}">&#9654; Play all</button>
            <button type="button" class="btn-outline-light" data-pl-shuffle="${esc(p.id)}">&#128256; Shuffle</button>
            <button type="button" class="btn-outline-light" data-pl-share="${esc(p.id)}">&#10150; Share</button></div></div></section>
      <div class="pl-tracks">${t.map((v, i) => trackRow(v, i, p)).join('')}</div>` + credit();
  }

  App.views.songs = {
    render(root) {
      const arg = App.state.arg || '';
      const p = arg ? get(arg) : null;
      root.innerHTML = `<div class="app-wrap pl-wrap"><div class="app-head"><div><h1>${p ? esc(p.name) : 'Songs &amp; Playlists'}</h1>
        <p class="app-sub">${p ? 'Press play and the songs keep coming, one after another.' : 'The best worship and gospel songs on DWIM TV. Press play and let the music roll.'}</p></div></div>
        ${arg && !p && (App.cat().videos || []).length ? '<p class="app-sub">That playlist was not found.</p>' : ''}
        ${p ? detailHTML(p) : hubHTML()}</div>`;
      if (App.wireCommon) App.wireCommon(root);
      this.wire(root);
    },
    wire(root) {
      if (root.__plWired) return; root.__plWired = true;
      root.addEventListener('click', (e) => {
        if (root.dataset.view !== 'songs') return;
        let b;
        if ((b = e.target.closest('[data-pl-play]'))) { e.stopPropagation(); App.playPlaylist(b.getAttribute('data-pl-play')); return; }
        if ((b = e.target.closest('[data-pl-shuffle]'))) { App.playPlaylist(b.getAttribute('data-pl-shuffle'), { shuffle: true }); return; }
        if ((b = e.target.closest('[data-pl-share]'))) {
          const p = get(b.getAttribute('data-pl-share')); if (!p) return;
          App.share(p.name, `Listen to "${p.name}" on DWIM TV`, location.origin + '/#/songs/' + encodeURIComponent(p.id)); return;
        }
        if ((b = e.target.closest('[data-pl]'))) { App.go('#/songs/' + encodeURIComponent(b.getAttribute('data-pl'))); return; }
        if ((b = e.target.closest('[data-track]'))) {
          const p = get(App.state.arg || ''); if (p) App.playPlaylist(p.id, { start: b.getAttribute('data-track') });
          return;
        }
      });
    }
  };

  /* playlist cards inside the On Demand layer (rendered by app-views) */
  document.addEventListener('click', (e) => {
    const layer = App.layerEl && App.layerEl(); if (!layer || layer.hidden || layer.dataset.view !== 'ondemand') return;
    let b;
    if ((b = e.target.closest('#odBody [data-pl-play]'))) { e.stopPropagation(); App.playPlaylist(b.getAttribute('data-pl-play')); return; }
    if ((b = e.target.closest('#odBody [data-pl]'))) { App.go('#/songs/' + encodeURIComponent(b.getAttribute('data-pl'))); return; }
  }, true);
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.pl-card[role="button"]')) { e.preventDefault(); e.target.click(); }
  });

})();
