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
  {
    id: 'tomtom', name: 'TomTom', status: 'next', route: 'browser', cost: 'Free tier, no card',
    unlocks: 'Live traffic congestion overlay (layer not built yet).',
    get: 'https://my.tomtom.com/',
    steps: [
      'Sign up at <a href="https://developer.tomtom.com/" target="_blank" rel="noopener">developer.tomtom.com</a> (Get started → my.tomtom.com; no credit card).',
      'Your dashboard shows an API key for the free evaluation plan; copy it (or create one under <b>Keys</b>).',
      'If your dashboard offers domain whitelisting for the key, add <code>{origin}</code>.',
      'Paste it below, <b>Test</b>, <b>Save</b>. The traffic layer will use it once it’s built.',
    ],
    notes: 'Free evaluation: about 200,000 traffic/map tile requests and 2,500–20,000 other requests per month depending on the API. The Test loads one traffic tile over Worcester.',
    test: async (key) => {
      const res = await fetch(`https://api.tomtom.com/traffic/map/4/tile/flow/relative0/12/1226/1512.png?key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(12000) });
      if (res.ok) return { ok: true, msg: 'Key works — traffic flow tiles are available.' };
      if (res.status === 403 || res.status === 401) return { ok: false, msg: 'TomTom rejected this key (or it isn’t allowed on this site).' };
      return { ok: false, msg: `TomTom answered HTTP ${res.status}.` };
    },
  },
  {
    id: 'firms', name: 'NASA FIRMS map key', status: 'next', route: 'relay', cost: 'Free',
    unlocks: 'Active fire detections from satellites, last 24 h (layer not built yet).',
    get: 'https://firms.modaps.eosdis.nasa.gov/api/map_key/',
    steps: [
      'Open <a href="https://firms.modaps.eosdis.nasa.gov/api/map_key/" target="_blank" rel="noopener">FIRMS MAP_KEY</a> and enter your email.',
      'The key arrives by email. Paste it below and <b>Save</b>.',
    ],
    notes: 'Limit: 5,000 transactions per 10 minutes (bigger requests count as several). FIRMS blocks browser requests, so the fires layer will go through the relay Worker; that’s also why there’s no Test button yet.',
  },
  {
    id: 'aisstream', name: 'AISStream', status: 'next', route: 'relay', cost: 'Free',
    unlocks: 'Live ship positions (layer not built yet).',
    get: 'https://aisstream.io/',
    steps: [
      'Sign in at <a href="https://aisstream.io/" target="_blank" rel="noopener">aisstream.io</a> and open your <b>Account</b> page.',
      'Create an API key. It’s shown only once, so copy it straight away.',
      'Paste it below and <b>Save</b>.',
    ],
    notes: 'AISStream doesn’t allow direct browser connections; its key is meant to live on a server that streams only the data the app needs. Ships need a streaming relay, which isn’t built yet, so there’s no Test button.',
  },
  {
    id: 'openai', name: 'OpenAI', status: 'next', route: 'relay', cost: 'Metered (pay per use)',
    unlocks: 'Voice control + AI scene summary (not built yet; will ship with a spend cap).',
    get: 'https://platform.openai.com/api-keys',
    steps: [
      'Sign in at <a href="https://platform.openai.com/" target="_blank" rel="noopener">platform.openai.com</a> and add billing credit.',
      'Create a separate <b>project</b> for this app and set its usage limits / budget alerts.',
      'Under <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">API keys</a>, create a key for that project (restrict its permissions if the option is offered).',
      'Paste it below and <b>Save</b>.',
    ],
    notes: 'This is the only key that costs real money per use. OpenAI keys shouldn’t be used directly from browser code, so the voice feature will use the relay to get short-lived session tokens; the key would only pass through it per request. No Test button, so nothing is spent.',
  },
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
      <h2>Power up: add your API keys</h2>
      <p class="hint">Everything works without keys. Paste any keys you have below; they're saved in an <b>encrypted vault</b> on this device, locked with a passphrase you choose (AES-256), and only decrypted after you unlock.</p>
      ${legacy ? '<p class="warn">⚠ A Cesium ion token from the previous version is stored <b>unencrypted</b>. Creating the vault moves it inside and deletes the plaintext copy.</p>' : ''}
      <fieldset class="pass-box">
        <legend>1. Choose a vault passphrase</legend>
        <label>Passphrase (10+ characters)<input id="pass1" type="password" autocomplete="new-password" minlength="10" /></label>
        <label>Repeat passphrase<input id="pass2" type="password" autocomplete="new-password" /></label>
        <p class="hint">There's no recovery: if you forget it, delete the vault and re-enter your keys.</p>
      </fieldset>
      <h3 class="keys-h">2. Paste your keys <small>(any or none; you can add more later)</small></h3>
      ${keyList()}
      ${relayBlock()}
      <div class="dialog-actions"><button value="close">Not now</button><button type="button" class="primary" data-act="create">Create vault &amp; save keys</button></div>`;
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
        <details class="howto">
          <summary>How to get this key</summary>
          <ol>${steps}</ol>
          ${p.notes ? `<p class="hint">${esc(p.notes)}</p>` : ''}
        </details>
        <div class="key-row">
          <input type="password" autocomplete="off" spellcheck="false" data-key="${p.id}" aria-label="${esc(p.name)} key" placeholder="${vault.has(p.id) ? '•••••••• saved (type to replace)' : `paste ${esc(p.name)} key`}" />
          <button type="button" class="icon" data-act="reveal" data-id="${p.id}" title="Show / hide" aria-label="Show or hide ${esc(p.name)} key">👁</button>
          ${p.test ? `<button type="button" data-act="test" data-id="${p.id}">Test</button>` : ''}
        </div>
        <p class="hint test-msg" id="test-${p.id}" hidden></p>
      </div>`;
  }

  function keyList() {
    const active = PROVIDERS.filter((p) => p.status === 'active').map(providerRow).join('');
    const next = PROVIDERS.filter((p) => p.status !== 'active').map(providerRow).join('');
    return `
      <h4 class="group-h">Used by the app now</h4>${active}
      <h4 class="group-h">For layers being built <small>(save now; they're used once each layer ships)</small></h4>${next}`;
  }

  function renderEdit() {
    body.innerHTML = `
      <h2>Power up <span class="tag set">🔓 unlocked</span></h2>
      <p class="hint">Add or replace your API keys. They're encrypted on this device and only decrypted after you unlock. Leave a field empty to keep a saved key.</p>
      ${keyList()}
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
    if (act === 'reveal') { const inp = body.querySelector(`[data-key="${e.target.dataset.id}"]`); if (inp) inp.type = inp.type === 'password' ? 'text' : 'password'; return; }
    try {
      if (act === 'relay') { if (saveRelay()) dlg.close(); }
      if (act === 'create') {
        const a = document.getElementById('pass1').value, b = document.getElementById('pass2').value;
        if (a !== b) return toast('Passphrases don’t match');
        if (!saveRelay()) return;
        e.target.disabled = true; e.target.textContent = 'Encrypting…';
        const legacy = legacyIonToken();
        const initial = legacy ? { ion: legacy } : {};
        for (const inp of body.querySelectorAll('[data-key]')) { const v = inp.value.trim(); if (v) initial[inp.dataset.key] = v; }
        await vault.create(a, initial);
        localStorage.removeItem(LEGACY_ION);
        const n = Object.keys(initial).length;
        toast(n ? `Vault created — ${n} key${n === 1 ? '' : 's'} saved (encrypted)` : 'Vault created — add keys any time');
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
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || e.target.type === 'checkbox' || e.target.dataset.key) return;
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
