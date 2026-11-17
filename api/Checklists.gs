/**
 * PJ Portal API: Leaving staff + New joiner checklists (Step 12).
 *
 * Who: Admin, Owner and Manager (incl. EA). Doers are refused.
 *
 * Leaving list  = people marked Active = No in the Registry People tab, plus anyone
 *                 whose leaving checklist was started early (notice period).
 * Joining list  = active people who joined in the last 45 days (EMPLOYEES Date_Of_Joining),
 *                 plus anyone whose joining checklist was started by hand.
 *
 * Each checklist has:
 *   - Automatic checks, worked out by the portal (read-only):
 *       Leaving: portal access removed (Active = No), open work still in their name
 *                (FMS steps, checklist rows, delegations, karigar items), Google Drive
 *                files they can still open (Registry "Sharing audit").
 *       Joining: added as Active, found in Attendance (EMPLOYEES), Drive access still
 *                pending in the Registry "Grant plan", work assigned.
 *   - Your own items, from the Registry tab "Portal Checklist Items" (edit it any time).
 *     Ticks are saved in "Portal Checklist Log" (one row per tick, latest wins, with
 *     who and when). These two tabs are created automatically on first use.
 *
 * The portal NEVER changes Google Drive sharing, the People tab or any source sheet.
 */

var CL_ITEMS_TAB = 'Portal Checklist Items';
var CL_LOG_TAB = 'Portal Checklist Log';
var CL_LISTS = ['Leaving', 'Joining'];
var CL_JOIN_DAYS = 45;
var CL_START = '__start__';
var CL_CACHE = 'cl_v1';

var CL_HEADERS = {};
CL_HEADERS[CL_ITEMS_TAB] = ['Checklist', 'Item', 'Who does it', 'Order', 'Active'];
CL_HEADERS[CL_LOG_TAB] = ['Checklist', 'Person email', 'Person', 'Item', 'Done', 'By', 'By name', 'At', 'Note'];

/** Registers the two tabs with Social.gs sheetOf_ (done at call time, so file order does not matter). */
function clHeaders_() {
  HEADERS[CL_ITEMS_TAB] = CL_HEADERS[CL_ITEMS_TAB];
  HEADERS[CL_LOG_TAB] = CL_HEADERS[CL_LOG_TAB];
}

var CL_SEED = [
  ['Leaving', 'Shop keys / locker keys returned', 'Manager', 1],
  ['Leaving', 'ID card and uniform returned', 'Manager', 2],
  ['Leaving', 'Gold / stock / items with them checked and returned', 'Manager', 3],
  ['Leaving', 'Removed from staff WhatsApp groups', 'MIS', 4],
  ['Leaving', 'Shared logins they knew changed (store, ERP, Wi-Fi)', 'MIS', 5],
  ['Leaving', 'Marked as left in the Attendance system', 'MIS', 6],
  ['Leaving', 'Removed from System Master (doer / editor columns)', 'MIS', 7],
  ['Leaving', 'Final settlement done', 'Owner', 8],
  ['Joining', 'Documents collected (ID proof, address proof, photo)', 'Manager', 1],
  ['Joining', 'Address verification done (Verification system)', 'MIS', 2],
  ['Joining', 'Added to the Attendance system (EMPLOYEES)', 'MIS', 3],
  ['Joining', 'Added to System Master and the Registry People tab', 'MIS', 4],
  ['Joining', 'ID card and uniform given', 'Manager', 5],
  ['Joining', 'Added to staff WhatsApp groups', 'MIS', 6],
  ['Joining', 'Shown how to use the portal, checklist and FMS forms', 'MIS', 7],
  ['Joining', 'Introduced to the team and their buddy', 'Manager', 8]
];

/* ================= Read ================= */

/** checklists {session} -> {ok, leaving, joining, people, items} */
function actionChecklists_(req) {
  var user = findPerson_(readSession_(req.session));
  if (user.role === 'Doer') throw apiError_('forbidden');
  var cl = loadChecklistData_(false);
  var data = loadSnapshot_();
  var D = 864e5, now = Date.now();

  var people = loadPeople_(false).filter(function (p) {
    return PORTAL_ROLES.indexOf(p.role) > -1 && p.accountType !== 'Alias';
  });
  var nameOf = {};
  loadPeople_(false).forEach(function (p) { p.emails.forEach(function (e) { nameOf[e] = p.name; }); });

  var state = {};
  cl.log.forEach(function (r) { state[r.list + '|' + r.email + '|' + r.item] = r; });   // log is oldest first: latest wins
  var started = function (list, p) {
    return p.emails.some(function (e) { var s = state[list + '|' + e + '|' + CL_START]; return s && s.done; });
  };

  var doj = {};
  ((data && data.joins) || []).forEach(function (j) { if (j.email && /^\d{4}-\d{2}-\d{2}$/.test(j.doj)) doj[j.email] = j.doj; });

  var leaving = [], joining = [];
  people.forEach(function (p) {
    var d0 = p.emails.map(function (e) { return doj[e]; }).filter(Boolean)[0] || '';
    var daysIn = d0 ? Math.floor((now - Date.parse(d0 + 'T00:00:00+05:30')) / D) : null;
    if (!p.active || started('Leaving', p)) {
      leaving.push(checklistFor_('Leaving', p, d0, cl, state, data, nameOf));
    } else if ((daysIn != null && daysIn >= 0 && daysIn <= CL_JOIN_DAYS) || started('Joining', p)) {
      joining.push(checklistFor_('Joining', p, d0, cl, state, data, nameOf));
    }
  });
  var order = function (a, b) { return (a.complete - b.complete) || (a.name < b.name ? -1 : 1); };

  return {
    ok: true, canTick: true,
    leaving: leaving.sort(order), joining: joining.sort(order),
    // people who can be started by hand (active, not already on a list)
    people: people.filter(function (p) { return p.active; }).map(function (p) {
      return { email: p.emails[0], name: p.name, designation: p.designation, role: p.role };
    }),
    sharingCheckedAt: cl.sharingCheckedAt, builtAt: data ? data.builtAt : null
  };
}

function checklistFor_(list, p, doj, cl, state, data, nameOf) {
  var emails = p.emails, has = function (arr) { return arr.some(function (e) { return emails.indexOf(e) > -1; }); };
  var tick = function (item) {
    var best = null;
    emails.forEach(function (e) { var s = state[list + '|' + e + '|' + item]; if (s && (!best || s.at > best.at)) best = s; });
    return best;
  };

  // Your items
  var items = cl.items.filter(function (it) { return it.list === list; }).map(function (it) {
    var s = tick(it.item);
    return { item: it.item, who: it.who, done: Boolean(s && s.done),
             by: s ? (nameOf[s.by] || s.byName || s.by) : '', at: s ? s.at : null, note: s ? s.note : '' };
  });

  // Automatic checks
  var auto = [];
  var tasks = (data && data.tasks) || [];
  var open = tasks.filter(function (t) { return !t.d && has(t.w); });
  var bySys = {};
  open.forEach(function (t) {
    var g = bySys[t.n] = bySys[t.n] || { system: t.n, type: t.y, count: 0, rows: [] };
    g.count++;
    if (g.rows.length < 5) g.rows.push({ label: t.l || t.k, step: t.t, planned: t.p, url: (data.bases[t.b] || '') + t.u });
  });
  var karigar = ((data && data.karigar) || []).filter(function (k) { return has(k.by); });
  if (karigar.length) {
    bySys['Items with karigars'] = { system: 'Items with karigars', type: 'Karigar', count: karigar.length,
      rows: karigar.slice(0, 5).map(function (k) { return { label: k.cust || k.id, step: k.prod + ' with ' + k.kar, planned: k.at, url: (data.bases[k.b] || '') + k.u }; }) };
  }
  var work = Object.keys(bySys).map(function (k) { return bySys[k]; }).sort(function (a, b) { return b.count - a.count; });
  var workCount = work.reduce(function (n, g) { return n + g.count; }, 0);

  if (list === 'Leaving') {
    auto.push({ id: 'access', label: 'Portal access removed (People tab: Active = No)', done: !p.active,
                detail: p.active ? 'Still Active = Yes. Set Active = No in the Registry People tab; the portal stops them within 5 minutes.' : '' });
    auto.push({ id: 'work', label: 'Open work handed over to someone else', done: data ? workCount === 0 : false,
                detail: !data ? 'Work data is loading, try again in a minute.' : workCount ? workCount + ' open item(s) still in their name. Reassign in the sheet (Doer / Email column, System Master or Doer Emails tab).' : '',
                groups: work });
    var files = [];
    emails.forEach(function (e) { files = files.concat(cl.sharing[e] || []); });
    var owned = files.filter(function (f) { return /owner/i.test(f.role); });
    var other = files.filter(function (f) { return !/owner/i.test(f.role); });
    auto.push({ id: 'drive', label: 'Google Drive access removed', done: files.length === 0,
                detail: files.length ? other.length + ' file(s) they can still open' + (owned.length ? ' · they OWN ' + owned.length + ' file(s): transfer ownership first' : '') + '. Open each file → Share → remove them. Updates after the next Registry sharing check.' : '',
                files: owned.concat(other).slice(0, 200) });
  } else {
    auto.push({ id: 'active', label: 'In the People tab as Active', done: p.active, detail: '' });
    auto.push({ id: 'attendance', label: 'Found in the Attendance system (EMPLOYEES)', done: Boolean(doj),
                detail: doj ? '' : 'Not matched in EMPLOYEES yet (name + email), or no Date_Of_Joining.' });
    var grantRows = [];
    emails.forEach(function (e) { grantRows = grantRows.concat(cl.grants[e] || []); });
    var pending = grantRows.filter(function (g) { return /pending|failed/i.test(g.status); });
    auto.push({ id: 'grants', label: 'Google Drive access given (Registry Grant plan)', done: pending.length === 0,
                detail: pending.length ? pending.length + ' file(s) still Pending / Failed in the Grant plan. Run Registry → Grant Viewer access now.' : '',
                files: pending.slice(0, 200) });
    auto.push({ id: 'work', label: 'Has work assigned in the portal', done: workCount > 0,
                detail: workCount ? '' : 'No tasks found yet. Add them as Doer in the FMS / checklist sheets.', groups: work });
  }

  var done = items.filter(function (i) { return i.done; }).length + auto.filter(function (a) { return a.done; }).length;
  var total = items.length + auto.length;
  var st = tick(CL_START);
  return {
    list: list, email: emails[0], name: p.name, designation: p.designation, role: p.role, active: p.active,
    doj: doj, startedBy: st && st.done ? (nameOf[st.by] || st.byName) : '', startedAt: st && st.done ? st.at : null,
    items: items, auto: auto, done: done, total: total, complete: done === total ? 1 : 0
  };
}

/** Registry reads for checklists (5-minute cache): items, ticks, Sharing audit, Grant plan. */
function loadChecklistData_(fresh) {
  var cache = CacheService.getScriptCache();
  if (!fresh) {
    var hit = cache.get(CL_CACHE);
    if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  }
  clHeaders_();
  var ss = SpreadsheetApp.openById(cfg_('REGISTRY_ID'));
  var itemsSh = ensureChecklistItems_(ss);
  var iv = itemsSh.getDataRange().getDisplayValues();
  var ih = lowerRow_(iv[0]);
  var items = iv.slice(1).map(function (r) {
    return { list: String(r[ih.indexOf('checklist')] || '').trim(), item: String(r[ih.indexOf('item')] || '').trim(),
             who: String(r[ih.indexOf('who does it')] || '').trim(), order: Number(r[ih.indexOf('order')]) || 99,
             active: ih.indexOf('active') === -1 ? true : String(r[ih.indexOf('active')]).trim() === '' || isTrue_(r[ih.indexOf('active')]) };
  }).filter(function (it) { return it.active && it.item && CL_LISTS.indexOf(it.list) > -1; })
    .sort(function (a, b) { return a.order - b.order; });

  var log = [];
  var logSh = ss.getSheetByName(CL_LOG_TAB);
  if (logSh && logSh.getLastRow() > 1) {
    logSh.getRange(2, 1, logSh.getLastRow() - 1, CL_HEADERS[CL_LOG_TAB].length).getValues().forEach(function (r) {
      var at = r[7] instanceof Date ? r[7].getTime() : Date.parse(r[7]) || 0;
      log.push({ list: String(r[0]), email: normaliseEmail_(r[1]), item: String(r[3]), done: isTrue_(r[4]),
                 by: normaliseEmail_(r[5]), byName: String(r[6] || ''), at: at, note: String(r[8] || '') });
    });
    log.sort(function (a, b) { return a.at - b.at; });
  }

  var sharing = {}, checkedAt = '';
  var sa = ss.getSheetByName('Sharing audit');
  if (sa && sa.getLastRow() > 1) {
    var sv = sa.getDataRange().getDisplayValues(), sh = lowerRow_(sv[0]);
    var c = function (n) { return sh.indexOf(n); };
    var cId = c('file id'), cName = c('file name'), cSys = c('used in systems'), cEmail = c('email'),
        cRole = c('role'), cInh = c('inherited'), cAt = c('checked at');
    sv.slice(1).forEach(function (r) {
      var e = normaliseEmail_(r[cEmail]);
      if (!e || !r[cId]) return;
      (sharing[e] = sharing[e] || []).push({ id: String(r[cId]), name: String(r[cName] || ''), systems: cSys > -1 ? String(r[cSys] || '') : '',
        role: String(r[cRole] || ''), inherited: cInh > -1 ? String(r[cInh] || '') : '' });
      if (cAt > -1 && String(r[cAt]) > checkedAt) checkedAt = String(r[cAt]);
    });
  }

  var grants = {};
  var gp = ss.getSheetByName('Grant plan');
  if (gp && gp.getLastRow() > 1) {
    var gv = gp.getDataRange().getDisplayValues(), gh = lowerRow_(gv[0]);
    gv.slice(1).forEach(function (r) {
      var e = normaliseEmail_(r[gh.indexOf('email')]);
      if (!e) return;
      (grants[e] = grants[e] || []).push({ id: String(r[gh.indexOf('file id')] || ''), name: String(r[gh.indexOf('file name')] || ''),
        systems: String(r[gh.indexOf('system(s)')] || ''), role: String(r[gh.indexOf('wanted')] || ''), status: String(r[gh.indexOf('status')] || '') });
    });
  }

  var out = { items: items, log: log, sharing: sharing, grants: grants, sharingCheckedAt: checkedAt };
  try { cache.put(CL_CACHE, JSON.stringify(out), 300); } catch (e) { /* too big for cache: fine, read again next time */ }
  return out;
}

function ensureChecklistItems_(ss) {
  var sh = ss.getSheetByName(CL_ITEMS_TAB);
  if (sh) return sh;
  return withLock_(function () {
    var again = ss.getSheetByName(CL_ITEMS_TAB);
    if (again) return again;
    sh = sheetOf_(CL_ITEMS_TAB);
    sh.getRange(2, 1, CL_SEED.length, 5).setValues(CL_SEED.map(function (r) { return r.concat(['Yes']); }));
    sh.autoResizeColumns(1, 5);
    return sh;
  });
}

/* ================= Write: one tick ================= */

/** tickChecklist {session, list, email, item, done, note} -> {ok} */
function actionTickChecklist_(req) {
  var user = findPerson_(readSession_(req.session));
  if (user.role === 'Doer') throw apiError_('forbidden');
  var list = String(req.list || '');
  if (CL_LISTS.indexOf(list) === -1) throw apiError_('bad_request');
  var email = normaliseEmail_(req.email);
  var person = loadPeople_(false).filter(function (p) { return p.emails.indexOf(email) > -1; })[0];
  if (!person) throw apiError_('bad_request');
  var item = cleanText_(req.item, 200);
  var cl = loadChecklistData_(false);
  var known = item === CL_START || cl.items.some(function (it) { return it.list === list && it.item === item; });
  if (!known) throw apiError_('bad_request');
  var done = req.done === true || req.done === 'true';
  var note = cleanText_(req.note, 300);

  clHeaders_();
  withLock_(function () {
    sheetOf_(CL_LOG_TAB).appendRow([list, person.emails[0], safeCell_(person.name), safeCell_(item), done ? 'Yes' : 'No',
      user.email, safeCell_(user.name), new Date(), safeCell_(note)]);
  });
  CacheService.getScriptCache().remove(CL_CACHE);
  return { ok: true };
}
