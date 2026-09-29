// Provider registry + the "Power up" dialog (vault create / unlock / edit keys).
import { vault } from './vault.js';
import { esc, toast } from './util.js';

// status: 'active' = used by a feature today · 'next' = feature not built yet (key can be stored now)
// route:  'browser' = sent from this device straight to the provider · 'relay' = sent through your Worker per request
export const PROVIDERS = [
  { id: 'ion', name: 'Cesium ion', status: 'active', route: 'browser', unlocks: 'Google Photorealistic 3D cities + world terrain (free Community plan, personal use).', get: 'https://cesium.com/ion/tokens', restrict: 'Scope: assets:read only. Allowed URLs: your Pages URL.' },
  { id: 'google', name: 'Google Maps Tile API', status: 'active', route: 'browser', unlocks: 'Google 3D tiles direct from Google (metered; used instead of ion when set).', get: 'https://console.cloud.google.com/google/maps-apis/credentials', restrict: 'Restrict to Map Tiles API and your site as HTTP referrer. Set a budget alert.' },
  { id: 'tomtom', name: 'TomTom', status: 'next', route: 'browser', unlocks: 'Live traffic congestion overlay.', get: 'https://developer.tomtom.com/', restrict: 'Free tier; restrict to your domain in the TomTom dashboard.' },
  { id: 'firms', name: 'NASA FIRMS map key', status: 'next', route: 'relay', unlocks: 'Active fire detections (last 24 h).', get: 'https://firms.modaps.eosdis.nasa.gov/api/map_key/', restrict: 'Free. Goes through your relay because FIRMS blocks browser calls.' },
  { id: 'aisstream', name: 'AISStream', status: 'next', route: 'relay', unlocks: 'Live ship positions.', get: 'https://aisstream.io/', restrict: 'Free. Goes through your relay because AISStream refuses browser connections.' },
  { id: 'openai', name: 'OpenAI', status: 'next', route: 'browser', unlocks: 'Voice control + AI scene summary (metered — will ship with a spend cap).', get: 'https://platform.openai.com/api-keys', restrict: 'Use a project key with a monthly budget limit.' },
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
      <label>Flight relay URL <small>(not secret)</small>
        <input id="relayInput" type="url" autocomplete="off" placeholder="https://gel-relay.you.workers.dev" value="${esc(relayGet())}" />
      </label>`;
  }

  function renderCreate() {
    const legacy = legacyIonToken();
    body.innerHTML = `
      <h2>Power up</h2>
      <p>Everything works without keys. To add your own, create an <b>encrypted key vault</b> on this device. Keys are encrypted with your passphrase (AES-256) and only decrypted in memory after you unlock.</p>
      ${legacy ? '<p class="warn">⚠ A Cesium ion token from the previous version is stored <b>unencrypted</b>. Creating a vault moves it inside and deletes the plaintext copy.</p>' : ''}
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

  function renderEdit() {
    const rows = PROVIDERS.map((p) => `
      <div class="prov ${p.status}">
        <div class="prov-head"><b>${esc(p.name)}</b>
          <span class="tag ${p.status}">${p.status === 'active' ? 'active' : 'feature coming'}</span>
          <span class="tag route">${p.route === 'relay' ? 'via relay' : 'browser-direct'}</span>
          ${vault.has(p.id) ? '<span class="tag set">saved</span>' : ''}
        </div>
        <p class="hint">${esc(p.unlocks)} <a href="${p.get}" target="_blank" rel="noopener">Get key ↗</a><br>${esc(p.restrict)}</p>
        <input type="password" autocomplete="off" spellcheck="false" data-key="${p.id}" placeholder="${vault.has(p.id) ? '•••••••• (saved — type to replace, clear to remove)' : 'paste key'}" />
      </div>`).join('');
    body.innerHTML = `
      <h2>Power up <span class="tag set">🔓 unlocked</span></h2>
      <p class="hint">Keys stay encrypted at rest. Leave a field empty to keep the saved key; tick <i>remove</i> to delete it.</p>
      ${rows}
      <label class="row"><input type="checkbox" id="removeMode" /> <span>Remove keys whose fields I cleared</span></label>
      ${relayBlock()}
      <div class="dialog-actions">
        <button data-act="lock">🔒 Lock</button>
        <button value="close">Close</button>
        <button class="primary" data-act="save">Save</button>
      </div>`;
  }

  body.addEventListener('click', async (e) => {
    const act = e.target.dataset?.act;
    if (e.target.value === 'close') { dlg.close(); return; }
    if (!act) return;
    e.preventDefault();
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
