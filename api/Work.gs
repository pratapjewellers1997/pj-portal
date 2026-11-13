/**
 * PJ Portal API — work and attendance, read from each source sheet.
 *
 * READ-ONLY on every source: FMS, checklists, delegation and attendance
 * sheets are only read (Sheets API values.batchGet), never written.
 *
 * The Registry holds two small portal tabs (no task data):
 *   "Portal Sources": which spreadsheet + tab to read for each system
 *   "Portal Names":   short names used in sheets -> email (Babu, Megha, HR…)
 *
 * How it stays fast and safe:
 *   1. A timer (refreshWorkCache, every 10 min, 07:00–24:00 IST) reads every
 *      source in ONE Sheets API call per spreadsheet and builds a "snapshot".
 *   2. The snapshot is compressed (gzip) and kept in two places:
 *        - Script cache (fast, can be cleared by Google at any time)
 *        - Script Properties (survives cache clearing)
 *      So a staff request never reads the source sheets itself.
 *   3. A lock stops two refreshes running at once.
 *   4. Health (Admin only) shows each source's rows, time, errors,
 *      unmatched names, snapshot size and age.
 *
 * Older dates: any range older than the window is read from the sheets on
 * request (loadHistory_) and cached for 6 hours.
 *
 * Window kept in the snapshot:
 *   - every task planned in the last WORK_WINDOW_DAYS days (~3 months)
 *   - every task planned in the next WORK_FUTURE_DAYS days
 *   - every FMS / delegation task still not done, however old ("still open")
 *
 * Ownership (agreed with MIS, 13 Nov 2026):
 *   FMS open step  -> Final Doer Email in DB_Format (same column Data Studio uses)
 *   FMS done step  -> the row's own Doer cell, else "Doer Emails", else "Who" row
 *   Checklist      -> the Email column (already the final doer, buddy included)
 *   Delegation     -> the Name column ("Babu - 98673 24934")
 * On time = Actual on or before Planned (date and time).
 * Delegation has no completion time: on time = Completed with 0 revisions.
 */

var SOURCES_TAB = 'Portal Sources';
var NAMES_TAB = 'Portal Names';
var WORK_WINDOW_DAYS = 92;
var WORK_FUTURE_DAYS = 31;
var QUIET_HOURS = [0, 7];            // no timer refresh from 00:00 to 06:59 IST
var CACHE_CHUNK = 90000;             // script cache: max 100 KB per value
var PROP_CHUNK = 8500;               // script properties: max 9 KB per value
var PROP_MAX = 450000;               // script properties: 500 KB in total
var SNAP_KEY = 'snap_v2';
var TZ = 'Asia/Kolkata';
var DAY_MS = 24 * 60 * 60 * 1000;

/* ================= Public: timer + test ================= */

/** Run once from the editor: refresh the snapshot every 10 minutes. */
function setupWorkTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshWorkCache') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshWorkCache').timeBased().everyMinutes(10).create();
  Logger.log('Timer set: refreshWorkCache every 10 minutes (paused 00:00–07:00 IST).');
}

/** Timer target. */
function refreshWorkCache() {
  var hour = Number(Utilities.formatDate(new Date(), TZ, 'H'));
  if (hour >= QUIET_HOURS[0] && hour < QUIET_HOURS[1]) return;
  buildSnapshotLocked_(5000);
  try { refreshActivity_(false); } catch (e) { console.warn('Activity refresh failed: ' + e); }
}

/** Run from the editor: rebuilds now and prints a health report. */
function testWork() {
  var data = buildSnapshotLocked_(30000) || loadSnapshot_();
  if (!data) { Logger.log('Another refresh is running. Try again in a minute.'); return; }
  data.health.sources.forEach(function (h) {
    Logger.log(h.system + ' [' + h.tab + ']: ' + (h.error ? 'ERROR ' + h.error : h.rows + ' items') + ' (' + h.ms + ' ms)');
  });
  data.health.sources.forEach(function (h) {
    if (!h.check) return;
    Logger.log('CHECK ' + h.system + ': DB_Format pending ' + h.check.db + ' · portal pending ' + h.check.portal +
      (h.check.missing ? ' · missing in portal ' + h.check.missing + ' e.g. ' + h.check.missingEx.join(' ; ') : '') +
      (h.check.extra ? ' · extra in portal ' + h.check.extra + ' e.g. ' + h.check.extraEx.join(' ; ') : '') +
      (!h.check.missing && !h.check.extra ? ' · MATCH' : ''));
  });
  var act = refreshActivity_(true);
  Logger.log('Sheet activity: ' + act.files.length + ' sheets · edited in last 24 h: ' +
    act.files.filter(function (f) { return f.t > Date.now() - DAY_MS; }).length +
    (act.errors.length ? ' · could not read: ' + act.errors.join(', ') : ''));
  Logger.log('Attendance days: ' + data.attendance.length + ' · today live: ' + data.health.liveToday +
             ' · monthly rows: ' + data.monthly.length);
  Logger.log('Unmatched names: ' + (data.health.unmatched.join(', ') || 'none'));
  Logger.log('Snapshot: ' + data.health.sizeKb + ' KB compressed · stored in: ' + data.health.storedIn.join(' + ') +
             ' · built in ' + data.health.totalMs + ' ms');
}

/* ================= API action ================= */

/**
 * work {session, from:'YYYY-MM-DD', to:'YYYY-MM-DD', person?}
 * Doer: only own tasks and own attendance. Manager/Owner/Admin: everyone.
 */
function actionWork_(req) {
  var user = findPerson_(readSession_(req.session));
  var range = parseRange_(req.from, req.to);
  var data = range.historic ? loadHistory_(range)
           : (loadSnapshot_() || buildSnapshotLocked_(60000) || loadSnapshot_());
  if (!data) throw apiError_('busy');

  var now = Date.now();
  var isDoer = user.role === 'Doer';
  var person = req.person ? normaliseEmail_(req.person) : '';
  var mine = function (list) {
    for (var i = 0; i < list.length; i++) if (user.emails.indexOf(list[i]) > -1) return true;
    return false;
  };
  var allowed = function (emails) {
    if (isDoer) return mine(emails);
    if (person) return emails.indexOf(person) > -1;
    return true;
  };

  var tasks = data.tasks.filter(function (t) {
    var inRange = t.p >= range.from && t.p <= range.to;
    var carryOver = !t.d && t.p < range.from && t.y !== 'Checklist';
    return (inRange || carryOver) && allowed(t.w);
  }).map(function (t) {
    return {
      sys: t.s, system: t.n, type: t.y, key: t.k, label: t.l, task: t.t, freq: t.f || '',
      step: t.i == null ? null : t.i, mark: t.m || '',
      planned: t.p, actual: t.a, who: t.w, url: (data.bases[t.b] || '') + t.u, carry: t.p < range.from,
      status: t.d ? (t.o === true ? 'on_time' : t.o === false ? 'late' : 'done') : (t.p < now ? 'overdue' : 'due')
    };
  });

  var attendance = data.attendance.filter(function (r) {
    return r.date >= range.fromKey && r.date <= range.toKey && allowed([r.email]);
  });
  var months = monthsBetween_(range.fromKey, range.toKey);
  var monthly = data.monthly.filter(function (m) {
    return months.indexOf(m.month) > -1 && allowed([m.email]);
  });

  var people = loadPeople_(false);
  var names = {};
  people.forEach(function (p) { p.emails.forEach(function (e) { names[e] = p.name; }); });

  var out = {
    ok: true, user: user, scope: isDoer ? 'self' : 'all',
    range: { from: range.fromKey, to: range.toKey },
    names: names, tasks: tasks, attendance: attendance, monthly: monthly,
    builtAt: data.builtAt, historic: Boolean(range.historic)
  };
  if (!isDoer) {
    out.people = people
      .filter(function (p) { return p.active && PORTAL_ROLES.indexOf(p.role) > -1 && p.accountType !== 'Alias'; })
      .map(function (p) { return { email: p.emails[0], name: p.name, role: p.role, designation: p.designation }; });
  }
  if (user.role === 'Admin') out.health = data.health;
  return out;
}

/**
 * lookup {session, q}: find a customer, order or item across every FMS and the
 * Delegation Sheet. Returns up to 30 items, each with all its steps in order.
 * A Doer only sees items where one of the steps is theirs.
 */
function actionLookup_(req) {
  var user = findPerson_(readSession_(req.session));
  var words = normName_(req.q || '').split(' ').filter(function (w) { return w.length > 0; });
  if (!words.length || normName_(req.q).length < 2) throw apiError_('query_too_short');
  var data = loadSnapshot_() || buildSnapshotLocked_(60000) || loadSnapshot_();
  if (!data) throw apiError_('busy');
  var isDoer = user.role === 'Doer', now = Date.now();

  var items = {};
  data.tasks.forEach(function (t) {
    if (t.y === 'Checklist') return;
    var hay = normName_(t.k + ' ' + t.l + ' ' + (t.y === 'Delegation' ? t.t : ''));
    for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) === -1) return;
    var id = t.s + '|' + t.k;
    var it = items[id] = items[id] || { sys: t.s, system: t.n, type: t.y, key: t.k, label: t.l, steps: [], mine: false };
    if (t.w.some(function (e) { return user.emails.indexOf(e) > -1; })) it.mine = true;
    it.steps.push({
      task: t.t, step: t.i == null ? null : t.i, planned: t.p, actual: t.a, who: t.w,
      url: (data.bases[t.b] || '') + t.u, mark: t.m || '',
      status: t.d ? (t.o === true ? 'on_time' : t.o === false ? 'late' : 'done') : (t.p < now ? 'overdue' : 'due')
    });
  });
  var list = Object.keys(items).map(function (k) { return items[k]; })
    .filter(function (it) { return !isDoer || it.mine; });
  list.forEach(function (it) {
    it.steps.sort(function (a, b) { return (a.step == null ? 0 : a.step) - (b.step == null ? 0 : b.step) || a.planned - b.planned; });
    it.last = Math.max.apply(null, it.steps.map(function (s) { return s.actual || s.planned; }));
    it.open = it.steps.filter(function (s) { return s.status === 'overdue' || s.status === 'due'; }).length;
    delete it.mine;
  });
  list.sort(function (a, b) { return b.open - a.open || b.last - a.last; });

  var names = {};
  loadPeople_(false).forEach(function (p) { p.emails.forEach(function (e) { names[e] = p.name; }); });
  return { ok: true, q: req.q, total: list.length, items: list.slice(0, 30), names: names, builtAt: data.builtAt };
}

function parseRange_(from, to) {
  var re = /^\d{4}-\d{2}-\d{2}$/;
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var f = re.test(from || '') ? from : today;
  var t = re.test(to || '') ? to : f;
  if (t < f) { var x = f; f = t; t = x; }
  var fromMs = istMs_(f, '00:00:00'), toMs = istMs_(t, '23:59:59');
  if (toMs - fromMs > (WORK_WINDOW_DAYS + WORK_FUTURE_DAYS) * DAY_MS) throw apiError_('range_too_long');
  // Older than the snapshot window (with a 1-day margin): read the sheets for this range.
  var historic = fromMs < Date.now() - (WORK_WINDOW_DAYS - 1) * DAY_MS;
  return { from: fromMs, to: toMs, fromKey: f, toKey: t, historic: historic };
}

/* ================= Snapshot: build, store, load ================= */

function buildSnapshotLocked_(waitMs) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs)) return null;
  try {
    var data = buildSnapshot_();
    saveSnapshot_(data);
    return data;
  } finally {
    lock.releaseLock();
  }
}

function buildSnapshot_(win) {
  var started = Date.now();
  var sources = loadSourcesCfg_();
  var cutoff = win ? win.from : started - WORK_WINDOW_DAYS * DAY_MS;
  var horizon = win ? win.to : started + WORK_FUTURE_DAYS * DAY_MS;

  // 1. Read every source (one call for tab ids + one batchGet per spreadsheet)
  var raw = sources.map(function (src) {
    var t0 = Date.now();
    var h = { system: src.system, tab: src.tab, type: src.type, rows: 0, error: '', ms: 0 };
    var book = null;
    try { book = readBook_(src); } catch (err) { h.error = shortErr_(err); }
    h.ms = Date.now() - t0;
    return { src: src, book: book, health: h };
  });

  // 2. Names: People + every FMS "Doer Emails" tab + EMPLOYEES + Portal Names (MIS wins)
  var names = buildNameMap_(raw);

  // 3. Turn each source into tasks / attendance
  var tasks = [], bases = {}, attendance = [], monthly = [], liveToday = 0;
  raw.forEach(function (r) {
    if (!r.book) return;
    var t0 = Date.now();
    try {
      if (r.src.type === 'Attendance') {
        var att = parseAttendance_(r.src, r.book, names, cutoff);
        attendance = attendance.concat(att.days);
        monthly = monthly.concat(att.monthly);
        liveToday += att.liveToday;
        r.health.rows = att.days.length;
      } else {
        var list = r.src.type === 'FMS' ? parseFms_(r.src, r.book, names, cutoff, horizon)
                 : r.src.type === 'Checklist' ? parseChecklist_(r.src, r.book, names, cutoff, horizon)
                 : r.src.type === 'Delegation' ? parseDelegation_(r.src, r.book, names, cutoff, horizon)
                 : null;
        if (!list) throw new Error('Unknown type ' + r.src.type);
        var bk = r.src.sysId + '|' + r.src.tab;
        bases[bk] = r.book.url + '/edit#gid=' + (r.book.gids[r.src.tab] || 0) + '&range=A';
        list.forEach(function (t) { t.b = bk; });
        tasks = tasks.concat(list);
        r.health.rows = list.length;
        if (list.check) r.health.check = list.check;
      }
    } catch (err) {
      r.health.error = shortErr_(err);
    }
    r.health.ms += Date.now() - t0;
  });

  return {
    tasks: tasks, bases: bases, attendance: attendance, monthly: monthly,
    builtAt: new Date().toISOString(),
    health: {
      sources: raw.map(function (r) { return r.health; }),
      unmatched: Object.keys(names.unmatched).sort(),
      liveToday: liveToday,
      totalMs: Date.now() - started,
      sizeKb: 0, storedIn: []
    }
  };
}

/**
 * Older than 3 months: read the sheets for exactly this date range, once.
 * The result is kept in the script cache for 6 hours (not in Properties),
 * so the same old range opens instantly after the first time.
 */
function loadHistory_(range) {
  var key = 'hist_v1_' + range.fromKey + '_' + range.toKey;
  var cache = CacheService.getScriptCache();
  var packed = joinParts_(function (keys) { return cache.getAll(keys); }, cache.get(key + '_n'), key + '_');
  if (packed) { try { return unpack_(packed); } catch (e) {} }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(90000)) return null;
  try {
    var data = buildSnapshot_({ from: range.from, to: range.to });
    var p = pack_(data), parts = {}, n = 0;
    for (var i = 0; i < p.length; i += CACHE_CHUNK) parts[key + '_' + (n++)] = p.substr(i, CACHE_CHUNK);
    parts[key + '_n'] = String(n);
    try { cache.putAll(parts, 21600); } catch (e) { console.warn('History cache write failed: ' + e); }
    return data;
  } finally {
    lock.releaseLock();
  }
}

function saveSnapshot_(data) {
  var packed = pack_(data);
  var canProps = packed.length <= PROP_MAX;
  data.health.sizeKb = Math.round(packed.length / 1024);
  data.health.storedIn = canProps ? ['cache', 'properties'] : ['cache'];
  packed = pack_(data);                                  // re-pack with final health

  // Cache: fast layer (Google may clear it any time; that is fine)
  try {
    var cparts = {}, n = 0;
    for (var i = 0; i < packed.length; i += CACHE_CHUNK) cparts[SNAP_KEY + '_c' + (n++)] = packed.substr(i, CACHE_CHUNK);
    cparts[SNAP_KEY + '_cn'] = String(n);
    CacheService.getScriptCache().putAll(cparts, 21600);   // 6 h, the maximum
  } catch (e) { console.warn('Snapshot cache write failed: ' + e); }

  // Properties: durable layer
  if (canProps) {
    var props = PropertiesService.getScriptProperties();
    var all = props.getProperties(), pparts = {}, m = 0;
    for (var j = 0; j < packed.length; j += PROP_CHUNK) pparts[SNAP_KEY + '_p' + (m++)] = packed.substr(j, PROP_CHUNK);
    pparts[SNAP_KEY + '_pn'] = String(m);
    props.setProperties(pparts, false);
    Object.keys(all).forEach(function (k) {                 // remove leftovers from a bigger snapshot
      var mm = k.match(new RegExp('^' + SNAP_KEY + '_p(\\d+)$'));
      if (mm && Number(mm[1]) >= m) props.deleteProperty(k);
    });
  } else {
    console.warn('Snapshot ' + data.health.sizeKb + ' KB is above the Properties limit; cache only.');
  }
}

function loadSnapshot_() {
  var cache = CacheService.getScriptCache();
  var packed = joinParts_(function (keys) { return cache.getAll(keys); }, cache.get(SNAP_KEY + '_cn'), SNAP_KEY + '_c');
  if (!packed) {
    var props = PropertiesService.getScriptProperties();
    packed = joinParts_(function (keys) {
      var all = props.getProperties(), o = {};
      keys.forEach(function (k) { o[k] = all[k]; });
      return o;
    }, props.getProperty(SNAP_KEY + '_pn'), SNAP_KEY + '_p');
  }
  if (!packed) return null;
  try { return unpack_(packed); } catch (e) { console.warn('Snapshot unreadable: ' + e); return null; }
}

function joinParts_(getAll, count, prefix) {
  var n = Number(count);
  if (!n) return null;
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(prefix + i);
  var got = getAll(keys), s = '';
  for (var j = 0; j < n; j++) { if (got[keys[j]] == null) return null; s += got[keys[j]]; }
  return s;
}

function pack_(obj) {
  var blob = Utilities.gzip(Utilities.newBlob(JSON.stringify(obj), 'application/json'));
  return Utilities.base64Encode(blob.getBytes());
}

function unpack_(s) {
  var blob = Utilities.newBlob(Utilities.base64Decode(s), 'application/x-gzip');
  return JSON.parse(Utilities.ungzip(blob).getDataAsString());
}

/* ================= Reading the sheets ================= */

/** One Sheets API call for tab ids, one batchGet for every tab this source needs. */
function readBook_(src) {
  var want = {};
  if (src.type === 'FMS') { want[src.tab] = q_(src.tab); want['Doer Emails'] = q_('Doer Emails') + '!A:C'; want['DB_Format'] = q_('DB_Format') + '!A:J'; }
  if (src.type === 'Checklist') want[src.tab] = q_(src.tab) + '!A:Z';
  if (src.type === 'Delegation') want[src.tab] = q_(src.tab) + '!A:Z';
  if (src.type === 'Attendance') {
    want[src.tab] = q_(src.tab) + '!A:X';
    want['RAW_DATA'] = q_('RAW_DATA') + '!A:G';
    want['MONTHLY_SUMMARY'] = q_('MONTHLY_SUMMARY') + '!A:K';
    // EMPLOYEES: Name (A), Email (D), Shift_Start..Grace (G:I). Salary (E) is never read.
    want['EMPLOYEES|A'] = q_('EMPLOYEES') + '!A:A';
    want['EMPLOYEES|D'] = q_('EMPLOYEES') + '!D:D';
    want['EMPLOYEES|G'] = q_('EMPLOYEES') + '!G:I';
  }

  var meta = Sheets.Spreadsheets.get(src.id, { fields: 'sheets.properties(sheetId,title)' });
  var gids = {};
  (meta.sheets || []).forEach(function (s) { gids[s.properties.title] = s.properties.sheetId; });
  if (!(src.tab in gids)) throw new Error('Tab not found: ' + src.tab);

  var keys = Object.keys(want).filter(function (k) { return k.split('|')[0] in gids; });
  var res = Sheets.Spreadsheets.Values.batchGet(src.id, {
    ranges: keys.map(function (k) { return want[k]; }),
    valueRenderOption: 'FORMATTED_VALUE',
    majorDimension: 'ROWS'
  });
  var tabs = {};
  keys.forEach(function (k, i) { tabs[k] = (res.valueRanges[i] && res.valueRanges[i].values) || []; });
  return { tabs: tabs, gids: gids, url: 'https://docs.google.com/spreadsheets/d/' + src.id };
}

function q_(tab) { return "'" + String(tab).replace(/'/g, "''") + "'"; }

function loadSourcesCfg_() {
  var sheet = SpreadsheetApp.openById(cfg_('REGISTRY_ID')).getSheetByName(SOURCES_TAB);
  if (!sheet) throw new Error('Registry tab not found: ' + SOURCES_TAB);
  var rows = sheet.getDataRange().getDisplayValues();
  var head = lowerRow_(rows[0]);
  var c = function (n) { return head.indexOf(n); };
  return rows.slice(1).map(function (r) {
    return {
      sysId: String(r[c('system id')] || '').trim(), system: String(r[c('system')] || '').trim(),
      type: String(r[c('type')] || '').trim(), id: String(r[c('spreadsheet id')] || '').trim(),
      tab: String(r[c('tab')] || '').trim(), active: isTrue_(r[c('active')])
    };
  }).filter(function (s) { return s.active && s.id && s.tab; });
}

/* ================= Names -> emails ================= */

function normName_(s) {
  return String(s || '').toLowerCase()
    .replace(/\b(ma'?am|madam|sir|ji)\b/g, ' ')
    .replace(/[^a-z0-9@.ऀ-ॿ ]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function buildNameMap_(raw) {
  var map = {}, firstNames = {};
  var add = function (name, email) {
    var k = normName_(name), e = normaliseEmail_(email);
    if (!k || e.indexOf('@') < 1) return;
    map[k] = map[k] || [];
    if (map[k].indexOf(e) === -1) map[k].push(e);
  };

  loadPeople_(false).forEach(function (p) {
    if (PORTAL_ROLES.indexOf(p.role) === -1 || p.accountType === 'Alias') return;
    add(p.name, p.emails[0]);
    var first = normName_(p.name).split(' ')[0];
    if (first) (firstNames[first] = firstNames[first] || []).push(p.emails[0]);
  });
  Object.keys(firstNames).forEach(function (f) {
    if (firstNames[f].length === 1 && !map[f]) add(f, firstNames[f][0]);
  });

  raw.forEach(function (r) {
    if (!r.book) return;
    (r.book.tabs['Doer Emails'] || []).slice(1).forEach(function (row) { if (row[2] && row[1]) add(row[2], row[1]); });
    var en = r.book.tabs['EMPLOYEES|A'], ee = r.book.tabs['EMPLOYEES|D'];
    if (en && ee) en.forEach(function (row, i) { if (i > 0 && row[0] && ee[i] && ee[i][0]) add(row[0], ee[i][0]); });
  });

  var sheet = SpreadsheetApp.openById(cfg_('REGISTRY_ID')).getSheetByName(NAMES_TAB);
  if (sheet) sheet.getDataRange().getDisplayValues().slice(1).forEach(function (r) {
    var k = normName_(r[0]);
    if (!k) return;
    var e = normaliseEmail_(r[1]);
    if (e === '-') map[k] = [];                  // "-" = not a person
    else if (e.indexOf('@') > 0) map[k] = [e];   // MIS override wins
  });
  return { map: map, unmatched: {} };
}

/** "Kishan / Priya", "Babu - 98673 24934", "x@gmail.com" -> [emails]. */
function resolveNames_(text, names) {
  var out = [];
  String(text || '').split(/\s*(?:\/|,|&|\band\b|\n)\s*/i).forEach(function (part) {
    var raw = part.replace(/\s+-\s*[\d\s+]*$/, '').trim();
    if (!raw) return;
    if (/@/.test(raw)) { var em = normaliseEmail_(raw); if (out.indexOf(em) === -1) out.push(em); return; }
    var hit = names.map[normName_(raw)];
    if (hit) hit.forEach(function (e) { if (out.indexOf(e) === -1) out.push(e); });
    else names.unmatched[raw] = true;
  });
  return out;
}

/* ================= Parsers ================= */

/**
 * FMS (all F2D sheets + Hiring): row 2 = step names, row 3 = Who, row 6 = labels,
 * data from row 7. Each "Planned" column followed by "Actual" is one step.
 */
function parseFms_(src, book, names, cutoff, horizon) {
  var v = book.tabs[src.tab];
  if (!v || v.length < 7) return [];
  var labels = lowerRow_(v[5]), stepRow = v[1] || [], whoRow = v[2] || [];
  var keyCol = firstCol_(labels, ['unique key', 'repair id', 'transaction id', 'order number', 'job id', 'product']);
  var labelCols = ['customer name', 'customer first name', 'full name', 'job title / role', 'article name', 'article']
    .map(function (n) { return labels.indexOf(n); }).filter(function (i) { return i > -1; });
  var lastNameCol = labels.indexOf('customer last name');

  var steps = [], prevEnd = 0;
  for (var c = 1; c < labels.length - 1; c++) {
    if (labels[c] !== 'planned' || labels[c + 1] !== 'actual') continue;
    var nameCol = -1;
    for (var b = c; b >= prevEnd && b >= 1; b--) { if (String(stepRow[b] || '').trim()) { nameCol = b; break; } }
    steps.push({
      planned: c, actual: c + 1, doer: labels[c - 1] === 'doer' ? c - 1 : -1,
      name: nameCol > -1 ? String(stepRow[nameCol]).trim() : 'Step ' + (steps.length + 1),
      who: nameCol > -1 ? String(whoRow[nameCol] || '').trim() : ''
    });
    prevEnd = c + 2;
  }

  var stepDoer = {};
  (book.tabs['Doer Emails'] || []).slice(1).forEach(function (r) {
    if (r[0] && r[1]) stepDoer[normName_(r[0])] = [normaliseEmail_(r[1])];
  });
  // DB_Format = the open steps with their FINAL doer (same column Data Studio filters on)
  var finalDoer = {}, markLink = {};
  var dv = book.tabs['DB_Format'] || [];
  if (dv.length > 1) {
    var dh = lowerRow_(dv[0]);
    var ck = dh.indexOf('unique key'), cs = dh.indexOf('step'), cf = dh.indexOf('final doer email'), cl = dh.indexOf('link');
    if (ck > -1 && cs > -1) dv.slice(1).forEach(function (r) {
      var dk = String(r[ck] || '').trim() + '|' + normName_(r[cs]);
      if (cf > -1 && r[cf]) finalDoer[dk] = normaliseEmail_(r[cf]);
      if (cl > -1 && /^https:\/\/docs\.google\.com\/forms\//.test(String(r[cl] || ''))) markLink[dk] = String(r[cl]);
    });
  }

  var out = [];
  for (var r = 6; r < v.length; r++) {
    var row = v[r] || [];
    if (!row[0] && !row[1]) continue;
    var key = keyCol > -1 ? String(row[keyCol] || '').trim() : '';
    var label = labelCols.map(function (i) { return String(row[i] || '').trim(); }).filter(Boolean)[0] || '';
    if (lastNameCol > -1 && labels[labelCols[0]] === 'customer first name' && row[lastNameCol]) {
      label = (label + ' ' + String(row[lastNameCol]).trim()).trim();
    }
    steps.forEach(function (st, si) {
      var p = toMs_(row[st.planned]);
      if (!p) return;                                    // step not reached yet
      var a = toMs_(row[st.actual]);
      if (a && p < cutoff) return;                       // finished long ago
      if (!a && p > horizon) return;
      var who = [];
      var fd = !a ? finalDoer[key + '|' + normName_(st.name)] : '';
      if (fd) who = [fd];                                // open step: DB_Format final doer decides
      else {
        if (st.doer > -1 && String(row[st.doer] || '').trim()) who = resolveNames_(row[st.doer], names);
        if (!who.length) who = stepDoer[normName_(st.name)] || [];
        if (!who.length && st.who) who = resolveNames_(st.who, names);
      }
      var t = { s: src.sysId, n: src.system, y: 'FMS', k: key || 'Row ' + (r + 1), l: label,
                t: st.name, p: p, a: a, d: Boolean(a), o: a ? a <= p : null, w: who, u: r + 1, i: si };
      if (!a && markLink[key + '|' + normName_(st.name)]) t.m = markLink[key + '|' + normName_(st.name)];
      out.push(t);
    });
  }
  out.check = reconcileFms_(out, dv);
  return out;
}

/**
 * Self-check: DB_Format is the pending list Data Studio uses. Every open step
 * planned up to the end of today should appear in both lists.
 * Returns counts and up to 5 examples each way (shown in Data health).
 */
function reconcileFms_(tasks, dv) {
  if (!dv || dv.length < 2) return null;
  var dh = lowerRow_(dv[0]);
  var ck = dh.indexOf('unique key'), cs = dh.indexOf('step');
  if (ck < 0 || cs < 0) return null;
  var endToday = istMs_(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'), '23:59:59');
  var keyOf = function (k, step) { return String(k || '').trim() + '|' + normName_(step); };
  var db = {}, portal = {};
  dv.slice(1).forEach(function (r) {
    if (String(r[ck] || '').trim()) db[keyOf(r[ck], r[cs])] = String(r[ck]).trim() + ' / ' + String(r[cs] || '').trim();
  });
  tasks.forEach(function (t) {
    if (!t.d && t.p <= endToday) portal[keyOf(t.k, t.t)] = t.k + ' / ' + t.t;
  });
  var missing = Object.keys(db).filter(function (k) { return !portal[k]; }).map(function (k) { return db[k]; });
  var extra = Object.keys(portal).filter(function (k) { return !db[k]; }).map(function (k) { return portal[k]; });
  return { db: Object.keys(db).length, portal: Object.keys(portal).length,
           missing: missing.length, extra: extra.length,
           missingEx: missing.slice(0, 5), extraEx: extra.slice(0, 5) };
}

/** Checklist "Master": the Email column is the final doer (buddy already reflected). */
function parseChecklist_(src, book, names, cutoff, horizon) {
  var v = book.tabs[src.tab] || [];
  if (v.length < 2) return [];
  var h = lowerRow_(v[0]);
  var col = function (n) { return h.indexOf(n); };
  var cTask = col('task'), cP = col('planned'), cA = col('actual'), cE = col('email'),
      cAcc = col('email of person accountable'), cF = col('freq'), cId = col('task id'), cN = col('name');
  if (cTask < 0 || cP < 0 || cA < 0 || cE < 0) throw new Error('Master needs Task, Planned, Actual and Email columns');

  var out = [];
  for (var r = 1; r < v.length; r++) {
    var row = v[r] || [];
    var p = toMs_(row[cP]);
    if (!p || p > horizon || p < cutoff) continue;       // checklists: misses older than the window are not carried
    var a = toMs_(row[cA]);
    var who = row[cE] ? resolveNames_(row[cE], names)
            : row[cAcc] ? resolveNames_(row[cAcc], names) : resolveNames_(row[cN], names);
    out.push({ s: src.sysId, n: src.system, y: 'Checklist', k: cId > -1 ? String(row[cId] || '') : String(r + 1),
               l: '', t: String(row[cTask] || '').trim(), p: p, a: a, d: Boolean(a), o: a ? a <= p : null,
               w: who, u: r + 1, f: cF > -1 ? String(row[cF] || '') : '' });
  }
  return out;
}

/** Delegation "Master": due = Latest Revision (end of that day). */
function parseDelegation_(src, book, names, cutoff, horizon) {
  var v = book.tabs[src.tab] || [];
  if (v.length < 2) return [];
  var h = lowerRow_(v[0]);
  var col = function (n) { return h.indexOf(n); };
  var cId = col('task id'), cN = col('name'), cT = col('task'), cL = col('latest revision'),
      cFirst = col('first date'), cR = col('total revisions'), cS = col('status');

  var out = [];
  for (var r = 1; r < v.length; r++) {
    var row = v[r] || [];
    if (!row[cT]) continue;
    var due = toMs_(cL > -1 && row[cL] ? row[cL] : row[cFirst]);
    if (!due) continue;
    due = endOfDay_(due);
    var done = /complete/i.test(String(row[cS] || ''));
    if (done && due < cutoff) continue;
    if (!done && due > horizon) continue;
    out.push({ s: src.sysId, n: src.system, y: 'Delegation', k: String(row[cId] || r + 1), l: String(row[cS] || ''),
               t: String(row[cT]).trim(), p: due, a: null, d: done, o: done ? (Number(row[cR]) || 0) === 0 : null,
               w: resolveNames_(row[cN], names), u: r + 1 });
  }
  return out;
}

/**
 * Attendance: ATTENDANCE has every day up to yesterday (built each night).
 * Today (and any day not yet processed) comes live from RAW_DATA check-ins.
 * MONTHLY_SUMMARY gives the official month totals.
 */
function parseAttendance_(src, book, names, cutoff) {
  var cutKey = Utilities.formatDate(new Date(cutoff), TZ, 'yyyy-MM-dd');
  var days = [], lastKey = '';

  var v = book.tabs[src.tab] || [];
  if (v.length > 1) {
    var h = lowerRow_(v[0]);
    var col = function (n) { return h.indexOf(n); };
    for (var r = 1; r < v.length; r++) {
      var row = v[r] || [];
      var date = dateKey_(row[col('date')]);
      if (!date) continue;
      if (date > lastKey) lastKey = date;
      if (date < cutKey) continue;
      var who = resolveNames_(row[col('employee name')], names);
      if (!who.length) continue;
      days.push({
        date: date, email: who[0], name: cleanName_(row[col('employee name')]),
        checkIn: row[col('check-in time')] || '', checkOut: row[col('check-out time')] || '',
        hours: Number(row[col('working hours')]) || 0, status: row[col('status')] || '',
        late: /^y/i.test(row[col('late')] || ''), lateBy: Number(row[col('late by (mins)')]) || 0,
        dayType: row[col('day type')] || '', earlyLeave: /^y/i.test(row[col('early leave')] || ''), live: false
      });
    }
  }

  // Shift start + grace per employee (EMPLOYEES G:I), to judge "late" for today
  var shift = {};
  var en = book.tabs['EMPLOYEES|A'] || [], eg = book.tabs['EMPLOYEES|G'] || [];
  var gh = lowerRow_(eg[0] || []);
  var cStart = gh.indexOf('shift_start'), cGrace = gh.indexOf('grace_period_mins');
  en.forEach(function (row, i) {
    if (i === 0 || !row[0] || !eg[i]) return;
    shift[normName_(row[0])] = { start: String(eg[i][cStart] || ''), grace: Number(eg[i][cGrace]) || 0 };
  });

  // Live days from RAW_DATA (any day after the last processed day)
  var live = {}, liveToday = 0;
  var rv = book.tabs['RAW_DATA'] || [];
  if (rv.length > 1) {
    var rh = lowerRow_(rv[0]);
    var cTs = rh.indexOf('timestamp'), cNm = rh.indexOf('employee name'), cAc = rh.indexOf('action');
    for (var i = 1; i < rv.length; i++) {
      var rr = rv[i] || [];
      var ms = toMs_(rr[cTs]);
      if (!ms) continue;
      var dk = Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd');
      if (dk <= lastKey) continue;
      var nm = cleanName_(rr[cNm]);
      var k = dk + '|' + normName_(nm);
      var e = live[k] = live[k] || { date: dk, name: nm, inMs: 0, outMs: 0 };
      var action = String(rr[cAc] || '').toLowerCase();
      if (action.indexOf('out') > -1) { if (ms > e.outMs) e.outMs = ms; }
      else if (action.indexOf('in') > -1) { if (!e.inMs || ms < e.inMs) e.inMs = ms; }
    }
  }
  Object.keys(live).forEach(function (k) {
    var e = live[k];
    var who = resolveNames_(e.name, names);
    if (!who.length || !e.inMs) return;
    var hhmm = function (ms) { return ms ? Utilities.formatDate(new Date(ms), TZ, 'HH:mm') : ''; };
    var s = shift[normName_(e.name)], lateBy = 0;
    var sm = s && s.start.match(/^(\d{1,2}):(\d{2})/);
    if (sm) {
      var startMs = istMs_(e.date, pad_(sm[1]) + ':' + sm[2] + ':00');
      lateBy = Math.max(0, Math.round((e.inMs - startMs) / 60000) - s.grace);
    }
    days.push({
      date: e.date, email: who[0], name: e.name, checkIn: hhmm(e.inMs), checkOut: hhmm(e.outMs),
      hours: e.outMs ? Math.round((e.outMs - e.inMs) / 36000) / 100 : 0,
      status: e.outMs ? 'Present' : 'Checked in', late: lateBy > 0, lateBy: lateBy,
      dayType: '', earlyLeave: false, live: true
    });
    liveToday++;
  });

  // Official month totals
  var monthly = [];
  var mv = book.tabs['MONTHLY_SUMMARY'] || [];
  if (mv.length > 1) {
    var mh = lowerRow_(mv[0]);
    var mc = function (n) { return mh.indexOf(n); };
    mv.slice(1).forEach(function (row) {
      var who = resolveNames_(row[mc('employee name')], names);
      if (!who.length || !row[mc('month')]) return;
      monthly.push({
        email: who[0], name: cleanName_(row[mc('employee name')]), month: String(row[mc('month')]).slice(0, 7),
        workingDays: Number(row[mc('working days')]) || 0, present: Number(row[mc('present days')]) || 0,
        absent: Number(row[mc('absent days')]) || 0, late: Number(row[mc('late count')]) || 0,
        halfDays: Number(row[mc('half days')]) || 0, fullDays: Number(row[mc('full days')]) || 0,
        earlyLeave: Number(row[mc('early leave count')]) || 0
      });
    });
  }
  return { days: days, monthly: monthly, liveToday: liveToday };
}

/* ================= Small helpers ================= */

function lowerRow_(row) { return (row || []).map(function (x) { return String(x == null ? '' : x).trim().toLowerCase(); }); }
function cleanName_(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
function shortErr_(err) { return String(err && err.message || err).slice(0, 200); }

function firstCol_(labels, list) {
  for (var i = 0; i < list.length; i++) { var c = labels.indexOf(list[i]); if (c > -1) return c; }
  return -1;
}

function istMs_(dateKey, time) {
  return Utilities.parseDate(dateKey + ' ' + time, TZ, 'yyyy-MM-dd HH:mm:ss').getTime();
}

/** "dd/MM/yyyy HH:mm:ss", "dd/MM/yyyy", "yyyy-MM-dd" (as shown in the sheet) -> ms in IST. */
function toMs_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : v.getTime();
  var s = String(v).trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return istMs_(m[3] + '-' + pad_(m[2]) + '-' + pad_(m[1]), pad_(m[4] || 0) + ':' + pad_(m[5] || 0) + ':' + pad_(m[6] || 0));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return istMs_(m[1] + '-' + m[2] + '-' + m[3], pad_(m[4] || 0) + ':' + pad_(m[5] || 0) + ':' + pad_(m[6] || 0));
  return null;
}

function dateKey_(v) {
  var ms = toMs_(v);
  return ms ? Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd') : '';
}

function endOfDay_(ms) { return istMs_(Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd'), '23:59:59'); }

function pad_(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

function monthsBetween_(fromKey, toKey) {
  var out = [], y = Number(fromKey.slice(0, 4)), m = Number(fromKey.slice(5, 7));
  var ty = Number(toKey.slice(0, 4)), tm = Number(toKey.slice(5, 7));
  while (y < ty || (y === ty && m <= tm)) {
    out.push(y + '-' + pad_(m));
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/* ================= Sheet activity (last edited) ================= */

var ACTIVITY_KEY = 'activity_v1';
var ACTIVITY_EVERY_MS = 30 * 60 * 1000;   // refreshed at most every 30 minutes

/**
 * "Last edited" time of every Google Sheet linked in the Registry Links tab,
 * from Drive metadata (read-only scope). Google does not tell scripts when a
 * file was merely OPENED by someone, only when it was last EDITED.
 * Stored small (a few KB) in Script Properties.
 */
function refreshActivity_(force) {
  var props = PropertiesService.getScriptProperties();
  var old = null;
  try { old = JSON.parse(props.getProperty(ACTIVITY_KEY) || 'null'); } catch (e) {}
  if (!force && old && Date.now() - old.builtAt < ACTIVITY_EVERY_MS) return old;

  var sheet = SpreadsheetApp.openById(cfg_('REGISTRY_ID')).getSheetByName('Links');
  var rows = sheet.getDataRange().getDisplayValues();
  var h = lowerRow_(rows[0]), cU = h.indexOf('url'), cS = h.indexOf('system id');
  var ids = {};
  rows.slice(1).forEach(function (r) {
    var m = String(r[cU] || '').match(/docs\.google\.com\/spreadsheets\/d\/([\w-]{20,})(\/(copy))?/);
    if (m && !m[3]) (ids[m[1]] = ids[m[1]] || []).push(r[cS]);
  });

  var files = [], errors = [];
  Object.keys(ids).forEach(function (id) {
    try {
      var f = Drive.Files.get(id, { fields: 'name,modifiedTime,lastModifyingUser(displayName)', supportsAllDrives: true });
      files.push({ id: id, name: f.name, t: Date.parse(f.modifiedTime),
                   by: (f.lastModifyingUser && f.lastModifyingUser.displayName) || '', sys: ids[id] });
    } catch (e) { errors.push(ids[id][0] || id); }
  });
  var data = { builtAt: Date.now(), files: files, errors: errors };
  try { props.setProperty(ACTIVITY_KEY, JSON.stringify(data)); } catch (e) { console.warn('Activity too big to store: ' + e); }
  return data;
}

function loadActivity_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(ACTIVITY_KEY) || 'null'); }
  catch (e) { return null; }
}
