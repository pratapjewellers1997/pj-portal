import { h } from './dom.js';
import { callApi } from './api.js';
import { ymd, loadingBox, ERRORS } from './workdata.js';

// Insights page (Managers, Owners, Admin):
//  - Sales funnel from the MeCa enquiry FMS: enquiries -> visited -> converted
//  - Turnaround from FMS with a Kaarigar / Vendor: days to finish, late steps
//  - Work anniversaries this month

const SESSION_ERRORS = ['session_expired', 'no_session', 'not_registered', 'inactive'];
const PERIODS = [
  ['30d', 'Last 30 days', () => { const t = new Date(); const f = new Date(t); f.setDate(f.getDate() - 29); return [f, t]; }],
  ['90d', 'Last 90 days', () => { const t = new Date(); const f = new Date(t); f.setDate(f.getDate() - 89); return [f, t]; }],
  ['month', 'This month', () => { const t = new Date(); return [new Date(t.getFullYear(), t.getMonth(), 1), t]; }],
  ['lastmonth', 'Last month', () => { const t = new Date(); return [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)]; }],
];
const state = { period: '30d' };
const MEMO_TTL = 10 * 60 * 1000;
const memo = new Map();
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const fmtPct = (v) => (v == null ? '—' : `${v}%`);

/** Clear all cached state (call on sign-out). */
export function resetInsights() { memo.clear(); state.period = '30d'; }

export function renderInsights(root, ctx) {
  const body = h('div', { class: 'page-body' });
  root.replaceChildren(
    h('section', { class: 'page-head' },
      h('h1', {}, 'Insights'),
      h('p', {}, 'Sales conversion and turnaround, worked out from your FMS sheets.'),
      h('a', { href: '#vendors', class: 'vs-link' }, '⭐ Vendor scorecard →'),
      h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Period' }, PERIODS.map(([id, label]) => h('button', {
        type: 'button', class: `chip${state.period === id ? ' on' : ''}`, 'aria-pressed': String(state.period === id),
        onclick: () => { state.period = id; renderInsights(root, ctx); },
      }, label)))),
    body);

  const [f, t] = PERIODS.find((p) => p[0] === state.period)[2]();
  const key = `${ymd(f)}|${ymd(t)}`;
  body.replaceChildren(loadingBox('Working out insights…'));
  const cached = memo.get(key);
  if (!cached || Date.now() - cached.ts >= MEMO_TTL) {
    const p = callApi('insights', { session: ctx.session, from: ymd(f), to: ymd(t) }).catch((e) => { memo.delete(key); throw e; });
    memo.set(key, { p, ts: Date.now() });
  }
  memo.get(key).p
    .then((d) => draw(body, d))
    .catch((e) => body.replaceChildren(h('div', { class: 'notice error' },
      h('p', {}, e.message === 'forbidden' ? 'Insights are for managers and owners.' : ERRORS[e.message] || 'Something went wrong. Please try again.'),
      SESSION_ERRORS.includes(e.message)
        ? h('button', { type: 'button', class: 'btn-navy', onclick: ctx.onSignOut }, 'Sign in again')
        : h('button', { type: 'button', class: 'btn-navy', onclick: () => renderInsights(root, ctx) }, 'Try again'))));
}

function draw(body, d) {
  const parts = [];
  // Data period indicator
  {
    const [f, t] = PERIODS.find((p) => p[0] === state.period)[2]();
    const daysN = Math.round((t - f) / 864e5) + 1;
    const fmtD = (dt) => dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    parts.push(h('p', { class: 'analysis-hint' }, `Showing data from ${fmtD(f)} to ${fmtD(t)} ${t.getFullYear()} · ${daysN} calendar day${daysN !== 1 ? 's' : ''}`));
  }
  if (d.celebrations && d.celebrations.length) parts.push(celebrationsBox(d.celebrations));

  parts.push(h('h2', { class: 'section-title' }, 'Sales funnel'));
  if (!d.funnels.length) parts.push(h('p', { class: 'empty' }, 'No enquiries in this period.'));
  d.funnels.forEach((f) => parts.push(funnelCard(f)));

  parts.push(h('h2', { class: 'section-title' }, 'Turnaround'));
  if (!d.turnaround.length) parts.push(h('p', { class: 'empty' }, 'No repair or order work in this period.'));
  d.turnaround.forEach((t) => parts.push(turnaroundCard(t)));

  parts.push(h('p', { class: 'muted-sm' },
    'Sales funnel counts enquiries created in the period. "Converted" means a convert step was answered Yes; ' +
    '"Visited" means a visit step was answered Yes. Turnaround counts steps finished in the period; ' +
    '"Avg days" is from the item\'s first entry to its last finished step, for items fully finished in the period. ' +
    'Finished steps older than 3 months are not included.'));
  body.replaceChildren(...parts);
}

function funnelCard(f) {
  const stage = (label, n, of) => h('div', { class: 'fn-stage' },
    h('div', { class: 'fn-num' }, n == null ? '—' : n),
    h('div', { class: 'fn-label' }, label),
    of != null && n != null && h('div', { class: 'fn-pct' }, `${fmtPct(pct(n, of))} of enquiries`));
  const widths = [f.enquiries, f.visited, f.converted].filter((x) => x != null);
  const max = Math.max(1, ...widths);
  return h('article', { class: 'ins-card' },
    h('h3', {}, f.system),
    h('div', { class: 'fn-row' },
      stage('Enquiries', f.enquiries),
      f.visited != null && stage('Visited', f.visited, f.enquiries),
      f.converted != null && stage('Converted', f.converted, f.enquiries)),
    h('div', { class: 'fn-bars', 'aria-hidden': 'true' },
      [['Enquiries', f.enquiries], ['Visited', f.visited], ['Converted', f.converted]].filter(([, n]) => n != null).map(([l, n]) =>
        h('div', { class: 'fn-bar' }, h('span', { style: `width:${Math.max(3, (n / max) * 100)}%` }), h('em', {}, l)))),
    f.stages.length && h('details', { class: 'ins-more' },
      h('summary', {}, 'Each step'),
      table(['Step', 'Yes', 'No', 'Done', 'Waiting'],
        f.stages.map((s) => [s.name, s.yesNo ? s.yes : '—', s.yesNo ? s.no : '—', s.done, s.waiting]))),
    h('h4', {}, 'By salesperson'),
    table(['Name', 'Enquiries', f.converted != null ? 'Converted' : 'Visited', 'Rate'],
      f.byPerson.map((p) => {
        const n = f.converted != null ? p.converted : p.visited;
        return [p.name, p.enquiries, n, fmtPct(pct(n, p.enquiries))];
      })),
    h('h4', {}, 'By item asked for'),
    table(['Item', 'Enquiries', f.converted != null ? 'Converted' : 'Visited', 'Rate'],
      f.byType.map((p) => {
        const n = f.converted != null ? p.converted : p.visited;
        return [p.name, p.enquiries, n, fmtPct(pct(n, p.enquiries))];
      })));
}

function turnaroundCard(t) {
  return h('article', { class: 'ins-card' },
    h('h3', {}, t.system),
    h('div', { class: 'fn-row' },
      h('div', { class: 'fn-stage' }, h('div', { class: 'fn-num' }, t.completed), h('div', { class: 'fn-label' }, 'Finished')),
      h('div', { class: 'fn-stage' }, h('div', { class: 'fn-num' }, t.avgDays == null ? '—' : `${t.avgDays} d`), h('div', { class: 'fn-label' }, 'Avg days to finish'))),
    h('h4', {}, 'Steps'),
    table(['Step', 'On time', 'Avg late by', 'Overdue now'],
      t.steps.map((s) => [s.name, s.done ? `${fmtPct(pct(s.onTime, s.done))} (${s.onTime}/${s.done})` : '—',
        s.avgLateH == null ? '—' : hours(s.avgLateH), s.overdue]), (row) => (Number(row[3]) > 0 ? 3 : -1)),
    h('h4', {}, `By ${t.partner.toLowerCase()} (slowest first)`),
    table([t.partner, 'Finished', 'Avg days', 'On-time steps', 'Still open'],
      t.partners.map((p) => [p.name, p.completed, p.avgDays == null ? '—' : p.avgDays, p.done ? fmtPct(pct(p.onTime, p.done)) : '—', p.open])));
}

export function celebrationsBox(list) {
  return h('section', { class: 'best celebrate' },
    h('div', { class: 'best-title' }, '🎉 Work anniversaries this month'),
    h('ul', { class: 'best-list' }, list.map((c) => h('li', {},
      h('b', {}, c.name),
      h('span', {}, `${c.years} year${c.years === 1 ? '' : 's'} with Pratap Jewellers`),
      h('span', { class: c.today ? 'pill pill-green' : 'muted-sm' },
        c.today ? 'Today!' : new Date(c.date + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }))))));
}

function table(head, rows, warnCol) {
  if (!rows.length) return h('p', { class: 'muted-sm' }, 'Nothing to show.');
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))),
    h('tbody', {}, rows.map((r) => {
      const w = warnCol ? warnCol(r) : -1;
      return h('tr', {}, r.map((c, i) => h('td', { class: i === w ? 'num-red' : '' }, c)));
    }))));
}

function hours(hh) {
  if (hh < 48) return `${Math.round(hh)} h`;
  return `${Math.round(hh / 24)} days`;
}
