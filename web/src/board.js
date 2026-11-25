import { h, safeUrl } from './dom.js';
import { callApi } from './api.js';
import { karigarSection } from './karigar.js';
import { loadWork, ymd, selectBox, fmtDateTime, loadingBox, ERRORS, markButton } from './workdata.js';

// Board page:
//  1. Find a customer / order / item across every FMS and the Delegation Sheet.
//  2. One FMS as columns (one per step) with the items waiting at each step.

const SESSION_ERRORS = ['session_expired', 'no_session', 'not_registered', 'inactive'];
const STATUS = {
  overdue: ['Overdue', 'red'], due: ['Due', 'amber'], on_time: ['Done on time', 'green'],
  late: ['Done late', 'orange'], done: ['Done', 'gray'],
};
const state = { system: '', q: '' };

export function resetBoard() { state.system = ''; state.q = ''; }

/** Used by Search: open the Board with this customer / order already looked up. */
export function setBoardQuery(q) { state.q = String(q || ''); }

export function renderBoard(root, ctx) {
  const results = h('div', { class: 'lookup-results', 'aria-live': 'polite' });
  const input = h('input', {
    class: 'search', type: 'search', value: state.q, autocomplete: 'off',
    placeholder: 'Find a customer, order number or item…', 'aria-label': 'Find a customer or order',
    onkeydown: (e) => { if (e.key === 'Enter') runLookup(); },
  });
  const err = h('span', { class: 'field-error', role: 'alert' });
  input.addEventListener('input', () => { err.textContent = ''; });
  const runLookup = () => {
    const q = input.value.trim();
    if (q.length < 2) { err.textContent = 'Type at least 2 letters.'; return; }
    state.q = q;
    lookup(results, ctx, q);
  };
  const body = h('div', { class: 'page-body' });
  root.replaceChildren(
    h('section', { class: 'page-head' },
      h('h1', {}, 'Board'),
      h('p', {}, 'Where every order stands, step by step.'),
      h('a', { href: '#vendors', class: 'vs-link' }, '⭐ Vendor scorecard →'),
      h('div', { class: 'lookup-bar' }, input,
        h('button', { type: 'button', class: 'btn-navy', onclick: runLookup }, 'Find')),
      err),
    h('div', { class: 'page-body' }, results),
    body,
    h('div', { class: 'page-body' }, karigarSection(ctx)));
  if (state.q) lookup(results, ctx, state.q);

  body.replaceChildren(loadingBox('Loading board…'));
  const today = new Date();
  const to = new Date(today); to.setDate(to.getDate() + 30);
  loadWork(ctx.session, ymd(today), ymd(to))
    .then((data) => drawBoard(body, data))
    .catch((e) => body.replaceChildren(errorBox(e.message, ctx, () => renderBoard(root, ctx))));
}

/* ---------- Search ---------- */

function lookup(box, ctx, q) {
  box.replaceChildren(loadingBox(`Searching for “${q}”…`));
  callApi('lookup', { session: ctx.session, q })
    .then((d) => {
      if (!d.items.length) { box.replaceChildren(h('p', { class: 'empty' }, `Nothing found for “${q}”.`)); return; }
      const nameOf = (e) => d.names[e] || e;
      box.replaceChildren(
        h('p', { class: 'muted-sm' }, `${d.total} found${d.total > d.items.length ? `, showing the first ${d.items.length}` : ''}`),
        h('div', { class: 'lookup-list' }, d.items.map((it) => h('article', { class: 'lookup-item' },
          h('div', { class: 'lookup-head' },
            h('strong', {}, it.label || it.key),
            h('span', { class: 'muted-sm' }, `${it.system}${it.label && it.key !== it.label ? ' · ' + it.key : ''}`),
            it.open ? h('span', { class: 'pill pill-amber' }, `${it.open} open`) : h('span', { class: 'pill pill-green' }, 'Complete')),
          h('ol', { class: 'timeline' }, it.steps.map((s) => {
            const [label, tone] = STATUS[s.status];
            const url = safeUrl(s.url);
            return h('li', { class: `tl tl-${tone}` },
              h('div', { class: 'tl-top' }, h('span', { class: 'tl-step' }, s.task), h('span', { class: `pill pill-${tone}` }, label)),
              h('div', { class: 'task-meta' }, `Planned ${fmtDateTime(s.planned)}${s.actual ? ' · Done ' + fmtDateTime(s.actual) : ''}`),
              s.who.length ? h('div', { class: 'task-who' }, s.who.map(nameOf).join(', ')) : null,
              h('div', { class: 'task-actions' },
                markButton({ ...s, sys: it.sys, key: it.key }),
                url && h('a', { class: 'task-open', href: url, target: '_blank', rel: 'noopener' }, 'Open in sheet ↗')));
          }))))),
        h('p', { class: 'muted-sm' }, 'Finished steps older than 3 months are not shown here.'));
    })
    .catch((e) => box.replaceChildren(errorBox(e.message, ctx, () => lookup(box, ctx, q))));
}

/* ---------- Board ---------- */

function drawBoard(body, data) {
  const open = data.tasks.filter((t) => t.type === 'FMS' && (t.status === 'overdue' || t.status === 'due'));
  const bySys = new Map();
  open.forEach((t) => { const r = bySys.get(t.sys) || { name: t.system, n: 0 }; r.n++; bySys.set(t.sys, r); });
  const systems = [...bySys.entries()].sort((a, b) => b[1].n - a[1].n);
  if (!systems.length) { body.replaceChildren(h('p', { class: 'empty' }, 'No open FMS steps right now.')); return; }
  if (!bySys.has(state.system)) state.system = systems[0][0];

  const names = data.names || {};
  const tasks = open.filter((t) => t.sys === state.system);
  const cols = new Map();
  tasks.forEach((t) => {
    const k = `${t.step == null ? 99 : t.step}|${t.task}`;
    if (!cols.has(k)) cols.set(k, { step: t.step == null ? 99 : t.step, name: t.task, items: [] });
    cols.get(k).items.push(t);
  });
  const columns = [...cols.values()].sort((a, b) => a.step - b.step);
  columns.forEach((c) => c.items.sort((a, b) => a.planned - b.planned));
  const overdueN = tasks.filter((t) => t.status === 'overdue').length;

  body.replaceChildren(
    h('h2', { class: 'section-title' }, 'Steps board'),
    h('div', { class: 'filter-row' },
      selectBox('FMS', systems.map(([id, r]) => [id, `${r.name} (${r.n} open)`]), state.system,
        (v) => { state.system = v; drawBoard(body, data); })),
    h('p', { class: 'muted-sm' }, `${tasks.length} open steps · ${overdueN} overdue · oldest first in each column`),
    h('div', { class: 'board', role: 'list' }, columns.map((c) => h('section', { class: 'col', role: 'listitem' },
      h('header', { class: 'col-head' },
        h('span', { class: 'col-name' }, c.name),
        h('span', { class: `col-count${c.items.some((t) => t.status === 'overdue') ? ' has-overdue' : ''}` }, c.items.length)),
      h('div', { class: 'col-body' }, c.items.map((t) => {
        const url = safeUrl(t.url);
        return h('article', { class: `bcard ${t.status === 'overdue' ? 'is-overdue' : ''}` },
          h('div', { class: 'bcard-title' }, t.label || t.key),
          t.label && t.key !== t.label && h('div', { class: 'muted-sm' }, t.key),
          h('div', { class: 'task-meta' }, `${t.status === 'overdue' ? 'Overdue since' : 'Due'} ${fmtDateTime(t.planned)}`),
          t.who.length ? h('div', { class: 'task-who' }, t.who.map((e) => names[e] || e).join(', '))
            : h('div', { class: 'task-who warn' }, 'Not assigned'),
          h('div', { class: 'task-actions' },
            markButton(t),
            url && h('a', { class: 'task-open', href: url, target: '_blank', rel: 'noopener' }, 'Sheet ↗')));
      })))).filter(Boolean)));
}

function errorBox(code, ctx, retry) {
  return h('div', { class: 'notice error' },
    h('p', {}, ERRORS[code] || (code === 'query_too_short' ? 'Type at least 2 letters.' : 'Something went wrong. Please try again.')),
    SESSION_ERRORS.includes(code)
      ? h('button', { type: 'button', class: 'btn-navy', onclick: ctx.onSignOut }, 'Sign in again')
      : h('button', { type: 'button', class: 'btn-navy', onclick: retry }, 'Try again'));
}
