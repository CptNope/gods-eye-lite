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
| 📷 ~2,400 public traffic cameras with live stills: London, California, Finland, British Columbia, Tallinn, Austin, Sydney, Calgary | Catalog built daily on GitHub Actions with God's Eye View's MIT CCTV loaders; images load straight from each operator | none |
| 🔎 Address & place search with suggestions, plus 📍 your device location | Photon (komoot) type-ahead, Nominatim on Enter, both OpenStreetMap; browser Geolocation API | none |
| 🌧️ Rain radar with 3-hour playback | RainViewer (global) or NOAA nowCOAST (US high-res) | none |
| ☁️ Satellite clouds (IR) + ⚡ lightning density | NOAA nowCOAST | none |
| 🌬️ Animated 10 m wind | Open-Meteo | none |
| 🌀 Tropical cyclone cones, tracks, positions | NOAA NHC / CPHC | none |
| ⚠️ Active warnings & advisories (US) | NWS api.weather.gov | none |
| 🗺️ Basemaps: Esri satellite, NASA GIBS "yesterday", CARTO streets/dark | Esri / NASA / CARTO | none |
| 🏙️ Google Photorealistic 3D + world terrain | Cesium ion, or Google Map Tiles API direct | your key (optional) |

Plus: CRT / NVG / FLIR / Noir sensor shaders (keys `1`–`5`), click-to-inspect cards, follow-cam for aircraft and satellites, share links that restore camera + layers + sensor, offline app shell, and a tile cache so revisited areas load offline.

## Deploy (≈2 minutes)

1. Create a new public repo on GitHub (e.g. `gods-eye-lite`) and upload **the contents of this folder** to the root of `main` (keep the hidden `.github/` folder and `.nojekyll`).
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The *Deploy to GitHub Pages* workflow runs on every push. Your app lands at
   `https://<your-user>.github.io/<repo>/`.
4. Open it on your phone → browser menu → **Add to Home Screen / Install**.

Everything uses relative paths, so it works under a project sub-path or a custom domain unchanged.

## Flights (parked)

**Status, 2026-09-29:** a Cloudflare Worker relay was deployed and tested, but every free flight source refuses Cloudflare's network — adsb.lol `429`, airplanes.live `403`, adsb.fi `403`, OpenSky `522` (connection refused before any login, so an OpenSky account doesn't help). Flights are therefore off by default. To revive them, run the same relay logic on an ordinary server (e.g. a small DigitalOcean droplet) after confirming `curl -s -o /dev/null -w "%{http_code}" https://api.adsb.lol/v2/mil` returns `200` from it, then add that host to `connect-src` in the CSP and set `RELAY_URL`.

### Original relay notes

Tested in a real browser on 2026-09-29: adsb.lol, OpenSky, airplanes.live, adsb.fi and adsb.one all refuse direct browser requests from other websites (no CORS header). Everything else — CelesTrak, USGS, Launch Library 2, Esri, NASA GIBS, CARTO and the CDN — works directly.

`relay/worker.js` is a locked-down Cloudflare Worker that forwards **only** the three flight endpoints, adds CORS for your site, and caches for 10–15 s. It deploys itself from GitHub:

1. **Cloudflare:** [dash.cloudflare.com](https://dash.cloudflare.com) → *Workers & Pages*. If it asks, pick your free `workers.dev` subdomain. Copy the **Account ID** shown on that page.
2. **API token:** *My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"* template → Account Resources: your account → Zone Resources: *All zones* (or none) → Create. Copy it (shown once).
3. **GitHub:** repo *Settings → Secrets and variables → Actions → New repository secret*: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. **Actions → "Deploy flight relay" → Run workflow.** The log prints the Worker URL (`https://gel-relay.<subdomain>.workers.dev`).
5. Put that URL in `js/config.js` → `RELAY_URL` and push. Allowed sites are set in `relay/wrangler.toml` (`ALLOWED_ORIGINS`).

Any later change under `relay/` redeploys automatically.

Free tier = 100,000 requests/day; with the built-in caching one active viewer uses roughly 400 requests/hour.

## Traffic cameras: how the catalog works

Most operators' camera *lists* refuse browser requests (no CORS), but their still *images* embed fine. So `scripts/build-cctv.mjs` runs inside the Pages workflow: it checks out God's Eye View at a pinned commit (`GEV_SHA` in `.github/workflows/pages.yml`), runs its CCTV loaders on the GitHub runner, keeps cameras whose still image is on an allowed host, and publishes `data/cctv.json` (~590 KB, gzip-served). A daily scheduled run keeps it fresh; if a source is down the deploy still ships. Image hosts are allowlisted in both the script and the page's CSP `img-src` — add a host to both to add a region. Not included: Ontario 511 (list unreachable from GitHub runners at build time), TxDOT (snapshot API isn't a plain image), Delaware (video-only), Estonia highways.

## API keys: bring your own, encrypted on your device

Open **⚡ Power up (API keys)**. The first time, you create a **key vault** with a passphrase; after that the app asks you to unlock it once per session (or you skip and run keyless). The 🔒/🔓 chip top-right shows the state.

**How keys are protected**
- **Encrypted at rest.** AES-256-GCM with a key derived from your passphrase (PBKDF2-SHA-256, 600,000 iterations, random salt; fresh nonce on every save). `localStorage` only ever holds ciphertext, so a copied profile, backup or stolen disk yields nothing usable. Code: `js/vault.js`.
- **Memory only when unlocked.** The derived key is a non-extractable `CryptoKey`; the passphrase is never stored. Lock, or closing the tab, wipes the plaintext keys.
- **Can't be sent anywhere unexpected.** A Content-Security-Policy in `index.html` only lets the page talk to the listed providers (and `*.workers.dev` for your relay), and only load code from itself and jsDelivr.
- **Never on anyone else's machine.** Each visitor's keys stay in their own browser. Relay-routed keys (FIRMS, AISStream — coming) will be forwarded per request by *your* Worker and never stored there.

**The honest limit:** while unlocked, a script running *on this page* could use your keys — that's true of any browser app. The CSP narrows that sharply; the backstop is restricting each key at its provider:

| Key | Restrict it like this |
|---|---|
| Cesium ion | Scope `assets:read` only; Allowed URLs = your Pages URL |
| Google Map Tiles | API restriction = Map Tiles API; HTTP referrer = your site; budget alert |
| TomTom / OpenAI (coming) | Domain restriction / project key with a monthly cap |

No recovery: if you forget the passphrase, choose *Forget vault* and re-enter keys. Upgrading from the first version moves any unencrypted ion token into the vault and deletes the plaintext copy.

## What didn't come over from the full app (and why)

The original is a Vite app with a Node server that brokers secrets. GitHub Pages can only serve static files, so these were left out:

- **Ships (AISStream), fires (NASA FIRMS), TomTom traffic, OpenAI voice** — each needs a secret key that would be exposed in a public static site, or a WebSocket/proxy server.
- **CCTV mesh, transit, radio, ALPR, weather overlays** — keyless upstream, but most city feeds don't send CORS headers, so browsers block direct calls. They'd need a small proxy (e.g. a Cloudflare Worker free tier) — a good next step if you want them.

## Notes & limits

- Feed quotas are the providers'. adsb.lol is polled every 15 s (civil) / 20 s (military); CelesTrak TLEs cache 2 h; Launch Library 2 caches 1 h (anonymous limit is ~15 requests/hour).
- Flights show **needs relay** until a relay URL is set. The relay must be on `*.workers.dev` (or add your custom domain to `connect-src` in the CSP).
- Weather imagery draws on the globe surface, so it's hidden while Photorealistic 3D is on.
- If a layer shows **blocked/offline**, that provider refused the browser request (CORS change, rate limit, or ad-blocker). Others keep working independently.
- Exploratory visualization only — data can be delayed or wrong. Don't use it for navigation or safety decisions.

## Credits

Concept and data-source map from [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) by Bilawal Sidhu & Sameh Khamis (MIT). This is an independent, from-scratch lite client, not affiliated with Halfpixel. Data © their respective providers: adsb.lol (ODbL), OpenSky Network, CelesTrak, USGS, The Space Devs, Esri, NASA GIBS, OpenStreetMap contributors / CARTO, Cesium / Google.
