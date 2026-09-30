// Provider registry + the "Power up" dialog (vault create / unlock / edit keys).
import { vault } from './vault.js';
import { esc, toast } from './util.js';
import { relayUrl } from './config.js';

// status: 'active' = used by a feature today · 'next' = feature not built yet (key can be stored now)
// route:  'browser' = sent from this device straight to the provider · 'relay' = may go through the relay Worker
// steps:  shown under "How to get this key". {origin} is replaced with this site's address.
// test(key): checks a key against the provider; resolves { ok, msg }.
export const PROVIDERS = [
  {
    id: 'windy', name: 'Windy Webcams', status: 'active', route: 'browser', cost: 'Free',
    unlocks: 'Public webcams around the map view (scenic, weather and town cams).',
    get: 'https://api.windy.com/keys',
    steps: [
      'Open <a href="https://api.windy.com/keys" target="_blank" rel="noopener">api.windy.com/keys</a> and sign in, or create a free Windy account.',
      'Create a new API key and pick the <b>Webcams API</b>, <b>Free</b> plan.',
      'Copy the key, paste it below, press <b>Test</b>, then <b>Save</b>.',
      'Turn on <b>📹 Webcams</b> under Cameras and zoom to a town.',
    ],
    notes: 'Free plan: smaller images whose links expire after about 15 minutes (the app refreshes them), and every image links back to Windy. Nothing billable. If Windy blocks the browser, requests go through the site’s relay Worker, which forwards your key for that request only.',
    test: async (key) => {
      const direct = 'https://api.windy.com/webcams/api/v3/webcams?nearby=51.5074,-0.1278,50&limit=3';
      let res;
      try { res = await fetch(direct, { headers: { 'x-windy-api-key': key }, signal: AbortSignal.timeout(12000) }); }
      catch {
        const relay = relayUrl();
        if (!relay) return { ok: false, msg: 'Windy blocked the browser and no relay is set.' };
        res = await fetch(`${relay}/windy/webcams?nearby=51.5074,-0.1278,50&limit=3`, { headers: { 'X-Windy-Api-Key': key }, signal: AbortSignal.timeout(12000) });
      }
      if (res.status === 401 || res.status === 403) return { ok: false, msg: 'Windy rejected this key. Check it’s a Webcams API key.' };
      if (res.status === 400) return { ok: false, msg: 'That doesn’t look like a Windy key.' };
      if (!res.ok) return { ok: false, msg: `Windy answered HTTP ${res.status}.` };
      const j = await res.json();
      const via = res.headers.get('x-upstream') === 'windy' ? ' (via relay)' : '';
      return { ok: true, msg: `Key works${via} — ${j.total ?? j.webcams?.length ?? 0} webcams near the London test point.` };
    },
  },
  {
    id: 'ion', name: 'Cesium ion', status: 'active', route: 'browser', cost: 'Free (personal use)',
    unlocks: 'Google Photorealistic 3D cities + world terrain.',
    get: 'https://ion.cesium.com/tokens',
    steps: [
      'Sign up at <a href="https://ion.cesium.com/signup" target="_blank" rel="noopener">ion.cesium.com</a> (free Community plan, personal/non-commercial use).',
      'Go to <b>Access Tokens → Create token</b>. Give it only the <code>assets:read</code> scope.',
      'Under <b>Allowed URLs</b>, add <code>{origin}</code> so the token only works on this site.',
      'Copy the token, paste it below, <b>Test</b>, <b>Save</b>, then tick <b>Photorealistic 3D</b> under Basemap.',
    ],
    notes: 'Community-plan quotas apply. Commercial use needs a paid Cesium plan.',
    test: async (key) => {
      const res = await fetch('https://api.cesium.com/v1/assets/2275207/endpoint', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(12000) });
      if (res.status === 401) return { ok: false, msg: 'Cesium rejected this token.' };
      if (res.status === 404) return { ok: false, msg: 'Token works, but Google 3D isn’t available to this account.' };
      if (!res.ok) return { ok: false, msg: `Cesium answered HTTP ${res.status}. If you set Allowed URLs, make sure it includes this site.` };
      return { ok: true, msg: 'Token works — Google Photorealistic 3D is available.' };
    },
  },
  {
    id: 'google', name: 'Google Map Tiles API', status: 'active', route: 'browser', cost: 'Metered (free monthly allowance)',
    unlocks: 'Google 3D tiles direct from Google, used instead of Cesium ion when both are set.',
    get: 'https://console.cloud.google.com/google/maps-apis/credentials',
    steps: [
      'In <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a>, create a project and turn on billing (required even inside the free allowance).',
      'Enable the <b>Map Tiles API</b> (APIs &amp; Services → Library).',
      'Credentials → <b>Create credentials → API key</b>. Restrict it: API = Map Tiles API; Websites = <code>{origin}/*</code>.',
      'Set a <b>budget alert</b> under Billing, then paste the key below, <b>Test</b> and <b>Save</b>.',
    ],
    notes: 'Most people should use Cesium ion instead; this route is for commercial use or if you already have a Google Cloud project.',
    test: async (key) => {
      const res = await fetch(`https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(12000) });
      if (res.ok) return { ok: true, msg: 'Key works — Map Tiles API is enabled.' };
      let why = '';
      try { why = (await res.json())?.error?.message || ''; } catch { /* not JSON */ }
      return { ok: false, msg: `Google answered HTTP ${res.status}${why ? `: ${why.slice(0, 140)}` : ''}` };
    },
  },
  { id: 'tomtom', name: 'TomTom', status: 'next', route: 'browser', cost: 'Free tier', unlocks: 'Live traffic congestion overlay.', get: 'https://developer.tomtom.com/', steps: ['Create a free account at <a href="https://developer.tomtom.com/" target="_blank" rel="noopener">developer.tomtom.com</a>.', 'Your dashboard shows a default API key; restrict it to <code>{origin}</code>.'], notes: '' },
  { id: 'firms', name: 'NASA FIRMS map key', status: 'next', route: 'relay', cost: 'Free', unlocks: 'Active fire detections (last 24 h).', get: 'https://firms.modaps.eosdis.nasa.gov/api/map_key/', steps: ['Request a free MAP_KEY at <a href="https://firms.modaps.eosdis.nasa.gov/api/map_key/" target="_blank" rel="noopener">firms.modaps.eosdis.nasa.gov</a>; it’s emailed to you.'], notes: 'Will go through the relay because FIRMS blocks browser calls.' },
  { id: 'aisstream', name: 'AISStream', status: 'next', route: 'relay', cost: 'Free', unlocks: 'Live ship positions.', get: 'https://aisstream.io/', steps: ['Sign in at <a href="https://aisstream.io/" target="_blank" rel="noopener">aisstream.io</a> with GitHub and create an API key.'], notes: 'Needs a streaming relay on a server; not built yet.' },
  { id: 'openai', name: 'OpenAI', status: 'next', route: 'browser', cost: 'Metered', unlocks: 'Voice control + AI scene summary (will ship with a spend cap).', get: 'https://platform.openai.com/api-keys', steps: ['Create a <b>project</b> key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a> and set a monthly budget on the project.'], notes: '' },
];

const LEGACY_ION = 'gel:ionToken'; // plaintext token from v1 — migrated into the vault

export function legacyIonToken() { return (localStorage.getItem(LEGACY_ION) || '').trim(); }

// Effective key for a provider: vault first, then the legacy plaintext ion token (until migrated).
export function keyFor(id) {
  if (vault.has(id)) return vault.get(id);
  if (id === 'ion' && !vault.exists()) return legacyIonToken();
  return '';
}

export function initKeysUI({ relayGet, relaySet }) {
  const dlg = document.getElementById('settings');
  const body = document.getElementById('settingsBody');

  function render() {
    if (!vault.supported) {
      body.innerHTML = `<h2>Power up</h2><p class="err">This browser can't encrypt keys here (needs HTTPS and Web Crypto). Keys are disabled.</p>${relayBlock()}<div class="dialog-actions"><button value="close">Close</button><button class="primary" data-act="relay">Save relay</button></div>`;
      return;
    }
    if (!vault.exists()) return renderCreate();
    if (!vault.isUnlocked()) return renderUnlock();
    renderEdit();
  }

  function relayBlock() {
    return `
      <label>Relay URL <small>(optional, not secret; default is this site's relay)</small>
        <input id="relayInput" type="url" autocomplete="off" placeholder="https://gel-relay.you.workers.dev" value="${esc(relayGet())}" />
      </label>`;
  }

  function renderCreate() {
    const legacy = legacyIonToken();
    body.innerHTML = `
      <h2>Power up</h2>
      <p>Everything works without keys. To add your own, create an <b>encrypted key vault</b> on this device. Keys are encrypted with your passphrase (AES-256) and only decrypted in memory after you unlock.</p>
      ${legacy ? '<p class="warn">⚠ A Cesium ion token from the previous version is stored <b>unencrypted</b>. Creating a vault moves it inside and deletes the plaintext copy.</p>' : ''}
      <p class="hint">Keys you can add: <b>Windy Webcams</b> (free) for webcams, <b>Cesium ion</b> (free, personal use) for photorealistic 3D cities, or a <b>Google Map Tiles</b> key. Each one has step-by-step instructions after you create the vault.</p>
      <label>New passphrase (10+ characters)<input id="pass1" type="password" autocomplete="new-password" minlength="10" /></label>
      <label>Repeat passphrase<input id="pass2" type="password" autocomplete="new-password" /></label>
      <p class="hint">There's no recovery: forget it and you just delete the vault and re-enter keys.</p>
      ${relayBlock()}
      <div class="dialog-actions"><button value="close">Not now</button><button class="primary" data-act="create">Create vault</button></div>`;
  }

  function renderUnlock() {
    body.innerHTML = `
      <h2>Unlock your keys</h2>
      <p>Your API keys are encrypted on this device. Unlock to use them this session — or continue without them.</p>
      <label>Passphrase<input id="pass" type="password" autocomplete="current-password" /></label>
      <p class="err" id="unlockErr" hidden></p>
      <div class="dialog-actions">
        <button data-act="destroy" class="danger">Forget vault…</button>
        <button value="close">Skip</button>
        <button class="primary" data-act="unlock">Unlock</button>
      </div>`;
    setTimeout(() => document.getElementById('pass')?.focus(), 50);
  }

  function providerRow(p) {
    const origin = location.origin;
    const steps = (p.steps || []).map((st) => `<li>${st.replaceAll('{origin}', esc(origin))}</li>`).join('');
    return `
      <div class="prov ${p.status}" data-prov="${p.id}">
        <div class="prov-head"><b>${esc(p.name)}</b>
          <span class="tag">${esc(p.cost || '')}</span>
          ${p.route === 'relay' ? '<span class="tag route">via relay</span>' : ''}
          ${vault.has(p.id) ? '<span class="tag set">saved</span>' : ''}
        </div>
        <p class="hint">${esc(p.unlocks)}</p>
        <details class="howto"${!vault.has(p.id) && p.status === 'active' && p.id === 'windy' ? ' open' : ''}>
          <summary>How to get this key</summary>
          <ol>${steps}</ol>
          ${p.notes ? `<p class="hint">${esc(p.notes)}</p>` : ''}
        </details>
        <div class="key-row">
          <input type="password" autocomplete="off" spellcheck="false" data-key="${p.id}" aria-label="${esc(p.name)} key" placeholder="${vault.has(p.id) ? '•••••••• saved (type to replace)' : 'paste key'}" />
          ${p.test ? `<button type="button" data-act="test" data-id="${p.id}">Test</button>` : ''}
        </div>
        <p class="hint test-msg" id="test-${p.id}" hidden></p>
      </div>`;
  }

  function renderEdit() {
    const active = PROVIDERS.filter((p) => p.status === 'active').map(providerRow).join('');
    const next = PROVIDERS.filter((p) => p.status !== 'active').map(providerRow).join('');
    body.innerHTML = `
      <h2>Power up <span class="tag set">🔓 unlocked</span></h2>
      <p class="hint">Add your own API keys. They're encrypted on this device and only decrypted after you unlock. Leave a field empty to keep a saved key.</p>
      ${active}
      <details class="coming">
        <summary>Coming soon (you can store these keys now)</summary>
        ${next}
      </details>
      <label class="row"><input type="checkbox" id="removeMode" /> <span>Remove keys whose fields I cleared</span></label>
      ${relayBlock()}
      <div class="dialog-actions">
        <button type="button" data-act="lock">🔒 Lock</button>
        <button value="close">Close</button>
        <button type="button" class="primary" data-act="save">Save</button>
      </div>`;
  }

  async function testKey(id, btn) {
    const p = PROVIDERS.find((x) => x.id === id);
    const typed = body.querySelector(`[data-key="${id}"]`)?.value.trim();
    const key = typed || vault.get(id);
    const out = document.getElementById(`test-${id}`);
    out.hidden = false;
    if (!key) { out.className = 'hint test-msg warn'; out.textContent = 'Paste a key first.'; return; }
    btn.disabled = true; out.className = 'hint test-msg'; out.textContent = 'Testing…';
    try {
      const r = await p.test(key);
      out.className = `hint test-msg ${r.ok ? 'ok' : 'err'}`;
      out.textContent = `${r.ok ? '✓' : '✗'} ${r.msg}${r.ok && typed ? ' Press Save to keep it.' : ''}`;
    } catch (err) {
      out.className = 'hint test-msg err';
      out.textContent = `✗ Couldn’t reach the provider (${err.name === 'TimeoutError' ? 'timeout' : 'network or blocked'}).`;
    } finally { btn.disabled = false; }
  }

  body.addEventListener('click', async (e) => {
    const act = e.target.dataset?.act;
    if (e.target.value === 'close') { dlg.close(); return; }
    if (!act) return;
    e.preventDefault();
    if (act === 'test') { testKey(e.target.dataset.id, e.target); return; }
    try {
      if (act === 'relay') { if (saveRelay()) dlg.close(); }
      if (act === 'create') {
        const a = document.getElementById('pass1').value, b = document.getElementById('pass2').value;
        if (a !== b) return toast('Passphrases don’t match');
        if (!saveRelay()) return;
        e.target.disabled = true; e.target.textContent = 'Encrypting…';
        const legacy = legacyIonToken();
        await vault.create(a, legacy ? { ion: legacy } : {});
        localStorage.removeItem(LEGACY_ION);
        toast('Vault created');
        render();
      }
      if (act === 'unlock') {
        e.target.disabled = true; e.target.textContent = 'Unlocking…';
        try { await vault.unlock(document.getElementById('pass').value); dlg.close(); toast('Keys unlocked for this session'); }
        catch (err) { const el = document.getElementById('unlockErr'); el.hidden = false; el.textContent = err.message; e.target.disabled = false; e.target.textContent = 'Unlock'; }
      }
      if (act === 'save') {
        if (!saveRelay()) return;
        const remove = document.getElementById('removeMode').checked;
        const updates = {};
        for (const inp of body.querySelectorAll('[data-key]')) {
          const v = inp.value.trim();
          if (v) updates[inp.dataset.key] = v;
          else if (remove && vault.has(inp.dataset.key)) updates[inp.dataset.key] = '';
        }
        await vault.set(updates);
        toast('Keys saved (encrypted)');
        dlg.close();
      }
      if (act === 'lock') { vault.lock(); toast('Locked — keys cleared from memory'); dlg.close(); }
      if (act === 'destroy') {
        if (confirm('Delete the encrypted vault from this device? You will need to re-enter your keys.')) { vault.destroy(); render(); }
      }
    } catch (err) {
      toast(err.message || 'Something went wrong');
      render();
    }
  });

  body.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || e.target.type === 'checkbox') return;
    e.preventDefault();
    body.querySelector('.dialog-actions .primary')?.click();
  });

  function saveRelay() {
    const inp = document.getElementById('relayInput');
    if (!inp) return true;
    const v = inp.value.trim();
    if (v && !/^https:\/\/[a-z0-9.-]+\.workers\.dev\/?$/i.test(v)) { toast('Relay must be an https://….workers.dev URL (allowed by the page security policy)'); return false; }
    relaySet(v);
    return true;
  }

  const open = () => { render(); if (!dlg.open) dlg.showModal(); };
  return { open, render };
}
