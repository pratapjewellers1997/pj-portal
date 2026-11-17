import { h, safeUrl } from './dom.js';
import { callApi } from './api.js';
import { loadingBox, ERRORS } from './workdata.js';

// Chat records (Step 13, part 3): where everything is stored, free limits,
// daily archive, delete old chats, and the Audit setting.
// Admin: everything. Owners / Managers: the Audit view, only while Audit is ON.

const ERR = {
  purge_needs_filter: 'Choose a person, a chat or a date range first.',
  forbidden: 'This page is for Admin (and for Owners / Managers while Audit is ON).',
};
const errText = (e) => ERR[e?.message] || ERRORS[e?.message] || 'Something went wrong. Please try again.';
const fmt = (t) => (t ? new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

export function renderChatAdmin(root, ctx) {
  const body = h('div', { class: 'page-body' }, loadingBox('Loading chat records…'));
  root.replaceChildren(
    h('section', { class: 'page-head' }, h('a', { href: '#messages', class: 'vs-link' }, '← Messages'),
      h('h1', {}, '⚙️ Chat records'),
      h('p', {}, 'Where chats are kept, free limits, archive, clean-up and the Audit setting.')),
    body);
  callApi('chatAdmin', { session: ctx.session })
    .then((d) => draw(body, d, ctx, () => renderChatAdmin(root, ctx)))
    .catch((e) => body.replaceChildren(h('div', { class: 'notice error' }, h('p', {}, errText(e)))));
}

function draw(body, d, ctx, reload) {
  const parts = [];
  if (d.isAdmin) parts.push(storageBox(d), limitsBox(), archiveBox(d, ctx, reload), purgeBox(d, ctx, reload));
  parts.push(auditBox(d, ctx, reload));
  body.replaceChildren(...parts);
}

const link = (url, label) => {
  const u = safeUrl(url);
  return u ? h('a', { href: u, target: '_blank', rel: 'noopener' }, label, ' ↗') : h('span', { class: 'muted-sm' }, 'not created yet');
};

function storageBox(d) {
  const L = d.links;
  const rows = [
    ['Chat messages (live)', link(L.firestore, 'Firebase → Firestore → chats'), 'Portal: only the two people of a chat (and Audit roles while ON). Console: mis@.'],
    ['Photos, videos, PDFs', link(L.files, 'mis@ Drive → PJ Portal Chat Files'), 'mis@ only. One folder per chat. Never shared by link.'],
    ['Daily archive (backup)', link(L.archive, 'PJ Portal Chat Archive (spreadsheet)'), 'mis@ only. Has a Guide tab and a Deletion log.'],
    ['Who may chat', link(L.staff, 'Firebase → Firestore → staff'), 'Copied from People (Active = Yes) every 10 minutes.'],
    ['Phone notification devices', link(L.devices, 'Registry → Portal Devices'), `${d.devices} device${d.devices === 1 ? '' : 's'} turned on.`],
    ['Usage (near a limit?)', link(L.usage, 'Firebase → Firestore → Usage'), 'Reads, writes and storage per day.'],
  ];
  return h('section', { class: 'ca-box' }, h('h2', { class: 'section-title' }, 'Where everything is stored'),
    d.firestoreError ? h('p', { class: 'notice error' }, `Firestore could not be read: ${d.firestoreError}`) : null,
    table(['What', 'Where', 'Who can open it'], rows));
}

function limitsBox() {
  const rows = [
    ['Firestore: stored', '1 GiB', 'Millions of text messages (photos are in Drive, not here)'],
    ['Firestore: reads', '50,000 / day', 'Opening chats and the inbox'],
    ['Firestore: writes', '20,000 / day', 'Sending, "Seen"'],
    ['Firestore: deletes', '20,000 / day', 'Clean-up below'],
    ['Firestore: downloads', '10 GiB / month', ''],
    ['Notifications (FCM)', 'Free, no limit', ''],
    ['Files', 'mis@ Workspace storage', 'Per file: photo 10 MB (shrunk to ~0.2 MB), video 25 MB, PDF 10 MB'],
    ['If a limit is reached', 'Pauses until the next day (~1:30 pm IST)', 'Nothing lost, never billed. Never add a card / Blaze plan.'],
  ];
  return h('section', { class: 'ca-box' }, h('h2', { class: 'section-title' }, 'Free limits (Spark plan)'), table(['Service', 'Limit', 'Note'], rows));
}

function archiveBox(d, ctx, reload) {
  const btn = h('button', { type: 'button', class: 'btn-navy-solid' }, 'Archive now');
  const msg = h('span', { class: 'muted-sm', role: 'status' });
  btn.addEventListener('click', async () => {
    btn.disabled = true; msg.textContent = 'Copying new messages…';
    try {
      const r = await callApi('archiveNow', { session: ctx.session });
      msg.textContent = r.busy ? 'An archive is already running. Try again in a minute.' : `${r.added} new message${r.added === 1 ? '' : 's'} copied.`;
    } catch (e) { msg.textContent = errText(e); }
    btn.disabled = false;
  });
  return h('section', { class: 'ca-box' }, h('h2', { class: 'section-title' }, 'Daily archive'),
    h('p', {}, 'Every day at 23:00 IST new messages are copied to the archive spreadsheet (date, chat, from, to, text, file link). Deleting below always archives first.'),
    h('p', { class: 'muted-sm' }, `Last run: ${fmt(d.archive.lastRun && Date.parse(d.archive.lastRun))} · Copied up to: ${fmt(d.archive.upto)}`),
    h('div', { class: 'ca-row' }, btn, msg));
}

function purgeBox(d, ctx, reload) {
  const person = h('select', { 'aria-label': 'Person' }, h('option', { value: '' }, 'Anyone'),
    d.people.map((p) => h('option', { value: p.email }, `${p.name}${p.active ? '' : ' (left)'}`)));
  const chatSel = h('select', { 'aria-label': 'Chat' }, h('option', { value: '' }, 'Any chat'),
    d.chats.map((c) => h('option', { value: c.id }, `${c.names.join(' – ')}${c.lastAt ? ' · ' + new Date(c.lastAt).toLocaleDateString('en-IN') : ''}`)));
  const from = h('input', { type: 'date', 'aria-label': 'From date' });
  const to = h('input', { type: 'date', 'aria-label': 'To date' });
  const files = h('input', { type: 'checkbox', checked: true });
  const arch = h('input', { type: 'checkbox' });
  const out = h('div', { class: 'ca-out', role: 'status' });
  const filter = () => ({ person: person.value, chatId: chatSel.value, from: from.value, to: to.value, files: files.checked, archive: arch.checked });
  const preview = h('button', { type: 'button', class: 'btn-navy-solid' }, 'Preview');
  preview.addEventListener('click', async () => {
    preview.disabled = true; out.replaceChildren(h('span', { class: 'muted-sm' }, 'Counting…'));
    try {
      const p = await callApi('chatPurge', { session: ctx.session, ...filter(), preview: true });
      if (!p.messages) { out.replaceChildren(h('p', {}, `Nothing found for: ${p.what}.`)); }
      else {
        const word = h('input', { type: 'text', placeholder: 'Type DELETE', 'aria-label': 'Type DELETE to confirm', autocomplete: 'off' });
        const go = h('button', { type: 'button', class: 'ca-danger', disabled: true }, `Delete ${p.messages} message${p.messages === 1 ? '' : 's'}`);
        word.addEventListener('input', () => { go.disabled = word.value.trim() !== 'DELETE'; });
        go.addEventListener('click', async () => {
          go.disabled = true; go.textContent = 'Archiving, then deleting…';
          try {
            const r = await callApi('chatPurge', { session: ctx.session, ...filter(), confirm: 'DELETE' });
            out.replaceChildren(h('p', { class: 'notice' },
              `Deleted ${r.deleted} message${r.deleted === 1 ? '' : 's'} · ${r.files} file${r.files === 1 ? '' : 's'} moved to the Drive bin (30 days to restore)`,
              r.archiveRemoved ? ` · ${r.archiveRemoved} archive rows removed` : ' · archive kept',
              r.chatsRemoved ? ` · ${r.chatsRemoved} empty chat${r.chatsRemoved === 1 ? '' : 's'} removed` : '',
              r.more ? ` · ${r.more} more left: press Preview and Delete again.` : '. Logged in the archive "Deletion log".'));
          } catch (e) { out.replaceChildren(h('p', { class: 'notice error' }, errText(e))); }
        });
        out.replaceChildren(
          h('p', {}, h('b', {}, `${p.messages} message${p.messages === 1 ? '' : 's'}`), ` in ${p.chats} chat${p.chats === 1 ? '' : 's'}`,
            p.files ? `, ${p.files} with a photo / video / PDF` : '', ` · from ${fmt(p.oldest)} to ${fmt(p.newest)}`),
          h('p', { class: 'muted-sm' }, p.what),
          h('div', { class: 'ca-row' }, word, go));
      }
    } catch (e) { out.replaceChildren(h('p', { class: 'notice error' }, errText(e))); }
    preview.disabled = false;
  });
  return h('section', { class: 'ca-box' }, h('h2', { class: 'section-title' }, '🗑 Delete old chats'),
    h('p', {}, 'Frees space in Firestore. Choose at least one: a person, a chat, or dates. Nothing is deleted until you preview and type DELETE.'),
    h('div', { class: 'ca-grid' },
      h('label', { class: 'select' }, h('span', {}, 'Person (all their chats)'), person),
      h('label', { class: 'select' }, h('span', {}, 'Or one chat'), chatSel),
      h('label', { class: 'select' }, h('span', {}, 'From date'), from),
      h('label', { class: 'select' }, h('span', {}, 'To date'), to)),
    h('label', { class: 'ca-check' }, files, ' Also move their photos / videos / PDFs to the Drive bin'),
    h('label', { class: 'ca-check' }, arch, ' Also remove them from the archive spreadsheet (normally keep them)'),
    h('div', { class: 'ca-row' }, preview), out);
}

function auditBox(d, ctx, reload) {
  const a = d.audit;
  const box = h('section', { class: 'ca-box' }, h('h2', { class: 'section-title' }, '👁 Audit setting'),
    h('p', {}, a.on
      ? `ON since ${fmt(a.since)}. Admin, Owners and Managers can read chats sent after that time. Staff see a notice in Messages.`
      : 'OFF: chats are private between the two people. When turned ON, Admin, Owners and Managers can read chats sent from that moment on (never older ones), and every staff member sees a notice in Messages.'));
  if (d.isAdmin) {
    const btn = h('button', { type: 'button', class: a.on ? 'ca-danger' : 'btn-navy-solid' }, a.on ? 'Turn OFF' : 'Turn ON');
    btn.addEventListener('click', async () => {
      if (!a.on && !confirm('Turn ON chat audit? Staff will see a notice that Admin, Owners and Managers can read new chats.')) return;
      btn.disabled = true;
      try { await callApi('chatAuditSet', { session: ctx.session, on: !a.on }); reload(); }
      catch (e) { btn.disabled = false; alert(errText(e)); }
    });
    box.append(h('div', { class: 'ca-row' }, btn));
  }
  if (a.on) {
    const view = h('div', {}, loadingBox('Loading chats…'));
    box.append(view);
    callApi('auditChats', { session: ctx.session }).then((r) => {
      if (!r.chats.length) { view.replaceChildren(h('p', { class: 'empty' }, 'No chats since Audit was turned on.')); return; }
      view.replaceChildren(h('ul', { class: 'gs-list' }, r.chats.map((c) => h('li', {},
        h('button', { type: 'button', class: 'gs-row', onclick: () => openAudit(view, ctx, c) },
          h('span', { class: 'gs-main' }, h('b', {}, c.names.join(' – ')), h('span', { class: 'muted-sm' }, `Last: ${fmt(c.last.at)} by ${c.last.from}`)),
          h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))))));
    }).catch((e) => view.replaceChildren(h('p', { class: 'notice error' }, errText(e))));
  }
  return box;
}

function openAudit(view, ctx, c) {
  view.replaceChildren(loadingBox('Loading messages…'));
  callApi('auditThread', { session: ctx.session, chatId: c.id }).then((r) => {
    view.replaceChildren(
      h('div', { class: 'ca-row' }, h('b', {}, r.names.join(' – ')),
        h('button', { type: 'button', class: 'link-btn vs-close', onclick: () => renderChatAdmin(document.querySelector('.view'), ctx) }, 'Back')),
      h('p', { class: 'muted-sm' }, `Read-only. Showing messages sent since ${fmt(r.since)}.`),
      h('div', { class: 'msg-thread' }, ...(r.messages.length ? r.messages.map((m) => h('div', { class: 'msg-bubble' },
        h('div', { class: 'muted-sm' }, m.fromName),
        m.file ? h('div', { class: 'muted-sm' }, `📎 ${m.file.name || m.file.kind} (open from the chat files folder)`) : null,
        m.text ? h('div', { class: 'msg-text' }, m.text) : null,
        h('div', { class: 'msg-meta' }, fmt(m.at)))) : [h('p', { class: 'empty' }, 'No messages.')])));
  }).catch((e) => view.replaceChildren(h('p', { class: 'notice error' }, errText(e))));
}

function table(head, rows) {
  return h('div', { class: 'ca-table-wrap' }, h('table', { class: 'ca-table' },
    h('thead', {}, h('tr', {}, head.map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))));
}
