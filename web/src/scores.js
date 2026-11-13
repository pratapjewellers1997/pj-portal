import { h } from './dom.js';
import { loadWork, ymd, selectBox, loadingBox, ERRORS } from './workdata.js';
import { GOOD, OK, tone, pctOf, weeksEnding, weeksOfMonth, scoreRows, bestThisWeek } from './scoring.js';

// Scores page — one simple number per person per week:
//   Score = tasks done on time ÷ tasks that were due (higher is better).
// Period picker: last 8 weeks (with Earlier / Later), last 13 weeks, or one month.

const SESSION_ERRORS = ['session_expired', 'no_session', 'not_registered', 'inactive'];
const state = { period: '8w', offset: 0, month: '', type: '' };

function lastMonths(n) {
  const out = [], d = new Date();
  for (let i = 0; i < n; i++) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push([`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`,
      x.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })]);
  }
  return out;
}

function periodWeeks() {
  if (state.period === 'month') return weeksOfMonth(state.month);
  if (state.period === '13w') return weeksEnding(13, 0);
  return weeksEnding(8, state.offset * 8);
}

export function renderScores(root, ctx) {
  if (!state.month) state.month = lastMonths(1)[0][0];
  const weeks = periodWeeks();
  const start = weeks[0];
  const end = new Date(weeks[weeks.length - 1]); end.setDate(end.getDate() + 6);
  let within = null;
  if (state.period === 'month') {
    const [y, m] = state.month.split('-').map(Number);
    within = { from: new Date(y, m - 1, 1).getTime(), to: new Date(y, m, 0, 23, 59, 59).getTime() };
  }

  const rerender = () => renderScores(root, ctx);
  const picker = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Period' },
    [['8w', 'Last 8 weeks'], ['13w', 'Last 13 weeks'], ['month', 'Pick a month']].map(([id, label]) => h('button', {
      type: 'button', class: `chip${state.period === id ? ' on' : ''}`, 'aria-pressed': String(state.period === id),
      onclick: () => { state.period = id; state.offset = 0; rerender(); },
    }, label)));
  const nav = state.period === '8w' ? h('div', { class: 'period-nav' },
    h('button', { type: 'button', class: 'chip', onclick: () => { state.offset++; rerender(); } }, '← Earlier 8 weeks'),
    h('span', { class: 'muted-sm' }, `${fmt(start)} – ${fmt(end)}`),
    state.offset > 0 && h('button', { type: 'button', class: 'chip', onclick: () => { state.offset--; rerender(); } }, 'Later 8 weeks →'))
    : state.period === 'month' ? h('div', { class: 'period-nav' },
      h('select', { class: 'month-select', 'aria-label': 'Month', onchange: (e) => { state.month = e.target.value; rerender(); } },
        lastMonths(12).map(([v, t]) => h('option', { value: v, selected: v === state.month }, t))))
      : h('div', { class: 'period-nav' }, h('span', { class: 'muted-sm' }, `${fmt(start)} – ${fmt(end)}`));

  const body = h('div', { class: 'page-body' });
  root.replaceChildren(
    h('section', { class: 'page-head' },
      h('h1', {}, ctx.user.role === 'Doer' ? 'My scores' : 'Scores'),
      h('p', {}, 'How much of the work that was due got done on time. Higher is better.'),
      picker, nav),
    body);

  const old = start < new Date(Date.now() - 90 * 864e5);
  body.replaceChildren(loadingBox(old
    ? 'Reading older data from the sheets… this can take up to a minute the first time.'
    : 'Working out scores…'));

  loadWork(ctx.session, ymd(start), ymd(end))
    .then((data) => draw(body, data, weeks, within))
    .catch((e) => body.replaceChildren(h('div', { class: 'notice error' },
      h('p', {}, ERRORS[e.message] || 'Something went wrong. Please try again.'),
      SESSION_ERRORS.includes(e.message)
        ? h('button', { type: 'button', class: 'btn-navy', onclick: ctx.onSignOut }, 'Sign in again')
        : h('button', { type: 'button', class: 'btn-navy', onclick: rerender }, 'Try again'))));
}

function draw(body, data, weeks, within) {
  const rows = scoreRows(data, weeks, { type: state.type, within })
    .filter((r) => r.total.due)
    .sort((a, b) => pctOf(a.total) - pctOf(b.total));          // lowest first: who needs help
  const isDoer = data.scope === 'self';
  const thisWeekIdx = weeks.findIndex((w) => +w === +weeksEnding(1)[0]);

  const parts = [h('div', { class: 'filter-row' },
    selectBox('Count', [['', 'All work'], ['Checklist', 'Checklists only'], ['FMS', 'FMS only'], ['Delegation', 'Delegation only']],
      state.type, (v) => { state.type = v; draw(body, data, weeks, within); }))];

  // Best this week (only when the period includes this week)
  if (thisWeekIdx > -1 && !isDoer) {
    const best = bestThisWeek(rows, thisWeekIdx);
    parts.push(bestBox(best));
  }

  parts.push(h('div', { class: 'score-explain' },
    h('div', { class: 'score-formula' }, h('b', {}, 'Score'), ' = tasks done on time ÷ tasks that were due'),
    h('div', { class: 'legend' },
      h('span', { class: 'lg lg-good' }, `${GOOD}% and above`),
      h('span', { class: 'lg lg-ok' }, `${OK}–${GOOD - 1}%`),
      h('span', { class: 'lg lg-bad' }, `Below ${OK}%`),
      h('span', { class: 'muted-sm' }, '— no work was due'))));

  if (!rows.length) {
    parts.push(h('p', { class: 'empty' }, 'No work was due in this period.'));
  } else {
    const label = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    parts.push(h('div', { class: 'table-wrap' }, h('table', { class: 'data scores' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Name'),
        weeks.map((w, i) => h('th', {}, i === thisWeekIdx ? 'This week' : label(w))),
        h('th', {}, state.period === 'month' ? 'Month' : `${weeks.length} weeks`),
        h('th', {}, 'Change'))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('td', {}, h('a', { href: `#person/${encodeURIComponent(r.email)}`, class: 'name-link' }, r.name)),
        r.cells.map(scoreCell),
        scoreCell(r.total),
        h('td', { class: 'sc-change' }, changeText(r.change))))))));
    parts.push(h('p', { class: 'muted-sm' },
      'Big number = score, small = tasks done on time out of tasks due. Hover a box (on a computer) for late and not done. ' +
      '"This week" only counts work already due. Tap a name to open that person\'s profile.'));
  }
  body.replaceChildren(...parts.filter(Boolean));
}

export function scoreCell(c) {
  const v = pctOf(c);
  if (v == null) return h('td', { class: 'sc' }, '—');
  const detail = `${c.onTime} on time · ${c.late} late · ${c.missed} not done`;
  return h('td', { class: `sc sc-${tone(v)}`, title: detail, 'aria-label': `${v}%, ${detail}` },
    h('div', { class: 'sc-big' }, `${v}%`),
    h('div', { class: 'sc-small' }, `${c.onTime} of ${c.due}`));
}

export function changeText(change) {
  if (change == null) return '—';
  if (change > 0) return h('span', { class: 'up' }, `▲ +${change}`);
  if (change < 0) return h('span', { class: 'down' }, `▼ ${change}`);
  return h('span', { class: 'muted-sm' }, '= 0');
}

export function bestBox(best) {
  return h('section', { class: 'best' },
    h('div', { class: 'best-title' }, '🏆 Best this week'),
    best.length
      ? h('ul', { class: 'best-list' }, best.map((r, i) => h('li', {},
        h('span', { class: 'best-rank' }, i + 1),
        h('a', { href: `#person/${encodeURIComponent(r.email)}`, class: 'name-link' }, r.name),
        h('span', { class: 'best-score' }, `${r.pct}%`),
        h('span', { class: 'muted-sm' }, `${r.week.onTime} of ${r.week.due} on time`))))
      : h('p', { class: 'muted-sm' }, `Nobody has reached ${GOOD}% on time with at least 3 tasks due yet this week.`));
}

const fmt = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
