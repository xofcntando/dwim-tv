const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const S = require('../public/js/schedule.js');
const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'videos.json'), 'utf8'));

test('something is always on air, every 5 minutes for a week', () => {
  const start = Date.UTC(2026, 10, 1);
  for (let ms = start; ms < start + 7 * 86400000; ms += 300000) {
    const r = S.resolve(cat, ms);
    assert.ok(r && r.video && r.video.id, 'nothing on air at ' + new Date(ms).toISOString());
    assert.ok(r.offset >= 0, 'negative offset at ' + new Date(ms).toISOString());
  }
});

test('every viewer sees the same programme (deterministic)', () => {
  const t = Date.UTC(2026, 10, 4, 10, 30);
  assert.strictEqual(S.resolve(cat, t).video.id, S.resolve(cat, t).video.id);
});

test('day grid has blocks that cover the day without overlap', () => {
  for (let d = 0; d < 7; d++) {
    const g = S.dayGrid(cat, Date.UTC(2026, 10, 1 + d, 10));
    assert.ok(g.length > 3);
    for (let i = 1; i < g.length; i++) assert.ok(g[i].startMs >= g[i - 1].endMs - 1);
  }
});

test('catalog videos are well formed', () => {
  const ids = new Set();
  for (const v of cat.videos) {
    assert.ok(v.id && v.title && v.source, 'bad video ' + JSON.stringify(v).slice(0, 80));
    assert.ok(!ids.has(v.id), 'duplicate id ' + v.id); ids.add(v.id);
    assert.ok(cat.channels.some(c => c.id === v.channel), 'unknown channel for ' + v.id);
  }
});
