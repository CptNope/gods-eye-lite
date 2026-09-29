// Upcoming launches from Launch Library 2 (The Space Devs). Anonymous quota is small (~15 req/hr),
// so results are cached for an hour and shared across tabs via localStorage.
import { fetchJson, cacheGet, cacheSet, setStatus, describeError, fmt, esc } from '../util.js';

const URLS = [
  'https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=20&mode=normal',
  'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=20&mode=normal',
];

export class LaunchesLayer {
  constructor(viewer, { onList }) {
    this.viewer = viewer;
    this.id = 'launches';
    this.onList = onList;
    this.points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this.labels = viewer.scene.primitives.add(new Cesium.LabelCollection());
    this.setShown(false);
    this.results = [];
  }

  setShown(v) { this.points.show = v; this.labels.show = v; }
  start() { this.setShown(true); this.load(); this.timer = setInterval(() => this.load(), 60 * 60e3); }
  stop() { clearInterval(this.timer); this.setShown(false); setStatus(this.id, ''); this.onList(null); }

  async load() {
    let data = cacheGet('ll2', 60 * 60e3);
    if (!data) {
      let lastErr;
      for (const url of URLS) {
        try { data = await fetchJson(url); cacheSet('ll2', data); break; } catch (e) { lastErr = e; }
      }
      if (!data) {
        data = cacheGet('ll2', 7 * 24 * 3600e3);
        if (!data) { setStatus(this.id, describeError(lastErr), 'err'); return; }
      }
    }
    this.results = (data.results || []).filter((r) => r.pad && r.pad.latitude != null);
    this.points.removeAll();
    this.labels.removeAll();
    const padsSeen = new Set();
    for (const r of this.results) {
      const lat = Number(r.pad.latitude), lon = Number(r.pad.longitude);
      const pos = Cesium.Cartesian3.fromDegrees(lon, lat, 50);
      const pt = this.points.add({
        position: pos, pixelSize: 10, color: Cesium.Color.fromCssColorString('#ffb347'),
        outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: 1e7,
      });
      pt.id = { kind: 'launch', layer: this.id, r };
      if (!padsSeen.has(r.pad.name)) {
        padsSeen.add(r.pad.name);
        this.labels.add({
          position: pos, text: r.pad.location?.name || r.pad.name, font: '11px monospace',
          fillColor: Cesium.Color.fromCssColorString('#ffb347'), pixelOffset: new Cesium.Cartesian2(12, 0),
          showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.5),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8e6), disableDepthTestDistance: 1e7,
        });
      }
    }
    setStatus(this.id, `${this.results.length} · LL2`, 'ok');
    this.onList(this.results);
  }

  positionOf(r) { return { lat: Number(r.pad.latitude), lon: Number(r.pad.longitude), altM: 0 }; }

  card(id) {
    const r = id.r;
    return `
      <h3>🚀 ${esc(r.name)}</h3>
      <dl>
        <dt>Window (NET)</dt><dd>${new Date(r.net).toUTCString().replace(' GMT', 'Z')}</dd>
        <dt>Countdown</dt><dd>${fmt.countdown(r.net)}</dd>
        <dt>Status</dt><dd>${esc(r.status?.abbrev || r.status?.name || '—')}</dd>
        <dt>Provider</dt><dd>${esc(r.launch_service_provider?.name || '—')}</dd>
        ${r.mission?.orbit?.name ? `<dt>Orbit</dt><dd>${esc(r.mission.orbit.name)}</dd>` : ''}
        <dt>Pad</dt><dd>${esc(r.pad.name)}</dd>
      </dl>
      ${r.mission?.description ? `<p class="hint">${esc(r.mission.description.slice(0, 280))}${r.mission.description.length > 280 ? '…' : ''}</p>` : ''}`;
  }
}
