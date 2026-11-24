import { h } from './dom.js';
import { callApi } from './api.js';

// Notice board ("Got it") and Kudos wall.
// One "social" request loads both; posting, "Got it" and kudos are small writes.

let cache = null;
export function loadSocial(session, fresh = false) {
  if (fresh || !cache) cache = callApi('social', { session }).catch((e) => { cache = null; throw e; });
  return cache;
}

const ERR = {
  forbidden: 'Only Admin, Owners and Managers can do this.',
  missing_fields: 'Please fill in every field.',
  daily_limit: 'Daily limit reached. Please try again tomorrow.',
  not_yourself: 'You cannot appreciate yourself.',
  not_registered_person: 'That person is not in the staff list.',
  busy: 'The portal is busy. Please try again in a moment.',
};
const errText = (code) => ERR[code] || 'Something went wrong. Please try again.';
const when = (ms) => new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/* ================= Notice board ================= */

export function noticeBoard(ctx) {
  const box = h('section', { class: 'notices', 'aria-live': 'polite' });
  const draw = (d) => {
    const list = d.notices;
    const unread = list.filter((n) => !n.read).length;
    const showAll = box.dataset.all === '1';
    const shown = showAll ? list : list.slice(0, 3);
    box.replaceChildren(...[
      h('div', { class: 'nb-head' },
        h('strong', {}, '📢 Notice board'),
        unread ? h('span', { class: 'pill pill-red' }, `${unread} new`) : null,
        d.canPost && h('button', { type: 'button', class: 'nb-new', onclick: () => openForm(box, ctx, d, () => refresh(true)) }, '+ New notice')),
      list.length ? h('ul', { class: 'nb-list' }, shown.map((n) => noticeItem(n, ctx, () => refresh(true))))
        : h('p', { class: 'muted-sm' }, 'No notices right now.'),
      list.length > 3 && h('button', {
        type: 'button', class: 'toolbar-btn',
        onclick: () => { box.dataset.all = showAll ? '' : '1'; draw(d); },
      }, showAll ? 'Show fewer' : `Show all ${list.length}`)].filter(Boolean));
  };
  const refresh = (fresh) => loadSocial(ctx.session, fresh).then(draw).catch(() => box.remove());
  refresh(false);
  return box;
}

function noticeItem(n, ctx, refresh) {
  const err = h('span', { class: 'field-error dark', role: 'alert' });
  const gotIt = !n.read && h('button', {
    type: 'button', class: 'btn-gotit',
    onclick: async (e) => {
      e.target.disabled = true;
      try { await callApi('readNotice', { session: ctx.session, id: n.id }); refresh(); }
      catch (ex) { err.textContent = errText(ex.message); e.target.disabled = false; }
    },
  }, '✓ Got it');
  const remove = n.canRemove && h('button', {
    type: 'button', class: 'link-small',
    onclick: async (e) => {
      e.target.textContent = 'Taking down…'; e.target.disabled = true;
      try { await callApi('removeNotice', { session: ctx.session, id: n.id }); refresh(); }
      catch (ex) { err.textContent = errText(ex.message); e.target.disabled = false; e.target.textContent = 'Take down'; }
    },
  }, 'Take down');
  return h('li', { class: `nb-item${n.read ? ' is-read' : ''}${n.pinned ? ' is-pinned' : ''}` },
    h('div', { class: 'nb-top' },
      n.pinned && h('span', { class: 'pill pill-amber' }, 'Pinned'),
      h('span', { class: 'nb-title' }, n.title)),
    h('p', { class: 'nb-msg' }, n.message),
    h('div', { class: 'nb-meta' },
      `${n.byName} · ${when(n.at)}`,
      n.audience !== 'All' && ` · for ${n.audience === 'Doers' ? 'staff' : 'managers'}`,
      n.expires && ` · until ${new Date(n.expires + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}`),
    n.readers && h('details', { class: 'nb-receipts' },
      h('summary', {}, `Read by ${n.readers.length} of ${n.readers.length + n.notRead.length}`),
      n.notRead.length ? h('p', { class: 'muted-sm' }, `Not yet: ${n.notRead.join(', ')}`) : h('p', { class: 'muted-sm' }, 'Everyone has read it.')),
    h('div', { class: 'task-actions' }, gotIt, n.read && h('span', { class: 'mark-note' }, '✓ You read this'), remove, err));
}

function openForm(box, ctx, d, done) {
  if (box.querySelector('.nb-form')) return;
  const title = h('input', { type: 'text', maxlength: '100', placeholder: 'Title, e.g. Diwali store timing', 'aria-label': 'Title' });
  const msg = h('textarea', { rows: '4', maxlength: '1000', placeholder: 'Message for staff…', 'aria-label': 'Message' });
  const aud = h('select', { 'aria-label': 'Who should see it' },
    h('option', { value: 'All' }, 'Everyone'), h('option', { value: 'Doers' }, 'Staff (Doers) only'), h('option', { value: 'Managers' }, 'Managers and owners only'));
  const pin = h('input', { type: 'checkbox', id: 'nb-pin' });
  const exp = h('input', { type: 'date', 'aria-label': 'Show until (optional)' });
  const err = h('span', { class: 'field-error dark', role: 'alert' });
  [title, msg].forEach((i) => i.addEventListener('input', () => { err.textContent = ''; }));
  const form = h('div', { class: 'nb-form' },
    title, msg,
    h('div', { class: 'nb-form-row' },
      h('label', { class: 'select' }, h('span', {}, 'Who sees it'), aud),
      h('label', { class: 'select' }, h('span', {}, 'Show until (optional)'), exp)),
    h('label', { class: 'nb-check', for: 'nb-pin' }, pin, ' Pin to the top'),
    h('div', { class: 'task-actions' },
      h('button', {
        type: 'button', class: 'btn-navy-solid',
        onclick: async (e) => {
          if (!title.value.trim() || !msg.value.trim()) { err.textContent = 'Please add a title and a message.'; return; }
          e.target.disabled = true; e.target.textContent = 'Posting…';
          try {
            await callApi('postNotice', { session: ctx.session, title: title.value, message: msg.value, audience: aud.value, pinned: pin.checked, expires: exp.value });
            done();
          } catch (ex) { err.textContent = errText(ex.message); e.target.disabled = false; e.target.textContent = 'Post notice'; }
        },
      }, 'Post notice'),
      h('button', { type: 'button', class: 'link-small', onclick: () => form.remove() }, 'Cancel'),
      err));
  box.querySelector('.nb-head').after(form);
  title.focus();
}

/* ================= Kudos ================= */

/** Recent appreciation on the home page (everyone sees it). */
export function kudosWall(ctx) {
  const box = h('section', { class: 'kudos' });
  loadSocial(ctx.session).then((d) => {
    if (!d.kudos.length && !d.canPost) { box.remove(); return; }
    box.replaceChildren(
      h('div', { class: 'nb-head' }, h('strong', {}, '👏 Appreciation')),
      d.kudos.length ? h('ul', { class: 'kd-list' }, d.kudos.slice(0, 5).map(kudosItem))
        : h('p', { class: 'muted-sm' }, 'No appreciation yet. Open someone\'s profile and tap "Appreciate".'));
  }).catch(() => box.remove());
  return box;
}

function kudosItem(k) {
  return h('li', { class: 'kd-item' },
    h('div', {}, h('a', { href: `#person/${encodeURIComponent(k.to)}`, class: 'name-link' }, k.toName),
      h('span', { class: 'muted-sm' }, ` · from ${k.fromName} · ${when(k.at)}`)),
    h('p', { class: 'kd-msg' }, `“${k.message}”`));
}

/** On a profile: kudos received + "Appreciate" button for Admin/Owner/Manager. */
export function profileKudos(ctx, person) {
  const box = h('section', {});
  const draw = (d) => {
    const mine = d.kudos.filter((k) => person.emails.includes(k.to));
    const self = (ctx.user.emails || [ctx.user.email]).some((e) => person.emails.includes(e));
    const err = h('span', { class: 'field-error dark', role: 'alert' });
    const input = h('input', { type: 'text', maxlength: '200', placeholder: `What did ${person.name.split(' ')[0]} do well?`, 'aria-label': 'Appreciation message' });
    input.addEventListener('input', () => { err.textContent = ''; });
    const give = d.canPost && !self && h('div', { class: 'kd-give' }, input,
      h('button', {
        type: 'button', class: 'btn-navy-solid',
        onclick: async (e) => {
          if (!input.value.trim()) { err.textContent = 'Please write a short message.'; return; }
          e.target.disabled = true;
          try { await callApi('giveKudos', { session: ctx.session, to: person.email, message: input.value }); loadSocial(ctx.session, true).then(draw); }
          catch (ex) { err.textContent = errText(ex.message); e.target.disabled = false; }
        },
      }, '👏 Appreciate'), err);
    box.replaceChildren(...[
      h('h2', { class: 'section-title' }, `Appreciation · ${mine.length}`),
      give,
      mine.length ? h('ul', { class: 'kd-list' }, mine.slice(0, 20).map((k) => h('li', { class: 'kd-item' },
        h('p', { class: 'kd-msg' }, `“${k.message}”`),
        h('div', { class: 'muted-sm' }, `from ${k.fromName} · ${when(k.at)}`,
          k.canRemove && h('button', {
            type: 'button', class: 'link-small',
            onclick: async () => { try { await callApi('removeKudos', { session: ctx.session, id: k.id }); loadSocial(ctx.session, true).then(draw); } catch {} },
          }, ' · remove')))))
        : h('p', { class: 'muted-sm' }, 'No appreciation yet.')].filter(Boolean));
  };
  loadSocial(ctx.session).then(draw).catch(() => box.remove());
  return box;
}
