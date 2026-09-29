// Build data/cctv.json at deploy time (GitHub Actions), not in the browser.
//
// Most city camera LISTS refuse browser requests (no CORS) — but their still IMAGES embed fine.
// So the Pages workflow runs this script on a GitHub runner: it reuses the MIT-licensed CCTV
// loaders from God's Eye View (pinned commit, cloned to $GEV_DIR), keeps only cameras with a
// directly embeddable still image, and writes a compact catalog the app loads same-origin.
//
// Usage: GEV_DIR=/path/to/gods-eye-view node scripts/build-cctv.mjs [out=data/cctv.json]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const GEV_DIR = process.env.GEV_DIR;
const OUT = process.argv[2] || 'data/cctv.json';
if (!GEV_DIR) { console.error('GEV_DIR not set'); process.exit(1); }

// Per-region caps (defaults upstream are tuned for a local 3D client; keep ours light for phones).
process.env.CCTV_AUSTIN_MAX_SOURCES ??= '250';
process.env.CCTV_CALTRANS_MAX_SOURCES ??= '400';
process.env.CCTV_TFL_MAX_SOURCES ??= '400';
process.env.CCTV_ONTARIO_MAX_SOURCES ??= '400';
process.env.CCTV_FINTRAFFIC_MAX_SOURCES ??= '300';
process.env.CCTV_DRIVEBC_MAX_SOURCES ??= '300';
process.env.CCTV_NSW_MAX_SOURCES ??= '250';
process.env.CCTV_MAX_SOURCES ??= '4000';

// Only still-image hosts the page's Content-Security-Policy allows (img-src). A camera whose
// frame lives anywhere else is dropped rather than widening the policy silently.
export const IMAGE_HOSTS = [
  'cctv.austinmobility.io',
  'cwwp2.dot.ca.gov',
  's3-eu-west-1.amazonaws.com',
  '511on.ca',
  'weathercam.digitraffic.fi',
  'www.drivebc.ca',
  'ristmikud.tallinn.ee',
  'tarktee.transpordiamet.ee',
  'webcams.transport.nsw.gov.au',
  'trafficcam.calgary.ca',
  'webcam.warendorf.de',
];

const catalogUrl = pathToFileURL(path.join(GEV_DIR, 'server/providers/cctv/catalog.js')).href;
const { createCctvCatalog } = await import(catalogUrl);
const getSources = createCctvCatalog({ sourceRoot: GEV_DIR });
const sources = await getSources();

const round = (n, d = 5) => Math.round(n * 10 ** d) / 10 ** d;
const byRegion = {};
const dropped = {};
const cams = [];
for (const s of sources) {
  const region = s.city && s.cityId ? s.cityId : (s.sourceKind || 'other');
  const img = String(s.snapshotUrl || (s.feedType === 'image' ? s.url : '') || '');
  let host = '';
  try { host = new URL(img).hostname; } catch { /* not a URL */ }
  const ok = img.startsWith('https://') && IMAGE_HOSTS.includes(host) && /\.(jpe?g|png)(\?|$)|\/image\/|\/Cctv\/|\/images\//i.test(img);
  const kind = s.sourceKind || region;
  if (!ok || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) { dropped[kind] = (dropped[kind] || 0) + 1; continue; }
  cams.push({
    id: String(s.id),
    n: String(s.name || s.id).slice(0, 120),
    c: String(s.city || ''),
    p: String(s.provider || ''),
    la: round(s.lat), lo: round(s.lon),
    h: Number.isFinite(s.headingDeg) && s.headingConfidence === 'high' ? Math.round(s.headingDeg) : null,
    i: img,
    l: String(s.license || ''),
  });
  byRegion[s.provider || kind] = (byRegion[s.provider || kind] || 0) + 1;
}

const out = { built: new Date().toISOString(), source: 'God\'s Eye View CCTV loaders (MIT), pinned', count: cams.length, providers: byRegion, cams };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`CCTV catalog: ${cams.length} cameras → ${OUT} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
console.log('By provider:', JSON.stringify(byRegion));
console.log('Dropped (no embeddable still on an allowed host):', JSON.stringify(dropped));
if (!cams.length) { console.error('No cameras built — failing so the previous deploy stays live.'); process.exit(1); }
