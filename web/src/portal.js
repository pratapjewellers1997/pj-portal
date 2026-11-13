import { h, safeUrl, isPhone } from './dom.js';
import { renderWork } from './work.js';
import { renderAttendance } from './attendance.js';

// Function groups in the order agreed in the hand-off.
const GROUP_ORDER = [
  'Daily routine', 'Orders and repair', 'Stock and purchase', 'Sales and customer',
  'Money and compliance', 'People', 'Content and marketing', 'Analytics',
];

// Short tag + colour family for each Link type in the Registry.
const TYPE_STYLE = {
  'Doer dashboard': 'dash', 'MD dashboard': 'dash', 'Dashboard': 'dash',
  'Sheet': 'sheet', 'FMS': 'sheet', 'Checklist': 'form',
  'Form / web app': 'form', 'Document': 'doc', 'Flow chart': 'doc',
  'Training video': 'admin', 'Code file': 'admin', 'Drive folder': 'admin',
};

// Pages inside the portal. The address bar hash picks one (#work, #attendance).
const PAGES = [
  { id: 'systems', label: 'Systems' },
  { id: 'work', label: 'Work' },
  { id: 'attendance', label: 'Attendance' },
];

export function renderPortal(root, data, { onSignOut, session }) {
  const { user } = data;
  const view = h('div', { class: 'view' });
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Portal pages' });
  const ctx = { user, session, onSignOut };

  root.replaceChildren(
    h('header', { class: 'top' },
      h('div', { class: 'top-brand' },
        h('div', { class: 'monogram sm', 'aria-hidden': 'true' }, 'PJ'),
        h('div', {}, h('div', { class: 'top-name' }, 'Pratap Jewellers'), h('div', { class: 'top-sub' }, 'Staff portal'))),
      h('div', { class: 'top-user' },
        h('span', { class: `role role-${user.role.toLowerCase()}` }, user.role),
        h('button', { class: 'link-btn', type: 'button', onclick: onSignOut }, 'Sign out'))),
    tabs,
    view,
  );

  function route() {
    const id = (location.hash || '#systems').slice(1);
    const page = PAGES.find((p) => p.id === id) || PAGES[0];
    tabs.replaceChildren(...PAGES.map((p) => h('a', {
      href: `#${p.id}`, class: `tab${p.id === page.id ? ' on' : ''}`,
      'aria-current': p.id === page.id ? 'page' : null,
    }, p.id === 'work' && user.role === 'Doer' ? 'My work' : p.label)));
    if (page.id === 'work') renderWork(view, ctx);
    else if (page.id === 'attendance') renderAttendance(view, ctx);
    else renderSystems(view, data);
    window.scrollTo(0, 0);
  }
  window.onhashchange = route;
  route();
}

function renderSystems(root, data) {
  const { user, systems = [] } = data;
  const state = { query: '', group: 'All', open: new Set() };

  const groups = orderGroups([...new Set(systems.map((s) => s.group))]);
  const linkCount = systems.reduce((n, s) => n + s.links.length, 0);
  const firstName = (user.name || user.email).split(' ')[0];

  const main = h('main', { class: 'content', id: 'content' });
  const chips = h('nav', { class: 'groups', 'aria-label': 'Function groups' });
  const search = h('input', {
    class: 'search', type: 'search', placeholder: 'Search systems, sheets, dashboards…',
    'aria-label': 'Search', oninput: (e) => { state.query = e.target.value.trim().toLowerCase(); draw(); },
  });

  root.replaceChildren(
    h('section', { class: 'hero' },
      h('h1', {}, `Namaste, ${firstName}`),
      h('p', {}, [user.designation, `${systems.length} systems`, `${linkCount} links`].filter(Boolean).join(' · ')),
      search),
    h('div', { class: 'layout' }, chips, main),
    h('footer', { class: 'foot-note' }, `Updated ${formatTime(data.generatedAt)} · Pratap Jewellers MIS`),
  );

  function drawChips(visible) {
    const counts = Object.fromEntries(groups.map((g) => [g, 0]));
    visible.forEach((s) => { counts[s.group] = (counts[s.group] || 0) + 1; });
    chips.replaceChildren(
      ...['All', ...groups].map((g) => h('button', {
        type: 'button',
        class: `chip${state.group === g ? ' on' : ''}`,
        'aria-pressed': String(state.group === g),
        onclick: () => { state.group = g; draw(); },
      }, g, h('span', { class: 'count' }, g === 'All' ? visible.length : counts[g] || 0))),
    );
  }

  function draw() {
    const matched = systems.filter((s) => matches(s, state.query));
    drawChips(matched);
    const shown = matched.filter((s) => state.group === 'All' || s.group === state.group);

    if (!systems.length) {
      main.replaceChildren(h('p', { class: 'empty' }, 'No systems are shared with you yet. Please ask MIS (Rohan).'));
      return;
    }
    if (!shown.length) {
      main.replaceChildren(h('p', { class: 'empty' }, 'Nothing matches your search.'));
      return;
    }
    // While searching, every matching card opens so the hits are visible.
    const isOpen = (s) => Boolean(state.query) || state.open.has(s.id);
    const allOpen = shown.every(isOpen);
    const toggleAll = h('button', {
      type: 'button', class: 'toolbar-btn',
      onclick: () => {
        shown.forEach((s) => (allOpen ? state.open.delete(s.id) : state.open.add(s.id)));
        draw();
      },
    }, allOpen ? 'Collapse all' : 'Expand all');

    main.replaceChildren(
      h('div', { class: 'toolbar' },
        h('span', {}, `${shown.length} ${shown.length === 1 ? 'system' : 'systems'}`),
        !state.query && toggleAll),
      ...groups
        .map((g) => [g, shown.filter((s) => s.group === g)])
        .filter(([, list]) => list.length)
        .map(([g, list]) => h('section', { class: 'group' },
          h('h2', {}, g),
          h('div', { class: 'cards' }, list.map((s) => systemCard(s, isOpen(s), state.open))))),
    );
  }

  draw();
}

// A card starts collapsed: name, link count and a chevron. Tap to open.
function systemCard(sys, open, openSet) {
  const inactive = sys.lifecycle.toLowerCase() !== 'active';
  const blurb = sys.task || sys.purpose;
  const n = sys.links.length;
  const card = h('article', { class: `card-sys${inactive ? ' inactive' : ''}${open ? ' open' : ''}` });
  const head = h('button', {
    type: 'button', class: 'card-head', 'aria-expanded': String(open),
    onclick: () => {
      const nowOpen = !card.classList.contains('open');
      card.classList.toggle('open', nowOpen);
      head.setAttribute('aria-expanded', String(nowOpen));
      nowOpen ? openSet.add(sys.id) : openSet.delete(sys.id);
    },
  },
  h('span', { class: 'card-title' }, sys.name),
  h('span', { class: 'card-meta' },
    inactive && h('span', { class: 'badge' }, 'Inactive'),
    h('span', { class: 'count-pill' }, `${n} ${n === 1 ? 'link' : 'links'}`),
    h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
  card.append(head,
    h('div', { class: 'card-body' },
      blurb && h('p', { class: 'blurb' }, blurb),
      h('ul', { class: 'links' }, sys.links.map((l) => h('li', {}, linkButton(sys, l))))));
  return card;
}

function linkButton(sys, link) {
  const style = TYPE_STYLE[link.type] || 'doc';
  return h('button', {
    type: 'button',
    class: 'link',
    onclick: () => openLink(sys, link),
  },
  h('span', { class: `tag tag-${style}` }, link.type || 'Link'),
  h('span', { class: 'label' }, link.label));
}

// Phones: always open in a new tab (embeds of private Google files often
// fail on phones). Desktop: "Embed" links open in the viewer.
function openLink(sys, link) {
  const url = safeUrl(link.url);
  const embed = safeUrl(link.embedUrl);
  if (link.showAs === 'Embed' && embed && !isPhone()) {
    openViewer(sys, link, embed, url);
  } else if (url) {
    window.open(url, '_blank', 'noopener');
  }
}

function openViewer(sys, link, embedUrl, url) {
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const overlay = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': link.label },
    h('div', { class: 'viewer-bar' },
      h('div', { class: 'viewer-title' }, h('strong', {}, link.label), h('span', {}, ` · ${sys.name}`)),
      h('div', { class: 'viewer-actions' },
        url && h('a', { class: 'btn-gold', href: url, target: '_blank', rel: 'noopener' },
          link.open ? 'Open original' : 'Open in new tab'),
        h('button', { class: 'btn-ghost', type: 'button', onclick: close }, 'Close'))),
    h('iframe', { src: embedUrl, title: link.label, allow: 'clipboard-write', referrerpolicy: 'no-referrer-when-downgrade' }),
    h('p', { class: 'viewer-hint' }, 'Blank or asking to sign in? Use the gold button to open it in a new tab.'));
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
}

function matches(sys, q) {
  if (!q) return true;
  const hay = [sys.name, sys.group, sys.purpose, sys.task, ...sys.links.flatMap((l) => [l.label, l.type])]
    .join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

function orderGroups(list) {
  const known = GROUP_ORDER.filter((g) => list.includes(g));
  return [...known, ...list.filter((g) => !GROUP_ORDER.includes(g)).sort()];
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
