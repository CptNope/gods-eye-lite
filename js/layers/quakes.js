// USGS earthquakes (past 24h, all magnitudes). Size = magnitude, colour = depth.
import { fetchJson, setStatus, describeError, fmt, esc } from '../util.js';

export class QuakesLayer {
  constructor(viewer) {
    this.viewer = viewer;
    this.id = 'quakes';
    this.points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this.points.show = false;
  }

  start() { this.points.show = true; this.load(); this.timer = setInterval(() => this.load(), 5 * 60e3); }
  stop() { clearInterval(this.timer); this.points.show = false; setStatus(this.id, ''); }

  async load() {
    try {
      const j = await fetchJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson');
      this.points.removeAll();
      for (const f of j.features || []) {
        const [lon, lat, depth] = f.geometry.coordinates;
        const mag = f.properties.mag ?? 0;
        const pt = this.points.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 100),
          pixelSize: Math.max(4, mag * 4),
          color: depthColor(depth).withAlpha(0.8),
          outlineColor: Cesium.Color.WHITE.withAlpha(0.7), outlineWidth: mag >= 4.5 ? 2 : 0.5,
          disableDepthTestDistance: 1e7,
        });
        pt.id = { kind: 'quake', layer: this.id, f };
      }
      setStatus(this.id, `${j.features.length} · USGS`, 'ok');
    } catch (err) {
      setStatus(this.id, describeError(err), 'err');
    }
  }

  positionOf(f) { const [lon, lat] = f.geometry.coordinates; return { lat, lon, altM: 0 }; }

  card(id) {
    const p = id.f.properties, [, , depth] = id.f.geometry.coordinates;
    return `
      <h3>🌍 M${fmt.num(p.mag, 1)} — ${esc(p.place || 'Unknown location')}</h3>
      <dl>
        <dt>Time</dt><dd>${new Date(p.time).toUTCString().replace(' GMT', 'Z')}</dd>
        <dt>Age</dt><dd>${fmt.ago(p.time)}</dd>
        <dt>Depth</dt><dd>${fmt.km(depth)}</dd>
        ${p.tsunami ? '<dt>Tsunami flag</dt><dd>yes</dd>' : ''}
        ${p.alert ? `<dt>PAGER alert</dt><dd>${esc(p.alert)}</dd>` : ''}
      </dl>
      <div class="links"><a href="${esc(p.url)}" target="_blank" rel="noopener">USGS event page ↗</a></div>`;
  }
}

function depthColor(km) {
  if (km < 30) return Cesium.Color.fromCssColorString('#ff5a3c');
  if (km < 70) return Cesium.Color.fromCssColorString('#ffb347');
  if (km < 300) return Cesium.Color.fromCssColorString('#ffe66d');
  return Cesium.Color.fromCssColorString('#6ec6ff');
}
