// Satellites from CelesTrak TLEs, propagated in-browser with SGP4 (satellite.js).
// TLEs are cached for 2 hours — CelesTrak asks clients not to re-download more often.
import { fetchText, cacheGet, cacheSet, setStatus, describeError, fmt, esc } from '../util.js';

const CLASS_COLORS = {
  stations: '#ffffff', 'gps-ops': '#ffd166', weather: '#6ec6ff', science: '#c792ea',
  starlink: '#8aa1b1', visual: '#5dffb0',
};

export class SatellitesLayer {
  constructor(viewer) {
    this.viewer = viewer;
    this.id = 'satellites';
    this.points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this.labels = viewer.scene.primitives.add(new Cesium.LabelCollection());
    this.orbit = null;
    this.sats = [];
    this.group = 'visual';
    this.setShown(false);
  }

  setShown(v) { this.points.show = v; this.labels.show = v; if (this.orbit) this.orbit.show = v; }

  async start() {
    this.setShown(true);
    await this.load();
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop() {
    clearInterval(this.timer);
    this.setShown(false);
    setStatus(this.id, '');
  }

  async setGroup(g) {
    this.group = g;
    if (this.points.show) await this.load();
  }

  async load() {
    if (typeof satellite === 'undefined') { setStatus(this.id, 'sgp4 lib missing', 'err'); return; }
    setStatus(this.id, 'loading…', 'warn');
    const key = 'tle:' + this.group;
    let text = cacheGet(key, 2 * 3600e3);
    try {
      if (!text) {
        text = await fetchText(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(this.group)}&FORMAT=tle`);
        if (!/^1 /m.test(text)) throw new Error('no TLE data');
        cacheSet(key, text);
      }
    } catch (err) {
      text = cacheGet(key, 30 * 24 * 3600e3); // fall back to a stale copy if we have one
      if (!text) { setStatus(this.id, describeError(err), 'err'); return; }
    }
    this.build(text);
  }

  build(text) {
    this.points.removeAll();
    this.labels.removeAll();
    this.clearOrbit();
    const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
    const color = Cesium.Color.fromCssColorString(CLASS_COLORS[this.group] || '#5dffb0');
    const iss = Cesium.Color.fromCssColorString('#ff6b6b');
    this.sats = [];
    for (let i = 0; i + 2 < lines.length + 1; i += 3) {
      const name = lines[i]?.trim(), l1 = lines[i + 1], l2 = lines[i + 2];
      if (!l1?.startsWith('1 ') || !l2?.startsWith('2 ')) continue;
      let satrec;
      try { satrec = satellite.twoline2satrec(l1, l2); } catch { continue; }
      const norad = l1.slice(2, 7).trim();
      const isIss = norad === '25544';
      const pt = this.points.add({
        pixelSize: isIss ? 9 : this.group === 'starlink' ? 3 : 5,
        color: isIss ? iss : color,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.6), outlineWidth: 1,
      });
      const sat = { name, norad, satrec, pt };
      pt.id = { kind: 'satellite', layer: this.id, sat };
      if (isIss || this.group === 'stations') {
        sat.label = this.labels.add({
          text: name, font: '12px monospace', fillColor: Cesium.Color.WHITE,
          pixelOffset: new Cesium.Cartesian2(10, -10), showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.5),
        });
      }
      this.sats.push(sat);
    }
    this.tick();
    setStatus(this.id, `${this.sats.length} · CelesTrak`, 'ok');
  }

  propagate(sat, date) {
    const pv = satellite.propagate(sat.satrec, date);
    if (!pv?.position || typeof pv.position === 'boolean') return null;
    const gmst = satellite.gstime(date);
    const ecf = satellite.eciToEcf(pv.position, gmst);
    const geo = satellite.eciToGeodetic(pv.position, gmst);
    const v = pv.velocity;
    return {
      cart: new Cesium.Cartesian3(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000),
      lat: satellite.degreesLat(geo.latitude), lon: satellite.degreesLong(geo.longitude),
      altKm: geo.height, speedKms: v ? Math.hypot(v.x, v.y, v.z) : null,
    };
  }

  tick() {
    const now = new Date();
    for (const s of this.sats) {
      const p = this.propagate(s, now);
      if (!p) { s.pt.show = false; continue; }
      s.pt.show = true;
      s.pt.position = p.cart;
      s.last = p;
      if (s.label) s.label.position = p.cart;
    }
  }

  positionOf(sat) { return sat.last ? { lat: sat.last.lat, lon: sat.last.lon, altM: sat.last.altKm * 1000 } : null; }

  clearOrbit() {
    if (this.orbit) { this.viewer.scene.primitives.remove(this.orbit); this.orbit = null; }
  }

  // Draw one full orbital period (fixed-frame snapshot) for the selected satellite.
  showOrbit(sat) {
    this.clearOrbit();
    const periodMin = (2 * Math.PI) / sat.satrec.no; // no = rad/min
    const pts = [];
    const t0 = Date.now();
    for (let m = 0; m <= periodMin; m += periodMin / 180) {
      const p = this.propagate(sat, new Date(t0 + m * 60000));
      if (p) pts.push(p.cart);
    }
    if (pts.length < 2) return;
    this.orbit = this.viewer.scene.primitives.add(new Cesium.PolylineCollection());
    this.orbit.add({ positions: pts, width: 1.5, material: Cesium.Material.fromType('Color', { color: Cesium.Color.fromCssColorString('#5dffb0').withAlpha(0.6) }) });
  }

  card(id) {
    const s = id.sat, p = s.last || {};
    this.showOrbit(s);
    const periodMin = (2 * Math.PI) / s.satrec.no;
    return `
      <h3>🛰️ ${esc(s.name)}</h3>
      <dl>
        <dt>NORAD ID</dt><dd>${esc(s.norad)}</dd>
        <dt>Altitude</dt><dd>${fmt.km(p.altKm)}</dd>
        <dt>Speed</dt><dd>${p.speedKms ? fmt.num(p.speedKms, 2) + ' km/s' : '—'}</dd>
        <dt>Period</dt><dd>${fmt.num(periodMin, 1)} min</dd>
        <dt>Inclination</dt><dd>${fmt.deg(Cesium.Math.toDegrees(s.satrec.inclo))}</dd>
        <dt>Sub-point</dt><dd>${fmt.num(p.lat, 2)}, ${fmt.num(p.lon, 2)}</dd>
      </dl>
      <div class="links"><a href="https://celestrak.org/satcat/table-satcat.php?CATNR=${encodeURIComponent(s.norad)}" target="_blank" rel="noopener">SATCAT ↗</a></div>`;
  }

  onDeselect() { this.clearOrbit(); }
}
