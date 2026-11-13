import { h, safeUrl } from './dom.js';
import { loadWork, ymd, fmtDateTime, fmtDay, loadingBox, ERRORS, markButton } from './workdata.js';
import { tone, pctOf, weeksEnding, scoreRows, GOOD } from './scoring.js';
import { scoreCell, changeText } from './scores.js';

// Person profile: one page per person — score trend, open tasks, attendance.
// Uses the same 8-week data as the Scores page, so it opens instantly after it.
// A Doer can only open their own profile (the API only sends their own data).

const SESSION_ERRORS = ['session_expired', 'no_session', 'not_registered', 'inactive'];

export function renderProfile(root, ctx, email) {
  const body = h('div', { class: 'page-body' });
  const head = h('section', { class: 'page-head' }, h('h1', {}, 'Profile'));
  root.replaceChildren(head, body);
  body.replaceChildren(loadingBox('Loading profile…'));

  const weeks = weeksEnding(8, 0);
  const end = new Date(weeks[7]); end.setDate(end.getDate() + 6);
  loadWork(ctx.session, ymd(weeks[0]), ymd(end))
    .then((data) => draw(head, body, data, weeks, ctx, email))
    .catch((e) => body.replaceChildren(h('div', { class: 'notice error' },
      h('p', {}, ERRORS[e.message] || 'Something went wrong. Please try again.'),
      SESSION_ERRORS.includes(e.message)
        ? h('button', { type: 'button', class: 'btn-navy', onclick: ctx.onSignOut }, 'Sign in again')
        : h('button', { type: 'button', class: 'btn-navy', onclick: () => renderProfile(root, ctx, email) }, 'Try again'))));
}

function draw(head, body, data, weeks, ctx, email) {
  const isDoer = data.scope === 'self';
  const me = data.user;
  const target = isDoer || !email ? me.email : email;
  const person = isDoer || target === me.email
    ? { email: me.email, name: me.name, designation: me.designation, role: me.role, emails: me.emails || [me.email] }
    : (() => { const p = (data.people || []).find((x) => x.email === target); return p ? { ...p, emails: [p.email] } : null; })();

  if (!person) {
    head.replaceChildren(h('h1', {}, 'Profile'));
    body.replaceChildren(h('p', { class: 'empty' }, 'This person is not in the staff list.'));
    return;
  }
  const mine = (t) => t.who.some((e) => person.emails.includes(e));
  const tasks = data.tasks.filter(mine);
  const row = scoreRows(data, weeks, { people: [person] })[0];
  const thisWeek = row.cells[weeks.length - 1];
  const now = Date.now();

  // ---- Header
  head.replaceChildren(
    h('div', { class: 'profile-head' },
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, initials(person.name)),
      h('div', {},
        h('h1', {}, person.name),
        h('p', {}, [person.designation, person.role].filter(Boolean).join(' · ')))),
    !isDoer && h('a', { href: '#scores', class: 'back-link' }, '← Back to scores'));

  // ---- Number tiles
  const overdue = tasks.filter((t) => t.status === 'overdue');
  const due = tasks.filter((t) => t.status === 'due');
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const att = data.attendance.filter((a) => person.emails.includes(a.email));
  const attMonth = att.filter((a) => a.date >= ymd(monthStart));
  const present = attMonth.filter((a) => /present|checked in/i.test(a.status)).length;
  const late = attMonth.filter((a) => a.late).length;
  const weekScore = pctOf(thisWeek), total = pctOf(row.total);

  const tiles = h('div', { class: 'kpis' },
    tileBox('This week', weekScore == null ? '—' : `${weekScore}%`, tone(weekScore), thisWeek.due ? `${thisWeek.onTime} of ${thisWeek.due} on time` : 'nothing due yet'),
    tileBox('Last 8 weeks', total == null ? '—' : `${total}%`, tone(total), `${row.total.onTime} of ${row.total.due} on time`),
    tileBox('Overdue now', overdue.length, overdue.length ? 'bad' : ''),
    tileBox('Due soon', due.length),
    tileBox('Present this month', present, '', late ? `${late} late` : 'never late'));

  const badge = weekScore != null && weekScore >= GOOD && thisWeek.due >= 3
    ? h('div', { class: 'best inline' }, `🏆 ${weekScore}% on time this week — great work!`) : null;

  // ---- Weekly trend (bars)
  const label = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const trend = h('section', {},
    h('h2', { class: 'section-title' }, 'Weekly score'),
    h('div', { class: 'week-bars', role: 'img', 'aria-label': 'Weekly score for the last 8 weeks' },
      row.cells.map((c, i) => {
        const v = pctOf(c);
        return h('div', { class: 'wb' },
          h('div', { class: 'wb-val' }, v == null ? '—' : `${v}%`),
          h('div', { class: 'wb-track' }, h('div', { class: `wb-fill sc-${tone(v)}`, style: `height:${v == null ? 0 : Math.max(4, v)}%` })),
          h('div', { class: 'wb-label' }, i === weeks.length - 1 ? 'This wk' : label(weeks[i])));
      })),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data scores' },
      h('thead', {}, h('tr', {}, weeks.map((w, i) => h('th', {}, i === weeks.length - 1 ? 'This week' : label(w))), h('th', {}, '8 weeks'), h('th', {}, 'Change'))),
      h('tbody', {}, h('tr', {}, row.cells.map(scoreCell), scoreCell(row.total), h('td', { class: 'sc-change' }, changeText(row.change)))))));

  // ---- Open tasks (overdue first)
  const open = [...overdue.sort((a, b) => a.planned - b.planned), ...due.sort((a, b) => a.planned - b.planned)];
  const openList = h('section', {},
    h('h2', { class: 'section-title' }, `Open tasks · ${open.length}`),
    open.length ? h('ul', { class: 'tasks' }, open.slice(0, 40).map((t) => {
      const url = safeUrl(t.url);
      return h('li', { class: `task tone-${t.status === 'overdue' ? 'red' : 'amber'}` },
        h('div', { class: 'task-top' },
          h('span', { class: `pill pill-${t.status === 'overdue' ? 'red' : 'amber'}` }, t.status === 'overdue' ? 'Overdue' : 'Due'),
          h('span', { class: 'task-type' }, t.type)),
        h('div', { class: 'task-title' }, t.task),
        h('div', { class: 'task-meta' }, [t.system, t.label].filter(Boolean).join(' · ')),
        h('div', { class: 'task-meta' }, `Planned ${fmtDateTime(t.planned)}`),
        h('div', { class: 'task-actions' }, markButton(t),
          url && h('a', { class: 'task-open', href: url, target: '_blank', rel: 'noopener' }, 'Open in sheet ↗')));
    })) : h('p', { class: 'empty' }, 'Nothing open. All caught up.'),
    open.length > 40 && h('p', { class: 'muted-sm' }, `Showing 40 of ${open.length}. See all on the Work page.`));

  // ---- Attendance (last 14 days)
  const days = att.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
  const attList = h('section', {},
    h('h2', { class: 'section-title' }, 'Attendance (last 14 days)'),
    days.length ? h('ul', { class: 'days' }, days.map((d) => h('li', { class: `day${d.late ? ' is-late' : ''}${/absent/i.test(d.status) ? ' is-absent' : ''}` },
      h('div', { class: 'day-top' }, h('strong', {}, fmtDay(d.date)), d.live && h('span', { class: 'pill pill-amber' }, 'Live')),
      h('div', { class: 'task-meta' }, [d.status, d.checkIn && `In ${d.checkIn}`, d.checkOut && `Out ${d.checkOut}`,
        d.late && `Late ${d.lateBy} min`, d.earlyLeave && 'Left early'].filter(Boolean).join(' · ')))))
      : h('p', { class: 'empty' }, 'No attendance found.'));

  body.replaceChildren(...[tiles, badge, trend, openList, attList,
    h('p', { class: 'foot-note' }, `Data refreshed ${fmtDateTime(Date.parse(data.builtAt))}`)].filter(Boolean));
  void now;
}

function tileBox(label, value, t = '', hint = '') {
  const cls = t === 'good' ? ' kpi-green' : t === 'ok' ? ' kpi-amber' : t === 'bad' ? ' kpi-red' : '';
  return h('div', { class: `kpi${cls}` },
    h('div', { class: 'kpi-value' }, value),
    h('div', { class: 'kpi-label' }, label),
    hint && h('div', { class: 'kpi-hint' }, hint));
}

function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}
