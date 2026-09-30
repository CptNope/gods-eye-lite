// Outdoor features.
//  OutdoorPoiLayer — peaks, trailheads, water, shelters, campsites, viewpoints, toilets, waterfalls and
//                    named hiking routes from OpenStreetMap (Overpass API), loaded for the area in view.
//  OutdoorTools    — conditions card (Open-Meteo), my-coordinates card, GPS track recorder with GPX export,
//                    and "save this area offline" (tiles into the browser's Cache Storage).
// Location privacy: positions are used on this device only. Recorded tracks are kept in this browser's
// storage until you clear them; nothing is uploaded. Forecasts are fetched for the MAP VIEW point,
// or your position only when you ask for conditions "at my location".
import { fetchJson, setStatus, describeError, toast, esc } from './util.js';
import { TILESETS, tileUrl, tileRange } from './tiles.js';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const OFFLINE_CACHE = 'gel-offline';

// ---------- units ----------
export function makeUnits(get) {
  const imp = () => get() === 'imperial';
  return {
    imp,
    len: (m) => (m == null || !Number.isFinite(m) ? '—' : imp() ? (m >= 1609.344 * 0.1 ? `${(m / 1609.344).toFixed(m < 16093 ? 2 : 1)} mi` : `${Math.round(m * 3.28084)} ft`) : m >= 1000 ? `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km` : `${Math.round(m)} m`),
    ele: (m) => (m == null || !Number.isFinite(m) ? '—' : imp() ? `${Math.round(m * 3.28084).toLocaleString()} ft` : `${Math.round(m).toLocaleString()} m`),
    temp: (c) => (c == null ? '—' : imp() ? `${Math.round(c * 9 / 5 + 32)}°F` : `${Math.round(c)}°C`),
    speed: (kmh) => (kmh == null ? '—' : imp() ? `${Math.round(kmh / 1.609344)} mph` : `${Math.round(kmh)} km/h`),
    precip: (mm) => (mm == null ? '—' : imp() ? `${(mm / 25.4).toFixed(2)} in` : `${mm.toFixed(1)} mm`),
  };
}

// ---------- geometry helpers ----------
const R = 6371008.8;
export function haversine(a, b) {
  const toR = Math.PI / 180, dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function dms(v, pos, neg) {
  const a = Math.abs(v), d = Math.floor(a), mF = (a - d) * 60, m = Math.floor(mF), s = (mF - m) * 60;
  return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″ ${v >= 0 ? pos : neg}`;
}

// ---------- POI categories ----------
const CATS = {
  peak: { icon: '⛰️', label: 'Peak', color: '#e8d6b0' },
  trailhead: { icon: '🥾', label: 'Trailhead', color: '#5dffb0' },
  water: { icon: '💧', label: 'Drinking water', color: '#6ec6ff' },
  spring: { icon: '🫗', label: 'Spring', color: '#6ec6ff' },
  shelter: { icon: '🛖', label: 'Shelter / hut', color: '#ffb347' },
  camp: { icon: '⛺', label: 'Campsite', color: '#ffb347' },
  view: { icon: '🔭', label: 'Viewpoint', color: '#c792ea' },
  toilets: { icon: '🚻', label: 'Toilets', color: '#b0b0b0' },
  waterfall: { icon: '🌊', label: 'Waterfall', color: '#6ec6ff' },
  route: { icon: '🧭', label: 'Hiking route', color: '#ff5a3c' },
};

function categorize(t) {
  if (t.route === 'hiking' || t.route === 'foot') return 'route';
  if (t.natural === 'peak' || t.natural === 'volcano') return 'peak';
  if (t.highway === 'trailhead') return 'trailhead';
  if (t.amenity === 'drinking_water') return 'water';
  if (t.natural === 'spring') return 'spring';
  if (t.amenity === 'shelter' || t.tourism === 'wilderness_hut' || t.tourism === 'alpine_hut') return 'shelter';
  if (t.tourism === 'camp_site') return 'camp';
  if (t.tourism === 'viewpoint') return 'view';
  if (t.amenity === 'toilets') return 'toilets';
  if (t.waterway === 'waterfall') return 'waterfall';
  return null;
}

const iconCache = {};
function poiIcon(cat) {
  if (iconCache[cat]) return iconCache[cat];
  const c = document.createElement('canvas');
  c.width = c.height = 34;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(5,8,10,0.85)';
  g.strokeStyle = CATS[cat].color; g.lineWidth = 2;
  g.beginPath(); g.arc(17, 17, 15, 0, Math.PI * 2); g.fill(); g.stroke();
  g.font = '17px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(CATS[cat].icon, 17, 18);
  return (iconCache[cat] = c);
}

const NETWORK = { iwn: 'International', nwn: 'National', rwn: 'Regional', lwn: 'Local' };

export class OutdoorPoiLayer {
  constructor(viewer, units) {
    this.viewer = viewer; this.units = units; this.id = 'poi';
    this.bbs = viewer.scene.primitives.add(new Cesium.BillboardCollection({ scene: viewer.scene }));
    this.labels = viewer.scene.primitives.add(new Cesium.LabelCollection({ scene: viewer.scene }));
    this.bbs.show = this.labels.show = false;
    this.loadedRect = null; this.lastFetch = 0; this.items = [];
    this.onMove = () => { clearTimeout(this.deb); this.deb = setTimeout(() => this.maybeLoad(), 900); };
  }

  start() {
    this.bbs.show = this.labels.show = true;
    this.viewer.camera.moveEnd.addEventListener(this.onMove);
    this.maybeLoad();
  }

  stop() {
    this.bbs.show = this.labels.show = false;
    this.viewer.camera.moveEnd.removeEventListener(this.onMove);
    clearTimeout(this.deb);
    setStatus(this.id, '');
  }

  viewRect() {
    const r = this.viewer.camera.computeViewRectangle(this.viewer.scene.globe.ellipsoid);
    if (!r) return null;
    return { w: Cesium.Math.toDegrees(r.west), s: Cesium.Math.toDegrees(r.south), e: Cesium.Math.toDegrees(r.east), n: Cesium.Math.toDegrees(r.north) };
  }

  async maybeLoad() {
    const h = this.viewer.camera.positionCartographic.height;
    const r = this.viewRect();
    if (!r || h > 40000 || r.e - r.w > 0.8 || r.n - r.s > 0.6) { setStatus(this.id, 'zoom in to load', 'warn'); return; }
    const L = this.loadedRect;
    if (L && r.w >= L.w && r.e <= L.e && r.s >= L.s && r.n <= L.n) { setStatus(this.id, `${this.items.length} nearby`, 'ok'); return; }
    const wait = 4000 - (Date.now() - this.lastFetch); // be gentle with the shared Overpass service
    if (wait > 0) { clearTimeout(this.deb); this.deb = setTimeout(() => this.maybeLoad(), wait); return; }
    const padX = (r.e - r.w) * 0.35, padY = (r.n - r.s) * 0.35;
    const q = { w: r.w - padX, e: r.e + padX, s: r.s - padY, n: r.n + padY };
    this.lastFetch = Date.now();
    await this.load(q);
  }

  async load(q) {
    const bb = `${q.s.toFixed(4)},${q.w.toFixed(4)},${q.n.toFixed(4)},${q.e.toFixed(4)}`;
    const query = `[out:json][timeout:25];(
      node["natural"~"^(peak|volcano)$"](${bb});
      node["highway"="trailhead"](${bb});
      node["amenity"="drinking_water"](${bb});
      node["natural"="spring"](${bb});
      nwr["amenity"="shelter"](${bb});
      nwr["tourism"~"^(wilderness_hut|alpine_hut|camp_site)$"](${bb});
      node["tourism"="viewpoint"](${bb});
      nwr["amenity"="toilets"](${bb});
      node["waterway"="waterfall"](${bb});
      relation["route"~"^(hiking|foot)$"](${bb});
    );out center tags 900;`;
    try {
      setStatus(this.id, 'loading…', 'warn');
      const res = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(30000) });
      if (res.status === 429 || res.status === 504) throw new Error('busy — retry in a moment');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      this.render(j.elements || []);
      this.loadedRect = q;
    } catch (err) {
      setStatus(this.id, err.message?.startsWith('busy') ? 'Overpass busy — pan to retry' : describeError(err), 'err');
    }
  }

  render(elements) {
    this.bbs.removeAll(); this.labels.removeAll(); this.items = [];
    const counts = {};
    for (const el of elements) {
      const t = el.tags || {};
      const cat = categorize(t);
      const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
      if (!cat || lat == null || lon == null) continue;
      counts[cat] = (counts[cat] || 0) + 1;
      const item = { cat, lat, lon, tags: t, osm: `${el.type}/${el.id}`, relId: el.type === 'relation' ? el.id : null };
      this.items.push(item);
      const pos = Cesium.Cartesian3.fromDegrees(lon, lat, 20);
      const bb = this.bbs.add({
        position: pos, image: poiIcon(cat), scale: cat === 'route' ? 0.8 : 0.7,
        scaleByDistance: new Cesium.NearFarScalar(1e3, 1.1, 6e4, 0.55),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, cat === 'peak' || cat === 'route' ? 2.5e5 : 6e4),
        disableDepthTestDistance: 5e4,
      });
      bb.id = { kind: 'poi', layer: this.id, item };
      if ((cat === 'peak' && t.name) || cat === 'route') {
        const ele = Number.parseFloat(t.ele);
        this.labels.add({
          position: pos,
          text: cat === 'peak' ? `${t.name}${Number.isFinite(ele) ? ' · ' + this.units.ele(ele) : ''}` : (t.name || t.ref || 'Route'),
          font: '12px monospace', fillColor: Cesium.Color.WHITE, showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.55),
          pixelOffset: new Cesium.Cartesian2(16, -2), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, cat === 'route' ? 3e4 : 5e4), disableDepthTestDistance: 5e4,
        });
      }
    }
    const summary = ['peak', 'trailhead', 'route', 'water', 'shelter', 'camp'].filter((c) => counts[c]).map((c) => `${counts[c]} ${CATS[c].icon}`).join(' ');
    setStatus(this.id, this.items.length ? summary || `${this.items.length} nearby` : 'none mapped here', 'ok');
  }

  pos(id) { return { lat: id.item.lat, lon: id.item.lon, altM: 0 }; }

  card(id) {
    const { cat, tags: t, lat, lon, osm, relId } = id.item;
    const u = this.units;
    const name = t.name || t['name:en'] || CATS[cat].label;
    const rows = [];
    const add = (k, v) => v != null && v !== '' && rows.push(`<dt>${k}</dt><dd>${esc(v)}</dd>`);
    add('Type', CATS[cat].label + (t.shelter_type ? ` (${t.shelter_type.replace(/_/g, ' ')})` : ''));
    const ele = Number.parseFloat(t.ele);
    if (Number.isFinite(ele)) add('Elevation', u.ele(ele));
    if (cat === 'route') {
      add('Network', NETWORK[t.network] || t.network);
      const d = Number.parseFloat(String(t.distance || '').replace(',', '.'));
      if (Number.isFinite(d)) add('Length', u.len(d * 1000));
      add('Ref', t.ref); add('From → to', t.from && t.to ? `${t.from} → ${t.to}` : null);
      add('Operator', t.operator);
    }
    add('Difficulty', t.sac_scale?.replace(/_/g, ' '));
    add('Fee', t.fee); add('Opening hours', t.opening_hours); add('Capacity', t.capacity);
    if (cat === 'water' || cat === 'spring') add('Drinkable', t.drinking_water || (cat === 'water' ? 'yes (mapped)' : 'unknown'));
    const safety = cat === 'spring' || (cat === 'water' && t.drinking_water === 'no') ? '<p class="hint warn">Treat or filter natural water; OpenStreetMap data can be out of date.</p>' : '';
    const links = [
      relId ? `<a href="https://hiking.waymarkedtrails.org/#route?id=${relId}" target="_blank" rel="noopener">Route, elevation profile &amp; GPX ↗</a>` : '',
      `<a href="https://www.openstreetmap.org/${osm}" target="_blank" rel="noopener">OpenStreetMap ↗</a>`,
      `<a href="https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lon.toFixed(6)}" target="_blank" rel="noopener">Directions ↗</a>`,
      t.website ? `<a href="${esc(t.website)}" target="_blank" rel="noopener">Website ↗</a>` : '',
    ].filter(Boolean).join('');
    return `<h3>${CATS[cat].icon} ${esc(name)}</h3><dl>${rows.join('')}</dl>${t.description ? `<p class="hint">${esc(t.description.slice(0, 240))}</p>` : ''}${safety}
      <p class="hint">${lat.toFixed(5)}, ${lon.toFixed(5)}</p><div class="links">${links}</div>`;
  }
}

// ---------- weather code text ----------
const WMO = { 0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail' };

// ---------- tools ----------
export class OutdoorTools {
  constructor(viewer, { units, getCenter, getBasemap, getOverlays, onChange }) {
    this.viewer = viewer; this.units = units; this.getCenter = getCenter; this.getBasemap = getBasemap; this.getOverlays = getOverlays;
    this.onChange = onChange || (() => {});
    this.id = 'tools';
    this.trackDs = new Cesium.CustomDataSource('track');
    viewer.dataSources.add(this.trackDs);
    this.track = loadTrack();
    this.watch = null; this.wake = null;
    this.drawTrack();
  }
  start() {} stop() {} // registry no-ops: this "layer" only provides cards
  pos() { return null; } // tool cards never move the camera

  card(id) {
    if (id.kind === 'conditions') { this.fillConditions(id); return `<h3>🌤️ Conditions</h3><p class="hint" id="condBody">Loading forecast…</p>`; }
    if (id.kind === 'coords') return this.coordsCard(id.pos);
    if (id.kind === 'offline') return `<h3>💾 Save area offline</h3><div id="offBody"></div>`;
    return '';
  }

  // ----- conditions -----
  async fillConditions({ lat, lon, where }) {
    const u = this.units;
    const params = new URLSearchParams({
      latitude: lat.toFixed(4), longitude: lon.toFixed(4), timezone: 'auto', forecast_days: '2',
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,is_day',
      hourly: 'temperature_2m,precipitation_probability,weather_code',
      daily: 'sunrise,sunset,uv_index_max,temperature_2m_max,temperature_2m_min,precipitation_sum',
    });
    try {
      const [w, e] = await Promise.all([
        fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`, { timeout: 15000 }),
        fetchJson(`https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`, { timeout: 10000 }).catch(() => null),
      ]);
      const el = document.getElementById('condBody');
      if (!el) return;
      const off = (w.utc_offset_seconds || 0) * 1000;
      const local = (s) => Date.parse(s + 'Z') - off; // API times are local wall-clock strings
      const now = Date.now();
      const c = w.current;
      const hours = w.hourly.time.map((t, i) => ({ t: local(t), p: w.hourly.precipitation_probability[i], code: w.hourly.weather_code[i], temp: w.hourly.temperature_2m[i] })).filter((h) => h.t >= now - 3600e3 && h.t <= now + 12 * 3600e3);
      const maxP = Math.max(0, ...hours.map((h) => h.p ?? 0));
      const thunder = hours.find((h) => h.code >= 95);
      const sunset = local(w.daily.sunset[0]), sunrise = local(w.daily.sunrise[0]), sunriseTomorrow = local(w.daily.sunrise[1]);
      const fmtT = (ms) => new Date(ms + off).toISOString().slice(11, 16); // local time at the point
      const until = (ms) => { const m = Math.round((ms - now) / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
      const daylight = now < sunrise ? `Sunrise in ${until(sunrise)} (${fmtT(sunrise)})` : now < sunset ? `<b>${until(sunset)}</b> of daylight left (sunset ${fmtT(sunset)})` : `After dark · sunrise ${fmtT(sunriseTomorrow)}`;
      const warn = [];
      if (thunder) warn.push(`⚡ Thunderstorms possible around ${fmtT(thunder.t)} — avoid ridges and summits.`);
      if (now < sunset && sunset - now < 90 * 60e3) warn.push('🌇 Less than 90 minutes of daylight.');
      if (c.wind_gusts_10m >= 60) warn.push(`💨 Strong gusts (${u.speed(c.wind_gusts_10m)}).`);
      if (c.apparent_temperature <= 0) warn.push('🥶 Feels below freezing.');
      const elev = e?.elevation?.[0];
      el.outerHTML = `
        <p class="hint">${esc(where)} · ${lat.toFixed(4)}, ${lon.toFixed(4)}${Number.isFinite(elev) ? ` · ${u.ele(elev)}` : ''}</p>
        ${warn.length ? `<p class="warnbox">${warn.join('<br>')}</p>` : ''}
        <dl>
          <dt>Now</dt><dd>${WMO[c.weather_code] || '—'} · ${u.temp(c.temperature_2m)}</dd>
          <dt>Feels like</dt><dd>${u.temp(c.apparent_temperature)}</dd>
          <dt>Wind</dt><dd>${u.speed(c.wind_speed_10m)}, gusts ${u.speed(c.wind_gusts_10m)}</dd>
          <dt>Rain chance (12 h)</dt><dd>${maxP}%</dd>
          <dt>Today</dt><dd>${u.temp(w.daily.temperature_2m_min[0])} – ${u.temp(w.daily.temperature_2m_max[0])}, ${u.precip(w.daily.precipitation_sum[0])}</dd>
          <dt>UV max</dt><dd>${w.daily.uv_index_max[0] ?? '—'}</dd>
        </dl>
        <p class="hint">${daylight}</p>
        <div class="hours">${hours.filter((_, i) => i % 2 === 0).slice(0, 6).map((h) => `<span><b>${fmtT(h.t)}</b>${u.temp(h.temp)}<i>${h.p ?? 0}%</i></span>`).join('')}</div>
        <p class="hint">Forecast: Open-Meteo. Mountain weather changes fast — check an official forecast before you go.</p>`;
    } catch (err) {
      const el = document.getElementById('condBody');
      if (el) el.textContent = `Forecast unavailable (${describeError(err)}).`;
    }
  }

  // ----- coordinates -----
  coordsCard(p) {
    const u = this.units;
    const { lat, lon, accuracy, altitude } = p;
    const text = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    setTimeout(() => {
      document.getElementById('copyCoords')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(text); toast('Coordinates copied'); } catch { prompt('Copy these coordinates', text); }
      });
      document.getElementById('shareCoords')?.addEventListener('click', () => navigator.share({ title: 'My location', text: `I'm at ${text} (±${Math.round(accuracy)} m) https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=16/${lat.toFixed(5)}/${lon.toFixed(5)}` }).catch(() => {}));
    }, 0);
    return `<h3>📋 My coordinates</h3>
      <p class="bigcoords">${text}</p>
      <dl>
        <dt>DMS</dt><dd>${dms(lat, 'N', 'S')}<br>${dms(lon, 'E', 'W')}</dd>
        <dt>Accuracy</dt><dd>± ${u.len(accuracy)}</dd>
        ${altitude != null ? `<dt>GPS altitude</dt><dd>${u.ele(altitude)}</dd>` : ''}
      </dl>
      <div class="links"><button id="copyCoords">Copy</button>${navigator.share ? '<button id="shareCoords">Share…</button>' : ''}</div>
      <p class="hint">In an emergency, call 911 (US) or 112 and read these numbers to the dispatcher. This position stays on your device unless you share it.</p>`;
  }

  getPosition() {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) return reject(new Error('Location isn’t supported in this browser'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy, altitude: pos.coords.altitude }),
        (err) => reject(new Error({ 1: 'Location permission is blocked — allow it in your browser’s site settings.', 2: 'Your device couldn’t determine a location.', 3: 'Getting a location took too long.' }[err.code] || 'Location unavailable')),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 },
      );
    });
  }

  // ----- track recording -----
  get recording() { return this.watch != null; }

  async startRecording() {
    if (!('geolocation' in navigator)) return toast('Location isn’t supported in this browser');
    if (this.track.points.length && !confirm('Continue the saved track? (Cancel starts a new one.)')) this.track = { started: Date.now(), points: [] };
    if (!this.track.started) this.track.started = Date.now();
    let firstFix = true;
    toast('Waiting for GPS… keep this screen open while recording.', 4000);
    this.watch = navigator.geolocation.watchPosition((pos) => {
      if (firstFix) { firstFix = false; toast('Recording — keep this screen open; phones pause web apps in the background.', 5000); }
      this.addPoint(pos);
    }, (err) => {
      if (err.code === 1) this.stopRecording();
      toast({ 1: 'Location permission is blocked — allow it in your browser’s site settings to record.', 2: 'No GPS fix yet…', 3: 'Still waiting for GPS…' }[err.code] || 'Location error', 5000);
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    try { const w = await navigator.wakeLock?.request('screen'); if (this.recording) this.wake = w; else w?.release?.(); } catch { /* not supported / denied */ }
    document.addEventListener('visibilitychange', this.reWake = async () => {
      if (document.visibilityState === 'visible' && this.recording) { try { this.wake = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ } }
    });
    this.onChange();
  }

  stopRecording() {
    if (this.watch != null) navigator.geolocation.clearWatch(this.watch);
    this.watch = null;
    this.wake?.release?.(); this.wake = null;
    if (this.reWake) document.removeEventListener('visibilitychange', this.reWake);
    saveTrack(this.track);
    this.onChange();
  }

  addPoint(pos) {
    const { latitude: lat, longitude: lon, accuracy, altitude } = pos.coords;
    if (accuracy > 50) return; // too fuzzy to trust
    const pts = this.track.points;
    const last = pts[pts.length - 1];
    if (last && haversine([last[0], last[1]], [lat, lon]) < Math.max(5, accuracy * 0.5)) return; // jitter while standing still
    pts.push([+lat.toFixed(6), +lon.toFixed(6), altitude != null ? +altitude.toFixed(1) : null, pos.timestamp]);
    if (pts.length % 5 === 0) saveTrack(this.track);
    this.drawTrack();
    this.onChange();
  }

  stats() {
    const pts = this.track.points;
    let dist = 0, gain = 0, ref = null;
    for (let i = 1; i < pts.length; i++) dist += haversine(pts[i - 1], pts[i]);
    for (const p of pts) { // elevation gain with 4 m hysteresis to ignore GPS noise
      if (p[2] == null) continue;
      if (ref == null) ref = p[2];
      else if (p[2] - ref >= 4) { gain += p[2] - ref; ref = p[2]; } else if (ref - p[2] >= 4) ref = p[2];
    }
    const t0 = pts[0]?.[3], t1 = pts[pts.length - 1]?.[3];
    return { n: pts.length, dist, gain, secs: t0 && t1 ? (t1 - t0) / 1000 : 0, hasAlt: pts.some((p) => p[2] != null) };
  }

  drawTrack() {
    this.trackDs.entities.removeAll();
    const pts = this.track.points;
    if (pts.length >= 2) {
      this.trackDs.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArray(pts.flatMap((p) => [p[1], p[0]])), width: 4, material: Cesium.Color.fromCssColorString('#ff3bd4'), clampToGround: true } });
    }
    if (pts.length) {
      const p = pts[pts.length - 1];
      this.trackDs.entities.add({ position: Cesium.Cartesian3.fromDegrees(p[1], p[0]), point: { pixelSize: 10, color: Cesium.Color.fromCssColorString('#ff3bd4'), outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: 1e7, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND } });
    }
  }

  clearTrack() {
    if (this.recording) this.stopRecording();
    this.track = { started: null, points: [] };
    saveTrack(this.track);
    this.drawTrack();
    this.onChange();
  }

  async exportGpx() {
    const pts = this.track.points;
    if (pts.length < 2) return toast('Nothing recorded yet');
    const name = `God's Eye Lite track ${new Date(this.track.started || pts[0][3]).toISOString().slice(0, 16).replace('T', ' ')}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="God's Eye Lite" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name><time>${new Date(pts[0][3]).toISOString()}</time></metadata>
  <trk><name>${esc(name)}</name><trkseg>
${pts.map((p) => `    <trkpt lat="${p[0]}" lon="${p[1]}">${p[2] != null ? `<ele>${p[2]}</ele>` : ''}<time>${new Date(p[3]).toISOString()}</time></trkpt>`).join('\n')}
  </trkseg></trk>
</gpx>`;
    const file = new File([xml], `track-${new Date(pts[0][3]).toISOString().slice(0, 10)}.gpx`, { type: 'application/gpx+xml' });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch { /* fall back to download */ } }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ----- offline area -----
  planOffline() {
    const r = this.viewer.camera.computeViewRectangle(this.viewer.scene.globe.ellipsoid);
    if (!r) return { error: 'Point the map at the ground first.' };
    const rect = { w: Cesium.Math.toDegrees(r.west), s: Cesium.Math.toDegrees(r.south), e: Cesium.Math.toDegrees(r.east), n: Cesium.Math.toDegrees(r.north) };
    if (rect.e - rect.w > 1.5 || rect.n - rect.s > 1.2) return { error: 'Zoom in to the area you’ll be in (roughly a county or smaller).' };
    const h = this.viewer.camera.positionCartographic.height;
    const zNow = Math.max(8, Math.min(16, Math.round(Math.log2(4e7 / Math.max(h, 1)))));
    const sets = [this.getBasemap(), ...this.getOverlays()].filter((n) => TILESETS[n]);
    const LIMIT = 2500;
    let zMax = Math.min(16, zNow + 3);
    let tiles = [];
    for (; zMax >= zNow; zMax--) {
      tiles = [];
      for (const name of sets) {
        for (let z = Math.max(1, zNow - 3); z <= Math.min(zMax, TILESETS[name].max); z++) {
          const t = tileRange(rect, z);
          for (let x = t.x0; x <= t.x1; x++) for (let y = t.y0; y <= t.y1; y++) tiles.push(tileUrl(name, z, x, y));
        }
      }
      if (tiles.length <= LIMIT) break;
    }
    if (tiles.length > LIMIT) return { error: 'That area is too large at trail-level detail. Zoom in a little.' };
    return { rect, sets, tiles, zMin: Math.max(1, zNow - 3), zMax };
  }

  async saveOffline(plan, onProgress, signal) {
    try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
    const cache = await caches.open(OFFLINE_CACHE);
    let done = 0, failed = 0, i = 0;
    const worker = async () => {
      while (i < plan.tiles.length && !signal.aborted) {
        const url = plan.tiles[i++];
        try {
          if (!(await cache.match(url))) {
            const res = await fetch(url, { mode: 'cors', signal });
            if (res.ok) await cache.put(url, res); else failed++;
          }
        } catch { if (!signal.aborted) failed++; }
        done++;
        onProgress(done, failed);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    const saved = JSON.parse(localStorage.getItem('gel:offlineAreas') || '[]');
    if (!signal.aborted) {
      saved.push({ at: Date.now(), rect: plan.rect, sets: plan.sets, tiles: plan.tiles.length });
      localStorage.setItem('gel:offlineAreas', JSON.stringify(saved.slice(-20)));
    }
    return { done, failed };
  }

  async clearOffline() {
    await caches.delete(OFFLINE_CACHE);
    localStorage.removeItem('gel:offlineAreas');
  }

  offlineAreas() { try { return JSON.parse(localStorage.getItem('gel:offlineAreas') || '[]'); } catch { return []; } }
}

function loadTrack() {
  try { const t = JSON.parse(localStorage.getItem('gel:track')); if (t && Array.isArray(t.points)) return t; } catch { /* ignore */ }
  return { started: null, points: [] };
}
function saveTrack(t) { try { localStorage.setItem('gel:track', JSON.stringify(t)); } catch { /* storage full */ } }
