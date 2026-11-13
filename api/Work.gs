/**
 * PJ Portal API — work and attendance, read LIVE from each source sheet.
 *
 * Nothing is copied into the Registry. The Registry only holds two small
 * portal tabs:
 *   "Portal Sources": which spreadsheet + tab to read for each system
 *   "Portal Names":   short names used in sheets -> email (Babu, Megha, HR…)
 *
 * Each source is read, turned into one simple list of tasks, and kept in
 * Google's temporary script cache for WORK_CACHE_SECONDS (no sheet is written).
 * A timer (setupWorkTrigger) refreshes the cache every 10 minutes so the
 * portal stays fast. Only the last WORK_WINDOW_DAYS days, plus anything
 * still open, are kept in the cache.
 *
 * Task shape (short keys keep the cache small):
 *   s sysId, n system, y type (FMS|Checklist|Delegation), k item key,
 *   l item label, t task/step, p planned (ms), a actual (ms|null),
 *   d done, o on time (true|false|null), w [emails], u sheet row, b source key, f freq
 *
 * Rules agreed with MIS (13 Nov 2026):
 *   On time   = Actual on or before Planned (date and time).
 *   Pending   = no Actual and Planned has passed (overdue) / not yet (due).
 *   Delegation has no completion time: on time = Completed with 0 revisions.
 *   A Doer sees a task if they are its doer, buddy or final doer.
 */

var SOURCES_TAB = 'Portal Sources';
var NAMES_TAB = 'Portal Names';
var WORK_CACHE_SECONDS = 1500;      // 25 min; the timer refreshes every 10 min
var WORK_WINDOW_DAYS = 92;          // history kept in cache (about 3 months)
var WORK_FUTURE_DAYS = 31;          // upcoming tasks kept in cache
var CACHE_CHUNK = 90000;            // script cache: max 100 KB per value
var TZ = 'Asia/Kolkata';
var DAY_MS = 24 * 60 * 60 * 1000;

/* ---------------- Public: timer + test helpers ---------------- */

/** Run once from the editor: refresh the work cache every 10 minutes. */
function setupWorkTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshWorkCache') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshWorkCache').timeBased().everyMinutes(10).create();
  Logger.log('Timer set: refreshWorkCache every 10 minutes.');
}

/** Timer target: re-reads every active source into the cache. */
function refreshWorkCache() {
  loadWorkData_(true);
}

/** Run from the editor to check every source. Prints counts and unmatched names. */
function testWork() {
  var data = loadWorkData_(true);
  data.health.sources.forEach(function (h) {
    Logger.log(h.system + ' [' + h.tab + ']: ' + (h.error ? 'ERROR ' + h.error : h.rows + ' items') +
      ' (' + h.ms + ' ms)');
  });
  Logger.log('Attendance rows: ' + data.attendance.length);
  Logger.log('Unmatched names: ' + (data.health.unmatched.join(', ') || 'none'));
}

/* ---------------- API action ---------------- */

/**
 * work {session, from:'YYYY-MM-DD', to:'YYYY-MM-DD', person?}
 * Doer: only own tasks (doer / buddy / final doer) and own attendance.
 * Manager, Owner, Admin: everyone (or one person when "person" is given).
 */
function actionWork_(req) {
  var email = readSession_(req.session);
  var user = findPerson_(email);
  var range = parseRange_(req.from, req.to);
  var data = loadWorkData_(false);
  var now = Date.now();
  var isDoer = user.role === 'Doer';
  var mine = function (list) {
    for (var i = 0; i < list.length; i++) if (user.emails.indexOf(list[i]) > -1) return true;
    return false;
  };
  var person = req.person ? normaliseEmail_(req.person) : '';

  var tasks = data.tasks.filter(function (t) {
    var inRange = t.p >= range.from && t.p <= range.to;
    var carryOver = !t.d && t.p < range.from && t.y !== 'Checklist'; // still open from before
    if (!inRange && !carryOver) return false;
    if (isDoer) return mine(t.w);
    if (person) return t.w.indexOf(person) > -1;
    return true;
  }).map(function (t) {
    var status = t.d ? (t.o === true ? 'on_time' : t.o === false ? 'late' : 'done')
                     : (t.p < now ? 'overdue' : 'due');
    return {
      sys: t.s, system: t.n, type: t.y, key: t.k, label: t.l, task: t.t, freq: t.f || '',
      planned: t.p, actual: t.a, status: status, who: t.w, url: (data.bases[t.b] || '') + t.u,
      carry: t.p < range.from
    };
  });

  var attendance = data.attendance.filter(function (r) {
    if (r.date < range.fromKey || r.date > range.toKey) return false;
    if (isDoer) return user.emails.indexOf(r.email) > -1;   // never colleagues
    if (person) return r.email === person;
    return true;
  });

  var names = {};
  loadPeople_(false).forEach(function (p) { p.emails.forEach(function (e) { names[e] = p.name; }); });

  var out = {
    ok: true,
    user: user,
    scope: isDoer ? 'self' : 'all',
    range: { from: range.fromKey, to: range.toKey },
    names: names,
    tasks: tasks,
    attendance: attendance,
    builtAt: data.builtAt
  };
  if (!isDoer) {
    out.people = loadPeople_(false)
      .filter(function (p) { return p.active && PORTAL_ROLES.indexOf(p.role) > -1 && p.accountType !== 'Alias'; })
      .map(function (p) { return { email: p.emails[0], name: p.name, role: p.role, designation: p.designation }; });
  }
  if (user.role === 'Admin') out.health = data.health;
  return out;
}

function parseRange_(from, to) {
  var re = /^\d{4}-\d{2}-\d{2}$/;
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var f = re.test(from || '') ? from : today;
  var t = re.test(to || '') ? to : f;
  if (t < f) { var x = f; f = t; t = x; }
  var fromMs = Utilities.parseDate(f + ' 00:00:00', TZ, 'yyyy-MM-dd HH:mm:ss').getTime();
  var toMs = Utilities.parseDate(t + ' 23:59:59', TZ, 'yyyy-MM-dd HH:mm:ss').getTime();
  if (fromMs < Date.now() - WORK_WINDOW_DAYS * DAY_MS) throw apiError_('range_too_old');
  if (toMs - fromMs > WORK_WINDOW_DAYS * DAY_MS) throw apiError_('range_too_long');
  return { from: fromMs, to: toMs, fromKey: f, toKey: t };
}

/* ---------------- Loading (with cache) ---------------- */

function loadWorkData_(forceRefresh) {
  var cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    var hit = cacheGetBig_(cache, 'work_v1');
    if (hit) return hit;
  }
  var sources = loadSourcesCfg_();
  var names = buildNameMap_(sources);
  var cutoff = Date.now() - WORK_WINDOW_DAYS * DAY_MS;
  var horizon = Date.now() + WORK_FUTURE_DAYS * DAY_MS;
  var tasks = [], attendance = [], health = [], bases = {};

  sources.forEach(function (src) {
    var started = Date.now();
    var h = { system: src.system, tab: src.tab, type: src.type, rows: 0, error: '' };
    try {
      var ss = SpreadsheetApp.openById(src.id);
      if (src.type === 'Attendance') {
        var att = readAttendance_(src, ss, names, cutoff);
        attendance = attendance.concat(att);
        h.rows = att.length;
      } else {
        var list = src.type === 'FMS' ? readFms_(src, ss, names, cutoff, horizon)
                 : src.type === 'Checklist' ? readChecklist_(src, ss, names, cutoff, horizon)
                 : src.type === 'Delegation' ? readDelegation_(src, ss, names, cutoff, horizon)
                 : null;
        if (!list) throw new Error('Unknown type ' + src.type);
        var bk = src.sysId + '|' + src.tab;
        bases[bk] = list.base;                          // sheet link stored once per source
        list.forEach(function (t) { t.b = bk; });
        tasks = tasks.concat(list);
        h.rows = list.length;
      }
    } catch (err) {
      h.error = String(err && err.message || err);
    }
    h.ms = Date.now() - started;
    health.push(h);
  });

  var data = {
    tasks: tasks,
    bases: bases,
    attendance: attendance,
    health: { sources: health, unmatched: Object.keys(names.unmatched).sort() },
    builtAt: new Date().toISOString()
  };
  cachePutBig_(cache, 'work_v1', data, WORK_CACHE_SECONDS);
  return data;
}

function loadSourcesCfg_() {
  var sheet = SpreadsheetApp.openById(cfg_('REGISTRY_ID')).getSheetByName(SOURCES_TAB);
  if (!sheet) throw new Error('Registry tab not found: ' + SOURCES_TAB);
  var rows = sheet.getDataRange().getDisplayValues();
  var head = lowerRow_(rows[0]);
  var c = function (n) { return head.indexOf(n); };
  return rows.slice(1).map(function (r) {
    return {
      sysId: String(r[c('system id')] || '').trim(),
      system: String(r[c('system')] || '').trim(),
      type: String(r[c('type')] || '').trim(),
      id: String(r[c('spreadsheet id')] || '').trim(),
      tab: String(r[c('tab')] || '').trim(),
      active: isTrue_(r[c('active')])
    };
  }).filter(function (s) { return s.active && s.id && s.tab; });
}

/* ---------------- Name -> email ---------------- */

function normName_(s) {
  return String(s || '').toLowerCase()
    .replace(/\b(ma'?am|madam|sir|ji)\b/g, ' ')
    .replace(/[^a-z0-9@.ऀ-ॿ ]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Builds name -> [emails] from People, Portal Names and each FMS "Doer Emails" tab. */
function buildNameMap_(sources) {
  var map = {}, firstNames = {};
  var add = function (name, email) {
    var k = normName_(name), e = normaliseEmail_(email);
    if (!k) return;
    if (e === '-') { map[k] = []; return; }           // "-" = not a person, ignore
    if (e.indexOf('@') < 1) return;
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
    if (firstNames[f].length === 1 && !map[f]) add(f, firstNames[f][0]); // unique first name
  });

  var seen = {};
  sources.forEach(function (src) {
    if (src.type !== 'FMS' || seen[src.id]) return;
    seen[src.id] = true;
    try {
      var sh = SpreadsheetApp.openById(src.id).getSheetByName('Doer Emails');
      if (!sh) return;
      sh.getDataRange().getDisplayValues().slice(1).forEach(function (r) {
        if (r[2] && r[1]) add(r[2], r[1]);              // Doer Name -> Doer Email
      });
    } catch (e) {}
  });

  // Portal Names last: MIS overrides win.
  var sheet = SpreadsheetApp.openById(cfg_('REGISTRY_ID')).getSheetByName(NAMES_TAB);
  if (sheet) {
    sheet.getDataRange().getDisplayValues().slice(1).forEach(function (r) {
      var k = normName_(r[0]);
      if (!k) return;
      var e = normaliseEmail_(r[1]);
      if (e === '-') map[k] = [];
      else if (e.indexOf('@') > 0) map[k] = [e];
    });
  }
  return { map: map, unmatched: {} };
}

/** "Kishan / Priya", "Babu - 98673 24934", "x@gmail.com" -> [emails]. */
function resolveNames_(text, names) {
  var out = [];
  String(text || '').split(/\s*(?:\/|,|&|\band\b|\n)\s*/i).forEach(function (part) {
    var raw = part.replace(/\s+-\s+[\d\s+]+$/, '').trim();     // strip " - phone"
    if (!raw) return;
    if (/@/.test(raw)) { out.push(normaliseEmail_(raw)); return; }
    var hit = names.map[normName_(raw)];
    if (hit) hit.forEach(function (e) { if (out.indexOf(e) === -1) out.push(e); });
    else names.unmatched[raw] = true;
  });
  return out;
}

/* ---------------- Readers ---------------- */

/**
 * FMS (all F2D sheets + Hiring): row 2 = step names, row 3 = Who,
 * row 6 = column labels, data from row 7. A step is every
 * "Planned" column followed by "Actual". Optional "Doer" just before Planned.
 */
function readFms_(src, ss, names, cutoff, horizon) {
  var sheet = ss.getSheetByName(src.tab);
  if (!sheet) throw new Error('Tab not found: ' + src.tab);
  var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < 7) return [];
  var v = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var labels = lowerRow_(v[5]);
  var stepRow = v[1], whoRow = v[2];

  var keyCol = firstCol_(labels, ['unique key', 'repair id', 'transaction id', 'order number', 'job id']);
  var labelCols = ['customer name', 'customer first name', 'full name', 'job title / role', 'article name', 'article']
    .map(function (n) { return labels.indexOf(n); }).filter(function (i) { return i > -1; });
  var lastNameCol = labels.indexOf('customer last name');

  // Step blocks
  var steps = [], prevEnd = 0;
  for (var c = 1; c < labels.length - 1; c++) {
    if (labels[c] !== 'planned' || labels[c + 1] !== 'actual') continue;
    var nameCol = -1;
    for (var b = c; b >= prevEnd && b >= 1; b--) {
      if (String(stepRow[b] || '').trim()) { nameCol = b; break; }
    }
    steps.push({
      planned: c, actual: c + 1,
      doer: labels[c - 1] === 'doer' ? c - 1 : -1,
      name: nameCol > -1 ? String(stepRow[nameCol]).trim() : 'Step ' + (steps.length + 1),
      who: nameCol > -1 ? String(whoRow[nameCol] || '').trim() : ''
    });
    prevEnd = c + 2;
  }

  // Default doer per step from the "Doer Emails" tab
  var stepDoer = {};
  var de = ss.getSheetByName('Doer Emails');
  if (de) de.getDataRange().getDisplayValues().slice(1).forEach(function (r) {
    if (r[0] && r[1]) stepDoer[normName_(r[0])] = [normaliseEmail_(r[1])];
  });
  // Final doer for open steps from "DB_Format" (Unique Key + Step -> Final Doer Email)
  var finalDoer = {};
  var db = ss.getSheetByName('DB_Format');
  if (db && db.getLastRow() > 1) {
    var dv = db.getDataRange().getDisplayValues();
    var dh = lowerRow_(dv[0]);
    var ck = dh.indexOf('unique key'), cs = dh.indexOf('step'), cf = dh.indexOf('final doer email');
    if (ck > -1 && cs > -1 && cf > -1) dv.slice(1).forEach(function (r) {
      if (r[cf]) finalDoer[String(r[ck]).trim() + '|' + normName_(r[cs])] = normaliseEmail_(r[cf]);
    });
  }

  var base = ss.getUrl().replace(/\/edit.*$/, '') + '/edit#gid=' + sheet.getSheetId() + '&range=A';
  var out = [];
  for (var r = 6; r < v.length; r++) {
    var row = v[r];
    if (!row[0] && !row[1]) continue;
    var key = keyCol > -1 ? String(row[keyCol] || '').trim() : '';
    var label = labelCols.map(function (i) { return String(row[i] || '').trim(); }).filter(Boolean)[0] || '';
    if (lastNameCol > -1 && labels[labelCols[0]] === 'customer first name' && row[lastNameCol]) {
      label = (label + ' ' + String(row[lastNameCol]).trim()).trim();
    }
    steps.forEach(function (st) {
      var p = toMs_(row[st.planned]);
      if (!p) return;                                   // step not reached yet
      var a = toMs_(row[st.actual]);
      if (a && p < cutoff) return;                      // old and finished
      if (!a && p > horizon) return;
      var who = [];
      if (st.doer > -1 && String(row[st.doer] || '').trim()) who = resolveNames_(row[st.doer], names);
      if (!who.length) who = stepDoer[normName_(st.name)] || [];
      if (!who.length && st.who) who = resolveNames_(st.who, names);
      var fd = finalDoer[key + '|' + normName_(st.name)];
      if (fd && who.indexOf(fd) === -1) who = who.concat([fd]);
      out.push({
        s: src.sysId, n: src.system, y: 'FMS', k: key || 'Row ' + (r + 1), l: label,
        t: st.name, p: p, a: a, d: Boolean(a), o: a ? a <= p : null, w: who, u: r + 1
      });
    });
  }
  out.base = base;
  return out;
}

/** Checklist "Master": one row per task per date. Doer = Email, plus Buddy Email. */
function readChecklist_(src, ss, names, cutoff, horizon) {
  var sheet = ss.getSheetByName(src.tab);
  if (!sheet) throw new Error('Tab not found: ' + src.tab);
  var v = sheet.getDataRange().getValues();
  var h = lowerRow_(v[0]);
  var col = function (n) { return h.indexOf(n); };
  var cTask = col('task'), cP = col('planned'), cA = col('actual'), cE = col('email'),
      cAcc = col('email of person accountable'), cB = col('buddy email'), cF = col('freq'),
      cId = col('task id'), cN = col('name');
  if (cTask < 0 || cP < 0 || cA < 0) throw new Error('Master needs Task, Planned and Actual columns');
  var base = ss.getUrl().replace(/\/edit.*$/, '') + '/edit#gid=' + sheet.getSheetId() + '&range=A';

  var out = [];
  for (var r = 1; r < v.length; r++) {
    var row = v[r];
    var p = toMs_(row[cP]);
    if (!p || p < cutoff || p > horizon) continue;
    var a = toMs_(row[cA]);
    var who = [];
    [cE, cAcc, cB].forEach(function (ci) {
      if (ci < 0 || !row[ci]) return;
      resolveNames_(row[ci], names).forEach(function (e) { if (who.indexOf(e) === -1) who.push(e); });
    });
    if (!who.length && cN > -1) who = resolveNames_(row[cN], names);
    out.push({
      s: src.sysId, n: src.system, y: 'Checklist', k: cId > -1 ? String(row[cId]) : String(r + 1),
      l: '', t: String(row[cTask] || '').trim(), p: p, a: a, d: Boolean(a), o: a ? a <= p : null,
      w: who, u: r + 1, f: cF > -1 ? String(row[cF] || '') : ''
    });
  }
  out.base = base;
  return out;
}

/** Delegation "Master": due = Latest Revision (end of that day). */
function readDelegation_(src, ss, names, cutoff, horizon) {
  var sheet = ss.getSheetByName(src.tab);
  if (!sheet) throw new Error('Tab not found: ' + src.tab);
  var v = sheet.getDataRange().getValues();
  var h = lowerRow_(v[0]);
  var col = function (n) { return h.indexOf(n); };
  var cId = col('task id'), cN = col('name'), cT = col('task'), cL = col('latest revision'),
      cFirst = col('first date'), cR = col('total revisions'), cS = col('status');
  var base = ss.getUrl().replace(/\/edit.*$/, '') + '/edit#gid=' + sheet.getSheetId() + '&range=A';

  var out = [];
  for (var r = 1; r < v.length; r++) {
    var row = v[r];
    if (!row[cT]) continue;
    var due = toMs_(cL > -1 && row[cL] ? row[cL] : row[cFirst]);
    if (!due) continue;
    due = endOfDay_(due);
    var done = /complete/i.test(String(row[cS] || ''));
    if (done && due < cutoff) continue;
    if (!done && due > horizon) continue;
    var revisions = Number(row[cR]) || 0;
    out.push({
      s: src.sysId, n: src.system, y: 'Delegation', k: String(row[cId] || r + 1), l: String(row[cS] || ''),
      t: String(row[cT]).trim(), p: due, a: null, d: done, o: done ? revisions === 0 : null,
      w: resolveNames_(row[cN], names), u: r + 1
    });
  }
  out.base = base;
  return out;
}

/**
 * Attendance "ATTENDANCE": one row per person per day.
 * Email comes from EMPLOYEES — only its Employee Name (A) and Email (D)
 * columns are read; salary columns are never touched.
 */
function readAttendance_(src, ss, names, cutoff) {
  var emp = {};
  var es = ss.getSheetByName('EMPLOYEES');
  if (es && es.getLastRow() > 1) {
    es.getRange(2, 1, es.getLastRow() - 1, 1).getDisplayValues().forEach(function (r, i) { emp[i] = r[0]; });
    es.getRange(2, 4, es.getLastRow() - 1, 1).getDisplayValues().forEach(function (r, i) {
      if (emp[i] && r[0]) names.map[normName_(emp[i])] = [normaliseEmail_(r[0])];
    });
  }
  var sheet = ss.getSheetByName(src.tab);
  if (!sheet) throw new Error('Tab not found: ' + src.tab);
  var v = sheet.getDataRange().getDisplayValues();
  var h = lowerRow_(v[0]);
  var col = function (n) { return h.indexOf(n); };
  var cutKey = Utilities.formatDate(new Date(cutoff), TZ, 'yyyy-MM-dd');

  var out = [];
  for (var r = 1; r < v.length; r++) {
    var row = v[r];
    var date = dateKey_(row[col('date')]);
    if (!date || date < cutKey) continue;
    var who = resolveNames_(row[col('employee name')], names);
    if (!who.length) continue;
    out.push({
      date: date, email: who[0], name: String(row[col('employee name')]).replace(/\s+/g, ' ').trim(),
      checkIn: row[col('check-in time')] || '', checkOut: row[col('check-out time')] || '',
      hours: Number(row[col('working hours')]) || 0, status: row[col('status')] || '',
      late: /^y/i.test(row[col('late')] || ''), lateBy: Number(row[col('late by (mins)')]) || 0,
      dayType: row[col('day type')] || '', earlyLeave: /^y/i.test(row[col('early leave')] || '')
    });
  }
  return out;
}

/* ---------------- Small helpers ---------------- */

function lowerRow_(row) { return (row || []).map(function (x) { return String(x).trim().toLowerCase(); }); }

function firstCol_(labels, list) {
  for (var i = 0; i < list.length; i++) { var c = labels.indexOf(list[i]); if (c > -1) return c; }
  return -1;
}

/** Date object, "dd/MM/yyyy HH:mm:ss", "dd/MM/yyyy" or "yyyy-MM-dd" -> ms (IST). */
function toMs_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : v.getTime();
  var s = String(v).trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    return Utilities.parseDate(m[3] + '-' + pad_(m[2]) + '-' + pad_(m[1]) + ' ' +
      pad_(m[4] || 0) + ':' + pad_(m[5] || 0) + ':' + pad_(m[6] || 0), TZ, 'yyyy-MM-dd HH:mm:ss').getTime();
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Utilities.parseDate(m[1] + '-' + m[2] + '-' + m[3] + ' 00:00:00', TZ, 'yyyy-MM-dd HH:mm:ss').getTime();
  return null;
}

function dateKey_(v) {
  var ms = toMs_(v);
  return ms ? Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd') : '';
}

function endOfDay_(ms) {
  var key = Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd');
  return Utilities.parseDate(key + ' 23:59:59', TZ, 'yyyy-MM-dd HH:mm:ss').getTime();
}

function pad_(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

/** Script cache holds max 100 KB per value: split big JSON into chunks. */
function cachePutBig_(cache, key, obj, seconds) {
  try {
    var json = JSON.stringify(obj), parts = {}, n = 0;
    for (var i = 0; i < json.length; i += CACHE_CHUNK) parts[key + '_' + (n++)] = json.substr(i, CACHE_CHUNK);
    parts[key + '_n'] = String(n);
    cache.putAll(parts, seconds);
  } catch (e) {
    console.warn('Work cache too big, served live only: ' + e);
  }
}

function cacheGetBig_(cache, key) {
  var n = Number(cache.get(key + '_n'));
  if (!n) return null;
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(key + '_' + i);
  var got = cache.getAll(keys), json = '';
  for (var j = 0; j < n; j++) {
    if (got[keys[j]] == null) return null;
    json += got[keys[j]];
  }
  try { return JSON.parse(json); } catch (e) { return null; }
}
