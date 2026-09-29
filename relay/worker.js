// God's Eye Lite — flight relay (Cloudflare Worker, free tier).
// adsb.lol and OpenSky don't send CORS headers for other sites, so browsers can't call them directly.
// This Worker forwards ONLY the flight endpoints the app uses, adds CORS for your site, and caches briefly.
//
// Deploy: automatic via .github/workflows/relay.yml (needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
// repo secrets). ALLOWED_ORIGINS comes from wrangler.toml. Manual alternative: paste this file into a
// dashboard-created Worker and add ALLOWED_ORIGINS under Settings → Variables.

const ROUTES = [
  // civil flights around a point (adsb.lol caps radius at 250 nm)
  { re: /^\/v2\/lat\/-?\d{1,2}(\.\d+)?\/lon\/-?\d{1,3}(\.\d+)?\/dist\/\d{1,3}$/, upstream: (p) => `https://api.adsb.lol${p}`, ttl: 10 },
  // military flights, global
  { re: /^\/v2\/mil$/, upstream: (p) => `https://api.adsb.lol${p}`, ttl: 15 },
  // OpenSky anonymous fallback (bounding box query only)
  { re: /^\/opensky\/states\/all$/, upstream: (p, q) => `https://opensky-network.org/api/states/all${q}`, ttl: 15, query: /^\?lamin=-?[\d.]+&lomin=-?[\d.]+&lamax=-?[\d.]+&lomax=-?[\d.]+$/ },
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    // Comma-separated list, e.g. "https://jeremy.github.io,http://localhost:8080". Unset = allow any origin.
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const originOk = !allowed.length || allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed.length ? (originOk ? origin : allowed[0]) : '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors);
    if (!originOk) return json({ error: 'origin not allowed' }, 403, cors);

    const route = ROUTES.find((r) => r.re.test(url.pathname));
    if (!route || (route.query ? !route.query.test(url.search) : url.search)) return json({ error: 'not found' }, 404, cors);

    const target = route.upstream(url.pathname, url.search);
    const cache = caches.default;
    const cacheKey = new Request(target, { method: 'GET' });
    let res = await cache.match(cacheKey);
    if (!res) {
      try {
        const up = await fetch(target, { headers: { 'User-Agent': 'gods-eye-lite-relay/1.0', Accept: 'application/json' }, cf: { cacheTtl: route.ttl } });
        if (!up.ok) return json({ error: `upstream ${up.status}` }, 502, cors);
        res = new Response(up.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${route.ttl}` } });
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
      } catch (e) {
        return json({ error: 'upstream unreachable' }, 502, cors);
      }
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
