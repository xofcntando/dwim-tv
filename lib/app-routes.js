/* DWIM TV app routes: audience stats (views, live viewers), events & announcements, SEO files.
   Registered from server.js before the SPA fallback. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const VIEWS_FILE = path.join(os.tmpdir(), 'dwim-views.json');
const PRESENCE_TTL = 75 * 1000;          // a viewer counts as "watching" for 75s after their last heartbeat
const VIEW_DEDUPE_MS = 30 * 60 * 1000;   // one view per device per video per 30 min

function register(app, deps) {
  const { db, readCatalog, writeCatalog, syncCatalogToGitHub, requireAdmin } = deps;

  /* ---------- Views ---------- */
  let views = null;                      // { videoId: count }
  let dirty = false;
  async function loadViews() {
    if (views) return views;
    views = {};
    try {
      if (db.isConnected && db.isConnected() && db.loadViews) views = await db.loadViews();
      else views = JSON.parse(fs.readFileSync(VIEWS_FILE, 'utf8'));
    } catch (e) { views = views || {}; }
    return views;
  }
  const pending = {};                    // increments not yet flushed to MongoDB
  async function flush() {
    if (!dirty) return;
    dirty = false;
    try {
      if (db.isConnected && db.isConnected() && db.incViews) {
        const batch = Object.assign({}, pending);
        for (const k of Object.keys(batch)) delete pending[k];
        await db.incViews(batch);
      } else {
        fs.writeFileSync(VIEWS_FILE, JSON.stringify(views || {}));
      }
    } catch (e) { dirty = true; }
  }
  setInterval(flush, 30000).unref();
  process.on('SIGTERM', () => { flush().finally(() => process.exit(0)); });

  const seen = new Map();                // ip|id -> ts
  app.post('/api/view', async (req, res) => {
    const id = String((req.body || {}).id || '').slice(0, 40);
    const cat = readCatalog();
    if (!id || !(cat.videos || []).some(v => v.id === id)) return res.status(400).json({ ok: false });
    const key = req.ip + '|' + id, now = Date.now();
    if (now - (seen.get(key) || 0) < VIEW_DEDUPE_MS) return res.json({ ok: true, counted: false });
    seen.set(key, now);
    if (seen.size > 20000) for (const [k, t] of seen) if (now - t > VIEW_DEDUPE_MS) seen.delete(k);
    const v = await loadViews();
    v[id] = (v[id] || 0) + 1; pending[id] = (pending[id] || 0) + 1; dirty = true;
    res.json({ ok: true, counted: true });
  });

  /* ---------- Live viewers (presence) ---------- */
  const presence = new Map();            // sid -> ts
  function watching() {
    const now = Date.now();
    for (const [k, t] of presence) if (now - t > PRESENCE_TTL) presence.delete(k);
    return presence.size;
  }
  app.post('/api/heartbeat', (req, res) => {
    const sid = String((req.body || {}).sid || '').replace(/[^\w-]/g, '').slice(0, 40);
    if (sid.length >= 8) presence.set(sid, Date.now());
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, watching: watching() });
  });

  app.get('/api/stats', async (req, res) => {
    const v = await loadViews();
    const cat = readCatalog();
    const valid = new Set((cat.videos || []).map(x => x.id));
    const trending = Object.entries(v).filter(([id]) => valid.has(id))
      .sort((a, b) => b[1] - a[1]).slice(0, 24).map(([id, views]) => ({ id, views }));
    res.set('Cache-Control', 'public, max-age=30');
    res.json({ ok: true, watching: watching(), trending });
  });

  /* ---------- Events & announcements (admin-managed, served inside /api/catalog) ---------- */
  function validateEvents(events, notices) {
    if (!Array.isArray(events) || !Array.isArray(notices)) return 'Events and announcements must be lists';
    if (events.length > 60 || notices.length > 30) return 'Too many entries';
    for (const e of events) {
      if (!e.title || !String(e.title).trim()) return 'Every event needs a title';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) return `Event "${e.title}": date must look like 2026-12-25`;
      if (e.time && !/^\d{2}:\d{2}$/.test(e.time)) return `Event "${e.title}": time must look like 18:00`;
    }
    for (const n of notices) if (!n.text || !String(n.text).trim()) return 'Every announcement needs text';
    return null;
  }
  const clip = (s, n) => String(s || '').trim().slice(0, n);

  app.get('/api/admin/events', requireAdmin, (req, res) => {
    const c = readCatalog();
    res.json({ ok: true, events: c.events || [], announcements: c.announcements || [] });
  });
  app.put('/api/admin/events', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const err = validateEvents(b.events, b.announcements);
    if (err) return res.status(400).json({ ok: false, error: err });
    const cat = readCatalog();
    cat.events = b.events.map(e => ({ title: clip(e.title, 120), date: e.date, time: clip(e.time, 5), place: clip(e.place, 120), desc: clip(e.desc, 400) }))
      .sort((a, c) => (a.date + (a.time || '')).localeCompare(c.date + (c.time || '')));
    cat.announcements = b.announcements.map(n => ({ text: clip(n.text, 240), link: clip(n.link, 300), until: /^\d{4}-\d{2}-\d{2}$/.test(n.until || '') ? n.until : '' }));
    await writeCatalog(cat);
    const gh = await syncCatalogToGitHub();
    res.json({ ok: true, events: cat.events, announcements: cat.announcements, github: gh });
  });

  /* ---------- SEO ---------- */
  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /api/admin/\nSitemap: ${req.protocol}://${req.get('host')}/sitemap.xml\n`);
  });
  app.get('/sitemap.xml', (req, res) => {
    const base = `${req.protocol}://${req.get('host')}`;
    const urls = ['/', '/#/live', '/#/guide', '/#/ondemand', '/#prayer', '/#giving', '/#about'];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `<url><loc>${base}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
  });
}

module.exports = { register };
