import { h, safeUrl } from './dom.js';
import { callApi } from './api.js';
import { fmtDateTime, loadingBox, ERRORS } from './workdata.js';

// Items with karigars (Step 10): sent to a karigar from the Repair web app and
// not received back yet. Doers see items they created or have to follow up /
// bring back (the API filters it). Oldest first.

const DAY = 864e5;
let memo = null;
const state = { karigar: 'All' };

export function loadKarigar(session) {
  if (!memo) memo = callApi('karigar', { session }).catch((e) => { memo = null; throw e; });
  return memo;
}

const daysWith = (it) => (it.at ? Math.max(0, Math.floor((Date.now() - it.at) / DAY)) : null);
const toneOf = (d) => (d == null ? 'gray' : d > 7 ? 'red' : d > 3 ? 'amber' : 'green');
const daysText = (d) => (d == null ? 'date not known' : d === 0 ? 'since today' : `${d} day${d === 1 ? '' : 's'}`);

/** Compact line for the home page. Hidden when there is nothing with a karigar. */
export function karigarLine(ctx) {
  const box = h('a', { href: '#board', class: 'kg-line', hidden: true });
  loadKarigar(ctx.session).then((d) => {
    if (!d.items.length) return;
    const old = d.items.filter((it) => daysWith(it) > 7).length;
    const oldest = Math.max(...d.items.map((it) => daysWith(it) || 0));
    box.replaceChildren(
      h('span', { class: 'kg-ico', 'aria-hidden': 'true' }, '🔨'),
      h('span', { class: 'kg-text' },
        h('b', {}, `${d.items.length} item${d.items.length === 1 ? '' : 's'} with karigars`),
        h('span', {}, d.scope === 'self' ? ' · yours to follow up' : '',
          ` · oldest ${daysText(oldest)}`, old ? ` · ${old} over 7 days` : '')),
      old ? h('span', { class: 'pill pill-red' }, `${old} late`) : null,
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
    box.hidden = false;
  }).catch(() => box.remove());
  return box;
}

/** Section for the Board page. */
export function karigarSection(ctx) {
  const box = h('section', { class: 'kg', id: 'karigars' }, loadingBox('Loading items with karigars…'));
  loadKarigar(ctx.session)
    .then((d) => draw(box, d))
    .catch((e) => box.replaceChildren(h('div', { class: 'notice error' },
      h('p', {}, ERRORS[e.message] || 'Could not load items with karigars.'))));
  return box;
}

function draw(box, d) {
  const title = h('h2', { class: 'section-title' }, '🔨 Items with karigars', h('span', { class: 'count' }, d.items.length));
  if (!d.configured) {
    box.replaceChildren(title, h('p', { class: 'muted-sm' }, 'Not set up yet. The portal will read the Repair web app after the next data refresh.'));
    return;
  }
  if (!d.items.length) {
    box.replaceChildren(title, h('p', { class: 'empty' },
      d.scope === 'self' ? 'Nothing of yours is with a karigar right now.' : 'Nothing is with a karigar right now.'));
    return;
  }
  const counts = new Map();
  d.items.forEach((it) => counts.set(it.karigar, (counts.get(it.karigar) || 0) + 1));
  const karigars = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (state.karigar !== 'All' && !counts.has(state.karigar)) state.karigar = 'All';
  const shown = d.items.filter((it) => state.karigar === 'All' || it.karigar === state.karigar);
  const late = d.items.filter((it) => daysWith(it) > 7).length;
  const nameOf = (e) => d.names[e] || e;

  box.replaceChildren(
    title,
    h('p', { class: 'muted-sm' },
      d.scope === 'self' ? 'Items you gave, or have to follow up or bring back. ' : 'Sent to a karigar and not received back yet. ',
      `Oldest first${late ? ` · ${late} with a karigar for more than 7 days` : ''}.`),
    h('div', { class: 'kg-chips', role: 'group', 'aria-label': 'Filter by karigar' },
      ...[['All', d.items.length], ...karigars].map(([k, n]) => h('button', {
        type: 'button', class: `chip${state.karigar === k ? ' on' : ''}`, 'aria-pressed': String(state.karigar === k),
        onclick: () => { state.karigar = k; draw(box, d); },
      }, k, h('span', { class: 'count' }, n)))),
    h('div', { class: 'kg-list' }, shown.map((it) => {
      const days = daysWith(it);
      const tone = toneOf(days);
      const url = safeUrl(it.url);
      return h('article', { class: `kg-card kg-${tone}` },
        h('div', { class: 'kg-top' },
          h('strong', {}, [it.product || 'Item', it.weight ? `${it.weight} g` : ''].filter(Boolean).join(' · ')),
          h('span', { class: `pill pill-${tone}` }, daysText(days))),
        h('div', { class: 'muted-sm' }, [it.customer, it.id].filter(Boolean).join(' · ')),
        it.description ? h('div', { class: 'kg-desc' }, it.description) : null,
        h('div', { class: 'task-meta' }, `With ${it.karigar}${it.at ? ' · given ' + fmtDateTime(it.at) : ''}`),
        it.who.length ? h('div', { class: 'task-who' }, it.who.map(nameOf).join(', ')) : h('div', { class: 'task-who warn' }, 'No one assigned'),
        url ? h('div', { class: 'task-actions' }, h('a', { class: 'task-open', href: url, target: '_blank', rel: 'noopener' }, 'Open in sheet ↗')) : null);
    })),
    h('p', { class: 'muted-sm' }, 'Green: up to 3 days · Amber: 4–7 days · Red: more than 7 days. From the Repair web app (Repair_Issued / Repair_Received), refreshed every 10 minutes.'));
}
