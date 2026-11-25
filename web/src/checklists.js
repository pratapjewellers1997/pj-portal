import { h, safeUrl } from './dom.js';
import { callApi } from './api.js';
import { fmtDateTime, loadingBox, ERRORS } from './workdata.js';

// Leaving staff + New joiner checklists (Step 12). Admin, Owners and Managers.
// Automatic checks come from the portal's data (read-only); "your items" come
// from the Registry tab "Portal Checklist Items" and are ticked here.

const SESSION_ERRORS = ['session_expired', 'no_session', 'not_registered', 'inactive'];
const MEMO_TTL = 10 * 60 * 1000;
let memo = null;
let memoTs = 0;
const open = new Set();   // cards the user expanded

export function resetChecklists() { memo = null; memoTs = 0; open.clear(); saving = Promise.resolve(); }

const load = (session, fresh) => {
  if (fresh || !memo || Date.now() - memoTs >= MEMO_TTL) {
    memo = callApi('checklists', { session }).catch((e) => { memo = null; throw e; });
    memoTs = Date.now();
  }
  return memo;
};

/** Home line for Admin / Owner / Manager when a checklist is still open. */
export function checklistLine(ctx) {
  const box = h('a', { href: '#checklists', class: 'kg-line', hidden: true });
  load(ctx.session).then((d) => {
    const l = d.leaving.filter((x) => !x.complete).length, j = d.joining.filter((x) => !x.complete).length;
    if (!l && !j) return;
    box.replaceChildren(
      h('span', { class: 'kg-ico', 'aria-hidden': 'true' }, '📋'),
      h('span', { class: 'kg-text' }, h('b', {}, 'Staff checklists'),
        h('span', {}, [l ? ` · 🚪 ${l} leaving` : '', j ? ` · 🆕 ${j} new joiner${j === 1 ? '' : 's'}` : ''].join(''))),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
    box.hidden = false;
  }).catch(() => box.remove());
  return box;
}

export function renderChecklists(root, ctx) {
  const body = h('div', { class: 'page-body' }, loadingBox('Loading checklists…'));
  root.replaceChildren(
    h('section', { class: 'page-head' },
      h('h1', {}, '📋 Staff checklists'),
      h('p', {}, 'Everything to finish when someone leaves or joins. Ticks are saved with who and when.')),
    body);
  load(ctx.session).then((d) => draw(body, d, ctx)).catch((e) => body.replaceChildren(h('div', { class: 'notice error' },
    h('p', {}, e.message === 'forbidden' ? 'Checklists are for Admin, Owners and Managers.' : ERRORS[e.message] || 'Could not load checklists.'),
    SESSION_ERRORS.includes(e.message)
      ? h('button', { type: 'button', class: 'btn-navy', onclick: ctx.onSignOut }, 'Sign in again')
      : h('button', { type: 'button', class: 'btn-navy', onclick: () => { memo = null; renderChecklists(root, ctx); } }, 'Try again'))));
}

function draw(body, d, ctx) {
  const redraw = (fresh) => load(ctx.session, fresh).then((nd) => draw(body, nd, ctx));
  redraw.local = () => draw(body, d, ctx);   // re-draw from what is on screen, no server call
  const section = (title, list, empty) => {
    const live = list.filter((x) => !x.complete), done = list.filter((x) => x.complete);
    return h('section', { class: 'cl-section' },
      h('h2', { class: 'section-title' }, title, h('span', { class: 'count' }, live.length)),
      live.length ? h('div', { class: 'cl-list' }, live.map((p) => personCard(p, ctx, redraw))) : h('p', { class: 'empty' }, empty),
      done.length ? h('details', { class: 'cl-done' },
        h('summary', {}, `Completed (${done.length})`),
        h('div', { class: 'cl-list' }, done.map((p) => personCard(p, ctx, redraw)))) : null);
  };
  body.replaceChildren(
    section('🚪 Leaving', d.leaving, 'No one is leaving. Set Active = No in the Registry People tab, or start one below for someone on notice.'),
    section('🆕 New joiners', d.joining, 'No new joiners in the last 45 days.'),
    ...[startBox(d, ctx, redraw)].filter(Boolean),
    h('p', { class: 'muted-sm' },
      'To change your items, edit the Registry tab "Portal Checklist Items" (Checklist = Leaving or Joining). ',
      'Automatic checks update every 10 minutes; Drive access updates after the Registry sharing check',
      d.sharingCheckedAt ? ` (last: ${d.sharingCheckedAt}).` : '.'));
}

function personCard(p, ctx, redraw) {
  const id = `${p.list}|${p.email}`;
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  const details = h('details', { class: 'cl-card', open: open.has(id) ? true : null,
    ontoggle: (e) => { if (e.target.open) open.add(id); else open.delete(id); } },
    h('summary', {},
      h('div', { class: 'cl-head' },
        h('div', {}, h('b', {}, p.name), h('span', { class: 'muted-sm' }, ` ${p.designation || p.role}`)),
        h('span', { class: `pill pill-${p.complete ? 'green' : pct >= 50 ? 'amber' : 'red'}` }, `${p.done}/${p.total}`)),
      h('div', { class: 'cl-bar', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' },
        h('span', { style: `width:${pct}%` })),
      h('div', { class: 'muted-sm' }, [
        p.doj ? `Joined ${fmtDay(p.doj)}` : '',
        p.list === 'Leaving' ? (p.active ? 'Still Active (on notice)' : 'Active = No') : '',
        p.startedBy ? `Started by ${p.startedBy}` : ''].filter(Boolean).join(' · '))),
    h('h3', { class: 'cl-sub' }, 'Automatic checks'),
    h('ul', { class: 'cl-items' }, p.auto.map((a) => autoRow(a))),
    p.items.length ? h('h3', { class: 'cl-sub' }, 'Your items') : null,
    p.items.length ? h('ul', { class: 'cl-items' }, p.items.map((it) => itemRow(p, it, ctx, redraw))) : null,
    p.startedBy ? h('button', { type: 'button', class: 'link-btn vs-close cl-stop',
      onclick: async (e) => {
        e.target.disabled = true;
        try { await callApi('tickChecklist', { session: ctx.session, list: p.list, email: p.email, item: '__start__', done: false }); redraw(true); }
        catch (err) { e.target.disabled = false; alert(ERRORS[err.message] || 'Could not save.'); }
      } }, p.active && p.list === 'Leaving' ? 'Cancel this leaving checklist' : 'Remove from this list') : null);
  return details;
}

function autoRow(a) {
  const extra = [];
  if (a.groups && a.groups.length) {
    extra.push(h('ul', { class: 'cl-sublist' }, a.groups.map((g) => h('li', {},
      h('b', {}, `${g.system}: ${g.count}`),
      h('ul', {}, g.rows.map((r) => {
        const url = safeUrl(r.url);
        return h('li', {}, url ? h('a', { href: url, target: '_blank', rel: 'noopener' }, r.label || '—') : (r.label || '—'),
          h('span', { class: 'muted-sm' }, ` · ${r.step || ''}${r.planned ? ' · ' + fmtDateTime(r.planned) : ''}`));
      }), g.count > g.rows.length ? h('li', { class: 'muted-sm' }, `…and ${g.count - g.rows.length} more`) : null)))));
  }
  if (a.files && a.files.length) {
    extra.push(h('ul', { class: 'cl-sublist' }, a.files.map((f) => h('li', {},
      h('a', { href: `https://drive.google.com/open?id=${encodeURIComponent(f.id)}`, target: '_blank', rel: 'noopener' }, f.name || f.id, ' ↗'),
      h('span', { class: `muted-sm${/owner/i.test(f.role) ? ' warn' : ''}` },
        ` · ${f.role}${f.systems ? ' · ' + f.systems : ''}${f.status ? ' · ' + f.status : ''}${/yes/i.test(f.inherited || '') ? ' · from a folder' : ''}`)))));
  }
  return h('li', { class: `cl-row${a.done ? ' ok' : ''}` },
    h('span', { class: 'cl-mark', 'aria-hidden': 'true' }, a.done ? '✅' : '⏳'),
    h('div', { class: 'cl-text' }, h('span', {}, a.label),
      a.detail ? h('span', { class: 'muted-sm' }, a.detail) : null, ...extra));
}

// Ticks show at once and are saved in the background, one after another.
let saving = Promise.resolve();

function applyTick(p, it, done, by, at) {
  if (it.done !== done) p.done += done ? 1 : -1;
  it.done = done; it.by = done ? by : ''; it.at = done ? at : null;
  p.complete = p.done === p.total ? 1 : 0;
}

function itemRow(p, it, ctx, redraw) {
  const btn = h('button', {
    type: 'button', class: `cl-check${it.done ? ' on' : ''}${it.saving ? ' saving' : ''}`, role: 'checkbox', 'aria-checked': String(it.done),
    'aria-label': it.item,
    onclick: () => {
      const before = { done: it.done, by: it.by, at: it.at };
      const want = !it.done;
      applyTick(p, it, want, ctx.user.name, Date.now());
      it.saving = true;
      open.add(`${p.list}|${p.email}`);
      redraw.local();
      saving = saving.then(() => callApi('tickChecklist', { session: ctx.session, list: p.list, email: p.email, item: it.item, done: want }))
        .then((r) => { it.saving = false; if (r && r.at && it.done) it.at = r.at; redraw.local(); })
        .catch((err) => {
          it.saving = false;
          applyTick(p, it, before.done, before.by, before.at);
          redraw.local();
          alert(`${ERRORS[err.message] || 'Could not save.'} "${it.item}" was not changed. Please try again.`);
        });
    },
  }, it.done ? '✓' : '');
  return h('li', { class: `cl-row${it.done ? ' ok' : ''}` }, btn,
    h('div', { class: 'cl-text' }, h('span', {}, it.item),
      h('span', { class: 'muted-sm' }, [it.who ? `Who: ${it.who}` : '', it.done && it.by ? `Done by ${it.by}${it.at ? ' · ' + fmtDateTime(it.at) : ''}` : '', it.saving ? 'Saving…' : ''].filter(Boolean).join(' · '))));
}

function startBox(d, ctx, redraw) {
  const onList = new Set([...d.leaving, ...d.joining].map((p) => p.email));
  const choices = d.people.filter((p) => !onList.has(p.email));
  if (!choices.length) return null;
  const sel = h('select', { 'aria-label': 'Person' }, h('option', { value: '' }, 'Choose a person…'),
    choices.map((p) => h('option', { value: p.email }, `${p.name}${p.designation ? ' · ' + p.designation : ''}`)));
  const go = (list) => async (e) => {
    if (!sel.value) { sel.focus(); return; }
    e.target.disabled = true;
    try { await callApi('tickChecklist', { session: ctx.session, list, email: sel.value, item: '__start__', done: true }); redraw(true); }
    catch (err) { e.target.disabled = false; alert(ERRORS[err.message] || 'Could not start.'); }
  };
  return h('section', { class: 'cl-start' },
    h('h2', { class: 'section-title' }, 'Start a checklist by hand'),
    h('p', { class: 'muted-sm' }, 'For someone on notice period (before Active = No), or a joiner without a joining date in EMPLOYEES.'),
    h('div', { class: 'cl-start-row' }, h('label', { class: 'select' }, h('span', {}, 'Person'), sel),
      h('button', { type: 'button', class: 'btn-ghost-dark', onclick: go('Leaving') }, '🚪 Start leaving'),
      h('button', { type: 'button', class: 'btn-ghost-dark', onclick: go('Joining') }, '🆕 Start joining')));
}

function fmtDay(k) {
  return new Date(`${k}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}
