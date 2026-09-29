// Encrypted key vault for user-supplied API keys.
//
// Threat model (be honest about it):
//  ✔ Keys are encrypted at rest (AES-256-GCM, key derived from the user's passphrase with PBKDF2-SHA256,
//    600k iterations). Copying localStorage, a synced/backed-up profile, or a stolen disk image yields ciphertext.
//  ✔ The derived key is a non-extractable CryptoKey held in memory only; the passphrase is never stored.
//  ✔ Plaintext keys exist only in this tab's memory after unlock and vanish when it closes or on lock().
//  ✘ While unlocked, code running on this page can use the keys. The Content-Security-Policy in index.html
//    limits where the page can send data; provider-side restrictions (allowed URLs, quotas) are the backstop.

const STORE = 'gel:vault';
const ITER = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let cryptoKey = null; // non-extractable AES-GCM key, memory only
let secrets = {}; // decrypted provider keys, memory only
const listeners = new Set();

async function derive(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt'],
  );
}

function readBlob() {
  try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; }
}

async function persist() {
  const blob = readBlob();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // fresh IV for every write
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, enc.encode(JSON.stringify(secrets)));
  localStorage.setItem(STORE, JSON.stringify({ v: 1, iter: blob.iter, salt: blob.salt, iv: b64(iv), ct: b64(ct) }));
}

function emit() { for (const fn of listeners) fn(); }

export const vault = {
  supported: !!(window.crypto?.subtle && window.isSecureContext),
  exists: () => !!readBlob(),
  isUnlocked: () => !!cryptoKey,
  get: (id) => (cryptoKey ? secrets[id] || '' : ''),
  has: (id) => !!(cryptoKey && secrets[id]),
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  async create(passphrase, initial = {}) {
    if (passphrase.length < 10) throw new Error('Use at least 10 characters.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    cryptoKey = await derive(passphrase, salt, ITER);
    secrets = { ...initial };
    localStorage.setItem(STORE, JSON.stringify({ v: 1, iter: ITER, salt: b64(salt) }));
    await persist();
    emit();
  },

  async unlock(passphrase) {
    const blob = readBlob();
    if (!blob) throw new Error('No vault on this device.');
    const key = await derive(passphrase, unb64(blob.salt), blob.iter || ITER);
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
      secrets = JSON.parse(dec.decode(pt));
      cryptoKey = key;
    } catch {
      throw new Error('Wrong passphrase.'); // GCM auth tag fails on a wrong key
    }
    emit();
  },

  async set(updates) {
    if (!cryptoKey) throw new Error('Vault is locked.');
    for (const [k, v] of Object.entries(updates)) {
      const val = (v || '').trim();
      if (val) secrets[k] = val; else delete secrets[k];
    }
    await persist();
    emit();
  },

  lock() {
    cryptoKey = null;
    secrets = {};
    emit();
  },

  destroy() {
    localStorage.removeItem(STORE);
    this.lock();
  },
};
