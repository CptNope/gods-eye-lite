// Live aircraft via the flight relay (relay/worker.js): adsb.lol point-radius, OpenSky anonymous fallback,
// and adsb.lol /v2/mil for military. These APIs block direct browser calls (no CORS), hence the relay.
// Positions are dead-reckoned between polls for smooth motion.
import { fetchJson, setStatus, describeError, planeIcon, fmt, esc } from '../util.js';
import { relayUrl, FLIGHTS_VIA_RELAY } from '../config.js';

const R = 6371000;

export class FlightsLayer {
  constructor(viewer, { mode = 'civil', getCenter }) {
    this.viewer = viewer;
    this.mode = mode;
    this.id = mode === 'military' ? 'military' : 'flights';
    this.getCenter = getCenter;
    this.collection = viewer.scene.primitives.add(new Cesium.BillboardCollection({ scene: viewer.scene }));
    this.collection.show = false;
    this.icon = planeIcon(mode === 'military' ? '#ffb347' : '#5dffb0');
    this.items = new Map();
    this.pollMs = mode === 'military' ? 20000 : 15000;
    this.source = 'adsb.lol';
  }

  start() {
    this.collection.show = true;
    this.poll();
    this.timer = setInterval(() => this.poll(), this.pollMs);
    this.anim = setInterval(() => this.animate(), 500);
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.anim);
    this.collection.show = false;
    setStatus(this.id, '');
  }

  async poll() {
    if (this.busy) return;
    const relay = relayUrl();
    if (!FLIGHTS_VIA_RELAY && !localStorage.getItem('gel:relay')) { setStatus(this.id, 'parked · needs relay', 'warn'); return; }
    if (!relay) { setStatus(this.id, 'parked · needs relay', 'warn'); return; }
    this.busy = true;
    try {
      const list = this.mode === 'military' ? await this.fetchMil(relay) : await this.fetchCivil(relay);
      this.apply(list);
      setStatus(this.id, `${list.length} · ${this.source}`, 'ok');
    } catch (err) {
      setStatus(this.id, describeError(err), 'err');
    } finally {
      this.busy = false;
    }
  }

  async fetchMil(relay) {
    const j = await fetchJson(`${relay}/v2/mil`);
    this.source = 'adsb.lol';
    return (j.ac || []).map(normAdsb).filter(Boolean);
  }

  async fetchCivil(relay) {
    const c = this.getCenter();
    if (!c) return [];
    const lat = c.lat.toFixed(3), lon = c.lon.toFixed(3);
    try {
      const j = await fetchJson(`${relay}/v2/lat/${lat}/lon/${lon}/dist/250`);
      this.source = 'adsb.lol';
      return (j.ac || []).map(normAdsb).filter(Boolean);
    } catch (err) {
      // Fallback: OpenSky anonymous (rate-limited; bounding box ~±4°)
      const d = 4, f = (n) => n.toFixed(2);
      const url = `${relay}/opensky/states/all?lamin=${f(Math.max(-90, c.lat - d))}&lomin=${f(Math.max(-180, c.lon - d))}&lamax=${f(Math.min(90, c.lat + d))}&lomax=${f(Math.min(180, c.lon + d))}`;
      const j = await fetchJson(url);
      this.source = 'OpenSky';
      return (j.states || []).map(normOpenSky).filter(Boolean);
    }
  }

  apply(list) {
    const seen = new Set();
    const now = Date.now();
    for (const a of list) {
      seen.add(a.hex);
      let it = this.items.get(a.hex);
      if (!it) {
        const bb = this.collection.add({
          image: this.icon,
          scale: 0.7,
          alignedAxis: Cesium.Cartesian3.UNIT_Z,
          disableDepthTestDistance: 5e6,
          scaleByDistance: new Cesium.NearFarScalar(2e4, 1.1, 8e6, 0.45),
        });
        it = { bb };
        this.items.set(a.hex, it);
      }
      Object.assign(it, { data: a, lat: a.lat, lon: a.lon, t0: now });
      it.bb.id = { kind: 'aircraft', layer: this.id, hex: a.hex, get data() { return it.data; } };
      it.bb.rotation = -Cesium.Math.toRadians(a.track || 0);
      this.place(it, a.lat, a.lon);
    }
    for (const [hex, it] of this.items) {
      if (!seen.has(hex)) {
        this.collection.remove(it.bb);
        this.items.delete(hex);
      }
    }
  }

  place(it, lat, lon) {
    it.bb.position = Cesium.Cartesian3.fromDegrees(lon, lat, it.data.altM + 30);
    it.curLat = lat; it.curLon = lon;
  }

  animate() {
    const now = Date.now();
    for (const it of this.items.values()) {
      const a = it.data;
      if (!a.gs || a.onGround) continue;
      const dist = a.gs * 0.514444 * ((now - it.t0) / 1000); // knots → m/s
      if (dist > 60000) continue; // stale; wait for next poll
      const brg = Cesium.Math.toRadians(a.track || 0);
      const dLat = (dist * Math.cos(brg)) / R;
      const dLon = (dist * Math.sin(brg)) / (R * Math.cos(Cesium.Math.toRadians(it.lat)));
      this.place(it, it.lat + Cesium.Math.toDegrees(dLat), it.lon + Cesium.Math.toDegrees(dLon));
    }
  }

  positionOf(hex) {
    const it = this.items.get(hex);
    return it ? { lat: it.curLat, lon: it.curLon, altM: it.data.altM } : null;
  }

  card(id) {
    const a = id.data;
    const title = a.callsign || a.reg || a.hex.toUpperCase();
    return `
      <h3>${this.mode === 'military' ? '🎖️' : '✈️'} ${esc(title)}</h3>
      <dl>
        <dt>ICAO hex</dt><dd>${esc(a.hex.toUpperCase())}</dd>
        ${a.reg ? `<dt>Registration</dt><dd>${esc(a.reg)}</dd>` : ''}
        ${a.type ? `<dt>Type</dt><dd>${esc(a.type)}</dd>` : ''}
        ${a.country ? `<dt>Country</dt><dd>${esc(a.country)}</dd>` : ''}
        <dt>Altitude</dt><dd>${a.onGround ? 'on ground' : fmt.ft(a.altFt)}</dd>
        <dt>Ground speed</dt><dd>${fmt.kt(a.gs)}</dd>
        <dt>Track</dt><dd>${fmt.deg(a.track)}</dd>
        ${a.squawk ? `<dt>Squawk</dt><dd>${esc(a.squawk)}</dd>` : ''}
        <dt>Source</dt><dd>${esc(this.source)}</dd>
      </dl>
      <div class="links">
        <a href="https://globe.adsb.lol/?icao=${encodeURIComponent(a.hex)}" target="_blank" rel="noopener">Track history ↗</a>
      </div>`;
  }
}

function normAdsb(ac) {
  if (ac.lat == null || ac.lon == null) return null;
  const onGround = ac.alt_baro === 'ground';
  const altFt = onGround ? 0 : Number(ac.alt_geom ?? ac.alt_baro ?? 0);
  return {
    hex: String(ac.hex).replace('~', ''),
    callsign: (ac.flight || '').trim(),
    reg: ac.r, type: ac.desc || ac.t, squawk: ac.squawk,
    lat: ac.lat, lon: ac.lon, altFt, altM: altFt * 0.3048, onGround,
    gs: ac.gs, track: ac.track ?? ac.true_heading ?? 0,
  };
}

function normOpenSky(s) {
  if (s[5] == null || s[6] == null) return null;
  const altM = s[13] ?? s[7] ?? 0;
  return {
    hex: s[0], callsign: (s[1] || '').trim(), country: s[2],
    lat: s[6], lon: s[5], altM, altFt: altM / 0.3048, onGround: s[8],
    gs: s[9] != null ? s[9] / 0.514444 : null, track: s[10] ?? 0, squawk: s[14],
  };
}

