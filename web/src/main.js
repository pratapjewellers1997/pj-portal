import './style.css';
import { callApi } from './api.js';

// Step 1: sign-in test. Shows who the API says you are.

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SESSION_KEY = 'pj_session';
const view = document.getElementById('view');

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

function getSession() {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
}
function setSession(s) {
  try { s ? localStorage.setItem(SESSION_KEY, s) : localStorage.removeItem(SESSION_KEY); } catch {}
}

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (text != null) node.textContent = text;
  return node;
}

function showError(code) {
  const p = el('p', { class: 'error' }, MESSAGES[code] || MESSAGES.server_error);
  view.prepend(p);
}

function renderSignIn(errorCode) {
  view.replaceChildren();
  view.append(el('p', { class: 'muted' }, 'Sign in with your Google account (company or Gmail).'));
  const btn = el('div', { id: 'gbtn' });
  view.append(btn);
  if (errorCode) showError(errorCode);
  waitForGoogle().then(() => {
    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: onGoogleCredential,
      ux_mode: 'popup',
    });
    google.accounts.id.renderButton(btn, {
      theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', width: 280,
    });
  });
}

function renderUser(user) {
  view.replaceChildren();
  const box = el('div', { class: 'who' });
  box.append(el('p', { class: 'hello' }, `Namaste, ${user.name || user.email}`));
  const dl = el('dl');
  [['Email', user.email], ['Role', user.role], ['Designation', user.designation || '—']]
    .forEach(([k, v]) => { dl.append(el('dt', {}, k), el('dd', {}, v)); });
  box.append(dl);
  box.append(el('p', { class: 'ok' }, 'Sign-in test passed. The API checked your Google account.'));
  const out = el('button', { class: 'ghost', type: 'button' }, 'Sign out');
  out.addEventListener('click', () => {
    setSession(null);
    if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
    renderSignIn();
  });
  box.append(out);
  view.append(box);
}

async function onGoogleCredential(response) {
  view.replaceChildren(el('p', { class: 'muted' }, 'Checking your account…'));
  try {
    const data = await callApi('login', { idToken: response.credential });
    setSession(data.session);
    renderUser(data.user);
  } catch (err) {
    renderSignIn(err.message);
  }
}

function waitForGoogle() {
  return new Promise((resolve) => {
    const tick = () => (window.google?.accounts?.id ? resolve() : setTimeout(tick, 100));
    tick();
  });
}

async function start() {
  if (!CLIENT_ID) { renderSignIn('config_missing'); return; }
  const session = getSession();
  if (!session) { renderSignIn(); return; }
  try {
    const data = await callApi('me', { session });
    renderUser(data.user);
  } catch (err) {
    setSession(null);
    renderSignIn(err.message === 'no_session' ? null : err.message);
  }
}

start();
