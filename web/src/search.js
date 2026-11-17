import { h } from './dom.js';
import { callApi } from './api.js';
import { loadWork, ymd, ERRORS } from './workdata.js';
import { setBoardQuery } from './board.js';

// Global search (Step 9): one box for everything.
//  - Systems and their sheets / dashboards / forms  (already on the phone, instant)
//  - Portal pages                                   (instant)
//  - People (Managers, Owners, Admin only)          (from today's work data, usually cached)
//  - Customers, orders, items and delegations       (the same "lookup" the Board uses)
// A Doer only gets their own customers / orders back: the API filters it.

const SESSION_ERRORS = ['session_expired', 'no_session', 'not_registered', 'inactive'];
const MAX_LINKS = 12;
const MAX_ITEMS = 8;

const PAGE_LIST = [
  { id: 'work', label: 'Work', desc: 'Tasks due, overdue and done', words: 'work task tasks due overdue pending done my work checklist fms delegation' },
  { id: 'board', label: 'Board', desc: 'Where every order stands, step by step', words: 'board steps order orders repair customer status kanban' },
  { id: 'scores', label: 'Scores', desc: 'Done on time %, week by week', words: 'scores score on time performance week weekly rank best' },
  { id: 'insights', label: 'Insights', desc: 'Sales funnel, turnaround, anniversaries', words: 'insights funnel sales enquiry conversion turnaround kaarigar karigar vendor anniversary', notFor: 'Doer' },
  { id: 'vendors', label: 'Vendor scorecard', desc: 'On-time delivery, delays and quality by vendor', words: 'vendor vendors supplier suppliers scorecard rating stars delivery delay quality' },
  { id: 'checklists', label: 'Staff checklists', desc: 'Leaving staff and new joiner checklists', words: 'leaving left resign exit offboarding joining joiner new joinee onboarding checklist access revoke', notFor: 'Doer' },
  { id: 'attendance', label: 'Attendance', desc: 'Check-in times, late days, monthly summary', words: 'attendance check in late present absent leave month summary' },
  { id: 'person/', label: 'My profile', desc: 'Your score trend, open tasks and appreciation', words: 'profile me my kudos appreciation' },
];

const lookups = new Map(); // query -> promise, kept for this visit
let timer = null;
let token = 0;

export function renderSearch(root, ctx, q0 = '') {
  const input = h('input', {
    class: 'search gs-input', type: 'search', value: q0, autocomplete: 'off', enterkeyhint: 'search',
    placeholder: 'Customer, order no., person, system…', 'aria-label': 'Search everything',
  });
  const out = h('div', { class: 'gs-results', 'aria-live': 'polite' });
  root.replaceChildren(
    h('section', { class: 'page-head' },
      h('h1', {}, 'Search'),
      h('p', {}, ctx.user.role === 'Doer'
        ? 'Find your customers, orders, systems and sheets.'
        : 'Find customers, orders, people, systems and sheets in one place.'),
      input),
    h('div', { class: 'page-body' }, out));

  const run = () => {
    const q = input.value.trim();
    history.replaceState(null, '', q ? `#search/${encodeURIComponent(q)}` : '#search');
    draw(out, ctx, q);
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 450); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); run(); input.blur(); } });
  run();
  if (!q0) setTimeout(() => input.focus(), 0);
}

function draw(out, ctx, q) {
  const my = ++token;
  if (!q) {
    out.replaceChildren(h('div', { class: 'gs-tips' },
      h('p', {}, 'Try:'),
      h('ul', {},
        h('li', {}, 'a customer name, e.g. ', h('i', {}, 'Ritesh')),
        h('li', {}, 'an order or repair number, e.g. ', h('i', {}, 'RPR-2611')),
        ctx.user.role !== 'Doer' ? h('li', {}, 'a person, e.g. ', h('i', {}, 'Babu')) : null,
        h('li', {}, 'a system or sheet, e.g. ', h('i', {}, 'Repair'), ' or ', h('i', {}, 'checklist')))));
    return;
  }
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const has = (hay) => { const s = hay.toLowerCase(); return words.every((w) => s.includes(w)); };

  const peopleBox = h('div');
  const itemsBox = h('div');
  const systemsBox = systemsSection(ctx, has);
  const pagesBox = pagesSection(ctx, has);
  const empty = h('p', { class: 'empty', hidden: true }, `Nothing found for “${q}”.`);
  out.replaceChildren(peopleBox, itemsBox, systemsBox || '', pagesBox || '', empty);

  let pending = 0;
  const settle = () => {
    if (my !== token || --pending > 0) return;
    const any = systemsBox || pagesBox || peopleBox.childNodes.length || itemsBox.querySelector('.gs-item');
    empty.hidden = Boolean(any);
  };

  // People: only Managers, Owners and Admin get the staff list from the API.
  if (ctx.user.role !== 'Doer') {
    pending++;
    const today = ymd(new Date());
    loadWork(ctx.session, today, today).then((d) => {
      if (my !== token) return;
      const hits = (d.people || []).filter((p) => has(`${p.name} ${p.designation || ''} ${p.role} ${p.email}`)).slice(0, 8);
      if (hits.length) {
        peopleBox.replaceChildren(section('People', hits.length, h('ul', { class: 'gs-list' }, hits.map((p) => h('li', {},
          h('a', { href: `#person/${encodeURIComponent(p.email)}`, class: 'gs-row' },
            h('span', { class: 'gs-avatar', 'aria-hidden': 'true' }, initials(p.name)),
            h('span', { class: 'gs-main' }, h('b', {}, p.name), h('span', { class: 'muted-sm' }, p.designation || p.email)),
            h('span', { class: `role role-${String(p.role).toLowerCase()}` }, p.role)))))));
      }
    }).catch(() => {}).finally(settle);
  }

  // Customers, orders, items, delegations: needs at least 2 letters.
  if (q.length >= 2) {
    pending++;
    itemsBox.replaceChildren(section('Customers & orders', null, h('p', { class: 'muted-sm' }, 'Searching…')));
    const key = q.toLowerCase();
    if (!lookups.has(key)) {
      lookups.set(key, callApi('lookup', { session: ctx.session, q }).catch((e) => { lookups.delete(key); throw e; }));
    }
    lookups.get(key).then((d) => {
      if (my !== token) return;
      if (!d.items.length) { itemsBox.replaceChildren(); return; }
      itemsBox.replaceChildren(section('Customers & orders', d.total,
        h('ul', { class: 'gs-list' }, d.items.slice(0, MAX_ITEMS).map((it) => h('li', { class: 'gs-item' },
          h('button', { type: 'button', class: 'gs-row', onclick: () => openOnBoard(it.key) },
            h('span', { class: 'gs-main' },
              h('b', {}, it.label || it.key),
              h('span', { class: 'muted-sm' }, `${it.system}${it.label && it.key !== it.label ? ' · ' + it.key : ''}`)),
            it.open ? h('span', { class: 'pill pill-amber' }, `${it.open} open`) : h('span', { class: 'pill pill-green' }, 'Complete'),
            h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))))),
        d.total > MAX_ITEMS
          ? h('button', { type: 'button', class: 'link-btn gs-more', onclick: () => openOnBoard(q) }, `See all ${d.total} on the Board →`)
          : null));
    }).catch((e) => {
      if (my !== token) return;
      itemsBox.replaceChildren(section('Customers & orders', null, h('div', { class: 'notice error' },
        h('p', {}, ERRORS[e.message] || 'Could not search orders right now.'),
        SESSION_ERRORS.includes(e.message)
          ? h('button', { type: 'button', class: 'btn-navy', onclick: ctx.onSignOut }, 'Sign in again')
          : null)));
    }).finally(settle);
  }
  if (!pending) { pending = 1; settle(); }
}

function systemsSection(ctx, has) {
  const hits = [];
  ctx.systems.forEach((s) => {
    const sysHit = has(`${s.name} ${s.group} ${s.purpose || ''} ${s.task || ''}`);
    s.links.forEach((l) => { if (sysHit || has(`${s.name} ${l.label} ${l.type}`)) hits.push([s, l]); });
  });
  if (!hits.length) return null;
  return section('Systems & sheets', hits.length,
    h('ul', { class: 'links gs-links' }, hits.slice(0, MAX_LINKS).map(([s, l]) => h('li', {},
      ctx.linkButton(s, l), h('div', { class: 'gs-sys muted-sm' }, s.name)))),
    hits.length > MAX_LINKS ? h('p', { class: 'muted-sm' }, `Showing ${MAX_LINKS} of ${hits.length}. Type more to narrow it down.`) : null);
}

function pagesSection(ctx, has) {
  const hits = PAGE_LIST.filter((p) => p.notFor !== ctx.user.role && has(`${p.label} ${p.words}`));
  if (!hits.length) return null;
  return section('Pages', null, h('ul', { class: 'gs-list' }, hits.map((p) => h('li', {},
    h('a', { href: `#${p.id}`, class: 'gs-row' },
      h('span', { class: 'gs-main' }, h('b', {}, p.label), h('span', { class: 'muted-sm' }, p.desc)),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))))));
}

function section(title, count, ...body) {
  return h('section', { class: 'gs-section' },
    h('h2', { class: 'section-title' }, title, count != null ? h('span', { class: 'count' }, count) : null),
    ...body);
}

function openOnBoard(q) {
  setBoardQuery(q);
  location.hash = '#board';
}

function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}
