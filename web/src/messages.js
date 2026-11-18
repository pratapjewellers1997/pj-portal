import { h } from './dom.js';
import { callApi } from './api.js';
import { loadingBox, ERRORS } from './workdata.js';

// Messages (Step 13, v2): real-time chat on Firebase Firestore.
// - Text: Firestore (instant, works on weak data, kept on the phone).
// - Photos / videos / PDFs: private files in mis@ Google Drive, through the API.
// - Phone notifications: Firebase Cloud Messaging, sent by the API.
// The Firebase code is loaded only after the portal has opened.

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const LIMITS = { image: 10, video: 25, pdf: 10 };           // MB
const ERR = {
  file_type: 'Only photos, videos (MP4/MOV) and PDFs can be sent.',
  file_too_big: 'File is too big. Photos and PDFs: up to 10 MB, videos: up to 25 MB.',
  push_blocked: 'Notifications are blocked for this site. Allow them in the browser settings (🔒 next to the address), then try again.',
  push_dismissed: 'Notifications were not allowed.',
  'permission-denied': 'Chat is not ready for your account yet. It updates every 10 minutes; ask MIS if this stays.',
  unavailable: 'No internet right now. Messages will send when you are back online.',
};
const errText = (e) => ERR[e?.code] || ERR[e?.message] || ERRORS[e?.message] || 'Something went wrong. Please try again.';

let fbMod = null;          // the firebase.js module once loaded
let chat = null;           // {me, myName} once connected
let chats = [];            // my chats, live
const chatSubs = new Set();
let chatsOff = null;
let pageOffs = [];         // listeners of the open page
const fileUrls = new Map(); // Drive file id -> object URL (this visit)

const loadFb = () => (fbMod ? Promise.resolve(fbMod) : import('./firebase.js').then((m) => { fbMod = m; return m; }));

/** Connects chat if Firebase already knows this person. Returns 'ready' | 'signin' | 'not_ready'. */
async function ensureChat(ctx) {
  if (chat) return 'ready';
  const fb = await loadFb();
  const u = await fb.currentUser();
  if (!u) return 'signin';
  if (!ctx.user.emails.map((e) => e.toLowerCase()).includes(String(u.email).toLowerCase())) {
    await fb.disconnectChat();             // a different Google account was used before
    return 'signin';
  }
  let staff = null;
  try { staff = await fb.myStaff(u.email); } catch { staff = null; }
  if (!staff) return 'not_ready';
  chat = { me: staff.primary, myName: staff.name || ctx.user.name };
  chatsOff = fb.watchChats(chat.me, (list) => { chats = list; chatSubs.forEach((f) => f(list)); }, () => {});
  return 'ready';
}

/** Called right after the portal sign-in, with Google's fresh ID token. */
export function connectChatAfterLogin(idToken) {
  loadFb().then((fb) => fb.connectChat(idToken)).catch(() => {});
}

export function disconnectChatOnSignOut() {
  if (chatsOff) chatsOff();
  chat = null; chats = []; chatsOff = null;
  if (fbMod) fbMod.disconnectChat();
}

/* ---------- Header button with unread badge ---------- */

export function messagesButton(ctx) {
  const badge = h('span', { class: 'msg-badge', hidden: true });
  const btn = h('a', { href: '#messages', class: 'top-search top-msg', 'aria-label': 'Messages', title: 'Messages' }, '💬', badge);
  const show = (list) => {
    const n = list.filter((c) => c.unread).length;
    badge.hidden = !n;
    badge.textContent = n > 9 ? '9+' : String(n || '');
    btn.setAttribute('aria-label', n ? `Messages, ${n} unread` : 'Messages');
  };
  chatSubs.add(show);
  setTimeout(() => ensureChat(ctx).then((s) => { if (s === 'ready') show(chats); }).catch(() => {}), 1500);
  return btn;
}

/* ---------- Pages ---------- */

export function renderMessages(root, ctx, withEmail) {
  pageOffs.forEach((f) => f()); pageOffs = [];
  const body = h('div', { class: 'page-body' }, loadingBox('Opening chat…'));
  const notice = h('p', { class: 'msg-audit', hidden: true });
  const records = ctx.user.role !== 'Doer' ? h('a', { href: '#chatadmin', class: 'vs-link' }, '⚙️ Chat records') : null;
  const intro = h('p', {}, 'Chat with anyone in the team. Only the two of you can read it.');
  const head = h('section', { class: 'page-head' }, h('h1', {}, '💬 Messages'), intro, records, notice);
  root.replaceChildren(head, body);
  ensureChat(ctx).then((state) => {
    if (!document.body.contains(body)) return;
    if (state === 'ready') {
      pageOffs.push(fbMod.watchSettings((s) => {
        notice.hidden = !s.auditOn;
        intro.textContent = s.auditOn ? 'Chat with anyone in the team.' : 'Chat with anyone in the team. Only the two of you can read it.';
        notice.textContent = s.auditOn ? `👁 Chat audit is ON since ${new Date(s.since).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}: Admin, Owners and Managers can read messages sent after that time.` : '';
      }));
    }
    if (state === 'signin') return signInCard(body, ctx, () => renderMessages(root, ctx, withEmail));
    if (state === 'not_ready') return body.replaceChildren(h('div', { class: 'notice' }, h('p', {}, ERR['permission-denied'])));
    if (withEmail) renderThread(root, ctx, withEmail.toLowerCase());
    else renderInbox(body, ctx);
  }).catch((e) => body.replaceChildren(h('div', { class: 'notice error' }, h('p', {}, errText(e)))));
}

function signInCard(body, ctx, done) {
  const slot = h('div', { class: 'msg-gbtn' });
  const msg = h('p', { class: 'muted-sm', role: 'status' });
  body.replaceChildren(h('section', { class: 'msg-connect' },
    h('h2', { class: 'section-title' }, 'Connect chat on this device'),
    h('p', {}, 'One time only: tap the button and choose the same Google account you use for the portal.'),
    slot, msg));
  const tick = () => {
    if (!window.google?.accounts?.id) { setTimeout(tick, 150); return; }
    google.accounts.id.initialize({
      client_id: CLIENT_ID, ux_mode: 'popup',
      callback: async (r) => {
        msg.textContent = 'Connecting…';
        try { const fb = await loadFb(); await fb.connectChat(r.credential); done(); }
        catch (e) { msg.textContent = errText(e); }
      },
    });
    google.accounts.id.renderButton(slot, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'continue_with', width: 260 });
  };
  tick();
}

function renderInbox(body, ctx) {
  const find = h('input', { class: 'search msg-find', type: 'search', placeholder: 'New message: type a name…', 'aria-label': 'Find a person to message' });
  const results = h('ul', { class: 'gs-list msg-contacts', hidden: true });
  const list = h('div');
  let staff = [];
  const drawResults = () => {
    const q = find.value.trim().toLowerCase();
    const hits = q ? staff.filter((s) => s.email !== chat.me && `${s.name} ${s.designation}`.toLowerCase().includes(q)).slice(0, 8) : [];
    results.hidden = !hits.length;
    results.replaceChildren(...hits.map((s) => h('li', {}, h('a', { href: `#messages/${encodeURIComponent(s.email)}`, class: 'gs-row' },
      avatar(s.name), h('span', { class: 'gs-main' }, h('b', {}, s.name), h('span', { class: 'muted-sm' }, s.designation || s.role))))));
  };
  find.addEventListener('input', drawResults);
  const drawList = (all) => {
    const withMsgs = all.filter((c) => c.last);
    list.replaceChildren(withMsgs.length ? h('ul', { class: 'gs-list msg-convs' }, withMsgs.map((c) => h('li', {},
      h('a', { href: `#messages/${encodeURIComponent(c.other)}`, class: `gs-row${c.unread ? ' msg-unread' : ''}` },
        avatar(c.otherName),
        h('span', { class: 'gs-main' }, h('b', {}, c.otherName),
          h('span', { class: 'muted-sm msg-last' }, `${c.last.from === chat.me ? 'You: ' : ''}${c.last.text}`)),
        h('span', { class: 'msg-side' }, h('span', { class: 'muted-sm' }, when(c.last.at)),
          c.unread ? h('span', { class: 'msg-count' }, 'New') : null)))))
      : h('p', { class: 'empty' }, 'No messages yet. Type a name above to start one.'));
  };
  body.replaceChildren(pushBar(ctx), h('section', { class: 'msg-new' }, find, results), list);
  drawList(chats);
  chatSubs.add(drawList);
  pageOffs.push(() => chatSubs.delete(drawList));
  pageOffs.push(fbMod.watchStaff((s) => { staff = s; drawResults(); }, () => {}));
}

function renderThread(root, ctx, other) {
  const fb = fbMod;
  const id = fb.chatIdOf(chat.me, other);
  const title = h('h1', {}, '💬');
  const sub = h('p', {});
  const list = h('div', { class: 'msg-thread', 'aria-live': 'polite' }, loadingBox('Loading conversation…'));
  const box = h('textarea', { class: 'msg-input', rows: '2', maxlength: '1000', placeholder: 'Write a message…', 'aria-label': 'Message' });
  const fileIn = h('input', { type: 'file', accept: 'image/*,video/mp4,video/quicktime,video/webm,application/pdf', hidden: true });
  const attach = h('button', { type: 'button', class: 'msg-attach', title: 'Send a photo, video or PDF', 'aria-label': 'Attach a photo, video or PDF' }, '📎');
  const send = h('button', { type: 'button', class: 'btn-navy-solid' }, 'Send');
  const status = h('p', { class: 'muted-sm', role: 'status' });
  let otherName = other, otherDesig = '', otherActive = true, messages = [], otherReadAt = 0, msgOff = null, lastMarked = 0;

  root.replaceChildren(
    h('section', { class: 'page-head' }, h('a', { href: '#messages', class: 'vs-link' }, '← All messages'), title, sub),
    h('div', { class: 'page-body' }, list,
      h('div', { class: 'msg-compose' }, box, fileIn,
        h('div', { class: 'msg-compose-row' }, attach, h('span', { class: 'muted-sm msg-hint' }, 'Ctrl+Enter to send'), send)),
      status));

  const setHeader = () => {
    title.textContent = `💬 ${otherName}`;
    sub.textContent = otherActive ? otherDesig : 'This person is no longer active; you can read old messages only.';
    box.disabled = send.disabled = attach.disabled = !otherActive;
  };
  pageOffs.push(fb.watchStaff((staff) => {
    const s = staff.find((x) => x.email === other);
    otherActive = Boolean(s);
    if (s) { otherName = s.name; otherDesig = s.designation || ''; }
    setHeader();
  }, () => {}));

  const draw = () => {
    const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
    const lastMine = [...messages].reverse().find((m) => m.from === chat.me);
    list.replaceChildren(...(messages.length ? messages.flatMap((m, i) => {
      const prev = messages[i - 1];
      return [
        !prev || dayLabel(prev.at) !== dayLabel(m.at) ? h('div', { class: 'msg-day' }, dayLabel(m.at)) : null,
        h('div', { class: `msg-bubble${m.from === chat.me ? ' mine' : ''}` },
          m.file ? fileView(m.file, ctx) : null,
          m.text ? h('div', { class: 'msg-text' }, m.text) : null,
          h('div', { class: 'msg-meta' }, timeOf(m.at),
            m.pending ? ' · Sending…' : m === lastMine && otherReadAt >= m.at ? ' · Seen' : '')),
      ].filter(Boolean);
    }) : [h('p', { class: 'empty' }, 'No messages yet. Say hello!')]));
    if (atBottom || !list.dataset.scrolled) { list.dataset.scrolled = '1'; window.scrollTo(0, document.body.scrollHeight); }
  };

  const markRead = () => {
    const last = messages[messages.length - 1];
    if (!last || last.from === chat.me || document.hidden || last.at <= lastMarked) return;
    lastMarked = last.at;
    fb.markChatRead(id, chat.me).catch(() => {});
  };
  let retries = 0;
  const attachMessages = () => {
    if (msgOff) return;
    msgOff = fb.watchMessages(id, (l) => { messages = l; retries = 0; status.textContent = ''; draw(); markRead(); }, (e) => {
      // A refused listener stops; start it again a few times (e.g. chat just created, phone was offline).
      msgOff = null;
      if (retries++ < 5 && document.body.contains(list)) setTimeout(attachMessages, 1500 * retries);
      else status.textContent = errText(e);
    });
  };
  pageOffs.push(() => { if (msgOff) msgOff(); msgOff = null; retries = 99; });
  const onChats = (all) => {
    const c = all.find((x) => x.id === id);
    if (c && !c.saved && !msgOff) { otherReadAt = c.otherReadAt; return; }   // wait until Google has the chat
    if (c) {
      if (!otherDesig && c.otherName) otherName = c.otherName;
      otherReadAt = c.otherReadAt;
      setHeader(); attachMessages(); if (messages.length) draw();
    } else if (!msgOff) { messages = []; draw(); }
  };
  onChats(chats);
  chatSubs.add(onChats);
  pageOffs.push(() => chatSubs.delete(onChats));
  const onVis = () => { if (!document.hidden) markRead(); };
  document.addEventListener('visibilitychange', onVis);
  pageOffs.push(() => document.removeEventListener('visibilitychange', onVis));

  const deliver = async (text, file) => {
    // Firestore shows the message at once ("Sending…") and confirms it when saved.
    // A brand-new chat is listened to only after it exists (security rules check the chat).
    await fb.sendChatMessage({ me: chat.me, myName: chat.myName, other, otherName, text, file });
    attachMessages();   // safe now: the chat exists on Google's side
    callApi('notifyChat', { session: ctx.session, to: other }).catch(() => {});
  };
  const doSend = () => {
    const text = box.value.trim();
    if (!text) { box.focus(); return; }
    box.value = ''; status.textContent = '';
    deliver(text).catch((e) => { status.textContent = `${errText(e)} Your text is back in the box.`; if (!box.value) box.value = text; });
    box.focus();
  };
  send.addEventListener('click', doSend);
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSend(); } });
  attach.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    const kind = f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : f.type === 'application/pdf' ? 'pdf' : '';
    if (!kind) { status.textContent = ERR.file_type; return; }
    attach.disabled = true;
    try {
      status.textContent = kind === 'image' ? 'Preparing photo…' : 'Reading file…';
      const prepared = kind === 'image' && !/gif|heic|heif/.test(f.type) ? await shrinkImage(f) : { blob: f, name: f.name, mime: f.type };
      if (prepared.blob.size > LIMITS[kind] * 1048576) throw new Error('file_too_big');
      status.textContent = `Uploading ${kind === 'image' ? 'photo' : kind} (${mb(prepared.blob.size)})…`;
      const data = await toBase64(prepared.blob);
      const up = await callApi('chatUpload', { session: ctx.session, to: other, name: prepared.name, mime: prepared.mime, data });
      fileUrls.set(up.file.id, URL.createObjectURL(prepared.blob));
      const caption = box.value.trim();
      box.value = '';
      await deliver(caption, up.file);
      status.textContent = '';
    } catch (e) { status.textContent = errText(e); }
    attach.disabled = !otherActive;
  });
  setHeader();
}

/* ---------- Files ---------- */

function fileView(file, ctx) {
  const wrap = h('div', { class: `msg-file msg-file-${file.kind}` });
  const load = async () => {
    if (fileUrls.has(file.id)) return fileUrls.get(file.id);
    const r = await callApi('chatFile', { session: ctx.session, id: file.id });
    const bin = atob(r.data), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: r.mime }));
    fileUrls.set(file.id, url);
    return url;
  };
  if (file.kind === 'image') {
    const img = h('img', { alt: 'Photo', class: 'msg-img' });
    wrap.append(h('span', { class: 'muted-sm' }, '📷 Loading photo…'));
    load().then((u) => { img.src = u; img.addEventListener('click', () => window.open(u, '_blank')); wrap.replaceChildren(img); })
      .catch(() => wrap.replaceChildren(h('span', { class: 'muted-sm' }, '📷 Photo could not be loaded.')));
    return wrap;
  }
  const btn = h('button', { type: 'button', class: 'msg-file-btn' },
    file.kind === 'video' ? `▶ Play video (${mb(file.size)})` : `📄 ${file.name} (${mb(file.size)})`);
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Loading…';
    try {
      const u = await load();
      if (file.kind === 'video') wrap.replaceChildren(h('video', { src: u, controls: true, playsinline: true, class: 'msg-video' }));
      else { window.open(u, '_blank'); btn.disabled = false; btn.textContent = `📄 ${file.name}`; }
    } catch { btn.disabled = false; btn.textContent = 'Could not load. Tap to try again.'; }
  });
  wrap.append(btn);
  return wrap;
}

function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 1600, scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve({ blob: b, name: file.name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg' }) : reject(new Error('file_type'))), 'image/jpeg', 0.82);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => resolve({ blob: file, name: file.name, mime: file.type });
    img.src = URL.createObjectURL(file);
  });
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('file_type'));
    r.readAsDataURL(blob);
  });
}

/* ---------- Phone notifications bar ---------- */

function pushBar(ctx) {
  const bar = h('section', { class: 'msg-push', hidden: true });
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const draw = () => {
    const on = localStorage.getItem('pj_push_token');
    bar.hidden = false;
    if (isIos && !standalone) {
      bar.replaceChildren(h('span', {}, '🔔 For notifications on iPhone: tap Share → "Add to Home Screen", then open the portal from that icon.'));
      return;
    }
    const btn = h('button', { type: 'button', class: 'vs-how-btn' }, on ? 'Turn off' : 'Turn on');
    const msg = h('span', { class: 'muted-sm' });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      if (on) {
        // Instant: switch off on screen, tidy up in the background.
        localStorage.removeItem('pj_push_token');
        draw();
        callApi('pushUnregister', { session: ctx.session, token: on }).catch(() => {});
        fbMod.disablePush().catch(() => {});
        return;
      }
      btn.textContent = 'Turning on…';
      try {
        const token = await fbMod.enablePush();
        // Show "on" straight away; save to the server in the background.
        localStorage.setItem('pj_push_token', token);
        draw();
        callApi('pushRegister', { session: ctx.session, token, device: deviceName() }).catch((e) => {
          localStorage.removeItem('pj_push_token');
          draw();
          const m = bar.querySelector('.muted-sm');
          if (m) m.textContent = 'Could not save this device. ' + errText(e) + ' Please tap Turn on again.';
        });
      } catch (e) { msg.textContent = errText(e); btn.textContent = 'Turn on'; btn.disabled = false; }
    });
    bar.replaceChildren(h('span', {}, on ? '🔔 Notifications are on for this device.' : '🔔 Get a notification on this device for new messages, notices and appreciation.'), btn, msg);
  };
  // pushSupported() also preloads the notification code, so the first tap is quicker.
  fbMod.pushSupported().then((ok) => { if (ok || isIos) draw(); });
  return bar;
}

function deviceName() {
  const ua = navigator.userAgent;
  const os = /android/i.test(ua) ? 'Android' : /iphone|ipad/i.test(ua) ? 'iPhone' : /windows/i.test(ua) ? 'Windows' : /mac/i.test(ua) ? 'Mac' : 'Device';
  const br = /edg\//i.test(ua) ? 'Edge' : /chrome/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : /firefox/i.test(ua) ? 'Firefox' : '';
  return `${os} ${br}`.trim();
}

/* ---------- helpers ---------- */

const avatar = (name) => h('span', { class: 'gs-avatar', 'aria-hidden': 'true' },
  String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join(''));
const mb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const timeOf = (t) => new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
function dayLabel(t) {
  const d = new Date(t), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
const when = (t) => (new Date(t).toDateString() === new Date().toDateString() ? timeOf(t)
  : new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
