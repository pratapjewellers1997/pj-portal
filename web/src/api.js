// Talks to the Apps Script API.
// POST with text/plain keeps it a "simple" request, so the browser
// sends no CORS preflight (Apps Script cannot answer one).
//
// Features: exponential-backoff retry (3 attempts), 30 s timeout,
// in-flight request deduplication so the same action+payload pair
// never fires twice at the same time.

const API_URL = import.meta.env.VITE_API_URL;
const MAX_RETRIES  = 3;
const TIMEOUT_MS   = 30_000;
const RETRY_DELAYS = [1000, 3000, 8000]; // ms before each retry

// In-flight deduplication: same action+payload reuses the pending promise.
const inflight = new Map();

export async function callApi(action, payload = {}) {
  const key = JSON.stringify({ action, ...payload });
  if (inflight.has(key)) return inflight.get(key);

  const promise = callWithRetry(action, payload);
  inflight.set(key, promise);
  promise.finally(() => inflight.delete(key));
  return promise;
}

async function callWithRetry(action, payload) {
  if (!API_URL) throw new Error('config_missing');

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, ...payload }),
        redirect: 'follow',
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        // 5xx = server issue, worth retrying; 4xx = client error, don't.
        if (res.status >= 500 && attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_DELAYS[attempt]);
          continue;
        }
        throw new Error('network_error');
      }

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'server_error');
      return data;

    } catch (err) {
      // Don't retry auth/session/business errors.
      const noRetry = ['config_missing', 'no_session', 'session_expired',
        'not_registered', 'inactive', 'bad_token', 'email_not_verified'];
      if (noRetry.includes(err.message)) throw err;

      // Abort = timeout
      if (err.name === 'AbortError') {
        if (attempt < MAX_RETRIES - 1) { await sleep(RETRY_DELAYS[attempt]); continue; }
        throw new Error('network_error');
      }

      // Network failure — retry if attempts remain.
      if (attempt < MAX_RETRIES - 1) { await sleep(RETRY_DELAYS[attempt]); continue; }
      throw err;
    }
  }
}

/** Cancel all in-flight deduplication entries (call on sign-out). */
export function clearInflight() { inflight.clear(); }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
