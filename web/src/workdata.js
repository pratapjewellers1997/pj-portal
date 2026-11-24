import { callApi } from './api.js';
import { h } from './dom.js';

// ---------- Dates (pinned to IST so every device sees the same business day) ----------

const pad = (n) => String(n).padStart(2, '0');

/** Return a Date whose year/month/day/weekday match the current IST wall-clock,
 *  regardless of the browser's local timezone. The returned Date is a plain
 *  local-Date object (not UTC) so getDay()/getMonth()/getDate() all work. */
function nowIST() {
  const now = new Date();
  // IST is UTC+5:30 → +330 minutes.  getTimezoneOffset() is negative east of GMT.
  const istMs = now.getTime() + (now.getTimezoneOffset() + 330) * 60000;
  const ist = new Date(istMs);
  // Return a clean midnight date so preset ranges are day-aligned
  return new Date(ist.getFullYear(), ist.getMonth(), ist.getDate());
}

export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const tuesday = (d) => addDays(d, -((d.getDay() + 5) % 7));

export const PRESETS = [
  { id: 'today', label: 'Today', range: (t) => [t, t] },
  { id: 'yesterday', label: 'Yesterday', range: (t) => [addDays(t, -1), addDays(t, -1)] },
  { id: 'week', label: 'This week', range: (t) => [tuesday(t), addDays(tuesday(t), 6)] },
  { id: 'lastweek', label: 'Last week', range: (t) => [addDays(tuesday(t), -7), addDays(tuesday(t), -1)] },
  { id: 'month', label: 'This month', range: (t) => [new Date(t.getFullYear(), t.getMonth(), 1), new Date(t.getFullYear(), t.getMonth() + 1, 0)] },
  { id: 'lastmonth', label: 'Last month', range: (t) => [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)] },
  { id: 'custom', label: 'Custom', range: null },
];

export function presetRange(id) {
  const p = PRESETS.find((x) => x.id === id);
  const [a, b] = p.range(nowIST());
  return { from: ymd(a), to: ymd(b) };
}

export const MAX_DAYS = 123;

// ---------- Loading (one request per date range, cached with 10-min TTL) ----------

const MEMO_TTL = 10 * 60 * 1000; // 10 minutes — matches backend snapshot refresh
const memo = new Map();

export function loadWork(session, from, to) {
  const key = `${from}|${to}`;
  const cached = memo.get(key);
  if (cached && Date.now() - cached.ts < MEMO_TTL) return cached.p;
  const p = callApi('work', { session, from, to }).catch((err) => { memo.delete(key); throw err; });
  memo.set(key, { p, ts: Date.now() });
  return p;
}

export function clearWorkMemo() { memo.clear(); }

// ---------- Shared bits for the Work and Attendance pages ----------

export const ERRORS = {
  range_too_long: `Please pick ${MAX_DAYS} days or fewer.`,
  busy: 'The portal is refreshing data. Please try again in a minute.',
  network_error: 'Could not reach the portal server. Check your internet.',
  session_expired: 'Your session ended. Please sign in again.',
  no_session: 'Please sign in again.',
};

/** Date controls: preset chips + custom from/to. Calls onChange({from,to,preset}). */
export function dateBar(state, onChange) {
  const custom = h('div', { class: 'custom-range' + (state.preset === 'custom' ? ' on' : '') });
  const fromIn = h('input', { type: 'date', value: state.from, 'aria-label': 'From date' });
  const toIn = h('input', { type: 'date', value: state.to, 'aria-label': 'To date' });
  const err = h('span', { class: 'field-error', role: 'alert' });
  const apply = h('button', {
    type: 'button', class: 'btn-navy',
    onclick: () => {
      const from = fromIn.value, to = toIn.value;
      if (!from || !to) { err.textContent = 'Pick both dates.'; return; }
      if (to < from) { err.textContent = '"To" must be on or after "From".'; return; }
      if ((new Date(to) - new Date(from)) / 864e5 + 1 > MAX_DAYS) { err.textContent = `Pick ${MAX_DAYS} days or fewer.`; return; }
      err.textContent = '';
      onChange({ preset: 'custom', from, to });
    },
  }, 'Apply');
  [fromIn, toIn].forEach((i) => i.addEventListener('input', () => { err.textContent = ''; }));
  custom.append(fromIn, h('span', { class: 'muted-sm' }, 'to'), toIn, apply, err);

  const chips = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Date range' },
    PRESETS.map((p) => h('button', {
      type: 'button', class: `chip${state.preset === p.id ? ' on' : ''}`, 'aria-pressed': String(state.preset === p.id),
      onclick: () => {
        if (p.id === 'custom') { custom.classList.add('on'); chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === chips.querySelector(`[data-p="custom"]`))); return; }
        onChange({ preset: p.id, ...presetRange(p.id) });
      },
      'data-p': p.id,
    }, p.label)));
  return h('div', { class: 'date-bar' }, chips, custom);
}

export function selectBox(label, options, value, onChange) {
  const sel = h('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value) },
    options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)));
  return h('label', { class: 'select' }, h('span', {}, label), sel);
}

export function tile(label, value, tone = '', hint = '') {
  return h('div', { class: `kpi${tone ? ' kpi-' + tone : ''}` },
    h('div', { class: 'kpi-value' }, value),
    h('div', { class: 'kpi-label' }, label),
    hint && h('div', { class: 'kpi-hint' }, hint));
}

export const fmtDateTime = (ms) => (ms ? new Date(ms).toLocaleString('en-IN', {
  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  timeZone: 'Asia/Kolkata',
}) : '—');

export const fmtDay = (key) => new Date(key + 'T00:00:00+05:30').toLocaleDateString('en-IN', {
  weekday: 'short', day: 'numeric', month: 'short',
  timeZone: 'Asia/Kolkata',
});

export const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

export function loadingBox(text) {
  return h('div', { class: 'loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text);
}

/** Skeleton placeholder grid for KPI tiles + task list */
export function skeletonWork() {
  return h('div', { class: 'skeleton-work' },
    h('div', { class: 'kpis' },
      ...Array.from({ length: 5 }, () => h('div', { class: 'skeleton-kpi' },
        h('div', { class: 'skeleton-line h28 w60' }),
        h('div', { class: 'skeleton-line h12 w80' })))),
    h('div', { class: 'skeleton-tasks' },
      ...Array.from({ length: 4 }, () => h('div', { class: 'skeleton-card' },
        h('div', { class: 'skeleton-line h14 w40' }),
        h('div', { class: 'skeleton-line h16 w90' }),
        h('div', { class: 'skeleton-line h12 w60' })))));
}

/** Skeleton placeholder for the today card */
export function skeletonToday() {
  return h('div', { class: 'skeleton-today' },
    h('div', { class: 'skeleton-line h16 w40' }),
    h('div', { class: 'today-stats' },
      ...Array.from({ length: 4 }, () => h('div', { class: 'skeleton-kpi' },
        h('div', { class: 'skeleton-line h22 w50' }),
        h('div', { class: 'skeleton-line h12 w80' })))));
}

// ---------- One-tap "Mark done" (opens the step's own pre-filled Google Form) ----------
// The form is submitted to Google Forms directly, exactly as staff do today.
// The portal sends nothing to the API: the step turns "done" at the next
// 10-minute refresh, once the FMS sheet has recorded the form.

const MARKED_KEY = 'pj_marked';
const markedSet = () => { try { return new Set(JSON.parse(sessionStorage.getItem(MARKED_KEY) || '[]')); } catch { return new Set(); } };

export function markButton(t) {
  const isOpen = t.status === 'overdue' || t.status === 'due';
  let url = null;
  try { url = t.mark && new URL(t.mark).hostname === 'docs.google.com' ? t.mark : null; } catch { url = null; }
  if (!isOpen || !url) return null;
  const id = `${t.sys}|${t.key}|${t.task}`;
  const note = h('span', { class: 'mark-note' }, 'Form opened · shows as done within ~10 min');
  const btn = h('a', {
    class: 'btn-mark', href: url, target: '_blank', rel: 'noopener',
    onclick: () => {
      const s = markedSet(); s.add(id);
      try { sessionStorage.setItem(MARKED_KEY, JSON.stringify([...s])); } catch {}
      btn.replaceWith(note);
    },
  }, '✓ Mark done');
  return markedSet().has(id) ? note : btn;
}
