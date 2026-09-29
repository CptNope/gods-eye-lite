// Public traffic cameras (stills). The catalog is built at deploy time by scripts/build-cctv.mjs
// (city camera lists block browsers; their images don't), so the app loads one same-origin file.
import { fetchJson, setStatus, describeError, esc } from '../util.js';

export class CctvLayer {
  constructor(viewer) {
    this.viewer = viewer;
    this.id = 'cctv';
    this.bbs = viewer.scene.primitives.add(new Cesium.BillboardCollection({ scene: viewer.scene }));
    this.aims = viewer.scene.primitives.add(new Cesium.PolylineCollection());
    this.bbs.show = this.aims.show = false;
    this.icon = cameraIcon();
    this.cams = [];
    this.loaded = false;
  }

  async start() {
    this.bbs.show = this.aims.show = true;
    if (!this.loaded) await this.load();
    else setStatus(this.id, `${this.cams.length} cameras`, 'ok');
  }

  stop() {
    this.bbs.show = this.aims.show = false;
    this.stopRefresh();
    setStatus(this.id, '');
  }

  async load() {
    try {
      setStatus(this.id, 'loading…', 'warn');
      const j = await fetchJson('./data/cctv.json', { timeout: 30000 });
      this.cams = j.cams || [];
      this.meta = { built: j.built, providers: j.providers };
      const aimColor = Cesium.Material.fromType('Color', { color: Cesium.Color.fromCssColorString('#6ec6ff').withAlpha(0.8) });
      for (const cam of this.cams) {
        const pos = Cesium.Cartesian3.fromDegrees(cam.lo, cam.la, 12);
        const bb = this.bbs.add({
          position: pos, image: this.icon, scale: 0.8,
          scaleByDistance: new Cesium.NearFarScalar(2e3, 1.1, 3e6, 0.35),
          translucencyByDistance: new Cesium.NearFarScalar(4e6, 1, 9e6, 0),
          disableDepthTestDistance: 5e5,
        });
        bb.id = { kind: 'camera', layer: this.id, cam };
        if (cam.h != null) { // show which way it looks, only when close
          const end = destination(cam.la, cam.lo, cam.h, 160);
          this.aims.add({
            positions: [pos, Cesium.Cartesian3.fromDegrees(end[1], end[0], 12)],
            width: 2, material: aimColor,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 25000),
          });
        }
      }
      this.loaded = true;
      const age = Math.round((Date.now() - new Date(j.built).getTime()) / 3600e3);
      setStatus(this.id, `${this.cams.length} cameras · list ${age}h old`, 'ok');
    } catch (err) {
      setStatus(this.id, err?.message?.includes('404') ? 'catalog unavailable' : describeError(err), 'err');
    }
  }

  nearest(lat, lon) {
    let best = null, bestD = Infinity;
    const cosLat = Math.cos(lat * Math.PI / 180);
    for (const c of this.cams) {
      const dx = (c.lo - lon) * cosLat, dy = c.la - lat, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best ? { cam: best, km: Math.sqrt(bestD) * 111.2 } : null;
  }

  pos(id) { return { lat: id.cam.la, lon: id.cam.lo, altM: 0 }; }

  card(id) {
    const c = id.cam;
    this.stopRefresh();
    // Refresh the still every 15 s while the card is open.
    setTimeout(() => {
      const img = document.getElementById('camImg');
      if (!img) return;
      const reload = () => { const el = document.getElementById('camImg'); if (!el) return this.stopRefresh(); el.src = bust(c.i); };
      this.refresh = setInterval(reload, 15000);
      img.addEventListener('error', () => { const s = document.getElementById('camState'); if (s) s.textContent = 'No image right now (camera offline or restricted).'; });
      img.addEventListener('load', () => { const s = document.getElementById('camState'); if (s) s.textContent = `Updated ${new Date().toLocaleTimeString()} · refreshes every 15 s`; });
    }, 0);
    return `
      <h3>📷 ${esc(c.n)}</h3>
      <img id="camImg" class="cam-img" src="${esc(bust(c.i))}" alt="Live still from ${esc(c.n)}" referrerpolicy="no-referrer" />
      <p class="hint" id="camState">Loading latest frame…</p>
      <dl>
        <dt>Area</dt><dd>${esc(c.c)}</dd>
        <dt>Operator</dt><dd>${esc(c.p)}</dd>
        ${c.h != null ? `<dt>Facing</dt><dd>${c.h}°</dd>` : ''}
      </dl>
      <p class="hint">${esc(c.l)}</p>
      <div class="links"><a href="${esc(c.i)}" target="_blank" rel="noopener noreferrer">Open full image ↗</a></div>`;
  }

  stopRefresh() { clearInterval(this.refresh); this.refresh = null; }
  onDeselect() { this.stopRefresh(); }
}

function bust(url) { return url + (url.includes('?') ? '&' : '?') + '_=' + Math.floor(Date.now() / 15000); }

function destination(lat, lon, brgDeg, m) {
  const R = 6371000, d = m / R, b = brgDeg * Math.PI / 180, p1 = lat * Math.PI / 180, l1 = lon * Math.PI / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 * 180 / Math.PI, l2 * 180 / Math.PI];
}

function cameraIcon() {
  const c = document.createElement('canvas');
  c.width = 28; c.height = 20;
  const g = c.getContext('2d');
  g.fillStyle = '#6ec6ff'; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = 1.5;
  g.beginPath(); g.roundRect(2, 4, 17, 12, 2); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(19, 8); g.lineTo(26, 4); g.lineTo(26, 16); g.lineTo(19, 12); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#05080a'; g.beginPath(); g.arc(10.5, 10, 3, 0, Math.PI * 2); g.fill();
  return c;
}
