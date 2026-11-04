#!/usr/bin/env node
/* Checks every YouTube video in data/videos.json with YouTube's oEmbed endpoint.
   Reports videos that are private, deleted or not embeddable (they show a grey tile and skip on air).
   Usage: node scripts/check-videos.js [--remove]   (--remove writes a cleaned copy to data/videos.cleaned.json) */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'data', 'videos.json');
const cat = JSON.parse(fs.readFileSync(file, 'utf8'));
const idOf = (u) => { const m = String(u).match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/); return m && m[1]; };

async function check(v) {
  const id = idOf(v.source);
  if (!id) return { v, ok: v.type !== 'youtube', why: 'bad link' };
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`);
    return { v, ok: r.ok, why: r.ok ? '' : 'HTTP ' + r.status + (r.status === 401 ? ' (embedding disabled)' : r.status === 404 ? ' (deleted/private)' : '') };
  } catch (e) { return { v, ok: true, why: 'network error, skipped' }; }
}

(async () => {
  const yt = cat.videos.filter(v => v.type === 'youtube');
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (i < yt.length) out.push(await check(yt[i++])); }));
  const bad = out.filter(x => !x.ok);
  console.log(`Checked ${yt.length} YouTube videos. Problems: ${bad.length}`);
  bad.forEach(x => console.log(`- ${x.v.id}  ${x.why}  [${x.v.channel}]  ${x.v.title}`));
  if (process.argv.includes('--remove') && bad.length) {
    const gone = new Set(bad.map(x => x.v.id));
    const cleaned = { ...cat, videos: cat.videos.filter(v => !gone.has(v.id)) };
    fs.writeFileSync(path.join(__dirname, '..', 'data', 'videos.cleaned.json'), JSON.stringify(cleaned, null, 2) + '\n');
    console.log('Wrote data/videos.cleaned.json without them.');
  }
})();
