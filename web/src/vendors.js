import { h, safeUrl } from './dom.js';
import { callApi } from './api.js';
import { fmtDateTime, loadingBox, ERRORS } from './workdata.js';

// Vendor scorecard (Step 11). "SSG mode": figures are worked out from FMS and
// GP sheets and may not be accurate, so the page says so and shows how to check
// every number by hand. Each number opens the exact orders it counted.

const SESSION_ERRORS = ['session_expired', 'no_session', 'not_registered', 'inactive'];
const STATUS = {
  on_time: ['On time', 'green'], late: ['Late', 'red'], overdue: ['Overdue', 'red'],
  waiting: ['Waiting', 'amber'], received: ['Received (no promise date)', 'gray'],
};
const FILTERS = {
  all: ['All orders', () => true],
  on_time: ['On time', (o) => o.status === 'on_time'],
  late: ['Received late', (o) => o.status === 'late'],
  overdue: ['Overdue now', (o) => o.status === 'overdue'],
  open: ['Not received yet', (o) => o.status === 'overdue' || o.status === 'waiting'],
  extended: ['Asked for extension', (o) => o.extended],
  first: ['First promise missed', (o) => o.received && o.firstPromise && o.received > o.firstPromise],
  qc: ['Failed quality check', (o) => /^no\b/i.test(o.qc || '')],
};
const SORTS = {
  orders: ['Most orders', (a, b) => b.orders - a.orders || b.receipts - a.receipts],
  best: ['Best on time', (a, b) => (b.onTimePct ?? -1) - (a.onTimePct ?? -1) || b.orders - a.orders],
  worst: ['Most overdue', (a, b) => b.overdue - a.overdue || (b.avgLateDays || 0) - (a.avgLateDays || 0)],
  sales: ['Highest sales', (a, b) => (b.sales?.revenue || 0) - (a.sales?.revenue || 0)],
};
const PERIODS = [['3m', 'Last 3 months'], ['thisMonth', 'This month'], ['lastMonth', 'Last month'],
  ['6m', 'Last 6 months'], ['fy', 'This financial year'], ['all', 'All time']];
const MEMO_TTL = 10 * 60 * 1000;
const memo = new Map();
const state = { sort: 'orders', q: '', period: '3m' };

export function renderVendors(root, ctx) {
  const body = h('div', { class: 'page-body' }, loadingBox(state.period === '3m' ? 'Loading vendor scorecard…'
    : 'Loading vendor scorecard… (older orders can take up to a minute the first time)'));
  root.replaceChildren(
    h('section', { class: 'page-head' },
      h('h1', {}, '⭐ Vendor scorecard'),
      h('p', {}, 'How each vendor delivers your orders, worked out from the FMS sheets.'),
      h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Period' }, PERIODS.map(([id, label]) => h('button', {
        type: 'button', class: `chip${state.period === id ? ' on' : ''}`, 'aria-pressed': String(state.period === id),
        onclick: () => { state.period = id; renderVendors(root, ctx); },
      }, label)))),
    body);
  const key = state.period;
  const cached = memo.get(key);
  if (!cached || Date.now() - cached.ts >= MEMO_TTL) {
    const p = callApi('vendors', { session: ctx.session, period: key }).catch((e) => { memo.delete(key); throw e; });
    memo.set(key, { p, ts: Date.now() });
  }
  memo.get(key).p.then((d) => { if (state.period === key) draw(body, d); }).catch((e) => body.replaceChildren(h('div', { class: 'notice error' },
    h('p', {}, ERRORS[e.message] || 'Could not load the vendor scorecard.'),
    SESSION_ERRORS.includes(e.message)
      ? h('button', { type: 'button', class: 'btn-navy', onclick: ctx.onSignOut }, 'Sign in again')
      : h('button', { type: 'button', class: 'btn-navy', onclick: () => renderVendors(root, ctx) }, 'Try again'))));
}

function draw(body, d) {
  const list = h('div', { class: 'vs-grid' });
  const search = h('input', {
    class: 'search vs-search', type: 'search', value: state.q, placeholder: 'Find a vendor…', 'aria-label': 'Find a vendor',
    oninput: (e) => { state.q = e.target.value.trim().toLowerCase(); drawList(); },
  });
  const sorts = Object.entries(SORTS).filter(([k]) => k !== 'sales' || d.canSeeSales);
  const sortSel = h('select', { 'aria-label': 'Sort vendors', onchange: (e) => { state.sort = e.target.value; drawList(); } },
    sorts.map(([k, [label]]) => h('option', { value: k, selected: state.sort === k ? true : null }, label)));

  function drawList() {
    const shown = d.vendors
      .filter((v) => !state.q || `${v.name} ${v.code}`.toLowerCase().includes(state.q))
      .sort(SORTS[state.sort][1]);
    list.replaceChildren(...(shown.length ? shown.map((v) => vendorCard(v, d)) : [h('p', { class: 'empty' }, 'No vendor matches.')]));
  }

  // Data period indicator
  const hintParts = [];
  if (!d.window.all && d.window.from && d.window.to) {
    const fromD = new Date(typeof d.window.from === 'number' ? d.window.from : `${d.window.from}T00:00:00+05:30`);
    const toD = new Date(typeof d.window.to === 'number' ? d.window.to : `${d.window.to}T00:00:00+05:30`);
    const daysN = Math.round((toD - fromD) / 864e5) + 1;
    const fmtD = (dt) => dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });
    const yrStr = typeof d.window.to === 'string' ? d.window.to.slice(0, 4) : toD.toLocaleDateString('en-IN', { year: 'numeric', timeZone: 'Asia/Kolkata' });
    hintParts.push(h('p', { class: 'analysis-hint' }, `Showing data from ${fmtD(fromD)} to ${fmtD(toD)} ${yrStr} · ${daysN} calendar day${daysN !== 1 ? 's' : ''}`));
  } else if (d.window.all && d.window.to) {
    const toD = new Date(typeof d.window.to === 'number' ? d.window.to : `${d.window.to}T00:00:00+05:30`);
    const yrStr = typeof d.window.to === 'string' ? d.window.to.slice(0, 4) : toD.toLocaleDateString('en-IN', { year: 'numeric', timeZone: 'Asia/Kolkata' });
    hintParts.push(h('p', { class: 'analysis-hint' }, `Showing all data up to ${toD.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })} ${yrStr}`));
  }

  body.replaceChildren(
    warning(d),
    ...(d.note ? [h('p', { class: 'notice' }, d.note)] : []),
    ...hintParts,
    h('p', { class: 'muted-sm' },
      d.window.all ? `All orders issued to a vendor, up to ${fmtDay(d.window.to)}` : `Orders issued to a vendor from ${fmtDay(d.window.from)} to ${fmtDay(d.window.to)}`,
      d.sales ? ` · Sales: GP data up to ${d.sales.upTo ? fmtDay(d.sales.upTo) : '— (no data fed yet)'}` : '',
      '. Tap any number to see the orders behind it.'),
    h('div', { class: 'vs-tools' }, search, h('label', { class: 'select' }, h('span', {}, 'Sort'), sortSel)),
    list);
  drawList();
}

/* ---------- Warning + "How to check manually" ---------- */

function warning(d) {
  const panel = h('div', { class: 'vs-how', hidden: true },
    h('h3', {}, 'Sources used'),
    h('ul', { class: 'vs-sources' }, d.sources.map((s) => {
      const url = safeUrl(s.url);
      return h('li', {},
        url ? h('a', { href: url, target: '_blank', rel: 'noopener' }, s.label, ' ↗') : h('span', {}, s.label),
        h('span', { class: 'muted-sm' },
          s.edited ? ` · last edited ${new Date(s.edited).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : '',
          s.upTo ? ` · data up to ${fmtDay(s.upTo)}` : '',
          s.ownersOnly ? ' · Owners & MIS only' : ''));
    })),
    h('h3', {}, 'How to check manually (reconciliation)'),
    h('ol', { class: 'vs-steps' },
      h('li', {}, 'Open the Order to Delivery FMS and filter the ', h('b', {}, 'Vendor Name'), ' (or Confirmed Vendor) column to the vendor you are checking.'),
      h('li', {}, 'Keep only rows where ', h('b', {}, 'Issue Order to Supplier → Actual'), ' is filled and falls in the period shown above. Count them: this is ', h('b', {}, 'Orders'), '.'),
      h('li', {}, h('b', {}, 'Delivery Time'), ` is customer days (vendor days + ${d.bufferDays}). So the vendor's first promise = the day of "Issue Order to Supplier → Actual" + (Delivery Time − ${d.bufferDays}) days, till the end of that day.`),
      h('li', {}, 'If ', h('b', {}, 'Follow up with Supplier ?'), ' is ', h('b', {}, 'Yes'), ', the vendor asked for more time: the agreed vendor date becomes ', h('b', {}, 'Extended Date'), ` (the vendor's date). If Extended Date is blank: the follow-up Actual day + (Extended Delivery Time − ${d.bufferDays}) days. Count these rows: this is `, h('b', {}, 'Extended'), '.'),
      h('li', {}, 'Compare ', h('b', {}, 'Product Recieved from Vendor → Actual'), ' with the agreed vendor date. On or before = ', h('b', {}, 'On time'), '; after = ', h('b', {}, 'Late'), '; still blank after that date = ', h('b', {}, 'Overdue'), '. Compared with the first promise instead = ', h('b', {}, 'First promise kept'), '.'),
      h('li', {}, 'Rows where ', h('b', {}, 'Order Quality Check ?'), ' is "No" = ', h('b', {}, 'QC failed'), '; "Return to Vendor" done = ', h('b', {}, 'Returned'), '.'),
      h('li', {}, 'In the Purchase to Display FMS, filter ', h('b', {}, 'Vendor Name'), ' and count receipts and Number of Pieces for the same period.'),
      d.canSeeSales ? h('li', {}, '(Owners/MIS) In the GP Feeder System open ', h('b', {}, 'gp_vendor_wise'), ', pick the same months and compare that vendor\'s Revenue and GP.') : null,
      h('li', {}, 'If a number does not match, look for: a blank Actual date, a missing Delivery Time, a vendor name spelt differently or without its code, or rows entered late. Fix the sheet; the portal updates within about 10 minutes.')),
    h('h3', {}, 'How the stars work'),
    h('p', {}, 'Stars come from On time % against the agreed vendor date (needs at least 3 received orders with a Delivery Time): 90%+ ★★★★★ · 75%+ ★★★★ · 60%+ ★★★ · 40%+ ★★ · below ★. One star less if more than 20% of quality checks failed. Vendors are matched by the code in brackets, e.g. "AALOK (A01)".'));
  const btn = h('button', {
    type: 'button', class: 'vs-how-btn', 'aria-expanded': 'false',
    onclick: () => {
      panel.hidden = !panel.hidden;
      btn.setAttribute('aria-expanded', String(!panel.hidden));
      btn.textContent = panel.hidden ? 'How to check manually' : 'Hide steps';
    },
  }, 'How to check manually');
  return h('section', { class: 'vs-warn', role: 'note' },
    h('div', { class: 'vs-warn-row' },
      h('span', {}, h('b', {}, '🧪 SSG mode: figures may not be accurate.'), ' Worked out from FMS and other sheets, which can have missed or late entries. Check manually before any decision about a vendor.'),
      btn),
    panel);
}

/* ---------- One vendor ---------- */

function vendorCard(v, d) {
  const orders = d.orders.filter((o) => o.vendor === v.key);
  const drill = h('div', { class: 'vs-drill', hidden: true });
  let current = '';
  const open = (f) => {
    if (current === f && !drill.hidden) { drill.hidden = true; current = ''; return; }
    current = f;
    const [label, test] = FILTERS[f];
    const rows = orders.filter(test);
    drill.hidden = false;
    drill.replaceChildren(
      h('div', { class: 'vs-drill-head' }, h('b', {}, `${label} · ${rows.length}`),
        h('button', { type: 'button', class: 'link-btn vs-close', onclick: () => { drill.hidden = true; current = ''; } }, 'Close')),
      rows.length ? h('ul', { class: 'vs-orders' }, rows.map(orderRow)) : h('p', { class: 'muted-sm' }, 'No orders.'));
  };
  const tile = (value, label, f, tone = '') => h('button', {
    type: 'button', class: `vs-tile${tone ? ' t-' + tone : ''}`, disabled: f && orders.length ? null : true,
    onclick: f ? () => open(f) : null,
  }, h('b', {}, value), h('span', {}, label));

  const delivery = v.orders ? [
    tile(v.orders, 'orders', 'all'),
    tile(v.onTimePct == null ? '—' : `${v.onTimePct}%`, `on time (${v.onTime}/${v.onTime + v.late})`, 'on_time', v.onTimePct == null ? '' : v.onTimePct >= 75 ? 'green' : v.onTimePct >= 50 ? 'amber' : 'red'),
    tile(v.avgLateDays == null ? '—' : `${v.avgLateDays}d`, `avg late (${v.late} late)`, 'late', v.late ? 'red' : ''),
    tile(v.overdue, `overdue now · ${v.open} open`, 'overdue', v.overdue ? 'red' : ''),
    tile(v.firstKeptPct == null ? '—' : `${v.firstKeptPct}%`, `first promise kept (${v.firstKept}/${v.firstJudged})`, 'first', v.firstKeptPct == null ? '' : v.firstKeptPct >= 75 ? 'green' : v.firstKeptPct >= 50 ? 'amber' : 'red'),
    tile(v.extended, 'asked for extension', 'extended', v.extended ? 'amber' : ''),
    tile(v.qcDone ? `${v.qcFail}/${v.qcDone}` : '—', `QC failed${v.returned ? ` · ${v.returned} returned` : ''}`, 'qc', v.qcFail ? 'red' : ''),
  ] : [];

  return h('article', { class: 'vs-card' },
    h('div', { class: 'vs-head' },
      h('div', {}, h('h3', {}, v.name), v.code ? h('span', { class: 'muted-sm' }, `Code ${v.code}`) : null),
      h('div', { class: 'vs-stars', title: v.stars ? `${v.stars} of 5` : 'Not enough data' },
        v.stars ? '★'.repeat(v.stars) + '☆'.repeat(5 - v.stars) : h('span', { class: 'muted-sm' }, 'Not enough data'))),
    delivery.length ? h('div', { class: 'vs-tiles' }, delivery) : h('p', { class: 'muted-sm' }, 'No orders issued in this period.'),
    v.receipts ? h('p', { class: 'vs-line' }, `📦 Purchase to Display: ${v.receipts} receipt${v.receipts === 1 ? '' : 's'}`,
      v.pieces ? ` · ${v.pieces} pieces` : '',
      (v.huidYes || v.huidNo) ? ` · "Check for HUID": Yes ${v.huidYes} / No ${v.huidNo}` : '') : null,
    v.sales ? h('p', { class: 'vs-line vs-sales' }, '💰 Sales (Owners & MIS): ',
      h('b', {}, `₹${v.sales.revenue.toLocaleString('en-IN')}`), ` revenue · ₹${v.sales.gp.toLocaleString('en-IN')} GP`,
      v.sales.gpPct != null ? ` (${v.sales.gpPct}%)` : '', ` · ${v.sales.pcs} pcs sold`) : null,
    drill);
}

function orderRow(o) {
  const [label, tone] = STATUS[o.status] || ['—', 'gray'];
  const url = safeUrl(o.url);
  return h('li', { class: 'vs-order' },
    h('div', { class: 'vs-order-top' },
      h('b', {}, o.customer ? `${o.customer}` : `Order ${o.order}`),
      h('span', { class: `pill pill-${tone}` }, label + (o.lateDays ? ` · ${o.lateDays}d` : ''))),
    o.customer ? h('div', { class: 'muted-sm' }, o.order) : null,
    h('div', { class: 'task-meta' },
      `Issued ${fmtDay(o.issued)}`,
      o.firstPromise ? ` · First promise ${fmtDay(o.firstPromise)}` : ' · No Delivery Time',
      o.extended && o.agreed && o.agreed !== o.firstPromise ? ` · Extended to ${fmtDay(o.agreed)}` : '',
      o.received ? ` · Received ${fmtDateTime(o.received)}` : ''),
    (o.extended || o.qc || o.returned) ? h('div', { class: 'task-meta' },
      [o.extended ? `Extension (${o.extensionNote})` : '', o.qc ? `QC: ${o.qc}` : '', o.returned ? 'Returned to vendor' : ''].filter(Boolean).join(' · ')) : null,
    url ? h('a', { class: 'task-open', href: url, target: '_blank', rel: 'noopener' }, 'Open row in sheet ↗') : null);
}

function fmtDay(v) {
  const d = typeof v === 'number' ? new Date(v) : new Date(`${v}T00:00:00+05:30`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}
