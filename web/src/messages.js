import { h } from './dom.js';
import { callApi } from './api.js';
import { loadingBox, ERRORS } from './workdata.js';

// Messages (Step 13): one-to-one messages between staff, stored in the Registry.
// Light on limits: the header badge checks every 3 minutes while the portal is
// open and visible; an open conversation checks every 20 seconds, and stops
// after 10 minutes without activity.

const SESSION_ERRORS = ['session_expired', 'no_session', 'not_registered', 'inactive'];
const MSG_ERRORS = { daily_limit: 'Daily message limit reached. Please try again tomorrow.', bad_request: 'This person cannot receive messages.' };
const errText = (e) => MSG_ERRORS[e.message] || ERRORS[e.message] || 'Something went wrong. Please try again.';
const BADGE_MS = 180000, THREAD_MS = 20000, IDLE_MS = 600000;

let badgeTimer = null, threadTimer = null;
const threads = new Map();   // email -> last thread, so a chat opens instantly
let inboxMemo = null;

/* ---------- Header button with unread badge ---------- */

export function messagesButton(ctx) {
  const badge = h('span', { class: 'msg-badge', hidden: true });
  const btn = h('a', { href: '#messages', class: 'top-search top-msg', 'aria-label': 'Messages', title: 'Messages' }, '💬', badge);
  const refresh = () => {
    if (document.hidden) return;
    callApi('unread', { session: ctx.session }).then((d) => setBadge(badge, d.unread)).catch(() => {});
  };
  btn._setBadge = (n) => setBadge(badge, n);
  clearInterval(badgeTimer);
  badgeTimer = setInterval(refresh, BADGE_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setTimeout(refresh, 1500);
  return btn;
}

function setBadge(badge, n) {
  badge.hidden = !n;
  badge.textContent = n > 9 ? '9+' : String(n || '');
  const top = document.querySelector('.top-msg');
  if (top) top.setAttribute('aria-label', n ? `Messages, ${n} unread` : 'Messages');
}

/* ---------- Inbox ---------- */

export function renderMessages(root, ctx, withEmail) {
  clearInterval(threadTimer);
  if (withEmail) { renderThread(root, ctx, withEmail); return; }
  const body = h('div', { class: 'page-body' }, loadingBox('Loading messages…'));
  root.replaceChildren(
    h('section', { class: 'page-head' }, h('h1', {}, '💬 Messages'),
      h('p', {}, 'Send a message to anyone in the team. Only the two of you can read it.')),
    body);
  const show = (d) => {
    const badge = document.querySelector('.top-msg .msg-badge');
    if (badge) setBadge(badge, d.unread);
    const typed = body.querySelector('.msg-find');
    if (typed && typed.value) return;          // don't wipe a name being typed
    body.replaceChildren(newMessage(d.contacts), conversations(d.conversations));
  };
  if (inboxMemo) show(inboxMemo);
  callApi('inbox', { session: ctx.session }).then((d) => { inboxMemo = d; show(d); })
    .catch((e) => { if (!inboxMemo) body.replaceChildren(errorBox(e, ctx, () => renderMessages(root, ctx))); });
}

function newMessage(contacts) {
  const results = h('ul', { class: 'gs-list msg-contacts', hidden: true });
  const input = h('input', {
    class: 'search msg-find', type: 'search', placeholder: 'New message: type a name…', 'aria-label': 'Find a person to message',
    oninput: (e) => {
      const q = e.target.value.trim().toLowerCase();
      const hits = q ? contacts.filter((c) => `${c.name} ${c.designation}`.toLowerCase().includes(q)).slice(0, 8) : [];
      results.hidden = !hits.length;
      results.replaceChildren(...hits.map((c) => h('li', {}, h('a', { href: `#messages/${encodeURIComponent(c.email)}`, class: 'gs-row' },
        h('span', { class: 'gs-avatar', 'aria-hidden': 'true' }, initials(c.name)),
        h('span', { class: 'gs-main' }, h('b', {}, c.name), h('span', { class: 'muted-sm' }, c.designation || c.role))))));
    },
  });
  return h('section', { class: 'msg-new' }, input, results);
}

function conversations(list) {
  if (!list.length) return h('p', { class: 'empty' }, 'No messages yet. Type a name above to start one.');
  return h('ul', { class: 'gs-list msg-convs' }, list.map((c) => h('li', {},
    h('a', { href: `#messages/${encodeURIComponent(c.email)}`, class: `gs-row${c.unread ? ' msg-unread' : ''}` },
      h('span', { class: 'gs-avatar', 'aria-hidden': 'true' }, initials(c.name)),
      h('span', { class: 'gs-main' },
        h('b', {}, c.name, c.active ? '' : ' (left)'),
        h('span', { class: 'muted-sm msg-last' }, `${c.last.mine ? 'You: ' : ''}${c.last.text}`)),
      h('span', { class: 'msg-side' },
        h('span', { class: 'muted-sm' }, when(c.last.at)),
        c.unread ? h('span', { class: 'msg-count' }, String(c.unread)) : null)))));
}

/* ---------- One conversation ---------- */

function renderThread(root, ctx, email) {
  const list = h('div', { class: 'msg-thread', 'aria-live': 'polite' }, loadingBox('Loading conversation…'));
  const title = h('h1', {}, '💬');
  const sub = h('p', {});
  const box = h('textarea', { class: 'msg-input', rows: '2', maxlength: '1000', placeholder: 'Write a message…', 'aria-label': 'Message' });
  const count = h('span', { class: 'muted-sm' }, '');
  const send = h('button', { type: 'button', class: 'btn-navy-solid' }, 'Send');
  const status = h('p', { class: 'muted-sm', role: 'status' });
  let last = Date.now(), shown = '';

  root.replaceChildren(
    h('section', { class: 'page-head' }, h('a', { href: '#messages', class: 'vs-link' }, '← All messages'), title, sub),
    h('div', { class: 'page-body' }, list,
      h('div', { class: 'msg-compose' }, box, h('div', { class: 'msg-compose-row' }, count, send)), status));

  const draw = (d) => {
    if (d.with.name) {
      title.textContent = `💬 ${d.with.name}`;
      sub.textContent = d.with.active ? (d.with.designation || '') : 'This person has left; you can read old messages only.';
      box.disabled = send.disabled = !d.with.active;
    }
    const sig = d.messages.map((m) => m.id + (m.readAt ? 'r' : '') + (m.sending ? 's' : '')).join(',');
    if (sig === shown) return;
    const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
    shown = sig;
    const lastMine = [...d.messages].reverse().find((m) => m.mine);
    list.replaceChildren(...(d.messages.length ? d.messages.map((m, i) => {
      const day = dayLabel(m.at), prev = d.messages[i - 1];
      return [
        !prev || dayLabel(prev.at) !== day ? h('div', { class: 'msg-day' }, day) : null,
        h('div', { class: `msg-bubble${m.mine ? ' mine' : ''}` },
          h('div', { class: 'msg-text' }, m.text),
          h('div', { class: 'msg-meta' }, timeOf(m.at), m.sending ? ' · Sending…' : m === lastMine && m.readAt ? ' · Seen' : '')),
      ];
    }).flat().filter(Boolean) : [h('p', { class: 'empty' }, 'No messages yet. Say hello!')]));
    if (atBottom || !list.dataset.scrolled) { list.dataset.scrolled = '1'; window.scrollTo(0, document.body.scrollHeight); }
  };

  const badge = document.querySelector('.top-msg .msg-badge');
  let pending = [];   // messages sent from this screen, not yet confirmed
  const withPending = (d) => ({ ...d, messages: [...d.messages, ...pending.filter((p) => !d.messages.some((m) => m.id === p.id))] });
  const markRead = (d) => {
    if (!d.messages.some((m) => !m.mine && !m.readAt)) return;
    callApi('markRead', { session: ctx.session, with: email })
      .then(() => callApi('unread', { session: ctx.session }))
      .then((u) => { if (u && badge) setBadge(badge, u.unread); inboxMemo = null; })
      .catch(() => {});
  };
  const fetchThread = () => callApi('thread', { session: ctx.session, with: email }).then((d) => {
    threads.set(email, d);
    draw(withPending(d));
    markRead(d);
  });
  if (threads.has(email)) draw(withPending(threads.get(email)));
  fetchThread().catch((e) => { if (!threads.has(email)) list.replaceChildren(errorBox(e, ctx, () => renderThread(root, ctx, email))); });

  clearInterval(threadTimer);
  threadTimer = setInterval(() => {
    if (!document.body.contains(list)) { clearInterval(threadTimer); return; }
    if (document.hidden || Date.now() - last > IDLE_MS) return;
    fetchThread().catch(() => {});
  }, THREAD_MS);

  const doSend = async () => {
    const text = box.value.trim();
    if (!text) { box.focus(); return; }
    last = Date.now();
    // Show it straight away; the server confirms in the background.
    const temp = { id: `tmp-${Date.now()}`, at: Date.now(), mine: true, text, readAt: null, sending: true };
    pending.push(temp);
    box.value = ''; count.textContent = ''; status.textContent = '';
    const base = threads.get(email) || { with: { name: '', active: true }, messages: [] };
    draw(withPending(base));
    window.scrollTo(0, document.body.scrollHeight);
    box.focus();
    try {
      const r = await callApi('sendMessage', { session: ctx.session, to: email, text });
      pending = pending.filter((p) => p !== temp);
      const cur = threads.get(email) || base;
      const next = { ...cur, messages: [...cur.messages.filter((m) => m.id !== r.message.id), r.message] };
      threads.set(email, next);
      inboxMemo = null;
      draw(withPending(next));
    } catch (e) {
      temp.sending = false; temp.failed = true;
      status.textContent = `${errText(e)} Your text is back in the box.`;
      pending = pending.filter((p) => p !== temp);
      if (!box.value) box.value = text;
      draw(withPending(threads.get(email) || base));
    }
  };
  send.addEventListener('click', doSend);
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSend(); } });
  box.addEventListener('input', () => { last = Date.now(); count.textContent = box.value.length > 800 ? `${box.value.length}/1000` : ''; });
}

/* ---------- helpers ---------- */

function errorBox(e, ctx, retry) {
  return h('div', { class: 'notice error' }, h('p', {}, errText(e)),
    SESSION_ERRORS.includes(e.message)
      ? h('button', { type: 'button', class: 'btn-navy', onclick: ctx.onSignOut }, 'Sign in again')
      : h('button', { type: 'button', class: 'btn-navy', onclick: retry }, 'Try again'));
}

const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const timeOf = (ms) => new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
function dayLabel(ms) {
  const d = new Date(ms), t = new Date();
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
function when(ms) {
  return new Date(ms).toDateString() === new Date().toDateString() ? timeOf(ms)
    : new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
