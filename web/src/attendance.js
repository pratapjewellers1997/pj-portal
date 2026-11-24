import { h } from './dom.js';
import {
  loadWork, dateBar, selectBox, tile, fmtDateTime, fmtDay, pct, presetRange, loadingBox, ERRORS,
} from './workdata.js';

// Attendance page (Haazri). Days up to yesterday come from ATTENDANCE,
// today comes live from check-ins, month totals from MONTHLY_SUMMARY.
// Doer: own attendance only. Manager / Owner / Admin: everyone.

const SESSION_ERRORS = ['session_expired', 'no_session', 'not_registered', 'inactive'];
const state = { preset: 'week', ...presetRange('week'), person: '' };

export function renderAttendance(root, ctx) {
  const isDoer = ctx.user.role === 'Doer';
  const body = h('div', { class: 'page-body' });
  root.replaceChildren(
    h('section', { class: 'page-head' },
      h('h1', {}, isDoer ? 'My attendance' : 'Attendance'),
      h('p', {}, 'From the Haazri attendance system. Today updates live from check-ins.'),
      dateBar(state, (r) => { Object.assign(state, r); renderAttendance(root, ctx); })),
    body);
  body.replaceChildren(loadingBox('Loading…'));

  loadWork(ctx.session, state.from, state.to)
    .then((data) => draw(body, data))
    .catch((err) => {
      const code = err.message;
      body.replaceChildren(h('div', { class: 'notice error' },
        h('p', {}, ERRORS[code] || 'Something went wrong loading attendance. Please try again.'),
        SESSION_ERRORS.includes(code)
          ? h('button', { type: 'button', class: 'btn-navy', onclick: ctx.onSignOut }, 'Sign in again')
          : h('button', { type: 'button', class: 'btn-navy', onclick: () => renderAttendance(root, ctx) }, 'Try again')));
    });
}

function draw(body, data) {
  const isDoer = data.scope === 'self';
  let days = data.attendance.slice();
  let monthly = (data.monthly || []).slice();
  if (!isDoer && state.person) {
    days = days.filter((d) => d.email === state.person);
    monthly = monthly.filter((m) => m.email === state.person);
  }
  days.sort((a, b) => (b.date + a.name).localeCompare(a.date + b.name));

  const present = days.filter((d) => /present|checked in/i.test(d.status)).length;
  const absent = days.filter((d) => /absent/i.test(d.status)).length;
  const half = days.filter((d) => /half/i.test(d.dayType)).length;
  const late = days.filter((d) => d.late).length;
  const early = days.filter((d) => d.earlyLeave).length;
  const ins = days.map((d) => toMins(d.checkIn)).filter((m) => m != null);
  const avgIn = ins.length ? fromMins(Math.round(ins.reduce((a, b) => a + b, 0) / ins.length)) : '—';

  const parts = [];
  if (!isDoer) {
    parts.push(h('div', { class: 'filter-row' },
      selectBox('Person', [['', 'Everyone'], ...(data.people || []).map((p) => [p.email, p.name])], state.person,
        (v) => { state.person = v; draw(body, data); })));
  }
  // Data period indicator
  {
    const daysN = Math.round((new Date(state.to) - new Date(state.from)) / 864e5) + 1;
    const fromD = new Date(state.from + 'T00:00:00+05:30');
    const toD = new Date(state.to + 'T00:00:00+05:30');
    const fmtD = (d) => d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });
    const weekLabel = (state.preset === 'week' || state.preset === 'lastweek') ? ' (Tue–Mon business week)' : '';
    const updated = data.builtAt ? ` · Last updated ${fmtDateTime(Date.parse(data.builtAt))}` : '';
    parts.push(h('p', { class: 'analysis-hint' }, `${fmtD(fromD)} to ${fmtD(toD)} ${parseInt(state.to.slice(0, 4), 10)} · ${daysN} day${daysN !== 1 ? 's' : ''}${weekLabel}${updated}`));
  }
  parts.push(h('div', { class: 'kpis' },
    tile('Present', present, 'green'),
    tile('Absent', absent, absent ? 'red' : ''),
    tile('Late', late, late ? 'amber' : '', pct(late, present) + ' of present days'),
    tile('Half days', half),
    tile('Early leave', early),
    tile('Avg check-in', avgIn)));

  if (monthly.length) {
    parts.push(h('h2', { class: 'section-title' }, 'Month totals (official)'),
      table(['Name', 'Month', 'Working', 'Present', 'Absent', 'Late', 'Half', 'Early leave'],
        monthly.sort((a, b) => (b.month + a.name).localeCompare(a.month + b.name)).map((m) => [
          m.name, m.month, m.workingDays, m.present, m.absent, m.late, m.halfDays, m.earlyLeave])));
  }

  if (!isDoer && !state.person) {
    const per = new Map();
    days.forEach((d) => {
      const r = per.get(d.email) || { email: d.email, name: d.name, present: 0, absent: 0, late: 0, ins: [] };
      if (/present|checked in/i.test(d.status)) r.present++;
      if (/absent/i.test(d.status)) r.absent++;
      if (d.late) r.late++;
      const m = toMins(d.checkIn); if (m != null) r.ins.push(m);
      per.set(d.email, r);
    });
    const rows = [...per.values()].sort((a, b) => b.late - a.late || a.name.localeCompare(b.name));
    if (rows.length) {
      parts.push(h('h2', { class: 'section-title' }, 'By person'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, ['Name', 'Present', 'Absent', 'Late', 'Avg check-in'].map((x) => h('th', {}, x)))),
          h('tbody', {}, rows.map((r) => h('tr', {
            tabindex: '0', role: 'button', 'aria-label': `Show ${r.name}`,
            onclick: () => { state.person = r.email; draw(body, data); },
            onkeydown: (e) => { if (e.key === 'Enter') { state.person = r.email; draw(body, data); } },
          },
          h('td', {}, r.name), h('td', {}, r.present), h('td', { class: r.absent ? 'num-red' : '' }, r.absent),
          h('td', { class: r.late ? 'num-amber' : '' }, r.late),
          h('td', {}, r.ins.length ? fromMins(Math.round(r.ins.reduce((a, b) => a + b, 0) / r.ins.length)) : '—')))))));
    }
  }

  parts.push(h('h2', { class: 'section-title' }, 'Day by day'));
  if (!days.length) {
    const msg = (state.preset === 'week') ? 'No records available for this week.' : 'No attendance for this selection.';
    parts.push(h('p', { class: 'empty' }, msg));
  }
  else {
    parts.push(h('ul', { class: 'days' }, days.map((d) => h('li', { class: `day${d.late ? ' is-late' : ''}${/absent/i.test(d.status) ? ' is-absent' : ''}` },
      h('div', { class: 'day-top' },
        h('strong', {}, fmtDay(d.date)),
        !isDoer && h('span', { class: 'day-name' }, d.name),
        d.live && h('span', { class: 'pill pill-amber' }, 'Live')),
      h('div', { class: 'task-meta' }, [
        d.status,
        d.checkIn && `In ${d.checkIn}`,
        d.checkOut && `Out ${d.checkOut}`,
        d.hours && `${d.hours} h`,
        d.dayType,
        d.late && `Late ${d.lateBy} min`,
        d.earlyLeave && 'Left early',
      ].filter(Boolean).join(' · '))))));
  }
  parts.push(h('p', { class: 'foot-note' }, `Data refreshed ${fmtDateTime(Date.parse(data.builtAt))}`));
  body.replaceChildren(...parts.filter(Boolean));
}

function table(head, rows) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))));
}

function toMins(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function fromMins(n) {
  const hh = Math.floor(n / 60), mm = n % 60;
  const ap = hh >= 12 ? 'pm' : 'am';
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${ap}`;
}
