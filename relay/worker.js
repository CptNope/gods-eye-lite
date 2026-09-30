// God's Eye Lite — flight relay (Cloudflare Worker, free tier).
// Flight APIs don't send CORS headers for other sites, and several throttle shared cloud IPs,
// so this Worker forwards ONLY the flight queries the app uses, tries several free aggregators in
// order, adds CORS for your site, and caches briefly.
//
// Deploy: automatic via .github/workflows/relay.yml (needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
// repo secrets), or paste into the dashboard editor. ALLOWED_ORIGINS (wrangler.toml / dashboard variable)
// overrides DEFAULT_ORIGINS below.

const DEFAULT_ORIGINS = 'https://cptnope.github.io';
const UA = 'gods-eye-lite-relay/1.3 (+https://github.com/CptNope/gods-eye-lite)';

// Same readsb-style JSON from each; tried in order until one answers 200.
// Each upstream is { name, url(a) } where `a` is the list of values captured from the request path/query.
/** @typedef {{ name: string, url: (a: string[]) => string }} Upstream */
/** @type {Upstream[]} */
const POINT = [
  { name: 'adsb.lol', url: (a) => `https://api.adsb.lol/v2/lat/${a[0]}/lon/${a[1]}/dist/${a[2]}` },
  { name: 'airplanes.live', url: (a) => `https://api.airplanes.live/v2/point/${a[0]}/${a[1]}/${a[2]}` },
  { name: 'adsb.fi', url: (a) => `https://opendata.adsb.fi/api/v2/lat/${a[0]}/lon/${a[1]}/dist/${a[2]}` },
];
/** @type {Upstream[]} */
const MIL = [
  { name: 'adsb.lol', url: () => 'https://api.adsb.lol/v2/mil' },
  { name: 'airplanes.live', url: () => 'https://api.airplanes.live/v2/mil' },
  { name: 'adsb.fi', url: () => 'https://opendata.adsb.fi/api/v2/mil' },
];
/** @type {Upstream[]} */
const OPENSKY = [{ name: 'OpenSky', url: (a) => `https://opensky-network.org/api/states/all${a[0]}` }];

/** @type {{ re: RegExp, list: Upstream[], ttl: number, query?: RegExp }[]} */
const ROUTES = [
  { re: /^\/v2\/lat\/(-?\d{1,2}(?:\.\d+)?)\/lon\/(-?\d{1,3}(?:\.\d+)?)\/dist\/(\d{1,3})$/, list: POINT, ttl: 10 },
  { re: /^\/v2\/mil$/, list: MIL, ttl: 15 },
  { re: /^\/opensky\/states\/all$/, list: OPENSKY, ttl: 15, query: /^\?lamin=-?[\d.]+&lomin=-?[\d.]+&lamax=-?[\d.]+&lomax=-?[\d.]+$/ },
];

// Windy Webcams (v3) pass-through. The CALLER's own key arrives in the X-Windy-Api-Key header and is
// forwarded for that one request — never stored or cached. Only two read endpoints, strict params.
const WINDY = 'https://api.windy.com/webcams/api/v3/webcams';
const WINDY_INCLUDE = /^(categories|images|location|player|urls)(,(categories|images|location|player|urls))*$/;
const WINDY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

async function windy(url, request, cors) {
  const key = request.headers.get('X-Windy-Api-Key') || '';
  if (!WINDY_KEY.test(key)) return json({ error: 'missing or malformed Windy key' }, 400, cors);
  const p = url.searchParams;
  const out = new URLSearchParams();
  const include = p.get('include') || 'images,location,urls';
  if (!WINDY_INCLUDE.test(include)) return json({ error: 'bad include' }, 400, cors);
  out.set('include', include);
  let target;
  const one = url.pathname.match(/^\/windy\/webcams\/(\d{1,12})$/);
  if (one) {
    target = `${WINDY}/${one[1]}`;
  } else if (url.pathname === '/windy/webcams') {
    const nearby = p.get('nearby') || '';
    if (!/^-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?,\d{1,3}$/.test(nearby)) return json({ error: 'bad nearby' }, 400, cors);
    const limit = Math.min(50, Math.max(1, Number.parseInt(p.get('limit') || '50', 10) || 50));
    out.set('nearby', nearby); out.set('limit', String(limit));
    target = WINDY;
  } else {
    return json({ error: 'not found' }, 404, cors);
  }
  try {
    const up = await fetch(`${target}?${out}`, { headers: { 'X-Windy-Api-Key': key, Accept: 'application/json', 'User-Agent': UA } });
    const body = await up.text();
    return new Response(body, { status: up.status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Upstream': 'windy' } });
  } catch (e) {
    return json({ error: 'upstream unreachable' }, 502, cors);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean);
    const originOk = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': originOk ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'X-Windy-Api-Key',
      'Access-Control-Expose-Headers': 'X-Upstream',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors);
    // Public health check (dashboard preview / "Visit"): says the relay is up, reveals no data.
    if (url.pathname === '/') return json({ service: 'God\'s Eye Lite relay', ok: true, routes: ['/windy/webcams', '/v2/mil (parked)'], note: 'Data routes answer only the site listed in ALLOWED_ORIGINS.' }, 200, cors);
    if (!originOk) return json({ error: 'origin not allowed' }, 403, cors);

    if (url.pathname.startsWith('/windy/')) return windy(url, request, cors);

    const route = ROUTES.find((r) => r.re.test(url.pathname));
    if (!route || (route.query ? !route.query.test(url.search) : url.search)) return json({ error: 'not found' }, 404, cors);
    const m = url.pathname.match(route.re);
    const args = route.query ? [url.search] : m ? m.slice(1) : [];

    // Cache on OUR canonical URL so every upstream shares one cache entry.
    const cache = caches.default;
    const cacheKey = new Request(`https://relay.cache${url.pathname}${url.search}`);
    const hit = await cache.match(cacheKey);
    if (hit) return withHeaders(hit, cors);

    const tried = [];
    for (const { name, url: build } of route.list) {
      try {
        const up = await fetch(build(args), { headers: { 'User-Agent': UA, Accept: 'application/json' } });
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
