import './style.css';
import { callApi } from './api.js';
import { h } from './dom.js';
import { renderPortal } from './portal.js';

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
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
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

function start() {
  if (!CLIENT_ID) { renderSignIn('config_missing'); return; }
  const session = store.get(SESSION_KEY);
  if (!session) { renderSignIn(); return; }

  let cached = null;
  try { cached = JSON.parse(store.get(CACHE_KEY) || 'null'); } catch {}
  if (cached?.user) renderPortal(root, cached, { onSignOut: signOut, session });
  else renderLoading('Loading your portal…');
  loadPortal(session, cached);
}

start();

// ---- Install as an app (Android/desktop Chrome offer a prompt; iPhone uses Share > Add to Home Screen)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__pjInstall = e;
  document.dispatchEvent(new Event('pj-installable'));
});
