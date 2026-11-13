import { h } from './dom.js';
import { loadWork, ymd, selectBox, loadingBox, ERRORS } from './workdata.js';

// Scores page: weekly MIS scores per person, last 8 weeks (Monday to Sunday).
//   % Not done        = tasks planned in the week (already due) and still not done
//   % Not done on time = not done + done late
// Lower is better. Built from the same tasks as the Work page.

const WEEKS = 8;
const TONE = (v) => (v == null ? '' : v <= 10 ? 'good' : v <= 25 ? 'ok' : 'bad');
const SESSION_ERRORS = ['session_expired', 'no_session', 'not_registered', 'inactive'];
const state = { type: '' };

export function renderScores(root, ctx) {
  const body = h('div', { class: 'page-body' });
  root.replaceChildren(
    h('section', { class: 'page-head' },
      h('h1', {}, ctx.user.role === 'Doer' ? 'My scores' : 'Scores'),
      h('p', {}, `Weekly MIS score for the last ${WEEKS} weeks. Lower is better: green up to 10%, amber up to 25%.`)),
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

  const wkIndex = (ms) => {
    const i = Math.floor((ms - weeks[0].getTime()) / (7 * 864e5));
    return i >= 0 && i < weeks.length ? i : -1;
  };
  const rows = people.map((p) => {
    const cells = weeks.map(() => ({ planned: 0, notDone: 0, late: 0 }));
    tasks.forEach((t) => {
      if (!t.who.some((e) => p.emails.includes(e))) return;
      const i = wkIndex(t.planned); if (i < 0) return;
      const c = cells[i];
      c.planned++;
      if (t.status === 'overdue' || t.status === 'due') c.notDone++;
      if (t.status === 'late') c.late++;
    });
    const score = cells.map((c) => (c.planned
      ? { nd: Math.round((c.notDone / c.planned) * 100), nt: Math.round(((c.notDone + c.late) / c.planned) * 100), n: c.planned }
      : null));
    const total = cells.reduce((a, c) => ({ planned: a.planned + c.planned, notDone: a.notDone + c.notDone, late: a.late + c.late }),
      { planned: 0, notDone: 0, late: 0 });
    return { ...p, score, total };
  }).filter((r) => r.total.planned);

  const label = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const parts = [h('div', { class: 'filter-row' },
    selectBox('Count', [['', 'All work'], ['Checklist', 'Checklists only'], ['FMS', 'FMS only'], ['Delegation', 'Delegation only']],
      state.type, (v) => { state.type = v; draw(body, data, weeks); }))];

  if (!rows.length) parts.push(h('p', { class: 'empty' }, 'No work was due in these weeks.'));
  else {
    parts.push(h('div', { class: 'legend' },
      h('span', {}, h('b', {}, 'Top number'), ' % not done'),
      h('span', {}, h('b', {}, 'Bottom number'), ' % not done on time'),
      h('span', {}, h('b', {}, 'Colour'), ' follows the bottom number')));
    parts.push(h('div', { class: 'table-wrap' }, h('table', { class: 'data scores' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Trend'),
        weeks.map((w, i) => h('th', {}, i === weeks.length - 1 ? 'This week' : `W/c ${label(w)}`)), h('th', {}, `${weeks.length} weeks`))),
      h('tbody', {}, rows.map((r) => {
        const t = r.total;
        const tnd = t.planned ? Math.round((t.notDone / t.planned) * 100) : null;
        const tnt = t.planned ? Math.round(((t.notDone + t.late) / t.planned) * 100) : null;
        return h('tr', {},
          h('td', {}, r.name),
          h('td', {}, spark(r.score.map((s) => (s ? s.nt : null)))),
          r.score.map((s) => h('td', { class: `sc sc-${TONE(s && s.nt)}`, title: s ? `${s.n} tasks due` : 'No tasks due' },
            s ? [h('div', { class: 'sc-nd' }, `${s.nd}%`), h('div', { class: 'sc-nt' }, `${s.nt}%`)] : '—')),
          h('td', { class: `sc sc-${TONE(tnt)}` }, h('div', { class: 'sc-nd' }, `${tnd}%`), h('div', { class: 'sc-nt' }, `${tnt}%`)));
      })))));
    parts.push(h('p', { class: 'muted-sm' },
      'Counts every task that was due in that week (FMS steps, checklist tasks, delegated tasks). ' +
      'Delegation has no completion time, so a delegated task counts as late when it was shifted at least once.'));
  }
  body.replaceChildren(...parts);
}

/** Tiny trend line of "% not done on time" (lower is better). */
function spark(values) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return h('span', { class: 'muted-sm' }, '—');
  const w = 84, hgt = 26, n = values.length - 1;
  const xy = pts.map(([i, v]) => `${((i / n) * (w - 4) + 2).toFixed(1)},${(hgt - 2 - (v / 100) * (hgt - 4)).toFixed(1)}`);
  const last = pts[pts.length - 1][1], first = pts[0][1];
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`); svg.setAttribute('width', w); svg.setAttribute('height', hgt);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Trend from ${first}% to ${last}% not on time`);
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', xy.join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', last <= first ? '#2E7D46' : '#B23030');
  line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-linecap', 'round'); line.setAttribute('stroke-linejoin', 'round');
  svg.append(line);
  return svg;
}
