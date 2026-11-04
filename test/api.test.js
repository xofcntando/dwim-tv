const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');

const PORT = 3917;
let proc;
const url = (p) => `http://127.0.0.1:${PORT}${p}`;

test.before(async () => {
  proc = spawn(process.execPath, ['server.js'], { cwd: require('path').join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), MONGODB_URI: '', MONGO_URL: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { const r = await fetch(url('/healthz')); if (r.ok) return; } catch (e) { /* not up yet */ } await new Promise(r => setTimeout(r, 150)); }
  throw new Error('server did not start');
});
test.after(() => proc && proc.kill());

const post = (p, body) => fetch(url(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('catalog is served', async () => {
  const j = await (await fetch(url('/api/catalog'))).json();
  assert.ok(j.videos.length > 100 && j.channels.length > 3 && j.schedule);
});
test('heartbeat counts viewers', async () => {
  await post('/api/heartbeat', { sid: 'testsession0001' });
  const j = await (await post('/api/heartbeat', { sid: 'testsession0002' })).json();
  assert.ok(j.watching >= 2);
});
test('views are counted once per device and appear in trending', async () => {
  const cat = await (await fetch(url('/api/catalog'))).json();
  const id = cat.videos[0].id;
  assert.strictEqual((await (await post('/api/view', { id })).json()).counted, true);
  assert.strictEqual((await (await post('/api/view', { id })).json()).counted, false);
  assert.strictEqual((await post('/api/view', { id: 'nope' })).status, 400);
  const st = await (await fetch(url('/api/stats'))).json();
  assert.ok(st.trending.some(t => t.id === id));
});
test('admin endpoints are protected', async () => {
  assert.strictEqual((await fetch(url('/api/admin/events'))).status, 401);
  assert.strictEqual((await fetch(url('/api/admin/events'), { method: 'PUT' })).status, 401);
});
test('robots and sitemap exist', async () => {
  assert.match(await (await fetch(url('/robots.txt'))).text(), /Sitemap:/);
  assert.match(await (await fetch(url('/sitemap.xml'))).text(), /<urlset/);
});

test('best songs playlists are served and only reference real videos', async () => {
  const j = await (await fetch(url('/api/catalog'))).json();
  assert.ok(Array.isArray(j.playlists) && j.playlists.length >= 3);
  assert.ok(j.playlists.some(p => p.id === 'pl-best' && p.featured));
  const ids = new Set(j.videos.map(v => v.id));
  for (const p of j.playlists) {
    assert.ok(p.name && p.videoIds.length > 3, p.id);
    for (const id of p.videoIds) assert.ok(ids.has(id), `${p.id} references missing video ${id}`);
  }
});
test('Ntandomods brand is present on the site', async () => {
  const html = await (await fetch(url('/'))).text();
  assert.ok(/Ntandomods/i.test(html) && html.includes('name="author" content="Ntandomods"'));
  assert.strictEqual((await fetch(url('/img/ntandomods-mark.svg'))).status, 200);
});
