// Shared scoring rules (Scores page + Person profile):
//
//   Score = tasks done ON TIME ÷ tasks that were due × 100   (higher is better)
//
// "Due" = planned in that week (Monday–Sunday) and the planned time has passed.
// Delegation has no completion time: done without being shifted = on time.

export const GOOD = 90;   // green from here
export const OK = 75;     // amber from here, red below
export const BEST_MIN_TASKS = 3;   // "Best this week" needs at least this many due tasks

export const tone = (v) => (v == null ? '' : v >= GOOD ? 'good' : v >= OK ? 'ok' : 'bad');
export const pctOf = (c) => (c && c.due ? Math.round((c.onTime / c.due) * 100) : null);

export function mondayOf(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/** `count` Mondays, the last one being `endOffset` weeks before this week. */
export function weeksEnding(count, endOffset = 0) {
  const last = mondayOf(new Date()); last.setDate(last.getDate() - 7 * endOffset);
  return Array.from({ length: count }, (_, i) => { const d = new Date(last); d.setDate(d.getDate() - 7 * (count - 1 - i)); return d; });
}

/** Mondays of every week that touches the given month ('YYYY-MM'). */
export function weeksOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1), last = new Date(y, m, 0);
  const out = [];
  for (let d = mondayOf(first); d <= last; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)) out.push(new Date(d));
  return out;
}

const blank = () => ({ due: 0, onTime: 0, late: 0, missed: 0 });

/**
 * Builds one row per person: weekly cells, total, change vs previous week.
 * `within` (optional {from,to} ms) limits counting to a period, e.g. one month.
 */
export function scoreRows(data, weeks, { type = '', within = null, people = null } = {}) {
  const now = Date.now();
  let tasks = data.tasks.filter((t) => !t.carry && t.planned <= now);
  if (type) tasks = tasks.filter((t) => t.type === type);
  if (within) tasks = tasks.filter((t) => t.planned >= within.from && t.planned <= within.to);

  const list = people || (data.scope === 'self'
    ? [{ email: data.user.email, name: data.user.name, emails: data.user.emails || [data.user.email] }]
    : (data.people || []).map((p) => ({ ...p, emails: [p.email] })));

  const start = weeks[0].getTime();
  const weekOf = (ms) => { const i = Math.floor((ms - start) / (7 * 864e5)); return i >= 0 && i < weeks.length ? i : -1; };

  return list.map((p) => {
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
    const withWork = cells.map((c) => pctOf(c)).filter((v) => v != null);
    const change = withWork.length > 1 ? withWork[withWork.length - 1] - withWork[withWork.length - 2] : null;
    return { ...p, cells, total, change };
  });
}

/** People at the top this week: highest score, at least BEST_MIN_TASKS due. */
export function bestThisWeek(rows, weekIndex) {
  return rows
    .map((r) => ({ ...r, week: r.cells[weekIndex] }))
    .filter((r) => r.week && r.week.due >= BEST_MIN_TASKS)
    .map((r) => ({ ...r, pct: pctOf(r.week) }))
    .filter((r) => r.pct >= GOOD)
    .sort((a, b) => b.pct - a.pct || b.week.due - a.week.due)
    .slice(0, 5);
}
