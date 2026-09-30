// Place search + device location.
//  • Type-ahead: Photon (komoot, OpenStreetMap data) — built for autocomplete, biased to the current view.
//  • Enter with no suggestion picked: Nominatim (OSM Foundation) as a second opinion — used only on
//    explicit submit, never per keystroke, per its usage policy (max 1 request/second).
//  • "lat, lon" typed directly flies there with no network request.
//  • 📍 uses the browser Geolocation API. The position never leaves the device: it isn't sent to a
//    geocoder, stored, or put in share links.
import { fetchJson, esc, toast } from './util.js';

const PHOTON = 'https://photon.komoot.io/api/';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

export function initSearch({ viewer, getCenter }) {
  const box = document.getElementById('searchBox');
  const input = document.getElementById('searchInput');
  const list = document.getElementById('searchList');
  const locateBtn = document.getElementById('locateBtn');
  const clearBtn = document.getElementById('searchClear');

  const pins = new Cesium.CustomDataSource('search');
  viewer.dataSources.add(pins);
  const me = new Cesium.CustomDataSource('me');
  viewer.dataSources.add(me);

  let results = [];
  let active = -1;
  let seq = 0;
  let debounce = null;
  let lastNominatim = 0;
  let watchId = null;

  // ---------- helpers ----------
  const coordRe = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

  function label(f) {
    const p = f.properties || {};
    const street = [p.housenumber, p.street].filter(Boolean).join(' ');
    const title = p.name || street || p.city || p.county || p.state || p.country || 'Unnamed place';
    const rest = [p.name && street ? street : '', p.city || p.district, p.state, p.country]
      .filter((x) => x && x !== title);
    return { title, sub: [...new Set(rest)].join(', ') };
  }

  function fromPhoton(f) {
    const [lon, lat] = f.geometry.coordinates;
    const { title, sub } = label(f);
    const ext = f.properties.extent; // [minLon, maxLat, maxLon, minLat]
    return { lat, lon, title, sub, kind: f.properties.osm_value, extent: ext ? { w: ext[0], n: ext[1], e: ext[2], s: ext[3] } : null };
  }

  function fromNominatim(r) {
    const bb = r.boundingbox?.map(Number); // [s, n, w, e]
    const parts = String(r.display_name || '').split(', ');
    return { lat: Number(r.lat), lon: Number(r.lon), title: r.name || parts[0], sub: parts.slice(r.name ? 0 : 1).join(', ').replace(`${r.name}, `, ''), kind: r.type, extent: bb ? { s: bb[0], n: bb[1], w: bb[2], e: bb[3] } : null };
  }

  function render() {
    if (!results.length) { list.hidden = true; list.innerHTML = ''; input.setAttribute('aria-expanded', 'false'); return; }
    list.innerHTML = results.map((r, i) => `
      <li role="option" id="sr-${i}" data-i="${i}" aria-selected="${i === active}" class="${i === active ? 'on' : ''}">
        <b>${esc(r.title)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}
      </li>`).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', active >= 0 ? `sr-${active}` : '');
  }

  function close() { results = []; active = -1; render(); }

  async function suggest(q) {
    const my = ++seq;
    const c = getCenter();
    const params = new URLSearchParams({ q, limit: '10', lang: 'en' });
    if (c) {
      // Bias toward the view, scaled to zoom: street-level views favour nearby matches, globe views barely
      // do. location_bias_scale 0.6 keeps well-known places (e.g. "Worcester MA" from London) on top.
      const h = viewer.camera.positionCartographic.height;
      const zoom = Math.max(3, Math.min(14, Math.round(Math.log2(4e7 / Math.max(h, 1)))));
      params.set('lat', c.lat.toFixed(3)); params.set('lon', c.lon.toFixed(3));
      params.set('zoom', String(zoom)); params.set('location_bias_scale', '0.6');
    }
    try {
      const j = await fetchJson(`${PHOTON}?${params}`, { timeout: 8000 });
      if (my !== seq) return; // a newer keystroke won
      const seen = new Set();
      results = (j.features || []).map(fromPhoton).filter((r) => {
        const k = `${r.title}|${r.sub}`; // OSM often has a node and an area for one place
        if (seen.has(k)) return false;
        seen.add(k); return true;
      }).slice(0, 6);
      active = results.length ? 0 : -1;
      render();
    } catch {
      if (my === seq) close();
    }
  }

  async function submit() {
    const q = input.value.trim();
    if (!q) return;
    const m = q.match(coordRe);
    if (m) {
      const lat = Number(m[1]), lon = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return pick({ lat, lon, title: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, sub: 'Coordinates' });
    }
    if (active >= 0 && results[active]) return pick(results[active]);
    // Nothing suggested — ask Nominatim once (rate-limited to 1/s).
    const wait = 1100 - (Date.now() - lastNominatim);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatim = Date.now();
    try {
      box.classList.add('busy');
      const params = new URLSearchParams({ q, format: 'jsonv2', limit: '5', addressdetails: '0' });
      const j = await fetchJson(`${NOMINATIM}?${params}`, { timeout: 10000, headers: { 'Accept-Language': navigator.language || 'en' } });
      results = (Array.isArray(j) ? j : []).map(fromNominatim);
      if (results.length === 1) return pick(results[0]);
      active = results.length ? 0 : -1;
      render();
      if (!results.length) toast('No match — try adding a city or postcode');
    } catch {
      toast('Search is unavailable right now');
    } finally {
      box.classList.remove('busy');
    }
  }

  function pick(r) {
    close();
    input.value = r.title;
    input.blur();
    clearBtn.hidden = false;
    pins.entities.removeAll();
    pins.entities.add({
      position: Cesium.Cartesian3.fromDegrees(r.lon, r.lat),
      point: { pixelSize: 12, color: Cesium.Color.fromCssColorString('#ff5a3c'), outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: 1e7, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
      label: { text: r.title, font: '13px monospace', pixelOffset: new Cesium.Cartesian2(0, -22), fillColor: Cesium.Color.WHITE, showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.6), disableDepthTestDistance: 1e7, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
    });
    flyTo(r);
  }

  function flyTo(r) {
    const e = r.extent;
    const big = e && (Math.abs(e.e - e.w) > 0.02 || Math.abs(e.n - e.s) > 0.02);
    if (big) {
      viewer.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(e.w, e.s, e.e, e.n), duration: 1.8 });
    } else {
      viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(r.lon, r.lat), 1), {
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-50), 1500), duration: 1.8,
      });
    }
  }

  function clearPin() {
    pins.entities.removeAll();
    input.value = '';
    clearBtn.hidden = true;
    close();
  }

  // ---------- device location ----------
  function showMe(pos, fly) {
    const { latitude: lat, longitude: lon, accuracy } = pos.coords;
    me.entities.removeAll();
    me.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      ellipse: { semiMajorAxis: Math.max(accuracy, 5), semiMinorAxis: Math.max(accuracy, 5), material: Cesium.Color.fromCssColorString('#4da3ff').withAlpha(0.18), outline: true, outlineColor: Cesium.Color.fromCssColorString('#4da3ff'), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
    });
    me.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: { pixelSize: 14, color: Cesium.Color.fromCssColorString('#4da3ff'), outlineColor: Cesium.Color.WHITE, outlineWidth: 3, disableDepthTestDistance: 1e7, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
    });
    if (fly) {
      const range = Math.min(Math.max(accuracy * 6, 800), 50000);
      viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon, lat), 1), {
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-55), range), duration: 1.8,
      });
    }
    return { lat, lon, accuracy };
  }

  function geoError(err) {
    stopWatch();
    const msg = {
      1: 'Location permission is blocked. Allow it in your browser’s site settings for this page, then tap 📍 again.',
      2: 'Your device couldn’t determine a location. Check that location services are on.',
      3: 'Finding your location took too long. Try again, ideally with Wi-Fi or GPS on.',
    }[err?.code] || 'Location is unavailable.';
    toast(msg, 5000);
  }

  function stopWatch() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    locateBtn.classList.remove('on', 'busy');
    locateBtn.title = 'Show my location';
  }

  function locate() {
    if (!('geolocation' in navigator) || !window.isSecureContext) return toast('Location needs HTTPS and a browser that supports it');
    if (watchId != null) { stopWatch(); me.entities.removeAll(); toast('Stopped following your location'); return; }
    locateBtn.classList.add('busy');
    let first = true;
    // watchPosition: first fix flies there; later fixes just move the dot. Tap 📍 again to stop.
    watchId = navigator.geolocation.watchPosition((pos) => {
      const p = showMe(pos, first);
      if (first) {
        first = false;
        locateBtn.classList.remove('busy'); locateBtn.classList.add('on');
        locateBtn.title = 'Following your location — tap to stop';
        toast(`You’re here (±${Math.round(p.accuracy)} m). Tap 📍 again to stop.`, 3500);
      }
    }, geoError, { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 });
  }

  // ---------- events ----------
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearBtn.hidden = !input.value;
    clearTimeout(debounce);
    if (q.length < 3 || coordRe.test(q)) { seq++; close(); return; }
    debounce = setTimeout(() => suggest(q), 300);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && results.length) { e.preventDefault(); active = (active + 1) % results.length; render(); }
    else if (e.key === 'ArrowUp' && results.length) { e.preventDefault(); active = (active - 1 + results.length) % results.length; render(); }
    else if (e.key === 'Enter') { e.preventDefault(); clearTimeout(debounce); submit(); }
    else if (e.key === 'Escape') { if (results.length) close(); else input.blur(); }
  });

  // pointerdown so the pick happens before the input's blur closes the list
  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    pick(results[Number(li.dataset.i)]);
  });

  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('focus', () => { if (input.value.trim().length >= 3 && !coordRe.test(input.value)) suggest(input.value.trim()); });
  clearBtn.addEventListener('click', clearPin);
  locateBtn.addEventListener('click', locate);

  document.addEventListener('keydown', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (e.key === '/' && !(t && t.closest('input, textarea, select, dialog'))) { e.preventDefault(); input.focus(); input.select(); }
  });

  return { clearPin, locate };
}
