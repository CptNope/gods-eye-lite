// Public webcams from Windy.com (scenic, weather and town cams worldwide) — uses the VIEWER'S OWN free
// Windy Webcams API key from the encrypted key vault. Image links on the free tier expire after
// 10 minutes, so the list is re-fetched every 9 minutes and an open card refreshes its own image.
import { setStatus, describeError, esc } from '../util.js';
import { relayUrl } from '../config.js';

const API = 'https://api.windy.com/webcams/api/v3/webcams';

export class WebcamsLayer {
  constructor(viewer, { getKey, getCenter, openKeys }) {
    this.viewer = viewer; this.getKey = getKey; this.getCenter = getCenter; this.openKeys = openKeys;
    this.id = 'webcams';
    this.bbs = viewer.scene.primitives.add(new Cesium.BillboardCollection({ scene: viewer.scene }));
    this.bbs.show = false;
    this.icon = icon();
    this.cams = new Map();
    this.onMove = () => { clearTimeout(this.deb); this.deb = setTimeout(() => this.load(), 900); };
  }

  start() {
    this.bbs.show = true;
    this.viewer.camera.moveEnd.addEventListener(this.onMove);
    this.timer = setInterval(() => this.load(true), 9 * 60e3); // before free-tier image tokens expire
    this.load(true);
  }

  stop() {
    this.bbs.show = false;
    this.viewer.camera.moveEnd.removeEventListener(this.onMove);
    clearInterval(this.timer); clearTimeout(this.deb);
    setStatus(this.id, '');
  }

  // Called when the key vault changes (unlock / key added).
  keysChanged() { if (this.bbs.show) this.load(true); }

  // Try Windy directly; if the browser is blocked (CORS), use the relay Worker, which forwards the
  // key for that single request only. The working route is remembered for this browser.
  async request(url) {
    const key = this.getKey();
    const mode = localStorage.getItem('gel:windyRoute') || 'direct';
    const relay = relayUrl();
    const viaRelay = (u) => u.replace(API, `${relay}/windy/webcams`);
    let res;
    if (mode === 'direct' || !relay) {
      try {
        res = await fetch(url, { headers: { 'x-windy-api-key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      } catch (err) {
        if (!(err instanceof TypeError) || !relay) throw err;
        res = null;
      }
    }
    if (!res) {
      res = await fetch(viaRelay(url), { headers: { 'X-Windy-Api-Key': key }, signal: AbortSignal.timeout(15000) });
      if (res.ok) localStorage.setItem('gel:windyRoute', 'relay');
    }
    this.route = res.headers.get('x-upstream') === 'windy' ? 'relay' : 'direct';
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('key rejected'), { code: 'key' });
    if (res.status === 429) throw Object.assign(new Error('rate limited — try later'), { code: 'rate' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async load(force = false) {
    if (!this.getKey()) { setStatus(this.id, 'needs free Windy key', 'warn'); return; }
    const h = this.viewer.camera.positionCartographic.height;
    if (h > 600000) { setStatus(this.id, 'zoom in to load', 'warn'); return; }
    const c = this.getCenter();
    if (!c) return;
    // Radius ≈ half the visible ground width, clamped to the API's 1–250 km.
    const radius = Math.max(5, Math.min(250, Math.round((h * 1.2) / 1000)));
    const key = `${c.lat.toFixed(2)},${c.lon.toFixed(2)},${radius}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    const url = `${API}?nearby=${c.lat.toFixed(4)},${c.lon.toFixed(4)},${radius}&limit=50&include=images,location,urls`;
    try {
      setStatus(this.id, 'loading…', 'warn');
      const j = await this.request(url);
      this.render(j.webcams || []);
      setStatus(this.id, `${this.cams.size} within ${radius} km${this.route === 'relay' ? ' · via relay' : ''}`, 'ok');
    } catch (err) {
      const blocked = err instanceof TypeError; // fetch() TypeError = CORS/network
      setStatus(this.id, err.code === 'key' ? 'Windy key rejected' : blocked ? 'blocked (browser & relay)' : describeError(err), 'err');
    }
  }

  render(list) {
    this.bbs.removeAll();
    this.cams.clear();
    for (const w of list) {
      const loc = w.location;
      if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) continue;
      this.cams.set(w.webcamId, w);
      const bb = this.bbs.add({
        position: Cesium.Cartesian3.fromDegrees(loc.longitude, loc.latitude, 15),
        image: this.icon, scale: 0.8,
        scaleByDistance: new Cesium.NearFarScalar(2e3, 1.1, 3e5, 0.5),
        disableDepthTestDistance: 5e5,
      });
      bb.id = { kind: 'webcam', layer: this.id, id: w.webcamId };
    }
  }

  pos(sel) {
    const w = this.cams.get(sel.id);
    return w ? { lat: w.location.latitude, lon: w.location.longitude, altM: 0 } : null;
  }

  card(sel) {
    const w = this.cams.get(sel.id);
    if (!w) return '<h3>📹 Webcam</h3><p class="hint">No longer in view.</p>';
    const img = w.images?.current?.preview || w.images?.current?.thumbnail || w.images?.daylight?.preview || '';
    const place = [w.location?.city, w.location?.region, w.location?.country].filter(Boolean).join(', ');
    const updated = w.lastUpdatedOn ? new Date(w.lastUpdatedOn).toLocaleString() : null;
    // Refresh this camera's image link (tokens expire) every 5 minutes while the card is open.
    clearInterval(this.cardTimer);
    this.cardTimer = setInterval(async () => {
      const el = document.getElementById('wcImg');
      if (!el) return clearInterval(this.cardTimer);
      try {
        const j = await this.request(`${API}/${sel.id}?include=images,location,urls`);
        const fresh = j.images?.current?.preview;
        if (fresh) { el.src = fresh; this.cams.set(sel.id, { ...w, ...j }); }
      } catch { /* keep the last frame */ }
    }, 5 * 60e3);
    return `
      <h3>📹 ${esc(w.title || 'Webcam')}</h3>
      ${img ? `<img id="wcImg" class="cam-img" src="${esc(img)}" alt="Latest image from ${esc(w.title || 'webcam')}" referrerpolicy="no-referrer" />` : '<p class="hint">No current image.</p>'}
      <dl>
        ${place ? `<dt>Place</dt><dd>${esc(place)}</dd>` : ''}
        ${updated ? `<dt>Image from</dt><dd>${esc(updated)}</dd>` : ''}
        ${w.status && w.status !== 'active' ? `<dt>Status</dt><dd>${esc(w.status)}</dd>` : ''}
      </dl>
      <div class="links">${w.urls?.detail ? `<a href="${esc(w.urls.detail)}" target="_blank" rel="noopener">Live view &amp; timelapse on Windy ↗</a>` : ''}</div>
      <p class="hint">Webcams provided by <a href="https://www.windy.com/" target="_blank" rel="noopener">windy.com</a></p>`;
  }

  onDeselect() { clearInterval(this.cardTimer); }
}

function icon() {
  const c = document.createElement('canvas');
  c.width = 28; c.height = 20;
  const g = c.getContext('2d');
  g.fillStyle = '#ffd166'; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = 1.5;
  g.beginPath(); g.roundRect(2, 4, 17, 12, 2); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(19, 8); g.lineTo(26, 4); g.lineTo(26, 16); g.lineTo(19, 12); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#05080a'; g.beginPath(); g.arc(10.5, 10, 3, 0, Math.PI * 2); g.fill();
  return c;
}
