# God's Eye Lite

A static, installable PWA that puts the **keyless** feeds from
[God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) on a CesiumJS 3D globe — and runs entirely on GitHub Pages. No server, no build step, no required keys.

## What's in it

| Layer | Source | Key |
|---|---|---|
| ✈️ Live flights (250 nm around your view) | adsb.lol → OpenSky anonymous fallback, **via your relay** | none (free Worker) |
| 🎖️ Military flights (global) | adsb.lol `/v2/mil`, **via your relay** | none (free Worker) |
| 🛰️ Satellites (SGP4 in-browser, orbit path on click) | CelesTrak TLEs + satellite.js | none |
| 🌍 Earthquakes, last 24h | USGS | none |
| 🚀 Upcoming launches + countdown list | Launch Library 2 (The Space Devs) | none |
| 🗺️ Basemaps: Esri satellite, NASA GIBS "yesterday", CARTO streets/dark | Esri / NASA / CARTO | none |
| 🏙️ Google Photorealistic 3D + world terrain | Cesium ion | free token (optional) |

Plus: CRT / NVG / FLIR / Noir sensor shaders (keys `1`–`5`), click-to-inspect cards, follow-cam for aircraft and satellites, share links that restore camera + layers + sensor, offline app shell, and a tile cache so revisited areas load offline.

## Deploy (≈2 minutes)

1. Create a new public repo on GitHub (e.g. `gods-eye-lite`) and upload **the contents of this folder** to the root of `main` (keep the hidden `.github/` folder and `.nojekyll`).
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The *Deploy to GitHub Pages* workflow runs on every push. Your app lands at
   `https://<your-user>.github.io/<repo>/`.
4. Open it on your phone → browser menu → **Add to Home Screen / Install**.

Everything uses relative paths, so it works under a project sub-path or a custom domain unchanged.

## Flights need a tiny relay (5 minutes, free)

Tested in a real browser on 2026-09-29: adsb.lol, OpenSky, airplanes.live, adsb.fi and adsb.one all refuse direct browser requests from other websites (no CORS header). Everything else — CelesTrak, USGS, Launch Library 2, Esri, NASA GIBS, CARTO and the CDN — works directly.

`relay/worker.js` is a locked-down Cloudflare Worker that forwards **only** the three flight endpoints, adds CORS for your site, and caches for 10–15 s:

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Create Worker** → name it `gel-relay` → **Deploy**.
2. **Edit code** → replace everything with `relay/worker.js` → **Deploy**.
3. Worker **Settings → Variables and Secrets → Add** `ALLOWED_ORIGINS` = `https://<your-user>.github.io` (add `,http://localhost:8080` for local testing).
4. Put the Worker URL (e.g. `https://gel-relay.<you>.workers.dev`) in `js/config.js` → `RELAY_URL`, commit, and Pages redeploys.
   (Or paste it under **⚡ Power up → Flight relay URL** to try it without committing.)

Free tier = 100,000 requests/day; with the built-in caching one active viewer uses roughly 400 requests/hour.

## Optional: photorealistic 3D

1. Sign up at [cesium.com/ion](https://cesium.com/ion/signup) (Community plan = personal, non-commercial).
2. **Access Tokens → Create token** with only `assets:read`, and under *Allowed URLs* add your Pages URL.
3. In the app: **⚡ Power up** → paste token → *Save & reload* → tick **Photorealistic 3D**.

The token lives only in that browser's `localStorage`. Because it's used from the browser, restricting its allowed URLs at ion is what protects it.

## What didn't come over from the full app (and why)

The original is a Vite app with a Node server that brokers secrets. GitHub Pages can only serve static files, so these were left out:

- **Ships (AISStream), fires (NASA FIRMS), TomTom traffic, OpenAI voice** — each needs a secret key that would be exposed in a public static site, or a WebSocket/proxy server.
- **CCTV mesh, transit, radio, ALPR, weather overlays** — keyless upstream, but most city feeds don't send CORS headers, so browsers block direct calls. They'd need a small proxy (e.g. a Cloudflare Worker free tier) — a good next step if you want them.

## Notes & limits

- Feed quotas are the providers'. adsb.lol is polled every 15 s (civil) / 20 s (military); CelesTrak TLEs cache 2 h; Launch Library 2 caches 1 h (anonymous limit is ~15 requests/hour).
- Flights show **needs relay** until a relay URL is set.
- If a layer shows **blocked/offline**, that provider refused the browser request (CORS change, rate limit, or ad-blocker). Others keep working independently.
- Exploratory visualization only — data can be delayed or wrong. Don't use it for navigation or safety decisions.

## Credits

Concept and data-source map from [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) by Bilawal Sidhu & Sameh Khamis (MIT). This is an independent, from-scratch lite client, not affiliated with Halfpixel. Data © their respective providers: adsb.lol (ODbL), OpenSky Network, CelesTrak, USGS, The Space Devs, Esri, NASA GIBS, OpenStreetMap contributors / CARTO, Cesium / Google.
