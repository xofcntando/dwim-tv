# ✝️ DWIM TV — Destiny Word International Ministries

**DWIM TV** is the official media channel of **Destiny Word International Ministries (DWIM)** — a Spirit-filled ministry in Old Ascot, Gweru, Zimbabwe, led by **Apostle Godfrey** and **Apostle Teckla**.

Built in the spirit of platforms like Emmanuel TV, DWIM TV lets the whole world join the ministry:

- **Live Sunday Services** — an ON AIR banner + countdown to the next service (Sundays, 11:00 AM CAT)
- **Sermons & Messages** — watch anointed teachings on demand
- **Prayer & Deliverance** — pray along from anywhere; *distance is not a barrier*
- **Worship & Songs** — the DWIM sound
- **Testimonies** — what God is doing among His people
- **Giving & Partnership** — sow into destiny, become a DWIM Partner
- **Admin Panel** (`/admin.html`) — add videos by YouTube URL straight from the browser; changes auto-commit back to the GitHub repo

## Purpose

DWIM TV exists so the Word, worship and prayer of Destiny Word International Ministries reach every home and phone in the world, day and night. **Distance is not a barrier.** DWIM TV was **built in Zimbabwe by Ntandomods (age 20)**.

### DWIM TV breaks (every 10 minutes)

Short branded DWIM TV videos (`public/breaks/`, channel `ch-breaks`) play on air **every 10 minutes**, taking turns. They never remove the sermon: the programme clock pauses during the break and the sermon resumes exactly where it stopped. Breaks never land on top of the Let It Rain signature slots.

```json
"breaks": [{ "label": "DWIM TV", "videoIds": ["brk-reel"], "everyMinutes": 10 }]
```

Use `times: ["08:00", "16:00"]` instead of `everyMinutes` for fixed clock times. To add a new break video, add it to `ch-breaks` and list its id in `videoIds`.

## The Big Idea (read this first!)

Render's free tier has **ephemeral storage** — any video file uploaded to the server gets wiped on every redeploy. **DWIM TV solves this differently:** the app stores *no video files*. It streams everything from external sources:

- **YouTube embeds** — add any YouTube video by its URL
- **Vimeo/Dailymotion embeds** — generic iframe support
- **Direct MP4/HLS links** — e.g. files hosted on GitHub Releases, Cloudflare R2, Internet Archive

The catalog lives in one small JSON file (`data/videos.json`) — including the **church info** (service times, location, contact, giving details), the **live stream** setting, **channels** and **videos**. Edit that file and push (or use the admin panel). No video ever touches the server.

## Quick Start (local)

```bash
npm install
npm start
# → http://localhost:3000
```

## Deploy to Render (free tier) — 5 steps

1. Push this folder to a GitHub repo (public or private).
2. On [render.com](https://render.com) → **New → Web Service**.
3. Connect the repo. Render reads `render.yaml` automatically, but if it asks:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
   - **Plan:** Free
4. Deploy — you get `https://dwim-tv.onrender.com` (or your custom name).
5. Keep it alive: free tier services sleep after 15 min of inactivity. A free uptime pinger ([cron-job.org](https://cron-job.org) or [UptimeRobot](https://uptimerobot.com)) pinging `https://YOURAPP.onrender.com/healthz` every 10 minutes prevents sleep.

## MongoDB (persistent storage)

DWIM TV stores its catalog (channels, videos, church info), the live-stream state and **prayer requests** in MongoDB when `MONGODB_URI` is set. Admin-panel edits are saved instantly and survive Render redeploys, with no GitHub commits needed.

1. Create a free cluster at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) (M0), add a database user, and under *Network Access* allow `0.0.0.0/0`.
2. Copy the connection string (`mongodb+srv://USER:PASS@cluster.mongodb.net/`).
3. In Render → Environment add `MONGODB_URI` (optional: `MONGODB_DB`, default `dwimtv`).
4. Deploy. On first start MongoDB is seeded automatically from `data/videos.json`.

Without `MONGODB_URI` the app still works exactly as before using `data/videos.json` (and GitHub sync).

## Install on phones and PCs (PWA)

DWIM TV is an installable Progressive Web App (manifest + service worker):

- **Android / Chrome / Edge (phone or PC):** tap the **Install App** button in the top bar (or the browser's install icon).
- **iPhone / iPad:** Safari → Share → **Add to Home Screen** (the Install App button shows these steps).
- **Windows / Mac / Linux:** Chrome or Edge → install icon in the address bar. It opens in its own window like a normal app.

PWAs require HTTPS, which Render provides. Bump `VERSION` in `public/sw.js` to force installed apps to refresh their cache.

## Prayer requests

The **Submit a Prayer Request** button opens a form; requests are stored in MongoDB (rate-limited, spam honeypot) and appear in the admin panel under **Prayer Requests**, where the team can mark them *Prayed* or delete them.

## TV Schedule (Zimbabwe time, CAT)

DWIM TV runs a real daily programme, the same for every viewer worldwide. The plan lives in `schedule` inside the catalog and can be edited in the admin panel under **TV Schedule**.

| Time (CAT) | Block |
|---|---|
| 00:00 - 04:00 | Midnight Watch (prayer + worship) |
| 04:00 - 06:00 | Dawn Prayer |
| 06:00 - 09:00 | Morning Glory (worship) |
| 09:00 - 12:00 | The Word Hour (sermons) |
| 12:00 - 14:00 | Midday Miracles (prayer + faith messages) |
| 14:00 - 18:00 | Afternoon Teaching |
| **18:00 - 20:00** | **Worship Hour** (Jesus Culture, Zimbabwe gospel, Sinach, Hillsong, Elevation and more) |
| 20:00 - 24:00 | Evening Word & Prayer |
| Sundays 11:00 - 14:00 | Sunday Service |

**Let It Rain** (Jesus Culture) plays every day at **00:00, 06:00, 14:00 and 18:00** (midnight, morning, afternoon, evening).

Blocks pull from channels (`channels` or a weighted `mix`), skip videos longer than `maxMinutes`, and are shuffled with a daily seed so everyone sees the same order. New gospel songs are in the **Gospel Music** channel (`ch-gospel`). Existing MongoDB databases receive the new songs and schedule automatically once (via `seedVersion`).

## How to add videos (never touch Render!)

### Option 0 — the Admin Panel (easiest, no code!)

1. Open `https://YOURAPP.onrender.com/admin.html` (linked in the site footer).
2. Log in — set your credentials via environment variables (see below).
3. Paste any YouTube URL or video ID → click **Check** → the real title & channel are fetched from YouTube.
4. Pick a channel (or create a new one on the fly), hit **Add Video** — done.
5. The video appears on the site instantly, and the catalog change is **committed back to your GitHub repo automatically** (if you set `GITHUB_TOKEN`).

**Admin credentials** come from environment variables (set them in Render → Environment):

```
ADMIN_USER=ntando
ADMIN_PASS=<choose-a-strong-password>
GITHUB_TOKEN=ghp_xxxxxxxxxxxx        # a token with repo write access
GITHUB_REPO=mrnt4ndo/dwim-tv         # owner/name
GITHUB_BRANCH=main
```

> ⚠️ Change `ADMIN_PASS` before going public!

### Live Stream (Sunday Services)

Use the **Live Stream Control** in the admin panel: paste the YouTube live URL before a service and the site shows an ON AIR banner — the "Watch Live" buttons join the stream. Clear it after the service. You can also edit the `"live"` object in `data/videos.json` by hand:

```json
{
  "live": {
    "title": "DWIM TV Live — Sunday Service",
    "type": "youtube",
    "source": "https://www.youtube.com/watch?v=LIVE_ID"
  }
}
```

### 1. Videos (manual way)

Add an entry to `data/videos.json`:

```json
{
  "id": "v36",
  "title": "Sunday Service — Dismantling Strongholds",
  "channel": "ch-services",
  "category": "Sunday Service",
  "type": "youtube",
  "source": "https://www.youtube.com/watch?v=VIDEO_ID_HERE",
  "duration": "1:45:00",
  "thumb": "https://i.ytimg.com/vi/VIDEO_ID_HERE/hqdefault.jpg",
  "desc": "A short description of the message.",
  "tags": ["service", "dwim"]
}
```

The thumbnail URL pattern `https://i.ytimg.com/vi/VIDEO_ID/hqdefault.jpg` works for almost every video.

### 2. Church info (service times, contact, giving)

All site text (location, service times, contact links, giving details) lives in the `"church"` object of `data/videos.json`:

```json
{
  "church": {
    "name": "Destiny Word International Ministries",
    "location": "Old Ascot, Gweru, Zimbabwe",
    "services": [{ "name": "Sunday Service", "time": "Sundays · 11:00 AM (CAT)" }],
    "contact": { "facebook": "https://…", "whatsapp": "", "phone": "", "email": "" },
    "giving": { "bankName": "", "accountName": "", "accountNumber": "", "note": "…" }
  }
}
```

Fill in the WhatsApp number (`whatsapp`: international format, digits only), phone, email or Facebook — the **Prayer Request**, **Share Your Testimony** and **Giving** buttons automatically link to the best contact you provide. If you add a bank account number, a giving details box appears automatically on the site.

### 3. Channels

Channels are also in `data/videos.json`. Add one like:

```json
{ "id": "ch-conferences", "name": "Conferences", "icon": "✝" }
```

…then use `"channel": "ch-conferences"` on videos.

## Project structure

```
dwim-tv/
├── server.js            # Express server + catalog API + admin auth & GitHub sync
├── package.json
├── render.yaml          # Render blueprint (free plan)
├── Procfile             # Fallback for other hosts (Heroku-style)
├── data/
│   └── videos.json      # ⭐ YOUR CATALOG — church info, live stream, channels & videos
└── public/
    ├── index.html       # Church site (hero + countdown, watch, prayer, testimonies, giving, about, visit)
    ├── admin.html       # 🔒 Admin panel (login + add/delete videos + live stream control)
    ├── css/styles.css   # Royal blue + gold church theme
    ├── css/admin.css    # Admin panel styles
    ├── js/app.js        # Countdown, live stream, channels, search, player logic
    ├── js/admin.js      # Admin panel logic
    └── img/             # Logo, favicons, hero & apostles' photos
```

## Tips

- **Live streams** work too: set the live URL in the admin panel before every service.
- **Start times**: add `"t": 30` to any video to make it start at 30 seconds in.
- **Copyright**: only stream videos you have the right to embed. YouTube's embed feature is provided by the uploader; if a video shows "embedding disabled", it won't play in the app — pick another upload.
- **Free tier limits**: 750 hours/month of runtime — plenty for a ministry channel.

## License

MIT — do whatever you want. Demo catalog content is publicly available media from YouTube.
