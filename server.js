const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const compression = require('compression');

const app = express();
app.set('trust proxy', 1); // behind Render's proxy, so req.ip is the real visitor
const PORT = process.env.PORT || 3000;

// DWIM TV — Destiny Word International Ministries
console.log('⏳ DWIM TV (Destiny Word International Ministries) starting…');

// Serve frontend
// Service worker + manifest must always be revalidated so app updates reach installed phones/PCs
app.get(['/sw.js', '/manifest.webmanifest'], (req, res, next) => { res.set('Cache-Control', 'no-cache'); next(); });
app.use((req, res, next) => { // light security headers
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' });
  next();
});
app.use(compression());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));
app.use(express.json({ limit: '100kb' }));

// ---- API: the catalog (this is our "storage") ----
const CATALOG_PATH = path.join(__dirname, 'data', 'videos.json');

// In-memory copy of the catalog. MongoDB (when MONGODB_URI is set) is the source of truth;
// otherwise data/videos.json is. Reads are served from memory, writes go to the store.
let catalogCache = null;
let writeChain = Promise.resolve(); // keeps MongoDB writes in order

function readCatalogFile() {
  try {
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  } catch (err) {
    console.error('Failed to read videos.json:', err.message);
    return { channels: [], videos: [] };
  }
}

function readCatalog() {
  if (!catalogCache) catalogCache = readCatalogFile();
  return JSON.parse(JSON.stringify(catalogCache)); // copy, so a rejected edit never corrupts the cache
}

/* ---- Live state: held in memory (and a temp file), NEVER committed to GitHub.
        Going live must not trigger a Render redeploy mid-service. ---- */
const LIVE_FILE = path.join(require('os').tmpdir(), 'dwim-live.json');
const LIVE_MAX_MS = 10 * 3600 * 1000; // auto-end after 10h in case nobody taps End Live
let liveNow = null;
function loadLiveFromFile() {
  try {
    const saved = JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8'));
    if (saved && saved.source && Date.now() - saved.startedAt < LIVE_MAX_MS) liveNow = saved;
  } catch (e) { /* none saved */ }
}
loadLiveFromFile();

function getLive() {
  if (liveNow && Date.now() - liveNow.startedAt >= LIVE_MAX_MS) { liveNow = null; persistLive(); }
  return liveNow
    ? { title: liveNow.title, type: liveNow.type || 'youtube', source: liveNow.source }
    : { title: 'DWIM TV Live — Sunday Service', type: 'youtube', source: '' };
}
function persistLive() {
  if (db.isConnected()) {
    db.saveLive(liveNow).catch(e => console.error('MongoDB: saving live state failed:', e.message));
    return;
  }
  try { liveNow ? fs.writeFileSync(LIVE_FILE, JSON.stringify(liveNow)) : fs.rmSync(LIVE_FILE, { force: true }); } catch (e) { /* ignore */ }
}

async function writeCatalog(cat) {
  catalogCache = JSON.parse(JSON.stringify(cat));
  if (db.isConnected()) {
    const snapshot = catalogCache;
    writeChain = writeChain.then(() => db.saveCatalog(snapshot)).catch(e => {
      console.error('MongoDB: saving catalog failed:', e.message);
    });
    await writeChain;
    return;
  }
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(cat, null, 2) + '\n', 'utf8');
}

// Full catalog (channels + videos)
app.get('/api/catalog', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ...readCatalog(), live: getLive() });
});

// Live status only (polled by the site; never cached)
app.get('/api/live', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ live: getLive(), serverTime: Date.now() });
});

// Weekly recurring calendar event for the Sunday service (11:00 AM CAT = 09:00 UTC)
app.get('/service.ics', (req, res) => {
  const cat = readCatalog();
  const church = cat.church || {};
  const hours = Number(church.serviceDurationHours) || 3;
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay(), 9, 0, 0));
  const fmt = (dt) => dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = new Date(d.getTime() + hours * 3600 * 1000);
  const host = `${req.protocol}://${req.get('host')}`;
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DWIM TV//Sunday Service//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:sunday-service@${req.get('host')}`,
    `DTSTAMP:${fmt(now)}`,
    `DTSTART:${fmt(d)}`, `DTEND:${fmt(end)}`,
    'RRULE:FREQ=WEEKLY;BYDAY=SU',
    `SUMMARY:DWIM Sunday Service (LIVE on DWIM TV)`,
    `DESCRIPTION:Join Destiny Word International Ministries live. Watch at ${host}`,
    `LOCATION:${(church.location || 'Old Ascot\\, Gweru\\, Zimbabwe').replace(/,/g, '\\,')}`,
    `URL:${host}`,
    'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:DWIM Sunday Service starts in 30 minutes', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n') + '\r\n';
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="dwim-sunday-service.ics"');
  res.send(ics);
});

// Just the videos
app.get('/api/videos', (req, res) => {
  res.json(readCatalog().videos || []);
});

// Just the channels
app.get('/api/channels', (req, res) => {
  res.json(readCatalog().channels || []);
});

// Health check (Render uses this to know the app is alive)
app.get('/healthz', (req, res) => {
  res.status(200).send(db.isConnected() ? 'ok (mongodb)' : 'ok');
});

/* =========================================================
   ADMIN PANEL — login: ntando / ntando (env-overridable)
   ========================================================= */
const ADMIN_USER = process.env.ADMIN_USER || 'ntando';
const ADMIN_PASS = process.env.ADMIN_PASS || 'ntando';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'mrnt4ndo/dwim-tv';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

const SESSION_TTL = 1000 * 60 * 60 * 6; // 6 hours
const sessions = new Map(); // token -> expiry

function parseSessionCookie(req) {
  const m = String(req.headers.cookie || '').match(/dwim_session=([a-f0-9]+)/);
  return m ? m[1] : null;
}

function authed(req) {
  const t = parseSessionCookie(req);
  if (!t) return false;
  const exp = sessions.get(t);
  if (!exp || exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}

function requireAdmin(req, res, next) {
  if (!authed(req)) return res.status(401).json({ ok: false, error: 'Not logged in' });
  next();
}

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL);
    res.setHeader('Set-Cookie',
      `dwim_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`);
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false, error: 'Invalid username or password' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  const t = parseSessionCookie(req);
  if (t) sessions.delete(t);
  res.setHeader('Set-Cookie', 'dwim_session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  res.json({ ok: authed(req), user: authed(req) ? ADMIN_USER : null });
});

// List full catalog (admin view)
app.get('/api/admin/videos', requireAdmin, (req, res) => {
  res.json(readCatalog());
});

// Verify a YouTube URL/ID via oEmbed — returns title, author, thumbnail
app.get('/api/admin/verify', requireAdmin, async (req, res) => {
  const raw = String(req.query.url || '').trim();
  if (!raw) return res.status(400).json({ ok: false, error: 'Missing url' });
  let id = null;
  if (/^[\w-]{11}$/.test(raw)) id = raw;
  else {
    const m = raw.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/);
    if (m) id = m[1];
  }
  if (!id) return res.status(400).json({ ok: false, error: 'Could not find a YouTube video ID in that input' });
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
    if (!r.ok) return res.status(404).json({ ok: false, error: 'Video not found on YouTube (private, deleted or wrong ID)' });
    const meta = await r.json();
    res.json({ ok: true, id, title: meta.title, author: meta.author_name, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
  } catch (e) {
    res.status(502).json({ ok: false, error: 'YouTube check failed: ' + e.message });
  }
});

/* =========================================================
   CHURCH INFO — service times, theme banner, contact, giving
   ========================================================= */
app.get('/api/admin/church', requireAdmin, (req, res) => {
  const cat = readCatalog();
  res.json({ ok: true, church: cat.church || {} });
});

app.put('/api/admin/church', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const cat = readCatalog();
  const prev = cat.church || {};

  // Whitelisted, shallow-merged fields — keeps unknown/extra keys out of the catalog
  const church = {
    ...prev,
    name: body.name !== undefined ? String(body.name).trim() : prev.name,
    short: body.short !== undefined ? String(body.short).trim() : prev.short,
    tagline: body.tagline !== undefined ? String(body.tagline).trim() : prev.tagline,
    theme: body.theme !== undefined ? String(body.theme).trim() : prev.theme,
    themeNote: body.themeNote !== undefined ? String(body.themeNote).trim() : prev.themeNote,
    themeVerse: body.themeVerse !== undefined ? String(body.themeVerse).trim() : prev.themeVerse,
    location: body.location !== undefined ? String(body.location).trim() : prev.location,
    mapUrl: body.mapUrl !== undefined ? String(body.mapUrl).trim() : prev.mapUrl,
    services: Array.isArray(body.services)
      ? body.services
          .map(s => ({ name: String((s || {}).name || '').trim(), time: String((s || {}).time || '').trim() }))
          .filter(s => s.name || s.time)
      : prev.services,
    contact: {
      ...(prev.contact || {}),
      ...(body.contact ? {
        facebook: body.contact.facebook !== undefined ? String(body.contact.facebook).trim() : (prev.contact || {}).facebook,
        whatsapp: body.contact.whatsapp !== undefined ? String(body.contact.whatsapp).trim() : (prev.contact || {}).whatsapp,
        phone: body.contact.phone !== undefined ? String(body.contact.phone).trim() : (prev.contact || {}).phone,
        email: body.contact.email !== undefined ? String(body.contact.email).trim() : (prev.contact || {}).email
      } : {})
    },
    giving: {
      ...(prev.giving || {}),
      ...(body.giving ? {
        bankName: body.giving.bankName !== undefined ? String(body.giving.bankName).trim() : (prev.giving || {}).bankName,
        accountName: body.giving.accountName !== undefined ? String(body.giving.accountName).trim() : (prev.giving || {}).accountName,
        accountNumber: body.giving.accountNumber !== undefined ? String(body.giving.accountNumber).trim() : (prev.giving || {}).accountNumber,
        note: body.giving.note !== undefined ? String(body.giving.note).trim() : (prev.giving || {}).note
      } : {})
    }
  };

  cat.church = church;
  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  res.json({ ok: true, church, github: gh });
});

/* =========================================================
   CHANNEL MANAGEMENT — rename, delete, reorder
   ========================================================= */

// Rename a channel and/or change its icon
app.put('/api/admin/channels/:id', requireAdmin, async (req, res) => {
  const cat = readCatalog();
  const ch = (cat.channels || []).find(c => c.id === req.params.id);
  if (!ch) return res.status(404).json({ ok: false, error: 'Channel not found' });
  if (ch.id === 'ch-all') return res.status(400).json({ ok: false, error: '"All Videos" is a built-in channel and cannot be renamed' });

  const body = req.body || {};
  const newName = body.name !== undefined ? String(body.name).trim() : ch.name;
  if (!newName) return res.status(400).json({ ok: false, error: 'Channel name cannot be empty' });
  const dupe = cat.channels.some(c => c.id !== ch.id && c.name.toLowerCase() === newName.toLowerCase());
  if (dupe) return res.status(409).json({ ok: false, error: 'Another channel already has that name' });

  ch.name = newName;
  if (body.icon !== undefined) ch.icon = String(body.icon).trim() || ch.icon;
  // keep the video "category" label in sync when it mirrors the old channel name
  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  res.json({ ok: true, channel: ch, github: gh });
});

// Delete a channel. Videos in it are moved to a target channel (default: ch-archive, fallback: first remaining channel)
app.delete('/api/admin/channels/:id', requireAdmin, async (req, res) => {
  const cat = readCatalog();
  const idx = (cat.channels || []).findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Channel not found' });
  const ch = cat.channels[idx];
  if (ch.id === 'ch-all') return res.status(400).json({ ok: false, error: '"All Videos" is a built-in channel and cannot be deleted' });

  const moveTo = String(req.query.moveTo || req.body?.moveTo || '').trim();
  const videosInChannel = (cat.videos || []).filter(v => v.channel === ch.id);

  if (videosInChannel.length > 0) {
    let target = cat.channels.find(c => c.id === moveTo && c.id !== ch.id);
    if (!target) target = cat.channels.find(c => c.id === 'ch-archive' && c.id !== ch.id);
    if (!target) target = cat.channels.find(c => c.id !== ch.id && c.id !== 'ch-all');
    if (!target) return res.status(400).json({ ok: false, error: 'Cannot delete the only remaining channel while it still has videos' });
    for (const v of videosInChannel) v.channel = target.id;
  }

  cat.channels.splice(idx, 1);
  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  res.json({ ok: true, removed: ch, movedVideos: videosInChannel.length, github: gh });
});

// Reorder channels — body: { order: ["ch-all", "ch-services", ...] } (full list of channel ids in desired order)
app.put('/api/admin/channels-order', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const order = Array.isArray(body.order) ? body.order.map(String) : null;
  if (!order || !order.length) return res.status(400).json({ ok: false, error: 'Missing order array' });

  const cat = readCatalog();
  const byId = new Map(cat.channels.map(c => [c.id, c]));
  const missing = order.filter(id => !byId.has(id));
  if (missing.length) return res.status(400).json({ ok: false, error: 'Unknown channel id(s): ' + missing.join(', ') });

  const reordered = order.map(id => byId.get(id));
  // append any channel not mentioned (defensive — keeps data safe if the client sent a partial list)
  for (const c of cat.channels) if (!order.includes(c.id)) reordered.push(c);

  cat.channels = reordered;
  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  res.json({ ok: true, channels: cat.channels, github: gh });
});

function nextVideoId(cat) {
  let max = 0;
  for (const v of cat.videos) {
    const m = String(v.id).match(/^v(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'v' + (max + 1);
}

// Add a video (by YouTube URL or ID)
app.post('/api/admin/videos', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const raw = String(body.url || '').trim();
  if (!raw) return res.status(400).json({ ok: false, error: 'Missing YouTube URL or ID' });

  let id = null;
  if (/^[\w-]{11}$/.test(raw)) id = raw;
  else {
    const m = raw.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/);
    if (m) id = m[1];
  }
  if (!id) return res.status(400).json({ ok: false, error: 'Could not find a YouTube video ID in that input' });

  // Verify against YouTube
  let meta = null;
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
    if (!r.ok) return res.status(404).json({ ok: false, error: 'Video not found on YouTube — cannot add' });
    meta = await r.json();
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'YouTube check failed: ' + e.message });
  }

  const cat = readCatalog();

  // no duplicates
  if ((cat.videos || []).some(v => (v.source || '').includes('v=' + id))) {
    return res.status(409).json({ ok: false, error: 'That video is already in the catalog' });
  }

  // figure out channel
  let channelId = body.channel;
  if (body.newChannelName) {
    const name = String(body.newChannelName).trim();
    if (!name) return res.status(400).json({ ok: false, error: 'New channel name is empty' });
    const exists = cat.channels.some(c => c.name.toLowerCase() === name.toLowerCase());
    if (!exists) {
      const chId = 'ch-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      cat.channels.push({ id: chId, name, icon: String(body.newChannelIcon || '📺').trim() || '📺' });
      channelId = chId;
    } else {
      channelId = cat.channels.find(c => c.name.toLowerCase() === name.toLowerCase()).id;
    }
  }
  const channelObj = cat.channels.find(c => c.id === channelId);
  if (!channelObj) return res.status(400).json({ ok: false, error: 'Unknown channel' });

  const video = {
    id: nextVideoId(cat),
    title: String(body.title || meta.title || 'Untitled').trim(),
    channel: channelObj.id,
    category: String(body.category || channelObj.name).trim(),
    type: 'youtube',
    source: 'https://www.youtube.com/watch?v=' + id,
    duration: String(body.duration || '—').trim(),
    thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    desc: String(body.desc || `Added via DWIM TV admin panel. From YouTube channel: ${meta.author_name}.`).trim(),
    tags: Array.isArray(body.tags) ? body.tags.map(String) :
      String(body.tags || '').split(',').map(s => s.trim()).filter(Boolean)
  };

  cat.videos.push(video);
  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();

  res.json({ ok: true, video, github: gh, channels: cat.channels });
});

// Add one of our OWN videos (direct MP4/WebM or HLS .m3u8 link) - plays in the DWIM TV player
app.post('/api/admin/videos/own', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const source = String(body.source || '').trim();
  const title = String(body.title || '').trim();
  if (!title) return res.status(400).json({ ok: false, error: 'Please give the video a title' });
  if (!/^https:\/\/\S+$/i.test(source)) return res.status(400).json({ ok: false, error: 'Video link must be a full https:// URL' });
  const type = /\.m3u8(\?.*)?$/i.test(source) ? 'hls' : 'direct';
  if (type === 'direct' && !/\.(mp4|webm|m4v|mov)(\?.*)?$/i.test(source)) {
    return res.status(400).json({ ok: false, error: 'Link must end in .mp4, .webm or .m3u8' });
  }
  const thumb = String(body.thumb || '').trim();
  if (thumb && !/^https:\/\/\S+$/i.test(thumb)) return res.status(400).json({ ok: false, error: 'Thumbnail must be a full https:// image URL' });

  const cat = readCatalog();
  if ((cat.videos || []).some(v => v.source === source)) return res.status(409).json({ ok: false, error: 'That video is already in the catalog' });
  const channelObj = cat.channels.find(c => c.id === body.channel);
  if (!channelObj) return res.status(400).json({ ok: false, error: 'Unknown channel' });

  const video = {
    id: nextVideoId(cat),
    title,
    channel: channelObj.id,
    category: String(body.category || channelObj.name).trim(),
    type,
    source,
    duration: String(body.duration || '—').trim(),
    thumb: thumb || '/img/hero-worship.jpg',
    desc: String(body.desc || '').trim(),
    tags: String(body.tags || '').split(',').map(s => s.trim()).filter(Boolean)
  };
  cat.videos.push(video);
  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  res.json({ ok: true, video, github: gh });
});

// Delete a video
app.delete('/api/admin/videos/:id', requireAdmin, async (req, res) => {
  const cat = readCatalog();
  const idx = (cat.videos || []).findIndex(v => v.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Video not found' });
  const removed = cat.videos.splice(idx, 1)[0];
  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  res.json({ ok: true, removed, github: gh });
});

/* =========================================================
   EDIT a video — title, channel, category, duration, desc,
   tags, and thumbnail override (paste an image URL)
   ========================================================= */
app.put('/api/admin/videos/:id', requireAdmin, async (req, res) => {
  const cat = readCatalog();
  const video = (cat.videos || []).find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ ok: false, error: 'Video not found' });

  const body = req.body || {};

  if (body.channel !== undefined && body.channel !== '') {
    const chObj = cat.channels.find(c => c.id === body.channel);
    if (!chObj) return res.status(400).json({ ok: false, error: 'Unknown channel' });
    video.channel = chObj.id;
    // keep category text in step with the new channel unless caller also set category explicitly
    if (body.category === undefined) video.category = chObj.name;
  }
  if (body.title !== undefined) video.title = String(body.title).trim() || video.title;
  if (body.category !== undefined) video.category = String(body.category).trim() || video.category;
  if (body.duration !== undefined) video.duration = String(body.duration).trim() || video.duration;
  if (body.desc !== undefined) video.desc = String(body.desc).trim();
  if (body.tags !== undefined) {
    video.tags = Array.isArray(body.tags)
      ? body.tags.map(String)
      : String(body.tags || '').split(',').map(s => s.trim()).filter(Boolean);
  }

  // Thumbnail override — paste any direct image URL (jpg/png/webp). Empty string resets to the YouTube auto-thumb.
  if (body.thumb !== undefined) {
    const t = String(body.thumb).trim();
    if (t) {
      if (!/^https?:\/\/.+\.(jpe?g|png|webp|gif)(\?.*)?$/i.test(t) && !/^https:\/\/i\.ytimg\.com\//i.test(t)) {
        return res.status(400).json({ ok: false, error: 'Thumbnail must be a direct image URL (.jpg, .png, .webp, .gif)' });
      }
      video.thumb = t;
    } else {
      const m = (video.source || '').match(/v=([\w-]{11})/);
      video.thumb = m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : video.thumb;
    }
  }

  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  res.json({ ok: true, video, github: gh });
});

/* =========================================================
   FEATURE / PIN a video to the top of its channel + reorder
   ========================================================= */

// Toggle "featured" (pinned) flag
app.post('/api/admin/videos/:id/feature', requireAdmin, async (req, res) => {
  const cat = readCatalog();
  const video = (cat.videos || []).find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ ok: false, error: 'Video not found' });
  const body = req.body || {};
  video.featured = body.featured !== undefined ? !!body.featured : !video.featured;
  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  res.json({ ok: true, video, github: gh });
});

// Reorder videos — body: { order: ["v12", "v3", ...] } (full list of video ids in desired display order)
app.put('/api/admin/videos-order', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const order = Array.isArray(body.order) ? body.order.map(String) : null;
  if (!order || !order.length) return res.status(400).json({ ok: false, error: 'Missing order array' });

  const cat = readCatalog();
  const byId = new Map(cat.videos.map(v => [v.id, v]));
  const missing = order.filter(id => !byId.has(id));
  if (missing.length) return res.status(400).json({ ok: false, error: 'Unknown video id(s): ' + missing.join(', ') });

  const reordered = order.map(id => byId.get(id));
  for (const v of cat.videos) if (!order.includes(v.id)) reordered.push(v); // keep anything not mentioned, defensively

  cat.videos = reordered;
  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  res.json({ ok: true, videos: cat.videos, github: gh });
});

/* =========================================================
   TV SCHEDULE — daily programme (edited as JSON in the admin panel)
   ========================================================= */
function validateSchedule(sc, cat) {
  if (!sc || typeof sc !== 'object') return 'Schedule must be an object';
  const hm = /^([01]?\d|2[0-4]):[0-5]\d$/;
  if (!Array.isArray(sc.blocks) || !sc.blocks.length) return 'Schedule needs a "blocks" list';
  const chIds = new Set((cat.channels || []).map(c => c.id));
  for (const b of sc.blocks) {
    if (!b.id || !b.name) return 'Every block needs "id" and "name"';
    if (!hm.test(b.start || '') || !hm.test(b.end || '')) return `Block "${b.name}": start/end must look like "18:00"`;
    const chans = [].concat(b.channels || [], ...(b.mix || []).map(m => m.channels || []));
    if (!chans.length) return `Block "${b.name}" needs "channels" or "mix"`;
    const bad = chans.find(c => !chIds.has(c));
    if (bad) return `Block "${b.name}": unknown channel "${bad}"`;
  }
  if (sc.signature) {
    const inCat = (cat.videos || []).some(v => v.id === sc.signature.videoId);
    const inCategory = sc.signature.category && (cat.videos || []).some(v => v.category === sc.signature.category);
    if (!inCat && !inCategory) return 'Signature videoId (or category) not found in the catalog';
    if (!Array.isArray(sc.signature.times) || sc.signature.times.some(t => !hm.test(t))) return 'Signature times must look like ["06:00","18:00"]';
  }
  if (sc.breaks !== undefined) {
    if (!Array.isArray(sc.breaks)) return 'Schedule "breaks" must be a list';
    for (const b of sc.breaks) {
      const ids = (Array.isArray(b.videoIds) && b.videoIds.length) ? b.videoIds : [b.videoId];
      for (const id of ids) if (!(cat.videos || []).some(v => v.id === id)) return `Break "${b.label || ''}": video "${id}" not found in the catalog`;
      if (b.times !== undefined && (!Array.isArray(b.times) || b.times.some(t => !hm.test(t)))) return 'Break times must look like ["08:00","16:00"]';
      if (b.everyMinutes !== undefined && !(+b.everyMinutes >= 1 && +b.everyMinutes <= 720)) return 'Break "everyMinutes" must be between 1 and 720';
      if (b.times === undefined && b.everyMinutes === undefined) return 'Break needs "times" or "everyMinutes"';
    }
  }
  try { new Intl.DateTimeFormat('en-US', { timeZone: sc.timezone || 'Africa/Harare' }); } catch (e) { return 'Unknown timezone'; }
  return null;
}

app.get('/api/admin/schedule', requireAdmin, (req, res) => {
  res.json({ ok: true, schedule: readCatalog().schedule || null });
});

app.put('/api/admin/schedule', requireAdmin, async (req, res) => {
  const cat = readCatalog();
  const sc = (req.body || {}).schedule;
  const err = validateSchedule(sc, cat);
  if (err) return res.status(400).json({ ok: false, error: err });
  cat.schedule = sc;
  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  res.json({ ok: true, schedule: sc, github: gh });
});

/* =========================================================
   PRAYER REQUESTS — public form -> MongoDB, admin inbox
   (without MongoDB they go to a temp file: they survive restarts
   but NOT redeploys, so set MONGODB_URI in production)
   ========================================================= */
const PRAYER_FILE = path.join(require('os').tmpdir(), 'dwim-prayers.json');
let prayersMem = null;
function prayersLoadFile() {
  if (!prayersMem) { try { prayersMem = JSON.parse(fs.readFileSync(PRAYER_FILE, 'utf8')); } catch (e) { prayersMem = []; } }
  return prayersMem;
}
function prayersSaveFile() { try { fs.writeFileSync(PRAYER_FILE, JSON.stringify(prayersMem)); } catch (e) { /* ignore */ } }

const prayerHits = new Map(); // ip -> [timestamps]  (max 5 requests / hour)
function prayerRateOk(ip) {
  const now = Date.now();
  const hits = (prayerHits.get(ip) || []).filter(t => now - t < 3600 * 1000);
  if (hits.length >= 5) { prayerHits.set(ip, hits); return false; }
  hits.push(now); prayerHits.set(ip, hits);
  return true;
}

app.post('/api/prayer', async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot: bots fill hidden fields
  const text = String(b.request || '').trim().slice(0, 1500);
  if (text.length < 5) return res.status(400).json({ ok: false, error: 'Please write your prayer request.' });
  if (!prayerRateOk(req.ip)) return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });
  const clean = (v, n) => String(v || '').trim().slice(0, n);
  const doc = {
    _id: crypto.randomBytes(8).toString('hex'),
    name: clean(b.name, 80) || 'Anonymous',
    location: clean(b.location, 80),
    contact: clean(b.contact, 120),
    category: clean(b.category, 40) || 'General',
    request: text,
    prayed: false,
    createdAt: new Date()
  };
  try {
    if (db.isConnected()) await db.addPrayer(doc);
    else { prayersLoadFile().unshift({ ...doc, createdAt: doc.createdAt.toISOString() }); prayersSaveFile(); }
    res.json({ ok: true });
  } catch (e) {
    console.error('Saving prayer request failed:', e.message);
    res.status(500).json({ ok: false, error: 'Could not save your request. Please try again.' });
  }
});

app.get('/api/admin/prayers', requireAdmin, async (req, res) => {
  try {
    const list = db.isConnected() ? await db.listPrayers() : prayersLoadFile();
    res.json({ ok: true, storage: db.isConnected() ? 'mongodb' : 'temp-file', prayers: list.map(p => ({ ...p, id: p._id })) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/admin/prayers/:id/prayed', requireAdmin, async (req, res) => {
  const prayed = (req.body || {}).prayed !== false;
  try {
    if (db.isConnected()) {
      const r = await db.setPrayerPrayed(req.params.id, prayed);
      if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
    } else {
      const p = prayersLoadFile().find(x => x._id === req.params.id);
      if (!p) return res.status(404).json({ ok: false, error: 'Not found' });
      p.prayed = prayed; prayersSaveFile();
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/api/admin/prayers/:id', requireAdmin, async (req, res) => {
  try {
    let ok;
    if (db.isConnected()) ok = await db.deletePrayer(req.params.id);
    else { const l = prayersLoadFile(); const i = l.findIndex(x => x._id === req.params.id); ok = i >= 0; if (ok) { l.splice(i, 1); prayersSaveFile(); } }
    res.status(ok ? 200 : 404).json({ ok });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ---- Live stream: Go Live / End Live (memory only, instant for every phone) ---- */
app.get('/api/admin/live', requireAdmin, (req, res) => {
  res.json({ ok: true, live: getLive(), startedAt: liveNow ? liveNow.startedAt : null });
});

app.post('/api/admin/live', requireAdmin, (req, res) => {
  const url = String((req.body || {}).url || '').trim();
  if (!url) {
    liveNow = null; // End Live
  } else {
    const title = String((req.body || {}).title || 'DWIM TV Live — Sunday Service').slice(0, 120);
    if (/^https:\/\/.+\.m3u8(\?.*)?$/i.test(url)) {
      // our own HLS live stream (plays in the DWIM TV player)
      liveNow = { title, type: 'hls', source: url, startedAt: Date.now() };
    } else {
      const m = url.match(/(?:youtu\.be\/|v=|\/embed\/|\/live\/|\/shorts\/)([\w-]{11})/);
      const id = /^[\w-]{11}$/.test(url) ? url : (m ? m[1] : null);
      if (!id) return res.status(400).json({ ok: false, error: 'Paste an HTTPS .m3u8 stream link, or a valid YouTube live URL' });
      liveNow = { title, type: 'youtube', source: 'https://www.youtube.com/watch?v=' + id, startedAt: Date.now() };
    }
  }
  persistLive();
  res.json({ ok: true, live: getLive(), startedAt: liveNow ? liveNow.startedAt : null });
});

/* ---- GitHub sync: commits data/videos.json so changes survive
        Render free-tier restarts (Render auto-redeploys from repo) ---- */
async function syncCatalogToGitHub() {
  if (db.isConnected()) return { ok: true, mongo: true }; // MongoDB persists everything; no commit/redeploy needed
  if (!GITHUB_TOKEN) return { ok: false, skipped: true, reason: 'GITHUB_TOKEN not set — saved to disk only' };
  try {
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/data/videos.json`;
    const headers = {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'User-Agent': 'dwim-tv-admin',
      'Accept': 'application/vnd.github+json'
    };
    // current file sha (needed to update)
    let sha;
    const cur = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { headers });
    if (cur.ok) sha = (await cur.json()).sha;

    const content = fs.readFileSync(CATALOG_PATH).toString('base64');
    const payload = {
      message: 'Admin panel: update video catalog',
      content,
      branch: GITHUB_BRANCH
    };
    if (sha) payload.sha = sha;

    const put = await fetch(apiUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!put.ok) {
      const err = await put.text();
      return { ok: false, status: put.status, error: err.slice(0, 300) };
    }
    return { ok: true, pushed: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// App routes: stats (views, live viewers), events & announcements, robots/sitemap
require('./lib/app-routes').register(app, { db, readCatalog, writeCatalog, syncCatalogToGitHub, requireAdmin });

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function init() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL || '';
  if (uri) {
    try {
      await db.connect(uri);
      let cat = await db.loadCatalog();
      if (!cat) {
        cat = readCatalogFile(); // first run: seed MongoDB from data/videos.json
        await db.saveCatalog(cat);
        console.log(`🌱 MongoDB seeded from data/videos.json (${(cat.videos || []).length} videos)`);
      }
      // New seed content shipped in data/videos.json (higher seedVersion) is merged in ONCE:
      // missing channels/videos are added and the schedule is installed. Admin edits/deletes are not overwritten.
      const fileCat = readCatalogFile();
      if ((fileCat.seedVersion || 0) > (cat.seedVersion || 0)) {
        cat.channels = cat.channels || []; cat.videos = cat.videos || [];
        const haveCh = new Set(cat.channels.map(c => c.id));
        for (const c of fileCat.channels || []) if (!haveCh.has(c.id)) cat.channels.push(c);
        const haveV = new Set(cat.videos.map(v => v.id));
        const haveSrc = new Set(cat.videos.map(v => v.source));
        let added = 0;
        for (const v of fileCat.videos || []) if (!haveV.has(v.id) && !haveSrc.has(v.source)) { cat.videos.push(v); added++; }
        // fill in missing durations from the seed (needed for the schedule clock)
        const seedDur = new Map((fileCat.videos || []).map(v => [v.id, v.duration]));
        for (const v of cat.videos) if (!/^\d+(:\d+)+$/.test(v.duration || '') && seedDur.get(v.id)) v.duration = seedDur.get(v.id);
        // videos the seed explicitly retires (removed on purpose, so they must leave MongoDB too)
        if (Array.isArray(fileCat.seedRemoveSources) && fileCat.seedRemoveSources.length) {
          const gone = new Set(fileCat.seedRemoveSources);
          cat.videos = cat.videos.filter(v => !gone.has(v.source));
        }
        if (!cat.schedule && fileCat.schedule) cat.schedule = fileCat.schedule;
        // shuffle all versions of the signature song (e.g. every "Let It Rain") instead of a single video
        const fs_ = fileCat.schedule && fileCat.schedule.signature;
        if (fs_ && fs_.category && cat.schedule && cat.schedule.signature && !cat.schedule.signature.category) {
          cat.schedule.signature.category = fs_.category; cat.schedule.signature.maxMinutes = fs_.maxMinutes || 14;
        }
        // install new timed breaks (e.g. DWIM TV 1 Year) if the live schedule has none yet
        if (cat.schedule && fileCat.schedule && fileCat.schedule.breaks) cat.schedule.breaks = fileCat.schedule.breaks; // seed v9: DWIM TV breaks every 10 minutes
        // seed v19: add the daily "Kids Moment" block (and the split afternoon) if the live schedule lacks it
        if (cat.schedule && fileCat.schedule && fileCat.schedule.blocks && !(cat.schedule.blocks || []).some(b => b.id === 'kids')) cat.schedule.blocks = fileCat.schedule.blocks;
        // seed v21: curated song playlists ("DWIM TV Best Songs" and more). Add the ones the live catalog lacks, never overwrite admin edits.
        if (Array.isArray(fileCat.playlists)) {
          cat.playlists = cat.playlists || [];
          const havePl = new Set(cat.playlists.map(p => p.id));
          for (const p of fileCat.playlists) if (!havePl.has(p.id)) cat.playlists.push(p);
        }
        // keep the original "Let It Rain" in the same category as its new versions
        for (const v of cat.videos) if (v.id === 'gc-rain' && fs_ && fs_.category) v.category = fs_.category;
        cat.seedVersion = fileCat.seedVersion;
        await db.saveCatalog(cat);
        console.log(`🌱 Seed v${cat.seedVersion} merged into MongoDB (+${added} videos)`);
      }
      catalogCache = cat;
      const savedLive = await db.loadLive();
      if (savedLive && savedLive.source && Date.now() - savedLive.startedAt < LIVE_MAX_MS) liveNow = savedLive;
      console.log(`🍃 MongoDB connected — ${(cat.videos || []).length} videos, ${(cat.channels || []).length} channels`);
    } catch (e) {
      console.error('⚠️  MongoDB connection failed, falling back to data/videos.json:', e.message);
    }
  } else {
    console.log('ℹ️  MONGODB_URI not set — using data/videos.json');
  }
  app.listen(PORT, () => {
    console.log(`✝️ DWIM TV — Destiny Word International Ministries is live on port ${PORT}`);
    console.log('   Raising a people of destiny through the Word.');
  });
}
init();
