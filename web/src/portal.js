import { h, safeUrl, isPhone } from './dom.js';
import { loadWork, ymd, skeletonToday, skeletonWork } from './workdata.js';
// Eagerly loaded: needed on the home screen immediately
import { karigarLine } from './karigar.js';
import { checklistLine } from './checklists.js';
import { messagesButton } from './messages.js';
import { noticeBoard, kudosWall } from './social.js';

// Lazy-loaded page modules — only fetched when navigated to
const lazy = {
  work:       () => import('./work.js'),
  attendance: () => import('./attendance.js'),
  board:      () => import('./board.js'),
  scores:     () => import('./scores.js'),
  profile:    () => import('./profile.js'),
  insights:   () => import('./insights.js'),
  search:     () => import('./search.js'),
  vendors:    () => import('./vendors.js'),
  checklists: () => import('./checklists.js'),
  messages:   () => import('./messages.js'),
  chatadmin:  () => import('./chatadmin.js'),
};

/** Load a page module and call its render function, showing a skeleton while it loads */
async function lazyRender(view, moduleKey, renderName, args) {
  view.replaceChildren(h('div', { class: 'skeleton' },
    moduleKey === 'work' ? skeletonWork() : h('div', { style: 'padding:24px;' },
      ...Array.from({ length: 3 }, () => h('div', { class: 'skeleton-card skeleton' })))));
  const mod = await lazy[moduleKey]();
  mod[renderName](view, ...args);
}

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
  { id: 'board', label: 'Board' },
  { id: 'scores', label: 'Scores' },
  { id: 'insights', label: 'Insights', notFor: 'Doer' },
  { id: 'attendance', label: 'Attendance' },
];

export function renderPortal(root, data, { onSignOut, session }) {
  const { user } = data;
  const pages = PAGES.filter((p) => p.notFor !== user.role);
  const view = h('div', { class: 'view' });
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Portal pages' });
  const ctx = { user, session, onSignOut, systems: data.systems || [], linkButton };

  root.replaceChildren(
    h('header', { class: 'top' },
      h('div', { class: 'top-brand' },
        h('img', { src: './brand/monogram.png', alt: '', class: 'logo-mono', width: '40', height: '40' }),
        h('div', {}, h('div', { class: 'top-name' }, 'Pratap Jewellers'), h('div', { class: 'top-sub' }, 'Staff portal'))),
      h('div', { class: 'top-user' },
        h('a', { href: '#search', class: 'top-search', 'aria-label': 'Search everything', title: 'Search' }, '🔍'),
        messagesButton(ctx),
        h('span', { class: `role role-${user.role.toLowerCase()}` }, user.role),
        h('button', { class: 'link-btn', type: 'button', onclick: onSignOut }, 'Sign out'))),
    tabs,
    view,
  );

  function route() {
    const [id, param] = (location.hash || '#systems').slice(1).split('/');
    const tabLabel = (p) => p.id === 'work' && user.role === 'Doer' ? 'My work' : p.label;
    const drawTabs = (activeId) => {
      tabs.replaceChildren(...pages.map((p) => h('a', {
        href: `#${p.id}`, class: `tab${p.id === activeId ? ' on' : ''}`,
        'aria-current': p.id === activeId ? 'page' : null,
      }, tabLabel(p))));
    };

    if (id === 'checklists' && user.role !== 'Doer') {
      drawTabs('');
      lazyRender(view, 'checklists', 'renderChecklists', [ctx]);
      window.scrollTo(0, 0);
      return;
    }
    if (id === 'vendors') {
      drawTabs('');
      lazyRender(view, 'vendors', 'renderVendors', [ctx]);
      window.scrollTo(0, 0);
      return;
    }
    if (id === 'chatadmin' && user.role !== 'Doer') {
      drawTabs('');
      lazyRender(view, 'chatadmin', 'renderChatAdmin', [ctx]);
      window.scrollTo(0, 0);
      return;
    }
    if (id === 'messages') {
      drawTabs('');
      lazyRender(view, 'messages', 'renderMessages', [ctx, decodeURIComponent(location.hash.split('/').slice(1).join('/') || '')]);
      window.scrollTo(0, 0);
      return;
    }
    if (id === 'search') {
      drawTabs('');
      lazyRender(view, 'search', 'renderSearch', [ctx, decodeURIComponent((location.hash.split('/').slice(1).join('/')) || '')]);
      window.scrollTo(0, 0);
      return;
    }
    if (id === 'person') {
      drawTabs('');
      lazyRender(view, 'profile', 'renderProfile', [ctx, decodeURIComponent(param || '')]);
      window.scrollTo(0, 0);
      return;
    }
    const page = pages.find((p) => p.id === id) || pages[0];
    drawTabs(page.id);
    if (page.id === 'work') lazyRender(view, 'work', 'renderWork', [ctx]);
    else if (page.id === 'board') lazyRender(view, 'board', 'renderBoard', [ctx]);
    else if (page.id === 'scores') lazyRender(view, 'scores', 'renderScores', [ctx]);
    else if (page.id === 'insights') lazyRender(view, 'insights', 'renderInsights', [ctx]);
    else if (page.id === 'attendance') lazyRender(view, 'attendance', 'renderAttendance', [ctx]);
    else renderSystems(view, data, ctx);
    window.scrollTo(0, 0);
  }
  window.onhashchange = route;

  // Auto-refresh: re-render the active dashboard page when the user returns
  // to a tab that has been hidden long enough for the memo cache to expire.
  // The 10-min memo TTL in workdata/insights/vendors/checklists ensures a fresh
  // API call happens automatically; we just need to trigger the re-render.
  let hiddenSince = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenSince = Date.now(); return; }
    // Re-render if hidden for ≥ 10 min (matches MEMO_TTL)
    if (hiddenSince && Date.now() - hiddenSince >= 10 * 60 * 1000) route();
    hiddenSince = 0;
  });

  route();
}

function renderSystems(root, data, ctx) {
  const { user, systems = [] } = data;
  const state = { query: '', group: 'All', open: new Set() };

  const groups = orderGroups([...new Set(systems.map((s) => s.group))]);
  const linkCount = systems.reduce((n, s) => n + s.links.length, 0);
  const firstName = (user.name || user.email).split(' ')[0];

  const main = h('main', { class: 'content', id: 'content' });
  const chips = h('nav', { class: 'groups', 'aria-label': 'Function groups' });
  const everywhere = h('a', { class: 'gs-hint', hidden: true });
  const search = h('input', {
    class: 'search', type: 'search', placeholder: 'Search systems, customers, orders, people…',
    'aria-label': 'Search', enterkeyhint: 'search',
    oninput: (e) => {
      const raw = e.target.value.trim();
      state.query = raw.toLowerCase();
      everywhere.hidden = raw.length < 2;
      everywhere.href = `#search/${encodeURIComponent(raw)}`;
      everywhere.textContent = `🔎 Search everywhere for “${raw}” →`;
      draw();
    },
    onkeydown: (e) => {
      const raw = e.target.value.trim();
      if (e.key === 'Enter' && raw.length >= 2) location.hash = `#search/${encodeURIComponent(raw)}`;
    },
  });

  root.replaceChildren(...[
    h('section', { class: 'hero' },
      h('h1', {}, `Namaste, ${firstName}`),
      h('p', {}, [user.designation, `${systems.length} systems`, `${linkCount} links`].filter(Boolean).join(' · ')),
      search,
      everywhere,
      installHint()),
    noticeBoard(ctx),
    todayCard(ctx),
    karigarLine(ctx),
    user.role !== 'Doer' ? checklistLine(ctx) : null,
    kudosWall(ctx),
    user.role !== 'Doer' ? activityLine(systems) : null,
    h('div', { class: 'layout' }, chips, main),
    h('footer', { class: 'foot-note' }, `Updated ${formatTime(data.generatedAt)} · Pratap Jewellers MIS`),
  ].filter(Boolean));

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
    activityDot(latestEdit(sys)),
    h('span', { class: 'count-pill' }, `${n} ${n === 1 ? 'link' : 'links'}`),
    h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
  card.append(head,
    h('div', { class: 'card-body' },
      h('div', { class: 'card-inner' },
        blurb && h('p', { class: 'blurb' }, blurb),
        h('ul', { class: 'links' }, sys.links.map((l) => h('li', {}, linkButton(sys, l)))))));
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
  h('span', { class: 'label' }, link.label),
  link.edited && h('span', { class: `edited ${isFresh(link.edited) ? 'fresh' : 'stale'}`,
    title: `Last edited ${new Date(link.edited).toLocaleString('en-IN')}${link.editedBy ? ' by ' + link.editedBy : ''}` },
  ago(link.edited)));
}

/* ---------- Sheet activity: green = edited in the last 24 h, red = not ---------- */

const DAY = 864e5;
const isFresh = (ms) => Date.now() - ms < DAY;
const latestEdit = (sys) => sys.links.reduce((m, l) => Math.max(m, l.edited || 0), 0);

function ago(ms) {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function activityDot(ms) {
  if (!ms) return null;
  return h('span', {
    class: `dot ${isFresh(ms) ? 'dot-green' : 'dot-red'}`,
    title: `${isFresh(ms) ? 'Active' : 'Not edited'} · last edit ${ago(ms)}`,
    'aria-label': `${isFresh(ms) ? 'Active' : 'Not edited in 24 hours'}, last edit ${ago(ms)}`,
  });
}

/** One line for Managers and above: how many sheets were edited in the last 24 h, with the list. */
function activityLine(systems) {
  const seen = new Map();
  systems.forEach((s) => s.links.forEach((l) => {
    if (!l.edited) return;
    const id = (String(l.url).match(/spreadsheets\/d\/([\w-]+)/) || [])[1] || l.url;
    if (!seen.has(id)) seen.set(id, { label: l.label, system: s.name, edited: l.edited, by: l.editedBy || '' });
  }));
  const rows = [...seen.values()].sort((a, b) => a.edited - b.edited);
  if (!rows.length) return null;
  const fresh = rows.filter((r) => isFresh(r.edited)).length;
  return h('details', { class: 'activity' },
    h('summary', {},
      h('span', { class: 'dot dot-green', 'aria-hidden': 'true' }), ` ${fresh} active`,
      h('span', { class: 'sep' }, '·'),
      h('span', { class: 'dot dot-red', 'aria-hidden': 'true' }), ` ${rows.length - fresh} not edited in 24 h`,
      h('span', { class: 'muted-sm' }, ' · tap to see sheets')),
    h('ul', { class: 'activity-list' }, rows.map((r) => h('li', {},
      activityDot(r.edited),
      h('span', { class: 'act-label' }, r.label),
      h('span', { class: 'muted-sm' }, `${r.system} · ${ago(r.edited)}${r.by ? ' · ' + r.by : ''}`)))));
}

/* ---------- Today card: Doers see their day, others see the team ---------- */

function todayCard(ctx) {
  const box = h('section', { class: 'today', 'aria-live': 'polite' }, skeletonToday());
  const today = ymd(new Date());
  loadWork(ctx.session, today, today).then((d) => {
    const isDoer = d.scope === 'self';
    const due = d.tasks.filter((t) => t.status === 'due').length;
    const overdue = d.tasks.filter((t) => t.status === 'overdue').length;
    const doneToday = d.tasks.filter((t) => !t.carry && ['on_time', 'late', 'done'].includes(t.status)).length;
    const todayTotal = d.tasks.filter((t) => !t.carry).length;
    const att = d.attendance.filter((a) => a.date === today);
    const parts = [];
    if (isDoer) {
      const me = att[0];
      parts.push(
        stat(due, 'due today', due ? 'amber' : ''),
        stat(overdue, 'overdue', overdue ? 'red' : ''),
        stat(`${doneToday}/${todayTotal}`, 'done today', 'green'),
        h('div', { class: 'today-att' }, me
          ? `Checked in ${me.checkIn}${me.late ? ` · late ${me.lateBy} min` : ' · on time'}`
          : 'Not checked in yet today'));
    } else {
      const late = att.filter((a) => a.late).length;
      parts.push(
        stat(overdue, 'overdue tasks', overdue ? 'red' : ''),
        stat(due, 'still due today', due ? 'amber' : ''),
        stat(todayTotal ? `${Math.round((doneToday / todayTotal) * 100)}%` : '—', 'of today done', 'green'),
        stat(att.length, `checked in${late ? ` · ${late} late` : ''}`));
    }
    const pc = pratapCard(d.pratap, isDoer);
    if (pc) box.after(pc);
    box.replaceChildren(
      h('div', { class: 'today-head' }, h('strong', {}, isDoer ? 'Your day' : 'Team today'),
        h('span', { class: 'today-links' },
          isDoer && h('a', { href: '#person/', class: 'today-link' }, 'My profile'),
          h('a', { href: '#work', class: 'today-link' }, isDoer ? 'Open my work →' : 'Open work →'))),
      h('div', { class: 'today-stats' }, parts));
  }).catch(() => box.remove());
  return box;
}

/* ---------- Today at Pratap: anniversaries this week and new joiners ---------- */

function pratapCard(p, isDoer) {
  if (!p) return null;
  const ann = p.anniversaries || [], joined = p.joined || [];
  if (!ann.length && !joined.length) return null;
  const now = ann.filter((a) => a.inDays === 0), soon = ann.filter((a) => a.inDays > 0);
  const yrs = (n) => `${n} year${n === 1 ? '' : 's'}`;
  const day = (k) => new Date(`${k}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const profile = (x) => `#person/${encodeURIComponent(x.email)}`;
  // Doers can only open their own profile, so names are plain text for them.
  const nameEl = (x) => (isDoer ? h('b', {}, x.name) : h('a', { href: profile(x), class: 'pc-name' }, x.name));
  const row = (emoji, x, text, action) => h('li', {},
    h('span', { class: 'pc-emoji', 'aria-hidden': 'true' }, emoji),
    h('div', { class: 'pc-text' }, nameEl(x), h('span', {}, text)),
    action || null);
  return h('section', { class: 'pratap' },
    h('div', { class: 'pc-head' }, h('strong', {}, '🎂 Today at Pratap'), h('span', { class: 'muted-sm' }, day(p.date))),
    now.length ? h('ul', { class: 'pc-list pc-now' }, now.map((a) => row('🎉', a,
      `completes ${yrs(a.years)} with Pratap Jewellers today`,
      isDoer ? null : h('a', { href: profile(a), class: 'pc-act' }, '👏 Appreciate')))) : null,
    soon.length ? h('div', { class: 'pc-sub' }, 'Work anniversaries this week') : null,
    soon.length ? h('ul', { class: 'pc-list' }, soon.map((a) => row('📅', a,
      `${yrs(a.years)} · ${a.inDays === 1 ? 'tomorrow' : day(a.date)}`))) : null,
    joined.length ? h('div', { class: 'pc-sub' }, 'Welcome to the team') : null,
    joined.length ? h('ul', { class: 'pc-list' }, joined.map((j) => row('👋', j,
      `${j.designation ? j.designation + ' · ' : ''}joined ${j.days === 0 ? 'today' : day(j.date)}`))) : null);
}

function stat(value, label, tone = '') {
  return h('div', { class: `today-stat${tone ? ' t-' + tone : ''}` }, h('b', {}, value), h('span', {}, label));
}

/* ---------- Install as an app ---------- */

function installHint() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return null;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const wrap = h('div', { class: 'install' });
  const showButton = () => {
    wrap.replaceChildren(h('button', {
      type: 'button', class: 'btn-install',
      onclick: async () => {
        const e = window.__pjInstall; if (!e) return;
        e.prompt(); await e.userChoice; window.__pjInstall = null; wrap.remove();
      },
    }, 'Install app on this phone'));
  };
  if (window.__pjInstall) showButton();
  else if (isIos) wrap.append(h('p', { class: 'install-tip' }, 'iPhone: tap Share, then "Add to Home Screen" to install.'));
  document.addEventListener('pj-installable', showButton, { once: true });
  return wrap;
}

// Phones: always open in a new tab (embeds of private Google files often
// fail on phones). Desktop: "Embed" links open in the viewer.
function openLink(sys, link) {
  const url = safeUrl(link.url);
  const embed = safeUrl(link.embedUrl);
  // Drive folders can't be shown inside the portal (Google answers 403), so
  // they always open in a new tab, whatever "Show as" says in the Registry.
  const isFolder = /drive\.google\.com\/(drive\/)?(u\/\d+\/)?folders\//.test(String(link.url || ''));
  if (link.showAs === 'Embed' && embed && !isPhone() && !isFolder) {
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
