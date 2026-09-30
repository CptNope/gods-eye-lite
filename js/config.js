// Site-wide settings.
// RELAY_URL: your Cloudflare Worker (relay/worker.js). Visitors can override it under ⚡ Power up.
export const RELAY_URL = 'https://gel-relay.jeremy-anderson.workers.dev';

// Flights stay off even with a relay: every free flight feed refuses Cloudflare's network (see README).
// Flip to true once RELAY_URL points at a relay on an ordinary server that the feeds accept.
export const FLIGHTS_VIA_RELAY = false;

export function relayUrl() {
  const own = (localStorage.getItem('gel:relay') || '').trim();
  return (own || RELAY_URL).replace(/\/+$/, '');
}
