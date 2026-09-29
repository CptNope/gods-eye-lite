// God's Eye Lite — static PWA front-end for the keyless feeds used by God's Eye View.
import { FlightsLayer } from './layers/flights.js';
import { SatellitesLayer } from './layers/satellites.js';
import { QuakesLayer } from './layers/quakes.js';
import { LaunchesLayer } from './layers/launches.js';
import { Styles, STYLE_ORDER } from './styles.js';
import { toast, fmt, esc } from './util.js';

const $ = (s) => document.querySelector(s);
const TOKEN_KEY = 'gel:ionToken';
const PREF_KEY = 'gel:prefs';
const ionToken = (localStorage.getItem(TOKEN_KEY) || '').trim();
const prefs = loadPrefs();

if (typeof Cesium === 'undefined') {
  document.body.innerHTML = '<p style="padding:24px">Could not load CesiumJS from the CDN. Check your connection and reload.</p>';
  throw new Error('Cesium missing');
}
if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;

// ---------- Viewer ----------
const viewer = new Cesium.Viewer('globe', {
  baseLayer: false,
  animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
  sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false,
  infoBox: false, selectionIndicator: false,
  terrain: ionToken ? Cesium.Terrain.fromWorldTerrain() : undefined,
  msaaSamples: 2,
});
const scene = viewer.scene;
scene.globe.enableLighting = false;
scene.globe.baseColor = Cesium.Color.fromCssColorString('#061014');
scene.skyAtmosphere.show = true;
scene.fog.enabled = true;
viewer.clock.shouldAnimate = true;

// ---------- Basemaps ----------
const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const BASEMAPS = {
  esri: () => new Cesium.UrlTemplateImageryProvider({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maximumLevel: 19, credit: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  }),
  gibs: () => new Cesium.UrlTemplateImageryProvider({
    url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${yesterday}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    maximumLevel: 9, credit: `NASA GIBS · VIIRS SNPP true color · ${yesterday}`,
  }),
  osm: () => new Cesium.UrlTemplateImageryProvider({
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', subdomains: 'abcd',
    maximumLevel: 19, credit: '© OpenStreetMap contributors © CARTO',
  }),
  dark: () => new Cesium.UrlTemplateImageryProvider({
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', subdomains: 'abcd',
    maximumLevel: 19, credit: '© OpenStreetMap contributors © CARTO',
  }),
};
let baseLayer = null;
function setBasemap(name) {
  if (!BASEMAPS[name]) name = 'esri';
  if (baseLayer) viewer.imageryLayers.remove(baseLayer, true);
  baseLayer = viewer.imageryLayers.addImageryProvider(BASEMAPS[name](), 0);
  prefs.base = name; savePrefs();
  document.querySelectorAll('#basemap button').forEach((b) => b.classList.toggle('on', b.dataset.base === name));
}
setBasemap(prefs.base || 'esri');
$('#basemap').addEventListener('click', (e) => e.target.dataset.base && setBasemap(e.target.dataset.base));

// ---------- Photorealistic 3D (optional, needs ion token) ----------
let photoreal = null;
async function setPhotoreal(on) {
  const status = $('#photorealStatus');
  if (!ionToken) { status.textContent = 'needs token'; status.className = 'warn'; $('#photoreal').checked = false; if (on) openSettings(); return; }
  prefs.photoreal = on; savePrefs();
  if (!on) {
    if (photoreal) photoreal.show = false;
    scene.globe.show = true; status.textContent = 'off'; status.className = '';
    return;
  }
  try {
    status.textContent = 'loading…'; status.className = 'warn';
    if (!photoreal) photoreal = scene.primitives.add(await Cesium.createGooglePhotorealistic3DTileset());
    photoreal.show = true;
    scene.globe.show = false;
    status.textContent = 'on · ion'; status.className = 'ok';
  } catch (err) {
    console.error(err);
    status.textContent = 'token rejected'; status.className = 'err';
    $('#photoreal').checked = false; scene.globe.show = true;
  }
}
$('#photoreal').addEventListener('change', (e) => setPhotoreal(e.target.checked));
if (ionToken) { $('#photorealStatus').textContent = 'off'; $('#photorealStatus').className = ''; }

// ---------- Camera helpers ----------
function viewCenter() {
  const c = scene.canvas;
  const hit = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(c.clientWidth / 2, c.clientHeight / 2));
  const carto = hit ? Cesium.Cartographic.fromCartesian(hit) : viewer.camera.positionCartographic;
  return { lat: Cesium.Math.toDegrees(carto.latitude), lon: Cesium.Math.toDegrees(carto.longitude) };
}

function flyToPos(p, range = 60000) {
  const target = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.altM || 0);
  viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 1), {
    offset: new Cesium.HeadingPitchRange(viewer.camera.heading, Cesium.Math.toRadians(-40), range),
    duration: 1.6,
  });
}

// ---------- Layers ----------
const layers = {
  flights: new FlightsLayer(viewer, { mode: 'civil', getCenter: viewCenter }),
  military: new FlightsLayer(viewer, { mode: 'military' }),
  satellites: new SatellitesLayer(viewer),
  quakes: new QuakesLayer(viewer),
  launches: new LaunchesLayer(viewer, { onList: renderLaunches }),
};
const active = new Set();

function setLayer(id, on) {
  const L = layers[id];
  if (!L) return;
  if (on && !active.has(id)) { active.add(id); L.start(); }
  if (!on && active.has(id)) { active.delete(id); L.stop(); if (selected?.layer === id) deselect(); }
  const box = document.querySelector(`[data-layer="${id}"]`);
  if (box) box.checked = on;
  prefs.layers = [...active]; savePrefs();
}
document.querySelectorAll('[data-layer]').forEach((box) => box.addEventListener('change', () => setLayer(box.dataset.layer, box.checked)));

$('#satGroup').value = prefs.satGroup || 'visual';
layers.satellites.group = $('#satGroup').value;
$('#satGroup').addEventListener('change', (e) => { prefs.satGroup = e.target.value; savePrefs(); layers.satellites.setGroup(e.target.value); });

// Civil flights follow the view: re-poll shortly after the camera settles somewhere new.
let lastPollCenter = null;
viewer.camera.moveEnd.addEventListener(() => {
  if (!active.has('flights')) return;
  const c = viewCenter();
  if (!lastPollCenter || Math.abs(c.lat - lastPollCenter.lat) + Math.abs(c.lon - lastPollCenter.lon) > 1.5) {
    lastPollCenter = c;
    layers.flights.poll();
  }
});

function renderLaunches(list) {
  const sec = $('#launchList'), ol = $('#launches');
  if (!list) { sec.hidden = true; return; }
  sec.hidden = false;
  ol.innerHTML = list.slice(0, 8).map((r, i) => `
    <li data-i="${i}"><span>${esc(r.name)}</span>
      <small><span class="t">${fmt.countdown(r.net)}</span> · ${esc(r.pad.location?.name || r.pad.name)}</small></li>`).join('');
}
$('#launches').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const r = layers.launches.results[Number(li.dataset.i)];
  if (r) select({ kind: 'launch', layer: 'launches', r });
});

// ---------- Selection, info card, follow ----------
let selected = null;
let following = false;
let followTimer = null;

function selectedRef(id) {
  return id.kind === 'aircraft' ? id.hex : id.kind === 'satellite' ? id.sat : id.kind === 'quake' ? id.f : id.r;
}
function positionOfSelected() {
  if (!selected) return null;
  const L = layers[selected.layer];
  return L.positionOf(selectedRef(selected));
}

function select(id) {
  if (selected && selected.layer !== id.layer) layers[selected.layer].onDeselect?.();
  stopFollow();
  selected = id;
  const L = layers[id.layer];
  const canFollow = id.kind === 'aircraft' || id.kind === 'satellite';
  $('#cardBody').innerHTML = L.card(id) + (canFollow ? '<button class="track" id="followBtn">🎯 Follow</button>' : '');
  $('#card').hidden = false;
  if (window.innerWidth < 640) $('#panel').classList.add('closed'); // card and panel share the screen on phones
  const p = positionOfSelected();
  if (p) flyToPos(p, id.kind === 'satellite' ? 2.5e6 : id.kind === 'aircraft' ? 40000 : 400000);
  if (canFollow) $('#followBtn').addEventListener('click', () => (following ? stopFollow() : startFollow()));
}

function deselect() {
  if (selected) layers[selected.layer].onDeselect?.();
  stopFollow();
  selected = null;
  $('#card').hidden = true;
}

function startFollow() {
  const p = positionOfSelected();
  if (!p) return;
  following = true;
  $('#followBtn').textContent = '■ Stop following';
  $('#followBtn').classList.add('on');
  const range = selected.kind === 'satellite' ? 2.5e6 : 30000;
  viewer.camera.lookAt(Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.altM), new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), range));
  followTimer = setInterval(() => {
    const q = positionOfSelected();
    if (!q) return stopFollow();
    const offset = Cesium.Cartesian3.clone(viewer.camera.position); // offset in the current local frame keeps the user's orbit
    viewer.camera.lookAt(Cesium.Cartesian3.fromDegrees(q.lon, q.lat, q.altM), offset);
  }, 250);
}

function stopFollow() {
  if (!following) return;
  following = false;
  clearInterval(followTimer);
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  const b = $('#followBtn');
  if (b) { b.textContent = '🎯 Follow'; b.classList.remove('on'); }
}

const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
handler.setInputAction((click) => {
  const picked = scene.pick(click.position);
  const id = picked?.id ?? picked?.primitive?.id;
  if (id && id.kind && layers[id.layer]) select(id);
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

handler.setInputAction((move) => {
  const hit = viewer.camera.pickEllipsoid(move.endPosition);
  if (!hit) return;
  const c = Cesium.Cartographic.fromCartesian(hit);
  $('#coords').textContent = `${Cesium.Math.toDegrees(c.latitude).toFixed(4)}, ${Cesium.Math.toDegrees(c.longitude).toFixed(4)}`;
}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

$('#cardClose').addEventListener('click', deselect);

// ---------- Sensor styles & keyboard ----------
const styles = new Styles(viewer);
$('#styles').addEventListener('click', (e) => {
  const s = e.target.dataset.style;
  if (s) { styles.set(s); prefs.style = s; savePrefs(); }
});
document.addEventListener('keydown', (e) => {
  // Only swallow keys while typing; checkboxes/buttons keep focus after a click and shouldn't block shortcuts.
  const t = e.target instanceof Element ? e.target : null;
  if (t && (t.closest('dialog, textarea, select') || (t.matches('input') && !['checkbox', 'radio', 'button'].includes(t.type)))) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const n = Number(e.key);
  if (n >= 1 && n <= STYLE_ORDER.length) { styles.set(STYLE_ORDER[n - 1]); prefs.style = STYLE_ORDER[n - 1]; savePrefs(); }
  if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('no-hud');
  if (e.key === 'Escape') deselect();
});

// ---------- Panel, clock ----------
$('#panelToggle').addEventListener('click', () => $('#panel').classList.toggle('closed'));
if (window.innerWidth < 640) $('#panel').classList.add('closed');
setInterval(() => { $('#clock').textContent = new Date().toISOString().slice(11, 19) + ' UTC'; }, 1000);
setInterval(() => { if (active.has('launches') && layers.launches.results.length) renderLaunches(layers.launches.results); }, 30000);

// ---------- Share links (#v=lat,lon,height,heading,pitch&s=style&l=a,b) ----------
function shareUrl() {
  const c = viewer.camera.positionCartographic;
  const v = [Cesium.Math.toDegrees(c.latitude).toFixed(4), Cesium.Math.toDegrees(c.longitude).toFixed(4), Math.round(c.height),
    Cesium.Math.toDegrees(viewer.camera.heading).toFixed(1), Cesium.Math.toDegrees(viewer.camera.pitch).toFixed(1)].join(',');
  const q = new URLSearchParams({ v, s: styles.current, l: [...active].join(',') });
  return `${location.origin}${location.pathname}#${q.toString()}`;
}
$('#shareBtn').addEventListener('click', async () => {
  const url = shareUrl();
  try { await navigator.clipboard.writeText(url); toast('Share link copied'); }
  catch { prompt('Copy this link', url); }
});

function applyHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  const v = q.get('v')?.split(',').map(Number);
  if (v && v.length >= 3 && v.every(Number.isFinite)) {
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(v[1], v[0], v[2]),
      orientation: { heading: Cesium.Math.toRadians(v[3] || 0), pitch: Cesium.Math.toRadians(v[4] ?? -90), roll: 0 },
    });
  } else {
    viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-71.5, 38, 1.4e7) });
  }
  return { style: q.get('s'), layers: q.get('l')?.split(',').filter(Boolean) };
}

// ---------- Settings (ion token) ----------
function openSettings() {
  $('#ionToken').value = ionToken;
  $('#relayInput').value = localStorage.getItem('gel:relay') || '';
  $('#settings').showModal();
}
$('#settingsBtn').addEventListener('click', openSettings);
$('#saveToken').addEventListener('click', () => {
  const v = $('#ionToken').value.trim();
  if (v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY);
  const relay = $('#relayInput').value.trim();
  if (relay && !/^https:\/\//.test(relay)) { toast('Relay URL must start with https://'); return; }
  if (relay) localStorage.setItem('gel:relay', relay); else localStorage.removeItem('gel:relay');
  location.reload();
});
$('#clearToken').addEventListener('click', () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem('gel:relay'); prefs.photoreal = false; savePrefs(); location.reload(); });

// ---------- PWA: service worker + install ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW failed', e)));
}
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $('#installBtn').hidden = false; });
$('#installBtn').addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null; $('#installBtn').hidden = true;
});
window.addEventListener('online', () => toast('Back online — feeds resuming'));
window.addEventListener('offline', () => toast('Offline — showing last known data'));

// ---------- Boot ----------
const fromHash = applyHash();
styles.set(fromHash.style || prefs.style || 'normal');
const startLayers = fromHash.layers || prefs.layers || ['flights', 'satellites', 'quakes'];
for (const id of startLayers) setLayer(id, true);
for (const id of Object.keys(layers)) if (!startLayers.includes(id)) setLayer(id, false);
if (prefs.photoreal && ionToken) { $('#photoreal').checked = true; setPhotoreal(true); }

function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; } }
function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } }
