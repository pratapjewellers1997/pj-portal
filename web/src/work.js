import { h, safeUrl } from './dom.js';
import {
  loadWork, dateBar, selectBox, tile, fmtDateTime, pct, presetRange, loadingBox, ERRORS, markButton,
} from './workdata.js';

// Work page: tasks from every FMS, both checklists and the Delegation Sheet.
// Doer: own tasks. Manager / Owner / Admin: everyone, with person + system filters.

const STATUS = {
  overdue: { label: 'Overdue', tone: 'red' },
  due: { label: 'Due', tone: 'amber' },
  on_time: { label: 'Done on time', tone: 'green' },
  late: { label: 'Done late', tone: 'orange' },
  done: { label: 'Done', tone: 'gray' },
};
const STATUS_FILTERS = [['all', 'All'], ['overdue', 'Overdue'], ['due', 'Due'], ['on_time', 'On time'], ['late', 'Late']];
const SESSION_ERRORS = ['session_expired', 'no_session', 'not_registered', 'inactive'];

const state = { preset: 'week', ...presetRange('week'), person: '', system: '', status: 'all', doneShown: 30 };

export function renderWork(root, ctx) {
  const isDoer = ctx.user.role === 'Doer';
  const body = h('div', { class: 'page-body' });
  root.replaceChildren(
    h('section', { class: 'page-head' },
      h('h1', {}, isDoer ? 'My work' : 'Work'),
      h('p', {}, isDoer ? 'Your FMS steps, checklist tasks and delegated tasks.' : 'Tasks across every FMS, checklist and the Delegation Sheet.'),
      dateBar(state, (r) => { Object.assign(state, r, { doneShown: 30 }); renderWork(root, ctx); })),
    body);

  const historicHint = new Date(state.from) < new Date(Date.now() - 90 * 864e5);
  body.replaceChildren(loadingBox(historicHint
    ? 'Reading older data from the sheets… this can take up to a minute the first time.'
    : 'Loading…'));

  loadWork(ctx.session, state.from, state.to)
    .then((data) => draw(body, data, ctx, () => renderWork(root, ctx)))
    .catch((err) => {
      const code = err.message;
      body.replaceChildren(h('div', { class: 'notice error' },
        h('p', {}, ERRORS[code] || 'Something went wrong loading work. Please try again.'),
        SESSION_ERRORS.includes(code)
          ? h('button', { type: 'button', class: 'btn-navy', onclick: ctx.onSignOut }, 'Sign in again')
          : h('button', { type: 'button', class: 'btn-navy', onclick: () => renderWork(root, ctx) }, 'Try again')));
    });
}

function draw(body, data, ctx, redraw) {
  const isDoer = data.scope === 'self';
  const names = data.names || {};
  const nameOf = (e) => names[e] || e;

  // Filters
  let tasks = data.tasks;
  if (!isDoer && state.person) {
    tasks = tasks.filter((t) => (state.person === '-' ? !t.who.length : t.who.includes(state.person)));
  }
  if (state.system) tasks = tasks.filter((t) => t.sys === state.system);

  const inRange = tasks.filter((t) => !t.carry);
  const count = (list, s) => list.filter((t) => t.status === s).length;
  const doneCount = inRange.filter((t) => ['on_time', 'late', 'done'].includes(t.status)).length;
  const timed = count(inRange, 'on_time') + count(inRange, 'late');
  const overdue = count(tasks, 'overdue');
  const carried = tasks.filter((t) => t.carry).length;

  const systems = [...new Map(data.tasks.map((t) => [t.sys, t.system])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const filters = h('div', { class: 'filter-row' },
    !isDoer && selectBox('Person', [['', 'Everyone'], ...(data.people || []).map((p) => [p.email, p.name]), ['-', 'Not assigned']],
      state.person, (v) => { state.person = v; state.doneShown = 30; draw(body, data, ctx, redraw); }),
    selectBox('System', [['', 'All systems'], ...systems], state.system,
      (v) => { state.system = v; state.doneShown = 30; draw(body, data, ctx, redraw); }));

  const kpis = h('div', { class: 'kpis' },
    tile('Assigned', inRange.length),
    tile('Done', doneCount, 'green', pct(doneCount, inRange.length) + ' of assigned'),
    tile('On time', pct(count(inRange, 'on_time'), timed), 'green', `${count(inRange, 'on_time')} of ${timed} finished`),
    tile('Pending', count(inRange, 'due') + overdue, 'amber'),
    tile('Overdue', overdue, overdue ? 'red' : '', carried ? `${carried} from before this range` : ''));

  const parts = [filters, kpis];
  if (!isDoer && !state.person && !state.system) parts.push(overview(tasks, data, nameOf, (key) => { state.person = key; draw(body, data, ctx, redraw); }));
  if (!isDoer && !state.person) parts.push(summaryTable('By person', groupBy(tasks, 'person', data.people || [], nameOf),
    (key) => { state.person = key; draw(body, data, ctx, redraw); }));
  if (!state.system) parts.push(summaryTable('By system', groupBy(tasks, 'system'),
    (key) => { state.system = key; draw(body, data, ctx, redraw); }));

  // Task lists
  const show = (s) => state.status === 'all' || state.status === s;
  const statusChips = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Status' },
    STATUS_FILTERS.map(([id, label]) => h('button', {
      type: 'button', class: `chip${state.status === id ? ' on' : ''}`, 'aria-pressed': String(state.status === id),
      onclick: () => { state.status = id; draw(body, data, ctx, redraw); },
    }, label)));
  parts.push(h('h2', { class: 'section-title' }, 'Tasks'), statusChips);

  const byPlanned = (a, b) => a.planned - b.planned;
  const lists = [
    ['Overdue', tasks.filter((t) => t.status === 'overdue').sort(byPlanned), show('overdue')],
    ['Due', tasks.filter((t) => t.status === 'due').sort(byPlanned), show('due')],
    ['Done', tasks.filter((t) => ['on_time', 'late', 'done'].includes(t.status)
      && (state.status === 'all' || t.status === state.status)).sort((a, b) => (b.actual || b.planned) - (a.actual || a.planned)),
    show('on_time') || show('late')],
  ];
  let any = false;
  lists.forEach(([title, list, visible]) => {
    if (!visible || !list.length) return;
    any = true;
    const limit = title === 'Done' ? state.doneShown : list.length;
    parts.push(h('h3', { class: 'list-title' }, `${title} · ${list.length}`),
      h('ul', { class: 'tasks' }, list.slice(0, limit).map((t) => taskItem(t, isDoer, ctx.user, nameOf))));
    if (list.length > limit) {
      parts.push(h('button', {
        type: 'button', class: 'btn-ghost-dark',
        onclick: () => { state.doneShown += 50; draw(body, data, ctx, redraw); },
      }, `Show more (${list.length - limit} left)`));
    }
  });
  if (!any) parts.push(h('p', { class: 'empty' }, 'No tasks for this selection.'));

  if (data.health) parts.push(healthPanel(data.health));
  parts.push(h('p', { class: 'foot-note' },
    `${data.historic ? 'Read from the sheets' : 'Data refreshed'} ${fmtDateTime(Date.parse(data.builtAt))} · updates every 10 minutes`));
  body.replaceChildren(...parts.filter(Boolean));
}

function taskItem(t, isDoer, user, nameOf) {
  const st = STATUS[t.status];
  const url = safeUrl(t.url);
  const mine = user.emails || [user.email];
  const others = t.who.filter((e) => !mine.includes(e));
  const meta = [t.system, t.label || (t.type === 'FMS' ? t.key : ''), t.freq && freqLabel(t.freq)].filter(Boolean);
  let timing = `Planned ${fmtDateTime(t.planned)}`;
  if (t.actual) timing += ` · Done ${fmtDateTime(t.actual)}${t.status === 'late' ? ` (${lateBy(t.actual - t.planned)} late)` : ''}`;
  else if (t.status === 'overdue') timing += ` · ${lateBy(Date.now() - t.planned)} overdue`;
  if (t.type === 'Delegation' && t.label) timing += ` · ${t.label}`;

  return h('li', { class: `task tone-${st.tone}` },
    h('div', { class: 'task-top' },
      h('span', { class: `pill pill-${st.tone}` }, st.label),
      h('span', { class: 'task-type' }, t.type)),
    h('div', { class: 'task-title' }, t.task || '(no task text)'),
    h('div', { class: 'task-meta' }, meta.join(' · ')),
    h('div', { class: 'task-meta' }, timing),
    (!isDoer || others.length) && t.who.length
      ? h('div', { class: 'task-who' }, t.who.map(nameOf).join(', '))
      : (!t.who.length && h('div', { class: 'task-who warn' }, 'Not assigned to anyone')),
    h('div', { class: 'task-actions' },
      markButton(t),
      url && h('a', { class: 'task-open', href: url, target: '_blank', rel: 'noopener' }, 'Open in sheet ↗')));
}

function groupBy(tasks, by, people = [], nameOf = (x) => x) {
  const rows = new Map();
  const row = (key, label) => {
    if (!rows.has(key)) rows.set(key, { key, label, assigned: 0, done: 0, onTime: 0, timed: 0, overdue: 0 });
    return rows.get(key);
  };
  if (by === 'person') people.forEach((p) => row(p.email, p.name));
  tasks.forEach((t) => {
    const keys = by === 'person' ? (t.who.length ? t.who : ['-']) : [t.sys];
    keys.forEach((k) => {
      const r = row(k, by === 'person' ? (k === '-' ? 'Not assigned' : nameOf(k)) : t.system);
      if (!t.carry) {
        r.assigned++;
        if (['on_time', 'late', 'done'].includes(t.status)) r.done++;
        if (t.status === 'on_time') { r.onTime++; r.timed++; }
        if (t.status === 'late') r.timed++;
      }
      if (t.status === 'overdue') r.overdue++;
    });
  });
  return [...rows.values()].filter((r) => r.assigned || r.overdue)
    .sort((a, b) => b.overdue - a.overdue || b.assigned - a.assigned);
}

function summaryTable(title, rows, onPick) {
  if (!rows.length) return null;
  return h('section', { class: 'summary' },
    h('h2', { class: 'section-title' }, title),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, ['Name', 'Assigned', 'Done', 'On time', 'Overdue'].map((x) => h('th', {}, x)))),
        h('tbody', {}, rows.map((r) => h('tr', {
          tabindex: '0', role: 'button', 'aria-label': `Show ${r.label}`,
          onclick: () => onPick(r.key),
          onkeydown: (e) => { if (e.key === 'Enter') onPick(r.key); },
        },
        h('td', {}, r.label), h('td', {}, r.assigned), h('td', {}, r.done),
        h('td', {}, pct(r.onTime, r.timed)),
        h('td', { class: r.overdue ? 'num-red' : '' }, r.overdue)))))));
}

function healthPanel(health) {
  return h('details', { class: 'health' },
    h('summary', {}, `Data health (Admin) · ${health.sources.filter((s) => s.error).length} errors · ${health.sizeKb} KB`),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, ['Source', 'Tab', 'Items', 'Time', 'Status', 'Pending vs DB_Format'].map((x) => h('th', {}, x)))),
        h('tbody', {}, health.sources.map((s) => h('tr', {},
          h('td', {}, s.system), h('td', {}, s.tab), h('td', {}, s.rows), h('td', {}, `${(s.ms / 1000).toFixed(1)} s`),
          h('td', { class: s.error ? 'num-red' : '' }, s.error || 'OK'),
          h('td', { class: s.check && (s.check.missing || s.check.extra) ? 'num-amber' : '' }, checkText(s.check))))))),
    health.sources.some((s) => s.check && (s.check.missing || s.check.extra)) && h('ul', { class: 'check-list' },
      health.sources.filter((s) => s.check && (s.check.missing || s.check.extra)).map((s) => h('li', {},
        h('b', {}, s.system), ': ',
        s.check.missing ? `in DB_Format but not in portal: ${s.check.missingEx.join('; ')}${s.check.missing > 5 ? ' …' : ''}. ` : '',
        s.check.extra ? `in portal but not in DB_Format: ${s.check.extraEx.join('; ')}${s.check.extra > 5 ? ' …' : ''}.` : ''))),
    h('p', { class: 'muted-sm' },
      `Unmatched names: ${health.unmatched.length ? health.unmatched.join(', ') : 'none'} · ` +
      `stored in ${health.storedIn.join(' + ')} · built in ${(health.totalMs / 1000).toFixed(0)} s`));
}

function lateBy(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} h`;
  return `${Math.round(hrs / 24)} days`;
}

function freqLabel(f) {
  return { D: 'Daily', W: 'Weekly', M: 'Monthly', F: 'Fortnightly', Q: 'Quarterly', Y: 'Yearly' }[f] || f;
}

/* ---------- Owner / Manager overview: who is behind, which step is stuck ---------- */

function overview(tasks, data, nameOf, pickPerson) {
  const overdue = tasks.filter((t) => t.status === 'overdue');
  if (!overdue.length && !tasks.length) return null;

  const byPerson = new Map();
  overdue.forEach((t) => (t.who.length ? t.who : ['-']).forEach((e) => byPerson.set(e, (byPerson.get(e) || 0) + 1)));
  const people = [...byPerson.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const bySteps = new Map();
  overdue.filter((t) => t.type === 'FMS').forEach((t) => {
    const k = `${t.system}|${t.task}`;
    const r = bySteps.get(k) || { system: t.system, step: t.task, n: 0, oldest: t.planned };
    r.n++; r.oldest = Math.min(r.oldest, t.planned);
    bySteps.set(k, r);
  });
  const steps = [...bySteps.values()].sort((a, b) => b.n - a.n).slice(0, 5);

  const lateDone = tasks.filter((t) => t.status === 'late' && t.actual);
  const avgLateH = lateDone.length
    ? Math.round(lateDone.reduce((s, t) => s + (t.actual - t.planned), 0) / lateDone.length / 36e5) : 0;
  const max = Math.max(1, ...people.map((p) => p[1]));

  return h('section', { class: 'overview' },
    h('h2', { class: 'section-title' }, 'At a glance'),
    h('div', { class: 'overview-grid' },
      h('div', { class: 'ov-card' },
        h('h3', {}, 'Most overdue'),
        people.length ? h('ul', { class: 'bars' }, people.map(([e, n]) => h('li', {
          role: 'button', tabindex: '0', onclick: () => pickPerson(e),
          onkeydown: (ev) => { if (ev.key === 'Enter') pickPerson(e); },
        },
        h('span', { class: 'bar-label' }, e === '-' ? 'Not assigned' : nameOf(e)),
        h('span', { class: 'bar' }, h('span', { class: 'bar-fill', style: `width:${Math.round((n / max) * 100)}%` })),
        h('span', { class: 'bar-num' }, n)))) : h('p', { class: 'muted-sm' }, 'Nobody is overdue.')),
      h('div', { class: 'ov-card' },
        h('h3', {}, 'Stuck FMS steps'),
        steps.length ? h('ul', { class: 'stuck' }, steps.map((r) => h('li', {},
          h('b', {}, r.n), h('span', {}, h('span', { class: 'stuck-step' }, r.step), h('span', { class: 'muted-sm' }, ` · ${r.system}`))))) :
          h('p', { class: 'muted-sm' }, 'No FMS step is overdue.')),
      h('div', { class: 'ov-card' },
        h('h3', {}, 'When work is late'),
        h('p', { class: 'ov-big' }, lateDone.length ? `${avgLateH} h` : '—'),
        h('p', { class: 'muted-sm' }, lateDone.length ? `average delay across ${lateDone.length} late tasks in this range` : 'No late tasks in this range'))));
}

function checkText(c) {
  if (!c) return '—';
  if (!c.missing && !c.extra) return `Match (${c.db})`;
  return `${c.db} vs ${c.portal}` + (c.missing ? ` · ${c.missing} missing` : '') + (c.extra ? ` · ${c.extra} extra` : '');
}
