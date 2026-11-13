import { h } from './dom.js';
import { loadWork, ymd, selectBox, loadingBox, ERRORS } from './workdata.js';

// Scores page — one simple number per person per week:
//
//   Score = tasks done ON TIME ÷ tasks that were due × 100   (higher is better)
//
// "Due" = planned in that week (Monday–Sunday) and the planned time has passed.
// FMS steps, checklist tasks and delegated tasks all count.
// Delegation has no completion time: done without being shifted = on time.

const WEEKS = 8;
const GOOD = 90;   // green from here
const OK = 75;     // amber from here, red below
const tone = (v) => (v == null ? '' : v >= GOOD ? 'good' : v >= OK ? 'ok' : 'bad');
const SESSION_ERRORS = ['session_expired', 'no_session', 'not_registered', 'inactive'];
const state = { type: '' };

export function renderScores(root, ctx) {
  const body = h('div', { class: 'page-body' });
  root.replaceChildren(
    h('section', { class: 'page-head' },
      h('h1', {}, ctx.user.role === 'Doer' ? 'My scores' : 'Scores'),
      h('p', {}, 'How much of the work that was due got done on time. Higher is better.')),
    body);
  body.replaceChildren(loadingBox('Working out scores…'));

  const monday = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const start = monday(new Date()); start.setDate(start.getDate() - 7 * (WEEKS - 1));
  const end = new Date(start); end.setDate(end.getDate() + 7 * WEEKS - 1);
  const weeks = Array.from({ length: WEEKS }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + 7 * i); return d; });

  loadWork(ctx.session, ymd(start), ymd(end))
    .then((data) => draw(body, data, weeks))
    .catch((e) => body.replaceChildren(h('div', { class: 'notice error' },
      h('p', {}, ERRORS[e.message] || 'Something went wrong. Please try again.'),
      SESSION_ERRORS.includes(e.message)
        ? h('button', { type: 'button', class: 'btn-navy', onclick: ctx.onSignOut }, 'Sign in again')
        : h('button', { type: 'button', class: 'btn-navy', onclick: () => renderScores(root, ctx) }, 'Try again'))));
}

function draw(body, data, weeks) {
  const now = Date.now();
  const isDoer = data.scope === 'self';
  let tasks = data.tasks.filter((t) => !t.carry && t.planned <= now);   // only work that was already due
  if (state.type) tasks = tasks.filter((t) => t.type === state.type);

  const people = isDoer
    ? [{ email: data.user.email, name: data.user.name, emails: data.user.emails || [data.user.email] }]
    : (data.people || []).map((p) => ({ ...p, emails: [p.email] }));

  const weekOf = (ms) => {
    const i = Math.floor((ms - weeks[0].getTime()) / (7 * 864e5));
    return i >= 0 && i < weeks.length ? i : -1;
  };
  const blank = () => ({ due: 0, onTime: 0, late: 0, missed: 0 });
  const pctOf = (c) => (c.due ? Math.round((c.onTime / c.due) * 100) : null);

  const rows = people.map((p) => {
    const cells = weeks.map(blank);
    tasks.forEach((t) => {
      if (!t.who.some((e) => p.emails.includes(e))) return;
      const i = weekOf(t.planned); if (i < 0) return;
      const c = cells[i];
      c.due++;
      if (t.status === 'on_time') c.onTime++;
      else if (t.status === 'late' || t.status === 'done') c.late++;
      else c.missed++;
    });
    const total = cells.reduce((a, c) => ({ due: a.due + c.due, onTime: a.onTime + c.onTime, late: a.late + c.late, missed: a.missed + c.missed }), blank());
    // Change: latest week that had work vs the week with work before it
    const withWork = cells.map((c, i) => [i, pctOf(c)]).filter(([, v]) => v != null);
    const change = withWork.length > 1 ? withWork[withWork.length - 1][1] - withWork[withWork.length - 2][1] : null;
    return { ...p, cells, total, change };
  }).filter((r) => r.total.due)
    .sort((a, b) => pctOf(a.total) - pctOf(b.total));          // lowest score first: who needs help

  const label = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const parts = [h('div', { class: 'filter-row' },
    selectBox('Count', [['', 'All work'], ['Checklist', 'Checklists only'], ['FMS', 'FMS only'], ['Delegation', 'Delegation only']],
      state.type, (v) => { state.type = v; draw(body, data, weeks); }))];

  parts.push(h('div', { class: 'score-explain' },
    h('div', { class: 'score-formula' }, h('b', {}, 'Score'), ' = tasks done on time ÷ tasks that were due'),
    h('div', { class: 'legend' },
      h('span', { class: 'lg lg-good' }, `${GOOD}% and above`),
      h('span', { class: 'lg lg-ok' }, `${OK}–${GOOD - 1}%`),
      h('span', { class: 'lg lg-bad' }, `Below ${OK}%`),
      h('span', { class: 'muted-sm' }, '— no work was due'))));

  if (!rows.length) parts.push(h('p', { class: 'empty' }, 'No work was due in these weeks.'));
  else {
    const cell = (c) => {
      const v = pctOf(c);
      if (v == null) return h('td', { class: 'sc' }, '—');
      const detail = `${c.onTime} on time · ${c.late} late · ${c.missed} not done`;
      return h('td', { class: `sc sc-${tone(v)}`, title: detail, 'aria-label': `${v}%, ${detail}` },
        h('div', { class: 'sc-big' }, `${v}%`),
        h('div', { class: 'sc-small' }, `${c.onTime} of ${c.due}`));
    };
    parts.push(h('div', { class: 'table-wrap' }, h('table', { class: 'data scores' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Name'),
        weeks.map((w, i) => h('th', {}, i === weeks.length - 1 ? 'This week' : label(w))),
        h('th', {}, `${weeks.length} weeks`),
        h('th', {}, 'Change'))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('td', {}, r.name),
        r.cells.map(cell),
        cell(r.total),
        h('td', { class: 'sc-change' }, r.change == null ? '—'
          : r.change > 0 ? h('span', { class: 'up' }, `▲ +${r.change}`)
          : r.change < 0 ? h('span', { class: 'down' }, `▼ ${r.change}`)
          : h('span', { class: 'muted-sm' }, '= 0'))))))));
    parts.push(h('p', { class: 'muted-sm' },
      'Each box: big number = score, small = tasks done on time out of tasks due. Hover a box (on a computer) for late and not done. ' +
      '"This week" only counts work already due. "Change" compares the latest week with the week before it. ' +
      'Lowest scores are shown first.'));
  }
  body.replaceChildren(...parts);
}
