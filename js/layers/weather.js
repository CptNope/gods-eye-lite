// Keyless weather layers.
//  Radar      — NOAA nowCOAST base reflectivity (US & territories, ~4-min) or RainViewer (global, 10-min)
//  Clouds     — NOAA nowCOAST global longwave-infrared satellite mosaic (hourly)
//  Lightning  — NOAA nowCOAST strike density (15-min)
//  Wind       — Open-Meteo 10 m wind sampled over the view, drawn as animated particles
//  Cyclones   — NOAA NHC/CPHC forecast cones, tracks and positions (ArcGIS service)
//  Alerts     — NWS active warnings/watches/advisories (US)
import { fetchJson, cacheGet, cacheSet, setStatus, describeError, fmt, esc } from '../util.js';

const NOWCOAST = 'https://nowcoast.noaa.gov/geoserver';
const round5 = () => new Date(Math.floor(Date.now() / 300e3) * 300e3);

// ---------- time-aware imagery with cross-fade ----------
class TimedImagery {
  constructor(viewer, timeline, { id, alpha = 0.7, refreshMin = 5 }) {
    this.viewer = viewer; this.timeline = timeline; this.id = id; this.alpha = alpha; this.refreshMin = refreshMin;
    this.layer = null; this.seq = 0;
  }

  start() {
    this.unsub = this.timeline.subscribe((t) => this.show(t));
    this.show(this.timeline.time());
    this.refresh = setInterval(() => { if (!this.timeline.time()) this.show(null); }, this.refreshMin * 60e3);
  }

  stop() {
    this.unsub?.(); clearInterval(this.refresh);
    if (this.layer) this.viewer.imageryLayers.remove(this.layer, true);
    this.layer = null; setStatus(this.id, '');
  }

  async show(time) {
    const seq = ++this.seq;
    let made;
    try { made = await this.makeProvider(time); } catch (err) { setStatus(this.id, describeError(err), 'err'); return; }
    if (seq !== this.seq) return; // a newer request superseded this one
    const { provider, label } = made;
    const next = this.viewer.imageryLayers.addImageryProvider(provider);
    next.alpha = 0;
    const old = this.layer;
    this.layer = next;
    const t0 = performance.now();
    const fade = () => {
      const k = Math.min(1, (performance.now() - t0) / 700);
      next.alpha = this.alpha * k;
      if (old) old.alpha = this.alpha * (1 - k);
      if (k < 1) requestAnimationFrame(fade);
      else if (old) this.viewer.imageryLayers.remove(old, true);
    };
    setTimeout(() => requestAnimationFrame(fade), 350); // let the first tiles arrive before fading
    setStatus(this.id, label, 'ok');
  }
}

function wms(workspace, layers, time) {
  return new Cesium.WebMapServiceImageryProvider({
    url: `${NOWCOAST}/${workspace}/ows`,
    layers,
    parameters: { transparent: true, format: 'image/png', time: (time || round5()).toISOString() },
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    enablePickFeatures: false,
    credit: 'NOAA nowCOAST',
  });
}

const hhmm = (d) => d.toISOString().slice(11, 16) + 'Z';

export class RadarLayer extends TimedImagery {
  constructor(viewer, timeline) { super(viewer, timeline, { id: 'radar', alpha: 0.75 }); this.source = 'global'; }
  setSource(s) { this.source = s; if (this.unsub) this.show(this.timeline.time()); }
  async makeProvider(time) {
    if (this.source === 'noaa') {
      return { provider: wms('observations/weather_radar', 'base_reflectivity_mosaic', time), label: `NOAA · ${time ? hhmm(time) : 'latest'}` };
    }
    let maps = cacheGet('rainviewer', 4 * 60e3);
    if (!maps) { maps = await fetchJson('https://api.rainviewer.com/public/weather-maps.json'); cacheSet('rainviewer', maps); }
    const frames = maps.radar?.past || [];
    if (!frames.length) throw new Error('no radar frames');
    const want = (time || new Date()).getTime() / 1000;
    const frame = frames.reduce((a, b) => (Math.abs(b.time - want) < Math.abs(a.time - want) ? b : a));
    return {
      provider: new Cesium.UrlTemplateImageryProvider({
        url: `${maps.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, maximumLevel: 7, credit: 'RainViewer',
      }),
      label: `RainViewer · ${hhmm(new Date(frame.time * 1000))}${time && Math.abs(frame.time - want) > 900 ? ' (oldest)' : ''}`,
    };
  }
}

export class CloudsLayer extends TimedImagery {
  constructor(viewer, timeline) { super(viewer, timeline, { id: 'clouds', alpha: 0.65, refreshMin: 15 }); }
  async makeProvider(time) {
    return { provider: wms('satellite', 'global_longwave_imagery_mosaic', time), label: `NOAA IR · ${time ? hhmm(time) : 'latest'}` };
  }
}

export class LightningLayer extends TimedImagery {
  constructor(viewer, timeline) { super(viewer, timeline, { id: 'lightning', alpha: 0.9 }); }
  async makeProvider(time) {
    return { provider: wms('lightning_detection', 'ldn_lightning_strike_density', time), label: `NOAA · ${time ? hhmm(time) : 'latest'}` };
  }
}

// ---------- Wind particles ----------
export class WindLayer {
  constructor(viewer) {
    this.viewer = viewer; this.id = 'wind';
    this.lines = viewer.scene.primitives.add(new Cesium.PolylineCollection());
    this.lines.show = false;
    this.grid = null; this.particles = [];
    this.onMove = () => { clearTimeout(this.deb); this.deb = setTimeout(() => this.load(), 600); };
    this.tick = this.tick.bind(this);
  }

  start() {
    this.lines.show = true;
    this.viewer.camera.moveEnd.addEventListener(this.onMove);
    this.viewer.scene.preRender.addEventListener(this.tick);
    this.load();
    this.timer = setInterval(() => this.load(), 15 * 60e3);
  }

  stop() {
    this.lines.show = false;
    this.viewer.camera.moveEnd.removeEventListener(this.onMove);
    this.viewer.scene.preRender.removeEventListener(this.tick);
    clearInterval(this.timer);
    this.lines.removeAll(); this.particles = []; this.grid = null;
    setStatus(this.id, '');
  }

  viewRect() {
    const r = this.viewer.camera.computeViewRectangle(this.viewer.scene.globe.ellipsoid);
    let w, s, e, n;
    if (r) { [w, s, e, n] = [r.west, r.south, r.east, r.north].map(Cesium.Math.toDegrees); }
    if (!r || e < w || e - w > 200) { // globe view / dateline: sample a hemisphere around the camera
      const c = this.viewer.camera.positionCartographic;
      const lon = Cesium.Math.toDegrees(c.longitude), lat = Cesium.Math.toDegrees(c.latitude);
      w = lon - 70; e = lon + 70; s = lat - 50; n = lat + 50;
    }
    return { w, e, s: Math.max(s, -78), n: Math.min(n, 78) };
  }

  async load() {
    const rect = this.viewRect();
    const nx = 14, ny = 10;
    const lats = [], lons = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      lats.push((rect.s + (rect.n - rect.s) * (j / (ny - 1))).toFixed(2));
      let lon = rect.w + (rect.e - rect.w) * (i / (nx - 1));
      lon = ((lon + 540) % 360) - 180;
      lons.push(lon.toFixed(2));
    }
    try {
      setStatus(this.id, 'loading…', 'warn');
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;
      const res = await fetchJson(url, { timeout: 20000 });
      const arr = Array.isArray(res) ? res : [res];
      const u = new Float32Array(nx * ny), v = new Float32Array(nx * ny);
      arr.forEach((p, k) => {
        const spd = p.current?.wind_speed_10m ?? 0, dir = Cesium.Math.toRadians(p.current?.wind_direction_10m ?? 0);
        u[k] = -spd * Math.sin(dir); // meteorological "from" direction → vector
        v[k] = -spd * Math.cos(dir);
      });
      this.grid = { rect, nx, ny, u, v };
      this.spawnAll();
      const c = this.sample((rect.w + rect.e) / 2, (rect.s + rect.n) / 2);
      setStatus(this.id, `${fmt.num(Math.hypot(c.u, c.v), 1)} m/s at center · Open-Meteo`, 'ok');
    } catch (err) {
      setStatus(this.id, describeError(err), 'err');
    }
  }

  sample(lon, lat) {
    const g = this.grid, r = g.rect;
    const fx = Cesium.Math.clamp(((lon - r.w) / (r.e - r.w)) * (g.nx - 1), 0, g.nx - 1.001);
    const fy = Cesium.Math.clamp(((lat - r.s) / (r.n - r.s)) * (g.ny - 1), 0, g.ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j;
    const at = (arr, ii, jj) => arr[jj * g.nx + ii];
    const bil = (arr) => (1 - a) * (1 - b) * at(arr, i, j) + a * (1 - b) * at(arr, i + 1, j) + (1 - a) * b * at(arr, i, j + 1) + a * b * at(arr, i + 1, j + 1);
    return { u: bil(g.u), v: bil(g.v) };
  }

  spawn(p) {
    const r = this.grid.rect;
    p.lon = r.w + Math.random() * (r.e - r.w);
    p.lat = r.s + Math.random() * (r.n - r.s);
    p.age = 0; p.max = 60 + Math.random() * 90;
    p.trail = [];
  }

  spawnAll() {
    this.lines.removeAll();
    this.particles = [];
    const N = 700;
    for (let k = 0; k < N; k++) {
      const p = {};
      this.spawn(p);
      p.line = this.lines.add({ positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO], width: 1.6, material: Cesium.Material.fromType('Color', { color: Cesium.Color.WHITE.withAlpha(0) }) });
      this.particles.push(p);
    }
  }

  tick() {
    if (!this.grid || !this.particles.length) return;
    const now = performance.now();
    if (this.last && now - this.last < 33) return; // ~30 fps is plenty
    this.last = now;
    const r = this.grid.rect;
    const k = (r.e - r.w) / 9000; // degrees per (m/s · frame) scaled to the view
    const h = 3000;
    for (const p of this.particles) {
      const { u, v } = this.sample(p.lon, p.lat);
      const spd = Math.hypot(u, v);
      p.lon += (u * k) / Math.max(0.2, Math.cos(Cesium.Math.toRadians(p.lat)));
      p.lat += v * k;
      p.age++;
      if (p.age > p.max || p.lon < r.w || p.lon > r.e || p.lat < r.s || p.lat > r.n || spd < 0.3) { this.spawn(p); continue; }
      p.trail.push(Cesium.Cartesian3.fromDegrees(p.lon, p.lat, h));
      if (p.trail.length > 6) p.trail.shift();
      if (p.trail.length >= 2) {
        p.line.positions = p.trail;
        const fadeIn = Math.min(1, p.age / 10), fadeOut = Math.min(1, (p.max - p.age) / 15);
        p.line.material.uniforms.color = speedColor(spd).withAlpha(0.85 * fadeIn * fadeOut);
      }
    }
  }
}

function speedColor(ms) {
  if (ms < 3) return Cesium.Color.fromCssColorString('#9fd8ff');
  if (ms < 7) return Cesium.Color.fromCssColorString('#5dffb0');
  if (ms < 12) return Cesium.Color.fromCssColorString('#ffe66d');
  if (ms < 18) return Cesium.Color.fromCssColorString('#ffb347');
  return Cesium.Color.fromCssColorString('#ff5a3c');
}

// ---------- Tropical cyclones (NHC / CPHC) ----------
const NHC = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';

export class CyclonesLayer {
  constructor(viewer) {
    this.viewer = viewer; this.id = 'cyclones';
    this.ds = new Cesium.CustomDataSource('cyclones');
    viewer.dataSources.add(this.ds);
    this.ds.show = false;
  }

  start() { this.ds.show = true; this.load(); this.timer = setInterval(() => this.load(), 20 * 60e3); }
  stop() { this.ds.show = false; clearInterval(this.timer); setStatus(this.id, ''); }

  async query(id) {
    const j = await fetchJson(`${NHC}/${id}/query?where=1%3D1&outFields=*&f=geojson`, { timeout: 20000 });
    return j.features || [];
  }

  async load() {
    try {
      setStatus(this.id, 'loading…', 'warn');
      let svc = cacheGet('nhc-svc', 6 * 3600e3);
      if (!svc) { svc = await fetchJson(`${NHC}?f=json`); svc = { layers: svc.layers.map((l) => ({ id: l.id, name: l.name })) }; cacheSet('nhc-svc', svc); }
      const byName = new Map(svc.layers.map((l) => [l.name, l.id]));
      const slots = [...new Set(svc.layers.map((l) => (l.name.match(/^(AT|EP|CP)\d/) || [])[0]).filter(Boolean))];
      const withPoints = await Promise.all(slots.map(async (s) => {
        const id = byName.get(`${s} Forecast Points`);
        return id == null ? null : { s, points: await this.query(id).catch(() => []) };
      }));
      const active = withPoints.filter((x) => x && x.points.length);
      this.ds.entities.removeAll();
      for (const st of active) {
        const [cone, track, past] = await Promise.all(['Forecast Cone', 'Forecast Track', 'Past Track'].map((n) => {
          const id = byName.get(`${st.s} ${n}`);
          return id == null ? [] : this.query(id).catch(() => []);
        }));
        this.draw(st.points, cone, track, past);
      }
      setStatus(this.id, active.length ? `${active.length} active · NHC` : 'none active · NHC', 'ok');
    } catch (err) {
      setStatus(this.id, describeError(err), 'err');
    }
  }

  draw(points, cone, track, past) {
    const E = this.ds.entities;
    const white = Cesium.Color.WHITE;
    for (const f of cone) for (const ring of polygons(f.geometry)) {
      E.add({ polygon: { hierarchy: Cesium.Cartesian3.fromDegreesArray(ring.flat()), material: white.withAlpha(0.18), outline: true, outlineColor: white.withAlpha(0.7), height: 0 } });
    }
    for (const f of track) for (const line of lines(f.geometry)) {
      E.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArray(line.flat()), width: 2.5, material: new Cesium.PolylineDashMaterialProperty({ color: white, dashLength: 12 }), clampToGround: false } });
    }
    for (const f of past) for (const line of lines(f.geometry)) {
      E.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArray(line.flat()), width: 2, material: Cesium.Color.fromCssColorString('#ffb347') } });
    }
    const order = (f) => Number(f.properties.tau ?? f.properties.fhour ?? f.properties.objectid ?? 0);
    points = [...points].sort((a, b) => order(a) - order(b));
    points.forEach((f, idx) => {
      const [lon, lat] = f.geometry.coordinates;
      const p = f.properties;
      const cat = (p.dvlbl || p.stormtype || '').toString();
      const ent = E.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
        point: { pixelSize: idx === 0 ? 14 : 9, color: stormColor(p.maxwind), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: 1e7 },
        label: idx === 0 ? { text: `${p.stormname || ''} ${cat}`.trim(), font: '13px monospace', pixelOffset: new Cesium.Cartesian2(14, 0), fillColor: white, showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.55), disableDepthTestDistance: 1e7 } : { text: cat, font: '11px monospace', pixelOffset: new Cesium.Cartesian2(10, 0), fillColor: white, disableDepthTestDistance: 1e7, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 6e6) },
      });
      ent._gel = { kind: 'storm', layer: this.id, p, lat, lon };
    });
  }

  pos(id) { return { lat: id.lat, lon: id.lon, altM: 0 }; }

  card(id) {
    const p = id.p;
    const rows = [
      ['Type', p.stormtype], ['Label', p.dvlbl], ['Max wind', p.maxwind != null ? `${p.maxwind} kt` : null], ['Gusts', p.gust != null ? `${p.gust} kt` : null],
      ['Pressure', p.mslp && p.mslp < 9000 ? `${p.mslp} mb` : null], ['Valid', p.fldatelbl || p.datelbl], ['Advisory', p.advisnum ? `#${p.advisnum} · ${p.advdate || ''}` : p.advdate], ['Basin', p.basin],
    ].filter(([, v]) => v != null && v !== '');
    return `<h3>🌀 ${esc(p.stormname || 'Tropical system')}</h3><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <div class="links"><a href="https://www.nhc.noaa.gov/" target="_blank" rel="noopener">NHC advisories ↗</a></div>`;
  }
}

function stormColor(kt) {
  if (kt == null) return Cesium.Color.WHITE;
  if (kt < 34) return Cesium.Color.fromCssColorString('#6ec6ff');
  if (kt < 64) return Cesium.Color.fromCssColorString('#5dffb0');
  if (kt < 96) return Cesium.Color.fromCssColorString('#ffe66d');
  if (kt < 113) return Cesium.Color.fromCssColorString('#ffb347');
  return Cesium.Color.fromCssColorString('#ff5a3c');
}

// GeoJSON helpers → arrays of [lon,lat] pairs
function polygons(g) {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates[0]];
  if (g.type === 'MultiPolygon') return g.coordinates.map((p) => p[0]);
  return [];
}
function lines(g) {
  if (!g) return [];
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  return [];
}

// ---------- NWS alerts (US) ----------
const SEVERITY = { Extreme: '#ff3b3b', Severe: '#ff8c1a', Moderate: '#ffd84d', Minor: '#6ec6ff', Unknown: '#b0b0b0' };

export class AlertsLayer {
  constructor(viewer) {
    this.viewer = viewer; this.id = 'alerts';
    this.ds = new Cesium.CustomDataSource('alerts');
    viewer.dataSources.add(this.ds);
    this.ds.show = false;
  }

  start() { this.ds.show = true; this.load(); this.timer = setInterval(() => this.load(), 5 * 60e3); }
  stop() { this.ds.show = false; clearInterval(this.timer); setStatus(this.id, ''); }

  async load() {
    try {
      setStatus(this.id, 'loading…', 'warn');
      const j = await fetchJson('https://api.weather.gov/alerts/active?status=actual&message_type=alert', { timeout: 25000, headers: { Accept: 'application/geo+json' } });
      const feats = (j.features || []).filter((f) => f.geometry);
      this.ds.entities.suspendEvents();
      this.ds.entities.removeAll();
      for (const f of feats) {
        const col = Cesium.Color.fromCssColorString(SEVERITY[f.properties.severity] || SEVERITY.Unknown);
        for (const ring of polygons(f.geometry)) {
          const ent = this.ds.entities.add({
            polygon: { hierarchy: Cesium.Cartesian3.fromDegreesArray(ring.flat()), material: col.withAlpha(0.28), outline: true, outlineColor: col, height: 0 },
          });
          const c = centroid(ring);
          ent._gel = { kind: 'alert', layer: this.id, p: f.properties, lat: c[1], lon: c[0] };
        }
      }
      this.ds.entities.resumeEvents();
      const total = (j.features || []).length;
      setStatus(this.id, `${feats.length} mapped / ${total} · NWS`, 'ok');
    } catch (err) {
      setStatus(this.id, describeError(err), 'err');
    }
  }

  pos(id) { return { lat: id.lat, lon: id.lon, altM: 0 }; }

  card(id) {
    const p = id.p;
    return `<h3>⚠️ ${esc(p.event)}</h3>
      <dl>
        <dt>Severity</dt><dd>${esc(p.severity)} · ${esc(p.urgency)}</dd>
        <dt>Areas</dt><dd>${esc((p.areaDesc || '').slice(0, 120))}${(p.areaDesc || '').length > 120 ? '…' : ''}</dd>
        <dt>Expires</dt><dd>${p.expires ? new Date(p.expires).toUTCString().replace(' GMT', 'Z') : '—'}</dd>
        <dt>Issued by</dt><dd>${esc(p.senderName)}</dd>
      </dl>
      ${p.headline ? `<p class="hint">${esc(p.headline)}</p>` : ''}
      ${p.instruction ? `<p class="hint">${esc(p.instruction.slice(0, 280))}${p.instruction.length > 280 ? '…' : ''}</p>` : ''}
      <div class="links"><a href="https://www.weather.gov/" target="_blank" rel="noopener">weather.gov ↗</a></div>`;
  }
}

function centroid(ring) {
  let x = 0, y = 0;
  for (const [lon, lat] of ring) { x += lon; y += lat; }
  return [x / ring.length, y / ring.length];
}
