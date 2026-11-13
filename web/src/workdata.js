import { callApi } from './api.js';
import { h } from './dom.js';

// ---------- Dates (the phone's local time, i.e. IST for staff) ----------

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));

export const PRESETS = [
  { id: 'today', label: 'Today', range: (t) => [t, t] },
  { id: 'yesterday', label: 'Yesterday', range: (t) => [addDays(t, -1), addDays(t, -1)] },
  { id: 'week', label: 'This week', range: (t) => [monday(t), addDays(monday(t), 6)] },
  { id: 'lastweek', label: 'Last week', range: (t) => [addDays(monday(t), -7), addDays(monday(t), -1)] },
  { id: 'month', label: 'This month', range: (t) => [new Date(t.getFullYear(), t.getMonth(), 1), new Date(t.getFullYear(), t.getMonth() + 1, 0)] },
  { id: 'lastmonth', label: 'Last month', range: (t) => [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)] },
  { id: 'custom', label: 'Custom', range: null },
];

export function presetRange(id) {
  const p = PRESETS.find((x) => x.id === id);
  const [a, b] = p.range(new Date());
  return { from: ymd(a), to: ymd(b) };
}

export const MAX_DAYS = 123;

// ---------- Loading (one request per date range, kept for this visit) ----------

const memo = new Map();

export function loadWork(session, from, to) {
  const key = `${from}|${to}`;
  if (!memo.has(key)) {
    const p = callApi('work', { session, from, to }).catch((err) => { memo.delete(key); throw err; });
    memo.set(key, p);
  }
  return memo.get(key);
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
}) : '—');

export const fmtDay = (key) => new Date(key + 'T00:00:00').toLocaleDateString('en-IN', {
  weekday: 'short', day: 'numeric', month: 'short',
});

export const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

export function loadingBox(text) {
  return h('div', { class: 'loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text);
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
