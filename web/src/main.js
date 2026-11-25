import './style.css';
import { callApi, clearInflight } from './api.js';
import { h } from './dom.js';
import { renderPortal } from './portal.js';
import { clearWorkMemo } from './workdata.js';
// Lazy-load chat connection functions — avoids pulling messages.js (and its
// Firebase dependency) into the main bundle. Firebase loads only when needed.
const chatModule = () => import('./messages.js');
const connectChatAfterLogin = (idToken) => chatModule().then((m) => m.connectChatAfterLogin(idToken)).catch(() => {});
const disconnectChatOnSignOut = () => chatModule().then((m) => m.disconnectChatOnSignOut()).catch(() => {});

// Flow: sign in with Google -> API checks -> portal session (7 days)
// -> "portal" call returns this person's systems and links from the Feed.
// The last portal result is kept on the phone so it opens instantly,
// then refreshes in the background.

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SESSION_KEY = 'pj_session';
const CACHE_KEY = 'pj_portal_cache';
const root = document.getElementById('root');

const MESSAGES = {
  not_registered: 'This Google account is not in the staff list. Ask MIS (Rohan) to add it.',
  inactive: 'This account is marked inactive. Ask MIS (Rohan).',
  bad_token: 'Google sign-in could not be checked. Please try again.',
  token_expired: 'Sign-in took too long. Please try again.',
  email_not_verified: 'This Google account has no verified email.',
  session_expired: 'Your session ended. Please sign in again.',
  no_session: 'Please sign in.',
  config_missing: 'Portal is not configured yet (API URL missing).',
  network_error: 'Could not reach the portal server. Check your internet.',
  server_error: 'Something went wrong on the server. Please try again.',
};
const SESSION_ERRORS = ['no_session', 'session_expired', 'not_registered', 'inactive'];

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

function signOut() {
  store.set(SESSION_KEY, null);
  store.set(CACHE_KEY, null);
  disconnectChatOnSignOut();  // fire-and-forget async cleanup (clears fileUrls, chat state, Firebase auth)
  localStorage.removeItem('pj_chat_used');
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();

  // Clear all module-level caches and state so the next employee gets a clean session
  clearInflight();
  clearWorkMemo();
  // Lazy-loaded modules: reset only if already imported (no-op if never visited)
  import('./insights.js').then((m) => m.resetInsights()).catch(() => {});
  import('./vendors.js').then((m) => m.resetVendors()).catch(() => {});
  import('./checklists.js').then((m) => m.resetChecklists()).catch(() => {});
  import('./karigar.js').then((m) => m.resetKarigar()).catch(() => {});
  import('./social.js').then((m) => m.resetSocial()).catch(() => {});
  import('./search.js').then((m) => m.resetSearch()).catch(() => {});
  import('./work.js').then((m) => m.resetWork()).catch(() => {});
  import('./attendance.js').then((m) => m.resetAttendance()).catch(() => {});
  import('./scores.js').then((m) => m.resetScores()).catch(() => {});
  import('./board.js').then((m) => m.resetBoard()).catch(() => {});

  renderSignIn();
}

function renderSignIn(errorCode) {
  const btn = h('div', { id: 'gbtn' });
  root.replaceChildren(
    h('main', { class: 'shell' },
      h('section', { class: 'card', 'aria-live': 'polite' },
        h('div', { class: 'brand brand-logo' },
          h('img', { src: './brand/logo-full.png', alt: 'Pratap Jewellers', class: 'logo-full', width: '220', height: '255' }),
          h('p', { class: 'sub' }, 'Staff portal')),
        errorCode && h('p', { class: 'error' }, MESSAGES[errorCode] || MESSAGES.server_error),
        h('p', { class: 'muted' }, 'Sign in with your Google account (company or Gmail).'),
        btn),
      h('p', { class: 'foot' }, 'For Pratap Jewellers staff only')));

  if (!CLIENT_ID) return;
  waitForGoogle().then(() => {
    google.accounts.id.initialize({ client_id: CLIENT_ID, callback: onGoogleCredential, ux_mode: 'popup' });
    google.accounts.id.renderButton(btn, {
      theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', width: 280,
    });
  });
}

function renderLoading(text) {
  root.replaceChildren(h('main', { class: 'shell' }, h('section', { class: 'card' }, h('p', { class: 'muted' }, text))));
}

async function onGoogleCredential(response) {
  renderLoading('Checking your account…');
  try {
    const data = await callApi('login', { idToken: response.credential });
    store.set(SESSION_KEY, data.session);
    connectChatAfterLogin(response.credential);   // same Google sign-in also opens chat (Firebase)
    await loadPortal(data.session, null);
  } catch (err) {
    renderSignIn(err.message);
  }
}

async function loadPortal(session, cached) {
  try {
    const data = await callApi('portal', { session });
    store.set(CACHE_KEY, JSON.stringify(data));
    // Don't redraw (and wipe a search being typed) if nothing changed.
    const same = cached && JSON.stringify(cached.systems) === JSON.stringify(data.systems)
      && JSON.stringify(cached.user) === JSON.stringify(data.user);
    if (!same) renderPortal(root, data, { onSignOut: signOut, session });
  } catch (err) {
    if (SESSION_ERRORS.includes(err.message)) {
      store.set(SESSION_KEY, null);
      store.set(CACHE_KEY, null);
      renderSignIn(err.message === 'no_session' ? null : err.message);
    } else if (!cached) {
      renderSignIn(err.message);
    } // else: keep showing the cached portal (e.g. phone is offline)
  }
}

function waitForGoogle() {
  return new Promise((resolve) => {
    const tick = () => (window.google?.accounts?.id ? resolve() : setTimeout(tick, 100));
    tick();
  });
}

/** Silently refresh the session token when it's within 1 day of expiry. */
function scheduleSessionRefresh(session) {
  try {
    const payload = JSON.parse(atob(session.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
    const expiresIn = payload.x - Date.now();
    const refreshAt = expiresIn - 24 * 60 * 60 * 1000; // 1 day before expiry
    if (refreshAt <= 0) {
      // Already within refresh window — refresh now
      refreshSession(session);
    } else {
      setTimeout(() => refreshSession(session), Math.min(refreshAt, 2147483647));
    }
  } catch { /* session format unreadable, skip refresh scheduling */ }
}

async function refreshSession(session) {
  try {
    const data = await callApi('refresh_session', { session });
    if (data.session) {
      store.set(SESSION_KEY, data.session);
      scheduleSessionRefresh(data.session);
    }
  } catch { /* silent — will re-auth on next page load if expired */ }
}

function start() {
  if (!CLIENT_ID) { renderSignIn('config_missing'); return; }
  const session = store.get(SESSION_KEY);
  if (!session) { renderSignIn(); return; }

  let cached = null;
  try { cached = JSON.parse(store.get(CACHE_KEY) || 'null'); } catch {}
  if (cached?.user) renderPortal(root, cached, { onSignOut: signOut, session });
  else renderLoading('Loading your portal…');
  loadPortal(session, cached);
  scheduleSessionRefresh(session);
}

start();

// ---- Install as an app (Android/desktop Chrome offer a prompt; iPhone uses Share > Add to Home Screen)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  // Tapping a message notification while this tab is already open: the
  // service worker focuses this tab and tells us where to go. Routing it
  // here is more reliable than the service worker's own navigate() (not
  // every browser supports that), and firing 'pj-resumed' wakes the chat
  // connection, which can have gone stale while this tab sat in the background.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'pj-sw-updated') { location.reload(); return; }
    if (e.data?.type !== 'pj-notification-open') return;
    if (e.data.hash) location.hash = e.data.hash;
    window.dispatchEvent(new Event('pj-resumed'));
  });
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__pjInstall = e;
  document.dispatchEvent(new Event('pj-installable'));
});
