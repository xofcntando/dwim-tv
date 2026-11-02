/* ==========================================================
   DWIM TV schedule engine.
   Pure functions: given the catalog (with catalog.schedule) and a clock,
   work out exactly what should be on air - the same answer for every
   viewer in the world, like a real TV station.
   ========================================================== */
const DwimSchedule = (function () {
  const DAY = 86400;

  function hmToSec(hm) { const p = String(hm).split(':'); return (+p[0]) * 3600 + (+p[1] || 0) * 60; }
  function durSec(v) {
    if (!v || !/^\d+(:\d+)+$/.test(v.duration || '')) return 0;
    return String(v.duration).split(':').reduce((a, x) => a * 60 + (+x), 0);
  }

  // Wall-clock parts of an instant in a time zone (CAT = Africa/Harare, no daylight saving)
  function zoneParts(ms, tz) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' });
    const o = {}; f.formatToParts(new Date(ms)).forEach(p => { o[p.type] = p.value; });
    const sec = (+o.hour) * 3600 + (+o.minute) * 60 + (+o.second);
    const asUTC = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second);
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday);
    return { y: +o.year, m: +o.month, d: +o.day, dow, sec, offsetMs: asUTC - Math.floor(ms / 1000) * 1000, key: `${o.year}-${o.month}-${o.day}` };
  }
  // UTC ms of "secOfDay" on the same zone-day as `parts`
  function msAt(parts, secOfDay) { return Date.UTC(parts.y, parts.m - 1, parts.d) + secOfDay * 1000 - parts.offsetMs; }

  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  // Stable "shuffle": every video gets a pseudo-random rank from (day + block + video id), so the order
  // never depends on how the catalog happens to be stored, and adding/removing a video only moves that video.
  function rankSort(arr, salt) {
    return arr.map(v => ({ v, k: hashStr(salt + '|' + v.id) })).sort((a, b) => a.k - b.k || (a.v.id < b.v.id ? -1 : 1)).map(x => x.v);
  }

  function blockApplies(b, dow) { return !b.days || b.days.indexOf(dow) >= 0; }

  function findBlock(sc, parts, sec) {
    const list = (sc.blocks || []).filter(b => blockApplies(b, parts.dow));
    // day-specific blocks (e.g. Sunday Service) win over general ones
    list.sort((a, b) => (b.days ? 1 : 0) - (a.days ? 1 : 0));
    return list.find(b => sec >= hmToSec(b.start) && sec < hmToSec(b.end)) || null;
  }

  function eligible(catalog, sc, channels, maxMin, usedIds) {
    const sigIds = new Set(sigPool(catalog, sc).map(v => v.id));
    return (catalog.videos || []).filter(v =>
      !sigIds.has(v.id) && !usedIds.has(v.id) && channels.indexOf(v.channel) >= 0 &&
      v.source && (v.type === 'youtube' || v.type === 'direct' || v.type === 'hls') &&
      durSec(v) > 0 && durSec(v) <= maxMin * 60);
  }

  // Deterministic playlist for a block on a given day - identical for every viewer
  function playlistFor(catalog, sc, block, dayKey) {
    const salt = dayKey + '|' + block.id;
    const maxMin = block.maxMinutes || 180;
    const used = new Set();
    let list = [];
    if (block.mix && block.mix.length) {
      const groups = block.mix.map(g => {
        const items = rankSort(eligible(catalog, sc, g.channels || [], maxMin, new Set()), salt);
        return { items, take: Math.max(1, g.take || 1) };
      });
      let left = true;
      while (left) {
        left = false;
        for (const g of groups) {
          for (let k = 0; k < g.take && g.items.length; k++) {
            const v = g.items.shift();
            if (!used.has(v.id)) { used.add(v.id); list.push(v); }
          }
          if (g.items.length) left = true;
        }
      }
    } else {
      list = rankSort(eligible(catalog, sc, block.channels || [], maxMin, used), salt);
    }
    if (!list.length) list = rankSort(eligible(catalog, sc, (catalog.channels || []).map(c => c.id), maxMin, new Set()), salt);
    return list;
  }

  // The signature "pool": a single video (signature.videoId) or, when signature.category is set,
  // every playable video in that category (e.g. all versions of "Let It Rain") up to maxMinutes long.
  function sigPool(catalog, sc) {
    const sig = sc && sc.signature; if (!sig) return [];
    const vids = catalog.videos || [];
    const single = vids.find(v => v.id === sig.videoId);
    if (!sig.category) return single ? [single] : [];
    const maxSec = (sig.maxMinutes || 14) * 60;
    const pool = vids.filter(v => v.category === sig.category && v.source && (v.type === 'youtube' || v.type === 'direct' || v.type === 'hls') && durSec(v) > 0 && durSec(v) <= maxSec)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    return pool.length ? pool : (single ? [single] : []);
  }
  // Shuffled but identical for every viewer: which version plays in a given slot on a given day
  function sigVideoAt(catalog, sc, dayKey, t) {
    const pool = sigPool(catalog, sc);
    if (!pool.length) return null;
    // extra bit-mixing so neighbouring slots/days do not favour the same version
    const mix = (n) => { n ^= n >>> 16; n = Math.imul(n, 0x85ebca6b); n ^= n >>> 13; n = Math.imul(n, 0xc2b2ae35); return (n ^ (n >>> 16)) >>> 0; };
    const salt = dayKey + '|sig|' + t;
    return pool.map(v => ({ v, k: mix(hashStr(salt + '|' + v.id)) })).sort((a, b) => a.k - b.k)[0].v;
  }

  // DWIM TV "breaks": short branded videos that play between the programme, WITHOUT cutting the sermon short.
  // The sermon is paused on the clock and resumes exactly where it stopped (see resolve()).
  // sc.breaks = [{ label, videoId | videoIds:[...], times:["08:00",...] | everyMinutes:10 }]
  //   - times: fixed clock times;  everyMinutes: a break at every N minutes (00:00, 00:10, 00:20, ...)
  //   - videoIds: the breaks take turns, so viewers see different DWIM TV videos
  function breakSlots(sc) {
    const out = [];
    (sc.breaks || []).forEach(b => {
      const ids = (b.videoIds && b.videoIds.length) ? b.videoIds : [b.videoId];
      let n = 0; // the DWIM TV videos take turns, one after another
      const add = (t) => out.push({ t, b, videoId: ids[n++ % ids.length] });
      (b.times || []).map(hmToSec).sort((x, y) => x - y).forEach(add);
      const every = (+b.everyMinutes || 0) * 60;
      if (every >= 60) for (let t = 0; t < DAY; t += every) add(t);
    });
    return out;
  }
  // Every timed insert for a day: signature song versions + breaks, sorted by time
  function slotsFor(catalog, sc, dayKey) {
    const list = [];
    if (sc.signature) sigSlots(sc).forEach(t => { const v = sigVideoAt(catalog, sc, dayKey, t); if (v) list.push({ t, v, label: sc.signature.label || v.title }); });
    const sigs = list.filter(x => durSec(x.v) > 0).map(x => [x.t, x.t + durSec(x.v)]);
    breakSlots(sc).forEach(({ t, b, videoId }) => {
      const v = (catalog.videos || []).find(x => x.id === videoId); if (!v) return;
      const len = durSec(v);
      // a break never lands on top of a signature song (e.g. Let It Rain)
      if (sigs.some(([a, z]) => t < z && t + len > a)) return;
      list.push({ t, v, label: b.label || 'DWIM TV Break' });
    });
    return list.filter(x => durSec(x.v) > 0).sort((a, b) => a.t - b.t);
  }

  function sigSlots(sc) { return sc.signature ? (sc.signature.times || []).map(hmToSec).sort((a, b) => a - b) : []; }

  // What is on air at instant `ms`?
  function resolve(catalog, ms) {
    const sc = catalog && catalog.schedule;
    if (!sc || !(sc.blocks || []).length) return null;
    const tz = sc.timezone || 'Africa/Harare';
    const parts = zoneParts(ms, tz);
    const sec = parts.sec + (ms % 1000) / 1000;
    const slotList = slotsFor(catalog, sc, parts.key);

    // 1) signature song (e.g. "Let It Rain", a different version each slot) due right now
    for (const { t, v: sigVideo, label: slotLabel } of slotList) {
      const sigLen = durSec(sigVideo);
      if (sec >= t && sec < t + sigLen) {
        return { kind: 'signature', token: 'sig:' + parts.key + '@' + t, block: findBlock(sc, parts, sec), video: sigVideo, offset: sec - t, remaining: t + sigLen - sec, label: slotLabel, parts, sec };
      }
    }
    // 2) the block playlist
    const block = findBlock(sc, parts, sec);
    if (!block) return null;
    const pl = playlistFor(catalog, sc, block, parts.key);
    if (!pl.length) return null;
    let elapsed = sec - hmToSec(block.start);
    for (const { t, v: sv } of slotList) if (t >= hmToSec(block.start) && t + durSec(sv) <= sec) elapsed -= durSec(sv);
    elapsed = Math.max(0, elapsed);
    const total = pl.reduce((a, v) => a + durSec(v), 0);
    let pos = elapsed % total, i = 0;
    while (i < pl.length - 1 && pos >= durSec(pl[i])) { pos -= durSec(pl[i]); i++; }
    const v = pl[i];
    return { kind: 'block', token: 'blk:' + parts.key + ':' + block.id, block, video: v, offset: pos, remaining: durSec(v) - pos, playlist: pl, index: i, parts, sec };
  }

  // Seconds-of-day of the next schedule boundary (block end or signature slot) after now
  function nextBoundary(catalog, ms) {
    const sc = catalog.schedule, parts = zoneParts(ms, sc.timezone || 'Africa/Harare');
    const sec = parts.sec;
    const cands = [];
    (sc.blocks || []).filter(b => blockApplies(b, parts.dow)).forEach(b => { cands.push(hmToSec(b.start), hmToSec(b.end)); });
    sigSlots(sc).forEach(t => cands.push(t));
    breakSlots(sc).forEach(x => cands.push(x.t));
    const later = cands.filter(t => t > sec).sort((a, b) => a - b)[0];
    return later === undefined ? DAY : later; // midnight rolls into the next day
  }

  // What follows the current item? Handles block/signature boundaries arriving before the video ends.
  function upNext(catalog, r, ms) {
    if (!r) return null;
    const b = nextBoundary(catalog, ms);
    const tillBoundary = b - r.parts.sec;
    if (tillBoundary < r.remaining - 1) {
      const nr = resolve(catalog, ms + (tillBoundary + 1) * 1000);
      if (nr) return { title: nr.kind === 'signature' ? nr.label : nr.video.title, block: nr.block, atBoundary: true, atMs: ms + tillBoundary * 1000 };
    }
    if (r.kind === 'signature') {
      const nr = resolve(catalog, ms + (r.remaining + 1) * 1000);
      return nr ? { title: nr.video.title, block: nr.block } : null;
    }
    const n = r.playlist[(r.index + 1) % r.playlist.length];
    return n ? { title: n.title, block: r.block } : null;
  }

  // Today's programme for the UI: effective segments (a Sunday block overrides the weekday ones)
  function dayGrid(catalog, ms) {
    const sc = catalog.schedule; if (!sc) return [];
    const parts = zoneParts(ms, sc.timezone || 'Africa/Harare');
    const segs = []; let cur = null;
    for (let sec = 0; sec < DAY; sec += 60) {
      const b = findBlock(sc, parts, sec);
      if (cur && b && cur.block.id === b.id) { cur.endSec = sec + 60; continue; }
      if (cur) segs.push(cur);
      cur = b ? { block: b, startSec: sec, endSec: sec + 60 } : null;
    }
    if (cur) segs.push(cur);
    return segs.map(g => ({ block: g.block, startMs: msAt(parts, g.startSec), endMs: msAt(parts, g.endSec) }));
  }
  function signatureTimes(catalog, ms) {
    const sc = catalog.schedule; if (!sc || !sc.signature) return [];
    const parts = zoneParts(ms, sc.timezone || 'Africa/Harare');
    return sigSlots(sc).map(t => msAt(parts, t));
  }

  return { resolve, upNext, dayGrid, signatureTimes, durSec, zoneParts, hmToSec, playlistFor };
})();
if (typeof module !== 'undefined') module.exports = DwimSchedule;
