// Shared helpers: fetch with timeout, small localStorage cache, status reporting, formatting.

export async function fetchJson(url, { timeout = 15000, headers } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function fetchText(url, { timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// Cache responses in localStorage so we respect provider rate limits (CelesTrak, Launch Library 2).
export function cacheGet(key, maxAgeMs) {
  try {
    const raw = localStorage.getItem('gel:' + key);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw);
    if (Date.now() - at > maxAgeMs) return null;
    return data;
  } catch { return null; }
}
export function cacheSet(key, data) {
  try { localStorage.setItem('gel:' + key, JSON.stringify({ at: Date.now(), data })); } catch { /* quota — ignore */ }
}

export function setStatus(layer, text, level = '') {
  const el = document.querySelector(`[data-status="${layer}"]`);
  if (!el) return;
  el.textContent = text;
  el.className = level;
}

export function describeError(err) {
  if (err?.name === 'AbortError') return 'timeout';
  if (err instanceof TypeError) return 'blocked/offline'; // fetch() TypeError = network or CORS
  return err?.message || 'error';
}

export function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), ms);
}

export const fmt = {
  num: (n, d = 0) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d })),
  ft: (n) => (n == null ? '—' : `${fmt.num(n)} ft`),
  kt: (n) => (n == null ? '—' : `${fmt.num(n)} kt`),
  deg: (n) => (n == null ? '—' : `${fmt.num(n)}°`),
  km: (n) => (n == null ? '—' : `${fmt.num(n)} km`),
  ago: (ms) => {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    return `${Math.round(s / 3600)}h ago`;
  },
  countdown: (iso) => {
    let s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
    const sign = s < 0 ? 'T+' : 'T-';
    s = Math.abs(s);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d > 0 ? `${sign}${d}d ${h}h` : `${sign}${h}h ${String(m).padStart(2, '0')}m`;
  },
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Draw a simple aircraft glyph to a canvas once and reuse it for every billboard.
export function planeIcon(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.translate(16, 16);
  g.fillStyle = color;
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, -14); g.lineTo(2.5, -4); g.lineTo(13, 3); g.lineTo(13, 6); g.lineTo(2.5, 2.5);
  g.lineTo(2, 10); g.lineTo(5.5, 13); g.lineTo(5.5, 15); g.lineTo(0, 13.5); g.lineTo(-5.5, 15);
  g.lineTo(-5.5, 13); g.lineTo(-2, 10); g.lineTo(-2.5, 2.5); g.lineTo(-13, 6); g.lineTo(-13, 3);
  g.lineTo(-2.5, -4); g.closePath();
  g.stroke(); g.fill();
  return c;
}
