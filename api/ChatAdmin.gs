/**
 * PJ Portal API: Chat records (Step 13, part 3).
 *
 * 1. Chat Archive: a separate private spreadsheet "PJ Portal Chat Archive" (in the
 *    mis@ Drive chat folder). Once a day (23:00 IST) and on "Archive now", new chat
 *    messages are copied there: date, chat, from, to, text, file link. It also has
 *    a "Guide" tab (where everything is stored, limits, how to delete) and a
 *    "Deletion log" tab.
 * 2. Delete tool (Admin only): delete chat messages by person, chat and/or date
 *    range. Always archives first, previews counts, needs the word DELETE, and
 *    logs who deleted what. Photos / videos / PDFs of those messages go to the
 *    Drive bin (recoverable for 30 days). Archive rows are kept unless asked.
 * 3. Audit setting: OFF by default. Only Admin can turn it on. While on, Admin,
 *    Owners and Managers can read chats sent from the moment it was turned on
 *    (never older ones). Every staff member sees a notice in Messages while on.
 *
 * Firestore is read and written here with the project owner's access (mis@),
 * so the strict Firestore rules for the portal stay unchanged.
 */

var CHAT_ARCHIVE_PROP = 'chat_archive_id';
var CHAT_ARCHIVE_UPTO = 'chat_archive_upto';
var CHAT_AUDIT_PROP = 'chat_audit';
var CHAT_AUDIT_ROLES = ['Admin', 'Owner', 'Manager'];
var ARCHIVE_HEADERS = ['Date', 'Chat', 'From name', 'From', 'To name', 'To', 'Text', 'File name', 'File type', 'File link', 'Message ID', 'Chat ID'];
var PURGE_MAX = 3000;

/* ================= Firestore REST helpers ================= */

function fsVal_(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsVal_);
  if ('mapValue' in v) {
    var o = {}, f = v.mapValue.fields || {};
    Object.keys(f).forEach(function (k) { o[k] = fsVal_(f[k]); });
    return o;
  }
  return null;
}

function fsDoc_(d) {
  var o = { _name: d.name, _id: decodeURIComponent(d.name.split('/').pop()) }, f = d.fields || {};
  Object.keys(f).forEach(function (k) { o[k] = fsVal_(f[k]); });
  return o;
}

function listChats_() {
  var out = [], page = '';
  do {
    var r = fsFetch_('get', '/chats?pageSize=300' + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
    (r.documents || []).forEach(function (d) { out.push(fsDoc_(d)); });
    page = r.nextPageToken || '';
  } while (page);
  return out;
}

/** Messages of many chats at once. opts: {after, from, to, desc, limit}. Returns {chatId: [msg]}. */
function chatMessagesMany_(chatIds, opts) {
  var filters = [];
  var ts = function (ms) { return { timestampValue: new Date(ms).toISOString() }; };
  if (opts.after) filters.push({ fieldFilter: { field: { fieldPath: 'at' }, op: 'GREATER_THAN', value: ts(opts.after) } });
  if (opts.from) filters.push({ fieldFilter: { field: { fieldPath: 'at' }, op: 'GREATER_THAN_OR_EQUAL', value: ts(opts.from) } });
  if (opts.to) filters.push({ fieldFilter: { field: { fieldPath: 'at' }, op: 'LESS_THAN_OR_EQUAL', value: ts(opts.to) } });
  var sq = { from: [{ collectionId: 'messages' }], orderBy: [{ field: { fieldPath: 'at' }, direction: opts.desc ? 'DESCENDING' : 'ASCENDING' }],
             limit: opts.limit || 5000 };
  if (filters.length === 1) sq.where = filters[0];
  if (filters.length > 1) sq.where = { compositeFilter: { op: 'AND', filters: filters } };
  var token = ScriptApp.getOAuthToken(), out = {};
  for (var i = 0; i < chatIds.length; i += 40) {
    var part = chatIds.slice(i, i + 40);
    var res = UrlFetchApp.fetchAll(part.map(function (id) {
      return { url: FS_BASE + '/chats/' + encodeURIComponent(id) + ':runQuery', method: 'post', contentType: 'application/json',
               muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify({ structuredQuery: sq }) };
    }));
    res.forEach(function (r, j) {
      if (r.getResponseCode() >= 300) throw new Error('Firestore ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
      out[part[j]] = JSON.parse(r.getContentText() || '[]').filter(function (x) { return x.document; })
        .map(function (x) { return fsDoc_(x.document); });
    });
  }
  return out;
}

function fsCommit_(writes) {
  for (var i = 0; i < writes.length; i += 400) fsFetch_('post', ':commit', { writes: writes.slice(i, i + 400) });
}

function staffNames_() {
  var names = {};
  loadPeople_(false).forEach(function (p) { p.emails.forEach(function (e) { names[e] = p.name; }); });
  return names;
}

function requireAdmin_(req) {
  var user = findPerson_(readSession_(req.session));
  if (user.role !== 'Admin') throw apiError_('forbidden');
  return user;
}

/* ================= 1. Archive spreadsheet ================= */

/** Creates the archive spreadsheet and the daily timer (safe to run again). */
function setupChatArchive() {
  var ss = archiveBook_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'archiveChats') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('archiveChats').timeBased().everyDays(1).atHour(23).inTimezone(TZ).create();
  console.log('Chat Archive: ' + ss.getUrl() + ' · copied every day at 23:00 IST');
}

function archiveBook_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(CHAT_ARCHIVE_PROP);
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { /* deleted: make a new one */ } }
  var f = Drive.Files.create({ name: 'PJ Portal Chat Archive', mimeType: 'application/vnd.google-apps.spreadsheet', parents: [chatFolderId_()],
                               description: 'Daily copy of PJ Portal chat messages. Private: do not share.' });
  var ss = SpreadsheetApp.openById(f.id);
  ss.setSpreadsheetTimeZone(TZ);                         // show times in India time
  var msg = ss.getSheets()[0].setName('Messages');
  msg.getRange(1, 1, 1, ARCHIVE_HEADERS.length).setValues([ARCHIVE_HEADERS]).setFontWeight('bold').setBackground('#0B1F3A').setFontColor('#ffffff');
  msg.setFrozenRows(1);
  msg.setColumnWidth(7, 420);
  var log = ss.insertSheet('Deletion log');
  log.getRange(1, 1, 1, 7).setValues([['When', 'By', 'What was deleted', 'Messages', 'Files to bin', 'Archive rows removed', 'Chats removed']]).setFontWeight('bold');
  log.setFrozenRows(1);
  ss.insertSheet('Guide', 0);
  props.setProperty(CHAT_ARCHIVE_PROP, f.id);
  writeChatGuide_(ss);
  return ss;
}

/** Timer target: copies new messages to the archive. */
function archiveChats() {
  var out = archiveChats_();
  // Only if the Portal Guide tab is missing (e.g. removed by a Registry update): write it back. Otherwise nothing is written.
  try { if (!SpreadsheetApp.openById(cfg_('REGISTRY_ID')).getSheetByName(GUIDE_TAB)) writePortalGuide_(); } catch (e) { console.warn('Portal Guide check: ' + e); }
  return out;
}

function archiveChats_() {
  var done = withBuildFlag_('chat_archive', 60000, function () {
    var props = PropertiesService.getScriptProperties();
    var upto = Number(props.getProperty(CHAT_ARCHIVE_UPTO) || 0);
    var ss = archiveBook_(), sh = ss.getSheetByName('Messages');
    if (ss.getSpreadsheetTimeZone() !== TZ) ss.setSpreadsheetTimeZone(TZ);   // fixes archives made before 0.16.1
    var names = staffNames_();
    var chats = listChats_();
    var many = chatMessagesMany_(chats.map(function (c) { return c._id; }), { after: upto });
    var rows = [], max = upto;
    chats.forEach(function (c) {
      var members = c.members || [];
      var chatName = members.map(function (e) { return names[e] || e; }).join(' – ');
      (many[c._id] || []).forEach(function (m) {
        var to = members.filter(function (e) { return e !== m.from; })[0] || '';
        var f = m.file || null;
        rows.push([new Date(m.at), chatName, names[m.from] || m.from, m.from, names[to] || to, to, safeCell_(m.text || ''),
          f ? safeCell_(f.name || '') : '', f ? f.kind || '' : '', f && f.id ? 'https://drive.google.com/file/d/' + f.id + '/view' : '',
          m._id, c._id]);
        if (m.at > max) max = m.at;
      });
    });
    rows.sort(function (a, b) { return a[0] - b[0]; });
    if (rows.length) {
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, ARCHIVE_HEADERS.length).setValues(rows);
      sh.getRange(2, 1, sh.getLastRow() - 1, 1).setNumberFormat('dd-mmm-yyyy hh:mm');
    }
    props.setProperty(CHAT_ARCHIVE_UPTO, String(max));
    props.setProperty('chat_archive_last_run', new Date().toISOString());
    writeChatGuide_(ss);
    return { added: rows.length };
  });
  return done || { added: 0, busy: true };
}

/** The Guide tab inside the archive spreadsheet (rewritten on every archive run). */
function writeChatGuide_(ss) {
  var sh = ss.getSheetByName('Guide') || ss.insertSheet('Guide', 0);
  var props = PropertiesService.getScriptProperties();
  var audit = chatAuditState_();
  var regUrl = 'https://docs.google.com/spreadsheets/d/' + cfg_('REGISTRY_ID') + '/edit';
  var rows = [
    ['PJ PORTAL CHAT: GUIDE', '', ''],
    ['Last archived', props.getProperty('chat_archive_last_run') || 'not yet', 'Copied automatically every day at 23:00 IST, or with "Archive now" on the portal page Chat records.'],
    ['', '', ''],
    ['WHERE EVERYTHING IS STORED', 'Link', 'Who can open it'],
    ['Chat messages (live)', 'https://console.firebase.google.com/project/' + FIREBASE_PROJECT + '/firestore/databases/-default-/data/~2Fchats', 'Portal: only the two people of a chat (plus Admin / Owners / Managers while Audit is ON, for messages sent after it was turned on). Firebase console: project owner (mis@).'],
    ['Photos, videos, PDFs', 'https://drive.google.com/drive/folders/' + chatFolderId_(), 'mis@ only. One sub-folder per chat. Never shared by link.'],
    ['This archive (daily copy)', ss.getUrl(), 'mis@ only. Keep private.'],
    ['Who may chat', 'https://console.firebase.google.com/project/' + FIREBASE_PROJECT + '/firestore/databases/-default-/data/~2Fstaff', 'Copied from the Registry People tab (Active = Yes) every 10 minutes.'],
    ['Phone notification devices', regUrl, 'Registry tab "Portal Devices".'],
    ['Firestore usage (are we near a limit?)', 'https://console.firebase.google.com/project/' + FIREBASE_PROJECT + '/firestore/databases/-default-/usage', 'Firebase console.'],
    ['', '', ''],
    ['FREE LIMITS (Spark plan, no card, never billed)', 'Limit', 'Note'],
    ['Firestore: stored data', '1 GiB', 'Millions of text messages. Photos are NOT here (they are in Drive).'],
    ['Firestore: reads', '50,000 per day', 'Opening chats and the inbox. Resets daily at about 1:30 pm IST.'],
    ['Firestore: writes', '20,000 per day', 'Sending messages, "Seen".'],
    ['Firestore: deletes', '20,000 per day', 'The delete tool. Big clean-ups may need 2 days.'],
    ['Firestore: downloaded', '10 GiB per month', ''],
    ['Phone notifications (FCM)', 'Free, no limit', ''],
    ['Google sign-in (Firebase Auth)', 'Free for a team this size', ''],
    ['Photos / videos / PDFs', 'mis@ Workspace storage', 'Limits per file: photo 10 MB (shrunk to about 0.2 MB), video 25 MB, PDF 10 MB.'],
    ['Apps Script (mis@)', '100,000 web requests/day · 6 min per run · 6 h of timers/day', ''],
    ['If a limit is reached', 'That service pauses until the next reset', 'Nothing is lost and nothing is billed. Never add a card / Blaze plan to the Firebase project.'],
    ['', '', ''],
    ['HOW TO DELETE OLD CHATS', '', ''],
    ['1', 'Portal → 💬 Messages → "⚙️ Chat records" (Admin only)', 'Choose a person, one chat, and/or a date range → Preview → type DELETE → Delete.'],
    ['2', 'What happens', 'New messages are archived first. Then the messages are deleted from Firestore, their files go to the Drive bin (30 days to restore), and a row is added to "Deletion log". Archive rows stay unless you tick "also remove from the archive".'],
    ['3', 'Very large clean-ups', 'Up to 3,000 messages per run: press Delete again until it says nothing is left.'],
    ['4', 'Delete everything of one person who left', 'Choose that person, leave dates empty → Preview → Delete. Their staff record is turned off automatically when Active = No.'],
    ['', '', ''],
    ['AUDIT SETTING', audit.on ? 'ON since ' + new Date(audit.since).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'OFF', 'Only Admin can switch it (portal → Chat records). While ON, Admin, Owners and Managers can read chats sent after it was turned on; staff see a notice in Messages.']
  ];
  sh.clear();
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
  sh.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  [4, 12, 24, 30].forEach(function (r) { sh.getRange(r, 1, 1, 3).setFontWeight('bold').setBackground('#F4EBD2'); });
  sh.setColumnWidth(1, 300); sh.setColumnWidth(2, 380); sh.setColumnWidth(3, 520);
  sh.getRange(1, 1, rows.length, 3).setWrap(true).setVerticalAlignment('top');
}

/* ================= 2. Delete tool ================= */

/** chatPurge {session, person, chatId, from, to, files, archive, preview, confirm} (Admin only). */
function actionChatPurge_(req) {
  var user = requireAdmin_(req);
  var D = 864e5;
  var person = normaliseEmail_(req.person), chatId = String(req.chatId || '');
  var fromMs = /^\d{4}-\d{2}-\d{2}$/.test(req.from || '') ? istMidnight_(req.from) : 0;
  var toMs = /^\d{4}-\d{2}-\d{2}$/.test(req.to || '') ? istMidnight_(req.to) + D - 1 : 0;
  if (!person && !chatId && !fromMs && !toMs) throw apiError_('purge_needs_filter');

  var chats = listChats_().filter(function (c) {
    if (chatId && c._id !== chatId) return false;
    if (person && (c.members || []).indexOf(person) === -1) return false;
    return true;
  });
  var many = chatMessagesMany_(chats.map(function (c) { return c._id; }), { from: fromMs || null, to: toMs || null });
  var all = [];
  chats.forEach(function (c) { (many[c._id] || []).forEach(function (m) { m._chat = c._id; all.push(m); }); });
  var files = all.filter(function (m) { return m.file && m.file.id; });
  var names = staffNames_();
  var what = [person ? 'Person: ' + (names[person] || person) : '', chatId ? 'Chat: ' + chatId.split('__').map(function (e) { return names[e] || e; }).join(' – ') : '',
              'Dates: ' + (req.from || 'start') + ' to ' + (req.to || 'today')].filter(Boolean).join(' · ');

  if (req.preview || req.confirm !== 'DELETE') {
    return { ok: true, preview: true, what: what, chats: chats.filter(function (c) { return (many[c._id] || []).length; }).length,
             messages: all.length, files: files.length,
             oldest: all.length ? Math.min.apply(null, all.map(function (m) { return m.at; })) : null,
             newest: all.length ? Math.max.apply(null, all.map(function (m) { return m.at; })) : null };
  }

  archiveChats_();                                        // never delete anything that is not archived
  var batch = all.slice(0, PURGE_MAX);
  fsCommit_(batch.map(function (m) { return { 'delete': m._name }; }));
  var trashed = 0;
  if (req.files !== false) {
    batch.forEach(function (m) {
      if (!m.file || !m.file.id) return;
      try { Drive.Files.update({ trashed: true }, m.file.id); trashed++; } catch (e) { console.warn('Could not bin ' + m.file.id + ': ' + e); }
    });
  }

  // Fix each touched chat's "last message", or remove the chat if nothing is left
  var touched = {};
  batch.forEach(function (m) { touched[m._chat] = true; });
  var ids = Object.keys(touched), left = chatMessagesMany_(ids, { desc: true, limit: 1 }), writes = [], removed = 0;
  ids.forEach(function (id) {
    var last = (left[id] || [])[0];
    var name = fsDocName_('chats/' + id);
    if (!last) { writes.push({ 'delete': name }); removed++; return; }
    writes.push({ update: { name: name, fields: { last: { mapValue: { fields: {
      text: { stringValue: String(last.text || (last.file ? '📎 File' : '')).slice(0, 90) },
      at: { timestampValue: new Date(last.at).toISOString() }, from: { stringValue: last.from },
      kind: { stringValue: last.file ? last.file.kind || '' : '' } } } } } }, updateMask: { fieldPaths: ['last'] } });
  });
  fsCommit_(writes);

  var archiveRemoved = 0;
  if (req.archive === true) {
    var gone = {};
    batch.forEach(function (m) { gone[m._id] = true; });
    var sh = archiveBook_().getSheetByName('Messages');
    if (sh.getLastRow() > 1) {
      var vals = sh.getRange(2, 1, sh.getLastRow() - 1, ARCHIVE_HEADERS.length).getValues();
      var keep = vals.filter(function (r) { return !gone[String(r[10])]; });
      archiveRemoved = vals.length - keep.length;
      if (archiveRemoved) {
        sh.getRange(2, 1, vals.length, ARCHIVE_HEADERS.length).clearContent();
        if (keep.length) sh.getRange(2, 1, keep.length, ARCHIVE_HEADERS.length).setValues(keep);
      }
    }
  }
  archiveBook_().getSheetByName('Deletion log').appendRow([new Date(), user.email, safeCell_(what), batch.length, trashed, archiveRemoved, removed]);
  return { ok: true, deleted: batch.length, files: trashed, archiveRemoved: archiveRemoved, chatsRemoved: removed,
           more: all.length > batch.length ? all.length - batch.length : 0 };
}

/* ================= 3. Audit setting ================= */

function chatAuditState_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(CHAT_AUDIT_PROP) || '{}'); }
  catch (e) { return {}; }
}

function chatAuditAllows_(user, atMs) {
  var a = chatAuditState_();
  return Boolean(a.on && CHAT_AUDIT_ROLES.indexOf(user.role) > -1 && atMs >= a.since);
}

/** chatAuditSet {session, on} (Admin only). Also tells every portal (Firestore settings/chat) to show the notice. */
function actionChatAuditSet_(req) {
  var user = requireAdmin_(req);
  var on = req.on === true;
  var state = on ? { on: true, since: Date.now(), by: user.email } : { on: false, since: 0, by: user.email, offAt: Date.now() };
  PropertiesService.getScriptProperties().setProperty(CHAT_AUDIT_PROP, JSON.stringify(state));
  fsCommit_([{ update: { name: fsDocName_('settings/chat'), fields: {
    auditOn: { booleanValue: on }, since: { timestampValue: new Date(state.since || 0).toISOString() },
    roles: { arrayValue: { values: CHAT_AUDIT_ROLES.map(function (r) { return { stringValue: r }; }) } },
    updatedAt: { timestampValue: new Date().toISOString() } } } }]);
  try { writeChatGuide_(archiveBook_()); } catch (e) {}
  return { ok: true, audit: state };
}

/** auditChats {session}: chats with messages since audit was turned on (Admin / Owner / Manager, audit ON). */
function actionAuditChats_(req) {
  var user = findPerson_(readSession_(req.session));
  var a = chatAuditState_();
  if (!a.on || CHAT_AUDIT_ROLES.indexOf(user.role) === -1) throw apiError_('forbidden');
  var names = staffNames_();
  var list = listChats_().filter(function (c) { return c.last && c.last.at >= a.since; }).map(function (c) {
    return { id: c._id, members: c.members, names: (c.members || []).map(function (e) { return names[e] || e; }),
             last: { at: c.last.at, from: names[c.last.from] || c.last.from } };
  }).sort(function (x, y) { return y.last.at - x.last.at; });
  return { ok: true, since: a.since, chats: list };
}

/** auditThread {session, chatId}: messages sent since audit was turned on. */
function actionAuditThread_(req) {
  var user = findPerson_(readSession_(req.session));
  var a = chatAuditState_();
  if (!a.on || CHAT_AUDIT_ROLES.indexOf(user.role) === -1) throw apiError_('forbidden');
  var id = String(req.chatId || '');
  if (!/^[^\/]{5,300}__[^\/]{5,300}$/.test(id)) throw apiError_('bad_request');
  var names = staffNames_();
  var msgs = (chatMessagesMany_([id], { from: a.since })[id] || []).slice(-300).map(function (m) {
    return { at: m.at, from: m.from, fromName: names[m.from] || m.from, text: m.text || '', file: m.file || null };
  });
  return { ok: true, since: a.since, chatId: id, names: id.split('__').map(function (e) { return names[e] || e; }), messages: msgs };
}

/* ================= Page info ================= */

/** chatAdmin {session}: links, limits, archive status, audit state (Admin full; Owner/Manager audit part). */
function actionChatAdmin_(req) {
  var user = findPerson_(readSession_(req.session));
  if (CHAT_AUDIT_ROLES.indexOf(user.role) === -1) throw apiError_('forbidden');
  var a = chatAuditState_();
  var out = { ok: true, isAdmin: user.role === 'Admin', audit: { on: Boolean(a.on), since: a.since || null } };
  if (user.role !== 'Admin') return out;
  var props = PropertiesService.getScriptProperties();
  var archiveId = props.getProperty(CHAT_ARCHIVE_PROP);
  var chats = [];
  try { chats = listChats_(); } catch (e) { out.firestoreError = String(e).slice(0, 200); }
  var names = staffNames_();
  out.links = {
    firestore: 'https://console.firebase.google.com/project/' + FIREBASE_PROJECT + '/firestore/databases/-default-/data/~2Fchats',
    staff: 'https://console.firebase.google.com/project/' + FIREBASE_PROJECT + '/firestore/databases/-default-/data/~2Fstaff',
    usage: 'https://console.firebase.google.com/project/' + FIREBASE_PROJECT + '/firestore/databases/-default-/usage',
    files: 'https://drive.google.com/drive/folders/' + chatFolderId_(),
    archive: archiveId ? 'https://docs.google.com/spreadsheets/d/' + archiveId + '/edit' : '',
    devices: 'https://docs.google.com/spreadsheets/d/' + cfg_('REGISTRY_ID') + '/edit'
  };
  out.archive = { lastRun: props.getProperty('chat_archive_last_run') || null, upto: Number(props.getProperty(CHAT_ARCHIVE_UPTO) || 0) || null };
  out.chats = chats.map(function (c) {
    return { id: c._id, names: (c.members || []).map(function (e) { return names[e] || e; }), lastAt: c.last ? c.last.at : null };
  }).sort(function (x, y) { return (y.lastAt || 0) - (x.lastAt || 0); });
  out.people = loadPeople_(false).filter(function (p) { return PORTAL_ROLES.indexOf(p.role) > -1; })
    .map(function (p) { return { email: p.emails[0], name: p.name, active: p.active }; });
  out.devices = loadDevices_().length;
  return out;
}

/** archiveNow {session} (Admin only) */
function actionArchiveNow_(req) {
  requireAdmin_(req);
  var r = archiveChats_();
  return { ok: true, added: r.added, busy: Boolean(r.busy) };
}
