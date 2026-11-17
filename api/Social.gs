/**
 * PJ Portal API — Notice board ("Got it") and Kudos wall.
 *
 * These are the portal's ONLY writes, and they go only to three portal tabs
 * in the System Registry (created automatically on first use):
 *   Portal Notices  — one row per notice
 *   Portal Reads    — one row per "Got it" (notice id + person)
 *   Portal Kudos    — one row per appreciation
 * Nothing else is ever written. System Master and the source sheets are never touched.
 *
 * Who can do what:
 *   Everyone            : read notices, tap "Got it", see kudos
 *   Admin/Owner/Manager : post / take down notices, give kudos (not to themselves)
 *   Admin               : also take down any notice or kudos
 *
 * Safety: text is stored as plain text (a leading = + - @ is escaped so it can
 * never run as a formula), lengths are capped, and each person has a daily limit.
 */

var NOTICES_TAB = 'Portal Notices';
var READS_TAB = 'Portal Reads';
var KUDOS_TAB = 'Portal Kudos';
var SOCIAL_CACHE_SECONDS = 60;
var NOTICE_LIMITS = { title: 100, message: 1000, perDay: 20 };
var KUDOS_LIMITS = { message: 200, perDay: 30 };
var AUDIENCES = ['All', 'Doers', 'Managers'];   // Managers = Admin, Owner, Manager

var HEADERS = {};
HEADERS[NOTICES_TAB] = ['ID', 'Posted at', 'Posted by', 'Posted by name', 'Title', 'Message', 'Audience', 'Pinned', 'Expires', 'Active'];
HEADERS[READS_TAB] = ['Notice ID', 'Email', 'Name', 'Read at'];
HEADERS[KUDOS_TAB] = ['ID', 'Given at', 'From', 'From name', 'To', 'To name', 'Message', 'Active'];

/* ================= Read: notices + kudos in one call ================= */

/** social {session} -> {ok, notices, kudos, canPost} */
function actionSocial_(req) {
  var user = findPerson_(readSession_(req.session));
  var data = loadSocial_();
  var isDoer = user.role === 'Doer';
  var canPost = !isDoer;
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');

  var readsBy = {};
  data.reads.forEach(function (r) { (readsBy[r.id] = readsBy[r.id] || {})[r.email] = r.at; });
  var audienceOf = function (n) {
    return loadPeople_(false).filter(function (p) {
      if (!p.active || PORTAL_ROLES.indexOf(p.role) === -1 || p.accountType === 'Alias') return false;
      if (n.audience === 'Doers') return p.role === 'Doer';
      if (n.audience === 'Managers') return p.role !== 'Doer';
      return true;
    });
  };
  var forMe = function (n) {
    if (n.audience === 'Doers') return isDoer || user.role === 'Admin';
    if (n.audience === 'Managers') return !isDoer;
    return true;
  };

  var notices = data.notices
    .filter(function (n) { return n.active && (!n.expires || n.expires >= today) && (forMe(n) || n.by === user.email); })
    .map(function (n) {
      var reads = readsBy[n.id] || {};
      var mine = user.emails.some(function (e) { return reads[e]; });
      var out = { id: n.id, at: n.at, by: n.by, byName: n.byName, title: n.title, message: n.message,
                  audience: n.audience, pinned: n.pinned, expires: n.expires, read: mine,
                  canRemove: n.by === user.email || user.role === 'Admin' };
      if (canPost) {                                  // read receipts for posters / managers
        var people = audienceOf(n);
        out.readers = people.filter(function (p) { return p.emails.some(function (e) { return reads[e]; }); }).map(function (p) { return p.name; });
        out.notRead = people.filter(function (p) { return !p.emails.some(function (e) { return reads[e]; }); }).map(function (p) { return p.name; });
      }
      return out;
    })
    .sort(function (a, b) { return (b.pinned - a.pinned) || (a.read - b.read) || (b.at - a.at); });

  var kudos = data.kudos.filter(function (k) { return k.active; })
    .sort(function (a, b) { return b.at - a.at; }).slice(0, 60)
    .map(function (k) {
      return { id: k.id, at: k.at, from: k.from, fromName: k.fromName, to: k.to, toName: k.toName, message: k.message,
               canRemove: user.role === 'Admin' || k.from === user.email };
    });

  return { ok: true, notices: notices, kudos: kudos, canPost: canPost, audiences: AUDIENCES };
}

/* ================= Writes ================= */

/** postNotice {session, title, message, audience, pinned, expires} */
function actionPostNotice_(req) {
  var user = requirePoster_(req);
  var title = cleanText_(req.title, NOTICE_LIMITS.title);
  var message = cleanText_(req.message, NOTICE_LIMITS.message);
  if (!title || !message) throw apiError_('missing_fields');
  var audience = AUDIENCES.indexOf(req.audience) > -1 ? req.audience : 'All';
  var expires = /^\d{4}-\d{2}-\d{2}$/.test(req.expires || '') ? req.expires : '';
  var result = withLock_(function () {
    var data = loadSocial_(true);
    if (countToday_(data.notices, user.email) >= NOTICE_LIMITS.perDay) throw apiError_('daily_limit');
    var id = 'N-' + Utilities.getUuid().slice(0, 8);
    sheetOf_(NOTICES_TAB).appendRow([id, new Date(), user.email, safeCell_(user.name), safeCell_(title), safeCell_(message),
      audience, req.pinned ? 'Yes' : 'No', expires, 'Yes']);
    clearSocialCache_();
    return { ok: true, id: id };
  });
  // Phone notification (after the lock, so nobody waits for it)
  if (typeof notifyPush_ === 'function') notifyPush_(audienceEmails_(audience, user.email), '📢 ' + title, 'New notice from ' + user.name, '#systems', 'notice');
  return result;
}

/** readNotice {session, id}: "Got it" */
function actionReadNotice_(req) {
  var user = findPerson_(readSession_(req.session));
  var id = String(req.id || '');
  if (!/^N-[\w-]{4,20}$/.test(id)) throw apiError_('bad_request');
  return withLock_(function () {
    var data = loadSocial_(true);
    if (!data.notices.some(function (n) { return n.id === id && n.active; })) throw apiError_('not_found');
    var already = data.reads.some(function (r) { return r.id === id && user.emails.indexOf(r.email) > -1; });
    if (!already) {
      sheetOf_(READS_TAB).appendRow([id, user.email, safeCell_(user.name), new Date()]);
      clearSocialCache_();
    }
    return { ok: true };
  });
}

/** removeNotice {session, id}: poster or Admin. Sets Active = No (kept for history). */
function actionRemoveNotice_(req) {
  var user = findPerson_(readSession_(req.session));
  return setInactive_(NOTICES_TAB, String(req.id || ''), function (row) {
    return row.by === user.email || user.role === 'Admin';
  });
}

/** giveKudos {session, to, message} */
function actionGiveKudos_(req) {
  var user = requirePoster_(req);
  var to = normaliseEmail_(req.to);
  var message = cleanText_(req.message, KUDOS_LIMITS.message);
  if (!to || !message) throw apiError_('missing_fields');
  if (user.emails.indexOf(to) > -1) throw apiError_('not_yourself');
  var target = loadPeople_(false).filter(function (p) {
    return p.active && p.emails.indexOf(to) > -1 && PORTAL_ROLES.indexOf(p.role) > -1;
  })[0];
  if (!target) throw apiError_('not_registered_person');
  var result = withLock_(function () {
    var data = loadSocial_(true);
    if (countToday_(data.kudos, user.email) >= KUDOS_LIMITS.perDay) throw apiError_('daily_limit');
    var id = 'K-' + Utilities.getUuid().slice(0, 8);
    sheetOf_(KUDOS_TAB).appendRow([id, new Date(), user.email, safeCell_(user.name), target.emails[0], safeCell_(target.name),
      safeCell_(message), 'Yes']);
    clearSocialCache_();
    return { ok: true, id: id };
  });
  if (typeof notifyPush_ === 'function') notifyPush_(target.emails, '👏 ' + user.name + ' appreciated you', 'Tap to see it on your profile.', '#person/' + encodeURIComponent(target.emails[0]), 'kudos');
  return result;
}

/** removeKudos {session, id}: giver or Admin. */
function actionRemoveKudos_(req) {
  var user = findPerson_(readSession_(req.session));
  return setInactive_(KUDOS_TAB, String(req.id || ''), function (row) {
    return row.from === user.email || user.role === 'Admin';
  });
}

/* ================= Helpers ================= */

function requirePoster_(req) {
  var user = findPerson_(readSession_(req.session));
  if (user.role === 'Doer') throw apiError_('forbidden');
  return user;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw apiError_('busy');
  try { return fn(); } finally { lock.releaseLock(); }
}

/** Gets a portal tab, creating it with headers the first time. */
function sheetOf_(name) {
  var ss = SpreadsheetApp.openById(cfg_('REGISTRY_ID'));
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function loadSocial_(fresh) {
  var cache = CacheService.getScriptCache();
  if (!fresh) {
    var hit = cache.get('social_v1');
    if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  }
  var rows = function (name) {
    var sh = SpreadsheetApp.openById(cfg_('REGISTRY_ID')).getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS[name].length).getValues();
  };
  var ms = function (v) { return v instanceof Date ? v.getTime() : (toMs_(v) || 0); };
  var day = function (v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v || '').slice(0, 10); };
  var data = {
    notices: rows(NOTICES_TAB).filter(function (r) { return r[0]; }).map(function (r) {
      return { id: String(r[0]), at: ms(r[1]), by: normaliseEmail_(r[2]), byName: String(r[3]), title: String(r[4]),
               message: String(r[5]), audience: String(r[6] || 'All'), pinned: isTrue_(r[7]), expires: r[8] ? day(r[8]) : '',
               active: isTrue_(r[9]) };
    }),
    reads: rows(READS_TAB).filter(function (r) { return r[0]; }).map(function (r) {
      return { id: String(r[0]), email: normaliseEmail_(r[1]), at: ms(r[3]) };
    }),
    kudos: rows(KUDOS_TAB).filter(function (r) { return r[0]; }).map(function (r) {
      return { id: String(r[0]), at: ms(r[1]), from: normaliseEmail_(r[2]), fromName: String(r[3]), to: normaliseEmail_(r[4]),
               toName: String(r[5]), message: String(r[6]), active: isTrue_(r[7]) };
    })
  };
  try { cache.put('social_v1', JSON.stringify(data), SOCIAL_CACHE_SECONDS); } catch (e) {}
  return data;
}

function clearSocialCache_() { CacheService.getScriptCache().remove('social_v1'); }

function setInactive_(tab, id, allowed) {
  if (!/^[NK]-[\w-]{4,20}$/.test(id)) throw apiError_('bad_request');
  return withLock_(function () {
    var data = loadSocial_(true);
    var list = tab === NOTICES_TAB ? data.notices : data.kudos;
    var row = list.filter(function (x) { return x.id === id; })[0];
    if (!row) throw apiError_('not_found');
    if (!allowed(row)) throw apiError_('forbidden');
    var sh = sheetOf_(tab);
    var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === id) { sh.getRange(i + 2, HEADERS[tab].length).setValue('No'); break; }
    }
    clearSocialCache_();
    return { ok: true };
  });
}

function countToday_(list, email) {
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  return list.filter(function (x) {
    return (x.by === email || x.from === email) && x.at && Utilities.formatDate(new Date(x.at), TZ, 'yyyy-MM-dd') === today;
  }).length;
}

function cleanText_(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

/** Stops text like "=IMPORTXML(...)" from ever running as a formula in the sheet. */
function safeCell_(s) {
  s = String(s == null ? '' : s);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
