// Site-wide settings. Set RELAY_URL to your deployed Cloudflare Worker (see relay/worker.js),
// e.g. 'https://gel-relay.yourname.workers.dev'. Visitors can also set their own under ⚡ Power up.
export const RELAY_URL = '';

export function relayUrl() {
  const own = (localStorage.getItem('gel:relay') || '').trim();
  return (own || RELAY_URL).replace(/\/+$/, '');
}
