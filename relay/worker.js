// God's Eye Lite — flight relay (Cloudflare Worker, free tier).
// Flight APIs don't send CORS headers for other sites, and several throttle shared cloud IPs,
// so this Worker forwards ONLY the flight queries the app uses, tries several free aggregators in
// order, adds CORS for your site, and caches briefly.
//
// Deploy: automatic via .github/workflows/relay.yml (needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
// repo secrets), or paste into the dashboard editor. ALLOWED_ORIGINS (wrangler.toml / dashboard variable)
// overrides DEFAULT_ORIGINS below.

const DEFAULT_ORIGINS = 'https://cptnope.github.io';
const UA = 'gods-eye-lite-relay/1.1 (+https://github.com/CptNope/gods-eye-lite)';

// Same readsb-style JSON from each; tried in order until one answers 200.
const POINT = [
  ['adsb.lol', (la, lo, d) => `https://api.adsb.lol/v2/lat/${la}/lon/${lo}/dist/${d}`],
  ['airplanes.live', (la, lo, d) => `https://api.airplanes.live/v2/point/${la}/${lo}/${d}`],
  ['adsb.fi', (la, lo, d) => `https://opendata.adsb.fi/api/v2/lat/${la}/lon/${lo}/dist/${d}`],
];
const MIL = [
  ['adsb.lol', () => 'https://api.adsb.lol/v2/mil'],
  ['airplanes.live', () => 'https://api.airplanes.live/v2/mil'],
  ['adsb.fi', () => 'https://opendata.adsb.fi/api/v2/mil'],
];

const ROUTES = [
  { re: /^\/v2\/lat\/(-?\d{1,2}(?:\.\d+)?)\/lon\/(-?\d{1,3}(?:\.\d+)?)\/dist\/(\d{1,3})$/, list: POINT, ttl: 10 },
  { re: /^\/v2\/mil$/, list: MIL, ttl: 15 },
  { re: /^\/opensky\/states\/all$/, list: [['OpenSky', (q) => `https://opensky-network.org/api/states/all${q}`]], ttl: 15, query: /^\?lamin=-?[\d.]+&lomin=-?[\d.]+&lamax=-?[\d.]+&lomax=-?[\d.]+$/ },
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean);
    const originOk = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': originOk ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Expose-Headers': 'X-Upstream',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors);
    if (!originOk) return json({ error: 'origin not allowed' }, 403, cors);

    const route = ROUTES.find((r) => r.re.test(url.pathname));
    if (!route || (route.query ? !route.query.test(url.search) : url.search)) return json({ error: 'not found' }, 404, cors);
    const args = route.query ? [url.search] : url.pathname.match(route.re).slice(1);

    // Cache on OUR canonical URL so every upstream shares one cache entry.
    const cache = caches.default;
    const cacheKey = new Request(`https://relay.cache${url.pathname}${url.search}`);
    const hit = await cache.match(cacheKey);
    if (hit) return withHeaders(hit, cors);

    const tried = [];
    for (const [name, build] of route.list) {
      try {
        const up = await fetch(build(...args), { headers: { 'User-Agent': UA, Accept: 'application/json' } });
        if (!up.ok) { tried.push(`${name}:${up.status}`); continue; }
        const data = await up.json();
        if (!data.ac && Array.isArray(data.aircraft)) data.ac = data.aircraft; // normalise field name
        delete data.aircraft;
        const res = new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${route.ttl}`, 'X-Upstream': name },
        });
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return withHeaders(res, cors);
      } catch (e) {
        tried.push(`${name}:error`);
      }
    }
    return json({ error: 'all upstreams failed', tried }, 502, cors);
  },
};

function withHeaders(res, headers) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
