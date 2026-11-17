/**
 * PJ Portal API: Messages (Step 13). One-to-one messages between staff.
 *
 *   inbox   {session}           -> {ok, unread, conversations, contacts}
 *   thread  {session, with}     -> {ok, with, messages}   (also marks them read)
 *   sendMessage {session, to, text} -> {ok, message}
 *   unread  {session}           -> {ok, unread}           (small, for the header badge)
 *
 * Anyone Active in the People tab can message anyone else Active (not the
 * automation account). Messages are stored in the Registry tab "Portal Messages",
 * created automatically: one row per message, with who, when and when it was read.
 * Text is plain, formula-safe and at most 1000 characters; 150 messages a day each.
 */

var MSG_TAB = 'Portal Messages';
var MSG_HEADERS = ['ID', 'Sent at', 'From', 'From name', 'To', 'To name', 'Text', 'Read at'];
var MSG_CACHE = 'msg_v1';
var MSG_MAX_LEN = 1000;
var MSG_DAILY = 150;
var MSG_THREAD_MAX = 200;

function msgHeaders_() { HEADERS[MSG_TAB] = MSG_HEADERS; }

/** All messages, oldest first. Cached for 60 seconds (cleared on every send / read). */
function loadMessages_() {
  var cache = CacheService.getScriptCache();
  var packed = joinParts_(function (keys) { return cache.getAll(keys); }, cache.get(MSG_CACHE + '_n'), MSG_CACHE + '_');
  if (packed) { try { return unpack_(packed); } catch (e) {} }
  var sh = SpreadsheetApp.openById(cfg_('REGISTRY_ID')).getSheetByName(MSG_TAB);
  var list = [];
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, MSG_HEADERS.length).getValues().forEach(function (r, i) {
      if (!r[0]) return;
      var at = r[1] instanceof Date ? r[1].getTime() : Date.parse(r[1]) || 0;
      var readAt = r[7] instanceof Date ? r[7].getTime() : (r[7] ? Date.parse(r[7]) || 1 : 0);
      list.push({ id: String(r[0]), at: at, from: normaliseEmail_(r[2]), to: normaliseEmail_(r[4]),
                  text: String(r[6] || '').replace(/^'(?=[=+\-@])/, ''), readAt: readAt || null, row: i + 2 });
    });
  }
  try {
    var p = pack_(list), parts = {}, n = 0;
    for (var j = 0; j < p.length; j += CACHE_CHUNK) parts[MSG_CACHE + '_' + (n++)] = p.substr(j, CACHE_CHUNK);
    parts[MSG_CACHE + '_n'] = String(n);
    cache.putAll(parts, 60);
  } catch (e) { /* fine: read the sheet again next time */ }
  return list;
}

function clearMessageCache_() { CacheService.getScriptCache().remove(MSG_CACHE + '_n'); }

/** Active people who can be messaged, keyed by every email they have. */
function messageable_() {
  var byEmail = {}, list = [];
  loadPeople_(false).forEach(function (p) {
    if (!p.active || PORTAL_ROLES.indexOf(p.role) === -1 || p.accountType === 'Alias') return;
    var c = { email: p.emails[0], name: p.name, designation: p.designation || '', role: p.role, emails: p.emails };
    list.push(c);
    p.emails.forEach(function (e) { byEmail[e] = c; });
  });
  return { byEmail: byEmail, list: list };
}

function actionInbox_(req) {
  var user = findPerson_(readSession_(req.session));
  var people = messageable_(), mine = user.emails;
  var convs = {}, unread = 0;
  loadMessages_().forEach(function (m) {
    var out = mine.indexOf(m.from) > -1, inn = mine.indexOf(m.to) > -1;
    if (!out && !inn) return;
    var otherEmail = out ? m.to : m.from;
    var other = people.byEmail[otherEmail];
    var key = other ? other.email : otherEmail;
    var c = convs[key] = convs[key] || { email: key, name: other ? other.name : otherEmail,
      designation: other ? other.designation : '', active: Boolean(other), unread: 0, last: null };
    c.last = { text: m.text.slice(0, 90), at: m.at, mine: out };
    if (inn && !out && !m.readAt) { c.unread++; unread++; }
  });
  var list = Object.keys(convs).map(function (k) { return convs[k]; })
    .sort(function (a, b) { return b.last.at - a.last.at; });
  return {
    ok: true, unread: unread, conversations: list,
    contacts: people.list.filter(function (c) { return c.emails.indexOf(user.email) === -1; })
      .map(function (c) { return { email: c.email, name: c.name, designation: c.designation, role: c.role }; })
      .sort(function (a, b) { return a.name < b.name ? -1 : 1; })
  };
}

function actionUnread_(req) {
  var user = findPerson_(readSession_(req.session));
  var n = 0;
  loadMessages_().forEach(function (m) {
    if (user.emails.indexOf(m.to) > -1 && user.emails.indexOf(m.from) === -1 && !m.readAt) n++;
  });
  return { ok: true, unread: n };
}

function actionThread_(req) {
  var user = findPerson_(readSession_(req.session));
  var people = messageable_();
  var withEmail = normaliseEmail_(req['with']);
  var other = people.byEmail[withEmail];
  var otherEmails = other ? other.emails : [withEmail];
  var mine = user.emails;
  var msgs = loadMessages_().filter(function (m) {
    return (mine.indexOf(m.from) > -1 && otherEmails.indexOf(m.to) > -1) ||
           (otherEmails.indexOf(m.from) > -1 && mine.indexOf(m.to) > -1);
  });
  if (!other && !msgs.length) throw apiError_('bad_request');

  // Mark their messages to me as read (one sheet call)
  var toMark = msgs.filter(function (m) { return mine.indexOf(m.to) > -1 && otherEmails.indexOf(m.from) > -1 && !m.readAt; });
  if (toMark.length) {
    var now = new Date();
    withLock_(function () {
      var sh = SpreadsheetApp.openById(cfg_('REGISTRY_ID')).getSheetByName(MSG_TAB);
      sh.getRangeList(toMark.map(function (m) { return 'H' + m.row; })).setValue(now);
    });
    toMark.forEach(function (m) { m.readAt = now.getTime(); });
    clearMessageCache_();
  }
  return {
    ok: true,
    'with': { email: other ? other.email : withEmail, name: other ? other.name : withEmail,
              designation: other ? other.designation : '', active: Boolean(other) },
    messages: msgs.slice(-MSG_THREAD_MAX).map(function (m) {
      return { id: m.id, at: m.at, mine: mine.indexOf(m.from) > -1, text: m.text, readAt: m.readAt };
    })
  };
}

function actionSendMessage_(req) {
  var user = findPerson_(readSession_(req.session));
  var people = messageable_();
  var to = people.byEmail[normaliseEmail_(req.to)];
  if (!to || to.emails.indexOf(user.email) > -1) throw apiError_('bad_request');
  var text = cleanText_(req.text, MSG_MAX_LEN);
  if (!text) throw apiError_('bad_request');
  var list = loadMessages_();
  if (countToday_(list, user.email) >= MSG_DAILY) throw apiError_('daily_limit');

  var id = 'M' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  var now = new Date();
  msgHeaders_();
  withLock_(function () {
    sheetOf_(MSG_TAB).appendRow([id, now, user.email, safeCell_(user.name), to.email, safeCell_(to.name), safeCell_(text), '']);
  });
  clearMessageCache_();
  if (typeof notifyPush_ === 'function') {
    try { notifyPush_(to.emails, '💬 New message from ' + user.name, 'Open the portal to read it.', '#messages/' + encodeURIComponent(user.email)); }
    catch (e) { console.warn('push failed: ' + e); }
  }
  return { ok: true, message: { id: id, at: now.getTime(), mine: true, text: text, readAt: null } };
}
