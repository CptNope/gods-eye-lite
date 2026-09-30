// Raster tile sets used as basemaps and overlays. One definition feeds Cesium AND the offline
// "save this area" downloader, so the URLs cached for offline use are exactly the ones Cesium requests.
//  url: template with {z} {x} {y} and optional {s}; subdomains: string of letters for {s}.
const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);

export const TILESETS = {
  // ---- basemaps ----
  esri: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', max: 19, credit: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community' },
  gibs: { url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${yesterday}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, max: 9, credit: `NASA GIBS · VIIRS SNPP true color · ${yesterday}` },
  osm: { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', subdomains: 'abcd', max: 19, credit: '© OpenStreetMap contributors © CARTO' },
  dark: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', subdomains: 'abcd', max: 19, credit: '© OpenStreetMap contributors © CARTO' },
  topo: { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', subdomains: 'abc', max: 17, credit: 'Map data © OpenStreetMap contributors, SRTM · Style © OpenTopoMap (CC-BY-SA)' },
  usgs: { url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', max: 16, credit: 'USGS The National Map' },
  // ---- overlays ----
  relief: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', max: 16, credit: 'Esri World Hillshade', overlay: true },
  trails: { url: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', max: 17, credit: 'Hiking routes © Waymarked Trails (CC-BY-SA), OpenStreetMap contributors', overlay: true },
  bike: { url: 'https://tile.waymarkedtrails.org/mtb/{z}/{x}/{y}.png', max: 17, credit: 'MTB routes © Waymarked Trails (CC-BY-SA), OpenStreetMap contributors', overlay: true },
};

export function provider(name) {
  const t = TILESETS[name];
  return new Cesium.UrlTemplateImageryProvider({ url: t.url, subdomains: t.subdomains, maximumLevel: t.max, credit: t.credit });
}

// Same {s} choice Cesium's UrlTemplateImageryProvider makes, so prefetched URLs match its requests.
export function tileUrl(name, z, x, y) {
  const t = TILESETS[name];
  let u = t.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  if (t.subdomains) u = u.replace('{s}', t.subdomains[(x + y + z) % t.subdomains.length]);
  return u;
}

export function tileRange(rect, z) {
  const n = 2 ** z;
  const lonToX = (lon) => Math.floor(((lon + 180) / 360) * n);
  const latToY = (lat) => {
    const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  };
  return { x0: Math.max(0, lonToX(rect.w)), x1: Math.min(n - 1, lonToX(rect.e)), y0: Math.max(0, latToY(rect.n)), y1: Math.min(n - 1, latToY(rect.s)) };
}

// Overlay layer that plugs into the app's layer registry (start/stop).
export class TileOverlay {
  constructor(viewer, name, { id, alpha = 1 } = {}) {
    this.viewer = viewer; this.name = name; this.id = id || name; this.alpha = alpha; this.layer = null;
  }
  start() {
    if (this.layer) return;
    this.layer = this.viewer.imageryLayers.addImageryProvider(provider(this.name));
    this.layer.alpha = this.alpha;
  }
  stop() {
    if (this.layer) this.viewer.imageryLayers.remove(this.layer, true);
    this.layer = null;
  }
}
